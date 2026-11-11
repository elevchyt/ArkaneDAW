// Force-included (-include) into every native translation unit so the binaries run on older glibc.
//
// glibc >= 2.38 headers redirect strtol/strtoul/sscanf/... to the C23 variants (__isoc23_strtoul,
// __isoc23_sscanf, versioned GLIBC_2.38) whenever _GNU_SOURCE is on, which g++ always defines. We never
// parse "0b" binary literals, so bind to the classic symbols instead. With this, the floor is glibc 2.34
// (shm_open/dlopen/pthread_* moved into libc there); native/build.sh checks it after every build.
#pragma once
#include <features.h>
#if defined(__GLIBC_USE_C2X_STRTOL)
#undef __GLIBC_USE_C2X_STRTOL
#define __GLIBC_USE_C2X_STRTOL 0
#endif
#if defined(__GLIBC_USE_C23_STRTOL)
#undef __GLIBC_USE_C23_STRTOL
#define __GLIBC_USE_C23_STRTOL 0
#endif
