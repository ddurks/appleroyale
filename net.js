// Online play: a WebSocket to the Apple Royale world (drawvidverse
// worldserver, games/appleroyale). Speaks its protocol:
//   → auth, join, c (your apple's colour), q (queue for a lobby), go (start
//     now), i (one step's input), n (rename)
//   ← welcome, hi (the server's rules fingerprint), s (snapshot, 30/s)
// Snapshots come and inputs go as binary, in drawvidverse's shared format
// (wire.js, copied from there by its tools/scripts/copy-wire.sh); the
// welcome brings their schema. See the server's games/appleroyale/protocol.ts.

(function () {
  "use strict";

  // Served from this machine or the local network (a phone testing against
  // your Mac) → the dev server on that host; anywhere else → the live world.
  // ?server=ws://host:port overrides.
  function serverUrl() {
    const override = new URLSearchParams(location.search).get("server");
    if (override) return override;
    const h = location.hostname;
    const local = /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(h);
    return local ? `ws://${h}:7781` : "wss://apple-world.drawvid.com";
  }

  // ?lag=100 delays every message 100 ms each way (testing on localhost).
  const LAG = +new URLSearchParams(location.search).get("lag") || 0;
  const later = (fn) => (LAG ? setTimeout(fn, LAG) : fn());

  // Snapshots come 30 a second; none for this long and the link has
  // stalled. Inputs aren't sent into it meanwhile: they'd only pile up and
  // arrive in one late burst (the server keeps just the newest few).
  const STALL_MS = 500;

  class Net {
    // handlers: onHello(rules), onSnapshot(s), onClose(reason)
    constructor(name, colour, handlers) {
      this.h = handlers;
      this.colour = colour;
      this.closed = false;
      this.ws = new WebSocket(serverUrl());
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => {
        this._send({ t: "auth", token: "" });
        this._send({ t: "join", name });
      };
      this.heardAt = performance.now();
      this.ws.onmessage = (e) => {
        this.heardAt = performance.now();
        later(() => this._receive(e));
      };
      this.ws.onclose = () => this.close("connection lost");
      this.ws.onerror = () => this.close("can't reach the server");
    }

    _receive(e) {
      let m;
      try {
        if (typeof e.data === "string") m = JSON.parse(e.data);
        else if (this.codec) m = this.codec.decode(new Uint8Array(e.data));
        else return;
      } catch (err) {
        return;
      }
      if (m.t === "welcome") {
        if (m.wire) {
          if (m.wire.v !== DrawvidWire.VERSION) return this.close("This page is out of date — reload it to play online.");
          this.codec = DrawvidWire.compile(m.wire.schema);
        }
        this._send({ t: "c", c: this.colour });
        this._send({ t: "q" });
      }
      else if (m.t === "hi") this.h.onHello(m.rules);
      else if (m.t === "s") this.h.onSnapshot(m);
      else if (m.t === "error") this.close(m.message || m.code || "server error");
    }

    input(seq, input) {
      if (performance.now() - this.heardAt > STALL_MS) return;
      const m = { t: "i", s: seq, m: input.move, b: input.button };
      if (this.codec && this.codec.has("i")) this._sendRaw(this.codec.encode(m));
      else this._send(m);
    }

    startNow() {
      this._send({ t: "go" });
    }

    rename(name) {
      this._send({ t: "n", name });
    }

    close(reason) {
      if (this.closed) return;
      this.closed = true;
      try {
        this.ws.close();
      } catch (e) {}
      if (reason) this.h.onClose(reason);
    }

    _send(m) {
      this._sendRaw(JSON.stringify(m));
    }

    _sendRaw(data) {
      later(() => {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
      });
    }
  }

  window.AppleNet = Net;
})();
