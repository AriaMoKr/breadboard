import type { Layout } from '../layout';
import { buildCounter } from './counter';
import { buildDLatch } from './d-latch';
import { buildDivide60 } from './divide60';
import { buildHexDisplay } from './hex-display';
import { buildRegister } from './register';
import { buildSeconds } from './seconds';
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
  {
    id: 'divide-60',
    title: 'Divide by 60 (clock part 3)',
    description: 'Ben’s 60 Hz divider from his digital clock: a 74LS90 divides by 2 and 5, a 74LS92 by 2 and 3, so the red LED blinks once for every 60 pulses. A 555 stands in for the 60 Hz he takes from the mains.',
    build: buildDivide60,
  },
  {
    id: 'seconds',
    title: 'Seconds 00-59 (clock part 4)',
    description: 'The seconds of Ben’s digital clock: a 74LS90 counts the units, a 74LS92 the tens 0-5, and two CD4511 decoders light the displays. ZERO resets them. A 555 stands in for the one pulse a second.',
    build: buildSeconds,
  },
];

/** Example by id. */
export const exampleById = (id: string): BreadboardExample | undefined => EXAMPLES.find((e) => e.id === id);
