# arkane_bridge.node — N-API addon (ABI-stable: one binary for Node and Electron). No node-gyp needed.
CXX ?= g++
BUILD := build
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -fPIC -pthread \
            -Ithird_party/node-api -DBUILDING_NODE_EXTENSION

all: $(BUILD)/arkane_bridge.node

$(BUILD)/arkane_bridge.node: src/bridge.cpp ../vsthost/src/protocol.h
	@mkdir -p $(BUILD)
	$(CXX) $(CXXFLAGS) -shared -o $@ src/bridge.cpp -lrt -pthread

clean:
	rm -rf $(BUILD)

.PHONY: all clean
