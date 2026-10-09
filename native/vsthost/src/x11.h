// Minimal Xlib binding loaded with dlopen("libX11.so.6") — no X11 development headers needed at build
// time, and the sidecar still runs headless (scan mode, tests) when there is no display.
// Struct layouts match <X11/Xlib.h> on LP64 Linux.
#pragma once
#include <dlfcn.h>

namespace ark {
namespace x11 {

typedef struct _XDisplay Display;
typedef unsigned long XID;
typedef XID Window;
typedef XID Atom;
typedef int Bool;
typedef int Status;

struct XAnyEvent { int type; unsigned long serial; Bool send_event; Display* display; Window window; };
struct XClientMessageEvent {
  int type; unsigned long serial; Bool send_event; Display* display; Window window; Atom message_type; int format;
  union { char b[20]; short s[10]; long l[5]; } data;
};
struct XConfigureEvent {
  int type; unsigned long serial; Bool send_event; Display* display; Window event; Window window;
  int x, y, width, height, border_width; Window above; Bool override_redirect;
};
union XEvent {
  int type;
  XAnyEvent xany;
  XClientMessageEvent xclient;
  XConfigureEvent xconfigure;
  long pad[24];
};
struct XSizeHints {
  long flags; int x, y, width, height, min_width, min_height, max_width, max_height, width_inc, height_inc;
  struct { int x, y; } min_aspect, max_aspect;
  int base_width, base_height, win_gravity;
};

constexpr long StructureNotifyMask = 1L << 17;
constexpr int ConfigureNotify = 22;
constexpr int ClientMessage = 33;
constexpr long PSize = 1L << 3, PMinSize = 1L << 4, PMaxSize = 1L << 5;
constexpr int PropModeReplace = 0;
constexpr Atom XA_STRING = 31, XA_WINDOW = 33, XA_CARDINAL = 6, XA_WM_CLASS = 67;

struct Lib {
  void* h = nullptr;
  Status (*XInitThreads)();
  Display* (*XOpenDisplay)(const char*);
  int (*XCloseDisplay)(Display*);
  int (*XDefaultScreen)(Display*);
  Window (*XRootWindow)(Display*, int);
  Window (*XCreateSimpleWindow)(Display*, Window, int, int, unsigned, unsigned, unsigned, unsigned long, unsigned long);
  int (*XDestroyWindow)(Display*, Window);
  int (*XMapRaised)(Display*, Window);
  int (*XUnmapWindow)(Display*, Window);
  int (*XStoreName)(Display*, Window, const char*);
  Atom (*XInternAtom)(Display*, const char*, Bool);
  Status (*XSetWMProtocols)(Display*, Window, Atom*, int);
  int (*XPending)(Display*);
  int (*XNextEvent)(Display*, XEvent*);
  int (*XConnectionNumber)(Display*);
  int (*XFlush)(Display*);
  int (*XSync)(Display*, Bool);
  int (*XResizeWindow)(Display*, Window, unsigned, unsigned);
  void (*XSetWMNormalHints)(Display*, Window, XSizeHints*);
  int (*XChangeProperty)(Display*, Window, Atom, Atom, int, int, const unsigned char*, int);
  int (*XSelectInput)(Display*, Window, long);
  int (*XSetTransientForHint)(Display*, Window, Window);
  void* (*XSetErrorHandler)(int (*)(Display*, void*));

  bool load() {
    if (h) return true;
    h = dlopen("libX11.so.6", RTLD_NOW | RTLD_GLOBAL);
    if (!h) return false;
#define X(name) if (!(*(void**)&name = dlsym(h, #name))) return false;
    X(XInitThreads) X(XOpenDisplay) X(XCloseDisplay) X(XDefaultScreen) X(XRootWindow) X(XCreateSimpleWindow)
    X(XDestroyWindow) X(XMapRaised) X(XUnmapWindow) X(XStoreName) X(XInternAtom) X(XSetWMProtocols) X(XPending)
    X(XNextEvent) X(XConnectionNumber) X(XFlush) X(XSync) X(XResizeWindow) X(XSetWMNormalHints) X(XChangeProperty)
    X(XSelectInput) X(XSetTransientForHint) X(XSetErrorHandler)
#undef X
    return true;
  }
};

}  // namespace x11
}  // namespace ark
