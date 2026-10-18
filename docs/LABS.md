# Writing a chapter lab

Each video in the playlist maps to a **lab** (`src/app/chapters.ts` → `lab` id).
A lab is one file `src/labs/<group>/<lab-id>.lab.ts` that default-exports
`defineLab({ id, title, summary, mount })`. Labs are discovered
automatically: never edit a shared file to register a lab. The app loads each
`*.lab.ts` on demand through `import.meta.glob`, keyed by file name (`src/app/lab-loader.ts`),
so the file name must be exactly `<lab-id>.lab.ts`; `src/labs/registry.ts` is
the eager map that tests use (a test checks that names and ids agree).

Ben's videos outside the playlist are in `MORE_GROUPS` (also in `chapters.ts`). A video there gets a
lab through its own `lab` field: the digital clock labs in `src/labs/dclock/` are wired up like that.
Such labs are in `MORE_LAB_IDS`, and every lab is in `ALL_LAB_IDS`. The sidebar lists them under the
group's title, and their prev/next links stay within the series.

(Vitest's on-disk module cache would keep the registry's old file list when a lab file is added, so
`vite.config.ts` turns it off with `fsModuleCache: false`.)

```ts
import { defineLab } from '../types';
export default defineLab({
  id: 'd-latch',              // must match chapters.ts
  title: 'D latch',
  summary: 'One paragraph, plain language, what the video teaches and what to try.',
  mount(root) {
    const d = new Disposer();
    // build DOM into root, start loops via d.add(animate(...)), listeners via d.listen(...)
    return d.dispose;          // stop every loop/listener here
  },
});
```

The app renders the page header (title, summary, video cards with “Watch
here” / YouTube links) and prev/next navigation. `mount` only builds the lab
body.

## Building blocks

| Need | Use |
| --- | --- |
| DOM | `h(tag, props, ...children)`, `s(svgTag, attrs)`, `setText`, `setClass`, `animate(cb)`, `Disposer` — `src/ui/dom.ts` |
| Widgets | `Led`, `LedBar` (`setLevels(levels, readout?)` for floating/contended lines), `Toggle`, `Button` (`onPress`/`onRelease` for momentary), `DipSwitch`, `Slider` (supports `log`), `select` (returns the `<label>` with `selectEl`, `getValue()`, `setValue(v)`), `SevenSegment` (`set(byte, brightness?)`, brightness 0..1 for all or per segment a..g,dp), `Scope` (digital + analog lanes; `draw(samples, { window, cursor, markers })`), `panel`, `row`, `note`, `readouts` — `src/ui/components.ts` |
| Gate-level logic | `Circuit` (event-driven, unit gate delays, 0/1/Z/X, tri-state, `edgeDetector`, custom components with state via `add({evaluate})`), `Trace` — `src/logic/circuit.ts` |
| Live gate drawings | `Schematic` (gates, chips with pins, wires coloured by net level, clickable switches, LED probes) — `src/ui/schematic.ts`. See "Schematic extras" below. |
| Whole computer | `Machine` (`src/sim/machine.ts`) wraps `Computer` (`src/sim/computer.ts`); `ComputerView` (`src/ui/computer-view.ts`, options: `modules` (subset of modules for earlier chapters), `manualControl` (16 control switches instead of the control logic, shown in the 'control' slot), `manualSignals` (only these switches; works without 'control' in `modules`), `busInput` (8 switches that drive the bus like Ben's test jumpers), `highlight`; methods `setHighlight(modules)`, `moduleEl(m)`); `mountComputerWorkbench(root, opts)` (`src/app/computer-page.ts`) adds toolbar + program/microcode/output tabs and returns `{ machine, dispose, view, programPanel, microcodePanel, showTab }` |
| Microcode | `buildMicrocode`, `MICROCODE_VERSIONS` (`control-logic` v38, `arduino` v40 (+SUB), `more-instructions` v41, `flags` v44), `microcodeEepromImage`, `Machine.editMicrocode` — `src/sim/microcode.ts`; `MicrocodePanel` (`editable`, `highlightOpcodes`; `setHighlight(opcodes)`, `rowEl(op)`) |
| Programs | `assemble`, `disassemble` — `src/sim/assembler.ts` (also Ben's on-screen binary notation: `1110: 0001 1100`, `LDA 1110`); `PROGRAMS` / `PROGRAM_BY_ID` — `src/sim/programs.ts`; `ProgramPanel.setSource(src)`, `selectProgram(id)` (the panel also follows any `machine.loadSource()` call) |
| 7-segment / display EEPROM | `HEX_DIGITS`, `DEC_DIGITS`, `displayEepromImage`, `displaySegments` — `src/sim/display.ts` |

### The Computer model in one paragraph

Rising edge: every register with its "in" signal set latches the pre-edge
bus; the PC loads (J, wins) or counts (CE); flags latch the pre-edge ALU carry
and zero on FI. RAM is written by the ~10 µs RC pulse *after* the edge, so it
stores the settled bus at the settled MAR address (same thing for Ben's
microcode; with a hand-set MI|RI the byte lands at the new address, and with
RO|RI it stores 0 because the 74189 outputs float while writing). Falling
edge: the step counter advances (T0..T4, then 0). HLT holds the clock low.
Reset clears A, B, IR, MAR, PC, OUT, flags and the step counter, not RAM.
The bus has the video-34 pull-downs by default; `new Computer({ pullDowns:
false })` (or `computer.pullDowns = false`) makes undriven lines float high,
so an idle bus reads 0xFF and the PC (which only drives BUS 0-3) shows 1111
on the high nibble. `bus` reports `drivers`, `contention`, `driven` and
`floating` bit masks; `busInputMask` limits which lines `busInput` drives.

Observers (no need to wrap `halfCycle`): `computer.onRisingEdge(e => …)` gives
`e.pre` (step, IR, PC, MAR, A, B, flags, control word, microcode word, bus,
ALU, RAM address/value before the edge) and `e.transfers`;
`onFallingEdge(e => …)` gives the step change; `onReset(cb)`. `Machine` has
the same three as pass-throughs, plus `lastSource` / `sourceVersion` for the
last `loadSource()`.

### Schematic extras

* `new Schematic(circuit, { width, height, x0, y0 })` — viewBox origin, e.g. `x0: -20` for switch labels left of 0.
* `gate(kind, at, { flip: true })` points the gate left (inputs to the right of `at`, output 50 to the left).
* `chip(at, { left: [{ name: '1D', pin: 14, net }] })` — `pin` draws the physical pin number outside the body. Pin stubs with a `net` are coloured by its level.
* `probe(net, at, { r: 5 })` — smaller LEDs for closely spaced lines.
* `box(at, { width, height }, { dashed, fill, label })` — package outlines / gate groups under everything; `layer('back' | 'bus' | 'wires' | 'parts' | 'top')` and `add(el, layer)` for any other custom SVG.
* `bus(points, { label: [x, y] })` — a thick multi-bit bus line; `handle.set('active' | 'idle' | 'floating' | 'contention' | 'off', '42')`.
* The function returned by `autoUpdate()` also cancels a frame that is still queued.
* Stacks of `switch()`es closer than about 36 apart are hard to hit with a finger. Space them (and
  the chip pins they feed) with `switchPitch(normal)`: `normal` with a mouse, 36 on touch screens.
  Then size the chip (`height`) and the schematic from it, as `ram-intro` and `eeprom` do.

Reference labs to copy from:
* `src/labs/latches/sr-latch.lab.ts`: gate level. It has a Circuit, a Schematic, a Trace and Scope timing diagram, a truth table, and slow motion.
* `src/labs/intro/overview.lab.ts`: full computer via `mountComputerWorkbench`.

## CSS classes you can use

`lab-grid` (responsive grid of cards), `lab-grid two` (two wide columns),
`lab-stack` (vertical stack), `panel(...)` cards (accent: red/green/yellow/blue/orange/white/gray),
`row`, `note`, `callout` (highlighted explanation), `truth-table` (+ `tr.current`),
`kv` (key/value list), `mono`, `dim`, `small`, `legend`. Chip pin labels are
readable on the dark chip bodies in both colour schemes (no local fix needed).
Don't add global CSS
files. If a lab needs a little extra styling, set inline styles or inject a
`<style>` element scoped under a lab-specific class inside `root`, and remove
it in cleanup.

## Rules

* Faithful to the video. Use Ben's chips, component values and demos (see the research
  notes in the build prompt). Show the actual behaviour, including quirks such as
  switch bounce, JK racing, floating TTL inputs reading high, and the
  inverted 74LS189 outputs.
* Interactive first: switches, buttons and sliders that the learner drives, with live
  LEDs/wires/scope, plus a short `callout` that explains what is happening now.
* Everything must work at 375 px width (no horizontal page scroll; the
  schematic SVGs scale down) and in light and dark colour schemes (use CSS
  variables like `var(--fg)`, `var(--panel)`, never hard-coded white or black text).
* Keep each lab self-contained in its own file(s) under its group directory.
  Shared helpers for one group go in `src/labs/<group>/_shared.ts` (no
  `.lab.ts` suffix). Don't modify files outside your group without being told to.
* Pure logic (formulas, models, tables) goes in plain functions, tested in
  `tests/labs-<group>.test.ts` with vitest.
* Stop every `animate` loop and listener in the cleanup function.
* TypeScript strict mode; `npx tsc --noEmit` and `npx vitest run` must pass.
  `tests/computer.test.ts` also mounts every lab in a fake DOM, clicks every
  control and checks that no animation frame or window listener survives the
  cleanup function, and that the text never shows `NaN` or `undefined`.
