// VST3 hosting on top of the MIT-licensed VST3 pluginterfaces (no public.sdk hosting helpers needed).
#include <dlfcn.h>
#include <sys/stat.h>
#include <dirent.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <mutex>
#include <unordered_map>

#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"
#include "pluginterfaces/vst/ivstattributes.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivsthostapplication.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "plugin.h"
#include "spsc.h"
#include "util.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace ark {
namespace {

std::string u16to8(const char16* s) {
  std::string out;
  for (; s && *s; s++) {
    uint32_t c = (uint16_t)*s;
    if (c >= 0xD800 && c < 0xDC00 && s[1]) {
      uint32_t lo = (uint16_t)s[1];
      c = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
      s++;
    }
    if (c < 0x80) out += (char)c;
    else if (c < 0x800) { out += (char)(0xC0 | (c >> 6)); out += (char)(0x80 | (c & 0x3F)); }
    else if (c < 0x10000) { out += (char)(0xE0 | (c >> 12)); out += (char)(0x80 | ((c >> 6) & 0x3F)); out += (char)(0x80 | (c & 0x3F)); }
    else { out += (char)(0xF0 | (c >> 18)); out += (char)(0x80 | ((c >> 12) & 0x3F)); out += (char)(0x80 | ((c >> 6) & 0x3F)); out += (char)(0x80 | (c & 0x3F)); }
  }
  return out;
}
void str8to16(const char* s, char16* out, size_t max) {
  size_t i = 0;
  for (; s && *s && i + 1 < max; s++) out[i++] = (char16)(unsigned char)*s;
  out[i] = 0;
}

std::string uidHex(const TUID cid) {
  static const char* hx = "0123456789ABCDEF";
  std::string s;
  for (int i = 0; i < 16; i++) { s += hx[(uint8_t)cid[i] >> 4]; s += hx[(uint8_t)cid[i] & 15]; }
  return s;
}
bool uidFromHex(const std::string& h, TUID out) {
  if (h.size() != 32) return false;
  for (int i = 0; i < 16; i++) out[i] = (char)strtoul(h.substr(i * 2, 2).c_str(), nullptr, 16);
  return true;
}

#define ARK_REFCOUNT                                                     \
  std::atomic<uint32> refs{1};                                           \
  uint32 PLUGIN_API addRef() override { return ++refs; }                 \
  uint32 PLUGIN_API release() override {                                 \
    uint32 r = --refs;                                                   \
    if (r == 0) delete this;                                             \
    return r;                                                            \
  }
#define ARK_NOREFCOUNT                                    \
  uint32 PLUGIN_API addRef() override { return 1000; }    \
  uint32 PLUGIN_API release() override { return 1000; }
#define ARK_QI_BEGIN \
  tresult PLUGIN_API queryInterface(const TUID _iid, void** obj) override {
#define ARK_QI(I)                                                  \
  if (FUnknownPrivate::iidEqual(_iid, I::iid)) {                   \
    addRef();                                                      \
    *obj = static_cast<I*>(this);                                  \
    return kResultOk;                                              \
  }
#define ARK_QI_END    \
  *obj = nullptr;     \
  return kNoInterface; \
  }

// ── module ───────────────────────────────────────────────────────────────────
std::string resolveBinary(const std::string& path) {
  struct stat st{};
  if (stat(path.c_str(), &st) != 0) return path;
  if (!S_ISDIR(st.st_mode)) return path;
  std::string base = path;
  while (!base.empty() && base.back() == '/') base.pop_back();
  std::string name = base.substr(base.find_last_of('/') + 1);
  if (endsWith(name, ".vst3")) name = name.substr(0, name.size() - 5);
  std::string dir = base + "/Contents/x86_64-linux/";
  std::string candidate = dir + name + ".so";
  if (stat(candidate.c_str(), &st) == 0) return candidate;
  if (DIR* d = opendir(dir.c_str())) {
    while (dirent* e = readdir(d)) {
      std::string f = e->d_name;
      if (endsWith(f, ".so")) { closedir(d); return dir + f; }
    }
    closedir(d);
  }
  return candidate;
}

struct Vst3Module {
  void* handle = nullptr;
  IPluginFactory* factory = nullptr;
  bool entered = false;
  bool open(const std::string& bundle, std::string& err) {
    std::string bin = resolveBinary(bundle);
    handle = dlopen(bin.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) { err = dlerror(); return false; }
    using EntryFn = bool (*)(void*);
    auto entry = (EntryFn)dlsym(handle, "ModuleEntry");
    if (entry) {
      if (!entry(handle)) { err = "ModuleEntry failed"; return false; }
      entered = true;
    }
    using GetFactory = IPluginFactory* (*)();
    auto gf = (GetFactory)dlsym(handle, "GetPluginFactory");
    if (!gf) { err = "no GetPluginFactory"; return false; }
    factory = gf();
    if (!factory) { err = "GetPluginFactory returned null"; return false; }
    return true;
  }
  void close() {
    if (factory) factory->release();
    factory = nullptr;
    if (entered && handle) {
      using ExitFn = bool (*)();
      if (auto ex = (ExitFn)dlsym(handle, "ModuleExit")) ex();
    }
    entered = false;
  }
};

// ── host-side helper objects ─────────────────────────────────────────────────
class MemStream final : public IBStream, public ISizeableStream {
 public:
  std::vector<uint8_t> data;
  int64 pos = 0;
  ARK_REFCOUNT
  ARK_QI_BEGIN ARK_QI(IBStream) ARK_QI(ISizeableStream) if (FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
    addRef();
    *obj = static_cast<IBStream*>(this);
    return kResultOk;
  }
  ARK_QI_END
  tresult PLUGIN_API read(void* buffer, int32 n, int32* nr) override {
    int64 avail = (int64)data.size() - pos;
    int32 k = (int32)std::max<int64>(0, std::min<int64>(n, avail));
    if (k > 0) memcpy(buffer, data.data() + pos, k);
    pos += k;
    if (nr) *nr = k;
    return kResultOk;
  }
  tresult PLUGIN_API write(void* buffer, int32 n, int32* nw) override {
    if (n < 0) return kInvalidArgument;
    if ((size_t)(pos + n) > data.size()) data.resize(pos + n);
    memcpy(data.data() + pos, buffer, n);
    pos += n;
    if (nw) *nw = n;
    return kResultOk;
  }
  tresult PLUGIN_API seek(int64 p, int32 mode, int64* result) override {
    int64 np = mode == kIBSeekSet ? p : mode == kIBSeekCur ? pos + p : (int64)data.size() + p;
    if (np < 0) return kInvalidArgument;
    pos = np;
    if (result) *result = pos;
    return kResultOk;
  }
  tresult PLUGIN_API tell(int64* p) override { if (p) *p = pos; return kResultOk; }
  tresult PLUGIN_API getStreamSize(int64& size) override { size = (int64)data.size(); return kResultOk; }
  tresult PLUGIN_API setStreamSize(int64 size) override { data.resize((size_t)size); return kResultOk; }
};

class AttrList final : public IAttributeList {
 public:
  struct V { int kind; int64 i; double f; std::vector<char16> s; std::vector<uint8_t> b; };
  std::map<std::string, V> m;
  ARK_REFCOUNT
  ARK_QI_BEGIN ARK_QI(IAttributeList) ARK_QI(FUnknown) ARK_QI_END
  tresult PLUGIN_API setInt(AttrID id, int64 v) override { auto& x = m[id]; x.kind = 0; x.i = v; return kResultOk; }
  tresult PLUGIN_API getInt(AttrID id, int64& v) override {
    auto it = m.find(id);
    if (it == m.end() || it->second.kind != 0) return kResultFalse;
    v = it->second.i;
    return kResultOk;
  }
  tresult PLUGIN_API setFloat(AttrID id, double v) override { auto& x = m[id]; x.kind = 1; x.f = v; return kResultOk; }
  tresult PLUGIN_API getFloat(AttrID id, double& v) override {
    auto it = m.find(id);
    if (it == m.end() || it->second.kind != 1) return kResultFalse;
    v = it->second.f;
    return kResultOk;
  }
  tresult PLUGIN_API setString(AttrID id, const TChar* s) override {
    auto& x = m[id];
    x.kind = 2;
    x.s.clear();
    for (; s && *s; s++) x.s.push_back(*s);
    x.s.push_back(0);
    return kResultOk;
  }
  tresult PLUGIN_API getString(AttrID id, TChar* s, uint32 bytes) override {
    auto it = m.find(id);
    if (it == m.end() || it->second.kind != 2 || bytes < sizeof(TChar)) return kResultFalse;
    size_t n = std::min<size_t>(it->second.s.size(), bytes / sizeof(TChar));
    memcpy(s, it->second.s.data(), n * sizeof(TChar));
    s[n - 1] = 0;
    return kResultOk;
  }
  tresult PLUGIN_API setBinary(AttrID id, const void* d, uint32 n) override {
    auto& x = m[id];
    x.kind = 3;
    x.b.assign((const uint8_t*)d, (const uint8_t*)d + n);
    return kResultOk;
  }
  tresult PLUGIN_API getBinary(AttrID id, const void*& d, uint32& n) override {
    auto it = m.find(id);
    if (it == m.end() || it->second.kind != 3) return kResultFalse;
    d = it->second.b.data();
    n = (uint32)it->second.b.size();
    return kResultOk;
  }
};

class HostMessage final : public IMessage {
 public:
  std::string id;
  AttrList* attrs = new AttrList();
  ~HostMessage() { attrs->release(); }
  ARK_REFCOUNT
  ARK_QI_BEGIN ARK_QI(IMessage) ARK_QI(FUnknown) ARK_QI_END
  FIDString PLUGIN_API getMessageID() override { return id.c_str(); }
  void PLUGIN_API setMessageID(FIDString m) override { id = m ? m : ""; }
  IAttributeList* PLUGIN_API getAttributes() override { return attrs; }
};

class HostApp final : public IHostApplication {
 public:
  ARK_NOREFCOUNT
  ARK_QI_BEGIN ARK_QI(IHostApplication) ARK_QI(FUnknown) ARK_QI_END
  tresult PLUGIN_API getName(String128 name) override { str8to16("ArkaneDAW", name, 128); return kResultOk; }
  tresult PLUGIN_API createInstance(TUID cid, TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(cid, IMessage::iid) && FUnknownPrivate::iidEqual(iid, IMessage::iid)) {
      *obj = static_cast<IMessage*>(new HostMessage());
      return kResultOk;
    }
    if (FUnknownPrivate::iidEqual(cid, IAttributeList::iid) && FUnknownPrivate::iidEqual(iid, IAttributeList::iid)) {
      *obj = static_cast<IAttributeList*>(new AttrList());
      return kResultOk;
    }
    *obj = nullptr;
    return kResultFalse;
  }
};
HostApp gHostApp;

class ParamQueue final : public IParamValueQueue {
 public:
  ParamID id = 0;
  int32 count = 0;
  int32 offsets[32];
  ParamValue values[32];
  ARK_NOREFCOUNT
  ARK_QI_BEGIN ARK_QI(IParamValueQueue) ARK_QI(FUnknown) ARK_QI_END
  ParamID PLUGIN_API getParameterId() override { return id; }
  int32 PLUGIN_API getPointCount() override { return count; }
  tresult PLUGIN_API getPoint(int32 i, int32& off, ParamValue& v) override {
    if (i < 0 || i >= count) return kResultFalse;
    off = offsets[i];
    v = values[i];
    return kResultOk;
  }
  tresult PLUGIN_API addPoint(int32 off, ParamValue v, int32& index) override {
    // keep sorted by offset; replace same offset
    for (int32 i = 0; i < count; i++)
      if (offsets[i] == off) { values[i] = v; index = i; return kResultOk; }
    if (count >= 32) return kResultFalse;
    int32 i = count;
    while (i > 0 && offsets[i - 1] > off) { offsets[i] = offsets[i - 1]; values[i] = values[i - 1]; i--; }
    offsets[i] = off;
    values[i] = v;
    count++;
    index = i;
    return kResultOk;
  }
};

class ParamChanges final : public IParameterChanges {
 public:
  ParamQueue queues[1024];
  int32 used = 0;
  ARK_NOREFCOUNT
  ARK_QI_BEGIN ARK_QI(IParameterChanges) ARK_QI(FUnknown) ARK_QI_END
  void clear() { used = 0; }
  int32 PLUGIN_API getParameterCount() override { return used; }
  IParamValueQueue* PLUGIN_API getParameterData(int32 i) override { return i >= 0 && i < used ? &queues[i] : nullptr; }
  IParamValueQueue* PLUGIN_API addParameterData(const ParamID& id, int32& index) override {
    for (int32 i = 0; i < used; i++)
      if (queues[i].id == id) { index = i; return &queues[i]; }
    if (used >= 1024) return nullptr;
    index = used;
    auto& q = queues[used++];
    q.id = id;
    q.count = 0;
    return &q;
  }
  void add(ParamID id, int32 off, double v) {
    int32 idx;
    if (auto* q = addParameterData(id, idx)) q->addPoint(off, v, idx);
  }
};

class EventList final : public IEventList {
 public:
  Event events[512];
  int32 count = 0;
  ARK_NOREFCOUNT
  ARK_QI_BEGIN ARK_QI(IEventList) ARK_QI(FUnknown) ARK_QI_END
  int32 PLUGIN_API getEventCount() override { return count; }
  tresult PLUGIN_API getEvent(int32 i, Event& e) override {
    if (i < 0 || i >= count) return kResultFalse;
    e = events[i];
    return kResultOk;
  }
  tresult PLUGIN_API addEvent(Event& e) override {
    if (count >= 512) return kResultFalse;
    events[count++] = e;
    return kResultOk;
  }
};

PluginDesc describeClass(IPluginFactory* f, int32 i, const PClassInfo& ci, const PFactoryInfo& fi, const std::string& path) {
  PluginDesc d;
  d.format = "vst3";
  d.path = path;
  d.uid = uidHex(ci.cid);
  d.name = ci.name;
  d.vendor = fi.vendor;
  IPluginFactory2* f2 = nullptr;
  if (f->queryInterface(IPluginFactory2::iid, (void**)&f2) == kResultOk && f2) {
    PClassInfo2 c2{};
    if (f2->getClassInfo2(i, &c2) == kResultOk) {
      if (c2.vendor[0]) d.vendor = c2.vendor;
      d.version = c2.version;
      std::string sub = c2.subCategories;
      d.instrument = sub.find("Instrument") != std::string::npos;
      // category = most specific token after Fx/Instrument
      size_t start = 0;
      while (start <= sub.size()) {
        size_t end = sub.find('|', start);
        std::string tok = sub.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (!tok.empty() && tok != "Fx" && tok != "Instrument" && tok != "Stereo" && tok != "Mono") { d.category = tok; break; }
        if (end == std::string::npos) break;
        start = end + 1;
      }
    }
    f2->release();
  }
  return d;
}


class Vst3Plugin;

class ComponentHandler final : public IComponentHandler, public IComponentHandler2 {
 public:
  Vst3Plugin* owner = nullptr;
  ARK_NOREFCOUNT
  ARK_QI_BEGIN ARK_QI(IComponentHandler) ARK_QI(IComponentHandler2) if (FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
    *obj = static_cast<IComponentHandler*>(this);
    return kResultOk;
  }
  ARK_QI_END
  tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API performEdit(ParamID id, ParamValue v) override;
  tresult PLUGIN_API endEdit(ParamID) override;
  tresult PLUGIN_API restartComponent(int32 flags) override;
  tresult PLUGIN_API setDirty(TBool) override;
  tresult PLUGIN_API requestOpenEditor(FIDString) override { return kResultFalse; }
  tresult PLUGIN_API startGroupEdit() override { return kResultOk; }
  tresult PLUGIN_API finishGroupEdit() override { return kResultOk; }
};

/** IPlugFrame + Linux IRunLoop for editors. */
class PlugFrame final : public IPlugFrame, public Linux::IRunLoop {
 public:
  HostServices* svc = nullptr;
  std::unordered_map<Linux::IEventHandler*, int> fds;
  std::unordered_map<Linux::ITimerHandler*, int> timers;
  ARK_NOREFCOUNT
  ARK_QI_BEGIN ARK_QI(IPlugFrame) ARK_QI(Linux::IRunLoop) if (FUnknownPrivate::iidEqual(_iid, FUnknown::iid)) {
    *obj = static_cast<IPlugFrame*>(this);
    return kResultOk;
  }
  ARK_QI_END
  tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* r) override {
    if (!r || !view) return kInvalidArgument;
    int w = r->getWidth(), h = r->getHeight();
    if (!svc->resizeEditor(w, h)) return kResultFalse;
    view->onSize(r);
    return kResultTrue;
  }
  tresult PLUGIN_API registerEventHandler(Linux::IEventHandler* h, Linux::FileDescriptor fd) override {
    if (!h) return kInvalidArgument;
    h->addRef();
    fds[h] = fd;
    svc->registerFd(fd, FD_READ, [h, fd](int) { h->onFDIsSet(fd); });
    return kResultTrue;
  }
  tresult PLUGIN_API unregisterEventHandler(Linux::IEventHandler* h) override {
    auto it = fds.find(h);
    if (it == fds.end()) return kInvalidArgument;
    svc->unregisterFd(it->second);
    fds.erase(it);
    h->release();
    return kResultTrue;
  }
  tresult PLUGIN_API registerTimer(Linux::ITimerHandler* h, Linux::TimerInterval ms) override {
    if (!h) return kInvalidArgument;
    h->addRef();
    timers[h] = svc->registerTimer((int)std::max<uint64>(ms, 5), [h]() { h->onTimer(); });
    return kResultTrue;
  }
  tresult PLUGIN_API unregisterTimer(Linux::ITimerHandler* h) override {
    auto it = timers.find(h);
    if (it == timers.end()) return kInvalidArgument;
    svc->unregisterTimer(it->second);
    timers.erase(it);
    h->release();
    return kResultTrue;
  }
  void clear() {
    for (auto& kv : fds) { svc->unregisterFd(kv.second); kv.first->release(); }
    for (auto& kv : timers) { svc->unregisterTimer(kv.second); kv.first->release(); }
    fds.clear();
    timers.clear();
  }
};

struct ParamMsg { uint32_t id; double v; };

class Vst3Plugin final : public Plugin {
 public:
  explicit Vst3Plugin(HostServices* h) : svc(h) {
    handler.owner = this;
    frame.svc = h;
  }
  ~Vst3Plugin() override { shutdown(); }

  bool load(const std::string& path, const std::string& uid, std::string& err) override {
    if (!mod.open(path, err)) return false;
    IPluginFactory* f = mod.factory;
    {
      IPluginFactory3* f3 = nullptr;
      if (f->queryInterface(IPluginFactory3::iid, (void**)&f3) == kResultOk && f3) {
        f3->setHostContext(&gHostApp);
        f3->release();
      }
    }
    PFactoryInfo finfo{};
    f->getFactoryInfo(&finfo);
    TUID want{};
    bool haveUid = uidFromHex(uid, want);
    int32 n = f->countClasses();
    bool found = false;
    for (int32 i = 0; i < n && !found; i++) {
      PClassInfo ci{};
      if (f->getClassInfo(i, &ci) != kResultOk || strcmp(ci.category, kVstAudioEffectClass) != 0) continue;
      if (haveUid && !FUnknownPrivate::iidEqual(ci.cid, want)) continue;
      memcpy(cid, ci.cid, sizeof(TUID));
      d = describeClass(f, i, ci, finfo, path);
      found = true;
    }
    if (!found) { err = "no matching VST3 audio module class"; return false; }
    if (f->createInstance(cid, IComponent::iid, (void**)&component) != kResultOk || !component) {
      err = "createInstance(IComponent) failed";
      return false;
    }
    if (component->initialize(&gHostApp) != kResultOk) { err = "component initialize failed"; return false; }
    if (component->queryInterface(IAudioProcessor::iid, (void**)&processor) != kResultOk || !processor) {
      err = "no IAudioProcessor";
      return false;
    }
    if (component->queryInterface(IEditController::iid, (void**)&controller) == kResultOk && controller) {
      singleComponent = true;
    } else {
      TUID ccid;
      if (component->getControllerClassId(ccid) == kResultOk &&
          f->createInstance(ccid, IEditController::iid, (void**)&controller) == kResultOk && controller) {
        if (controller->initialize(&gHostApp) != kResultOk) {
          controller->release();
          controller = nullptr;
        }
      }
    }
    if (controller) {
      controller->setComponentHandler(&handler);
      if (!singleComponent) {
        component->queryInterface(IConnectionPoint::iid, (void**)&compCP);
        controller->queryInterface(IConnectionPoint::iid, (void**)&ctrlCP);
        if (compCP && ctrlCP) {
          compCP->connect(ctrlCP);
          ctrlCP->connect(compCP);
        }
        MemStream s;
        if (component->getState(&s) == kResultOk) {
          s.pos = 0;
          controller->setComponentState(&s);
        }
      }
      controller->queryInterface(IMidiMapping::iid, (void**)&midiMap);
    }
    setupBuses();
    scanParams();
    d.hasEditor = 0;
    if (controller) {
      if (IPlugView* v = controller->createView(ViewType::kEditor)) {
        d.hasEditor = v->isPlatformTypeSupported(kPlatformTypeX11EmbedWindowID) == kResultTrue ? 1 : 0;
        v->release();
      }
    }
    return true;
  }

  PluginDesc desc() override { return d; }
  std::vector<ParamInfo> params() override { return pinfo; }
  double getParam(uint32_t id) override { return controller ? controller->getParamNormalized(id) : 0; }
  std::string paramText(uint32_t id, double norm) override {
    if (!controller) return "";
    String128 s{};
    if (controller->getParamStringByValue(id, norm, s) != kResultOk) return "";
    return u16to8(s);
  }

  bool activate(double sr, uint32_t maxFrames) override {
    if (active) return true;
    ProcessSetup setup{kRealtime, kSample32, (int32)maxFrames, sr};
    if (processor->setupProcessing(setup) != kResultOk) return false;
    if (component->setActive(true) != kResultOk) return false;
    processor->setProcessing(true);
    sampleRate = sr;
    active = true;
    return true;
  }
  void deactivate() override {
    if (!active) return;
    processor->setProcessing(false);
    component->setActive(false);
    active = false;
  }

  void process(ProcessArgs& a) override {
    if (!active) { zero(a); return; }
    inChanges.clear();
    outChanges.clear();
    inEvents.count = 0;
    outEvents.count = 0;
    // GUI edits (performEdit) queued from the main thread
    ParamMsg m;
    while (guiToAudio.pop(m)) inChanges.add(m.id, 0, m.v);
    for (uint32_t i = 0; i < a.numEvents; i++) {
      const WireEvent& w = a.events[i];
      int32 off = (int32)std::min(w.offset, a.frames ? a.frames - 1 : 0);
      switch (w.type) {
        case EV_NOTE_ON:
        case EV_NOTE_OFF: {
          if (!hasEventIn || inEvents.count >= 512) break;
          Event e{};
          e.busIndex = 0;
          e.sampleOffset = off;
          if (w.type == EV_NOTE_ON) {
            e.type = Event::kNoteOnEvent;
            e.noteOn.channel = 0;
            e.noteOn.pitch = (int16)w.a;
            e.noteOn.velocity = (float)std::max(w.v, 1.0 / 127);
            e.noteOn.noteId = w.b;
          } else {
            e.type = Event::kNoteOffEvent;
            e.noteOff.channel = 0;
            e.noteOff.pitch = (int16)w.a;
            e.noteOff.velocity = (float)w.v;
            e.noteOff.noteId = w.b;
          }
          inEvents.events[inEvents.count++] = e;
          break;
        }
        case EV_PARAM:
          inChanges.add((ParamID)w.a, off, w.v);
          audioToMain.push({(uint32_t)w.a, w.v});  // keep the controller (GUI) in sync
          break;
        case EV_PITCHBEND:
          if (pitchBendParam != kNoParamId) {
            double v = std::clamp((w.v + 1) * 0.5, 0.0, 1.0);
            inChanges.add(pitchBendParam, off, v);
          }
          break;
        default:
          break;
      }
    }
    // buses
    for (size_t i = 0; i < inBus.size(); i++) {
      auto& b = inBuffers[i];
      b.numChannels = inBus[i];
      b.silenceFlags = 0;
      b.channelBuffers32 = inPtrs[i].data();
      for (int32 c = 0; c < inBus[i]; c++) {
        if (i == 0 && inBus[i] == 1) {
          for (uint32_t f = 0; f < a.frames; f++) monoIn[f] = 0.5f * (a.in[0][f] + a.in[1][f]);
          inPtrs[i][c] = monoIn.data();
        } else if (i == 0 && c < 2) inPtrs[i][c] = (float*)a.in[c];
        else inPtrs[i][c] = silence.data();
      }
    }
    for (size_t i = 0; i < outBus.size(); i++) {
      auto& b = outBuffers[i];
      b.numChannels = outBus[i];
      b.silenceFlags = 0;
      b.channelBuffers32 = outPtrs[i].data();
      for (int32 c = 0; c < outBus[i]; c++) {
        if (i == 0 && c < 2) outPtrs[i][c] = a.out[c];
        else outPtrs[i][c] = scratch.data() + (size_t)(c % 8) * 4096;
      }
    }
    ctx = {};
    ctx.state = ProcessContext::kTempoValid | ProcessContext::kProjectTimeMusicValid | ProcessContext::kTimeSigValid |
                ProcessContext::kBarPositionValid | (a.transport.playing ? ProcessContext::kPlaying : 0);
    ctx.sampleRate = sampleRate;
    ctx.projectTimeSamples = a.transport.samplePos;
    ctx.projectTimeMusic = a.transport.ppq;
    ctx.barPositionMusic = std::floor(a.transport.ppq / 4.0) * 4.0;
    ctx.tempo = a.transport.tempo;
    ctx.timeSigNumerator = 4;
    ctx.timeSigDenominator = 4;
    ProcessData pd;
    pd.processMode = kRealtime;
    pd.symbolicSampleSize = kSample32;
    pd.numSamples = (int32)a.frames;
    pd.numInputs = (int32)inBus.size();
    pd.numOutputs = (int32)outBus.size();
    pd.inputs = inBuffers.data();
    pd.outputs = outBuffers.data();
    pd.inputParameterChanges = &inChanges;
    pd.outputParameterChanges = &outChanges;
    pd.inputEvents = hasEventIn ? &inEvents : nullptr;
    pd.outputEvents = &outEvents;
    pd.processContext = &ctx;
    if (processor->process(pd) != kResultOk) zero(a);
    else if (!outBus.empty() && outBus[0] == 1) memcpy(a.out[1], a.out[0], a.frames * sizeof(float));
    else if (outBus.empty()) zero(a);
    for (int32 i = 0; i < outChanges.used; i++) {
      auto& q = outChanges.queues[i];
      if (q.count) {
        audioToMain.push({q.id, q.values[q.count - 1]});
        svc->paramFromPlugin(q.id, q.values[q.count - 1]);
      }
    }
  }

  void idle() override {
    // apply processor-side parameter changes to the controller on the main thread
    ParamMsg m;
    while (audioToMain.pop(m))
      if (controller) controller->setParamNormalized(m.id, m.v);
  }

  bool getState(std::vector<uint8_t>& out) override {
    MemStream cs, es;
    if (component->getState(&cs) != kResultOk) return false;
    if (controller && !singleComponent) controller->getState(&es);
    out.clear();
    auto put32 = [&](uint32_t v) { for (int i = 0; i < 4; i++) out.push_back((v >> (i * 8)) & 0xFF); };
    out.insert(out.end(), {'A', 'V', '3', 'S'});
    put32((uint32_t)cs.data.size());
    out.insert(out.end(), cs.data.begin(), cs.data.end());
    put32((uint32_t)es.data.size());
    out.insert(out.end(), es.data.begin(), es.data.end());
    return true;
  }
  bool setState(const std::vector<uint8_t>& in) override {
    if (in.size() < 12 || memcmp(in.data(), "AV3S", 4) != 0) return false;
    auto get32 = [&](size_t at) { uint32_t v = 0; for (int i = 0; i < 4; i++) v |= (uint32_t)in[at + i] << (i * 8); return v; };
    size_t pos = 4;
    uint32_t cl = get32(pos);
    pos += 4;
    if (pos + cl + 4 > in.size()) return false;
    MemStream cs;
    cs.data.assign(in.begin() + pos, in.begin() + pos + cl);
    pos += cl;
    uint32_t el = get32(pos);
    pos += 4;
    if (pos + el > in.size()) return false;
    MemStream es;
    es.data.assign(in.begin() + pos, in.begin() + pos + el);
    bool ok = component->setState(&cs) == kResultOk;
    if (controller) {
      cs.pos = 0;
      controller->setComponentState(&cs);
      if (!singleComponent && el) controller->setState(&es);
    }
    return ok;
  }

  uint32_t latency() override { return processor ? processor->getLatencySamples() : 0; }

  bool hasEditor() override { return d.hasEditor == 1; }
  bool editorCreate(int& w, int& h) override {
    if (!controller) return false;
    view = controller->createView(ViewType::kEditor);
    if (!view) return false;
    if (view->isPlatformTypeSupported(kPlatformTypeX11EmbedWindowID) != kResultTrue) {
      view->release();
      view = nullptr;
      return false;
    }
    view->setFrame(&frame);
    IPlugViewContentScaleSupport* scale = nullptr;
    if (view->queryInterface(IPlugViewContentScaleSupport::iid, (void**)&scale) == kResultOk && scale) {
      scale->setContentScaleFactor((IPlugViewContentScaleSupport::ScaleFactor)svc->uiScale());
      scale->release();
    }
    ViewRect r{};
    if (view->getSize(&r) != kResultOk || r.getWidth() <= 0 || r.getHeight() <= 0) r = ViewRect(0, 0, 640, 400);
    w = r.getWidth();
    h = r.getHeight();
    return true;
  }
  bool editorAttach(unsigned long parent) override {
    if (!view) return false;
    return view->attached((void*)parent, kPlatformTypeX11EmbedWindowID) == kResultOk;
  }
  void editorClose() override {
    if (!view) return;
    view->removed();
    view->setFrame(nullptr);
    view->release();
    view = nullptr;
    frame.clear();
  }
  bool editorCanResize() override { return view && view->canResize() == kResultTrue; }
  void editorResized(int& w, int& h) override {
    if (!view || view->canResize() != kResultTrue) return;
    ViewRect r(0, 0, w, h);
    view->checkSizeConstraint(&r);
    view->onSize(&r);
    w = r.getWidth();
    h = r.getHeight();
  }

  // ComponentHandler callbacks (main thread)
  void onPerformEdit(ParamID id, ParamValue v) {
    guiToAudio.push({id, v});
    svc->paramFromPlugin(id, v);
  }
  void onEndEdit() { svc->stateDirty(); }
  void onRestart(int32 flags) {
    if (flags & kLatencyChanged) svc->latencyChanged();
    if (flags & (kParamValuesChanged | kParamTitlesChanged)) {
      if (flags & kParamTitlesChanged) { scanParams(); svc->paramsRescanned(); }
      svc->stateDirty();
    }
    if (flags & (kReloadComponent | kIoChanged)) svc->requestRestart();
  }
  void onDirty() { svc->stateDirty(); }

 private:
  void setupBuses() {
    int32 nIn = component->getBusCount(kAudio, kInput);
    int32 nOut = component->getBusCount(kAudio, kOutput);
    std::vector<SpeakerArrangement> inArr(nIn), outArr(nOut);
    for (int32 i = 0; i < nIn; i++) {
      BusInfo bi{};
      component->getBusInfo(kAudio, kInput, i, bi);
      processor->getBusArrangement(kInput, i, inArr[i]);
      if (i == 0) inArr[i] = SpeakerArr::kStereo;
    }
    for (int32 i = 0; i < nOut; i++) {
      processor->getBusArrangement(kOutput, i, outArr[i]);
      if (i == 0) outArr[i] = SpeakerArr::kStereo;
    }
    if (processor->setBusArrangements(inArr.data(), nIn, outArr.data(), nOut) != kResultTrue) {
      // plugin refused stereo: keep its own arrangements
      for (int32 i = 0; i < nIn; i++) processor->getBusArrangement(kInput, i, inArr[i]);
      for (int32 i = 0; i < nOut; i++) processor->getBusArrangement(kOutput, i, outArr[i]);
    }
    inBus.clear();
    outBus.clear();
    for (int32 i = 0; i < nIn; i++) {
      component->activateBus(kAudio, kInput, i, i == 0);
      int32 ch = 0;
      for (uint64 a = inArr[i]; a; a &= a - 1) ch++;
      inBus.push_back(std::min<int32>(64, ch));
    }
    for (int32 i = 0; i < nOut; i++) {
      component->activateBus(kAudio, kOutput, i, i == 0);
      int32 ch = 0;
      for (uint64 a = outArr[i]; a; a &= a - 1) ch++;
      outBus.push_back(std::min<int32>(64, ch));
    }
    hasEventIn = component->getBusCount(kEvent, kInput) > 0;
    if (hasEventIn) component->activateBus(kEvent, kInput, 0, true);
    inBuffers.resize(inBus.size());
    outBuffers.resize(outBus.size());
    inPtrs.assign(inBus.size(), std::vector<float*>(64));
    outPtrs.assign(outBus.size(), std::vector<float*>(64));
    silence.assign(4096, 0.f);
    scratch.assign(4096 * 8, 0.f);
    monoIn.assign(4096, 0.f);
    pitchBendParam = kNoParamId;
    if (midiMap) {
      ParamID pid;
      if (midiMap->getMidiControllerAssignment(0, 0, kPitchBend, pid) == kResultTrue) pitchBendParam = pid;
    }
  }

  void scanParams() {
    pinfo.clear();
    if (!controller) return;
    int32 n = controller->getParameterCount();
    for (int32 i = 0; i < n; i++) {
      ParameterInfo pi{};
      if (controller->getParameterInfo(i, pi) != kResultOk) continue;
      ParamInfo o;
      o.id = pi.id;
      o.name = u16to8(pi.title);
      o.unit = u16to8(pi.units);
      o.def = pi.defaultNormalizedValue;
      o.steps = pi.stepCount;
      o.automatable = (pi.flags & ParameterInfo::kCanAutomate) != 0;
      o.readonly = (pi.flags & ParameterInfo::kIsReadOnly) != 0;
      o.hidden = (pi.flags & ParameterInfo::kIsHidden) != 0;
      pinfo.push_back(o);
    }
  }

  void zero(ProcessArgs& a) {
    memset(a.out[0], 0, a.frames * sizeof(float));
    memset(a.out[1], 0, a.frames * sizeof(float));
  }

  void shutdown() {
    if (view) editorClose();
    deactivate();
    if (compCP && ctrlCP) {
      compCP->disconnect(ctrlCP);
      ctrlCP->disconnect(compCP);
    }
    if (compCP) compCP->release();
    if (ctrlCP) ctrlCP->release();
    compCP = ctrlCP = nullptr;
    if (midiMap) midiMap->release();
    midiMap = nullptr;
    if (controller) {
      controller->setComponentHandler(nullptr);
      if (!singleComponent) controller->terminate();
      controller->release();
      controller = nullptr;
    }
    if (processor) processor->release();
    processor = nullptr;
    if (component) {
      component->terminate();
      component->release();
      component = nullptr;
    }
    mod.close();
  }

  HostServices* svc;
  Vst3Module mod;
  TUID cid{};
  PluginDesc d;
  IComponent* component = nullptr;
  IAudioProcessor* processor = nullptr;
  IEditController* controller = nullptr;
  IConnectionPoint* compCP = nullptr;
  IConnectionPoint* ctrlCP = nullptr;
  IMidiMapping* midiMap = nullptr;
  IPlugView* view = nullptr;
  bool singleComponent = false, active = false, hasEventIn = false;
  double sampleRate = 48000;
  ComponentHandler handler;
  PlugFrame frame;
  std::vector<ParamInfo> pinfo;
  std::vector<int32> inBus, outBus;
  std::vector<AudioBusBuffers> inBuffers, outBuffers;
  std::vector<std::vector<float*>> inPtrs, outPtrs;
  std::vector<float> silence, scratch, monoIn;
  ParamChanges inChanges, outChanges;
  EventList inEvents, outEvents;
  ProcessContext ctx{};
  ParamID pitchBendParam = kNoParamId;
  SpscQueue<ParamMsg, 1024> guiToAudio, audioToMain;
};

tresult PLUGIN_API ComponentHandler::performEdit(ParamID id, ParamValue v) { owner->onPerformEdit(id, v); return kResultOk; }
tresult PLUGIN_API ComponentHandler::endEdit(ParamID) { owner->onEndEdit(); return kResultOk; }
tresult PLUGIN_API ComponentHandler::restartComponent(int32 flags) { owner->onRestart(flags); return kResultOk; }
tresult PLUGIN_API ComponentHandler::setDirty(TBool) { owner->onDirty(); return kResultOk; }

}  // namespace

std::unique_ptr<Plugin> createVst3Plugin(HostServices* host) { return std::make_unique<Vst3Plugin>(host); }

bool scanVst3(const std::string& path, std::vector<PluginDesc>& out, std::string& err) {
  Vst3Module mod;
  if (!mod.open(path, err)) return false;
  IPluginFactory* f = mod.factory;
  {
    IPluginFactory3* f3 = nullptr;
    if (f->queryInterface(IPluginFactory3::iid, (void**)&f3) == kResultOk && f3) {
      f3->setHostContext(&gHostApp);
      f3->release();
    }
  }
  PFactoryInfo finfo{};
  f->getFactoryInfo(&finfo);
  int32 n = f->countClasses();
  for (int32 i = 0; i < n; i++) {
    PClassInfo ci{};
    if (f->getClassInfo(i, &ci) != kResultOk || strcmp(ci.category, kVstAudioEffectClass) != 0) continue;
    out.push_back(describeClass(f, i, ci, finfo, path));
  }
  mod.close();
  return true;
}

}  // namespace ark
