# Ben Eater 8-bit computer — behavioural spec (research notes)

Compiled from primary sources (eater.net, beneater/eeprom-programmer, Ben's schematics/netlist, datasheets) by a research agent. Facts are labelled confirmed/inferred in the source notes.

## Control signals

| bit | name | active-low in HW | EEPROM | meaning | source |
|---|---|---|---|---|---|
| 15 | HLT | False | U47 (left/high-byte EEPROM, A7=GND) D7, pin 17 | Halt. Gates the master clock: CLK = (selected clock) AND NOT HLT, using the 74LS04 U4D inverter and the 74LS08 U5C AND gate in the clock module. Asserted only in step T2 of opcode 1111. | Confirmed by #define bit order in microcode-eeprom-with-flags.ino and by KiCad netlist net /Clock/HLT (U47.17 to U4.9) |
| 14 | MI | True | U47 D6, pin 16 | Memory address register in. The MAR 74LS173 (U34) loads BUS[3:0] on the rising edge of CLK. | Netlist: U47.16 goes through U49 74LS04 (pin 1 to pin 2) to ~MI on U34 ~E1/~E2 |
| 13 | RI | False | U47 D5, pin 15 | RAM in. Run mode only: ~WE = NAND(RI, RC-differentiated CLK), so the write is a ~10 µs pulse at the CLK rising edge. The NAND output passes through 74LS157 U32 input I1c to ~WE of both 74189s. | Netlist: U47.15 goes directly to U31(74LS00) pin 2. Also confirmed in video Vw3uDOUJRGw. |
| 12 | RO | True | U47 D4, pin 14 | RAM out. Enables the RAM's 74LS245 (U30) to drive the RAM word at the current RAM address onto the bus. | Netlist: U47.14 goes through U49 (pin 3 to pin 4) to ~RO on U30 pin 19 |
| 11 | IO | True | U47 D3, pin 13 | Instruction register out. The IR's 74LS245 (U13) drives IR[3:0] onto BUS[3:0] and actively drives BUS[7:4] = 0, because its A0-A3 inputs are tied to GND. | Netlist: U47.13 goes through U49 (pin 5 to pin 6) to ~IO on U13 pin 19 |
| 10 | II | True | U47 D2, pin 11 | Instruction register in. Both IR 74LS173s (U14 high nibble, U15 low nibble) load all 8 bus bits on the CLK rising edge. | Netlist: U47.11 goes through U49 (pin 13 to pin 12) to ~II |
| 9 | AI | True | U47 D1, pin 10 | A register in. U8 and U9 74LS173 load the bus on the CLK rising edge. | Netlist: U47.10 goes through U49 (pin 11 to pin 10) to ~AI |
| 8 | AO | True | U47 D0, pin 9 | A register out. The A register's 74LS245 (U7) drives A onto the bus. | Netlist: U47.9 goes through U49 (pin 9 to pin 8) to ~AO on U7 pin 19 |
| 7 | EO | True | U52 (right/low-byte EEPROM, A7=VCC) D7, pin 17 | ALU (sum) out. Ben's breadboard label is ΣO, 'sum out'. The ALU's 74LS245 (U17) drives the combinational ALU result onto the bus. | Netlist: U52.17 goes through U53 74LS04 (pin 1 to pin 2) to ~EO on U17 pin 19 |
| 6 | SU | False | U52 D6, pin 16 | Subtract. Drives all 8 XOR gates (74LS86 U16/U18) that invert B, and the carry-in C0 of the low adder (74LS283 U21). The ALU computes A + (B XOR 0xFF·SU) + SU. | Netlist: net /ALU/SU |
| 5 | BI | True | U52 D5, pin 15 | B register in. U11 and U12 74LS173 load the bus on the CLK rising edge. The B register has no bus output: its 74LS245 CE is tied to VCC and ~BO is tied high. | Netlist: U52.15 goes through U53 (pin 3 to pin 4) to ~BI |
| 4 | OI | False | U52 D4, pin 14 | Output register in. The 74LS273 (U44) clock input is OI AND CLK (74LS08 U46A), so the output register latches the bus on the CLK rising edge while OI=1. | Netlist: U52.14 goes to U46 pin 1, and U46 pin 3 goes to U44 Cp |
| 3 | CE | False | U52 D3, pin 13 | Counter enable. Drives CEP and CET of the PC 74LS161 (U35). The PC increments on the CLK rising edge. | Netlist: net /Control logic/CE goes to U35 pins 7 and 10 |
| 2 | CO | True | U52 D2, pin 11 | Counter out. The PC's 74LS245 (U36, B-to-A direction) drives PC[3:0] onto BUS[3:0]. BUS[7:4] is not driven and is pulled to 0 by the 10k pull-downs. | Netlist: U52.11 goes through U53 (pin 13 to pin 12) to ~CO on U36 pin 19 |
| 1 | J | True | U52 D1, pin 10 | Jump, i.e. program counter in. Drives ~PE (parallel load) of the PC 74LS161. The PC loads BUS[3:0] synchronously on the CLK rising edge. | Netlist: U52.10 goes through U53 (pin 11 to pin 10) to ~J on U35 pin 9 |
| 0 | FI | True | U52 D0, pin 9 | Flags in. The flags 74LS173 (U19) loads CF (adder carry out) into Q0 and ZF (ALU result == 0) into Q1 on the CLK rising edge. Added in the 'CPU flags register' video using a spare inverter. | Netlist: U52.9 goes through U53 (pin 5 to pin 6) to ~FI on U19 ~E1/~E2. Also confirmed in video ObnosznZvHY. |

## Microcode

### Verbatim source

```c
/* Source: https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-with-flags/microcode-eeprom-with-flags.ino  (Copyright 2017 Ben Eater, MIT licensed per repo README) -- excerpts verbatim */

#define HLT 0b1000000000000000  // Halt clock
#define MI  0b0100000000000000  // Memory address register in
#define RI  0b0010000000000000  // RAM data in
#define RO  0b0001000000000000  // RAM data out
#define IO  0b0000100000000000  // Instruction register out
#define II  0b0000010000000000  // Instruction register in
#define AI  0b0000001000000000  // A register in
#define AO  0b0000000100000000  // A register out
#define EO  0b0000000010000000  // ALU out
#define SU  0b0000000001000000  // ALU subtract
#define BI  0b0000000000100000  // B register in
#define OI  0b0000000000010000  // Output register in
#define CE  0b0000000000001000  // Program counter enable
#define CO  0b0000000000000100  // Program counter out
#define J   0b0000000000000010  // Jump (program counter in)
#define FI  0b0000000000000001  // Flags in

#define FLAGS_Z0C0 0
#define FLAGS_Z0C1 1
#define FLAGS_Z1C0 2
#define FLAGS_Z1C1 3

#define JC  0b0111
#define JZ  0b1000

uint16_t UCODE_TEMPLATE[16][8] = {
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 0000 - NOP
  { MI|CO,  RO|II|CE,  IO|MI,  RO|AI,  0,           0, 0, 0 },   // 0001 - LDA
  { MI|CO,  RO|II|CE,  IO|MI,  RO|BI,  EO|AI|FI,    0, 0, 0 },   // 0010 - ADD
  { MI|CO,  RO|II|CE,  IO|MI,  RO|BI,  EO|AI|SU|FI, 0, 0, 0 },   // 0011 - SUB
  { MI|CO,  RO|II|CE,  IO|MI,  AO|RI,  0,           0, 0, 0 },   // 0100 - STA
  { MI|CO,  RO|II|CE,  IO|AI,  0,      0,           0, 0, 0 },   // 0101 - LDI
  { MI|CO,  RO|II|CE,  IO|J,   0,      0,           0, 0, 0 },   // 0110 - JMP
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 0111 - JC
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 1000 - JZ
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 1001
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 1010
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 1011
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 1100
  { MI|CO,  RO|II|CE,  0,      0,      0,           0, 0, 0 },   // 1101
  { MI|CO,  RO|II|CE,  AO|OI,  0,      0,           0, 0, 0 },   // 1110 - OUT
  { MI|CO,  RO|II|CE,  HLT,    0,      0,           0, 0, 0 },   // 1111 - HLT
};

uint16_t ucode[4][16][8];

void initUCode() {
  // ZF = 0, CF = 0
  memcpy(ucode[FLAGS_Z0C0], UCODE_TEMPLATE, sizeof(UCODE_TEMPLATE));

  // ZF = 0, CF = 1
  memcpy(ucode[FLAGS_Z0C1], UCODE_TEMPLATE, sizeof(UCODE_TEMPLATE));
  ucode[FLAGS_Z0C1][JC][2] = IO|J;

  // ZF = 1, CF = 0
  memcpy(ucode[FLAGS_Z1C0], UCODE_TEMPLATE, sizeof(UCODE_TEMPLATE));
  ucode[FLAGS_Z1C0][JZ][2] = IO|J;

  // ZF = 1, CF = 1
  memcpy(ucode[FLAGS_Z1C1], UCODE_TEMPLATE, sizeof(UCODE_TEMPLATE));
  ucode[FLAGS_Z1C1][JC][2] = IO|J;
  ucode[FLAGS_Z1C1][JZ][2] = IO|J;
}

/* ... (setup(), address loop:) */

  // Program the 8 high-order bits of microcode into the first 128 bytes of EEPROM
  for (int address = 0; address < 1024; address += 1) {
    int flags       = (address & 0b1100000000) >> 8;
    int byte_sel    = (address & 0b0010000000) >> 7;
    int instruction = (address & 0b0001111000) >> 3;
    int step        = (address & 0b0000000111);

    if (byte_sel) {
      writeEEPROM(address, ucode[flags][instruction][step]);
    } else {
      writeEEPROM(address, ucode[flags][instruction][step] >> 8);
    }

    if (address % 64 == 0) {
      Serial.print(".");
    }
  }

/* Note: writeEEPROM(address, byte data) puts data bit 0 on EEPROM D0 ... bit 7 on D7. setup() calls initUCode() first and afterwards printContents(0, 1024). The comment line inside the loop is stale, left over from the pre-flags sketch. */
```

### Flags handling

There are 4 copies of the 16x8 template, indexed by flags = (ZF<<1)|CF: FLAGS_Z0C0=0, FLAGS_Z0C1=1 (carry only), FLAGS_Z1C0=2 (zero only), FLAGS_Z1C1=3 (both). The only differences between copies are at step 2 of JC (opcode 0111) and JZ (opcode 1000):
- JC step 2 = IO|J (0x0802) when CF=1, i.e. flags index 1 or 3. Otherwise it is 0.
- JZ step 2 = IO|J when ZF=1, i.e. flags index 2 or 3. Otherwise it is 0.
- Steps 3-4 of JC/JZ are always 0. A non-taken conditional jump is a 5-cycle NOP.
Hardware (confirmed in the netlist and in video ObnosznZvHY): the flags register is a 74LS173 (U19) clocked by CLK.
- ~G1/~G2 are driven by ~FI, so it loads only when FI=1.
- D0 = C4 (carry out) of the high-nibble 74LS283 (U20), so Q0 = CF, which goes to EEPROM A8 on both U47 and U52.
- D1 = zero detect, so Q1 = ZF, which goes to A9 on both EEPROMs.
- Zero detect = NOR pairs of the 8 ALU sum bits (74LS02 U22), ANDed together with 74LS08 U23 (three gates). It looks at the ALU output, not at the A register.
- D2/D3 are unconnected and Q2/Q3 are unused. Output enables are tied to GND. MR = CLR, so the master reset clears the flags.
FI is asserted only in T4 of ADD and SUB, together with EO|AI. At that rising edge, A gets the result and the flags get the carry/zero of the same pre-edge ALU result. The flags then hold until the next ADD/SUB. No other instruction (LDA, LDI, STA, ...) changes the flags.
Because the flags change only at T4 of ADD/SUB, and the 4 table copies differ only at T2 of JC/JZ, the control word does not glitch when the flags update.
Before the flags video, A8, A9 and A10 of both EEPROMs were tied to GND. In that video Ben removed those ties for A8/A9, tied A8 left to A8 right and A9 left to A9 right, then connected CF to A8 and ZF to A9. A10 stays at GND.

### EEPROM address layout

28C16 (2K x 8) microcode EEPROM address bits. Two identical chips are used. Confirmed by the sketch, the netlist and video Zg1NdPKoosU at ~3:40.
- A0-A2 = step counter Q0-Q2 (74LS161 U48). A0 is the LSB. Q3 is not used.
- A3-A6 = opcode = IR[4..7] from the IR high-nibble 74LS173 U14. A3 = IR bit 4 (opcode LSB), A6 = IR bit 7 (opcode MSB).
- A7 = byte select, hardwired. U47 (left) has A7=GND and outputs the HIGH byte (bits 15-8: HLT MI RI RO IO II AI AO on D7..D0). U52 (right) has A7=VCC and outputs the LOW byte (bits 7-0: EO SU BI OI CE CO J FI on D7..D0).
- A8 = CF (flags Q0).
- A9 = ZF (flags Q1).
- A10 = GND.
- EEPROM control pins: ~CE=GND, ~OE=GND, ~WE=VCC. The EEPROM is used as purely combinational logic.

So: address = (ZF<<9) | (CF<<8) | (bytesel<<7) | (opcode<<3) | step, and data = bytesel ? (word & 0xFF) : (word >> 8).

Verified image bytes (recomputed from the sketch):
- 0x000-0x00F: 40 14 00 00 00 00 00 00 40 14 48 12 00 00 00 00
- 0x080-0x08F: 04 08 00 00 00 00 00 00 04 08 00 00 00 00 00 00
Ben reads out '4 0 1 4' and '0 4 0 8' for the fetch steps in JUVt_KYAp-I. SHA-256 of the 1024-byte image = e405e87f15b00258a7424222d490eda73c5e767ba17cb525cda72c901fbe6335.

History: in 'Control logic part 3', A7-A10 were all tied to GND and the two EEPROMs were hand-programmed differently. From 'Reprogramming CPU microcode with an Arduino' (JUVt_KYAp-I, ~18:00-23:00) on, A7 is the byte select so both chips are programmed identically. The pre-flags sketch wrote the high byte at 0-127 and the low byte at 128-255.

### Per-opcode steps

| opcode | mnemonic | operand | steps | notes |
|---|---|---|---|---|
| 0000 | NOP | ignored | T0: MI|CO (0x4004) ; T1: RO|II|CE (0x1408) ; T2: - ; T3: - ; T4: - | Fetch only. Flags unaffected. Also the state right after reset (IR=0). |
| 0001 | LDA | 4-bit RAM address | T0: MI|CO ; T1: RO|II|CE ; T2: IO|MI (0x4800) ; T3: RO|AI (0x1200) ; T4: - | A = RAM[addr]. Flags unaffected. |
| 0010 | ADD | 4-bit RAM address | T0: MI|CO ; T1: RO|II|CE ; T2: IO|MI (0x4800) ; T3: RO|BI (0x1020) ; T4: EO|AI|FI (0x0281) | B = RAM[addr]; A = A+B (mod 256). CF = carry out of bit 7, ZF = (result==0). Flags updated. B keeps the operand afterwards. |
| 0011 | SUB | 4-bit RAM address | T0: MI|CO ; T1: RO|II|CE ; T2: IO|MI ; T3: RO|BI (0x1020) ; T4: EO|AI|SU|FI (0x02C1) | A = A + ~B + 1 = A-B (mod 256). CF = 1 iff no borrow, i.e. A >= B unsigned. ZF = (result==0). Flags updated. Example: 0-1 gives 255 with CF=0, and x-1 gives CF=1 for any x != 0, as Ben explains in Zg1NdPKoosU ~36:40. |
| 0100 | STA | 4-bit RAM address | T0: MI|CO ; T1: RO|II|CE ; T2: IO|MI (0x4800) ; T3: AO|RI (0x2100) ; T4: - | RAM[addr] = A. Written during the ~10 µs RC pulse after the T3 rising edge. Only works in run mode. Flags unaffected. |
| 0101 | LDI | 4-bit immediate 0-15 | T0: MI|CO ; T1: RO|II|CE ; T2: IO|AI (0x0A00) ; T3: - ; T4: - | A = IR[3:0], with the high nibble 0 (the IR 245 drives BUS[7:4]=0). Can only load 0..15. Flags unaffected. |
| 0110 | JMP | 4-bit address | T0: MI|CO ; T1: RO|II|CE ; T2: IO|J (0x0802) ; T3: - ; T4: - | PC = IR[3:0], loaded on the T2 rising edge. The PC was already incremented in T1, so the load overrides it. Flags unaffected. |
| 0111 | JC | 4-bit address | T0: MI|CO ; T1: RO|II|CE ; T2: IO|J if CF=1 else - ; T3: - ; T4: - | Conditional on flag-register CF, which comes from the last ADD/SUB. |
| 1000 | JZ | 4-bit address | T0: MI|CO ; T1: RO|II|CE ; T2: IO|J if ZF=1 else - ; T3: - ; T4: - | Conditional on flag-register ZF, which comes from the last ADD/SUB. |
| 1001 | (unused) | ignored | T0: MI|CO ; T1: RO|II|CE ; T2-T4: - | Behaves as NOP (5 cycles). |
| 1010 | (unused) | ignored | T0: MI|CO ; T1: RO|II|CE ; T2-T4: - | Behaves as NOP. |
| 1011 | (unused) | ignored | T0: MI|CO ; T1: RO|II|CE ; T2-T4: - | Behaves as NOP. |
| 1100 | (unused) | ignored | T0: MI|CO ; T1: RO|II|CE ; T2-T4: - | Behaves as NOP. |
| 1101 | (unused) | ignored | T0: MI|CO ; T1: RO|II|CE ; T2-T4: - | Behaves as NOP. |
| 1110 | OUT | ignored (Ben writes 0000) | T0: MI|CO ; T1: RO|II|CE ; T2: AO|OI (0x0110) ; T3: - ; T4: - | OUT register = A, latched on the T2 rising edge. Flags unaffected. |
| 1111 | HLT | ignored (Ben writes 0000) | T0: MI|CO ; T1: RO|II|CE ; T2: HLT (0x8000) ; T3: - ; T4: - | HLT is asserted right after the falling edge that enters T2. CLK is forced low, so the T2 rising edge never happens. The machine stops with step=2 and IR=0xF?. Only reset (or physically removing HLT) resumes it. |

## Timing

The rules below come from the KiCad netlist (eater.net/downloads/8bit-computer.zip, revB, 2018-08-18, which matches the eater.net schematic PNGs) and from the video transcripts.

MASTER CLOCK
- CLK = U5C pin 8: ((astable AND sel) OR (monostable AND NOT sel)) AND NOT HLT.
- ~CLK = U4F pin 12, from a spare inverter in the clock module.

RISING EDGE OF CLK (all at the same instant, all using the pre-edge bus value)
- 74LS173 registers load when both data enables are low (i.e. the control signal is asserted). This covers A (U8/U9, AI), B (U11/U12, BI), IR (U14/U15, II), MAR (U34, MI) and Flags (U19, FI). Ben (dHWFpkGsxOs ~34:03) says the A register latches "immediately on the rising edge of the clock".
- PC 74LS161 (U35):
  - If J=1 (~PE low), it loads BUS[3:0] synchronously. Load has priority over count.
  - Else if CE=1 (CEP=CET=1), it increments, wrapping 15 to 0.
- Output register 74LS273 (U44): its clock is CLK AND OI (U46A). It latches the 8-bit bus on the CLK rising edge while OI=1. OI only changes while CLK is low, so this gives no spurious edges.
- RAM write (run mode):
  - ~WE = NAND(RI, Vrc), where Vrc is CLK fed through a 0.01 µF series capacitor (C7) into a 1 kΩ resistor (R58) to GND. Vrc is a ~10 µs (RC = 10 µs) positive pulse right after each CLK rising edge.
  - So with RI=1, RAM[address] is written with the bus value during the first ~10 µs of CLK-high.
  - The edge detector was added in 'RAM module testing and troubleshooting' (Vw3uDOUJRGw, ~10:14). Before that, the NAND used CLK directly, so writing lasted the whole CLK-high time and the RAM output LEDs read 00 during the write.
  - 74189 writes are level-sensitive, and its outputs go high-Z while ~WE is low (74F189 datasheet on eater.net).
  - Simulator model: write at the rising edge with the pre-edge bus value. The only RI step is STA T3 (AO|RI), and neither the bus nor the address changes at that edge.

FALLING EDGE OF CLK = RISING EDGE OF ~CLK
- Step counter 74LS161 (U48) increments. Wiring: Cp = ~CLK; P0-P3 unused; ~PE = CEP = CET = VCC; ~MR = AND(~CLR, ~O5), built from U51B NAND plus U51A NAND used as an inverter.
- 74LS138 (U50) decodes Q0-Q2. Its enables are E1=E2=GND and E3=VCC. Outputs O0-O4 drive the T0-T4 LEDs.
- When the count reaches 5, O5 goes low and asynchronously clears the counter to 0. The 5 exists only for nanoseconds.
- Effective sequence: 0,1,2,3,4,0,... Every instruction (except HLT) takes exactly 5 clock cycles. There is no early reset or variable-length instruction.
- History (X7rCxs1ppyY): Ben first used O6 (6 steps). After merging CE into T1 he moved the reset to O5. Q3 is unused.
- The control word (EEPROM outputs) then settles combinationally from {ZF, CF, IR[7:4], step} while CLK is low, ready for the next rising edge. Ben (X7rCxs1ppyY ~4:43-5:50) describes this as the control logic updating "between" clock pulses.
- The IR changes at the T1 rising edge, but T1 is identical for all opcodes, so the control word does not glitch during T1-high.

CYCLE-LEVEL SIMULATOR LOOP (one clock period)
1. step changes (falling edge)
2. control word = ucode[flags][IR>>4][step]
3. bus = OR of enabled drivers; 0 if none (10k pull-downs)
4. ALU = (A + (B ^ (SU?0xFF:0)) + SU) & 0xFF; carry = bit 8; zero = (ALU == 0)
5. rising edge: apply all loads at once, using values computed in step 4: A/B/IR/MAR/flags/OUT/RAM write/PC load or increment

Example: instruction k (0-based, straight-line code from reset) does T0..T4 on rising edges 5k+1 .. 5k+5.

ALU
- Purely combinational (74LS283 x2 + 74LS86 x2). It changes as soon as A, B or SU change.
- In T4 of ADD, the new A appears on the bus after the edge. It is not re-latched, because everything is edge-triggered.

HLT
- The microcode asserts HLT at T2 of opcode 1111, after the falling edge, when CLK is already low.
- The AND gate then holds CLK low and ~CLK high. Nothing changes after that. The halt LED is D58 and the clock LED is D1.

RESET
- The pushbutton SW8 connects to VCC, with R75 (1 kΩ) to GND.
- U51 74LS00 gates buffer it: U51C makes ~CLR and U51D makes CLR. U51B/A combine ~CLR with the step reset.
- Every clear is asynchronous and holds for as long as the button is pressed.
- CLR (active high) drives the MR of every 74LS173: A, B, IR, MAR and Flags.
- ~CLR (active low) drives:
  - PC 74LS161 ~MR
  - Output 74LS273 ~MR (the display shows 000)
  - the step counter, through the AND
- NOT cleared: RAM contents and the clock module (mode, 555 states).
- After reset, IR=0 and step=0, so the control word is MI|CO and HLT goes low. The clock resumes by itself: in auto mode the program re-runs immediately (HtFro0UKqkk ~10:55).
- Reset video (HtFro0UKqkk): Ben lists PC, A, B, OUT, IR, MAR and the micro-step counter. Flags were added to reset in the flags video (ObnosznZvHY ~17:22).

POWER-ON
- Registers and RAM hold random values. Ben resets first and calls the RAM content "junk".

PROGRAM MODE
- RAM address, RAM data-in and ~WE come from the DIP switches and the write button through 74LS157 muxes. Writes are level-sensitive while the button is held.
- In this mode RI has no effect.
- The MAR register itself still loads on MI, but its output is not used for the RAM address.

DISPLAY MULTIPLEX
- Independent asynchronous ~716 Hz 555 clock.
- The 74LS76 toggles on the falling edges of the 555 output.

PRACTICAL SPEED
- Ben measured a maximum of about 300 Hz with his parts (AqNDk_UJW4k ~0:17).


## Datapath

BUS
- 8 bits, BUS_0 = LSB. Each line has a 10 kΩ pull-down (R8-R15) to GND, so an undriven bus reads 0x00. Ben added these in '-6JAgFWCL9w' at ~11:39 because some modules drive only the low 4 bits.
- Before the pull-downs, floating LS-TTL lines read high.
- Bus LEDs: 8 red with 220 Ω.
- Drivers (all 74LS245 with active-low CE): RAM (U30, ~RO), IR (U13, ~IO), A (U7, ~AO), ALU (U17, ~EO), PC (U36, ~CO).
- The B register's 245 (U10) has CE tied to VCC (never drives) and ~BO is tied high.
- The microcode never enables two drivers at once.

A REGISTER
- 2x 74LS173 (U9 low nibble, U8 high nibble). Outputs are always enabled (~M/~N = GND).
- Feeds the ALU A inputs, its 245 and 8 red LEDs.
- Loads all 8 bits on AI.

B REGISTER
- 2x 74LS173 (U12 low, U11 high). Loads on BI. Feeds the ALU through the XOR gates. No bus output.

INSTRUCTION REGISTER
- U14 holds IR[7:4] and U15 holds IR[3:0]. Both load all 8 bits on II.
- IR[7:4] goes to EEPROM A6..A3 (IR7 to A6, IR4 to A3) and to 4 blue LEDs.
- IR[3:0] goes to 4 yellow LEDs and to U13 245 inputs A4-A7, which drive BUS[3:0].
- U13 inputs A0-A3 are tied to GND, so IO actively drives BUS[7:4]=0.
- Ben (FCscQGBIL-Y ~4:53): IO puts only the 4 LSBs on the bus. Hence LDI loads 0-15, and JMP/JC/JZ/LDA/... operands are 4 bits.

ALU
- 2x 74LS283 (U21 low nibble with C0 = SU; U21 C4 goes to U20 C0).
- 2x 74LS86 XOR each B bit with SU.
- Result S = A + (B XOR (SU?0xFF:0)) + SU (mod 256). Carry out = U20 C4, which goes to flag D0.
- Subtraction carry: A-B = A + ~B + 1, so CF=1 means no borrow (A >= B unsigned) and CF=0 means borrow. Ben (Zg1NdPKoosU ~37:20) says subtracting 1 sets carry for anything except 0.
- Zero = NOR/AND tree on the 8 sum bits.
- Sum goes to 8 red LEDs and to the U17 245 (EO).
- Fully combinational and always computing.

MAR
- 74LS173 U34 loads BUS[3:0] on MI. Note the breadboard wiring reverses chip D order, but logically MAR bit n = BUS_n.
- Output goes to 74LS157 U33 input I1. U33 input I0 = 4-position DIP SW5. U33 Z = RAM address A0..A3, shown on 4 yellow LEDs (D44-D47), so the LEDs show whichever address is actually selected.
- MR = CLR.

RAM
- 2x 74189 (16x4, U24 = bits 7-4, U25 = bits 3-0), ~CS = GND.
- Data inputs come from 74LS157 U26/U27 (I1 = bus bits, I0 = 8-position DIP SW3).
- The 74189 outputs are INVERTED (complement of stored data). 2x 74LS04 (U28/U29) re-invert them, then they feed 8 red LEDs (always showing RAM[current address]) and the U30 245 to the bus (RO).
- ~WE comes from 74LS157 U32 section c: I1 = NAND(RI, RC-edge(CLK)) and I0 = write pushbutton SW4 to GND.

PROGRAM / RUN MODE
- SPDT SW6 drives the net PROG, which is S of all four 74LS157s (U26, U27, U32, U33).
- PROG = 0 means program mode, red LED D48: switches/button select (I0).
- PROG = 1 means run mode (pulled high via R63 1 kΩ + LED), green LED D49 lit: bus/MAR/RI (I1).
- DIP switches and the write button only switch to GND, with no pull-ups. A closed switch reads 0 and an open switch floats high = 1 (inferred from the schematic). The button writes while pressed.

PROGRAM COUNTER
- 74LS161 U35. Cp = CLK, CEP = CET = CE, ~PE = ~J, ~MR = ~CLR. P0-P3 come from BUS[3:0].
- Q0-Q3 go to 4 green LEDs (D82-D85) and to the U36 245, which has direction B to A (A->B pin = GND) and drives BUS[3:0] only. BUS[7:4] is undriven and therefore 0.
- TC is unused. 4-bit, wraps 15 to 0.
- Ben (FCscQGBIL-Y ~16:58): the PC is incremented at T1, so JMP overwrites the incremented value.

OUTPUT REGISTER
- 74LS273 U44 (8 D flip-flops, no enable). D = BUS[7:0]. Cp = OI AND CLK (74LS08 U46A). ~MR = ~CLR. Q drives display EEPROM A0-A7.
- Ben chose the 273 instead of 2x 173 (-6JAgFWCL9w ~2:37) and therefore had to AND the clock.

CONTROL LOGIC
- Step counter 74LS161 U48, 74LS138 U50, 74LS00 U51.
- 2x 28C16: U47 = high byte, A7=0; U52 = low byte, A7=1.
- 2x 74LS04 (U49, U53) invert the 11 active-low signals.
- 16 blue control LEDs (D58-D73) show the active-high EEPROM outputs.
- Flags: 2 green LEDs (D34 = CF, D35 = ZF).

POWER
- USB-B 5 V with a 10 µF bulk capacitor. 0.1 µF decoupling capacitors throughout.


## Clock module

The eater.net clock schematic and the KiCad netlist (U1-U6) give the final values below. Ben's breadboard parts differed in places; those are noted where relevant.

ASTABLE 555 (U1)
- Wiring:
  - VCC to R1 1 kΩ to DIS (pin 7).
  - DIS to R2 1 kΩ to the wiper of RV1, a 1 MΩ pot. Pot pin 1 goes to TR/THR (pins 2/6) and C6.
  - C6 is 1 µF to GND.
  - CV (pin 5) has 0.01 µF (C5) to GND. Reset pin 4 goes to VCC.
- So RA = 1 kΩ, RB = 1 kΩ + Rpot (0-1 MΩ), C = 1 µF.
- Timing:
  - t_high = 0.693(RA+RB)C, t_low = 0.693·RB·C, f = 1.44/((RA+2RB)C).
  - Rpot = 0: t_high ≈ 1.39 ms, t_low ≈ 0.69 ms, f ≈ 480 Hz.
  - Rpot = 1 MΩ: f ≈ 0.72 Hz (period ≈ 1.39 s).
- Ben's actual 'MFD' capacitor measured 2 µF (kRlSFm519Bo), which halves these frequencies. His own estimate of practical maximum speed is ~300 Hz.
- In the video he first used RB = 100 kΩ (T ≈ 139 ms calculated, 263 ms measured), then switched to the 1 MΩ pot plus a 1 kΩ series resistor so RB never reaches 0.
- eater.net/8bit/clock describes the range as "from less than 1Hz to a few hundred Hz".

MONOSTABLE 555 (U2) — manual-step debounce
- TR (pin 2) is pulled up by R3 1 kΩ. The tact switch SW1 goes to GND.
- THR/DIS (pins 6/7) go to R4 1 MΩ from VCC and C3 0.1 µF to GND. CV has 0.01 µF (C2). Reset goes to VCC.
- Pulse width = 1.1·R·C ≈ 110 ms; Ben states 0.1 s.
- In the video he first used ~2 µF (2 s pulse) and then 0.1 µF (81BgFhm2vz8).

BISTABLE 555 (U3) — debounced mode switch
- TR (pin 2) is pulled up by R5 1 kΩ. Reset (pin 4) is pulled up by R6 1 kΩ. THR (pin 6) goes to GND. CV has 0.01 µF (C4). DIS is unconnected.
- SPDT SW2: the common goes to GND, position A to TR, position C to RESET.
- Grounding TR sets Q=1, which selects the astable (auto mode). Grounding RESET gives Q=0, which selects manual.

CLOCK LOGIC (74LS04 U4, 74LS08 U5, 74LS32 U6)
- U5A = astable_Q AND bistable_Q
- U4A = NOT bistable_Q
- U5B = monostable_Q AND U4A
- U6A = U5A OR U5B
- U4D = NOT HLT
- CLK = U5C = U6A AND U4D
- ~CLK = U4F = NOT CLK, which goes to the step counter only.
- Clock LED: D1 blue with 220 Ω on CLK.
- U4 spare inverters (pins 3-6, 10-11) and the U5D/U6 spares are unused.

HLT BEHAVIOUR
- HLT high forces CLK low regardless of mode, so manual presses do nothing while halted.

VIDEO PARTS LISTS (for reference)
- Clock part 1: 1 MΩ pot, 2x 1 kΩ, 100 kΩ, 330 Ω (LED), '2µF', 0.1 µF, 0.01 µF.
- Part 2: 1 kΩ, 1 MΩ, 330 Ω, 2 µF, 0.1 µF, 0.01 µF.
- Part 3: 2x 1 kΩ, 330 Ω, 0.01 µF, double-pole toggle.
- Part 4: 74LS04, 74LS08, 74LS32.


## Output display

DECIMAL DISPLAY EEPROM ALGORITHM
Verbatim from https://raw.githubusercontent.com/beneater/eeprom-programmer/master/multiplexed-display/multiplexed-display.ino (Copyright Ben Eater, MIT licensed), inside setup():

  // Bit patterns for the digits 0..9
  byte digits[] = { 0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b };

  Serial.println("Programming ones place");
  for (int value = 0; value <= 255; value += 1) {
    writeEEPROM(value, digits[value % 10]);
  }
  Serial.println("Programming tens place");
  for (int value = 0; value <= 255; value += 1) {
    writeEEPROM(value + 256, digits[(value / 10) % 10]);
  }
  Serial.println("Programming hundreds place");
  for (int value = 0; value <= 255; value += 1) {
    writeEEPROM(value + 512, digits[(value / 100) % 10]);
  }
  Serial.println("Programming sign");
  for (int value = 0; value <= 255; value += 1) {
    writeEEPROM(value + 768, 0);
  }

  Serial.println("Programming ones place (twos complement)");
  for (int value = -128; value <= 127; value += 1) {
    writeEEPROM((byte)value + 1024, digits[abs(value) % 10]);
  }
  Serial.println("Programming tens place (twos complement)");
  for (int value = -128; value <= 127; value += 1) {
    writeEEPROM((byte)value + 1280, digits[abs(value / 10) % 10]);
  }
  Serial.println("Programming hundreds place (twos complement)");
  for (int value = -128; value <= 127; value += 1) {
    writeEEPROM((byte)value + 1536, digits[abs(value / 100) % 10]);
  }
  Serial.println("Programming sign (twos complement)");
  for (int value = -128; value <= 127; value += 1) {
    if (value < 0) {
      writeEEPROM((byte)value + 1792, 0x01);
    } else {
      writeEEPROM((byte)value + 1792, 0);
    }
  }

Notes on the code:
- (byte)value converts to 0..255 before adding.
- C truncating division means -128/10 = -12 gives tens 2, and -128/100 = -1 gives hundreds 1.

ADDRESS LAYOUT (28C16 U45)
- A0-A7 = output register Q0-Q7.
- A8, A9 = digit select (A8 = LSB):
  - 00 = ones
  - 01 = tens
  - 10 = hundreds
  - 11 = sign/fourth digit
- A10 = signed mode, from SPDT SW7:
  - A10 = 0 (via R104 10 kΩ to GND): unsigned 0..255. Sign digit always blank.
  - A10 = 1 (VCC): two's complement -128..127. Sign digit = 0x01 (segment g only, a minus) when the value is negative, blank otherwise.
- ~CE = ~OE = GND, ~WE = VCC.

NO LEADING-ZERO BLANKING
- The tens and hundreds digits always come from digits[]. For example, 42 shows as ' 042' with a blank sign digit, and reset (OUT = 0) shows ' 000'.
- In signed mode, -13 shows '-013'. Ben demonstrates -13 = 0b11110011 (243 unsigned) and -62 = 0b11000010 (194 unsigned) at ~31:00 of dLh1n2dErzE.

SEGMENT-TO-BIT MAPPING
- EEPROM D7 = DP, D6 = a, D5 = b, D4 = c, D3 = d, D2 = e, D1 = f, D0 = g.
- Ben (dLh1n2dErzE ~4:18): the decimal point is the MSB on IO7, then a through g, with g as the LSB on IO0.
- Confirmed by the netlist: U45 D0 to G, D1 to F, D2 to E, D3 to D, D4 to C, D5 to B, D6 to A, D7 to DP.
- So 0x7e = '0' (abcdef), 0x30 = '1' (bc), and 0x01 = '-' (g).
- Displays are common cathode (4x 7SEGMENT_CC). DP is never lit, since bit 7 is always 0.
- This differs from the hex decoder in eeprom-programmer.ino, which used common-anode inverted codes; the commented-out common-cathode hex table there matches this mapping.

MULTIPLEXING CIRCUIT
- 555 U39 astable: VCC to R65 1 kΩ to DIS; DIS to R66 100 kΩ to THR/TR; C8 10 nF to GND; CV has C9 10 nF. Reset pin 4 is shown unconnected (marked X) in the schematic.
- Frequency = 1.44/((1k + 2·100k)·10 nF) ≈ 716 Hz. In the video Ben first used 2 µF for a slow demo, then 10 nF.
- Counter: 74LS76 U37, two JK flip-flops with J=K=PRE=CLR=1, so both toggle.
  - FF1 clock = 555 output, negative-edge triggered.
  - FF1 ~Q (pin 14) drives FF2 clock (pin 6), EEPROM A8 and 74LS139 A0.
  - FF2 ~Q (pin 10) drives EEPROM A9 and 74LS139 A1.
  - Taking the ~Q outputs gives an up-counter 0,1,2,3, which advances on each 555 falling edge.
  - eater.net: 74LS107 is a functional substitute with a different pinout.
- Decoder: 74LS139 U38 (half 1, ~E = GND), active-low outputs sinking the digit common cathodes:
  - O0 to U43 = ones (rightmost)
  - O1 to U42 = tens
  - O2 to U41 = hundreds
  - O3 to U40 = sign (leftmost)
- The EEPROM address and the enabled digit always match.
- Each digit is lit 1/4 of the time. Full refresh ≈ 179 Hz.

SIMULATOR SHORTCUT
- Render four digits directly from OUT and the mode switch using the formulas above.
- Optionally animate the multiplex at about 716 Hz digit rate.


## Other subtleties

OTHER SIMULATOR-RELEVANT SUBTLETIES

1. LDI and all operands are 4 bits.
- IO only drives IR[3:0], with BUS[7:4] forced to 0.
- So LDI loads 0..15, and JMP/JC/JZ/LDA/STA/ADD/SUB address only RAM 0..15.
- MAR and PC take only BUS[3:0]. Ben explains this in FCscQGBIL-Y ~4:50.

2. Unused opcodes 1001-1101 and NOP 0000.
- They perform only the fetch (T0/T1), with T2-T4 empty. 5 clocks; PC advances by 1.
- The operand nibble of OUT, HLT and NOP is ignored.

3. Fixed instruction length.
- Every instruction takes 5 clocks: T0 MI|CO, T1 RO|II|CE. The counter always runs T0-T4.
- HLT stops the clock at the start of T2.
- No microcode uses steps 5-7. They exist in the EEPROM (8 entries per opcode) but are unreachable because 74LS138 O5 resets the counter.

4. Flags.
- Only ADD and SUB update the flags (FI in T4).
- JC/JZ test the flags from the most recent ADD/SUB, not from LDA, LDI, etc. For example, to test A for zero you must ADD 0 or SUB something.
- Ben discusses an x86-style CMP as a possible addition (Zg1NdPKoosU ~35:50).
- Flags reset to 0 on reset. Their LEDs are labelled C and Z (green).

5. 'EEPROM with flags' wiring.
- Flags register Q0 (CF) goes to A8 and Q1 (ZF) goes to A9 of both microcode EEPROMs.
- A7 is the byte select: left EEPROM = GND = high byte, right EEPROM = VCC = low byte.
- A10 = GND.
- Both EEPROMs get the identical 1024-byte image from microcode-eeprom-with-flags.ino.
- FLAGS_Z0C1 = 1 means index bit 0 = carry = A8, and index bit 1 = zero = A9.

6. Microcode history (for simulating earlier videos).
- Part 3 (dHWFpkGsxOs): only LDA 0001, ADD 0010, OUT 1110, and later HLT 1111. EEPROMs were hand-programmed with A7-A10 = GND.
- JUVt_KYAp-I: Arduino programming, A7 used as byte select, SUB 0011 added.
- FCscQGBIL-Y: STA 0100, LDI 0101, JMP 0110 added (GitHub commit 'Add STA, LDI, and JMP instructions...').
- ObnosznZvHY: flags register hardware and the FI bit 0 added. The bit was unused/zero before; all bits up to that point were 15 signals.
- Zg1NdPKoosU: FI in ADD/SUB T4, JC 0111, JZ 1000.

7. RAM.
- The 74189 stores complemented data internally and its outputs are re-inverted by 74LS04s, so this is invisible at the bus.
- RAM is not cleared by reset; power-up contents are random.
- In program mode the RAM address and data come from the DIP switches and the write button. MI/RI are ignored for RAM addressing and writing, but RO would read the switch-selected address.

8. ALU bus output.
- EO places A+B or A-B on the bus. B is only loadable from the bus; there is no B-out.
- The ALU and the zero detector are combinational and always reflect the current A, B and SU, so the sum LEDs change live.

9. Reset is asynchronous and level-held.
- It clears A, B, IR, MAR, Flags, PC, OUT and the step counter, but not RAM.
- After reset the control word is MI|CO (NOP T0), so HLT releases and the clock resumes.

10. Known errata and quirks.
- The address loop in the flags sketch carries a stale comment ('Program the 8 high-order bits ... first 128 bytes').
- Ben fixes an off-by-one in printContents during the video (base < length).
- Ben's Fibonacci program skips 233 (his own note).
- eater.net notes the 74LS76 is hard to find; the 74LS107 is equivalent but has a different pinout.
- Ben observed a one-off misfetch in Part 3 (~35:00) and attributed it to a bumped breadboard wire; it is not a design behaviour.

11. Control/indicator LEDs a simulator may mirror.
- 16 blue control-word LEDs, all shown active-high.
- 5 green T0-T4 LEDs (lit when the 74LS138 output is low) plus 3 red binary step LEDs.
- PC: 4 green. MAR/RAM address: 4 yellow.
- RAM: 8 red. IR: 4 blue (opcode) + 4 yellow (operand).
- A, B, ALU and bus: 8 red each.
- Flags: 2 green. Program/run: red/green.
- HLT: blue LED on the control word. Clock: blue LED.

12. Microcode words in hex (bit15 = HLT .. bit0 = FI). Columns are T0, T1, T2, T3, T4:
- NOP: 4004 1408 0000 0000 0000
- LDA: 4004 1408 4800 1200 0000
- ADD: 4004 1408 4800 1020 0281
- SUB: 4004 1408 4800 1020 02C1
- STA: 4004 1408 4800 2100 0000
- LDI: 4004 1408 0A00 0000 0000
- JMP: 4004 1408 0802 0000 0000
- JC / JZ: 4004 1408 0802-if-flag-else-0000 0000 0000
- OUT: 4004 1408 0110 0000 0000
- HLT: 4004 1408 8000 0000 0000


## Example programs

### 28 + 14 (first program; LDA/ADD/OUT/HLT)  
_video: 8-bit CPU control logic: Part 3 (https://youtu.be/dHWFpkGsxOs; HLT added at address 3 at ~42:00). Re-run in 'reset circuit' (https://youtu.be/HtFro0UKqkk ~10:15) and 'Reprogramming CPU microcode' (https://youtu.be/JUVt_KYAp-I ~23:34). · confidence: high (transcripts confirm addresses, operands, data and the 42 result)_

| addr | asm | byte |
|---|---|---|
| 0 | LDA 14 | 0x1E (0001 1110) |
| 1 | ADD 15 | 0x2F (0010 1111) |
| 2 | OUT | 0xE0 (1110 0000) |
| 3 | HLT | 0xF0 (1111 0000) |
| 14 | data 28 | 0x1C (0001 1100) |
| 15 | data 14 | 0x0E (0000 1110) |

Expected: The display shows 42 (OUT latched on rising edge 13 after reset), then the computer halts. The halt LED lights after 17 rising edges, with step=2 and IR=0xF0. End state: A=42, B=14, flags CF=0, ZF=0. Pressing reset re-runs it. In the HtFro0UKqkk video Ben then changes the data and gets other sums, e.g. 12.

### Subtraction test: 5 + 6 - 7  
_video: Reprogramming CPU microcode with an Arduino (https://youtu.be/JUVt_KYAp-I ~26:14-30:34) · confidence: high (transcript gives the binary for each byte and the data)_

| addr | asm | byte |
|---|---|---|
| 0 | LDA 15 | 0x1F |
| 1 | ADD 14 | 0x2E |
| 2 | SUB 13 | 0x3D |
| 3 | OUT | 0xE0 |
| 4 | HLT | 0xF0 |
| 13 | data 7 | 0x07 |
| 14 | data 6 | 0x06 |
| 15 | data 5 | 0x05 |

Expected: Output 4, then halt. With the final flagged microcode the flags after SUB are CF=1 (11 >= 7) and ZF=0. When filmed, the microcode had no FI.

### Multiples of 3 (first program using LDI/STA/JMP)  
_video: Adding more machine language instructions to the CPU (https://youtu.be/FCscQGBIL-Y ~8:52-18:37) · confidence: high (transcript lists every byte in binary)_

| addr | asm | byte |
|---|---|---|
| 0 | LDI 3 | 0x53 (0101 0011) |
| 1 | STA 15 | 0x4F (0100 1111) |
| 2 | LDI 0 | 0x50 (0101 0000) |
| 3 | ADD 15 | 0x2F (0010 1111) |
| 4 | OUT | 0xE0 (1110 0000) |
| 5 | JMP 3 | 0x63 (0110 0011) |

Expected: RAM[15] becomes 3, then the display shows 3, 6, 9, ... forever. It wraps mod 256: 255, then 2, 5, 8, ... Each loop is 3 instructions = 15 clocks. With the final microcode, ADD sets CF on wrap.

### Count by tens (regression test after reprogramming flagged EEPROMs)  
_video: Conditional jump instructions (https://youtu.be/Zg1NdPKoosU ~22:14-22:55) · confidence: medium (narration confirms 'adds from 15, 10 in address 15, outputs, jumps back to zero'; exact addresses and order are inferred)_

| addr | asm | byte |
|---|---|---|
| 0 | ADD 15 | 0x2F |
| 1 | OUT | 0xE0 |
| 2 | JMP 0 | 0x60 |
| 15 | data 10 | 0x0A |

Expected: Starting from A=0 after reset, the display shows 10, 20, ..., 250, then 4 (260 mod 256) with the carry flag LED lit, then 14, 24, ... (CF clears again on the next non-wrapping ADD). Ben used it to show the carry flag being set and the code still running correctly in the CF=1 quarter of the EEPROM.

### Count up 0..255 then down to 0, repeat (first JC/JZ program)  
_video: Conditional jump instructions (https://youtu.be/Zg1NdPKoosU ~28:25-32:45) · confidence: high (Ben states the opcodes and operands for addresses 2 and 6 explicitly and describes all 8 lines)_

| addr | asm | byte |
|---|---|---|
| 0 | OUT | 0xE0 (1110 0000) |
| 1 | ADD 15 | 0x2F (0010 1111) |
| 2 | JC 4 | 0x74 (0111 0100) |
| 3 | JMP 0 | 0x60 (0110 0000) |
| 4 | SUB 15 | 0x3F (0011 1111) |
| 5 | OUT | 0xE0 (1110 0000) |
| 6 | JZ 0 | 0x80 (1000 0000) |
| 7 | JMP 4 | 0x64 (0110 0100) |
| 15 | data 1 | 0x01 |

Expected: Displays 0, 1, 2, ..., 255. Then ADD gives 0 with CF=1, so JC 4 jumps to the SUB loop: 0-1 = 255 (CF=0) is shown, so 255 appears twice. It counts 254, ..., 1, 0; at 0 ZF=1 so JZ 0 jumps to the OUT at address 0, which shows 0 again. Then it counts up again, forever. The sequence at turnarounds is ..254,255,255,254.. and ..1,0,0,1.. Ben ran it with a sped-up clock and saw the carry and zero flag LEDs flash at the turnarounds.

### Multiply x*y using JC (Turing-completeness demo)  
_video: Conditional jump instructions (https://youtu.be/Zg1NdPKoosU ~33:52-42:15; pseudocode motivated in 'Making a computer Turing complete' https://youtu.be/AqNDk_UJW4k) · confidence: high (narration confirms LDA 14, SUB 12 with 1 at address 12, JC 6, product at 13, x at 14, y at 15, results 15 and 56; full line-by-line listing matches the secondary source theshamblog.com)_

| addr | asm | byte |
|---|---|---|
| 0 | LDA 14   ; x | 0x1E |
| 1 | SUB 12   ; x-1 | 0x3C |
| 2 | JC 6     ; carry set unless x was 0 | 0x76 |
| 3 | LDA 13   ; product | 0x1D |
| 4 | OUT | 0xE0 |
| 5 | HLT | 0xF0 |
| 6 | STA 14   ; x = x-1 | 0x4E |
| 7 | LDA 13 | 0x1D |
| 8 | ADD 15   ; product += y | 0x2F |
| 9 | STA 13 | 0x4D |
| 10 | JMP 0 | 0x60 |
| 11 | (unused) | 0x00 (don't care) |
| 12 | data 1 | 0x01 |
| 13 | product (init 0) | 0x00 |
| 14 | x | 0x03 (first run) / 0x07 (second run) |
| 15 | y | 0x05 (first run) / 0x08 (second run) |

Expected: Run 1: x=3, y=5 outputs 15 and halts. Run 2: Ben re-initializes product to 0 and sets x=7, y=8; it outputs 56 and halts. After a run, RAM[14]=0 and RAM[13]=the product, so the product must be reset by hand before re-running. No intermediate values are displayed: OUT only at the end.

### Fibonacci (from Ben's earlier, pre-series video; same ISA)  
_video: Programming Fibonacci on a breadboard computer (https://youtu.be/a73ZXDJtU48) -- linked from eater.net/8bit but NOT in the 44-video playlist · confidence: medium (reconstructed from auto-captions: variables at 0xD/0xE/0xF, program occupies 0x0-0xC, byte 1 = 0100 1110 read out; remaining bytes follow Ben's line-by-line narration)_

| addr | asm | byte |
|---|---|---|
| 0 | LDI 1 | 0x51 |
| 1 | STA 14   ; y=1 | 0x4E |
| 2 | LDI 0    ; x=0 (kept in A) | 0x50 |
| 3 | OUT | 0xE0 |
| 4 | ADD 14   ; x+y | 0x2E |
| 5 | STA 15   ; z | 0x4F |
| 6 | LDA 14 | 0x1E |
| 7 | STA 13   ; x=y | 0x4D |
| 8 | LDA 15 | 0x1F |
| 9 | STA 14   ; y=z | 0x4E |
| 10 | LDA 13   ; A=x | 0x1D |
| 11 | JC 0 | 0x70 |
| 12 | JMP 3 | 0x63 |

Expected: Displays 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, then restarts at 0 forever. 233 is never shown, a bug Ben notes himself: the carry from 144+233 triggers the restart before 233 is output.


## Uncertainties

- The pin-level wiring comes from the KiCad 'revB' project (Aug 2018, made after the final April 2018 video), whose PNG exports are the eater.net schematics. The breadboard in the videos may differ in non-logical details: LED resistor values (videos mention 330/470 Ω, schematic 220 Ω), the clock capacitor (Ben's measured 2 µF vs 1 µF in the schematic), and the display 555 reset pin (unconnected in the schematic). Logic-level behaviour is consistent between the videos and the schematic.
- DIP-switch and write-button polarity is inferred from the schematic: switches pull to GND with no pull-ups, so closed reads 0 and open floats high to 1, and the button writes while pressed. Physical switch orientation on Ben's board was not verified.
- Leading zeros on the display ('042', '000') follow from the verbatim display code; not visually confirmed from video frames.
- The order of the count-by-10 test program (ADD 15 / OUT / JMP 0) is inferred from narration; Ben did not read out the bytes.
- Fibonacci listing is reconstructed from auto-generated captions of a video outside the playlist (Ben's older build). The opcode numbering matches (byte 1 = 0x4E = STA 14), but not every byte was read aloud.
- Multiply program address 11 is unused/unspecified (shown as '-' in the secondary listing). The complete 16-byte listing is from a secondary source; Ben's narration confirms its key elements.
- Exact clock frequency range depends on the actual capacitor: nominal schematic gives ~0.72-480 Hz; Ben observed ~300 Hz max. Monostable pulse is ~110 ms (1.1·RC), and Ben calls it 0.1 s.
- Analog effects are not modelled: the RC edge detector also produces a negative spike on CLK falling edges (a known community issue), and EEPROM output glitches can occur during step transitions. Neither affects the logic-level model above.
- Behaviour under bus contention or undefined control words is not specified by Ben; the shipped microcode never enables two bus drivers at once.
- The 74LS76 ~Q-based counter starts in an arbitrary state at power-up; only its free-running cycling matters.

## Sources

- https://github.com/beneater/eeprom-programmer (README: MIT license, sketch-to-video mapping)
- https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-with-flags/microcode-eeprom-with-flags.ino
- https://raw.githubusercontent.com/beneater/eeprom-programmer/master/microcode-eeprom-programmer/microcode-eeprom-programmer.ino (pre-flags; 0-127 high byte / 128-255 low byte)
- https://raw.githubusercontent.com/beneater/eeprom-programmer/master/multiplexed-display/multiplexed-display.ino
- https://raw.githubusercontent.com/beneater/eeprom-programmer/master/eeprom-programmer/eeprom-programmer.ino
- https://eater.net/8bit and subpages /clock /registers /alu /ram /pc /output /bus /control /schematics /parts
- https://eater.net/schematics/{high-level,clock,a-register,b-register,ir,alu,mar,ram,pc,output,control}.png
- https://eater.net/downloads/8bit-computer.zip (KiCad project, revB, netlist dated 2018-08-18; parsed 8bit-computer.net for pin-level connectivity)
- https://eater.net/datasheets/74189.pdf (74F189 function table: write gives high-Z outputs, read gives complement of stored data)
- Video transcripts (YouTube captions, read via the in-app browser): Zg1NdPKoosU, ObnosznZvHY, dHWFpkGsxOs, X7rCxs1ppyY, HtFro0UKqkk, JUVt_KYAp-I, FCscQGBIL-Y, AwUirxi9eBg, Vw3uDOUJRGw, -6JAgFWCL9w, dLh1n2dErzE, kRlSFm519Bo, 81BgFhm2vz8, AqNDk_UJW4k, a73ZXDJtU48
- YouTube video descriptions/chapters for all 44 playlist videos (https://www.youtube.com/playlist?list=PLowKtXNTBypGqImE405J2565dvjafglHU)
- SECONDARY: https://theshamblog.com/programs-and-more-commands-for-the-ben-eater-8-bit-breadboard-computer/ (multiply listing, Fibonacci 233 bug)
- SECONDARY: https://github.com/XarkLabs/BenEaterSV rtl/cpu_mem.sv (independent ISA table agreeing that unused opcodes act as NOP and LDI loads 4 LSBs)
