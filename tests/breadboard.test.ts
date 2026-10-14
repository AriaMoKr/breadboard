import { describe, expect, it } from 'vitest';
import aRegister from '../src/breadboard/boards/a-register.board';
import { CHIPS } from '../src/breadboard/catalog';
import { dipPinHole, holeXY, parseHole, stripOf, RAIL_COLUMNS } from '../src/breadboard/geometry';
import { LayoutBuilder, validateLayout } from '../src/breadboard/layout';
import { GND_NET, VCC_NET, buildNets, pinNet, unpoweredChips } from '../src/breadboard/nets';

describe('breadboard geometry', () => {
  it('parses holes and knows which exist', () => {
    expect(parseHole('e12')).toEqual({ row: 'e', col: 12 });
    expect(() => parseHole('k3')).toThrow();
    expect(() => parseHole('tp8')).toThrow(); // gap between rail groups
    expect(parseHole('tp9')).toEqual({ row: 'tp', col: 9 });
    expect(RAIL_COLUMNS.length).toBe(50);
  });
  it('strips: a-e and f-j of a column, rails whole', () => {
    expect(stripOf('a5')).toBe(stripOf('e5'));
    expect(stripOf('e5')).not.toBe(stripOf('f5'));
    expect(stripOf('tp3')).toBe(stripOf('tp61'));
  });
  it('DIP pins straddle the channel, pin 1 bottom-left, anticlockwise', () => {
    expect(dipPinHole(10, 16, 1)).toBe('f10');
    expect(dipPinHole(10, 16, 8)).toBe('f17');
    expect(dipPinHole(10, 16, 9)).toBe('e17');
    expect(dipPinHole(10, 16, 16)).toBe('e10');
    // rotated 180°: pin 1 top-right
    expect(dipPinHole(17, 16, 1, 3, true)).toBe('e17');
    expect(dipPinHole(17, 16, 9, 3, true)).toBe('f10');
    // 0.6" EEPROM
    expect(dipPinHole(5, 24, 1, 6)).toBe('h5');
    expect(dipPinHole(5, 24, 24, 6)).toBe('d5');
    expect(holeXY('f1')).toEqual({ x: 1.5, y: 10.5 });
  });
  it('catalog pin lists match pin counts and power pins', () => {
    for (const c of Object.values(CHIPS)) {
      expect(c.pins.length % 2).toBe(0);
      expect(c.pins[c.vcc - 1]).toBe('VCC');
      expect(c.pins[c.gnd - 1]).toBe('GND');
    }
  });
});

describe('layout builder', () => {
  it('rejects two legs in one hole', () => {
    const b = new LayoutBuilder();
    const bb = b.board('x');
    bb.chip('U1', '74LS00', 10);
    expect(() => bb.wire('f10', 'tp9')).toThrow(/already used/);
  });
  it('free() walks away from the channel', () => {
    const b = new LayoutBuilder();
    const bb = b.board('x');
    const u = bb.chip('U1', '74LS00', 10);
    expect(u.free(1)).toBe('g10');
    expect(u.free(14)).toBe('d10');
    bb.wire('g10', 'g20');
    expect(u.free(1)).toBe('h10');
  });
});

describe('A register board (reference)', () => {
  const L = aRegister.layout;
  const nets = buildNets(L);
  it('is a valid layout with every chip powered', () => {
    expect(validateLayout(L)).toEqual([]);
    expect(unpoweredChips(L, nets)).toEqual([]);
    expect(nets.shorted).toBe(false);
  });
  it('is wired like Ben’s schematic', () => {
    for (const u of ['U8', 'U9']) {
      expect(pinNet(L, nets, u, '~M')).toBe(GND_NET);
      expect(pinNet(L, nets, u, '~N')).toBe(GND_NET);
      expect(pinNet(L, nets, u, '~G1')).toBe('port:~AI');
      expect(pinNet(L, nets, u, '~G2')).toBe('port:~AI');
      expect(pinNet(L, nets, u, 'CP')).toBe('port:CLK');
      expect(pinNet(L, nets, u, 'MR')).toBe('port:CLR');
    }
    expect(pinNet(L, nets, 'U7', 'DIR')).toBe(VCC_NET);
    expect(pinNet(L, nets, 'U7', '~OE')).toBe('port:~AO');
    for (let bit = 0; bit < 8; bit++) {
      const u = bit < 4 ? 'U9' : 'U8';
      expect(pinNet(L, nets, u, `D${bit % 4}`)).toBe(`port:BUS${bit}`);
      expect(pinNet(L, nets, 'U7', `B${bit + 1}`)).toBe(`port:BUS${bit}`);
      expect(pinNet(L, nets, u, `Q${bit % 4}`)).toBe(`port:A${bit}`);
      expect(pinNet(L, nets, 'U7', `A${bit + 1}`)).toBe(`port:A${bit}`);
    }
    // 8 LEDs, each bound to a bit of A
    const leds = L.parts.filter((p) => p.kind === 'led');
    expect(leds).toHaveLength(8);
    expect(Object.keys(aRegister.live.leds)).toHaveLength(8);
  });
});
