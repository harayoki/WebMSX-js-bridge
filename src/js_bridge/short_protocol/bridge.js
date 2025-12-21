// Short Protocol v1 bridge for WebMSX
// - Implements CMD/ARG/STATUS/DATA ports (defaults: 0x48–0x4B)
// - Uses a byte ring buffer for JS -> MSX packets
// - Handles swipe/accelerometer events plus MP3/text commands

(function attachShortProtocolBridge() {
  const PORT_CMD = 0x48;
  const PORT_ARG = 0x49;
  const PORT_STATUS = 0x4a;
  const PORT_DATA = 0x4b;

  const CMD = {
    MP3_PLAY: 0x20,
    MP3_STOP: 0x21,
    MP3_VOL: 0x22,
    REQ_TEXT: 0x30,
    RESET: 0x3f,
  };

  const TYPE = {
    EVT_SWIPE: 0x01,
    EVT_ACCEL: 0x02,
    RSP_TEXT: 0x10,
    RSP_ERROR: 0x7e,
  };

  const ERR = {
    TIMEOUT: 1,
    NETWORK: 2,
    NOT_FOUND: 3,
    BUSY: 4,
    BAD_REQ: 5,
  };

  const STATUS_FLAGS = {
    RX_READY: 1 << 0,
    TX_READY: 1 << 1,
    EV_READY: 1 << 2,
    BUSY: 1 << 3,
    ERROR: 1 << 4,
    ALIVE: 1 << 7,
  };

  const encoder = new TextEncoder();

  class RingBuffer {
    constructor(size) {
      this.buffer = new Uint8Array(size);
      this.head = 0;
      this.tail = 0;
      this.length = 0;
    }

    available() {
      return this.buffer.length - this.length;
    }

    push(value) {
      this.buffer[this.tail] = value & 0xff;
      this.tail = (this.tail + 1) % this.buffer.length;
      if (this.length < this.buffer.length) {
        this.length += 1;
      } else {
        // overwrite the oldest byte
        this.head = (this.head + 1) % this.buffer.length;
      }
    }

    pop() {
      if (!this.length) return null;
      const value = this.buffer[this.head];
      this.head = (this.head + 1) % this.buffer.length;
      this.length -= 1;
      return value;
    }

    discard(count) {
      if (count <= 0 || !this.length) return;
      const drop = Math.min(count, this.length);
      this.head = (this.head + drop) % this.buffer.length;
      this.length -= drop;
    }

    clear() {
      this.head = 0;
      this.tail = 0;
      this.length = 0;
    }
  }

  const state = {
    bus: null,
    ring: new RingBuffer(2048),
    packets: [],
    packetHead: 0,
    awaitingArg: false,
    currentCmd: null,
    busy: false,
    error: false,
    requestToken: 0,
    handlers: {},
    hasEvent: false,
    mp3Hooks: {
      play: (trackId) => console.log("[ShortBridge] MP3_PLAY", trackId),
      stop: () => console.log("[ShortBridge] MP3_STOP"),
      setVolume: (volume) => console.log("[ShortBridge] MP3_VOL", volume),
    },
    textProvider: async (reqId) => `Text response for req ${reqId}`,
  };

  function compactPackets() {
    if (state.packetHead > 32 && state.packetHead * 2 > state.packets.length) {
      state.packets = state.packets.slice(state.packetHead);
      state.packetHead = 0;
    }
  }

  function computeHasEvent() {
    for (let i = state.packetHead; i < state.packets.length; i += 1) {
      const meta = state.packets[i];
      if (meta.isEvent && meta.remaining > 0) return true;
    }
    return false;
  }

  function ensureCapacity(bytesNeeded) {
    while (state.ring.available() < bytesNeeded && state.packetHead < state.packets.length) {
      const drop = state.packets[state.packetHead];
      state.ring.discard(drop.remaining);
      state.packetHead += 1;
    }
    compactPackets();
    state.hasEvent = computeHasEvent();
  }

  function enqueuePacket(type, payload = []) {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const total = bytes.length + 2;
    ensureCapacity(total);

    state.packets.push({
      type,
      remaining: total,
      isEvent: type === TYPE.EVT_SWIPE || type === TYPE.EVT_ACCEL,
    });

    state.ring.push(type & 0xff);
    state.ring.push(bytes.length & 0xff);
    for (let i = 0; i < bytes.length; i += 1) state.ring.push(bytes[i]);
    state.hasEvent = computeHasEvent();
  }

  function readByte() {
    const value = state.ring.pop();
    if (value === null) return 0xff;

    const meta = state.packets[state.packetHead];
    if (meta) {
      meta.remaining -= 1;
      if (meta.remaining <= 0) {
        state.packetHead += 1;
        compactPackets();
      }
    }
    state.hasEvent = computeHasEvent();
    return value;
  }

  function resetState() {
    state.ring.clear();
    state.packets = [];
    state.packetHead = 0;
    state.awaitingArg = false;
    state.currentCmd = null;
    state.busy = false;
    state.error = false;
    state.requestToken += 1;
    state.hasEvent = false;
  }

  function pushError(errCode, context) {
    const payload = context === undefined ? [errCode] : [errCode, context];
    state.error = true;
    enqueuePacket(TYPE.RSP_ERROR, payload);
  }

  function pushTextResponse(text, token) {
    if (token !== state.requestToken) return;
    const utf8 = encoder.encode(String(text ?? ""));
    const capped = utf8.slice(0, Math.min(255, utf8.length));
    enqueuePacket(TYPE.RSP_TEXT, capped);
  }

  function startTextRequest(reqId) {
    const token = state.requestToken + 1;
    state.requestToken = token;
    state.busy = true;
    Promise.resolve()
      .then(() => state.textProvider(reqId))
      .then((text) => pushTextResponse(text, token))
      .catch(() => {
        if (token !== state.requestToken) return;
        pushError(ERR.BUSY, reqId);
      })
      .finally(() => {
        if (token !== state.requestToken) return;
        state.busy = false;
      });
  }

  function clampSignedByte(value) {
    return Math.max(-128, Math.min(127, Math.round(value)));
  }

  function feedSwipe(dir, strength) {
    const safeDir = dir & 0x03;
    const safeStrength = Math.max(0, Math.min(255, Math.round(strength ?? 0)));
    enqueuePacket(TYPE.EVT_SWIPE, [safeDir, safeStrength]);
  }

  function feedAcceleration(ax, ay, az) {
    const payload = [
      clampSignedByte(ax) + 128,
      clampSignedByte(ay) + 128,
      clampSignedByte(az) + 128,
    ];
    enqueuePacket(TYPE.EVT_ACCEL, payload);
  }

  function handleCommand(cmd) {
    state.currentCmd = cmd;
    state.awaitingArg = cmd === CMD.MP3_PLAY || cmd === CMD.MP3_VOL || cmd === CMD.REQ_TEXT;

    if (state.awaitingArg) return;

    switch (cmd) {
      case CMD.MP3_STOP:
        state.mp3Hooks.stop();
        break;
      case CMD.RESET:
        resetState();
        break;
      default:
        pushError(ERR.BAD_REQ, cmd);
        break;
    }
    state.currentCmd = null;
  }

  function handleArg(arg) {
    const value = arg & 0xff;
    if (!state.awaitingArg || state.currentCmd === null) {
      pushError(ERR.BAD_REQ, value);
      return;
    }

    const cmd = state.currentCmd;
    state.awaitingArg = false;
    state.currentCmd = null;

    switch (cmd) {
      case CMD.MP3_PLAY:
        state.mp3Hooks.play(value);
        break;
      case CMD.MP3_VOL:
        state.mp3Hooks.setVolume(value);
        break;
      case CMD.REQ_TEXT:
        startTextRequest(value);
        break;
      default:
        pushError(ERR.BAD_REQ, cmd);
        break;
    }
  }

  function statusByte() {
    let status = STATUS_FLAGS.ALIVE | STATUS_FLAGS.TX_READY;
    if (state.ring.length) status |= STATUS_FLAGS.RX_READY;
    if (state.hasEvent) status |= STATUS_FLAGS.EV_READY;
    if (state.busy) status |= STATUS_FLAGS.BUSY;
    if (state.error) status |= STATUS_FLAGS.ERROR;
    return status;
  }

  function ensurePortsAreFree(bus) {
    const conflicts = [];
    if (bus.devicesOutputPorts[PORT_CMD]) conflicts.push(PORT_CMD);
    if (bus.devicesOutputPorts[PORT_ARG]) conflicts.push(PORT_ARG);
    if (bus.devicesInputPorts[PORT_STATUS]) conflicts.push(PORT_STATUS);
    if (bus.devicesInputPorts[PORT_DATA]) conflicts.push(PORT_DATA);
    if (conflicts.length) {
      console.warn("[ShortBridge] Ports already in use:", conflicts.map((p) => `0x${p.toString(16)}`));
    }
  }

  function connectPorts(bus) {
    state.handlers.cmd = (value) => queueMicrotask(() => handleCommand(value & 0xff));
    state.handlers.arg = (value) => queueMicrotask(() => handleArg(value & 0xff));
    state.handlers.status = () => statusByte();
    state.handlers.data = () => readByte();

    bus.connectOutputDevice(PORT_CMD, state.handlers.cmd);
    bus.connectOutputDevice(PORT_ARG, state.handlers.arg);
    bus.connectInputDevice(PORT_STATUS, state.handlers.status);
    bus.connectInputDevice(PORT_DATA, state.handlers.data);
  }

  function attachSwipeListeners() {
    const target = document.querySelector("#wmsx") || window;
    let start = null;

    function pointerFromEvent(event) {
      if (event.changedTouches && event.changedTouches.length) {
        const touch = event.changedTouches[0];
        return { x: touch.clientX, y: touch.clientY };
      }
      return { x: event.clientX, y: event.clientY };
    }

    function onStart(event) {
      start = { ...pointerFromEvent(event), time: performance.now() };
    }

    function onEnd(event) {
      if (!start) return;
      const end = pointerFromEvent(event);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 10) {
        start = null;
        return;
      }

      const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 0) : (dy >= 0 ? 3 : 2);
      const elapsed = Math.max(1, performance.now() - start.time);
      const speedFactor = Math.min(1, distance / 300) * Math.min(1, 200 / elapsed);
      const strength = Math.min(255, Math.round(speedFactor * 255));
      feedSwipe(dir, strength || Math.min(255, Math.round(distance)));
      start = null;
    }

    target.addEventListener("mousedown", onStart, { passive: true });
    target.addEventListener("touchstart", onStart, { passive: true });
    target.addEventListener("mouseup", onEnd, { passive: true });
    target.addEventListener("touchend", onEnd, { passive: true });
  }

  function attachMotionListener() {
    let lastSent = 0;
    window.addEventListener(
      "devicemotion",
      (event) => {
        const now = performance.now();
        if (now - lastSent < 80) return;
        const acc = event.accelerationIncludingGravity;
        if (!acc) return;
        feedAcceleration(acc.x || 0, acc.y || 0, acc.z || 0);
        lastSent = now;
      },
      { passive: true }
    );
  }

  function waitForBus() {
    return new Promise((resolve) => {
      function poll() {
        const bus = window.WMSX?.room?.machine?.bus;
        if (bus) return resolve(bus);
        requestAnimationFrame(poll);
      }
      poll();
    });
  }

  async function bootstrap() {
    const bus = await waitForBus();
    ensurePortsAreFree(bus);
    state.bus = bus;
    connectPorts(bus);
    attachSwipeListeners();
    attachMotionListener();
    console.log("[ShortBridge] Attached:", {
      ports: {
        cmd: `0x${PORT_CMD.toString(16)}`,
        arg: `0x${PORT_ARG.toString(16)}`,
        status: `0x${PORT_STATUS.toString(16)}`,
        data: `0x${PORT_DATA.toString(16)}`,
      },
    });
  }

  const api = {
    feedSwipe,
    feedAcceleration,
    reset: resetState,
    setTextProvider(fn) {
      if (typeof fn === "function") state.textProvider = fn;
    },
    setMp3Hooks(hooks) {
      if (!hooks) return;
      if (typeof hooks.play === "function") state.mp3Hooks.play = hooks.play;
      if (typeof hooks.stop === "function") state.mp3Hooks.stop = hooks.stop;
      if (typeof hooks.setVolume === "function") state.mp3Hooks.setVolume = hooks.setVolume;
    },
  };

  window.WebMSXShortBridge = api;
  window.addEventListener("load", bootstrap);
})();
