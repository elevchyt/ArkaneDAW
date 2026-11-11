# arkane_bridge.node — N-API addon (ABI-stable: one binary for Node and Electron). No node-gyp needed.
CXX ?= g++
BUILD := build
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -fPIC -pthread \
            -Ithird_party/node-api -DBUILDING_NODE_EXTENSION -include ../compat/glibc-compat.h
# Portable addon: no libstdc++ version requirement on the user's system (libgcc_s stays shared: its static
# unwinder would need glibc 2.35 for _dl_find_object).
PORTABLE_LDFLAGS := -static-libstdc++

all: $(BUILD)/arkane_bridge.node

$(BUILD)/arkane_bridge.node: src/bridge.cpp ../vsthost/src/protocol.h ../compat/glibc-compat.h ../compat/glibc-compat.cpp
	@mkdir -p $(BUILD)
	$(CXX) $(CXXFLAGS) $(PORTABLE_LDFLAGS) -shared -o $@ src/bridge.cpp ../compat/glibc-compat.cpp -lrt -pthread

clean:
	rm -rf $(BUILD)

.PHONY: all clean
