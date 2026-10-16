import * as THREE from 'three';
import { BOARD_H, BOARD_W, COLUMNS, RAILS, RAIL_COLUMNS, ROWS, ROW_Y, colX } from '../breadboard/geometry';

/** The BB830's top (holes, rail stripes, centre channel), drawn once and shared by every board. */
export function boardTexture(anisotropy = 4): THREE.CanvasTexture {
  const px = 24; // canvas pixels per pitch unit
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_W * px;
  canvas.height = BOARD_H * px;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ecebe4';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#d3d0c4'; // the channel between rows e and f
  g.fillRect(0, 8.6 * px, canvas.width, 0.8 * px);
  const stripe = (y: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(1 * px, y * px, (BOARD_W - 2) * px, 0.14 * px);
  };
  stripe(0.25, '#3b6fd6'); // GND rail (tn) outside, +5 V (tp) inside, as printed on a BB830
  stripe(2.5, '#d33a2c');
  stripe(15.4, '#d33a2c');
  stripe(17.65, '#3b6fd6');
  g.fillStyle = '#5f5c54';
  const hole = (x: number, y: number) => g.fillRect((x - 0.19) * px, (y - 0.19) * px, 0.38 * px, 0.38 * px);
  for (const r of ROWS) for (let col = 1; col <= COLUMNS; col++) hole(colX(col), ROW_Y[r]);
  for (const r of RAILS) for (const col of RAIL_COLUMNS) hole(colX(col), ROW_Y[r]);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** A line of light text on a transparent background (chip names, board titles). */
export function labelTexture(text: string): THREE.CanvasTexture {
  const h = 64;
  const font = `600 ${Math.round(h * 0.6)}px ui-monospace, Consolas, monospace`;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  g.font = font;
  canvas.width = Math.ceil(g.measureText(text).width + h * 0.4);
  canvas.height = h;
  g.font = font; // resizing the canvas resets the context
  g.fillStyle = '#e6e6e2';
  g.textBaseline = 'middle';
  g.fillText(text, h * 0.2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
