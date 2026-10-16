import * as THREE from 'three';

export interface PanelAction {
  label: () => string;
  run: () => void;
  primary?: boolean;
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

  constructor(actions: PanelAction[], title: string) {
    const cols = 4, rows = Math.ceil(actions.length / cols);
    const W = 0.6, H = 0.196 + rows * 0.072; // 0.34 for two rows of buttons
    const back = new CanvasPlane(W, H);
    back.draw((g, w, h) => {
      g.fillStyle = 'rgba(23, 26, 33, 0.94)';
      roundRect(g, 0, 0, w, h, 24);
      g.fill();
      g.strokeStyle = '#2f3644';
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = '#e6e8ee';
      g.font = '600 34px system-ui, sans-serif';
      g.fillText(title, 28, 52);
    });
    this.group.add(back.mesh);

    this.status = new CanvasPlane(W - 0.05, 0.1);
    this.status.mesh.position.set(0, H / 2 - 0.12, 0.002);
    this.group.add(this.status.mesh);

    const bw = 0.13, bh = 0.06, gap = 0.012;
    actions.forEach((action, i) => {
      const plane = new CanvasPlane(bw, bh);
      const col = i % cols, row = Math.floor(i / cols);
      plane.mesh.position.set((col - (cols - 1) / 2) * (bw + gap), H / 2 - 0.19 - row * (bh + gap), 0.004);
      this.group.add(plane.mesh);
      this.targets.push(plane.mesh);
      this.buttons.push({ action, plane, text: '', hover: false, flash: 0 });
    });
    this.refresh(true);
  }

  /** Redraw buttons whose label or state changed. */
  refresh(force = false) {
    const now = performance.now();
    for (const b of this.buttons) {
      const text = b.action.label();
      const lit = now < b.flash;
      const key = `${text}|${b.hover}|${lit}`;
      if (!force && key === b.text) continue;
      b.text = key;
      b.plane.draw((g, w, h) => {
        g.fillStyle = lit ? '#60a5fa' : b.action.primary ? (b.hover ? '#3f7fe0' : '#2f6fdd') : b.hover ? '#3b4456' : '#2a303c';
        roundRect(g, 2, 2, w - 4, h - 4, 14);
        g.fill();
        g.fillStyle = '#ffffff';
        g.font = `600 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 1);
      });
    }
  }

  setStatus(lines: string[]) {
    const text = lines.join('\n');
    if (text === this.statusText) return;
    this.statusText = text;
    this.status.draw((g, w) => {
      g.font = '500 26px ui-monospace, Consolas, monospace';
      g.fillStyle = '#b8bfcc';
      lines.forEach((line, i) => g.fillText(line, 8, 30 + i * 34, w - 16));
    });
  }

  setHover(target: THREE.Object3D | null) {
    for (const b of this.buttons) b.hover = b.plane.mesh === target;
    this.refresh();
  }

  press(target: THREE.Object3D) {
    const b = this.buttons.find((x) => x.plane.mesh === target);
    if (!b) return;
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

  /** `height` in metres; the label is as wide as its text. */
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

  show(text: string, at: THREE.Vector3) {
    if (text !== this.text) {
      this.text = text;
      const g = this.canvas.getContext('2d')!;
      const { width: w, height: h } = this.canvas;
      g.clearRect(0, 0, w, h);
      g.font = '600 40px system-ui, sans-serif';
      const tw = Math.min(w - 8, g.measureText(text).width + 40);
      g.fillStyle = 'rgba(23, 26, 33, 0.92)';
      roundRect(g, (w - tw) / 2, 4, tw, h - 8, 18);
      g.fill();
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 1, w - 48);
      this.texture.needsUpdate = true;
    }
    this.sprite.position.copy(at);
    this.sprite.visible = true;
  }

  hide() {
    this.sprite.visible = false;
  }
}
