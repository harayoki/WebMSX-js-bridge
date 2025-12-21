# IO Port JS Bridge

## Overview

This document describes a mechanism to connect JavaScript code and MSX-side code inside **WebMSX** using **I/O ports**.

By routing communication through MSX-style I/O port access, programs running inside WebMSX can interact with the outside world via JavaScript. This approach intentionally avoids embedding web-specific logic directly into the emulator core or MSX programs.

For a concrete, low-latency command/event channel, see the [Short Protocol v1 bridge](short-protocol-v1.md) and the accompanying implementation in `src/js_bridge/short_protocol/`.

This mechanism works **only inside the WebMSX emulator** by default.  
However, if a real MSX cartridge were designed to intercept and handle the same I/O port accesses, similar concepts could be realized on actual MSX hardware, depending on external hardware capabilities.

The long-term motivation is to keep the MSX program logic clean and portable, while leaving the door open for a future dedicated ROM cartridge implementation.

---

## Design Philosophy

- Communication is performed **only via I/O ports**
- No direct web APIs are exposed to MSX programs
- JavaScript acts as an external environment, not as part of the MSX OS
- MSX-side code remains valid Z80/MSX software
- Emulator-specific behavior is isolated at the I/O boundary

This design avoids hard-coding web access into the emulator or MSX software, preserving the possibility of future hardware implementations.

---

## Communication Model

- **MSX → JS**
  - MSX code uses `OUT` instructions to send data
- **JS → MSX**
  - MSX code uses `IN` instructions to receive data
- Data is transferred as bytes
- Higher-level protocols (length-prefixed data, commands, JSON, etc.) are built on top of this byte stream

---

## Examples of What This Enables

### BGM / Sound Effect Playback

- JavaScript handles audio playback (e.g. MP3, streaming audio)
- MSX code sends commands such as:
  - play / stop
  - track ID
  - volume changes

For cartridge-level audio handling details, see the [Sound Cartridge Specification](sound-cartridge-spec.md).

In a future hardware scenario, a ROM cartridge could:
- Store MP3 or compressed audio data externally
- Decode audio via an onboard chip
- Mix the decoded audio with the MSX sound output

This would allow rich streamed audio even on an MSX1-class machine.

---

### Web Page Navigation and DOM Control

- JavaScript updates the DOM or performs page navigation
- Typical use case:
  - Game clear events
  - Scene transitions
  - UI changes outside the emulator canvas

The MSX program remains unaware of the web environment, simply emitting commands via I/O.

---

### Internet Data Access

- JavaScript fetches dynamic data from the internet
  - APIs
  - Online services
  - Remote configuration or scores
- Retrieved data is sent back to the MSX program through the I/O bridge

This allows MSX software to react to live external data without implementing any networking stack itself.

---

### Touch and Gesture Input

- JavaScript detects smartphone or tablet interactions
  - Touch coordinates
  - Swipe directions
  - Gesture types
- Events are encoded and transmitted to MSX via I/O ports

This enables modern input methods while keeping the MSX-side logic simple and device-agnostic.

---

## Limitations

- This mechanism only functions within WebMSX unless supported by dedicated hardware
- Performance is bounded by I/O polling frequency and protocol design
- Timing-sensitive operations should remain on the MSX side

---

## Summary

The I/O Port JS Bridge treats JavaScript as an external peripheral rather than an integrated runtime.  
By respecting MSX-era I/O semantics, it enables modern capabilities while preserving portability, simplicity, and the possibility of future real-hardware implementations.

---

## Implementation Guidelines for Handling OUT/IN from External JavaScript

### When to Hook
- After `WMSX.start()` is called, you can access `WMSX.room.machine.bus`.
- Before reserving ports, inspect `bus.devicesInputPorts` / `bus.devicesOutputPorts` and ensure no existing devices are present.

### OUT (MSX → JS)
- Register handlers with `bus.connectOutputDevice(port, handler)`. Handlers receive `(value, port)`.
- **Do not run heavy work synchronously** inside the handler. Buffer data and process it later via `setTimeout` / `queueMicrotask` to keep emulator frames responsive.
- Example: buffer bytes from OUT and forward them to host JS when convenient.

```js
function attachBridge() {
  const bus = WMSX.room.machine.bus;
  const PORT_DATA = 0x48;   // Verify the port is free before use
  const outbox = [];

  function drainOutbox() {
    if (!outbox.length) return;
    const packet = new Uint8Array(outbox.splice(0, outbox.length));
    // Forward packet via fetch, WebSocket, etc.
  }

  bus.connectOutputDevice(PORT_DATA, (value) => {
    outbox.push(value & 0xff);
    if (outbox.length === 1) queueMicrotask(drainOutbox);
  });
}
```

### IN (JS → MSX)
- Register handlers with `bus.connectInputDevice(port, handler)`. Handlers receive `port` and **must immediately return** a byte.
- If delivering async data, keep a queue ready; when empty, return `0xff` (or another sentinel for “not ready”).
- Splitting “data ports” and “status ports” simplifies the protocol.

```js
function attachInbound(bus) {
  const PORT_STATUS = 0x49; // Verify the port is free before use
  const PORT_DATA = 0x4a;
  const inbox = [];

  // Feed bytes into inbox from external events
  function feedBytes(bytes) { inbox.push(...bytes); }

  bus.connectInputDevice(PORT_STATUS, () => (inbox.length ? 1 : 0)); // 1 = data available
  bus.connectInputDevice(PORT_DATA, () => (inbox.length ? inbox.shift() : 0xff));
}
```

### Port Design Tips
- Avoid ports used by existing devices (e.g., VDP: 0x98–0x9b, PSG: 0xa0–0xa1, PPI: 0xa8–0xab).
- Reserve 2–4 consecutive ports and split roles across them (“data,” “status,” “command/length,” etc.).
- For bulk transfers, consider simple protocols such as length-prefixed packets or leading-byte commands.

### Cleanup
- When detaching the bridge, call `bus.disconnectInputDevice` / `bus.disconnectOutputDevice` to free ports.
- If Room is rebuilt (e.g., NetPlay reconnection), re-run your `attachBridge` to bind to the fresh `bus`.

### Sample: BASIC + JS Visualization
- A runnable example lives in `src/js_bridge/sample1/`:
  - `io-port-bridge.bas`: SCREEN 0 BASIC that watches IN ports for JS-sent bytes, shows status on screen, and sends OUT values when keys **1–4** (port `0x50`) or **5–8** (port `0x51`) are pressed.
  - `bridge.js`: JavaScript that displays MSX OUT traffic, queues bytes for MSX IN via on-page buttons, and renders a DIV below the emulator.

Use this sample as a reference for end-to-end I/O bridging between MSX BASIC and host JavaScript.
