# IO Port JS Bridge

## Overview

This document describes a mechanism to connect JavaScript code and MSX-side code inside **WebMSX** using **I/O ports**.

By routing communication through MSX-style I/O port access, programs running inside WebMSX can interact with the outside world via JavaScript. This approach intentionally avoids embedding web-specific logic directly into the emulator core or MSX programs.

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
