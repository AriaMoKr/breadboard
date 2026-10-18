import { describe, expect, it } from 'vitest';
import type { Part } from '../src/breadboard/layout';
import { endAt, movedPart } from '../src/breadboard/move';

const on = (hole: string, board = 'bb1') => ({ board, hole });
const wire = (a: string, b: string, more: Partial<Part> = {}) => ({ id: 'W1', board: 'bb1', kind: 'wire', color: 'red', a, b, ...more }) as Part;

describe('moving a part (the sandbox Move tool)', () => {
  it('moves a whole part by the step from where it was picked up to where it is put', () => {
    const r = { id: 'R1', board: 'bb1', kind: 'resistor', ohms: 220, a: 'a10', b: 'a14' } as Part;
    expect(movedPart(r, on('a12'), on('b22'))).toMatchObject({ a: 'b20', b: 'b24' });
    // across the channel and onto the rails, row by row
    expect(movedPart(wire('e5', 'tp5'), on('c7'), on('f7'))).toMatchObject({ a: 'h5', b: 'c5' });
    const sw = { id: 'SW1', board: 'bb1', kind: 'slide', a: 'a3', common: 'a4', b: 'a5' } as Part;
    expect(movedPart(sw, on('a4'), on('j40'))).toMatchObject({ a: 'j39', common: 'j40', b: 'j41' });
  });

  it('moves just the end of a wire or a two-legged part it was picked up by', () => {
    expect(endAt(wire('a5', 'tp5'), on('a5'))).toBe('a');
    expect(movedPart(wire('a5', 'tp5'), on('a5'), on('c9'))).toMatchObject({ a: 'c9', b: 'tp5' });
    const led = { id: 'D1', board: 'bb1', kind: 'led', color: 'red', anode: 'j20', cathode: 'bn21' } as Part;
    expect(movedPart(led, on('bn21'), on('bn22'))).toMatchObject({ anode: 'j20', cathode: 'bn22' });
    // a switch has three legs: it moves whole
    const sw = { id: 'SW1', board: 'bb1', kind: 'slide', a: 'a3', common: 'a4', b: 'a5' } as Part;
    expect(endAt(sw, on('a3'))).toBeNull();
  });

  it('keeps chips, DIP switches and displays across the channel: they move along the columns', () => {
    const chip = { id: 'U1', board: 'bb1', kind: 'chip', chip: '74LS00', col: 10 } as Part;
    expect(movedPart(chip, on('e12'), on('a20'))).toMatchObject({ col: 18 });
    const dip = { id: 'SW2', board: 'bb1', kind: 'dip', positions: 4, col: 30 } as Part;
    expect(movedPart(dip, on('f31'), on('f28'))).toMatchObject({ col: 27 });
  });

  it('moves a part onto another board, but not one end of it', () => {
    expect(movedPart(wire('a5', 'a9'), on('a7'), on('a7', 'bb2'))).toMatchObject({ board: 'bb2', a: 'a5', b: 'a9' });
    expect(movedPart(wire('a5', 'a9'), on('a5'), on('a7', 'bb2'))).toBeNull();
  });

  it('refuses holes that are not there: off the board, or a rail where it has no hole', () => {
    expect(movedPart(wire('a60', 'a62'), on('a61'), on('a63'))).toBeNull(); // a64
    // picked up in the middle, so the whole wire moves
    expect(movedPart(wire('tn7', 'c7'), on('b7'), on('b8'))).toBeNull(); // tn8: rails skip a column every five
    expect(movedPart(wire('tn7', 'c7'), on('b7'), on('a7'))).toBeNull(); // above the top rail
    expect(movedPart(wire('tn7', 'c7'), on('b7'), on('b9'))).toMatchObject({ a: 'tn9', b: 'c9' });
  });

  it("shifts a wire's bends with it, and drops them when an end moves", () => {
    const bent = wire('a5', 'a15', { via: [[6.5, 2.5]] } as Partial<Part>);
    expect(movedPart(bent, on('a10'), on('a12'))).toMatchObject({ via: [[8.5, 2.5]] });
    expect(movedPart(bent, on('a5'), on('a6'))).not.toHaveProperty('via');
  });
});
