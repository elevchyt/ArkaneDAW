/* Deterministic CLAP test plugins for the arkane-vsthost test-suite.
 *
 *   arkane.test.synth  instrument: one sine per held note, amplitude = velocity * gain, no envelope.
 *                       params: 0 "Gain" (0..1, def 0.5), 1 "Tune" (-12..12 st, stepped), 99 "Crash" (hidden; >0.5 = SIGSEGV)
 *   arkane.test.gain   stereo effect: out = in * gain; params: 0 "Gain" (0..2, def 1). Reports 64 samples latency.
 *
 * Both save/restore their params through the state extension and offer a tiny X11 editor (dlopen'd libX11,
 * a coloured child window) so editor embedding can be exercised without any toolkit.
 */
#include <clap/clap.h>
#include <dlfcn.h>
#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXV 16
typedef struct { int active; int key; int id; double phase, inc, amp; } Voice;

typedef struct {
  clap_plugin_t plugin;
  const clap_host_t* host;
  int synth;
  double sr;
  double gain, tune, crash;
  Voice v[MAXV];
  /* gui */
  void* xlib;
  void* dpy;
  unsigned long win;
  int guiCreated;
} Test;

/* ── tiny X11 editor ───────────────────────────────────────────────────── */
typedef void* (*XOpenDisplay_t)(const char*);
typedef int (*XCloseDisplay_t)(void*);
typedef unsigned long (*XCreateSimpleWindow_t)(void*, unsigned long, int, int, unsigned, unsigned, unsigned, unsigned long, unsigned long);
typedef int (*XWin_t)(void*, unsigned long);
typedef int (*XFlush_t)(void*);

static int guiOpen(Test* t, unsigned long parent) {
  if (!t->xlib) t->xlib = dlopen("libX11.so.6", RTLD_NOW);
  if (!t->xlib) return 0;
  XOpenDisplay_t open = (XOpenDisplay_t)dlsym(t->xlib, "XOpenDisplay");
  XCreateSimpleWindow_t create = (XCreateSimpleWindow_t)dlsym(t->xlib, "XCreateSimpleWindow");
  XWin_t map = (XWin_t)dlsym(t->xlib, "XMapWindow");
  XFlush_t flush = (XFlush_t)dlsym(t->xlib, "XFlush");
  t->dpy = open(NULL);
  if (!t->dpy) return 0;
  t->win = create(t->dpy, parent, 0, 0, 320, 200, 0, 0, t->synth ? 0x3a7bd5 : 0xd5893a);
  map(t->dpy, t->win);
  flush(t->dpy);
  return 1;
}
static void guiClose(Test* t) {
  if (!t->dpy) return;
  ((XWin_t)dlsym(t->xlib, "XDestroyWindow"))(t->dpy, t->win);
  ((XCloseDisplay_t)dlsym(t->xlib, "XCloseDisplay"))(t->dpy);
  t->dpy = NULL;
  t->win = 0;
}

/* ── params ─────────────────────────────────────────────────────────────── */
static uint32_t p_count(const clap_plugin_t* p) { return ((Test*)p->plugin_data)->synth ? 3 : 1; }
static bool p_info(const clap_plugin_t* p, uint32_t i, clap_param_info_t* info) {
  Test* t = p->plugin_data;
  memset(info, 0, sizeof *info);
  info->flags = CLAP_PARAM_IS_AUTOMATABLE;
  if (i == 0) {
    info->id = 0;
    snprintf(info->name, sizeof info->name, "Gain");
    info->min_value = 0;
    info->max_value = t->synth ? 1 : 2;
    info->default_value = t->synth ? 0.5 : 1;
  } else if (i == 1 && t->synth) {
    info->id = 1;
    snprintf(info->name, sizeof info->name, "Tune");
    info->min_value = -12;
    info->max_value = 12;
    info->default_value = 0;
    info->flags |= CLAP_PARAM_IS_STEPPED;
  } else if (i == 2 && t->synth) {
    info->id = 99;
    snprintf(info->name, sizeof info->name, "Crash");
    info->min_value = 0;
    info->max_value = 1;
    info->flags = CLAP_PARAM_IS_HIDDEN;
  } else return false;
  return true;
}
static double* slot(Test* t, clap_id id) { return id == 0 ? &t->gain : id == 1 ? &t->tune : id == 99 ? &t->crash : NULL; }
static bool p_get(const clap_plugin_t* p, clap_id id, double* out) {
  double* s = slot(p->plugin_data, id);
  if (!s) return false;
  *out = *s;
  return true;
}
static bool p_to_text(const clap_plugin_t* p, clap_id id, double v, char* out, uint32_t size) {
  if (id == 0) snprintf(out, size, "%.2f", v);
  else if (id == 1) snprintf(out, size, "%+d st", (int)lround(v));
  else snprintf(out, size, "%g", v);
  return true;
}
static bool p_from_text(const clap_plugin_t* p, clap_id id, const char* s, double* out) { *out = atof(s); return true; }
static void handle(Test* t, const clap_event_header_t* e);
static void p_flush(const clap_plugin_t* p, const clap_input_events_t* in, const clap_output_events_t* out) {
  for (uint32_t i = 0; i < in->size(in); i++) handle(p->plugin_data, in->get(in, i));
}
static const clap_plugin_params_t s_params = {p_count, p_info, p_get, p_to_text, p_from_text, p_flush};

/* ── state ──────────────────────────────────────────────────────────────── */
static bool st_save(const clap_plugin_t* p, const clap_ostream_t* s) {
  Test* t = p->plugin_data;
  double buf[3] = {t->gain, t->tune, 12345.0};
  return s->write(s, "ATST", 4) == 4 && s->write(s, buf, sizeof buf) == sizeof buf;
}
static bool st_load(const clap_plugin_t* p, const clap_istream_t* s) {
  Test* t = p->plugin_data;
  char magic[4];
  double buf[3];
  if (s->read(s, magic, 4) != 4 || memcmp(magic, "ATST", 4)) return false;
  if (s->read(s, buf, sizeof buf) != sizeof buf || buf[2] != 12345.0) return false;
  t->gain = buf[0];
  t->tune = buf[1];
  return true;
}
static const clap_plugin_state_t s_state = {st_save, st_load};

/* ── ports ──────────────────────────────────────────────────────────────── */
static uint32_t ap_count(const clap_plugin_t* p, bool in) { return in && ((Test*)p->plugin_data)->synth ? 0 : 1; }
static bool ap_get(const clap_plugin_t* p, uint32_t i, bool in, clap_audio_port_info_t* info) {
  if (i) return false;
  memset(info, 0, sizeof *info);
  info->id = in ? 1 : 2;
  snprintf(info->name, sizeof info->name, in ? "In" : "Out");
  info->flags = CLAP_AUDIO_PORT_IS_MAIN;
  info->channel_count = 2;
  info->port_type = CLAP_PORT_STEREO;
  info->in_place_pair = CLAP_INVALID_ID;
  return true;
}
static const clap_plugin_audio_ports_t s_ports = {ap_count, ap_get};
static uint32_t np_count(const clap_plugin_t* p, bool in) { return in && ((Test*)p->plugin_data)->synth ? 1 : 0; }
static bool np_get(const clap_plugin_t* p, uint32_t i, bool in, clap_note_port_info_t* info) {
  if (i || !in) return false;
  memset(info, 0, sizeof *info);
  info->id = 0;
  info->supported_dialects = CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI;
  info->preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
  snprintf(info->name, sizeof info->name, "Notes");
  return true;
}
static const clap_plugin_note_ports_t s_notes = {np_count, np_get};
static uint32_t lat_get(const clap_plugin_t* p) { return ((Test*)p->plugin_data)->synth ? 0 : 64; }
static const clap_plugin_latency_t s_latency = {lat_get};

/* ── gui ────────────────────────────────────────────────────────────────── */
static bool g_supported(const clap_plugin_t* p, const char* api, bool floating) { return !strcmp(api, CLAP_WINDOW_API_X11) && !floating; }
static bool g_preferred(const clap_plugin_t* p, const char** api, bool* floating) { *api = CLAP_WINDOW_API_X11; *floating = false; return true; }
static bool g_create(const clap_plugin_t* p, const char* api, bool floating) { ((Test*)p->plugin_data)->guiCreated = 1; return true; }
static void g_destroy(const clap_plugin_t* p) { guiClose(p->plugin_data); ((Test*)p->plugin_data)->guiCreated = 0; }
static bool g_scale(const clap_plugin_t* p, double s) { return true; }
static bool g_size(const clap_plugin_t* p, uint32_t* w, uint32_t* h) { *w = 320; *h = 200; return true; }
static bool g_can_resize(const clap_plugin_t* p) { return false; }
static bool g_hints(const clap_plugin_t* p, clap_gui_resize_hints_t* h) { return false; }
static bool g_adjust(const clap_plugin_t* p, uint32_t* w, uint32_t* h) { return false; }
static bool g_set_size(const clap_plugin_t* p, uint32_t w, uint32_t h) { return false; }
static bool g_parent(const clap_plugin_t* p, const clap_window_t* w) { return guiOpen(p->plugin_data, w->x11); }
static bool g_transient(const clap_plugin_t* p, const clap_window_t* w) { return false; }
static void g_title(const clap_plugin_t* p, const char* t) {}
static bool g_show(const clap_plugin_t* p) { return true; }
static bool g_hide(const clap_plugin_t* p) { return true; }
static const clap_plugin_gui_t s_gui = {g_supported, g_preferred, g_create, g_destroy, g_scale, g_size, g_can_resize, g_hints,
                                        g_adjust, g_set_size, g_parent, g_transient, g_title, g_show, g_hide};

/* ── plugin ─────────────────────────────────────────────────────────────── */
static bool pl_init(const clap_plugin_t* p) { return true; }
static void pl_destroy(const clap_plugin_t* p) {
  guiClose(p->plugin_data);
  free(p->plugin_data);
}
static bool pl_activate(const clap_plugin_t* p, double sr, uint32_t minf, uint32_t maxf) { ((Test*)p->plugin_data)->sr = sr; return true; }
static void pl_deactivate(const clap_plugin_t* p) {}
static bool pl_start(const clap_plugin_t* p) { return true; }
static void pl_stop(const clap_plugin_t* p) {}
static void pl_reset(const clap_plugin_t* p) { memset(((Test*)p->plugin_data)->v, 0, sizeof(Voice) * MAXV); }

static void noteOn(Test* t, int key, int id, double vel) {
  for (int i = 0; i < MAXV; i++)
    if (!t->v[i].active) {
      t->v[i].active = 1;
      t->v[i].key = key;
      t->v[i].id = id;
      t->v[i].phase = 0;
      t->v[i].inc = 2 * M_PI * 440.0 * pow(2.0, (key - 69 + t->tune) / 12.0) / t->sr;
      t->v[i].amp = vel;
      return;
    }
}
static void noteOff(Test* t, int key) {
  for (int i = 0; i < MAXV; i++)
    if (t->v[i].active && t->v[i].key == key) t->v[i].active = 0;
}

static void handle(Test* t, const clap_event_header_t* e) {
  if (e->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
  switch (e->type) {
    case CLAP_EVENT_NOTE_ON: {
      const clap_event_note_t* n = (const clap_event_note_t*)e;
      noteOn(t, n->key, n->note_id, n->velocity);
      break;
    }
    case CLAP_EVENT_NOTE_OFF: noteOff(t, ((const clap_event_note_t*)e)->key); break;
    case CLAP_EVENT_MIDI: {
      const clap_event_midi_t* m = (const clap_event_midi_t*)e;
      int st = m->data[0] & 0xF0;
      if (st == 0x90 && m->data[2]) noteOn(t, m->data[1], -1, m->data[2] / 127.0);
      else if (st == 0x80 || st == 0x90) noteOff(t, m->data[1]);
      else if (st == 0xB0 && (m->data[1] == 123 || m->data[1] == 120)) pl_reset(&t->plugin);
      break;
    }
    case CLAP_EVENT_PARAM_VALUE: {
      const clap_event_param_value_t* pv = (const clap_event_param_value_t*)e;
      double* s = slot(t, pv->param_id);
      if (s) *s = pv->value;
      if (pv->param_id == 99 && pv->value > 0.5) raise(SIGSEGV); /* crash test */
      break;
    }
  }
}

static clap_process_status pl_process(const clap_plugin_t* p, const clap_process_t* pr) {
  Test* t = p->plugin_data;
  uint32_t n = pr->frames_count, ev = 0, nev = pr->in_events->size(pr->in_events);
  float* oL = pr->audio_outputs[0].data32[0];
  float* oR = pr->audio_outputs[0].data32[1];
  for (uint32_t i = 0; i < n; i++) {
    while (ev < nev) {
      const clap_event_header_t* e = pr->in_events->get(pr->in_events, ev);
      if (e->time > i) break;
      handle(t, e);
      ev++;
    }
    if (t->synth) {
      double s = 0;
      for (int k = 0; k < MAXV; k++)
        if (t->v[k].active) {
          s += sin(t->v[k].phase) * t->v[k].amp * t->gain;
          t->v[k].phase += t->v[k].inc;
        }
      oL[i] = oR[i] = (float)s;
    } else {
      oL[i] = (float)(pr->audio_inputs[0].data32[0][i] * t->gain);
      oR[i] = (float)(pr->audio_inputs[0].data32[1][i] * t->gain);
    }
  }
  for (; ev < nev; ev++) handle(t, pr->in_events->get(pr->in_events, ev));
  return CLAP_PROCESS_CONTINUE;
}

static const void* pl_ext(const clap_plugin_t* p, const char* id) {
  if (!strcmp(id, CLAP_EXT_PARAMS)) return &s_params;
  if (!strcmp(id, CLAP_EXT_STATE)) return &s_state;
  if (!strcmp(id, CLAP_EXT_AUDIO_PORTS)) return &s_ports;
  if (!strcmp(id, CLAP_EXT_NOTE_PORTS)) return &s_notes;
  if (!strcmp(id, CLAP_EXT_LATENCY)) return &s_latency;
  if (!strcmp(id, CLAP_EXT_GUI)) return &s_gui;
  return NULL;
}
static void pl_main(const clap_plugin_t* p) {}

static const char* synth_features[] = {CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER, CLAP_PLUGIN_FEATURE_STEREO, NULL};
static const char* gain_features[] = {CLAP_PLUGIN_FEATURE_AUDIO_EFFECT, CLAP_PLUGIN_FEATURE_UTILITY, CLAP_PLUGIN_FEATURE_STEREO, NULL};
static const clap_plugin_descriptor_t descs[2] = {
    {CLAP_VERSION_INIT, "arkane.test.synth", "Arkane Test Synth", "Arkane", "", "", "", "1.0.0", "Sine test synth", synth_features},
    {CLAP_VERSION_INIT, "arkane.test.gain", "Arkane Test Gain", "Arkane", "", "", "", "1.0.0", "Gain test effect", gain_features},
};

static uint32_t f_count(const clap_plugin_factory_t* f) { return 2; }
static const clap_plugin_descriptor_t* f_desc(const clap_plugin_factory_t* f, uint32_t i) { return i < 2 ? &descs[i] : NULL; }
static const clap_plugin_t* f_create(const clap_plugin_factory_t* f, const clap_host_t* host, const char* id) {
  int synth = !strcmp(id, descs[0].id);
  if (!synth && strcmp(id, descs[1].id)) return NULL;
  Test* t = calloc(1, sizeof(Test));
  t->host = host;
  t->synth = synth;
  t->gain = synth ? 0.5 : 1.0;
  t->sr = 48000;
  t->plugin.desc = &descs[synth ? 0 : 1];
  t->plugin.plugin_data = t;
  t->plugin.init = pl_init;
  t->plugin.destroy = pl_destroy;
  t->plugin.activate = pl_activate;
  t->plugin.deactivate = pl_deactivate;
  t->plugin.start_processing = pl_start;
  t->plugin.stop_processing = pl_stop;
  t->plugin.reset = pl_reset;
  t->plugin.process = pl_process;
  t->plugin.get_extension = pl_ext;
  t->plugin.on_main_thread = pl_main;
  return &t->plugin;
}
static const clap_plugin_factory_t s_factory = {f_count, f_desc, f_create};

static bool e_init(const char* path) { return true; }
static void e_deinit(void) {}
static const void* e_factory(const char* id) { return !strcmp(id, CLAP_PLUGIN_FACTORY_ID) ? &s_factory : NULL; }
CLAP_EXPORT const clap_plugin_entry_t clap_entry = {CLAP_VERSION_INIT, e_init, e_deinit, e_factory};
