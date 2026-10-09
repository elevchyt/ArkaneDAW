// Minimal clean-room description of the VST 2.x binary interface (AEffect ABI).
//
// Written from scratch for interoperability — it contains NO code or text from Steinberg's VST2 SDK.
// The layout and constant values below are the de-facto binary interface every VST2 plugin and host
// agrees on; they are documented publicly by independent projects (e.g. "VeSTige" in LMMS/Ardour and
// "FST" by IOhannes m zmölnig) and were cross-checked against the plugins this host loads.
// Only the subset ArkaneDAW needs is defined. Names are ArkaneDAW's own (prefix `vst2::`).
#pragma once
#include <cstdint>

namespace vst2 {

constexpr int32_t kEffectMagic = ('V' << 24) | ('s' << 16) | ('t' << 8) | 'P';  // 'VstP'

struct AEffect;
using HostCallback = intptr_t (*)(AEffect* effect, int32_t opcode, int32_t index, intptr_t value, void* ptr, float opt);
using DispatcherFn = intptr_t (*)(AEffect* effect, int32_t opcode, int32_t index, intptr_t value, void* ptr, float opt);
using ProcessFn = void (*)(AEffect* effect, float** inputs, float** outputs, int32_t frames);
using ProcessDoubleFn = void (*)(AEffect* effect, double** inputs, double** outputs, int32_t frames);
using SetParameterFn = void (*)(AEffect* effect, int32_t index, float value);
using GetParameterFn = float (*)(AEffect* effect, int32_t index);
using EntryFn = AEffect* (*)(HostCallback host);

struct AEffect {
  int32_t magic;
  DispatcherFn dispatcher;
  ProcessFn processAccumulating;  // deprecated
  SetParameterFn setParameter;
  GetParameterFn getParameter;
  int32_t numPrograms;
  int32_t numParams;
  int32_t numInputs;
  int32_t numOutputs;
  int32_t flags;
  intptr_t hostReserved1;  // ArkaneDAW stores its instance pointer here
  intptr_t hostReserved2;
  int32_t initialDelay;  // latency in samples
  int32_t realQualities;
  int32_t offQualities;
  float ioRatio;
  void* object;
  void* user;
  int32_t uniqueID;
  int32_t version;
  ProcessFn processReplacing;
  ProcessDoubleFn processDoubleReplacing;
  char future[56];
};

// AEffect::flags
enum : int32_t {
  FlagHasEditor = 1 << 0,
  FlagCanReplacing = 1 << 4,
  FlagProgramChunks = 1 << 5,
  FlagIsSynth = 1 << 8,
  FlagNoSoundInStop = 1 << 9,
  FlagCanDoubleReplacing = 1 << 12,
};

// host → plugin opcodes (dispatcher)
enum : int32_t {
  effOpen = 0,
  effClose = 1,
  effSetProgram = 2,
  effGetProgram = 3,
  effGetParamLabel = 6,
  effGetParamDisplay = 7,
  effGetParamName = 8,
  effSetSampleRate = 10,
  effSetBlockSize = 11,
  effMainsChanged = 12,
  effEditGetRect = 13,
  effEditOpen = 14,
  effEditClose = 15,
  effEditIdle = 19,
  effGetChunk = 23,
  effSetChunk = 24,
  effProcessEvents = 25,
  effCanBeAutomated = 26,
  effGetPlugCategory = 35,
  effGetEffectName = 45,
  effGetVendorString = 47,
  effGetProductString = 48,
  effGetVendorVersion = 49,
  effCanDo = 51,
  effGetVstVersion = 58,
  effStartProcess = 71,
  effStopProcess = 72,
};

// plugin → host opcodes (host callback)
enum : int32_t {
  amAutomate = 0,
  amVersion = 1,
  amCurrentId = 2,
  amIdle = 3,
  amGetTime = 7,
  amProcessEvents = 8,
  amIOChanged = 13,
  amSizeWindow = 15,
  amGetSampleRate = 16,
  amGetBlockSize = 17,
  amGetInputLatency = 18,
  amGetOutputLatency = 19,
  amGetCurrentProcessLevel = 23,
  amGetAutomationState = 24,
  amGetVendorString = 32,
  amGetProductString = 33,
  amGetVendorVersion = 34,
  amCanDo = 37,
  amGetLanguage = 38,
  amGetDirectory = 41,
  amUpdateDisplay = 42,
  amBeginEdit = 43,
  amEndEdit = 44,
};

// effGetPlugCategory results (subset)
enum : int32_t { CategUnknown = 0, CategEffect = 1, CategSynth = 2, CategAnalysis = 3, CategMastering = 4,
                 CategSpacializer = 5, CategRoomFx = 6, CategSurroundFx = 7, CategRestoration = 8,
                 CategOfflineProcess = 9, CategShell = 10, CategGenerator = 11 };

struct Rect {
  int16_t top, left, bottom, right;
};

constexpr int32_t kMidiEventType = 1;

struct MidiEvent {
  int32_t type;         // kMidiEventType
  int32_t byteSize;     // sizeof(MidiEvent)
  int32_t deltaFrames;  // sample offset within the block
  int32_t flags;        // 1 = realtime
  int32_t noteLength;
  int32_t noteOffset;
  char midiData[4];
  char detune;
  char noteOffVelocity;
  char reserved1;
  char reserved2;
};

struct Events {
  int32_t numEvents;
  intptr_t reserved;
  void* events[2];  // variable length: MidiEvent* array
};

// time info (amGetTime)
enum : int32_t {
  TimeTransportPlaying = 1 << 1,
  TimeNanosValid = 1 << 8,
  TimePpqPosValid = 1 << 9,
  TimeTempoValid = 1 << 10,
  TimeBarsValid = 1 << 11,
  TimeSigValid = 1 << 13,
};

struct TimeInfo {
  double samplePos;
  double sampleRate;
  double nanoSeconds;
  double ppqPos;
  double tempo;
  double barStartPos;
  double cycleStartPos;
  double cycleEndPos;
  int32_t timeSigNumerator;
  int32_t timeSigDenominator;
  int32_t smpteOffset;
  int32_t smpteFrameRate;
  int32_t samplesToNextClock;
  int32_t flags;
};

static_assert(sizeof(MidiEvent) == 32, "MidiEvent layout");
static_assert(sizeof(void*) != 8 || sizeof(AEffect) == 192, "AEffect layout (64-bit)");

}  // namespace vst2
