import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MODULE_BOARDS } from '../src/breadboard/boards';
import { composeComputer } from '../src/breadboard/computer-layout';
import { buildComputerModel } from '../src/vr/model';

describe('VR model of the breadboard computer', () => {
  const scene = composeComputer([...MODULE_BOARDS.values()]);
  const model = buildComputerModel(scene.layout);
  const count = (kind: string) => scene.layout.parts.filter((p) => p.kind === kind).length;
  const instanced = (name: string) => model.root.getObjectByName(name) as THREE.InstancedMesh;

  it('has every board, chip, LED, wire and display of the layout', () => {
    expect(model.counts).toMatchObject({ boards: scene.layout.boards.length, chips: count('chip'), leds: count('led'), wires: count('wire'), seg7: count('seg7') });
    expect(model.counts.chips).toBe(49);
    expect(instanced('led-domes').count).toBe(count('led'));
    expect(instanced('seg7-segments').count).toBe(8 * count('seg7'));
  });

  it('merges the static parts into a few meshes (VR headsets want few draw calls)', () => {
    expect(model.counts.meshes).toBeLessThan(scene.layout.boards.length + 40);
  });

  it('is centred and about 0.7 m across at 1.5x real size', () => {
    const box = new THREE.Box3().setFromObject(model.root);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.00254 * 1.5);
    expect(size.x).toBeGreaterThan(0.5);
    expect(size.x).toBeLessThan(0.9);
    expect(size.z).toBeGreaterThan(0.5);
    expect(size.z).toBeLessThan(0.9);
    const centre = box.getCenter(new THREE.Vector3());
    expect(Math.abs(centre.x)).toBeLessThan(5);
    expect(Math.abs(centre.z)).toBeLessThan(5);
  });

  it('has a hit box for every button, switch and pot, and one per DIP switch', () => {
    const interactive = scene.layout.parts.filter((p) => p.kind === 'button' || p.kind === 'slide' || p.kind === 'dip' || p.kind === 'pot');
    expect(model.counts.controls).toBe(interactive.length);
    expect(model.hitTargets.length).toBe(interactive.reduce((n, p) => n + (p.kind === 'dip' ? p.positions : 1), 0));
    for (const id of Object.keys(scene.live.controls)) expect(model.hitTargets.some((t) => t.userData.part === id), id).toBe(true);
    expect(model.hitTargets.filter((t) => t.userData.part === 'ram/SW3').map((t) => t.userData.bit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('shows a hit box only while it is pointed at', () => {
    const [a, b] = model.hitTargets;
    expect(model.hitTargets.every((t) => !t.visible)).toBe(true);
    model.setHover(a);
    expect([a.visible, b.visible]).toEqual([true, false]);
    model.setHover(b);
    expect([a.visible, b.visible]).toEqual([false, true]);
    model.setHover(null);
    expect(b.visible).toBe(false);
  });

  it('moves slide knobs, DIP levers, button caps and the pot slot', () => {
    const moving = (id: string) => model.hitTargets.find((t) => t.userData.part === id)!.parent!.children.filter((c) => !model.hitTargets.includes(c as THREE.Mesh));
    const [knob] = moving('clock/SW2');
    model.setControl('clock/SW2', 0);
    const at0 = knob.position.clone();
    model.setControl('clock/SW2', 1);
    expect(knob.position.distanceTo(at0)).toBeCloseTo(1.2);

    const levers = moving('ram/SW3');
    expect(levers).toHaveLength(8);
    model.setControl('ram/SW3', 0);
    const off = levers.map((l) => l.position.z);
    model.setControl('ram/SW3', 0b1);
    expect(levers[0].position.z).toBeLessThan(off[0]); // towards row e, the ON side
    expect(levers[1].position.z).toBe(off[1]);

    const [cap] = moving('clock/SW1');
    const up = cap.position.y;
    model.setControl('clock/SW1', 1);
    expect(cap.position.y).toBeLessThan(up);
    model.setControl('clock/SW1', 0);
    expect(cap.position.y).toBe(up);

    const [slot] = moving('clock/RV1');
    model.setControl('clock/RV1', 0);
    const turned0 = slot.rotation.y;
    model.setControl('clock/RV1', 1);
    expect(turned0 - slot.rotation.y).toBeCloseTo(1.5 * Math.PI); // 270°, clockwise seen from above
  });

  it('lights LEDs and display segments by id', () => {
    const domes = instanced('led-domes');
    const id = Object.keys(scene.live.leds)[0];
    const i = scene.layout.parts.filter((p) => p.kind === 'led').findIndex((p) => p.id === id);
    const before = new THREE.Color();
    domes.getColorAt(i, before);
    model.setLed(id, true);
    const after = new THREE.Color();
    domes.getColorAt(i, after);
    expect(after.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(before.getHSL({ h: 0, s: 0, l: 0 }).l);

    const segs = instanced('seg7-segments');
    const digit = Object.keys(scene.live.seg7)[0];
    model.setSeg7(digit, 0x7e); // "0": a-f lit, g off
    const k = scene.layout.parts.filter((p) => p.kind === 'seg7').findIndex((p) => p.id === digit) * 8;
    const a = new THREE.Color(), g = new THREE.Color();
    segs.getColorAt(k, a);
    segs.getColorAt(k + 6, g);
    expect(a.r).toBeGreaterThan(g.r);
  });
});
