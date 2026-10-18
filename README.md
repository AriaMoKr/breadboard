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
  displays, and the 74LS85, 74LS90, 74LS92 and CD4511 from his digital clock). Wire up your own circuits and the chip-level engine simulates them. **Move** picks a
  part or a wire up and puts it elsewhere (click, then click a hole, or drag it), or just one end of
  a wire or a two-legged part when picked up by that end. **Step** (key S)
  pauses it and moves it on to the next change: a gate delay at a time while a change spreads
  through the gates, or on to the 555's next edge when nothing else is coming. It comes with
  seven example circuits, two of them from the digital clock (its ÷60 divider and its seconds), and **Share link** puts your circuit in a link (`#/sandbox/c1.…`) that
  opens it in anyone's sandbox. **View in VR** shows it in the VR view. See
  [docs/BREADBOARD.md](docs/BREADBOARD.md).
* **VR view** (`vr.html`): the breadboard computer in 3D on a table, run live by the simulator,
  with a control panel behind it (Run/Stop, Pulse, Step, Reset, speed, program). The switches,
  buttons and pot on the boards work too, as in the breadboard view: the clock's step button,
  manual/auto and speed pot, the address and data DIP switches, write, program/run, signed and
  reset. In a WebXR headset (Quest Browser, or Chrome/Edge with a PC headset) press **Enter VR**,
  point and pull the trigger (twist the controller to turn the pot); the grip buttons pick the
  computer up, and pulling both grips apart makes it bigger (up to 8x). On a screen, drag to look
  around, double-click to look closer, and click. It is built with three.js from the same layout
  as the breadboard view (`src/vr/`), at 1.5x real size. It also shows sandbox circuits:
  `vr.html#c1.…` (the code from a share link, or the sandbox's **View in VR**) or
  `vr.html#example/<id>`, run by the sandbox's chip-level engine. **Next ▸** on the panel goes
  through the computer and the seven examples.
  In VR the speed pot changes the speed evenly, tenfold per ~100° of twist (Ben's linear pot
  crowds 7–480 Hz into its first tenth). `vr.html?debug` logs to the console what the
  controllers do and, once a second, how evenly the frames come, to read from a headset over
  adb (`chrome://inspect`).
* **Chapter labs** (`#/lab/<id>`): each of the 44 videos maps to an interactive lab
  that rebuilds what that video builds. Examples: the 555 timer modes, SR/D latches,
  flip-flops, JK racing, tri-state buses, registers, two's complement, the ALU, RAM,
  counters, 7-segment and EEPROM decoders, the Arduino EEPROM programmer, the
  multiplexed decimal display, the control logic, microcode, flags and conditional jumps.
* **Digital clock labs** (`#/lab/mains-60hz` …): a lab for each part of Ben's breadboard clock
  series published so far. They cover:
  * the 5 V supply and squaring the 60 Hz from the mains with an LM339 and hysteresis;
  * the edge detector and ramp that make the square wave independent of the input;
  * dividing by 60 with the 74LS90 and 74LS92;
  * the seconds and minutes with CD4511 decoders;
  * setting the time through an XOR gate, with switch bounce and its debounce.

  The analog parts are small time-step models with Ben's component values (`src/labs/dclock/_analog.ts`).
  The counters are the sandbox's chip models.
* **More videos** (`#/more`): Ben's videos outside the playlist that go with it. These are his first
  build running programs and his introduction to transistors and logic gates (both from 2015 and
  linked from eater.net/8bit), plus his digital clock series (2026, eater.net/clock).

## Running

It needs Node 22.12 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. Other scripts: `npm test` (vitest), `npm run typecheck`,
`npm run build` (static site in `dist/`, see [Deploying](#deploying)), `npm run icons` (renders
the app icons from `public/icons/icon.svg`).

Vite stays on version 7 for now. Vite 8's bundler, Rolldown, has no native build for the
MinGW-built Node in MSYS2's UCRT64 shell, so Vite 8 doesn't start there.

`npm run check:browser` checks in headless Chrome what the unit tests can't see. It checks
that every page renders without errors, that phones get no sideways scrolling and controls of
at least 24 px, the sticky toolbar, parts drawer and tap-to-zoom, the shared computer, placing,
moving, deleting and stepping in the sandbox with real clicks, taps and drags, sandbox links, the
breadboard view's frame rate, and that the VR view builds the computer in 3D and runs it.
`npm run check:browser -- --dist`
checks the built site instead (run `npm run build` first), plus the download link, install and
offline use, and `-- --url <address>` checks a deployed copy the same way (such as
`https://example.com/breadboard/` after a deploy). It needs an installed Chrome, Edge or
Chromium (or `CHROME_PATH`).

`npm run check:input` takes a few minutes, so `verify` leaves it out: run it after changing
controls or layout. On every page, on a desktop with a mouse and on a phone with touch, it
clicks or taps controls the way a person does. Chrome then decides where each click goes, which
an event sent straight to the control skips. It checks that each control's own handler runs, so
nothing on top, no pointer captured elsewhere and no layout change between press and release
takes the click. It also checks that no control moves back and forth while the computer runs,
where a tap would land on whatever moved under the finger. `-- --page <text>` checks only the
pages whose route contains it, and `-- --url <address>` checks a deployed copy.

`npm run verify` runs the unit tests, the build and the browser checks on the built site, in that
order, stopping at the first failure. Run it before committing or pushing (it takes about two
minutes).

Keyboard on the computer page: **Space** = clock pulse, **I** = step one
instruction, **R** = run/stop, **Backspace** = reset.

## Deploying

`npm run build` writes a static site to `dist/`:
* `index.html` and `vr.html`, each with one JS and one CSS file. These are two builds, so the
  app doesn't carry three.js;
* the app manifest, icons and `sw.js` (a service worker, made by `scripts/sw-dist.mjs`);
* `breadboard-8bit.zip`, the same site as a download (made by `scripts/zip-dist.mjs`). It is
  reproducible: its files are dated with the last commit (or `SOURCE_DATE_EPOCH`), so the same
  site always makes the same zip.

Copy `dist/` to any static host, at the root or in a sub-folder. Pages use `#/…` URLs, so the
host needs no rewrite rules. A build rewrites every file, so with rsync compare by content
(`-c`), and leave out folder times (`-O`); then only what changed is listed and sent:

```bash
rsync -avcO --delete dist/ user@host:path/to/breadboard/
``` The sidebar offers the zip ("Download for offline use") wherever it
sits next to `index.html`, so not on the dev server or in a copy.

Served over HTTPS, the site is an installable app: "Install" in desktop Chrome or Edge, or "Add
to Home Screen" on a phone. After the first visit it works offline, the VR view too. The service
worker keeps the pages fresh while online, so a new build shows up on the next visit. WebXR (the
VR view's "Enter VR") also needs HTTPS.

Each page is built as a single JS file on purpose, so a plain mirror gets all of it (a link in
`index.html`'s `<noscript>` leads wget to `vr.html`):

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
final machine), [docs/research/videos.md](docs/research/videos.md) (per-video content) and
[docs/research/clock.md](docs/research/clock.md) (the digital clock series).

## Credits

Ben Eater designed the computer, its microcode and the display code. See
[eater.net/8bit](https://eater.net/8bit) and
[beneater/eeprom-programmer](https://github.com/beneater/eeprom-programmer) (MIT).
This project is an independent, unofficial learning companion; watch the videos!
