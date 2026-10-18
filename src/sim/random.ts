import type { IdSource, RandomSource } from './types.ts';
export class Random implements RandomSource {
  readonly algorithm = 'mulberry32-v1' as const;
  private value: number;
  constructor(seed: number) { if (!Number.isFinite(seed)) throw new RangeError('Nonfinite seed'); this.value = seed >>> 0; }
  next(): number { this.value = (this.value + 0x6d2b79f5) >>> 0; let t = Math.imul(this.value ^ (this.value >>> 15), 1 | this.value); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  state(): number { return this.value; }
}
export class Ids implements IdSource {
  private value: number;
  constructor(next = 1) { if (!Number.isSafeInteger(next) || next < 1 || next > 0x100000000) throw new RangeError('Invalid next id'); this.value = next; }
  get nextValue(): number { return this.value; }
  next(): number { if (this.value > 0xffffffff) throw new RangeError('ID exhausted'); return this.value++; }
}
export const rand = (rng: RandomSource, a: number, b: number): number => a + rng.next() * (b - a);
export const randInt = (rng: RandomSource, a: number, b: number): number => Math.floor(rand(rng, a, b + 1));
export function pick<T>(rng: RandomSource, items: readonly T[]): T { if (!items.length) throw new RangeError('Empty choice'); return items[Math.floor(rng.next() * items.length)]!; }
