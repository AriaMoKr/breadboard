# Per-video notes (research)

One entry per playlist video: concept, key facts, circuit, component values, lab ideas.

## 1. 8-bit computer update

**Concept.** Announcement and overview video (6:52, published 2016-03-09). Ben shows an 8-bit breadboard computer he built earlier, its schematic and the book the design comes from. He walks through the architecture and components, lists his enhancements and says he will rebuild it from scratch on video. It sets out the target machine the whole series builds.

**Key facts**

- [C] Chapters: 0:00 Intro, 0:26 Schematic, 0:50 Book recommendation, 1:06 Architecture, 1:26 Components, 2:30 Enhancements, 3:26 Future plans (YouTube page).
- [I] The book is very likely 'Digital Computer Electronics' (Malvino and Brown), whose SAP-1 machine this design follows. This is from memory and not verified.
- [C] Final machine: 8-bit bus; 4-bit addresses, so 16 bytes of RAM, which eater.net calls 'by far its biggest limitation'; registers A, B and IR; the ALU only adds and subtracts.
- [C] Modules on the bus (high-level.png): Clock, Program Counter, MAR, RAM, Instruction Register, A, ALU (with flags), B, Output, Control logic. The bus has 8x 10k pull-downs to GND and 8 bus LEDs with 220R resistors. B's output enable is tied to VCC, so B never drives the bus.
- [C] Final instruction set (microcode-eeprom-with-flags.ino): NOP 0000, LDA 0001, ADD 0010, SUB 0011, STA 0100, LDI 0101, JMP 0110, JC 0111, JZ 1000, OUT 1110, HLT 1111. Opcodes 1001-1101 are unused (fetch only). An instruction byte is the opcode in the high nibble and the operand or address in the low nibble.
- [C] There are 16 control signals: HLT MI RI RO IO II AI AO EO SU BI OI CE CO J FI.

**Circuit.** Nothing is built. Overview of the SAP-1-style bus computer: clock, 4-bit PC, MAR plus 16x8 RAM, IR, microcoded control (2x 28C16), A, B, ALU (2x 74LS283 plus XOR), flags, output register with decimal display.

**Component values.** None in this video.

**Lab ideas**

- Clickable block diagram of the final computer (high-level.png layout). Each module highlights its control lines and bus connection and links to its own lab.
- 'Guided tour' run of the LDA 14 / ADD 15 / OUT / HLT program (28+14=42) that animates each bus transfer with the active control signals named.
- Instruction-set reference card generated from the microcode table (opcode, mnemonic, T2-T4 microsteps).

_Sources: https://www.youtube.com/watch?v=HyznrdDSSGM, https://eater.net/8bit, https://eater.net/8bit/ram, https://eater.net/schematics/high-level.png, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-with-flags/microcode-eeprom-with-flags.ino_

## 2. Astable 555 timer - 8-bit computer clock - part 1

**Concept.** Ben wires a 555 as an astable oscillator that blinks an LED, then explains its internals: a 3x5k divider, two comparators, an SR latch and a discharge transistor. He derives the timing formulas and checks them on an oscilloscope, which turns up a capacitor whose real value is double its label. He finishes with noise fixes and a potentiometer for variable speed.

**Key facts**

- [C] Parts in the description: 555, 1M potentiometer, 2x 1k, 1x 100k, 1x 330R (LED), 1x '2uF' capacitor, 1x 0.1uF, 1x 0.01uF, LED, 5V USB supply.
- [S] First circuit: R1 = 1k from pin 7 (DIS) to VCC; R2 = 100k from pin 7 to pin 6 (THR); pin 6 tied to pin 2 (TRIG); C = 1uF from pin 2 to GND; output pin 3 drives the LED. Power is pin 8 (VCC) and pin 1 (GND).
- [S] Internals: three 5k resistors set comparator references at 1/3 Vcc (about 1.67V) and 2/3 Vcc (about 3.33V). The trigger comparator sets the latch when V(C) < 1/3 Vcc. The threshold comparator resets it when V(C) > 2/3 Vcc. Q-bar drives the discharge transistor on pin 7, so C swings between 1.67V and 3.33V.
- [C] lm555 datasheet: tH = 0.693(RA+RB)C, tL = 0.693*RB*C, T = 0.693(RA+2RB)C, so f = 1.44/((RA+2RB)C). Duty cycle = (RA+RB)/(RA+2RB).
- [S] Worked numbers: T = 0.693 x 201k x 1uF = 139 ms (about 7.2 Hz). The scope measured 263 ms. The '1uF' capacitor measured about 2uF, which gives a predicted 278 ms.
- [S] Noise fixes: 0.01uF from pin 5 (CV) to GND, per the datasheet; 0.1uF across the supply close to the chip, to cover current spikes and overshoot; a shorter USB cable (less wire inductance); pin 4 (RESET) tied to VCC to prevent spurious resets.
- [S] Speed control: R2 is replaced by a 1M potentiometer with a 1k resistor in series, so R2 is never 0. At the minimum setting C charges through 2k and discharges through 1k.
- [C] Final schematic (clock.png): R1 = 1k, R2 = 1k + RV1 1M, C6 = 1uF, C5 = 0.01uF on CV; LM555 U1.
- [Derived] With C = 1uF, pot at 0: tH = 1.386 ms, tL = 0.693 ms, f = 481 Hz, duty 66.7%. Pot at 1M: tH = 0.694 s, tL = 0.694 s, f = 0.72 Hz, duty about 50%. This matches eater.net's '<1Hz to a few hundred Hz'.

**Circuit.** LM555 astable: pin 8 VCC, pin 1 GND, pin 4 to VCC, pin 5 through 0.01uF to GND. RA (1k) between VCC and pin 7. RB (100k, later 1k + 1M pot) between pin 7 and pins 6+2. Timing C from pins 6/2 to GND. Pin 3 to LED and resistor. 0.1uF decoupling across the rails.

**Component values.** RA = 1k; RB = 100k at first, then 1k + 1M pot; C = 1uF nominal (measured about 2uF); CV cap 0.01uF; decoupling 0.1uF; LED resistor 330R per the description (220R in the summary and in the final schematic).

**Lab ideas**

- 555 astable bench: sliders or knobs for RA, RB and C, plus a 'real capacitor = 2x label' toggle. A two-channel scope trace shows pin 3 and V(C) bouncing between 1/3 and 2/3 Vcc, with live readouts of tH, tL, f and duty against the measured 263 ms.
- Internal-view mode: the 5k-5k-5k divider, both comparators, the SR latch and the discharge transistor, colored by state as C charges and discharges.
- Pot knob 0-1M with the series 1k as a removable part: show the resulting frequency range and why the 1k must stay.
- Supply-noise toggle: switch the CV cap and decoupling cap off or on and see ringing or overshoot spikes on the scope trace.

_Sources: https://www.youtube.com/watch?v=kRlSFm519Bo, https://videohighlight.com/v/kRlSFm519Bo, https://eater.net/8bit/clock, https://eater.net/schematics/clock.png, https://eater.net/datasheets/lm555.pdf_

## 3. Monostable 555 timer - 8-bit computer clock - part 2

**Concept.** A second 555 in monostable (one-shot) mode debounces the manual-step pushbutton. One press of a bouncing button gives exactly one clean output pulse of length 1.1RC. The scope shows the raw switch bounce, which would otherwise make several clock pulses.

**Key facts**

- [C] Parts in the description: 555, 1k, 1M, 330R, 2uF, 0.1uF, 0.01uF, Microtivity 6mm tact switch, LED.
- [C] Final schematic U2: R3 = 1k pull-up from TRIG (pin 2) to VCC. SW1 pulls pin 2 to GND. R4 = 1M from VCC to DIS (pin 7) and THR (pin 6). C3 = 0.1uF from pins 6/7 to GND. C2 = 0.01uF on CV (pin 5). Pin 4 to VCC. Output on pin 3.
- [C] Monostable pulse t = 1.1RC (lm555 datasheet).
- [S] 1M x 2uF gives about 2 s (1.1RC = 2.2 s). With 0.1uF it is about 0.1 s (1.1RC = 110 ms, the final value).
- [S] Operation: pressing pulls TRIG below 1/3 Vcc, which sets the latch. The output goes high and the discharge transistor turns off. C charges through R. At 2/3 Vcc the latch resets and the discharge transistor dumps C immediately. Bounces during the pulse are ignored.
- [I] By standard 555 behavior, if TRIG is still held low when the time runs out, the output stays high until it is released.
- [S] Also: CV cap to GND and RESET tied to VCC, as in part 1.

**Circuit.** LM555 monostable: TRIG pulled up by 1k with the pushbutton to GND. DIS and THR tied together, to VCC through 1M and to GND through the timing C. CV through 0.01uF to GND. RESET to VCC. Output to LED (later to the clock logic).

**Component values.** Rpull-up = 1k; R = 1M; C = 2uF in the demo (about 2.2 s), 0.1uF in the final build (110 ms); CV 0.01uF; LED resistor 330R.

**Lab ideas**

- Bounce lab: a pushbutton model that emits a random bounce train (for example 5-20 transitions over 1-5 ms). Compare the raw signal driving a counter (it counts too many) with the 555 one-shot output (counts 1), on a scope with zoom.
- One-shot timing: R and C sliders (presets 1M/2uF and 1M/0.1uF) show the V(C) ramp to 2/3 Vcc and the instant discharge, with t = 1.1RC computed live.
- Hold-the-button experiment: hold the button longer than t and see the output stay high until release.

_Sources: https://www.youtube.com/watch?v=81BgFhm2vz8, https://videohighlight.com/v/81BgFhm2vz8, https://eater.net/schematics/clock.png, https://eater.net/datasheets/lm555.pdf_

## 4. Bistable 555 - 8-bit computer clock - part 3

**Concept.** A third 555 is used only as an SR latch (bistable mode) to debounce the toggle switch that picks auto (astable) or manual (monostable) clock. Switching the clock source with the bare switch would bounce and make extra pulses. The latch ignores repeated set or reset bounces.

**Key facts**

- [C] Parts in the description: 555, 2x 1k, 330R, 0.01uF, toggle switch (listed as double-pole), LED.
- [C] Final schematic U3: R5 = 1k pull-up on TRIG (pin 2); R6 = 1k pull-up on RESET (pin 4); SW2 (drawn SPDT) has its common to GND and its throws to TRIG and RESET; THR (pin 6) to GND; DIS (pin 7) not connected; C4 = 0.01uF on CV; Q on pin 3.
- [S] TRIG grounded: below 1/3 Vcc, latch set, Q = 1. RESET grounded: Q = 0. Bouncing on one contact just re-asserts the same set or reset. THR is grounded so the threshold comparator never resets the latch.
- [C] Q = 1 selects the astable clock and Q = 0 selects manual (clock.png logic).
- [S] Recap of the 555 modes: astable (no stable state), monostable (one), bistable (two).

**Circuit.** LM555 with TRIG and RESET each pulled up through 1k, an SPDT switch grounding one or the other, THR grounded, DIS open, CV cap. Output to the select input of the clock logic.

**Component values.** 2x 1k pull-ups; 0.01uF CV cap; LED resistor 330R (description).

**Lab ideas**

- Toggle-switch bounce lab: route a bouncing SPDT switch straight to a clock mux and count spurious edges, then route it through the 555 SR latch and see clean single transitions.
- 555-as-SR-latch panel: inputs TRIG-bar and RESET-bar, a live truth table, and a comparator and latch view with THR grounded.
- Three-mode explorer: one 555 model switchable between astable, monostable and bistable wiring, with an explanation of each stable state.

_Sources: https://www.youtube.com/watch?v=WCwJNnx36Rk, https://videohighlight.com/v/WCwJNnx36Rk, https://eater.net/schematics/clock.png_

## 5. Clock logic - 8-bit computer clock - part 4

**Concept.** Gates combine the three 555 outputs into one clock. The bistable select picks the astable or the monostable pulse, and a HLT input lets a program stop the clock. CLK and an inverted CLK-bar are both produced. Ben uses AND/OR/NOT chips for readability rather than a smaller NAND-only design.

**Key facts**

- [C] Parts in the description: 74LS04, 74LS08, 74LS32, LED.
- [C] Equation (clock.png): CLK = ((ASTABLE AND SEL) OR (MONO AND NOT SEL)) AND NOT HLT; CLK-bar = NOT CLK.
- [C] Gate assignment: U5A AND (pins 1,2 to 3) = astable AND SEL. U4A NOT (1 to 2) = SEL-bar. U5B AND (4,5 to 6) = SEL-bar AND mono. U6A OR (1,2 to 3). U4D NOT (9 to 8) = HLT-bar. U5C AND (9,10 to 8) = CLK. U4F NOT (13 to 12) = CLK-bar. A blue LED with 220R shows CLK.
- [C] HLT is active high: HLT = 1 forces CLK low and stops the computer.
- [S] Ben mentions a NAND-only version needs fewer chips but is harder to follow, so he favors clarity. He removes the debug LEDs at the end.
- [C] eater.net: the manual mode exists for single-step debugging.

**Circuit.** 74LS08 (3 AND), 74LS32 (1 OR), 74LS04 (3 NOT) combining the astable Q, monostable Q, bistable Q and HLT into CLK and CLK-bar.

**Component values.** Clock LED 220R (schematic). No timing parts beyond parts 1-3.

**Lab ideas**

- Complete clock module: speed pot (0.72-480 Hz), auto/manual toggle with bounce, step button (110 ms one-shot), HLT switch, and CLK and CLK-bar LEDs plus a scope.
- Gate-level view with live wire coloring and a truth table for (SEL, ASTABLE, MONO, HLT) to CLK.
- Timing-diagram puzzle: flip SEL mid-cycle and see whether a truncated or extra pulse appears; then build the NAND-only version and count chips.

_Sources: https://www.youtube.com/watch?v=SmQ5K7UQPMM, https://videohighlight.com/v/SmQ5K7UQPMM, https://eater.net/schematics/clock.png, https://eater.net/8bit/clock_

## 6. SR latch

**Concept.** Feeding a gate's output back to its input makes memory. An OR gate fed back to itself latches on for good. Two cross-coupled NOR gates make a settable and resettable SR latch. The video covers hold, set, reset, the invalid S=R=1 state and the random power-up state.

**Key facts**

- [C] Parts in the description: 74LS32, 74LS02, 3x 330R, 3 tact switches, 3 LEDs.
- [S] OR gate with its output fed to one input: one press latches the output to 1, and only removing power resets it.
- [S] NOR latch truth table (S R to Q Q-bar): 0 0 hold; 1 0 gives 1 0 (set); 0 1 gives 0 1 (reset); 1 1 gives 0 0 (invalid, Q and Q-bar both 0). If S and R are released together from 1 1, the end state depends on which gate is faster (a race).
- [S] At power-up one gate wins by propagation delay, so the initial state is effectively random.
- [I] Standard wiring: R goes to the NOR whose output is Q; S goes to the NOR whose output is Q-bar.

**Circuit.** 74LS02: two NOR gates cross-coupled (each output to one input of the other), pushbuttons on S and R, LEDs with 330R on Q and Q-bar. A first demo uses a 74LS32 OR gate with feedback.

**Component values.** 330R LED resistors.

**Lab ideas**

- Interactive NOR SR latch with S and R buttons, Q and Q-bar LEDs, and a live truth table that marks the invalid row when both are pressed.
- Race simulator: release S and R 'simultaneously' with configurable per-gate delays or jitter; the final state is random, and the same happens at power-up.
- OR-gate self-latch demo showing that it cannot be turned off without a power cycle, and why NOR fixes this.

_Sources: https://www.youtube.com/watch?v=KM0DdEaY5sY, https://videohighlight.com/v/KM0DdEaY5sY, https://eater.net/8bit_

## 7. D latch

**Concept.** The SR latch gets an enable (AND gates on S and R), then a single data input. D drives S directly and drives R through an inverter, so the invalid state cannot occur. With E = 1 the latch is transparent (Q follows D); with E = 0 it holds.

**Key facts**

- [C] Parts in the description: 4x 74LS02, 2x 74LS08, 8x 330R, 1x 1k, 8 tact switches, 9 LEDs.
- [S] Gated SR latch: S' = S AND E, R' = R AND E. With E = 0 the buttons do nothing.
- [S] D latch: S = D AND E, R = (NOT D) AND E. The inverter is a NOR gate with both inputs tied together (chapter 1:30 'A NOR gate as an inverter').
- Truth table: E=1 gives Q = D; E=0 gives Q = previous Q. Q-bar is always the complement.
- [S] The D latch stores one bit and is the basis of registers and memory.

**Circuit.** 74LS02 NOR SR latch, 74LS08 ANDs gating S and R with E, and a NOR used as the inverter from D to the R path. Buttons for D and E, LEDs on D, E, Q and Q-bar.

**Component values.** 330R LED resistors; 1k (pull-down for button inputs, inferred).

**Lab ideas**

- Build-up lab in three stages: SR latch, then add an enable, then add the D inverter. Each stage is interactive and shows that the invalid state becomes impossible.
- Transparency demo: hold E high and wiggle D (Q follows), release E (Q frozen), with a scrolling timing diagram.
- 'NOR as inverter' mini-panel showing NOR(x,x) = NOT x.

_Sources: https://www.youtube.com/watch?v=peCh_859q7Q, https://videohighlight.com/v/peCh_859q7Q, https://eater.net/8bit_

## 8. D flip-flop

**Concept.** Turns the D latch into an edge-triggered D flip-flop by feeding its enable from a rising-edge detector, so data is captured only at the clock's low-to-high transition. Two edge detectors are shown: a gate-delay glitch circuit and a simple RC differentiator.

**Key facts**

- [C] Parts in the description: 74LS02, 74LS08, 2x 330R, 1x 1k, 1x 0.1uF, 2 tact switches, 4 LEDs.
- [S] Timing diagram comparison: the latch follows D while E is high; the flip-flop changes only at the rising CLK edge, using D's value at that instant.
- [S] Gate-delay edge detector: AND (or NAND) of CLK with an inverted copy of CLK. Because the inverter lags by its propagation delay, both inputs are briefly high and a pulse a few ns wide appears on the rising edge. Chaining more inverters lengthens it.
- [S] RC edge detector: series C = 0.1uF from CLK, R = 1k to GND, and the junction drives the latch enable. Pulse width is about tau = RC = 0.1 ms.
- [I] The RC node also swings negative on the falling edge, which is harmless for the enable.
- [S] Schematic symbols: a triangle on an input means edge-triggered clock; a bubble means falling edge.

**Circuit.** D latch (74LS02 + 74LS08) whose E input is driven from a pushbutton clock through a 0.1uF capacitor with a 1k resistor to GND (RC differentiator). LEDs on CLK, D, Q and Q-bar.

**Component values.** C = 0.1uF, R = 1k, tau = 100 us; 330R LED resistors.

**Lab ideas**

- Waveform editor: draw D and CLK, then compare predicted outputs of a D latch and a D flip-flop side by side and check against the simulation.
- RC edge-detector scope: sliders for R and C show V = Vin*e^(-t/RC) and the time above the LS-TTL input threshold (about 2.0V high and 0.8V low), with a negative spike on the falling edge.
- Gate-delay detector: adjustable inverter delay (5-30 ns) and number of chained inverters, showing the resulting pulse width.

_Sources: https://www.youtube.com/watch?v=YW-_GkUguMM, https://videohighlight.com/v/YW-_GkUguMM, https://eater.net/8bit_

## 9. Bus architecture and how register transfers work - 8 bit register - Part 1

**Concept.** Explains the computer's 8-wire shared bus. Each module has a 'load' (in) and an 'enable' (out) control line. In a transfer, exactly one module drives the bus and the chosen receivers latch it on the clock edge. Ben demonstrates transfers between registers, memory and a sum register with an animated diagram.

**Key facts**

- [S] The bus is 8 wires; every module attached sees the same voltages.
- [S] Each module has LOAD (read the bus on the next clock edge) and ENABLE (drive its value onto the bus). Only one ENABLE may be active at a time.
- [S] Transfers are synchronous: the receiver's LOAD is asserted and the data is latched on the rising clock edge.
- [C] The registers are built from 2x 74LS173 plus 1x 74LS245 (eater.net/8bit/registers): A and B are general-purpose; IR holds the current instruction.
- [C] Final signal names for in and out: AI/AO, BI (no BO), II/IO, MI, RI/RO, OI, EO, CO/J.

**Circuit.** Conceptual only: an 8-bit bus with several modules, each having load, enable and clock inputs.

**Component values.** None.

**Lab ideas**

- Bus-transfer sandbox: registers A, B, C and D plus 'memory' on one bus. Pick one OUT and any number of INs, press CLK, and watch the value move. Two ENABLEs at once flags a conflict.
- Micro-puzzle mode: 'move A to C using as few clocks as possible' or 'swap A and B using a temp register'.

_Sources: https://www.youtube.com/watch?v=QzWW-CBugZo, https://videohighlight.com/v/QzWW-CBugZo, https://eater.net/8bit/registers_

## 10. Tri-state logic: Connecting multiple outputs together - 8 bit register - Part 2

**Concept.** Shows why two ordinary outputs must never share a wire. A totem-pole output sources current for a 1 and sinks it for a 0, so two outputs fight. Tri-state outputs add a third, high-impedance state where both output transistors are off. The 74LS245 bus transceiver supplies eight such buffers.

**Key facts**

- [S] Output stage: the top transistor on sources current (1); the bottom transistor on sinks current (0). Two outputs at opposite levels on one wire give contention: high current and an undefined voltage.
- [S] Tri-state: an enable input turns both transistors off, so the output is disconnected (high-Z).
- [C] 74LS245 (datasheet): G-bar (OE-bar, pin 19) low enables; DIR (pin 1) high sends A to B and low sends B to A; A1-A8 on pins 2-9, B8-B1 on pins 11-18, GND pin 10, VCC pin 20.
- [S] Rule: at most one module's enable is active; load signals go active alongside it.

**Circuit.** Conceptual transistor-level output stages; introduces the 74LS245.

**Component values.** None.

**Lab ideas**

- Transistor-level output stage: two gates wired to one net with toggles for each output's value and enable. Show current arrows, contention (red), and high-Z as a floating, undefined level.
- 74LS245 explorer: set DIR and OE-bar and toggle the A or B side, showing which side drives which, with the pin numbers.

_Sources: https://www.youtube.com/watch?v=faAjse109Q8, https://videohighlight.com/v/faAjse109Q8, https://eater.net/datasheets/74ls245.pdf_

## 11. Designing and building a 1-bit register - 8 bit register - Part 3

**Concept.** Builds a 1-bit register from a D flip-flop plus gating, so it only takes a new value when LOAD is asserted at a clock edge and otherwise recirculates Q. It then adds a tri-state output. It closes by introducing the 74LS173 4-bit register, which has load gating and tri-state outputs built in and is used from then on.

**Key facts**

- [C] Parts in the description: 74LS04, 74LS08, 74LS32, 74LS74 (dual D flip-flop), LED, the clock module from part 4.
- [I/S] Load logic: D = (BUS AND LOAD) OR (Q AND NOT LOAD), fed to a 74LS74 clocked by the computer CLK. With LOAD = 0 the register keeps its value on every clock.
- [S] Its output to the bus goes through a tri-state buffer with ENABLE; the 74LS245 is introduced as eight tri-state buffers (DIR tied high for one-way use).
- [C] 74LS173 (datasheet): pins M = 1, N = 2 (output control, high = high-Z); 1Q-4Q = 3-6; CLK = 7; GND = 8; G1 = 9 and G2 = 10 (data enable, both LOW to load on the rising CLK edge); 4D-1D = 11-14; CLR = 15 (active HIGH, asynchronous); VCC = 16.
- [S] The design will use 74LS173s instead of building discrete registers.

**Circuit.** 74LS74 D flip-flop; 74LS08 two ANDs; 74LS04 inverting LOAD; 74LS32 OR forming the D input mux; LED on Q; CLK from the clock module.

**Component values.** No specific RC values; LED.

**Lab ideas**

- Gate-level 1-bit register with LOAD, ENABLE, BUS-bit and CLK controls; a highlighted path shows whether the D input comes from the bus or from Q.
- Side-by-side comparison of the discrete 1-bit register and a 74LS173 bit slice (G1/G2, M/N, CLR), stepping through the same stimulus.

_Sources: https://www.youtube.com/watch?v=-arYx_oVIj8, https://videohighlight.com/v/-arYx_oVIj8, https://eater.net/datasheets/74ls173.pdf_

## 12. Building an 8-bit register - 8-bit register - Part 4

**Concept.** Builds the A register from two 74LS173s and one 74LS245. The 173s' own tri-state outputs are left permanently enabled so their LEDs always show the contents, and the 245 controls bus output. The 173 inputs and 245 outputs share the same bus wires; that is safe because load and enable are never both active.

**Key facts**

- [C] Parts in the description: 2x 74LS173, 1x 74LS245, 8 LEDs.
- [C] Wiring (a-register.png): 173 pins 1 and 2 (M, N) to GND, so outputs always drive the LEDs and the 245. Pins 9 and 10 (G1, G2) tied together to AI-bar, the active-low load. Pin 7 to CLK. Pin 15 to CLR (active high). U8 holds bus bits 4-7 and U9 bits 0-3.
- [C] 245: DIR (pin 1) to VCC so register data goes A to B onto the bus; OE-bar (pin 19) = AO-bar. Bus wires go to both the 173 D inputs and the 245 B pins.
- [C] A register outputs A_0..A_7 also feed the ALU. Schematic LEDs are red with 220R.
- [S] Control lines are active low: LOAD-bar and ENABLE-bar.

**Circuit.** 2x 74LS173 (high and low nibble) plus 74LS245 output buffer plus 8 LEDs; control inputs AI-bar, AO-bar, CLK, CLR.

**Component values.** LED resistors 220R in the schematic (Ben often omitted them in the video; community note).

**Lab ideas**

- Chip-level register: an interactive DIP view of the 74LS173 and 74LS245 with pin-number tooltips. Drive AI-bar, AO-bar, CLK and CLR and watch the LEDs and the bus.
- Wiring exercise: connect bus bits to the correct 173 and 245 pins; the lab checks for swapped nibbles or reversed bits.

_Sources: https://www.youtube.com/watch?v=CiMaWbz_6E8, https://videohighlight.com/v/CiMaWbz_6E8, https://eater.net/schematics/a-register.png, https://eater.net/datasheets/74ls173.pdf_

## 13. Testing our computer's registers - 8-bit register - Part 5

**Concept.** Tests the A register against an LED bus, then builds B and the instruction register and transfers values between them. An undriven bus reads as all 1s because floating LS-TTL inputs float high. The IR only puts its low nibble (the operand) back on the bus; its high nibble (the opcode) goes to control logic.

**Key facts**

- [C] Parts in the description: 6x 74LS173, 3x 74LS245, 32 LEDs, clock module.
- [S] Loading from an undriven bus gives 11111111, because LS-TTL inputs float high. Grounding bus wires with jumpers loads 0s.
- [S] A-to-B transfer: AO-bar low (A drives the bus) plus BI-bar low, then a rising CLK edge latches into B.
- [C] IR (ir.png): 245 A0-A3 (pins 2-5) grounded, so the IR outputs 0000 on bus bits 4-7 and its low 4 bits on bus bits 0-3 when IO-bar is low. IR_4..IR_7 go to the control logic. LEDs: 4 blue (opcode), 4 yellow (operand).
- [S] The IR is built mirror-image on the breadboard for layout reasons.
- [C] B register (b-register.png): BO-bar tied to VCC at top level, so B never drives the bus.
- [I] Bus pull-downs are added only in video 34.

**Circuit.** Three 8-bit registers (A, B, IR) on a shared bus with 8 bus LEDs. The IR's 245 has its upper inputs grounded and IR high bits routed out.

**Component values.** None specified beyond the LEDs.

**Lab ideas**

- Floating-bus lab: no pull-downs, and loading reads 0xFF. Add 'jumpers to GND' per bit to set values. A toggle adds the later 10k pull-downs for comparison.
- Three-register transfer drill (A to B, B to IR, and so on) with clock stepping and the IR's split display (opcode blue, operand yellow; only the operand returns to the bus).

_Sources: https://www.youtube.com/watch?v=9WE3Obdjtv0, https://videohighlight.com/v/9WE3Obdjtv0, https://eater.net/schematics/ir.png, https://eater.net/schematics/b-register.png, https://eater.net/schematics/high-level.png_

## 14. Twos complement: Negative numbers in binary

**Concept.** Compares three signed encodings: sign bit (sign-magnitude), ones' complement and two's complement. Two's complement wins because plain binary addition gives correct results with negative numbers, there is one zero, and the MSB has weight -2^(n-1). Negate by inverting all bits and adding 1.

**Key facts**

- [S] Sign-magnitude: the MSB is the sign (for example 4-bit -5 = 1101). There are two zeros, and plain addition gives wrong answers (5 + (-5) is not 0).
- [S] Ones' complement: negate by inverting all bits (-5 = 1010). There is a -0 (1111), and results are off by one when a carry occurs.
- [S] Two's complement: negate = invert + 1 (5 = 0101, 1010, +1 = 1011 = -5). Place values in 4 bits are -8 4 2 1. 1000 = -8, 1001 = -7, 1100 = -4, 1111 = -1.
- [S] Example: 6 - 2 = 0110 + 1110 = 1 0100; discard the carry to get 0100 = 4.
- [Derived] n-bit range is -2^(n-1) .. 2^(n-1)-1, so 8-bit is -128..127 with weights -128 64 32 16 8 4 2 1. This is used later by the ALU (SU) and the signed display mode.

**Circuit.** None (theory).

**Component values.** None.

**Lab ideas**

- Bit-toggle panel (4- or 8-bit) showing the same pattern as unsigned, sign-magnitude, ones' complement and two's complement values at once.
- Number-wheel visualization of 4-bit values for each encoding, highlighting the double zeros and the wrap point.
- Adder playground: add two signed values bit by bit with carries shown, discarding the final carry, with overflow detection.

_Sources: https://www.youtube.com/watch?v=4qH4unVtJkE, https://videohighlight.com/v/4qH4unVtJkE_

## 15. ALU Design

**Concept.** Designs the ALU: two cascaded 74LS283 4-bit adders sum A and B continuously. A 74LS245 puts the result on the bus when EO (sum out) is asserted. For subtraction, B passes through XOR gates driven by SU (conditional inversion) and SU also feeds the adder carry-in, so the ALU computes A + NOT B + 1 = A - B.

**Key facts**

- [C] Final ALU (alu.png): U21 is the low nibble with carry-in C0 (pin 7) = SU. U21 C4 (pin 9) feeds U20 C0. U20 C4 (pin 9) is the carry out, later used as CF. Each B bit goes through a 74LS86 XOR with SU into the adder B inputs. A bits go directly to the adder A inputs.
- [C] 74LS283 pin map (schematic): A1-A4 = pins 5, 3, 14, 12; B1-B4 = 6, 2, 15, 11; Sum1-Sum4 = 4, 1, 13, 10; C0 = 7; C4 = 9.
- [C] Output 245 (U17): DIR (pin 1) = VCC, OE-bar (pin 19) = EO-bar. Ben calls the signal 'Sigma-out'.
- [S] XOR as a conditional inverter: B XOR 0 = B, B XOR 1 = NOT B.
- [C] Control signals: EO (active-low at the chip), SU (active high, direct).

**Circuit.** 2x 74LS283 (carry-chained), 2x 74LS86 (8 XORs on B with SU), 1x 74LS245 to the bus, 8 result LEDs; inputs A_0..A_7 and B_0..B_7 from the registers.

**Component values.** LED resistors 220R (schematic).

**Lab ideas**

- ALU workbench: set A and B (bit toggles or decimal), toggle SU, and watch the XOR outputs, the per-bit carries rippling through both 283s and the carry-out, with unsigned and signed result readouts.
- 'Why +1?' step mode: show NOT B, then the carry-in of 1, then the sum, comparing against the two's complement formula.
- 283 pinout trainer: map A1..A4, B1..B4 and Sum1..Sum4 to their odd physical pin numbers.

_Sources: https://www.youtube.com/watch?v=mOVOS9AjgFs, https://videohighlight.com/v/mOVOS9AjgFs, https://eater.net/8bit/alu, https://eater.net/schematics/alu.png_

## 16. Building the ALU

**Concept.** Builds the ALU between the A and B registers on the breadboard: adders, XORs, output buffer, LEDs and control signals. At first power-up the result is wrong, which sets up the next video.

**Key facts**

- [C] Parts in the description: 2x 74LS283, 2x 74LS86, 1x 74LS245, 8 LEDs, plus the clock module and registers.
- [S] Build order: place chips, power; A register to the adder A inputs; adder outputs to the 245; carry out (low) to carry in (high); B register to the XORs and the XORs to the adder B inputs; SU to the XORs and carry-in; 245 pin 19 (enable, active low) and pin 1 (DIR high); LEDs on the sum.
- [S] The initial test shows wrong sums, for example A = 0 and B = 8 displays 4 (see video 17).

**Circuit.** Same as video 15, physically built.

**Component values.** None new.

**Lab ideas**

- Guided wiring build: the user drags wires between the register outputs, 74LS86 and 74LS283 pins. A checker validates against the reference netlist and reports specific miswires.
- Power-on test harness: after wiring, auto-run the test vectors (0+0, A only, B only, single bits) and show pass or fail.

_Sources: https://www.youtube.com/watch?v=S-3fXU3FZQc, https://videohighlight.com/v/S-3fXU3FZQc, https://eater.net/schematics/alu.png_

## 17. Troubleshooting the ALU

**Concept.** A systematic troubleshooting session. Ben simplifies inputs to isolate the fault: both zero, then A only with B = 0, then single bits. He finds the faults, traces wires with a multimeter and fixes two wiring errors.

**Key facts**

- [S] Symptom: A = 0, B = 8 gives a sum of 4; subtraction is also wrong.
- [S] Method: set A = B = 0 (the output is 0 for both add and subtract), then test A alone with B = 0 (the output should equal A), bit by bit, then B alone.
- [S] Fault 1: a wire from the A register to the adder was off by one position (bit 3).
- [S] Fault 2: two B-register bits (3rd and 4th) were swapped on the way to the XORs or adders; fixed by swapping the wires.
- [S] After the fixes: 2 + 6 = 8 and 6 - 2 = 4 are correct.
- [C] Description: persistence matters, and fresh eyes help.

**Circuit.** The ALU from video 16 with two injected miswires.

**Component values.** None.

**Lab ideas**

- Fault-injection game: the lab hides 1-2 random miswires (swap, off-by-one, open). The user sets A, B and SU and probes nets with a virtual multimeter or logic probe to locate them, and is scored on probes used.
- Isolation-strategy tutor: suggests the next best test vector, such as B = 0 with a single A bit set.

_Sources: https://www.youtube.com/watch?v=U7Q8-2YZTUU, https://videohighlight.com/v/U7Q8-2YZTUU_

## 18. Testing the computer's ALU

**Concept.** Connects the ALU output to the bus and shows clocked arithmetic. With EO and AI both asserted, every rising clock edge loads A + B back into A, so A counts by B. With SU set it counts down. Registers latch only on the edge, so the feedback loop advances exactly once per clock.

**Key facts**

- [S] Bus wires from the ALU's 245 join the shared bus (the external test input and the IR are disconnected for this).
- [S] With EO and AI active: A <- A + B on each rising edge. With B = 2 it counts by 2 and wraps at 256. With SU it counts down.
- [S] Edge-triggered loading prevents a runaway loop even though the ALU is combinational.
- [S] Recap of the signals: AI, AO, BI, EO, SU, CLR.

**Circuit.** A, B and ALU on the bus; the ALU's 245 output to the bus; AI and EO asserted together.

**Component values.** None.

**Lab ideas**

- Accumulator loop: set B, assert EO and AI, and run the clock (speed slider). A counts up (or down with SU), with signed and unsigned displays and the wrap at 255 to 0.
- 'What if the register were a latch?' toggle: replace the edge-triggered load with a transparent latch and watch the value race uncontrolled.

_Sources: https://www.youtube.com/watch?v=4nCMDvnR2Fg, https://videohighlight.com/v/4nCMDvnR2Fg_

## 19. 8-bit computer RAM intro

**Concept.** Extends the register idea to a 16-byte memory: 16 8-bit registers selected by a 4-bit address decoder, with write and enable signals. It compares DRAM (capacitors that need refresh) with SRAM (flip-flops), then introduces the 74LS189 16x4 SRAM, whose outputs are inverted. Two chips make 16x8.

**Key facts**

- [S] Address decoding: the 4 address bits and their complements feed AND gates, so exactly one of 16 word lines is active. Separate write per word; shared bit lines.
- [S] DRAM stores charge on capacitors and needs periodic refresh. SRAM uses flip-flops: no refresh, but more expensive.
- [C] 74F189 datasheet (served by eater.net): 16 words x 4 bits. CS-bar = L and WE-bar = L: write, outputs high-Z. CS-bar = L and WE-bar = H: read, outputs show the COMPLEMENT of the stored data. CS-bar = H: outputs high-Z.
- [C] Pinout (ram.png): A0 = 1, CS-bar = 2, WE-bar = 3, D1 = 4, O1-bar = 5, D2 = 6, O2-bar = 7, GND = 8, O3-bar = 9, D3 = 10, O4-bar = 11, D4 = 12, A3 = 13, A2 = 14, A1 = 15, VCC = 16.
- [C] The RAM is 16 bytes because addresses are 4 bits (eater.net).

**Circuit.** Conceptual decoder plus register array; introduces two 74LS189s in parallel (high and low nibble).

**Component values.** None.

**Lab ideas**

- 16x8 memory grid: set a 4-bit address and watch the decoder light one word line; read and write a byte with WE and enable.
- 74189 chip explorer: write a nibble and read it back inverted, then add a 74LS04 to restore it; CS and WE truth table.
- DRAM leak toy: capacitor cells decay over time unless a refresh sweep runs.

_Sources: https://www.youtube.com/watch?v=FnxPIZR1ybs, https://videohighlight.com/v/FnxPIZR1ybs, https://eater.net/datasheets/74189.pdf, https://eater.net/schematics/ram.png_

## 20. RAM module build - part 1

**Concept.** Wires two 74189s as one 16x8 memory. The inverted outputs are re-inverted with 74LS04s and shown on 8 red LEDs, then buffered to the bus through a 74LS245 enabled by RO. Address lines are grounded temporarily and writes are done manually to show that power-up contents are random.

**Key facts**

- [C] Full RAM module parts (description): 2x 74LS189, 2x 74LS04, 1x 74LS173, 4x 74LS157, 1x 74LS245, 1x 74LS00, 14 LEDs (9 red, 4 yellow, 1 green), 3x 1k, 1x 0.01uF.
- [C] Wiring (ram.png): both 189s share A0-A3; CS-bar (pin 2) to GND; each O-bar goes to a 74LS04 inverter, then to an LED (220R in the schematic) and the 245 A side. 245 DIR to VCC, OE-bar = RO-bar. The WE-bar of both chips are tied together.
- [S] Power-up contents are random garbage until written.
- [S] The data inputs will later come from either the DIP switches (program mode) or the bus (run mode).

**Circuit.** 2x 74189 plus 2x 74LS04 (8 inverters) plus 74LS245 plus 8 LEDs; address and data temporarily hard-wired; manual WE.

**Component values.** LED resistors 220R (schematic).

**Lab ideas**

- Bare-RAM bench: address switches, data switches and a WE button. Power-on fills RAM randomly; write and read back, and toggle the inverters to see raw inverted outputs.
- Byte-split view showing which 189 holds which nibble.

_Sources: https://www.youtube.com/watch?v=uYXwCBo40iA, https://videohighlight.com/v/uYXwCBo40iA, https://eater.net/schematics/ram.png_

## 21. RAM module build - part 2

**Concept.** Adds the memory address register (74LS173, loaded from bus bits 0-3 by MI) and a 74LS157 mux that feeds the RAM address from either a 4-position DIP switch (program mode) or the MAR (run mode). An SPDT mode switch with red and green LEDs selects the mode.

**Key facts**

- [C] MAR (mar.png): 74LS173 U34 D inputs = BUS_0..3; G1/G2 (pins 9, 10) = MI-bar; M/N (pins 1, 2) = GND; CLK; CLR (pin 15, active high; it must not float high). Q goes to the 74LS157 B inputs (I1).
- [C] 74LS157 (datasheet): Select (pin 1) L selects A, H selects B; Strobe (pin 15) H forces outputs L, so it is tied to GND. Pins: 1A = 2, 1B = 3, 1Y = 4, 2A = 5, 2B = 6, 2Y = 7, 3Y = 9, 3B = 10, 3A = 11, 4Y = 12, 4B = 13, 4A = 14.
- [C] A inputs (I0) come from a 4-position DIP (SW5) whose switches close to GND; an open switch floats high. Mux outputs drive RAM A0-A3 plus 4 yellow LEDs.
- [C] Mode switch SW6 (SPDT): common to GND. Program position grounds the PROG/select line, lighting the red LED (anode through R63 1k from VCC) and selecting the DIP switches. Run position leaves select pulled high through the green-LED path (R64 1k) and lights green; the MAR is used.
- [S] The DIP switch is mounted rotated so that 'up = 1' reads intuitively.
- [S] With the MAR loaded from the bus, run mode shows the MAR contents.

**Circuit.** 74LS173 MAR, 74LS157 address mux, 4-position DIP switch, SPDT program/run switch, red and green mode LEDs with 1k resistors, 4 yellow address LEDs.

**Component values.** R63 = R64 = 1k (mode LEDs); address LEDs 220R (schematic).

**Lab ideas**

- Program/run mode lab: flip the switch to see the address source change (DIP vs MAR), with the red and green LEDs; load the MAR from the bus with MI and CLK.
- 74LS157 visualizer: per-channel A/B selection with select and strobe; floating-input-reads-1 behavior for open DIP switches.

_Sources: https://www.youtube.com/watch?v=KNve2LCcSRc, https://videohighlight.com/v/KNve2LCcSRc, https://eater.net/schematics/mar.png, https://eater.net/datasheets/74ls157.pdf_

## 22. RAM module build - part 3

**Concept.** Adds the data-input path: two 74LS157s choose RAM data from an 8-position DIP switch in program mode or from the bus in run mode. A third 157 section chooses the write signal: a manual pushbutton in program mode, or RI combined with the clock (74LS00 NAND) in run mode.

**Key facts**

- [C] Data muxes U26/U27 (ram.png): A (I0) = 8-position DIP SW3 to GND; B (I1) = BUS_0..7; select = PROG; strobe = GND; outputs to the 189 D1-D4.
- [C] Write mux U32 74LS157 (only channel c used): I0c (pin 14) = pushbutton SW4 to GND (program-mode write); I1c (pin 13) = NAND(RI, clock-pulse) from 74LS00 U31A; Zc (pin 12) = WE-bar of both 189s; select = PROG; strobe = GND.
- [S] Program mode: set the address and data DIPs and press the button to write. Run mode: when RI is high, the clock produces the WE-bar pulse.
- [S] All four 157 select pins are tied to the PROG line.

**Circuit.** 2x 74LS157 (8-bit data mux), 8-position DIP, 1x 74LS157 for WE selection, 74LS00 NAND gating RI with CLK, pushbutton.

**Component values.** None new (the RC edge detector comes in video 23).

**Lab ideas**

- Hand-programming lab: in program mode, enter a 16-byte program by setting the address DIP, data DIP and pressing WRITE. A memory map shows the contents. Then switch to run mode.
- Write-path diagram highlighting which source (button or RI and CLK) reaches WE-bar in each mode.

_Sources: https://www.youtube.com/watch?v=5rl1tEFXKt0, https://videohighlight.com/v/5rl1tEFXKt0, https://eater.net/schematics/ram.png_

## 23. RAM module testing and troubleshooting

**Concept.** Powers up and debugs the RAM module (an off-by-one wiring fault; unconnected TTL inputs read as 1). Ben tests RO and RI over the bus, labels the control signals, and adds an RC edge detector so RAM writes happen only briefly after the rising clock edge instead of during the whole high phase.

**Key facts**

- [C] Description: fix an issue and make RAM writes trigger on the rising edge of the clock.
- [S] Fault: some connections were shifted by one pin. Floating or unpowered inputs read as 1, which explains the 1s being written.
- [S] When both MI and RI are active with the same bus value, the address register changes too (normally only one is used); fixed by resetting to address 0.
- [S] Control-signal labels added: HLT, MI, RI, RO, IO, II.
- [C] Edge detector (ram.png): CLK feeds C7 = 0.01uF in series, R58 = 1k to GND, and that node goes to the U31A NAND input together with RI. WE-bar is low only for about tau = RC = 10 us after each rising edge (value per summary and schematic).
- [I] Purpose: make the RAM behave like the edge-triggered registers, so data can't be written while the bus or address changes during the clock-high phase.

**Circuit.** The RAM module from videos 20-22 plus an RC differentiator (0.01uF and 1k) between CLK and the NAND gate that forms the run-mode WE-bar.

**Component values.** C7 = 0.01uF, R58 = 1k, tau = 10 us.

**Lab ideas**

- Write-timing comparison: WE-bar = NAND(RI, CLK) (level, writes throughout clock-high) versus NAND(RI, RC-pulse). Make the bus change mid-high-phase and see the wrong byte stored in the level version.
- RC pulse scope: adjust R and C and see the pulse width relative to the LS-TTL threshold.
- Troubleshooting puzzle: an off-by-one data wire; the user finds it by writing patterns such as 00000001 and walking the 1.

_Sources: https://www.youtube.com/watch?v=Vw3uDOUJRGw, https://videohighlight.com/v/Vw3uDOUJRGw, https://eater.net/schematics/ram.png_

## 24. JK flip-flop

**Concept.** Builds up from the SR latch to a gated SR latch, then an SR flip-flop with an edge-detected clock, then a JK flip-flop. The JK feeds Q and Q-bar back into the input AND gates, so J = K = 1 toggles instead of giving the invalid state. Toggling is what counters need.

**Key facts**

- [C] Description: J = 1, K = 0 sets; J = 0, K = 1 resets; J = 1, K = 1 toggles (J and K are the renamed S and R).
- [S] SR flip-flop: inputs gated by a short clock pulse (rising-edge detector); S = R = 1 at the edge is still invalid.
- [S] JK: J AND Q-bar AND pulse drives set; K AND Q AND pulse drives reset (3-input ANDs). Only the input that changes the state can act, so 11 toggles.
- Characteristic equation: Q(next) = J*Q-bar + K-bar*Q; truth table 00 hold, 01 reset, 10 set, 11 toggle.

**Circuit.** Conceptual (built in video 25): NOR SR latch, 3-input AND gates with Q and Q-bar feedback, edge-detected clock.

**Component values.** None.

**Lab ideas**

- Stepwise evolution panel: SR latch, gated SR, SR flip-flop, JK flip-flop. At each step, try S = R = 1 or J = K = 1 and see the outcome.
- Characteristic-table quiz: given Q, J and K, predict Q after the edge, then verify.

_Sources: https://www.youtube.com/watch?v=F1OC5e7Tn_o, https://videohighlight.com/v/F1OC5e7Tn_o_

## 25. JK flip-flop racing

**Concept.** Builds the edge-triggered JK flip-flop and shows it fails at J = K = 1. While the RC clock pulse is still high, the output toggles, feeds back and toggles again many times (racing, or race-around), ending in an unpredictable state. Shrinking the pulse helps but breadboard parasitics make it unreliable.

**Key facts**

- [C] Parts in the description: 74LS02, 74LS11 (3-input AND), 2 LEDs, 2 tact switches, 3x 1k, 1x 100R, 1x 0.001uF, clock module.
- [S] Edge detector: 0.001uF (1nF) with 1k gives tau = 1 us (the AI summary says '100us', an arithmetic error). Replacing the 1k with 100R gives tau = 100 ns, still too long or unreliable.
- [S] On the scope the output oscillates during the pulse (the summary cites about 82 ns per toggle period); the final state depends on how many toggles fit in the pulse.
- [S] A pulse of only a few ns would be needed. Stray breadboard capacitance means even a hand near the board changes the behavior.
- [I] The race happens because the feedback loop delay (about 2-3 gate delays) is shorter than the clock-pulse width.

**Circuit.** 74LS02 cross-coupled NOR latch plus 74LS11 3-input ANDs (J, pulse, Q-bar) and (K, pulse, Q); RC differentiator on the clock; button inputs with 1k pull-downs; LEDs on Q and Q-bar.

**Component values.** C = 0.001uF (1nF); R = 1k (tau = 1 us), then 100R (tau = 100 ns); 1k pull-downs.

**Lab ideas**

- Racing simulator: sliders for clock-pulse width (1 ns-2 us) and per-gate delay (5-15 ns). Show the number of toggles during the pulse and a histogram of final states over many trials.
- Scope view of CLK-pulse and Q showing the oscillation burst; add a 'stray capacitance / hand proximity' jitter knob.
- Fix-it challenge: find the maximum pulse width that toggles exactly once for a given loop delay.

_Sources: https://www.youtube.com/watch?v=st3mUEub99E, https://videohighlight.com/v/st3mUEub99E_

## 26. Master-slave JK flip-flop

**Concept.** Solves racing with a master-slave JK: two SR latches. The master is enabled while CLK is high and the slave while CLK is low (through an inverter). The feedback comes from the frozen slave, so only one toggle per clock is possible and the output changes on the falling edge. The video ends by introducing the 74LS76 dual JK with preset and clear.

**Key facts**

- [C] Parts in the description: 74LS02, 74LS11, 74LS08, 74LS04, 4 LEDs, 2 tact switches, 2x 1k, clock module.
- [S] Master: J AND Q-bar(slave) AND CLK, and K AND Q(slave) AND CLK, via 74LS11 into a NOR latch. Slave: master Q and Q-bar ANDed with NOT CLK (74LS04 plus 74LS08) into a second NOR latch.
- [S] The output updates when CLK goes high then low (falling-edge behavior); the clock symbol gets a bubble.
- [S] J = K = 1 toggles exactly once per clock with no racing; no tight timing needed.
- [C] 74LS76 pinout (output.png): 1CLK = 1, 1PRE-bar = 2, 1CLR-bar = 3, 1J = 4, VCC = 5, 2CLK = 6, 2PRE-bar = 7, 2CLR-bar = 8, 2J = 9, 2Q-bar = 10, 2Q = 11, 2K = 12, GND = 13, 1Q-bar = 14, 1Q = 15, 1K = 16. PRE and CLR are active low and asynchronous.
- [C] eater.net: the 74LS76 is hard to find; the 74LS107 is functionally equivalent but has a different pinout (and no preset).

**Circuit.** Two NOR SR latches (74LS02); master gating with 74LS11 3-input ANDs; slave gating with 74LS08 and inverted clock (74LS04); 4 LEDs on the master and slave outputs.

**Component values.** 2x 1k (button pull-downs).

**Lab ideas**

- Master/slave viewer: four LEDs (master Q/Q-bar, slave Q/Q-bar). Step CLK high and low separately to see the master capture on high and the slave update on low.
- Same J = K = 1 stress test as the racing lab: zero races regardless of pulse width.
- 74LS76 chip widget with PRE, CLR, J, K and CLK pins, with a 74LS107 pinout toggle.

_Sources: https://www.youtube.com/watch?v=rXHSB5w7CyE, https://videohighlight.com/v/rXHSB5w7CyE, https://eater.net/schematics/output.png, https://eater.net/8bit/parts_

## 27. Binary counter

**Concept.** Uses 74LS76 JK flip-flops in toggle mode (J = K = 1, PRE and CLR inactive) as divide-by-2 stages. Chaining each stage's Q into the next stage's falling-edge clock makes a ripple counter: the four LEDs count in binary 0-15.

**Key facts**

- [C] Parts in the description: '4x 74LS76', 4 LEDs, clock module. Two dual chips would be enough for 4 bits; the count of 4 is unverified.
- [S] Setup: VCC and GND, PRE-bar and CLR-bar high (inactive; both low is invalid), J = K = high, clock in.
- [S] Each stage toggles on the falling edge of its clock, so its output has half the frequency. N stages divide by 2^N.
- [I] Feeding Q (not Q-bar) to the next falling-edge clock gives an up-count; bit 0 = first stage.
- [I] A ripple counter shows brief intermediate states because the stages change one after another (this motivates the synchronous 74LS161 later).

**Circuit.** Four JK flip-flops in toggle mode, Q(n) to CLK(n+1), with LEDs on each Q; the first stage is clocked by the 555 clock.

**Component values.** None specified.

**Lab ideas**

- 4-bit ripple counter with LEDs and a decimal readout; a clock speed slider; frequency of each bit shown.
- Ripple-delay microscope: slow-motion propagation (for example 20 ns per stage) showing glitch states such as 0111 to 0110 to 0100 to 0000 to 1000.
- Divider chain: show the waveforms of each stage stacked (f, f/2, f/4, f/8, f/16).

_Sources: https://www.youtube.com/watch?v=exGEmA67dNc, https://videohighlight.com/v/exGEmA67dNc_

## 28. Program counter design

**Concept.** Specifies the program counter: a 4-bit counter (16 RAM addresses) that increments when CE (count enable) is high, drives the bus low nibble through a tri-state buffer when CO (counter out) is asserted, and loads a value from the bus on J (jump). It uses the 74LS161 synchronous counter, which has async clear, synchronous parallel load and count enables.

**Key facts**

- [C] Chapters: 0:34 The Program Counter, 1:42 Program Counter Out, 4:19 Count Enable Input Signal, 7:26 Functionality.
- [C] Signals (pc.png): CE drives CEP (pin 7) and CET (pin 10) of the 74LS161; CO-bar drives the 245 OE-bar; J-bar drives PE-bar (pin 9); CLR-bar drives MR-bar (pin 1); CLK drives CP (pin 2).
- [C] 74LS161 (datasheet): clear is asynchronous (MR-bar low gives Q = 0 immediately); load is synchronous (PE-bar low loads P0-P3 on the rising CP edge regardless of the enables); counts on the rising edge when CEP = CET = 1 and PE-bar = 1; otherwise holds; TC (pin 15) = CET AND Q0..Q3.
- [C] Pins: P0-P3 = 3-6, Q0-Q3 = 14, 13, 12, 11, GND = 8, VCC = 16.
- [I] Ben contrasts this with the JK ripple counter from video 27; the 161 is synchronous and presettable.

**Circuit.** Design only: 74LS161 plus 74LS245 with CE, CO, J, CLR and CLK.

**Component values.** None.

**Lab ideas**

- 74LS161 mode table explorer: MR-bar, PE-bar, CEP, CET and CLK controls with a highlighted active row (clear, load, count, hold) and the TC output.
- PC on a bus: CE stepping, CO to bus, J loading from bus switches, with a timing diagram.

_Sources: https://www.youtube.com/watch?v=g_1HyxBzjl0, https://eater.net/8bit/pc, https://eater.net/schematics/pc.png, https://eater.net/datasheets/74ls161.pdf_

## 29. Program counter build

**Concept.** Builds the program counter module from one 74LS161, one 74LS245 and 4 LEDs. Ben tests counting, output to the bus and jump (loading from the bus).

**Key facts**

- [C] Parts in the description: 1x 74LS161, 1x 74LS245, 4 LEDs.
- [C] Wiring (pc.png): bus bits 0-3 go to P0-P3 and also to the 245 A4..A7 side. Q0-Q3 go to the 245 B7..B4 (the order is reversed in the KiCad drawing but maps bit-for-bit) and to 4 green LEDs (220R). 245 DIR = GND (B to A, counter to bus) and OE-bar = CO-bar; the unused 245 channels are not connected. CEP and CET are tied together to CE; TC is unused.
- [I] Tests: count with CE high; CO puts the count on the bus; set a bus value and pulse J to jump.

**Circuit.** 74LS161 4-bit counter plus 74LS245 (4 channels used) plus 4 LEDs; signals CE, CO-bar, J-bar, CLR-bar, CLK.

**Component values.** LED resistors 220R (schematic).

**Lab ideas**

- PC module bench with CE, CO and J switches, a bus value input and clock stepping; LEDs plus a bus readout.
- Combined drill: PC plus MAR plus RAM; CO and MI then CE to walk through memory addresses and display the RAM contents.

_Sources: https://www.youtube.com/watch?v=tNwU7pK_3tk, https://eater.net/schematics/pc.png_

## 30. Designing a 7-segment hex decoder

**Concept.** Designs combinational logic that turns 4 input bits into a hex digit on one common-anode 7-segment display. Each segment has its own truth-table column and is built from AND (minterm) and OR gates with inverted inputs. The large chip count motivates replacing the logic with an EEPROM.

**Key facts**

- [C] Description parts: 5x 74LS32, 9x 74LS08, 1x 74LS04, 1 common-anode 7-segment display with a single 100R resistor, DIP switches, LEDs and 1k pull-ups on the inputs.
- [C] Segment bit order (later EEPROM code): bit7 = dp, bit6 = a, bit5 = b, bit4 = c, bit3 = d, bit2 = e, bit1 = f, bit0 = g. Common-cathode patterns 0-F: 7E 30 6D 79 33 5B 5F 70 7F 7B 77 1F 4E 3D 4F 47. Common-anode = bitwise NOT: 81 CF 92 86 CC A4 A0 8F 80 84 88 E0 B1 C2 B0 B8 (eeprom-programmer.ino).
- [Derived from the table] Segment OFF sets: a {1,4,b,d}; b {5,6,b,C,E,F}; c {2,C,E,F}; d {1,4,7,A,F}; e {1,3,4,5,7,9}; f {1,2,3,7,d}; g {0,1,7,C}. B and D display as lowercase 'b' and 'd'.
- Segment layout: a top, b upper-right, c lower-right, d bottom, e lower-left, f upper-left, g middle, dp decimal point. Common anode means a segment is lit when its pin is driven LOW.
- [I] Method: one row per input combination (AND of true or inverted inputs), ORed per segment. The exact simplification and gate sharing Ben used is not verified.
- [C] Description: even this is 'pretty complicated'; 8-bit to 3-digit decimal would be far worse, so later videos use EEPROMs for the output register and control logic.

**Circuit.** 4 DIP-switch inputs with 1k pull-ups; 74LS04 producing complemented inputs; 74LS08 AND trees forming minterms; 74LS32 OR trees per segment; outputs to the 7 cathode-side segment pins of a common-anode display (common pin to +5V through 100R).

**Component values.** 100R on the display common; 1k input pull-ups.

**Lab ideas**

- Truth-table-to-gates lab: the user edits the 16x7 truth table; the lab auto-generates the SOP and a K-map per segment and counts the 2-input AND and OR gates (compare with 9x 74LS08 and 5x 74LS32).
- Interactive 7-segment display driven by 4 switches, with a common anode or cathode toggle (output inversion) and a 'single shared resistor' brightness effect (dimmer with more segments lit).
- Segment equation quiz: given segment c, derive the minimal expression and verify all 16 inputs.

_Sources: https://www.youtube.com/watch?v=7zffjsXqATg, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/eeprom-programmer/eeprom-programmer.ino, https://github.com/tardate/LittleArduinoProjects/tree/master/playground/LED7Segment/CombinationalLogicDriver_

## 31. Using an EEPROM to replace combinational logic

**Concept.** Introduces ROM types and the 28C16 (2K x 8) parallel EEPROM: wiring for reading, write timing from the datasheet, and a manual write circuit. Ben programs a few bytes by hand, then shows the EEPROM as a lookup table: address = input bits, data = outputs. That replaces the hex decoder's gates.

**Key facts**

- [C] Description parts: 28C16, 8 LEDs plus 8x 330R, 8-position DIP, 4-position DIP, 12x 10k, 1x 100nF, 1x 680R, tact switch, common-anode 7-segment display, 100R.
- [S] Chapters: types of ROM (mask ROM, PROM, EPROM, EEPROM), pinout, wiring the data pins, address setup, initial read test, write timing, building a write circuit, programming, ROM as combinational logic.
- [C] 28C16 (datasheet): 2048 x 8 with 11 address lines A0-A10; read access 150 ns; byte write is self-timed, up to 1 ms ('200 us or 1 ms'). WE-bar pulse width tWP is 100 ns min and 1000 ns max. Address setup 10 ns, address hold 50 ns, data setup 50 ns, data hold 10 ns. Address is latched on the falling WE-bar/CE-bar edge and data on the rising edge. Writes are inhibited if OE-bar is low, CE-bar is high or WE-bar is high.
- [C] Pinout (output.png and control.png): A7 = 1, A6 = 2, A5 = 3, A4 = 4, A3 = 5, A2 = 6, A1 = 7, A0 = 8, I/O0 = 9, I/O1 = 10, I/O2 = 11, GND = 12, I/O3 = 13 .. I/O7 = 17, CE-bar = 18, A10 = 19, OE-bar = 20, WE-bar = 21, A9 = 22, A8 = 23, VCC = 24.
- [I] Manual setup: A0-A3 from the 4-position DIP and data from the 8-position DIP, each with a 10k pull-down (12 total), other addresses grounded; LEDs with 330R on I/O. The write pulse comes from the tact switch through an RC network (680R plus a capacitor) to meet the 1 us maximum. The description's 100nF would give tau = 68 us, so the actual capacitor value and network are unverified.
- [C] The final programmed data for the hex digits is the common-anode table 81 CF 92 86 CC A4 A0 8F 80 84 88 E0 B1 C2 B0 B8.

**Circuit.** 28C16 with A0-A3 on DIP switches (10k pull-downs) and A4-A10 grounded; I/O0-7 to LEDs (330R) and to the data DIP switches (10k pull-downs) for writing; CE-bar low; OE-bar controlled for read or write; WE-bar from a pushbutton through an RC pulse shaper; later I/O drives a common-anode display (100R).

**Component values.** 10k x 12 pull-downs; 330R x 8 LED resistors; 680R plus capacitor (100nF per the description) for the WE pulse; 100R display resistor.

**Lab ideas**

- Manual EEPROM programming console: address and data DIP switches, an OE toggle and a WE button with a configurable pulse width. The lab enforces tWP 100-1000 ns, shows the write-cycle busy time (up to 1 ms) and reads back.
- 'ROM is a truth table': load the hex-decoder table into a 16-byte region and drive a 7-segment display from the address switches; edit any byte to change a glyph.
- Datasheet timing diagram explorer for the read and write cycles, with draggable edges validated against tAS, tAH, tDS, tDH and tWP.

_Sources: https://www.youtube.com/watch?v=BA12Z7gQ4P0, https://eater.net/datasheets/28c16.pdf, https://eater.net/schematics/output.png, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/eeprom-programmer/eeprom-programmer.ino_

## 32. Build an Arduino EEPROM programmer

**Concept.** Builds an Arduino Nano programmer for the 28C16. Two cascaded 74HC595 shift registers supply the 11 address lines plus OE-bar from 3 Arduino pins. Eight Arduino pins connect directly to the EEPROM's data lines and one pin drives WE-bar. The sketch implements setAddress, readEEPROM, writeEEPROM and a hex dump, then writes the 7-segment table.

**Key facts**

- [C] Wiring (schematic.png): D2 to SER (pin 14) of 595 #1; D3 to SRCLK (pin 11) of both; D4 to RCLK (pin 12) of both; 595 #1 QH' (pin 9) to SER of #2; SRCLR-bar (pin 10) to VCC; G-bar/OE-bar (pin 13) to GND. #1 QA..QH go to A0..A7. #2 QA..QC go to A8..A10 (QA..QG = A8..A14 for a 28C256). #2 QH (pin 7) goes to EEPROM OE-bar. D5..D12 go to I/O0..I/O7, D13 to WE-bar, and EEPROM CE-bar to GND.
- [C] setAddress(address, outputEnable): shiftOut(SHIFT_DATA, SHIFT_CLK, MSBFIRST, (address >> 8) | (outputEnable ? 0x00 : 0x80)); shiftOut(SHIFT_DATA, SHIFT_CLK, MSBFIRST, address); then LATCH LOW, HIGH, LOW. Bit 0x80 of the first byte ends up on QH of #2, which is OE-bar.
- [C] readEEPROM: data pins to INPUT, setAddress(addr, true), then read D12 down to D5 MSB-first: data = (data << 1) + digitalRead(pin).
- [C] writeEEPROM: setAddress(addr, false) (OE-bar high), data pins to OUTPUT, write bits LSB-first to D5..D12, WE-bar LOW, delayMicroseconds(1), WE-bar HIGH, then delay(10) ms for the write cycle.
- [C] Serial at 57600 baud. printContents dumps 0x000-0x0FF as '%03x:  %02x x8   %02x x8'. Erase writes 0xFF to all 0..2047. The default data written is the common-anode hex table (the common-cathode table is commented out).
- [S] 74HC595 explained: chained D flip-flops sharing SRCLK form the shift register; a separate storage register latched by RCLK updates all outputs at once. MR is tied high and OE low.
- [S] Ben tests with 11 LEDs on the 595 outputs before connecting the EEPROM.

**Circuit.** Arduino Nano plus 2x 74HC595 (cascaded) plus 28C16 (or 28C64/28C256).

**Component values.** WE pulse is about 1 us (delayMicroseconds(1)), within tWP 100-1000 ns plus overhead. Post-write delay is 10 ms. Baud 57600.

**Lab ideas**

- Shift-register animation: shiftOut 16 bits MSB-first into two cascaded 595s, bit by bit, then pulse RCLK and watch all 16 outputs update at once; the OE bit is highlighted.
- Programmer simulator: step through readEEPROM and writeEEPROM line by line with pin states (D2-D13), the address bus, OE-bar, WE-bar and the data bus shown on a logic-analyzer view.
- Serial monitor emulator: run erase, program and dump on a virtual 28C16 and get the exact hex-dump format; edit the data array and reprogram.

_Sources: https://www.youtube.com/watch?v=K88pgWhEb1M, https://videohighlight.com/v/K88pgWhEb1M, https://github.com/beneater/eeprom-programmer, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/eeprom-programmer/eeprom-programmer.ino, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/schematic.png_

## 33. Build an 8-bit decimal display for our 8-bit computer

**Concept.** One 28C16 decodes an 8-bit value into 4 digits (sign, hundreds, tens, ones) by multiplexing. A fast 555 clock drives a 2-bit counter (74LS76) that picks the digit through EEPROM A8-A9 and enables one common-cathode display at a time through a 74LS139. A10 switches between unsigned and two's-complement mode.

**Key facts**

- [C] Description parts: 28C16, 555, 74LS76, 74LS139, 4 common-cathode displays, 1x 1k, 1x 100k, 2x 10nF.
- [C] Wiring (output.png): 555 U39 astable with R65 = 1k (VCC to DIS), R66 = 100k (DIS to THR/TRIG), C8 = 0.01uF timing, C9 = 0.01uF on CV. Its output clocks 74LS76 FF A (J = K = PRE = CLR = VCC); FF A's Q-bar clocks FF B. FF A Q-bar goes to 139 A0 and EEPROM A8; FF B Q-bar goes to 139 A1 and EEPROM A9. 139 E-bar = GND. Active-low Y0..Y3 drive the display common cathodes: Y0 = rightmost (ones), Y1 = tens, Y2 = hundreds, Y3 = leftmost (sign).
- [C] EEPROM D0..D7 go to segments g, f, e, d, c, b, a, dp of all 4 displays in parallel. OE-bar and CE-bar to GND, WE-bar to VCC. A0..A7 come from the 74LS273 output register. A10 comes from the SPDT signed-mode switch to VCC with a 10k pull-down (R104).
- [C] EEPROM map (multiplexed-display.ino): unsigned: addr = value + 0 (ones, digits[v%10]), +256 (tens, digits[(v/10)%10]), +512 (hundreds, digits[(v/100)%10]), +768 (sign = 0x00, blank). Signed: addr = (byte)v + 1024 / 1280 / 1536 using abs(v)%10, abs(v/10)%10, abs(v/100)%10; +1792 sign = 0x01 (segment g, the minus) if v < 0, else 0. digits[] = 7E 30 6D 79 33 5B 5F 70 7F 7B.
- [Derived] Leading zeros are shown (7 displays as ' 007'). Signed range -128..127.
- [Derived] 555: tH = 0.693 x 101k x 10nF = 0.70 ms, tL = 0.693 x 100k x 10nF = 0.69 ms, f = 1.44/(201k x 10nF), about 717 Hz. Each digit is lit for about 1.4 ms, and the 4-digit frame repeats at about 179 Hz.
- [S] Chapters: 'adjust the speed of our clock' (slowed to show the multiplexing, then sped up), 'start at memory location 1024' (signed mode).

**Circuit.** 555 astable at about 717 Hz to a 74LS76 2-bit ripple counter, which feeds the 74LS139 digit select (active-low commons) and EEPROM A8/A9. 74LS273 value to A0-A7; mode switch to A10; 28C16 data to shared segment lines.

**Component values.** R65 = 1k, R66 = 100k, C8 = C9 = 10nF (0.01uF); R104 = 10k pull-down on A10.

**Lab ideas**

- Multiplex slow-motion: a 555 frequency slider from 1 Hz to 1 kHz shows one digit at a time at low speed and a steady 4-digit display at high speed (persistence-of-vision simulation with LED decay).
- EEPROM content explorer: enter a value and mode, and the lab computes all 4 addresses (mode<<10 | digit<<8 | value) with the stored bytes and lit segments; a full 2 KB hex view.
- Signed/unsigned toggle: the same 8-bit pattern (for example 0xF6) shows 246 or -10.

_Sources: https://www.youtube.com/watch?v=dLh1n2dErzE, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/multiplexed-display/multiplexed-display.ino, https://eater.net/schematics/output.png, https://eater.net/8bit/output_

## 34. 8-bit computer build: Connecting the bus

**Concept.** Builds the output register (a 74LS273 that latches the bus into the display EEPROM's address lines). The 273 has no load-enable, so its clock is gated with AND(OI, CLK). Ben then joins every module to one common bus and clock, adds 10k pull-downs so an undriven bus reads 0, and tests transfers.

**Key facts**

- [C] Description: output register = 74LS273 (octal D flip-flop with clear) plus 74LS08; the bus needs 8x 10k plus 8 LEDs.
- [C] Output schematic: 74LS08 U46A ANDs OI with CLK, driving 273 CP (pin 11). 273 MR-bar (pin 1) = CLR-bar. D0..D7 = BUS_0..7 (pins 3, 4, 7, 8, 13, 14, 17, 18); Q0..Q7 (pins 2, 5, 6, 9, 12, 15, 16, 19) go to EEPROM A0..A7.
- [C] Bus (high-level.png): 8x 10k pull-downs to GND (R8-R15) plus 8 red LEDs with 220R; all modules share CLK and CLR.
- [C] eater.net: the bus LEDs can sit on the breadboard below the IR instead of being soldered.
- [I] Without the pull-downs a floating bus reads 0xFF (seen in video 13); with them it reads 0x00.

**Circuit.** 74LS273 plus 74LS08 clock gate plus decimal display (video 33); a bus joining the PC, MAR/RAM, IR, A, ALU, B and output; 10k pull-downs and bus LEDs.

**Component values.** 8x 10k bus pull-downs; bus LED resistors 220R (schematic).

**Lab ideas**

- Assembled datapath: all modules on a bus with manual control switches. Transfer A to OUT and see the decimal display.
- Floating vs pull-down toggle showing what each register loads when nothing drives the bus.
- Clock-gating lab: 273 with CP = CLK AND OI. Show a glitch if OI changes while CLK is high, and why the control logic changes signals on the falling edge.

_Sources: https://www.youtube.com/watch?v=-6JAgFWCL9w, https://eater.net/8bit/bus, https://eater.net/schematics/output.png, https://eater.net/schematics/high-level.png_

## 35. 8-bit CPU control signal overview

**Concept.** Lists every control signal and wires it to a central control area with indicator LEDs. Active-low module inputs are inverted with 74LS04s so that the whole control word reads active-high. The HLT line is connected to the clock.

**Key facts**

- [C] Description parts: 15 control LEDs, 15x 470R for the control LEDs, 15x 470R for the bus LEDs, 2x 74LS04 (optional, makes the control word easier to read), red gel over the LEDs for filming.
- [C] Signals in final bit order (microcode .ino, bit 15 to bit 0): HLT, MI, RI, RO, IO, II, AI, AO, EO, SU, BI, OI, CE, CO, J, FI (FI is added in video 43, making 16).
- [C] Inverted on the control board (control.png): MI, RO, IO, II, AI, AO (U49) and EO, BI, CO, J, FI (U53). HLT, RI, SU, OI and CE pass straight through (active high at the modules).
- [C] Meanings: HLT halt clock; MI MAR in; RI RAM in; RO RAM out; IO IR out (low nibble); II IR in; AI/AO A in/out; EO ALU (sum) out; SU subtract; BI B in; OI output register in; CE counter enable; CO counter out; J jump (PC load); FI flags in.
- [S] Chapters: halt signal 1:45; memory and RAM; IR; A and ALU; B; output and PC; control panel overview 9:30.

**Circuit.** 16 (initially 15) control lines, each with an LED (blue in the schematic, 220R), routed to their modules; 74LS04s for the active-low lines; HLT to the clock module.

**Component values.** 470R LED resistors (description); 220R in the KiCad schematic; eater.net parts list has 24x 470R.

**Lab ideas**

- Control panel: 16 toggle switches and LEDs driving the full simulated computer. The user performs transfers by hand (for example CO+MI, clock, RO+II+CE, clock).
- Active-high vs active-low view: show the logical control word and the actual pin voltages after the inverters.
- Signal glossary hover map highlighting each signal's destination pins on the high-level schematic.

_Sources: https://www.youtube.com/watch?v=AwUirxi9eBg, https://eater.net/schematics/control.png, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-programmer/microcode-eeprom-programmer.ino_

## 36. 8-bit CPU control logic: Part 1

**Concept.** Ben defines a small machine language: LDA, ADD, OUT and later HLT. He hand-assembles a program into RAM in program mode, then executes it by setting the control signals himself for every clock cycle: fetch (two steps) followed by each instruction's execute steps.

**Key facts**

- [C] Opcodes: LDA 0001, ADD 0010, OUT 1110 (HLT 1111 is added in Part 3).
- [I/community] Program: addr 0 LDA 14 (0x1E), 1 ADD 15 (0x2F), 2 OUT (0xE0), [3 HLT (0xF0) later], 14: 28 (0x1C), 15: 14 (0x0E). The output is 42.
- [C] Microsteps (microcode .ino): T0 CO|MI; T1 RO|II|CE (fetch). LDA: T2 IO|MI, T3 RO|AI. ADD: T2 IO|MI, T3 RO|BI, T4 EO|AI. OUT: T2 AO|OI.
- [S] Chapters: Program definition, Programming the computer, Manual program execution, Instruction fetch cycle 7:56, Executing load 13:29, add 15:28, Outputting results 21:04.
- [I] IO puts only the IR's low 4 bits (the operand address) on the bus.

**Circuit.** The complete datapath with control lines set by hand through jumpers or switches; RAM programmed with DIP switches.

**Component values.** None.

**Lab ideas**

- Be-the-control-unit game: the user sets control switches each cycle to run LDA/ADD/OUT. The lab validates against the reference microcode and explains wrong choices (for example two drivers on the bus).
- Hand-assembler: mnemonic to binary for the 16 RAM bytes, then load into the RAM DIP-switch view.

_Sources: https://www.youtube.com/watch?v=dXdoim96v5A, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-programmer/microcode-eeprom-programmer.ino, https://circuitverse.org/users/301558/projects/8-bit-computer-0134d5a5-ec49-49ea-a442-8d1ffd5b8576_

## 37. 8-bit CPU control logic: Part 2

**Concept.** Separates instructions from microinstructions. A step counter (74LS161) clocked on the inverted clock is decoded by a 74LS138 into step lines T0..T7 shown on LEDs. Control signals then change on the falling edge and are stable at the rising edge when registers latch. A quick hard-wired fetch cycle shows instruction fetching working.

**Key facts**

- [C] Description: 'ring counter' for the instruction cycle plus a quick-and-dirty fetch implementation.
- [C] Step counter (control.png): 74LS161 U48 with CP = CLK-bar; PE-bar, CEP and CET to VCC; P0-P3 not connected. Q0-Q2 go to 74LS138 A0-A2 (pins 1-3) and to EEPROM A0-A2. Red LEDs (220R) show Q0-Q2.
- [C] 74LS138: E3 (pin 6) = VCC, E1-bar and E2-bar (pins 4, 5) = GND; outputs O0-O7 are active low (O0 = 15 .. O4 = 11, O5 = 10). Green LEDs on O0-O4 (anodes through 220R to VCC).
- [C] Final: O5 low resets the counter through the NAND logic to MR-bar, so steps are T0..T4 (5 clocks per instruction); CLR-bar also resets it.
- [S] Clock inversion: steps advance on the CLK falling edge, so control lines settle half a cycle before the rising edge that latches the bus.
- [I] Exactly when the reset-at-T5 shortcut was added (this video's 'optimization' or later) is unverified.

**Circuit.** 74LS161 (clocked by CLK-bar) to 74LS138 3-to-8 decoder to step LEDs; temporary wiring from T0/T1 to the CO, MI, RO, II and CE lines for fetch.

**Component values.** LED resistors 220R (schematic).

**Lab ideas**

- Timing diagram: CLK, CLK-bar, step count, T0..T4 and the control signals. Toggle between 'counter on CLK' and 'counter on CLK-bar' and show the race at the latch edge in the first case.
- Step-decoder widget: 161 count to 138 active-low outputs to LEDs, with the reset-at-T5 path highlighted.
- Hard-wired fetch: run T0/T1 only and watch the IR fill with successive RAM bytes as the PC increments.

_Sources: https://www.youtube.com/watch?v=X7rCxs1ppyY, https://eater.net/schematics/control.png, https://eater.net/datasheets/74ls138.pdf, https://eater.net/datasheets/74ls161.pdf_

## 38. 8-bit CPU control logic: Part 3

**Concept.** Replaces hard-wiring with two 28C16 EEPROMs used as a microcode lookup table. Address = step (3 bits) + opcode (4 bits) + a chip-select bit; data = 8 control lines per chip, 16 in total. At the end Ben runs the first full program and adds HLT.

**Key facts**

- [C] Address map (control.png): A0-A2 = step Q0-Q2; A3-A6 = IR_4..IR_7 (opcode); A7 = GND on U47 (left) and VCC on U52 (right), so one image holds both bytes; A8 = CF and A9 = ZF after video 43 (GND before); A10 = GND. OE-bar and CE-bar = GND, WE-bar = VCC.
- [C] U47 (high byte) D7..D0 = HLT, MI, RI, RO, IO, II, AI, AO. U52 (low byte) D7..D0 = EO, SU, BI, OI, CE, CO, J, FI.
- [C] 16 blue indicator LEDs (220R) show the active-high control word before the inverters.
- [S] Chapter list includes 'program the micro codes for the load', 'cycle through all of the possible instructions', 'add a halt' (40:14).
- [I] The first full program, LDA 14 / ADD 15 / OUT / HLT with 28 and 14, outputs 42.

**Circuit.** 2x 28C16 addressed by the step counter and IR high nibble, plus the A7 select tie; outputs through the 74LS04 inverters to the module control inputs.

**Component values.** LED resistors 220R (schematic).

**Lab ideas**

- Microcode ROM viewer: enter an opcode and step and see the address computed (step | opcode<<3 | sel<<7 | flags<<8) and both EEPROM bytes decoded into signal names.
- Editable microcode table: change a microstep (for example drop CE from T1) and rerun the program to observe the bug.
- Run-the-42-program with step-by-step highlighting of the EEPROM row being read.

_Sources: https://www.youtube.com/watch?v=dHWFpkGsxOs, https://eater.net/8bit/control, https://eater.net/schematics/control.png_

## 39. 8-bit CPU reset circuit and power supply tips

**Concept.** Adds a reset button that clears all registers, the PC, the output register and the microstep counter in one action, using NAND gates to make CLR and CLR-bar. Then gives power distribution tips: voltage drop along long breadboard rails, adding power feed wires and a sturdier supply connection.

**Key facts**

- [C] Reset (control.png): SW8 pushbutton to VCC with R75 = 1k pull-down. 74LS00 U51C (inputs 9, 10 tied) gives CLR-bar; U51D (12, 13 tied) gives CLR.
- [C] CLR (active high) goes to 74LS173 CLR on A, B, IR, MAR and flags. CLR-bar goes to 74LS161 PC MR-bar and 74LS273 output MR-bar.
- [C] Step counter MR-bar = CLR-bar AND O5-bar, built as U51B NAND(O5-bar, CLR-bar) followed by U51A NAND used as an inverter.
- [C] eater.net notes: instead of soldering a USB cable for power you can use a DC wall plug with a screw-terminal adapter, and multiple wires make the connection more robust.
- [I] The video measures the supply sagging across boards and adds parallel feed wires to the rails; it also references Julian Ilett's channel.

**Circuit.** 74LS00 (4 NANDs): reset button logic plus step-counter reset combination; distribution of CLR and CLR-bar to all modules.

**Component values.** R75 = 1k pull-down on the reset button.

**Lab ideas**

- Reset lab: press reset mid-program and see which state elements clear (A, B, IR, MAR, flags, PC, OUT, step) and which keep their contents (RAM).
- Power-rail drop calculator: model the breadboard rail resistance and per-module current, and show the voltage at each board. Below about 4.75 V the simulated logic gets flaky; adding feed wires fixes it.

_Sources: https://www.youtube.com/watch?v=HtFro0UKqkk, https://eater.net/8bit/control, https://eater.net/schematics/control.png_

## 40. Reprogramming CPU microcode with an Arduino

**Concept.** Rewrites the microcode-programming sketch so it is readable. Each control signal is a #define bit mask, and the microcode is a table of 16 instructions x 8 steps of uint16_t control words. The sketch writes the high bytes to addresses 0-127 and the low bytes to 128-255 (A7 = byte select) of each EEPROM.

**Key facts**

- [C] #defines: HLT 0x8000, MI 0x4000, RI 0x2000, RO 0x1000, IO 0x0800, II 0x0400, AI 0x0200, AO 0x0100, EO 0x0080, SU 0x0040, BI 0x0020, OI 0x0010, CE 0x0008, CO 0x0004, J 0x0002 (FI 0x0001 later).
- [C] data[128]: 16 rows of 8 steps; every row starts with MI|CO, RO|II|CE. NOP and the unused opcodes are fetch only. Table: LDA, ADD (EO|AI), SUB (EO|AI|SU), STA, LDI, JMP, OUT (AO|OI), HLT.
- [C] Programming: for address 0..127, write data[a] >> 8 to address a and data[a] & 0xFF to address a + 128. The same image goes into both EEPROMs.
- [S] Chapters: defining constants 4:39, writing the microcode 7:30, NoOp instructions 11:22, programming EEPROMs 12:45-23:35.

**Circuit.** The Arduino programmer from video 32 programming the two microcode 28C16s.

**Component values.** Same programmer timing (1 us WE pulse, 10 ms delay).

**Lab ideas**

- Microcode compiler: edit the symbolic table (for example 'IO|MI') and generate the two 256-byte EEPROM images with a hex dump and a diff against the previous version.
- Bit-mask explorer: click signals to build a control word and see hex for the high and low bytes.

_Sources: https://www.youtube.com/watch?v=JUVt_KYAp-I, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-programmer/microcode-eeprom-programmer.ino_

## 41. Adding more machine language instructions to the CPU

**Concept.** Adds three instructions by microcode alone: STA (store A to memory), LDI (load a 4-bit immediate into A) and JMP (load the PC from the operand). Ben writes a looping program that uses them and walks through its execution.

**Key facts**

- [C] STA 0100: T2 IO|MI, T3 AO|RI. LDI 0101: T2 IO|AI. JMP 0110: T2 IO|J (microcode .ino).
- [C] Description: STA, LDI and JMP are added and a program using them is written and run.
- [Derived] LDI can only load 0-15, because IO outputs only the IR's low nibble with the high nibble 0. JMP targets 0-15.
- [I] The demo program is a counting loop, for example 0 LDI 1, 1 STA 15, 2 LDI 0, 3 ADD 15, 4 OUT, 5 JMP 3. The exact listing is unverified.

**Circuit.** No hardware change; EEPROMs reprogrammed.

**Component values.** None.

**Lab ideas**

- Assembler plus trace: write a program with STA, LDI and JMP, assemble it to the 16 bytes, and run with a per-microstep trace table (PC, MAR, IR, A, B, bus, signals).
- Infinite-counter demo at an adjustable clock, with the decimal output wrapping at 255.

_Sources: https://www.youtube.com/watch?v=FCscQGBIL-Y, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-programmer/microcode-eeprom-programmer.ino_

## 42. Making a computer Turing complete

**Concept.** Theory video on what 'computer' means: Turing machines and the lambda calculus define computable problems. The breadboard CPU lacks conditional branching. A small change, a conditional jump, makes it Turing complete apart from its finite 16-byte memory.

**Key facts**

- [C] Description: Turing machines and lambda calculus define the class of computable problems; a relatively minor change makes the computer Turing complete.
- [S] Chapters: What should a computer do 0:50, The Turing machine 4:11, Lambda calculus 8:38, Conclusion 16:55.
- [I] The missing feature is a data-dependent branch (conditional jump), implemented in videos 43-44 as JC and JZ. Memory is finite, so in practice it is a bounded machine.

**Circuit.** None.

**Lab ideas**

- Turing-machine toy: tape, head and state table (for example a binary incrementer) to make the 'conditional' state transition concrete.
- 'Can you loop N times?' challenge on the current instruction set (no conditional jump), showing it can't stop at a data-dependent point; then preview JC.

_Sources: https://www.youtube.com/watch?v=AqNDk_UJW4k_

## 43. CPU flags register

**Concept.** Ben first tries using the ALU's carry and zero signals directly for conditional jumps. That fails because the ALU is combinational: once ADD writes A, the carry and zero lines reflect the new A + B. He adds a 2-bit flags register (74LS173) that latches the carry (from the adder's carry out) and zero (NOR/AND detector) only when FI is asserted, and routes the flags to the microcode EEPROM address lines.

**Key facts**

- [C] Zero detect (alu.png): 74LS02 U22 NORs pairs of ALU result bits; 74LS08 U23 ANDs them, (U23A of NOR1 and NOR2, U23C of NOR3 and NOR4, U23B of those two). ZF = 1 when all 8 bits are 0.
- [C] Carry: CF = U20 (high 74LS283) C4, pin 9.
- [C] Flags register 74LS173 U19: D0 = CF, D1 = ZF; G1/G2 = FI-bar; M/N = GND; CLK; CLR. Q0 = CF and Q1 = ZF go to green LEDs (220R) and to control EEPROM A8 (CF) and A9 (ZF).
- [C] FI is a new control bit, bit 0 of the low EEPROM, active low at the chip through U53C.
- [S] Chapters: Implementing jump carry 1:31, jump on zero 3:55, The need for a flags register 8:59, Building 14:04, Testing 17:35, Connecting flags to control 20:41.
- [Derived] SUB computes A + NOT B + 1, so after SUB, CF = 1 means A >= B (unsigned, no borrow); 5-5 gives CF = 1 and ZF = 1; 3-5 gives CF = 0. After ADD, CF = 1 means the result exceeded 255.
- [C] Description links the x86 manual's EFLAGS section.

**Circuit.** 74LS02 plus 74LS08 zero detector on the ALU outputs; 74LS173 flags register clocked by CLK and enabled by FI; flags to EEPROM A8/A9 plus LEDs.

**Component values.** Flag LED resistors 220R (schematic).

**Lab ideas**

- Latched vs live flags: run ADD then OUT and compare the 'live' ALU carry and zero lines (which change after A updates) with the latched flags register.
- Zero-detector gate view: toggle the 8 result bits and watch the NOR/AND tree.
- Carry semantics quiz for SUB: predict CF and ZF for A - B over random pairs.

_Sources: https://www.youtube.com/watch?v=ObnosznZvHY, https://eater.net/schematics/alu.png, https://eater.net/schematics/control.png, https://eater.net/8bit/alu_

## 44. Conditional jump instructions

**Concept.** Ben reprograms the microcode with the two flag bits as extra address inputs, which needs 4 copies of the microcode table, one per flag combination. JC and JZ do IO|J only when their flag is set. He tests with counting programs and an up/down bouncer, then writes a multiply-by-repeated-addition program that uses the carry flag.

**Key facts**

- [C] Code: UCODE_TEMPLATE[16][8] is copied into ucode[4][16][8]; flags index = ZF<<1 | CF (FLAGS_Z0C0 = 0, Z0C1 = 1, Z1C0 = 2, Z1C1 = 3). JC = 0111: step 2 = IO|J when CF = 1. JZ = 1000: step 2 = IO|J when ZF = 1. Otherwise both are fetch-only NOPs. ADD and SUB step 4 add FI.
- [C] Programming loop for address 0..1023: flags = (a & 0x300) >> 8, byte_sel = (a & 0x80) >> 7, instruction = (a & 0x78) >> 3, step = a & 7. byte_sel = 1 writes the low byte, otherwise the high byte (>> 8). printContents(0, 1024).
- [S] The video moves the template to PROGMEM (memcpy_P) to save Nano SRAM (2 KB); the repo version uses plain memcpy. An off-by-one in the dump loop is fixed.
- [S] First test: count by 10 using the value at address 15; the carry LED lights past 255.
- [S/I] Up/down program (counts by 15): 0 OUT, 1 ADD 15, 2 JC 4, 3 JMP 0, 4 SUB 15, 5 OUT, 6 JZ 0, 7 JMP 4, 15: 15. The listing is reconstructed from the summary.
- [S/I] Multiply (x at 14, y at 15, product at 13, constant 1 at 12): 0 LDA 14, 1 SUB 12, 2 JC 6, 3 LDA 13, 4 OUT, 5 HLT, 6 STA 14, 7 LDA 13, 8 ADD 15, 9 STA 13, 10 JMP 0. Demos: 3x5 = 15 and 7x8 = 56. Subtracting 1 sets CF unless x was 0, which is the loop test (an x86 CMP-like trick is discussed).
- [S] Mentions a Patreon supporter's self-modifying multiply that works without conditional jumps.

**Circuit.** No new hardware; both microcode EEPROMs reprogrammed with the 1024-byte flag-aware image (A8 = CF, A9 = ZF).

**Component values.** None.

**Lab ideas**

- Flag-aware microcode explorer: set the flags and opcode and see which copy of the table is addressed and whether JC or JZ jumps.
- Program runner with assembler: preload the up/down bouncer and multiply demos; editable x and y in RAM; a trace of the flags every step.
- Off-by-one challenge: write a loop with JZ, then with JC after SUB 1, and compare the iteration counts.

_Sources: https://www.youtube.com/watch?v=Zg1NdPKoosU, https://videohighlight.com/v/Zg1NdPKoosU, https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-with-flags/microcode-eeprom-with-flags.ino, https://hackmd.io/@wmvanvliet/SJHhPqr4c_

## Uncertainties

- Labels used in keyFacts: [C] means confirmed by the cited primary source (eater.net pages, eater.net schematics PNGs, YouTube descriptions or chapter lists, Ben's GitHub code, datasheets on eater.net). [S] means secondary: an AI-generated transcript summary on videohighlight.com, or a community write-up. [I] means inferred or recalled from memory and not verified. [Derived] means computed from confirmed values.
- I could not get any video transcripts. YouTube caption and transcript endpoints require a proof-of-origin token, and I did not try to get around that bot protection. Third-party transcript sites needed a login or a JavaScript/Cloudflare check.
- Videos 1, 28-31 and 33-43 have no videohighlight summary. Their entries rest on the descriptions, chapter lists, schematics and code, plus some [I] recollection.
- The videohighlight AI summaries contain errors I found: the clock logic summary says 74LS00 where the description says 74LS04; the JK racing summary says a 100us time constant where 1nF x 1k = 1us; the clock summary says 'grounding halt halts' where HLT is actually active high; the RAM summary gives wrong 74LS189 power pins. Treat [S] items as approximate.
- Astable clock: Ben's '1uF' capacitor measured about 2uF, and the description lists a 2uF part. The final schematic uses 1uF. The real frequency range of his build is therefore uncertain: 0.72-480 Hz with 1uF, about half that with 2uF.
- LED resistor values are inconsistent across sources: 330R in the early descriptions, 220R in the KiCad schematics, 470R in the control-signal video description and the parts list (24x 470R). Community reports say Ben left out LED resistors on many modules in the videos.
- Manual EEPROM write pulse (video 31): the description lists 680R, a 100nF capacitor and a tact switch. That RC gives tau = 68us, far above the 28C16 tWP maximum of 1000 ns. The actual pulse-shaping circuit and capacitor value are unverified.
- Hex decoder (video 30): the exact gate-level equations and simplification Ben used are unverified. Only the truth table (from the Arduino code) and the chip counts (from the description) are confirmed.
- The demo program listings for video 41 (count loop) and video 44 (up/down bouncer) are reconstructions. The multiply listing matches the summary's addresses and behavior but is still recalled from memory. The first-program bytes 1E 2F E0 F0 / 1C 0E (=42) are confirmed only by community sources and recollection.
- The datasheet on eater.net is the 74F189: outputs are high-Z during a write and the complement of stored data during a read. Whether Ben's actual 74LS189/74189 parts behave identically during writes (outputs high-Z vs complement of the inputs) is unverified.
- When the step-counter reset at T5 (74LS138 O5 to MR-bar through NANDs) was introduced, in control logic Part 2, Part 3 or the reset video, is unverified. The final schematic does confirm 5 microsteps, T0-T4.
- Video 27 description lists '4x 74LS76' for a 4-bit counter; 2 dual chips would suffice, so the actual count is unverified.
- Video 1: the book named in 'Book recommendation' (very likely Malvino and Brown's 'Digital Computer Electronics', SAP-1) and the specific 'Enhancements' discussed are recalled, not verified.
- Video 25 racing oscillation period (about 82 ns) comes only from the AI summary.
- I did not download the KiCad project zip (eater.net/downloads/8bit-computer.zip). It could confirm the exact net names and values read from the PNG schematics.
- In the video 44 PROGMEM detail, the summary says Ben used PROGMEM and memcpy_P, but the GitHub repo version uses plain arrays and memcpy. A simulator should follow the repo code for exact behavior.
