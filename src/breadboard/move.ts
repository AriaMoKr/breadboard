import { ROWS, holeExists, holeName, holeXY, parseHole, type RowOrRail } from './geometry';
import type { Part } from './layout';

/**
 * Moving a part on the breadboards (the sandbox's Move tool). A part is picked up at a hole and
 * put down at another. The whole part moves by the step between the two, on the grid of holes;
 * picked up at one end of a wire or a two-legged part, only that end moves. Chips, DIP switches
 * and 7-segment displays move along the columns only, as they straddle the channel.
 */

/** Rails and rows from the top of a board to the bottom: the grid a part moves on. */
const GRID: RowOrRail[] = ['tn', 'tp', ...ROWS, 'bp', 'bn'];

/** The fields that hold a part's holes, by kind. */
const HOLES: Partial<Record<Part['kind'], string[]>> = {
  wire: ['a', 'b'],
  led: ['anode', 'cathode'],
  resistor: ['a', 'b'],
  capacitor: ['a', 'b'],
  button: ['a', 'b'],
  slide: ['a', 'common', 'b'],
  pot: ['a', 'wiper', 'b'],
  port: ['hole'],
};
/** Parts with two ends that can be moved one at a time. */
const TWO_ENDS = new Set<Part['kind']>(['wire', 'led', 'resistor', 'capacitor', 'button']);

/** A hole on a board. */
export interface At {
  board: string;
  hole: string;
}

const field = (p: Part, f: string) => (p as unknown as Record<string, string>)[f];

/** The end of `p` at `at` ("a", "anode", ...), if `p` has two ends and one is there. */
export function endAt(p: Part, at: At): string | null {
  if (!TWO_ENDS.has(p.kind) || at.board !== p.board) return null;
  return HOLES[p.kind]!.find((f) => field(p, f) === at.hole) ?? null;
}

/**
 * `p` picked up at `from` and put down at `to`, or null where it can't go (a hole that doesn't
 * exist, an end onto another board). Whether it fits among the other parts is for the layout's
 * checks (`validateLayout`).
 */
export function movedPart(p: Part, from: At, to: At): Part | null {
  const end = endAt(p, from);
  if (end) {
    if (to.board !== p.board) return null;
    const moved = { ...p, [end]: to.hole } as Part;
    if (moved.kind === 'wire') delete moved.via; // its bends were for the old route
    return moved;
  }
  const a = parseHole(from.hole), b = parseHole(to.hole);
  const rows = GRID.indexOf(b.row) - GRID.indexOf(a.row), cols = b.col - a.col;
  if (p.kind === 'chip' || p.kind === 'dip' || p.kind === 'seg7') return { ...p, board: to.board, col: p.col + cols };
  const fields = HOLES[p.kind];
  if (!fields) return null; // text has no holes
  const moved: Record<string, unknown> = { ...p, board: to.board };
  for (const f of fields) {
    const h = parseHole(field(p, f));
    const there = { row: GRID[GRID.indexOf(h.row) + rows], col: h.col + cols };
    if (!there.row || !holeExists(there)) return null;
    moved[f] = holeName(there);
  }
  if (p.kind === 'wire' && p.via) {
    const pa = holeXY(a), pb = holeXY(b);
    moved.via = p.via.map(([x, y]) => [x + pb.x - pa.x, y + pb.y - pa.y]);
  }
  return moved as unknown as Part;
}
