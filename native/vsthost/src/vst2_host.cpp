// VST 2.x hosting through the clean-room ABI in vst2_abi.h.
#include <dlfcn.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include "plugin.h"
#include "util.h"
#include "vst2_abi.h"

namespace ark {
namespace {

using namespace vst2;

class Vst2Plugin;
thread_local Vst2Plugin* tLoading = nullptr;

class Vst2Plugin final : public Plugin {
 public:
  explicit Vst2Plugin(HostServices* h) : svc(h) {}
  ~Vst2Plugin() override {
    if (fx) {
      if (editorOpen) dispatch(effEditClose);
      if (active) deactivate();
      dispatch(effClose);
    }
  }

  bool load(const std::string& path, const std::string& uid, std::string& err) override {
    (void)uid;
    handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) { err = dlerror(); return false; }
    auto entry = (EntryFn)dlsym(handle, "VSTPluginMain");
    if (!entry) entry = (EntryFn)dlsym(handle, "main");
    if (!entry) { err = "not a VST2 plugin (no VSTPluginMain)"; return false; }
    tLoading = this;
    fx = entry(&Vst2Plugin::hostCallback);
    tLoading = nullptr;
    if (!fx || fx->magic != vst2::kEffectMagic) { err = "VSTPluginMain returned no valid AEffect"; fx = nullptr; return false; }
    fx->hostReserved1 = (intptr_t)this;
    dispatch(effOpen);
    if (dispatch(effGetPlugCategory) == CategShell) {
      err = "VST2 shell plugins are not supported";
      return false;
    }
    char buf[256];
    d.format = "vst2";
    d.path = path;
    d.uid = std::to_string(fx->uniqueID);
    memset(buf, 0, sizeof buf);
    dispatch(effGetEffectName, 0, 0, buf);
    d.name = buf;
    if (d.name.empty()) {
      memset(buf, 0, sizeof buf);
      dispatch(effGetProductString, 0, 0, buf);
      d.name = buf;
    }
    if (d.name.empty()) {
      std::string base = path.substr(path.find_last_of('/') + 1);
      d.name = base.substr(0, base.find_last_of('.'));
    }
    memset(buf, 0, sizeof buf);
    dispatch(effGetVendorString, 0, 0, buf);
    d.vendor = buf;
    intptr_t ver = dispatch(effGetVendorVersion);
    d.version = ver ? std::to_string((long long)ver) : "";
    intptr_t cat = dispatch(effGetPlugCategory);
    d.instrument = (fx->flags & FlagIsSynth) || cat == CategSynth || cat == CategGenerator;
    static const char* cats[] = {"", "Effect", "Synth", "Analyzer", "Mastering", "Spatial", "Reverb", "Surround", "Restoration", "Offline", "Shell", "Generator"};
    if (cat > 0 && cat < 12) d.category = cats[cat];
    d.hasEditor = (fx->flags & FlagHasEditor) ? 1 : 0;
    for (int32_t i = 0; i < fx->numParams; i++) {
      ParamInfo p;
      p.id = (uint32_t)i;
      memset(buf, 0, sizeof buf);
      dispatch(effGetParamName, i, 0, buf);
      p.name = buf;
      if (p.name.empty()) p.name = "Param " + std::to_string(i + 1);
      memset(buf, 0, sizeof buf);
      dispatch(effGetParamLabel, i, 0, buf);
      p.unit = buf;
      p.def = fx->getParameter(fx, i);
      pinfo.push_back(p);
    }
    scratch.assign(4096 * 8, 0.f);
    silence.assign(4096, 0.f);
    return true;
  }

  PluginDesc desc() override { return d; }
  std::vector<ParamInfo> params() override { return pinfo; }
  double getParam(uint32_t id) override { return (int32_t)id < fx->numParams ? fx->getParameter(fx, (int32_t)id) : 0; }
  std::string paramText(uint32_t id, double norm) override {
    if ((int32_t)id >= fx->numParams) return "";
    char buf[256] = {0}, label[256] = {0};
    // VST2 can only display the current value
    if (std::fabs(fx->getParameter(fx, (int32_t)id) - norm) > 1e-6) {
      snprintf(buf, sizeof buf, "%.0f%%", norm * 100);
      return buf;
    }
    dispatch(effGetParamDisplay, (int32_t)id, 0, buf);
    dispatch(effGetParamLabel, (int32_t)id, 0, label);
    std::string s = buf;
    while (!s.empty() && s.front() == ' ') s.erase(s.begin());
    if (label[0]) s += std::string(" ") + label;
    return s;
  }

  bool activate(double sr, uint32_t maxFrames) override {
    if (active) return true;
    sampleRate = sr;
    blockSize = maxFrames;
    dispatch(effSetSampleRate, 0, 0, nullptr, (float)sr);
    dispatch(effSetBlockSize, 0, (intptr_t)maxFrames);
    dispatch(effMainsChanged, 0, 1);
    dispatch(effStartProcess);
    active = true;
    return true;
  }
  void deactivate() override {
    if (!active) return;
    dispatch(effStopProcess);
    dispatch(effMainsChanged, 0, 0);
    active = false;
  }

  void process(ProcessArgs& a) override {
    if (!active || !fx->processReplacing) {
      memset(a.out[0], 0, a.frames * 4);
      memset(a.out[1], 0, a.frames * 4);
      return;
    }
    // transport
    time = {};
    time.samplePos = (double)a.transport.samplePos;
    time.sampleRate = sampleRate;
    time.ppqPos = a.transport.ppq;
    time.tempo = a.transport.tempo;
    time.barStartPos = std::floor(a.transport.ppq / 4.0) * 4.0;
    time.timeSigNumerator = 4;
    time.timeSigDenominator = 4;
    time.flags = TimePpqPosValid | TimeTempoValid | TimeBarsValid | TimeSigValid | (a.transport.playing ? TimeTransportPlaying : 0);
    // events
    int32_t n = 0;
    for (uint32_t i = 0; i < a.numEvents && n < 512; i++) {
      const WireEvent& w = a.events[i];
      int32_t off = (int32_t)std::min(w.offset, a.frames ? a.frames - 1 : 0);
      MidiEvent& m = midi[n];
      memset(&m, 0, sizeof m);
      m.type = kMidiEventType;
      m.byteSize = sizeof(MidiEvent);
      m.deltaFrames = off;
      m.flags = 1;
      switch (w.type) {
        case EV_NOTE_ON: {
          int vel = std::clamp((int)std::lround(w.v * 127), 1, 127);
          m.midiData[0] = (char)0x90;
          m.midiData[1] = (char)(w.a & 127);
          m.midiData[2] = (char)vel;
          break;
        }
        case EV_NOTE_OFF:
          m.midiData[0] = (char)0x80;
          m.midiData[1] = (char)(w.a & 127);
          m.midiData[2] = (char)std::clamp((int)std::lround(w.v * 127), 0, 127);
          break;
        case EV_PITCHBEND: {
          int v = std::clamp((int)std::lround((w.v + 1) * 8192), 0, 16383);
          m.midiData[0] = (char)0xE0;
          m.midiData[1] = (char)(v & 127);
          m.midiData[2] = (char)(v >> 7);
          break;
        }
        case EV_MIDI:
          m.midiData[0] = (char)(w.a & 0xFF);
          m.midiData[1] = (char)((w.a >> 8) & 0xFF);
          m.midiData[2] = (char)((w.a >> 16) & 0xFF);
          break;
        case EV_PARAM:
          if (w.a >= 0 && w.a < fx->numParams) fx->setParameter(fx, w.a, (float)w.v);
          continue;
        default:
          continue;
      }
      evList.events[n] = &m;
      n++;
    }
    if (n) {
      evList.numEvents = n;
      evList.reserved = 0;
      dispatch(effProcessEvents, 0, 0, &evList);
    }
    float* ins[64];
    float* outs[64];
    int32_t ni = std::min<int32_t>(fx->numInputs, 64), no = std::min<int32_t>(fx->numOutputs, 64);
    for (int32_t c = 0; c < ni; c++) ins[c] = c < 2 ? (float*)a.in[c] : silence.data();
    if (ni == 1) {
      for (uint32_t f = 0; f < a.frames; f++) monoIn[f] = 0.5f * (a.in[0][f] + a.in[1][f]);
      ins[0] = monoIn;
    }
    for (int32_t c = 0; c < no; c++) outs[c] = c < 2 ? a.out[c] : scratch.data() + (size_t)(c % 8) * 4096;
    if (no < 2) {
      memset(a.out[1], 0, a.frames * 4);
      if (no == 0) memset(a.out[0], 0, a.frames * 4);
    }
    fx->processReplacing(fx, ins, outs, (int32_t)a.frames);
    if (no == 1) memcpy(a.out[1], a.out[0], a.frames * 4);
  }

  bool getState(std::vector<uint8_t>& out) override {
    out.clear();
    if (fx->flags & FlagProgramChunks) {
      void* data = nullptr;
      intptr_t size = dispatch(effGetChunk, 0, 0, &data);
      if (size > 0 && data) {
        out.insert(out.end(), {'A', 'V', '2', 'C'});
        out.insert(out.end(), (uint8_t*)data, (uint8_t*)data + size);
        return true;
      }
    }
    out.insert(out.end(), {'A', 'V', '2', 'P'});
    int32_t n = fx->numParams;
    out.insert(out.end(), (uint8_t*)&n, (uint8_t*)&n + 4);
    for (int32_t i = 0; i < n; i++) {
      float v = fx->getParameter(fx, i);
      out.insert(out.end(), (uint8_t*)&v, (uint8_t*)&v + 4);
    }
    return true;
  }
  bool setState(const std::vector<uint8_t>& in) override {
    if (in.size() < 4) return false;
    if (!memcmp(in.data(), "AV2C", 4)) {
      std::vector<uint8_t> chunk(in.begin() + 4, in.end());
      dispatch(effSetChunk, 0, (intptr_t)chunk.size(), chunk.data());
      return true;
    }
    if (!memcmp(in.data(), "AV2P", 4) && in.size() >= 8) {
      int32_t n;
      memcpy(&n, in.data() + 4, 4);
      for (int32_t i = 0; i < n && i < fx->numParams && 8 + (size_t)i * 4 + 4 <= in.size(); i++) {
        float v;
        memcpy(&v, in.data() + 8 + i * 4, 4);
        fx->setParameter(fx, i, v);
      }
      return true;
    }
    return false;
  }

  uint32_t latency() override { return fx ? (uint32_t)std::max(0, fx->initialDelay) : 0; }

  void idle() override {
    if (editorOpen) dispatch(effEditIdle);
  }

  bool hasEditor() override { return fx && (fx->flags & FlagHasEditor); }
  bool editorCreate(int& w, int& h) override {
    if (!hasEditor()) return false;
    Rect* r = nullptr;
    dispatch(effEditGetRect, 0, 0, &r);
    w = r ? r->right - r->left : 0;
    h = r ? r->bottom - r->top : 0;
    if (w <= 0 || h <= 0) { w = 640; h = 400; }
    return true;
  }
  bool editorAttach(unsigned long parent) override {
    dispatch(effEditOpen, 0, 0, (void*)parent);  // return value is unreliable across plugins
    editorOpen = true;
    // Many plugins only report their real size after opening.
    Rect* r = nullptr;
    dispatch(effEditGetRect, 0, 0, &r);
    if (r && r->right - r->left > 0 && r->bottom - r->top > 0) svc->resizeEditor(r->right - r->left, r->bottom - r->top);
    return editorOpen;
  }
  void editorClose() override {
    if (!editorOpen) return;
    dispatch(effEditClose);
    editorOpen = false;
  }

 private:
  intptr_t dispatch(int32_t op, int32_t index = 0, intptr_t value = 0, void* ptr = nullptr, float opt = 0) {
    return fx ? fx->dispatcher(fx, op, index, value, ptr, opt) : 0;
  }

  static intptr_t hostCallback(AEffect* e, int32_t op, int32_t index, intptr_t value, void* ptr, float opt) {
    Vst2Plugin* self = e && e->hostReserved1 ? (Vst2Plugin*)e->hostReserved1 : tLoading;
    switch (op) {
      case amVersion: return 2400;
      case amCurrentId: return e ? e->uniqueID : 0;
      case amAutomate:
        if (self && self->svc) self->svc->paramFromPlugin((uint32_t)index, opt);
        return 0;
      case amIdle: return 0;
      case amGetTime: return self ? (intptr_t)&self->time : 0;
      case amProcessEvents: return 0;
      case amIOChanged:
        if (self) self->svc->latencyChanged();
        return 1;
      case amSizeWindow:
        if (self && self->editorOpen) return self->svc->resizeEditor(index, (int)value) ? 1 : 0;
        return 0;
      case amGetSampleRate: return self ? (intptr_t)self->sampleRate : 48000;
      case amGetBlockSize: return self ? (intptr_t)self->blockSize : 128;
      case amGetInputLatency:
      case amGetOutputLatency: return 0;
      case amGetCurrentProcessLevel: return self && self->svc->isAudioThread() ? 2 : 1;
      case amGetAutomationState: return 1;
      case amGetVendorString: if (ptr) strcpy((char*)ptr, "Arkane"); return 1;
      case amGetProductString: if (ptr) strcpy((char*)ptr, "ArkaneDAW"); return 1;
      case amGetVendorVersion: return 100;
      case amCanDo: {
        const char* s = (const char*)ptr;
        if (!s) return 0;
        static const char* yes[] = {"sendVstEvents", "sendVstMidiEvent", "sendVstTimeInfo", "receiveVstEvents",
                                    "receiveVstMidiEvent", "sizeWindow", "supplyIdle", "startStopProcess", nullptr};
        for (int i = 0; yes[i]; i++)
          if (!strcmp(s, yes[i])) return 1;
        return 0;
      }
      case amGetLanguage: return 1;
      case amUpdateDisplay:
        if (self) self->svc->stateDirty();
        return 1;
      case amBeginEdit: return 1;
      case amEndEdit:
        if (self) self->svc->stateDirty();
        return 1;
      default: (void)value; return 0;
    }
  }

  HostServices* svc;
  void* handle = nullptr;
  AEffect* fx = nullptr;
  PluginDesc d;
  std::vector<ParamInfo> pinfo;
  bool active = false, editorOpen = false;
  double sampleRate = 48000;
  uint32_t blockSize = 1024;
  TimeInfo time{};
  std::vector<float> scratch, silence;
  float monoIn[4096];
  MidiEvent midi[512];
  // Same layout as vst2::Events, with room for 512 event pointers.
  struct {
    int32_t numEvents;
    intptr_t reserved;
    void* events[512];
  } evList;
};

}  // namespace

std::unique_ptr<Plugin> createVst2Plugin(HostServices* host) { return std::make_unique<Vst2Plugin>(host); }

bool scanVst2(const std::string& path, std::vector<PluginDesc>& out, std::string& err, HostServices* host) {
  Vst2Plugin p(host);
  if (!p.load(path, "", err)) return false;
  out.push_back(p.desc());
  return true;
}

}  // namespace ark
