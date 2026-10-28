# Forrest M. Mims III on digital logic and computers (research)

Forrest Mims wrote Radio Shack's project books and monthly columns in Popular Electronics (1975-82),
Computers & Electronics (1982-85) and Modern Electronics (1984-91). Some of that writing covers the
same ground as Ben's playlist, with the same TTL chips, and could give the sandbox and the labs
circuits from a second source. These notes list what fits, from the archive.org scans, as of
2026-10-26. Nothing in the simulator follows them yet.

Labels: [R] read in the scan's OCR text (summarised here, not quoted). [N] part numbers counted in
the OCR text after the article's title, not read in context, so a few may belong to a neighbouring
page. [I] inferred or recalled, not checked. [Lab] an idea for the simulator.

## Understanding Digital Computers (Radio Shack, 1978): PIP-1

https://archive.org/details/Understanding_Digital_Computers_1978_Radio_Shack (free scan; the
other copies on archive.org are lending-only)

- [R] Chapters 2-7 follow nearly the same path as the playlist: binary, octal and hex, gates,
  half and full adders, decoders and multiplexers, RS, clocked RS, D and JK flip-flops, races and
  the master-slave flip-flop, shift registers, ripple and synchronous counters, then ROM, PROM and
  RAM.
- [R] Chapter 8 (Computer Organization, p. 106) is PIP-1, a tutorial computer Mims designed after
  reading Malvino's *Digital Computer Electronics* (1977), the SAP-1 book that Ben's design likely
  follows (videos.md, video 1). The preface says he built a working model, and the reading list
  that he built a similar microcomputer from about a dozen ICs.
- [R] Sections: a 16 × 8 PROM for program and data, a memory address register, a program counter,
  an instruction register, control (a control ROM and instruction decoder, with START, STOP and
  BUSY), the A register (accumulator), the B register, an add/subtract ALU, and the C register,
  shown on a readout of eight lights. A bidirectional address/data bus links them, and a one-way
  control bus carries the microinstructions. The architecture diagram is on p. 114.
- [R] The book makes every control input active high to keep things simple, and says real TTL
  inputs are mostly active low.
- [R] Each memory-reference instruction has three fetch and three execute microinstructions, one
  2 µs clock cycle each, so 12 µs. Fetch: PC/R and MAR/W; then PROM/R and IR/W; then PC/I. Ben's
  fetch takes two steps (MI|CO, then RO|II|CE).
- [R] Instruction set (op-code, then a 4-bit PROM address or don't-care):

  | Mnemonic | Op-code | Operation |
  |---|---|---|
  | LDA | 0001 addr | A = PROM[addr] |
  | ADD | 0010 addr | B = PROM[addr], A = A + B |
  | SUB | 0011 addr | B = PROM[addr], A = A − B |
  | JMP | 0100 addr | PC = PROM[addr] (the byte stored there, not addr itself) |
  | CLR | 0000 0000 | clear A, B and C |
  | OUT | 0101 xxxx | C = A |
  | NOP | 0110 xxxx | nothing |
  | HLT | 0111 xxxx | stop the clock |

  LDA, ADD and SUB have Ben's op-codes. His JMP takes its address from the operand nibble.
- [R] The example program is LDA 0100, ADD 0101, OUT, HLT (about 42 µs). The chapter ends with how
  to give PIP-1 a new instruction. Two instruction decoder lines are unused, and Mims suggests
  ALU-to-C, PC-to-bus, A-to-IR (letting a result steer the next instruction) or another register.
  The control ROM's truth table is printed, but the OCR has garbled it, so read it from the scan.
- [Lab] A second machine for the computer page, with its own microcode table and assembler, or a lab
  comparing PIP-1 with Ben's computer. The new-instruction section fits the editable microcode
  table.

## Microprocessor Microcourse (Popular Electronics, March-July 1978): PIP-2

Part 1, number systems: https://archive.org/details/197803PopularElectronics. Part 2, basic digital
logic: https://archive.org/details/197804PopularElectronics. Part 3, memories, bus-oriented logic and
microprocessor organisation: https://archive.org/details/197805PopularElectronics. Part 4, PIP-2:
https://archive.org/details/197806-popular-electronics. Part 5:
https://archive.org/details/197807PopularElectronics. The 1981 Electronic Experimenter's Handbook
reprints the series: https://archive.org/details/PopularElectronicsElectronicExperimentersHandbook1981.

- [R] PIP-2 is a 4-bit simplification of PIP-1, with the program in read/write memory and a
  microprogrammable control ROM. Part 4 gives block diagrams, not chip numbers.
- [R] Everything that drives the 4-bit bidirectional bus has three-state outputs:
  - a 16 × 4 RAM for the program, read onto the bus by RAM/R;
  - A and B registers (A/R, A/W, B/R, B/W, clocked by φ2);
  - a 4-bit adder that always sums A and B, with a buffer enabled by ADD/R.
- [R] The program counter doubles as the memory address register. PC/C clears it, PC/I increments
  it, and PC/W loads it from the bus for jumps.
- [R] Four LEDs always show B. The front panel has four toggle switches, LOAD, INITIATE (clear the
  PC), START and STOP. Power-on clears A, B, the PC and the memory.
- [R] Control is a 16 × 8 control ROM, an address decoder, microinstruction decoders and a
  two-phase clock. The instruction register doubles as the microprogram counter, and each
  instruction takes one to five microinstructions.
- [R] Instruction set: NOP 1111, LDA 0001 + data nibble, ADD 0101 (A = A + B), JMP 1000 + address
  nibble, MOV 1011 (B = A, which also puts A on the LEDs), HLT 1110. Part 4 says Part 5 shows how to
  revise the instruction set (not read).

## Columns with circuits for the sandbox

### Three-State Logic (Experimenter's Corner, Popular Electronics, March 1978)

https://archive.org/details/197803PopularElectronics

- [R] Fig. 2, three-state buffer demonstrator: one gate of a 74125, with two LEDs showing a low or a
  high output. When the gate is disabled, both LEDs glow at about half brightness.
- [R] Fig. 3: a 4-to-1 multiplexer from the four 74125 buffers, their enables used as the select
  inputs, driven from a rotary switch or half a 74139.
- [R] Fig. 4, three-state bus demonstrator, built on a solderless breadboard:
  - A 74173 has its inputs and outputs on the same 4-bit bus, with DIP switches for data and
    control and LEDs on the bus.
  - With the write input low, the next rising clock edge (pin 7) loads the bus. Opening the clock
    switch lets the floating TTL input go high, which gives that edge. Contact bounce only reloads
    the same word.
  - With the data switches off the bus, enabling the read input puts the stored word back on the
    LEDs.
  - Going further, a second 74173 shares the clock with its own read and write switches.
  - Mims notes this is a piece of a microprocessor.
- [Lab] Fig. 4 is Ben's register videos (9-13) in one small circuit. The 74LS173, DIP switches, LEDs
  and resistors are all in the parts bin, so it could be an eighth sandbox example. Check how the
  engine treats a floating 74LS input, since the circuit relies on it reading high. Figs. 2 and 3
  need a 74125.

### Read/Write Memories (RAMs), Parts 1 and 2 (Experimenter's Corner, December 1977 and January 1978)

https://archive.org/details/197712PopularElectronics,
https://archive.org/details/197801PopularElectronics

- [R] Part 1 introduces the 7489, a 16 × 4 TTL RAM:
  - Pins: address D C B A on 13, 14, 15 and 1; data in on 4, 6, 10 and 12; data out on 5, 7, 9
    and 11.
  - ME (pin 2) is low to read or write, and WE (pin 3) is low to write.
  - The outputs give the complement of the stored word, so store the complement of what you want
    to read back.
- [R] Part 2 describes the 7489 as sixteen 4-bit latches, covers programming it and introduces the
  74193 4-bit counter. [N] 7489, 7490 and 74193.
- [I] The 74LS189 in Ben's RAM module (videos.md, 19) has the 7489's pinout and inverted outputs,
  with three-state outputs instead of open-collector ones (recalled; check the datasheets).

### Programmable controllers (Electronics Notebook, Modern Electronics, May and June 1988)

https://archive.org/details/modern-electronics-may-1988,
https://archive.org/details/modern-electronics-june-1988

- [R] May, "A 16-Step Programmable Digital Controller":
  - A clock steps a 74193 address counter, which addresses a 7489 RAM. The 4-bit words drive LEDs,
    motors, a 4-to-16 decoder or a DAC.
  - A punched card pulled through a homemade reader of five phototransistors loads the program.
    Four phototransistors give the data, through Schmitt-trigger buffers, and the fifth clocks the
    counter.
  - A run/load switch picks reading or writing, and the 7489 inverts the stored data.
- [R] June, "A 256-Step Programmable Controller":
  - A 2101 static RAM (256 × 4, three-state).
  - Two microinstructions: jump, to an address set on switches, and halt, which stops the clock to
    the address counter.
  - The clock has a fast and a slow speed. [N] 74154, 74193, 555.
- [Lab] A program counter stepping through RAM, with jump and halt: the computer's fetch loop
  without the ALU.

### The Digital Comparator, and the Binary Hi-Lo Game (Popular Electronics, June 1979)

https://archive.org/details/197906PopularElectronics

- [R] Experimenter's Corner:
  - XOR comparators for 1- and 2-bit numbers.
  - A parity generator and detector made from XOR gates.
  - The 7485 4-bit magnitude comparator, with A>B, A=B and A<B outputs and cascade inputs for 8 bits
    or more.
- [R] Project of the Month, a binary Hi-Lo game:
  - A 555 clocks a 74193 fast while a button is held, so it stops on a near-random nibble.
  - The player sets a guess on a DIP switch, and a 7485 lights the higher, lower or equal LED.
- [Lab] The 74LS85, the 555, DIP switches and LEDs are in the parts bin. The counter would need a
  74193, or a 74LS161 counting up.

### Flip-flops and Decade Counters, Part 1 (Experimenter's Corner, Popular Electronics, February 1977)

https://archive.org/details/197702PopularElectronics

- [R] A flip-flop from two cross-coupled 7404 inverters with an LED on each output, built on a
  solderless breadboard. Then a 7473 JK flip-flop clocked by a 555 (Fig. 3). [N] Also a 7475.
- Part 2 is in the March 1977 issue (https://archive.org/details/197703PopularElectronics), not
  read.
- [Lab] Goes with the SR latch, JK flip-flop and binary counter labs.

### The Versatile NAND Gate (Electronics Notebook, Modern Electronics, October 1986)

https://archive.org/details/modern-electronics-october-1986

- [R] Starts from a two-transistor NAND gate, then uses 7400s on a solderless breadboard (74LS00 or
  74C00 also work) for:
  - NOT, AND, OR and NOR, and other combinational circuits;
  - logic probes built from a 7404;
  - a data selector and an 8-input NAND;
  - a latch and a D flip-flop;
  - a switch debouncer from two cross-coupled NAND gates, for single-stepping sequential circuits;
  - a two-inverter LED flasher at about 2 Hz, which can also serve as a logic clock.
- [R] For more, it points to Lancaster's *TTL Cookbook* and *CMOS Cookbook*.
- [Lab] Nearly all of it fits the sandbox's 74LS00 and 74LS04. The flasher needs capacitors, which
  the parts bin doesn't have. Popular Electronics, June 1976, "Applications for the TTL NAND Gate"
  (https://archive.org/details/197606PopularElectronics) is an earlier column on the same theme,
  not read. [N] 7400.

## Books of small circuits

- *Engineer's Notebook: Integrated Circuit Applications* (Radio Shack, 1980),
  https://archive.org/details/engineersnoteboo00unse_0. [R] One hand-lettered circuit per page,
  with CMOS and TTL/LS sections, each split into gate packages, combinational logic and sequential
  logic. Its TTL/LS index:
  - 7400, 7402, 7404, 7408, 74LS10, 74LS13, 74LS20, 74LS27, 74LS30 and 74LS32;
  - 7441, 7447, 7448 and 74LS51;
  - 7473, 7474, 7475 and 7476;
  - 74LS85, 7490, 7492, 74LS93, 74LS123 and 74LS132;
  - 74LS151, 74154, 74LS157, 74LS161, 74LS164 and 74LS175;
  - 74192, 74193, 74LS194 and 74LS196;
  - 74LS367, 74LS368, 74LS373 and 74LS374.

  The CMOS index includes the 4511. Twelve of the TTL parts, and the 4511, are in the sandbox's
  catalog. The OCR garbles the page numbers.
- *Engineer's Notebook II* (Radio Shack, 1982), https://archive.org/details/engineersnoteboo00unse,
  and *The Forrest Mims Engineer's Notebook* (HighText, 1992). The 1992 book is a file in
  https://archive.org/details/engineers-notebook-ii-a-handbook-of-integrated-circuit-applications-forrest-mims.
  [N] 7400, 7404, 7490, 74193 and 7447/7448 most often.
- *Computer Circuits for Experimenters* (Radio Shack, 1974),
  https://archive.org/details/computer-circuits-for-experimenters.
  - [R] Binary arithmetic and logic, then one project per chapter: logic-status indicators, an
    AND-OR gate, a diode-transistor NOR gate, YES and NOT circuits, RTL astable and monostable
    multivibrators, a simple logic clock, a TTL monostable, and a flip-flop decade counter.
  - [N] 74121, 7473, 7490, 7400, 7404, 7447.
  - [Lab] Fits the transistor-gates lab and the clock labs.
- *Getting Started in Electronics* (Radio Shack, 1983), https://archive.org/details/getting-started-in-electronics.
  [R] Hand-lettered, so the OCR is too poor to check part numbers. Its digital section starts with
  gates made from switches, then RTL gates built from transistors, then gate symbols. [Lab] A
  companion to background.md and `#/lab/transistor-gates`.
- *Engineer's Mini-Notebook: 555 Timer IC Circuits*, https://archive.org/details/555-timer-ic-circuits.
  Hand-lettered. [N] 555, 556. [Lab] Variations for the 555 labs.
- *Engineer's Mini-Notebook: Digital Logic Circuits* (1986) would be the most compact source here,
  but its only scan is lending-only (https://archive.org/details/engineersmininot00mims), with no
  downloadable text.

## Background

- Solderless Breadboards for Experimenters (Experimenter's Corner, Computers & Electronics, April
  1983), https://archive.org/details/ComputersElectronics1983-04. [R] Before solderless
  breadboards, prototypes meant point-to-point wiring and solder. The column opens with Barry
  Instrument's Springboard, from about ten years earlier: a plastic base with 120 slots, each
  holding a 0.3" spring. Only the opening was read. [Lab] For the overview lab or docs/BREADBOARD.md.

## Parts these use that the catalog lacks

| Part | Used in | Nearest part in the catalog |
|---|---|---|
| 7489 16 × 4 RAM | RAMs columns, 16-step controller | 74LS189 (same pinout, three-state outputs [I]) |
| 74193 up/down counter | RAMs Part 2, controllers, Hi-Lo game, Engineer's Notebooks | 74LS161 (counts up only, different pinout) |
| 74125 three-state buffers | Three-State Logic, Figs. 2 and 3 | 74LS245 (eight buffers, one enable) |
| 7473 dual JK flip-flop | Flip-flops and Decade Counters, Computer Circuits | 74LS107 (same function, different pinout [I]), 74LS76 |
| 7475 latch | Flip-flops and Decade Counters, Engineer's Notebook | — |
| 7447, 7448 BCD to 7-segment | Computer Circuits, Engineer's Notebooks | CD4511 (same job, CMOS) |
| 2101 256 × 4 RAM | 256-step controller | — |
| Capacitors | NAND gate flasher, RTL multivibrators | — (the 555 is the only timer) |

_Sources: the archive.org scans above (their OCR text); the parts in src/breadboard/catalog.ts._
