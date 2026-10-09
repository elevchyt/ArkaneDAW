# arkane-vsthost: out-of-process VST2/VST3/CLAP host. Plain make + g++ (no cmake, no X11 headers needed).
CXX ?= g++
CC ?= gcc
BUILD := build
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -pthread \
            -Ithird_party/clap/include -Ithird_party/vst3 -DRELEASE=1
LDLIBS := -ldl -lrt -pthread

SRCS := src/main.cpp src/clap_host.cpp src/vst3_host.cpp src/vst2_host.cpp src/vst3_iids.cpp \
        third_party/vst3/pluginterfaces/base/funknown.cpp
OBJS := $(patsubst %.cpp,$(BUILD)/obj/%.o,$(SRCS))

all: $(BUILD)/arkane-vsthost tests

$(BUILD)/obj/%.o: %.cpp src/*.h
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(BUILD)/arkane-vsthost: $(OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $(OBJS) $(LDLIBS)

# ── tests ─────────────────────────────────────────────────────────────────────
tests: $(BUILD)/arkane-test-synth.clap $(BUILD)/vsthost-test

$(BUILD)/arkane-test-synth.clap: tests/test_plugin.c
	@mkdir -p $(BUILD)
	$(CC) -O2 -g -std=gnu11 -Wall -fPIC -shared -Ithird_party/clap/include -o $@ $< -lm -ldl

$(BUILD)/vsthost-test: tests/harness.cpp src/protocol.h src/util.h
	$(CXX) $(CXXFLAGS) -Isrc -o $@ tests/harness.cpp -lrt -pthread

test: all
	$(BUILD)/vsthost-test $(BUILD)/arkane-vsthost $(BUILD)/arkane-test-synth.clap $(EXTRA_PLUGINS)

clean:
	rm -rf $(BUILD)

.PHONY: all tests test clean
