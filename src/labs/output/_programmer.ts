import type { Level } from '../../logic/circuit';
import { Cascade595, Eeprom28C16, HEX_CA, formatContentsLine, setAddressBytes, shiftOutBits } from './_shared';

/**
 * A line-by-line simulation of Ben's Arduino Nano EEPROM programmer
 * (video 32): the sketch's functions are generators that yield after every
 * source line (and every shiftOut bit), so the lab can highlight the line
 * being executed and step through it. No DOM here; unit-tested.
 */

export const SHIFT_DATA = 2;
export const SHIFT_CLK = 3;
export const SHIFT_LATCH = 4;
export const EEPROM_D0 = 5;
export const EEPROM_D7 = 12;
export const WRITE_EN = 13;

/**
 * The sketch, after Ben Eater's eeprom-programmer.ino (MIT licence). A line
 * ending in `//@id` can be highlighted; the marker is stripped for display.
 */
const SOURCE = `#define SHIFT_DATA 2
#define SHIFT_CLK 3
#define SHIFT_LATCH 4
#define EEPROM_D0 5
#define EEPROM_D7 12
#define WRITE_EN 13

/*
 * Output the address bits and outputEnable signal using shift registers.
 */
void setAddress(int address, bool outputEnable) {
  shiftOut(SHIFT_DATA, SHIFT_CLK, MSBFIRST, (address >> 8) | (outputEnable ? 0x00 : 0x80));//@sa1
  shiftOut(SHIFT_DATA, SHIFT_CLK, MSBFIRST, address);//@sa2

  digitalWrite(SHIFT_LATCH, LOW);//@sa3
  digitalWrite(SHIFT_LATCH, HIGH);//@sa4
  digitalWrite(SHIFT_LATCH, LOW);//@sa5
}

/*
 * Read a byte from the EEPROM at the specified address.
 */
byte readEEPROM(int address) {
  for (int pin = EEPROM_D0; pin <= EEPROM_D7; pin += 1) {
    pinMode(pin, INPUT);//@rd1
  }
  setAddress(address, /*outputEnable*/ true);//@rd2

  byte data = 0;
  for (int pin = EEPROM_D7; pin >= EEPROM_D0; pin -= 1) {
    data = (data << 1) + digitalRead(pin);//@rd3
  }
  return data;//@rd4
}

/*
 * Write a byte to the EEPROM at the specified address.
 */
void writeEEPROM(int address, byte data) {
  setAddress(address, /*outputEnable*/ false);//@wr1
  for (int pin = EEPROM_D0; pin <= EEPROM_D7; pin += 1) {
    pinMode(pin, OUTPUT);//@wr2
  }

  for (int pin = EEPROM_D0; pin <= EEPROM_D7; pin += 1) {
    digitalWrite(pin, data & 1);//@wr3
    data = data >> 1;
  }
  digitalWrite(WRITE_EN, LOW);//@wr4
  delayMicroseconds(1);//@wr5
  digitalWrite(WRITE_EN, HIGH);//@wr6
  delay(10);//@wr7
}

/*
 * Read the contents of the EEPROM and print them to the serial monitor.
 */
void printContents() {
  for (int base = 0; base <= 255; base += 16) {//@pc1
    byte data[16];
    for (int offset = 0; offset <= 15; offset += 1) {
      data[offset] = readEEPROM(base + offset);//@pc2
    }

    char buf[80];
    sprintf(buf, "%03x:  %02x %02x %02x %02x %02x %02x %02x %02x   %02x %02x %02x %02x %02x %02x %02x %02x",
            base, data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
            data[8], data[9], data[10], data[11], data[12], data[13], data[14], data[15]);//@pc3

    Serial.println(buf);//@pc4
  }
}

// 4-bit hex decoder for common anode 7-segment display
byte data[] = { 0x81, 0xcf, 0x92, 0x86, 0xcc, 0xa4, 0xa0, 0x8f, 0x80, 0x84, 0x88, 0xe0, 0xb1, 0xc2, 0xb0, 0xb8 };

// 4-bit hex decoder for common cathode 7-segment display
// byte data[] = { 0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b, 0x77, 0x1f, 0x4e, 0x3d, 0x4f, 0x47 };

void setup() {
  pinMode(SHIFT_DATA, OUTPUT);
  pinMode(SHIFT_CLK, OUTPUT);
  pinMode(SHIFT_LATCH, OUTPUT);
  digitalWrite(WRITE_EN, HIGH);
  pinMode(WRITE_EN, OUTPUT);
  Serial.begin(57600);

  // Erase entire EEPROM
  Serial.print("Erasing EEPROM");//@er1
  for (int address = 0; address <= 2047; address += 1) {
    writeEEPROM(address, 0xff);//@er2

    if (address % 64 == 0) {
      Serial.print(".");//@er3
    }
  }
  Serial.println(" done");//@er4

  // Program data bytes
  Serial.print("Programming EEPROM");//@su1
  for (int address = 0; address < sizeof(data); address += 1) {
    writeEEPROM(address, data[address]);//@su2
    if (address % 64 == 0) {
      Serial.print(".");//@su3
    }
  }
  Serial.println(" done");//@su4

  // Read and print out the contents of the EERPROM
  Serial.println("Reading EEPROM");//@su5
  printContents();//@su6
}

void loop() {
}`;

export interface CodeLine {
  text: string;
  id: string | null;
}

export const CODE_LINES: CodeLine[] = SOURCE.split('\n').map((line) => {
  const m = /\/\/@(\w+)$/.exec(line);
  return m ? { text: line.slice(0, m.index), id: m[1] } : { text: line, id: null };
});

export const LINE_INDEX = new Map(CODE_LINES.flatMap((l, i) => (l.id ? [[l.id, i] as const] : [])));

export interface Ev {
  /** Source line id (see CODE_LINES). */
  line: string;
  note?: string;
}

/** Microseconds each Arduino call takes (roughly what a 16 MHz Nano does). */
const COST_US = { digitalWrite: 4, digitalRead: 4, pinMode: 4 };

export class ArduinoProgrammer {
  /** Output latch of each Arduino pin. */
  readonly pin: Record<number, 0 | 1> = {};
  readonly mode: Record<number, 'INPUT' | 'OUTPUT'> = {};
  readonly sr = new Cascade595();
  readonly rom = new Eeprom28C16();
  serial = '';
  /** Simulated time (µs). */
  us = 0;
  /** Skip the pinMode(INPUT) loop in readEEPROM (to see why it matters). */
  forgetInputMode = false;
  lastWrite: { addr: number; data: number; stored: boolean } | null = null;
  lastRead: { addr: number; data: number } | null = null;
  private weFellAt = 0;
  /** Time between the W̅E̅ edges of the last write (µs). */
  lastPulseUs = 0;

  constructor(private rand: () => number = Math.random) {
    for (let p = 2; p <= 13; p++) {
      this.pin[p] = 0;
      this.mode[p] = 'INPUT';
    }
    // what setup() does before the interesting part
    for (const p of [SHIFT_DATA, SHIFT_CLK, SHIFT_LATCH, WRITE_EN]) this.mode[p] = 'OUTPUT';
    this.pin[WRITE_EN] = 1;
  }

  get weN(): 0 | 1 {
    return this.pin[WRITE_EN];
  }

  /** Levels on the 8 EEPROM I/O lines (index = bit = pin - 5): Arduino and EEPROM can both drive them. */
  ioLevels(): Level[] {
    const out = this.rom.output(this.sr.address, 0, this.sr.oeN, this.weN);
    return Array.from({ length: 8 }, (_, b) => {
      const p = EEPROM_D0 + b;
      const a: Level | null = this.mode[p] === 'OUTPUT' ? this.pin[p] : null;
      const e: Level | null = out === null ? null : (((out >> b) & 1) as 0 | 1);
      if (a === null && e === null) return 'Z';
      if (a === null) return e!;
      if (e === null) return a;
      return a === e ? a : 'X';
    });
  }

  digitalWrite(p: number, v: 0 | 1) {
    this.us += COST_US.digitalWrite;
    const was = this.pin[p];
    this.pin[p] = v;
    if (p === SHIFT_CLK && was === 0 && v === 1) this.sr.clock(this.pin[SHIFT_DATA]);
    if (p === SHIFT_LATCH && was === 0 && v === 1) this.sr.rclk();
    if (p === WRITE_EN && was === 1 && v === 0) this.weFellAt = this.us;
    if (p === WRITE_EN && was === 0 && v === 1) {
      // Data is latched on the rising edge of W̅E̅. The pulse is meant to be the
      // 1 µs of delayMicroseconds(1); digitalWrite's own overhead makes the real
      // one a little longer, which the chip tolerates in practice.
      const lv = this.ioLevels();
      const data = lv.reduce<number>((acc, l, b) => acc | ((l === 1 ? 1 : 0) << b), 0);
      this.lastPulseUs = this.us - COST_US.digitalWrite - this.weFellAt;
      const r = this.rom.write(this.sr.address, data, { ceN: 0, oeN: this.sr.oeN, pulseNs: 1000 });
      this.lastWrite = { addr: this.sr.address, data, stored: r.stored };
    }
  }

  digitalRead(p: number): 0 | 1 {
    this.us += COST_US.digitalRead;
    const l = this.ioLevels()[p - EEPROM_D0];
    if (l === 0 || l === 1) return l;
    return this.rand() < 0.5 ? 0 : 1; // floating or fighting: anyone's guess
  }

  pinMode(p: number, m: 'INPUT' | 'OUTPUT') {
    this.us += COST_US.pinMode;
    this.mode[p] = m;
  }

  print(s: string) {
    this.serial += s;
    this.us += s.length * 173.6; // 10 bits per character at 57600 baud
  }

  // ---- the sketch, as generators ----

  *shiftOut(byte: number, line: string): Generator<Ev> {
    const bits = shiftOutBits(byte, true);
    for (let i = 0; i < 8; i++) {
      this.digitalWrite(SHIFT_DATA, bits[i]);
      yield { line, note: `shiftOut: bit ${7 - i} of 0x${byte.toString(16).padStart(2, '0')} = ${bits[i]} on SHIFT_DATA` };
      this.digitalWrite(SHIFT_CLK, 1);
      yield { line, note: `shiftOut: SHIFT_CLK rises, both 595s shift by one (QH′ of #1 feeds #2)` };
      this.digitalWrite(SHIFT_CLK, 0);
      yield { line, note: `shiftOut: SHIFT_CLK low` };
    }
  }

  *setAddress(address: number, outputEnable: boolean): Generator<Ev> {
    const [hi, lo] = setAddressBytes(address, outputEnable);
    yield* this.shiftOut(hi, 'sa1');
    yield* this.shiftOut(lo, 'sa2');
    this.digitalWrite(SHIFT_LATCH, 0);
    yield { line: 'sa3' };
    this.digitalWrite(SHIFT_LATCH, 1);
    yield { line: 'sa4', note: 'SHIFT_LATCH rises: both 595s copy their shift registers to their outputs at once' };
    this.digitalWrite(SHIFT_LATCH, 0);
    yield { line: 'sa5' };
  }

  *readEEPROM(address: number): Generator<Ev, number> {
    if (this.forgetInputMode) yield { line: 'rd1', note: 'BUG: pinMode(pin, INPUT) skipped, so the data pins are still outputs' };
    else
      for (let p = EEPROM_D0; p <= EEPROM_D7; p++) {
        this.pinMode(p, 'INPUT');
        yield { line: 'rd1', note: `pinMode(D${p}, INPUT)` };
      }
    yield* this.setAddress(address, true);
    yield { line: 'rd2' };
    let data = 0;
    for (let p = EEPROM_D7; p >= EEPROM_D0; p--) {
      data = ((data << 1) + this.digitalRead(p)) & 0xff;
      yield { line: 'rd3', note: `digitalRead(D${p}) → data = ${data.toString(2).padStart(8 - (p - EEPROM_D0), '0')}` };
    }
    this.lastRead = { addr: address, data };
    yield { line: 'rd4', note: `readEEPROM(0x${address.toString(16).padStart(3, '0')}) returns 0x${data.toString(16).padStart(2, '0')}` };
    return data;
  }

  *writeEEPROM(address: number, data: number): Generator<Ev> {
    yield* this.setAddress(address, false);
    yield { line: 'wr1' };
    for (let p = EEPROM_D0; p <= EEPROM_D7; p++) {
      this.pinMode(p, 'OUTPUT');
      yield { line: 'wr2', note: `pinMode(D${p}, OUTPUT)` };
    }
    let d = data & 0xff;
    for (let p = EEPROM_D0; p <= EEPROM_D7; p++) {
      this.digitalWrite(p, (d & 1) as 0 | 1);
      yield { line: 'wr3', note: `digitalWrite(D${p}, ${d & 1}): I/O${p - EEPROM_D0}` };
      d >>= 1;
    }
    this.digitalWrite(WRITE_EN, 0);
    yield { line: 'wr4' };
    this.us += 1;
    yield { line: 'wr5' };
    this.digitalWrite(WRITE_EN, 1);
    yield { line: 'wr6' };
    this.us += 10_000;
    yield { line: 'wr7' };
  }

  *printContents(): Generator<Ev> {
    for (let base = 0; base <= 255; base += 16) {
      yield { line: 'pc1', note: `base = 0x${base.toString(16).padStart(3, '0')}` };
      const data: number[] = [];
      for (let off = 0; off <= 15; off++) {
        data.push(yield* this.readEEPROM(base + off));
        yield { line: 'pc2' };
      }
      const buf = formatContentsLine(base, data);
      yield { line: 'pc3', note: buf };
      this.print(buf + '\n');
      yield { line: 'pc4' };
    }
  }

  /** The first loop of setup(): write 0xFF to all 2048 bytes (about 20 s of delay(10) on the real Nano). */
  *eraseAll(): Generator<Ev> {
    this.print('Erasing EEPROM');
    yield { line: 'er1' };
    for (let a = 0; a <= 2047; a++) {
      yield* this.writeEEPROM(a, 0xff);
      yield { line: 'er2', note: `erased 0x${a.toString(16).padStart(3, '0')}` };
      if (a % 64 === 0) {
        this.print('.');
        yield { line: 'er3' };
      }
    }
    this.print(' done\n');
    yield { line: 'er4' };
  }

  /** The body of setup() after the erase: program data[] then print the contents. */
  *programTable(data: ArrayLike<number> = HEX_CA, thenPrint = true): Generator<Ev> {
    this.print('Programming EEPROM');
    yield { line: 'su1' };
    for (let a = 0; a < data.length; a++) {
      yield* this.writeEEPROM(a, data[a]);
      yield { line: 'su2' };
      if (a % 64 === 0) {
        this.print('.');
        yield { line: 'su3' };
      }
    }
    this.print(' done\n');
    yield { line: 'su4' };
    if (!thenPrint) return;
    this.print('Reading EEPROM\n');
    yield { line: 'su5' };
    yield* this.printContents();
    yield { line: 'su6' };
  }
}

/** Run a generator to completion (tests / "instant" speed). Returns the number of events. */
export function runAll(gen: Generator<Ev, unknown>, max = 5_000_000): number {
  let n = 0;
  while (n < max && !gen.next().done) n++;
  return n;
}
