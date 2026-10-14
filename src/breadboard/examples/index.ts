import type { Layout } from '../layout';
import { buildCounter } from './counter';
import { buildDLatch } from './d-latch';
import { buildHexDisplay } from './hex-display';
import { buildRegister } from './register';
import { buildSrLatch } from './sr-latch';

/** A ready-made circuit for the breadboard sandbox, simulated by BreadboardSim. */
export interface BreadboardExample {
  id: string;
  title: string;
  description: string;
  build(): Layout;
}

export const EXAMPLES: BreadboardExample[] = [
  {
    id: 'sr-latch',
    title: 'SR latch',
    description: 'Two cross-coupled NOR gates (74LS02) remember one bit. Press S to set Q, R to reset it; with both released the latch holds. Press both for the "invalid" state where Q and Q̅ are both off.',
    build: buildSrLatch,
  },
  {
    id: 'd-latch',
    title: 'D latch',
    description: 'AND gates (74LS08) and an inverter (74LS04) in front of an SR latch (74LS02). While E is on, Q follows D; turn E off and Q holds whatever D was.',
    build: buildDLatch,
  },
  {
    id: 'counter',
    title: 'Binary counter',
    description: 'A 555 timer in astable mode clocks a 74LS161 4-bit counter. The blue LED is the clock; the green LEDs count 0 to 15 in binary (Q0 on the left).',
    build: buildCounter,
  },
  {
    id: 'register',
    title: '4-bit register',
    description: 'A 74LS173 stores the DIP switch value when you press LOAD (its clock). Change the switches: the LEDs keep the old value until the next press.',
    build: buildRegister,
  },
  {
    id: 'hex-display',
    title: 'EEPROM hex display',
    description: 'A 28C16 EEPROM used as a lookup table: the DIP switch sets the address, and the byte stored there (Ben\'s hex-digit table) lights a common-anode 7-segment display.',
    build: buildHexDisplay,
  },
];

/** Example by id. */
export const exampleById = (id: string): BreadboardExample | undefined => EXAMPLES.find((e) => e.id === id);
