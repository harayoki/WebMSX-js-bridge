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

## Short Protocol v1-2P (two-port short bridge)

**Goal:** Compress the previous 4-port Short Protocol into two fixed ports (`0x48`/`0x49`) while keeping the original concepts (STATUS bits, length-prefixed packets, RESET, BUSY/ERROR) intact.

### Port map
- **PORT0 = `0x48` (CTRL/STATUS, bidirectional)**
  - `OUT`: `CMD` (1 byte)
  - `IN` : `STATUS` (bitfield)
- **PORT1 = `0x49` (DATA, bidirectional)**
  - `OUT`: `ARG` / `DATA` (1 byte each)
  - `IN` : RX data (1 byte each, dequeued from a JS-side ring buffer)

### STATUS bits (`IN` from PORT0)
- `bit0 RX_READY` : JS → MSX RX queue has readable data (the next byte is on PORT1)
- `bit1 TX_READY` : MSX → JS send is currently accepted (may always be `1` for now)
- `bit2 EV_READY` : Input event ready (can mirror `RX_READY`)
- `bit3 BUSY`     : JS is generating a response asynchronously (e.g., `fetch`)
- `bit4 ERROR`    : The most recent handling failed (details arrive via `RSP_ERROR`)
- `bit7 ALIVE`    : Always `1` (liveness indicator)

### Packet format (JS → MSX, required)
- `1 byte TYPE`
- `1 byte LEN` (`0..255`)
- `N bytes PAYLOAD`

The MSX side typically polls `STATUS` until `RX_READY` is set, then consumes a packet from `PORT1`.

### Commands (`OUT PORT0`)

After writing `CMD` to `PORT0`, send the required argument bytes to `PORT1`.  
JS keeps `lastCmd` and `expectedLen`; once the expected number of bytes arrives, it dispatches.

| CMD  | Extra data on PORT1 | Notes |
| ---- | ------------------- | ----- |
| `0x20 MP3_PLAY` | `1 byte trackId` | |
| `0x21 MP3_STOP` | `0` bytes | |
| `0x22 MP3_VOL`  | `1 byte volume` | |
| `0x30 REQ_TEXT` | `1 byte reqId` | JS responds asynchronously with `RSP_TEXT` packet; may set `STATUS.BUSY` while generating |
| `0x3F RESET`    | `0` bytes | Clears JS-side state (queues, `lastCmd`, `ERROR/BUSY`, partial reception) |

#### Extension notes
- *Plan B (length prefix on MSX → JS)*: After `CMD`, send `LEN (1)` on `PORT1`, then `LEN` bytes.
- *Plan C (full symmetry)*: Apply `TYPE/LEN/PAYLOAD` to MSX → JS as well if future features require it.

### Failure and recovery
- If `DATA` arrives unexpectedly (`expectedLen == 0` but `PORT1 OUT` occurs), set `STATUS.ERROR`.
- `RESET` (`CMD = 0x3F`) clears error/busy flags, reception buffers, queues, and in-flight commands.
- Optional: drop partial receptions after a timeout if `PORT1` stays silent too long.

### Minimal MSX-side polling loop (pseudo code)

```asm
WAIT:   IN   A,(0x48)           ; read STATUS
        BIT  0,A                ; RX_READY?
        JR   Z,WAIT
        IN   A,(0x49)           ; TYPE
        LD   B,A
        IN   A,(0x49)           ; LEN
        LD   C,A
READ:   ; read payload C bytes from 0x49
```

---

## Implementation Guidelines for Handling OUT/IN from External JavaScript

### When to Hook
- After `WMSX.start()` is called, you can access `WMSX.room.machine.bus`.
- Before reserving ports, inspect `bus.devicesInputPorts` / `bus.devicesOutputPorts` and ensure no existing devices are present.

### OUT (MSX → JS)
- Register handlers with `bus.connectOutputDevice(port, handler)`. Handlers receive `(value, port)`.
- **Do not run heavy work synchronously** inside the handler. Buffer data and process it later via `setTimeout` / `queueMicrotask` to keep emulator frames responsive.
- On this 2-port protocol, `PORT0 OUT` selects the command, and `PORT1 OUT` streams its fixed-length arguments.

### IN (JS → MSX)
- Register handlers with `bus.connectInputDevice(port, handler)`. Handlers receive `port` and **must immediately return** a byte.
- Keep a queue of response bytes ready; when empty, return `0xff` (or another sentinel for “not ready”).
- The `STATUS` byte (via `PORT0 IN`) advertises queue state (`RX_READY`), async progress (`BUSY`), and errors (`ERROR`).

### Sample: attachBridge() for Short Protocol v1-2P

```js
function attachBridge() {
  const bus = WMSX.room.machine.bus;
  const PORT_CTRL = 0x48;
  const PORT_DATA = 0x49;
  const RX_CAPACITY = 1024;

  // Prevent collisions with other devices
  if (bus.devicesInputPorts[PORT_CTRL] || bus.devicesOutputPorts[PORT_CTRL]) {
    throw new Error("PORT 0x48 is already in use");
  }
  if (bus.devicesInputPorts[PORT_DATA] || bus.devicesOutputPorts[PORT_DATA]) {
    throw new Error("PORT 0x49 is already in use");
  }

  // STATUS bits
  const STATUS = {
    RX_READY: 1 << 0,
    TX_READY: 1 << 1,
    EV_READY: 1 << 2,
    BUSY: 1 << 3,
    ERROR: 1 << 4,
    ALIVE: 1 << 7
  };

  // Commands
  const CMD = { MP3_PLAY: 0x20, MP3_STOP: 0x21, MP3_VOL: 0x22, REQ_TEXT: 0x30, RESET: 0x3f };
  const ARG_LEN = { [CMD.MP3_PLAY]: 1, [CMD.MP3_STOP]: 0, [CMD.MP3_VOL]: 1, [CMD.REQ_TEXT]: 1, [CMD.RESET]: 0 };

  // Packet types (JS -> MSX)
  const PKT = { RSP_TEXT: 0x81, RSP_ERROR: 0xe0 };

  // RX ring buffer (Array.shift is avoided)
  const rxBuf = new Uint8Array(RX_CAPACITY);
  let rxHead = 0, rxTail = 0, rxCount = 0;
  const rxPush = (byte) => {
    if (rxCount === RX_CAPACITY) { rxTail = (rxTail + 1) % RX_CAPACITY; rxCount--; } // drop oldest
    rxBuf[rxHead] = byte & 0xff;
    rxHead = (rxHead + 1) % RX_CAPACITY;
    rxCount++;
  };
  const rxPop = () => {
    if (!rxCount) return 0xff;
    const value = rxBuf[rxTail];
    rxTail = (rxTail + 1) % RX_CAPACITY;
    rxCount--;
    return value;
  };
  const pushPacket = (type, payloadBytes) => {
    rxPush(type);
    rxPush(payloadBytes.length & 0xff);
    payloadBytes.forEach(rxPush);
  };

  let busy = false;
  let error = false;
  let lastCmd = 0x00;
  let expectedLen = 0;
  let rxTmp = [];
  const resetState = () => {
    busy = false;
    error = false;
    lastCmd = 0;
    expectedLen = 0;
    rxTmp = [];
    rxHead = rxTail = rxCount = 0;
  };

  const handleReqText = (reqId) => {
    busy = true;
    queueMicrotask(async () => {
      try {
        // Replace this with a real fetch or generator; keep heavy work off the OUT handler
        const text = `Hello from JS (req ${reqId})`;
        const bytes = Array.from(new TextEncoder().encode(text)).slice(0, 255);
        pushPacket(PKT.RSP_TEXT, [reqId, ...bytes]);
      } catch (e) {
        error = true;
        pushPacket(PKT.RSP_ERROR, [reqId]);
      } finally {
        busy = false;
      }
    });
  };

  const dispatch = (cmd, args) => {
    switch (cmd) {
      case CMD.MP3_PLAY:
        // Hook your audio backend here
        break;
      case CMD.MP3_STOP:
        break;
      case CMD.MP3_VOL:
        break;
      case CMD.REQ_TEXT:
        handleReqText(args[0] ?? 0);
        return;
      case CMD.RESET:
        resetState();
        return;
      default:
        error = true;
        pushPacket(PKT.RSP_ERROR, [0xff]);
        return;
    }
  };

  bus.connectOutputDevice(PORT_CTRL, (value) => {
    lastCmd = value & 0xff;
    expectedLen = ARG_LEN[lastCmd] ?? 0;
    rxTmp = [];
    if (expectedLen === 0) queueMicrotask(() => dispatch(lastCmd, []));
  });

  bus.connectOutputDevice(PORT_DATA, (value) => {
    if (expectedLen === 0) { error = true; return; }
    rxTmp.push(value & 0xff);
    if (rxTmp.length === expectedLen) {
      queueMicrotask(() => dispatch(lastCmd, rxTmp));
      expectedLen = 0;
    }
  });

  bus.connectInputDevice(PORT_CTRL, () => {
    let status = STATUS.ALIVE | STATUS.TX_READY;
    if (rxCount) status |= STATUS.RX_READY | STATUS.EV_READY;
    if (busy) status |= STATUS.BUSY;
    if (error) status |= STATUS.ERROR;
    return status;
  });

  bus.connectInputDevice(PORT_DATA, () => rxPop());
}
```

Key points:
- Two ports only: `0x48` for `CMD`/`STATUS`, `0x49` for `ARG`/`DATA`.
- Heavy work (e.g., `fetch`) runs off the OUT handler via `queueMicrotask`.
- RX is a ring buffer; no `Array.shift`.
- `RESET` clears partial receptions, queues, and flags.

### Port design tips
- Avoid ports used by existing devices (e.g., VDP: `0x98–0x9b`, PSG: `0xa0–0xa1`, PPI: `0xa8–0xab`).
- If you need optional bulk transfer, layer a length-prefixed scheme on top of `PORT1` after a dedicated `CMD`.

### Cleanup
- When detaching the bridge, call `bus.disconnectInputDevice` / `bus.disconnectOutputDevice` to free ports.
- If the Room is rebuilt (e.g., NetPlay reconnection), re-run `attachBridge` to bind to the fresh bus.

### Legacy 4-port Short Protocol (deprecated)
- The previous `PORT_CMD/ARG/STATUS/DATA` (4-port) layout remains a useful reference but should be treated as **deprecated** in favor of the 2-port map above.
- If you keep it for comparison, clearly flag it as deprecated in downstream docs or samples.
