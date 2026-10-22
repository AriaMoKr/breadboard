import * as THREE from 'three';
import type { ViewParams } from 'common/door.js';

/**
 * A doorway's material: a flat quad in the opening that shows a room behind it, made from one
 * picture. The picture is the room's far wall, and its edges are stretched back to the opening as
 * the floor, ceiling and side walls ("interior mapping"). Each eye sees it from its own position,
 * so it has parallax and, in a headset, depth. In front of it drift a veil and a glow along the
 * frame. The Hallway's (its public/js/portal.js, as outside has it, with setView for the view the
 * Hallway publishes of its door), in TypeScript.
 */

const vertexShader = /* glsl */ `
uniform mat4 uInverseModel;
varying vec3 vLocal;
varying vec3 vEye;
void main() {
  vLocal = position;
  vEye = (uInverseModel * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uBoxMin;   // the room behind the opening, in the opening's frame (origin at the
uniform vec3 uBoxMax;   // middle of its sill, facing +z): the picture hangs at z = uBoxMin.z
uniform vec2 uOpening;  // the opening's width and height
uniform float uTime;
uniform float uGlow;    // 0 idle, 1 pointed at
varying vec3 vLocal;
varying vec3 vEye;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float safe(float v) { return abs(v) < 1e-5 ? (v < 0.0 ? -1e-5 : 1e-5) : v; }

void main() {
  // Follow the ray from the eye through this point until it leaves the room.
  vec3 dir = vLocal - vEye;
  vec3 inv = vec3(1.0 / safe(dir.x), 1.0 / safe(dir.y), 1.0 / safe(dir.z));
  vec3 exits = max((uBoxMin - vLocal) * inv, (uBoxMax - vLocal) * inv);
  float t = min(min(exits.x, exits.y), exits.z);
  vec3 hit = vLocal + dir * t;
  vec2 uv = clamp((hit.xy - uBoxMin.xy) / (uBoxMax.xy - uBoxMin.xy), 0.002, 0.998);
  // The stretched edges (floor, ceiling, sides) a little darker than the picture itself.
  float back = step(exits.z, min(exits.x, exits.y));
  vec3 col = texture2D(uMap, uv).rgb * mix(0.78, 1.0, back);
  float n = noise(vLocal.xy * vec2(3.0, 2.0) + vec2(0.0, uTime * 0.35)) * 0.6
          + noise(vLocal.xy * 7.0 - vec2(uTime * 0.25, 0.0)) * 0.4;
  float d = max(min(uOpening.x * 0.5 - abs(vLocal.x), uOpening.y - vLocal.y), 0.0);
  float rim = exp(-d / 0.11) * (0.75 + 0.25 * n);
  float mist = (0.05 + 0.10 * uGlow) * n * n;
  col = col * (0.95 + 0.3 * uGlow) + uColor * (mist + rim * (0.5 + 0.9 * uGlow));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export type PortalMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uMap: { value: THREE.Texture };
    uColor: { value: THREE.Color };
    uBoxMin: { value: THREE.Vector3 };
    uBoxMax: { value: THREE.Vector3 };
    uOpening: { value: THREE.Vector2 };
    uTime: { value: number };
    uGlow: { value: number };
    uInverseModel: { value: THREE.Matrix4 };
  };
};

/** The material for an opening `width` x `height`, glowing in `color`, showing `map` hung as `view` says. */
export function portalMaterial(map: THREE.Texture, width: number, height: number, view: Omit<ViewParams, 'image'>, color: string): PortalMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uColor: { value: new THREE.Color(color) },
      uBoxMin: { value: new THREE.Vector3() },
      uBoxMax: { value: new THREE.Vector3() },
      uOpening: { value: new THREE.Vector2(width, height) },
      uTime: { value: 0 },
      uGlow: { value: 0 },
      uInverseModel: { value: new THREE.Matrix4() },
    },
    vertexShader,
    fragmentShader,
  }) as PortalMaterial;
  setView(material, map, view);
  return material;
}

/**
 * Hangs a picture behind the opening: `depth` behind it, `pictureHeight` tall and `aspect` times as
 * wide, its horizon `eye` above the sill and at `horizon` of its height from its bottom.
 */
export function setView(material: PortalMaterial, map: THREE.Texture, { depth, pictureHeight, eye, horizon, aspect }: Omit<ViewParams, 'image'>) {
  const u = material.uniforms;
  const bottom = eye - horizon * pictureHeight;
  const half = (pictureHeight * aspect) / 2;
  u.uBoxMin.value.set(-half, bottom, -depth);
  u.uBoxMax.value.set(half, bottom + pictureHeight, 0);
  u.uMap.value = map;
}

/** The quad for an opening, its origin at the middle of the sill, facing +z. */
export function openingGeometry(width: number, height: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0);
}

/** Call once the mesh is placed, and again if it moves: the shader works in the opening's own frame. */
export function placePortal(mesh: THREE.Mesh<THREE.BufferGeometry, PortalMaterial>) {
  mesh.updateWorldMatrix(true, false);
  mesh.material.uniforms.uInverseModel.value.copy(mesh.matrixWorld).invert();
}
