// Linked into every native binary (see glibc-compat.h). The static libstdc++ of a newer toolchain calls
// glibc entry points that older systems lack: the C23 strto* functions (eh_alloc.o reads GLIBCXX_TUNABLES
// with __isoc23_strtoul, glibc 2.38) and arc4random (std::random_device, glibc 2.36). Define them here on
// top of older functions, hidden so they never interpose on the host process (Electron).
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/random.h>

#define COMPAT_HIDDEN extern "C" __attribute__((visibility("hidden")))

COMPAT_HIDDEN long __isoc23_strtol(const char* s, char** end, int base) { return strtol(s, end, base); }
COMPAT_HIDDEN unsigned long __isoc23_strtoul(const char* s, char** end, int base) { return strtoul(s, end, base); }
COMPAT_HIDDEN long long __isoc23_strtoll(const char* s, char** end, int base) { return strtoll(s, end, base); }
COMPAT_HIDDEN unsigned long long __isoc23_strtoull(const char* s, char** end, int base) { return strtoull(s, end, base); }

COMPAT_HIDDEN uint32_t arc4random(void) {
  uint32_t v = 0;
  for (;;) {
    ssize_t n = getrandom(&v, sizeof v, 0);  // glibc 2.25
    if (n == (ssize_t)sizeof v) return v;
    if (n < 0 && errno != EINTR) abort();  // getrandom never fails on a sane kernel (>= 3.17)
  }
}
