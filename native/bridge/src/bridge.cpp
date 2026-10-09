// arkane_bridge.node — copies audio blocks between renderer SharedArrayBuffers and the POSIX shared memory
// of arkane-vsthost sidecars (layout: native/vsthost/src/protocol.h).
//
// Why a copier thread: Electron's V8 sandbox forbids external ArrayBuffers, so the SAB must be allocated by V8
// and cannot itself live in shm; the AudioWorklet cannot call native code, and Atomics.notify() does not wake
// OS futexes. One native thread therefore polls every attached SAB (~every 200 µs while audio flows), forwards
// new input blocks to the sidecar's shm (ringing its futex) and copies processed audio back into the SAB.
// The audio thread itself never blocks: missing output is an xrun the worklet handles.
//
// Pure N-API (ABI-stable): the same binary loads in Node and in Electron.
//
//   open(view: Int32Array over a SAB of kTotalBytes) -> { id, shm }   // creates /arkane-<pid>-<n>
//   unlink(id)            remove the shm name (after the sidecar mapped it)
//   close(id)             detach + unmap + unlink
//   stats() -> { instances, passes, forwarded, returned }
//   setPollMicros(us)
#include <fcntl.h>
#include <linux/futex.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sched.h>
#include <time.h>
#include <unistd.h>

#include <atomic>
#include <condition_variable>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#define NAPI_VERSION 8
#include "node_api.h"
#include "../../vsthost/src/protocol.h"

using namespace ark;

namespace {

struct Instance {
  int id;
  std::string name;
  uint8_t* sab;  // V8 SharedArrayBuffer backing store (kept alive by `ref`)
  uint8_t* shm;
  napi_ref ref = nullptr;
  uint32_t forwarded = 0;  // blocks copied SAB → shm
  uint32_t returned = 0;   // blocks copied shm → SAB
  bool unlinked = false;
};

int32_t* word(uint8_t* base, uint32_t i) { return reinterpret_cast<int32_t*>(base + i * 4); }
int32_t load(uint8_t* base, uint32_t i) { return __atomic_load_n(word(base, i), __ATOMIC_ACQUIRE); }
void store(uint8_t* base, uint32_t i, int32_t v) { __atomic_store_n(word(base, i), v, __ATOMIC_RELEASE); }

// Intentionally leaked: process.exit() runs static destructors while the copier thread may still be waiting on
// the condition variable (glibc's pthread_cond_destroy would block forever).
std::mutex& gMx = *new std::mutex;
std::condition_variable& gCv = *new std::condition_variable;
std::vector<std::shared_ptr<Instance>>& gInstances = *new std::vector<std::shared_ptr<Instance>>;
bool gThreadRunning = false;
std::atomic<bool> gThreadExited{true};
std::atomic<int> gPollMicros{200};
std::atomic<uint64_t> gPasses{0}, gForwarded{0}, gReturned{0};
int gNextId = 1;

/** One pass over an instance. Returns true if anything moved. */
bool service(Instance& in) {
  bool moved = false;
  uint8_t* sab = in.sab;
  uint8_t* shm = in.shm;
  // SAB → shm (input blocks + events)
  uint32_t sabIn = (uint32_t)load(sab, H_IN_WRITE);
  uint32_t shmOut = (uint32_t)load(shm, H_OUT_WRITE);
  uint32_t fwd = in.forwarded;
  while (fwd != sabIn && fwd - shmOut < kSlots - 1) {
    size_t off = kHeaderBytes + (size_t)(fwd % kSlots) * kSlotBytes;
    uint32_t nev;
    memcpy(&nev, sab + off + kSlotNumEvents, 4);
    if (nev > kMaxEvents) nev = kMaxEvents;
    memcpy(shm + off, sab + off, kSlotHeaderBytes + nev * kEventBytes);
    memcpy(shm + off + kAudioInOffset, sab + off + kAudioInOffset, kChannels * kBlock * 4);
    fwd++;
  }
  if (fwd != in.forwarded) {
    gForwarded += fwd - in.forwarded;
    in.forwarded = fwd;
    store(shm, H_IN_WRITE, (int32_t)fwd);
    __atomic_fetch_add(word(shm, H_SIDECAR_BELL), 1, __ATOMIC_RELEASE);
    syscall(SYS_futex, word(shm, H_SIDECAR_BELL), FUTEX_WAKE, 1, nullptr, nullptr, 0);
    moved = true;
  }
  // shm → SAB (processed audio)
  shmOut = (uint32_t)load(shm, H_OUT_WRITE);
  uint32_t ret = in.returned;
  while (ret != shmOut) {
    size_t off = kHeaderBytes + (size_t)(ret % kSlots) * kSlotBytes + kAudioOutOffset;
    memcpy(sab + off, shm + off, kChannels * kBlock * 4);
    ret++;
  }
  if (ret != in.returned) {
    gReturned += ret - in.returned;
    in.returned = ret;
    store(sab, H_OUT_WRITE, (int32_t)ret);
    moved = true;
  }
  return moved;
}

int64_t nowNs() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

void threadMain() {
  std::vector<std::shared_ptr<Instance>> local;
  int idlePasses = 0;
  int64_t lastMove = 0;
  for (;;) {
    {
      std::unique_lock<std::mutex> lk(gMx);
      gCv.wait(lk, [] { return !gInstances.empty() || !gThreadRunning; });
      if (!gThreadRunning) break;
      local = gInstances;  // shared_ptr copies: instances stay mapped during this pass
    }
    bool moved = false;
    for (auto& in : local) moved |= service(*in);
    local.clear();
    gPasses++;
    int64_t now = nowNs();
    if (moved) {
      idlePasses = 0;
      lastMove = now;
      continue;
    }
    idlePasses++;
    // Right after traffic, keep polling for ~300 µs: the sidecar's answer is usually microseconds away
    // (and offline rendering waits for every block).
    if (now - lastMove < 300000) {
      sched_yield();
      continue;
    }
    // Back off when audio is stopped (suspended context): a few seconds of nothing → poll at 2 ms.
    int us = idlePasses > 10000 ? 2000 : gPollMicros.load();
    timespec ts{0, (long)us * 1000};
    nanosleep(&ts, nullptr);
  }
  gThreadExited = true;
}

void destroyInstance(napi_env env, Instance& in) {
  if (in.shm) munmap(in.shm, kTotalBytes);
  in.shm = nullptr;
  if (!in.unlinked) shm_unlink(in.name.c_str());
  in.unlinked = true;
  if (in.ref && env) napi_delete_reference(env, in.ref);
  in.ref = nullptr;
}

napi_value throwError(napi_env env, const char* msg) {
  napi_throw_error(env, nullptr, msg);
  return nullptr;
}

napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool isTA = false;
  if (argc < 1 || napi_is_typedarray(env, argv[0], &isTA) != napi_ok || !isTA)
    return throwError(env, "open(view): expected an Int32Array over a SharedArrayBuffer");
  napi_typedarray_type type;
  size_t length;
  void* data = nullptr;
  napi_value ab;
  size_t byteOffset;
  if (napi_get_typedarray_info(env, argv[0], &type, &length, &data, &ab, &byteOffset) != napi_ok || !data)
    return throwError(env, "open(view): cannot access buffer memory");
  if (type != napi_int32_array || length * 4 < kTotalBytes) return throwError(env, "open(view): buffer too small");
  auto in = std::make_shared<Instance>();
  {
    std::lock_guard<std::mutex> lk(gMx);
    in->id = gNextId++;
  }
  in->name = "/arkane-" + std::to_string(getpid()) + "-" + std::to_string(in->id);
  in->sab = (uint8_t*)data;
  int fd = shm_open(in->name.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
  if (fd < 0) {
    shm_unlink(in->name.c_str());
    fd = shm_open(in->name.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
  }
  if (fd < 0) return throwError(env, "shm_open failed");
  if (ftruncate(fd, kTotalBytes) != 0) {
    close(fd);
    shm_unlink(in->name.c_str());
    return throwError(env, "ftruncate failed");
  }
  void* p = mmap(nullptr, kTotalBytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) {
    shm_unlink(in->name.c_str());
    return throwError(env, "mmap failed");
  }
  in->shm = (uint8_t*)p;
  memset(in->shm, 0, kHeaderBytes);
  store(in->shm, H_MAGIC, (int32_t)kMagic);
  store(in->shm, H_VERSION, (int32_t)kVersion);
  store(in->shm, H_SLOTS, (int32_t)kSlots);
  store(in->shm, H_BLOCK, (int32_t)kBlock);
  in->forwarded = (uint32_t)load(in->sab, H_IN_WRITE);
  in->returned = in->forwarded;
  store(in->shm, H_IN_WRITE, (int32_t)in->forwarded);
  store(in->shm, H_OUT_WRITE, (int32_t)in->forwarded);
  // Re-attaching an existing SAB (sidecar restart): everything before this point counts as delivered.
  store(in->sab, H_OUT_WRITE, (int32_t)in->forwarded);
  napi_create_reference(env, argv[0], 1, &in->ref);
  {
    std::lock_guard<std::mutex> lk(gMx);
    gInstances.push_back(in);
    if (!gThreadRunning) {
      // wait for a previous thread (env teardown) to finish before starting a new one
      while (!gThreadExited.load()) std::this_thread::yield();
      gThreadRunning = true;
      gThreadExited = false;
      std::thread(threadMain).detach();  // detached: process.exit() must not hit a joinable std::thread
    }
  }
  gCv.notify_all();
  napi_value res, idv, namev;
  napi_create_object(env, &res);
  napi_create_int32(env, in->id, &idv);
  napi_create_string_utf8(env, in->name.c_str(), in->name.size(), &namev);
  napi_set_named_property(env, res, "id", idv);
  napi_set_named_property(env, res, "shm", namev);
  return res;
}

int argId(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t id = -1;
  if (argc >= 1) napi_get_value_int32(env, argv[0], &id);
  return id;
}

napi_value Unlink(napi_env env, napi_callback_info info) {
  int id = argId(env, info);
  std::lock_guard<std::mutex> lk(gMx);
  for (auto& in : gInstances)
    if (in->id == id && !in->unlinked) {
      shm_unlink(in->name.c_str());
      in->unlinked = true;
    }
  return nullptr;
}

napi_value Close(napi_env env, napi_callback_info info) {
  int id = argId(env, info);
  std::shared_ptr<Instance> victim;
  {
    std::lock_guard<std::mutex> lk(gMx);
    for (size_t i = 0; i < gInstances.size(); i++)
      if (gInstances[i]->id == id) {
        victim = gInstances[i];
        gInstances.erase(gInstances.begin() + i);
        break;
      }
  }
  if (!victim) return nullptr;
  // The copier may still hold a shared_ptr for the current pass: wait until we are the last owner.
  for (int i = 0; i < 1000 && victim.use_count() > 1; i++) {
    timespec ts{0, 100000};
    nanosleep(&ts, nullptr);
  }
  destroyInstance(env, *victim);
  return nullptr;
}

napi_value Stats(napi_env env, napi_callback_info) {
  napi_value res, v;
  napi_create_object(env, &res);
  size_t n;
  {
    std::lock_guard<std::mutex> lk(gMx);
    n = gInstances.size();
  }
  napi_create_uint32(env, (uint32_t)n, &v);
  napi_set_named_property(env, res, "instances", v);
  napi_create_double(env, (double)gPasses.load(), &v);
  napi_set_named_property(env, res, "passes", v);
  napi_create_double(env, (double)gForwarded.load(), &v);
  napi_set_named_property(env, res, "forwarded", v);
  napi_create_double(env, (double)gReturned.load(), &v);
  napi_set_named_property(env, res, "returned", v);
  return res;
}

napi_value SetPollMicros(napi_env env, napi_callback_info info) {
  int us = argId(env, info);
  if (us >= 20 && us <= 5000) gPollMicros = us;
  return nullptr;
}

void cleanup(void*) {
  {
    std::lock_guard<std::mutex> lk(gMx);
    gThreadRunning = false;
  }
  gCv.notify_all();
  for (int i = 0; i < 2000 && !gThreadExited.load(); i++) {
    timespec ts{0, 1000000};
    nanosleep(&ts, nullptr);
  }
  std::lock_guard<std::mutex> lk(gMx);
  for (auto& in : gInstances) {
    in->ref = nullptr;  // env is going away; V8 frees its own handles
    destroyInstance(nullptr, *in);
  }
  gInstances.clear();
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"open", nullptr, Open, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"unlink", nullptr, Unlink, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stats", nullptr, Stats, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setPollMicros", nullptr, SetPollMicros, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof props / sizeof props[0], props);
  napi_value v;
  napi_create_uint32(env, kTotalBytes, &v);
  napi_set_named_property(env, exports, "totalBytes", v);
  napi_create_uint32(env, kVersion, &v);
  napi_set_named_property(env, exports, "protocolVersion", v);
  napi_add_env_cleanup_hook(env, cleanup, nullptr);
  return exports;
}

}  // namespace

NAPI_MODULE(arkane_bridge, Init)
