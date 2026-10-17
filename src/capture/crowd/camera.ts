// The crowd camera: the program's shots, each a keyframed path in formation coordinates, eased
// over the shot and rounded with Catmull-Rom, evaluated as a pure function of the song clock.
import * as THREE from 'three';
import type { Crowd } from './crowd';
import type { CamKey, Shot } from './program';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const EASE: Record<NonNullable<Shot['ease']>, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  smooth: (x) => x * x * (3 - 2 * x),
  sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};

type V3 = [number, number, number];
const cr = (p0: V3, p1: V3, p2: V3, p3: V3, u: number): V3 => {
  const u2 = u * u;
  const u3 = u2 * u;
  const o: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    o[i] = 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3);
  }
  return o;
};

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

export interface CameraState {
  shot: number;
  /** Distance from the camera to the focus point. */
  focus: number;
  focusRange: number;
}

/** The shot playing at song time t (the last one that has started). */
export function shotAt(shots: Shot[], t: number): number {
  let k = 0;
  for (let i = 0; i < shots.length; i++) if (shots[i].from <= t + 1e-9) k = i;
  return k;
}

/**
 * Place `cam` for song time t. `port` takes the portrait keys (or widens the lens 1.6 times).
 * Returns what the depth of field needs.
 */
export function placeCamera(cam: THREE.PerspectiveCamera, crowd: Crowd, shots: Shot[], t: number, port: boolean): CameraState {
  const i = shotAt(shots, t);
  const S = shots[i];
  const keys = (port && S.port) || S.keys;
  const span = Math.max(1e-3, (S.to ?? S.from + 1) - S.from);
  const g = (EASE[S.ease ?? 'inout'] ?? EASE.inout)(clamp01((t - S.from) / span));
  let k = 0;
  while (k < keys.length - 2 && g > keys[k + 1].u) k++;
  const a = keys[k];
  const b = keys[Math.min(k + 1, keys.length - 1)];
  const f = b.u > a.u ? clamp01((g - a.u) / (b.u - a.u)) : 0;
  const prev = keys[Math.max(0, k - 1)];
  const next = keys[Math.min(keys.length - 1, k + 2)];
  const look = (key: CamKey): V3 => {
    if (Array.isArray(key.l)) return key.l;
    // Hero-relative: back to formation coordinates through the hero's body.
    // The look point follows `rise` of the body's height above standing (the jumps).
    const hb = crowd.heroBody(v1);
    const rel = worldToFormation(crowd, hb);
    const y = rel[1] - (1 - (S.rise ?? 0.5)) * Math.max(0, hb.y - crowd.heroStandY);
    return [rel[0] + key.l.hero[0], y + key.l.hero[1], rel[2] + key.l.hero[2]];
  };
  const spline = keys.length > 2;
  const p = spline ? cr(prev.p, a.p, b.p, next.p, f) : lerp3(a.p, b.p, f);
  const l = spline ? cr(look(prev), look(a), look(b), look(next), f) : lerp3(look(a), look(b), f);
  const fov = (a.fov ?? 40) + ((b.fov ?? 40) - (a.fov ?? 40)) * f;
  const roll = (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * f;
  if (S.shake) {
    const w = wobble(t, S.shake);
    p[0] += w[0];
    p[1] += w[1];
    p[2] += w[2];
  }
  const pw = crowd.toWorld(p[0], p[1], p[2], v1);
  const lw = crowd.toWorld(l[0], l[1], l[2], v2);
  cam.position.copy(pw);
  const fwd = lw.clone().sub(pw).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  cam.up.set(0, 1, 0).multiplyScalar(Math.cos(roll)).addScaledVector(right, Math.sin(roll));
  cam.lookAt(lw);
  const vfov = port && !S.port ? Math.min(100, fov * 1.6) : fov;
  if (Math.abs(cam.fov - vfov) > 1e-4) {
    cam.fov = vfov;
    cam.updateProjectionMatrix();
  }
  let focus: number;
  if (S.focus === 'hero') focus = pw.distanceTo(crowd.heroBody(v2));
  else if (typeof S.focus === 'number') focus = S.focus;
  else focus = pw.distanceTo(lw);
  return { shot: i, focus, focusRange: S.focusRange ?? 40 };
}

function worldToFormation(crowd: Crowd, w: THREE.Vector3): V3 {
  const o = crowd.toWorld(0, 0, 0, new THREE.Vector3());
  const dx = w.x - o.x;
  const dz = w.z - o.z;
  const c = Math.cos(crowd.siteYaw);
  const s = Math.sin(crowd.siteYaw);
  // Inverse of Crowd.toWorld's rotation.
  return [c * dx - s * dz, w.y - o.y, s * dx + c * dz];
}

const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Deterministic hand-held wobble, units. */
function wobble(t: number, amp: number): V3 {
  return [
    amp * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9 + 1) * 0.4),
    amp * (Math.sin(t * 1.7 + 2) * 0.6 + Math.sin(t * 3.7) * 0.4) * 0.6,
    amp * (Math.sin(t * 1.1 + 4) * 0.6 + Math.sin(t * 2.3 + 3) * 0.4),
  ];
}
