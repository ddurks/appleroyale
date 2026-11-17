// DrawvidWire: game messages as compact binary, for every drawvidverse world
// server and its clients. One file, no dependencies, the same in Node and the
// browser (a classic <script>: window.DrawvidWire; require or import: the
// module). Clients keep a copy: tools/scripts/copy-wire.sh <client repo>.
//
// A game describes its messages in a schema (plain JSON, so the server sends
// it in its welcome and clients never keep one of their own):
//
//   { s: [["k", "uint"], ["ph", ["enum", "lobby", "playing"]], ["x", ["q", 100]]] }
//
// Each key is a message's `t`; its fields are [name, type], every one
// optional (a message carries only those it has). Types:
//
//   "uint"            whole number ≥ 0 (1 byte under 128, more as needed)
//   "int"             whole number, either sign
//   ["q", scale]      a number kept to 1/scale (["q", 100]: hundredths)
//   "f32", "f64"      a number as a float
//   "bool"
//   "str"
//   "json"            anything, as JSON text (for what's rare or irregular)
//   ["enum", a, b…]   one of these values
//   ["list", T]       a list of T
//   ["tuple", T, U…]  a fixed list: a T, then a U…
//   ["or", v, T]      v itself (0, null…), or else a T
//
// Decoding gives back what was encoded: the same object, numbers kept to
// what their type keeps. Encode a message only if its `t` is in the schema
// (codec.has); others stay JSON.

(function (root, factory) {
  const wire = factory();
  if (typeof module === "object" && module.exports) module.exports = wire;
  else root.DrawvidWire = wire;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Raise when the encoding changes: the server sends its own in the
  // welcome, and a client with another can't read it.
  const VERSION = 1;

  const utf8Out = new TextEncoder();
  const utf8In = new TextDecoder();

  class Writer {
    constructor() {
      this.buf = new Uint8Array(256);
      this.view = new DataView(this.buf.buffer);
      this.n = 0;
    }
    room(k) {
      if (this.n + k <= this.buf.length) return;
      const grown = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
      grown.set(this.buf);
      this.buf = grown;
      this.view = new DataView(grown.buffer);
    }
    byte(b) {
      this.room(1);
      this.buf[this.n++] = b;
    }
    // LEB128, by arithmetic (exact up to 2^53, past 32 bits).
    uint(v) {
      if (!(v >= 0) || v > Number.MAX_SAFE_INTEGER || v !== Math.floor(v)) throw new Error(`wire: not a uint: ${v}`);
      while (v >= 128) {
        this.byte((v % 128) | 128);
        v = Math.floor(v / 128);
      }
      this.byte(v);
    }
    int(v) {
      this.uint(v < 0 ? -2 * v - 1 : 2 * v); // zigzag: small either way is short
    }
    float(v, bytes) {
      this.room(bytes);
      if (bytes === 4) this.view.setFloat32(this.n, v, true);
      else this.view.setFloat64(this.n, v, true);
      this.n += bytes;
    }
    str(s) {
      const b = utf8Out.encode(s);
      this.uint(b.length);
      this.room(b.length);
      this.buf.set(b, this.n);
      this.n += b.length;
    }
    done() {
      return this.buf.slice(0, this.n);
    }
  }

  class Reader {
    constructor(bytes) {
      this.buf = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.n = 0;
    }
    byte() {
      if (this.n >= this.buf.length) throw new Error("wire: message ends early");
      return this.buf[this.n++];
    }
    uint() {
      let v = 0;
      let k = 1;
      for (;;) {
        const b = this.byte();
        v += (b & 127) * k;
        if (b < 128) return v;
        k *= 128;
      }
    }
    int() {
      const z = this.uint();
      return z % 2 ? -(z + 1) / 2 : z / 2;
    }
    float(bytes) {
      if (this.n + bytes > this.buf.length) throw new Error("wire: message ends early");
      const v = bytes === 4 ? this.view.getFloat32(this.n, true) : this.view.getFloat64(this.n, true);
      this.n += bytes;
      return v;
    }
    str() {
      const len = this.uint();
      if (this.n + len > this.buf.length) throw new Error("wire: message ends early");
      const s = utf8In.decode(this.buf.subarray(this.n, this.n + len));
      this.n += len;
      return s;
    }
  }

  // A type as a pair of functions: put(writer, value), get(reader) → value.
  function compileType(type) {
    const kind = Array.isArray(type) ? type[0] : type;
    switch (kind) {
      case "uint":
        return { put: (w, v) => w.uint(v), get: (r) => r.uint() };
      case "int":
        return { put: (w, v) => w.int(Math.round(v)), get: (r) => r.int() };
      case "q": {
        const scale = type[1];
        return { put: (w, v) => w.int(Math.round(v * scale)), get: (r) => r.int() / scale };
      }
      case "f32":
        return { put: (w, v) => w.float(v, 4), get: (r) => r.float(4) };
      case "f64":
        return { put: (w, v) => w.float(v, 8), get: (r) => r.float(8) };
      case "bool":
        return { put: (w, v) => w.byte(v ? 1 : 0), get: (r) => r.byte() === 1 };
      case "str":
        return { put: (w, v) => w.str(String(v)), get: (r) => r.str() };
      case "json":
        return { put: (w, v) => w.str(JSON.stringify(v)), get: (r) => JSON.parse(r.str()) };
      case "enum": {
        const values = type.slice(1);
        return {
          put: (w, v) => {
            const i = values.indexOf(v);
            if (i < 0) throw new Error(`wire: ${JSON.stringify(v)} isn't one of ${JSON.stringify(values)}`);
            w.uint(i);
          },
          get: (r) => values[r.uint()],
        };
      }
      case "list": {
        const item = compileType(type[1]);
        return {
          put: (w, v) => {
            w.uint(v.length);
            for (const x of v) item.put(w, x);
          },
          get: (r) => {
            const out = new Array(r.uint());
            for (let i = 0; i < out.length; i++) out[i] = item.get(r);
            return out;
          },
        };
      }
      case "tuple": {
        const items = type.slice(1).map(compileType);
        return {
          put: (w, v) => {
            for (let i = 0; i < items.length; i++) items[i].put(w, v[i]);
          },
          get: (r) => items.map((t) => t.get(r)),
        };
      }
      case "or": {
        const absent = type[1];
        const t = compileType(type[2]);
        return {
          put: (w, v) => {
            if (v === absent) return w.byte(0);
            w.byte(1);
            t.put(w, v);
          },
          get: (r) => (r.byte() ? t.get(r) : absent),
        };
      }
      default:
        throw new Error(`wire: unknown type ${JSON.stringify(type)}`);
    }
  }

  // The codec for a schema. A message is: its number (the schema's order of
  // `t`s), which of its fields it has (a bit each, as a uint), then those.
  function compile(schema) {
    const byT = new Map();
    const byNumber = [];
    for (const t of Object.keys(schema)) {
      const fields = schema[t].map(([name, type]) => ({ name, ...compileType(type) }));
      const msg = { t, number: byNumber.length, fields };
      byT.set(t, msg);
      byNumber.push(msg);
    }
    return {
      has: (t) => byT.has(t),
      encode(message) {
        const msg = byT.get(message.t);
        if (!msg) throw new Error(`wire: no message ${message.t} in the schema`);
        const w = new Writer();
        w.uint(msg.number);
        let present = 0;
        let bit = 1;
        for (const f of msg.fields) {
          if (message[f.name] !== undefined) present += bit;
          bit *= 2;
        }
        w.uint(present);
        for (const f of msg.fields) if (message[f.name] !== undefined) f.put(w, message[f.name]);
        return w.done();
      },
      decode(bytes) {
        const r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        const msg = byNumber[r.uint()];
        if (!msg) throw new Error("wire: unknown message");
        let present = r.uint();
        const out = { t: msg.t };
        for (const f of msg.fields) {
          if (present % 2) out[f.name] = f.get(r);
          present = Math.floor(present / 2);
        }
        return out;
      },
    };
  }

  return { VERSION, compile };
});
