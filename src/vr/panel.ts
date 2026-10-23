import * as THREE from 'three';

export interface PanelAction {
  label: () => string;
  run: () => void;
  primary?: boolean;
  /** Greyed out, and does nothing, while this says so. */
  disabled?: () => boolean;
}

const PX_PER_M = 1000; // canvas pixels per metre of panel

/** A canvas drawn into a texture, redrawn on demand. */
class CanvasPlane {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  constructor(w: number, h: number) {
    this.canvas.width = Math.round(w * PX_PER_M);
    this.canvas.height = Math.round(h * PX_PER_M);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }));
  }
  draw(fn: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(g, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/**
 * The control panel in the room: a title, a status read-out and a grid of buttons. Buttons are
 * pointed at with a VR controller ray or the mouse / a finger (see `targets`).
 */
export class ControlPanel {
  readonly group = new THREE.Group();
  /** Meshes that can be pointed at; `press` and `setHover` take one of them. */
  readonly targets: THREE.Mesh[] = [];
  private buttons: { action: PanelAction; plane: CanvasPlane; text: string; hover: boolean; flash: number }[] = [];
  private status: CanvasPlane;
  private statusText = '';
  /** The longest status line so far, in characters: what the status font is sized for. */
  private statusChars = 0;
  /** Status redraws (each a texture upload), for the debug log. */
  statusDraws = 0;

  /**
   * `note`: small print in the bottom right corner (which version this is). `corner`: a smaller
   * button in the top right corner, beside the title (the way back to the Hallway, hallway.ts).
   */
  constructor(actions: PanelAction[], title: string, note = '', corner?: PanelAction) {
    // two rows of four buttons, or of five (wider, not taller: the screen's home view shows it whole)
    const cols = actions.length > 8 ? 5 : 4, rows = Math.ceil(actions.length / cols);
    const W = 0.032 + cols * 0.142, H = 0.196 + rows * 0.072; // 0.6 x 0.34 for 2 x 4
    const cw = 0.15, ch = 0.044, inset = 0.016; // the corner button
    const back = new CanvasPlane(W, H);
    back.draw((g, w, h) => {
      g.fillStyle = 'rgba(23, 26, 33, 0.94)';
      roundRect(g, 0, 0, w, h, 24);
      g.fill();
      g.strokeStyle = '#2f3644';
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = '#e6e8ee';
      // smaller, not cut off, when a long title meets the corner button
      const room = w - 56 - (corner ? (cw + inset) * PX_PER_M : 0);
      g.font = '600 34px system-ui, sans-serif';
      const wide = g.measureText(title).width;
      if (wide > room) g.font = `600 ${Math.floor((34 * room) / wide)}px system-ui, sans-serif`;
      g.fillText(title, 28, 52);
      g.fillStyle = '#8c92a0';
      g.font = '400 17px ui-monospace, Consolas, monospace';
      g.textAlign = 'right';
      g.fillText(note, w - 24, h - 14);
    });
    this.group.add(back.mesh);

    this.status = new CanvasPlane(W - 0.05, 0.1);
    this.status.mesh.position.set(0, H / 2 - 0.12, 0.002);
    this.group.add(this.status.mesh);

    const bw = 0.13, bh = 0.06, gap = 0.012;
    actions.forEach((action, i) => {
      const plane = new CanvasPlane(bw, bh);
      const col = i % cols, row = Math.floor(i / cols);
      const inRow = Math.min(cols, actions.length - row * cols); // a row that isn't full is centred
      plane.mesh.position.set((col - (inRow - 1) / 2) * (bw + gap), H / 2 - 0.19 - row * (bh + gap), 0.004);
      this.group.add(plane.mesh);
      this.targets.push(plane.mesh);
      this.buttons.push({ action, plane, text: '', hover: false, flash: 0 });
    });
    if (corner) {
      const plane = new CanvasPlane(cw, ch);
      plane.mesh.position.set(W / 2 - inset - cw / 2, H / 2 - inset - ch / 2, 0.004);
      this.group.add(plane.mesh);
      this.targets.push(plane.mesh);
      this.buttons.push({ action: corner, plane, text: '', hover: false, flash: 0 });
    }
    this.refresh(true);
  }

  /** Redraw buttons whose label or state changed. */
  refresh(force = false) {
    const now = performance.now();
    for (const b of this.buttons) {
      const text = b.action.label();
      const lit = now < b.flash;
      const off = b.action.disabled?.() ?? false;
      const key = `${text}|${b.hover}|${lit}|${off}`;
      if (!force && key === b.text) continue;
      b.text = key;
      b.plane.draw((g, w, h) => {
        g.fillStyle = off ? '#1f232b' : lit ? '#60a5fa' : b.action.primary ? (b.hover ? '#3f7fe0' : '#2f6fdd') : b.hover ? '#3b4456' : '#2a303c';
        roundRect(g, 2, 2, w - 4, h - 4, 14);
        g.fill();
        g.fillStyle = off ? '#5b6270' : '#ffffff';
        g.font = `600 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 1, w - 16); // a long label (another host's name) squeezed in
      });
    }
  }

  setStatus(lines: string[]) {
    const text = lines.join('\n');
    if (text === this.statusText) return;
    this.statusText = text;
    this.statusDraws++;
    // One font size for the longest line so far (smaller only when a longer one comes), not each
    // line squeezed to fit: that stretched and shrank the line every time a number changed length.
    this.statusChars = Math.max(this.statusChars, ...lines.map((l) => l.length));
    this.status.draw((g, w) => {
      const font = (px: number) => `500 ${px}px ui-monospace, Consolas, monospace`;
      g.font = font(26);
      const fits = Math.floor((26 * (w - 16)) / (g.measureText('0').width * this.statusChars));
      g.font = font(Math.max(18, Math.min(26, fits)));
      g.fillStyle = '#b8bfcc';
      lines.forEach((line, i) => g.fillText(line, 8, 30 + i * 34, w - 16)); // squeezes only a line longer than 18 px fits
    });
  }

  setHover(target: THREE.Object3D | null) {
    for (const b of this.buttons) b.hover = b.plane.mesh === target;
    this.refresh();
  }

  /** The label of the button `target` is. */
  labelOf(target: THREE.Object3D) {
    return this.buttons.find((x) => x.plane.mesh === target)?.action.label();
  }

  press(target: THREE.Object3D) {
    const b = this.buttons.find((x) => x.plane.mesh === target);
    if (!b || b.action.disabled?.()) return;
    b.flash = performance.now() + 150;
    b.action.run();
    this.refresh();
  }
}

/** A label floating just above a point, always facing the viewer, drawn over everything. */
export class Tooltip {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private text = '';
  private key: unknown = null;
  private boxW = 0;
  /** Redraws (each a texture upload), for the debug log. */
  draws = 0;

  /** `height` in metres; the box fits the text (see `show`). */
  constructor(height = 0.024) {
    this.canvas.width = 1024;
    this.canvas.height = 80;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true }));
    this.sprite.center.set(0.5, 0); // anchored at its bottom centre
    this.sprite.scale.set((height * this.canvas.width) / this.canvas.height, height, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  /**
   * `key`: what it labels. While that stays the same the box only grows, and the text starts at
   * its left edge, so a value changing as a knob turns doesn't make the label twitch. `others`:
   * what else it may say for that key, so the box starts as wide as the widest.
   */
  show(text: string, at: THREE.Vector3, key: unknown = text, others?: () => string[]) {
    if (text !== this.text || key !== this.key) {
      const g = this.canvas.getContext('2d')!;
      const { width: w, height: h } = this.canvas;
      g.clearRect(0, 0, w, h);
      g.font = '600 40px system-ui, sans-serif';
      const need = (t: string) => Math.min(w - 8, g.measureText(t).width + 40);
      this.boxW = key === this.key ? Math.max(this.boxW, need(text)) : Math.max(need(text), ...(others?.() ?? []).map(need));
      this.text = text;
      this.key = key;
      this.draws++;
      const x = (w - this.boxW) / 2;
      g.fillStyle = 'rgba(23, 26, 33, 0.92)';
      roundRect(g, x, 4, this.boxW, h - 8, 18);
      g.fill();
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      g.fillText(text, x + 20, h / 2 + 1, w - 48);
      this.texture.needsUpdate = true;
    }
    this.sprite.position.copy(at);
    this.sprite.visible = true;
  }

  hide() {
    this.sprite.visible = false;
  }
}
