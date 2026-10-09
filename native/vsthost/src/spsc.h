// Lock-free single-producer/single-consumer queue (wait-free push/pop, drops on overflow).
#pragma once
#include <atomic>
#include <cstddef>

namespace ark {

template <typename T, size_t N>
class SpscQueue {
  static_assert((N & (N - 1)) == 0, "N must be a power of two");

 public:
  bool push(const T& v) {
    size_t w = write.load(std::memory_order_relaxed);
    if (w - read.load(std::memory_order_acquire) >= N) return false;
    buf[w & (N - 1)] = v;
    write.store(w + 1, std::memory_order_release);
    return true;
  }
  bool pop(T& out) {
    size_t r = read.load(std::memory_order_relaxed);
    if (r == write.load(std::memory_order_acquire)) return false;
    out = buf[r & (N - 1)];
    read.store(r + 1, std::memory_order_release);
    return true;
  }

 private:
  T buf[N];
  std::atomic<size_t> write{0}, read{0};
};

}  // namespace ark
