# Breadboards

Two features share one breadboard model:

* **Breadboard view** (`#/breadboard`, `src/app/breadboard-page.ts`): the finished computer drawn
  as Ben's boards, driven live by the control-signal simulator (`src/sim`). LEDs, 7-segment
  digits and front-panel controls are bound to it.
* **Breadboard sandbox** (`#/sandbox`, `src/app/sandbox-page.ts`): place parts and wires yourself.
  The chip-level engine (`src/breadboard/sim`) simulates what you build.

The module boards of the view are also real chip-level circuits. The engine can simulate a board
on its own by driving its ports, which is how the boards are verified.

## Files

| File | What |
| --- | --- |
| `src/breadboard/geometry.ts` | BB830 geometry: holes `a1..j63`, rails `tn/tp/bp/bn` + column (only `RAIL_COLUMNS` exist), strips, DIP pin positions, board placement |
| `src/breadboard/catalog.ts` | Chip pinouts (`CHIPS`), datasheet pin names; `~` prefix = active low |
| `src/breadboard/layout.ts` | `Layout` data, part kinds, `validateLayout`, `LayoutBuilder`/`BoardBuilder`, live bindings, `ModuleBoardDef` |
| `src/breadboard/nets.ts` | Static connectivity (`buildNets`, `pinNet`, `unpoweredChips`) |
| `src/breadboard/render.ts` | SVG renderer `LayoutView` (+ `breadboard.css`) |
| `src/breadboard/viewer.ts` | `PanZoom` viewport |
| `src/breadboard/boards/*.board.ts` | One module of the computer each, default-export `ModuleBoardDef` (auto-registered) |
| `src/breadboard/computer-layout.ts` | Where each module sits in the full scene (`MODULE_SLOTS`) |
| `src/breadboard/sim/types.ts` | Engine interfaces (`ChipModel`, `BoardSimulator`) |
| `src/breadboard/sim/chips.ts` | `CHIP_MODELS`: logic behaviour of every catalog chip |
| `src/breadboard/sim/engine.ts` | `BreadboardSim`: layout → `Circuit`, passives, switches, ports |

## Geometry (pitch units, 1 = 0.1")

A board is 65 × 18. Columns 1–63 run left to right. Rows a–e (top half) and f–j (bottom half) of
one column are each one strip. Rails: `tn` (top, GND, blue), `tp` (top, +5 V, red), `bp` (bottom,
+5 V), `bn` (bottom, GND). Rail holes only exist in groups of five: columns 3–7, 9–13, …, 57–61
(no rail hole at 8, 14, 20, 26, 32, 38, 44, 50, 56, 62). **Every board's `tp`/`bp` are +5 V and
`tn`/`bn` are GND**, as on Ben's computer, where all boards share power. The exception is
`b.board(id, place, title, { rails: 'signal' })`: its four rails are ordinary nets. The bus uses
this: boards turned 90° (`rotate: 90`, column 1 at the top), whose rails become long vertical
lines. Signal-rail stripes are drawn dashed orange.

A 0.3" DIP straddles the channel with pin 1 in row **f** at column `col` (notch left).
Pins 1..n/2 run left to right in row f, and the rest come back right to left in row e. A 0.6"
DIP (28C16) uses rows **h** (pins 1..12) and **d**. `rotated: true` turns a chip 180°.
A 7-segment display (`seg7`) is a 10-pin 0.6" part.

## Building a module board

See `src/breadboard/boards/a-register.board.ts` (the reference) and its tests in
`tests/breadboard.test.ts` and `tests/boards-datapath.test.ts`.

```ts
const b = new LayoutBuilder();
const bb = b.board('a', { x: 0, y: 0 }, 'A register');     // more boards: b.board('ram2', { y: ROW }) …
const U8 = bb.chip('U8', '74LS173', 4);                       // pin 1 at f4, notch left
bb.toVcc(U8.pin('VCC')); bb.toGnd(U8.pin('GND'));             // red/black wires to the rails
bb.wire(U8.free('~G1'), U8.free('~G2'), 'white');             // free(): next empty hole in that pin's strip
bb.wireLane(fromHole, toHole, 11.0, 'yellow');                // long runs on their own lane (board-local y)
bb.port('BUS7', 'a22', 'top');                                // off-board net, joined by name
bb.led('D1', 'red', anodeHole, cathodeRailHole, 'A7').live((c) => (c.a >> 7 & 1) === 1);
export default b.module({ id: 'a-register', title: 'A register', description: '…', videos: [11, 12, 13] });
```

`LayoutBuilder` throws when two legs land in one hole or a hole doesn't exist. Use the Ben
schematic reference designators as part ids (U8, D1, SW2, R58, C7 …) wherever the research notes
give them, and follow the netlist's bit order (Ben wires bit 7 to the lowest-numbered pin of each
173/245).

### Tidiness rules

These are enforced by the "layout tidiness" checks in `tests/boards-datapath.test.ts`; copy them
for new boards.

* No wire passes under a chip, display or LED body, or over another part's leg.
* No two wires lie on top of each other. Give each long run its own lane **between** hole rows
  (e.g. 11.0, 12.0), and enter a strip from the hole right next to the lane.
* Port tags sit on the outer rows (a or j) and point off the board, not across it.
* Power wires go to a rail column that exists. Columns 8, 14, 20 … have no rail holes, so pick
  the neighbouring column on the clear side.

### Port names (the contract between boards)

Ports with the same name are one net. Use exactly these names:

* **Shared:** `BUS0`–`BUS7`, `CLK`, `~CLK` (inverted clock, clocks the step counter), `CLR`
  (active-high reset, to 74LS173 MR pins), `~CLR` (active-low reset: PC, output register, step counter).
* **Control lines**, named as the module receives them. They are active low after the
  control board's 74LS04s: `HLT`, `~MI`, `RI`, `~RO`, `~IO`, `~II`, `~AI`, `~AO`, `~EO`, `SU`,
  `~BI`, `OI`, `CE`, `~CO`, `~J`, `~FI`.
* **Between modules:** `A0`–`A7` (A register → ALU), `B0`–`B7` (B register → ALU), `SUM0`–`SUM7`
  (ALU sum → flags zero detector), `CARRY` (ALU C4 → flags), `CF`, `ZF` (flags → control
  EEPROM A8/A9), `IR4`–`IR7` (opcode → control EEPROM A3–A6), `RA0`–`RA3` (RAM address
  from the MAR board's 74LS157 → RAM chips), `PROG` (program/run switch line, high = run).

Port tags may point `top`, `bottom`, `left` or `right`. Prefer the board edge facing where the
signal goes.

### Visual conventions

* Wire colours: **red** +5 V, **black** GND, **blue** bus/data in, **yellow** data between chips,
  **white/green/orange/purple** control and clock. Route long parallel runs with `wireLane`, one
  lane each (lanes 0.5 apart), so they don't lie on top of each other.
* LED colours follow Ben's: bus, A, B, ALU and RAM red; MAR yellow; PC green; IR blue (opcode) +
  yellow (operand); control word blue; T0–T4 green + step binary red; flags green; clock blue;
  program/run red/green.
* Keep each board's parts within one BB830. Use more boards for big modules (RAM, control,
  output). Add a `title` to each board.

### Live bindings (breadboard view)

`led(...).live((c, m) => boolean)` reads the `Computer` (`src/sim/computer.ts`): `a`, `b`, `ir`,
`mar`, `pc`, `out`, `step`, `flagC`, `flagZ`, `clk`, `ramAddress`, `ramValue`, `controlWord`,
`bus.value`, `alu.value`, `halted`, `programMode` ….
`seg7(id, col, 'cathode', (c) => byte)` gives the segment byte for a digit; see
`displaySegments` in `src/sim/display.ts`.
Controls go through `button(id, a, b, { kind: 'button', press: (m) => …, release })`,
`slide(…, { kind: 'slide', get, set })`, `dip(…, { kind: 'dip', get, set })` and
`pot(…, { kind: 'pot', get, set })`. They act on the `Machine` (`src/sim/machine.ts`):
`m.halfPulse()`, `m.start()`, `m.setMode('manual')`, `m.setHz()`, `m.reset()`,
`m.computer.programMode`, `.dipAddress`, `.dipData`, `.programWrite()`, `.signedDisplay`.
Ben's DIP switches pull a line to GND, so an ON switch reads 0. Keep that polarity in the live
binding too (bit = switch OFF).

## Verifying a board

1. **Static** (`tests/boards-*.test.ts`): `validateLayout(layout)` is empty, `unpoweredChips` is
   empty, nets aren't shorted. Every chip pin that matters is on the right net (`pinNet(layout,
   nets, 'U9', 'D0') === 'port:BUS0'`). Every LED has a live binding.
2. **Dynamic** (once `src/breadboard/sim/engine.ts` exists): `new BreadboardSim(layout)` drives
   the board's ports (`setPort('~AI', 0)`, `setPort('BUS3', 1)`, pulse `CLK`). Check the outputs
   and LEDs with `ledLit`, `portLevel` and `seg7`.
