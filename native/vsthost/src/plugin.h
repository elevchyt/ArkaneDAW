// Format-independent plugin interface implemented by the CLAP, VST3 and VST2 hosts.
// Threading: everything runs on the main (control/GUI) thread except process() and
// audioThreadStop(), which run on the audio thread. Param values are always NORMALIZED (0..1).
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>
#include "protocol.h"

namespace ark {

struct ParamInfo {
  uint32_t id = 0;
  std::string name, unit, group;
  double def = 0;   // normalized
  int steps = 0;    // 0 = continuous, else number of steps (discrete values = steps + 1)
  bool automatable = true, hidden = false, readonly = false;
};

struct PluginDesc {
  std::string format, path, uid, name, vendor, version, category;
  bool instrument = false;
  int hasEditor = -1;  // -1 unknown (not instantiated during scan)
};

struct Transport {
  bool playing = false;
  double tempo = 120;
  double ppq = 0;
  int64_t samplePos = 0;
};

struct ProcessArgs {
  const float* in[2];
  float* out[2];
  uint32_t frames;
  const WireEvent* events;  // sorted by offset; EV_ALL_NOTES_OFF already expanded to note-offs
  uint32_t numEvents;
  Transport transport;
};

enum FdFlags { FD_READ = 1, FD_WRITE = 2, FD_ERROR = 4 };

/** Services the sidecar provides to a plugin implementation. */
class HostServices {
 public:
  virtual ~HostServices() {}
  /** Plugin changed a parameter (GUI edit or output event). Safe from any thread. */
  virtual void paramFromPlugin(uint32_t id, double norm) = 0;
  /** Plugin state changed (mark dirty). Safe from any thread. */
  virtual void stateDirty() = 0;
  virtual void latencyChanged() = 0;
  virtual void paramsRescanned() = 0;
  /** Plugin asks for main-thread callback (CLAP request_callback). Safe from any thread. */
  virtual void requestMainCallback() = 0;
  /** Plugin asks for restart (deactivate/activate). Safe from any thread. */
  virtual void requestRestart() = 0;
  /** Editor wants a new size (main thread). */
  virtual bool resizeEditor(int w, int h) = 0;
  virtual void editorClosedByPlugin() = 0;
  // run loop (main thread)
  virtual int registerTimer(int periodMs, std::function<void()> cb) = 0;
  virtual void unregisterTimer(int id) = 0;
  virtual void registerFd(int fd, int flags, std::function<void(int flags)> cb) = 0;
  virtual void modifyFd(int fd, int flags) = 0;
  virtual void unregisterFd(int fd) = 0;
  /** Run fn on the main thread while the audio thread is held off (it outputs silence meanwhile). */
  virtual void runWithAudioLocked(const std::function<void()>& fn) = 0;
  virtual double sampleRate() const = 0;
  /** Desktop scale factor for editors (1 = 96 dpi). */
  virtual double uiScale() const { return 1.0; }
  virtual bool isAudioThread() const = 0;
  virtual bool isMainThread() const = 0;
};

class Plugin {
 public:
  virtual ~Plugin() {}
  virtual bool load(const std::string& path, const std::string& uid, std::string& err) = 0;
  virtual PluginDesc desc() = 0;
  virtual std::vector<ParamInfo> params() = 0;
  virtual double getParam(uint32_t id) = 0;
  virtual std::string paramText(uint32_t id, double norm) = 0;
  virtual bool activate(double sampleRate, uint32_t maxFrames) = 0;
  virtual void deactivate() = 0;
  virtual void process(ProcessArgs& a) = 0;
  virtual void audioThreadStop() {}
  virtual bool getState(std::vector<uint8_t>& out) = 0;
  virtual bool setState(const std::vector<uint8_t>& data) = 0;
  virtual uint32_t latency() = 0;
  /** Main-thread periodic work (~60 Hz): VST2 effEditIdle, VST3 controller updates. */
  virtual void idle() {}
  virtual void onMainCallback() {}
  // editor
  virtual bool hasEditor() = 0;
  /** Create the editor and report its preferred size (before a parent exists). */
  virtual bool editorCreate(int& w, int& h) = 0;
  /** Embed into the X11 window `parent`. */
  virtual bool editorAttach(unsigned long parent) = 0;
  virtual void editorClose() = 0;
  virtual bool editorCanResize() { return false; }
  /** User resized our top-level; returns the size the plugin accepted. */
  virtual void editorResized(int& w, int& h) { (void)w; (void)h; }
};

std::unique_ptr<Plugin> createClapPlugin(HostServices* host);
std::unique_ptr<Plugin> createVst3Plugin(HostServices* host);
std::unique_ptr<Plugin> createVst2Plugin(HostServices* host);

/** Describe every plugin contained in a file/bundle (scan mode; may instantiate). */
bool scanClap(const std::string& path, std::vector<PluginDesc>& out, std::string& err);
bool scanVst3(const std::string& path, std::vector<PluginDesc>& out, std::string& err);
bool scanVst2(const std::string& path, std::vector<PluginDesc>& out, std::string& err, HostServices* host);

}  // namespace ark
