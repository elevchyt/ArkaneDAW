// Shared-memory block protocol between the AudioWorklet ('arkane-vst-bridge'), the N-API bridge
// thread (native/bridge) and the plugin sidecar (arkane-vsthost).
//
// The SAME byte layout is used for the renderer's SharedArrayBuffer and for the POSIX shm segment,
// so the bridge thread only memcpy()s slot regions between the two. Mirror of
// src/renderer/src/audio/vst/protocol.ts — keep both in sync (bump kVersion on any change).
//
//   [0 .. 256)                     header: int32 words (see enum H) + transport anchor (f64)
//   [256 + s*kSlotBytes ...)        slot s (ring of kSlots blocks of kBlock frames)
//       +0     slot header  (u32 seq, u32 numEvents, u32 flags, u32 frames, f64 tempo, f64 ppq, f64 samplePos)
//       +64    events       kMaxEvents x 24 bytes (u32 type, u32 offset, i32 a, i32 b, f64 v)
//       +1600  audio in     2 x kBlock float32 (L then R)
//       +2624  audio out    2 x kBlock float32
//
// Flow per block k:  worklet writes slot k%N, bumps H_IN_WRITE  →  bridge copies to shm, bumps shm H_IN_WRITE
// and rings H_SIDECAR_BELL (futex)  →  sidecar processes, writes audio out, bumps H_OUT_WRITE and rings
// H_BRIDGE_BELL  →  bridge copies audio out back into the SAB and bumps the SAB's H_OUT_WRITE.
#pragma once
#include <stdint.h>

namespace ark {

constexpr uint32_t kMagic = 0x41524B42;  // 'ARKB'
constexpr uint32_t kVersion = 1;
constexpr uint32_t kBlock = 128;
constexpr uint32_t kSlots = 32;
constexpr uint32_t kMaxEvents = 64;
constexpr uint32_t kChannels = 2;
constexpr uint32_t kHeaderBytes = 256;
constexpr uint32_t kSlotHeaderBytes = 64;
constexpr uint32_t kEventBytes = 24;
constexpr uint32_t kEventsOffset = kSlotHeaderBytes;
constexpr uint32_t kAudioInOffset = kEventsOffset + kMaxEvents * kEventBytes;   // 1600
constexpr uint32_t kAudioOutOffset = kAudioInOffset + kChannels * kBlock * 4;  // 2624
constexpr uint32_t kSlotBytes = 4096;
constexpr uint32_t kTotalBytes = kHeaderBytes + kSlots * kSlotBytes;
static_assert(kAudioOutOffset + kChannels * kBlock * 4 <= kSlotBytes, "slot too small");

// int32 word indices in the header
enum H : uint32_t {
  H_MAGIC = 0,
  H_VERSION = 1,
  H_SLOTS = 2,
  H_BLOCK = 3,
  H_IN_WRITE = 4,       // blocks written by the producer (worklet → SAB, bridge → shm)
  H_OUT_WRITE = 5,      // blocks processed (sidecar → shm, bridge → SAB)
  H_STATUS = 6,         // Status (SAB only, written by the renderer main thread)
  H_XRUNS = 7,          // worklet: output not ready in time
  H_SIDECAR_BELL = 8,   // shm futex: bridge → sidecar "new input"
  H_BRIDGE_BELL = 9,    // shm futex: sidecar → bridge "new output"
  H_LATENCY_BLOCKS = 10,// worklet: current bridge latency in blocks
  H_PLAYING = 11,       // transport anchor: 1 = playing
  H_DROPPED = 12,       // worklet: blocks not sent because the sidecar fell behind
  H_SIDECAR_ALIVE = 13, // sidecar sets 1 when attached
};
// f64 byte offsets in the header (transport anchor written by the renderer main thread)
constexpr uint32_t kHdrTempo = 128;       // BPM
constexpr uint32_t kHdrAnchorTime = 136;  // AudioContext time (s) of the anchor
constexpr uint32_t kHdrAnchorPpq = 144;   // quarter notes at the anchor

enum Status : int32_t { ST_STARTING = 0, ST_RUNNING = 1, ST_CRASHED = 2, ST_CLOSED = 3 };

// slot header byte offsets
constexpr uint32_t kSlotSeq = 0, kSlotNumEvents = 4, kSlotFlags = 8, kSlotFrames = 12, kSlotTempo = 16, kSlotPpq = 24,
                   kSlotSamplePos = 32;
constexpr uint32_t kSlotFlagPlaying = 1;

enum EvType : uint32_t {
  EV_NOTE_ON = 1,       // a = key, b = note id, v = velocity 0..1
  EV_NOTE_OFF = 2,      // a = key, b = note id, v = release velocity 0..1
  EV_PARAM = 3,         // a = param id, v = normalized 0..1
  EV_PITCHBEND = 4,     // v = -1..1 (±2 semitones convention)
  EV_ALL_NOTES_OFF = 5, // a = 1 hard (sound off), 0 = release
  EV_MIDI = 6,          // a = status | data1 << 8 | data2 << 16
};

#pragma pack(push, 4)
struct WireEvent {
  uint32_t type;
  uint32_t offset;
  int32_t a;
  int32_t b;
  double v;
};
#pragma pack(pop)
static_assert(sizeof(WireEvent) == kEventBytes, "event size");

}  // namespace ark
