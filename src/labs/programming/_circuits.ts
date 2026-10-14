/**
 * Gate-level flags register from "CPU flags register" (video 43), DOM-free
 * so it can be unit-tested.
 */
import { Circuit, type Level, type Net } from '../../logic/circuit';
import { addMux } from '../control/_circuits';

export interface FlagsCircuit {
  c: Circuit;
  /** ALU sum bits S0..S7 (driven by the lab from the A/B/SU ALU model). */
  sum: Net[];
  /** Carry out C4 of the high 74LS283. */
  c4: Net;
  /** FI control line (active high in the microcode), ~FI after the spare 74LS04. */
  fi: Net;
  fin: Net;
  clk: Net;
  /** CLR from the reset circuit (the 74LS173 MR pin). */
  clr: Net;
  /** 74LS02 outputs. */
  nors: Net[];
  /** 74LS08 outputs U23A, U23C and U23B (= zero). */
  and1: Net;
  and2: Net;
  zero: Net;
  /** 74LS173 outputs Q0 = CF, Q1 = ZF. */
  cf: Net;
  zf: Net;
  /** 1 = EEPROM A8/A9 wired to CF/ZF (after video 43), 0 = tied to GND (before). */
  rewired: Net;
  a8: Net;
  a9: Net;
  gnd: Net;
  setSum(value: number, carry: number): void;
}

export function buildFlagsCircuit(): FlagsCircuit {
  const c = new Circuit();
  const sum = Array.from({ length: 8 }, (_, i) => c.input(`Σ${i}`, 0));
  const c4 = c.input('C4', 0);
  const fi = c.input('FI', 0);
  const clk = c.input('CLK', 0);
  const clr = c.input('CLR', 0);
  const rewired = c.input('rewired', 1);
  const gnd = c.input('GND', 0);
  const fin = c.net('F̅I̅', 1);
  const nors = [0, 1, 2, 3].map((i) => c.net(`NOR${i + 1}`, 1));
  const and1 = c.net('U23A', 1);
  const and2 = c.net('U23C', 1);
  const zero = c.net('Z', 1);
  const cf = c.net('CF', 0);
  const zf = c.net('ZF', 0);
  const a8 = c.net('A8', 0);
  const a9 = c.net('A9', 0);

  for (let i = 0; i < 4; i++) c.nor([sum[2 * i], sum[2 * i + 1]], nors[i]); // 74LS02 U22
  c.and([nors[0], nors[1]], and1); // U23A
  c.and([nors[2], nors[3]], and2); // U23C
  c.and([and1, and2], zero); //       U23B
  c.not(fi, fin); //                  spare inverter on the control board (U53)

  // 74LS173 U19: D0 = C4, D1 = zero; G̅1 = G̅2 = F̅I̅; M = N = GND; MR = CLR.
  c.add({
    kind: '74LS173',
    name: 'flags register',
    inputs: [clk, fin, c4, zero, clr],
    outputs: [cf, zf],
    delay: 2,
    evaluate: ([ck, g, d0, d1, mr], ctx) => {
      const st = ctx.state as { q0?: Level; q1?: Level };
      if (mr === 1) {
        st.q0 = 0;
        st.q1 = 0;
      } else if (ctx.prevInputs[0] === 0 && ck === 1 && g === 0) {
        st.q0 = d0;
        st.q1 = d1;
      }
      return [st.q0 ?? 0, st.q1 ?? 0];
    },
  });
  addMux(c, rewired, cf, gnd, a8);
  addMux(c, rewired, zf, gnd, a9);
  c.settle();

  return {
    c, sum, c4, fi, fin, clk, clr, nors, and1, and2, zero, cf, zf, rewired, a8, a9, gnd,
    setSum(value: number, carry: number) {
      sum.forEach((n, i) => c.set(n, ((value >> i) & 1) as 0 | 1));
      c.set(c4, carry ? 1 : 0);
    },
  };
}
