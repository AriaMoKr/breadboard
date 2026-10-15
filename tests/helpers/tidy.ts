import { CHIPS } from '../../src/breadboard/catalog';
import { BOARD_H, BOARD_W, ROW_Y, colX, dipRows, holeXY, parseHole } from '../../src/breadboard/geometry';
import { partPins, type Layout, type ModuleBoardDef, type Part } from '../../src/breadboard/layout';

// ---------------------------------------------------------------------------
// tidy layouts: what a netlist check can't see

/** Drawn outline of a chip, display or LED dome (as src/breadboard/render.ts draws them), board-local. */
function bodies(L: Layout): { board: string; id: string; x0: number; y0: number; x1: number; y1: number }[] {
  const out: ReturnType<typeof bodies> = [];
  for (const p of L.parts) {
    if (p.kind === 'chip') {
      const def = CHIPS[p.chip];
      const n = def.pins.length / 2;
      const [top, bottom] = dipRows(def.spacing);
      const c0 = p.rotated ? p.col - n + 1 : p.col;
      out.push({ board: p.board, id: p.id, x0: colX(c0) - 0.47, x1: colX(c0 + n - 1) + 0.47, y0: ROW_Y[top] + 0.22, y1: ROW_Y[bottom] - 0.22 });
    } else if (p.kind === 'seg7') {
      out.push({ board: p.board, id: p.id, x0: colX(p.col) - 0.48, x1: colX(p.col + 4) + 0.48, y0: ROW_Y.d - 0.45, y1: ROW_Y.h + 0.45 });
    } else if (p.kind === 'led') {
      const a = holeXY(p.anode), k = holeXY(p.cathode);
      const dist = Math.hypot(k.x - a.x, k.y - a.y);
      const t = dist > 2.2 ? Math.min(0.5, 0.9 / dist) : 0.5;
      const x = a.x + (k.x - a.x) * t, y = a.y + (k.y - a.y) * t;
      out.push({ board: p.board, id: p.id, x0: x - 0.42, x1: x + 0.42, y0: y - 0.42, y1: y + 0.42 });
    }
  }
  return out;
}

type Pt = { x: number; y: number };
const wirePoints = (w: Extract<Part, { kind: 'wire' }>): Pt[] => [holeXY(w.a), ...(w.via ?? []).map(([x, y]) => ({ x, y })), holeXY(w.b)];
function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
function segmentInBox(a: Pt, b: Pt, r: { x0: number; y0: number; x1: number; y1: number }) {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  }
  return false;
}

/** Everything that would look wrong on the breadboard view. */
export function untidy(def: ModuleBoardDef): string[] {
  const L = def.layout;
  const out: string[] = [];
  const wires = L.parts.filter((p): p is Extract<Part, { kind: 'wire' }> => p.kind === 'wire');
  const legs = L.parts.flatMap((p) => (p.kind === 'text' ? [] : partPins(p).map((pin) => ({ id: p.id, board: p.board, hole: pin.hole, at: holeXY(pin.hole) }))));
  const boxes = bodies(L);
  const segs = wires.flatMap((w) => {
    const pts = wirePoints(w);
    return pts.slice(1).map((b, i) => ({ w, a: pts[i], b }));
  });
  for (const { w, a, b } of segs) {
    for (const r of boxes) if (r.board === w.board && segmentInBox(a, b, r)) out.push(`${w.id} (${w.a}-${w.b}) runs under ${r.id}`);
    for (const l of legs) {
      if (l.board !== w.board || l.id === w.id || l.hole === w.a || l.hole === w.b) continue;
      if (distToSegment(l.at, a, b) < 0.3) out.push(`${w.id} (${w.a}-${w.b}) runs over ${l.id} at ${l.hole}`);
    }
  }
  for (const w of wires) for (const [x, y] of w.via ?? []) if (!(x > 0 && x < BOARD_W && y > 0 && y < BOARD_H)) out.push(`${w.id} bends off the board at ${x},${y}`);
  // two runs on top of each other
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      if (s.w.board !== t.w.board || s.w.id === t.w.id) continue;
      const along = (q: typeof s, k: 'x' | 'y') => Math.abs(q.a[k] - q.b[k]) < 1e-9 && q.a[k === 'x' ? 'y' : 'x'] !== q.b[k === 'x' ? 'y' : 'x'];
      for (const [k, o] of [['y', 'x'], ['x', 'y']] as const) {
        if (!along(s, k) || !along(t, k) || Math.abs(s.a[k] - t.a[k]) >= 0.3) continue;
        const ov = Math.min(Math.max(s.a[o], s.b[o]), Math.max(t.a[o], t.b[o])) - Math.max(Math.min(s.a[o], s.b[o]), Math.min(t.a[o], t.b[o]));
        if (ov > 0.05) out.push(`${s.w.id} and ${t.w.id} overlap at ${k} = ${s.a[k]}`);
      }
    }
  }
  // two-leg parts lying over other legs or under chips
  for (const p of L.parts) {
    if (p.kind !== 'resistor' && p.kind !== 'capacitor') continue;
    const a = holeXY(p.a), b = holeXY(p.b);
    for (const l of legs) if (l.board === p.board && l.id !== p.id && distToSegment(l.at, a, b) < 0.3) out.push(`${p.id} lies over ${l.id} at ${l.hole}`);
    for (const r of boxes) if (r.board === p.board && r.id !== p.id && segmentInBox(a, b, r)) out.push(`${p.id} lies over ${r.id}`);
  }
  // port tags point off the board from the outer row and hide nothing
  for (const p of L.parts) {
    if (p.kind !== 'port' || p.hidden) continue; // hidden ports draw no tag
    const row = parseHole(p.hole).row;
    if ((p.side === 'top' && row !== 'a') || (p.side === 'bottom' && row !== 'j')) out.push(`tag ${p.name} at ${p.hole} points ${p.side} across the board`);
    const { x, y } = holeXY(p.hole);
    const len = 0.45 + p.name.replace(/^~/, '').length * 0.42 + 0.55;
    const box = {
      top: { x0: x - 0.36, x1: x + 0.36, y0: y - len, y1: y - 0.3 },
      bottom: { x0: x - 0.36, x1: x + 0.36, y0: y + 0.3, y1: y + len },
      right: { x0: x + 0.3, x1: x + len, y0: y - 0.36, y1: y + 0.36 },
      left: { x0: x - len, x1: x - 0.3, y0: y - 0.36, y1: y + 0.36 },
    }[p.side];
    for (const l of legs) {
      if (l.board === p.board && l.id !== p.id && l.at.x > box.x0 && l.at.x < box.x1 && l.at.y > box.y0 && l.at.y < box.y1) out.push(`tag ${p.name} at ${p.hole} hides ${l.id} at ${l.hole}`);
    }
    const inner = { x0: box.x0 + 0.1, x1: box.x1 - 0.1, y0: box.y0 + 0.1, y1: box.y1 - 0.1 };
    for (const s of segs) if (s.w.board === p.board && segmentInBox(s.a, s.b, inner)) out.push(`tag ${p.name} at ${p.hole} hides ${s.w.id}`);
  }
  return [...new Set(out)];
}

