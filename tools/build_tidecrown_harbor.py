"""Tidecrown harbour kit: ships, piers, quay, crane and cargo, built procedurally (Blender headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --factory-startup \
        --python tools/build_tidecrown_harbor.py -- --out /tmp/tidecrown-harbor.raw.glb \
        [--pieces tools/tidecrown-harbor-pieces.json] [--render DIR]
    (tools/build_tidecrown_harbor.sh compresses into public/models/world/tidecrown-harbor.glb)

Every top-level node is one kit piece (src/world/kit.ts). Geometry is written in game axes
(x, y up, z = bow) and converted to Blender axes only when a mesh is created, so the glTF export
(+Y up) lands back in game axes. Units are game units (1 = crab shell height).

Materials carry names only (TC_*); the game assigns textures and tints. Wood UVs use the plank
density measured on village.glb (Floor_WoodDark / MI_WoodTrim): 0.4917 UV per unit, u along the
grain, and every plank strip starts at v = 0 and spans at most one Floor_WoodDark strip (0.24).
Sails (and the stern ensign) each own the 0..1 UV square for a crest. Ambient occlusion is ray
traced per vertex and stored in COLOR_0.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True, help="Output .glb (uncompressed)")
ap.add_argument("--pieces", default=None, help="Write piece bounds, triangles and anchors here")
ap.add_argument("--render", default=None, help="Render EEVEE previews into this folder")
ap.add_argument("--shots", default="", help="Comma list of preview shots (default all)")
ap.add_argument("--only", default="", help="Comma list of pieces to build (debug)")
ap.add_argument("--blend", default=None, help="Save the .blend for inspection")
args = ap.parse_args(argv)

PI = math.pi
D_WOOD = 0.4917  # UV per unit, village.glb Floor_WoodDark (MI_WoodTrim)
D_STONE = 0.5  # UV per unit, village.glb Floor_Brick / Wall_UnevenBrick
WOOD_STRIP = 0.24  # v height of one Floor_WoodDark strip in T_WoodTrim (v 0.31..0.55)

MATS = ["TC_Wood", "TC_WoodDark", "TC_Sail", "TC_Rope", "TC_Gold", "TC_Iron", "TC_PaintBlue", "TC_Limestone", "TC_LimestoneDark"]
MAT_LOOK = {
    "TC_Wood": dict(color="#7a4c2c", rough=0.7),
    "TC_WoodDark": dict(color="#432a1b", rough=0.7),
    "TC_Sail": dict(color="#f1e6c8", rough=0.85),
    "TC_Rope": dict(color="#b39462", rough=0.9),
    "TC_Gold": dict(color="#e0b043", rough=0.3, metal=1.0),
    "TC_Iron": dict(color="#3d4046", rough=0.5, metal=0.7),
    "TC_PaintBlue": dict(color="#1d5aa6", rough=0.45),
    "TC_Limestone": dict(color="#e8dfca", rough=0.85),
    "TC_LimestoneDark": dict(color="#b9ab8f", rough=0.9),
}
DENSITY = {m: D_WOOD for m in MATS} | {"TC_Limestone": D_STONE, "TC_LimestoneDark": D_STONE}
# Sharp-edge thresholds (degrees) per face class.
SHARP = {"flat": 38.0, "round": 75.0}


def srgb(hexstr: str) -> tuple[float, float, float]:
    h = hexstr.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # type: ignore


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def interp(table, x):
    """Piecewise linear over [(x, y), ...] sorted by x."""
    if x <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x <= x1:
            return lerp(y0, y1, (x - x0) / (x1 - x0))
    return table[-1][1]


def V(x, y, z) -> Vector:
    return Vector((x, y, z))


def T(x=0.0, y=0.0, z=0.0) -> Matrix:
    return Matrix.Translation((x, y, z))


def R(axis: str, deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, axis)


def S(x, y=None, z=None) -> Matrix:
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


def frame(p0: Vector, p1: Vector, up: Vector | None = None) -> Matrix:
    """Matrix whose +Y runs from p0 to p1 (length kept in the caller), origin p0."""
    d = (p1 - p0).normalized()
    up = up or (V(1, 0, 0) if abs(d.x) < 0.9 else V(0, 0, 1))
    x = up.cross(d)
    if x.length < 1e-6:
        x = V(0, 0, 1).cross(d)
    x.normalize()
    z = x.cross(d).normalized()
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = x[i], d[i], z[i], p0[i]
    return m


# ---------------------------------------------------------------------------------------------
# Geometry soup in game axes
# ---------------------------------------------------------------------------------------------
class Geo:
    def __init__(self):
        self.v: list[Vector] = []
        self.f: list[tuple] = []  # (indices, material, uvs | None, cls, grain | None)

    def face(self, pts, mat, uvs=None, cls="flat", grain=None, out=None):
        pts = [Vector(p) for p in pts]
        n = len(pts)
        nrm = Vector((0, 0, 0))
        for i in range(n):  # Newell normal
            a, b = pts[i], pts[(i + 1) % n]
            nrm += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if nrm.length < 1e-9:
            return
        if out is not None:
            o = out(sum(pts, Vector()) / n) if callable(out) else Vector(out)
            if nrm.dot(o) < 0:
                pts.reverse()
                if uvs is not None:
                    uvs = list(reversed(uvs))
        base = len(self.v)
        self.v.extend(pts)
        self.f.append((tuple(range(base, base + n)), mat, uvs, cls, grain))

    def extend(self, other: "Geo", m: Matrix | None = None):
        m = m or Matrix.Identity(4)
        flip = m.to_3x3().determinant() < 0
        base = len(self.v)
        self.v.extend(m @ p for p in other.v)
        nm = m.to_3x3()
        for idx, mat, uvs, cls, grain in other.f:
            idx = tuple(i + base for i in idx)
            g = (nm @ grain) if grain is not None else None
            if flip:
                idx = tuple(reversed(idx))
                uvs = list(reversed(uvs)) if uvs is not None else None
            self.f.append((idx, mat, uvs, cls, g))

    def mirrored_x(self) -> "Geo":
        g = Geo()
        g.extend(self, S(-1, 1, 1))
        return g

    def ntris(self):
        return sum(len(f[0]) - 2 for f in self.f)


def quad_grid(g: Geo, P, mat, uv=None, cls="flat", out=None, skip=None, grain=None):
    """Quads between P[i][j], P[i+1][j], P[i+1][j+1], P[i][j+1]; uv[i][j] optional."""
    for i in range(len(P) - 1):
        for j in range(len(P[i]) - 1):
            if skip and skip(i, j):
                continue
            pts = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]]
            uvs = [uv[i][j], uv[i + 1][j], uv[i + 1][j + 1], uv[i][j + 1]] if uv else None
            m = mat(i, j) if callable(mat) else mat
            g.face(pts, m, uvs, cls, grain, out)


def box(g: Geo, mat, size, m: Matrix | None = None, bevel=0.05, grain="x", cls="flat"):
    """Chamfered box centred at the origin of m. grain: local axis the wood grain runs along."""
    sx, sy, sz = (s / 2 for s in size)
    m = m or Matrix.Identity(4)
    c = min(bevel, sx * 0.45, sy * 0.45, sz * 0.45)
    gl = {"x": V(1, 0, 0), "y": V(0, 1, 0), "z": V(0, 0, 1)}[grain]
    loc = Geo()
    if c <= 1e-4:
        P = [V(x, y, z) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        for q in quads:
            loc.face([P[i] for i in q], mat, None, cls, gl, out=lambda p: p)
    else:
        h = (sx, sy, sz)

        def pt(axis, sgn, a, b):
            """Point on the face (axis, sgn) inset by c, at corner signs a, b of the other axes."""
            p = [0.0, 0.0, 0.0]
            p[axis] = sgn * h[axis]
            o = [k for k in range(3) if k != axis]
            p[o[0]] = a * (h[o[0]] - c)
            p[o[1]] = b * (h[o[1]] - c)
            return Vector(p)

        for axis in range(3):
            for sgn in (-1, 1):
                loc.face([pt(axis, sgn, a, b) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))], mat, None, cls, gl, out=lambda p: p)
        # edge chamfers
        for a1 in range(3):
            for a2 in range(a1 + 1, 3):
                a3 = 3 - a1 - a2
                for s1 in (-1, 1):
                    for s2 in (-1, 1):
                        quad = []
                        for s3 in (-1, 1):
                            p = [0.0] * 3
                            p[a1] = s1 * h[a1]
                            p[a2] = s2 * (h[a2] - c)
                            p[a3] = s3 * (h[a3] - c)
                            q = [0.0] * 3
                            q[a1] = s1 * (h[a1] - c)
                            q[a2] = s2 * h[a2]
                            q[a3] = s3 * (h[a3] - c)
                            quad += [Vector(p), Vector(q)]
                        loc.face([quad[0], quad[1], quad[3], quad[2]], mat, None, cls, gl, out=lambda p: p)
        for x in (-1, 1):
            for y in (-1, 1):
                for z in (-1, 1):
                    tri = [V(x * sx, y * (sy - c), z * (sz - c)), V(x * (sx - c), y * sy, z * (sz - c)), V(x * (sx - c), y * (sy - c), z * sz)]
                    loc.face(tri, mat, None, cls, gl, out=lambda p: p)
    g.extend(loc, m)


def cyl(g: Geo, mat, p0, p1, r0, r1=None, seg=12, cap0=True, cap1=True, cls="round", ring_uv=True, rings=None):
    """Tapered cylinder from p0 to p1. rings: optional [(t, r), ...] profile overriding r0/r1."""
    p0, p1 = Vector(p0), Vector(p1)
    r1 = r0 if r1 is None else r1
    L = (p1 - p0).length
    m = frame(p0, p1)
    prof = rings or [(0.0, r0), (1.0, r1)]
    loc = Geo()
    dens = DENSITY[mat]
    rows = []
    uvr = []
    for t, r in prof:
        row = [V(r * math.cos(2 * PI * k / seg), t * L, r * math.sin(2 * PI * k / seg)) for k in range(seg + 1)]
        rows.append(row)
        uvr.append([(t * L * dens, 2 * PI * r * k / seg * dens) for k in range(seg + 1)])
    quad_grid(loc, rows, mat, uvr if ring_uv else None, cls, out=lambda p: V(p.x, 0, p.z))
    if cap0 and prof[0][1] > 1e-5:
        loc.face(rows[0][:-1], mat, None, "flat", V(1, 0, 0), out=V(0, -1, 0))
    if cap1 and prof[-1][1] > 1e-5:
        loc.face(rows[-1][:-1], mat, None, "flat", V(1, 0, 0), out=V(0, 1, 0))
    g.extend(loc, m)


def lathe(g: Geo, mat, profile, m: Matrix | None = None, seg=12, cls="round", cap=True):
    """Revolve [(r, y), ...] (bottom to top) about local +Y."""
    m = m or Matrix.Identity(4)
    loc = Geo()
    rows, uvr = [], []
    dens = DENSITY[mat]
    acc = 0.0
    for i, (r, y) in enumerate(profile):
        if i:
            acc += math.hypot(r - profile[i - 1][0], y - profile[i - 1][1])
        rows.append([V(r * math.cos(2 * PI * k / seg), y, -r * math.sin(2 * PI * k / seg)) for k in range(seg + 1)])
        uvr.append([(2 * PI * max(r, 0.05) * k / seg * dens, acc * dens) for k in range(seg + 1)])
    for i in range(len(rows) - 1):
        for k in range(seg):
            pts = [rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]]
            uvs = [uvr[i][k], uvr[i][k + 1], uvr[i + 1][k + 1], uvr[i + 1][k]]
            if (pts[0] - pts[1]).length < 1e-7:  # apex
                pts, uvs = pts[1:], uvs[1:]
            elif (pts[2] - pts[3]).length < 1e-7:
                pts, uvs = pts[:3], uvs[:3]
            loc.face(pts, mat, uvs, cls)
    if cap and profile[0][0] > 1e-5:
        loc.face(rows[0][:-1], mat, None, "flat", V(1, 0, 0), out=V(0, -1, 0))
    if cap and profile[-1][0] > 1e-5:
        loc.face(rows[-1][:-1], mat, None, "flat", V(1, 0, 0), out=V(0, 1, 0))
    g.extend(loc, m)


def torus(g: Geo, mat, R0, r, m: Matrix | None = None, seg=16, rseg=6, cls="round", arc=2 * PI):
    """Ring in the local XZ plane (axis +Y)."""
    m = m or Matrix.Identity(4)
    loc = Geo()
    full = abs(arc - 2 * PI) < 1e-6
    n = seg if full else seg
    rows = []
    for i in range(n + 1):
        a = arc * i / seg
        rows.append([V((R0 + r * math.cos(2 * PI * j / rseg)) * math.cos(a), r * math.sin(2 * PI * j / rseg), (R0 + r * math.cos(2 * PI * j / rseg)) * math.sin(a)) for j in range(rseg + 1)])
    dens = DENSITY[mat]
    uv = [[(R0 * arc * i / seg * dens, 2 * PI * r * j / rseg * dens) for j in range(rseg + 1)] for i in range(n + 1)]

    def out(p):
        c = V(p.x, 0, p.z)
        c = c.normalized() * R0 if c.length > 1e-6 else c
        return p - c

    quad_grid(loc, rows, mat, uv, cls, out=out)
    g.extend(loc, m)


def sphere(g: Geo, mat, r, m: Matrix | None = None, seg=10, rings=6, cls="round", scale=(1, 1, 1)):
    prof = [(r * math.sin(PI * i / rings), -r * math.cos(PI * i / rings)) for i in range(rings + 1)]
    lathe(g, mat, prof, (m or Matrix.Identity(4)) @ S(*scale), seg, cls, cap=False)


def tube(g: Geo, mat, pts, radius, seg=6, cls="round", cap=True, closed=False, up=None):
    """Swept circle along a polyline (parallel transport). radius: number or per-point list."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    if n < 2:
        return
    rad = radius if isinstance(radius, (list, tuple)) else [radius] * n
    tans = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[i - 1]
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tans.append(t.normalized())
    ref = up or (V(0, 1, 0) if abs(tans[0].y) < 0.9 else V(1, 0, 0))
    nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
    frames = []
    for i in range(n):
        if i:
            nrm = nrm - tans[i] * nrm.dot(tans[i])
            if nrm.length < 1e-6:
                nrm = (ref - tans[i] * ref.dot(tans[i]))
            nrm.normalize()
        b = tans[i].cross(nrm)
        frames.append((nrm.copy(), b))
    rows, uvr = [], []
    acc = 0.0
    dens = DENSITY[mat]
    idx = list(range(n)) + ([0] if closed else [])
    for k, i in enumerate(idx):
        if k:
            acc += (pts[i] - pts[idx[k - 1]]).length
        nn, bb = frames[i]
        rows.append([pts[i] + (nn * math.cos(2 * PI * j / seg) + bb * math.sin(2 * PI * j / seg)) * rad[i] for j in range(seg + 1)])
        uvr.append([(acc * dens, 2 * PI * rad[i] * j / seg * dens) for j in range(seg + 1)])
    for i in range(len(rows) - 1):
        c0 = pts[idx[i]]
        c1 = pts[idx[i + 1]]
        for j in range(seg):
            q = [rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]]
            cen = (c0 + c1) / 2
            g.face(q, mat, [uvr[i][j], uvr[i + 1][j], uvr[i + 1][j + 1], uvr[i][j + 1]], cls, out=lambda p, cen=cen: p - cen)
    if cap and not closed:
        if rad[0] > 1e-5:
            g.face(rows[0][:-1], mat, None, "flat", tans[0], out=-tans[0])
        if rad[-1] > 1e-5:
            g.face(rows[-1][:-1], mat, None, "flat", tans[-1], out=tans[-1])


def sweep(g: Geo, mat, pts, normals, profile, cls="flat", closed_profile=False, cap=True, uvscale=None):
    """Sweep a 2D profile [(along normal, along binormal), ...] along pts with given outward normals."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rows = []
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        nn = Vector(normals[i])
        nn = (nn - t * nn.dot(t)).normalized()
        b = t.cross(nn)
        rows.append([pts[i] + nn * a + b * c for a, c in profile])
    dens = DENSITY[mat]
    acc = [0.0]
    for i in range(1, n):
        acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
    plen = [0.0]
    pp = profile + ([profile[0]] if closed_profile else [])
    for k in range(1, len(pp)):
        plen.append(plen[-1] + math.hypot(pp[k][0] - pp[k - 1][0], pp[k][1] - pp[k - 1][1]))
    if closed_profile:
        rows = [r + [r[0]] for r in rows]
    uv = [[(acc[i] * dens, plen[k] * dens) for k in range(len(rows[0]))] for i in range(n)]
    for i in range(n - 1):
        for k in range(len(rows[0]) - 1):
            q = [rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]]
            g.face(q, mat, [uv[i][k], uv[i + 1][k], uv[i + 1][k + 1], uv[i][k + 1]], cls, out=sum(q, Vector()) / 4 - (pts[i] + pts[i + 1]) / 2)
    if cap:
        for i, s in ((0, -1), (n - 1, 1)):
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() * s
            ring = rows[i][:-1] if closed_profile else rows[i]
            if len(ring) >= 3:
                g.face(ring, mat, None, "flat", None, out=t)


def extrude(g: Geo, mat, poly, depth, m: Matrix | None = None, grain="x", bevel=0.0, cls="flat"):
    """Polygon [(x, y), ...] in local XY, extruded along local Z, centred on z = 0."""
    m = m or Matrix.Identity(4)
    loc = Geo()
    gl = {"x": V(1, 0, 0), "y": V(0, 1, 0), "z": V(0, 0, 1)}[grain]
    d = depth / 2
    b = min(bevel, d * 0.9)
    # signed area -> orientation
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    P = list(poly) if area > 0 else list(reversed(poly))
    n = len(P)
    if b > 0:
        inner = offset_poly(P, -b)
        front = [V(x, y, d) for x, y in inner]
        back = [V(x, y, -d) for x, y in inner]
        midf = [V(x, y, d - b) for x, y in P]
        midb = [V(x, y, -d + b) for x, y in P]
        loc.face(front, mat, None, cls, gl, out=V(0, 0, 1))
        loc.face(list(reversed(back)), mat, None, cls, gl, out=V(0, 0, -1))
        for i in range(n):
            j = (i + 1) % n
            loc.face([midf[i], midf[j], front[j], front[i]], mat, None, cls, gl)
            loc.face([back[i], back[j], midb[j], midb[i]], mat, None, cls, gl)
            loc.face([midb[i], midb[j], midf[j], midf[i]], mat, None, cls, gl)
    else:
        front = [V(x, y, d) for x, y in P]
        back = [V(x, y, -d) for x, y in P]
        loc.face(front, mat, None, cls, gl)
        loc.face(list(reversed(back)), mat, None, cls, gl)
        for i in range(n):
            j = (i + 1) % n
            loc.face([back[i], back[j], front[j], front[i]], mat, None, cls, gl)
    g.extend(loc, m)


def offset_poly(P, dist):
    """Offset a CCW polygon (negative = inwards) by moving vertices along averaged edge normals."""
    n = len(P)
    out = []
    for i in range(n):
        a, b, c = Vector((*P[i - 1], 0)), Vector((*P[i], 0)), Vector((*P[(i + 1) % n], 0))
        e0 = (b - a).normalized()
        e1 = (c - b).normalized()
        n0 = V(e0.y, -e0.x, 0)
        n1 = V(e1.y, -e1.x, 0)
        nb = (n0 + n1)
        if nb.length < 1e-6:
            nb = n0
        nb.normalize()
        k = 1.0 / max(0.3, nb.dot(n0))
        p = b + nb * dist * k
        out.append((p.x, p.y))
    return out


# ---------------------------------------------------------------------------------------------
# Blender objects, AO, export
# ---------------------------------------------------------------------------------------------
def to_bl(p: Vector) -> Vector:
    return Vector((p.x, -p.z, p.y))


def mat_get(name: str) -> bpy.types.Material:
    m = bpy.data.materials.get(name)
    if m:
        return m
    look = MAT_LOOK[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb(look["color"]), 1)
    bsdf.inputs["Metallic"].default_value = look.get("metal", 0.0)
    bsdf.inputs["Roughness"].default_value = look.get("rough", 0.6)
    m.use_backface_culling = True
    return m


AO_DIRS = []


def ao_dirs(n=40):
    if AO_DIRS:
        return AO_DIRS
    ga = PI * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - (i + 0.5) / n  # cosine-ish: more rays near the normal
        z = math.sqrt(z)
        r = math.sqrt(max(0.0, 1 - z * z))
        a = ga * i
        AO_DIRS.append(Vector((r * math.cos(a), r * math.sin(a), z)))
    return AO_DIRS


def bake_ao(bm: bmesh.types.BMesh, dist: float, floor: float, extra: list | None = None):
    """Per-vertex hemisphere AO (fixed directions, deterministic). Returns list of values 0..1."""
    tree = BVHTree.FromBMesh(bm)
    dirs = ao_dirs()
    vals = []
    for v in bm.verts:
        n = v.normal
        if n.length < 0.5:
            vals.append(1.0)
            continue
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = v.co + n * 0.015
        occ = 0.0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            hit = tree.ray_cast(o, w, dist)
            if hit[0] is not None:
                occ += 1.0 - (hit[3] / dist) ** 0.7
        # floor contact: rays toward -Z (blender) hit the ground plane at `floor`
        ao = 1.0 - occ / len(dirs)
        if floor is not None and v.co.z - floor < dist:
            h = max(0.0, v.co.z - floor)
            ao *= 1.0 - 0.35 * (1 - h / dist) ** 2 * max(0.0, -n.z * 0.5 + 0.5)
        vals.append(ao)
    return vals


def make_object(name: str, g: Geo, ao_dist=2.5, ao_floor=None, ao_gain=1.0) -> bpy.types.Object:
    used = sorted({f[1] for f in g.f}, key=MATS.index)
    mi = {m: i for i, m in enumerate(used)}
    me = bpy.data.meshes.new(name)
    verts = [to_bl(p) for p in g.v]
    faces = [f[0] for f in g.f]
    me.from_pydata(verts, [], faces)
    for m in used:
        me.materials.append(mat_get(m))
    uvl = me.uv_layers.new(name="UVMap")
    cls_attr = me.attributes.new("tc_cls", "INT", "FACE")
    li = 0
    for pi, (idx, mat, uvs, cls, grain) in enumerate(g.f):
        poly = me.polygons[pi]
        poly.material_index = mi[mat]
        cls_attr.data[pi].value = 1 if cls == "round" else 0
        if uvs is None:
            uvs = auto_uv([g.v[i] for i in idx], grain, DENSITY[mat])
        for k in range(len(idx)):
            u, v = uvs[k]
            uvl.data[poly.loop_start + k].uv = (u, 1.0 - v)  # glTF v runs down; Blender flips on export
    me.validate(clean_customdata=False)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    deg = [f for f in bm.faces if f.calc_area() < 1e-9]
    if deg:
        bmesh.ops.delete(bm, geom=deg, context="FACES")
    clsl = bm.faces.layers.int.get("tc_cls")
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = len(e.link_faces) < 2
            continue
        f0, f1 = e.link_faces
        thr = SHARP["round"] if (f0[clsl] and f1[clsl]) else SHARP["flat"]
        e.smooth = e.calc_face_angle(PI) < math.radians(thr)
    bm.normal_update()
    vals = bake_ao(bm, ao_dist, ao_floor)
    bm.to_mesh(me)
    bm.free()
    me.attributes.remove(me.attributes["tc_cls"])
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, a in enumerate(vals):
        c = clamp(0.28 + 0.72 * a ** ao_gain, 0.0, 1.0)
        col.data[i].color = (c, c, c, 1.0)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def auto_uv(pts, grain, dens):
    a, b, c = pts[0], pts[1], pts[2]
    n = Vector((0, 0, 0))
    for i in range(len(pts)):
        p, q = pts[i], pts[(i + 1) % len(pts)]
        n += Vector(((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y)))
    n = n.normalized() if n.length > 1e-9 else V(0, 1, 0)
    gdir = Vector(grain) if grain is not None else (pts[1] - pts[0])
    gdir = gdir - n * gdir.dot(n)
    if gdir.length < 1e-6:
        gdir = n.orthogonal()
    gdir.normalize()
    bdir = n.cross(gdir)
    return [(p.dot(gdir) * dens, p.dot(bdir) * dens) for p in pts]


PIECES: dict[str, dict] = {}
META = dict(
    glb="public/models/world/tidecrown-harbor.glb",
    builder="tools/build_tidecrown_harbor.sh (Blender 5.0 headless + gltf-transform meshopt --quantize-normal 12)",
    units="game units, 1 = crab shell height",
    axes="y up, bow / front faces +z; ship +x side is its port side",
    origins=dict(ships="waterline centre: y = 0 is the waterline, z centred on the waterline length, x on the centreline",
                 piers_quays="top surface centre (deck top / quay top at y = 0)", other="base centre at y = 0"),
    materials=MATS,
    textures="none embedded; the game assigns textures and tints by material name",
    uv=dict(
        wood=dict(uv_per_unit=D_WOOD, source="village.glb Floor_WoodDark, material MI_WoodTrim (area-weighted UV/world ratio 0.4912, median 0.4917)",
                  u="along the grain", v="across the grain",
                  planks="every plank strip (hull strakes, deck, pier, wall boards) starts at v = 0 and spans at most 0.24 = one Floor_WoodDark strip of T_WoodTrim (v 0.31..0.55), so v + 0.31 shows one plank per strip; round timbers and other faces use world planar/cylindrical mapping at the same density",
                  also_used_by=["TC_Rope", "TC_Gold", "TC_Iron", "TC_PaintBlue"]),
        stone=dict(uv_per_unit=D_STONE, source="village.glb Floor_Brick / Wall_UnevenBrick (one UV tile per 2 units)", materials=["TC_Limestone", "TC_LimestoneDark"]),
        sail=dict(material="TC_Sail", rule="every set sail owns the 0..1 square, aspect kept: the longer side spans 0..1 and the crest centre is (0.5, 0.5)",
                  square_sails="u = 0 at the -x edge to 1 at +x, v = 0 at the head; reads unmirrored from ahead (+z)",
                  lateen="u = 0 at the forward end to 1 aft, v = 0 at the top; reads unmirrored from the +x side",
                  furled="TC_GalleonFurled bundles use world cylindrical mapping, not the crest square"),
        convention="glTF UV (v runs down the image)"),
    ao="per-vertex hemisphere occlusion ray traced in Blender, stored linear in COLOR_0 (0.28..1, multiply with the base colour)",
)


def piece(name: str, g: Geo, anchors: dict, budget: int, notes: dict | None = None, ao_dist=2.5, ao_floor=None):
    o = make_object(name + "_mesh", g, ao_dist=ao_dist, ao_floor=ao_floor)
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    o.parent = e
    e["anchors"] = {k: [round(float(c), 4) for c in v] for k, v in anchors.items()}
    for k, v in (notes or {}).items():
        e[k] = v
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    xs = [p.x for p in g.v]
    ys = [p.y for p in g.v]
    zs = [p.z for p in g.v]
    PIECES[name] = dict(
        triangles=tris,
        budget=budget,
        bounds=dict(min=[round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)], max=[round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]),
        materials=sorted({f[1] for f in g.f}, key=MATS.index),
        anchors={k: [round(float(c), 4) for c in v] for k, v in anchors.items()},
        **(notes or {}),
    )
    print(f"PIECE {name:20s} tris {tris:6d} / {budget}")
    return e


# ---------------------------------------------------------------------------------------------
# Hulls: a lofted surface x = half(s, y), z = z(s, y); s = 0 at the transom, 1 at the stem
# ---------------------------------------------------------------------------------------------
class Hull:
    def __init__(self, B, K, ymax, ytop, p, tumble, bow_s0, bow_a, bow_b, stern_s0, stern_pow, wtr, zs, zb, top, bh, t, rake=0.0, straight=False):
        self.rake = rake
        self.straight = straight
        self.B, self.K, self.ymax, self.ytop, self.p, self.tumble = B, K, ymax, ytop, p, tumble
        self.bow_s0, self.bow_a, self.bow_b = bow_s0, bow_a, bow_b
        self.stern_s0, self.stern_pow, self.wtr = stern_s0, stern_pow, wtr
        self.zs, self.zb = zs, zb
        self.top, self.bh, self.t = top, bh, t  # deck-edge height top(s), bulwark height, bulwark thickness
        self.zc = 0.0
        self.zc = (self.z(0.0, 0.0) + self.z(1.0, 0.0)) / 2  # origin at the waterline centre

    def yn(self, y):
        return clamp((y - self.K) / (self.ytop - self.K))

    def hw(self, y):
        if y <= self.ymax:
            q = clamp((self.ymax - y) / (self.ymax - self.K))
            return max(0.0, 1 - q**self.p) ** (1 / self.p)
        return 1 - self.tumble * ((y - self.ymax) / (self.ytop - self.ymax)) ** 1.5

    def half(self, s, y):
        F = 1.0
        yn = self.yn(y)
        if s > self.bow_s0:
            q = clamp((s - self.bow_s0) / (1 - self.bow_s0))
            a = lerp(self.bow_a[0], self.bow_a[1], yn)
            F *= max(0.0, 1 - q**a) ** self.bow_b
        if s < self.stern_s0:
            q = (self.stern_s0 - s) / self.stern_s0
            F *= 1 - (1 - interp(self.wtr, y)) * q**self.stern_pow
        return self.B * self.hw(y) * F

    def zends(self, y):
        yn = self.yn(y)
        zs = lerp(self.zs[0], self.zs[1], yn)
        if self.straight:
            zb = self.zb[0] + (self.zb[1] - self.zb[0]) * yn
        else:
            zb = self.zb[0] + (self.zb[1] - self.zb[0]) * math.sqrt(max(0.0, 1 - (1 - yn) ** 2)) + self.rake * yn**2
        return zs - self.zc, zb - self.zc

    def z(self, s, y):
        a, b = self.zends(y)
        return lerp(a, b, s)

    def s_at(self, z, y):
        a, b = self.zends(y)
        return clamp((z - a) / (b - a))

    def P(self, s, y):
        return V(self.half(s, y), y, self.z(s, y))

    def normal(self, s, y):
        e = 2e-3
        Ts = self.P(min(1, s + e), y) - self.P(max(0, s - e), y)
        Ty = self.P(s, y + e) - self.P(s, y - e)
        n = Ty.cross(Ts)
        return n.normalized() if n.length > 1e-12 else V(1, 0, 0)

    def nh(self, s, y):
        n = self.normal(s, y)
        n = V(n.x, 0, n.z)
        return n.normalized() if n.length > 1e-6 else V(1, 0, 0)

    def inner(self, s, y):
        p = self.P(s, y) - self.nh(s, y) * self.t
        return V(max(p.x, 0.0), p.y, p.z)

    def wall_top(self, s):
        return self.top(s) + self.bh


def section(pt, s, y0, y1, n=40, bottom_dense=True):
    ys = [y0 + (y1 - y0) * ((1 - math.cos(PI / 2 * i / n)) if bottom_dense else i / n) for i in range(n + 1)]
    pts = [pt(s, y) for y in ys]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + (b - a).length)
    return ys, pts, cum


def at_len(ys, pts, cum, d):
    d = clamp(d, 0.0, cum[-1])
    for k in range(1, len(cum)):
        if cum[k] >= d - 1e-12:
            t = 0.0 if cum[k] == cum[k - 1] else (d - cum[k - 1]) / (cum[k] - cum[k - 1])
            return pts[k - 1].lerp(pts[k], t), lerp(ys[k - 1], ys[k], t)
    return pts[-1], ys[-1]


def planking(g, stations, pt, nrm, y0f, y1f, nstrake, matf, style="groove", gw=0.05, gd=0.035, lap=0.05, skip=None, bottom_dense=True, ufn=None, kg=0, cls="flat"):
    """Strakes between y0f(s) and y1f(s) on the surface pt(s, y); grooved or clinker plank seams.
    Strakes below kg are plain (one quad across) to save triangles under the waterline."""
    grid = []  # grid[i][k] = (points, normals, girth offsets, width)
    for s in stations:
        ys, pts, cum = section(pt, s, y0f(s), y1f(s), bottom_dense=bottom_dense)
        L = cum[-1]
        row = []
        for k in range(nstrake):
            a, b = L * k / nstrake, L * (k + 1) / nstrake
            grooved = style == "groove" and k >= kg
            ds = [a, a + gw, b - gw, b] if grooved else [a, b]
            P, N = [], []
            for d in ds:
                p, y = at_len(ys, pts, cum, d)
                P.append(p)
                N.append(nrm(s, y))
            if grooved:
                P[0] = P[0] - N[0] * gd
                P[3] = P[3] - N[3] * gd
            elif style == "clinker":
                P[0] = P[0] + N[0] * lap
            row.append((P, N, [d - a for d in ds], b - a))
        grid.append(row)
    for i in range(len(stations) - 1):
        if skip and skip(stations[i], stations[i + 1]):
            continue
        for k in range(nstrake):
            P0, N0, D0, W0 = grid[i][k]
            P1, N1, D1, W1 = grid[i + 1][k]
            mat = matf(k)
            for j in range(len(P0) - 1):
                q = [P0[j], P1[j], P1[j + 1], P0[j + 1]]

                def uvf(P, D, W, jj):
                    u = (ufn(P[jj]) if ufn else P[jj].z) * DENSITY[mat]
                    v = D[jj] / W * min(W * DENSITY[mat], WOOD_STRIP) if W > 1e-6 else 0.0
                    return (u, v)

                uvs = [uvf(P0, D0, W0, j), uvf(P1, D1, W1, j), uvf(P1, D1, W1, j + 1), uvf(P0, D0, W0, j + 1)]
                g.face(q, mat, uvs, cls, None, out=(N0[j] + N1[j + 1]))
            if style == "clinker" and k + 1 < nstrake:
                # lap lip: from the top of this strake to the lapped bottom of the next one
                Pa0, Pa1 = grid[i][k][0][-1], grid[i + 1][k][0][-1]
                Pb0, Pb1 = grid[i][k + 1][0][0], grid[i + 1][k + 1][0][0]
                down = (grid[i][k][0][0] - grid[i][k][0][-1])
                g.face([Pa0, Pa1, Pb1, Pb0], matf(k + 1), None, "flat", None, out=down)
    return grid


def hplanks(g, stations, pt, nrm, ylo, yhi, y0, y1, mat="TC_Wood", plank=0.488, gw=0.04, gd=0.03, skip=None):
    """Horizontal planks (constant y seams) on pt(s, y), clipped to ylo(s)..yhi(s) at every station."""
    n = max(1, int(math.ceil((y1 - y0) / plank - 1e-6)))
    for j in range(n):
        ya = y0 + j * plank
        yb = ya + plank
        lv = [(ya, True), (ya + gw, False), (yb - gw, False), (yb, True)]
        rows = []
        for s in stations:
            lo, hi = ylo(s), yhi(s)
            row = []
            for y, seam in lv:
                yc = clamp(y, lo, hi)
                p = pt(s, yc)
                nn = nrm(s, yc)
                if seam and lo < y < hi:
                    p = p - nn * gd
                row.append((p, nn, yc))
            rows.append(row)
        for i in range(len(stations) - 1):
            if skip and skip(stations[i], stations[i + 1]):
                continue
            for k in range(3):
                q = [rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]]
                g.face([c[0] for c in q], mat, [(c[0].z * D_WOOD, (c[2] - ya) * D_WOOD) for c in q], "flat", None, out=q[0][1] + q[2][1])


def strake_line(grid, k, j=0):
    """Points and normals of strake k's j-th girth point at every station."""
    return [row[k][0][j] for row in grid], [row[k][1][j] for row in grid]


def deck_planks(g, hull, stations, s0, s1, yd, mat="TC_Wood", plank=0.488, gw=0.04, gd=0.03, aft_wall=False):
    st = [s0] + [s for s in stations if s0 < s < s1] + [s1]
    rows = []
    for s in st:
        q = hull.inner(s, yd)
        if aft_wall and s == 0.0:
            q = V(q.x, yd, hull.z(0.0, yd) + hull.t)
        rows.append((q.z, max(q.x + 0.1, 0.0) if q.x > 0.05 else 0.0))
    W = max(w for _, w in rows)
    n = int(math.ceil(W / plank))
    for k in range(-n, n):
        xa, xb = k * plank, (k + 1) * plank
        xs = [xa, xa + gw, xb - gw, xb]
        dy = [-gd, 0, 0, -gd]
        for i in range(len(rows) - 1):
            (za, wa), (zb_, wb) = rows[i], rows[i + 1]
            for j in range(3):
                q = [V(clamp(xs[j], -wa, wa), yd + dy[j], za), V(clamp(xs[j + 1], -wa, wa), yd + dy[j + 1], za),
                     V(clamp(xs[j + 1], -wb, wb), yd + dy[j + 1], zb_), V(clamp(xs[j], -wb, wb), yd + dy[j], zb_)]
                uvs = [(p.z * D_WOOD, (p.x - xa) * D_WOOD) for p in q]
                g.face(q, mat, uvs, "flat", None, out=V(0, 1, 0))
    return rows


def station_list(spans, extra=()):
    out = set()
    for a, b, step in spans:
        n = max(1, int(round((b - a) / step)))
        for i in range(n + 1):
            out.add(round(a + (b - a) * i / n, 6))
    for e in extra:
        out.add(round(e, 6))
    return sorted(out)


def cap_rail(g, hull, stations, yf, skip=None, w_out=0.09, w_in=0.09, h0=-0.06, h1=0.1, mat="TC_WoodDark", ends=True):
    """Rail cap along the bulwark top between the outer and inner faces."""
    rows = []
    for s in stations:
        y = yf(s)
        o, i, n = hull.P(s, y), hull.inner(s, y), hull.nh(s, y)
        rows.append([o + n * w_out + V(0, h0, 0), o + n * w_out + V(0, h1, 0), i - n * w_in + V(0, h1, 0), i - n * w_in + V(0, h0, 0)])
    outs = [lambda n: n, lambda n: V(0, 1, 0), lambda n: -n]
    runs = [[]]
    for k in range(len(stations) - 1):
        if skip and skip(stations[k], stations[k + 1]):
            runs.append([])
            continue
        n = hull.nh(stations[k], yf(stations[k]))
        for j in range(3):
            q = [rows[k][j], rows[k + 1][j], rows[k + 1][j + 1], rows[k][j + 1]]
            uvs = [(p.z * D_WOOD, (j * 0.08 + (0 if m < 2 else 0.08)) * 1.0) for m, p in enumerate(q)]
            g.face(q, mat, uvs, "flat", None, out=outs[j](n))
        if not runs[-1]:
            runs[-1].append(k)
        runs[-1].append(k + 1)
    if ends:
        for run in runs:
            if not run:
                continue
            for k, sgn in ((run[0], -1), (run[-1], 1)):
                t = (rows[min(k + 1, len(rows) - 1)][1] - rows[max(k - 1, 0)][1]) * sgn
                g.face(rows[k], mat, None, "flat", None, out=t)


def molding(g, pts, nrms, mat, w=0.14, h=0.18, inset=0.0):
    prof = [(-inset, -h / 2), (w, -h / 2), (w, h / 2), (-inset, h / 2)]
    sweep(g, mat, pts, nrms, prof)


# ---------------------------------------------------------------------------------------------
# Galleon
# ---------------------------------------------------------------------------------------------
def galleon_hull():
    def top(s):
        y = 7.62
        y = lerp(y, 5.32, smoothstep(0.11, 0.16, s))
        y = lerp(y, 2.92, smoothstep(0.31, 0.37, s))
        y = lerp(y, 5.02, smoothstep(0.70, 0.76, s))
        return y + 0.45 * smoothstep(0.86, 1.0, s) ** 2

    h = Hull(
        B=5.5, K=-3.6, ymax=0.9, ytop=9.5, p=2.6, tumble=0.17,
        bow_s0=0.55, bow_a=(1.7, 2.6), bow_b=0.62, stern_s0=0.4, stern_pow=1.7,
        wtr=[(-3.6, 0.05), (-2.0, 0.22), (-0.5, 0.45), (1.0, 0.62), (3.0, 0.72), (9.5, 0.75)],
        zs=(-15.6, -17.6), zb=(12.0, 16.9), top=top, bh=0.5, t=0.2, rake=1.6,
    )
    h.sheer = lambda s: 2.92 + 1.5 * max(0.0, (0.42 - s) / 0.42) ** 2 + 1.1 * max(0.0, (s - 0.62) / 0.38) ** 2
    return h


GAL = dict(
    decks=[("poop", 0.0, 0.11, 7.4), ("quarter", 0.11, 0.31, 5.1), ("waist", 0.31, 0.76, 2.7), ("fore", 0.76, 1.0, 4.8)],
    band=(18, 20),  # painted strakes [a, b)
    nstrake=20,
    kg=12,  # grooved plank seams from this strake up
    gang_z=(3.3, 4.8),
)


def build_galleon(furled=False):
    h = galleon_hull()
    gz0, gz1 = GAL["gang_z"]
    sg0, sg1 = h.s_at(gz0, 3.2), h.s_at(gz1, 3.2)
    ST = station_list([(0, 0.16, 0.02), (0.16, 0.31, 0.03), (0.31, 0.37, 0.015), (0.37, 0.70, 0.045), (0.70, 0.76, 0.015), (0.76, 0.9, 0.02), (0.9, 1.0, 0.01)], extra=[sg0, sg1] + [d[1] for d in GAL["decks"]] + [d[2] for d in GAL["decks"]])
    SC = station_list([(0, 0.16, 0.04), (0.16, 0.31, 0.05), (0.31, 0.37, 0.03), (0.37, 0.70, 0.11), (0.70, 0.76, 0.03), (0.76, 0.9, 0.035), (0.9, 1.0, 0.02)])
    SD = station_list([(0, 0.16, 0.055), (0.16, 0.31, 0.1), (0.31, 0.70, 0.2), (0.70, 0.86, 0.08), (0.86, 1.0, 0.035)])
    gap = lambda a, b: a >= sg0 - 1e-6 and b <= sg1 + 1e-6
    half = Geo()  # +X side, mirrored at the end
    mid = Geo()  # centreline parts
    b0, b1 = GAL["band"]
    matf = lambda k: "TC_PaintBlue" if b0 <= k < b1 else "TC_Wood"
    grid = planking(half, ST, h.P, h.normal, lambda s: h.K, h.sheer, GAL["nstrake"], matf, kg=GAL["kg"])
    # upper works: horizontal planks from the sheer up to the stepped castle tops
    hplanks(half, ST, h.P, h.normal, h.sheer, h.wall_top, 2.92, 8.3, skip=gap)
    for name, s0, s1, yd in GAL["decks"]:
        st = [s for s in ST if s0 - 1e-9 <= s <= s1 + 1e-9]
        planking(half, st, h.inner, lambda s, y: -h.nh(s, y), lambda s, yd=yd: yd, h.wall_top, 2, lambda k: "TC_Wood", skip=gap, bottom_dense=False, gd=0.03)
    cap_rail(half, h, ST, lambda s: h.wall_top(s), skip=gap)
    # wales and trims
    keep = [i for i in range(len(ST)) if i % 2 == 0 or i == len(ST) - 1]
    for k, mat, w, hh in ((b0, "TC_WoodDark", 0.2, 0.3), (b0 - 5, "TC_WoodDark", 0.16, 0.26)):
        pts, nrms = strake_line(grid, k, 0)
        molding(half, [pts[i] for i in keep], [nrms[i] for i in keep], mat, w=w + 0.035, h=hh)
    molding(half, [h.P(s, h.sheer(s)) for s in SC], [h.nh(s, h.sheer(s)) for s in SC], "TC_WoodDark", w=0.17, h=0.2)
    molding(half, [h.P(s, h.sheer(s) - 0.16) for s in SC], [h.nh(s, h.sheer(s) - 0.16) for s in SC], "TC_Gold", w=0.1, h=0.09)
    for lo, hi in ((0.0, 0.37), (0.70, 1.0)):
        st = [s for s in SC if lo <= s <= hi]
        molding(half, [h.P(s, h.wall_top(s) - 0.14) for s in st], [h.nh(s, h.wall_top(s) - 0.14) for s in st], "TC_Gold", w=0.07, h=0.09)
    # transom edge molding
    ys = [-0.6 + (h.wall_top(0) + 0.04 + 0.6) * i / 16 for i in range(17)]
    molding(half, [h.P(0, y) for y in ys], [(h.nh(0, y) + V(0, 0, -1)).normalized() for y in ys], "TC_WoodDark", w=0.16, h=0.22)

    g = Geo()
    g.extend(half)
    g.extend(half.mirrored_x())
    # decks
    for name, s0, s1, yd in GAL["decks"]:
        deck_planks(mid, h, SD, s0, s1, yd, aft_wall=(s0 == 0.0))
    # transom: horizontal planks between the two hull edges, and the inner wall above the poop deck
    yt = h.wall_top(0)
    n = int(math.ceil((yt - h.K) / 0.488))
    for k in range(n):
        ya, yb = h.K + (yt - h.K) * k / n, h.K + (yt - h.K) * (k + 1) / n
        lv = [(ya, -0.03), (ya + 0.04, 0.0), (yb - 0.04, 0.0), (yb, -0.03)]
        for j in range(3):
            (y0, d0), (y1, d1) = lv[j], lv[j + 1]
            x0, x1 = h.half(0, y0), h.half(0, y1)
            z0, z1 = h.z(0, y0) + d0 * -1, h.z(0, y1) + d1 * -1
            q = [V(x0, y0, z0), V(-x0, y0, z0), V(-x1, y1, z1), V(x1, y1, z1)]
            mid.face(q, "TC_Wood", [(p.x * D_WOOD, (p.y - ya) * D_WOOD) for p in q], "flat", None, out=V(0, 0, -1))
    yd = GAL["decks"][0][3]
    xa, xb = h.half(0, yd) - h.t, h.half(0, yt) - h.t
    za, zb_ = h.z(0, yd) + h.t, h.z(0, yt) + h.t
    q = [V(-xa, yd, za), V(xa, yd, za), V(xb, yt, zb_), V(-xb, yt, zb_)]
    mid.face(q, "TC_Wood", [(p.x * D_WOOD, (p.y - yd) * D_WOOD * 0.4) for p in q], "flat", None, out=V(0, 0, 1))
    xo = h.half(0, yt)
    box(mid, "TC_WoodDark", (2 * xo + 0.2, 0.16, 0.42), T(0, yt + 0.02, h.z(0, yt) + 0.06), bevel=0.04)
    # keel, stem and sternpost
    kp = [V(0, h.K, h.z(s, h.K)) for s in (0.0, 0.25, 0.5, 0.75, 1.0)]
    sp = [V(0, y, h.z(1.0, y)) for y in [h.K + (h.wall_top(1.0) - h.K) * (1 - math.cos(PI / 2 * i / 14)) for i in range(1, 15)]]
    path = kp + sp
    nr = []
    for i in range(len(path)):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        nr.append(V(0, -t.z, t.y))
    sweep(mid, "TC_WoodDark", path, nr, [(-0.15, -0.2), (0.32, -0.2), (0.32, 0.2), (-0.15, 0.2)], closed_profile=True)
    sp = [V(0, y, h.z(0.0, y)) for y in (h.K, -2.0, -0.5, 1.0)]
    nr = [V(0, -0.1, -1).normalized()] * len(sp)
    sweep(mid, "TC_WoodDark", sp, nr, [(-0.1, -0.2), (0.3, -0.2), (0.3, 0.2), (-0.1, 0.2)], closed_profile=True)
    # rudder
    zr = h.z(0.0, h.K) - 0.3
    rm = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, zr), (0, 0, 0, 1)))
    extrude(mid, "TC_WoodDark", [(0, h.K + 0.35), (1.25, h.K + 0.35), (1.15, -0.2), (0.75, 2.6), (0, 2.8)], 0.32, rm, grain="y", bevel=0.05)
    for y in (h.K + 0.9, -1.2, 0.6, 2.2):
        box(mid, "TC_Iron", (0.4, 0.16, 1.0), T(0, y, zr - 0.35), bevel=0.03)
    g.extend(mid)
    return g, h, ST, grid


def rope(g, pts, r=0.05, seg=4):
    tube(g, "TC_Rope", pts, r, seg=seg, cap=False)


def sag(a, b, depth, n=6):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / n) - V(0, depth * math.sin(PI * i / n), 0) for i in range(n + 1)]


def yard(g, c, half, r_mid, r_end, axis=None, mat="TC_WoodDark", seg=8):
    axis = (axis or V(1, 0, 0)).normalized()
    cyl(g, mat, c - axis * half, c + axis * half, r_end, seg=seg, rings=[(0.0, r_end * 0.8), (0.04, r_end), (0.5, r_mid), (0.96, r_end), (1.0, r_end * 0.8)])


def square_sail(g, head, top_w, bot_w, height, belly, nu=12, nv=7, thick=0.06, roach=0.05):
    """Billowed square sail hanging from `head` (centre of the head edge) in the XY plane, bellying to +z.
    UV: its own 0..1 square, u = 0 at -x (reads unmirrored from ahead), v = 0 at the head."""
    head = Vector(head)
    P, U = [], []
    for i in range(nu + 1):
        u = i / nu
        col, cu = [], []
        for j in range(nv + 1):
            v = j / nv
            w = lerp(top_w, bot_w, v)
            x = (u - 0.5) * w
            y = head.y - v * height + roach * height * math.sin(PI * u) * v**3
            d = belly * math.sin(PI * u) ** 0.85 * math.sin(PI / 2 * min(1.0, v * 1.35)) ** 0.9
            d *= 1.0 - 0.25 * v**2
            seam = 0.05 * (1 if i % 2 else 0) * math.sin(PI * min(1.0, v * 1.5)) * math.sin(PI * u)
            col.append(V(head.x + x, y, head.z + d - seam))
            m = max(max(top_w, bot_w), height)
            cu.append((0.5 + (u - 0.5) * lerp(top_w, bot_w, v) / m, 0.5 + (v - 0.5) * height / m))
        P.append(col)
        U.append(cu)
    back = [[p - V(0, 0, thick) for p in col] for col in P]
    quad_grid(g, P, "TC_Sail", U, "round", out=V(0, 0, 1))
    quad_grid(g, back, "TC_Sail", U, "round", out=V(0, 0, -1))
    edges = [[P[i][0] for i in range(nu + 1)], [P[i][nv] for i in range(nu + 1)], [P[0][j] for j in range(nv + 1)], [P[nu][j] for j in range(nv + 1)]]
    bedges = [[back[i][0] for i in range(nu + 1)], [back[i][nv] for i in range(nu + 1)], [back[0][j] for j in range(nv + 1)], [back[nu][j] for j in range(nv + 1)]]
    for e, b in zip(edges, bedges):
        for k in range(len(e) - 1):
            c = (e[k] + e[k + 1] + b[k] + b[k + 1]) / 4
            ctr = sum((col[nv // 2] for col in P), Vector()) / len(P)
            g.face([e[k], e[k + 1], b[k + 1], b[k]], "TC_Sail", [(0.5, 0.5)] * 4, "flat", out=c - ctr)
    for e in edges[1:]:
        rope(g, [p - V(0, 0, thick / 2) for p in e], 0.055, seg=3)
    return dict(clew_l=P[0][nv], clew_r=P[nu][nv], centre=P[nu // 2][nv // 2])


def lateen_sail(g, A, B, C, belly, nu=12, nv=7, thick=0.06):
    """Triangular sail: A..B along the yard (A forward), C the clew. Bellies to +x.
    UV: own 0..1 square over its z/y bounds, u = 0 at the forward end, v = 0 at the top."""
    A, B, C = Vector(A), Vector(B), Vector(C)
    zs_ = [A.z, B.z, C.z]
    ys_ = [A.y, B.y, C.y]
    z0, z1, y0, y1 = min(zs_), max(zs_), min(ys_), max(ys_)
    P, U = [], []
    for i in range(nu + 1):
        u = i / nu
        col, cu = [], []
        top = A.lerp(B, u)
        for j in range(nv + 1):
            v = j / nv
            p = top.lerp(C, v * (1 - 0.0))
            d = belly * math.sin(PI * u) ** 0.8 * math.sin(PI * min(1.0, v * 1.2)) * (1 - v) ** 0.3 if v < 1 else 0.0
            p = p + V(d, 0, 0)
            col.append(p)
            m = max(z1 - z0, y1 - y0)
            cu.append((0.5 + ((z1 - p.z) - (z1 - z0) / 2) / m, 0.5 + ((y1 - p.y) - (y1 - y0) / 2) / m))
        P.append(col)
        U.append(cu)
    back = [[p - V(thick, 0, 0) for p in col] for col in P]
    quad_grid(g, P, "TC_Sail", U, "round", out=V(1, 0, 0))
    quad_grid(g, back, "TC_Sail", U, "round", out=V(-1, 0, 0))
    for e, b in (([P[i][0] for i in range(nu + 1)], [back[i][0] for i in range(nu + 1)]), ([P[0][j] for j in range(nv + 1)], [back[0][j] for j in range(nv + 1)]), ([P[nu][j] for j in range(nv + 1)], [back[nu][j] for j in range(nv + 1)])):
        ctr = P[nu // 2][nv // 2]
        for k in range(len(e) - 1):
            c = (e[k] + e[k + 1] + b[k] + b[k + 1]) / 4
            g.face([e[k], e[k + 1], b[k + 1], b[k]], "TC_Sail", [(0.5, 0.5)] * 4, "flat", out=c - ctr)
    rope(g, [P[0][j] - V(thick / 2, 0, 0) for j in range(nv + 1)], 0.055, seg=3)
    rope(g, [P[nu][j] - V(thick / 2, 0, 0) for j in range(nv + 1)], 0.055, seg=3)
    return dict(clew=C, centre=P[nu // 2][nv // 3])


def furled(g, a, b, r=0.32, below=0.3, fwd=0.25, n=10):
    """Sail bundled along a yard from a to b: a lumpy cream roll with rope gaskets."""
    a, b = Vector(a), Vector(b)
    pts, rad = [], []
    for i in range(n + 1):
        t = i / n
        pts.append(a.lerp(b, t) + V(0, -below, fwd))
        rad.append(r * (0.55 + 0.45 * math.sin(PI * t) ** 0.5) * (1 + 0.12 * math.sin(i * 2.3)))
    tube(g, "TC_Sail", pts, rad, seg=8)
    for i in range(1, n, 2):
        c = pts[i]
        ax = (b - a).normalized()
        torus(g, "TC_Rope", rad[i] * 1.02, 0.05, frame(c - ax * 0.05, c + ax * 0.05) @ R("X", 0), seg=10, rseg=3)


def pennant(g, base, length, width, mat="TC_PaintBlue", n=10, fwd=V(0, 0, 1), swallow=True):
    """Streaming two-sided pennant from `base` along fwd with a gentle wave; swallowtail end."""
    base = Vector(base)
    top, bot = [], []
    for i in range(n + 1):
        t = i / n
        w = width * (1 - 0.55 * t)
        c = base + fwd * (length * t) + V(0.35 * math.sin(t * 5.0) * t, -0.25 * t * t * length / 6, 0)
        top.append(c + V(0, w / 2, 0))
        bot.append(c - V(0, w / 2, 0))
    if swallow:
        mid = (top[-1] + bot[-1]) / 2 - fwd * (length * 0.12)
        top[-1] = top[-1] + fwd * 0.2
        bot[-1] = bot[-1] + fwd * 0.2
    for side, off in ((1, 0.02), (-1, -0.02)):
        for i in range(n):
            q = [top[i], top[i + 1], bot[i + 1], bot[i]]
            if swallow and i == n - 1:
                g.face([top[i] + V(off, 0, 0), top[i + 1] + V(off, 0, 0), mid + V(off, 0, 0), bot[i + 1] + V(off, 0, 0), bot[i] + V(off, 0, 0)], mat, None, "round", fwd, out=V(side, 0, 0))
            else:
                g.face([p + V(off, 0, 0) for p in q], mat, None, "round", fwd, out=V(side, 0, 0))


def deadeye(g, p, axis):
    cyl(g, "TC_WoodDark", p - axis * 0.07, p + axis * 0.07, 0.17, seg=8)


def mast_stack(g, z, foot, spec, furl=False):
    """Lower mast, top, topmast, topgallant, yards and sails. spec: dict of heights. Returns points."""
    out = {}
    lo_top, top_y, r0 = spec["lower"], spec["top"], spec["r"]
    cyl(g, "TC_WoodDark", V(0, foot - 0.3, z), V(0, lo_top, z), r0, r0 * 0.82, seg=12)
    for y in spec.get("bands", []):
        cyl(g, "TC_Iron", V(0, y, z), V(0, y + 0.14, z), r0 * 0.93 + 0.04, seg=12)
    # top platform with a crab-height ring rail
    rt = spec["top_r"]
    cyl(g, "TC_WoodDark", V(0, top_y - 0.25, z), V(0, top_y, z), rt, seg=14)
    for k in range(2):
        box(g, "TC_WoodDark", (2 * rt * 0.9, 0.22, 0.3), T(0, top_y - 0.36, z + (k - 0.5) * 0.7), bevel=0.04)
    for k in range(8):
        a = 2 * PI * (k + 0.5) / 8
        if spec.get("open_aft") and -0.9 < math.sin(a) < -0.3:
            pass
        cyl(g, "TC_WoodDark", V(rt * 0.92 * math.cos(a), top_y, z + rt * 0.92 * math.sin(a)), V(rt * 0.92 * math.cos(a), top_y + 0.62, z + rt * 0.92 * math.sin(a)), 0.06, seg=5)
    torus(g, "TC_WoodDark", rt * 0.92, 0.07, T(0, top_y + 0.64, z), seg=18, rseg=4)
    box(g, "TC_WoodDark", (r0 * 2.6, 0.5, r0 * 3.6), T(0, lo_top + 0.1, z + r0 * 0.6), bevel=0.06)
    # topmast and topgallant mast, stepped forward of the head below
    zt = z + r0 * 1.2
    cyl(g, "TC_WoodDark", V(0, top_y - 0.6, zt), V(0, spec["topmast"], zt), spec["rt"], spec["rt"] * 0.75, seg=10)
    box(g, "TC_WoodDark", (2.2, 0.16, 0.24), T(0, spec["topmast"] - 0.9, zt), bevel=0.03)
    box(g, "TC_WoodDark", (0.24, 0.16, 1.0), T(0, spec["topmast"] - 0.9, zt), bevel=0.03)
    box(g, "TC_WoodDark", (spec["rt"] * 2.4, 0.36, spec["rt"] * 3.6), T(0, spec["topmast"] - 0.1, zt + spec["rt"] * 0.5), bevel=0.04)
    zg = zt + spec["rt"] * 1.0
    head = spec["tg"]
    cyl(g, "TC_WoodDark", V(0, spec["topmast"] - 1.2, zg), V(0, head, zg), spec["rt"] * 0.6, spec["rt"] * 0.38, seg=8)
    sphere(g, "TC_Gold", 0.22, T(0, head + 0.14, zg), seg=10, rings=6)
    pennant(g, V(0, head - 0.15, zg), spec.get("pennant", 7.0), 0.75)
    out["masthead"] = V(0, head + 0.36, zg)
    out["lower_head"] = V(0, lo_top, z)
    out["top_y"] = top_y
    out["top_head"] = V(0, spec["topmast"], zt)
    out["tg_head"] = V(0, head, zg)
    out["z"], out["zt"], out["zg"] = z, zt, zg
    # yards and sails
    sails = []
    out["sails"] = sails
    if not spec.get("square", True):
        return out
    for (yy, half, zz, sail) in (
        (spec["course"][0], spec["course"][1], z + r0 + 0.25, spec["course"][2:]),
        (spec["topsail"][0], spec["topsail"][1], zt + spec["rt"] + 0.2, spec["topsail"][2:]),
        (spec["topgallant"][0], spec["topgallant"][1], zg + spec["rt"] * 0.6 + 0.15, spec["topgallant"][2:]),
    ):
        yard(g, V(0, yy, zz), half, 0.26 if half > 6 else 0.2 if half > 4 else 0.15, 0.11)
        if furl:
            furled(g, V(-half * 0.92, yy, zz), V(half * 0.92, yy, zz), r=0.38 if half > 6 else 0.3 if half > 4 else 0.22)
            sails.append(dict(yard=(yy, half, zz)))
        else:
            top_w, bot_w, height, belly = sail
            sd = square_sail(g, V(0, yy - 0.18, zz + 0.12), top_w, bot_w, height, belly)
            sd["yard"] = (yy, half, zz)
            sails.append(sd)
    out["sails"] = sails
    return out


def hull_side(h, z, y, out=0.0):
    s = h.s_at(z, y)
    n = h.nh(s, y)
    return h.P(s, y) + n * out, n


MAST_SPEC = {
    "main": dict(z=0.0, foot=2.7, lower=17.2, top=16.0, r=0.5, top_r=1.7, bands=[5.0, 7.5, 10.0, 12.5], topmast=26.2, rt=0.3, tg=33.6,
                 course=(15.3, 7.5, 14.2, 15.0, 8.0, 1.8), topsail=(24.8, 5.6, 10.6, 13.8, 8.9, 1.5), topgallant=(31.5, 3.7, 6.8, 10.2, 6.1, 1.0), pennant=8.0,
                 chan=(3.15, [-2.6, -1.7, -0.8, 0.1])),
    "fore": dict(z=11.4, foot=4.8, lower=15.6, top=14.5, r=0.45, top_r=1.5, bands=[7.5, 10.0, 12.5], topmast=24.0, rt=0.27, tg=29.8,
                 course=(13.8, 6.8, 12.8, 13.4, 6.4, 1.5), topsail=(22.4, 5.0, 9.4, 12.4, 8.1, 1.3), topgallant=(28.0, 3.2, 6.0, 9.0, 5.4, 0.9), pennant=6.5,
                 chan=(5.15, [-2.2, -1.4, -0.6, 0.2])),
    "mizzen": dict(z=-9.4, foot=5.1, lower=15.0, top=14.0, r=0.36, top_r=1.2, bands=[8.0, 11.0], topmast=21.0, rt=0.2, tg=24.6, square=False, pennant=5.0,
                   chan=(5.6, [-1.8, -1.0, -0.2])),
}


def galleon_rig(g, h, furl=False):
    pts = {}
    for name, sp in MAST_SPEC.items():
        pts[name] = mast_stack(g, sp["z"], sp["foot"], sp, furl=furl)
    # lateen mizzen
    A, B = V(0, 8.3, -4.2), V(0, 19.8, -17.4)
    yard(g, (A + B) / 2, (B - A).length / 2, 0.19, 0.1, axis=B - A)
    ax = (B - A).normalized()
    if furl:
        furled(g, A + ax * 0.6, B - ax * 0.8, r=0.3, below=0.28, fwd=0.0)
    else:
        lat = lateen_sail(g, A + ax * 0.5 + V(0.15, -0.2, 0), B - ax * 0.7 + V(0.15, -0.2, 0), V(0.15, 8.95, -16.3), 1.1)
    # bowsprit and spritsail
    b0, b1 = V(0, 5.3, 14.2), V(0, 9.6, 23.8)
    cyl(g, "TC_WoodDark", b0, b1, 0.42, 0.2, seg=10)
    bd = (b1 - b0).normalized()
    for t in (0.35, 0.55):
        c = b0.lerp(b1, t)
        cyl(g, "TC_Iron", c - bd * 0.07, c + bd * 0.07, lerp(0.42, 0.2, t) + 0.04, seg=10)
    pts["bowsprit"] = (b0, b1)
    # standing rigging
    for name, sp in MAST_SPEC.items():
        mp = pts[name]
        z, top_y, r0 = sp["z"], sp["top"], sp["r"]
        ch_y, offs = sp["chan"]
        for sgn in (1, -1):
            feet = []
            for dz in offs:
                p, n = hull_side(h, z + dz, ch_y)
                p = V(p.x * sgn, p.y, p.z)
                n = V(n.x * sgn, n.y, n.z)
                feet.append((p + n * 0.6 + V(0, 0.22, 0), n, p))
            # channel plank and deadeyes, chainplates
            pa, pb = feet[0][2], feet[-1][2]
            nmid = (feet[0][1] + feet[-1][1]).normalized()
            c = (pa + pb) / 2 + nmid * 0.36
            d = (pb - pa)
            L = d.length + 1.0
            m = frame(c - d.normalized() * (L / 2), c + d.normalized() * (L / 2), up=V(0, 1, 0))
            box(g, "TC_WoodDark", (0.16, L, 0.72), m @ T(0, L / 2, 0) @ R("Y", 0), bevel=0.04, grain="y")
            tops = []
            for k, (f, n, p) in enumerate(feet):
                deadeye(g, f, n)
                box(g, "TC_Iron", (0.08, 1.2, 0.12), frame(f - V(0, 0.15, 0), f - V(0, 1.4, 0) - n * 0.55, up=n) @ T(0, 0.6, 0), bevel=0.0, grain="y")
                tp = V(sgn * (r0 + 0.08), top_y - 0.35, z - 0.25 + 0.1 * k)
                tops.append(tp)
                rope(g, [f + V(0, 0.15, 0), tp], 0.065, seg=4)
            # ratlines
            y = ch_y + 0.95
            while y < top_y - 1.1:
                row = []
                for (f, n, p), tp in zip(feet, tops):
                    t = (y - f.y) / (tp.y - f.y)
                    row.append(f.lerp(tp, t))
                for a, b in zip(row, row[1:]):
                    rope(g, [a, b], 0.032, seg=3)
                y += 0.78
            # topmast shrouds with ratlines
            rt = sp["top_r"] * 0.95
            tf = [V(sgn * rt, top_y + 0.02, z + dz) for dz in (-0.55, 0.25)]
            tt = [V(sgn * (sp["rt"] + 0.05), sp["topmast"] - 1.0, mp["zt"] - 0.05 + 0.1 * k) for k in range(2)]
            for a, b in zip(tf, tt):
                rope(g, [a, b], 0.05, seg=4)
            y = top_y + 0.8
            while y < sp["topmast"] - 1.6:
                t = (y - tf[0].y) / (tt[0].y - tf[0].y)
                rope(g, [tf[0].lerp(tt[0], t), tf[1].lerp(tt[1], t)], 0.028, seg=3)
                y += 0.78
            # topgallant shroud from the crosstree end
            rope(g, [V(sgn * 1.05, sp["topmast"] - 0.85, mp["zt"]), V(sgn * 0.12, sp["tg"] - 0.7, mp["zg"])], 0.04, seg=3)
            # backstay
            hp, hn = hull_side(h, z + offs[0] - 2.4, ch_y - 0.1)
            rope(g, [V(sgn * (sp["rt"] + 0.04), sp["topmast"] - 0.3, mp["zt"]), V(sgn * (hp.x + 0.25), hp.y, hp.z)], 0.045, seg=3)
    M, F, Z = pts["main"], pts["fore"], pts["mizzen"]
    rope(g, [V(0, 16.7, 0.35), V(0, 5.6, 10.6)], 0.085)
    rope(g, [V(0, 25.6, M["zt"] + 0.2), V(0, 14.7, F["z"] + 0.35)], 0.06)
    rope(g, [V(0, 32.8, M["zg"]), V(0, 23.5, F["zt"] + 0.2)], 0.045)
    rope(g, [V(0, 15.1, F["z"] + 0.35), b0.lerp(b1, 0.45)], 0.085)
    rope(g, [V(0, 23.4, F["zt"] + 0.2), b0.lerp(b1, 0.95)], 0.06)
    rope(g, [V(0, 29.0, F["zg"]), b1 - bd * 0.1], 0.045)
    rope(g, [V(0, 14.4, Z["z"] + 0.3), V(0, 8.4, -0.55)], 0.06)
    rope(g, [V(0, 21.0, Z["zt"]), V(0, 15.9, -0.4)], 0.045)
    rope(g, [b0.lerp(b1, 0.72) - V(0, 0.3, 0), V(0, 0.9, 16.5)], 0.06)
    # running rigging: course sheets, braces and lifts
    if not furl:
        for name, aft in (("main", -6.2), ("fore", 6.2)):
            sd = pts[name]["sails"][0]
            for clew, sgn in ((sd["clew_l"], -1), (sd["clew_r"], 1)):
                hp, hn = hull_side(h, aft, 3.4)
                rope(g, [clew, V(sgn * hp.x, hp.y, hp.z)], 0.045, seg=3)
    for name, tgt in (("main", V(0, 12.2, -9.1)), ("fore", V(0, 12.8, 0.55))):
        sp = MAST_SPEC[name]
        for idx, key in ((0, "course"), (1, "topsail")):
            yy, half, zz = pts[name]["sails"][idx]["yard"]
            for sgn in (1, -1):
                arm = V(sgn * (half - 0.25), yy, zz)
                rope(g, [arm, tgt + V(sgn * 0.3, idx * 2.0, 0)], 0.04, seg=3)
                head = V(sgn * 0.3, (sp["lower"] if idx == 0 else sp["topmast"]) - 0.2, sp["z"] if idx == 0 else pts[name]["zt"])
                rope(g, [arm, head], 0.035, seg=3)
    return pts


def onplane(p, n, up=None) -> Matrix:
    """Frame at p with local +Z along n (outwards) and local +Y as close to `up` as possible."""
    up = up or V(0, 1, 0)
    z = Vector(n).normalized()
    y = up - z * up.dot(z)
    y = y.normalized() if y.length > 1e-6 else z.orthogonal().normalized()
    x = y.cross(z)
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = x[i], y[i], z[i], p[i]
    return m


def claw(g, m, mat="TC_Gold", o=1.0, sc=1.0, teeth=True):
    """Crab claw: palm at the origin of m along local +Y, fingers opening in local X."""
    sphere(g, mat, 1.0, m @ T(0, 0.85, 0), seg=12, rings=8, scale=(0.56, 0.95, 0.44))
    tube(g, mat, [m @ V(0, -0.55, 0), m @ V(0, 0.2, 0)], 0.34 * sc, seg=10)
    torus(g, mat, 0.37, 0.07, m @ T(0, -0.05, 0), seg=12, rseg=4)
    fixed = [V(-0.2, 1.45, 0), V(-0.36 - 0.1 * o, 1.95, 0), V(-0.37 - 0.12 * o, 2.4, 0), V(-0.24 - 0.05 * o, 2.8, 0), V(-0.03, 3.05, 0)]
    dact = [V(0.22, 1.5, 0), V(0.5 + 0.25 * o, 1.95, 0), V(0.6 + 0.3 * o, 2.45, 0), V(0.42 + 0.2 * o, 2.85, 0), V(0.12 + 0.06 * o, 3.1, 0)]
    rad = [r * sc for r in (0.3, 0.27, 0.2, 0.12, 0.025)]
    tube(g, mat, [m @ p for p in fixed], rad, seg=8)
    tube(g, mat, [m @ p for p in dact], rad, seg=8)
    if teeth:
        for pts_, sgn in ((fixed, 1), (dact, -1)):
            for i in (1, 2):
                a = pts_[i] + V(sgn * rad[i] / sc * 0.8, 0, 0)
                cyl(g, mat, m @ a, m @ (a + V(sgn * 0.17, 0.08, 0)), 0.07 * sc, 0.0, seg=5, cap1=False)


def window(g, m, w, hh, frame_w=0.1):
    """Gold-framed dark window on a surface (m: local +Z outwards)."""
    box(g, "TC_Gold", (w + 2 * frame_w, hh + 2 * frame_w, 0.08), m @ T(0, 0, 0.04), bevel=0.0)
    box(g, "TC_Iron", (w, hh, 0.06), m @ T(0, 0, 0.09), bevel=0.0)
    box(g, "TC_Gold", (0.05, hh, 0.04), m @ T(0, 0, 0.13), bevel=0.0)
    box(g, "TC_Gold", (w, 0.05, 0.04), m @ T(0, hh * 0.12, 0.13), bevel=0.0)
    box(g, "TC_WoodDark", (w + 0.36, 0.1, 0.2), m @ T(0, -hh / 2 - frame_w - 0.05, 0.1), bevel=0.0)


def lantern(g, p, size=1.0):
    """Brass stern lantern standing on p (base centre)."""
    m = T(*p) @ S(size)
    lathe(g, "TC_Gold", [(0.0, 0.0), (0.2, 0.0), (0.24, 0.08), (0.2, 0.14)], m, seg=6, cap=True)
    lathe(g, "TC_Iron", [(0.2, 0.14), (0.25, 0.55), (0.25, 0.6)], m, seg=6, cap=False)
    lathe(g, "TC_Gold", [(0.25, 0.6), (0.29, 0.64), (0.22, 0.72), (0.09, 0.9), (0.04, 1.0), (0.07, 1.06), (0.0, 1.14)], m, seg=6, cap=False)


def balustrade(g, a, b, y, height=0.72, step=0.46, post_step=2.4, gaps=()):
    """Rail with turned balusters from a to b (x/z at deck height y); gaps: [(t0, t1)] along a..b."""
    a, b = V(a.x, y, a.z), V(b.x, y, b.z)
    L = (b - a).length
    d = (b - a).normalized()
    up = V(0, 1, 0)
    side = d.cross(up)
    segs = [(0.0, L)]
    for t0, t1 in gaps:
        new = []
        for s0, s1 in segs:
            if t1 <= s0 or t0 >= s1:
                new.append((s0, s1))
                continue
            if t0 > s0:
                new.append((s0, t0))
            if t1 < s1:
                new.append((t1, s1))
        segs = new
    prof = [(0.06, 0.0), (0.1, 0.16), (0.05, 0.4), (0.07, 0.5)]
    for s0, s1 in segs:
        if s1 - s0 < 0.3:
            continue
        p0, p1 = a + d * s0, a + d * s1
        mm = onplane((p0 + p1) / 2 + up * (height - 0.05), side, up)
        box(g, "TC_WoodDark", (s1 - s0 + 0.12, 0.12, 0.16), mm, bevel=0.03)
        mm = onplane((p0 + p1) / 2 + up * 0.08, side, up)
        box(g, "TC_WoodDark", (s1 - s0, 0.12, 0.14), mm, bevel=0.0)
        n_post = max(1, int(math.ceil((s1 - s0) / post_step)))
        for k in range(n_post + 1):
            pp = p0.lerp(p1, k / n_post)
            box(g, "TC_WoodDark", (0.2, height + 0.05, 0.2), T(pp.x, y + (height + 0.05) / 2, pp.z), bevel=0.03, grain="y")
            sphere(g, "TC_Gold", 0.1, T(pp.x, y + height + 0.14, pp.z), seg=6, rings=4)
        nb = int((s1 - s0) / step)
        for k in range(1, nb):
            pp = p0.lerp(p1, k / nb)
            if any(abs((pp - p0.lerp(p1, j / n_post)).length) < 0.2 for j in range(n_post + 1)):
                continue
            lathe(g, "TC_Wood", [(r, y0 * (height - 0.2) / 0.5) for r, y0 in prof], T(pp.x, y + 0.14, pp.z), seg=5, cap=False)


def stairs(g, x, z_top, y0, y1, run_dir, width=1.15, rail_side=None):
    """Straight stair from (x, y0) at z_top + run_dir*run up to (x, y1) at z_top."""
    n = max(2, int(round((y1 - y0) / 0.34)))
    rise = (y1 - y0) / n
    tread = 0.46
    for k in range(n):
        zc = z_top + run_dir * (tread * (n - k - 0.5))
        box(g, "TC_Wood", (width, 0.1, tread + 0.04), T(x, y0 + rise * (k + 1) - 0.05, zc), bevel=0.025)
    p0 = V(0, y0, z_top + run_dir * tread * n)
    p1 = V(0, y1, z_top)
    L = (p1 - p0).length
    for sx in (-1, 1):
        mm = T(x + sx * (width / 2 + 0.06), 0, 0) @ frame(p0 + V(0, -0.1, 0), p1 + V(0, -0.1, 0), up=V(1, 0, 0))
        box(g, "TC_WoodDark", (0.12, L + 0.2, 0.36), mm @ T(0, L / 2, 0), bevel=0.03, grain="y")
    if rail_side is not None:
        xr = x + rail_side * (width / 2 + 0.06)
        q0, q1 = V(xr, y0 + 0.75, p0.z - run_dir * 0.1), V(xr, y1 + 0.75, p1.z + run_dir * 0.2)
        cyl(g, "TC_WoodDark", q0, q1, 0.06, seg=6)
        for q in (q0, q1):
            cyl(g, "TC_WoodDark", V(q.x, q.y - 0.8, q.z), q, 0.07, seg=6)
            sphere(g, "TC_Gold", 0.1, T(q.x, q.y + 0.06, q.z), seg=6, rings=4)


def bulkhead(g, h, s_b, y0, y1, face, door=(1.4, 1.7), wins=(), stair_x=(), stair_run=None):
    """Castle front wall across the ship at station s_b from deck y0 to deck y1, facing +z (face=1) or -z."""
    za, zb_ = h.z(s_b, y0), h.z(s_b, y1)
    zw = (max(za, zb_) if face > 0 else min(za, zb_)) + 0.02 * face
    w = min(h.inner(s_b, y).x for y in (y0, (y0 + y1) / 2, y1)) + 0.12
    n = int(math.ceil(w / 0.488))
    for k in range(-n, n):
        xa, xb = max(-w, k * 0.488), min(w, (k + 1) * 0.488)
        if xb - xa < 0.02:
            continue
        xs = [xa, xa + 0.04, xb - 0.04, xb]
        dz = [-0.03, 0, 0, -0.03]
        for j in range(3):
            q = [V(xs[j], y0, zw + dz[j] * face), V(xs[j + 1], y0, zw + dz[j + 1] * face), V(xs[j + 1], y1, zw + dz[j + 1] * face), V(xs[j], y1, zw + dz[j] * face)]
            g.face(q, "TC_Wood", [(p.y * D_WOOD, (p.x - xa) * D_WOOD) for p in q], "flat", out=V(0, 0, face))
    m0 = onplane(V(0, y0, zw), V(0, 0, face))
    dw, dh = door
    if dw:
        arch = [(-dw / 2, 0.0), (dw / 2, 0.0)] + [((dw / 2) * math.cos(PI * k / 8), dh - dw / 2 + (dw / 2) * math.sin(PI * k / 8)) for k in range(9)] + [(-dw / 2, 0.0)]
        extrude(g, "TC_WoodDark", arch[:-1], 0.12, m0 @ T(0, 0, 0.06), grain="y", bevel=0.03)
        tube(g, "TC_Gold", [m0 @ V(x, y, 0.13) for x, y in arch[1:-1]] , 0.07, seg=4, cap=True)
        box(g, "TC_Gold", (0.03, dh - 0.1, 0.04), m0 @ T(0, (dh - 0.1) / 2, 0.14), bevel=0.0)
        for yy in (0.35, dh - dw / 2 - 0.05):
            box(g, "TC_Iron", (dw - 0.1, 0.09, 0.04), m0 @ T(0, yy, 0.14), bevel=0.0)
        for sx in (-1, 1):
            torus(g, "TC_Gold", 0.09, 0.025, m0 @ T(sx * 0.16, dh * 0.45, 0.17) @ R("X", 90), seg=8, rseg=3)
        for sx in (-1, 1):
            box(g, "TC_WoodDark", (0.26, y1 - y0 - 0.25, 0.16), m0 @ T(sx * (dw / 2 + 0.3), (y1 - y0 - 0.25) / 2, 0.08), bevel=0.03, grain="y")
            box(g, "TC_Gold", (0.34, 0.12, 0.2), m0 @ T(sx * (dw / 2 + 0.3), y1 - y0 - 0.3, 0.1), bevel=0.02)
    for wx in wins:
        window(g, onplane(V(wx, (y0 + y1) / 2 + 0.15, zw), V(0, 0, face)), 0.62, 0.78)
    # deck edge beam and gold strip
    box(g, "TC_WoodDark", (2 * w, 0.26, 0.24), T(0, y1 - 0.08, zw + 0.08 * face), bevel=0.04)
    box(g, "TC_Gold", (2 * w, 0.07, 0.08), T(0, y1 - 0.25, zw + 0.12 * face), bevel=0.0)
    gaps = []
    for sx in stair_x:
        stairs(g, sx, zw, y0, y1, face, rail_side=(1 if sx < 0 else -1))
        gaps.append((sx + w - 0.65, sx + w + 0.65))
    balustrade(g, V(-w + 0.25, 0, zw - 0.15 * face), V(w - 0.25, 0, zw - 0.15 * face), y1, gaps=[(a - 0.25, b - 0.25) for a, b in gaps])
    return zw, w


def anchor(g, m):
    """Iron anchor hanging from its ring at the origin of m (shank down local -Y, arms in local X)."""
    torus(g, "TC_Iron", 0.2, 0.05, m @ T(0, 0.05, 0) @ R("Z", 90), seg=10, rseg=4)
    box(g, "TC_WoodDark", (0.22, 0.22, 2.0), m @ T(0, -0.35, 0), bevel=0.04, grain="z")
    box(g, "TC_Iron", (0.17, 2.5, 0.17), m @ T(0, -1.5, 0), bevel=0.03, grain="y")
    arc = [V(1.05 * math.cos(a), -1.85 + 1.05 * math.sin(a), 0) for a in [math.radians(d) for d in (200, 230, 270, 310, 340)]]
    tube(g, "TC_Iron", [m @ p for p in arc], 0.1, seg=6)
    for p, sx in ((arc[0], -1), (arc[-1], 1)):
        extrude(g, "TC_Iron", [(0, 0), (sx * 0.36, 0.45), (sx * 0.05, 0.6)] if sx > 0 else [(0, 0), (sx * 0.05, 0.6), (sx * 0.36, 0.45)], 0.07, m @ T(p.x, p.y, 0), bevel=0.0)


def barrel(g, m, h_=0.9, r=0.36):
    lathe(g, "TC_Wood", [(r * 0.82, 0.0), (r * 0.95, h_ * 0.25), (r, h_ * 0.5), (r * 0.95, h_ * 0.75), (r * 0.82, h_)], m, seg=10, cap=False)
    lathe(g, "TC_WoodDark", [(r * 0.82, h_), (r * 0.7, h_ + 0.02), (0.0, h_ + 0.02)], m, seg=10, cap=False)
    for t in (0.14, 0.86):
        cyl(g, "TC_Iron", m @ V(0, h_ * t - 0.04, 0), m @ V(0, h_ * t + 0.04, 0), r * lerp(0.86, 0.98, 1 - abs(t - 0.5) * 2) + 0.025, seg=10, cap0=False, cap1=False)


def crate(g, m, size=0.9):
    box(g, "TC_Wood", (size, size, size), m @ T(0, size / 2, 0), bevel=0.05)
    for yy in (0.1, size - 0.1):
        box(g, "TC_WoodDark", (size + 0.05, 0.12, size + 0.05), m @ T(0, yy, 0), bevel=0.0)
    box(g, "TC_WoodDark", (0.14, size + 0.04, size + 0.04), m @ T(0, size / 2, 0), bevel=0.0, grain="y")


def rope_coil(g, m, r=0.4, turns=3):
    for k in range(turns):
        torus(g, "TC_Rope", r - k * 0.09, 0.06, m @ T(0, 0.06 + k * 0.1, 0), seg=10, rseg=3)


def galleon_details(g, h, ST):
    an = {}
    hd = Geo()  # +X side details, mirrored
    cd = Geo()  # centreline details
    zst = lambda y: h.z(1.0, y)
    # head: knee with the gold claw figurehead
    knee = [(zst(-0.3) + 0.05, -0.3), (zst(0.6) + 0.9, 0.6), (zst(1.6) + 1.6, 1.6), (zst(2.7) + 2.1, 2.7), (zst(3.5) + 2.35, 3.5),
            (zst(4.1) + 2.15, 4.1), (zst(4.5) + 1.2, 4.5), (zst(4.9) + 0.1, 4.9), (zst(4.9) - 0.3, 4.9), (zst(2.0) - 0.3, 2.0), (zst(-0.3) - 0.3, -0.3)]
    km = Matrix(((0, 0, -1, 0), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))  # local x -> game z, local z -> game -x
    extrude(cd, "TC_WoodDark", [(z, y) for z, y in knee], 0.5, km, grain="x", bevel=0.06)
    tube(cd, "TC_Gold", [V(0, y, z) for z, y in knee[:6]], 0.1, seg=5)
    tip = V(0, 3.75, knee[4][0] + 0.1)
    fd = V(0, math.sin(math.radians(32)), math.cos(math.radians(32)))
    fm = onplane(tip, V(1, 0, 0), up=fd)
    claw(cd, fm @ S(1.15), sc=1.15, o=1.0)
    an["figurehead"] = tip + fd * 3.4
    for yy, zz in ((4.75, 15.0), (3.9, 15.6)):
        p, n = hull_side(h, zz, yy, 0.05)
        q = V(0.28, yy - 0.35, zst(yy - 0.35) + 1.4 + (4.75 - yy) * 0.6)
        tube(hd, "TC_Gold", [p.lerp(q, t) + V(0, -0.25 * math.sin(PI * t), 0) for t in (0, 0.25, 0.5, 0.75, 1.0)], 0.08, seg=5)
    # catheads and anchors
    p, n = hull_side(h, 14.0, 5.6)
    tipc = p + n * 1.1 + V(0, 0.2, 0.25)
    box(hd, "TC_WoodDark", (0.36, 0.36, 1.6), frame(p - n * 0.4, tipc, up=V(0, 1, 0)) @ T(0, 0.8, 0), bevel=0.05, grain="y")
    sphere(hd, "TC_Gold", 0.2, T(*(tipc + n * 0.05)), seg=8, rings=5)
    ap = tipc + V(0, -0.35, 0)
    rope(hd, [tipc - V(0, 0.1, 0), ap], 0.05)
    anchor(hd, onplane(ap, n))
    # stern castle side windows, ports along the blue band
    for zz, yy in ((-12.2, 4.0), (-8.3, 4.0), (-7.1, 4.0), (-14.3, 6.3), (-13.1, 6.3)):
        p, n = hull_side(h, zz, yy)
        window(hd, onplane(p, n), 0.6, 0.8)
    for zz in (-7.4, -5.0, -2.6, -0.2, 2.0, 6.6, 8.9):
        s_ = h.s_at(zz, 2.3)
        yy = h.sheer(s_) - 0.62
        p, n = hull_side(h, zz, yy)
        m = onplane(p, n)
        box(hd, "TC_Gold", (0.78, 0.66, 0.06), m @ T(0, 0, 0.03), bevel=0.0)
        box(hd, "TC_WoodDark", (0.62, 0.5, 0.08), m @ T(0, 0, 0.08), bevel=0.02)
        box(hd, "TC_Iron", (0.5, 0.06, 0.03), m @ T(0, 0.1, 0.13), bevel=0.0)
    # quarter galleries
    s_q = 0.035
    p = h.P(s_q, 5.2)
    n = h.nh(s_q, 5.2)
    ang = math.atan2(-n.z, n.x) - PI / 6
    mq = T(*(p + n * 0.15)) @ R("Y", math.degrees(ang))
    lathe(hd, "TC_WoodDark", [(0.0, -2.3), (0.35, -2.2), (0.95, -1.4), (1.0, -1.25)], mq, seg=6, cap=False)
    lathe(hd, "TC_Wood", [(1.0, -1.25), (1.0, 1.6)], mq, seg=6, cap=False)
    lathe(hd, "TC_Gold", [(1.0, 1.6), (1.13, 1.68), (1.13, 1.84)], mq, seg=6, cap=False)
    lathe(hd, "TC_PaintBlue", [(1.13, 1.84), (0.78, 2.3), (0.3, 2.65), (0.0, 2.72)], mq, seg=6, cap=False)
    sphere(hd, "TC_Gold", 0.16, mq @ T(0, 2.85, 0), seg=6, rings=4)
    for k in (-1, 0, 1):
        a = PI / 6 + ang + k * PI / 3
        fn = V(math.cos(a), 0, -math.sin(a))
        c = mq @ V(0, 0.2, 0) + fn * (1.0 * math.cos(PI / 6) + 0.0)
        window(hd, onplane(c, fn), 0.42, 0.95, frame_w=0.07)
    # gangway posts and boarding battens
    gz0, gz1 = GAL["gang_z"]
    for zz in (gz0 - 0.1, gz1 + 0.1):
        p, n = hull_side(h, zz, 3.3, -0.12)
        cyl(hd, "TC_WoodDark", V(p.x, 2.7, p.z), V(p.x, 3.95, p.z), 0.14, seg=8)
        sphere(hd, "TC_Gold", 0.16, T(p.x, 4.05, p.z), seg=8, rings=5)
    zm = (gz0 + gz1) / 2
    for k in range(5):
        yy = 0.4 + k * 0.48
        p, n = hull_side(h, zm, yy, 0.06)
        box(hd, "TC_WoodDark", (0.9, 0.12, 0.16), onplane(p, n), bevel=0.0)
    p, n = hull_side(h, zm, 2.92)
    an["gangplank"] = V(p.x, 2.7, p.z)
    an["gangplank_negx"] = V(-p.x, 2.7, p.z)
    g.extend(hd)
    g.extend(hd.mirrored_x())
    # castle fronts
    zq, wq = bulkhead(cd, h, 0.31, 2.7, 5.1, 1, door=(1.5, 1.75), wins=(-1.6, 1.6), stair_x=(-3.3, 3.3))
    zf, wf = bulkhead(cd, h, 0.76, 2.7, 4.8, -1, door=(1.2, 1.55), wins=(-1.35, 1.35), stair_x=(-2.6, 2.6))
    zp, wp = bulkhead(cd, h, 0.11, 5.1, 7.4, 1, door=(1.2, 1.6), wins=(-1.4, 1.4), stair_x=(-3.0, 3.0))
    # transom: window rows, stern walk, crest, lanterns
    tz = lambda y: h.z(0.0, y)
    tn = lambda y: V(0, (tz(y + 0.1) - tz(y - 0.1)) / 0.2, -1).normalized()
    for k in range(5):
        x = (k - 2) * 1.15
        window(cd, onplane(V(x, 3.95, tz(3.95)), tn(3.95)), 0.66, 0.95)
        window(cd, onplane(V(x, 6.25, tz(6.25)), tn(6.25)), 0.66, 1.25)
    for yy in (2.95, 5.05, 7.35):
        hw_ = h.half(0.0, yy) - 0.1
        box(cd, "TC_Gold", (2 * hw_, 0.1, 0.12), onplane(V(0, yy, tz(yy)), tn(yy)), bevel=0.0)
    zb5 = tz(5.0)
    box(cd, "TC_WoodDark", (7.4, 0.22, 1.35), T(0, 5.0, zb5 - 0.62), bevel=0.05)
    for x in (-3.0, -1.1, 1.1, 3.0):
        extrude(cd, "TC_WoodDark", [(0.0, 0.0), (1.2, 0.0), (0.15, -1.0), (0.0, -1.0)], 0.2, T(x, 4.9, zb5) @ R("Y", 90), grain="x", bevel=0.03)
    balustrade(cd, V(-3.55, 0, zb5 - 1.2), V(3.55, 0, zb5 - 1.2), 5.11, height=0.66)
    for sx in (-1, 1):
        balustrade(cd, V(sx * 3.6, 0, zb5 - 0.05), V(sx * 3.6, 0, zb5 - 1.15), 5.11, height=0.66, post_step=2.0)
    yc = 7.72
    for sx in (-1, 1):
        claw(cd, onplane(V(sx * 0.7, yc - 0.6, tz(yc) - 0.25), tn(yc), up=V(sx * 0.45, 1, 0)) @ S(0.46) @ S(-sx, 1, 1), sc=0.46, o=1.0)
    sphere(cd, "TC_PaintBlue", 0.34, T(0, yc + 0.35, tz(yc) - 0.4), seg=10, rings=6)
    torus(cd, "TC_Gold", 0.36, 0.05, T(0, yc + 0.35, tz(yc) - 0.4), seg=12, rseg=4)
    yt = h.wall_top(0.0) + 0.1
    ztt = tz(yt) - 0.05
    lant = []
    cyl(cd, "TC_Iron", V(0, yt, ztt + 0.1), V(0, yt + 1.3, ztt - 0.15), 0.07, seg=6)
    lantern(cd, V(0, yt + 1.3, ztt - 0.15), 1.15)
    lant.append(V(0, yt + 1.3 + 0.45, ztt - 0.15))
    for sx in (-1, 1):
        x0 = sx * (h.half(0.0, yt) - 0.3)
        hook = [V(x0, yt - 0.05, ztt + 0.15), V(x0 + sx * 0.25, yt + 0.25, ztt - 0.45), V(x0 + sx * 0.4, yt + 0.25, ztt - 0.85)]
        tube(cd, "TC_Iron", hook, 0.06, seg=5)
        hp = hook[-1]
        cyl(cd, "TC_Iron", hp, hp - V(0, 0.3, 0), 0.025, seg=4)
        lantern(cd, hp - V(0, 0.3 + 0.95, 0), 0.82)
        lant.append(hp - V(0, 0.3 + 0.95 - 0.36, 0))
        an[f"lantern_hook_{'negx' if sx < 0 else 'posx'}"] = hp
    for i, p in enumerate(lant):
        an[f"lantern_{i}"] = p
    # deck props
    wz = zp + 1.4
    box(cd, "TC_WoodDark", (0.36, 1.05, 0.3), T(0, 5.1 + 0.52, wz - 0.32), bevel=0.04, grain="y")
    wc = V(0, 6.1, wz)
    wm = T(*wc) @ R("X", 90)
    torus(cd, "TC_WoodDark", 0.6, 0.055, wm, seg=16, rseg=4)
    cyl(cd, "TC_Gold", wc - V(0, 0, 0.12), wc + V(0, 0, 0.12), 0.13, seg=8)
    for k in range(8):
        a = 2 * PI * k / 8
        d = V(math.cos(a), math.sin(a), 0)
        cyl(cd, "TC_WoodDark", wc + d * 0.12, wc + d * 0.84, 0.035, 0.05, seg=5)
    an["wheel"] = V(0, 5.1, wz + 0.7)
    lathe(cd, "TC_WoodDark", [(0.62, 0.0), (0.64, 0.1), (0.46, 0.22), (0.42, 0.78), (0.56, 0.86), (0.6, 1.0), (0.0, 1.05)], T(0, 2.7, -3.7), seg=10, cap=False)
    cyl(cd, "TC_Iron", V(0, 3.15, -3.7), V(0, 3.3, -3.7), 0.47, seg=10)
    for (zz, sz) in ((1.9, 1.8), (6.6, 1.3)):
        for sx in (-1, 1):
            box(cd, "TC_WoodDark", (0.18, 0.3, sz + 0.18), T(sx * sz / 2, 2.85, zz), bevel=0.03, grain="z")
            box(cd, "TC_WoodDark", (sz + 0.18, 0.3, 0.18), T(0, 2.85, zz + sx * sz / 2), bevel=0.03)
        box(cd, "TC_WoodDark", (sz, 0.06, sz), T(0, 2.86, zz), bevel=0.0)
        for k in range(1, 5):
            off = -sz / 2 + sz * k / 5
            box(cd, "TC_Wood", (0.07, 0.07, sz), T(off, 2.92, zz), bevel=0.0, grain="z")
            box(cd, "TC_Wood", (sz, 0.07, 0.07), T(0, 2.95, zz + off), bevel=0.0)
    for x, zz in ((3.7, 1.1), (3.75, 2.1), (-3.75, 2.4)):
        crate(cd, T(x, 2.7, zz) @ R("Y", 8 * x))
    crate(cd, T(3.72, 3.6, 1.55) @ R("Y", -12), 0.75)
    for x, zz in ((-3.5, 7.4), (-2.85, 7.6), (3.5, 7.5), (-3.3, 0.6)):
        barrel(cd, T(x, 2.7, zz))
    rope_coil(cd, T(-1.8, 2.7, -1.5))
    rope_coil(cd, T(1.5, 4.8, 13.4), r=0.32)
    an["deck_waist"] = V(0, 2.7, 3.0)
    an["deck_quarter"] = V(0, 5.1, -8.6)
    an["deck_poop"] = V(0, 7.4, -14.8)
    an["deck_fore"] = V(0, 4.8, 12.6)
    g.extend(cd)
    return an


def transom_fill(g, h, yt, mat="TC_Wood"):
    n = int(math.ceil((yt - h.K) / 0.488))
    for k in range(n):
        ya, yb = h.K + (yt - h.K) * k / n, h.K + (yt - h.K) * (k + 1) / n
        lv = [(ya, -0.03), (ya + 0.04, 0.0), (yb - 0.04, 0.0), (yb, -0.03)]
        for j in range(3):
            (y0, d0), (y1, d1) = lv[j], lv[j + 1]
            x0, x1 = h.half(0, y0), h.half(0, y1)
            z0, z1 = h.z(0, y0) - d0, h.z(0, y1) - d1
            q = [V(x0, y0, z0), V(-x0, y0, z0), V(-x1, y1, z1), V(x1, y1, z1)]
            g.face(q, mat, [(p.x * D_WOOD, (p.y - ya) * D_WOOD) for p in q], "flat", None, out=V(0, 0, -1))


def keel_parts(g, h, top, rudder=(1.25, 0.75, 2.8), post_w=0.2):
    kp = [V(0, h.K, h.z(s, h.K)) for s in (0.0, 0.25, 0.5, 0.75, 1.0)]
    sp = [V(0, y, h.z(1.0, y)) for y in [h.K + (top - h.K) * (1 - math.cos(PI / 2 * i / 12)) for i in range(1, 13)]]
    path = kp + sp
    nr = []
    for i in range(len(path)):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        nr.append(V(0, -t.z, t.y))
    sweep(g, "TC_WoodDark", path, nr, [(-0.12, -post_w), (0.3, -post_w), (0.3, post_w), (-0.12, post_w)], closed_profile=True)
    sp = [V(0, y, h.z(0.0, y)) for y in (h.K, -1.0, 1.0, 2.5)]
    sweep(g, "TC_WoodDark", sp, [V(0, -0.1, -1).normalized()] * len(sp), [(-0.1, -post_w), (0.28, -post_w), (0.28, post_w), (-0.1, post_w)], closed_profile=True)
    zr = h.z(0.0, h.K) - 0.25
    rm = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, zr), (0, 0, 0, 1)))
    wb, wt, yt = rudder
    # follow the sternpost rake
    k = (h.z(0.0, yt) - h.z(0.0, h.K)) / (yt - h.K)
    poly = [(0, h.K + 0.3), (wb, h.K + 0.3), (wb * 0.92 - k * (0 - h.K), 0.0), (wt - k * (yt - 0.2 - h.K), yt - 0.2), (-k * (yt - h.K), yt)]
    extrude(g, "TC_WoodDark", poly, 0.3, rm, grain="y", bevel=0.05)
    for y in (h.K + 0.8, (h.K + yt) / 2, yt - 0.6):
        zz = h.z(0.0, y) - 0.3
        box(g, "TC_Iron", (0.38, 0.14, 0.9), T(0, y, zz), bevel=0.02)
    return zr


def plank_wall(g, a, b, y0, y1, nrm, mat="TC_Wood", plank=0.488):
    """Vertical-plank wall between ground points a and b (x/z) from y0 to y1 facing nrm."""
    a, b = V(a.x, 0, a.z), V(b.x, 0, b.z)
    L = (b - a).length
    d = (b - a).normalized()
    nrm = Vector(nrm).normalized()
    n = max(1, int(math.ceil(L / plank)))
    for k in range(n):
        ta, tb = L * k / n, L * (k + 1) / n
        ts = [ta, ta + 0.04, tb - 0.04, tb]
        dd = [-0.03, 0, 0, -0.03]
        for j in range(3):
            pa, pb = a + d * ts[j] + nrm * dd[j], a + d * ts[j + 1] + nrm * dd[j + 1]
            q = [V(pa.x, y0, pa.z), V(pb.x, y0, pb.z), V(pb.x, y1, pb.z), V(pa.x, y1, pa.z)]
            g.face(q, mat, [(p.y * D_WOOD, ((p - a).dot(d) - ta) * D_WOOD) for p in q], "flat", out=nrm)


def rect_deck(g, x0, x1, z0, z1, y, mat="TC_Wood", plank=0.488):
    n = max(1, int(round((x1 - x0) / plank)))
    for k in range(n):
        xa, xb = x0 + (x1 - x0) * k / n, x0 + (x1 - x0) * (k + 1) / n
        xs = [xa, xa + 0.04, xb - 0.04, xb]
        dy = [-0.03, 0, 0, -0.03]
        for j in range(3):
            q = [V(xs[j], y + dy[j], z0), V(xs[j + 1], y + dy[j + 1], z0), V(xs[j + 1], y + dy[j + 1], z1), V(xs[j], y + dy[j], z1)]
            g.face(q, mat, [(p.z * D_WOOD, (p.x - xa) * D_WOOD) for p in q], "flat", out=V(0, 1, 0))


def crenel(g, a, b, y, nrm, h_=0.75, merlon=0.5, mat="TC_PaintBlue"):
    """Painted parapet with merlons and gold caps from a to b at height y."""
    a, b = V(a.x, y, a.z), V(b.x, y, b.z)
    L = (b - a).length
    d = (b - a).normalized()
    c = (a + b) / 2
    m = onplane(c + V(0, h_ * 0.35, 0), nrm)
    box(g, mat, (L + 0.18, h_ * 0.7, 0.18), m, bevel=0.03)
    box(g, "TC_Gold", (L + 0.24, 0.07, 0.24), onplane(c + V(0, h_ * 0.7, 0), nrm), bevel=0.0)
    n = max(1, int(L / (merlon * 2)))
    for k in range(n + 1):
        p = a.lerp(b, k / n) if n else c
        box(g, mat, (merlon, h_ * 0.38, 0.2), onplane(p + V(0, h_ * 0.7 + h_ * 0.19, 0), nrm), bevel=0.03)
        box(g, "TC_Gold", (merlon + 0.06, 0.06, 0.24), onplane(p + V(0, h_ * 1.08 + 0.03, 0), nrm), bevel=0.0)


def sack(g, m):
    sphere(g, "TC_Rope", 0.38, m @ T(0, 0.3, 0), seg=8, rings=5, scale=(1.0, 0.8, 0.8))
    cyl(g, "TC_Rope", m @ V(0, 0.5, 0), m @ V(0, 0.75, 0), 0.12, 0.16, seg=6)


def build_cog():
    sheer = lambda s: 2.25 + 1.15 * max(0.0, (0.45 - s) / 0.45) ** 2 + 1.35 * max(0.0, (s - 0.5) / 0.5) ** 2
    h = Hull(B=3.5, K=-2.2, ymax=0.7, ytop=6.0, p=2.2, tumble=0.1, bow_s0=0.52, bow_a=(1.5, 2.3), bow_b=0.75, stern_s0=0.45, stern_pow=1.5,
             wtr=[(-2.2, 0.02), (0.0, 0.16), (2.0, 0.34), (6.0, 0.42)], zs=(-8.6, -10.2), zb=(7.4, 10.4), top=sheer, bh=0.5, t=0.18, straight=True)
    h.sheer = sheer
    YD = 2.0
    gz0, gz1 = -3.4, -2.2
    sg0, sg1 = h.s_at(gz0, 2.6), h.s_at(gz1, 2.6)
    ST = station_list([(0, 0.12, 0.02), (0.12, 0.85, 0.04), (0.85, 1.0, 0.015)], extra=[sg0, sg1])
    SC = ST[::2] + ([ST[-1]] if len(ST) % 2 == 0 else [])
    gap = lambda a, b: a >= sg0 - 1e-6 and b <= sg1 + 1e-6
    half, cd = Geo(), Geo()
    an = {}
    matf = lambda k: "TC_PaintBlue" if k == 10 else "TC_Wood"
    grid = planking(half, ST, h.P, h.normal, lambda s: h.K, sheer, 12, matf, style="clinker", lap=0.06)
    hplanks(half, ST, h.P, h.normal, sheer, h.wall_top, 2.25, 4.4, skip=gap)
    planking(half, ST, h.inner, lambda s, y: -h.nh(s, y), lambda s: YD, h.wall_top, 2, lambda k: "TC_Wood", skip=gap, bottom_dense=False, gd=0.03)
    cap_rail(half, h, ST, h.wall_top, skip=gap)
    molding(half, [h.P(s, sheer(s)) for s in SC], [h.nh(s, sheer(s)) for s in SC], "TC_WoodDark", w=0.15, h=0.18)
    molding(half, [h.P(s, sheer(s) - 0.15) for s in SC], [h.nh(s, sheer(s) - 0.15) for s in SC], "TC_Gold", w=0.09, h=0.08)
    # through-beams, the cog's signature
    for zz in (-5.6, -3.0, 0.4, 3.0, 5.4):
        p, n = hull_side(h, zz, 1.45)
        box(half, "TC_WoodDark", (0.34, 0.34, 0.9), onplane(p, n), bevel=0.05, grain="z")
    # shroud deadeyes on the bulwark
    z_m = 0.4
    feet = []
    for dz in (-2.1, -1.1, -0.1):
        p, n = hull_side(h, z_m + dz, 2.55, 0.28)
        deadeye(half, p, n)
        box(half, "TC_Iron", (0.08, 1.1, 0.12), onplane(p - V(0, 0.65, 0) - n * 0.15, n), bevel=0.0, grain="y")
        feet.append(p)
    tops = [V(0.42, 14.6, z_m - 0.2 + 0.1 * k) for k in range(3)]
    for f, t_ in zip(feet, tops):
        rope(half, [f + V(0, 0.12, 0), t_], 0.06)
    y = 3.2
    while y < 13.8:
        row = [f.lerp(t_, (y - f.y) / (t_.y - f.y)) for f, t_ in zip(feet, tops)]
        for a, b in zip(row, row[1:]):
            rope(half, [a, b], 0.03, seg=3)
        y += 0.78
    for zz in (gz0 - 0.1, gz1 + 0.1):
        p, n = hull_side(h, zz, 2.6, -0.1)
        cyl(half, "TC_WoodDark", V(p.x, YD, p.z), V(p.x, 3.25, p.z), 0.12, seg=8)
        sphere(half, "TC_Gold", 0.14, T(p.x, 3.33, p.z), seg=8, rings=5)
    p, n = hull_side(h, (gz0 + gz1) / 2, 2.4)
    an["gangplank"] = V(p.x, YD, p.z)
    an["gangplank_negx"] = V(-p.x, YD, p.z)
    g = Geo()
    g.extend(half)
    g.extend(half.mirrored_x())
    deck_planks(cd, h, station_list([(0, 0.2, 0.1), (0.2, 0.8, 0.3), (0.8, 1.0, 0.05)]), 0.0, 1.0, YD, aft_wall=True)
    transom_fill(cd, h, h.wall_top(0.0))
    keel_parts(cd, h, h.wall_top(1.0) + 0.3, rudder=(1.1, 0.7, 2.9))
    # aftcastle: an overhanging painted box castle with a crenellated parapet
    zc1 = h.z(0.27, 3.0)
    zc0 = h.z(0.0, 3.5) - 0.35
    xw = 3.0
    yfl, ycd = 2.75, 4.45
    box(cd, "TC_WoodDark", (2 * xw, 0.22, zc1 - zc0), T(0, yfl, (zc0 + zc1) / 2), bevel=0.04, grain="z")
    for sx in (-1, 1):
        plank_wall(cd, V(sx * xw, 0, zc0), V(sx * xw, 0, zc1), yfl, ycd, V(sx, 0, 0))
        for zz in (zc0 + 0.6, (zc0 + zc1) / 2, zc1 - 0.6):
            extrude(cd, "TC_WoodDark", [(0, 0), (0.0, -0.9), (0.7, 0.0)], 0.22, T(sx * (xw - 0.7), yfl - 0.1, zz) @ (R("Y", 0) if sx > 0 else S(-1, 1, 1)), bevel=0.03)
        window(cd, onplane(V(sx * (xw + 0.01), 3.65, (zc0 + zc1) / 2), V(sx, 0, 0)), 0.55, 0.7)
    plank_wall(cd, V(xw, 0, zc0), V(-xw, 0, zc0), yfl, ycd, V(0, 0, -1))
    plank_wall(cd, V(-xw, 0, zc1), V(xw, 0, zc1), YD, ycd, V(0, 0, 1))
    for x in (-1.6, 1.6):
        window(cd, onplane(V(x, 3.65, zc0 - 0.01), V(0, 0, -1)), 0.55, 0.7)
    for sx in (-1, 1):
        for zz, yb in ((zc0, yfl - 0.25), (zc1, YD)):
            box(cd, "TC_WoodDark", (0.3, ycd - yb + 0.1, 0.3), T(sx * xw, (ycd + yb) / 2, zz), bevel=0.05, grain="y")
    box(cd, "TC_Gold", (2 * xw + 0.1, 0.08, 0.1), T(0, ycd - 0.12, zc1 + 0.08), bevel=0.0)
    m0 = onplane(V(0, YD, zc1 + 0.01), V(0, 0, 1))
    arch = [(-0.55, 0.0), (0.55, 0.0)] + [(0.55 * math.cos(PI * k / 6), 1.0 + 0.55 * math.sin(PI * k / 6)) for k in range(7)]
    extrude(cd, "TC_WoodDark", arch, 0.1, m0 @ T(0, 0, 0.05), grain="y", bevel=0.03)
    tube(cd, "TC_Gold", [m0 @ V(x, y, 0.11) for x, y in arch[1:]], 0.06, seg=4)
    rect_deck(cd, -xw, xw, zc0, zc1, ycd)
    crenel(cd, V(-xw, 0, zc0), V(xw, 0, zc0), ycd, V(0, 0, -1))
    for sx in (-1, 1):
        crenel(cd, V(sx * xw, 0, zc0), V(sx * xw, 0, zc1), ycd, V(sx, 0, 0))
        crenel(cd, V(sx * xw, 0, zc1), V(sx * 1.3, 0, zc1), ycd, V(0, 0, 1))
    stairs(cd, 0.0, zc1, YD, ycd, 1, width=1.1, rail_side=None)
    # forecastle platform
    zf0, zf1 = h.z(0.84, 3.6), h.z(0.97, 4.3)
    yfc = 4.3
    poly = [(-2.25, zf0), (2.25, zf0), (0.9, zf1), (-0.9, zf1)]
    for k in range(4):
        (x0, z0), (x1, z1) = poly[k], poly[(k + 1) % 4]
        nrm = V(z1 - z0, 0, -(x1 - x0)).normalized() * -1
        if k == 0:
            plank_wall(cd, V(-x0, 0, z0), V(-x1, 0, z1), YD, yfc, V(0, 0, -1))
        else:
            crenel(cd, V(x0, 0, z0), V(x1, 0, z1), yfc, nrm)
    fm = Geo()
    fm.face([V(x, yfc, z) for x, z in poly], "TC_Wood", None, "flat", V(0, 0, 1), out=V(0, 1, 0))
    cd.extend(fm)
    box(cd, "TC_WoodDark", (4.6, 0.22, 0.22), T(0, yfc - 0.1, zf0 - 0.05), bevel=0.04)
    for x in (-1.5, 1.5):
        crenel(cd, V(x - 0.7, 0, zf0), V(x + 0.7, 0, zf0), yfc, V(0, 0, -1), h_=0.6)
    stairs(cd, 0.0, zf0, YD, yfc, -1, width=1.0)
    # mast, crow's nest, yard and sail
    cyl(cd, "TC_WoodDark", V(0, YD - 0.2, z_m), V(0, 16.2, z_m), 0.42, 0.3, seg=12)
    for y in (5.0, 8.0, 11.0):
        cyl(cd, "TC_Iron", V(0, y, z_m), V(0, y + 0.14, z_m), 0.42, seg=12)
    lathe(cd, "TC_Wood", [(0.32, 14.9), (0.95, 15.35), (1.0, 16.25)], T(0, 0, z_m), seg=12, cap=False)
    lathe(cd, "TC_Wood", [(0.9, 16.25), (0.88, 15.5), (0.3, 15.1)], T(0, 0, z_m), seg=12, cap=False)
    torus(cd, "TC_Gold", 0.98, 0.07, T(0, 16.3, z_m), seg=14, rseg=4)
    cyl(cd, "TC_WoodDark", V(0, 16.0, z_m), V(0, 20.2, z_m), 0.18, 0.1, seg=8)
    sphere(cd, "TC_Gold", 0.2, T(0, 20.32, z_m), seg=8, rings=5)
    pennant(cd, V(0, 20.0, z_m), 6.0, 0.7)
    an["masthead"] = V(0, 20.52, z_m)
    yard(cd, V(0, 14.4, z_m + 0.65), 5.8, 0.24, 0.11)
    sd = square_sail(cd, V(0, 14.22, z_m + 0.78), 10.8, 11.6, 8.3, 1.5)
    rope(cd, [V(0, 15.0, z_m + 0.3), V(0, h.wall_top(1.0) + 0.2, h.z(1.0, h.wall_top(1.0)) + 0.1)], 0.07)
    rope(cd, [V(0, 16.0, z_m - 0.3), V(0, ycd + 0.9, zc0 + 0.9)], 0.06)
    for sx in (-1, 1):
        rope(cd, [V(sx * 5.55, 14.4, z_m + 0.65), V(sx * xw, ycd + 0.9, zc1 - 0.3)], 0.04, seg=3)
        rope(cd, [V(sx * 5.55, 14.4, z_m + 0.65), V(sx * 0.3, 16.0, z_m)], 0.035, seg=3)
        clew = sd["clew_r"] if sx > 0 else sd["clew_l"]
        p, n = hull_side(h, -1.0, 2.9)
        rope(cd, [clew, V(sx * p.x, p.y, p.z)], 0.04, seg=3)
    # bowsprit
    b0, b1 = V(0, 3.9, 8.3), V(0, 5.4, 12.6)
    cyl(cd, "TC_WoodDark", b0, b1, 0.26, 0.14, seg=8)
    rope(cd, [b1 - (b1 - b0).normalized() * 0.2, V(0, 15.6, z_m + 0.4)], 0.05)
    # cargo
    for x, zz, rot in ((1.2, 2.2, 6), (1.25, 3.2, -4), (-1.3, 2.4, 10), (1.2, 2.7, 0)):
        crate(cd, T(x, YD if rot != 0 else YD + 0.9, zz) @ R("Y", rot), 0.88)
    crate(cd, T(-1.25, YD, 3.4) @ R("Y", -15), 0.8)
    for x, zz in ((-1.5, -1.7), (-0.75, -1.9), (-1.2, -1.0), (1.5, -1.4)):
        barrel(cd, T(x, YD, zz))
    barrel(cd, T(-1.1, YD + 0.92, -1.55) @ R("X", 90) @ T(0, -0.45, 0), 0.9)
    for x, zz in ((0.3, 5.0), (0.95, 4.8), (0.6, 5.5)):
        sack(cd, T(x, YD, zz) @ R("Y", 30 * x))
    rope_coil(cd, T(-0.6, YD, 5.2))
    # stern lantern on an iron hook at the parapet
    hook = [V(0, ycd + 0.75, zc0 + 0.05), V(0, ycd + 1.05, zc0 - 0.35), V(0, ycd + 1.0, zc0 - 0.7)]
    tube(cd, "TC_Iron", hook, 0.05, seg=5)
    lantern(cd, hook[-1] - V(0, 1.05, 0), 0.75)
    an["lantern_0"] = hook[-1] - V(0, 1.05 - 0.3, 0)
    an["lantern_hook_0"] = hook[-1]
    an["deck"] = V(0, YD, 0.0)
    an["castle_deck"] = V(0, ycd, (zc0 + zc1) / 2)
    an["bowsprit_tip"] = b1
    g.extend(cd)
    notes = dict(waterline=[round(h.z(0, 0), 3), round(h.z(1, 0), 3)], decks=dict(main=YD, castle=ycd, forecastle=yfc))
    return g, an, 18000, notes, dict(ao_dist=2.5)


def build_gondola():
    sheer = lambda s: 0.42 + 0.62 * max(0.0, (s - 0.72) / 0.28) ** 2 + 0.42 * max(0.0, (0.25 - s) / 0.25) ** 2
    h = Hull(B=0.86, K=-0.3, ymax=0.15, ytop=1.2, p=2.0, tumble=0.04, bow_s0=0.45, bow_a=(1.5, 1.9), bow_b=0.8, stern_s0=0.5, stern_pow=1.4,
             wtr=[(-0.3, 0.0), (1.2, 0.0)], zs=(-3.15, -3.5), zb=(3.05, 3.55), top=sheer, bh=0.0, t=0.07)
    ST = station_list([(0, 0.15, 0.03), (0.15, 0.85, 0.07), (0.85, 1.0, 0.03)])
    half, cd = Geo(), Geo()
    an = {}
    planking(half, ST, h.P, h.normal, lambda s: h.K, sheer, 5, lambda k: "TC_PaintBlue" if k == 4 else "TC_WoodDark", style="plain", cls="round")
    ins = lambda s, y: (lambda p: V(max(p.x, 0.0), p.y, p.z))(h.P(s, y) - h.normal(s, y) * 0.07)
    planking(half, [s for s in ST if 0.04 <= s <= 0.96], ins, lambda s, y: -h.normal(s, y), lambda s: h.K + 0.08, sheer, 3, lambda k: "TC_Wood", style="plain", cls="round")
    cap_rail(half, h, [s for s in ST if 0.02 <= s <= 0.98], sheer, w_out=0.05, w_in=0.05, h0=-0.05, h1=0.06)
    SC = ST[::2]
    molding(half, [h.P(s, sheer(s) - 0.1) for s in SC], [h.nh(s, sheer(s) - 0.1) for s in SC], "TC_Gold", w=0.05, h=0.05)
    g = Geo()
    g.extend(half)
    g.extend(half.mirrored_x())
    rect_deck(cd, -0.5, 0.5, -1.9, 1.9, -0.12)
    deck_planks(cd, h, ST, 0.8, 0.95, 0.5)
    deck_planks(cd, h, ST, 0.06, 0.2, 0.5)
    # seats: a bench and a cushioned passenger seat with a back
    box(cd, "TC_Wood", (1.3, 0.1, 0.42), T(0, 0.22, 1.05), bevel=0.03)
    box(cd, "TC_PaintBlue", (1.2, 0.16, 0.62), T(0, 0.2, -0.4), bevel=0.06)
    box(cd, "TC_WoodDark", (1.3, 0.3, 0.7), T(0, 0.0, -0.4), bevel=0.04)
    box(cd, "TC_PaintBlue", (1.15, 0.5, 0.12), T(0, 0.55, -0.8) @ R("X", -12), bevel=0.05)
    box(cd, "TC_Gold", (1.25, 0.06, 0.16), T(0, 0.82, -0.86) @ R("X", -12), bevel=0.0)
    an["seat_0"] = V(0, 0.27, 1.05)
    an["seat_1"] = V(-0.3, 0.28, -0.4)
    an["seat_2"] = V(0.3, 0.28, -0.4)
    # swan-neck prow with the gold claw, upturned stern
    zt = h.z(1.0, sheer(1.0))
    neck = [V(0, sheer(1.0) - 0.15, zt - 0.15), V(0, 1.25, zt + 0.12), V(0, 1.7, zt + 0.25), V(0, 2.1, zt + 0.12), V(0, 2.3, zt - 0.15)]
    tube(cd, "TC_WoodDark", neck, [0.13, 0.12, 0.1, 0.085, 0.07], seg=8)
    tube(cd, "TC_Gold", [p + V(0, 0, 0.1) for p in neck[1:4]], 0.04, seg=4)
    claw(cd, onplane(neck[-1] + V(0, 0.05, 0), V(1, 0, 0), up=V(0, 0.6, 0.8)) @ S(0.24), sc=0.24, o=1.0, teeth=False)
    an["prow_ornament"] = neck[-1] + V(0, 0.75, 0.4)
    zs_ = h.z(0.0, sheer(0.0))
    tail = [V(0, sheer(0.0) - 0.1, zs_ + 0.1), V(0, 1.0, zs_ - 0.12), V(0, 1.25, zs_ - 0.2)]
    tube(cd, "TC_WoodDark", tail, [0.1, 0.08, 0.06], seg=6)
    sphere(cd, "TC_Gold", 0.09, T(*(tail[-1] + V(0, 0.06, 0))), seg=8, rings=5)
    # forcola and oar on the +x side aft
    fz = -2.15
    fx = h.half(h.s_at(fz, 0.5), 0.5)
    extrude(cd, "TC_WoodDark", [(-0.14, 0.0), (0.14, 0.0), (0.12, 0.35), (0.2, 0.55), (0.06, 0.62), (0.02, 0.45), (-0.08, 0.5), (-0.16, 0.42), (-0.1, 0.3)], 0.12, T(fx - 0.05, sheer(h.s_at(fz, 0.5)), fz) @ R("Y", 90), grain="y", bevel=0.02)
    o0, o1 = V(fx - 0.5, 1.0, fz + 1.4), V(fx + 0.45, -0.3, fz - 2.2)
    cyl(cd, "TC_Wood", o0, o1, 0.045, seg=6)
    od = (o1 - o0).normalized()
    box(cd, "TC_Wood", (0.05, 0.9, 0.22), frame(o1 - od * 0.6, o1 + od * 0.3, up=V(1, 0, 0)) @ T(0, 0.45, 0), bevel=0.02, grain="y")
    an["gondolier"] = V(0, 0.5, -2.6)
    g.extend(cd)
    return g, an, 3000, dict(waterline=[round(h.z(0, 0), 3), round(h.z(1, 0), 3)]), dict(ao_dist=1.2)


def build_pier():
    g = Geo()
    an = {}
    L, W = 10.0, 6.0
    n = 20
    for k in range(n):
        za, zb_ = -L / 2 + L * k / n, -L / 2 + L * (k + 1) / n
        jit = 0.06 * ((k * 7) % 3 - 1)
        zs_ = [za, za + 0.04, zb_ - 0.04, zb_]
        dy = [-0.03, 0, 0, -0.03]
        for j in range(3):
            q = [V(-W / 2 - 0.05 + jit, dy[j], zs_[j]), V(W / 2 + 0.05 + jit, dy[j], zs_[j]), V(W / 2 + 0.05 + jit, dy[j + 1], zs_[j + 1]), V(-W / 2 - 0.05 + jit, dy[j + 1], zs_[j + 1])]
            g.face(q, "TC_Wood", [(p.x * D_WOOD, (p.z - za) * D_WOOD) for p in q], "flat", out=V(0, 1, 0))
    for sx in (-1, 1):
        box(g, "TC_WoodDark", (0.22, 0.42, L), T(sx * (W / 2 + 0.14), -0.25, 0), bevel=0.04, grain="z")
        for x in (sx * 1.0,):
            box(g, "TC_WoodDark", (0.3, 0.3, L), T(x, -0.2, 0), bevel=0.0, grain="z")
    for zz in (-2.5, 2.5):
        box(g, "TC_WoodDark", (W + 0.7, 0.36, 0.42), T(0, -0.42, zz), bevel=0.05)
        for sx in (-1, 1):
            x = sx * 2.75
            cyl(g, "TC_WoodDark", V(x, -6.0, zz), V(x, -0.22, zz), 0.34, 0.31, seg=8, cap0=False)
            cyl(g, "TC_Iron", V(x, -1.0, zz), V(x, -0.84, zz), 0.355, seg=8, cap0=False, cap1=False)
            cyl(g, "TC_WoodDark", V(x, -0.62, zz), V(x, -0.22, zz), 0.36, seg=8, cap0=False)
        a, b = V(-2.75, -0.7, zz), V(2.75, -3.8, zz)
        box(g, "TC_WoodDark", (0.2, (b - a).length, 0.2), frame(a, b, up=V(0, 0, 1)) @ T(0, (b - a).length / 2, 0), bevel=0.0, grain="y")
    for sx in (-1, 1):
        a, b = V(sx * 2.75, -0.7, -2.5), V(sx * 2.75, -3.8, 2.5)
        box(g, "TC_WoodDark", (0.2, (b - a).length, 0.2), frame(a, b, up=V(1, 0, 0)) @ T(0, (b - a).length / 2, 0), bevel=0.0, grain="y")
    # rope rail on +x: posts every 2.5 so the sag meets the next module at its lowest point
    xr = W / 2 - 0.15
    for zz in (-3.75, -1.25, 1.25, 3.75):
        box(g, "TC_WoodDark", (0.22, 0.95, 0.22), T(xr, 0.45, zz), bevel=0.04, grain="y")
        cyl(g, "TC_Iron", V(xr, 0.92, zz), V(xr, 0.98, zz), 0.15, seg=6)
    pts = []
    spans = [(-6.25, -3.75), (-3.75, -1.25), (-1.25, 1.25), (1.25, 3.75), (3.75, 6.25)]
    for za, zb_ in spans:
        for i in range(9):
            t = i / 8
            z = lerp(za, zb_, t)
            if -5.0 - 1e-6 <= z <= 5.0 + 1e-6 and (not pts or z > pts[-1].z + 1e-6):
                pts.append(V(xr, 0.8 - 0.14 * math.sin(PI * t), z))
    rope(g, pts, 0.055, seg=5)
    an["rope_rail_x"] = V(xr, 0.8, 0)
    # bollards on the open -x edge, ladder down to the water
    for zz in (-2.5, 2.5):
        lathe(g, "TC_WoodDark", [(0.3, 0.0), (0.28, 0.25), (0.22, 0.45), (0.3, 0.55), (0.3, 0.68), (0.0, 0.72)], T(-2.55, 0.0, zz), seg=10, cap=False)
        cyl(g, "TC_Iron", V(-2.55, 0.5, zz), V(-2.55, 0.6, zz), 0.31, seg=10, cap0=False, cap1=False)
        an[f"bollard_{0 if zz < 0 else 1}"] = V(-2.55, 0.72, zz)
    for sx in (-0.45, 0.45):
        box(g, "TC_WoodDark", (0.12, 3.2, 0.12), T(-W / 2 - 0.32, -1.2, sx), bevel=0.0, grain="y")
    for k in range(5):
        box(g, "TC_Wood", (0.1, 0.08, 0.9), T(-W / 2 - 0.32, -0.25 - k * 0.5, 0), bevel=0.0, grain="z")
    an["ladder"] = V(-W / 2 - 0.32, 0.0, 0.0)
    notes = dict(tile_length=L, tile_axis="z", deck_top=0.0, post_depth=6.0)
    return g, an, 2500, notes, dict(ao_dist=1.5)


def flag_grid(g, x0, x1, z0, z1, y, nx, nz, mat, jd=0.05, jw=0.06, dark=None, seed=1):
    """Flagstones with chamfered joints; dark: fraction of stones in TC_LimestoneDark."""
    rnd = random.Random(seed)
    for i in range(nx):
        for j in range(nz):
            xa, xb = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
            za, zb_ = z0 + (z1 - z0) * j / nz, z0 + (z1 - z0) * (j + 1) / nz
            m = "TC_LimestoneDark" if dark and rnd.random() < dark else mat
            o = [V(xa, y - jd, za), V(xb, y - jd, za), V(xb, y - jd, zb_), V(xa, y - jd, zb_)]
            dy = rnd.uniform(-0.015, 0.015)
            c = [V(xa + jw, y + dy, za + jw), V(xb - jw, y + dy, za + jw), V(xb - jw, y + dy, zb_ - jw), V(xa + jw, y + dy, zb_ - jw)]
            g.face(c, m, [(p.x * D_STONE, p.z * D_STONE) for p in c], "flat", out=V(0, 1, 0))
            for k in range(4):
                q = [o[k], o[(k + 1) % 4], c[(k + 1) % 4], c[k]]
                g.face(q, m, [(p.x * D_STONE, p.z * D_STONE) for p in q], "flat", out=V(0, 1, 0))


def ashlar_face(g, x0, x1, y0, y1, z, course=0.9, block=1.5, jd=0.06, jw=0.07, wet=-2.4, seed=3):
    """Vertical ashlar wall in the plane z facing +z; courses alternate a half-block offset (tiles in x)."""
    rnd = random.Random(seed)
    nc = int(round((y1 - y0) / course))
    for c_ in range(nc):
        ya, yb = y1 - (c_ + 1) * (y1 - y0) / nc, y1 - c_ * (y1 - y0) / nc
        off = (block / 2) if c_ % 2 else 0.0
        edges = [x0]
        x = x0 + (block - off if off else block)
        while x < x1 - 1e-6:
            edges.append(x)
            x += block
        edges.append(x1)
        for a, b in zip(edges, edges[1:]):
            m = "TC_LimestoneDark" if (yb <= wet + 1e-6 or rnd.random() < 0.12) else "TC_Limestone"
            dz = rnd.uniform(0.0, 0.04)
            o = [V(a, ya, z - jd), V(b, ya, z - jd), V(b, yb, z - jd), V(a, yb, z - jd)]
            cc = [V(a + jw, ya + jw, z + dz), V(b - jw, ya + jw, z + dz), V(b - jw, yb - jw, z + dz), V(a + jw, yb - jw, z + dz)]
            g.face(cc, m, [(p.x * D_STONE, p.y * D_STONE) for p in cc], "flat", out=V(0, 0, 1))
            for k in range(4):
                q = [o[k], o[(k + 1) % 4], cc[(k + 1) % 4], cc[k]]
                g.face(q, m, [(p.x * D_STONE, p.y * D_STONE) for p in q], "flat", out=V(0, 0, 1))


def bollard_gold(g, p):
    lathe(g, "TC_Iron", [(0.34, 0.0), (0.3, 0.15), (0.23, 0.5), (0.3, 0.62), (0.34, 0.7)], T(*p), seg=10, cap=False)
    lathe(g, "TC_Gold", [(0.34, 0.7), (0.3, 0.8), (0.15, 0.87), (0.0, 0.9)], T(*p), seg=10, cap=False)


def build_quay(steps=True):
    g = Geo()
    an = {}
    L, Dp, H = 12.0, 6.0, 8.0
    zf = Dp / 2  # face plane
    # coping stones along the edge, paving behind
    for k in range(8):
        xa = -L / 2 + 1.5 * k
        box(g, "TC_Limestone", (1.48, 0.55, 1.3), T(xa + 0.75, -0.275, zf - 0.5), bevel=0.06)
    flag_grid(g, -L / 2, L / 2, -Dp / 2, zf - 1.15, 0.0, 6, 3, "TC_Limestone", dark=0.15, seed=5)
    ashlar_face(g, -L / 2, L / 2, -3.6, -0.55, zf - 0.02, seed=7)
    for ya, yb in ((-H, -3.6),):
        q = [V(-L / 2, ya, zf - 0.08), V(L / 2, ya, zf - 0.08), V(L / 2, yb, zf - 0.08), V(-L / 2, yb, zf - 0.08)]
        g.face(q, "TC_LimestoneDark", [(p.x * D_STONE, p.y * D_STONE) for p in q], "flat", out=V(0, 0, 1))
    box(g, "TC_LimestoneDark", (L, 0.25, 0.25), T(0, -3.62, zf + 0.02), bevel=0.05)
    # mooring rings on the face
    for x in (-3.75, 3.75) if steps else (-3.0, 3.0):
        box(g, "TC_Iron", (0.4, 0.4, 0.08), T(x, -1.15, zf + 0.06), bevel=0.02)
        torus(g, "TC_Iron", 0.28, 0.055, T(x, -1.47, zf + 0.14) @ R("X", 90), seg=12, rseg=4)
        an[f"ring_{0 if x < 0 else 1}"] = V(x, -1.6, zf + 0.15)
    for x in (-4.5, 4.6) if steps else (-3.0, 3.0):
        bollard_gold(g, V(x, 0.0, zf - 0.9))
        an[f"bollard_{0 if x < 0 else 1}"] = V(x, 0.9, zf - 0.9)
    if steps:
        # stair along the face, outside the coping, down to a landing
        sw = 1.35
        n = 10
        x_top = 1.9
        for k in range(n):
            y_t = -0.3 * (k + 1)
            xa = x_top - 0.5 * (k + 1)
            box(g, "TC_Limestone", (0.52, 0.32, sw), T(xa + 0.25, y_t - 0.12, zf + sw / 2), bevel=0.04)
        y_l = -0.3 * n
        box(g, "TC_Limestone", (2.4, 0.35, sw), T(x_top - 0.5 * n - 1.2, y_l - 0.15, zf + sw / 2), bevel=0.04)
        # solid stone under the flight
        xa, xb = x_top - 0.5 * n - 2.4, x_top
        prof = [(xa, y_l - 0.3), (x_top - 0.5 * n, y_l - 0.3), (xb, -0.3), (xb, -H), (xa, -H)]
        extrude(g, "TC_LimestoneDark", [(x, y) for x, y in prof], sw - 0.1, T(0, 0, zf + sw / 2 - 0.02), grain="x", bevel=0.0)
        # low parapet on the outer edge of the flight
        xl = x_top - 0.5 * n
        extrude(g, "TC_Limestone", [(xb, -0.35), (xb, 0.42), (xl, y_l + 0.42), (xl - 2.4, y_l + 0.42), (xl - 2.4, y_l - 0.35)], 0.26, T(0, 0, zf + sw - 0.1), grain="x", bevel=0.05)
        an["steps_top"] = V(x_top - 0.25, 0.0, zf + sw / 2)
        an["steps_bottom"] = V(x_top - 0.5 * n - 1.2, y_l, zf + sw / 2)
    notes = dict(tile_length=L, tile_axis="x", top=0.0, face_z=zf, face_depth=H, intended_freeboard=[1.5, 2.5])
    return g, an, 2500, notes, dict(ao_dist=1.5)


def build_crane():
    g = Geo()
    an = {}
    # timber platform
    px, pz0, pz1 = 2.6, -3.6, 3.4
    for sx in (-1, 1):
        box(g, "TC_WoodDark", (0.4, 0.42, pz1 - pz0), T(sx * (px - 0.2), 0.21, (pz0 + pz1) / 2), bevel=0.05, grain="z")
    for zz in (pz0 + 0.2, 0.0, pz1 - 0.2):
        box(g, "TC_WoodDark", (2 * px, 0.36, 0.4), T(0, 0.18, zz), bevel=0.05)
    rect_deck(g, -px + 0.3, px - 0.3, pz0 + 0.3, pz1 - 0.3, 0.42)
    # treadwheel (axis x) where crabs walk
    wz, wy, wr = -1.1, 3.25, 2.6
    for sx in (-0.8, 0.8):
        torus(g, "TC_WoodDark", wr, 0.13, T(sx, wy, wz) @ R("Z", 90), seg=24, rseg=4)
        for k in range(8):
            a = 2 * PI * k / 8 + PI / 8
            d = V(0, math.cos(a), math.sin(a))
            p0, p1 = V(sx, wy, wz) + d * 0.2, V(sx, wy, wz) + d * (wr - 0.05)
            box(g, "TC_Wood", (0.12, (p1 - p0).length, 0.14), frame(p0, p1, up=V(1, 0, 0)) @ T(0, (p1 - p0).length / 2, 0), bevel=0.0, grain="y")
    for k in range(24):
        a = 2 * PI * k / 24
        c = V(0, wy + (wr - 0.1) * math.cos(a), wz + (wr - 0.1) * math.sin(a))
        box(g, "TC_Wood", (0.36, 1.75, 0.08), onplane(c, V(0, -math.cos(a), -math.sin(a)), up=V(1, 0, 0)), bevel=0.0)
    cyl(g, "TC_Iron", V(-1.45, wy, wz), V(1.45, wy, wz), 0.16, seg=8)
    cyl(g, "TC_WoodDark", V(1.0, wy, wz), V(1.4, wy, wz), 0.42, seg=10)
    for sx in (-1.45, 1.45):
        sphere(g, "TC_Gold", 0.17, T(sx, wy, wz), seg=8, rings=5)
    an["wheel_inside"] = V(0, 0.7, wz)
    # A-frames holding the axle
    for sx in (-1.3, 1.3):
        for dz in (-1.3, 1.3):
            a, b = V(sx, 0.4, wz + dz), V(sx, wy + 0.1, wz)
            box(g, "TC_WoodDark", (0.24, (b - a).length + 0.2, 0.24), frame(a, b, up=V(1, 0, 0)) @ T(0, (b - a).length / 2, 0), bevel=0.04, grain="y")
    # mast, jib, strut, braces
    mz = 1.7
    box(g, "TC_WoodDark", (0.62, 11.0, 0.62), T(0, 0.42 + 5.5, mz), bevel=0.07, grain="y")
    sphere(g, "TC_Gold", 0.26, T(0, 11.62, mz), seg=10, rings=6)
    pennant(g, V(0, 11.5, mz), 3.0, 0.5)
    for sx in (-1, 1):
        a, b = V(sx * 2.2, 0.42, mz), V(0, 4.2, mz)
        box(g, "TC_WoodDark", (0.26, (b - a).length, 0.26), frame(a, b, up=V(0, 0, 1)) @ T(0, (b - a).length / 2, 0), bevel=0.04, grain="y")
    for dz in (-1, 1):
        a, b = V(0, 0.42, mz + dz * 1.6), V(0, 3.8, mz)
        box(g, "TC_WoodDark", (0.26, (b - a).length, 0.26), frame(a, b, up=V(1, 0, 0)) @ T(0, (b - a).length / 2, 0), bevel=0.04, grain="y")
    j0, j1 = V(0, 9.3, mz + 0.2), V(0, 13.6, mz + 7.6)
    Lj = (j1 - j0).length
    box(g, "TC_WoodDark", (0.48, Lj, 0.48), frame(j0, j1, up=V(1, 0, 0)) @ T(0, Lj / 2, 0), bevel=0.06, grain="y")
    s0, s1 = V(0, 4.6, mz + 0.3), j0.lerp(j1, 0.48)
    box(g, "TC_WoodDark", (0.34, (s1 - s0).length, 0.34), frame(s0, s1, up=V(1, 0, 0)) @ T(0, (s1 - s0).length / 2, 0), bevel=0.05, grain="y")
    for t in (0.3, 0.7):
        c = j0.lerp(j1, t)
        cyl(g, "TC_Iron", c - (j1 - j0).normalized() * 0.08, c + (j1 - j0).normalized() * 0.08, 0.36, seg=4)
    # pulleys and the hoist rope down to the hook
    tipc = j1 + V(0, -0.1, 0.25)
    for c, r in ((tipc, 0.42), (V(0, 11.2, mz + 0.45), 0.34)):
        cyl(g, "TC_Iron", c - V(0.12, 0, 0), c + V(0.12, 0, 0), r, seg=10)
        cyl(g, "TC_Gold", c - V(0.3, 0, 0), c + V(0.3, 0, 0), 0.08, seg=6)
    for sx in (-0.2, 0.2):
        box(g, "TC_Iron", (0.06, 0.7, 0.16), T(sx, tipc.y + 0.15, tipc.z - 0.05), bevel=0.0, grain="y")
    hook_y = 4.6
    rope(g, [V(1.2, wy + 0.42, wz), V(0.0, 11.2 - 0.34, mz + 0.45)], 0.05)
    rope(g, [V(0, 11.2 + 0.34, mz + 0.45), j0.lerp(j1, 0.5) + V(0, 0.32, 0), tipc + V(0, 0.42, 0)], 0.05)
    hp = tipc + V(0, -0.42, 0.42)
    rope(g, [V(0, tipc.y, tipc.z + 0.42), V(0, hook_y + 0.9, tipc.z + 0.42)], 0.05)
    box(g, "TC_WoodDark", (0.3, 0.55, 0.42), T(0, hook_y + 0.62, tipc.z + 0.42), bevel=0.05)
    tube(g, "TC_Iron", [V(0, hook_y + 0.35, tipc.z + 0.42), V(0, hook_y - 0.1, tipc.z + 0.42), V(0, hook_y - 0.35, tipc.z + 0.62), V(0, hook_y - 0.2, tipc.z + 0.85), V(0, hook_y, tipc.z + 0.82)], [0.08, 0.08, 0.075, 0.06, 0.035], seg=6)
    an["hook"] = V(0, hook_y - 0.35, tipc.z + 0.62)
    an["jib_tip"] = tipc
    # a small shingled roof over the wheel
    for sx in (-1, 1):
        for k in range(4):
            a = V(sx * (0.25 + 0.5 * k), 6.55 - 0.32 * k, wz)
            box(g, "TC_WoodDark", (0.62, 0.1, 3.3), T(a.x, a.y, a.z) @ R("Z", -sx * 33), bevel=0.02, grain="z")
    box(g, "TC_PaintBlue", (0.3, 0.3, 3.4), T(0, 6.68, wz), bevel=0.05, grain="z")
    for dz in (-1.55, 1.55):
        cyl(g, "TC_WoodDark", V(0, wy + 0.1, wz + dz * 0.84), V(0, 6.6, wz + dz), 0.12, seg=6)
    notes = dict(front="+z (jib reaches over the water)")
    return g, an, 6000, notes, dict(ao_dist=2.0)


def build_cargo():
    g = Geo()
    an = {}
    box(g, "TC_WoodDark", (2.4, 0.18, 1.6), T(-0.6, 0.09, 0.2), bevel=0.03)
    for x, z, y, sz, rot in ((-1.2, -0.2, 0.18, 0.95, 4), (-0.15, 0.1, 0.18, 0.95, -6), (-0.7, 0.0, 1.13, 0.85, 12), (1.2, 1.0, 0.0, 0.8, 20)):
        crate(g, T(x, y, z) @ R("Y", rot), sz)
    for x, z in ((1.3, -0.5), (2.05, -0.2), (1.75, 0.45)):
        barrel(g, T(x, 0, z))
    barrel(g, T(0.6, 0.38, -1.4) @ R("Z", 90) @ T(0, -0.45, 0) @ R("Y", 0), 0.9)
    for x, z in ((-2.2, 1.1), (-1.6, 1.4), (-2.0, 1.7)):
        sack(g, T(x, 0, z) @ R("Y", 50 * x))
    sack(g, T(-1.9, 0.5, 1.35) @ R("Z", 70) @ T(0, -0.2, 0))
    rope_coil(g, T(0.4, 0, 1.3), r=0.45, turns=4)
    rope_coil(g, T(-2.3, 0, -0.8), r=0.35)
    an["centre"] = V(0, 0, 0)
    return g, an, 3000, dict(footprint=[5.0, 3.6]), dict(ao_dist=1.2, ao_floor=0.0)


def scene_clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(path: Path, roots):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for r in roots:
        r.select_set(True)
        for c in r.children_recursive:
            c.select_set(True)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_extras=True, export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_animations=False,
        export_cameras=False, export_lights=False, export_image_format="NONE",
    )


# ---------------------------------------------------------------------------------------------
# Preview renders (EEVEE): procedural stand-ins for the runtime textures, water plane, sky, sun
# ---------------------------------------------------------------------------------------------
C_G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def g2b(m: Matrix) -> Matrix:
    return C_G2B @ m @ C_G2B.inverted()


def preview_material(name: str):
    m = mat_get(name)
    nt = m.node_tree
    nt.nodes.clear()
    look = MAT_LOOK[name]
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Metallic"].default_value = look.get("metal", 0.0)
    bsdf.inputs["Roughness"].default_value = look.get("rough", 0.6)
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    base = nt.nodes.new("ShaderNodeRGB")
    base.outputs[0].default_value = (*srgb(look["color"]), 1)
    col = base.outputs[0]
    uv = nt.nodes.new("ShaderNodeUVMap")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uv.outputs[0], sep.inputs[0])
    if name in ("TC_Wood", "TC_WoodDark"):
        # grain stretched along u, one plank per WOOD_STRIP of v (what the trim strip would show)
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        mu = nt.nodes.new("ShaderNodeMath"); mu.operation = "MULTIPLY"; mu.inputs[1].default_value = 3.0
        mv = nt.nodes.new("ShaderNodeMath"); mv.operation = "MULTIPLY"; mv.inputs[1].default_value = 60.0
        nt.links.new(sep.outputs[0], mu.inputs[0]); nt.links.new(sep.outputs[1], mv.inputs[0])
        nt.links.new(mu.outputs[0], comb.inputs[0]); nt.links.new(mv.outputs[0], comb.inputs[1])
        nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 1.0; nz.inputs["Detail"].default_value = 3.0
        nt.links.new(comb.outputs[0], nz.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.3; ramp.color_ramp.elements[0].color = (0.72, 0.72, 0.72, 1)
        ramp.color_ramp.elements[1].position = 0.7; ramp.color_ramp.elements[1].color = (1.15, 1.1, 1.05, 1)
        nt.links.new(nz.outputs[0], ramp.inputs[0])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.inputs[0].default_value = 1.0
        nt.links.new(col, mix.inputs[6]); nt.links.new(ramp.outputs[0], mix.inputs[7])
        col = mix.outputs[2]
    if name == "TC_Sail":
        # crest stand-in: blue disc in a gold ring at the centre of the sail's own UV square
        sub = nt.nodes.new("ShaderNodeVectorMath"); sub.operation = "DISTANCE"
        sub.inputs[1].default_value = (0.5, 0.5, 0.0)
        nt.links.new(uv.outputs[0], sub.inputs[0])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        cr = ramp.color_ramp
        cr.interpolation = "CONSTANT"
        cr.elements[0].position = 0.0; cr.elements[0].color = (*srgb("#1d5aa6"), 1)
        e = cr.elements.new(0.17); e.color = (*srgb("#e0b043"), 1)
        e = cr.elements.new(0.205); e.color = (*srgb(look["color"]), 1)
        cr.elements[1].position = 0.205; cr.elements[1].color = (*srgb(look["color"]), 1)
        nt.links.new(sub.outputs["Value"], ramp.inputs[0])
        col = ramp.outputs[0]
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs[0].default_value = 1.0
    nt.links.new(col, mul.inputs[6]); nt.links.new(vc.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    m.use_backface_culling = name != "TC_Sail"


def simple_mat(name, hexcol, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexcol), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(emit[0]), 1)
        b.inputs["Emission Strength"].default_value = emit[1]
    return m


def setup_preview_world():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 48
    try:
        sc.eevee.use_raytracing = True
        sc.eevee.ray_tracing_options.resolution_scale = "2"
    except Exception:
        pass
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 90
    w = bpy.data.worlds.new("sky")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    # world "Generated" z runs at about half the sine of the view elevation
    cr.elements[0].position = 0.0; cr.elements[0].color = (*srgb("#f2d9b0"), 1)
    e = cr.elements.new(0.035); e.color = (*srgb("#9cc6ec"), 1)
    e = cr.elements.new(0.16); e.color = (*srgb("#4f8fdc"), 1)
    cr.elements[-1].position = 0.42; cr.elements[-1].color = (*srgb("#2a62c4"), 1)
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs[2], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = 1.1
    nt.links.new(bg.outputs[0], out.inputs[0])
    # water
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, 0))
    wp = bpy.context.active_object
    wp.name = "water"
    wm = bpy.data.materials.new("water")
    wm.use_nodes = True
    b = wm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb("#1d6f8c"), 1)
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Specular IOR Level"].default_value = 0.6
    nz = wm.node_tree.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 0.6
    bump = wm.node_tree.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.08
    mp = wm.node_tree.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1, 1, 1)
    tc2 = wm.node_tree.nodes.new("ShaderNodeTexCoord")
    wm.node_tree.links.new(tc2.outputs["Object"], mp.inputs[0])
    wm.node_tree.links.new(mp.outputs[0], nz.inputs["Vector"])
    wm.node_tree.links.new(nz.outputs[0], bump.inputs["Height"])
    wm.node_tree.links.new(bump.outputs[0], b.inputs["Normal"])
    wp.data.materials.append(wm)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.2
    sun.color = srgb("#ffd6a0")
    sun.angle = math.radians(2.5)
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam")
    cam.clip_start = 0.1
    cam.clip_end = 3000
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    cube = bpy.data.meshes.new("crabcube")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(cube)
    bm.free()
    cube.materials.append(simple_mat("crab", "#d8452f", 0.4))
    for n in MATS:
        preview_material(n)
    return so, co, cube


PLACED: list = []


def place(name: str, m: Matrix):
    src = bpy.data.objects[name + "_mesh"]
    o = bpy.data.objects.new(f"{name}_{len(PLACED)}", src.data)
    bpy.context.scene.collection.objects.link(o)
    o.matrix_world = g2b(m)
    o["piece"] = name
    PLACED.append(o)
    return o


def crab_cube(cube_mesh, x, y, z, host="cube"):
    o = bpy.data.objects.new(f"crabcube_{len(PLACED)}", cube_mesh)
    bpy.context.scene.collection.objects.link(o)
    o.matrix_world = g2b(T(x, y + 0.5, z))
    o["piece"] = host
    PLACED.append(o)


def shoot(path, sun, cam, pos, target, lens=35, az=55, el=24, res=(1600, 900), only=None):
    for o in PLACED:
        o.hide_render = bool(only) and o["piece"] not in only
    pos, target = Vector(pos), Vector(target)
    f = (target - pos)
    fh = V(f.x, 0, f.z).normalized()
    left = V(0, 1, 0).cross(fh)
    toward = (-fh * math.cos(math.radians(az)) + left * math.sin(math.radians(az))) * math.cos(math.radians(el)) + V(0, 1, 0) * math.sin(math.radians(el))
    d = to_bl(-toward)
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.location = to_bl(pos)
    cam.rotation_euler = (to_bl(target) - to_bl(pos)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print("RENDER", path)


# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------
def galleon_piece(furl):
    g, h, ST, grid = build_galleon()
    pts = galleon_rig(g, h, furl=furl)
    an = galleon_details(g, h, ST)
    for k in ("fore", "main", "mizzen"):
        an[f"masthead_{k}"] = pts[k]["masthead"]
    an["bowsprit_tip"] = pts["bowsprit"][1]
    notes = dict(waterline=[round(h.z(0, 0), 3), round(h.z(1, 0), 3)], decks={d[0]: d[3] for d in GAL["decks"]})
    return g, an, 45000, notes, dict(ao_dist=3.0)


def b_galleon():
    return galleon_piece(False)


def b_galleon_furled():
    return galleon_piece(True)


BUILDERS = {
    "TC_Galleon": b_galleon,
    "TC_GalleonFurled": b_galleon_furled,
    "TC_Cog": build_cog,
    "TC_Gondola": build_gondola,
    "TC_Pier_10": build_pier,
    "TC_Quay_12": lambda: build_quay(True),
    "TC_Quay_12_Plain": lambda: build_quay(False),
    "TC_Crane": build_crane,
    "TC_CargoSet": build_cargo,
}


def main():
    scene_clear()
    only = [s for s in args.only.split(",") if s]
    roots = []
    for name, fn in BUILDERS.items():
        if only and name not in only:
            continue
        g, anchors, budget, notes, aop = fn()
        roots.append(piece(name, g, anchors, budget, notes, **aop))
    export_glb(Path(args.out), roots)
    if args.pieces:
        Path(args.pieces).write_text(json.dumps(dict(meta=META, pieces=PIECES), indent=1) + "\n")
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
    if args.render:
        render_shots(Path(args.render), [s for s in args.shots.split(",") if s])


def render_shots(outdir: Path, shots):
    outdir.mkdir(parents=True, exist_ok=True)
    for r in [o for o in bpy.context.scene.objects if o.type == "EMPTY"]:
        for c in r.children:
            c.hide_render = True
    sun, cam, cube = setup_preview_world()
    have = {o.name[:-5] for o in bpy.data.objects if o.name.endswith("_mesh")}
    S_ = {}
    Y = 2.0  # quay and pier tops sit 2 above the water
    put = lambda n, m: place(n, m) if n in have else None
    # quay line along x with its face at z = 0, one module with steps
    for k, x in enumerate(range(-42, 43, 12)):
        put("TC_Quay_12" if x == -18 else "TC_Quay_12_Plain", T(x, Y, -3.0))
    # pier out to sea, galleon on its open (-x) side, cog along the quay, gondolas by the steps
    for k in range(4):
        put("TC_Pier_10", T(0, Y, 5.0 + 10 * k))
    put("TC_Galleon", T(-9.6, 0, 21.0))
    put("TC_GalleonFurled", T(-44.0, 0, 34.0) @ R("Y", 160))
    put("TC_Cog", T(21.0, 0, 4.6) @ R("Y", 90))
    put("TC_Gondola", T(-23.5, 0, 2.7) @ R("Y", 92))
    put("TC_Gondola", T(-30.5, 0, 4.4) @ R("Y", 70))
    put("TC_Gondola", T(-14.0, 0, 9.5) @ R("Y", 150))
    put("TC_Crane", T(10.0, Y, -3.6))
    put("TC_CargoSet", T(4.5, Y, -3.2) @ R("Y", 10))
    put("TC_CargoSet", T(14.5, Y, -2.6) @ R("Y", 190))
    for x, y, z, host in ((1.0, Y, 9.0, "TC_Pier_10"), (-1.4, Y, 22.5, "TC_Pier_10"), (-17.0, Y, -1.6, "TC_Quay_12"), (-9.0, 2.7, 21.5, "TC_Galleon"),
                          (12.0, Y, -1.0, "TC_Crane"), (20.2, 2.0, 4.6, "TC_Cog"), (-47.0, 2.7, 33.0, "TC_GalleonFurled")):
        crab_cube(cube, x, y, z, host)
    S_["hero"] = dict(pos=(42, 16, 66), target=(-2, 8.5, 13), lens=27)
    G = ("TC_Galleon",)
    S_["galleon-side"] = dict(pos=(-72, 12, 21), target=(-9.6, 14, 21), lens=30, only=G)
    S_["galleon-front"] = dict(pos=(-38, 9, 70), target=(-9.6, 13, 24), lens=26, only=G + ("TC_Pier_10",))
    S_["galleon-stern"] = dict(pos=(-32, 9, -8), target=(-9.6, 6.5, 6), lens=30, only=G)
    S_["galleon-bow"] = dict(pos=(-20, 6, 52), target=(-9.6, 4.5, 38), lens=30, only=G)
    S_["galleon-deck"] = dict(pos=(-6.1, 7.5, 33), target=(-10.1, 4.5, 15), lens=22)
    S_["cog"] = dict(pos=(40, 9, 26), target=(21, 7, 4), lens=30)
    S_["galleon-furled"] = dict(pos=(-6, 11, 76), target=(-44, 12, 34), lens=30, only=("TC_GalleonFurled",))
    S_["cog-alone"] = dict(pos=(44, 7, 24), target=(21, 7, 4), lens=30, only=("TC_Cog",))
    S_["crane"] = dict(pos=(26, 7, 14), target=(10, 6.5, -3), lens=30, only=("TC_Crane", "TC_Quay_12_Plain", "TC_CargoSet"))
    S_["gondola"] = dict(pos=(-18.0, 3.4, 9.0), target=(-23.5, 0.6, 2.4), lens=30, only=("TC_Gondola", "TC_Quay_12", "TC_Quay_12_Plain"))
    S_["gondolas"] = dict(pos=(-30, 4.5, 14), target=(-20, 0.8, 1.5), lens=32)
    S_["quay-crane"] = dict(pos=(26, 6.5, 22), target=(8, 4.5, -2), lens=30)
    S_["pier"] = dict(pos=(12, 5.5, 34), target=(0, 1.5, 16), lens=30)
    for name, kw in S_.items():
        if shots and name not in shots:
            continue
        shoot(outdir / f"{name}.jpg", sun, cam, **kw)


main()
