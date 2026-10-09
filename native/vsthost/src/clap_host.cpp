// CLAP hosting (https://github.com/free-audio/clap, MIT).
#include <clap/clap.h>
#include <dlfcn.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <unordered_map>
#include "plugin.h"
#include "util.h"

namespace ark {
namespace {

struct ClapLib {
  void* handle = nullptr;
  const clap_plugin_entry* entry = nullptr;
  const clap_plugin_factory* factory = nullptr;
  bool open(const std::string& path, std::string& err) {
    handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) { err = dlerror(); return false; }
    entry = (const clap_plugin_entry*)dlsym(handle, "clap_entry");
    if (!entry) { err = "no clap_entry symbol"; return false; }
    if (!clap_version_is_compatible(entry->clap_version)) { err = "incompatible CLAP version"; entry = nullptr; return false; }
    if (!entry->init(path.c_str())) { err = "clap_entry.init failed"; entry = nullptr; return false; }
    factory = (const clap_plugin_factory*)entry->get_factory(CLAP_PLUGIN_FACTORY_ID);
    if (!factory) { err = "no plugin factory"; return false; }
    return true;
  }
  void close() {
    if (entry) entry->deinit();
    entry = nullptr;
    // Never dlclose: plugins frequently leave threads/atexit handlers behind; the process exits anyway.
  }
};

PluginDesc describe(const clap_plugin_descriptor* d, const std::string& path) {
  PluginDesc out;
  out.format = "clap";
  out.path = path;
  out.uid = d->id ? d->id : "";
  out.name = d->name ? d->name : out.uid;
  out.vendor = d->vendor ? d->vendor : "";
  out.version = d->version ? d->version : "";
  bool effect = false;
  if (d->features) {
    for (const char* const* f = d->features; *f; f++) {
      std::string feat = *f;
      if (feat == CLAP_PLUGIN_FEATURE_INSTRUMENT) out.instrument = true;
      else if (feat == CLAP_PLUGIN_FEATURE_AUDIO_EFFECT || feat == CLAP_PLUGIN_FEATURE_NOTE_EFFECT || feat == CLAP_PLUGIN_FEATURE_ANALYZER) effect = true;
      else if (out.category.empty() && feat != "stereo" && feat != "mono" && feat != "surround" && feat != "ambisonic")
        out.category = feat;
    }
  }
  if (out.instrument && effect) out.instrument = true;  // instrument wins (e.g. vocoders listing both)
  return out;
}

struct EvNote { clap_event_note n; };

class ClapPlugin final : public Plugin {
 public:
  explicit ClapPlugin(HostServices* h) : svc(h) {
    host.clap_version = CLAP_VERSION;
    host.host_data = this;
    host.name = "ArkaneDAW";
    host.vendor = "Arkane";
    host.url = "https://github.com/";
    host.version = "0.1.0";
    host.get_extension = &ClapPlugin::getExtension;
    host.request_restart = [](const clap_host* h) { self(h)->svc->requestRestart(); };
    host.request_process = [](const clap_host*) {};
    host.request_callback = [](const clap_host* h) { self(h)->svc->requestMainCallback(); };
    inEvents.ctx = this;
    inEvents.size = [](const clap_input_events* l) -> uint32_t { return (uint32_t)((ClapPlugin*)l->ctx)->evPtrs.size(); };
    inEvents.get = [](const clap_input_events* l, uint32_t i) -> const clap_event_header* {
      auto* s = (ClapPlugin*)l->ctx;
      return i < s->evPtrs.size() ? s->evPtrs[i] : nullptr;
    };
    outEvents.ctx = this;
    outEvents.try_push = [](const clap_output_events* l, const clap_event_header* e) -> bool {
      ((ClapPlugin*)l->ctx)->onOutputEvent(e);
      return true;
    };
    evStore.resize(512);
    evPtrs.reserve(512);
  }
  ~ClapPlugin() override {
    if (p) {
      if (guiCreated && gui) gui->destroy(p);
      if (active) p->deactivate(p);
      p->destroy(p);
    }
    lib.close();
  }

  bool load(const std::string& path, const std::string& uid, std::string& err) override {
    filePath = path;
    if (!lib.open(path, err)) return false;
    uint32_t n = lib.factory->get_plugin_count(lib.factory);
    const clap_plugin_descriptor* chosen = nullptr;
    for (uint32_t i = 0; i < n; i++) {
      auto* d = lib.factory->get_plugin_descriptor(lib.factory, i);
      if (d && (uid.empty() || uid == d->id)) { chosen = d; break; }
    }
    if (!chosen) { err = "plugin id not found: " + uid; return false; }
    d = describe(chosen, path);
    p = lib.factory->create_plugin(lib.factory, &host, chosen->id);
    if (!p) { err = "create_plugin failed"; return false; }
    if (!p->init(p)) { err = "plugin init failed"; p->destroy(p); p = nullptr; return false; }
    ext_params = (const clap_plugin_params*)p->get_extension(p, CLAP_EXT_PARAMS);
    ext_state = (const clap_plugin_state*)p->get_extension(p, CLAP_EXT_STATE);
    gui = (const clap_plugin_gui*)p->get_extension(p, CLAP_EXT_GUI);
    ext_audio = (const clap_plugin_audio_ports*)p->get_extension(p, CLAP_EXT_AUDIO_PORTS);
    ext_notes = (const clap_plugin_note_ports*)p->get_extension(p, CLAP_EXT_NOTE_PORTS);
    ext_latency = (const clap_plugin_latency*)p->get_extension(p, CLAP_EXT_LATENCY);
    ext_timer = (const clap_plugin_timer_support*)p->get_extension(p, CLAP_EXT_TIMER_SUPPORT);
    ext_fd = (const clap_plugin_posix_fd_support*)p->get_extension(p, CLAP_EXT_POSIX_FD_SUPPORT);
    d.hasEditor = gui && gui->is_api_supported(p, CLAP_WINDOW_API_X11, false) ? 1 : 0;
    scanParams();
    scanPorts();
    return true;
  }

  PluginDesc desc() override { return d; }

  std::vector<ParamInfo> params() override { return pinfo; }

  double getParam(uint32_t id) override {
    double v = 0;
    auto it = pmap.find(id);
    if (!ext_params || it == pmap.end() || !ext_params->get_value(p, id, &v)) return 0;
    return toNorm(it->second, v);
  }

  std::string paramText(uint32_t id, double norm) override {
    auto it = pmap.find(id);
    if (!ext_params || it == pmap.end()) return "";
    char buf[256] = {0};
    if (ext_params->value_to_text(p, id, toPlain(it->second, norm), buf, sizeof buf)) return buf;
    char tmp[64];
    snprintf(tmp, sizeof tmp, "%.3g", toPlain(it->second, norm));
    return tmp;
  }

  bool activate(double sr, uint32_t maxFrames) override {
    if (active) return true;
    active = p->activate(p, sr, 1, maxFrames);
    return active;
  }
  void deactivate() override {
    if (!active) return;
    p->deactivate(p);
    active = false;
    processing = false;
  }

  void process(ProcessArgs& a) override {
    if (!active) { zero(a); return; }
    if (!processing) {
      processing = p->start_processing ? p->start_processing(p) : true;
      if (!processing) { zero(a); return; }
    }
    // events
    evPtrs.clear();
    // transport first (time 0)
    memset(&transport, 0, sizeof transport);
    transport.header = {sizeof(clap_event_transport), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_TRANSPORT, 0};
    transport.flags = CLAP_TRANSPORT_HAS_TEMPO | CLAP_TRANSPORT_HAS_BEATS_TIMELINE | CLAP_TRANSPORT_HAS_SECONDS_TIMELINE |
                      CLAP_TRANSPORT_HAS_TIME_SIGNATURE | (a.transport.playing ? CLAP_TRANSPORT_IS_PLAYING : 0);
    transport.tempo = a.transport.tempo;
    transport.song_pos_beats = (clap_beattime)llround(a.transport.ppq * CLAP_BEATTIME_FACTOR);
    transport.song_pos_seconds = (clap_sectime)llround(a.transport.ppq * 60.0 / std::max(1.0, a.transport.tempo) * CLAP_SECTIME_FACTOR);
    double bar = std::floor(a.transport.ppq / 4.0);
    transport.bar_start = (clap_beattime)llround(bar * 4.0 * CLAP_BEATTIME_FACTOR);
    transport.bar_number = (int32_t)bar;
    transport.tsig_num = 4;
    transport.tsig_denom = 4;
    uint32_t used = 0;
    for (uint32_t i = 0; i < a.numEvents && used < evStore.size(); i++) {
      const WireEvent& w = a.events[i];
      Ev& e = evStore[used];
      uint32_t t = std::min(w.offset, a.frames ? a.frames - 1 : 0);
      switch (w.type) {
        case EV_NOTE_ON:
        case EV_NOTE_OFF: {
          if (!hasNotePort) continue;
          if (noteDialectClap) {
            e.note = {};
            e.note.header = {sizeof(clap_event_note), t, CLAP_CORE_EVENT_SPACE_ID,
                             (uint16_t)(w.type == EV_NOTE_ON ? CLAP_EVENT_NOTE_ON : CLAP_EVENT_NOTE_OFF), 0};
            e.note.note_id = w.b;
            e.note.port_index = notePort;
            e.note.channel = 0;
            e.note.key = (int16_t)w.a;
            e.note.velocity = w.v;
          } else {
            int vel = (int)std::lround(w.v * 127);
            if (w.type == EV_NOTE_ON && vel < 1) vel = 1;
            midi(e, t, w.type == EV_NOTE_ON ? 0x90 : 0x80, w.a & 127, std::clamp(vel, 0, 127));
          }
          break;
        }
        case EV_PARAM: {
          auto it = pmap.find((uint32_t)w.a);
          if (it == pmap.end()) continue;
          e.param = {};
          e.param.header = {sizeof(clap_event_param_value), t, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0};
          e.param.param_id = it->second.id;
          e.param.cookie = it->second.cookie;
          e.param.note_id = -1;
          e.param.port_index = -1;
          e.param.channel = -1;
          e.param.key = -1;
          e.param.value = toPlain(it->second, w.v);
          break;
        }
        case EV_PITCHBEND: {
          if (!hasNotePort || !(dialects & CLAP_NOTE_DIALECT_MIDI)) {
            // CLAP-only note port: no channel pitch bend concept → skip
            continue;
          }
          int v = std::clamp((int)std::lround((w.v + 1) * 8192), 0, 16383);
          midi(e, t, 0xE0, v & 127, v >> 7);
          break;
        }
        case EV_MIDI: {
          if (!hasNotePort || !(dialects & CLAP_NOTE_DIALECT_MIDI)) continue;
          midi(e, t, w.a & 0xFF, (w.a >> 8) & 0xFF, (w.a >> 16) & 0xFF);
          break;
        }
        default:
          continue;
      }
      evPtrs.push_back(&e.header);
      used++;
    }
    // transport must be first in time order; it has time 0, so put it at the front.
    evPtrs.insert(evPtrs.begin(), &transport.header);

    // audio buffers
    const float* inL = a.in[0];
    const float* inR = a.in[1];
    for (size_t i = 0; i < inPorts.size(); i++) {
      auto& b = inBufs[i];
      b.channel_count = inPorts[i];
      b.latency = 0;
      b.constant_mask = 0;
      b.data64 = nullptr;
      b.data32 = inPtrs[i].data();
      for (uint32_t c = 0; c < inPorts[i]; c++) {
        if (i == 0 && inPorts[i] == 1) {
          float* m = monoIn.data();
          for (uint32_t f = 0; f < a.frames; f++) m[f] = 0.5f * (inL[f] + inR[f]);
          inPtrs[i][c] = m;
        } else if (i == 0 && c < 2) inPtrs[i][c] = (float*)(c == 0 ? inL : inR);
        else inPtrs[i][c] = silence.data();
      }
    }
    for (size_t i = 0; i < outPorts.size(); i++) {
      auto& b = outBufs[i];
      b.channel_count = outPorts[i];
      b.latency = 0;
      b.constant_mask = 0;
      b.data64 = nullptr;
      b.data32 = outPtrs[i].data();
      for (uint32_t c = 0; c < outPorts[i]; c++) {
        if (i == 0 && c < 2) outPtrs[i][c] = a.out[c];
        else outPtrs[i][c] = scratch.data() + (size_t)(c % 8) * maxBlock;
      }
    }
    clap_process pr{};
    pr.steady_time = steady;
    pr.frames_count = a.frames;
    pr.transport = &transport;
    pr.audio_inputs = inBufs.data();
    pr.audio_inputs_count = (uint32_t)inPorts.size();
    pr.audio_outputs = outBufs.data();
    pr.audio_outputs_count = (uint32_t)outPorts.size();
    pr.in_events = &inEvents;
    pr.out_events = &outEvents;
    lastProcessMs.store(nowMs());
    clap_process_status st = p->process(p, &pr);
    steady += a.frames;
    if (st == CLAP_PROCESS_ERROR) zero(a);
    else if (!outPorts.empty() && outPorts[0] == 1) memcpy(a.out[1], a.out[0], a.frames * sizeof(float));
    else if (outPorts.empty()) zero(a);
  }

  void audioThreadStop() override {
    if (processing && p->stop_processing) p->stop_processing(p);
    processing = false;
  }

  bool getState(std::vector<uint8_t>& out) override {
    if (!ext_state) return false;
    out.clear();
    clap_ostream os{&out, [](const clap_ostream* s, const void* buf, uint64_t size) -> int64_t {
                      auto* v = (std::vector<uint8_t>*)s->ctx;
                      v->insert(v->end(), (const uint8_t*)buf, (const uint8_t*)buf + size);
                      return (int64_t)size;
                    }};
    return ext_state->save(p, &os);
  }
  bool setState(const std::vector<uint8_t>& data) override {
    if (!ext_state) return false;
    struct R { const std::vector<uint8_t>* v; size_t pos; } r{&data, 0};
    clap_istream is{&r, [](const clap_istream* s, void* buf, uint64_t size) -> int64_t {
                      auto* r = (R*)s->ctx;
                      size_t n = std::min<size_t>(size, r->v->size() - r->pos);
                      memcpy(buf, r->v->data() + r->pos, n);
                      r->pos += n;
                      return (int64_t)n;
                    }};
    return ext_state->load(p, &is);
  }

  uint32_t latency() override { return ext_latency && active ? ext_latency->get(p) : 0; }

  void onMainCallback() override {
    if (p && p->on_main_thread) p->on_main_thread(p);
    if (flushRequested) {
      flushRequested = false;
      // Only flush from the main thread when audio is not running (otherwise process() handles it).
      if (nowMs() - lastProcessMs.load() > 200) svc->runWithAudioLocked([this] { flushParams(); });
    }
  }

  /** Called on the main thread when the plugin asked for a params flush and no audio is running. */
  void flushParams() {
    if (!ext_params || !ext_params->flush) return;
    evPtrs.clear();
    ext_params->flush(p, &inEvents, &outEvents);
  }

  bool hasEditor() override { return d.hasEditor == 1; }
  bool editorCreate(int& w, int& h) override {
    if (!hasEditor()) return false;
    if (!gui->create(p, CLAP_WINDOW_API_X11, false)) return false;
    guiCreated = true;
    gui->set_scale(p, svc->uiScale());
    uint32_t W = 0, H = 0;
    if (!gui->get_size(p, &W, &H) || !W || !H) { W = 640; H = 400; }
    w = (int)W;
    h = (int)H;
    return true;
  }
  bool editorAttach(unsigned long parent) override {
    clap_window win{};
    win.api = CLAP_WINDOW_API_X11;
    win.x11 = parent;
    if (!gui->set_parent(p, &win)) return false;
    gui->show(p);
    return true;
  }
  void editorClose() override {
    if (!guiCreated) return;
    gui->hide(p);
    gui->destroy(p);
    guiCreated = false;
  }
  bool editorCanResize() override { return guiCreated && gui->can_resize(p); }
  void editorResized(int& w, int& h) override {
    if (!guiCreated || !gui->can_resize(p)) return;
    uint32_t W = (uint32_t)w, H = (uint32_t)h;
    gui->adjust_size(p, &W, &H);
    gui->set_size(p, W, H);
    w = (int)W;
    h = (int)H;
  }

 private:
  union Ev {
    clap_event_header header;
    clap_event_note note;
    clap_event_param_value param;
    clap_event_midi midi;
  };
  struct PInfo {
    clap_id id;
    void* cookie;
    double min, max;
    bool stepped;
  };

  static ClapPlugin* self(const clap_host* h) { return (ClapPlugin*)h->host_data; }

  static double toNorm(const PInfo& i, double v) { return i.max > i.min ? std::clamp((v - i.min) / (i.max - i.min), 0.0, 1.0) : 0; }
  static double toPlain(const PInfo& i, double n) {
    double v = i.min + std::clamp(n, 0.0, 1.0) * (i.max - i.min);
    return i.stepped ? std::round(v) : v;
  }

  void midi(Ev& e, uint32_t t, int s, int d1, int d2) {
    e.midi = {};
    e.midi.header = {sizeof(clap_event_midi), t, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_MIDI, 0};
    e.midi.port_index = notePort;
    e.midi.data[0] = (uint8_t)s;
    e.midi.data[1] = (uint8_t)d1;
    e.midi.data[2] = (uint8_t)d2;
  }

  void zero(ProcessArgs& a) {
    memset(a.out[0], 0, a.frames * sizeof(float));
    memset(a.out[1], 0, a.frames * sizeof(float));
  }

  void onOutputEvent(const clap_event_header* e) {
    if (e->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
    if (e->type == CLAP_EVENT_PARAM_VALUE) {
      auto* pv = (const clap_event_param_value*)e;
      auto it = pmap.find(pv->param_id);
      if (it != pmap.end()) svc->paramFromPlugin(pv->param_id, toNorm(it->second, pv->value));
    } else if (e->type == CLAP_EVENT_PARAM_GESTURE_END) {
      svc->stateDirty();
    }
  }

  void scanParams() {
    pinfo.clear();
    pmap.clear();
    if (!ext_params) return;
    uint32_t n = ext_params->count(p);
    for (uint32_t i = 0; i < n; i++) {
      clap_param_info info{};
      if (!ext_params->get_info(p, i, &info)) continue;
      PInfo pi{info.id, info.cookie, info.min_value, info.max_value, (info.flags & CLAP_PARAM_IS_STEPPED) != 0};
      pmap[info.id] = pi;
      ParamInfo o;
      o.id = info.id;
      o.name = info.name;
      o.group = info.module;
      o.def = toNorm(pi, info.default_value);
      o.steps = pi.stepped ? (int)std::lround(info.max_value - info.min_value) : 0;
      o.automatable = (info.flags & CLAP_PARAM_IS_AUTOMATABLE) != 0;
      o.hidden = (info.flags & CLAP_PARAM_IS_HIDDEN) != 0;
      o.readonly = (info.flags & CLAP_PARAM_IS_READONLY) != 0;
      pinfo.push_back(o);
    }
  }

  void scanPorts() {
    inPorts.clear();
    outPorts.clear();
    if (ext_audio) {
      for (int dir = 0; dir < 2; dir++) {
        uint32_t n = ext_audio->count(p, dir == 0);
        for (uint32_t i = 0; i < n; i++) {
          clap_audio_port_info info{};
          if (!ext_audio->get(p, i, dir == 0, &info)) continue;
          (dir == 0 ? inPorts : outPorts).push_back(std::max<uint32_t>(1, info.channel_count));
        }
      }
    } else {
      outPorts.push_back(2);
      if (!d.instrument) inPorts.push_back(2);
    }
    inBufs.resize(inPorts.size());
    outBufs.resize(outPorts.size());
    inPtrs.assign(inPorts.size(), std::vector<float*>(64));
    outPtrs.assign(outPorts.size(), std::vector<float*>(64));
    for (auto& c : inPorts) c = std::min<uint32_t>(c, 64);
    for (auto& c : outPorts) c = std::min<uint32_t>(c, 64);
    silence.assign(maxBlock, 0.f);
    scratch.assign((size_t)maxBlock * 8, 0.f);
    monoIn.assign(maxBlock, 0.f);
    hasNotePort = false;
    if (ext_notes && ext_notes->count(p, true) > 0) {
      clap_note_port_info info{};
      if (ext_notes->get(p, 0, true, &info)) {
        hasNotePort = true;
        notePort = 0;
        dialects = info.supported_dialects;
        noteDialectClap = (info.supported_dialects & CLAP_NOTE_DIALECT_CLAP) != 0;
      }
    }
  }

  // ── host extensions ────────────────────────────────────────────────────────
  static const void* getExtension(const clap_host* h, const char* id) {
    static const clap_host_params params = {
        [](const clap_host* h, clap_param_rescan_flags) {
          self(h)->scanParams();
          self(h)->svc->paramsRescanned();
        },
        [](const clap_host*, clap_id, clap_param_clear_flags) {},
        [](const clap_host* h) { self(h)->svc->requestMainCallback(); self(h)->flushRequested = true; }};
    static const clap_host_state state = {[](const clap_host* h) { self(h)->svc->stateDirty(); }};
    static const clap_host_latency latency = {[](const clap_host* h) { self(h)->svc->latencyChanged(); }};
    static const clap_host_gui gui = {
        [](const clap_host*) {},
        [](const clap_host* h, uint32_t w, uint32_t hh) -> bool { return self(h)->svc->resizeEditor((int)w, (int)hh); },
        [](const clap_host*) -> bool { return true; },
        [](const clap_host*) -> bool { return true; },
        [](const clap_host* h, bool) { self(h)->svc->editorClosedByPlugin(); }};
    static const clap_host_timer_support timers = {
        [](const clap_host* h, uint32_t period, clap_id* out) -> bool {
          auto* s = self(h);
          int idHolder = s->nextTimer++;
          int real = s->svc->registerTimer((int)std::max<uint32_t>(period, 5), [s, idHolder]() {
            if (s->ext_timer) s->ext_timer->on_timer(s->p, (clap_id)idHolder);
          });
          s->timerMap[idHolder] = real;
          *out = (clap_id)idHolder;
          return true;
        },
        [](const clap_host* h, clap_id id) -> bool {
          auto* s = self(h);
          auto it = s->timerMap.find((int)id);
          if (it == s->timerMap.end()) return false;
          s->svc->unregisterTimer(it->second);
          s->timerMap.erase(it);
          return true;
        }};
    static const clap_host_posix_fd_support fds = {
        [](const clap_host* h, int fd, clap_posix_fd_flags_t flags) -> bool {
          auto* s = self(h);
          s->svc->registerFd(fd, (int)flags, [s, fd](int fl) {
            if (s->ext_fd) s->ext_fd->on_fd(s->p, fd, (clap_posix_fd_flags_t)fl);
          });
          return true;
        },
        [](const clap_host* h, int fd, clap_posix_fd_flags_t flags) -> bool { self(h)->svc->modifyFd(fd, (int)flags); return true; },
        [](const clap_host* h, int fd) -> bool { self(h)->svc->unregisterFd(fd); return true; }};
    static const clap_host_thread_check threads = {
        [](const clap_host* h) -> bool { return self(h)->svc->isMainThread(); },
        [](const clap_host* h) -> bool { return self(h)->svc->isAudioThread(); }};
    static const clap_host_log log = {[](const clap_host*, clap_log_severity sev, const char* msg) {
      if (sev >= CLAP_LOG_WARNING) fprintf(stderr, "[clap] %s\n", msg ? msg : "");
    }};
    static const clap_host_audio_ports aports = {[](const clap_host*, uint32_t) -> bool { return false; },
                                                 [](const clap_host* h, uint32_t) { self(h)->svc->requestRestart(); }};
    static const clap_host_note_ports nports = {
        [](const clap_host*) -> uint32_t { return CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI; },
        [](const clap_host*, uint32_t) {}};
    (void)h;
    if (!strcmp(id, CLAP_EXT_PARAMS)) return &params;
    if (!strcmp(id, CLAP_EXT_STATE)) return &state;
    if (!strcmp(id, CLAP_EXT_LATENCY)) return &latency;
    if (!strcmp(id, CLAP_EXT_GUI)) return &gui;
    if (!strcmp(id, CLAP_EXT_TIMER_SUPPORT)) return &timers;
    if (!strcmp(id, CLAP_EXT_POSIX_FD_SUPPORT)) return &fds;
    if (!strcmp(id, CLAP_EXT_THREAD_CHECK)) return &threads;
    if (!strcmp(id, CLAP_EXT_LOG)) return &log;
    if (!strcmp(id, CLAP_EXT_AUDIO_PORTS)) return &aports;
    if (!strcmp(id, CLAP_EXT_NOTE_PORTS)) return &nports;
    return nullptr;
  }

 public:
  bool flushRequested = false;

 private:
  HostServices* svc;
  ClapLib lib;
  clap_host host{};
  const clap_plugin* p = nullptr;
  const clap_plugin_params* ext_params = nullptr;
  const clap_plugin_state* ext_state = nullptr;
  const clap_plugin_gui* gui = nullptr;
  const clap_plugin_audio_ports* ext_audio = nullptr;
  const clap_plugin_note_ports* ext_notes = nullptr;
  const clap_plugin_latency* ext_latency = nullptr;
  const clap_plugin_timer_support* ext_timer = nullptr;
  const clap_plugin_posix_fd_support* ext_fd = nullptr;
  std::string filePath;
  PluginDesc d;
  bool active = false, processing = false, guiCreated = false;
  std::vector<ParamInfo> pinfo;
  std::unordered_map<uint32_t, PInfo> pmap;
  std::vector<uint32_t> inPorts, outPorts;
  std::vector<clap_audio_buffer> inBufs, outBufs;
  std::vector<std::vector<float*>> inPtrs, outPtrs;
  std::vector<float> silence, scratch, monoIn;
  uint32_t maxBlock = 4096;
  bool hasNotePort = false, noteDialectClap = true;
  uint32_t dialects = 0;
  int16_t notePort = 0;
  std::vector<Ev> evStore;
  std::vector<const clap_event_header*> evPtrs;
  clap_event_transport transport{};
  clap_input_events inEvents{};
  clap_output_events outEvents{};
  int64_t steady = 0;
  std::atomic<int64_t> lastProcessMs{0};
  static int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
  }
  int nextTimer = 1;
  std::unordered_map<int, int> timerMap;
};

}  // namespace

std::unique_ptr<Plugin> createClapPlugin(HostServices* host) { return std::make_unique<ClapPlugin>(host); }

bool scanClap(const std::string& path, std::vector<PluginDesc>& out, std::string& err) {
  ClapLib lib;
  if (!lib.open(path, err)) return false;
  uint32_t n = lib.factory->get_plugin_count(lib.factory);
  for (uint32_t i = 0; i < n; i++) {
    auto* d = lib.factory->get_plugin_descriptor(lib.factory, i);
    if (d) out.push_back(describe(d, path));
  }
  lib.close();
  return true;
}

}  // namespace ark
