// End-to-end test of arkane-vsthost: plays the role of the bridge (creates the shm ring, spawns the sidecar,
// pushes blocks + events, reads audio back) and checks the results. No audio device is used (silent).
//
//   vsthost-test <arkane-vsthost> <arkane-test-synth.clap> [format:path[:uid] ...]
//
// Extra plugins (e.g. Kabee) get a smoke test: load, process 1 s of a sine, check output is finite and
// non-silent, state round trip. Set ARK_TEST_GUI=1 to also open/close each editor on $DISPLAY.
#include <fcntl.h>
#include <linux/futex.h>
#include <poll.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "protocol.h"
#include "util.h"

using namespace ark;

static int failures = 0;
#define CHECK(cond, ...)                                 \
  do {                                                   \
    if (cond) printf("  ok   " __VA_ARGS__);             \
    else { printf("  FAIL " __VA_ARGS__); failures++; }  \
    printf("\n");                                        \
  } while (0)

static const double SR = 48000;

struct Host {
  std::string exe, name;
  uint8_t* shm = nullptr;
  pid_t pid = -1;
  int toChild = -1, fromChild = -1;
  std::string buf;
  uint32_t written = 0;
  int nextId = 1;
  Json info;

  std::atomic<int32_t>& hdr(uint32_t i) { return *reinterpret_cast<std::atomic<int32_t>*>(shm + i * 4); }

  bool start(const std::string& format, const std::string& path, const std::string& uid) {
    static int n = 0;
    name = "/arkane-test-" + std::to_string(getpid()) + "-" + std::to_string(n++);
    int fd = shm_open(name.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
    if (fd < 0 || ftruncate(fd, kTotalBytes) != 0) return false;
    shm = (uint8_t*)mmap(nullptr, kTotalBytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    memset(shm, 0, kTotalBytes);
    hdr(H_MAGIC) = (int32_t)kMagic;
    hdr(H_VERSION) = (int32_t)kVersion;
    hdr(H_SLOTS) = (int32_t)kSlots;
    hdr(H_BLOCK) = (int32_t)kBlock;
    int in[2], out[2];
    if (pipe(in) || pipe(out)) return false;
    pid = fork();
    if (pid == 0) {
      dup2(in[0], 0);
      dup2(out[1], 1);
      close(in[1]);
      close(out[0]);
      std::string sr = std::to_string((int)SR);
      std::vector<const char*> args = {exe.c_str(), "host", "--format", format.c_str(), "--path", path.c_str(),
                                       "--sr", sr.c_str(), "--shm", name.c_str()};
      if (!uid.empty()) { args.push_back("--uid"); args.push_back(uid.c_str()); }
      args.push_back(nullptr);
      execv(exe.c_str(), (char* const*)args.data());
      _exit(127);
    }
    close(in[0]);
    close(out[1]);
    toChild = in[1];
    fromChild = out[0];
    Json ev = readLine(10000);
    shm_unlink(name.c_str());
    if (ev.str("ev") != "ready") {
      printf("  sidecar error: %s\n", ev.dump().c_str());
      return false;
    }
    info = *ev.get("info");
    return true;
  }

  Json readLine(int timeoutMs) {
    auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    for (;;) {
      size_t p = buf.find('\n');
      if (p != std::string::npos) {
        std::string line = buf.substr(0, p);
        buf.erase(0, p + 1);
        return Json::parse(line);
      }
      int left = (int)std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
      if (left <= 0) return Json();
      pollfd pf{fromChild, POLLIN, 0};
      if (poll(&pf, 1, left) <= 0) continue;
      char tmp[65536];
      ssize_t n = read(fromChild, tmp, sizeof tmp);
      if (n <= 0) return Json();
      buf.append(tmp, (size_t)n);
    }
  }

  /** Send a command and wait for its reply (skipping events). */
  Json call(Json cmd, int timeoutMs = 5000) {
    int id = nextId++;
    cmd["id"] = id;
    std::string s = cmd.dump() + "\n";
    if (write(toChild, s.data(), s.size()) != (ssize_t)s.size()) return Json();
    for (;;) {
      Json r = readLine(timeoutMs);
      if (r.type == Json::Null) return r;
      if (r.num("id", -1) == id) return r;
    }
  }
  Json cmd(const char* name) {
    Json c = Json::object();
    c["cmd"] = name;
    return call(c);
  }

  /** Process one block. Returns false on timeout (sidecar dead/hung). */
  bool block(const std::vector<WireEvent>& events, const float* inL, const float* inR, float* outL, float* outR,
             double ppq = 0) {
    uint8_t* slot = shm + kHeaderBytes + (written % kSlots) * kSlotBytes;
    uint32_t n = (uint32_t)std::min<size_t>(events.size(), kMaxEvents), flags = 0, frames = kBlock;
    double tempo = 120, pos = (double)written * kBlock;
    memcpy(slot + kSlotSeq, &written, 4);
    memcpy(slot + kSlotNumEvents, &n, 4);
    memcpy(slot + kSlotFlags, &flags, 4);
    memcpy(slot + kSlotFrames, &frames, 4);
    memcpy(slot + kSlotTempo, &tempo, 8);
    memcpy(slot + kSlotPpq, &ppq, 8);
    memcpy(slot + kSlotSamplePos, &pos, 8);
    memcpy(slot + kEventsOffset, events.data(), n * sizeof(WireEvent));
    float* in = (float*)(slot + kAudioInOffset);
    for (uint32_t i = 0; i < kBlock; i++) {
      in[i] = inL ? inL[i] : 0;
      in[kBlock + i] = inR ? inR[i] : 0;
    }
    written++;
    hdr(H_IN_WRITE).store((int32_t)written, std::memory_order_release);
    hdr(H_SIDECAR_BELL).fetch_add(1);
    syscall(SYS_futex, (int32_t*)&hdr(H_SIDECAR_BELL), FUTEX_WAKE, 1, nullptr, nullptr, 0);
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while ((uint32_t)hdr(H_OUT_WRITE).load(std::memory_order_acquire) != written) {
      if (std::chrono::steady_clock::now() > deadline) return false;
      int32_t bell = hdr(H_BRIDGE_BELL).load();
      if ((uint32_t)hdr(H_OUT_WRITE).load() == written) break;
      timespec ts{0, 2000000};
      syscall(SYS_futex, (int32_t*)&hdr(H_BRIDGE_BELL), FUTEX_WAIT, bell, &ts, nullptr, 0);
    }
    float* out = (float*)(slot + kAudioOutOffset);
    memcpy(outL, out, kBlock * 4);
    memcpy(outR, out + kBlock, kBlock * 4);
    return true;
  }

  int stop() {
    if (pid <= 0) return -1;
    Json q = Json::object();
    q["cmd"] = "quit";
    std::string s = q.dump() + "\n";
    (void)!write(toChild, s.data(), s.size());
    close(toChild);
    int status = 0;
    for (int i = 0; i < 300; i++) {
      if (waitpid(pid, &status, WNOHANG) == pid) { pid = -1; break; }
      usleep(10000);
    }
    if (pid > 0) { kill(pid, SIGKILL); waitpid(pid, &status, 0); pid = -1; }
    close(fromChild);
    munmap(shm, kTotalBytes);
    return status;
  }
};

static WireEvent ev(uint32_t type, uint32_t off, int a, int b, double v) { return WireEvent{type, off, a, b, v}; }
static float peak(const float* x, int n) { float p = 0; for (int i = 0; i < n; i++) p = std::max(p, std::fabs(x[i])); return p; }

static Json scan(const std::string& exe, const std::string& path) {
  std::string cmd = exe + " scan '" + path + "' 2>/dev/null";
  FILE* f = popen(cmd.c_str(), "r");
  std::string out;
  char b[4096];
  while (size_t n = fread(b, 1, sizeof b, f)) out.append(b, n);
  pclose(f);
  return Json::parse(out);
}

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: vsthost-test <arkane-vsthost> <test.clap> [format:path[:uid]...]\n"); return 2; }
  std::string exe = argv[1], clap = argv[2];
  float L[kBlock], R[kBlock], inL[kBlock], inR[kBlock];

  printf("scan %s\n", clap.c_str());
  {
    Json r = scan(exe, clap);
    auto* pl = r.get("plugins");
    CHECK(pl && pl->a.size() == 2, "two plugins found");
    if (pl && pl->a.size() == 2) {
      CHECK(pl->a[0].str("kind") == "instrument" && pl->a[0].str("uid") == "arkane.test.synth", "synth is an instrument");
      CHECK(pl->a[1].str("kind") == "effect" && pl->a[1].str("category") == "utility", "gain is a utility effect");
    }
    Json bad = scan(exe, "/nonexistent/thing.clap");
    CHECK(bad.get("error") != nullptr, "missing file reports an error");
  }

  printf("synth: notes, params, sample accuracy\n");
  {
    Host h;
    h.exe = exe;
    bool ok = h.start("clap", clap, "arkane.test.synth");
    CHECK(ok, "sidecar ready");
    if (!ok) return 1;
    CHECK(h.info.str("name") == "Arkane Test Synth" && h.info.str("kind") == "instrument", "info: name/kind");
    CHECK(h.info.get("params") && h.info.get("params")->a.size() == 3, "info: 3 params");
    h.block({}, nullptr, nullptr, L, R);
    CHECK(peak(L, kBlock) == 0, "silence without notes");
    h.block({ev(EV_NOTE_ON, 64, 69, 7, 1.0)}, nullptr, nullptr, L, R);
    CHECK(peak(L, 64) == 0 && peak(L + 64, 64) > 0.1, "note-on lands exactly at frame 64");
    // count zero crossings over ~0.5 s to estimate the frequency
    int crossings = 0;
    float prev = L[kBlock - 1], pk = 0;
    int blocks = (int)(SR / 2 / kBlock);
    for (int b = 0; b < blocks; b++) {
      h.block({}, nullptr, nullptr, L, R);
      for (int i = 0; i < (int)kBlock; i++) {
        if ((prev < 0) != (L[i] < 0)) crossings++;
        prev = L[i];
      }
      pk = std::max(pk, peak(L, kBlock));
    }
    double freq = crossings / 2.0 / (blocks * kBlock / SR);
    CHECK(std::fabs(freq - 440) < 3, "A4 = 440 Hz (measured %.1f)", freq);
    CHECK(std::fabs(pk - 0.5) < 0.01, "amplitude = velocity * gain(0.5) (measured %.3f)", pk);
    h.block({ev(EV_PARAM, 0, 0, 0, 1.0)}, nullptr, nullptr, L, R);
    h.block({}, nullptr, nullptr, L, R);
    CHECK(std::fabs(peak(L, kBlock) - 1.0) < 0.02, "param event: gain 1.0 (peak %.3f)", peak(L, kBlock));
    CHECK(memcmp(L, R, sizeof L) == 0, "stereo output");
    h.block({ev(EV_NOTE_OFF, 32, 69, 7, 0.5)}, nullptr, nullptr, L, R);
    CHECK(peak(L + 32, kBlock - 32) == 0 && peak(L, 32) > 0, "note-off at frame 32");
    h.block({ev(EV_NOTE_ON, 0, 60, 1, 1.0), ev(EV_NOTE_ON, 0, 64, 2, 1.0), ev(EV_NOTE_ON, 0, 67, 3, 1.0)}, nullptr, nullptr, L, R);
    CHECK(peak(L, kBlock) > 1.0, "chord plays");
    h.block({ev(EV_ALL_NOTES_OFF, 0, 0, 0, 0)}, nullptr, nullptr, L, R);
    h.block({}, nullptr, nullptr, L, R);
    CHECK(peak(L, kBlock) == 0, "all-notes-off silences held notes");
    // a stale note-off of a retriggered key must not cut the new note
    h.block({ev(EV_NOTE_ON, 0, 72, 10, 1.0), ev(EV_NOTE_ON, 10, 72, 11, 1.0), ev(EV_NOTE_OFF, 20, 72, 10, 0)}, nullptr, nullptr, L, R);
    CHECK(peak(L + 64, 64) > 0.1, "overlapping same-key notes handled by note id");
    h.block({ev(EV_ALL_NOTES_OFF, 0, 1, 0, 0)}, nullptr, nullptr, L, R);
    // tune param (stepped, -12..12): normalized 1.0 → +12 st
    h.block({ev(EV_PARAM, 0, 1, 0, 1.0)}, nullptr, nullptr, L, R);
    Json vals = h.cmd("values");
    auto* v = vals.get("values");
    CHECK(v && std::fabs(v->num("0") - 1.0) < 1e-6 && std::fabs(v->num("1") - 1.0) < 1e-6, "values reflect params");
    Json pt = Json::object();
    pt["cmd"] = "paramText";
    pt["param"] = 1;
    pt["value"] = 0.25;
    CHECK(h.call(pt).str("text") == "-6 st", "paramText via value_to_text");
    Json st = h.cmd("getState");
    std::string state = st.str("data");
    CHECK(st.get("ok") && st.get("ok")->b && !state.empty(), "getState returns base64 chunk (%zu chars)", state.size());
    Json ed = h.cmd("showEditor");
    if (getenv("ARK_TEST_GUI") && getenv("DISPLAY")) {
      CHECK(ed.get("ok") && ed.get("ok")->b, "editor opens on $DISPLAY");
      std::this_thread::sleep_for(std::chrono::milliseconds(300));
      CHECK(h.cmd("hideEditor").get("ok")->b, "editor closes");
    } else printf("  skip editor (set ARK_TEST_GUI=1 with a DISPLAY)\n");
    int status = h.stop();
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0, "clean quit");

    printf("synth: state restore in a fresh instance\n");
    Host h2;
    h2.exe = exe;
    CHECK(h2.start("clap", clap, "arkane.test.synth"), "second instance ready");
    Json ss = Json::object();
    ss["cmd"] = "setState";
    ss["data"] = state;
    CHECK(h2.call(ss).get("ok")->b, "setState ok");
    Json v2 = h2.cmd("values");
    CHECK(std::fabs(v2.get("values")->num("0") - 1.0) < 1e-6 && std::fabs(v2.get("values")->num("1") - 1.0) < 1e-6,
          "restored gain/tune");
    h2.block({ev(EV_NOTE_ON, 0, 57, 1, 1.0)}, nullptr, nullptr, L, R);  // A3 + 12 st = 440 Hz
    int cr = 0;
    float pv = L[kBlock - 1];
    for (int b = 0; b < 188; b++) {
      h2.block({}, nullptr, nullptr, L, R);
      for (int i = 0; i < (int)kBlock; i++) { if ((pv < 0) != (L[i] < 0)) cr++; pv = L[i]; }
    }
    double f2 = cr / 2.0 / (188 * kBlock / SR);
    CHECK(std::fabs(f2 - 440) < 3, "restored tune transposes A3 to 440 Hz (%.1f)", f2);

    printf("synth: plugin crash is contained\n");
    h2.block({ev(EV_PARAM, 0, 99, 0, 1.0)}, nullptr, nullptr, L, R);
    int cst = 0;
    pid_t w = 0;
    for (int i = 0; i < 300 && w == 0; i++) { w = waitpid(h2.pid, &cst, WNOHANG); usleep(10000); }
    CHECK(w == h2.pid && WIFSIGNALED(cst), "sidecar died with signal %d, host survived", WIFSIGNALED(cst) ? WTERMSIG(cst) : 0);
    h2.pid = -1;
    h2.stop();
  }

  printf("gain effect: audio in → out, latency\n");
  {
    Host h;
    h.exe = exe;
    CHECK(h.start("clap", clap, "arkane.test.gain"), "sidecar ready");
    CHECK(h.info.num("latency") == 64, "reports 64 samples latency");
    for (int i = 0; i < (int)kBlock; i++) { inL[i] = (float)std::sin(i * 0.1); inR[i] = (float)std::cos(i * 0.1); }
    h.block({ev(EV_PARAM, 0, 0, 0, 0.25)}, inL, inR, L, R);  // 0..2 → 0.5
    bool same = true;
    for (int i = 0; i < (int)kBlock; i++) same &= std::fabs(L[i] - inL[i] * 0.5f) < 1e-6 && std::fabs(R[i] - inR[i] * 0.5f) < 1e-6;
    CHECK(same, "out = in * 0.5");
    // throughput: 2 s of audio
    auto t0 = std::chrono::steady_clock::now();
    int nb = (int)(SR * 2 / kBlock);
    for (int b = 0; b < nb; b++) h.block({}, inL, inR, L, R);
    double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    CHECK(ms < 2000, "round-trip %d blocks in %.0f ms (%.1f us/block)", nb, ms, ms * 1000 / nb);
    h.stop();
  }

  for (int i = 3; i < argc; i++) {
    std::string spec = argv[i];
    size_t c1 = spec.find(':');
    std::string format = spec.substr(0, c1), rest = spec.substr(c1 + 1), uid;
    printf("smoke test %s\n", spec.c_str());
    Json sc = scan(exe, rest);
    CHECK(sc.get("plugins") && !sc.get("plugins")->a.empty(), "scan finds it");
    Host h;
    h.exe = exe;
    if (!h.start(format, rest, uid)) { CHECK(false, "sidecar ready"); continue; }
    printf("  info: %s by %s, %s, %zu params, editor=%d\n", h.info.str("name").c_str(), h.info.str("vendor").c_str(),
           h.info.str("kind").c_str(), h.info.get("params")->a.size(), h.info.get("hasEditor") && h.info.get("hasEditor")->b);
    bool finite = true;
    float pk = 0;
    for (int b = 0; b < (int)(SR / kBlock); b++) {
      for (int k = 0; k < (int)kBlock; k++) inL[k] = inR[k] = 0.3f * (float)std::sin(2 * M_PI * 110 * (b * kBlock + k) / SR);
      std::vector<WireEvent> e;
      if (b == 0) e.push_back(ev(EV_NOTE_ON, 0, 60, 1, 0.8));
      if (!h.block(e, inL, inR, L, R)) { finite = false; break; }
      for (int k = 0; k < (int)kBlock; k++) finite &= std::isfinite(L[k]) && std::isfinite(R[k]);
      pk = std::max(pk, peak(L, kBlock));
    }
    CHECK(finite, "1 s processed, output finite");
    CHECK(pk > 1e-4, "output not silent (peak %.3f)", pk);
    if (h.info.str("kind") == "instrument") {
      // the note from block 0 is still held: measure pitch, then bend up 2 semitones
      auto measure = [&](std::vector<WireEvent> first) {
        int cr = 0;
        float pv = 0;
        int nb = (int)(SR / 2 / kBlock);
        for (int b = 0; b < nb; b++) {
          h.block(b == 0 ? first : std::vector<WireEvent>{}, nullptr, nullptr, L, R);
          if (b < 4) { pv = L[kBlock - 1]; continue; }  // let the bend settle
          for (int k = 0; k < (int)kBlock; k++) { if ((pv < 0) != (L[k] < 0)) cr++; pv = L[k]; }
        }
        return cr / 2.0 / ((nb - 4) * kBlock / SR);
      };
      // C4 (60) was played: 261.6 Hz
      double f0 = measure({});
      CHECK(std::fabs(f0 - 261.63) < 3, "note-on → C4 (%.1f Hz)", f0);
      double f1 = measure({ev(EV_PITCHBEND, 0, 0, 0, 1.0)});
      CHECK(std::fabs(f1 - 293.66) < 4, "pitch bend +2 st → D4 (%.1f Hz)", f1);
      h.block({ev(EV_PITCHBEND, 0, 0, 0, 0.0), ev(EV_NOTE_OFF, 0, 60, 1, 0.5)}, nullptr, nullptr, L, R);
      h.block({}, nullptr, nullptr, L, R);
      CHECK(peak(L, kBlock) < 1e-4, "note-off → silence");
    }
    Json st = h.cmd("getState");
    CHECK(st.get("ok") && st.get("ok")->b, "getState (%zu chars)", st.str("data").size());
    Json ss = Json::object();
    ss["cmd"] = "setState";
    ss["data"] = st.str("data");
    CHECK(h.call(ss).get("ok")->b, "setState round trip");
    Json params = h.cmd("params");
    CHECK(params.get("params") != nullptr, "params with values/text");
    if (getenv("ARK_TEST_GUI") && getenv("DISPLAY") && h.info.get("hasEditor")->b) {
      Json ed = h.cmd("showEditor");
      CHECK(ed.get("ok") && ed.get("ok")->b, "editor opens %s", ed.str("error").c_str());
      for (int k = 0; k < 20; k++) h.block({}, inL, inR, L, R);  // keep audio running while the GUI is up
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      CHECK(h.cmd("hideEditor").get("ok")->b, "editor closes");
    }
    int status = h.stop();
    CHECK(WIFEXITED(status), "quit (status %d)", status);
  }

  printf(failures ? "\n%d FAILURE(S)\n" : "\nall tests passed\n", failures);
  return failures ? 1 : 0;
}
