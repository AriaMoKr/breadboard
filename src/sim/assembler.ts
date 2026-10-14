import { INSTRUCTION_BY_MNEMONIC, INSTRUCTION_BY_OPCODE, INSTRUCTIONS, type InstructionDef } from './microcode';

/**
 * Tiny assembler for Ben Eater's 8-bit computer (16 bytes of RAM).
 *
 * Syntax (case-insensitive, `;` or `#` starts a comment):
 *
 *   ; multiply x * y
 *   top:    LDA x          ; mnemonic + label/number operand (0-15)
 *           SUB one
 *           JC  cont
 *           OUT
 *           HLT
 *   .org 12                ; or "org 12": move the location counter
 *   one:    .db 1          ; data byte, also "db 1" or a bare number
 *   x:      3
 *   14: 28                 ; "<addr>:" prefix sets the address (Ben's notation)
 *
 * Numbers: decimal, 0x1f / $1f hex, 0b1010 / %1010 binary, negative decimals
 * are stored as two's complement. A 0bxxxx_xxxx literal may also be used as a
 * raw instruction byte.
 *
 * Ben's own notation from the videos also works: 4-digit binary addresses and
 * operands ("1110: ...", "LDA 1110") and 8-bit binary bytes, with or without
 * a space between the nibbles ("0001 1110", "00011110").
 */

export interface AsmError {
  line: number; // 1-based
  message: string;
}

export interface ListingLine {
  addr: number;
  byte: number;
  line: number;
  source: string;
}

export interface AsmResult {
  bytes: number[]; // always 16 entries
  errors: AsmError[];
  listing: ListingLine[];
  labels: Record<string, number>;
  /** Source line (1-based) that produced each address, or 0. */
  lineOfAddress: number[];
}

const LABEL_RE = /^[A-Za-z_.][\w.]*$/;
/** Ben-style 4-bit binary address/operand, e.g. "1110". */
const BIN4_RE = /^[01]{4}$/;
/** Ben-style 8-bit binary byte, e.g. "0001 1110" or "00011110". */
const BIN8_RE = /^(?:[01]{8}|[01]{4}[\s_]+[01]{4})$/;

export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/_/g, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^-?\d+$/))) return parseInt(t, 10);
  if ((m = t.match(/^(?:0x|\$)([0-9a-f]+)$/i))) return parseInt(m[1], 16);
  if ((m = t.match(/^(?:0b|%)([01]+)$/i))) return parseInt(m[1], 2);
  return null;
}

interface Pending {
  addr: number;
  line: number;
  source: string;
  instr?: InstructionDef;
  operand?: string;
  data?: string;
}

export function assemble(source: string): AsmResult {
  const errors: AsmError[] = [];
  const labels: Record<string, number> = {};
  const items: Pending[] = [];
  let pc = 0;

  const lines = source.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    let text = raw.replace(/[;#].*$/, '').trim();
    if (!text) return;

    // leading "label:" or "<addr>:" prefixes (several allowed: "14: x: 28")
    for (;;) {
      const m = text.match(/^([^\s:]+)\s*:\s*(.*)$/);
      if (!m) break;
      const [, head, rest] = m;
      const n = BIN4_RE.test(head) ? parseInt(head, 2) : parseNumber(head);
      if (n !== null) {
        if (n < 0 || n > 15) errors.push({ line: lineNo, message: `Address ${head} out of range (0-15)` });
        else pc = n;
      } else if (LABEL_RE.test(head)) {
        const key = head.toLowerCase();
        if (key in labels) errors.push({ line: lineNo, message: `Duplicate label "${head}"` });
        labels[key] = pc;
      } else {
        errors.push({ line: lineNo, message: `Bad label "${head}"` });
      }
      text = rest.trim();
    }
    if (!text) return;

    if (BIN8_RE.test(text)) {
      if (pc > 15) errors.push({ line: lineNo, message: 'Program does not fit in 16 bytes of RAM' });
      else items.push({ addr: pc++, line: lineNo, source: raw.trim(), data: text });
      return;
    }

    const [word, ...restParts] = text.split(/\s+/);
    const rest = restParts.join(' ').trim();
    const upper = word.toUpperCase();

    if (upper === '.ORG' || upper === 'ORG') {
      const n = parseNumber(rest);
      if (n === null || n < 0 || n > 15) errors.push({ line: lineNo, message: `Bad .org address "${rest}"` });
      else pc = n;
      return;
    }

    if (pc > 15) {
      errors.push({ line: lineNo, message: 'Program does not fit in 16 bytes of RAM' });
      return;
    }

    if (upper === '.DB' || upper === 'DB' || upper === '.BYTE') {
      items.push({ addr: pc++, line: lineNo, source: raw.trim(), data: rest });
      return;
    }

    const instr = INSTRUCTION_BY_MNEMONIC.get(upper);
    if (instr) {
      if (instr.operand === 'none' && rest) {
        // Ben sometimes writes "OUT 0" etc.; allow an explicit operand anyway.
      }
      items.push({ addr: pc++, line: lineNo, source: raw.trim(), instr, operand: rest || undefined });
      return;
    }

    if (parseNumber(word) !== null && !rest) {
      items.push({ addr: pc++, line: lineNo, source: raw.trim(), data: word });
      return;
    }

    errors.push({ line: lineNo, message: `Unknown instruction "${word}"` });
  });

  const bytes = new Array<number>(16).fill(0);
  const lineOfAddress = new Array<number>(16).fill(0);
  const listing: ListingLine[] = [];
  const used = new Map<number, number>();

  const resolveValue = (text: string, line: number, min: number, max: number, what: string): number => {
    const n = BIN8_RE.test(text)
      ? parseInt(text.replace(/[\s_]/g, ''), 2)
      : max === 15 && BIN4_RE.test(text)
        ? parseInt(text, 2)
        : parseNumber(text);
    let v: number | undefined;
    if (n !== null) v = n;
    else if (LABEL_RE.test(text) && text.toLowerCase() in labels) v = labels[text.toLowerCase()];
    if (v === undefined) {
      errors.push({ line, message: `Unknown ${what} "${text}"` });
      return 0;
    }
    if (v < min || v > max) {
      errors.push({ line, message: `${what[0].toUpperCase() + what.slice(1)} ${text} out of range (${min}..${max})` });
      return 0;
    }
    return v;
  };

  for (const it of items) {
    let byte = 0;
    if (it.instr) {
      let operand = 0;
      if (it.operand !== undefined) operand = resolveValue(it.operand, it.line, 0, 15, it.instr.operand === 'immediate' ? 'immediate' : 'operand');
      else if (it.instr.operand !== 'none') errors.push({ line: it.line, message: `${it.instr.mnemonic} needs an operand` });
      byte = (it.instr.opcode << 4) | operand;
    } else if (it.data !== undefined) {
      byte = resolveValue(it.data, it.line, -128, 255, 'value') & 0xff;
    }
    if (used.has(it.addr)) errors.push({ line: it.line, message: `Address ${it.addr} already used by line ${used.get(it.addr)}` });
    used.set(it.addr, it.line);
    bytes[it.addr] = byte;
    lineOfAddress[it.addr] = it.line;
    listing.push({ addr: it.addr, byte, line: it.line, source: it.source });
  }
  listing.sort((x, y) => x.addr - y.addr);
  return { bytes, errors, listing, labels, lineOfAddress };
}

/** Disassemble one byte, e.g. 0x1e -> "LDA 14". Unknown opcodes show as "??? n". */
export function disassemble(byte: number): string {
  const op = (byte >> 4) & 15;
  const arg = byte & 15;
  const instr = INSTRUCTION_BY_OPCODE.get(op);
  if (!instr) return `??? ${arg}`;
  return instr.operand === 'none' ? instr.mnemonic : `${instr.mnemonic} ${arg}`;
}

/** Produce assembler source from a RAM image (one line per address, Ben-style). */
export function disassembleProgram(bytes: ArrayLike<number>): string {
  const out: string[] = [];
  for (let i = 0; i < 16; i++) {
    const b = bytes[i] ?? 0;
    out.push(`${String(i).padStart(2, ' ')}: ${disassemble(b).padEnd(8)} ; ${b.toString(2).padStart(8, '0')}  ${b}`);
  }
  return out.join('\n');
}

export const MNEMONICS = INSTRUCTIONS.map((i) => i.mnemonic);

export const bin = (v: number, width = 8) => (v >>> 0).toString(2).padStart(width, '0').slice(-width);
export const hex = (v: number, width = 2) => (v >>> 0).toString(16).toUpperCase().padStart(width, '0');
