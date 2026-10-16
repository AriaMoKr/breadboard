# Breadboard 8-bit

An interactive browser simulator that follows Ben Eater's YouTube playlist
[**Building an 8-bit breadboard computer!**](https://www.youtube.com/playlist?list=PLowKtXNTBypGqImE405J2565dvjafglHU)
video by video.

* **The finished computer** (`#/`): the SAP-1-style machine as it stands at the end of
  the series. It has 16 bytes of RAM, A/B registers, an adder/subtractor ALU with carry
  and zero flags, a microcoded control unit and a decimal display. You can pulse the
  clock by hand or let it run, and watch every control signal and bus transfer. It
  also has an assembler with Ben's programs, a live microcode table you can edit, and a
  microcode-version picker that matches the stage of the series.
* **Breadboard view** (`#/breadboard`): the same computer laid out as Ben's BB830 boards. It
  has 49 chips with his reference designators, 88 LEDs, the decimal display and every wire. The
  running simulation lights the LEDs, and the clock button, mode switches, DIP switches and reset
  work on the boards themselves. The boards are also real circuits: composed together and
  simulated chip by chip, they run Ben's 28 + 14 program and latch 42 (see
  `tests/boards-output-control.test.ts`).
* **Breadboard sandbox** (`#/sandbox`): an empty breadboard with Ben's parts bin (every 74LS chip
  in the build, the 28C16, the 555, LEDs, resistors, buttons, switches, DIP switches, 7-segment
  displays). Wire up your own circuits and the chip-level engine simulates them. It comes with
  five example circuits. See [docs/BREADBOARD.md](docs/BREADBOARD.md).
* **Chapter labs** (`#/lab/<id>`): each of the 44 videos maps to an interactive lab
  that rebuilds what that video builds. Examples: the 555 timer modes, SR/D latches,
  flip-flops, JK racing, tri-state buses, registers, two's complement, the ALU, RAM,
  counters, 7-segment and EEPROM decoders, the Arduino EEPROM programmer, the
  multiplexed decimal display, the control logic, microcode, flags and conditional jumps.

## Running

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. Other scripts: `npm test` (vitest), `npm run typecheck`,
`npm run build` (static site in `dist/`, see [Deploying](#deploying)).

Keyboard on the computer page: **Space** = clock pulse, **I** = step one
instruction, **R** = run/stop, **Backspace** = reset.

## Deploying

`npm run build` writes a static site to `dist/`: `index.html`, one JS and one CSS file, and
`breadboard-8bit.zip`, the same site as a download (made by `scripts/zip-dist.mjs`). Copy `dist/`
to any static host, at the root or in a sub-folder. Pages use `#/…` URLs, so the host needs no
rewrite rules. The sidebar offers the zip ("Download for offline use") wherever it sits next to
`index.html`, so not on the dev server or in a copy.

The app is built as a single JS file on purpose, so a plain mirror gets all of it:

```bash
wget --mirror --no-parent --page-requisites https://example.com/breadboard/
```

Or download the zip:

```bash
curl -LO https://example.com/breadboard/breadboard-8bit.zip
```

Either copy has to be served over HTTP, because browsers don't run module scripts from
`file://`. In the folder with `index.html`:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/.

## How it's built

| Layer | Path | Notes |
| --- | --- | --- |
| Computer model | `src/sim/` | Control-signal-level, cycle-exact model. Registers latch on the rising edge from pre-edge bus values. The step counter advances on the falling edge (74LS161 on ~CLK) and resets at T5. HLT gates the clock. Undriven bus lines read 0 (10 kΩ pull-downs). IO drives only the operand nibble. Flags latch only on FI. Reset clears A, B, IR, MAR, flags, PC, OUT and the step counter. |
| Microcode | `src/sim/microcode.ts` | Verbatim from Ben's `microcode-eeprom-with-flags.ino`, with the same EEPROM address layout (`ZF CF │ byte-sel │ opcode │ step`) and four historical versions (control logic part 3 → Arduino → more instructions → flags). |
| Display | `src/sim/display.ts` | The `multiplexed-display.ino` EEPROM image: unsigned and two's complement, no leading-zero blanking. |
| Gate-level engine | `src/logic/circuit.ts` | Event-driven with unit gate delays, 0/1/Z/X levels, tri-state buffers and RC edge detectors, so latches, races and contention behave as in the videos. |
| UI | `src/ui/` | Framework-free widgets (LEDs, DIP switches, 7-segment, scope), live SVG schematics, the breadboard view of the computer. |
| Labs | `src/labs/**.lab.ts` | One file per lab, discovered automatically. See [docs/LABS.md](docs/LABS.md). |

Research notes with sources, used for fidelity:
[docs/research/computer-spec.md](docs/research/computer-spec.md) (exact behaviour of the
final machine) and [docs/research/videos.md](docs/research/videos.md) (per-video content).

## Credits

Ben Eater designed the computer, its microcode and the display code. See
[eater.net/8bit](https://eater.net/8bit) and
[beneater/eeprom-programmer](https://github.com/beneater/eeprom-programmer) (MIT).
This project is an independent, unofficial learning companion; watch the videos!
