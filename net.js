// Online play: a WebSocket to the Apple Royale world (drawvidverse
// worldserver, games/appleroyale). Speaks its protocol:
//   → auth, join, q (queue for a lobby), go (start now), i (one step's input)
//   ← welcome, hi (the server's rules fingerprint), s (snapshot, 20/s)
// See MULTIPLAYER_PLAN.md and the server's games/appleroyale/protocol.ts.

(function () {
  "use strict";

  // localhost → a local dev server; anywhere else → the live world.
  // ?server=ws://host:port overrides.
  function serverUrl() {
    const override = new URLSearchParams(location.search).get("server");
    if (override) return override;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    return local ? "ws://localhost:7781" : "wss://apple-world.drawvid.com";
  }

  // ?lag=100 delays every message 100 ms each way (testing on localhost).
  const LAG = +new URLSearchParams(location.search).get("lag") || 0;
  const later = (fn) => (LAG ? setTimeout(fn, LAG) : fn());

  class Net {
    // handlers: onHello(rules), onSnapshot(s), onClose(reason)
    constructor(name, handlers) {
      this.h = handlers;
      this.closed = false;
      this.ws = new WebSocket(serverUrl());
      this.ws.onopen = () => {
        this._send({ t: "auth", token: "" });
        this._send({ t: "join", name });
      };
      this.ws.onmessage = (e) => later(() => this._receive(e));
      this.ws.onclose = () => this.close("connection lost");
      this.ws.onerror = () => this.close("can't reach the server");
    }

    _receive(e) {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (m.t === "welcome") this._send({ t: "q" });
      else if (m.t === "hi") this.h.onHello(m.rules);
      else if (m.t === "s") this.h.onSnapshot(m);
      else if (m.t === "error") this.close(m.message || m.code || "server error");
    }

    input(seq, input) {
      this._send({ t: "i", s: seq, m: input.move, b: input.button });
    }

    startNow() {
      this._send({ t: "go" });
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
      later(() => {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
      });
    }
  }

  window.AppleNet = Net;
})();
