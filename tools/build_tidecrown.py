"""Tidecrown kit: Crownshell Keep and the capital's castle-scale pieces, modelled procedurally.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_tidecrown.py -- \
        --out /tmp/tidecrown.raw.glb --json tools/tidecrown-pieces.json [--render DIR [--kit-tex DIR]]
    (tools/build_tidecrown.sh runs this and meshopt-compresses into public/models/world/tidecrown.glb)

Contract with the scene code (src/world/kit.ts loadKit):
  * every top-level node is one piece (an empty named TC_*), its mesh child carries one primitive
    per material; node extras hold the piece's anchors (game units, piece-local, Y up)
  * game units (1 = crab shell height), Y up, origin at the ground centre of the footprint, front +Z
  * materials are named TC_* and carry only a base colour and roughness/metalness; the runtime swaps
    them and supplies the textures
  * UVs are in world units at the measured World 1 kit density (wall-like and roof-like below), so
    the kit textures tile at the same texel density; roof tile rows run around cones
  * COLOR_0 is baked ambient occlusion (white = open); the runtime multiplies it

Everything is deterministic: no randomness without a fixed seed, Cycles AO on the CPU.
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import random
import sys
import time
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True, help="raw GLB path")
ap.add_argument("--json", default="", help="write per-piece facts (tools/tidecrown-pieces.json)")
ap.add_argument("--only", default="", help="comma list of pieces to build (iteration)")
ap.add_argument("--samples", type=int, default=96, help="Cycles AO samples per vertex")
ap.add_argument("--render", default="", help="directory for EEVEE preview renders")
ap.add_argument("--kit-tex", default="", help="directory with MI_*__base.png kit textures for a textured preview")
ap.add_argument("--views", default="", help="comma list of preview names to render (e.g. TC_Keep_front,lineup); default all")
args = ap.parse_args(argv)

PI = math.pi
TAU = 2 * math.pi

# --------------------------------------------------------------------------------------------
# Materials (names are the runtime contract) and texel density
# --------------------------------------------------------------------------------------------
MATS = [
    ("TC_Limestone", dict(color="#e6dcc6", rough=0.88)),
    ("TC_LimestoneDark", dict(color="#cfc2a6", rough=0.9)),
    ("TC_Slate", dict(color="#35577d", rough=0.62)),
    ("TC_Gold", dict(color="#c9a24a", rough=0.32, metal=1.0)),
    ("TC_Nacre", dict(color="#f2e8f0", rough=0.22, metal=0.1)),
    ("TC_Glass", dict(color="#2a6fa8", rough=0.18)),
    ("TC_LanternGlow", dict(color="#53f2e4", rough=0.1, emit="#53f2e4")),
    ("TC_Iron", dict(color="#3a3a40", rough=0.55, metal=0.75)),
    ("TC_Wood", dict(color="#6b4a2e", rough=0.8)),
]
LIME, DARK, SLATE, GOLD, NACRE, GLASS, GLOW, IRON, WOOD = range(len(MATS))
ROOFLIKE = {SLATE}

# UV units per world unit, measured on public/models/world/village.glb (Blender, per-triangle
# dP/du and dP/dv, median): Wall_UnevenBrick_Straight / MI_UnevenBrick u 0.500 v 0.475 (u runs
# along the wall, v up); Roof_Tower_RoundTiles / MI_RoundTiles u 0.236 around the cone, v 0.212
# up the slope. Area-weighted over the whole kit: MI_Brick 0.448, MI_UnevenBrick 0.478,
# MI_RoundTiles 0.230.
WALL_U, WALL_V = 0.500, 0.475
ROOF_U, ROOF_V = 0.236, 0.212

PLANAR, CYL, CONE, EXPLICIT = 0, 1, 2, 3


def srgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # type: ignore


# --------------------------------------------------------------------------------------------
# Math helpers (game coordinates: X right, Y up, Z front)
# --------------------------------------------------------------------------------------------
def T(x=0.0, y=0.0, z=0.0) -> Matrix:
    return Matrix.Translation((x, y, z))


def RY(a: float) -> Matrix:
    """Rotation about up; RY(a) turns the front (+Z) towards (sin a, 0, cos a)."""
    return Matrix.Rotation(a, 4, "Y")


def RX(a: float) -> Matrix:
    return Matrix.Rotation(a, 4, "X")


def RZ(a: float) -> Matrix:
    return Matrix.Rotation(a, 4, "Z")


def polar(cx, cz, r, a, y=0.0) -> Vector:
    return Vector((cx + r * math.sin(a), y, cz + r * math.cos(a)))


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def newell(pts) -> Vector:
    n = Vector((0.0, 0.0, 0.0))
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n.x += (p.y - q.y) * (p.z + q.z)
        n.y += (p.z - q.z) * (p.x + q.x)
        n.z += (p.x - q.x) * (p.y + q.y)
    return n


def area2d(pts) -> float:
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def chamfer_poly(pts, c):
    """Cut every corner of a 2D polygon by c (clamped to a third of the shorter edge)."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        a, b = p0 - p1, p2 - p1
        ca = min(c, a.length / 3)
        cb = min(c, b.length / 3)
        out.append(tuple(p1 + a.normalized() * ca))
        out.append(tuple(p1 + b.normalized() * cb))
    return out


# --------------------------------------------------------------------------------------------
# Geometry accumulator
# --------------------------------------------------------------------------------------------
class Geo:
    """Vertices and faces in game coordinates; each face carries material, UV mode and flags."""

    def __init__(self):
        self.v: list[Vector] = []
        self.f: list[list] = []
        self.nt = 0  # >0: faces added now are not tessellated (thin trims)
        self.shade: dict[int, float] = {}  # vertex -> cavity factor multiplied into the baked AO (carapace grooves)

    def vert(self, p) -> int:
        self.v.append(Vector(p))
        return len(self.v) - 1

    def verts(self, pts) -> list[int]:
        return [self.vert(p) for p in pts]

    def face(self, idx, mat, mode=PLANAR, param=None, uv=None, flat=False):
        self.f.append([list(idx), mat, mode, param, uv, (1 if flat else 0) | (2 if self.nt else 0)])

    def face_dir(self, idx, mat, want, **kw):
        """Add a face wound so its normal points along `want`."""
        n = newell([self.v[i] for i in idx])
        if n.dot(Vector(want)) < 0:
            idx = list(reversed(idx))
            if kw.get("uv"):
                kw["uv"] = list(reversed(kw["uv"]))
        self.face(idx, mat, **kw)

    def face_out(self, idx, mat, centre, **kw):
        c = sum((self.v[i] for i in idx), Vector()) / len(idx)
        self.face_dir(idx, mat, c - Vector(centre), **kw)

    def mark(self):
        return len(self.v), len(self.f)

    def place(self, M: Matrix | None, mark):
        """Transform everything added since `mark` (mirrors flip the winding back)."""
        if M is None:
            return
        v0, f0 = mark
        for i in range(v0, len(self.v)):
            self.v[i] = M @ self.v[i]
        if M.to_3x3().determinant() < 0:
            for f in self.f[f0:]:
                f[0] = list(reversed(f[0]))
                if f[4]:
                    f[4] = list(reversed(f[4]))


# --------------------------------------------------------------------------------------------
# Primitive generators
# --------------------------------------------------------------------------------------------
def box(g: Geo, c, s, mat, ch=0.0, M=None, flat=False):
    """Box of size s centred at c, optional chamfer on every edge, then placed by M."""
    mk = g.mark()
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    ch = min(ch, hx * 0.45, hy * 0.45, hz * 0.45)
    if ch <= 1e-5:
        ids = {}
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    ids[sx, sy, sz] = g.vert((sx * hx, sy * hy, sz * hz))
        for ax in range(3):
            for s_ in (-1, 1):
                q = []
                for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    key = [0, 0, 0]
                    key[ax] = s_
                    key[(ax + 1) % 3] = a
                    key[(ax + 2) % 3] = b
                    q.append(ids[tuple(key)])
                g.face_out(q, mat, (0, 0, 0), flat=flat)
    else:
        X, Y, Z = {}, {}, {}
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    X[sx, sy, sz] = g.vert((sx * hx, sy * (hy - ch), sz * (hz - ch)))
                    Y[sx, sy, sz] = g.vert((sx * (hx - ch), sy * hy, sz * (hz - ch)))
                    Z[sx, sy, sz] = g.vert((sx * (hx - ch), sy * (hy - ch), sz * hz))
        P = ((-1, -1), (1, -1), (1, 1), (-1, 1))
        for s_ in (-1, 1):
            g.face_out([X[s_, a, b] for a, b in P], mat, (0, 0, 0), flat=flat)
            g.face_out([Y[a, s_, b] for a, b in P], mat, (0, 0, 0), flat=flat)
            g.face_out([Z[a, b, s_] for a, b in P], mat, (0, 0, 0), flat=flat)
        for a in (-1, 1):
            for b in (-1, 1):
                g.face_out([X[a, b, -1], X[a, b, 1], Y[a, b, 1], Y[a, b, -1]], mat, (0, 0, 0), flat=flat)
                g.face_out([X[a, -1, b], X[a, 1, b], Z[a, 1, b], Z[a, -1, b]], mat, (0, 0, 0), flat=flat)
                g.face_out([Y[-1, a, b], Y[1, a, b], Z[1, a, b], Z[-1, a, b]], mat, (0, 0, 0), flat=flat)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    g.face_out([X[sx, sy, sz], Y[sx, sy, sz], Z[sx, sy, sz]], mat, (0, 0, 0), flat=flat)
    g.place((M or Matrix()) @ T(*c), mk)


def _axmap(axis, p, q, w):
    if axis == "z":
        return (p, q, w)
    if axis == "x":
        return (w, q, p)  # p -> z, q -> y
    return (p, w, q)  # axis y: p -> x, q -> z


def prism(g: Geo, pts, w0, w1, axis, mat, M=None, caps=True, side_mat=None, cap_mat=None, flat=False):
    """Extrude a 2D polygon (any winding) along axis x|y|z from w0 to w1."""
    mk = g.mark()
    if area2d(pts) < 0:
        pts = list(reversed(pts))
    wv = Vector(_axmap(axis, 0, 0, 1))
    bot = g.verts([_axmap(axis, p, q, w0) for p, q in pts])
    top = g.verts([_axmap(axis, p, q, w1) for p, q in pts])
    n = len(pts)
    cen = Vector(_axmap(axis, sum(p for p, _ in pts) / n, sum(q for _, q in pts) / n, (w0 + w1) / 2))
    for i in range(n):
        j = (i + 1) % n
        p0, p1 = pts[i], pts[j]
        d = Vector((p1[0] - p0[0], p1[1] - p0[1]))
        out2 = Vector((d.y, -d.x))  # right of the edge = outside of a CCW polygon
        want = Vector(_axmap(axis, out2.x, out2.y, 0))
        g.face_dir([bot[i], bot[j], top[j], top[i]], side_mat if side_mat is not None else mat, want, flat=flat)
    if caps:
        cm = cap_mat if cap_mat is not None else mat
        g.face_dir(top, cm, wv, flat=flat)
        g.face_dir(bot, cm, -wv, flat=flat)
    g.place(M, mk)
    return cen


def poly_ring(sides, sub=1, a0=None):
    """Unit-circumradius polygon ring with `sub` points per side (corners first), for lathe(ring=)."""
    a0 = PI / sides if a0 is None else a0
    pts = []
    for k in range(sides):
        c0 = Vector((math.sin(a0 + TAU * k / sides), 0, math.cos(a0 + TAU * k / sides)))
        c1 = Vector((math.sin(a0 + TAU * (k + 1) / sides), 0, math.cos(a0 + TAU * (k + 1) / sides)))
        for i in range(sub):
            p = c0.lerp(c1, i / sub)
            pts.append((p.x, p.z))
    return pts


def lathe(g: Geo, prof, n, mat, cx=0.0, cz=0.0, a0=0.0, sweep=TAU, mats=None, loop=False, mode=CYL, rref=None,
          param=None, M=None, caps=True, flat=False, seg_len=None, ring=None):
    """Revolve a (r, y) profile about the vertical axis through (cx, cz).

    Profiles run counter-clockwise in the (r, y) half plane (bottom outwards, up the outside, back in
    over the top) so faces point out; r == 0 points collapse to the axis. `loop` closes the profile
    (rings, bands). Partial sweeps get end caps. seg_len splits long profile segments into rings;
    ring replaces the circle by a closed unit shape (poly_ring) for polygonal towers.
    """
    if seg_len:
        p2, m2 = [], []
        segs_ = len(prof) if loop else len(prof) - 1
        for i in range(len(prof)):
            p2.append(prof[i])
            if i < segs_:
                q = prof[(i + 1) % len(prof)]
                k = max(1, math.ceil(math.hypot(q[0] - prof[i][0], q[1] - prof[i][1]) / seg_len))
                for t in range(1, k):
                    p2.append((lerp(prof[i][0], q[0], t / k), lerp(prof[i][1], q[1], t / k)))
                m2 += [mats[i] if mats else mat] * k
        prof, mats = p2, m2
    if ring is not None:
        n = len(ring)
    mk = g.mark()
    full = abs(sweep - TAU) < 1e-6
    cols = n if full else n + 1
    if M is not None:
        mode = PLANAR
    if param is None:
        if mode == CYL:
            param = (cx, cz, rref if rref else max(r for r, _ in prof))
        elif mode == CONE:
            param = (cx, cz, max(y for _, y in prof), rref if rref else max(r for r, _ in prof))
    rings = []
    for r, y in prof:
        if r < 1e-6:
            rings.append([g.vert((cx, y, cz))] * cols)
        else:
            if ring is not None:
                rings.append([g.vert((cx + r * px, y, cz + r * pz)) for px, pz in ring])
            else:
                rings.append([g.vert(polar(cx, cz, r, a0 + sweep * j / n, y)) for j in range(cols)])
    segs = len(prof) if loop else len(prof) - 1
    for i in range(segs):
        i2 = (i + 1) % len(prof)
        m = mats[i] if mats else mat
        A, B = rings[i], rings[i2]
        apA, apB = prof[i][0] < 1e-6, prof[i2][0] < 1e-6
        if apA and apB:
            continue
        for j in range(n):
            j2 = (j + 1) % cols if full else j + 1
            if apA:
                q = [A[j], B[j2], B[j]]
            elif apB:
                q = [A[j], A[j2], B[j]]
            else:
                q = [A[j], A[j2], B[j2], B[j]]
            g.face(q, m, mode, param, flat=flat)
    if not full and caps:
        sm = mats[0] if mats else mat
        first = [rings[i][0] for i in range(len(prof))]
        last = [rings[i][-1] for i in range(len(prof))]
        dedup = lambda L: [x for k, x in enumerate(L) if k == 0 or x != L[k - 1]]
        first, last = dedup(first), dedup(last)
        t0 = Vector((math.cos(a0), 0, -math.sin(a0)))
        t1 = Vector((math.cos(a0 + sweep), 0, -math.sin(a0 + sweep)))
        if len(first) >= 3:
            g.face_dir(first, sm, -t0, flat=flat)
            g.face_dir(last, sm, t1, flat=flat)
    g.place(M, mk)


def sweep(g: Geo, path, frames, section, nsec, mat_fn, tip=False, caps=(True, True), uv_scale=(WALL_U, WALL_V)):
    """Tube along `path` (Vectors) with per-point frames (N, B) and section(k, m) -> (a, b).

    The section is closed (nsec points); faces carry explicit UVs: u around, v along the path.
    `tip` collapses the last ring to the path end.
    """
    K = len(path)
    rings = []
    perim = []
    for k in range(K):
        if tip and k == K - 1:
            rings.append([g.vert(path[k])] * nsec)
            perim.append(0.0)
            continue
        N, B = frames[k]
        pts = []
        for m in range(nsec):
            a, b = section(k, m)
            pts.append(path[k] + N * a + B * b)
        rings.append(g.verts(pts))
        perim.append(sum((pts[m] - pts[(m + 1) % nsec]).length for m in range(nsec)))
    pav = sum(perim) / max(1, len([p for p in perim if p > 0]))
    s = [0.0]
    for k in range(1, K):
        s.append(s[-1] + (path[k] - path[k - 1]).length)
    U = lambda m: pav * m / nsec * uv_scale[0]
    V = lambda k: s[k] * uv_scale[1]
    for k in range(K - 1):
        for m in range(nsec):
            m2 = (m + 1) % nsec
            mat = mat_fn(k, m)
            if tip and k == K - 2:
                q = [rings[k][m], rings[k][m2], rings[k + 1][m]]
                uv = [(U(m), V(k)), (U(m + 1), V(k)), (U(m + 0.5), V(k + 1))]
            else:
                q = [rings[k][m], rings[k][m2], rings[k + 1][m2], rings[k + 1][m]]
                uv = [(U(m), V(k)), (U(m + 1), V(k)), (U(m + 1), V(k + 1)), (U(m), V(k + 1))]
            ctr = sum((g.v[i] for i in q), Vector()) / len(q)
            g.face_dir(q, mat, ctr - (path[k] + path[k + 1]) / 2, mode=EXPLICIT, uv=uv)
    if caps[0]:
        T0 = path[1] - path[0]
        g.face_dir(rings[0], mat_fn(0, 0), -T0, mode=EXPLICIT, uv=[(0.0, 0.0)] * nsec)
    if caps[1] and not tip:
        T1 = path[-1] - path[-2]
        g.face_dir(rings[-1], mat_fn(K - 2, 0), T1, mode=EXPLICIT, uv=[(0.0, 0.0)] * nsec)


def plane_frames(path, up_hint: Vector):
    """Frames for a path lying in a plane: B = plane normal, N = B x T (in-plane)."""
    fr = []
    K = len(path)
    for k in range(K):
        t = (path[min(k + 1, K - 1)] - path[max(k - 1, 0)]).normalized()
        B = up_hint.normalized()
        N = B.cross(t).normalized()
        fr.append((N, B))
    return fr


# --------------------------------------------------------------------------------------------
# Arches
# --------------------------------------------------------------------------------------------
def arch_h(a, R):
    return math.sqrt(max(0.0, R * R - (R - a) ** 2))


def arch_y(dx, a, hs, R):
    """Height of a pointed arch (half width a, springing hs, radius R) at |x - centre| = dx."""
    dx = min(abs(dx), a)
    return hs + math.sqrt(max(0.0, R * R - (dx + R - a) ** 2))


def arch_pts(a, hs, R, n, x0=0.0):
    """Points along a pointed arch from the left springing over the apex to the right springing."""
    h = arch_h(a, R)
    phi_ap = math.acos(max(-1.0, min(1.0, (R - a) / R)))
    right = []
    for i in range(n + 1):
        phi = phi_ap * i / n
        right.append((x0 + a - R + R * math.cos(phi), hs + R * math.sin(phi)))
    right[-1] = (x0, hs + h)
    left = [(2 * x0 - x, y) for x, y in right[:-1]]
    return left + list(reversed(right))


def arch_ring(g, a, hs, R, d, w0, w1, mat, n=8, yb=None, M=None, blocks=0, step=0.0):
    """Frame between a pointed arch and the arch offset by d, extruded along local z.

    yb adds the jambs down to y = yb. blocks > 0 splits the arch part into voussoirs (alternate
    blocks stand `step` proud and reach a little further out).
    """
    mk = g.mark()
    inner = arch_pts(a, hs, R, n)
    outer = arch_pts(a + d, hs, R + d, n)
    if yb is not None:
        inner = [(-a, yb)] + inner + [(a, yb)]
        outer = [(-a - d, yb)] + outer + [(a + d, yb)]
    m = len(inner)
    if blocks <= 0:
        spans = [(0, m - 1, 0.0, 0.0)]
    else:
        off = 1 if yb is not None else 0
        arc = m - 2 * off - 1
        spans = []
        if off:
            spans.append((0, 1, 0.0, 0.0))
        for b in range(blocks):
            i0 = off + round(arc * b / blocks)
            i1 = off + round(arc * (b + 1) / blocks)
            if i1 > i0:
                alt = b % 2 == (blocks // 2) % 2
                spans.append((i0, i1, step if alt else 0.0, 0.18 if alt else 0.0))
        if off:
            spans.append((m - 2, m - 1, 0.0, 0.0))
    for i0, i1, dz, dd in spans:
        I = inner[i0 : i1 + 1]
        O = []
        for k in range(i0, i1 + 1):
            ix, iy = inner[k]
            ox, oy = outer[k]
            v = Vector((ox - ix, oy - iy))
            ln = v.length
            O.append((ix + v.x / ln * (ln + dd), iy + v.y / ln * (ln + dd)) if ln > 1e-6 else (ox, oy))
        z1 = w1 + dz
        If = g.verts([(x, y, z1) for x, y in I])
        Ib = g.verts([(x, y, w0) for x, y in I])
        Of = g.verts([(x, y, z1) for x, y in O])
        Ob = g.verts([(x, y, w0) for x, y in O])
        for k in range(len(I) - 1):
            g.face_dir([If[k], Of[k], Of[k + 1], If[k + 1]], mat, (0, 0, 1))
            g.face_dir([Ib[k], Ob[k], Ob[k + 1], Ib[k + 1]], mat, (0, 0, -1))
            mi = Vector(((I[k][0] + I[k + 1][0]) / 2, (I[k][1] + I[k + 1][1]) / 2, 0))
            mo = Vector(((O[k][0] + O[k + 1][0]) / 2, (O[k][1] + O[k + 1][1]) / 2, 0))
            g.face_dir([Ib[k], Ib[k + 1], If[k + 1], If[k]], mat, mi - mo)
            g.face_dir([Ob[k], Ob[k + 1], Of[k + 1], Of[k]], mat, mo - mi)
        e0 = Vector((I[0][0] - I[1][0], I[0][1] - I[1][1], 0))
        e1 = Vector((I[-1][0] - I[-2][0], I[-1][1] - I[-2][1], 0))
        g.face_dir([Ib[0], Ob[0], Of[0], If[0]], mat, e0)
        g.face_dir([Ib[-1], Ob[-1], Of[-1], If[-1]], mat, e1)
    g.place(M, mk)


def arch_wall(g, u0, u1, y0, y1, w0, w1, uc, a, hs, R, axis, mat, cell=2.0, n=10, vault_mat=None, jambs=True):
    """Solid wall slab with a pointed passage through it (axis z: u=x, w=z; axis x: u=z, w=x)."""

    def P(u, y, w):
        return (u, y, w) if axis == "z" else (w, y, u)

    wdir = Vector(P(0, 0, 1))
    udir = Vector(P(1, 0, 0))
    rows = max(2, math.ceil((y1 - y0) / cell))

    def cols(ua, ub, extra=()):
        k = max(1, math.ceil((ub - ua) / cell))
        us = sorted(set([ua + (ub - ua) * i / k for i in range(k + 1)] + [u for u in extra if ua < u < ub]))
        return us

    arch_u = [uc + x for x, _ in arch_pts(a, hs, R, n)]
    regions = [(u0, uc - a, lambda u: y0), (uc - a, uc + a, lambda u: arch_y(u - uc, a, hs, R)), (uc + a, u1, lambda u: y0)]
    for ua, ub, low in regions:
        if ub - ua < 1e-6:
            continue
        us = cols(ua, ub, arch_u if low(ua) != y0 or ua == uc - a else ())
        for w, sgn in ((w1, 1), (w0, -1)):
            grid = [[g.vert(P(u, lerp(low(u), y1, r / rows), w)) for r in range(rows + 1)] for u in us]
            for i in range(len(us) - 1):
                for r in range(rows):
                    g.face_dir([grid[i][r], grid[i + 1][r], grid[i + 1][r + 1], grid[i][r + 1]], mat, wdir * sgn)
        for i in range(len(us) - 1):
            ua_, ub_ = us[i], us[i + 1]
            t = [g.vert(P(ua_, y1, w0)), g.vert(P(ub_, y1, w0)), g.vert(P(ub_, y1, w1)), g.vert(P(ua_, y1, w1))]
            g.face_dir(t, mat, (0, 1, 0))
            if low(ua_) == y0 and low(ub_) == y0:
                b = [g.vert(P(ua_, y0, w0)), g.vert(P(ub_, y0, w0)), g.vert(P(ub_, y0, w1)), g.vert(P(ua_, y0, w1))]
                g.face_dir(b, mat, (0, -1, 0))
            else:
                ya, yb_ = low(ua_), low(ub_)
                q = [g.vert(P(ua_, ya, w0)), g.vert(P(ub_, yb_, w0)), g.vert(P(ub_, yb_, w1)), g.vert(P(ua_, ya, w1))]
                mid = Vector(P((ua_ + ub_) / 2, (ya + yb_) / 2, 0))
                g.face_dir(q, vault_mat if vault_mat is not None else mat, Vector(P(uc, hs, 0)) - mid)
    # jambs and ends
    for u, sgn in ((uc - a, 1), (uc + a, -1)) if jambs else ():
        q = [g.vert(P(u, y0, w0)), g.vert(P(u, hs, w0)), g.vert(P(u, hs, w1)), g.vert(P(u, y0, w1))]
        g.face_dir(q, mat, udir * sgn)
    for u, sgn in ((u0, -1), (u1, 1)):
        q = [g.vert(P(u, y0, w0)), g.vert(P(u, y1, w0)), g.vert(P(u, y1, w1)), g.vert(P(u, y0, w1))]
        g.face_dir(q, mat, udir * sgn)


# --------------------------------------------------------------------------------------------
# Architectural parts (local frame: x along the wall, y up, z out of the wall face)
# --------------------------------------------------------------------------------------------
def slit(g, M, h=2.4, w=0.36, frame=True, cross=True):
    """Arrow slit: dark inset with a stone surround (and a crosslet)."""
    box(g, (0, 0, 0.03), (w, h, 0.1), IRON, M=M)
    if cross:
        box(g, (0, h * 0.12, 0.03), (w * 2.6, w * 0.8, 0.1), IRON, M=M)
    if frame:
        f = 0.22
        box(g, (-(w + f) / 2, 0, 0.06), (f, h + 2 * f, 0.26), DARK, M=M)
        box(g, ((w + f) / 2, 0, 0.06), (f, h + 2 * f, 0.26), DARK, M=M)
        box(g, (0, (h + f) / 2, 0.06), (w, f, 0.26), DARK, M=M)
        box(g, (0, -(h + f) / 2, 0.06), (w + 2 * f + 0.2, f + 0.04, 0.32), DARK, ch=0.05, M=M)


def corbel(g, M, w=0.55, h=1.2, d=0.7, ch=0.0):
    """Two-tier corbel hanging under y=0 from the wall face (z=0) outwards."""
    box(g, (0, -h * 0.72, d * 0.28 - 0.15), (w, h * 0.56, d * 0.56 + 0.3), DARK, ch=ch, M=M)
    box(g, (0, -h * 0.22, d * 0.5 - 0.15), (w, h * 0.44, d + 0.3), DARK, ch=ch, M=M)


def merlon_row(g, x0, x1, y0, h, depth, M=None, w=1.4, gap=1.0, slits=True, cap=True, ch=0.09):
    """Merlons along x in [x0, x1], centred in each period so neighbouring segments tile."""
    n = max(1, round((x1 - x0) / (w + gap)))
    per = (x1 - x0) / n
    for k in range(n):
        xc = x0 + per * (k + 0.5)
        box(g, (xc, y0 + h / 2, 0), (w, h, depth), LIME, ch=ch, M=M)
        if cap:
            box(g, (xc, y0 + h + 0.12, 0), (w + 0.2, 0.24, depth + 0.2), DARK, ch=0.07, M=M)
        if slits and k % 2 == 0:
            slit(g, (M or Matrix()) @ T(xc, y0 + h * 0.45, depth / 2), h=h * 0.5, w=0.2, frame=False, cross=False)


def quoins(g, xc, zc, sx, sz, y0, y1, rng, long=1.7, short=1.0, proud=0.12, rowh=1.15, mat=LIME):
    """Alternating long/short corner stones at the vertical corner (xc, zc) facing (sx, sz)."""
    y = y0
    k = 0
    while y < y1 - 0.3:
        h = min(rowh * (1 + rng.uniform(-0.07, 0.07)), y1 - y)
        la, lb = (long, short) if k % 2 == 0 else (short, long)
        la *= 1 + rng.uniform(-0.08, 0.08)
        lb *= 1 + rng.uniform(-0.08, 0.08)
        xa, xb = sorted((xc - sx * la, xc + sx * proud))
        za, zb = sorted((zc - sz * lb, zc + sz * proud))
        box(g, ((xa + xb) / 2, y + h / 2, (za + zb) / 2), (xb - xa, h - 0.06, zb - za), mat, ch=0.09)
        y += h
        k += 1


def window(g, M, w=3.0, h=12.0, Rk=1.6, frame=0.45, depth=0.5, tracery=True, hood=True):
    """Pointed stained-glass window, glass bottom at local y=0, wall face at z=0."""
    mk = g.mark()
    a = w / 2
    R = a * Rk
    ha = arch_h(a, R)
    hs = h - ha
    # glass
    out = [(-a, 0.0)] + arch_pts(a, hs, R, 8) + [(a, 0.0)]
    gl = g.verts([(x, y, 0.06) for x, y in out])
    g.face_dir(gl, GLASS, (0, 0, 1))
    # frame with jambs, sill, hood mould
    arch_ring(g, a, hs, R, frame, -0.25, depth, DARK, n=8, yb=-0.05)
    box(g, (0, -0.2, depth / 2 - 0.05), (w + 2 * frame + 0.5, 0.4, depth + 0.5), DARK, ch=0.09)
    if hood:
        arch_ring(g, a + frame + 0.08, hs, R + frame + 0.08, 0.3, -0.2, depth * 0.7, DARK, n=8)
        for s in (-1, 1):
            box(g, (s * (a + frame + 0.23), hs - 0.3, depth * 0.35), (0.42, 0.6, depth * 0.7 + 0.2), DARK, ch=0.06)
    if tracery:
        bw, bd = 0.15, 0.13
        box(g, (0, hs / 2 + 0.15, 0.13), (bw, hs + 0.3, bd), GOLD)
        for t in (0.34, 0.67):
            box(g, (0, hs * t, 0.13), (w - 0.02, bw * 0.9, bd), GOLD)
        rr = min(0.42 * a, ha * 0.3)
        yc = hs + ha * 0.42
        prof = [(rr - 0.08, -bd / 2), (rr + 0.08, -bd / 2), (rr + 0.08, bd / 2), (rr - 0.08, bd / 2)]
        lathe(g, prof, 12, GOLD, loop=True, M=T(0, yc, 0.13) @ RX(PI / 2))
        for s in (-1, 1):  # little Y bars from the mullion head to the oculus
            p0 = Vector((0, hs + 0.2, 0.13))
            p1 = Vector((s * rr * 0.75, yc - rr * 0.7, 0.13))
            d = p1 - p0
            mb = g.mark()
            box(g, (0, 0, 0), (d.length, bw * 0.85, bd), GOLD)
            g.place(T(*((p0 + p1) / 2)) @ RZ(math.atan2(d.y, d.x)), mb)
    g.place(M, mk)


def buttress(g, M, w, stages, mat=LIME):
    """Stepped buttress against a wall face (z=0); stages = [(depth, y0, y1)], sloped weatherings."""
    for d, y0, y1 in stages:
        slope = min(1.6, d * 0.8)
        pts = [(-0.4, y0), (d, y0), (d, y1), (-0.4, y1 + (d + 0.4) * slope / max(d, 1e-3))]
        prism(g, chamfer_poly(pts, 0.08), -w / 2, w / 2, "x", mat, M=M)
        box(g, (0, y1 + 0.05, d - 0.06), (w + 0.1, 0.14, 0.3), DARK, M=(M or Matrix()) @ T(0, 0, 0))


class notess:
    """Context: faces added inside are left out of the AO tessellation (thin trims)."""

    def __init__(self, g):
        self.g = g

    def __enter__(self):
        self.g.nt += 1

    def __exit__(self, *a):
        self.g.nt -= 1


def string_course(g, M, x0, x1, y, proj=0.3, h=0.5, mat=DARK):
    """Moulded band along x on a wall face (z=0); flat ends so segments tile."""
    pts = chamfer_poly([(-0.3, y), (proj, y), (proj, y + h), (-0.3, y + h)], 0.12)
    with notess(g):
        prism(g, pts, x0, x1, "x", mat, M=M)


def shield_outline(w, h, n=10):
    """Heater-shield outline: wavy top, straight upper sides, curved to a point."""
    top = h * 0.5
    pts = [(-w / 2, top), (-w * 0.25, top - 0.05 * h), (0.0, top + 0.04 * h), (w * 0.25, top - 0.05 * h), (w / 2, top)]
    right = []
    for i in range(1, n + 1):
        t = i / n
        y = top - h * t
        x = w / 2 if t < 0.38 else w / 2 * math.cos((t - 0.38) / 0.62 * PI / 2) ** 0.75
        right.append((x, y))
    right[-1] = (0.0, -h * 0.5)
    left = [(-x, y) for x, y in reversed(right[:-1])]
    return pts + right + left


def shield_panel(g, M, w=3.6, h=4.4, depth=0.35, emblem=True):
    """Shield-shaped raised panel (local z out of the face) with a gold rim and claw emblem."""
    pts = shield_outline(w, h)
    prism(g, pts, 0.0, depth, "z", LIME, M=M)
    prism(g, pts, depth, depth + 0.08, "z", GOLD, M=M)
    prism(g, shield_outline(w * 0.84, h * 0.86), depth + 0.08, depth + 0.14, "z", LIME, M=(M or Matrix()) @ T(0, -0.05, 0))
    if emblem:
        claw_emblem(g, (M or Matrix()) @ T(0, 0.05, depth + 0.14), size=min(w, h) * 0.3)


def claw_emblem(g, M, size=1.0, depth=0.18, mat=GOLD):
    """Flat crab-pincer emblem: swollen palm, a heavy fixed finger and a slimmer dactyl, toothed gape."""
    S = size
    out = []
    # outer contour: from the dactyl tip (left) down round the palm and up to the fixed-finger tip
    for i in range(19):
        a = math.radians(150 + 225 * i / 18)
        rx, ry = 1.0 * S, 1.12 * S
        if a > math.radians(300):  # fixed finger bulges and hooks in
            k = (a - math.radians(300)) / math.radians(75)
            rx *= 1 + 0.08 * math.sin(PI * k)
        out.append((rx * math.cos(a), ry * math.sin(a) - 0.05 * S))
    out.append((0.18 * S, 1.02 * S))  # fixed-finger tip hooks over the gape
    gape = []
    for i in range(13):  # inner gape with teeth, right to left
        t = i / 12
        a = math.radians(20 - 200 * t)
        r = (0.5 + (0.06 if i % 2 else 0.0)) * S
        gape.append((0.1 * S + r * 0.9 * math.cos(a), 0.42 * S + r * 0.95 * math.sin(a)))
    gape.append((-0.62 * S, 0.62 * S))
    pts = out + gape
    prism(g, pts, 0.0, depth, "z", mat, M=M)
    wrist = [(-0.34 * S, -1.5 * S), (0.3 * S, -1.5 * S), (0.36 * S, -0.95 * S), (-0.3 * S, -0.95 * S)]
    prism(g, wrist, 0.0, depth * 0.85, "z", mat, M=M)


# Round-tower helpers ------------------------------------------------------------------------
def round_corbels(g, cx, cz, r, y_top, count, h=1.8, d=0.9, w=0.6, offset=0.0):
    for k in range(count):
        a = offset + TAU * k / count
        corbel(g, T(*polar(cx, cz, r, a, y_top)) @ RY(a), w=w, h=h, d=d)


def round_merlons(g, cx, cz, r_in, r_out, y0, y1, count, fill=0.56, offset=0.0, seg=2, cap=True, slits=True):
    da = TAU / count
    for k in range(count):
        a = offset + da * k - da * fill / 2
        prof = [(r_in, y0), (r_out, y0), (r_out, y1), (r_in, y1)]
        lathe(g, prof, seg, LIME, cx, cz, a0=a, sweep=da * fill, loop=True, rref=r_out)
        if cap:
            cp = ringprof(r_in - 0.1, r_out + 0.12, y1, y1 + 0.26, 0.08)
            lathe(g, cp, seg, DARK, cx, cz, a0=a - 0.012, sweep=da * fill + 0.024, loop=True, rref=r_out)
        if slits and k % 2 == 0:
            am = offset + da * k
            slit(g, T(*polar(cx, cz, r_out - 0.05, am, (y0 + y1) / 2)) @ RY(am), h=(y1 - y0) * 0.5, w=0.2, frame=False, cross=False)


def ringprof(r_in, r_out, y0, y1, ch):
    """Closed (r, y) ring profile with only the outer corners chamfered."""
    return [(r_in, y0), (r_out - ch, y0), (r_out, y0 + ch), (r_out, y1 - ch), (r_out - ch, y1), (r_in, y1)]


def band(g, cx, cz, r, y0, y1, n, mat=DARK, proj=0.3, ch=0.12, rref=None):
    lathe(g, ringprof(r - 0.4, r + proj, y0, y1, ch), n, mat, cx, cz, loop=True, rref=rref or r)


def roof_cone(g, cx, cz, y_eave, r_eave, height, n, r_drum, flare=0.2, p=1.55, a0=0.0, k=12):
    """Flared conical roof: soffit from the drum, gold fascia, concave cone to the apex."""
    prof = [(r_drum - 0.2, y_eave - 0.35), (r_eave, y_eave - 0.35), (r_eave + 0.08, y_eave - 0.05)]
    mats = [SLATE, GOLD]
    for i in range(k + 1):
        s = i / k
        prof.append((r_eave * (1 - s), y_eave + height * (flare * s + (1 - flare) * s ** p)))
        mats.append(SLATE)
    lathe(g, prof, n, SLATE, cx, cz, a0=a0, mats=mats[: len(prof) - 1], mode=CONE, rref=r_eave,
          param=(cx, cz, y_eave + height, r_eave))
    return y_eave + height


def finial(g, cx, cz, y0, s=1.0, socket=True, n=12):
    """Gold finial: collar, ball, neck, small ball, and a flag-pole socket (or a spike)."""
    prof = [(0, y0), (0.8 * s, y0), (0.8 * s, y0 + 0.3 * s), (0.5 * s, y0 + 0.5 * s), (0.42 * s, y0 + 0.85 * s)]
    cy, rb = y0 + 1.65 * s, 0.82 * s
    for i in range(1, 8):
        t = -PI / 2 + PI * i / 8
        prof.append((rb * math.cos(t), cy + rb * math.sin(t)))
    prof += [(0.28 * s, y0 + 2.62 * s), (0.42 * s, y0 + 2.95 * s), (0.42 * s, y0 + 3.15 * s)]
    if socket:
        prof += [(0.34 * s, y0 + 3.3 * s), (0.34 * s, y0 + 3.85 * s), (0.2 * s, y0 + 3.85 * s), (0.2 * s, y0 + 3.45 * s), (0, y0 + 3.45 * s)]
        top = y0 + 3.85 * s
    else:
        prof += [(0.3 * s, y0 + 3.3 * s), (0.12 * s, y0 + 4.6 * s), (0, y0 + 5.4 * s)]
        top = y0 + 5.4 * s
    lathe(g, prof, n, GOLD, cx, cz, mode=PLANAR)
    return top


# --------------------------------------------------------------------------------------------
# Piece assembly: bmesh, UVs, sharp edges, AO bake
# --------------------------------------------------------------------------------------------
class Piece:
    def __init__(self, name: str, cell=2.5, ao_dist=4.0, ground=0.0):
        self.name = name
        self.cell = cell
        self.ao_dist = ao_dist
        self.ground = ground
        self.g = Geo()
        self.anchors: dict = {}
        self.obj = None
        self.holder = None

    # Build ------------------------------------------------------------------------------------
    def to_object(self):
        g = self.g
        bm = bmesh.new()
        L_mode = bm.faces.layers.int.new("uvm")
        L_par = bm.faces.layers.int.new("uvp")
        L_flat = bm.faces.layers.int.new("flat")
        uvl = bm.loops.layers.uv.new("UVMap")
        params: list = [None]
        pid = {}
        bv = [bm.verts.new((p.x, -p.z, p.y)) for p in g.v]
        bad = 0
        for idx, mat, mode, param, uv, flat in g.f:
            vs = [bv[i] for i in idx]
            # drop repeated corners (collapsed apexes)
            clean, cuv = [], []
            for k, v in enumerate(vs):
                if not clean or v is not clean[-1]:
                    clean.append(v)
                    cuv.append(uv[k] if uv else None)
            if len(clean) > 2 and clean[0] is clean[-1]:
                clean.pop()
                cuv.pop()
            if len(clean) < 3 or len(set(clean)) != len(clean):
                bad += 1
                continue
            try:
                f = bm.faces.new(clean)
            except ValueError:
                bad += 1
                continue
            f.material_index = mat
            f[L_mode] = mode
            key = (mode, param)
            if key not in pid:
                pid[key] = len(params)
                params.append(key)
            f[L_par] = pid[key]
            f[L_flat] = flat
            if uv:
                for l, t in zip(f.loops, cuv):
                    l[uvl].uv = t
        self.dropped = bad
        self.bm, self.params = bm, params
        self.layers = (L_mode, L_par, L_flat, uvl)
        self.tessellate()
        self.uvs()
        self.edges()
        me = bpy.data.meshes.new(self.name + "_mesh")
        bm.to_mesh(me)
        bm.free()
        for n, _ in MATS:
            me.materials.append(bpy.data.materials[n])
        for a in ("uvm", "uvp", "flat"):
            if a in me.attributes:
                me.attributes.remove(me.attributes[a])
        o = bpy.data.objects.new(self.name + "_mesh", me)
        bpy.context.scene.collection.objects.link(o)
        h = bpy.data.objects.new(self.name, None)
        bpy.context.scene.collection.objects.link(h)
        o.parent = h
        self.obj, self.holder = o, h
        return o

    def tessellate(self):
        """Split long edges (not on explicit-UV faces) so the per-vertex AO has room to vary."""
        bm = self.bm
        L_mode, L_flat = self.layers[0], self.layers[2]
        L = self.cell
        for _ in range(8):
            long = []
            for e in bm.edges:
                if e.calc_length() <= L * 1.05:
                    continue
                if any(f[L_mode] == EXPLICIT or f[L_flat] & 2 for f in e.link_faces):
                    continue
                long.append(e)
            if not long:
                break
            groups: dict[int, list] = {}
            for e in long:
                groups.setdefault(math.ceil(e.calc_length() / L) - 1, []).append(e)
            for cuts in sorted(groups, reverse=True):
                es = [e for e in groups[cuts] if e.is_valid]
                if es:
                    bmesh.ops.subdivide_edges(bm, edges=es, cuts=cuts, use_grid_fill=True)

    def uvs(self):
        bm = self.bm
        L_mode, L_par, _, uvl = self.layers
        for f in bm.faces:
            mode = f[L_mode]
            if mode == EXPLICIT:
                continue
            key = self.params[f[L_par]]
            param = key[1] if key else None
            n = f.normal
            n = Vector((n.x, n.z, -n.y))
            roof = f.material_index in ROOFLIKE
            du, dv = (ROOF_U, ROOF_V) if roof else (WALL_U, WALL_V)
            pts = [Vector((l.vert.co.x, l.vert.co.z, -l.vert.co.y)) for l in f.loops]
            if abs(n.y) > 0.8 and mode != CONE or n.length < 1e-6:
                for l, p in zip(f.loops, pts):
                    l[uvl].uv = (p.x * du, -p.z * dv)
                continue
            if mode in (CYL, CONE) and param:
                cx, cz = param[0], param[1]
                if mode == CYL:
                    wrap = max(1, round(TAU * param[2] * du))
                else:
                    wrap = max(1, round(TAU * param[3] * du))
                c = sum(pts, Vector()) / len(pts)
                ac = math.atan2(c.x - cx, c.z - cz)
                for l, p in zip(f.loops, pts):
                    a = math.atan2(p.x - cx, p.z - cz)
                    if math.hypot(p.x - cx, p.z - cz) < 1e-5:
                        a = ac
                    while a - ac > PI:
                        a -= TAU
                    while a - ac < -PI:
                        a += TAU
                    u = a / TAU * wrap
                    if mode == CYL:
                        v = p.y * dv
                    else:
                        r = math.hypot(p.x - cx, p.z - cz)
                        v = -math.hypot(r, param[2] - p.y) * dv
                    l[uvl].uv = (u, v)
                continue
            t = Vector((n.z, 0.0, -n.x))
            if t.length < 1e-6:
                t = Vector((1, 0, 0))
            t.normalize()
            b = n.cross(t).normalized()
            for l, p in zip(f.loops, pts):
                l[uvl].uv = (p.dot(t) * du, p.dot(b) * dv)

    def edges(self, angle=35.0):
        bm = self.bm
        L_flat = self.layers[2]
        cos_t = math.cos(math.radians(angle))
        for f in bm.faces:
            f.smooth = not (f[L_flat] & 1)
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) != 2:
                e.smooth = True
                continue
            sharp = lf[0].normal.dot(lf[1].normal) < cos_t or lf[0].material_index != lf[1].material_index
            e.smooth = not sharp

    # AO ---------------------------------------------------------------------------------------
    def bake_ao(self, samples):
        sc = bpy.context.scene
        o = self.obj
        me = o.data
        ca = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
        me.color_attributes.active_color = ca
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        if self.ao_dist <= 0:
            for d in ca.data:
                d.color = (1, 1, 1, 1)
            return
        ground = None
        if self.ground is not None:
            gm = bpy.data.meshes.new("ao_ground")
            gb = bmesh.new()
            bmesh.ops.create_grid(gb, x_segments=1, y_segments=1, size=600)
            gb.to_mesh(gm)
            gb.free()
            ground = bpy.data.objects.new("ao_ground", gm)
            sc.collection.objects.link(ground)
            ground.location = (0, 0, self.ground)
        for ob in sc.objects:
            ob.hide_render = not (ob == o or ob == ground)
            ob.select_set(False)
        sc.world.light_settings.distance = self.ao_dist
        sc.cycles.samples = samples
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        if ground:
            bpy.data.objects.remove(ground)
            bpy.data.meshes.remove(gm)
        # stylised remap: keep open faces white, crevices warm-dark but never black
        glow = {i for i, (n, _) in enumerate(MATS) if n == "TC_LanternGlow"}
        glow_verts = set()
        for p in me.polygons:
            if p.material_index in glow:
                glow_verts.update(p.vertices)
        for i, d in enumerate(ca.data):
            ao = d.color[0]
            v = 1.0 - 0.82 * (1.0 - ao)
            v = max(0.3, min(1.0, v ** 1.1))
            if i in glow_verts:
                v = 1.0
            v *= self.g.shade.get(i, 1.0)
            d.color = (v, v, v, 1.0)
        for ob in sc.objects:
            ob.hide_render = False

    # Facts ------------------------------------------------------------------------------------
    def facts(self):
        me = self.obj.data
        me.calc_loop_triangles()
        tris = len(me.loop_triangles)
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.z for v in me.vertices]
        zs = [-v.co.y for v in me.vertices]
        mn = [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)]
        mx = [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]
        used = sorted({MATS[p.material_index][0] for p in me.polygons})
        return dict(
            triangles=tris,
            bbox=dict(min=mn, max=mx),
            size=[round(b - a, 3) for a, b in zip(mn, mx)],
            materials=used,
            anchors=self.anchors,
        )


def rnd(v):
    if isinstance(v, (list, tuple, Vector)):
        return [rnd(x) for x in v]
    if isinstance(v, dict):
        return {k: rnd(x) for k, x in v.items()}
    if isinstance(v, float):
        return round(v, 3)
    return v


# ============================================================================================
# Pieces
# ============================================================================================
def build_lantern() -> Piece:
    pc = Piece("TC_Lantern", cell=100, ao_dist=0, ground=None)
    g = pc.g
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=4.0)
    # gem: stretch a touch vertically and snap the facets into crisp bands
    for v in bm.verts:
        v.co.z *= 1.06
    vid = {}
    for v in bm.verts:
        vid[v] = g.vert((v.co.x, v.co.z, -v.co.y))
    for f in bm.faces:
        g.face_out([vid[v] for v in f.verts], GLOW, (0, 0, 0), flat=True)
    bm.free()
    pc.anchors = dict(centre=[0.0, 0.0, 0.0], radius=4.0, diameter=8.0)
    return pc


def build_plinth() -> Piece:
    pc = Piece("TC_Plinth", cell=1.6, ao_dist=2.5)
    g = pc.g
    box(g, (0, 0.25, 0), (8.0, 0.5, 8.0), DARK, ch=0.1)
    box(g, (0, 0.75, 0), (7.4, 0.5, 7.4), DARK, ch=0.1)
    box(g, (0, 1.12, 0), (6.9, 0.26, 6.9), DARK, ch=0.08)
    # body with corner pilasters
    box(g, (0, 1.2 + 2.6, 0), (6.2, 5.2, 6.2), DARK, ch=0.12)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(g, (sx * 2.95, 3.8, sz * 2.95), (0.9, 5.2, 0.9), DARK, ch=0.12)
    box(g, (0, 6.55, 0), (6.7, 0.3, 6.7), GOLD, ch=0.06)
    box(g, (0, 6.95, 0), (7.2, 0.5, 7.2), DARK, ch=0.12)
    box(g, (0, 7.45, 0), (7.6, 0.5, 7.6), DARK, ch=0.14)
    box(g, (0, 7.85, 0), (7.0, 0.3, 7.0), DARK, ch=0.08)
    shield_panel(g, T(0, 3.85, 3.1), w=3.4, h=4.0, depth=0.3)
    pc.anchors = dict(top=[0.0, 8.0, 0.0], topSize=[7.0, 7.0], shield=[0.0, 3.85, 3.5])
    return pc


def build_ward_wall() -> Piece:
    pc = Piece("TC_WardWall_12", cell=2.0, ao_dist=3.5)
    g = pc.g
    L = 6.0
    # batter, plinth, core
    prism(g, chamfer_poly([(-2.5, 0), (2.5, 0), (2.0, 3.0), (-2.0, 3.0)], 0.0), -L, L, "x", LIME)
    with notess(g):
        prism(g, chamfer_poly([(-2.62, 0), (2.62, 0), (2.62, 0.9), (-2.62, 0.9)], 0.14), -L, L, "x", DARK)
        prism(g, [(-1.45, 13.6), (1.45, 13.6), (1.45, 13.82), (-1.45, 13.82)], -L, L, "x", DARK)
    prism(g, [(-2.0, 2.9), (2.0, 2.9), (2.0, 13.7), (-2.0, 13.7)], -L, L, "x", LIME)
    for s in (-1, 1):
        Mf = T(0, 0, s * 2.0) @ RY(0 if s > 0 else PI)
        string_course(g, Mf, -L, L, 9.6, proj=0.28, h=0.45)
        string_course(g, Mf, -L, L, 13.0, proj=0.3, h=0.55)
        for x in (-3.0, 3.0):
            slit(g, Mf @ T(x, 6.4, 0), h=2.4)
    # parapets on both edges
    for s in (-1, 1):
        zc = s * 1.75
        prism(g, chamfer_poly([(zc - 0.4, 13.5), (zc + 0.4, 13.5), (zc + 0.4, 14.7), (zc - 0.4, 14.7)], 0.08), -L, L, "x", LIME)
        merlon_row(g, -L, L, 14.7, 1.06, 0.8, M=T(0, 0, zc) @ RY(0 if s > 0 else PI), slits=True)
    pc.anchors = dict(walkway=[0.0, 13.82, 0.0], walkwayWidth=2.9, ends=[[-6.0, 0.0, 0.0], [6.0, 0.0, 0.0]], length=12.0)
    return pc


def build_city_wall() -> Piece:
    pc = Piece("TC_CityWall_12", cell=2.0, ao_dist=4.0)
    g = pc.g
    L = 6.0
    prism(g, [(-3.9, 0), (3.9, 0), (3.0, 5.0), (-3.0, 5.0)], -L, L, "x", LIME)
    with notess(g):
        prism(g, chamfer_poly([(-4.05, 0), (4.05, 0), (4.05, 1.2), (-4.05, 1.2)], 0.16), -L, L, "x", DARK)
        prism(g, chamfer_poly([(-3.12, 22.75), (-2.23, 22.75), (-2.23, 23.0), (-3.12, 23.0)], 0.07), -L, L, "x", DARK)
        prism(g, [(-2.4, 21.5), (2.5, 21.5), (2.5, 21.8), (-2.4, 21.8)], -L, L, "x", DARK)
    prism(g, [(-3.0, 4.9), (3.0, 4.9), (3.0, 21.6), (-3.0, 21.6)], -L, L, "x", LIME)
    for s in (-1, 1):
        Mf = T(0, 0, s * 3.0) @ RY(0 if s > 0 else PI)
        string_course(g, Mf, -L, L, 14.6, proj=0.34, h=0.6)
        string_course(g, Mf, -L, L, 5.0, proj=0.22, h=0.4)
        for x in (-3.0, 3.0):
            slit(g, Mf @ T(x, 10.5, 0), h=2.8)
    # outer (+Z) machicolation: corbels carrying the overhanging parapet
    Mo = T(0, 0, 3.0)
    for k in range(10):
        corbel(g, Mo @ T(-L + 0.6 + 1.2 * k, 21.2, 0), w=0.55, h=1.6, d=0.65)
    prism(g, chamfer_poly([(2.45, 21.15), (3.65, 21.15), (3.65, 22.8), (2.45, 22.8)], 0.08), -L, L, "x", LIME)
    merlon_row(g, -L, L, 22.8, 1.0, 1.2, M=T(0, 0, 3.05), slits=True)
    # inner (city) parapet, low with coping
    prism(g, chamfer_poly([(-3.0, 21.4), (-2.35, 21.4), (-2.35, 22.75), (-3.0, 22.75)], 0.06), -L, L, "x", LIME)
    pc.anchors = dict(walkway=[0.0, 21.8, 0.0], walkwayWidth=4.9, ends=[[-6.0, 0.0, 0.0], [6.0, 0.0, 0.0]], length=12.0,
                      outerFace="+Z")
    return pc


def tower_body(g, cx, cz, r, y_shaft_top, n, plinth_r, batter_top, bands, slits_at, offset=0.0):
    """Round tower: plinth, batter, shaft, string courses, arrow slits."""
    lathe(g, [(0.0, 0.0), (plinth_r, 0.0), (plinth_r, 0.95), (plinth_r - 0.25, 1.2), (0.0, 1.2)], n, DARK, cx, cz, rref=r)
    lathe(g, [(0.0, 1.1), (plinth_r - 0.3, 1.1), (r + 0.05, batter_top), (r, batter_top + 0.3), (r, y_shaft_top), (0.0, y_shaft_top)],
          n, LIME, cx, cz, rref=r)
    for y in bands:
        band(g, cx, cz, r, y, y + 0.55, n, proj=0.32)
    for y, angs in slits_at:
        for a in angs:
            a = a + offset
            slit(g, T(*polar(cx, cz, r - 0.08, a, y)) @ RY(a), h=2.6)


def tower_top(g, cx, cz, r, y_cor, n, merlons, r_drum, roof_h, r_eave, parapet_h=1.2, merlon_h=2.0, corbels=None,
              flare=0.2, finial_s=1.0):
    """Machicolation gallery, crenellated parapet, roof drum, flared slate cone and finial."""
    nc = corbels or merlons * 2
    round_corbels(g, cx, cz, r, y_cor, nc, h=2.0, d=1.05, w=0.62, offset=PI / nc)
    yf = y_cor
    r_out = r + 1.05
    # gallery floor overhang and breast wall (the walkway is the floor top)
    lathe(g, ringprof(r_drum - 0.5, r_out + 0.1, yf, yf + 0.4, 0.1), n, DARK, cx, cz, loop=True, rref=r)
    yb = yf + 0.4
    lathe(g, ringprof(r_out - 0.75, r_out, yb - 0.05, yb + parapet_h, 0.08), n, LIME, cx, cz, loop=True, rref=r)
    ym = yb + parapet_h
    round_merlons(g, cx, cz, r_out - 0.75, r_out, ym, ym + merlon_h, merlons)
    top = ym + merlon_h + 0.24
    # drum and roof
    y_eave = top + 0.5
    lathe(g, [(r_drum, yb - 0.1), (r_drum, y_eave - 0.3)], n, LIME, cx, cz, rref=r_drum)
    band(g, cx, cz, r_drum, y_eave - 1.0, y_eave - 0.35, n, mat=GOLD, proj=0.12, ch=0.06)
    apex = roof_cone(g, cx, cz, y_eave, r_eave, roof_h, n, r_drum, flare=flare)
    sock = finial(g, cx, cz, apex - 0.35, s=finial_s, n=10)
    return top, y_eave, apex, sock


def build_ward_tower() -> Piece:
    pc = Piece("TC_WardTower", cell=2.4, ao_dist=4.5)
    g = pc.g
    r = 7.0
    n = 32
    tower_body(g, 0, 0, r, 51.7, n, plinth_r=8.0, batter_top=6.0, bands=[20.0, 41.0],
               slits_at=[(11.5, [0, PI / 2, PI, -PI / 2]), (24.5, [PI / 4, 3 * PI / 4, -PI / 4, -3 * PI / 4]),
                         (38.0, [PI / 2, -PI / 2])])
    for a in (0.0, PI):
        window(g, T(*polar(0, 0, r - 0.12, a, 37.0)) @ RY(a), w=1.8, h=4.6, frame=0.35, depth=0.4, hood=True)
    top, y_eave, apex, sock = tower_top(g, 0, 0, r, 51.6, n, merlons=14, r_drum=6.1, roof_h=18.0, r_eave=8.9,
                                        parapet_h=1.2, merlon_h=2.6, corbels=24)
    pc.anchors = dict(flagSocket=[0.0, round(sock, 3), 0.0], socketRadius=0.2, walkway=[0.0, 52.0, 0.0],
                      masonryTop=round(top, 3), roofEave=round(y_eave, 3), roofApex=round(apex, 3), radius=r)
    return pc


def build_city_tower() -> Piece:
    pc = Piece("TC_CityTower", cell=2.4, ao_dist=4.5)
    g = pc.g
    r = 6.0
    n = 30
    tower_body(g, 0, 0, r, 28.9, n, plinth_r=7.6, batter_top=6.5, bands=[5.0, 14.6, 21.0],
               slits_at=[(10.0, [PI / 4, 3 * PI / 4, -PI / 4, -3 * PI / 4]), (18.0, [0, PI / 2, PI, -PI / 2])])
    top, y_eave, apex, sock = tower_top(g, 0, 0, r, 28.8, n, merlons=14, r_drum=5.2, roof_h=15.0, r_eave=7.7,
                                        parapet_h=1.1, merlon_h=1.9, corbels=20)
    pc.anchors = dict(flagSocket=[0.0, round(sock, 3), 0.0], socketRadius=0.2, walkway=[0.0, 29.2, 0.0],
                      masonryTop=round(top, 3), roofEave=round(y_eave, 3), roofApex=round(apex, 3), radius=r,
                      wallJoint="city walls end at the tower centre; the 7.6 base flare hides their batter")
    return pc


def portcullis(g, x0, x1, ybot, ytop, z, bar=0.26, pitch=0.8, rows=1.0):
    n = max(2, round((x1 - x0) / pitch))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        box(g, (x, (ybot + ytop) / 2 + 0.25, z), (bar, ytop - ybot - 0.5, bar), IRON)
        prism(g, [(x - bar * 0.55, ybot + 0.5), (x + bar * 0.55, ybot + 0.5), (x, ybot)], z - bar / 2, z + bar / 2, "z", IRON)
    y = ybot + 0.8
    while y < ytop:
        box(g, ((x0 + x1) / 2, y, z), (x1 - x0 + bar, bar * 0.9, bar * 1.2), IRON)
        y += rows


def build_ward_gate() -> Piece:
    pc = Piece("TC_WardGate", cell=2.0, ao_dist=4.0)
    g = pc.g
    rng = random.Random(11)
    W, D, Ht = 8.0, 5.0, 19.4
    a, ha_ = 3.0, 9.0
    R = 3.9
    hs = ha_ - arch_h(a, R)
    arch_wall(g, -W, W, 0.0, Ht, -D, D, 0.0, a, hs, R, "z", LIME, cell=2.0)
    # plinth and string courses round the block
    for s, yaw in ((1, 0.0), (-1, PI)):
        Mf = T(0, 0, s * D) @ RY(yaw)
        for x0, x1 in ((-W, -a - 0.05), (a + 0.05, W)):
            prism(g, chamfer_poly([(-0.3, 0), (0.3, 0), (0.3, 1.0), (-0.3, 1.0)], 0.12), x0, x1, "x", DARK, M=Mf)
        string_course(g, Mf, -W, W, 12.6, proj=0.3, h=0.5)
        arch_ring(g, a, hs, R, 1.15, -0.2, 0.35, DARK, n=11, M=Mf, blocks=9, step=0.18)
        arch_ring(g, a + 1.2, hs, R + 1.2, 0.3, -0.2, 0.55, DARK, n=11, M=Mf)
        for x in (-5.6, 5.6):
            slit(g, Mf @ T(x, 7.5, 0), h=2.6)
        for k in range(13):
            corbel(g, Mf @ T(-W + 0.62 + 1.23 * k, 18.6, 0), w=0.55, h=1.5, d=0.6)
        prism(g, chamfer_poly([(-0.25, 18.55), (0.85, 18.55), (0.85, 20.3), (-0.25, 20.3)], 0.08), -W, W, "x", LIME, M=Mf)
        merlon_row(g, -W, W, 20.3, 1.45, 1.1, M=Mf @ T(0, 0, 0.3), w=1.4, gap=1.0)
    for s in (-1, 1):  # side faces (ward walls attach here): plinth and string course only
        Ms = T(s * W, 0, 0) @ RY(s * PI / 2)
        prism(g, chamfer_poly([(-0.3, 0), (0.3, 0), (0.3, 1.0), (-0.3, 1.0)], 0.12), -D, D, "x", DARK, M=Ms)
        string_course(g, Ms, -D, D, 12.6, proj=0.3, h=0.5)
        prism(g, chamfer_poly([(-0.2, 19.3), (0.35, 19.3), (0.35, 20.5), (-0.2, 20.5)], 0.08), -D, D, "x", LIME, M=Ms)
    prism(g, [(-W + 0.4, Ht - 0.1), (W - 0.4, Ht - 0.1), (W - 0.4, Ht + 0.15), (-W + 0.4, Ht + 0.15)], -D + 0.3, D - 0.3, "z", DARK)
    shield_panel(g, T(0, 15.1, D + 0.02), w=2.6, h=3.0, depth=0.28)
    # passage floor and raised portcullis in its slot
    box(g, (0, 0.05, 0), (2 * a, 0.1, 2 * D), DARK)
    portcullis(g, -a - 0.25, a + 0.25, ha_ - 1.25, ha_ + 2.5, D - 1.4)
    # corner turrets on the front corners
    for s in (-1, 1):
        cx, cz = s * W, D
        prof = [(0.0, 7.4), (0.6, 7.4), (1.2, 8.2), (1.75, 9.3), (2.2, 10.5), (2.2, 10.9), (0.0, 10.9)]
        lathe(g, chamfer_poly(prof, 0.05), 20, DARK, cx, cz, rref=2.2)
        lathe(g, [(0.0, 10.8), (2.05, 10.8), (2.05, 21.4), (0.0, 21.4)], 20, LIME, cx, cz, rref=2.05)
        band(g, cx, cz, 2.05, 15.5, 15.9, 20, proj=0.18, ch=0.08)
        round_corbels(g, cx, cz, 2.05, 21.4, 10, h=1.2, d=0.55, w=0.42)
        lathe(g, chamfer_poly([(1.2, 21.4), (2.65, 21.4), (2.65, 22.6), (1.2, 22.6)], 0.08), 20, LIME, cx, cz, loop=True, rref=2.6)
        round_merlons(g, cx, cz, 2.15, 2.65, 22.6, 23.8, 8, slits=False)
        lathe(g, [(1.6, 21.6), (1.6, 24.3)], 20, LIME, cx, cz, rref=1.6)
        apex = roof_cone(g, cx, cz, 24.6, 2.9, 6.2, 20, 1.6, flare=0.18)
        finial(g, cx, cz, apex - 0.15, s=0.42, socket=False)
        slit(g, T(*polar(cx, cz, 2.0, s * PI / 2, 17.5)) @ RY(s * PI / 2), h=1.8, w=0.28)
        slit(g, T(*polar(cx, cz, 2.0, 0.0, 13.0)), h=1.8, w=0.28)
    for sx in (-1, 1):
        quoins(g, sx * W, -D, sx, -1, 1.0, 18.4, rng)
    pc.anchors = dict(passage=dict(width=6.0, height=9.0, springing=round(hs, 3), depth=10.0, centre=[0.0, 0.0, 0.0]),
                      portcullisBottom=round(ha_ - 1.25, 3), walkway=[0.0, Ht + 0.15, 0.0],
                      sides=[[-8.0, 0.0, 0.0], [8.0, 0.0, 0.0]])
    return pc


# ---------------------------------------------------------------------------------------------
# Claws
# ---------------------------------------------------------------------------------------------
def bezier(pts, n):
    """Catmull-Rom through pts sampled to n points."""
    P = [Vector(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    segs = len(P) - 3
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(int(t), segs - 1)
        u = t - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return out


def resample(path, n):
    s = [0.0]
    for k in range(1, len(path)):
        s.append(s[-1] + (path[k] - path[k - 1]).length)
    out = []
    j = 0
    for i in range(n):
        t = s[-1] * i / (n - 1)
        while j < len(s) - 2 and s[j + 1] < t:
            j += 1
        u = (t - s[j]) / max(1e-9, s[j + 1] - s[j])
        out.append(path[j].lerp(path[j + 1], u))
    return out


def finger(g, ctrl, plane_n, inner_sign, width, depth, teeth=6, tooth=0.35, t_teeth=(0.15, 0.92), nsec=14, K=48,
           joints=(), gold_tip=0.0, gold_edge=True, tip=True, base_cap=True, stone=LIME, flat_inner=0.0):
    """One claw finger along a planar Catmull-Rom curve.

    width(t)/depth(t): half sizes in plane / across the plane. Teeth are cut on the side facing
    inner_sign * N. Joints are thin grooves (segmented plates); the outer ridge carries a gold trim.
    """
    path = resample(bezier(ctrl, K * 3), K)
    fr = plane_frames(path, plane_n)
    fr = [(N * inner_sign, B * inner_sign) for N, B in fr]  # N points to the serrated (inner) side

    def tooth_at(t):
        if teeth <= 0 or not (t_teeth[0] <= t <= t_teeth[1]):
            return 0.0
        u = (t - t_teeth[0]) / (t_teeth[1] - t_teeth[0]) * teeth
        f = u - math.floor(u)
        return tooth * (1 - abs(2 * f - 1)) ** 1.3 * math.sin(PI / 2 * min(1, (t - t_teeth[0]) / 0.08)) ** 0.5

    def section(k, m):
        t = k / (K - 1)
        phi = TAU * m / nsec
        c, s = math.cos(phi), math.sin(phi)
        w = width(t)
        d = depth(t)
        for tj in joints:
            w *= 1 - 0.07 * math.exp(-((t - tj) / 0.012) ** 2)
            d *= 1 - 0.07 * math.exp(-((t - tj) / 0.012) ** 2)
        a = w * c
        if c > 0:  # inner side: flatter, serrated
            a = w * (c ** (1 + flat_inner)) + tooth_at(t) * c ** 6
        b = d * s * (1 - 0.18 * c * c)
        if gold_edge:  # raised trim along the outer ridge
            a -= 0.12 * w * math.exp(-((phi - PI) / 0.3) ** 2)
        return a, b

    def mat_fn(k, m):
        t = (k + 0.5) / (K - 1)
        phi = TAU * (m + 0.5) / nsec
        if gold_tip and t > 1 - gold_tip:
            return GOLD
        if gold_edge and abs(phi - PI) < TAU / nsec * 0.9:
            return GOLD
        for tj in joints:
            if abs(t - tj) < 0.5 / (K - 1):
                return GOLD if gold_edge else DARK
        return stone

    sweep(g, path, fr, section, nsec, mat_fn, tip=tip, caps=(base_cap, not tip))
    return path


def build_pincer_gate() -> Piece:
    pc = Piece("TC_PincerGate", cell=2.2, ao_dist=5.0)
    g = pc.g
    rng = random.Random(23)
    # flanking towers
    for s in (-1, 1):
        cx = s * 12.0
        # talus and plinth
        prism(g, [(cx - 6.9, -6.9), (cx + 6.9, -6.9), (cx + 6.9, 6.9), (cx - 6.9, 6.9)], 0.0, 1.2, "y", DARK)
        lathe_box_talus(g, cx, 0.0, 13.6, 12.0, 1.2, 4.2)
        box(g, (cx, 13.45, 0), (12.0, 18.9, 12.0), LIME)
        for yaw in (0.0, PI / 2, PI, -PI / 2):
            Mf = T(cx, 0, 0) @ RY(yaw) @ T(0, 0, 6.0)
            string_course(g, Mf, -6.0, 6.0, 14.6, proj=0.34, h=0.6)
            if not (yaw == s * PI / 2):
                for k in range(10):
                    corbel(g, Mf @ T(-5.4 + 1.2 * k, 21.7, 0), w=0.55, h=1.7, d=0.7)
                prism(g, chamfer_poly([(-0.25, 21.6), (0.95, 21.6), (0.95, 23.9), (-0.25, 23.9)], 0.08), -6.6, 6.6, "x", LIME, M=Mf)
                merlon_row(g, -6.6, 6.6, 23.9, 1.85, 1.2, M=Mf @ T(0, 0, 0.35), w=1.5, gap=1.1)
            else:  # city-wall side: plain parapet so the wall walk runs in
                prism(g, chamfer_poly([(-0.25, 21.6), (0.6, 21.6), (0.6, 23.9), (-0.25, 23.9)], 0.08), -6.0, 6.0, "x", LIME, M=Mf)
                merlon_row(g, -6.0, 6.0, 23.9, 1.85, 0.85, M=Mf @ T(0, 0, 0.18), w=1.5, gap=1.1)
            if yaw in (0.0, PI):
                slit(g, Mf @ T(0, 9.0, 0), h=3.0)
                slit(g, Mf @ T(0, 17.6, 0), h=2.6)
        for qx in (-1, 1):
            for qz in (-1, 1):
                quoins(g, cx + qx * 6.0, qz * 6.0, qx, qz, 4.2, 21.0, rng, long=1.9, short=1.1, rowh=1.25)
        box(g, (cx, 23.0, 0), (11.4, 0.2, 11.4), DARK)
    # central gate block with the great arch
    a, hs = 6.0, 10.5
    R = (a * a + 7.5 * 7.5) / (2 * a)
    apex = hs + arch_h(a, R)
    arch_wall(g, -6.0, 6.0, 0.0, 21.6, -5.0, 5.0, 0.0, a, hs, R, "z", LIME, cell=2.2, jambs=False)
    for s, yaw in ((1, 0.0), (-1, PI)):
        Mf = T(0, 0, s * 5.0) @ RY(yaw)
        arch_ring(g, a, hs, R, 1.6, -0.2, 0.45, DARK, n=16, M=Mf, blocks=15, step=0.22)
        arch_ring(g, a + 1.65, hs, R + 1.65, 0.35, -0.2, 0.65, DARK, n=16, M=Mf)
        for k in range(10):
            corbel(g, Mf @ T(-5.4 + 1.2 * k, 21.0, 0), w=0.55, h=1.6, d=0.65)
        prism(g, chamfer_poly([(-0.25, 20.95), (0.9, 20.95), (0.9, 22.6), (-0.25, 22.6)], 0.08), -6.0, 6.0, "x", LIME, M=Mf)
        merlon_row(g, -6.0, 6.0, 22.6, 1.6, 1.15, M=Mf @ T(0, 0, 0.33), w=1.5, gap=1.0)
    claw_emblem(g, T(0, apex + 0.85, 5.68), size=0.55, depth=0.22)
    box(g, (0, 21.65, 0), (11.6, 0.2, 9.4), DARK)
    box(g, (0, 0.05, 0), (12.0, 0.1, 10.0), DARK)
    portcullis(g, -a - 0.3, a + 0.3, apex - 1.7, apex + 3.0, 3.4, bar=0.34, pitch=1.0, rows=1.2)
    # open doors folded against the passage walls behind the portcullis
    for s in (-1, 1):
        hinge = Vector((s * 5.72, 0.0, 2.4))
        pts = [(0.0, 0.0), (5.95, 0.0)]
        for i in range(10, -1, -1):
            x = 5.95 * i / 10
            pts.append((x, arch_y(6.0 - x, a, hs, R) - 0.2))
        door_leaf(g, pts, T(*hinge) @ RY(PI / 2 + s * 0.06), s)
    # the claws: palm on each tower, a long fixed finger meeting its twin overhead, a short dactyl
    plane_n = Vector((0, 0, 1))
    for s in (-1, 1):
        sx = float(s)
        box(g, (sx * 12.0, 23.8, 0), (8.6, 1.6, 8.6), DARK, ch=0.2)
        lathe(g, chamfer_poly([(0.0, 24.6), (4.4, 24.6), (4.4, 25.6), (0.0, 25.6)], 0.15), 24, GOLD, sx * 12.0, 0.0)
        palm = [(sx * 12.0, 24.6, 0), (sx * 12.3, 28.0, 0), (sx * 12.0, 31.6, 0), (sx * 10.9, 35.2, 0)]
        finger(g, palm, plane_n, sx, width=lambda t: 3.0 + 0.75 * math.sin(PI * min(1.0, t * 1.15)) - 0.3 * t,
               depth=lambda t: 2.5 + 0.45 * math.sin(PI * min(1.0, t * 1.15)), teeth=0, K=18, nsec=16, joints=(0.1,),
               tip=False)
        fixed = [(sx * 11.7, 31.6, 0), (sx * 10.9, 35.6, 0), (sx * 10.2, 39.2, 0), (sx * 7.8, 43.1, 0), (sx * 4.2, 45.5, 0), (sx * 0.55, 46.0, 0)]
        finger(g, fixed, plane_n, sx, width=lambda t: 2.75 * (1 - t) ** 0.75 + 0.12, depth=lambda t: 2.3 * (1 - t) ** 0.65 + 0.12,
               teeth=6, tooth=0.85, t_teeth=(0.12, 0.84), K=60, nsec=14, joints=(0.32, 0.6), gold_tip=0.07, flat_inner=0.6)
        dact = [(sx * 11.0, 31.4, 0), (sx * 8.4, 33.0, 0), (sx * 6.2, 35.3, 0), (sx * 4.9, 38.3, 0), (sx * 4.5, 39.8, 0)]
        finger(g, dact, plane_n, -sx, width=lambda t: 1.85 * (1 - t) ** 0.75 + 0.1, depth=lambda t: 1.7 * (1 - t) ** 0.65 + 0.1,
               teeth=4, tooth=0.7, t_teeth=(0.15, 0.82), K=44, nsec=12, joints=(0.42,), gold_tip=0.1, flat_inner=0.6)
    # gold crown hanging in the gap
    crown(g, 0.0, 42.4, 0.0, s=1.35)
    box(g, (0, 44.5, 0), (0.16, 2.3, 0.16), GOLD)
    lathe(g, [(0, -0.5), (0.3, -0.42), (0.5, 0), (0.3, 0.42), (0, 0.5)], 10, GOLD, mode=PLANAR, M=T(0, 45.75, 0))
    pc.anchors = dict(passage=dict(width=12.0, height=round(apex, 3), springing=hs, depth=10.0, centre=[0.0, 0.0, 0.0]),
                      portcullisBottom=round(apex - 1.7, 3), crownEmblem=[0.0, 42.4, 0.0], clawTips=[[-0.55, 46.0, 0.0], [0.55, 46.0, 0.0]],
                      wallSides=[[-18.0, 0.0, 0.0], [18.0, 0.0, 0.0]], towerWalkway=23.1)
    return pc


def lathe_box_talus(g, cx, cz, w0, w1, y0, y1):
    """Square talus (battered base) from w0 to w1 wide between y0 and y1."""
    pts = [(-w0 / 2, -w0 / 2), (w0 / 2, -w0 / 2), (w0 / 2, w0 / 2), (-w0 / 2, w0 / 2)]
    mk = g.mark()
    b = g.verts([(cx + x, y0, cz + z) for x, z in pts])
    t = g.verts([(cx + x * w1 / w0, y1, cz + z * w1 / w0) for x, z in pts])
    for i in range(4):
        j = (i + 1) % 4
        c = Vector((cx, (y0 + y1) / 2, cz))
        g.face_out([b[i], b[j], t[j], t[i]], LIME, c)
    g.face_dir(t, LIME, (0, 1, 0))
    g.face_dir(b, LIME, (0, -1, 0))


def door_leaf(g, pts, M, s):
    """Wooden door leaf (local x from the hinge, y up, thickness in z) with iron straps and studs."""
    prism(g, pts, -0.25, 0.25, "z", WOOD, M=M)
    hmax = max(y for _, y in pts)
    for y in (1.6, 5.0, 8.4, 11.8, 15.0):
        if y > hmax - 0.8:
            break
        width = max(x for x, yy in pts if yy >= y) if any(yy >= y for _, yy in pts) else 6.0
        width = min(6.0, width) - 0.25
        for z in (-0.3, 0.3):
            box(g, (width / 2 + 0.05, y, z), (width, 0.32, 0.12), IRON, M=M)
            for k in range(5):
                box(g, (0.6 + (width - 1.0) * k / 4, y, z * 1.25), (0.16, 0.16, 0.08), IRON, M=M)
    for i in range(1, 6):  # plank seams
        x = 6.0 * i / 6
        top = max(y for xx, y in pts if abs(xx - x) < 0.61) if pts else 10
        box(g, (x, top / 2, 0.0), (0.08, top - 0.3, 0.56), WOOD, M=M)


def crown(g, x, y, z, s=1.0):
    """Gold crown emblem: band with points and pearls, centred at (x, y, z)."""
    r = 1.45 * s
    prof = [(r - 0.18, -0.55 * s), (r + 0.06, -0.55 * s), (r + 0.06, 0.25 * s), (r - 0.18, 0.25 * s)]
    lathe(g, [(rr, yy + y) for rr, yy in chamfer_poly(prof, 0.05)], 20, GOLD, x, z, loop=True, mode=PLANAR)
    band(g, x, z, r - 0.02, y - 0.62 * s, y - 0.38 * s, 20, mat=GOLD, proj=0.12, ch=0.05)
    lathe(g, [(0, y - 0.5 * s), (r - 0.15, y - 0.5 * s), (r - 0.22, y + 0.15 * s), (0.75 * s, y + 0.62 * s), (0, y + 0.8 * s)], 16,
          GOLD, x, z, mode=PLANAR)
    for k in range(5):
        a = TAU * k / 5
        base = polar(x, z, r - 0.06, a, y + 0.2 * s)
        tipp = polar(x, z, r + 0.12, a, y + 1.25 * s)
        d = tipp - base
        path = [base + d * t for t in (0.0, 0.5, 1.0)]
        fr = [(Vector((math.sin(a), 0, math.cos(a))), Vector((math.cos(a), 0, -math.sin(a))))] * 3
        sweep(g, path, fr, lambda k_, m, _w=(0.32 * s, 0.2 * s, 0.0): (
            math.cos(TAU * m / 6) * _w[k_] * 0.6, math.sin(TAU * m / 6) * _w[k_]), 6, lambda k_, m: GOLD, tip=True)
        lathe(g, [(0, -0.22 * s), (0.16 * s, -0.17 * s), (0.22 * s, 0), (0.16 * s, 0.17 * s), (0, 0.22 * s)], 8, GOLD,
              mode=PLANAR, M=T(*(tipp + Vector((0, 0.18 * s, 0)))))


# ---------------------------------------------------------------------------------------------
def build_bridge() -> Piece:
    pc = Piece("TC_BridgeSpan", cell=2.2, ao_dist=4.5, ground=-14.0)
    g = pc.g
    HW = 7.0
    R = 10.0
    yc = -13.0
    # body: spandrels, piers (half at each end) and the barrel vault
    arch_wall(g, -15.0, 15.0, -14.0, -1.2, -HW, HW, 0.0, R, yc, R, "x", LIME, cell=2.2, n=14)
    for s in (-1, 1):
        Mf = T(s * HW, 0, 0) @ RY(s * PI / 2)
        # voussoir ring and hood (local x runs along -s*z, which is fine for a symmetric arch)
        arch_ring(g, R, yc, R, 1.35, -0.2, 0.3, DARK, n=16, M=Mf, blocks=19, step=0.16)
        arch_ring(g, R + 1.4, yc, R + 1.4, 0.3, -0.2, 0.5, DARK, n=16, M=Mf)
        string_course(g, Mf, -15.0, 15.0, -1.55, proj=0.32, h=0.5)
        for k in range(13):
            corbel(g, Mf @ T(-9.0 + 1.5 * k, -1.55, 0), w=0.5, h=0.95, d=0.5)
        # cutwater halves at each end, then corbelled bays at deck level
        for e in (-1, 1):
            z0 = e * 10.0
            z1 = e * 15.0
            tri = [(s * HW, z0), (s * HW, z1), (s * (HW + 5.0), z1)]
            prism(g, tri, -14.0, -5.6, "y", LIME)
            cap = [(s * (HW - 0.2), z0 - e * 0.25), (s * (HW - 0.2), z1), (s * (HW + 5.5), z1)]
            prism(g, cap, -5.6, -5.15, "y", DARK)
            # cove bracket carrying the bay out to the statue plinth
            cove = [(s * (HW - 0.3), -5.15), (s * (HW + 5.0), -5.15)]
            for i in range(1, 9):
                th = PI / 2 * i / 8
                cove.append((s * (HW + 8.8 - 3.8 * math.cos(th)), -5.15 + 3.6 * math.sin(th)))
            cove.append((s * (HW - 0.3), -1.55))
            za, zb = sorted((z0 + e * 0.15, z1))
            prism(g, cove, za, zb, "z", LIME)
            xa, xb = sorted((s * (HW - 0.3), s * (HW + 9.05)))
            box(g, ((xa + xb) / 2, -1.45, (za + zb) / 2 - e * 0.12), (xb - xa, 0.42, zb - za + 0.24), DARK, ch=0.1)
            # bay floor and parapets
            xa, xb = sorted((s * (HW - 0.2), s * (HW + 8.8)))
            za, zb = sorted((z0, z1))
            box(g, ((xa + xb) / 2, -0.65, (za + zb) / 2), (xb - xa, 1.1, zb - za), LIME)
            xa, xb = sorted((s * (HW - 0.8), s * (HW + 8.6)))
            box(g, ((xa + xb) / 2, -0.05, (za + zb) / 2), (xb - xa, 0.1, zb - za), DARK)
            xo = s * (HW + 8.4)
            parapet(g, xo, z0, xo, z1, along_z=True)
            parapet(g, s * HW, z0, s * (HW + 8.8), z0, along_z=False)
            post(g, s * (HW + 8.4), z0)
            post(g, s * (HW + 0.4), z0)
    # deck
    box(g, (0, -0.65, 0), (2 * HW, 1.1, 30.0), LIME)
    box(g, (0, -0.05, 0), (2 * HW - 1.6, 0.1, 30.0), DARK)
    for s in (-1, 1):
        parapet(g, s * (HW - 0.4), -10.0, s * (HW - 0.4), 10.0, along_z=True)
        post(g, s * (HW - 0.4), 0.0)
    pc.anchors = dict(deckWidth=12.4, length=30.0, pierBottom=-14.0, deckTop=0.0,
                      plinthSlots=[[sx * 11.0, 0.0, sz * 15.0] for sx in (-1, 1) for sz in (-1, 1)],
                      plinthSlotNote="bays sit at the span ends; neighbouring spans share a slot (8.0 x 9.2 clear)")
    return pc


def parapet(g, x0, z0, x1, z1, along_z=True, h=1.2, t=0.8):
    if along_z:
        za, zb = sorted((z0, z1))
        box(g, (x0, 0.5, (za + zb) / 2), (t, 1.0, zb - za), LIME)
        box(g, (x0, 1.1, (za + zb) / 2), (t + 0.2, 0.2, zb - za), DARK)
    else:
        xa, xb = sorted((x0, x1))
        box(g, ((xa + xb) / 2, 0.5, z0), (xb - xa, 1.0, t), LIME)
        box(g, ((xa + xb) / 2, 1.1, z0), (xb - xa, 0.2, t + 0.2), DARK)


def post(g, x, z):
    box(g, (x, 0.75, z), (1.05, 1.5, 1.05), DARK, ch=0.1)
    box(g, (x, 1.58, z), (1.2, 0.16, 1.2), DARK, ch=0.05)
    lathe(g, [(0, 1.66), (0.36, 1.66), (0.42, 1.8), (0.3, 2.02), (0.14, 2.2), (0, 2.42)], 8, GOLD, x, z, mode=PLANAR)


# ---------------------------------------------------------------------------------------------
# The keep: the fossil carapace of a giant crab lies on the great hall as its roof
# ---------------------------------------------------------------------------------------------
DOME_Y0 = 22.0  # hall roof line: the carapace's underside rests on it
RIM_Y = 23.4  # the margin stands a little proud of the roof so the lip throws a shadow line
BEAD_R = 0.55
EDGE_Y = RIM_Y + BEAD_R * 0.75  # where the dorsal surface meets the rim bead
DOME_TOP = 48.0  # crest of the carapace on the spire axis (under the spire stage)
STAGE_A = 7.4  # half width of the square spire stage; the shell starts under its plinth
SHELL_IN = 7.9  # half width of the square inner edge of the shell (inside the plinth)
SHOULDER, FLANGE_H = 0.94, 0.045  # the dorsal surface creases at rho 0.94 into a thin marginal flange
SHAFT_Y0 = 61.4  # the octagonal shaft starts above the stage

# right half of the outline (x, z) from the front centre round to the back centre: broad front with
# the orbits, anterolateral arc out to the lateral horn (widest point), posterolateral margin
# converging to a narrower rounded back
CARAPACE = [(0.0, 26.4), (4.5, 26.2), (8.5, 25.6), (11.0, 24.8), (12.6, 23.4), (14.6, 23.7), (17.5, 22.4), (21.6, 19.4),
            (25.4, 15.0), (28.3, 10.2), (30.0, 5.5), (29.8, 0.5), (28.4, -5.0), (25.6, -10.6), (21.4, -15.8), (16.2, -19.9),
            (10.6, -22.4), (5.2, -23.4), (0.0, -23.6)]
# carapace regions as relief, right half (mirrored): grooves (polyline, half width, depth) and lobes
GROOVES = [  # the H round the spire stage: its uprights beside the stage and the curve behind it. The stage stands
    # where the bar would be (a bar in front of it read as a cleft between two lobes from three-quarter views), and no
    # line runs down the slope to the margin.
    ([(12.9, 7.5), (12.9, 6.0), (12.6, 1.0), (11.8, -4.0), (10.4, -9.0), (8.2, -13.6), (5.0, -16.9), (1.8, -18.1)], 0.62, 0.1),
    ([(0.0, -8.8), (3.5, -9.4), (6.4, -10.8)], 0.55, 0.08),  # behind the cardiac region
]  # (polyline, half width, depth), right half, mirrored; the first line is the upright between cardiac and branchial regions
LOBES = [(0.0, 16.4, 8.0, 4.2, 0.15), (19.5, 6.5, 4.5, 4.5, 0.12), (18.0, -7.0, 6.0, 7.5, 0.25)]  # (x, z, sx, sz, h)
GROWTH = (0.72, 0.86)  # faint, broad growth ridges (rho)


def _catmull_closed(pts, n):
    """Closed centripetal Catmull-Rom through 2D pts, n samples per span."""
    P = [Vector(p) for p in pts]
    m = len(P)
    out = []
    for i in range(m):
        p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % m], P[(i + 2) % m]
        t1 = (p1 - p0).length ** 0.5
        t2 = t1 + (p2 - p1).length ** 0.5
        t3 = t2 + (p3 - p2).length ** 0.5
        for s in range(n):
            t = t1 + (t2 - t1) * s / n
            a1 = p0 * ((t1 - t) / t1) + p1 * (t / t1)
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / t2) + a2 * (t / t2)
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            out.append(b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1)))
    return out


def _outline_table():
    full = CARAPACE + [(-x, z) for x, z in reversed(CARAPACE[1:-1])]
    tab = sorted((math.atan2(p.x, p.y), p.length) for p in _catmull_closed(full, 40))
    return [t for t, _ in tab], [r for _, r in tab]


OUT_TH, OUT_R = _outline_table()


def out_r(th):
    """Outline radius about the spire axis at angle th (from the front towards +x)."""
    th = ((th + PI) % TAU) - PI
    n = len(OUT_TH)
    i = bisect.bisect_right(OUT_TH, th)
    t0 = OUT_TH[i - 1] if i > 0 else OUT_TH[-1] - TAU
    t1 = OUT_TH[i] if i < n else OUT_TH[0] + TAU
    return lerp(OUT_R[(i - 1) % n], OUT_R[i % n], (th - t0) / max(1e-9, t1 - t0))


def _smooth_outline(k=3, n=720):
    """Cosine coefficients of the outline radius up to harmonic k (a low-pass carapace envelope)."""
    ths = [TAU * i / n - PI for i in range(n)]
    return [sum(out_r(t) * math.cos(j * t) for t in ths) * (1 if j == 0 else 2) / n for j in range(k + 1)]


OUT_LP = _smooth_outline()


def out_r_smooth(th):
    return sum(a * math.cos(j * th) for j, a in enumerate(OUT_LP))


def rim_xz(th):
    r = out_r(th)
    return Vector((r * math.sin(th), 0.0, r * math.cos(th)))


def rim_normal(th, e=0.004):
    t = rim_xz(th + e) - rim_xz(th - e)
    return Vector((-t.z, 0.0, t.x)).normalized()


def shell_base(th, rho):
    """Dorsal surface: height from the smooth envelope inside, from the true outline near the margin (so
    the orbit notches and the frontal projection do not crease the whole shell radially)."""
    p = rim_xz(th) * rho
    rs = rho * out_r(th) / out_r_smooth(th)
    rho = min(1.0, rs + (rho - rs) * smooth(0.8, 0.96, rho))
    body = 1 - min(1.0, rho / SHOULDER) ** 2.2
    p.y = EDGE_Y + (DOME_TOP - EDGE_Y) * ((1 - FLANGE_H) * body + FLANGE_H * min(1.0, (1 - rho) / (1 - SHOULDER)))
    return p


def _seg_dist(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)


def relief(th, rho, x, z):
    """Offset along the normal (swollen regions, shallow grooves, growth ridges) and groove amount 0..1."""
    ax = abs(x)
    d = sum(h * math.exp(-((ax - cx) / sx) ** 2 - ((z - cz) / sz) ** 2) for cx, cz, sx, sz, h in LOBES)
    cut, cav = 0.0, 0.0
    for pts, w, depth in GROOVES:
        dist = min(_seg_dist(ax, z, pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        e = math.exp(-(dist / w) ** 2)
        cut = max(cut, depth * e)
        cav = max(cav, e * min(1.0, depth / 0.1))
    fade = 1 - smooth(0.8, 0.94, rho)
    d = (d - cut) * fade
    front = smooth(0.35, 0.95, abs(th))  # ridges fade out towards the granular front
    d += sum(0.08 * front * math.exp(-((rho - r) / 0.017) ** 2) for r in GROWTH)
    return d, cav * fade


def rho_in(th):
    """Inner edge of the shell: a square of half SHELL_IN about the spire axis."""
    return SHELL_IN / max(abs(math.sin(th)), abs(math.cos(th))) / out_r(th)


def shell_point(th, rho):
    p = shell_base(th, rho)
    e = 1e-3
    n = (shell_base(th + e, rho) - shell_base(th - e, rho)).cross(shell_base(th, rho + e) - shell_base(th, rho - e))
    if n.y < 0:
        n = -n
    n.normalize()
    d, cav = relief(th, rho, p.x, p.z)
    return p + n * d, n, cav


def _arc_columns(nh):
    """Angles for 2*nh columns at equal arc length round the rim, mirror symmetric."""
    k = 2000
    ts = [PI * i / k for i in range(k + 1)]
    s = [0.0]
    for i in range(1, k + 1):
        s.append(s[-1] + (rim_xz(ts[i]) - rim_xz(ts[i - 1])).length)
    right = []
    j = 0
    for c in range(nh + 1):
        target = s[-1] * c / nh
        while j < k - 1 and s[j + 1] < target:
            j += 1
        right.append(lerp(ts[j], ts[j + 1], (target - s[j]) / max(1e-9, s[j + 1] - s[j])))
    right[0], right[-1] = 0.0, PI
    return [-t for t in reversed(right[1:-1])] + right, s[-1] * 2


def _u_rows(n):
    """Rows u in [0, 1] (inner edge to the shoulder) at roughly equal spacing along the side meridian."""
    k = 600
    r0 = rho_in(PI / 2)
    us = [i / k for i in range(k + 1)]
    s = [0.0]
    for i in range(1, k + 1):
        a, b = r0 + (SHOULDER - r0) * us[i - 1], r0 + (SHOULDER - r0) * us[i]
        s.append(s[-1] + (shell_base(PI / 2, b) - shell_base(PI / 2, a)).length)
    rows = []
    j = 0
    for c in range(n + 1):
        target = s[-1] * c / n
        while j < k - 1 and s[j + 1] < target:
            j += 1
        rows.append(lerp(us[j], us[j + 1], (target - s[j]) / max(1e-9, s[j + 1] - s[j])))
    return rows


def lens_tooth(g, base, d, length, width, thick, curl=0.0, gold=0.22, K=10, back=1.8):
    """Flat crab-margin tooth: lens section in the plane of the margin, tapering to a gold tip."""
    up = Vector((0, 1, 0))
    fwd = Vector((0, 0, 1))
    ctrl = [base - Vector((d.x, 0, d.z)).normalized() * back, base + d * length * 0.35,
            base + d * length * 0.72 + fwd * curl * 0.5, base + d * length + fwd * curl]
    path = resample(bezier(ctrl, 40), K)
    i0 = 1  # path index nearest the rim, where the taper starts
    frames = []
    for k in range(K):
        t = (path[min(k + 1, K - 1)] - path[max(k - 1, 0)]).normalized()
        N = up.cross(t).normalized()
        frames.append((N, t.cross(N).normalized()))
    sec = ((1.0, 0.0), (0.62, 0.72), (0.0, 1.0), (-0.62, 0.72), (-1.0, 0.0), (-0.62, -0.72), (0.0, -1.0), (0.62, -0.72))

    def section(k, m):
        s = max(0.0, (k - i0) / (K - 1 - i0))
        hw = width / 2 * (1 - s)
        ht = thick / 2 * (1 - s) ** 0.8
        return sec[m][0] * hw, sec[m][1] * ht

    sweep(g, path, frames, section, 8, lambda k, m: GOLD if (k + 0.5) / (K - 1) > 1 - gold else NACRE, tip=True)


def build_dome(g: Geo):
    """The carapace: nacre shell with its regions, rolled margin, flat underside, teeth and horns."""
    ths, perim = _arc_columns(120)
    NT = len(ths)
    r0s = [rho_in(th) for th in ths]
    rows = []
    specs = [(u, None) for u in _u_rows(38)] + [(None, r) for r in (0.962, 0.981, 1.0)]  # body to the shoulder, then the flange
    for u, fixed in specs:
        row = []
        for th, r0 in zip(ths, r0s):
            p, _, cav = shell_point(th, fixed if fixed is not None else r0 + (SHOULDER - r0) * u)
            row.append(g.vert(p))
            if cav > 0.02:
                g.shade[row[-1]] = 1 - 0.24 * min(1.0, cav)  # grooves: a gentle cavity darkening in the AO
        rows.append(row)
    rims = [(rim_xz(th), rim_normal(th)) for th in ths]
    for adeg in (95, 45, 0, -45, -90):
        a = math.radians(adeg)
        rows.append([g.vert(p + n * (0.3 * BEAD_R + BEAD_R * math.cos(a)) + Vector((0, RIM_Y + BEAD_R * math.sin(a), 0)))
                     for p, n in rims])
    rows.append([g.vert(p - n * 1.3 + Vector((0, RIM_Y - BEAD_R - 0.5, 0))) for p, n in rims])
    rows.append([g.vert(p - n * 3.0 + Vector((0, DOME_Y0, 0))) for p, n in rims])
    # explicit UVs: u along the rim (wall density at 70% of the rim), v along the meridian
    wrap = round(perim * 0.7 * WALL_U)
    cum = [0.0]
    for j in range(1, NT):
        cum.append(cum[-1] + (rims[j][0] - rims[j - 1][0]).length)
    th_u = [c / perim * wrap for c in cum] + [float(wrap)]
    acc = [[0.0] * NT]
    for r in range(1, len(rows)):
        acc.append([acc[-1][j] + (g.v[rows[r][j]] - g.v[rows[r - 1][j]]).length for j in range(NT)])
    f0 = len(g.f)
    lip = range(len(specs) + 1, len(specs) + 3)  # bead rows 45 -> 0 -> -45 degrees: the gold outer lip
    for r in range(len(rows) - 1):
        for j in range(NT):
            j2 = (j + 1) % NT
            q = [rows[r][j], rows[r][j2], rows[r + 1][j2], rows[r + 1][j]]
            uv = [(th_u[j], acc[r][j] * WALL_V), (th_u[j + 1], acc[r][j2] * WALL_V),
                  (th_u[j + 1], acc[r + 1][j2] * WALL_V), (th_u[j], acc[r + 1][j] * WALL_V)]
            g.face(q, GOLD if r in lip else NACRE, EXPLICIT, None, uv)
    n = newell([g.v[i] for i in g.f[f0][0]])
    if n.y < 0:  # make the dorsal surface face up
        for f in g.f[f0:]:
            f[0] = list(reversed(f[0]))
            f[4] = list(reversed(f[4]))
    g.face_dir(rows[0], NACRE, (0, 1, 0), mode=EXPLICIT, uv=[(0.0, 0.0)] * NT)
    g.face_dir(rows[-1], NACRE, (0, -1, 0), mode=EXPLICIT, uv=[(0.0, 0.0)] * NT)
    # margin teeth: rostrum pair, inner orbital teeth, five anterolateral teeth growing to the horn
    rim_y = Vector((0, RIM_Y, 0))
    for s in (-1, 1):
        th = s * math.atan2(1.75, 26.4)
        lens_tooth(g, rim_xz(th) + rim_y, Vector((s * 0.16, -0.04, 1.0)).normalized(), 2.4, 1.9, 0.7, back=1.2)
        th = s * math.atan2(11.0, 24.8)
        lens_tooth(g, rim_xz(th) + rim_y, Vector((s * 0.3, 0.05, 1.0)).normalized(), 1.6, 1.8, 0.65, back=1.2)
        # arc length from the outer orbital corner to the widest point
        ta, tb = math.atan2(14.6, 23.7), math.atan2(30.0, 5.5)
        k = 400
        ts = [ta + (tb - ta) * i / k for i in range(k + 1)]
        acc_s = [0.0]
        for i in range(1, k + 1):
            acc_s.append(acc_s[-1] + (rim_xz(ts[i]) - rim_xz(ts[i - 1])).length)
        teeth = [(0.03, 2.6, 2.7, 0.8, 22), (0.21, 3.2, 3.2, 0.9, 24), (0.4, 3.8, 3.6, 1.0, 24), (0.59, 4.4, 3.9, 1.1, 22),
                 (0.78, 5.0, 4.2, 1.25, 20), (1.0, 7.0, 4.4, 3.0, 10)]  # (arc fraction, length, base width, thickness, lean)
        for frac, length, width, thick, lean in teeth:
            i = min(k, bisect.bisect_left(acc_s, acc_s[-1] * frac))
            th = s * ts[i]
            nrm = rim_normal(th)
            phi = math.atan2(nrm.x, nrm.z) - s * math.radians(lean)  # lean forward of the margin normal
            d = Vector((math.sin(phi), 0.21 if length < 5 else 0.27, math.cos(phi))).normalized()
            lens_tooth(g, rim_xz(th) + rim_y + nrm * 0.15 + Vector((0, 0.15, 0)), d, length, width, thick,
                       curl=0.5 if length > 5 else 0.18 * length, gold=0.2 if length > 5 else 0.24, K=14 if length > 5 else 10)
    # granules scattered along the frontal and hepatic margin, thinning out inwards
    rng = random.Random(7)
    placed = []
    tries = 0
    while len(placed) < 96 and tries < 6000:
        tries += 1
        th = rng.uniform(-0.98, 0.98)
        rho = 0.966 - 0.11 * rng.random() ** 1.4 * (0.7 + 0.3 * abs(th))
        p, nrm, _ = shell_point(th, rho)
        if any((p - q).length < 0.95 for q in placed):
            continue
        placed.append(p)
        rg = rng.uniform(0.24, 0.4) * (0.7 + 3.0 * (rho - 0.86))
        M = T(*p) @ Vector((0, 1, 0)).rotation_difference(nrm).to_matrix().to_4x4()
        lathe(g, [(rg, -0.2), (rg * 0.72, 0.07), (0.0, 0.17)], 5, NACRE, a0=rng.uniform(0, 1), M=M)


def spire_stage(g):
    """Square stage on the carapace crest broaching to an octagon; corner pinnacles over stepped buttresses."""
    A = STAGE_A
    c = 0.1
    sq = [(1 - c, 1), (1, 1 - c), (1, -(1 - c)), (1 - c, -1), (-(1 - c), -1), (-1, -(1 - c)), (-1, 1 - c), (-(1 - c), 1)]
    lathe(g, [(0, 39.5), (A + 0.9, 39.5), (A + 0.9, 46.4), (A + 0.35, 47.2), (A + 0.35, 47.6), (0, 47.6)], 8, DARK, ring=sq,
          mode=PLANAR)
    lathe(g, [(0, 47.5), (A, 47.5), (A, 55.0), (0, 55.0)], 8, LIME, ring=sq, mode=PLANAR)
    lathe(g, [(A - 0.3, 54.3), (A + 0.18, 54.3), (A + 0.18, 54.62), (A - 0.3, 54.62)], 8, GOLD, ring=sq, loop=True, mode=PLANAR)
    lathe(g, [(A - 0.3, 55.0), (A + 0.35, 55.0), (A + 0.75, 55.45), (A + 0.75, 55.9), (A - 0.3, 55.9)], 8, DARK, ring=sq, loop=True,
          mode=PLANAR)
    for k in range(4):  # a lancet on each face, the claw shield on the front
        a = TAU * k / 4
        M = T(*polar(0, 0, A, a, 0.0)) @ RY(a)
        if k == 0:
            shield_panel(g, M @ T(0, 51.0, 0), w=3.2, h=4.0, depth=0.3)
        else:
            window(g, M @ T(0, 48.8, 0), w=2.2, h=4.8, frame=0.38, depth=0.45)
        for sx in (-1, 1):  # corner quoin strips
            box(g, (sx * (A - 0.45), 51.3, 0.06), (0.95, 7.6, 0.24), DARK, ch=0.06, M=M)
    # broach: square (half A - 0.3) at 55.9 to an octagon (apothem 5.6) at 59.2
    y0, y1, ap = 55.9, 59.2, 5.6
    ro = ap / math.cos(PI / 8)
    O = [g.vert(polar(0, 0, ro, PI / 8 + k * PI / 4, y1)) for k in range(8)]
    a = A - 0.3
    C = [g.vert(Vector((sx * a, y0, sz * a))) for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
    ctr = (0, (y0 + y1) / 2, 0)
    for k in range(4):  # side k between corners k-1 and k; octagon flat 2k-1..2k; corner triangle at C[k]
        g.face_out([C[k - 1], C[k], O[2 * k], O[2 * k - 1]], LIME, ctr)
        g.face_out([C[k], O[2 * k + 1], O[2 * k]], DARK, ctr)
    oct8 = poly_ring(8, 1, a0=PI / 8)
    lathe(g, [(ro, 59.2), (ro, 61.4), (0, 61.4)], 8, LIME, ring=oct8, mode=PLANAR)
    lathe(g, chamfer_poly([(ro - 0.4, 60.6), (ro + 0.55, 60.6), (ro + 0.55, 61.9), (ro - 0.4, 61.9)], 0.15), 8, GOLD, ring=oct8,
          loop=True, mode=PLANAR)
    for k in range(4):  # slits on the diagonal faces of the drum
        a = PI / 4 + k * PI / 2
        slit(g, T(*polar(0, 0, ap - 0.02, a, 59.8)) @ RY(a), h=1.0, w=0.3, frame=False, cross=False)
    # corner pinnacles over stepped diagonal buttresses that run down onto the shell
    for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        cx, cz = sx * (A - 0.55), sz * (A - 0.55)
        lathe(g, [(0, 55.9), (1.25, 55.9), (1.25, 59.6), (0, 59.6)], 4, LIME, cx, cz, a0=PI / 4, mode=PLANAR)
        lathe(g, chamfer_poly([(1.0, 59.6), (1.5, 59.6), (1.5, 60.0), (1.0, 60.0)], 0.08), 4, DARK, cx, cz, a0=PI / 4, loop=True,
              mode=PLANAR)
        lathe(g, [(1.3, 60.0), (0.0, 63.4)], 4, SLATE, cx, cz, a0=PI / 4, mode=PLANAR)
        finial(g, cx, cz, 63.1, s=0.42, socket=False, n=8)
        a = math.atan2(sx, sz)
        foot = shell_point(a, (A * math.sqrt(2) + 4.6) / out_r(a))[0]
        buttress(g, T(sx * (A - 0.2), 0, sz * (A - 0.2)) @ RY(a), 1.7,
                 [(4.6, foot.y - 2.0, 46.6), (3.0, 46.6, 50.8), (1.5, 50.8, 54.4)], mat=LIME)
        lathe(g, [(0, 46.6 + 0.0), (0.55, 46.6), (0.42, 47.4), (0.0, 48.2)], 6, GOLD, mode=PLANAR,
              M=T(sx * (A - 0.2), 0, sz * (A - 0.2)) @ RY(a) @ T(0, 0, 4.15))


def wall_run(g, M, x0, x1, *, merlons=False, cornice=True, corbel_step=1.6):
    """Cornice (gold band, corbels, moulded slab) along a hall wall face at z=0 of M."""
    if cornice:
        string_course(g, M, x0, x1, 20.5, proj=0.2, h=0.32, mat=GOLD)
        n = max(1, round((x1 - x0) / corbel_step))
        for k in range(n):
            corbel(g, M @ T(x0 + (x1 - x0) * (k + 0.5) / n, 21.35, 0), w=0.5, h=0.85, d=0.55)
        prism(g, chamfer_poly([(-0.3, 21.3), (0.78, 21.3), (0.78, 22.0), (-0.3, 22.0)], 0.12), x0, x1, "x", DARK, M=M)
    if merlons:
        prism(g, chamfer_poly([(-0.6, 22.0), (0.55, 22.0), (0.55, 23.15), (-0.6, 23.15)], 0.08), x0, x1, "x", LIME, M=M)
        merlon_row(g, x0, x1, 23.15, 1.35, 1.0, M=M @ T(0, 0, 0.05), w=1.4, gap=1.0)


def octa_turret(g, cx, cz, r, y_top, spire_h, merl=True):
    """Octagonal corner turret with string courses and a slate spirelet."""
    n = 8
    a0 = PI / 8
    lathe(g, [(0, 0), (r + 0.45, 0), (r + 0.45, 1.5), (r + 0.1, 1.85), (0, 1.85)], n, DARK, cx, cz, a0=a0, mode=PLANAR)
    lathe(g, [(0, 1.8), (r, 1.8), (r, y_top), (0, y_top)], n, LIME, cx, cz, a0=a0, mode=PLANAR)
    for y in (7.2, 14.0):
        lathe(g, chamfer_poly([(r - 0.4, y), (r + 0.3, y), (r + 0.3, y + 0.5), (r - 0.4, y + 0.5)], 0.12), n, DARK, cx, cz,
              a0=a0, loop=True, mode=PLANAR)
    lathe(g, chamfer_poly([(r - 0.4, 20.5), (r + 0.2, 20.5), (r + 0.2, 20.82), (r - 0.4, 20.82)], 0.06), n, GOLD, cx, cz,
          a0=a0, loop=True, mode=PLANAR)
    yc = y_top
    lathe(g, [(r - 0.5, yc - 1.6), (r, yc - 1.6), (r + 0.55, yc - 0.6), (r + 0.85, yc), (r + 0.85, yc + 0.35), (r - 0.5, yc + 0.35)], n,
          DARK, cx, cz, a0=a0, loop=True, mode=PLANAR)
    yb = yc + 0.35
    if merl:
        for k in range(n):
            a = TAU * k / n
            Mf = T(*polar(cx, cz, (r + 0.85) * math.cos(PI / 8) - 0.35, a, yb)) @ RY(a)
            box(g, (0, 0.75, 0), (1.25, 1.5, 0.7), LIME, ch=0.07, M=Mf)
            box(g, (0, 1.6, 0), (1.4, 0.2, 0.85), DARK, ch=0.05, M=Mf)
    lathe(g, [(0, yb), (r - 0.3, yb), (r - 0.3, yb + 2.2), (0, yb + 2.2)], n, LIME, cx, cz, a0=a0, mode=PLANAR)
    ye = yb + 2.2
    prof = [(r - 0.4, ye - 0.3), (r + 0.75, ye - 0.3), (r + 0.8, ye)]
    k = 10
    for i in range(k + 1):
        s = i / k
        prof.append(((r + 0.8) * (1 - s), ye + spire_h * (0.18 * s + 0.82 * s ** 1.45)))
    lathe(g, prof, n, SLATE, cx, cz, a0=a0, mats=[SLATE, GOLD] + [SLATE] * (k + 1), mode=PLANAR)
    finial(g, cx, cz, ye + spire_h - 0.3, s=0.75, socket=False, n=8)
    for a, y in ((0.0, 10.5), (PI / 2, 17.0), (-PI / 2, 17.0), (PI, 10.5)):
        slit(g, T(*polar(cx, cz, r * math.cos(PI / 8) - 0.02, a, y)) @ RY(a), h=2.2, w=0.32)


def spire_r(y):
    """Circumradius of the octagonal spire at height y (10 wide at 54, 6 wide at 140)."""
    w = 10.0 - 4.0 * (y - 54.0) / (140.0 - 54.0)
    return w / 2 / math.cos(PI / 8)


def build_keep() -> Piece:
    pc = Piece("TC_Keep", cell=3.0, ao_dist=7.0)
    g = pc.g
    rng = random.Random(1)
    # --- hall masses: nave (34 x 70) and transept (50 x 24)
    box(g, (0, 11.0, 0), (34.0, 22.0, 70.0), LIME)
    box(g, (0, 11.0, 0), (50.0, 22.0, 24.0), LIME)
    for sx, sz, d in ((34.0, 70.0, 0.0), (50.0, 24.0, 0.0)):
        box(g, (0, 0.8, 0), (sx + 1.2, 1.6, sz + 1.2), DARK, ch=0.25)
        box(g, (0, 7.45, 0), (sx + 0.6, 0.5, sz + 0.6), DARK, ch=0.12)
    # wall faces: (M, x0, x1) in each face frame, plus buttress positions and windows
    faces = []
    # nave sides x = +-17: two runs each, z in [12, 35] and [-35, -12]
    for s in (-1, 1):
        M = T(s * 17.0, 0, 0) @ RY(s * PI / 2)  # local x = -s*z
        for zr in ((12.0, 35.0), (-35.0, -12.0)):
            x0, x1 = sorted((-s * zr[0], -s * zr[1]))
            faces.append((M, x0, x1, "nave", s, zr))
    # transept ends x = +-25, z in [-12, 12]
    for s in (-1, 1):
        M = T(s * 25.0, 0, 0) @ RY(s * PI / 2)
        faces.append((M, -12.0, 12.0, "tend", s, None))
    # transept front/back faces z = +-12, x in [17, 25] and [-25, -17]
    for s in (-1, 1):
        M = T(0, 0, s * 12.0) @ RY(0 if s > 0 else PI)
        for x0, x1 in ((17.0, 25.0), (-25.0, -17.0)):
            faces.append((M, x0, x1, "tface", s, None))
    for M, x0, x1, kind, s, extra in faces:
        wall_run(g, M, x0, x1, merlons=False)
        if kind == "nave":
            # buttresses at |z| = 18.0, 25.0, windows between
            zr = extra
            sign = 1 if zr[0] > 0 else -1
            for zb in (18.0, 25.0):
                xl = -s * sign * zb
                buttress(g, M @ T(xl, 0, 0), 2.0, [(3.0, 1.6, 9.0), (2.1, 9.0, 15.5), (1.2, 15.5, 20.2)])
            for zw in (15.0, 21.5, 28.5):
                window(g, M @ T(-s * sign * zw, 7.8, 0), w=3.0, h=12.0, frame=0.45, depth=0.55)
        elif kind == "tend":
            buttress(g, M @ T(0.0, 0, 0), 2.2, [(3.2, 1.6, 9.0), (2.2, 9.0, 15.5), (1.3, 15.5, 20.2)])
            for xw in (-6.0, 6.0):
                window(g, M @ T(xw, 7.8, 0), w=3.0, h=12.0, frame=0.45, depth=0.55)
        else:
            window(g, M @ T((x0 + x1) / 2, 7.8, 0), w=3.0, h=12.0, frame=0.45, depth=0.55)
    # transept corner buttresses (diagonal) and nave/transept re-entrant quoins
    for sx in (-1, 1):
        for sz in (-1, 1):
            a = math.atan2(sx, sz)
            buttress(g, T(sx * 25.0, 0, sz * 12.0) @ RY(a), 2.2, [(2.6, 1.6, 9.0), (1.8, 9.0, 15.5), (1.1, 15.5, 20.2)])
            quoins(g, sx * 25.0, sz * 12.0, sx, sz, 1.6, 20.4, rng)
    # terraces between the facades and the carapace, with crenellated parapets on the nave sides (the
    # front ones start clear of the carapace's anterolateral teeth)
    for sz in (-1, 1):
        z0, z1 = sorted((sz * 19.0, sz * 34.3))
        box(g, (0, 22.08, (z0 + z1) / 2), (33.0, 0.16, z1 - z0), DARK)
        for s in (-1, 1):
            M = T(s * 17.0, 0, 0) @ RY(s * PI / 2)
            xa, xb = sorted((-s * sz * (27.6 if sz > 0 else 23.2), -s * sz * 33.8))
            prism(g, chamfer_poly([(-0.6, 22.0), (0.55, 22.0), (0.55, 23.15), (-0.6, 23.15)], 0.08), xa, xb, "x", LIME, M=M)
            merlon_row(g, xa, xb, 23.15, 1.35, 1.0, M=M @ T(0, 0, 0.05), w=1.4, gap=1.0)
    # --- west front (z = +35) and east end (z = -35)
    for sz in (1, -1):
        yaw = 0.0 if sz > 0 else PI
        Mf = T(0, 0, sz * 35.0) @ RY(yaw)
        # cornice along the front between the corner turrets, behind the gable foot
        for x0, x1 in (((-14.2, -6.1), (6.1, 14.2)) if sz > 0 else ((-14.2, 14.2),)):
            string_course(g, Mf, x0, x1, 20.5, proj=0.2, h=0.32, mat=GOLD)
            prism(g, chamfer_poly([(-0.3, 21.3), (0.78, 21.3), (0.78, 22.0), (-0.3, 22.0)], 0.12), x0, x1, "x", DARK, M=Mf)
        # gable screen with coping, crockets and a finial
        gpts = [(-14.3, 21.9), (14.3, 21.9), (0.0, 34.0)]
        prism(g, gpts, -1.0, 0.0, "z", LIME, M=Mf)
        for side in (-1, 1):
            p0 = Vector((side * 14.6, 21.75, 0))
            p1 = Vector((0.0, 34.4, 0))
            d = p1 - p0
            ang = math.atan2(d.y, d.x)
            mk = g.mark()
            box(g, (0, 0, -0.45), (d.length + 0.6, 0.62, 1.5), DARK, ch=0.1)
            g.place(Mf @ T(*((p0 + p1) / 2)) @ RZ(ang), mk)
            mk = g.mark()
            box(g, (0, -0.42, -0.45), (d.length, 0.18, 1.62), GOLD)
            g.place(Mf @ T(*((p0 + p1) / 2)) @ RZ(ang), mk)
            for k in range(1, 6):
                t = k / 6.3
                c = p0 + d * t
                lathe(g, [(0, 0.0), (0.32, 0.05), (0.38, 0.35), (0.2, 0.75), (0, 0.95)], 6, GOLD, mode=PLANAR,
                      M=Mf @ T(c.x, c.y + 0.3, -0.45))
        mk = g.mark()
        finial(g, 0.0, 0.0, 34.1, s=1.3, socket=False)
        g.place(Mf @ T(0, 0, -0.45), mk)
        # corner turrets
        for sx in (-1, 1):
            octa_turret(g, sx * 17.0, sz * 35.0, 3.1, 27.5, 9.5)
        if sz > 0:
            # portal: porch with three orders, door, pinnacled buttresses, rose window, lancets
            aD, RD = 3.0, 4.4
            hsD = 10.0 - arch_h(aD, RD)
            arch_wall(g, -6.3, 6.3, 0.0, 12.9, 35.0, 37.6, 0.0, aD + 1.6, hsD, RD + 1.6, "z", LIME, cell=1.6, n=10)
            for a_in, z1 in ((aD + 0.8, 36.9), (aD, 36.2)):
                arch_ring(g, a_in, hsD, RD + a_in - aD, 0.8, 35.0, z1, DARK, n=10, yb=0.0)
            arch_ring(g, aD + 1.6, hsD, RD + 1.6, 0.85, 37.55, 37.95, DARK, n=10, blocks=11, step=0.15)
            # porch gable (wimperg) under the rose window
            prism(g, [(-6.6, 12.8), (6.6, 12.8), (0.0, 16.0)], 35.0, 37.4, "z", LIME)
            for side in (-1, 1):
                p0 = Vector((side * 6.9, 12.68, 0))
                p1 = Vector((0.0, 16.3, 0))
                d = p1 - p0
                mk = g.mark()
                box(g, (0, 0, 0), (d.length + 0.4, 0.45, 2.7), DARK, ch=0.08)
                g.place(T(*((p0 + p1) / 2 + Vector((0, 0, 36.25)))) @ RZ(math.atan2(d.y, d.x)), mk)
                for k in (1, 2, 3):
                    c = p0 + d * (k / 4.0)
                    lathe(g, [(0, 0.0), (0.26, 0.05), (0.3, 0.3), (0.16, 0.6), (0, 0.76)], 6, GOLD, mode=PLANAR,
                          M=T(c.x, c.y + 0.22, 36.25))
            box(g, (0, 12.75, 36.3), (13.2, 0.4, 2.9), DARK, ch=0.1)
            shield_panel(g, T(0, 14.0, 37.4), w=1.5, h=1.7, depth=0.18)
            # the great double door
            for side in (-1, 1):
                pts = [(0.0, 0.0), (side * 2.97, 0.0)]
                for i in range(10, -1, -1):
                    x = side * (2.97 * i / 10)
                    pts.append((x, arch_y(abs(x), aD, hsD, RD) - 0.02))
                prism(g, pts, 35.1, 35.5, "z", WOOD)
                for y in (1.5, 4.4, 7.3):
                    xe = 2.6
                    box(g, (side * (xe / 2 + 0.2), y, 35.55), (xe, 0.34, 0.1), IRON)
                    lathe(g, [(0.12, -0.05), (0.32, -0.05), (0.32, 0.05), (0.12, 0.05)], 8, IRON, loop=True, mode=PLANAR,
                          M=T(side * 2.75, y, 35.62) @ RX(PI / 2))
                    for k in range(4):
                        box(g, (side * (0.5 + 0.6 * k), y, 35.6), (0.14, 0.14, 0.08), IRON)
                for k in range(1, 5):
                    x = side * 0.6 * k
                    top = arch_y(abs(x), aD, hsD, RD) - 0.3
                    box(g, (x, top / 2, 35.5), (0.06, top - 0.2, 0.04), IRON)
                lathe(g, [(0.0, -0.06), (0.32, -0.06), (0.32, 0.06), (0.0, 0.06)], 10, IRON, mode=PLANAR,
                      M=T(side * 0.55, 4.9, 35.55) @ RX(PI / 2))
                lathe(g, [(0.36, -0.07), (0.5, -0.07), (0.5, 0.07), (0.36, 0.07)], 12, IRON, loop=True, mode=PLANAR,
                      M=T(side * 0.55, 4.45, 35.62))
            # flanking pinnacle buttresses
            for side in (-1, 1):
                buttress(g, Mf @ T(side * 7.6, 0, 0), 1.6, [(3.0, 1.6, 10.0), (2.2, 10.0, 17.5)])
                cx = side * 7.6
                lathe(g, [(0, 17.6), (1.0, 17.6), (1.0, 22.5), (0, 22.5)], 8, LIME, cx, 36.3, a0=PI / 8, mode=PLANAR)
                lathe(g, chamfer_poly([(0.6, 22.5), (1.25, 22.5), (1.25, 22.9), (0.6, 22.9)], 0.08), 8, DARK, cx, 36.3, a0=PI / 8,
                      loop=True, mode=PLANAR)
                lathe(g, [(0, 22.9), (1.05, 22.9), (0.0, 27.5)], 8, LIME, cx, 36.3, a0=PI / 8, mode=PLANAR)
                finial(g, cx, 36.3, 27.3, s=0.45, socket=False, n=8)
            # rose window
            rose_window(g, 0.0, 22.2, 35.0, Rg=4.4)
            for side in (-1, 1):
                window(g, Mf @ T(side * 11.0, 6.5, 0), w=3.0, h=12.0, frame=0.45, depth=0.55)
            pc.anchors["door"] = dict(centre=[0.0, 0.0, 35.5], width=6.0, height=10.0)
            pc.anchors["roseWindow"] = dict(centre=[0.0, 22.2, 35.4], radius=5.55)
        else:
            for side, hh in ((-1, 12.0), (0, 14.5), (1, 12.0)):
                window(g, Mf @ T(side * 5.0, 6.5, 0), w=3.0, h=hh, frame=0.45, depth=0.55)
            for side in (-1, 1):
                buttress(g, Mf @ T(side * 9.2, 0, 0), 1.8, [(2.8, 1.6, 10.0), (1.9, 10.0, 17.5), (1.1, 17.5, 20.2)])
                window(g, Mf @ T(side * 12.6, 6.5, 0), w=2.4, h=9.0, frame=0.4, depth=0.5)
    # --- the carapace and the spire stage on its cardiac region
    build_dome(g)
    spire_stage(g)
    # --- spire: octagonal shaft with gold bands, balconies, slits, crown cup and claws
    prof = [(0.0, SHAFT_Y0 - 0.6)] + [(spire_r(y), y) for y in (SHAFT_Y0 - 0.6, 140.0)] + [(0.0, 140.0)]
    with notess(g):
        lathe(g, prof, 8, LIME, mode=PLANAR, ring=poly_ring(8, 2, a0=PI / 8), seg_len=2.6)
    for y in (78.0, 98.0, 118.0):
        r = spire_r(y)
        lathe(g, chamfer_poly([(r - 0.4, y), (r + 0.32, y), (r + 0.32, y + 0.9), (r - 0.4, y + 0.9)], 0.12), 8, GOLD, a0=PI / 8,
              loop=True, mode=PLANAR)
        lathe(g, chamfer_poly([(r - 0.4, y - 0.45), (r + 0.18, y - 0.45), (r + 0.18, y), (r - 0.4, y)], 0.08), 8, DARK, a0=PI / 8,
              loop=True, mode=PLANAR)
    for y0 in (SHAFT_Y0 + 0.6, 80.0, 100.0, 120.0):
        for k in range(8):  # corner ribs
            a = PI / 8 + TAU * k / 8
            y1 = min(y0 + 17.4, 129.0)
            p0 = polar(0, 0, spire_r(y0 + 0.6) + 0.1, a, y0 + 0.6)
            p1 = polar(0, 0, spire_r(y1) + 0.1, a, y1)
            path = [p0, (p0 + p1) / 2, p1]
            out = Vector((math.sin(a), 0, math.cos(a)))
            tang = Vector((math.cos(a), 0, -math.sin(a)))
            sweep(g, path, [(out, tang)] * 3, lambda k_, m: ((0.24, 0.24, -0.24, -0.24)[m], (-0.24, 0.24, 0.24, -0.24)[m]), 4,
                  lambda k_, m: DARK)
    for yb in (88.0, 108.0):
        balcony(g, yb)
    for y, angs in ((68.0, (0, 2, 4, 6)), (73.0, (1, 3, 5, 7)), (92.5, (0, 2, 4, 6)), (104.0, (1, 3, 5, 7)), (113.0, (0, 2, 4, 6)),
                    (124.0, (1, 3, 5, 7))):
        for k in angs:
            a = TAU * k / 8
            r = spire_r(y) * math.cos(PI / 8)
            slit(g, T(*polar(0, 0, r - 0.02, a, y)) @ RY(a), h=2.8, w=0.42)
    # crown cup flaring out to the claw ring
    cup = [(spire_r(127.0) - 0.3, 127.0), (spire_r(127.0) + 0.35, 127.0), (4.3, 129.6), (5.3, 131.8), (6.3, 133.6), (7.1, 135.0),
           (7.45, 135.6), (7.45, 136.2), (4.0, 136.2)]
    lathe(g, cup, 32, DARK, loop=True, rref=6.0)
    for y, r in ((128.6, 4.0), (131.0, 5.0), (133.2, 6.1)):
        lathe(g, chamfer_poly([(r - 0.6, y), (r + 0.3, y), (r + 0.3, y + 0.5), (r - 0.6, y + 0.5)], 0.1), 32, DARK, loop=True, rref=6.0)
    lathe(g, chamfer_poly([(6.5, 135.5), (7.65, 135.5), (7.65, 136.5), (6.5, 136.5)], 0.12), 32, GOLD, loop=True, mode=PLANAR)
    lathe(g, chamfer_poly([(2.6, 139.3), (3.75, 139.3), (3.75, 140.0), (2.6, 140.0)], 0.1), 8, GOLD, a0=PI / 8, loop=True, mode=PLANAR)
    lathe(g, [(0.0, 139.95), (2.9, 139.95), (2.4, 140.25), (0.0, 140.25)], 16, GOLD, mode=PLANAR)
    for k in range(6):
        a = PI / 6 + TAU * k / 6
        out = Vector((math.sin(a), 0, math.cos(a)))
        up = Vector((0, 1, 0))
        P = lambda r, y: Vector((0, y, 0)) + out * r
        ctrl = [P(6.0, 135.4), P(7.6, 138.6), P(9.0, 142.4), P(8.9, 146.0), P(7.0, 148.9), P(4.6, 150.0)]
        side = out.cross(up).normalized()
        finger(g, ctrl, side, 1, width=lambda t: 1.75 * (1 - t) ** 0.7 + 0.08, depth=lambda t: 1.35 * (1 - t) ** 0.6 + 0.08,
               teeth=4, tooth=0.62, t_teeth=(0.22, 0.86), K=40, nsec=12, joints=(0.3,), gold_tip=0.14)
        lathe(g, chamfer_poly([(0.0, 134.6), (1.6, 134.6), (1.6, 136.2), (0.0, 136.2)], 0.15), 8, DARK, mode=PLANAR,
              M=T(*P(6.0, 0.0)))
        lathe(g, chamfer_poly([(1.0, 136.0), (1.75, 136.0), (1.75, 136.7), (1.0, 136.7)], 0.1), 10, GOLD, loop=True, mode=PLANAR,
              M=T(*P(6.05, 0.0)))
    pc.anchors.update(lantern=dict(centre=[0.0, 144.5, 0.0], diameter=8.0), spireTop=[0.0, 140.25, 0.0],
                      domeTop=[0.0, DOME_TOP, 0.0], hallRoofLine=DOME_Y0, clawTipHeight=150.0)
    return pc


def balcony(g, yb):
    r = spire_r(yb)
    ro = r + 1.9
    for k in range(16):
        a = TAU * k / 16 + PI / 16
        corbel(g, T(*polar(0, 0, r * math.cos(PI / 8) - 0.05, a, yb)) @ RY(a), w=0.5, h=1.5, d=1.6)
    lathe(g, chamfer_poly([(r - 0.3, yb), (ro, yb), (ro, yb + 0.45), (r - 0.3, yb + 0.45)], 0.1), 8, DARK, a0=PI / 8, loop=True,
          mode=PLANAR)
    for k in range(8):
        a = TAU * k / 8
        Mf = T(*polar(0, 0, ro * math.cos(PI / 8) - 0.2, a, yb + 0.45)) @ RY(a)
        side = 2 * ro * math.sin(PI / 8)
        box(g, (0, 0.5, 0), (side - 0.9, 1.0, 0.32), LIME, M=Mf)
        box(g, (0, 1.08, 0), (side - 0.7, 0.16, 0.44), GOLD, M=Mf)
    for k in range(8):
        a = PI / 8 + TAU * k / 8
        p = polar(0, 0, ro - 0.22, a, yb + 0.45)
        box(g, (p.x, p.y + 0.6, p.z), (0.5, 1.2, 0.5), DARK, ch=0.06)
        lathe(g, [(0, 0), (0.22, 0.05), (0.26, 0.24), (0.14, 0.46), (0, 0.56)], 6, GOLD, mode=PLANAR, M=T(p.x, p.y + 1.2, p.z))


def rose_window(g, x, y, z, Rg=4.55):
    M = T(x, y, z)
    gl = []
    n = 40
    for i in range(n):
        a = TAU * i / n
        gl.append((Rg * math.cos(a), Rg * math.sin(a)))
    ids = g.verts([M @ Vector((px, py, 0.06)) for px, py in gl])
    g.face_dir(ids, GLASS, (0, 0, 1))
    Mr = M @ RX(PI / 2)  # lathe axis (y) -> +z

    def ring(r0, r1, z0, z1, mat, seg=40):
        prof = chamfer_poly([(r0, z0), (r1, z0), (r1, z1), (r0, z1)], min(0.08, (r1 - r0) / 4))
        lathe(g, prof, seg, mat, loop=True, mode=PLANAR, M=Mr)

    ring(Rg - 0.1, Rg + 0.8, -0.3, 0.65, DARK)
    ring(Rg + 0.8, Rg + 1.15, -0.2, 0.42, DARK)
    ring(Rg - 0.25, Rg, 0.05, 0.4, GOLD)
    ring(1.35, 1.6, 0.05, 0.32, GOLD, seg=24)
    for k in range(12):
        a = TAU * k / 12 + PI / 12
        c = Vector((math.cos(a) * (1.6 + Rg) / 2, math.sin(a) * (1.6 + Rg) / 2, 0.18))  # spoke centre
        mk = g.mark()
        box(g, (0, 0, 0), (Rg - 1.6 + 0.1, 0.16, 0.24), GOLD)
        g.place(M @ T(*c) @ RZ(a), mk)
        a2 = a + PI / 12
        cc = Vector((math.cos(a2) * (Rg * 0.71), math.sin(a2) * (Rg * 0.71), 0))
        lathe(g, [(0.5, 0.05), (0.64, 0.05), (0.64, 0.32), (0.5, 0.32)], 12, GOLD, loop=True, mode=PLANAR, M=M @ T(*cc) @ RX(PI / 2))
    claw_emblem(g, M @ T(0, 0.05, 0.08), size=0.95, depth=0.22)
    for k in range(16):  # cusped outer edge of the frame
        a = TAU * k / 16
        c = Vector((math.cos(a) * (Rg + 1.0), math.sin(a) * (Rg + 1.0), 0.55))
        mk = g.mark()
        box(g, (0, 0, 0), (0.55, 0.4, 0.3), DARK, ch=0.06)
        g.place(M @ T(*c) @ RZ(a), mk)


# ============================================================================================
# Main
# ============================================================================================
BUILDERS = [
    ("TC_Keep", build_keep),
    ("TC_Lantern", build_lantern),
    ("TC_WardTower", build_ward_tower),
    ("TC_WardWall_12", build_ward_wall),
    ("TC_WardGate", build_ward_gate),
    ("TC_CityWall_12", build_city_wall),
    ("TC_CityTower", build_city_tower),
    ("TC_PincerGate", build_pincer_gate),
    ("TC_BridgeSpan", build_bridge),
    ("TC_Plinth", build_plinth),
]
BUDGET = {"TC_Keep": 120000, "TC_PincerGate": 40000, "TC_WardWall_12": 3000, "TC_CityWall_12": 3000,
          "TC_WardTower": 10000, "TC_CityTower": 10000}


def make_materials():
    for name, p in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*srgb(p["color"]), 1)
        b.inputs["Metallic"].default_value = p.get("metal", 0.0)
        b.inputs["Roughness"].default_value = p.get("rough", 0.5)
        if "emit" in p:
            b.inputs["Emission Color"].default_value = (*srgb(p["emit"]), 1)
            b.inputs["Emission Strength"].default_value = 1.0


def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.seed = 0
    sc.cycles.use_denoising = False
    sc.world = bpy.data.worlds.new("ao")
    make_materials()
    only = {s for s in args.only.split(",") if s}
    pieces = []
    for name, fn in BUILDERS:
        if only and name not in only:
            continue
        t = time.time()
        pc = fn()
        pc.to_object()
        tb = time.time() - t
        pc.bake_ao(args.samples)
        f = pc.facts()
        pieces.append(pc)
        print(f"TC_BUILD {name:16s} tris {f['triangles']:7d} dropped {pc.dropped:4d} build {tb:5.1f}s total {time.time() - t:5.1f}s",
              flush=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    for o in sc.objects:
        o.select_set(False)
    for pc in pieces:
        pc.holder["anchors"] = rnd(pc.anchors)
        pc.holder.select_set(True)
        pc.obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_extras=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_vertex_color="ACTIVE", export_animations=False, export_cameras=False,
        export_lights=False, export_attributes=False)
    print(f"TC_EXPORT {out} {out.stat().st_size} bytes in {time.time() - t0:.1f}s", flush=True)
    if args.json:
        doc = dict(
            file="public/models/world/tidecrown.glb",
            units="game units (1 = crab shell height); Y up; piece origin at the ground centre of its footprint; front +Z",
            uvDensity=dict(
                wall=dict(u=WALL_U, v=WALL_V, appliesTo=["TC_Limestone", "TC_LimestoneDark"],
                          measured="village.glb Wall_UnevenBrick_Straight / MI_UnevenBrick: u 0.500 along the wall, v 0.475 up "
                                   "(area-weighted kit: MI_Brick 0.448, MI_UnevenBrick 0.478)"),
                roof=dict(u=ROOF_U, v=ROOF_V, appliesTo=["TC_Slate"],
                          measured="village.glb Roof_Tower_RoundTiles / MI_RoundTiles: u 0.236 around the cone, v 0.212 up the "
                                   "slope (Roof_RoundTiles_6x6 0.269 / 0.240; area-weighted kit 0.230)"),
                note="UV units per world unit. v grows upwards (walls) and up the slope towards the apex (roofs); tile rows run "
                     "round cones. Other materials use the wall density."),
            budgets=BUDGET,
            pieces={pc.name: rnd(pc.facts()) for pc in pieces},
        )
        Path(args.json).write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
        print(f"TC_JSON {args.json}")
    if args.render:
        import importlib.util
        spec = importlib.util.spec_from_file_location("tc_render", Path(__file__).with_name("render_tidecrown.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.render_all(pieces, Path(args.render), args.kit_tex, args.views)


main()
