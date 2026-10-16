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
