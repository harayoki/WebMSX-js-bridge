# Short Protocol v1 Bridge (JavaScript ↔ MSX)

An embeddable bridge that implements the **Short Protocol v1** spec for WebMSX.

The bridge:
- Reserves four consecutive ports (default `0x48`–`0x4B`) for CMD/ARG/STATUS/DATA.
- Queues JS→MSX packets in a ring buffer (no `shift()`).
- Surfaces swipe and accelerometer events as `EVT_SWIPE` / `EVT_ACCEL`.
- Handles `MP3_PLAY`, `MP3_STOP`, `MP3_VOL`, `REQ_TEXT`, and `RESET`.
- Exposes a small host API to override text generation and MP3 hooks or to feed custom events.

See the protocol document for the wire format and command list: [`doc/short-protocol-v1.md`](../../../doc/short-protocol-v1.md).

## Usage

1. Include the script on the page that hosts WebMSX:
   ```html
   <script src="src/js_bridge/short_protocol/bridge.js"></script>
   ```
   The bridge waits for `WMSX.room.machine.bus`, verifies the port range is free, and then attaches.
2. Optionally customize behavior from the host page:
   ```js
   const bridge = window.WebMSXShortBridge;

   // Provide your own async text provider
   bridge.setTextProvider(async (reqId) => {
     const response = await fetch(`/text?id=${reqId}`);
     return response.text();
   });

   // Override MP3 handlers (play/stop/volume)
   bridge.setMp3Hooks({
     play: (trackId) => console.log("play", trackId),
     stop: () => console.log("stop"),
     setVolume: (volume) => console.log("volume", volume),
   });

   // Manually push events if you prefer not to use the built-in listeners
   bridge.feedSwipe(1, 180);          // dir=right
   bridge.feedAcceleration(0, 0, 64); // ax/ay/az in -128..127
   ```
3. On the MSX side, poll `PORT_STATUS` until `RX_READY` and read packets byte-by-byte from `PORT_DATA`.

## Notes

- `STATUS` bits follow the spec: `ALIVE` is always `1`, `TX_READY` is always `1`, `BUSY` reflects async text generation, `ERROR` latches after `RSP_ERROR` until `RESET`.
- Events prefer the **latest** data; if the buffer would overflow, the oldest packets are dropped to make room.
- When no data is queued, `PORT_DATA` returns `0xFF`.
- `REQ_TEXT` responses are UTF-8 and capped at **255 bytes** as required by the protocol.
