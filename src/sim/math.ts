import type { Vec3 } from './types.ts';
export const TAU = Math.PI * 2;
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function angleDiff(a: number, b: number): number { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
export const damp = (a: number, b: number, rate: number, dt: number): number => lerp(a, b, 1 - Math.exp(-rate * dt));
export const dampAngle = (a: number, b: number, rate: number, dt: number): number => a + angleDiff(b, a) * (1 - Math.exp(-rate * dt));
export function turnToward(a: number, b: number, rate: number, dt: number): number { const d = angleDiff(b, a); return Math.abs(d) <= rate * dt ? b : a + Math.sign(d) * rate * dt; }
export const yawTo = (ax: number, az: number, bx: number, bz: number): number => Math.atan2(bx - ax, bz - az);
export const distXZ = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => Math.hypot(a.x - b.x, a.z - b.z);
export const smoothstep = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOut = (t: number): number => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
