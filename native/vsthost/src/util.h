// Small utilities: a minimal JSON value/parser/writer (for the control channel), base64, string helpers.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <strings.h>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace ark {

// ── JSON ─────────────────────────────────────────────────────────────────────
struct Json {
  enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<Json> a;
  std::map<std::string, Json> o;

  Json() {}
  static Json object() { Json j; j.type = Obj; return j; }
  static Json array() { Json j; j.type = Arr; return j; }
  Json(bool v) : type(Bool), b(v) {}
  Json(double v) : type(Num), n(v) {}
  Json(int v) : type(Num), n(v) {}
  Json(unsigned v) : type(Num), n(v) {}
  Json(int64_t v) : type(Num), n((double)v) {}
  Json(const char* v) : type(Str), s(v ? v : "") {}
  Json(const std::string& v) : type(Str), s(v) {}

  Json& operator[](const std::string& k) { type = Obj; return o[k]; }
  const Json* get(const std::string& k) const {
    auto it = o.find(k);
    return it == o.end() ? nullptr : &it->second;
  }
  std::string str(const std::string& k, const std::string& def = "") const {
    auto* j = get(k);
    return j && j->type == Str ? j->s : def;
  }
  double num(const std::string& k, double def = 0) const {
    auto* j = get(k);
    return j && j->type == Num ? j->n : def;
  }
  void push(const Json& v) { type = Arr; a.push_back(v); }

  static void escape(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
      switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
          if (c < 0x20) {
            char buf[8];
            snprintf(buf, sizeof buf, "\\u%04x", c);
            out += buf;
          } else out += (char)c;
      }
    }
    out += '"';
  }
  void dump(std::string& out) const {
    switch (type) {
      case Null: out += "null"; break;
      case Bool: out += b ? "true" : "false"; break;
      case Num: {
        if (!std::isfinite(n)) { out += "null"; break; }
        char buf[32];
        if (n == (double)(int64_t)n && std::fabs(n) < 1e15) snprintf(buf, sizeof buf, "%lld", (long long)n);
        else snprintf(buf, sizeof buf, "%.9g", n);
        out += buf;
        break;
      }
      case Str: escape(out, s); break;
      case Arr: {
        out += '[';
        for (size_t i = 0; i < a.size(); i++) { if (i) out += ','; a[i].dump(out); }
        out += ']';
        break;
      }
      case Obj: {
        out += '{';
        bool first = true;
        for (auto& kv : o) {
          if (!first) out += ',';
          first = false;
          escape(out, kv.first);
          out += ':';
          kv.second.dump(out);
        }
        out += '}';
        break;
      }
    }
  }
  std::string dump() const { std::string s; dump(s); return s; }

  // Parser (accepts the JSON the renderer sends; returns Null on error)
  static Json parse(const std::string& src) {
    size_t i = 0;
    Json j;
    if (!parseValue(src, i, j)) return Json();
    return j;
  }

 private:
  static void ws(const std::string& s, size_t& i) { while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++; }
  static void utf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) out += (char)cp;
    else if (cp < 0x800) { out += (char)(0xC0 | (cp >> 6)); out += (char)(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { out += (char)(0xE0 | (cp >> 12)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
    else { out += (char)(0xF0 | (cp >> 18)); out += (char)(0x80 | ((cp >> 12) & 0x3F)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
  }
  static bool parseString(const std::string& s, size_t& i, std::string& out) {
    if (s[i] != '"') return false;
    i++;
    while (i < s.size() && s[i] != '"') {
      char c = s[i++];
      if (c == '\\') {
        if (i >= s.size()) return false;
        char e = s[i++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'u': {
            if (i + 4 > s.size()) return false;
            uint32_t cp = (uint32_t)strtoul(s.substr(i, 4).c_str(), nullptr, 16);
            i += 4;
            if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') {
              uint32_t lo = (uint32_t)strtoul(s.substr(i + 2, 4).c_str(), nullptr, 16);
              i += 6;
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            }
            utf8(out, cp);
            break;
          }
          default: out += e;
        }
      } else out += c;
    }
    if (i >= s.size()) return false;
    i++;
    return true;
  }
  static bool parseValue(const std::string& s, size_t& i, Json& j) {
    ws(s, i);
    if (i >= s.size()) return false;
    char c = s[i];
    if (c == '{') {
      j.type = Obj;
      i++;
      ws(s, i);
      if (i < s.size() && s[i] == '}') { i++; return true; }
      while (i < s.size()) {
        ws(s, i);
        std::string k;
        if (!parseString(s, i, k)) return false;
        ws(s, i);
        if (i >= s.size() || s[i] != ':') return false;
        i++;
        Json v;
        if (!parseValue(s, i, v)) return false;
        j.o[k] = std::move(v);
        ws(s, i);
        if (i < s.size() && s[i] == ',') { i++; continue; }
        if (i < s.size() && s[i] == '}') { i++; return true; }
        return false;
      }
      return false;
    }
    if (c == '[') {
      j.type = Arr;
      i++;
      ws(s, i);
      if (i < s.size() && s[i] == ']') { i++; return true; }
      while (i < s.size()) {
        Json v;
        if (!parseValue(s, i, v)) return false;
        j.a.push_back(std::move(v));
        ws(s, i);
        if (i < s.size() && s[i] == ',') { i++; continue; }
        if (i < s.size() && s[i] == ']') { i++; return true; }
        return false;
      }
      return false;
    }
    if (c == '"') { j.type = Str; return parseString(s, i, j.s); }
    if (s.compare(i, 4, "true") == 0) { j = Json(true); i += 4; return true; }
    if (s.compare(i, 5, "false") == 0) { j = Json(false); i += 5; return true; }
    if (s.compare(i, 4, "null") == 0) { j = Json(); i += 4; return true; }
    char* end = nullptr;
    double v = strtod(s.c_str() + i, &end);
    if (end == s.c_str() + i) return false;
    i = end - s.c_str();
    j = Json(v);
    return true;
  }
};

// ── base64 ───────────────────────────────────────────────────────────────────
inline std::string base64Encode(const uint8_t* data, size_t len) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((len + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < len; i += 3) {
    uint32_t v = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out += T[v >> 18]; out += T[(v >> 12) & 63]; out += T[(v >> 6) & 63]; out += T[v & 63];
  }
  if (i < len) {
    uint32_t v = data[i] << 16;
    if (i + 1 < len) v |= data[i + 1] << 8;
    out += T[v >> 18]; out += T[(v >> 12) & 63];
    out += i + 1 < len ? T[(v >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

inline std::vector<uint8_t> base64Decode(const std::string& s) {
  auto val = [](char c) -> int {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+' || c == '-') return 62;
    if (c == '/' || c == '_') return 63;
    return -1;
  };
  std::vector<uint8_t> out;
  out.reserve(s.size() * 3 / 4);
  uint32_t acc = 0;
  int bits = 0;
  for (char c : s) {
    int v = val(c);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back((uint8_t)((acc >> bits) & 0xFF));
    }
  }
  return out;
}

inline bool endsWith(const std::string& s, const std::string& suffix) {
  return s.size() >= suffix.size() && strcasecmp(s.c_str() + s.size() - suffix.size(), suffix.c_str()) == 0;
}

}  // namespace ark
