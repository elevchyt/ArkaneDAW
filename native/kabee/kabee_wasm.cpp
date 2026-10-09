// Kabee -> WebAssembly: a tiny C ABI around kabee::Engine (upstream/plugins/Kabee/dsp) for ArkaneDAW.
//
// Built by build.sh with wasi-sdk as a WASI "reactor" (no main, `_initialize` runs static constructors).
// The engine is the unmodified upstream DSP. Everything the UI needs to know about the parameter table,
// pedals, boards and factory presets is exported too, so gen-table.mjs can mirror it into TypeScript and
// the wasm stays the single source of truth.
//
// Audio thread usage (ArkaneDAW AudioWorklet):
//   h = kabee_create(sampleRate)
//   buf = kabee_alloc(bytes)               // scratch buffers inside wasm memory
//   kabee_set_param(h, index, value)       // any input parameter (see Params.hpp)
//   kabee_process(h, inL, inR, outL, outR, frames)
//   kabee_get_param(h, index)              // outputs too: input level, gate open, learn progress, tuner Hz
//   kabee_gate_learn(h)                    // starts a 1.5 s noise-floor listen

#include "dsp/Engine.hpp"

#include <cstdlib>
#include <new>

#define KABEE_EXPORT(name) extern "C" __attribute__((export_name(#name), used))

namespace kb = kabee;

namespace {

char gText[64];

const char* textOrEmpty(const char* s) { return s != nullptr ? s : ""; }

} // namespace

// ---- memory ------------------------------------------------------------------------------------------------------

KABEE_EXPORT(kabee_alloc) void* kabee_alloc(uint32_t bytes) { return std::malloc(bytes); }
KABEE_EXPORT(kabee_free) void kabee_free(void* p) { std::free(p); }

// ---- engine ------------------------------------------------------------------------------------------------------

KABEE_EXPORT(kabee_create) kb::Engine* kabee_create(float sampleRate)
{
    kb::Engine* e = new (std::nothrow) kb::Engine();
    if (e != nullptr)
        e->prepare(double(sampleRate));
    return e;
}

KABEE_EXPORT(kabee_destroy) void kabee_destroy(kb::Engine* e) { delete e; }

KABEE_EXPORT(kabee_prepare) void kabee_prepare(kb::Engine* e, float sampleRate) { e->prepare(double(sampleRate)); }

KABEE_EXPORT(kabee_reset) void kabee_reset(kb::Engine* e) { e->reset(); }

KABEE_EXPORT(kabee_set_param) void kabee_set_param(kb::Engine* e, uint32_t index, float value) { e->setParam(index, value); }

KABEE_EXPORT(kabee_get_param) float kabee_get_param(kb::Engine* e, uint32_t index) { return e->getParam(index); }

KABEE_EXPORT(kabee_process)
void kabee_process(kb::Engine* e, const float* inL, const float* inR, float* outL, float* outR, uint32_t frames)
{
    e->process(inL, inR, outL, outR, frames);
}

KABEE_EXPORT(kabee_oversampling) int kabee_oversampling(kb::Engine* e) { return e->oversampling(); }

/** Starts gate learn (same as pulsing the Gate Learn trigger parameter). */
KABEE_EXPORT(kabee_gate_learn) void kabee_gate_learn(kb::Engine* e)
{
    e->setParam(kb::kGateLearn, 1.0f);
    e->setParam(kb::kGateLearn, 0.0f);
}

/** The chain the engine is running (pedal ids). `out` needs room for kabee_max_slots() ints. */
KABEE_EXPORT(kabee_active_chain) int kabee_active_chain(kb::Engine* e, int32_t* out)
{
    kb::PedalId ids[kb::kMaxSlots];
    const int n = e->activeChain(ids);
    for (int i = 0; i < n; ++i)
        out[i] = int32_t(ids[i]);
    return n;
}

/** Writes a chain (pedal ids, signal order) into the slot parameters. Invalid entries are ignored by the engine. */
KABEE_EXPORT(kabee_set_chain) void kabee_set_chain(kb::Engine* e, const int32_t* ids, int count)
{
    for (int s = 0; s < kb::kMaxSlots; ++s)
        e->setParam(kb::kSlotParams[s], s < count ? float(ids[s] + 1) : 0.0f);
}

/** Applies a factory preset (board params only, like the Kabee UI does). */
KABEE_EXPORT(kabee_load_preset) void kabee_load_preset(kb::Engine* e, int index)
{
    float values[kb::kParamCount];
    bool mask[kb::kParamCount];
    kb::presetState(index, values, mask);
    for (uint32_t p = 0; p < kb::kParamCount; ++p)
        if (mask[p])
            e->setParam(p, values[p]);
}

/** Applies a serialized state: `count` (index, value) pairs. */
KABEE_EXPORT(kabee_load_state) void kabee_load_state(kb::Engine* e, const float* pairs, int count)
{
    for (int i = 0; i < count; ++i)
        e->setParam(uint32_t(pairs[i * 2]), pairs[i * 2 + 1]);
}

// ---- tables (UI / code generation) --------------------------------------------------------------------------------

KABEE_EXPORT(kabee_param_count) int kabee_param_count() { return kb::kParamCount; }
KABEE_EXPORT(kabee_param_symbol) const char* kabee_param_symbol(int p) { return kb::kParamInfo[p].symbol; }
KABEE_EXPORT(kabee_param_name) const char* kabee_param_name(int p) { return kb::kParamInfo[p].name; }
KABEE_EXPORT(kabee_param_unit) const char* kabee_param_unit(int p) { return kb::kParamInfo[p].unit; }
KABEE_EXPORT(kabee_param_min) float kabee_param_min(int p) { return kb::kParamInfo[p].min; }
KABEE_EXPORT(kabee_param_max) float kabee_param_max(int p) { return kb::kParamInfo[p].max; }
KABEE_EXPORT(kabee_param_def) float kabee_param_def(int p) { return kb::kParamInfo[p].def; }
KABEE_EXPORT(kabee_param_flags) uint32_t kabee_param_flags(int p) { return kb::kParamInfo[p].flags; }
/** Plugin default: the table default with the first preset applied (what a fresh instance starts with). */
KABEE_EXPORT(kabee_param_default) float kabee_param_default(int p) { return kb::defaultValue(kb::Param(p)); }

KABEE_EXPORT(kabee_max_slots) int kabee_max_slots() { return kb::kMaxSlots; }
KABEE_EXPORT(kabee_pedal_count) int kabee_pedal_count() { return kb::kPedalCount; }
KABEE_EXPORT(kabee_pedal_key) const char* kabee_pedal_key(int i) { return kb::kPedals[i].key; }
KABEE_EXPORT(kabee_pedal_name) const char* kabee_pedal_name(int i) { return kb::kPedals[i].name; }
KABEE_EXPORT(kabee_pedal_on_param) int kabee_pedal_on_param(int i) { return int(kb::kPedals[i].onParam); }
KABEE_EXPORT(kabee_pedal_knob_count) int kabee_pedal_knob_count(int i) { return kb::kPedals[i].numKnobs; }
KABEE_EXPORT(kabee_pedal_knob_param) int kabee_pedal_knob_param(int i, int k) { return int(kb::kPedals[i].knobs[k].param); }
KABEE_EXPORT(kabee_pedal_knob_label) const char* kabee_pedal_knob_label(int i, int k) { return textOrEmpty(kb::kPedals[i].knobs[k].label); }
KABEE_EXPORT(kabee_pedal_knob_kind) int kabee_pedal_knob_kind(int i, int k) { return int(kb::kPedals[i].knobs[k].kind); }

/** Default board of a mode (also the set of pedals the mode offers). */
KABEE_EXPORT(kabee_board) int kabee_board(int mode, int32_t* out)
{
    const kb::Board b = kb::defaultBoard(mode);
    for (int i = 0; i < b.count; ++i)
        out[i] = int32_t(b.ids[i]);
    return b.count;
}

KABEE_EXPORT(kabee_preset_count) int kabee_preset_count() { return kb::kPresetCount; }
KABEE_EXPORT(kabee_preset_name) const char* kabee_preset_name(int i) { return kb::kPresets[i].name; }
KABEE_EXPORT(kabee_preset_mode) int kabee_preset_mode(int i) { return kb::kPresets[i].mode; }

/** Full state a factory preset implies. values: kParamCount floats, mask: kParamCount bytes (1 = owned). */
KABEE_EXPORT(kabee_preset_state) void kabee_preset_state(int i, float* values, uint8_t* mask)
{
    bool m[kb::kParamCount];
    kb::presetState(i, values, m);
    for (uint32_t p = 0; p < kb::kParamCount; ++p)
        mask[p] = m[p] ? 1 : 0;
}

/** Empty board for a mode (NEW). */
KABEE_EXPORT(kabee_new_board_state) void kabee_new_board_state(int mode, float* values, uint8_t* mask)
{
    bool m[kb::kParamCount];
    kb::newBoardState(mode, values, m);
    for (uint32_t p = 0; p < kb::kParamCount; ++p)
        mask[p] = m[p] ? 1 : 0;
}

/** 1 when p is a parameter user presets store for this mode (board + gate + output). */
KABEE_EXPORT(kabee_is_user_preset_param) int kabee_is_user_preset_param(int p, int mode) { return kb::isUserPresetParam(uint32_t(p), mode) ? 1 : 0; }

/** Human readable value, as the Kabee UI shows it while a knob is hovered. */
KABEE_EXPORT(kabee_format_value) const char* kabee_format_value(int p, float v)
{
    kb::formatValue(kb::Param(p), v, gText, sizeof(gText));
    return gText;
}
