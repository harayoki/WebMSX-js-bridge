# IO Port JS Bridge Sample 1

A minimal end-to-end example that links MSX BASIC with host JavaScript via I/O ports.

## Port Map
- **OUT** from MSX → JS
  - `0x50`: values from BASIC when keys **1–4** are pressed
  - `0x51`: values from BASIC when keys **5–8** are pressed
- **IN** from JS → MSX
  - `0x52`: status (returns `1` if data is queued, otherwise `0`)
  - `0x53`: data byte (returns the next queued value or `0`)

## Files
- `io-port-bridge.bas`: SCREEN 0 BASIC that shows the current OUT/IN status and sends OUT values on key presses.
- `bridge.js`: JavaScript that displays OUT traffic, renders controls under the emulator, and queues bytes for MSX IN when buttons are clicked.

## How to Run
1. Load WebMSX as usual and include the sample script:
   ```html
   <script src="src/js_bridge/sample1/bridge.js"></script>
   ```
   The script waits for `WMSX.room.machine.bus` and then attaches handlers automatically.
2. Inside the MSX session, enter or paste the BASIC listing from `io-port-bridge.bas` and run it (`RUN`).
3. Press **1–4** (sends values to OUT `0x50`) or **5–8** (sends values to OUT `0x51`). The bridge panel shows the captured OUT log.
4. Use the buttons in the on-page panel to queue bytes (`0x10`, `0x20`, `0x30`, `0x40`). BASIC sees `STATUS` on `0x52` flip to `READY` and reads bytes from `0x53`.

Use this as a starting point for custom protocols—swap port numbers if your project already claims these addresses.
