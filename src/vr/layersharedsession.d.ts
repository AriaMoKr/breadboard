// Types for the parts of AriaMoKr/layersharedsession (plain ES modules, no types of their own) that
// together.ts uses. See its README and public/js/*.js.

declare module 'layersharedsession/identity.js' {
  export interface Identity {
    memberId: string;
    name: string;
    color: string;
  }
  export function loadIdentity(session: Storage | null, local: Storage | null, random?: () => number): Identity;
}

declare module 'layersharedsession/room.js' {
  export function roomFromUrl(href: string): string | null;
  export function newRoom(random?: () => number): string;
}

declare module 'layersharedsession/pose.js' {
  export const PART: { head: 0; left: 1; right: 2 };
  export const PART_LENGTH: number;
  export const INTERP_DELAY_MS: number;
  export interface PoseBuffer {
    capacity: number;
    samples: { t: number; pose: Float32Array }[];
  }
  export function emptyPose(): Float32Array;
  export function hasPart(pose: Float32Array, part: number): boolean;
  export function setPart(pose: Float32Array, part: number, position: { x: number; y: number; z: number } | null, quaternion?: { x: number; y: number; z: number; w: number }): Float32Array;
  export function latestPose(buffer: PoseBuffer): Float32Array | null;
  export function samplePose(buffer: PoseBuffer, t: number, out: Float32Array): Float32Array | null;
}

declare module 'layersharedsession/session.js' {
  import type { Identity } from 'layersharedsession/identity.js';
  import type { PoseBuffer } from 'layersharedsession/pose.js';
  export interface Peer {
    peerId: string;
    memberId: string | null;
    name: string | null;
    color: string;
    /** The page they are on (this one is `breadboard`, the Hallway `hallway`), once they said. */
    page: string | null;
    rtt: number | null;
    buffer: PoseBuffer;
  }
  export interface Relays {
    open: number;
    total: number;
  }
  export interface Session {
    room: string;
    peers: Map<string, Peer>;
    relays: Relays;
    on(type: 'join' | 'update' | 'leave', fn: (peer: Peer) => void): () => void;
    on(type: 'relays', fn: (relays: Relays) => void): () => void;
    setPose(pose: Float32Array): void;
    tick(): void;
    leave(): Promise<void>;
  }
  export function joinSession(o: { appId: string; room: string; page: string; identity: Identity; storage?: Storage | null }): Session;
}
