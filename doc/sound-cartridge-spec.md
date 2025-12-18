# Sound ROM Cartridge Specification (Draft)

## Overview

This document proposes a **Sound ROM Cartridge** for MSX systems that provides rich audio playback (BGM / SE) using external compressed audio files such as MP3 or WAV.

The cartridge is controlled via **MSX I/O ports** and is designed to work both:
- in emulators (e.g. WebMSX with an I/O bridge), and
- potentially on real MSX hardware.

The goal is to extend MSX audio capabilities without modifying the MSX OS or relying on network features.

---

## Design Goals

- Provide high-quality streamed audio (BGM-focused)
- Keep MSX-side code simple and portable
- Use MSX-style I/O port control
- Mix external audio with native MSX sound output
- Allow future emulator and real-hardware compatibility

---

## Hardware Components

### Audio Decoder

- One of the following:
  - Dedicated **MP3 decoder IC**
  - MCU with built-in or software-based MP3/WAV decoding
- Supported formats (minimum):
  - MP3
  - WAV (PCM)
- Optional future support:
  - OGG
  - ADPCM variants

---

### Storage

- On-cartridge storage, such as:
  - Flash memory
  - microSD card
- Stores audio assets:
  - BGM tracks
  - Sound effects
- File system:
  - Simple flat file structure
  - Index-based lookup preferred (ID → file)

---

### Audio Output

- Decoded audio is mixed with MSX sound output
- Mixing method:
  - SCC-style analog mixing
  - External DAC + analog mixer
- Output fed into MSX audio path

---

## Control Interface

### I/O Port Access

- MSX controls the cartridge via I/O ports
- Typical commands:
  - Play
  - Stop
  - Pause
  - Loop enable / disable
  - Volume control
  - Fade in / fade out
- Commands reference audio by ID, not filename

---

### Playback Channels

- **BGM Channel**
  - Long, looped tracks
  - Fade and loop control recommended
- **SE Channel (optional)**
  - Short one-shot sounds
  - Can be omitted to simplify hardware
  - MSX PSG may be used instead for SE

Minimum viable design may focus on **BGM only**.

---

## Playback Features

- Loop control
  - Infinite loop
  - Loop count
- Fade control
  - Fade-in
  - Fade-out
  - Adjustable duration
- Independent control of:
  - BGM playback state
  - Volume

---

## Intended Use Cases

- Rich background music on MSX1-class systems
- Game soundtracks exceeding PSG/SCC limitations
- Emulator-to-hardware compatible audio behavior
- Hybrid sound setups:
  - PSG for effects
  - Cartridge for background music

---

## Emulator Compatibility

- In emulators:
  - I/O port commands are intercepted
  - Audio playback handled by host (e.g. JavaScript)
- MSX software remains unchanged
- Same I/O protocol can be reused for hardware implementation

---

## Design Philosophy

- Treat the cartridge as an **external sound device**
- Avoid embedding web or host-specific logic into MSX software
- Preserve the possibility of real hardware realization
- Favor simplicity and forward compatibility over complexity

---

## Summary

This Sound ROM Cartridge extends MSX audio capabilities by offloading audio decoding and storage to dedicated hardware, controlled entirely through I/O ports.  
The design prioritizes clean separation between MSX logic and external functionality, enabling both emulator-based and real-hardware implementations.
