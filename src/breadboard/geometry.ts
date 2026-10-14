/**
 * Geometry of a BB830 solderless breadboard (the boards Ben uses).
 *
 * Coordinates are in "pitch" units: 1 unit = 0.1" = the distance between
 * neighbouring holes. A board is 65 × 18 units, drawn with column 1 on the
 * left:
 *
 *   tn  − − − − −   − − − − −  …   (top rail, GND, blue)
 *   tp  + + + + +   + + + + +  …   (top rail, +5 V, red)
 *   a   ● ● ● ● ● ● ● ● …          ┐
 *   …                              │ columns 1..63; a-e of one column are
 *   e   ● ● ● ● ● ● ● ● …          ┘ one strip (connected)
 *       ── centre channel (0.3") ──
 *   f   ● ● ● ● ● ● ● ● …          ┐ f-j of one column are one strip
 *   …                              │
 *   j   ● ● ● ● ● ● ● ● …          ┘
 *   bp  + + + + +   + + + + +  …   (bottom rail, +5 V, red)
 *   bn  − − − − −   − − − − −  …   (bottom rail, GND, blue)
 *
 * Rails run the full length of the board (BB830 rails are continuous) and
 * have holes in groups of five, so rail holes only exist at some columns.
 * A 0.3" DIP chip straddles the channel with its pins in rows e and f; a
 * 0.6" one (28C16 EEPROM) uses rows d and h... see `dipRows`.
 */

export type Row = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j';
export type Rail = 'tn' | 'tp' | 'bp' | 'bn';
export type RowOrRail = Row | Rail;

export const ROWS: Row[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
export const RAILS: Rail[] = ['tn', 'tp', 'bp', 'bn'];
export const COLUMNS = 63;
export const BOARD_W = 65;
export const BOARD_H = 18;

/** y (in pitch units, board-local) of each row/rail centre. */
export const ROW_Y: Record<RowOrRail, number> = {
  tn: 0.9, tp: 1.9,
  a: 3.5, b: 4.5, c: 5.5, d: 6.5, e: 7.5,
  f: 10.5, g: 11.5, h: 12.5, i: 13.5, j: 14.5,
  bp: 16.1, bn: 17.1,
};

/** x (board-local) of a column's holes. */
export const colX = (col: number) => 1.5 + (col - 1);

/** Columns that have rail holes: ten groups of five, skipping one between groups. */
export const RAIL_COLUMNS: number[] = (() => {
  const cols: number[] = [];
  for (let g = 0; g < 10; g++) for (let k = 0; k < 5; k++) cols.push(3 + g * 6 + k);
  return cols; // 3..7, 9..13, ..., 57..61
})();
const RAIL_SET = new Set(RAIL_COLUMNS);

export const isRail = (r: string): r is Rail => r === 'tn' || r === 'tp' || r === 'bp' || r === 'bn';
export const isRow = (r: string): r is Row => (ROWS as string[]).includes(r);

/** A hole on one board, e.g. "e12" or "tp5". */
export interface Hole {
  row: RowOrRail;
  col: number;
}

const HOLE_RE = /^(tn|tp|bp|bn|[a-j])(\d{1,2})$/;

export function parseHole(name: string): Hole {
  const m = HOLE_RE.exec(name.trim().toLowerCase());
  if (!m) throw new Error(`Bad hole name "${name}" (expected e.g. "e12" or "tp5")`);
  const hole: Hole = { row: m[1] as RowOrRail, col: Number(m[2]) };
  if (!holeExists(hole)) throw new Error(`Hole "${name}" does not exist on a BB830`);
  return hole;
}

export function holeName(h: Hole): string {
  return `${h.row}${h.col}`;
}

export function holeExists(h: Hole): boolean {
  if (!Number.isInteger(h.col) || h.col < 1 || h.col > COLUMNS) return false;
  if (isRail(h.row)) return RAIL_SET.has(h.col);
  return isRow(h.row);
}

/** Board-local position of a hole centre. */
export function holeXY(h: Hole | string): { x: number; y: number } {
  const hole = typeof h === 'string' ? parseHole(h) : h;
  return { x: colX(hole.col), y: ROW_Y[hole.row] };
}

/**
 * Identifier of the electrical strip a hole belongs to on its board:
 * "top12" (a-e of column 12), "bot12" (f-j of column 12), or the rail name.
 */
export function stripOf(h: Hole | string): string {
  const hole = typeof h === 'string' ? parseHole(h) : h;
  if (isRail(hole.row)) return hole.row;
  return `${ROWS.indexOf(hole.row as Row) < 5 ? 'top' : 'bot'}${hole.col}`;
}

/** All holes of a strip, e.g. stripHoles("top12") -> a12..e12. */
export function stripHoles(strip: string): string[] {
  if (isRail(strip)) return RAIL_COLUMNS.map((c) => `${strip}${c}`);
  const m = /^(top|bot)(\d+)$/.exec(strip);
  if (!m) throw new Error(`Bad strip "${strip}"`);
  const rows = m[1] === 'top' ? ROWS.slice(0, 5) : ROWS.slice(5);
  return rows.map((r) => `${r}${m[2]}`);
}

/** Nearest rail hole column to `col` (for "drop a wire to the rail here"). */
export function nearestRailColumn(col: number): number {
  let best = RAIL_COLUMNS[0];
  for (const c of RAIL_COLUMNS) if (Math.abs(c - col) < Math.abs(best - col)) best = c;
  return best;
}

/** Rows a DIP of the given row spacing (in 0.1") uses: [top row, bottom row]. */
export function dipRows(spacing: 3 | 6): [Row, Row] {
  return spacing === 3 ? ['e', 'f'] : ['d', 'h'];
}

/**
 * Hole of pin `pin` (1-based) of a DIP package whose pin 1 is at column
 * `col`, notch facing left (pin 1 bottom-left, pins counting
 * anticlockwise). With `rotated`, the chip is turned 180°: pin 1 is
 * top-right at column `col`.
 */
export function dipPinHole(col: number, pins: number, pin: number, spacing: 3 | 6 = 3, rotated = false): string {
  const half = pins / 2;
  const [top, bottom] = dipRows(spacing);
  if (!rotated) {
    return pin <= half ? `${bottom}${col + pin - 1}` : `${top}${col + (pins - pin)}`;
  }
  // rotated 180°: pin 1 top-right at `col`, pins 1..half run right-to-left along the top
  return pin <= half ? `${top}${col - (pin - 1)}` : `${bottom}${col - (pins - pin)}`;
}

// ---------------------------------------------------------------------------
// Placement of whole boards in a scene

export interface BoardPlacement {
  /** Scene position (pitch units) of the board's top-left corner. */
  x: number;
  y: number;
  /** Rotate the board 90° clockwise (column 1 at the top). */
  rotate?: 0 | 90;
}

/** Scene position of a board-local point. */
export function toScene(p: BoardPlacement, local: { x: number; y: number }): { x: number; y: number } {
  if (p.rotate === 90) return { x: p.x + (BOARD_H - local.y), y: p.y + local.x };
  return { x: p.x + local.x, y: p.y + local.y };
}

/** Scene-space size of a placed board. */
export function boardSize(p: BoardPlacement): { w: number; h: number } {
  return p.rotate === 90 ? { w: BOARD_H, h: BOARD_W } : { w: BOARD_W, h: BOARD_H };
}
