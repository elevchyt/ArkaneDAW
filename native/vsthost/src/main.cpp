// arkane-vsthost — out-of-process plugin host ("bridge") for ArkaneDAW.
//
//   arkane-vsthost scan <file-or-bundle>
//       Prints {"plugins":[...]} (or {"error":...}) as one JSON line and exits. Run with a timeout by the caller.
//   arkane-vsthost host --format clap|vst3|vst2 --path <p> [--uid <id>] --sr <rate> --shm </name>
//                       [--title <window title>] [--transient-for <xid>]
//       Loads one plugin instance, attaches to the shared-memory block ring (see protocol.h), processes audio on a
//       dedicated thread and serves JSON-line commands on stdin / events on stdout. Plugin editors open in their
//       own X11 top-level window. Exits when stdin closes (the DAW went away) or on {"cmd":"quit"}.
//
// stdout is reserved for the protocol: fd 1 is redirected to stderr so chatty plugins cannot corrupt it.
#include <errno.h>
#include <fcntl.h>
#include <linux/futex.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <mutex>
#include <thread>
#include <unordered_map>

#include "plugin.h"
#include "protocol.h"
#include "spsc.h"
#include "util.h"
#include "x11.h"

using namespace ark;

namespace {

int gProtoFd = 1;

void sendLine(const Json& j) {
  std::string s = j.dump();
  s += '\n';
  const char* p = s.data();
  size_t left = s.size();
  while (left) {
    ssize_t n = write(gProtoFd, p, left);
    if (n < 0) {
      if (errno == EINTR) continue;
      return;
    }
    p += n;
    left -= (size_t)n;
  }
}

int64_t nowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

int futexWait(std::atomic<int32_t>* addr, int32_t expected, int timeoutMs) {
  timespec ts{timeoutMs / 1000, (long)(timeoutMs % 1000) * 1000000L};
  return (int)syscall(SYS_futex, (int32_t*)addr, FUTEX_WAIT, expected, &ts, nullptr, 0);
}
void futexWake(std::atomic<int32_t>* addr) { syscall(SYS_futex, (int32_t*)addr, FUTEX_WAKE, INT32_MAX, nullptr, nullptr, 0); }

Json descToJson(const PluginDesc& d) {
  Json j = Json::object();
  j["format"] = d.format;
  j["path"] = d.path;
  j["uid"] = d.uid;
  j["name"] = d.name;
  j["vendor"] = d.vendor;
  j["version"] = d.version;
  j["category"] = d.category;
  j["kind"] = d.instrument ? "instrument" : "effect";
  if (d.hasEditor >= 0) j["hasEditor"] = d.hasEditor == 1;
  return j;
}

/** Minimal HostServices for scan mode (VST2 needs a host callback target). */
class NullHost : public HostServices {
 public:
  void paramFromPlugin(uint32_t, double) override {}
  void stateDirty() override {}
  void latencyChanged() override {}
  void paramsRescanned() override {}
  void requestMainCallback() override {}
  void requestRestart() override {}
  bool resizeEditor(int, int) override { return false; }
  void editorClosedByPlugin() override {}
  int registerTimer(int, std::function<void()>) override { return 0; }
  void unregisterTimer(int) override {}
  void registerFd(int, int, std::function<void(int)>) override {}
  void modifyFd(int, int) override {}
  void unregisterFd(int) override {}
  void runWithAudioLocked(const std::function<void()>& fn) override { fn(); }
  double sampleRate() const override { return 48000; }
  bool isAudioThread() const override { return false; }
  bool isMainThread() const override { return true; }
};

int runScan(const std::string& path) {
  std::vector<PluginDesc> out;
  std::string err;
  bool ok = false;
  NullHost host;
  if (endsWith(path, ".clap")) ok = scanClap(path, out, err);
  else if (endsWith(path, ".vst3") || endsWith(path, ".vst3/")) ok = scanVst3(path, out, err);
  else if (endsWith(path, ".so")) ok = scanVst2(path, out, err, &host);
  else err = "unknown plugin format";
  Json j = Json::object();
  if (!ok) j["error"] = err.empty() ? "scan failed" : err;
  Json arr = Json::array();
  for (auto& d : out) arr.push(descToJson(d));
  j["plugins"] = arr;
  sendLine(j);
  fflush(stderr);
  // Skip global destructors of possibly misbehaving plugins.
  _exit(ok ? 0 : 2);
}

// ── host mode ────────────────────────────────────────────────────────────────
struct ParamNote { uint32_t id; double v; };

class Sidecar final : public HostServices {
 public:
  std::string format, path, uid, shmName, title;
  double sr = 48000, scale = 1.0;
  unsigned long transientFor = 0;

  int run() {
    mainTid = std::this_thread::get_id();
    if (xlib.load()) {
      xlib.XInitThreads();
      // Xlib's default error handler exit()s the process: log instead (bad transient-for id, sloppy plugin GUIs).
      xlib.XSetErrorHandler([](x11::Display*, void* ev) -> int {
        const unsigned char* e = (const unsigned char*)ev;  // XErrorEvent: error_code at offset 32, request_code 33
        fprintf(stderr, "[arkane-vsthost] X error %d (request %d) ignored\n", e[32], e[33]);
        return 0;
      });
    }
    if (!attachShm()) return fail("cannot open shared memory " + shmName);
    if (format == "clap") plugin = createClapPlugin(this);
    else if (format == "vst3") plugin = createVst3Plugin(this);
    else if (format == "vst2") plugin = createVst2Plugin(this);
    else return fail("unknown format " + format);
    std::string err;
    if (!plugin->load(path, uid, err)) return fail(err.empty() ? "load failed" : err);
    if (!plugin->activate(sr, 4096)) return fail("activate failed");
    hdr(H_SIDECAR_ALIVE).store(1);
    audioThread = std::thread([this] { audioLoop(); });
    Json ready = Json::object();
    ready["ev"] = "ready";
    ready["info"] = infoJson();
    sendLine(ready);
    mainLoop();
    shutdown();
    return 0;
  }

  // HostServices
  void paramFromPlugin(uint32_t id, double norm) override {
    if (isAudioThread()) audioParams.push({id, norm});
    else {
      std::lock_guard<std::mutex> lk(paramMx);
      mainParams[id] = norm;
    }
  }
  void stateDirty() override { dirty.store(true); }
  void latencyChanged() override { latencyDirty.store(true); }
  void paramsRescanned() override { paramsDirty.store(true); }
  void requestMainCallback() override { mainCallback.store(true); }
  void requestRestart() override { restart.store(true); }
  bool resizeEditor(int w, int h) override {
    if (!isMainThread()) {
      pendingW.store(w);
      pendingH.store(h);
      return true;
    }
    if (!editorWin) return true;  // size is read when the editor opens
    applyEditorSize(w, h);
    return true;
  }
  void editorClosedByPlugin() override { closeRequested.store(true); }
  int registerTimer(int periodMs, std::function<void()> cb) override {
    int id = nextTimerId++;
    timers[id] = {periodMs, nowMs() + periodMs, std::move(cb)};
    return id;
  }
  void unregisterTimer(int id) override { timers.erase(id); }
  void registerFd(int fd, int flags, std::function<void(int)> cb) override { fds[fd] = {flags, std::move(cb)}; }
  void modifyFd(int fd, int flags) override {
    auto it = fds.find(fd);
    if (it != fds.end()) it->second.flags = flags;
  }
  void unregisterFd(int fd) override { fds.erase(fd); }
  void runWithAudioLocked(const std::function<void()>& fn) override {
    std::lock_guard<std::mutex> lk(procMx);
    fn();
  }
  double sampleRate() const override { return sr; }
  double uiScale() const override { return scale; }
  bool isAudioThread() const override { return std::this_thread::get_id() == audioTid.load(); }
  bool isMainThread() const override { return std::this_thread::get_id() == mainTid; }

 private:
  struct Timer { int period; int64_t next; std::function<void()> cb; };
  struct FdReg { int flags; std::function<void(int)> cb; };

  std::atomic<int32_t>& hdr(uint32_t i) { return *reinterpret_cast<std::atomic<int32_t>*>(shm + i * 4); }

  int fail(const std::string& msg) {
    Json j = Json::object();
    j["ev"] = "error";
    j["message"] = msg;
    sendLine(j);
    fflush(stderr);
    _exit(3);
  }

  bool attachShm() {
    int fd = shm_open(shmName.c_str(), O_RDWR, 0600);
    if (fd < 0) return false;
    void* p = mmap(nullptr, kTotalBytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) return false;
    shm = (uint8_t*)p;
    if (hdr(H_MAGIC).load() != (int32_t)kMagic || hdr(H_VERSION).load() != (int32_t)kVersion) return false;
    return true;
  }

  Json infoJson() {
    Json info = descToJson(plugin->desc());
    info["hasEditor"] = plugin->hasEditor();
    info["latency"] = (double)plugin->latency();
    info["params"] = paramsJson(false);
    return info;
  }

  Json paramsJson(bool withValues) {
    Json arr = Json::array();
    for (auto& p : plugin->params()) {
      Json j = Json::object();
      j["id"] = (double)p.id;
      j["name"] = p.name;
      if (!p.unit.empty()) j["unit"] = p.unit;
      if (!p.group.empty()) j["group"] = p.group;
      j["default"] = p.def;
      if (p.steps) j["steps"] = p.steps;
      if (!p.automatable) j["automatable"] = false;
      if (p.hidden) j["hidden"] = true;
      if (p.readonly) j["readonly"] = true;
      if (withValues) {
        double v = plugin->getParam(p.id);
        j["value"] = v;
        j["text"] = plugin->paramText(p.id, v);
      }
      arr.push(j);
    }
    return arr;
  }

  // ── audio thread ───────────────────────────────────────────────────────────
  void audioLoop() {
    audioTid.store(std::this_thread::get_id());
    sched_param sp{};
    sp.sched_priority = 70;
    pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);  // best effort (needs rtprio/rtkit)
    evs.reserve(1024);
    while (!quit.load()) {
      int32_t bell = hdr(H_SIDECAR_BELL).load(std::memory_order_acquire);
      uint32_t inW = (uint32_t)hdr(H_IN_WRITE).load(std::memory_order_acquire);
      uint32_t outW = (uint32_t)hdr(H_OUT_WRITE).load(std::memory_order_relaxed);
      if (inW == outW) {
        futexWait(&hdr(H_SIDECAR_BELL), bell, 100);
        continue;
      }
      while (outW != inW && !quit.load()) {
        processSlot(shm + kHeaderBytes + (outW % kSlots) * kSlotBytes);
        outW++;
        hdr(H_OUT_WRITE).store((int32_t)outW, std::memory_order_release);
      }
      hdr(H_BRIDGE_BELL).fetch_add(1, std::memory_order_release);
      futexWake(&hdr(H_BRIDGE_BELL));
    }
    std::lock_guard<std::mutex> lk(procMx);
    plugin->audioThreadStop();
  }

  void processSlot(uint8_t* slot) {
    uint32_t numEv, flags, frames;
    double tempo, ppq, samplePos;
    memcpy(&numEv, slot + kSlotNumEvents, 4);
    memcpy(&flags, slot + kSlotFlags, 4);
    memcpy(&frames, slot + kSlotFrames, 4);
    memcpy(&tempo, slot + kSlotTempo, 8);
    memcpy(&ppq, slot + kSlotPpq, 8);
    memcpy(&samplePos, slot + kSlotSamplePos, 8);
    numEv = std::min(numEv, kMaxEvents);
    if (frames == 0 || frames > kBlock) frames = kBlock;
    evs.clear();
    const WireEvent* raw = (const WireEvent*)(slot + kEventsOffset);
    for (uint32_t i = 0; i < numEv; i++) {
      WireEvent e = raw[i];
      if (e.offset >= frames) e.offset = frames - 1;
      if (e.type == EV_ALL_NOTES_OFF) {
        for (int k = 0; k < 128; k++)
          if (held[k] != INT32_MIN) {
            evs.push_back({EV_NOTE_OFF, e.offset, k, held[k], 0.0});
            held[k] = INT32_MIN;
          }
        evs.push_back({EV_MIDI, e.offset, 0xB0 | (123 << 8), 0, 0});  // MIDI "all notes off" for MIDI-dialect plugins
        if (e.a) evs.push_back({EV_MIDI, e.offset, 0xB0 | (120 << 8), 0, 0});  // "all sound off"
        continue;
      }
      if (e.type == EV_NOTE_ON && e.a >= 0 && e.a < 128) {
        if (held[e.a] != INT32_MIN) evs.push_back({EV_NOTE_OFF, e.offset, e.a, held[e.a], 0.0});  // retrigger
        held[e.a] = e.b;
      } else if (e.type == EV_NOTE_OFF && e.a >= 0 && e.a < 128) {
        // not playing, or this note was already retriggered by a newer note on the same key
        if (held[e.a] == INT32_MIN || held[e.a] != e.b) continue;
        held[e.a] = INT32_MIN;
      }
      evs.push_back(e);
    }
    std::stable_sort(evs.begin(), evs.end(), [](const WireEvent& a, const WireEvent& b) { return a.offset < b.offset; });
    float* inL = (float*)(slot + kAudioInOffset);
    float* outL = (float*)(slot + kAudioOutOffset);
    ProcessArgs a{};
    a.in[0] = inL;
    a.in[1] = inL + kBlock;
    a.out[0] = outL;
    a.out[1] = outL + kBlock;
    a.frames = frames;
    a.events = evs.data();
    a.numEvents = (uint32_t)evs.size();
    a.transport.playing = (flags & kSlotFlagPlaying) != 0;
    a.transport.tempo = tempo > 0 ? tempo : 120;
    a.transport.ppq = ppq;
    a.transport.samplePos = (int64_t)samplePos;
    if (procMx.try_lock()) {
      plugin->process(a);
      procMx.unlock();
      for (uint32_t c = 0; c < 2; c++)
        for (uint32_t f = 0; f < frames; f++) {
          float v = a.out[c][f];
          if (!std::isfinite(v)) a.out[c][f] = 0;
        }
    } else {
      memset(outL, 0, kBlock * 2 * sizeof(float));
    }
  }

  // ── main thread ────────────────────────────────────────────────────────────
  void mainLoop() {
    fcntl(0, F_SETFL, fcntl(0, F_GETFL) | O_NONBLOCK);
    std::string inbuf;
    int64_t lastIdle = 0, lastNotify = 0;
    while (!quit.load()) {
      std::vector<pollfd> pfds;
      pfds.push_back({0, POLLIN, 0});
      int xfd = dpy ? xlib.XConnectionNumber(dpy) : -1;
      if (xfd >= 0) pfds.push_back({xfd, POLLIN, 0});
      std::vector<int> fdKeys;
      for (auto& kv : fds) {
        short ev = 0;
        if (kv.second.flags & FD_READ) ev |= POLLIN;
        if (kv.second.flags & FD_WRITE) ev |= POLLOUT;
        pfds.push_back({kv.first, ev, 0});
        fdKeys.push_back(kv.first);
      }
      int timeout = 10;
      int64_t now = nowMs();
      for (auto& kv : timers) timeout = (int)std::max<int64_t>(0, std::min<int64_t>(timeout, kv.second.next - now));
      if (dpy && xlib.XPending(dpy)) timeout = 0;
      int r = poll(pfds.data(), pfds.size(), timeout);
      if (r < 0 && errno != EINTR) break;
      // stdin
      if (pfds[0].revents & (POLLIN | POLLHUP | POLLERR)) {
        char buf[65536];
        for (;;) {
          ssize_t n = read(0, buf, sizeof buf);
          if (n > 0) inbuf.append(buf, (size_t)n);
          else if (n == 0) { quit.store(true); break; }  // DAW closed the pipe
          else break;
        }
        size_t pos;
        while ((pos = inbuf.find('\n')) != std::string::npos) {
          std::string line = inbuf.substr(0, pos);
          inbuf.erase(0, pos + 1);
          if (!line.empty()) handleCommand(Json::parse(line));
        }
      }
      // X11
      if (dpy) pumpX();
      // plugin fds
      for (size_t i = 0; i < fdKeys.size(); i++) {
        auto& p = pfds[(xfd >= 0 ? 2 : 1) + i];
        if (!p.revents) continue;
        auto it = fds.find(fdKeys[i]);
        if (it == fds.end()) continue;
        int fl = 0;
        if (p.revents & POLLIN) fl |= FD_READ;
        if (p.revents & POLLOUT) fl |= FD_WRITE;
        if (p.revents & (POLLERR | POLLHUP)) fl |= FD_ERROR;
        auto cb = it->second.cb;  // copy: callback may unregister itself
        cb(fl);
      }
      // timers
      now = nowMs();
      std::vector<int> due;
      for (auto& kv : timers)
        if (kv.second.next <= now) due.push_back(kv.first);
      for (int id : due) {
        auto it = timers.find(id);
        if (it == timers.end()) continue;
        it->second.next = now + it->second.period;
        auto cb = it->second.cb;
        cb();
      }
      if (mainCallback.exchange(false)) plugin->onMainCallback();
      if (restart.exchange(false)) {
        runWithAudioLocked([this] {
          plugin->deactivate();
          plugin->activate(sr, 4096);
        });
        latencyDirty.store(true);
      }
      int pw = pendingW.exchange(0), ph = pendingH.exchange(0);
      if (pw > 0 && ph > 0 && editorWin) applyEditorSize(pw, ph);
      if (closeRequested.exchange(false)) closeEditor();
      if (now - lastIdle >= 16) {
        lastIdle = now;
        plugin->idle();
      }
      if (now - lastNotify >= 30) {
        lastNotify = now;
        flushNotifications();
      }
    }
  }

  void flushNotifications() {
    std::map<uint32_t, double> changed;
    ParamNote pn;
    while (audioParams.pop(pn)) changed[pn.id] = pn.v;
    {
      std::lock_guard<std::mutex> lk(paramMx);
      for (auto& kv : mainParams) changed[kv.first] = kv.second;
      mainParams.clear();
    }
    if (!changed.empty()) {
      Json j = Json::object();
      j["ev"] = "params";
      Json vals = Json::object();
      for (auto& kv : changed) vals[std::to_string(kv.first)] = kv.second;
      j["values"] = vals;
      sendLine(j);
      dirty.store(true);
    }
    if (dirty.exchange(false)) {
      Json j = Json::object();
      j["ev"] = "dirty";
      sendLine(j);
    }
    if (latencyDirty.exchange(false)) {
      Json j = Json::object();
      j["ev"] = "latency";
      j["samples"] = (double)plugin->latency();
      sendLine(j);
    }
    if (paramsDirty.exchange(false)) {
      Json j = Json::object();
      j["ev"] = "paramsChanged";
      j["params"] = paramsJson(false);
      sendLine(j);
    }
  }

  void reply(const Json& cmd, Json res) {
    res["id"] = cmd.num("id", -1);
    if (!res.get("ok")) res["ok"] = true;
    sendLine(res);
  }
  void replyError(const Json& cmd, const std::string& msg) {
    Json r = Json::object();
    r["ok"] = false;
    r["error"] = msg;
    reply(cmd, r);
  }

  void handleCommand(const Json& c) {
    std::string cmd = c.str("cmd");
    Json r = Json::object();
    if (cmd == "getState") {
      std::vector<uint8_t> data;
      if (!plugin->getState(data)) return replyError(c, "plugin has no state support");
      r["data"] = base64Encode(data.data(), data.size());
      reply(c, r);
    } else if (cmd == "setState") {
      std::vector<uint8_t> data = base64Decode(c.str("data"));
      bool ok = false;
      runWithAudioLocked([&] { ok = plugin->setState(data); });
      if (!ok) return replyError(c, "setState failed");
      reply(c, r);
    } else if (cmd == "showEditor") {
      std::string err;
      if (!showEditor(err)) return replyError(c, err);
      reply(c, r);
    } else if (cmd == "hideEditor") {
      closeEditor();
      reply(c, r);
    } else if (cmd == "params") {
      r["params"] = paramsJson(true);
      reply(c, r);
    } else if (cmd == "values") {
      Json vals = Json::object();
      for (auto& p : plugin->params()) vals[std::to_string(p.id)] = plugin->getParam(p.id);
      r["values"] = vals;
      reply(c, r);
    } else if (cmd == "paramText") {
      r["text"] = plugin->paramText((uint32_t)c.num("param"), c.num("value"));
      reply(c, r);
    } else if (cmd == "info") {
      r["info"] = infoJson();
      reply(c, r);
    } else if (cmd == "ping") {
      reply(c, r);
    } else if (cmd == "quit") {
      reply(c, r);
      quit.store(true);
    } else {
      replyError(c, "unknown command " + cmd);
    }
  }

  // ── editor window ──────────────────────────────────────────────────────────
  bool showEditor(std::string& err) {
    if (editorWin) {
      xlib.XMapRaised(dpy, editorWin);
      xlib.XFlush(dpy);
      return true;
    }
    if (!plugin->hasEditor()) { err = "plugin has no editor"; return false; }
    if (!xlib.load()) { err = "libX11 not available"; return false; }
    if (!dpy) {
      dpy = xlib.XOpenDisplay(nullptr);
      if (!dpy) { err = "cannot open X display (Wayland-only session? plugin editors need X11/XWayland)"; return false; }
      wmDelete = xlib.XInternAtom(dpy, "WM_DELETE_WINDOW", 0);
    }
    int w = 0, h = 0;
    if (!plugin->editorCreate(w, h)) { err = "plugin failed to create its X11 editor"; return false; }
    int screen = xlib.XDefaultScreen(dpy);
    editorWin = xlib.XCreateSimpleWindow(dpy, xlib.XRootWindow(dpy, screen), 0, 0, (unsigned)w, (unsigned)h, 0, 0, 0);
    xlib.XSelectInput(dpy, editorWin, x11::StructureNotifyMask);
    std::string t = title.empty() ? plugin->desc().name : title;
    xlib.XStoreName(dpy, editorWin, t.c_str());
    x11::Atom utf8 = xlib.XInternAtom(dpy, "UTF8_STRING", 0);
    xlib.XChangeProperty(dpy, editorWin, xlib.XInternAtom(dpy, "_NET_WM_NAME", 0), utf8, 8, x11::PropModeReplace,
                         (const unsigned char*)t.c_str(), (int)t.size());
    const char cls[] = "arkane-vsthost\0ArkaneDAW";
    xlib.XChangeProperty(dpy, editorWin, x11::XA_WM_CLASS, x11::XA_STRING, 8, x11::PropModeReplace,
                         (const unsigned char*)cls, (int)sizeof cls);
    long pid = getpid();
    xlib.XChangeProperty(dpy, editorWin, xlib.XInternAtom(dpy, "_NET_WM_PID", 0), x11::XA_CARDINAL, 32,
                         x11::PropModeReplace, (const unsigned char*)&pid, 1);
    xlib.XSetWMProtocols(dpy, editorWin, &wmDelete, 1);
    if (transientFor) xlib.XSetTransientForHint(dpy, editorWin, transientFor);
    editorW = w;
    editorH = h;
    setHints(w, h);
    if (!plugin->editorAttach(editorWin)) {
      plugin->editorClose();
      xlib.XDestroyWindow(dpy, editorWin);
      editorWin = 0;
      err = "plugin failed to attach its editor";
      return false;
    }
    xlib.XMapRaised(dpy, editorWin);
    xlib.XFlush(dpy);
    Json j = Json::object();
    j["ev"] = "editor";
    j["open"] = true;
    sendLine(j);
    return true;
  }

  void setHints(int w, int h) {
    x11::XSizeHints hints{};
    hints.flags = x11::PSize;
    hints.width = w;
    hints.height = h;
    if (!plugin->editorCanResize()) {
      hints.flags |= x11::PMinSize | x11::PMaxSize;
      hints.min_width = hints.max_width = w;
      hints.min_height = hints.max_height = h;
    }
    xlib.XSetWMNormalHints(dpy, editorWin, &hints);
  }

  void applyEditorSize(int w, int h) {
    if (w <= 0 || h <= 0 || !editorWin) return;
    editorW = w;
    editorH = h;
    setHints(w, h);
    xlib.XResizeWindow(dpy, editorWin, (unsigned)w, (unsigned)h);
    xlib.XFlush(dpy);
  }

  void closeEditor() {
    if (!editorWin) return;
    plugin->editorClose();
    xlib.XDestroyWindow(dpy, editorWin);
    xlib.XFlush(dpy);
    editorWin = 0;
    Json j = Json::object();
    j["ev"] = "editor";
    j["open"] = false;
    sendLine(j);
    dirty.store(true);
  }

  void pumpX() {
    while (dpy && xlib.XPending(dpy)) {
      x11::XEvent ev;
      xlib.XNextEvent(dpy, &ev);
      if (!editorWin || ev.xany.window != editorWin) continue;
      if (ev.type == x11::ClientMessage && (x11::Atom)ev.xclient.data.l[0] == wmDelete) {
        closeEditor();
      } else if (ev.type == x11::ConfigureNotify) {
        int w = ev.xconfigure.width, h = ev.xconfigure.height;
        if ((w != editorW || h != editorH) && plugin->editorCanResize()) {
          int aw = w, ah = h;
          plugin->editorResized(aw, ah);
          editorW = aw;
          editorH = ah;
          if (aw != w || ah != h) xlib.XResizeWindow(dpy, editorWin, (unsigned)aw, (unsigned)ah);
        }
      }
    }
  }

  void shutdown() {
    quit.store(true);
    hdr(H_SIDECAR_BELL).fetch_add(1);
    futexWake(&hdr(H_SIDECAR_BELL));
    if (audioThread.joinable()) audioThread.join();
    closeEditor();
    plugin->deactivate();
    plugin.reset();
    fflush(stderr);
    _exit(0);
  }

  std::unique_ptr<Plugin> plugin;
  uint8_t* shm = nullptr;
  std::thread audioThread;
  std::thread::id mainTid;
  std::atomic<std::thread::id> audioTid{};
  std::atomic<bool> quit{false}, dirty{false}, latencyDirty{false}, paramsDirty{false}, mainCallback{false},
      restart{false}, closeRequested{false};
  std::atomic<int> pendingW{0}, pendingH{0};
  std::mutex procMx, paramMx;
  std::map<uint32_t, double> mainParams;
  SpscQueue<ParamNote, 4096> audioParams;
  std::vector<WireEvent> evs;
  int32_t held[128] = {
#define I8 INT32_MIN, INT32_MIN, INT32_MIN, INT32_MIN, INT32_MIN, INT32_MIN, INT32_MIN, INT32_MIN
#define I32 I8, I8, I8, I8
      I32, I32, I32, I32
#undef I32
#undef I8
  };
  std::map<int, Timer> timers;
  std::map<int, FdReg> fds;
  int nextTimerId = 1;
  x11::Lib xlib;
  x11::Display* dpy = nullptr;
  x11::Window editorWin = 0;
  x11::Atom wmDelete = 0;
  int editorW = 0, editorH = 0;
};

}  // namespace

int main(int argc, char** argv) {
  signal(SIGPIPE, SIG_IGN);
  // Reserve the real stdout for the protocol; plugins printing to stdout end up on stderr.
  gProtoFd = dup(1);
  dup2(2, 1);
  if (argc >= 2 && !strcmp(argv[1], "--version")) {
    Json j = Json::object();
    j["version"] = "0.1.0";
    j["protocol"] = (double)kVersion;
    sendLine(j);
    return 0;
  }
  if (argc >= 3 && !strcmp(argv[1], "scan")) return runScan(argv[2]);
  if (argc >= 2 && !strcmp(argv[1], "host")) {
    Sidecar s;
    for (int i = 2; i + 1 < argc; i += 2) {
      std::string k = argv[i], v = argv[i + 1];
      if (k == "--format") s.format = v;
      else if (k == "--path") s.path = v;
      else if (k == "--uid") s.uid = v;
      else if (k == "--sr") s.sr = atof(v.c_str());
      else if (k == "--shm") s.shmName = v;
      else if (k == "--title") s.title = v;
      else if (k == "--transient-for") s.transientFor = strtoul(v.c_str(), nullptr, 0);
      else if (k == "--scale") s.scale = std::max(0.5, std::min(4.0, atof(v.c_str())));
    }
    return s.run();
  }
  fprintf(stderr, "usage: arkane-vsthost scan <path> | host --format F --path P [--uid U] --sr R --shm NAME\n");
  return 1;
}
