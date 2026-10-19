// Tidecrown's city water, numbers only (shared with the server): the canals of the Canal Quarter cut into the lower
// town between stone walls. tidecrownGround() lowers their beds; the browser lays water, walls and bridges on them.

type V2 = readonly [number, number];

export interface TcCanal {
  /** Centre line; the ends are square. */
  points: readonly V2[];
  /** Water width between the inner wall faces. */
  width: number;
}

/** Canal water level and bed (the lower town stands at 6). */
export const TC_CANAL = { water: 4.0, bed: 2.2, street: 6, wall: 2 } as const;

/** The Grand Canal from just outside the market's ring to the east wall, and its branch north to the terrace wall. */
export const TC_CANALS: readonly TcCanal[] = [
  { points: [[94.2, 98.2], [110, 103.5], [140, 102], [178, 94], [214, 81.5]], width: 7 },
  { points: [[159.2, 96], [158, 57]], width: 5 },
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smoothstep = (x: number, a: number, b: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Distance from a canal's inner wall face, negative over the water: across the nearest segment, and past a square end
 * along the end's direction.
 */
export function canalOffset(c: TcCanal, x: number, z: number): number {
  const pts = c.points, n = pts.length;
  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez), ux = ex / l, uz = ez / l;
    let along = (x - ax) * ux + (z - az) * uz;
    const across = Math.abs((x - ax) * -uz + (z - az) * ux);
    // Interior joints are open; only the polyline's own ends are capped.
    let over = 0;
    if (along < 0) { over = i === 0 ? -along : Infinity; along = 0; }
    else if (along > l) { over = i === n - 2 ? along - l : Infinity; along = l; }
    if (over === Infinity) {
      const px = ax + ux * along, pz = az + uz * along;
      best = Math.min(best, Math.hypot(x - px, z - pz) - c.width / 2);
    } else best = Math.min(best, Math.max(across - c.width / 2, over));
  }
  return best;
}

/** The nearest canal's offset (see canalOffset). */
export function canalDistance(x: number, z: number): number {
  let d = Infinity;
  for (const c of TC_CANALS) d = Math.min(d, canalOffset(c, x, z));
  return d;
}

/**
 * The canal cut: the bed under the water, the street level a wall's thickness back from the inner face. The walls
 * (2 thick, laid by the browser) hide the 2 m grid's slope between them; the water reaches the inner face.
 */
export function canalCut(x: number, z: number, h: number): number {
  if (x < 80 || x > 225 || z < 45 || z > 112) return h;
  const d = canalDistance(x, z);
  if (d > 1.6) return h;
  return h + (TC_CANAL.bed - h) * (1 - smoothstep(d, 0.2, 1.4));
}
