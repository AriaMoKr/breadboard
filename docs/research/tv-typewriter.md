# Don Lancaster's TV Typewriter (research)

The TV Typewriter (TVT) put 16 lines of 32 characters on an unmodified TV set. It was one of the
first home-built computer terminals, from Radio-Electronics, September 1973. It is a breadboard-era
digital design like Ben's computer: mostly TTL counters and gates, with a few MOS memory and
character-generator chips. These notes list what archive.org has on it and what the simulator would
need to run it, as of 2026-10-27. The timing board is built from them: its chips are in the
catalog and the sandbox, and the first lab, the timing chain (`src/labs/tvt/`), runs it chip by
chip and draws on a TV ("What the simulation shows", below).

Labels: [R] read in the scan's OCR text (summarised here, not quoted). [D] read in a drawing: a
schematic, the waveform page or a datasheet's pin diagram. [N] part numbers counted in the OCR
text, not read in context. [I] inferred or recalled, not checked. [Lab] an idea for the simulator.

## Where to find it

- The construction story, free in Don Lancaster's own collection:
  - https://archive.org/details/donlancaster_tv_typewriter_9_73
  - the same text again: https://archive.org/details/donlancaster_bdtvtype
  - another scan of it: https://archive.org/details/donlancaster_tvt02

  [R] Its pages are numbered 2-12 with the magazine's name, and it has every schematic, the parts
  lists, the waveforms, and the foil patterns and parts placement for the boards. [I] So it looks
  like the full construction booklet the article offered, rather than the magazine's own pages
  (43-5+). It also has the parts list of the improved ASCII encoder from February 1974, so this
  copy would be a later printing.
- The magazine issue it first appeared in, lending-only: https://archive.org/details/radioelectronics44unse_7
- *TV Typewriter Cookbook* (Howard W. Sams, 1976), free in the same collection:
  https://archive.org/details/donlancaster_tvtcb. A lending copy is
  https://archive.org/details/tvtypewritercook0000lanc.
- A list of Lancaster's articles, with magazines, dates and pages:
  https://archive.org/details/donlancaster_tempmbib.
- [R] The Computer Museum's 1986 report lists the TVT-1 prototype as Lancaster's gift:
  https://archive.org/details/computermuseufal1986comp.

## The 1973 design

- [R] What it shows:
  - 512 characters, as 16 lines of 32. A second memory page makes 1024.
  - Upper-case ASCII: capitals, numerals and most punctuation.
  - Its own RF modulator clips onto a TV's antenna terminals (channels 2-5). There is also a
    direct video output.
- [R] Input:
  - Six ASCII bits in parallel (the full code also works), entered by grounding a "key pressed"
    line. The input is debounced on the board, and characters can come up to 30 a second.
  - Any CTRL key gives a combined carriage return and line feed.
  - The keyboard can be the homemade one from February 1973, or six switches and a pushbutton.
- [R] Editing:
  - A winking cursor shows where the next character goes. It can be blanked, or moved in any
    direction without changing the text.
  - The screen wraps at the end of each line, and at the bottom it goes back to the top and writes
    over the old text.
  - Switches for REPEAT, KEEP-CHANGE (memory protect), HOME or erase, page A or B, and a
    line-scan mode for calculator use.
- [R] Timing:
  - A 4.561920 MHz crystal gives the dot clock, which a TTL divider brings down to a 15.840 kHz
    line rate (a 63 µs line) and 60 Hz frames.
  - The display is not interlaced, but the timing chain is split so interlace can be added for
    video titling.
- [R] Construction:
  - A mainframe (mother board) carries the power supply, the RF modulator and the control
    switches. The timing board, the cursor board and one or two memory boards stack onto it.
  - 33 ICs, 8 of them MOS LSI.
  - Lancaster calls it no first project, but notes that once the early stages work, the TV itself
    helps with debugging.
- [R] Memory board:
  - Six 2524 512-bit recirculating MOS shift registers, one per bit, hold 512 six-bit characters.
    A 7406 hex driver and two 2N5139 transistors go with them.
  - Page A also carries the shared output section, which a page-B board borrows over the bus:
    - a 2518 hex 32-bit recirculating register, a one-line memory that gives each row of
      characters back for each of its TV scans;
    - a 2513 character generator;
    - a 74165 parallel-in, serial-out register that shifts the dots out as video;
    - a 7401 open-collector NAND.

  Lancaster calls this bus organisation, and only one source may be enabled on the bus at a time.
- [R] Timing board:
  - Parts: an MC4024 dual astable (the crystal oscillator), four 8288 divide-by-12 counters, a 7473,
    two 7432s, two 7402s and two 7410s.
  - Its "main" timing is the divider chain's continuous outputs. Its "derived" timing combines them
    into composite sync and a blinker for the cursor wink, flashing and repeat.
- [R] Cursor board:
  - Parts: a 7408, two 74197 divide-by-16 counters (a 74177, 8281 or 8291 will also do), a 7473, two
    7402s, a 7474, a 7400 and a 555.
  - It keeps the next character position, winks the cursor and controls character entry. It also
    holds the input conditioner, the debouncer and the CTRL detector.
- [R] Figures: 2, the character generator; 3, the mainframe and power supply; 4, a page A or page B
  memory; 5, page A's character generator circuitry; 6, the main timing chain; 7, the derived
  timing; 8, the cursor's input conditioning; 9, the cursor board's position counter. There is
  also a page of key waveforms, and the full-size foil patterns and parts placement (12-15 and on).

## The schematics, transcribed

From the booklet's PDF, tv_typewriter_9_73.pdf in
https://archive.org/details/donlancaster_tv_typewriter_9_73 (24 pages, 5.0 MB), read at 300 dpi.
Numbers in brackets, like (47), are pins of the 60-pin stack connector that joins the boards; other
pin numbers are the chip's own. ~X is X inverted. The timing board's test points are lettered A
to U, fastest first, and these notes use Lancaster's letters. The cursor board has its own test
points A to H, which are not the same signals.

| PDF page | What's on it |
|---|---|
| 4 | Fig. 2, the character generator: the same circuit as Fig. 5 (compared at a glance only) |
| 13 | Table III, the stack connector's pins |
| 14 | Fig. 3 mainframe, Fig. 4 memory board, Fig. 5 page A's character generator |
| 15 | Fig. 6 main timing chain, Fig. 7 derived timing, Fig. 8 cursor input |
| 16 | Fig. 9 cursor position counter, and the key waveforms |
| 17 | the improved ASCII encoder (not transcribed) |
| 18-22 | foil patterns and parts placement, Figs. 10-17 |
| 23 | notes |
| 24 | Lancaster's 14 corrections |

### The stack connector (Table III)

[R] Every board plugs into the same 60 pins, so the boards stack in any order and the one being
tested goes on top. The names below are Table III's, with what the figures add.

| Pins | Signal |
|---|---|
| 1, 60 | ground |
| 2-8 | keyboard inputs A7 to A1 (pin 8 is A1) |
| 9-14 | memory outputs B1 to B6 |
| 15, 16 | memory clock drives: 15 makes φ2 and 16 makes φ1 on the memory board (Fig. 4, correction 12) |
| 17 | line 1 transfer: low on lines 1, 13, 25 and so on |
| 18 | line register clock |
| 19 | self test |
| 20 | video out |
| 21 | blank: high on lines 9-12, 21-24 and so on |
| 22 | key pressed |
| 23 | blinker ("winker" in Table III) |
| 24, 25 | clear (+5 V while clearing) and not-clear (ground while clearing) |
| 26 | the P clock, called carriage return clock in Fig. 6 (see Open points) |
| 27, 30 | right-left control |
| 28 | cursor on |
| 29 | line direction (see Open points) |
| 31, 33 | protect A, protect B |
| 32 | calculator control |
| 34, 35 | enable A, enable B (Fig. 3 swaps them; see Open points) |
| 36, 37 | line/frame scan select, line scan clock |
| 38 | sync in |
| 43 | flash display |
| 45 | output load |
| 47 | video clock |
| 48, 49, 50 | L4, L2 and L1 line commands |
| 51 | update |
| 52 | CTRL output |
| 53 | horizontal out |
| 54 | interlace reset |
| 55 | vertical out |
| 56, 57 | −12 V, −5 V |
| 58, 59 | +5 V |
| 39-42, 44, 46 | spare |

[R] As far as the OCR shows, Table III marks 32, 36, 37, 43, 53 and 54 as optional, not used in the
basic typewriter. Its columns showing which board drives or uses each pin did not survive the OCR.

### Timing board: the main chain (Fig. 6)

[D] Each 8288 holds a ÷2 (clock 1, pin 8, to output A, pin 5) and a separate ÷6 (clock 2, pin 6, to
output B, pin 9, which drives a ÷3 with outputs C, pin 2, and D, pin 12). In the ÷3, C is high on
the second count and D on the third, a third of the time each. Data inputs, load and reset go to
+5 V unless noted.

- IC1 MC4024 dual astable:
  - Oscillator 1 runs on the 4.561920 MHz crystal across pins 3 and 4. Its output, pin 6, is A,
    the VIDEO CLOCK (47): the dot clock.
  - Oscillator 2 has C9, 33 µF, across pins 10 and 11. Its output, pin 8, is U, the BLINKER (23),
    about 4 Hz, for the cursor's wink, flashing and repeat.
  - Pins 1, 13 and 14 go to +5 V; 5, 7 and 9 to ground. Both FREQ inputs, 2 and 12, are grounded
    too.
  - [R] For video titling, a capacitor can replace the crystal, and pin 2, lifted from ground, then
    takes a +3 to +5 V control voltage, so a phase-locked loop can hold the TVT to outside video.
- The dividers, in order. The last column is the waveform page's count per line or per frame.

  | Stage | Clocked by | Gives | Frequency | Count |
  |---|---|---|---|---|
  | IC2 ÷2 (CL2 to B) | A | B | 2280.96 kHz | |
  | IC2 ÷3 | B | C and D | 760.32 kHz, the character rate | |
  | IC2 ÷2 (CL1 to A) | C | E | 380.16 kHz | 24 a line |
  | IC3 ÷2 | E | F | 190.08 kHz | 12 a line |
  | IC4 7473, first half | F | G (pin 13) and ~G (pin 12) | 95.04 kHz | 6 a line |
  | IC3 ÷2 | G | H | 47.52 kHz | 3 a line |
  | IC3 ÷3 | H | I and J; J is HORIZ OUT (53) | 15.84 kHz, the line rate | 1 a line |
  | IC4, second half | J | K, from ~Q2 (pin 8): L1 (50) | 7920 Hz | 132 a frame |
  | IC5 ÷2 | K | L: L2 (49) | 3960 Hz | 66 a frame |
  | IC5 ÷3 | L | M: L4 (48); and N | 1320 Hz, the character-row rate | 22 a frame |
  | IC5 ÷2 | N | O | 660 Hz | 11 a frame |
  | IC6, cut to ÷11 | O | P, Q, R and S; S is V OUT (55) | S at 60 Hz | |

- [D] IC6's outputs: A is P, the CARRIAGE RETURN CLOCK (26), which also clocks its ÷6. B is Q, C
  is R and D is S. Its reset (13) comes from T (Fig. 7), which cuts its count from 12 to 11.
  [R] IC5's ÷2 and IC6 together divide the 1320 Hz row rate by 22, and 16 of the 22 rows hold
  text; the rest cover retrace and overscan.
- [D] IC4's first half has J1 (14) open, and K1 (3) and ~CLR1 (2) at +5 V, so it toggles. Its
  second half has J2 (7) and K2 (10) open, and ~CLR2 (6) pulled up by R1, 330 Ω, and brought out as
  INTERLACE RESET (54). Q2 (9) is unused. The drawing labels pin 10 "K1"; it is K2.
- [D] IC5's and IC6's load pins (1) go to the interlace reset line. [R] Grounding INTERLACE RESET
  sets the vertical chain to its highest count, and on release the next whole line starts a new
  frame.
- [I] The scan line within a character row is L1 + 2·L2 + 4·L4 + 8·N, 0 to 11. L1, L2 and L4
  address the character generator's rows. N is high on lines 9-12 (counting from 1), which are
  blanked between rows.
- [D] The drawing prints 3640 Hz for L4. The chain gives 1320 Hz.
- [D] The waveform page says the B clock makes 96 vertical lines. B has 144 cycles in a whole line,
  but 96 in the 32 shown characters (192 dots), so the count is for the visible part [I].

### Timing board: derived timing (Fig. 7)

[D] Lancaster draws most gates as negative-logic ANDs: a 7432 drawn this way is low only when all
its inputs are low. Written here as positive logic:

- IC7 7432:
  - 9-12 BLANK (21) = N + S (pins 12, 13 to 11): high on the blanked lines of each row, and all
    through the vertical interval.
  - LINE 1 TRANSFER (17) = K + L + M + N, from three gates (9, 10 to 8; 4, 5 to 6; then 1, 2 to 3).
    [R] It is low only on line 1 of each row (lines 1, 13, 25 and so on), when the line register
    reloads from memory.
- IC8 7432:
  - LINE CLOCK (18) = J + D (pins 1, 2 to 3). It goes low in part of each of the 32 shown character
    times, so 32 pulses a line. [R] The OCR text says J and O; the drawing has D, and only D gives
    the 32 pulses.
  - S + J (pins 12, 13 to 11), to IC12.
- IC12 7402:
  - X (pin 13) = NOR(LINE 1 TRANSFER, S + J) (pins 11, 12): high in the 32 shown character times of
    line 1 of each text row. "X" is this note's name, not Lancaster's.
  - ~H (pin 10) = NOR(H, ground) (pins 8, 9).
  - NOR(P, Q) (pins 5, 6 to 4), for the vertical sync jumper. Pins 1-3 are unused.
- IC9 7402, an RS latch with two edge detectors:
  - NOR(C, D) (pins 8, 9 to 10), high on the ÷3's first count. It goes to IC10 pin 5, and through
    C5, 160 pF, with R2, 220 Ω, to ground, to pin 2.
  - LINE CLOCK through C6, 160 pF, with R3, 220 Ω, to ground, to pin 5.
  - Gates 1 (pins 1-3) and 2 (pins 4-6) are cross-coupled (1 to 6, 4 to 3). Pin 1 is OUTPUT LOAD
    (45). Gate 4 (pins 11-13) is unused.
  - [R] This waits after each line-register clock until the character generator has settled, then
    loads the output register.
- IC10 7410:
  - T (pin 8) = NAND(R, P, S) (pins 11, 10, 9), to IC6's reset. See Open points: as drawn, it can
    never go low.
  - Stack 16 (pin 12) = NAND(C, B, X) (pins 13, 2, 1).
  - Stack 15 (pin 6) = NAND(B, X, NOR(C, D)) (pins 3, 4, 5).
  - [I] So in each character time while X is high, stack 15 goes low for one dot in the ÷3's first
    count and stack 16 for one dot in its second. That makes 32 pairs on line 1 of each of the 16
    text rows, 512 a frame: one full turn of the 512-bit memory each frame.
  - [D] The scan has φ2 written by hand at stack 16 and φ1 at stack 15, the opposite of Fig. 4.
    Correction 12 says the pins are wired right and only the φ names in Fig. 7 and Table III are
    swapped, so Fig. 4's names stand [I].
- IC11 7410, sync:
  - ~HS (pin 8) = NAND(J, H or ~H, G or ~G) (pins 9, 10, 11). Jumpers pick H or ~H and G or ~G,
    giving four horizontal positions. The output has C7, 0.001 µF, to ground and R4, 2.2 kΩ, to
    an unlabelled terminal, and goes to pin 2.
  - ~VS (pin 6) = NAND(S, O, a jumper to P, Q or NOR(P, Q)) (pins 3, 4, 5): three vertical
    positions.
  - SYNC (pin 12, to stack 38) = NAND(+5 V, ~HS, ~VS), which is HS or VS.
  - [I] HS lasts 4 character times, 5.3 µs, close to the text's 5.2 µs. VS lasts 12 lines, about
    0.76 ms, but the text says about 1.5 ms (see Open points).

### Page A: character generator and video (Fig. 5)

- IC8 2518, the line register (a hex 32-bit recirculating register):
  - Inputs 1-6 (pins 13, 14, 15, 1, 2, 3) from B1-B6 (stack 9-14), each with a 6.8 kΩ pull-down to
    −5 V (R27-R32).
  - REC (4) from LINE 1 TRANSFER (17), with R33, 2.2 kΩ, to +5 V. It loads from memory on line 1
    and recirculates on the other 11 lines of a row.
  - CLK (6) from LINE CLOCK (18) through R34, 220 Ω, with R35, 2.2 kΩ, to +5 V and C12, 680 pF, to
    −12 V.
  - Outputs 1-6 (pins 12, 11, 10, 9, 8, 7) to the 2513's address inputs 4-9 (pins 17-22), each with
    a 6.8 kΩ pull-down to −12 V (R45-R50).
  - Pin 5 is −12 V and pin 16 +5 V.
- IC9 2513, the character generator:
  - Address inputs 1-3 (pins 14-16) from L1, L2 and L4 (50, 49, 48), with 2.2 kΩ pull-ups (R40-R42).
  - ENABLE (11) from CURSOR INHIBIT (28), with R37, 47 kΩ, to −12 V. Grounding 28 removes the
    cursor. [R] A high enable gives an all-white cell, which is how the cursor shows.
  - Pin 1 is −12 V, 12 is −5 V, 10 ground and 24 +5 V. Pins 2, 3, 9, 13 and 23 are unused.
  - Outputs 1-5 are pins 4-8.
- IC10 74165, the output register:
  - Parallel inputs C (13), D (14), E (3), F (4) and G (5) take the 2513's outputs 1 to 5. H (6), A
    (11), B (12) and the serial input (10) are grounded.
  - Load (1) from OUTPUT LOAD (45) through C13, 100 pF, with R38, 2.2 kΩ, to ground and R39, 1 kΩ,
    to +5 V.
  - Clock (2) from VIDEO CLOCK (47). Clock inhibit (15) from 9-12 BLANK (21).
  - QH (9) goes to the video combiner; ~QH (7) is unused.
  - [I] After each load QH gives H (blank), then G, F, E, D and C: one blank dot, then the 2513's
    outputs 5 to 1, six dots a character. B and A never reach QH, since the next load comes six
    clocks later.
- IC11 7401 (open-collector NAND), the video combiner, with R36, 470 Ω, from VIDEO OUT (20) to
  +5 V:
  - Gate 3: NAND(QH (8), FLASH (9), optional), output 10 with R43, 2.2 kΩ, to +5 V.
  - Gate 4: NAND(gate 3 (11), SELF TEST (12), with R44, 2.2 kΩ, to +5 V). Its output (13) pulls
    VIDEO OUT down through R51, 330 Ω.
  - Gate 1: NAND(+5 V (2), SYNC IN (3)). Its output (1) pulls VIDEO OUT to ground.
  - Gate 2 (pins 4-6) is unused.
  - [I] So VIDEO OUT has three levels: sync 0 V, black about 2 V (5 V × 330/800), white 5 V. [R]
    The text gives the same levels. A dot (QH high) is white. Grounding SELF TEST gives a white
    raster, and grounding FLASH blanks the characters.

### Memory board, page A or page B (Fig. 4)

- Six 2524 512-bit registers (IC1-IC6), one per bit. Pins: 1 φ2, 2 out, 3 read, 4 VDD (−5 V),
  5 write, 6 in, 7 φ1, 8 +5 V. [D] From Signetics' table: write low recirculates and write high
  stores the input; read high puts the data on the output, and read low gives 0.
- Inputs: IC1-IC5 take A1-A5 (stack 8-4), each with a 2.2 kΩ pull-up (R1-R5). IC6 takes A6
  (stack 3, R6 pull-up) through D1, ORed through D4 with CLEAR (24), with R23, 10 kΩ, to ground.
- Outputs: IC1-IC6 to B1-B6 (stack 9-14).
- Read: all six from the page's enable, a jumper to ENABLE A (34) or ENABLE B (35), with R9,
  10 kΩ, to +5 V. High enables.
- Write: all six from one node, fed by the page's PROTECT jumper (31 or 33) directly, by CLEAR
  (24) through D5 and R24, 330 Ω, and through R25, 2.2 kΩ, by a node with R26, 470 Ω, to UPDATE
  (51) and D6 to CTRL (52).
- [I] So clearing writes 100000 everywhere (D10-D14 on the mainframe hold A1-A5 low, and D4 forces
  A6 high), a space in six-bit ASCII. An update writes the keyboard's character unless the CTRL
  line pulls the write node down, and a grounded PROTECT keeps the page from being written.
- Clock drivers. Two 2N5139 PNP transistors shift the TTL clocks down to a 7406 that runs with
  pin 14 at −5 V and pin 7 at −12 V:
  - Stack 15 drives Q1's base (R21, 1 kΩ, to +5 V; emitter R19, 150 Ω, to +5 V; collector R18,
    150 Ω, to −12 V). The collector drives 7406 inputs 9, 11 and 13; outputs 8, 10 and 12, in
    parallel, make φ2. φ2 goes to the 2524s' pin 1 through R10, 22 Ω, with R17, 100 Ω, to +5 V,
    and R11, 4.7 kΩ, to a φ2 test point.
  - Stack 16 drives Q2 (R22, R20, R14) and 7406 inputs 1, 3 and 5. Outputs 2, 4 and 6 make φ1, to
    pin 7 through R12, 22 Ω, with R16, 100 Ω, to +5 V, and R13, 4.7 kΩ, to a φ1 test point.
  - [D] The figure calls φ1 the early clock and φ2 the late one.
- Supplies: +5 V from 58 and 59 through R7, 2.7 Ω; −5 V from 57 through R8; −12 V from 56 through
  R15. Each has its filter capacitors and a diode (D2, D3, D7). Ground is on pin 1.

### Mainframe (Fig. 3)

- Power: a transformer, rectifiers D1-D6, a 5000 µF filter and a 7805 for +5 V (58, 59). −12 V
  (56) comes through R2, 47 Ω, and −5 V (57) from zeners D8 and D9. An optional keyboard supply
  goes through R1, 47 Ω, and a 12 V zener, D7.
- RF modulator: a 2N918 oscillator (Q1) with L1 (6 turns of #14 wire) and a 3-30 pF trimmer (C6),
  modulated through D10 from VIDEO OUT (20). A twinlead gimmick (C10) couples it to the RF output,
  SO1. Removing R3, 22 Ω, turns the RF off.
- Switches:
  - S7 CURSOR OFF-ON (printed S5; correction 14) grounds CURSOR (28).
  - S5 REPEAT, momentary, switches KEYPRESSED (22) from the keyboard's key-pressed line (C) to the
    BLINKER (23).
  - S2 LINE-FULL SCAN: one section grounds LINE SCAN (36) or connects it to LINE SCAN CLOCK (37);
    the other goes to CALCULATOR CONTROL (32), unused. See Open points.
  - S3 PAGE A/B grounds the enable and protect lines of one page or the other.
  - S4 KEEP-CHANGE grounds PROTECT A (31) or PROTECT B (33).
  - S6 CLEAR (HOME), momentary, two poles: at rest NOT-CLEAR (25) is +5 V and CLEAR (24) ground;
    pressed, the other way round.
  - S8 ADD-SUB joins 27 to 30 (right-left) and 29 to 26 (line direction to the P clock).
  - J2 grounds SELF TEST (19).
- Keyboard connector, A to L (correction 3: A is nearest the RF twinlead, L nearest J1). D to H are
  A1-A5 (stack 8-4), I is A6 (3), J is A7 (2), K is unused, and C is the key-pressed line.
  D10-D14 (1N914) join A1-A5 to NOT-CLEAR (25) and to keyboard B (correction 2).

### Cursor board (Figs. 8 and 9), in part

- Input conditioning (Fig. 8):
  - KEYPRESSED (22) goes through R21, 1 kΩ, and C17, 10 µF, to a 2N5129 (Q1, with R19, 330 Ω,
    and R20, 150 Ω), then to a Schmitt trigger made of two IC8 7400 gates as inverters (C15,
    0.1 µF, R18, 2.2 kΩ). Its output (pin 6) is test point H.
  - H goes through C14, 0.1 µF (R16, 1 kΩ, to +5 V; R17, 2.2 kΩ, to ground) to the trigger (2) of
    IC9, a 555 one-shot with R15, 100 kΩ, and C13, 0.1 µF (about 11 ms [I]). Its output (3) is test
    point G, which goes through C12, 1 µF (R13, 1 kΩ, to +5 V; R14, 2.2 kΩ, to ground), to IC7's
    ~PRE2 (10).
  - IC7 7474, the one-and-only-one synchronizer. FF2 has D2 (12) and CLK2 (11) at +5 V, so it acts
    as a set-reset latch: the 555 sets it, and FF1's ~Q (6) clears it (13). FF1 takes FF2's Q (9)
    on D1 (2), clocks (3) on ~S from IC8 (pins 9, 10 to 8), and has ~PRE1 (4) on LINE SCAN (36),
    with R22, 2.2 kΩ, to +5 V. FF1's Q (5) is test point C: high for exactly one frame per key.
  - IC6 7402, the CTRL detector and outputs. NOR(A7, A6) (pins 11, 12 to 13) goes through R12,
    100 Ω, and C11, 10 µF, to pin 9. NOR(ground, pin 9) (8, 9 to 10) is ~CTRL, to CTRL (52) and
    pin 2. Pin 4 is ~C (pin 5 from C, pin 6 grounded): test point B. Pin 1 = NOR(~CTRL, ~C) is high
    for one frame only on a CTRL key. Correction 10 adds an inverter (IC8 pins 11, 12) between it
    and test point A.
  - [D] A note on the figure: line scan left open means full frame, the P clock gives 14 lines, and
    the optional timing gives 1 line.
- Position counter (Fig. 9):
  - [R] A ÷512 runs on the φ1 pulses (512 a frame): ÷32 for the character (IC2, a 74197, then half
    of IC3, a 7473) and ÷16 for the line (IC4, a 74197). Its output falls at the same place each
    frame: the cursor. An extra short pulse moves the cursor back one place, and a long pulse that
    swallows two clocks moves it forward one. Lines move the same way through IC5.
  - [D] IC2 74197: clock 1 (8) from test point F, the input clock. QA (5) to clock 2 (6). QD (12) to
    IC3's first clock. QB and QC are unused; ~CLR and the data inputs are at +5 V; load (1) is on
    the clear line.
  - [D] IC3, first half: J and K at +5 V, so it toggles. ~Q1 is test point E (character position),
    to IC1 through C1, 0.0012 µF (R1, 1 kΩ, to +5 V; R2, 2.2 kΩ).
  - [D] IC3, second half: clocked by V OUT (55), J2 at +5 V, K2 grounded, ~CLR2 on NOT-CLEAR (25).
    Q2 goes to a hold line.
  - [D] IC4 74197: QA to clock 2; QD to IC5 through C2, 0.0043 µF (R5, 1 kΩ; R6, 2.2 kΩ).
  - [D] Labels: C3, 620 pF, and C4, 0.0062 µF, on the direction line (27, 30): shorted moves right,
    open moves left. R10, 330 Ω, and C5, 0.001 µF, give the add-line pulse. 29 sets the line
    direction for CTRL: ground is up, the P clock is down. Test points: D is the S clock, C is
    UPDATE high for one frame, B is UPDATE low for one frame, A is low for one frame only on CTRL.
  - Not read pin by pin: IC1 (7408), IC5 (7402), IC4's clock and load, and where the hold line
    goes.

### Lancaster's corrections (PDF page 24)

[R] In short:

1. D6 is reversed on the parts overlay, and the negative-supply diodes are drawn reversed.
2. Fig. 3: NOT-CLEAR (25) also goes to keyboard input B and to D10-D14. D10-D14 no longer go to C.
3. Keyboard connector: A is the end nearest the RF twinlead, L the end nearest J1.
4. Fig. 3: delete R11 and R12. Add R5 and R6, 1 kΩ, to the parts list.
5. Printing faults on the overlays.
6. Improved encoder: IC2 is a 7402, and the TP tie points go to IC4 pins 4 and 5.
7. Table V: leave the switch at FULL for normal use.
8. The cursor's TPH timing is 10 ms, not 10 µs.
9. Cursor IC1 (7408) may need an extra 0.05 µF from pin 7 to pin 14. Substitute counters can change
   pulse widths; check them at test point F.
10. Cursor board: add an inverter (IC8 pins 11, 12) between IC6 pin 1 and A.
11. Fig. 8: the dot left of C14 is not a connection.
12. Stack pins 15 and 16 are wired right; only the φ1 and φ2 names are swapped in Fig. 7 and
    Table III.
13. Fig. 6: C5's left end goes to R3, and C6's right end to R2. (C5, C6, R2 and R3 are in the
    derived timing, Fig. 7 here; the timing board numbers its parts across both figures [I].)
14. Fig. 3: CURSOR OFF-ON is S7, not S5.

It adds that the foil patterns are correct. The notes page (23) adds:

- an MC4044 phase detector for phase-locking the timing (for interlace);
- leave at least a third to a half of the scan in each direction for retrace;
- a Harris 0512 PROM for converting Baudot or EBCDIC.

### Pinouts checked

[D] Each chip's pins as Lancaster draws them, against a datasheet's pin diagram:

| Part | Checked against | Result |
|---|---|---|
| 2513 | Signetics MOS (1972) | matches Fig. 5 (and Fig. 2) |
| 2518 | Signetics MOS | matches Fig. 5 (and Fig. 2) |
| 2524 | Signetics MOS | matches Fig. 4; pin 1, unnamed there, is φ2 |
| 7401 | TI TTL Data Book, 2nd edition | matches. Outputs on 1, 4, 10 and 13, so not the 7400's pinout |
| 7406 | TI | matches: the 7404's pinout, with open-collector outputs |
| 7410 | TI | matches |
| 7473 | TI | matches: VCC on 4, ground on 11 |
| 74165 | TI | matches |
| 74197 | TI | matches Fig. 9 |
| 8288 | Signetics 8000 Series TTL/MSI (1972) | matches Fig. 6; the same pinout as the 74196 and 74197 |
| MC4024 | Lancaster's TTL Cookbook (1974), p. 52 | matches Fig. 6 (see Open points for the FREQ pins) |

- [D] The 8288 is a ÷2 and a ÷6 that count on the falling clock edge. Reset (13) is active low and
  clears all four outputs; the data strobe (1) is active low and loads the four data inputs. Its ÷6
  is a ÷2 then a ÷3, so with output A wired to clock 2 it counts 0 to 11 in binary.
- [D] TI's function table shows the 7473 as master-slave: the outputs change as the clock pulse
  ends. The 74LS73 changes on the falling edge.
- [D] The 7400, 7402, 7408, 7432, 7474 and 555 are drawn with their usual pinouts.

### Open points

- T can't fire as drawn. In an 8288, C and D (R and S here) are never high together, so
  NAND(R, P, S) never goes low, and IC6 would stay a ÷12, giving 55 Hz. Ending the count at 11
  needs outputs A, B and D: P, Q and S. So the drawing's R is probably Q [I]. [R] The building
  steps say to check that the chain ends at 60 Hz.
- Vertical sync: by the gates as read it lasts 12 lines, about 0.76 ms; the text says about
  1.5 ms.
- Enable A and B: Fig. 3 labels 35 ENABLE A and 34 ENABLE B, while Table III and Fig. 4 have 34 for
  A and 35 for B.
- Pins 26 and 29: Table III calls 26 the up-down direction control and 29 the down direction clock.
  Fig. 6 puts the P clock on 26, and Fig. 9 uses 29 as the line direction, so the names look
  swapped [I].
- S2 LINE-FULL SCAN grounds LINE SCAN (36) in one position, while Fig. 8 says 36 left open means
  full frame. Which position gives which mode isn't settled.
- The MC4024's FREQ inputs: the TVT grounds both, while the TTL Cookbook ties them to +5 V for a
  fixed frequency. [I] With pin 12 grounded, oscillator 2 may run at the low end of its 3:1 range:
  the Cookbook's C = 300/f gives about 9 Hz for 33 µF, and the TVT's blinker is about 4 Hz.
- Not transcribed: Fig. 9's IC1 and IC5 and parts of its wiring (above), the improved encoder
  (page 17), the foil patterns, and Table III's board-by-board columns.

## Articles that go with it (Radio-Electronics, all free in Lancaster's collection)

| Article | Issue | archive.org |
|---|---|---|
| Low Cost Keyboards | February 1973, pp. 54-7 | https://archive.org/details/donlancaster_low_cost_keyboard_2_73 |
| Build an ASCII Keyboard Encoder | April 1973, pp. 55-9 | https://archive.org/details/donlancaster_ascii_encoder_4_73 |
| Build Improved ASCII Encoder | February 1974, pp. 59-61 | https://archive.org/details/donlancaster_improved_encoder_2_74 |
| Understanding MOS Character Generators | June 1974, pp. 48-52 | https://archive.org/details/donlancaster_mos_character_gens_6_74 |
| What's a RAM? | September 1974, pp. 50-3 | https://archive.org/details/donlancaster_random_access_memory_9_74 |
| How It Works: IC MOS Shift Registers | December 1974 | https://archive.org/details/donlancaster_mos_shift_registers_12_74 |

- [R] The improved encoder uses a Harris HD0165 encoder, a 7402, an MC789P RTL hex inverter (the
  parts list says not to substitute it) and two 7400s.
- [N] What's a RAM? names the 7489, 2102, 7474, 74174 and 74175.
- [I] The bibliography doesn't list the shift-register article, so its magazine is unchecked.

## The TVTs after it

- [R] TV Typewriter II, the SWTPC CT-1024, by Ed Colle.
  - Radio-Electronics, February 1975 (p. 27), March (p. 56) and April (p. 61); a screen-read board
    followed in September (p. 56). All lending-only:
    https://archive.org/details/radioelectronics00unse_2,
    https://archive.org/details/radioelectronics46unse_0,
    https://archive.org/details/radioelectronics46unse_1.
  - The design: 16 lines of 32 characters, with 1024 held in six 2102 static RAMs (two pages). It
    uses a 2513 character generator, a UART on the serial option, and TTL for the rest.
  - SWTPC's brochure (October 1975) says it sold the kit from February 1975 and no longer supplied
    parts for the first TVT. Free copies of the brochure:
    https://archive.org/details/ct1024terminalsystem,
    https://archive.org/details/swtpc-ct-1024-terminal-system-kit-tv-typewriter-ii. The schematic:
    https://archive.org/details/tv-typewriter-ii-schematic.
- Electronic Systems' TVT kit (Burlingame, CA), https://archive.org/details/bitsavers_electronicElectronicSystemsTVTypewriter_573841.
  [R] 1024 characters in 32 lines of 32, with 16 shown. It scrolls, and the cursor moves up, down,
  left, right and home. [N] 74193.
- TVT-6 (Popular Electronics, July 1977, pp. 47-52), https://archive.org/details/donlancaster_tvt6_video_dis12_7_77.
  [R] Video for a KIM-1 (6502) from $20-35 of parts, with the microprocessor doing most of the work
  in software: 16 lines of 32 or 64 characters, or 32 lines of 64, with editing and a cursor. *The Cheap Video
  Cookbook* (https://archive.org/details/donlancaster_cvcb1) and *Son of Cheap Video*
  (https://archive.org/details/donlancaster_socv1) carry this on.

## TV Typewriter Cookbook (1976)

- [R] Nine chapters:
  1. Basics: TV fundamentals, dot-matrix scanning, ASCII.
  2. ICs for TVTs: baud-rate generators, character generators, keyboard encoders, PROMs, RAMs and
     UARTs.
  3. Memory and bus organisation.
  4. System timing: calculations and circuits, blanking, and combining sync, position and video.
  5. Cursor and update circuits, including a microprocessor cursor and a complete cursor system.
  6. Keyboards and encoders.
  7. Serial interfaces: Teletype, cassette and modems.
  8. The television interface: direct video, RF and colour.
  9. Hard copy and colour graphics, up to a 96 × 96 full-colour display.
- [N] It names CMOS more than TTL (4013, 4011, 4096, 4066, ...), and the 2102 RAM most of all.
  It is the design guide to read alongside the 1973 schematics.

## Datasheets

- [N] *Signetics MOS* (1972), https://archive.org/details/bitsavers_signeticsdcsMOS_10148267. It
  names the 2513 static character generator, the 2518/2519 hex 32-bit registers and the
  2524/2525 512-bit recirculating registers. [D] Their pin diagrams are on scan pages n65 (2513),
  n81 (2518) and n93 (2524).
- A separate 2513 sheet: https://archive.org/details/Signetics-25132560-BitStaticCharacterGenerator64x8x5OCR.
- *Signetics Digital 8000 Series TTL/MSI* (1972), with the 8288 from scan page n115:
  https://archive.org/details/bitsavers_signeticsdcs8000SeriesTTLMSI_11847693.
- TI's *TTL Data Book*, 2nd edition, slice 05:
  https://archive.org/details/bitsavers_tidataBook2ed05_2430672. Its pin assignments for the 7401
  are on scan page n5, the 7406 on n6, the 7410 on n7, the 7473 on n21, the 74165 on n43 and the
  74197 on n50.
- The MC4024 has a page in Lancaster's *TTL Cookbook* (p. 52, scan page n53):
  https://archive.org/details/donlancaster_TTLCB1. [R] It is a Motorola MTTL dual
  voltage-controlled astable, also numbered 74424, not the CMOS 4024 counter.

## What the simulator would need

| Part | Board | In the catalog? |
|---|---|---|
| 7400, 7402, 7408, 7432, 7474 | timing, cursor, encoder | yes (74LS) |
| 555 | cursor | yes (NE555) |
| 7401 open-collector NAND | memory (page A) | no; not the 7400's pinout |
| 7406 open-collector hex driver | memory | no |
| 7410 triple 3-input NAND | timing | yes |
| 7473 dual JK | timing, cursor | yes, master-slave as in TI's function table |
| 74165 parallel-in serial-out register | memory (page A) | no |
| 74197 (or 74177) divide-by-16 counter | cursor | no; 74LS161 counts the same way, with other controls |
| 8288 divide-by-12 counter (Signetics) | timing | yes |
| MC4024 dual astable | timing (crystal oscillator) | yes, its frequencies set as parameters |
| 2513 character generator, 2518 and 2524 MOS shift registers | memory | no |

All of these pinouts are checked against datasheets above, except the 74LS107's, 74LS161's and
74LS92's.
| HD0165 encoder, MC789P RTL inverter | improved encoder | no |

- [Lab] A display part for the sandbox, a TV that draws a raster from a video net and a sync net.
  Every TVT, and any video circuit, needs one. The timing lab has the TV itself
  (`src/labs/tvt/_tv.ts`); it isn't a sandbox part yet.
- [Lab] The dot clock is 4.56 MHz, about 76,000 dot clocks a frame. Chip by chip, the timing board
  runs at 160 to 380 thousand dots a second (a browser, and Node), 12 to 28 times slower than the
  real one: a picture every quarter of a second or so, drawn as it goes.
- [Lab] A lab track could follow the boards: the timing chain (crystal, ÷12 counters, sync), then
  the character generator and dot shifter, then the recirculating memory, then the cursor.
- [I] Ben's later video card series builds VGA timing from TTL counters on breadboards, so it
  would pair well with this. That's recalled, not checked against the videos.

## What the simulation shows

[I] Running the timing board as transcribed above (`src/labs/tvt/_timing.ts`,
`tests/labs-tvt.test.ts`), with the TV in `_tv.ts`, whose numbers are NTSC's:

- Every test point from B to O divides the dot clock as the table above says.
- As drawn, T never goes low, IC6 counts 0 to 11, and a frame is 288 lines (82,944 dots): 55 Hz.
  With Q in place of R, T goes low for a few gate delays at count 11, IC6 counts 0 to 10, and a
  frame is 264 lines (76,032 dots): 60 Hz. This supports the reading that the drawing's R is Q.
- As drawn there are also two vertical sync pulses a frame with the jumper on P or Q: count 11 has
  P, Q and S high, as count 9 (or 10) does. The second ends at the top of the text, 48 lines
  after the first. With NOR(P, Q) there is one; with Q for R, count 11 never lasts, so there is
  one.
- HS starts in character time 44, 40, 36 or 32 (counting from 0) for the jumpers H and G, H and
  G̅, H̅ and G, H̅ and G̅. A TV shows the picture from about 9.4 µs (7 character times) after the
  pulse begins, for 52.6 µs (40 character times), so H̅ and G centre the 32 characters, and with H
  and G the first three are cut off on the left.
- The vertical sync is in IC6 count 9 (P), 10 (Q) or 8 (NOR), in the second half of it (O high):
  lines 229-240, 253-264 or 205-216, counting the first text line as 1. With P the text starts
  about 15 lines below the top of the picture.
- A TV's field oscillator runs free a little slower than 60 Hz, and the sync pulse fires it
  early. At 55 Hz the pulse comes too late, so the picture rolls until the vertical hold is turned
  below 55 Hz.

_Sources: the archive.org scans above (their OCR text); the booklet's PDF, its drawings read at
300 dpi; the pin diagrams in Signetics MOS, Signetics' 8000 Series TTL/MSI, TI's TTL Data Book and
the TTL Cookbook; Lancaster's bibliography; the parts in src/breadboard/catalog.ts._
