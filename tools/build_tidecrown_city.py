"""Build public/models/world/tidecrown-city.glb, the Tidecrown landmarks kit (Blender headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python tools/build_tidecrown_city.py -- \
        --out /tmp/tidecrown-city.raw.glb --json tools/tidecrown-city-pieces.json
    npx @gltf-transform/cli meshopt /tmp/tidecrown-city.raw.glb public/models/world/tidecrown-city.glb --quantize-normal 12

Everything is generated here from primitives; no external models or textures.
Contract (shared with the castle kit):
- One top-level empty per piece with one child mesh (like village.glb); game units, Y up, origin at
  the ground centre of the footprint, main door facing +Z. Geometry is authored in game axes and
  exported with export_yup=False.
- Material names only (TC_*); the game assigns textures and tints. UVs follow the World 1 kit
  densities (measured from village.glb, see UV_DENSITY) and roof tile rows follow the slopes.
- Ambient occlusion baked into COLOR_0 (linear grey) by ray casting against the piece itself
  plus a ground plane.
--render DIR additionally renders EEVEE previews (flat and, with --textures, kit-textured).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True, help="Output .glb (uncompressed; compress with gltf-transform)")
ap.add_argument("--json", default=None, help="Write per-piece bounds, triangles and anchors here")
ap.add_argument("--only", default="", help="Comma list of piece names to build (iteration)")
ap.add_argument("--no-ao", action="store_true", help="Skip the AO bake (iteration only)")
ap.add_argument("--render", default=None, help="Render previews into this folder")
ap.add_argument("--textures", default=None, help="Folder with MI_*_base.png kit textures for a textured preview")
ap.add_argument("--views", default="pieces,lineup", help="Preview views: pieces,lineup,detail")
ap.add_argument("--samples", type=int, default=32)
args = ap.parse_args(argv)

PI = math.pi
TAU = 2 * PI

# ---------------------------------------------------------------------------------------------
# Materials and UV densities
# ---------------------------------------------------------------------------------------------
# Preview colour (linear-ish sRGB), metallic, roughness, emission strength.
MATS = {
    "TC_Limestone": ((0.86, 0.80, 0.68), 0.0, 0.8, 0.0),
    "TC_LimestoneDark": ((0.60, 0.55, 0.47), 0.0, 0.85, 0.0),
    "TC_Slate": ((0.12, 0.24, 0.46), 0.0, 0.6, 0.0),
    "TC_Gold": ((1.0, 0.74, 0.30), 1.0, 0.3, 0.0),
    "TC_Glass": ((0.16, 0.42, 0.78), 0.0, 0.15, 0.4),
    "TC_Seaglass": ((0.10, 0.55, 0.72), 0.0, 0.1, 0.7),
    "TC_SeaglassDeep": ((0.42, 0.16, 0.92), 0.0, 0.1, 0.9),
    "TC_Copper": ((0.32, 0.62, 0.52), 0.6, 0.5, 0.0),
    "TC_Iron": ((0.16, 0.16, 0.18), 0.8, 0.5, 0.0),
    "TC_Wood": ((0.42, 0.26, 0.14), 0.0, 0.8, 0.0),
    "TC_Banner": ((0.10, 0.18, 0.55), 0.0, 0.9, 0.0),
}
MAT_ORDER = list(MATS)

# UV units per game unit (u along the horizontal tangent, v up the wall or up the slope).
# Walls: village.glb MI_Brick / MI_UnevenBrick measure 0.500 (u) and 0.475 (v).
# Roofs: MI_RoundTiles on Roof_RoundTiles_* measures 0.225 along the eave and 0.194 up the slope.
UV_DENSITY = {
    "TC_Limestone": (0.5, 0.475),
    "TC_LimestoneDark": (0.5, 0.475),
    "TC_Slate": (0.225, 0.194),
    "TC_Copper": (0.225, 0.194),
    "TC_Wood": (0.45, 0.45),
    "TC_Gold": (0.5, 0.5),
    "TC_Iron": (0.5, 0.5),
    "TC_Seaglass": (0.25, 0.25),
    "TC_SeaglassDeep": (0.25, 0.25),
    "TC_Glass": (0.5, 0.5),  # windows get their own 0..1 square instead
    "TC_Banner": (0.5, 0.5),  # banners get their own 0..1 square instead
}


# ---------------------------------------------------------------------------------------------
# Matrices
# ---------------------------------------------------------------------------------------------
def T(x=0.0, y=0.0, z=0.0) -> Matrix:
    return Matrix.Translation((x, y, z))


def RX(a) -> Matrix:
    return Matrix.Rotation(a, 4, "X")


def RY(a) -> Matrix:
    return Matrix.Rotation(a, 4, "Y")


def RZ(a) -> Matrix:
    return Matrix.Rotation(a, 4, "Z")


def SC(x, y=None, z=None) -> Matrix:
    m = Matrix.Identity(4)
    m[0][0], m[1][1], m[2][2] = x, x if y is None else y, x if z is None else z
    return m


I4 = Matrix.Identity(4)
MIRROR_X = SC(-1, 1, 1)


def look_basis(fwd: Vector, up=Vector((0, 1, 0))) -> Matrix:
    """Rotation whose local +Y follows fwd (for tubes, posts, struts)."""
    y = fwd.normalized()
    x = up.cross(y)
    if x.length < 1e-6:
        x = Vector((1, 0, 0)).cross(y)
    x.normalize()
    z = x.cross(y).normalized()
    m = Matrix((x, y, z)).transposed().to_4x4()
    return m


# ---------------------------------------------------------------------------------------------
# Piece: an indexed polygon soup with a material and optional explicit UVs per face
# ---------------------------------------------------------------------------------------------
def poly_normal(P) -> Vector:
    n = Vector((0, 0, 0))
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def signed_volume(P, faces) -> float:
    v = 0.0
    for f in faces:
        a = P[f[0]]
        for k in range(1, len(f) - 1):
            v += a.dot(P[f[k]].cross(P[f[k + 1]]))
    return v / 6.0


class Piece:
    def __init__(self, name: str, budget: int, ground=True, note=""):
        self.name = name
        self.budget = budget
        self.ground = ground
        self.note = note
        self.V: list[Vector] = []
        self.F: list[tuple] = []
        self.M: list[str] = []
        self.UV: list = []
        self.anchors: dict = {}
        self.occluders: list = []  # extra AO quads (lists of 4 points)

    def add(self, verts, faces, mat, M=None, uv=None, orient="volume", facing=None):
        """Append geometry. orient='volume' flips closed solids to positive volume; 'facing' points
        every face along the given vector; 'keep' keeps winding (flipped by mirrored matrices)."""
        M = I4 if M is None else M
        P = [M @ Vector(v) for v in verts]
        faces = [list(f) for f in faces]
        if isinstance(uv, list):
            uv = [list(u) if u is not None else None for u in uv]
        if orient == "volume":
            if signed_volume(P, faces) < 0:
                faces = [f[::-1] for f in faces]
                if isinstance(uv, list):
                    uv = [u[::-1] if u is not None else None for u in uv]
        elif orient == "facing":
            d = Vector(facing)
            for i, f in enumerate(faces):
                if poly_normal([P[k] for k in f]).dot(d) < 0:
                    faces[i] = f[::-1]
                    if isinstance(uv, list) and uv[i] is not None:
                        uv[i] = uv[i][::-1]
        elif M.to_3x3().determinant() < 0:
            faces = [f[::-1] for f in faces]
            if isinstance(uv, list):
                uv = [u[::-1] if u is not None else None for u in uv]
        base = len(self.V)
        self.V.extend(P)
        for i, f in enumerate(faces):
            # drop repeated corners and degenerate faces
            g = []
            for k in f:
                if not g or (P[k] - P[g[-1]]).length > 1e-7:
                    g.append(k)
            if len(g) > 2 and (P[g[0]] - P[g[-1]]).length < 1e-7:
                g.pop()
            if len(g) < 3 or poly_normal([P[k] for k in g]).length < 1e-10:
                continue
            uvf = uv[i] if isinstance(uv, list) else None
            if uvf is not None and len(uvf) != len(g):
                uvf = None
            self.F.append(tuple(base + k for k in g))
            self.M.append(mat if isinstance(mat, str) else mat[i])
            self.UV.append(uvf)


# ---------------------------------------------------------------------------------------------
# Primitive generators: return (verts, faces[, uvs]) in local coordinates
# ---------------------------------------------------------------------------------------------
def g_box(x0, y0, z0, x1, y1, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    return v, f


def g_hull(points):
    bm = bmesh.new()
    seen = set()
    for p in points:
        key = tuple(round(c, 6) for c in p)
        if key in seen:
            continue
        seen.add(key)
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:], use_existing_faces=False)
    kill = list({g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)})
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts[:], edges=bm.edges[:])
    bm.verts.index_update()
    v = [tuple(x.co) for x in bm.verts]
    f = [[x.index for x in face.verts] for face in bm.faces]
    bm.free()
    return v, f


def cbox_pts(cx, y0, cz, sx, sy, sz, b):
    hx, hz = sx / 2, sz / 2
    if b <= 0:
        return [(cx + i * hx, y0 + j * sy, cz + k * hz) for i in (-1, 1) for j in (0, 1) for k in (-1, 1)]
    b = min(b, hx * 0.9, hz * 0.9, sy * 0.45)
    pts = []
    for i in (-1, 1):
        for k in (-1, 1):
            for yy, s in ((y0, 1), (y0 + sy, -1)):
                pts.append((cx + i * hx, yy + s * b, cz + k * (hz - b)))
                pts.append((cx + i * (hx - b), yy + s * b, cz + k * hz))
                pts.append((cx + i * (hx - b), yy, cz + k * (hz - b)))
    return pts


def g_cbox(cx, y0, cz, sx, sy, sz, b=0.0):
    """Chamfered box: centred on x/z, bottom at y0."""
    if b <= 0:
        return g_box(cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + sy, cz + sz / 2)
    return g_hull(cbox_pts(cx, y0, cz, sx, sy, sz, b))


def g_extrude(poly, z0, z1):
    """Extrude a simple 2D polygon (x, y) along z."""
    n = len(poly)
    v = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    f = [list(range(n))[::-1], list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        f.append([i, j, n + j, n + i])
    return v, f


def g_prism(poly_xz, y0, y1):
    """Extrude a 2D polygon (x, z) vertically."""
    n = len(poly_xz)
    v = [(x, y0, z) for x, z in poly_xz] + [(x, y1, z) for x, z in poly_xz]
    f = [list(range(n)), list(range(n, 2 * n))[::-1]]
    for i in range(n):
        j = (i + 1) % n
        f.append([i, j, n + j, n + i])
    return v, f


def g_lathe(prof, segs, a0=0.0, a1=TAU, uv_mat=None, r_ref=None, loop=False):
    """Surface of revolution around +Y. prof = [(r, y)] bottom to top. Caps close the solid, or
    loop=True closes the profile itself (rings, tori). uv_mat gives lathe UVs: u = angle * r_ref
    (arc length, wrapped to whole tiles), v = profile length."""
    if loop:
        prof = list(prof) + [prof[0]]
    full = abs(a1 - a0 - TAU) < 1e-6
    n = segs if full else segs + 1
    v, rows = [], []
    for r, y in prof:
        if r <= 1e-9:
            v.append((0.0, y, 0.0))
            rows.append([len(v) - 1] * n)
        else:
            row = []
            for j in range(n):
                a = a0 + (a1 - a0) * j / segs
                v.append((r * math.cos(a), y, -r * math.sin(a)))
                row.append(len(v) - 1)
            rows.append(row)
    f, uvs = [], []
    du = dv = 0
    if uv_mat:
        du, dv = UV_DENSITY[uv_mat]
        rr = r_ref if r_ref is not None else max(r for r, _ in prof)
        if full:
            tiles = max(1, round(TAU * rr * du))
            ucoef = tiles / TAU
        else:
            ucoef = rr * du
        s = [0.0]
        for i in range(1, len(prof)):
            s.append(s[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    for i in range(len(prof) - 1):
        for j in range(segs):
            j2 = (j + 1) % n if full else j + 1
            f.append([rows[i][j], rows[i + 1][j], rows[i + 1][j2], rows[i][j2]])
            if uv_mat:
                ua, ub = (a0 + (a1 - a0) * j / segs) * ucoef, (a0 + (a1 - a0) * (j + 1) / segs) * ucoef
                va, vb = s[i] * dv, s[i + 1] * dv
                uvs.append([(-ua, va), (-ua, vb), (-ub, vb), (-ub, va)])
            else:
                uvs.append(None)
    if loop:
        # the last profile row duplicates the first: weld it
        last = rows[-1]
        nv = len(v)
        remap = {last[j]: rows[0][j] for j in range(n)}
        f = [[remap.get(k, k) for k in q] for q in f]
        return v, f, uvs
    if full:
        if prof[0][0] > 1e-9:
            f.append(rows[0][:])
            uvs.append(None)
        if prof[-1][0] > 1e-9:
            f.append(rows[-1][:])
            uvs.append(None)
    else:
        for j in (0, n - 1):
            ring = [rows[i][j] for i in range(len(prof))]
            if prof[-1][0] > 1e-9:
                v.append((0.0, prof[-1][1], 0.0))
                ring.append(len(v) - 1)
            if prof[0][0] > 1e-9:
                v.append((0.0, prof[0][1], 0.0))
                ring.append(len(v) - 1)
            f.append(ring)
            uvs.append(None)
    return v, f, uvs


def g_loft(rings, ring_closed=True, path_closed=False, caps=True):
    v, R = [], []
    for ring in rings:
        R.append(list(range(len(v), len(v) + len(ring))))
        v.extend(tuple(p) for p in ring)
    n = len(rings[0])
    f = []
    m = len(rings) if path_closed else len(rings) - 1
    for i in range(m):
        a, b = R[i], R[(i + 1) % len(rings)]
        for j in range(n if ring_closed else n - 1):
            j2 = (j + 1) % n
            f.append([a[j], a[j2], b[j2], b[j]])
    if caps and not path_closed and ring_closed:
        f.append(R[0][::-1])
        f.append(R[-1][:])
    return v, f


def sweep_rings(profile, path, up, closed=False, miter=False, scales=None):
    """Rings of a 2D profile (a = side offset, b = up offset) along a 3D path."""
    up = Vector(up)
    n = len(path)
    P = [Vector(p) for p in path]
    rings = []
    for k in range(n):
        if closed:
            d0 = (P[k] - P[k - 1]).normalized()
            d1 = (P[(k + 1) % n] - P[k]).normalized()
        else:
            d0 = (P[k] - P[k - 1]).normalized() if k > 0 else (P[1] - P[0]).normalized()
            d1 = (P[k + 1] - P[k]).normalized() if k < n - 1 else d0
        t = (d0 + d1)
        t = t.normalized() if t.length > 1e-8 else d1
        side = t.cross(up).normalized()
        u2 = side.cross(t).normalized()
        sc = 1.0
        if miter:
            s0 = d0.cross(up).normalized()
            sc = 1.0 / max(0.3, side.dot(s0))
        k2 = scales[k] if scales else 1.0
        rings.append([P[k] + side * (a * sc * k2) + u2 * (b * k2) for a, b in profile])
    return rings


def g_sweep(profile, path, up, closed=False, miter=False):
    return g_loft(sweep_rings(profile, path, up, closed, miter), True, closed, not closed)


def g_tube(path, radius, segs=8, up=(0, 1, 0), closed=False, r1=None):
    """Round tube along a path; r1 tapers the radius linearly to the end."""
    prof = [(radius * math.cos(TAU * i / segs), radius * math.sin(TAU * i / segs)) for i in range(segs)]
    path = [Vector(q) for q in path]
    d = (path[-1] - path[0]).normalized()
    if abs(d.dot(Vector(up))) > 0.98:
        up = (1, 0, 0) if abs(d.x) < 0.9 else (0, 0, 1)
    sc = None
    if r1 is not None:
        sc = [1.0 + (r1 / radius - 1.0) * i / (len(path) - 1) for i in range(len(path))]
    return g_loft(sweep_rings(prof, path, up, closed, scales=sc), True, closed, not closed)


def circle2(r, n, a0=0.0, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(a0 + TAU * i / n), cy + r * math.sin(a0 + TAU * i / n)) for i in range(n)]


def lin(a, b, n):
    return [a + (b - a) * i / (n - 1) for i in range(n)]


# ---------------------------------------------------------------------------------------------
# Shapes and architectural helpers
# ---------------------------------------------------------------------------------------------
def arch_curve(halfw, hs, r, segs=8):
    """Pointed (r > halfw) or round (r = halfw) arch from the right springing (halfw, hs) over the
    apex to the left springing. Arc centres sit at (+-(halfw - r), hs)."""
    cx = halfw - r
    te = math.acos(max(-1.0, min(1.0, -cx / r)))
    right = [(cx + r * math.cos(t), hs + r * math.sin(t)) for t in lin(0.0, te, segs + 1)]
    left = [(-x, y) for x, y in reversed(right[:-1])]
    return right + left


def arch_apex(halfw, hs, r):
    cx = halfw - r
    return hs + math.sqrt(max(0.0, r * r - cx * cx))


def arch_window_outline(halfw, hs, r, segs=8, y0=0.0):
    """Closed outline of a pointed-arch opening (sill at y0)."""
    return [(halfw, y0)] + arch_curve(halfw, hs, r, segs) + [(-halfw, y0)]


def arch_frame_poly(halfw, hs, r, f, segs=8, y0=0.0):
    """Horseshoe polygon of a frame of width f around an arch opening (open at the sill)."""
    outer = [(halfw + f, y0)] + arch_curve(halfw + f, hs, r + f, segs)  + [(-halfw - f, y0)]
    inner = [(-halfw, y0)] + arch_curve(halfw, hs, r, segs)[::-1] + [(halfw, y0)]
    return outer + inner


def uv_square(P2, x0, y0, x1, y1, flip=False):
    out = []
    for x, y in P2:
        u = (x - x0) / (x1 - x0)
        out.append((1 - u if flip else u, (y - y0) / (y1 - y0)))
    return out


def pane(p: Piece, outline, z, M, mat="TC_Glass", facing=(0, 0, 1)):
    """A flat single-sided pane (glass) facing local +z with its own 0..1 UV square."""
    xs = [x for x, _ in outline]
    ys = [y for _, y in outline]
    v = [(x, y, z) for x, y in outline]
    uv = [uv_square(outline, min(xs), min(ys), max(xs), max(ys))]
    fw = (M.to_3x3() @ Vector(facing)).normalized()
    p.add(v, [list(range(len(v)))], mat, M, uv=uv, orient="facing", facing=fw)


def finial(p: Piece, M, h=1.0, mat="TC_Gold", segs=10):
    """Gold ball-and-spike finial, base at local origin, height h."""
    s = h
    prof = [(0, 0), (0.16 * s, 0), (0.16 * s, 0.06 * s), (0.08 * s, 0.12 * s), (0.07 * s, 0.22 * s),
            (0.17 * s, 0.30 * s), (0.20 * s, 0.40 * s), (0.17 * s, 0.50 * s), (0.08 * s, 0.57 * s),
            (0.06 * s, 0.62 * s), (0.09 * s, 0.66 * s), (0.05 * s, 0.70 * s), (0, s)]
    v, f, _ = g_lathe(prof, segs)
    p.add(v, f, mat, M)


def orb(p: Piece, M, r, mat="TC_Gold", segs=10, rings=6):
    prof = [(0, -r)] + [(r * math.sin(PI * i / rings), -r * math.cos(PI * i / rings)) for i in range(1, rings)] + [(0, r)]
    v, f, _ = g_lathe(prof, segs)
    p.add(v, f, mat, M)


def pyramid(p: Piece, M, w, h, mat, n=4, a0=PI / 4, d=None):
    """Pyramid (n sides) on a base of circumradius w/2 (or across-corner d)."""
    r = w / 2 / math.cos(PI / n) if d is None else d / 2
    pts = [(r * math.cos(a0 + TAU * i / n), 0.0, r * math.sin(a0 + TAU * i / n)) for i in range(n)]
    v, f = g_hull(pts + [(0, h, 0)])
    p.add(v, f, mat, M)


def pinnacle(p: Piece, x, y, z, w, h, M=I4, mat="TC_Limestone", tip=True):
    """Square pinnacle: shaft, gablets ring, pyramid cap with a gold tip."""
    sh = h * 0.45
    v, f = g_cbox(x, y, z, w, sh, w, w * 0.08)
    p.add(v, f, mat, M)
    v, f = g_cbox(x, y + sh, z, w * 1.18, w * 0.18, w * 1.18, w * 0.05)
    p.add(v, f, mat, M)
    pyramid(p, M @ T(x, y + sh + w * 0.18, z), w * 1.05, h - sh - w * 0.18, mat, 4, PI / 4)
    if tip:
        finial(p, M @ T(x, y + h - w * 0.15, z), w * 0.9)


def molding_loop(p: Piece, poly_xz, y, profile, mat, M=I4):
    """Closed horizontal molding around a polygon (profile a = outward, b = up)."""
    path = [Vector((x, y, z)) for x, z in poly_xz]
    cx = sum(x for x, _ in poly_xz) / len(poly_xz)
    cz = sum(z for _, z in poly_xz) / len(poly_xz)
    rings = sweep_rings(profile, path, (0, 1, 0), closed=True, miter=True)
    # flip the side offsets if they point inwards
    probe = sweep_rings([(1.0, 0.0)], path, (0, 1, 0), closed=True, miter=True)[0][0]
    if (Vector((probe.x - cx, 0, probe.z - cz))).length < (Vector((path[0].x - cx, 0, path[0].z - cz))).length:
        rings = sweep_rings([(-a, b) for a, b in profile], path, (0, 1, 0), closed=True, miter=True)
    v, f = g_loft(rings, True, True, False)
    p.add(v, f, mat, M)


def rect_xz(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def regular_xz(r, n, a0=0.0):
    return [(r * math.cos(a0 + TAU * i / n), r * math.sin(a0 + TAU * i / n)) for i in range(n)]


CORNICE = [(-0.05, 0.0), (0.12, 0.0), (0.22, 0.12), (0.38, 0.22), (0.38, 0.38), (-0.05, 0.38)]
STRING = [(-0.05, 0.0), (0.06, 0.0), (0.22, 0.10), (0.22, 0.22), (-0.05, 0.22)]
PLINTH = [(-0.05, 0.0), (0.3, 0.0), (0.3, 0.35), (0.12, 0.55), (-0.05, 0.55)]


def gothic_window(p: Piece, M, w, h, depth=0.45, frame=0.32, r_fac=0.9, lights=2, mat_frame="TC_Limestone",
                  mat_glass="TC_Glass", hood=True, sill=True, segs=8):
    """Pointed window on a wall whose surface is local z=0 (outside +z). Sill at y=0, apex at h."""
    halfw = w / 2
    r = r_fac * w
    cx = halfw - r
    rise = math.sqrt(r * r - cx * cx)
    hs = h - rise
    outline = arch_window_outline(halfw, hs, r, segs)
    pane(p, outline, 0.03, M, mat_glass)
    v, f = g_extrude(arch_frame_poly(halfw, hs, r, frame, segs), 0.0, depth)
    p.add(v, f, mat_frame, M)
    if hood:
        prof = [(0.0, 0.0), (0.16, 0.0), (0.16, 0.08), (0.06, 0.16), (0.0, 0.16)]
        path = [Vector((x, y, depth - 0.02)) for x, y in arch_curve(halfw + frame, hs, r + frame, segs)]
        path = [Vector((halfw + frame, hs - 0.5, depth - 0.02))] + path + [Vector((-halfw - frame, hs - 0.5, depth - 0.02))]
        v, f = g_sweep(prof, path, (0, 0, 1))
        p.add(v, f, mat_frame, M)
    if sill:
        v, f = g_cbox(0, -0.28, depth * 0.5, w + 2 * frame + 0.3, 0.28, depth + 0.25, 0.06)
        p.add(v, f, mat_frame, M)
    if lights >= 2:
        mw = 0.14
        # mullion and Y tracery: two sub-arches meeting the mullion
        v, f = g_box(-mw / 2, 0.0, 0.0, mw / 2, hs + 0.05, depth * 0.55)
        p.add(v, f, mat_frame, M)
        sub_half = (halfw - mw / 2) / 2
        prof = [(-mw / 2, 0.0), (mw / 2, 0.0), (mw / 2, depth * 0.55), (-mw / 2, depth * 0.55)]
        for sgn in (-1, 1):
            c = sgn * (mw / 2 + sub_half)
            pts = arch_curve(sub_half, hs, sub_half * 1.1, 6)
            path = [Vector((c + x, y, 0.0)) for x, y in pts]
            v, f = g_sweep(prof, path, (0, 0, 1))
            p.add(v, f, mat_frame, M)
        # oculus ring in the head
        oy = hs + (rise - 0.0) * 0.52
        orad = min(sub_half * 0.95, rise * 0.28)
        ring = [Vector((orad * math.cos(TAU * i / 12), oy + orad * math.sin(TAU * i / 12), 0.0)) for i in range(12)]
        v, f = g_loft(sweep_rings([(-0.06, 0.0), (0.06, 0.0), (0.06, depth * 0.5), (-0.06, depth * 0.5)], ring, (0, 0, 1), closed=True), True, True, False)
        p.add(v, f, mat_frame, M)
    return hs


def gable_roof(p: Piece, M, length, span, pitch_deg, thick=0.35, flare=0.9, mat="TC_Slate", ends=True,
               ridge_mat=None, end_overhang=0.0):
    """Gable roof slab, ridge along local x (centred), eaves at local z = +-span/2 at y = 0.
    Flared (bell-cast) eaves; tile UVs run up the slope (u along the ridge)."""
    t = math.tan(math.radians(pitch_deg))
    hw = span / 2
    H = hw * t
    fk = math.tan(math.radians(pitch_deg * 0.55))
    # top profile from right eave to ridge (z, y)
    top_r = [(hw, 0.0), (hw - flare, flare * fk)]
    y1 = flare * fk
    # continue at full pitch to the ridge height that keeps the ridge at H + y1 - flare*t
    ridge = H + y1 - (flare * t)
    top_r.append((0.0, ridge))
    top = top_r + [(-z, y) for z, y in reversed(top_r[:-1])]
    # underside: offset straight down by thick
    bot = [(z, y - thick) for z, y in reversed(top)]
    poly = top + bot  # (z, y) loop
    L = length / 2 + end_overhang
    v = [(-L, y, z) for z, y in poly] + [(L, y, z) for z, y in poly]
    n = len(poly)
    f, uvs = [], []
    du, dv = UV_DENSITY[mat]
    # arc length along the top for v (from each eave)
    s_top = []
    for i, (z, y) in enumerate(top):
        if i == 0:
            s_top.append(0.0)
        else:
            s_top.append(s_top[-1] + math.hypot(z - top[i - 1][0], y - top[i - 1][1]))
    half = s_top[len(top_r) - 1]
    for i in range(n):
        j = (i + 1) % n
        f.append([i, j, n + j, n + i])
        if i < len(top) - 1:
            # v grows from the eave to the ridge on both slopes
            va = s_top[i] if s_top[i] <= half + 1e-6 else 2 * half - s_top[i]
            vb = s_top[j] if s_top[j] <= half + 1e-6 else 2 * half - s_top[j]
            sgn = 1 if i < len(top_r) - 1 else -1
            uvs.append([(sgn * -L * du, va * dv), (sgn * -L * du, vb * dv), (sgn * L * du, vb * dv), (sgn * L * du, va * dv)])
        else:
            uvs.append(None)
    f.append(list(range(n))[::-1])
    uvs.append(None)
    f.append(list(range(n, 2 * n)))
    uvs.append(None)
    p.add(v, f, mat, M, uv=uvs)
    if ridge_mat:
        v, f = g_hull([(-L, ridge - 0.05, 0.22), (-L, ridge - 0.05, -0.22), (-L, ridge + 0.22, 0.0), (L, ridge - 0.05, 0.22), (L, ridge - 0.05, -0.22), (L, ridge + 0.22, 0.0)])
        p.add(v, f, ridge_mat, M)
    return ridge, top_r


def cone_roof(p: Piece, M, r_eave, y0, h, mat="TC_Slate", segs=24, flare=0.8, thick=0.3, r_wall=None):
    """Bell-cast conical roof: soffit at y0, apex at y0 + h."""
    rk = r_eave - flare
    k = math.tan(math.atan2(h, r_eave)) * 0.45
    prof = [(0.0, y0), (r_eave, y0), (r_eave, y0 + thick), (rk, y0 + thick + flare * k), (0.0, y0 + h)]
    v, f, uv = g_lathe(prof, segs, uv_mat=mat, r_ref=r_eave)
    p.add(v, f, mat, M, uv=uv)


def crab_claw_poly(R=1.0, open_deg=26.0, segs=14, teeth=4):
    """Upward-opening pincer crescent; the two finger tips meet near the top."""
    g = math.radians(open_deg) / 2
    a0, a1 = PI / 2 + g, PI / 2 - g + TAU
    outer = [(R * math.cos(a), R * math.sin(a)) for a in lin(a0, a1, segs * 2 + 1)]
    ri = R * 0.62
    oy = R * 0.22
    ia0, ia1 = PI / 2 + g * 2.2, PI / 2 - g * 2.2 + TAU
    inner = []
    pts = lin(ia0, ia1, segs * 2 + 1)
    for i, a in enumerate(pts):
        rr = ri * (1.0 + (0.08 if (i % 3 == 1 and 0.2 < i / len(pts) < 0.8 and teeth) else 0.0))
        inner.append((rr * math.cos(a), oy + rr * math.sin(a)))
    return outer + inner[::-1]


# ---------------------------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------------------------
PIECES: list[Piece] = []


def piece(name, budget, **kw):
    def deco(fn):
        PIECES.append((name, budget, kw, fn))
        return fn
    return deco


@piece("TC_Lamp", 1500)
def build_lamp(p: Piece):
    # octagonal stepped base
    v, f, _ = g_lathe([(0, 0), (0.55, 0), (0.55, 0.18), (0.45, 0.26), (0.36, 0.30), (0.36, 0.62), (0.26, 0.72), (0, 0.72)], 8, a0=PI / 8)
    p.add(v, f, "TC_LimestoneDark")
    # iron post with collars
    prof = [(0, 0.7), (0.17, 0.7), (0.17, 0.95), (0.12, 1.05), (0.1, 3.7), (0.14, 3.8), (0.14, 3.92), (0, 3.92)]
    v, f, _ = g_lathe(prof, 10)
    p.add(v, f, "TC_Iron")
    for y in (1.0, 2.6):
        v, f, _ = g_lathe([(0, y), (0.15, y), (0.15, y + 0.12), (0, y + 0.12)], 10)
        p.add(v, f, "TC_Gold")
    # scroll brackets under the lantern
    for k in range(4):
        a = PI / 4 + k * PI / 2
        pts = [Vector((math.cos(a) * (0.1 + 0.32 * math.sin(t)), 3.3 + 0.55 * (1 - math.cos(t)), math.sin(a) * (0.1 + 0.32 * math.sin(t)))) for t in lin(0.0, PI * 0.75, 6)]
        v, f = g_tube(pts, 0.035, 4)
        p.add(v, f, "TC_Iron")
    # lantern: square, wider at the top, iron frame, gold roof
    y0, y1 = 3.95, 4.95
    rb, rt = 0.28, 0.38
    v, f = g_cbox(0, 3.88, 0, 0.66, 0.1, 0.66, 0.03)
    p.add(v, f, "TC_Iron")
    corners_b = [(rb * math.cos(PI / 4 + k * PI / 2) * math.sqrt(2), rb * math.sin(PI / 4 + k * PI / 2) * math.sqrt(2)) for k in range(4)]
    corners_t = [(rt * math.cos(PI / 4 + k * PI / 2) * math.sqrt(2), rt * math.sin(PI / 4 + k * PI / 2) * math.sqrt(2)) for k in range(4)]
    for k in range(4):
        a, b = Vector((corners_b[k][0], y0, corners_b[k][1])), Vector((corners_t[k][0], y1, corners_t[k][1]))
        v, f = g_tube([a, b], 0.035, 4)
        p.add(v, f, "TC_Iron")
    # glass panes (each its own UV square)
    for k in range(4):
        a = k * PI / 2
        c, s = math.cos(a), math.sin(a)
        M = T(0, 0, 0) @ RY(-a)
        outline = [(-rb, y0 + 0.02), (rb, y0 + 0.02), (rt, y1 - 0.02), (-rt, y1 - 0.02)]
        # pane plane leans with the frame: local z from rb (bottom) to rt (top)
        verts = [(x, y, rb + (rt - rb) * (y - y0) / (y1 - y0) - 0.01) for x, y in outline]
        p.add(verts, [[0, 1, 2, 3]], "TC_Glass", M, uv=[uv_square(outline, -rt, y0, rt, y1)], orient="facing",
              facing=(M.to_3x3() @ Vector((0, 0, 1))))
    # glowing core (the light anchor sits here)
    v, f, _ = g_lathe([(0, 4.05), (0.09, 4.1), (0.12, 4.45), (0.07, 4.75), (0, 4.8)], 6)
    p.add(v, f, "TC_Glass")
    v, f = g_cbox(0, y1, 0, 0.92, 0.08, 0.92, 0.03)
    p.add(v, f, "TC_Gold")
    pyramid(p, T(0, y1 + 0.08, 0), 0.86, 0.42, "TC_Gold", 4, PI / 4)
    finial(p, T(0, y1 + 0.42, 0), 0.38)
    p.anchors["light"] = [0.0, 4.45, 0.0]


@piece("TC_BannerPole", 1500)
def build_banner_pole(p: Piece):
    v, f = g_cbox(0, 0, 0, 1.1, 0.35, 1.1, 0.06)
    p.add(v, f, "TC_LimestoneDark")
    v, f = g_cbox(0, 0.35, 0, 0.8, 0.45, 0.8, 0.08)
    p.add(v, f, "TC_Limestone")
    v, f, _ = g_lathe([(0, 0.8), (0.16, 0.8), (0.16, 1.0), (0.1, 1.08), (0.075, 8.5), (0, 8.5)], 8)
    p.add(v, f, "TC_Iron")
    for y in (1.0, 4.0, 8.15):
        v, f, _ = g_lathe([(0, y), (0.12, y), (0.12, y + 0.12), (0, y + 0.12)], 8)
        p.add(v, f, "TC_Gold")
    # crossbar with knobs
    v, f = g_tube([Vector((-1.15, 7.9, 0.34)), Vector((1.15, 7.9, 0.34))], 0.06, 6, up=(0, 0, 1))
    p.add(v, f, "TC_Gold")
    for s in (-1, 1):
        orb(p, T(s * 1.2, 7.9, 0.34), 0.11, segs=6, rings=4)
    v, f = g_tube([Vector((0, 8.05, 0.0)), Vector((0, 7.9, 0.34))], 0.05, 4)
    p.add(v, f, "TC_Gold")
    finial(p, T(0, 8.5, 0), 0.75)
    banner_cloth(p, T(0, 0, 0.36), width=1.9, top=7.85, bottom=2.7, tail=0.65, wave=0.1)
    p.anchors["banner"] = {"top": [0, 7.85, 0.36], "width": 1.9, "length": 5.15}


def banner_cloth(p: Piece, M, width, top, bottom, tail=0.6, wave=0.1, nx=6, ny=10, thick=0.035, swallow=True):
    """Two-sided banner slab hanging from y=top to y=bottom; front faces +z. Each side gets the
    full 0..1 UV square (the back is mirrored so a crest reads correctly from behind)."""
    hw = width / 2
    xs = lin(-hw, hw, nx + 1)
    ys = lin(top, bottom + tail, ny + 1)

    def zoff(x, y):
        return wave * math.sin((top - y) * 1.3 + 0.6) * (0.4 + 0.6 * (top - y) / (top - bottom)) + 0.05 * math.sin(x * 3.0)

    def tip_y(x):
        if swallow:
            # swallow tail: notch in the middle
            return bottom + tail * (abs(x) / hw) if hw > 0 else bottom
        return bottom + tail * (1 - abs(x) / hw)

    grid = []
    for j, y in enumerate(ys):
        row = []
        for x in xs:
            yy = y if j < ny else tip_y(x)
            row.append((x, yy))
        grid.append(row)
    span_y = top - bottom
    for side in (1, -1):
        verts, faces, uvs = [], [], []
        for j in range(ny + 1):
            for i in range(nx + 1):
                x, y = grid[j][i]
                verts.append((x, y, zoff(x, y) + side * thick / 2))
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                q = [a, a + 1, a + nx + 2, a + nx + 1]
                faces.append(q)
                uu = []
                for k in q:
                    x, y = verts[k][0], verts[k][1]
                    u = (x + hw) / width
                    uu.append((u if side > 0 else 1 - u, (y - bottom) / span_y))
                uvs.append(uu)
        p.add(verts, faces, "TC_Banner", M, uv=uvs, orient="facing", facing=(M.to_3x3() @ Vector((0, 0, side))))
    # rim along the edges (closes the slab)
    rim = []
    for i in range(nx + 1):
        rim.append(grid[0][i])
    for j in range(1, ny + 1):
        rim.append(grid[j][nx])
    for i in range(nx - 1, -1, -1):
        rim.append(grid[ny][i])
    for j in range(ny - 1, 0, -1):
        rim.append(grid[j][0])
    verts, faces = [], []
    for x, y in rim:
        verts.append((x, y, zoff(x, y) - thick / 2))
        verts.append((x, y, zoff(x, y) + thick / 2))
    n = len(rim)
    for i in range(n):
        j = (i + 1) % n
        faces.append([2 * i, 2 * j, 2 * j + 1, 2 * i + 1])
    # orient each rim quad outwards from the banner centre
    cxy = Vector((0, (top + bottom) / 2, 0))
    for fi, fc in enumerate(faces):
        P = [Vector(verts[k]) for k in fc]
        nrm = poly_normal(P)
        c = sum(P, Vector()) / 4
        if nrm.dot(Vector((c.x, c.y - cxy.y, 0))) < 0:
            faces[fi] = fc[::-1]
    p.add(verts, faces, "TC_Banner", M, orient="keep")


@piece("TC_BannerWall", 1500, ground=False)
def build_banner_wall(p: Piece):
    # wall at z = 0; banner hangs 0.3 in front; bottom tip at y = 0
    top = 5.0
    for s in (-1, 1):
        v, f = g_cbox(s * 0.85, top + 0.0, 0.06, 0.26, 0.36, 0.12, 0.03)
        p.add(v, f, "TC_Gold")
        v, f = g_tube([Vector((s * 0.85, top + 0.18, 0.1)), Vector((s * 0.85, top + 0.12, 0.32))], 0.05, 6, up=(0, 1, 0))
        p.add(v, f, "TC_Gold")
    v, f = g_tube([Vector((-1.2, top + 0.12, 0.32)), Vector((1.2, top + 0.12, 0.32))], 0.055, 6, up=(0, 0, 1))
    p.add(v, f, "TC_Gold")
    for s in (-1, 1):
        finial(p, T(s * 1.2, top + 0.12, 0.32) @ RZ(-s * PI / 2), 0.32)
    banner_cloth(p, T(0, 0, 0.32), width=2.0, top=top + 0.05, bottom=0.0, tail=0.6, wave=0.05, nx=6, ny=8, swallow=False)
    p.anchors["mount"] = [0.0, top + 0.12, 0.0]
    p.anchors["banner"] = {"top": [0, top + 0.05, 0.32], "width": 2.0, "length": top + 0.05}
    p.occluders.append([(-4, -1, 0), (4, -1, 0), (4, 8, 0), (-4, 8, 0)])


@piece("TC_Stair_8", 4000)
def build_stair(p: Piece):
    n, rise, run = 16, 0.5, 1.0
    hw = 3.3
    # sawtooth body (risers) in dark stone
    prof = [(0.0, 0.0)]
    for k in range(n):
        prof += [(-k * run, (k + 1) * rise - 0.12), (-(k + 1) * run, (k + 1) * rise - 0.12)]
    prof += [(-n * run, 0.0)]
    poly = [(z, y) for z, y in prof]
    # extrude along x: build in (z, y) then rotate so local x->z
    v, f = g_extrude(poly, -hw, hw)
    v = [(z, y, x) for x, y, z in v]
    p.add(v, f, "TC_LimestoneDark")
    # treads with nosings
    for k in range(n):
        v, f = g_cbox(0, (k + 1) * rise - 0.14, -k * run - run / 2 + 0.06, 2 * hw, 0.14, run + 0.12, 0.04)
        p.add(v, f, "TC_Limestone")
    # cheek walls following the slope, with sloped copings
    for s in (-1, 1):
        x0, x1 = s * hw, s * (hw + 0.65)
        ch = [(0.0, 0.0), (0.0, 1.1), (-0.9, 1.1), (-n * run + 0.9, n * rise + 1.1 - 0.45), (-n * run, n * rise + 1.1), (-n * run, 0.0)]
        ch = [(-0.45, 0.0), (-0.45, 1.0), (-n * run + 0.45, n * rise + 1.0), (-n * run + 0.45, 0.0)]
        v, f = g_extrude([(z, y) for z, y in ch], min(x0, x1), max(x0, x1))
        v = [(z, y, x) for x, y, z in v]
        p.add(v, f, "TC_Limestone")
        # plinth course along the base of the cheek
        v, f = g_cbox(s * (hw + 0.33), 0, -n * run / 2, 0.75, 0.4, n * run, 0.05)
        p.add(v, f, "TC_LimestoneDark")
        # coping slab along the slope
        a = math.atan2(n * rise, n * run)
        L = math.hypot(n * run - 0.9, n * rise) + 0.1
        mid = Vector((s * (hw + 0.325), (1.0 + 1.0 + n * rise) / 2 + 0.0, -n * run / 2))
        M = T(*mid) @ RX(a)
        v, f = g_cbox(0, 0.0, 0, 0.8, 0.22, L, 0.06)
        p.add(v, f, "TC_LimestoneDark", M)
        # newels with gold caps at both ends
        for z, y in ((-0.45, 0.0), (-n * run + 0.45, n * rise)):
            v, f = g_cbox(s * (hw + 0.25), y, z, 0.9, 0.35, 0.9, 0.06)
            p.add(v, f, "TC_LimestoneDark")
            v, f = g_cbox(s * (hw + 0.25), y + 0.35, z, 0.82, 1.45, 0.82, 0.07)
            p.add(v, f, "TC_Limestone")
            v, f = g_cbox(s * (hw + 0.25), y + 1.8, z, 0.92, 0.2, 0.92, 0.06)
            p.add(v, f, "TC_LimestoneDark")
            v, f = g_cbox(s * (hw + 0.25), y + 2.0, z, 0.6, 0.12, 0.6, 0.03)
            p.add(v, f, "TC_Gold")
            orb(p, T(s * (hw + 0.25), y + 2.4, z), 0.28, segs=10, rings=6)
            finial(p, T(s * (hw + 0.25), y + 2.6, z), 0.35)
    p.anchors["bottom"] = [0.0, 0.0, 0.0]
    p.anchors["top"] = [0.0, n * rise, -n * run]
    p.anchors["walkWidth"] = 2 * hw


@piece("TC_RetainingWall_12", 2500)
def build_retaining_wall(p: Piece):
    L = 12.0
    # stacked courses, each set back a little (battered face), V-grooves between courses
    y = 0.0
    face = 0.8
    v, f = g_cbox(0, 0, -0.05, L, 0.9, 1.9, 0.08)
    p.add(v, f, "TC_LimestoneDark")
    y = 0.9
    courses = [0.95, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0]  # base 0.9 + 6.75 + coping 0.35 = 8.0
    for k, h in enumerate(courses):
        fz = face - 0.05 * (k + 1)
        v, f = g_cbox(0, y, (fz + -0.8) / 2, L, h, fz + 0.8, 0.07)
        p.add(v, f, "TC_Limestone")
        y += h
    top = y  # 7.65
    # coping
    v, f = g_cbox(0, top, -0.15, L, 0.35, 1.9, 0.06)
    p.add(v, f, "TC_LimestoneDark")
    v, f = g_box(-L / 2, top - 0.12, 0.45, L / 2, top + 0.02, 0.8)
    p.add(v, f, "TC_LimestoneDark")
    # buttresses at x = -3, 3 (tiled modules keep a 6 unit rhythm)
    for bx in (-3.0, 3.0):
        stages = [(0.0, 3.2, 1.5, 1.7), (3.2, 3.0, 1.3, 1.25), (6.2, 1.1, 1.1, 0.85)]
        for y0, h, w, d in stages:
            v, f = g_cbox(bx, y0, face + d / 2 - 0.2, w, h, d + 0.4, 0.08)
            p.add(v, f, "TC_Limestone")
            # sloped weathering on top of each stage
            z0, z1 = face - 0.2, face + d
            v, f = g_hull([(bx - w / 2, y0 + h, z0), (bx + w / 2, y0 + h, z0), (bx - w / 2, y0 + h, z1), (bx + w / 2, y0 + h, z1),
                           (bx - w / 2, y0 + h + 0.45, z0), (bx + w / 2, y0 + h + 0.45, z0)])
            p.add(v, f, "TC_LimestoneDark")
        # quoin blocks alternating on the buttress face
        for k in range(4):
            yy = 0.4 + k * 0.75
            ww = 1.62 if k % 2 == 0 else 1.56
            v, f = g_cbox(bx, yy, face + 1.7 - 0.2 + 0.03, ww, 0.6, 0.12, 0.04)
            p.add(v, f, "TC_LimestoneDark")
    # drain spouts between buttresses
    for dx in (-6.0 + 1.5, 0.0, 6.0 - 1.5):
        v, f = g_cbox(dx, 2.0, face + 0.15, 0.5, 0.35, 0.6, 0.05)
        p.add(v, f, "TC_LimestoneDark")
    p.anchors["terraceY"] = round(top + 0.35, 3)
    p.anchors["faceZ"] = face
    p.anchors["tileLength"] = L
    p.occluders.append([(-8, top + 0.35, -0.8), (8, top + 0.35, -0.8), (8, top + 0.35, -10), (-8, top + 0.35, -10)])
    p.occluders.append([(-8, -2, -0.8), (8, -2, -0.8), (8, top + 0.35, -0.8), (-8, top + 0.35, -0.8)])


def hip_roof(p: Piece, M, hx, hz, y0, pitch_deg, mat="TC_Slate", flare=0.9, thick=0.3, cap_mat="TC_Slate"):
    """Hipped roof over a rectangle (hx >= hz half sizes), soffit at y0, bell-cast skirt."""
    t = math.tan(math.radians(pitch_deg))
    fk = math.tan(math.radians(pitch_deg * 0.5))

    def ring(ax, az, y):
        return [(ax, y, az), (-ax, y, az), (-ax, y, -az), (ax, y, -az)]

    ix, iz = hx - flare, hz - flare
    y1 = y0 + thick + flare * fk
    v, f = g_hull(ring(hx, hz, y0) + ring(hx, hz, y0 + thick) + ring(ix, iz, y1) + ring(ix, iz, y0))
    p.add(v, f, mat, M)
    ridge = y1 - 0.02 + iz * t
    rx = max(0.0, ix - iz)
    v, f = g_hull(ring(ix, iz, y1 - 0.02) + [(rx, ridge, 0.0), (-rx, ridge, 0.0)])
    p.add(v, f, mat, M)
    for sx in (-1, 1):
        for sz in (-1, 1):
            path = [Vector((sx * hx, y0 + thick + 0.06, sz * hz)), Vector((sx * ix, y1 + 0.07, sz * iz)), Vector((sx * rx, ridge + 0.1, 0.0))]
            v, f = g_tube(path, 0.13, 4)
            p.add(v, f, cap_mat, M)
    if rx > 0:
        v, f = g_tube([Vector((-rx, ridge + 0.1, 0)), Vector((rx, ridge + 0.1, 0))], 0.15, 4, up=(0, 0, 1))
        p.add(v, f, cap_mat, M)
    return ridge, rx


def voussoir_arch(p: Piece, M, r0, r1, z0, z1, n=13, mats=("TC_Limestone", "TC_LimestoneDark"), key_mat="TC_Limestone", yc=0.0):
    """Semicircular ring of wedge blocks (centre at (0, yc)), alternating long and short."""
    gap = 0.04
    for i in range(n):
        a0 = PI * i / n + gap / r1
        a1 = PI * (i + 1) / n - gap / r1
        ro = r1 + (0.25 if i % 2 == 0 else 0.0)
        zz1 = z1
        mat = mats[i % 2]
        if i == n // 2:
            ro, zz1, mat = r1 + 0.55, z1 + 0.18, key_mat
        pts = []
        for a in (a0, a1):
            for rr in (r0, ro):
                for zz in (z0, zz1):
                    pts.append((rr * math.cos(a), yc + rr * math.sin(a), zz))
        v, f = g_hull(pts)
        p.add(v, f, mat, M)


def iron_straps(p: Piece, M, halfw, ys, z):
    for y in ys:
        v, f = g_box(-halfw + 0.05, y, z, halfw - 0.05, y + 0.14, z + 0.06)
        p.add(v, f, "TC_Iron", M)


def door_leaf(p: Piece, M, halfw, hs, r, z0=0.0, z1=0.14, straps=True):
    outline = arch_window_outline(halfw, hs, r, 8)
    v, f = g_extrude(outline, z0, z1)
    p.add(v, f, "TC_Wood", M)
    # centre seam and planks read from the texture; iron straps and a ring handle on top
    v, f = g_box(-0.04, 0.0, z1, 0.04, hs + (arch_apex(halfw, hs, r) - hs) * 0.9, z1 + 0.03)
    p.add(v, f, "TC_Iron", M)
    if straps:
        iron_straps(p, M, halfw, [0.5, hs * 0.5, hs - 0.25], z1)
        for sx in (-1, 1):
            ring = [Vector((sx * 0.3 + 0.16 * math.cos(TAU * i / 8), hs * 0.42 - 0.12 + 0.16 * math.sin(TAU * i / 8), z1 + 0.08)) for i in range(8)]
            v, f = g_tube(ring, 0.035, 4, up=(0, 0, 1), closed=True)
            p.add(v, f, "TC_Gold", M)


@piece("TC_Fountain", 15000)
def build_fountain(p: Piece):
    a8 = PI / 8
    # stepped platform and octagonal basin
    v, f, uv = g_lathe([(0, 0), (8.0, 0), (8.0, 0.22), (0, 0.22)], 8, a0=a8, uv_mat="TC_LimestoneDark")
    p.add(v, f, "TC_LimestoneDark", uv=uv)
    prof = [(0, 0.22), (7.1, 0.22), (7.1, 0.45), (6.95, 0.55), (6.95, 1.0), (6.45, 1.0), (6.45, 0.35), (0, 0.35)]
    v, f, uv = g_lathe(prof, 8, a0=a8, uv_mat="TC_Limestone")
    p.add(v, f, "TC_Limestone", uv=uv)
    v, f, uv = g_lathe([(6.3, 0.98), (7.3, 0.98), (7.38, 1.08), (7.3, 1.2), (6.35, 1.2), (6.3, 1.12)], 8, a0=a8, loop=True, uv_mat="TC_LimestoneDark")
    p.add(v, f, "TC_LimestoneDark", uv=uv)
    # raised panels on the eight outer faces
    apo = 6.95 * math.cos(PI / 8)
    for k in range(8):
        phi = k * PI / 4
        M = T(apo * math.sin(phi), 0, apo * math.cos(phi)) @ RY(phi)
        side = 2 * 6.95 * math.sin(PI / 8)
        for x0, y0, sx, sy in ((0, 0.58, side - 1.2, 0.09), (0, 0.85, side - 1.2, 0.09)):
            v, f = g_cbox(x0, y0, 0.03, sx, sy, 0.12, 0.03)
            p.add(v, f, "TC_LimestoneDark", M)
        # gold shell boss
        orb(p, M @ T(0, 0.72, 0.05) @ SC(1.6, 1.0, 0.5), 0.12, segs=8, rings=4)
    # corner pedestals with gold balls on the rim
    for k in range(8):
        a = a8 + k * PI / 4
        x, z = 7.0 * math.cos(a), -7.0 * math.sin(a)
        v, f = g_cbox(x, 1.2, z, 0.55, 0.42, 0.55, 0.06)
        p.add(v, f, "TC_Limestone")
        orb(p, T(x, 1.82, z), 0.2, segs=8, rings=5)
    # central pedestal, spouts and the upper bowl
    prof = [(0, 0.35), (2.4, 0.35), (2.4, 0.6), (2.0, 0.78), (1.55, 0.9), (1.38, 1.2), (1.3, 1.95), (0, 1.95)]
    v, f, uv = g_lathe(prof, 16, uv_mat="TC_Limestone")
    p.add(v, f, "TC_Limestone", uv=uv)
    spouts = []
    for k in range(8):
        phi = k * PI / 4 + PI / 8
        d = Vector((math.sin(phi), 0.0, math.cos(phi)))
        a = d * 1.25 + Vector((0, 1.45, 0))
        b = d * 1.95 + Vector((0, 1.55, 0))
        v, f = g_tube([a, a.lerp(b, 0.6) + Vector((0, 0.08, 0)), b], 0.16, 6, r1=0.09)
        p.add(v, f, "TC_Gold")
        spouts.append({"pos": r3(b), "dir": r3((d + Vector((0, 0.35, 0))).normalized())})
    prof = [(0, 1.92), (1.2, 1.92), (2.6, 2.22), (3.05, 2.5), (3.12, 2.66), (2.88, 2.7), (2.78, 2.5), (1.1, 2.36), (0, 2.36)]
    v, f, uv = g_lathe(prof, 16, uv_mat="TC_Limestone")
    p.add(v, f, "TC_Limestone", uv=uv)
    v, f, _ = g_lathe([(3.0, 2.62), (3.18, 2.62), (3.18, 2.74), (3.0, 2.74)], 16, loop=True)
    p.add(v, f, "TC_Gold")
    prof = [(0, 2.3), (1.6, 2.3), (1.6, 2.5), (1.4, 2.62), (1.35, 3.0), (1.55, 3.12), (1.55, 3.3), (0, 3.3)]
    v, f, uv = g_lathe(prof, 16, uv_mat="TC_Limestone")
    p.add(v, f, "TC_Limestone", uv=uv)
    v, f, _ = g_lathe([(1.37, 2.8), (1.45, 2.8), (1.45, 2.92), (1.37, 2.92)], 16, loop=True)
    p.add(v, f, "TC_Gold")
    crab_statue(p, T(0, 3.3, 0))
    p.anchors["spouts"] = spouts
    p.anchors["water"] = [{"y": 0.85, "radius": 6.45, "sides": 8, "rotation": "flat faces toward +-x and +-z"},
                          {"y": 2.55, "radius": 2.8, "sides": 16}]
    p.anchors["spill"] = {"y": 2.66, "radius": 3.12}


def crab_statue(p: Piece, M, mat="TC_Limestone"):
    """A crab raising both claws and holding a crown above its shell (base at local y = 0)."""
    shell = M @ SC(1.15, 1.0, 0.95)
    prof = [(0, 0.72), (0.95, 0.76), (1.45, 0.96), (1.62, 1.24), (1.58, 1.55), (1.38, 1.92), (0.95, 2.22), (0.45, 2.36), (0, 2.4)]
    v, f, _ = g_lathe(prof, 20)
    p.add(v, f, mat, shell)
    v, f, _ = g_lathe([(1.58, 1.16), (1.7, 1.2), (1.7, 1.32), (1.58, 1.36)], 20, loop=True)
    p.add(v, f, "TC_Gold", shell)
    # visor band on the front
    v, f = g_hull([(x, y, 1.62) for x in (-0.75, 0.75) for y in (1.28, 1.6)] +
                  [(x, y, 1.3) for x in (-0.9, 0.9) for y in (1.28, 1.6)])
    p.add(v, f, "TC_Gold", M)
    # legs: three a side, knee up, foot down
    for s in (-1, 1):
        for zk in (0.55, -0.1, -0.75):
            hip = Vector((s * 1.55, 1.05, zk))
            knee = Vector((s * 2.55, 1.8, zk * 1.35))
            foot = Vector((s * 3.15, 0.0, zk * 1.6))
            v, f = g_tube([hip, hip.lerp(knee, 0.5) + Vector((0, 0.12, 0)), knee], 0.3, 6, r1=0.24)
            p.add(v, f, mat, M)
            v, f = g_tube([knee, knee.lerp(foot, 0.5) + Vector((s * 0.12, 0, 0)), foot], 0.24, 6, r1=0.1)
            p.add(v, f, mat, M)
            orb(p, M @ T(*knee), 0.3, mat, segs=8, rings=4)
    # eye stalks
    for s in (-1, 1):
        a, b = Vector((s * 0.45, 1.9, 0.85)), Vector((s * 0.58, 2.45, 1.05))
        v, f = g_tube([a, b], 0.08, 6)
        p.add(v, f, mat, M)
        orb(p, M @ T(*b), 0.17, "TC_Gold", segs=8, rings=5)
    # crown held aloft
    cc = Vector((0.0, 5.85, 0.75))
    v, f, _ = g_lathe([(0, 5.5), (0.8, 5.5), (0.86, 5.6), (0.86, 6.0), (0.78, 6.05), (0.7, 5.75), (0, 5.75)], 16)
    p.add(v, f, "TC_Gold", M @ T(0, 0, cc.z))
    for k in range(8):
        a = TAU * k / 8
        x, z = 0.8 * math.cos(a), 0.8 * math.sin(a)
        pyramid(p, M @ T(x, 6.0, cc.z + z), 0.26, 0.55 if k % 2 == 0 else 0.36, "TC_Gold", 4, PI / 4)
        if k % 2 == 0:
            orb(p, M @ T(x * 1.0, 6.58, cc.z + z), 0.08, segs=6, rings=4)
    orb(p, M @ T(0, 5.95, cc.z), 0.42, "TC_Glass", segs=10, rings=5)
    # arms and claws: a swollen claw body with two long fingers clamping the crown rim
    for s in (-1, 1):
        sh = Vector((s * 1.25, 1.4, 1.0))
        el = Vector((s * 2.55, 2.75, 1.3))
        wr = Vector((s * 2.2, 4.1, 1.0))
        v, f = g_tube([sh, sh.lerp(el, 0.5) + Vector((s * 0.1, 0, 0.1)), el], 0.4, 7, r1=0.32)
        p.add(v, f, mat, M)
        orb(p, M @ T(*el), 0.38, mat, segs=8, rings=4)
        v, f = g_tube([el, el.lerp(wr, 0.5) + Vector((s * 0.15, 0, 0)), wr], 0.32, 7, r1=0.3)
        p.add(v, f, mat, M)
        hand = Vector((s * 1.75, 5.35, 0.85))
        d = hand - wr
        L = d.length
        palm = [(0, -0.1 * L), (0.38, -0.05 * L), (0.72, 0.3 * L), (0.78, 0.55 * L), (0.66, 0.8 * L), (0.4, 0.98 * L), (0, 1.05 * L)]
        v, f, _ = g_lathe(palm, 12)
        p.add(v, f, mat, M @ T(*wr) @ look_basis(d) @ SC(1.0, 1.0, 0.82))
        for top, ty in ((True, 6.08), (False, 5.42)):
            a = hand + Vector((-s * 0.15, 0.32 if top else -0.25, 0.0))
            b = Vector((s * 0.8, ty, cc.z))
            mid = a.lerp(b, 0.5) + Vector((0, 0.32 if top else -0.25, 0))
            v, f = g_tube([a, a.lerp(mid, 0.6), mid, b], 0.36 if top else 0.32, 7, r1=0.08)
            p.add(v, f, mat, M)


@piece("TC_MarketArcade", 12000)
def build_arcade(p: Piece):
    xs = [-9.2 + 3.68 * i for i in range(6)]
    zs = [-4.4, 0.0, 4.4]
    hs, ytop = 4.35, 7.0
    # paving and a low step
    v, f = g_cbox(0, 0, 0, 20.4, 0.12, 10.8, 0.04)
    p.add(v, f, "TC_LimestoneDark")
    v, f = g_cbox(0, 0.12, 0, 19.6, 0.12, 10.0, 0.04)
    p.add(v, f, "TC_LimestoneDark")
    cols = set()
    for x in xs:
        for z in (-4.4, 4.4):
            cols.add((round(x, 3), z))
    for z in zs:
        for x in (-9.2, 9.2):
            cols.add((x, z))
    for x, z in sorted(cols):
        v, f = g_cbox(x, 0.24, z, 1.0, 0.3, 1.0, 0.06)
        p.add(v, f, "TC_Limestone")
        prof = [(0, 0.54), (0.44, 0.54), (0.44, 0.64), (0.33, 0.78), (0.3, 3.7), (0.36, 3.82), (0.3, 3.9), (0.52, 4.1), (0, 4.1)]
        v, f, uv = g_lathe(prof, 10, uv_mat="TC_Limestone")
        p.add(v, f, "TC_Limestone", T(x, 0, z), uv=uv)
        v, f, _ = g_lathe([(0.31, 2.0), (0.36, 2.0), (0.36, 2.12), (0.31, 2.12)], 10, loop=True)
        p.add(v, f, "TC_Gold", T(x, 0, z))
        v, f = g_cbox(x, 4.1, z, 1.12, 0.25, 1.12, 0.05)
        p.add(v, f, "TC_LimestoneDark")
    sides = [(T(0, 0, 4.4), xs), (T(0, 0, -4.4) @ RY(PI), xs), (T(9.2, 0, 0) @ RY(PI / 2), zs), (T(-9.2, 0, 0) @ RY(-PI / 2), zs)]
    mold = [(0.0, 0.0), (0.24, 0.0), (0.24, 0.08), (0.1, 0.16), (0.0, 0.16)]
    for M, cs in sides:
        poly = [(cs[0] - 0.3, ytop), (cs[0] - 0.3, hs)]
        arches = []
        for i in range(len(cs) - 1):
            mid = (cs[i] + cs[i + 1]) / 2
            halfw = (cs[i + 1] - cs[i]) / 2 - 0.45
            r = halfw * (1.8 if halfw < 1.5 else 1.5)
            r = max(r, halfw)
            if arch_apex(halfw, hs, r) > ytop - 0.35:
                r = halfw * 1.25
            pts = [(mid + x, y) for x, y in arch_curve(halfw, hs, r, 6)]
            poly += pts[::-1]
            arches.append(pts)
        poly += [(cs[-1] + 0.3, hs), (cs[-1] + 0.3, ytop)]
        v, f = g_extrude(poly, -0.3, 0.3)
        p.add(v, f, "TC_Limestone", M)
        for pts in arches:
            path = [Vector((x, y, 0.3)) for x, y in pts]
            v, f = g_sweep(mold, path, (0, 0, 1))
            p.add(v, f, "TC_LimestoneDark", M)
            p.add(v, f, "TC_LimestoneDark", M @ SC(1, 1, -1))
            # gold keystone at the apex
            ax, ay = pts[len(pts) // 2]
            v, f = g_hull([(ax + dx, ay + dy, z) for dx, dy in ((-0.2, 0.0), (0.2, 0.0), (-0.28, 0.55), (0.28, 0.55)) for z in (-0.38, 0.38)])
            p.add(v, f, "TC_Gold", M)
    molding_loop(p, rect_xz(-9.5, -4.7, 9.5, 4.7), ytop - 0.02, [(-0.05, 0.0), (0.1, 0.0), (0.2, 0.1), (0.36, 0.2), (0.36, 0.42), (-0.05, 0.42)], "TC_LimestoneDark")
    molding_loop(p, rect_xz(-9.5, -4.7, 9.5, 4.7), hs - 0.25, [(-0.05, 0.0), (0.06, 0.0), (0.06, 0.12), (-0.05, 0.12)], "TC_LimestoneDark")
    # ceiling beams inside
    for x in xs[1:-1]:
        v, f = g_cbox(x, ytop + 0.0, 0, 0.35, 0.4, 8.8, 0.05)
        p.add(v, f, "TC_Wood")
    v, f = g_cbox(0, ytop + 0.3, 0, 18.6, 0.12, 8.8, 0.0)
    p.add(v, f, "TC_Wood")
    ridge, rx = hip_roof(p, I4, 10.6, 5.8, ytop + 0.4, 46, flare=1.0)
    for sx in (-1, 1):
        finial(p, T(sx * rx, ridge + 0.15, 0), 1.0)
    # bell cupola on the ridge
    cy = ridge - 0.9
    v, f = g_cbox(0, cy, 0, 2.6, 1.5, 2.6, 0.08)
    p.add(v, f, "TC_Limestone")
    for sx in (-1, 1):
        for sz in (-1, 1):
            v, f = g_cbox(sx * 1.05, cy + 1.5, sz * 1.05, 0.42, 1.9, 0.42, 0.06)
            p.add(v, f, "TC_Limestone")
    v, f = g_cbox(0, cy + 3.4, 0, 2.9, 0.38, 2.9, 0.06)
    p.add(v, f, "TC_LimestoneDark")
    v, f, _ = g_lathe([(0, cy + 1.8), (0.55, cy + 1.8), (0.5, cy + 2.0), (0.36, cy + 2.6), (0.22, cy + 3.0), (0.12, cy + 3.2), (0, cy + 3.25)], 10)
    p.add(v, f, "TC_Gold")
    r2, _ = hip_roof(p, I4, 1.75, 1.75, cy + 3.78, 58, flare=0.35, thick=0.16)
    finial(p, T(0, r2 - 0.1, 0), 1.2)
    p.anchors["lights"] = [[round(x + 1.84, 3), round(ytop - 0.6, 3), 0.0] for x in xs[:-1]]
    p.anchors["openSides"] = "all four sides are open arcades; the floor is at y=0.24"


@piece("TC_Waterwheel", 4000, ground=False, note="Rotate about local +X (the axle). Place at TC_Forge anchors.waterwheel.pos.")
def build_waterwheel(p: Piece):
    toX = RZ(PI / 2)
    for sx in (-0.78, 0.78):
        v, f, uv = g_lathe([(4.25, -0.12), (5.0, -0.12), (5.0, 0.12), (4.25, 0.12)], 32, loop=True, uv_mat="TC_Wood")
        p.add(v, f, "TC_Wood", T(sx, 0, 0) @ toX, uv=uv)
        v, f, _ = g_lathe([(5.0, -0.1), (5.07, -0.1), (5.07, 0.1), (5.0, 0.1)], 32, loop=True)
        p.add(v, f, "TC_Iron", T(sx, 0, 0) @ toX)
        for k in range(8):
            v, f = g_box(-0.1, 0.55, -0.14, 0.1, 4.3, 0.14)
            p.add(v, f, "TC_Wood", T(sx, 0, 0) @ RX(TAU * k / 8 + PI / 16))
    for k in range(16):
        v, f = g_box(-0.92, 4.15, -0.06, 0.92, 5.35, 0.06)
        p.add(v, f, "TC_Wood", RX(TAU * k / 16))
    v, f, _ = g_lathe([(0, -1.05), (0.62, -1.05), (0.72, -0.95), (0.72, 0.95), (0.62, 1.05), (0, 1.05)], 12)
    p.add(v, f, "TC_Iron", toX)
    for sx in (-0.95, 0.95):
        v, f, _ = g_lathe([(0.72, -0.06), (0.8, -0.06), (0.8, 0.06), (0.72, 0.06)], 12, loop=True)
        p.add(v, f, "TC_Gold", T(sx, 0, 0) @ toX)
    v, f = g_tube([Vector((-1.45, 0, 0)), Vector((2.5, 0, 0))], 0.3, 10, up=(0, 1, 0))
    p.add(v, f, "TC_Iron")
    p.anchors["axis"] = [1, 0, 0]
    p.anchors["radius"] = 5.35


@piece("TC_Forge", 25000)
def build_forge(p: Piece):
    HX, HZ, TOP = 13.0, 9.0, 10.4
    FZ = 9.0  # front face
    # body and front wall with the forge arch and two crab doors cut from the bottom edge
    v, f = g_box(-HX, 0, -HZ, HX, TOP, 6.0)
    p.add(v, f, "TC_Limestone")
    poly = [(-HX, 0.0)]
    for xc, halfw, hs in ((-8.0, 1.1, 2.2), (0.0, 3.6, 3.2), (8.0, 1.1, 2.2)):
        pts = [(xc + x, y) for x, y in arch_curve(halfw, hs, halfw, 10 if halfw > 2 else 6)]
        poly += [(xc - halfw, 0.0)] + pts[::-1] + [(xc + halfw, 0.0)]
    poly += [(HX, 0.0), (HX, TOP), (-HX, TOP)]
    v, f = g_extrude(poly, 6.0, FZ)
    p.add(v, f, "TC_Limestone")
    # battered plinth between the openings
    for x0, x1 in ((-HX - 0.4, -9.1), (-6.9, -3.6), (3.6, 6.9), (9.1, HX + 0.4)):
        v, f = g_hull([(x, 0.0, FZ + 0.4) for x in (x0, x1)] + [(x, 1.1, FZ + 0.12) for x in (x0, x1)] + [(x, y, FZ - 0.5) for x in (x0, x1) for y in (0.0, 1.1)])
        p.add(v, f, "TC_LimestoneDark")
    for sx in (-1, 1):
        v, f = g_hull([(sx * (HX + zz), y, z) for zz, y in ((0.4, 0.0), (0.12, 1.1), (-0.5, 0.0), (-0.5, 1.1)) for z in (-HZ - 0.4, FZ + 0.4)])
        p.add(v, f, "TC_LimestoneDark")
    v, f = g_hull([(x, y, -HZ - zz) for zz, y in ((0.4, 0.0), (0.12, 1.1), (-0.5, 0.0), (-0.5, 1.1)) for x in (-HX - 0.4, HX + 0.4)])
    p.add(v, f, "TC_LimestoneDark")
    # forge niche: sooty back, floor, hearth with copper hood, anvil
    v, f = g_box(-3.6, 0.0, 6.0, 3.6, 6.8, 6.06)
    p.add(v, f, "TC_LimestoneDark")
    v, f = g_box(-3.6, 0.0, 6.0, 3.6, 0.08, FZ)
    p.add(v, f, "TC_LimestoneDark")
    v, f = g_cbox(0, 0.0, 6.75, 4.6, 1.1, 1.5, 0.08)
    p.add(v, f, "TC_LimestoneDark")
    v, f = g_cbox(0, 1.1, 6.75, 3.6, 0.12, 1.1, 0.0)
    p.add(v, f, "TC_Iron")
    v, f = g_hull([(x, 2.6, z) for x in (-2.5, 2.5) for z in (6.06, 7.7)] + [(x, 5.6, z) for x in (-0.8, 0.8) for z in (6.06, 6.9)])
    p.add(v, f, "TC_Copper")
    v, f = g_cbox(1.3, 0.08, 8.1, 0.8, 0.7, 0.8, 0.08)
    p.add(v, f, "TC_Wood")
    anvil = [(-0.75, 0.0), (0.55, 0.0), (0.4, 0.18), (0.25, 0.22), (0.3, 0.42), (0.7, 0.48), (0.75, 0.62), (-0.5, 0.62), (-0.9, 0.55), (-1.15, 0.5), (-0.6, 0.42), (-0.35, 0.22), (-0.6, 0.18)]
    v, f = g_extrude([(x * 0.9, y + 0.78) for x, y in anvil], -0.2, 0.2)
    p.add(v, f, "TC_Iron", T(1.3, 0, 8.1) @ RY(0.3))
    voussoir_arch(p, T(0, 0, 0), 3.6, 4.45, FZ, FZ + 0.32, 13, yc=3.2)
    for sx in (-1, 1):
        for k in range(3):
            w = 1.25 if k % 2 == 0 else 0.9
            v, f = g_cbox(sx * (3.6 + w / 2 - 0.02), 0.04 + k * 1.06, FZ + 0.12, w, 1.0, 0.4, 0.07)
            p.add(v, f, "TC_LimestoneDark" if k % 2 else "TC_Limestone")
    orb(p, T(0, 3.2 + 4.95, FZ + 0.55) @ SC(1, 1, 0.5), 0.28, segs=8, rings=4)
    # crab doors: recessed leaves, dark frames
    for xc in (-8.0, 8.0):
        door_leaf(p, T(xc, 0, FZ - 0.55), 1.1, 2.2, 1.1)
        v, f = g_extrude(arch_frame_poly(1.1, 2.2, 1.1, 0.32, 6), FZ, FZ + 0.25)
        p.add(v, f, "TC_LimestoneDark", T(xc, 0, 0))
        v, f = g_cbox(xc, 0.0, FZ + 0.35, 2.8, 0.18, 0.9, 0.05)
        p.add(v, f, "TC_LimestoneDark")
    # pilasters and corner quoins
    for x in (-11.2, -5.5, 5.5, 11.2):
        v, f = g_cbox(x, 1.1, FZ + 0.15, 1.0, 6.1, 0.42, 0.08)
        p.add(v, f, "TC_Limestone")
        v, f = g_hull([(x + dx, 7.2, FZ + dz) for dx in (-0.5, 0.5) for dz in (-0.1, 0.36)] + [(x + dx, 7.55, FZ - 0.1) for dx in (-0.5, 0.5)])
        p.add(v, f, "TC_LimestoneDark")
    for sx in (-1, 1):
        for sz in (-1, 1):
            for k in range(6):
                y0 = 1.15 + k * 1.0
                lx, lz = (1.2, 0.7) if k % 2 == 0 else (0.7, 1.2)
                v, f = g_cbox(sx * (HX - lx / 2 + 0.1), y0, sz * (HZ - lz / 2 + 0.1) if sz < 0 else FZ - lz / 2 + 0.1, lx, 0.9, lz, 0.07)
                p.add(v, f, "TC_LimestoneDark")
    # string course and corbel table under the upper storey
    molding_loop(p, rect_xz(-HX, -HZ, HX, FZ), 7.2, STRING, "TC_LimestoneDark")
    for x in lin(-12.2, 12.2, 15):
        if abs(x) < 5.0:
            continue
        v, f = g_hull([(x + dx, 7.45, FZ + dz) for dx in (-0.18, 0.18) for dz in (0.0, 0.05)] + [(x + dx, 8.0, FZ + dz) for dx in (-0.18, 0.18) for dz in (0.0, 0.3)])
        p.add(v, f, "TC_LimestoneDark")
    molding_loop(p, rect_xz(-HX, -HZ, HX, FZ), TOP - 0.42, CORNICE, "TC_Limestone")
    # upper windows with iron grilles and a gold anvil emblem above the arch
    for x in (-10.4, -6.6, 6.6, 10.4):
        gothic_window(p, T(x, 8.1, FZ), 1.0, 1.65, depth=0.3, frame=0.22, r_fac=0.5, lights=1, hood=False)
        for dx in (-0.2, 0.2):
            v, f = g_box(x + dx - 0.03, 8.1, FZ + 0.05, x + dx + 0.03, 9.5, FZ + 0.1)
            p.add(v, f, "TC_Iron")
    v, f = g_extrude([(x * 1.5, y * 1.5) for x, y in anvil], 0.0, 0.18)
    p.add(v, f, "TC_Gold", T(0, 8.85, FZ + 0.05))
    v, f = g_cbox(0, 8.65, FZ + 0.06, 3.4, 0.16, 0.2, 0.04)
    p.add(v, f, "TC_Gold")
    # copper roof with standing seams and a ridge vent
    ridge, top_r = gable_roof(p, T(0, TOP, 0.0), 2 * HX, 2 * HZ + 1.9, 36, thick=0.3, flare=1.1, mat="TC_Copper", end_overhang=0.7)
    ridge_y = TOP + ridge
    for x in lin(-HX - 0.3, HX + 0.3, 21):
        for sz in (1, -1):
            path = [Vector((x, TOP + y + 0.05, sz * z)) for z, y in top_r]
            path[-1].y -= 0.1
            v, f = g_tube(path, 0.07, 4)
            p.add(v, f, "TC_Copper")
    v, f = g_tube([Vector((-HX - 0.7, ridge_y + 0.02, 0)), Vector((HX + 0.7, ridge_y + 0.02, 0))], 0.22, 6, up=(0, 0, 1))
    p.add(v, f, "TC_Copper")
    v, f = g_cbox(0, ridge_y - 0.6, 0, 7.0, 1.6, 1.6, 0.06)
    p.add(v, f, "TC_Wood")
    for x in lin(-3.2, 3.2, 9):
        v, f = g_box(x - 0.05, ridge_y - 0.3, -0.85, x + 0.05, ridge_y + 0.9, 0.85)
        p.add(v, f, "TC_LimestoneDark")
    gable_roof(p, T(0, ridge_y + 1.0, 0), 7.6, 2.8, 34, thick=0.14, flare=0.25, mat="TC_Copper")
    # stone gables with round grilles
    for sx in (-1, 1):
        tri = [(-HZ - 0.4, 0.0), (FZ + 0.4, 0.0), (0.0, ridge - 0.35)]
        v, f = g_extrude([(z, y + TOP) for z, y in tri], 0, 0.6)
        v = [(sx * (HX - 0.6) + sx * z, y, x) for x, y, z in v]
        p.add(v, f, "TC_Limestone")
        M = T(sx * HX, TOP + 3.3, 0) @ RY(sx * PI / 2)
        pane(p, circle2(1.1, 16), 0.03, M)
        ring = [Vector((1.1 * math.cos(TAU * i / 16), 1.1 * math.sin(TAU * i / 16), 0)) for i in range(16)]
        v, f = g_loft(sweep_rings([(-0.05, 0.0), (0.42, 0.0), (0.42, 0.32), (-0.05, 0.32)], ring, (0, 0, 1), closed=True), True, True, False)
        p.add(v, f, "TC_LimestoneDark", M)
        for a in (0.0, PI / 2):
            v, f = g_box(-1.15, -0.05, 0.04, 1.15, 0.05, 0.12)
            p.add(v, f, "TC_Iron", M @ RZ(a))
    # chimneys (smoke anchors at the flue tops)
    smoke = []
    for x, z in ((-7.2, -3.6), (7.2, -3.6)):
        v, f = g_cbox(x, 8.0, z, 4.2, 8.6, 4.2, 0.16)
        p.add(v, f, "TC_Limestone")
        v, f = g_hull(cbox_pts(x, 16.6, z, 4.2, 0.01, 4.2, 0.0) + cbox_pts(x, 17.4, z, 3.3, 0.01, 3.3, 0.0))
        p.add(v, f, "TC_LimestoneDark")
        v, f = g_cbox(x, 17.4, z, 3.3, 9.6, 3.3, 0.14)
        p.add(v, f, "TC_Limestone")
        for y in (20.2, 23.6):
            v, f = g_cbox(x, y, z, 3.65, 0.5, 3.65, 0.08)
            p.add(v, f, "TC_LimestoneDark")
        v, f = g_hull(cbox_pts(x, 26.6, z, 3.3, 0.01, 3.3, 0.0) + cbox_pts(x, 27.0, z, 4.0, 0.7, 4.0, 0.0))
        p.add(v, f, "TC_LimestoneDark")
        v, f = g_box(x - 1.1, 27.5, z - 1.1, x + 1.1, 27.75, z + 1.1)
        p.add(v, f, "TC_Iron")
        for dx in (-1.45, 1.45):
            for dz in (-1.45, 1.45):
                v, f = g_cbox(x + dx, 27.7, z + dz, 0.26, 1.3, 0.26, 0.0)
                p.add(v, f, "TC_Iron")
        v, f = g_cbox(x, 29.0, z, 3.8, 0.18, 3.8, 0.05)
        p.add(v, f, "TC_Copper")
        pyramid(p, T(x, 29.18, z), 3.6, 1.4, "TC_Copper")
        finial(p, T(x, 30.45, z), 0.7)
        smoke.append([x, 28.4, z])
    # copper pipes and a boiler on the west side
    for z in (-3.0, 1.5):
        path = [Vector((-HX - 0.45, 1.6, z)), Vector((-HX - 0.45, 8.9, z)), Vector((-HX - 0.2, 9.4, z)), Vector((-HX + 0.2, 9.5, z))]
        v, f = g_tube(path, 0.22, 8)
        p.add(v, f, "TC_Copper")
        for y in (2.5, 5.0, 7.5):
            v, f = g_tube([Vector((-HX - 0.45, y, z)), Vector((-HX - 0.45, y + 0.14, z))], 0.3, 8, up=(1, 0, 0))
            p.add(v, f, "TC_Gold")
    v, f = g_cbox(-HX - 2.3, 0.0, -0.75, 3.4, 0.7, 3.4, 0.08)
    p.add(v, f, "TC_LimestoneDark")
    v, f, uv = g_lathe([(0, 0.7), (1.45, 0.7), (1.45, 0.95), (1.35, 1.05), (1.35, 3.3), (1.05, 3.85), (0.5, 4.1), (0, 4.15)], 16, uv_mat="TC_Copper")
    p.add(v, f, "TC_Copper", T(-HX - 2.3, 0, -0.75), uv=uv)
    for y in (1.4, 2.4, 3.2):
        v, f, _ = g_lathe([(1.35, y), (1.43, y), (1.43, y + 0.14), (1.35, y + 0.14)], 16, loop=True)
        p.add(v, f, "TC_Iron", T(-HX - 2.3, 0, -0.75))
    v, f = g_tube([Vector((-HX - 2.3, 4.05, -0.75)), Vector((-HX - 2.3, 4.9, -0.75)), Vector((-HX - 1.3, 5.6, -0.75)), Vector((-HX + 0.1, 5.6, -0.75))], 0.2, 8)
    p.add(v, f, "TC_Copper")
    # waterwheel housing on the east side: bearings, outer pier and a stone race
    wx, wy, wz = HX + 1.85, 5.4, -1.0
    v, f = g_cbox(HX + 0.25, wy - 0.7, wz, 0.5, 1.4, 1.5, 0.06)
    p.add(v, f, "TC_Iron")
    v, f = g_cbox(wx + 2.45, 0.0, wz, 1.3, 4.9, 1.8, 0.1)
    p.add(v, f, "TC_Limestone")
    v, f = g_cbox(wx + 2.45, 4.9, wz, 1.5, 1.1, 1.5, 0.08)
    p.add(v, f, "TC_Iron")
    pyramid(p, T(wx + 2.45, 6.0, wz), 1.5, 0.6, "TC_Copper")
    for x in (HX + 0.45, wx + 1.4):
        v, f = g_cbox(x, 0.0, wz, 0.45, 0.85, 12.5, 0.06)
        p.add(v, f, "TC_LimestoneDark")
    # side buttresses and copper-hooded dormers on the front slope
    for sx in (-1, 1):
        for z in (-6.6, 5.8):
            stepped_buttress(p, T(sx * HX, 0, z) @ RY(sx * PI / 2), [(0.0, 4.2, 1.7), (4.2, 8.4, 1.15)], 1.3)
    for x in (-7.0, 7.0):
        v, f = g_cbox(x, 11.0, 6.3, 2.4, 2.6, 2.8, 0.06)
        p.add(v, f, "TC_Limestone")
        gothic_window(p, T(x, 11.5, 7.7), 1.1, 1.7, depth=0.25, frame=0.2, r_fac=0.5, lights=1, hood=False, sill=False)
        dr, _ = gable_roof(p, T(x, 13.6, 6.2) @ RY(PI / 2), 3.4, 3.0, 45, thick=0.15, flare=0.25, mat="TC_Copper")
        v, f = g_extrude([(-1.2, 0.0), (1.2, 0.0), (0.0, dr - 0.12)], 7.45, 7.7)
        p.add(v, f, "TC_Limestone", T(x, 13.6, 0))
        finial(p, T(x, 13.6 + dr, 7.85), 0.6)
    p.anchors["waterwheel"] = {"piece": "TC_Waterwheel", "pos": [wx, wy, wz], "axis": [1, 0, 0], "waterY": 0.6,
                               "race": {"x": [HX + 0.65, wx + 1.2], "z": [wz - 6.25, wz + 6.25]}}
    p.anchors["smoke"] = smoke
    p.anchors["forgeGlow"] = [0.0, 1.3, 6.8]
    p.anchors["doors"] = [[-8.0, 0.0, FZ - 0.4], [8.0, 0.0, FZ - 0.4]]
    p.anchors["forgeArch"] = {"centre": [0.0, 0.0, FZ], "width": 7.2, "height": 6.8, "depth": 3.0}


def ring_rail(p: Piece, y0, r, posts, h=1.0, M=I4, post_mat="TC_Iron", rail_mat="TC_Gold", segs=32):
    """Balcony railing: posts on a circle and a gold top rail."""
    for k in range(posts):
        a = TAU * (k + 0.5) / posts
        v, f = g_cbox(r * math.sin(a), y0, r * math.cos(a), 0.12, h, 0.12, 0.0)
        p.add(v, f, post_mat, M)
    v, f, _ = g_lathe([(r - 0.1, y0 + h), (r + 0.1, y0 + h), (r + 0.1, y0 + h + 0.14), (r - 0.1, y0 + h + 0.14)], segs, loop=True)
    p.add(v, f, rail_mat, M)
    v, f, _ = g_lathe([(r - 0.05, y0 + h * 0.45), (r + 0.05, y0 + h * 0.45), (r + 0.05, y0 + h * 0.45 + 0.08), (r - 0.05, y0 + h * 0.45 + 0.08)], segs, loop=True)
    p.add(v, f, post_mat, M)


def corbel_ring(p: Piece, y_top, r_wall, n, out=0.7, h=0.6, mat="TC_LimestoneDark"):
    for k in range(n):
        a = TAU * (k + 0.5) / n
        d = Vector((math.sin(a), 0, math.cos(a)))
        t = Vector((math.cos(a), 0, -math.sin(a)))
        pts = []
        for s in (-0.18, 0.18):
            pts += [d * (r_wall - 0.2) + t * s + Vector((0, y_top, 0)), d * (r_wall + out) + t * s + Vector((0, y_top, 0)),
                    d * (r_wall - 0.2) + t * s + Vector((0, y_top - h, 0)), d * (r_wall + 0.1) + t * s + Vector((0, y_top - h, 0))]
        v, f = g_hull([tuple(q) for q in pts])
        p.add(v, f, mat)


def tower_r(y):
    """Shaft radius of the Seaglass Tower between y = 9 and 44 (gentle taper)."""
    return 3.7 - 0.7 * (y - 9.0) / 35.0


@piece("TC_SeaglassTower", 30000)
def build_seaglass_tower(p: Piece):
    # podium and battered drum
    v, f, uv = g_lathe([(0, 0), (7.4, 0), (7.4, 0.3), (6.9, 0.3), (6.9, 0.6), (0, 0.6)], 32, uv_mat="TC_LimestoneDark")
    p.add(v, f, "TC_LimestoneDark", uv=uv)
    v, f, uv = g_lathe([(0, 0.6), (6.35, 0.6), (6.35, 1.25), (6.15, 1.45), (5.9, 8.6), (0, 8.6)], 32, uv_mat="TC_Limestone")
    p.add(v, f, "TC_Limestone", uv=uv)
    v, f, _ = g_lathe([(6.0, 4.6), (6.25, 4.65), (6.25, 4.9), (6.0, 4.95)], 32, loop=True)
    p.add(v, f, "TC_LimestoneDark")
    # buttress fins with seaglass tips
    for k in range(4):
        phi = PI / 4 + k * PI / 2
        d = Vector((math.sin(phi), 0, math.cos(phi)))
        t = Vector((math.cos(phi), 0, -math.sin(phi)))
        pts = []
        for s in (-0.45, 0.45):
            pts += [d * 5.9 + t * s, d * 7.6 + t * s, d * 5.8 + t * s + Vector((0, 7.4, 0)), d * 6.5 + t * s + Vector((0, 7.4, 0))]
            pts += [d * 7.2 + t * s + Vector((0, 2.0, 0))]
        v, f = g_hull([tuple(q) for q in pts])
        p.add(v, f, "TC_Limestone")
        c = d * 6.15 + Vector((0, 7.4, 0))
        v, f = g_hull([tuple(c + d * dd + t * s + Vector((0, yy, 0))) for dd in (-0.35, 0.35) for s in (-0.5, 0.5) for yy in (0.0, 0.25)])
        p.add(v, f, "TC_LimestoneDark")
        pyramid(p, T(*(c + Vector((0, 0.25, 0)))) @ RY(phi), 0.75, 1.6, "TC_Seaglass", 4, PI / 4)
    # door porch on the front
    v, f = g_cbox(0, 0.6, 6.55, 3.6, 4.6, 1.7, 0.1)
    p.add(v, f, "TC_Limestone")
    door_leaf(p, T(0, 0.6, 7.4), 1.0, 2.3, 1.55)
    v, f = g_extrude(arch_frame_poly(1.0, 2.3, 1.55, 0.3, 8), 7.4, 7.72)
    p.add(v, f, "TC_LimestoneDark", T(0, 0.6, 0))
    ridge, _ = gable_roof(p, T(0, 5.2, 6.7) @ RY(PI / 2), 1.9, 4.0, 42, thick=0.2, flare=0.3)
    v, f = g_extrude([(-1.8, 0.0), (1.8, 0.0), (0.0, ridge - 0.2)], 6.9, 7.42)
    p.add(v, f, "TC_Limestone", T(0, 5.2, 0))
    orb(p, T(0, 5.2 + ridge - 0.9, 7.45) @ SC(1, 1, 0.4), 0.38, "TC_Seaglass", segs=10, rings=5)
    finial(p, T(0, 5.2 + ridge, 7.6), 0.9)
    p.anchors["door"] = [0.0, 0.6, 7.4]
    # first balcony on the drum
    corbel_ring(p, 8.6, 5.9, 20, out=0.9, h=0.7)
    v, f, uv = g_lathe([(3.4, 8.6), (6.9, 8.6), (6.9, 9.0), (3.4, 9.0)], 32, loop=True, uv_mat="TC_LimestoneDark")
    p.add(v, f, "TC_LimestoneDark", uv=uv)
    ring_rail(p, 9.0, 6.65, 26, 1.0)
    # shaft: an octagonal core of seaglass framed by eight limestone ribs that follow the taper, string courses at
    # its foot and head, the gold bands across the glass
    prof = [(0, 8.9)] + [(tower_r(y) - 0.18, y) for y in lin(9.0, 44.0, 8)] + [(0, 44.0)]
    v, f, uv = g_lathe(prof, 8, a0=PI / 8, a1=PI / 8 + TAU, uv_mat="TC_Seaglass", r_ref=3.1)
    p.add(v, f, "TC_Seaglass", uv=uv)
    for k in range(8):
        phi = PI / 8 + k * TAU / 8
        d = Vector((math.cos(phi), 0, -math.sin(phi)))
        t = Vector((math.sin(phi), 0, math.cos(phi)))
        pts = []
        for y in (8.9, 44.0):
            r = tower_r(y) - 0.18
            for dd in (-0.25, 0.4):
                for s in (-0.27, 0.27):
                    pts.append(tuple(d * (r + dd) + t * s + Vector((0, y, 0))))
        v, f = g_hull(pts)
        p.add(v, f, "TC_Limestone")
    for y, h in ((8.9, 0.7), (43.2, 0.7)):
        r = tower_r(y + h / 2) + 0.35
        v, f, _ = g_lathe([(r - 0.6, y), (r, y), (r, y + h), (r - 0.6, y + h)], 8, a0=PI / 8, a1=PI / 8 + TAU, loop=True)
        p.add(v, f, "TC_LimestoneDark")
    for y in (18.0, 27.0, 36.0):
        r = tower_r(y)
        v, f, _ = g_lathe([(r - 0.25, y), (r + 0.05, y + 0.04), (r + 0.05, y + 0.24), (r - 0.25, y + 0.28)], 8, a0=PI / 8, a1=PI / 8 + TAU, loop=True)
        p.add(v, f, "TC_Gold")
    # spiral ribbon of deep violet seaglass with gold rails and brackets, wound outside the ribs
    y0, y1, turns = 10.4, 43.0, 3.25
    N = int(turns * 40)
    th0 = PI * 0.15
    path, rail_hi, rail_lo = [], [], []
    for i in range(N + 1):
        y = y0 + (y1 - y0) * i / N
        th = th0 + TAU * turns * i / N
        r = tower_r(y) + 0.62
        d = Vector((math.sin(th), 0, math.cos(th)))
        path.append(d * r + Vector((0, y, 0)))
        rail_hi.append(d * (r + 0.06) + Vector((0, y + 0.92, 0)))
        rail_lo.append(d * (r + 0.06) + Vector((0, y - 0.92, 0)))
    v, f = g_sweep([(-0.2, -0.85), (0.2, -0.85), (0.2, 0.85), (-0.2, 0.85)], path, (0, 1, 0))
    p.add(v, f, "TC_SeaglassDeep")
    for rail in (rail_hi, rail_lo):
        v, f = g_tube(rail, 0.1, 4)
        p.add(v, f, "TC_Gold")
    for i in range(0, N + 1, 10):
        q = path[i]
        d = Vector((q.x, 0, q.z)).normalized()
        a = d * (tower_r(q.y) + 0.1) + Vector((0, q.y - 0.95, 0))
        v, f = g_tube([a, q + d * 0.2 + Vector((0, -0.85, 0))], 0.08, 4)
        p.add(v, f, "TC_Gold")
    # corbelled top chamber with seaglass windows
    v, f, uv = g_lathe([(0, 43.8), (tower_r(44.0), 43.8), (3.15, 44.4), (3.8, 45.3), (4.45, 45.9), (0, 45.9)], 28, uv_mat="TC_LimestoneDark")
    p.add(v, f, "TC_LimestoneDark", uv=uv)
    v, f, uv = g_lathe([(0, 45.8), (4.4, 45.8), (4.4, 53.0), (0, 53.0)], 32, uv_mat="TC_Limestone")
    p.add(v, f, "TC_Limestone", uv=uv)
    corbel_ring(p, 45.75, 4.0, 18, out=1.5, h=0.9)
    v, f, uv = g_lathe([(4.2, 45.4), (5.95, 45.4), (5.95, 45.8), (4.2, 45.8)], 32, loop=True, uv_mat="TC_LimestoneDark")
    p.add(v, f, "TC_LimestoneDark", uv=uv)
    ring_rail(p, 45.8, 5.7, 22, 1.0)
    for k in range(8):
        phi = k * PI / 4 + PI / 8
        r = 4.4 * math.cos(PI / 32)
        gothic_window(p, T(r * math.sin(phi), 47.0, r * math.cos(phi)) @ RY(phi), 1.3, 4.4, depth=0.35, frame=0.24,
                      r_fac=1.0, lights=1, mat_glass="TC_Seaglass", hood=True)
    v, f, _ = g_lathe([(4.35, 52.6), (4.75, 52.75), (4.95, 53.05), (4.95, 53.3), (4.35, 53.3)], 32)
    p.add(v, f, "TC_Limestone")
    v, f, _ = g_lathe([(4.9, 52.9), (5.02, 52.9), (5.02, 53.05), (4.9, 53.05)], 32, loop=True)
    p.add(v, f, "TC_Gold")
    # pointed cap with gold bands, four seaglass dormers and the finial
    y0c, hc, re = 53.3, 11.0, 5.7
    cone_roof(p, I4, re, y0c, hc, segs=28, flare=1.0, thick=0.3)
    rk, yk = re - 1.0, y0c + 0.3 + 1.0 * math.tan(math.atan2(hc, re)) * 0.45
    apex = y0c + hc

    def cone_r(y):
        return rk * (apex - y) / (apex - yk)

    for y in (57.2, 60.6):
        r = cone_r(y)
        v, f, _ = g_lathe([(r - 0.05, y), (r + 0.1, y + 0.02), (cone_r(y + 0.3) + 0.1, y + 0.3), (cone_r(y + 0.3) - 0.05, y + 0.3)], 28, loop=True)
        p.add(v, f, "TC_Gold")
    for k in range(4):
        phi = k * PI / 2
        M = T(0, 0, 0) @ RY(phi)
        v, f = g_cbox(0, 54.5, 3.5, 1.2, 1.6, 2.0, 0.06)
        p.add(v, f, "TC_Limestone", M)
        gable_roof(p, M @ T(0, 56.1, 3.5) @ RY(PI / 2), 2.2, 1.6, 48, thick=0.12, flare=0.15)
        pane(p, arch_window_outline(0.36, 0.6, 0.36, 6), 0.0, M @ T(0, 54.75, 4.51), "TC_Seaglass")
    finial(p, T(0, apex - 0.5, 0), 2.6)
    p.anchors["crystal"] = {"piece": "TC_SeaglassCrystal", "pos": [0.0, 69.5, 0.0], "spinAxis": [0, 1, 0], "bob": 0.5}
    p.anchors["glow"] = [[0.0, 49.0, 0.0]]


@piece("TC_SeaglassCrystal", 3000, ground=False, note="Origin at the cluster centre; spin about +Y. Hovers at TC_SeaglassTower anchors.crystal.pos.")
def build_seaglass_crystal(p: Piece):
    def crystal(M, r, up, down, n=6):
        pts = [(r * math.cos(TAU * i / n), y, r * math.sin(TAU * i / n)) for i in range(n) for y in (-0.15 * r, 0.25 * r)]
        v, f = g_hull(pts + [(0, up, 0), (0, -down, 0)])
        p.add(v, f, "TC_SeaglassDeep", M)

    crystal(I4, 0.95, 2.9, 2.1)
    for k in range(6):
        a = TAU * k / 6
        tilt = 0.55 if k % 2 == 0 else 0.85
        crystal(RY(a) @ T(0.0, (0.3 if k % 2 else -0.2), 0.0) @ RZ(-tilt) @ T(0, 0.6, 0), 0.38, 1.3, 0.3)
    for k in range(3):
        a = TAU * k / 3 + PI / 3
        crystal(RY(a) @ T(0, -0.6, 0) @ RZ(PI - 0.6) @ T(0, 0.5, 0), 0.3, 1.0, 0.25)
    v, f, _ = g_lathe([(2.05, -0.05), (2.25, -0.05), (2.25, 0.05), (2.05, 0.05)], 32, loop=True)
    p.add(v, f, "TC_Gold", RX(0.35))
    for k in range(4):
        a = TAU * k / 4
        orb(p, RX(0.35) @ T(2.15 * math.cos(a), 0, 2.15 * math.sin(a)), 0.14, segs=8, rings=4)


# ---------------------------------------------------------------------------------------------
# Cathedral of the Tide
# ---------------------------------------------------------------------------------------------
def rose_window(p: Piece, M, R):
    """Rose window on a wall at local z = 0: wave ring, spokes, cusps and a gold claw at the heart."""
    pane(p, circle2(R, 32), 0.03, M)
    ring = [Vector((R * math.cos(TAU * i / 32), R * math.sin(TAU * i / 32), 0)) for i in range(32)]
    v, f = g_loft(sweep_rings([(-0.12, 0.0), (0.75, 0.0), (0.75, 0.32), (0.5, 0.62), (-0.12, 0.62)], ring, (0, 0, 1), closed=True), True, True, False)
    p.add(v, f, "TC_Limestone", M)
    ring2 = [Vector(((R + 0.95) * math.cos(TAU * i / 32), (R + 0.95) * math.sin(TAU * i / 32), 0)) for i in range(32)]
    v, f = g_loft(sweep_rings([(-0.1, 0.0), (0.22, 0.0), (0.22, 0.26), (-0.1, 0.26)], ring2, (0, 0, 1), closed=True), True, True, False)
    p.add(v, f, "TC_LimestoneDark", M)
    bar = [(-0.07, 0.0), (0.07, 0.0), (0.07, 0.36), (-0.07, 0.36)]
    # wave ring
    rw = 0.66 * R
    wave = [Vector(((rw + 0.09 * R * math.sin(12 * TAU * i / 96)) * math.cos(TAU * i / 96),
                    (rw + 0.09 * R * math.sin(12 * TAU * i / 96)) * math.sin(TAU * i / 96), 0)) for i in range(96)]
    v, f = g_loft(sweep_rings(bar, wave, (0, 0, 1), closed=True), True, True, False)
    p.add(v, f, "TC_Limestone", M)
    ri = 0.34 * R
    inner = [Vector((ri * math.cos(TAU * i / 20), ri * math.sin(TAU * i / 20), 0)) for i in range(20)]
    v, f = g_loft(sweep_rings([(-0.09, 0.0), (0.09, 0.0), (0.09, 0.42), (-0.09, 0.42)], inner, (0, 0, 1), closed=True), True, True, False)
    p.add(v, f, "TC_Limestone", M)
    for k in range(12):
        a = TAU * k / 12 + PI / 12
        # inner spokes to the wave troughs, outer spokes to the ring
        for r0, r1, aa in ((ri, rw - 0.05 * R, a), (rw + 0.05 * R, R, a + PI / 12)):
            c, s = math.cos(aa), math.sin(aa)
            pts = [(r0 * c - 0.07 * s, r0 * s + 0.07 * c), (r1 * c - 0.07 * s, r1 * s + 0.07 * c), (r1 * c + 0.07 * s, r1 * s - 0.07 * c), (r0 * c + 0.07 * s, r0 * s - 0.07 * c)]
            v, f = g_extrude(pts, 0.0, 0.34)
            p.add(v, f, "TC_Limestone", M)
        # cusped lobe between outer spokes
        ca = a
        cr = 0.84 * R
        lob = [Vector((cr * math.cos(ca) + 0.15 * R * math.cos(t), cr * math.sin(ca) + 0.15 * R * math.sin(t), 0)) for t in lin(ca + PI * 0.55, ca + PI * 1.45, 7)]
        v, f = g_sweep(bar, lob, (0, 0, 1))
        p.add(v, f, "TC_Limestone", M)
    v, f = g_extrude(crab_claw_poly(0.27 * R, 30, 12), 0.05, 0.28)
    p.add(v, f, "TC_Gold", M @ T(0, -0.04 * R, 0))
    orb(p, M @ T(0, 0.02 * R, 0.2), 0.07 * R, "TC_Gold", segs=8, rings=4)


def great_portal(p: Piece, M, halfw, hs, r):
    """Recessed portal on a wall at local z = 0 with three archivolts, doors and a gable."""
    door_leaf(p, M, halfw, hs, r, 0.0, 0.16)
    steps = [(0.42, 1.55, "TC_Limestone"), (0.42, 1.05, "TC_LimestoneDark"), (0.42, 0.55, "TC_Limestone")]
    hw, rr = halfw, r
    for k, (w, depth, mat) in enumerate(reversed(steps)):
        v, f = g_extrude(arch_frame_poly(hw, hs, rr, w, 10), 0.0, depth)
        p.add(v, f, mat, M)
        # colonnette in each jamb step
        for sx in (-1, 1):
            v, f, _ = g_lathe([(0, 0), (0.2, 0), (0.2, 0.2), (0.12, 0.3), (0.12, hs - 0.3), (0.2, hs - 0.15), (0.22, hs), (0, hs)], 8)
            p.add(v, f, "TC_Limestone" if k != 1 else "TC_LimestoneDark", M @ T(sx * (hw + w / 2), 0, depth + 0.05))
        hw, rr = hw + w, rr + w
    apex = arch_apex(hw, hs, rr)
    # tympanum boss: gold claw over the doors
    v, f = g_extrude(crab_claw_poly(0.55, 30, 10), 0.16, 0.3)
    p.add(v, f, "TC_Gold", M @ T(0, arch_apex(halfw, hs, r) - 1.1, 0))
    # wimperg gable with crockets and a finial
    gy = hs + 0.2
    top = apex + 1.9
    path = [Vector((-hw - 0.2, gy, 1.55)), Vector((0.0, top, 1.55)), Vector((hw + 0.2, gy, 1.55))]
    v, f = g_sweep([(-0.28, -0.25), (0.28, -0.25), (0.28, 0.0), (-0.28, 0.0)], path, (0, 0, 1), miter=True)
    p.add(v, f, "TC_Limestone", M)
    for t in (0.25, 0.5, 0.75):
        for sx in (-1, 1):
            q = Vector((sx * (hw + 0.2) * (1 - t), gy + (top - gy) * t, 1.55))
            pyramid(p, M @ T(q.x, q.y + 0.2, q.z - 0.1), 0.32, 0.5, "TC_Gold", 4, PI / 4)
    finial(p, M @ T(0, top + 0.1, 1.45), 1.3)
    for sx in (-1, 1):
        pinnacle(p, sx * (hw + 0.55), 0.0, 1.1, 0.85, hs + 2.8, M)
    # steps up to the door
    for k in range(2):
        v, f = g_cbox(0, -0.3 * (k + 1), 0.9 + 0.55 * k, 2 * hw + 1.8 + 0.8 * k, 0.3, 1.8 + 1.1 * k, 0.05)
        p.add(v, f, "TC_LimestoneDark", M)
    return apex


def belfry_opening(p: Piece, M, w, h):
    halfw = w / 2
    r = w * 0.95
    hs = h - math.sqrt(r * r - (halfw - r) ** 2)
    v, f = g_extrude(arch_window_outline(halfw, hs, r, 8), 0.0, 0.05)
    p.add(v, f, "TC_Iron", M)
    v, f = g_extrude(arch_frame_poly(halfw, hs, r, 0.34, 8), 0.0, 0.55)
    p.add(v, f, "TC_Limestone", M)
    for yy in lin(0.4, hs + 0.6, 7):
        v, f = g_hull([(x, y, z) for x in (-halfw + 0.02, halfw - 0.02) for y, z in ((yy, 0.06), (yy + 0.42, 0.06), (yy + 0.42, 0.38))])
        p.add(v, f, "TC_Wood", M)
    v, f = g_cbox(0, -0.3, 0.3, w + 0.9, 0.3, 0.75, 0.06)
    p.add(v, f, "TC_Limestone", M)


def stepped_buttress(p: Piece, M, stages, width, cap_mat="TC_LimestoneDark"):
    """Buttress against a wall at local z = 0 projecting to +z; stages = [(y0, y1, depth)]."""
    for y0, y1, d in stages:
        v, f = g_cbox(0, y0, d / 2 - 0.3, width, y1 - y0, d + 0.6, 0.08)
        p.add(v, f, "TC_Limestone", M)
        v, f = g_hull([(x, y1, z) for x in (-width / 2, width / 2) for z in (-0.3, d)] + [(x, y1 + 0.55, -0.3) for x in (-width / 2, width / 2)] +
                      [(x, y1 + 0.12, d + 0.08) for x in (-width / 2 - 0.06, width / 2 + 0.06)])
        p.add(v, f, cap_mat, M)


@piece("TC_Cathedral", 60000)
def build_cathedral(p: Piece):
    NX, AX = 7.0, 12.0          # clerestory and aisle outer faces
    ZF, ZB = 16.0, -18.0        # nave front (behind the tower) and back (apse chord)
    NAVE_TOP, AISLE_TOP = 18.0, 9.6
    TX, TZ0, TZ1 = 5.5, 15.5, 26.5  # tower half width, back and front
    bays = [ZF - 6.8 * k for k in range(6)]  # 16 .. -18
    # main volumes
    v, f = g_box(-NX, 0, ZB, NX, NAVE_TOP, TZ0 + 0.5)
    p.add(v, f, "TC_Limestone")
    for sx in (-1, 1):
        v, f = g_box(min(sx * NX, sx * AX), 0, ZB, max(sx * NX, sx * AX), AISLE_TOP, ZF)
        p.add(v, f, "TC_Limestone")
    apse = [(7.0 * math.cos(PI * k / 5), ZB - 7.0 * math.sin(PI * k / 5)) for k in range(6)]
    v, f = g_prism(apse, 0.0, NAVE_TOP)
    p.add(v, f, "TC_Limestone")
    # plinth and cornices following the outline
    outline = [(TX, TZ1), (TX, ZF), (AX, ZF), (AX, ZB)] + [(x, z) for x, z in apse[:]] + [(-AX, ZB), (-AX, ZF), (-TX, ZF), (-TX, TZ1)]
    outline = [outline[0], outline[1], outline[2], outline[3]] + apse + outline[-4:]
    clean = []
    for q in outline:
        if not clean or (abs(q[0] - clean[-1][0]) + abs(q[1] - clean[-1][1])) > 1e-6:
            clean.append(q)
    molding_loop(p, clean, 0.0, PLINTH, "TC_LimestoneDark")
    for sx in (-1, 1):
        path = [Vector((sx * AX, AISLE_TOP - 0.35, ZF)), Vector((sx * AX, AISLE_TOP - 0.35, ZB))]
        v, f = g_sweep([(-0.05 * sx, 0.0), (0.38 * sx, 0.0), (0.38 * sx, 0.38), (-0.05 * sx, 0.38)], path, (0, 1, 0))
        p.add(v, f, "TC_Limestone")
        path = [Vector((sx * AX, 4.6, ZF)), Vector((sx * AX, 4.6, ZB))]
        v, f = g_sweep([(-0.05 * sx, 0.0), (0.2 * sx, 0.0), (0.2 * sx, 0.2), (-0.05 * sx, 0.2)], path, (0, 1, 0))
        p.add(v, f, "TC_LimestoneDark")
    cpath = [Vector((NX, NAVE_TOP - 0.4, TZ0))] + [Vector((x, NAVE_TOP - 0.4, z)) for x, z in apse] + [Vector((-NX, NAVE_TOP - 0.4, TZ0))]
    rings = sweep_rings(CORNICE, cpath, (0, 1, 0), miter=True)
    probe = sweep_rings([(1.0, 0.0)], cpath, (0, 1, 0), miter=True)[1][0]
    if abs(probe.x) < NX:
        rings = sweep_rings([(-a, b) for a, b in CORNICE], cpath, (0, 1, 0), miter=True)
    v, f = g_loft(rings, True, False, True)
    p.add(v, f, "TC_Limestone")
    # nave roof (gold cresting) and the apse half-cone
    ridge, top_r = gable_roof(p, T(0, NAVE_TOP, (TZ0 + ZB) / 2) @ RY(PI / 2), TZ0 - ZB + 0.2, 2 * NX + 1.7, 52, thick=0.35, flare=1.0, ridge_mat="TC_Gold")
    ry = NAVE_TOP + ridge
    hw = NX + 0.85
    eave = [(hw * math.cos(PI * k / 10), ZB - hw * math.sin(PI * k / 10)) for k in range(11)]
    pts = [(x, NAVE_TOP + 0.05, z) for x, z in eave] + [(x, NAVE_TOP - 0.3, z) for x, z in eave] + [(0, ry, ZB)]
    v, f = g_hull(pts)
    p.add(v, f, "TC_Slate")
    for k in range(1, 10, 2):
        x, z = eave[k]
        v, f = g_tube([Vector((x, NAVE_TOP + 0.1, z)), Vector((0, ry + 0.08, ZB))], 0.12, 4)
        p.add(v, f, "TC_Slate")
    finial(p, T(0, ry + 0.1, ZB), 1.6)
    # aisle lean-to roofs
    for sx in (-1, 1):
        run, rise = AX + 0.55 - NX, 3.2
        L = ZF - ZB + 0.6
        a = math.atan2(rise, run)
        poly = [(0.0, 0.0), (run, -rise), (run, -rise - 0.3), (0.0, -0.3)]
        v, f = g_extrude(poly, -L / 2, L / 2)
        du, dv = UV_DENSITY["TC_Slate"]
        uvs = [None] * len(f)
        # f[2] is the side for edge 0->1 (the slope, [0, 1, 5, 4]): u along the roof, v up the slope
        sl = math.hypot(run, rise)
        uvs[2] = [(-L / 2 * du, sl * dv), (-L / 2 * du, 0.0), (L / 2 * du, 0.0), (L / 2 * du, sl * dv)]
        v = [(sx * (NX + x), AISLE_TOP + rise + 0.25 + y, (ZF + ZB) / 2 + z) for x, y, z in v]
        p.add(v, f, "TC_Slate", uv=uvs)
    # flying buttresses on piers, aisle and clerestory windows
    for sx in (-1, 1):
        mx = I4 if sx > 0 else MIRROR_X
        for k, zb in enumerate(bays):
            zp = min(zb, ZF - 0.75) if k == 0 else max(zb, ZB + 0.75)
            stepped_buttress(p, mx @ T(AX, 0, zp) @ RY(PI / 2), [(0.0, 5.4, 2.5), (5.4, 10.6, 2.0), (10.6, 14.2, 1.55)], 1.5)
            pinnacle(p, AX + 0.78, 14.75, zp, 1.15, 6.6, mx)
            if 0 < k:
                top = [(NX - 0.05, 17.4), (AX + 0.1, 14.45)]
                p3, p4 = Vector((AX + 0.1, 12.9)), Vector((NX - 0.05, 15.2))
                ch = p4 - p3
                nrm = Vector((-ch.y, ch.x)).normalized()
                if nrm.y < 0:
                    nrm = -nrm
                under = [p3 + ch * t + nrm * 0.75 * 4 * t * (1 - t) for t in lin(0.0, 1.0, 9)]
                poly = top + [(q.x, q.y) for q in under]
                v, f = g_extrude(poly, zp - 0.42, zp + 0.42)
                p.add(v, f, "TC_Limestone", mx)
                v, f = g_sweep([(-0.5, 0.0), (0.5, 0.0), (0.5, 0.16), (-0.5, 0.16)], [Vector((NX - 0.05, 17.42, zp)), Vector((AX + 0.1, 14.47, zp))], (0, 1, 0))
                p.add(v, f, "TC_LimestoneDark", mx)
        for k in range(5):
            zc = (bays[k] + bays[k + 1]) / 2
            gothic_window(p, mx @ T(AX, 2.6, zc) @ RY(PI / 2), 2.6, 5.6, depth=0.45, frame=0.3, r_fac=0.9)
            gothic_window(p, mx @ T(NX, 13.4, zc) @ RY(PI / 2), 2.7, 4.0, depth=0.4, frame=0.28, r_fac=0.85)
        # aisle front wall with a window
        poly = [(TX, 0.0), (AX, 0.0), (AX, AISLE_TOP + 0.3), (NX, AISLE_TOP + 3.75), (TX, AISLE_TOP + 3.75)]
        v, f = g_extrude(poly, ZF - 0.6, ZF + 0.25)
        p.add(v, f, "TC_Limestone", mx)
        gothic_window(p, mx @ T((TX + AX) / 2 + 0.2, 3.0, ZF + 0.25), 2.0, 5.2, depth=0.4, frame=0.28)
        v, f = g_sweep([(-0.3, 0.0), (0.3, 0.0), (0.3, 0.3), (-0.3, 0.3)], [Vector((AX + 0.2, AISLE_TOP + 0.3, ZF - 0.17)), Vector((NX, AISLE_TOP + 3.75, ZF - 0.17)), Vector((TX, AISLE_TOP + 3.75, ZF - 0.17))], (0, 0, 1), miter=True)
        p.add(v, f, "TC_LimestoneDark", mx)
    # apse windows and radial buttresses
    for k in range(5):
        a = PI * (k + 0.5) / 5
        d = Vector((math.cos(a), 0, -math.sin(a)))
        apo = 7.0 * math.cos(PI / 10)
        phi = math.atan2(d.x, d.z)
        gothic_window(p, T(d.x * apo, 5.0, ZB + d.z * apo) @ RY(phi), 2.3, 9.5, depth=0.45, frame=0.3, r_fac=0.9)
    for k in range(1, 5):
        a = PI * k / 5
        d = Vector((math.cos(a), 0, -math.sin(a)))
        phi = math.atan2(d.x, d.z)
        M = T(d.x * 7.0, 0, ZB + d.z * 7.0) @ RY(phi)
        stepped_buttress(p, M, [(0.0, 6.0, 2.3), (6.0, 12.0, 1.8), (12.0, 15.6, 1.3)], 1.3)
        pinnacle(p, 0, 16.15, 0.65, 1.05, 5.8, M)
    # gable wall at the nave front (mostly behind the tower)
    v, f = g_extrude([(-NX - 0.5, NAVE_TOP), (NX + 0.5, NAVE_TOP), (0.0, ry - 0.4)], TZ0 - 0.6, TZ0 + 0.2)
    p.add(v, f, "TC_Limestone")
    build_cathedral_tower(p, TX, TZ0, TZ1)
    p.anchors["door"] = [0.0, 0.6, TZ1 + 0.16]
    p.anchors["bells"] = [0.0, 28.0, (TZ0 + TZ1) / 2]
    p.anchors["roseWindow"] = {"centre": [0.0, 17.6, TZ1], "radius": 3.3}


def build_cathedral_tower(p: Piece, TX, TZ0, TZ1):
    TOP = 34.0
    zc = (TZ0 + TZ1) / 2
    v, f = g_cbox(0, 0, zc, 2 * TX, TOP, TZ1 - TZ0, 0.12)
    p.add(v, f, "TC_Limestone")
    sq = rect_xz(-TX, TZ0, TX, TZ1)
    for y, prof, mat in ((12.5, STRING, "TC_LimestoneDark"), (22.4, STRING, "TC_LimestoneDark"), (TOP - 0.45, CORNICE, "TC_Limestone")):
        molding_loop(p, sq, y, prof, mat)
    # clasping corner buttresses, two per corner
    stages = [(0.0, 12.5, 1.5), (12.5, 22.4, 1.15), (22.4, 31.6, 0.8)]
    for sx in (-1, 1):
        for sz, zface in ((1, TZ1), (-1, TZ0)):
            # projecting along z from the front/back face
            M = T(sx * (TX - 0.75), 0, zface) @ (I4 if sz > 0 else RY(PI))
            stepped_buttress(p, M, stages, 1.5)
            # projecting along x from the side face
            M = T(sx * TX, 0, zface - sz * 0.75) @ RY(sx * PI / 2)
            stepped_buttress(p, M, stages, 1.5)
            pinnacle(p, sx * (TX + 0.15), TOP - 0.1, zface + sz * 0.15, 1.6, 7.2)
    # great door, rose window, belfry
    great_portal(p, T(0, 0.6, TZ1), 1.85, 4.2, 3.2)
    rose_window(p, T(0, 17.6, TZ1), 3.3)
    for face in range(4):
        phi = face * PI / 2
        half = TZ1 - TZ0
        M = T(0, 0, zc) @ RY(phi) @ T(0, 0, half / 2)
        for x in (-1.75, 1.75):
            belfry_opening(p, M @ T(x, 24.0, 0), 2.1, 7.6)
        if face in (1, 3):
            # tall lancet on the side faces at rose level
            gothic_window(p, M @ T(0, 14.2, 0), 2.0, 5.6, depth=0.4, frame=0.28)
    # parapet with merlons
    for face in range(4):
        phi = face * PI / 2
        M = T(0, 0, zc) @ RY(phi) @ T(0, 0, 5.5)
        v, f = g_box(-TX + 0.2, TOP, -0.45, TX - 0.2, TOP + 0.55, 0.15)
        p.add(v, f, "TC_Limestone", M)
        for x in lin(-3.6, 3.6, 5):
            v, f = g_cbox(x, TOP + 0.55, -0.15, 0.9, 0.8, 0.6, 0.06)
            p.add(v, f, "TC_Limestone", M)
    # octagonal spire with a flared skirt, gold bands, crockets and lucarnes
    y0, apex = TOP + 0.6, 68.0
    a8 = PI / 8
    oct_ = lambda r, y: [(r * math.cos(a8 + TAU * i / 8), y, zc + r * math.sin(a8 + TAU * i / 8)) for i in range(8)]
    v, f = g_hull(oct_(5.45, y0) + oct_(5.45, y0 + 0.3) + oct_(4.55, y0 + 1.5) + oct_(4.55, y0))
    p.add(v, f, "TC_Slate")
    yb = y0 + 1.45
    rb = 4.55
    v, f = g_hull(oct_(rb, yb) + [(0, apex, zc)])
    p.add(v, f, "TC_Slate")

    def sr(y):
        return rb * (apex - y) / (apex - yb)

    for y in (44.5, 55.0, 62.5):
        v, f = g_hull(oct_(sr(y) + 0.14, y) + oct_(sr(y + 0.45) + 0.14, y + 0.45))
        p.add(v, f, "TC_Gold")
    for i in range(8):
        a = a8 + TAU * i / 8
        for y in lin(yb + 3.5, apex - 5.0, 5):
            r = sr(y) + 0.05
            pyramid(p, T(r * math.cos(a), y, zc + r * math.sin(a)) @ RY(-a + PI / 2) @ RX(0.45), 0.6, 1.0, "TC_Gold", 4, PI / 4)
    for k in range(4):
        phi = k * PI / 2
        M = T(0, 0, zc) @ RY(phi)
        v, f = g_cbox(0, 37.0, 3.9, 1.5, 2.4, 2.0, 0.06)
        p.add(v, f, "TC_Limestone", M)
        gable_roof(p, M @ T(0, 39.4, 3.85) @ RY(PI / 2), 2.1, 1.9, 50, thick=0.14, flare=0.15)
        pane(p, arch_window_outline(0.42, 0.9, 0.42, 6), 0.0, M @ T(0, 37.4, 4.91))
        finial(p, M @ T(0, 39.4 + 1.0, 4.85), 0.6)
    # finial: gold orb, crab claw crescent and spike
    orb(p, T(0, apex + 0.45, zc), 0.6, segs=12, rings=6)
    v, f = g_extrude(crab_claw_poly(1.25, 30, 12, teeth=0), -0.16, 0.16)
    p.add(v, f, "TC_Gold", T(0, apex + 2.25, zc))
    v, f, _ = g_lathe([(0, apex + 0.9), (0.14, apex + 0.9), (0.08, apex + 3.6), (0, apex + 4.6)], 8)
    p.add(v, f, "TC_Gold", T(0, 0, zc))
    orb(p, T(0, apex + 2.2, zc), 0.32, segs=10, rings=5)


# ---------------------------------------------------------------------------------------------
# Mesh assembly: normals, UVs, AO, export
# ---------------------------------------------------------------------------------------------
def box_uv(P, n: Vector, mat):
    du, dv = UV_DENSITY[mat]
    if abs(n.y) > 0.95:
        return [(p.x * du, -p.z * dv * (1 if n.y > 0 else -1)) for p in P]
    t = Vector((0, 1, 0)).cross(n).normalized()
    s = n.cross(t).normalized()
    return [(p.dot(t) * du, p.dot(s) * dv) for p in P]


_DIRS = None


def ao_dirs(n=24):
    """Cosine-weighted hemisphere directions (Hammersley), local z up."""
    out = []
    for i in range(n):
        u1 = (i + 0.5) / n
        b, x, k = 0.0, 0.5, i
        while k:
            if k & 1:
                b += x
            x *= 0.5
            k >>= 1
        r = math.sqrt(u1)
        phi = TAU * b
        out.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1 - u1)))))
    return out


def bake_ao(p: Piece, me, max_dist=3.0, strength=0.9):
    global _DIRS
    if _DIRS is None:
        _DIRS = ao_dirs(24)
    verts = [v.co.copy() for v in me.vertices]
    polys = [tuple(pl.vertices) for pl in me.polygons]
    extra = []
    if p.ground:
        G = 400.0
        extra.append([(-G, -0.002, -G), (G, -0.002, -G), (G, -0.002, G), (-G, -0.002, G)])
    extra += p.occluders
    for q in extra:
        base = len(verts)
        verts += [Vector(c) for c in q]
        polys.append(tuple(range(base, base + 4)))
    bvh = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    attr = me.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
    cache = {}
    cn = me.corner_normals
    for li, loop in enumerate(me.loops):
        n = cn[li].vector
        key = (loop.vertex_index, round(n.x, 3), round(n.y, 3), round(n.z, 3))
        val = cache.get(key)
        if val is None:
            o = me.vertices[loop.vertex_index].co + n * 0.02
            # tangent frame with a per-point rotation (deterministic hash)
            t = n.orthogonal().normalized()
            b = n.cross(t)
            h = math.sin(o.x * 12.9898 + o.y * 78.233 + o.z * 37.719) * 43758.5453
            rot = (h - math.floor(h)) * TAU
            c, s = math.cos(rot), math.sin(rot)
            t, b = t * c + b * s, b * c - t * s
            occ = 0.0
            for d in _DIRS:
                w = t * d.x + b * d.y + n * d.z
                hit = bvh.ray_cast(o, w, max_dist)
                if hit[0] is not None:
                    occ += 1.0 - (hit[3] / max_dist) ** 2
            ao = 1.0 - strength * occ / len(_DIRS)
            val = max(0.25, min(1.0, ao))
            cache[key] = val
        attr.data[li].color = (val, val, val, 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0


_MATS: dict = {}


def get_mat(name):
    m = _MATS.get(name)
    if m:
        return m
    col, metal, rough, emit = MATS[name]
    m = bpy.data.materials.new(name)
    m.use_backface_culling = True
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*col, 1.0)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit > 0:
        bsdf.inputs["Emission Color"].default_value = (*col, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = (*col, 1.0)
    _MATS[name] = m
    return m


def build_object(p: Piece):
    me = bpy.data.meshes.new(p.name + "_mesh")
    me.from_pydata([tuple(v) for v in p.V], [], [list(f) for f in p.F])
    used = [m for m in MAT_ORDER if m in set(p.M)]
    for m in used:
        me.materials.append(get_mat(m))
    for poly, m in zip(me.polygons, p.M):
        poly.material_index = used.index(m)
    uvl = me.uv_layers.new(name="UVMap")
    for poly, m, uvf in zip(me.polygons, p.M, p.UV):
        P = [p.V[k] for k in p.F[poly.index]]
        uvs = uvf if uvf is not None else box_uv(P, poly.normal.copy(), m)
        for li, uv in zip(poly.loop_indices, uvs):
            uvl.data[li].uv = uv
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(38))
    me.update()
    if not args.no_ao:
        bake_ao(p, me)
    holder = bpy.data.objects.new(p.name, None)
    bpy.context.scene.collection.objects.link(holder)
    ob = bpy.data.objects.new(p.name + "_mesh", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = holder
    me.calc_loop_triangles()
    return holder, ob, len(me.loop_triangles)


def r3(v):
    return [round(float(x), 3) for x in v]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    only = set(x for x in args.only.split(",") if x)
    built = []
    for name, budget, kw, fn in PIECES:
        if only and name not in only:
            continue
        p = Piece(name, budget, **kw)
        fn(p)
        holder, ob, tris = build_object(p)
        lo = Vector((min(v.x for v in p.V), min(v.y for v in p.V), min(v.z for v in p.V)))
        hi = Vector((max(v.x for v in p.V), max(v.y for v in p.V), max(v.z for v in p.V)))
        built.append((p, holder, ob, tris, lo, hi))
        print(f"PIECE {name:24s} tris {tris:6d} / {budget:6d}  bounds {r3(lo)} {r3(hi)}  mats {sorted(set(p.M))}")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_yup=False,
        export_apply=False,
        export_extras=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_image_format="NONE",
    )
    if args.json:
        doc = {
            "file": "public/models/world/tidecrown-city.glb",
            "generator": "tools/build_tidecrown_city.py",
            "units": "game units (crab = 1 tall, storey = 3, town door about 2 x 3); Y up; origin at the ground centre of the footprint; main door faces +Z",
            "materials": MAT_ORDER,
            "uvDensity": {
                "note": "UV units per game unit, u along the horizontal tangent, v up the wall or up the roof slope (glTF V decreases upwards like the kit). Measured on village.glb: MI_Brick and MI_UnevenBrick walls 0.500 x 0.475, MI_RoundTiles roofs 0.225 x 0.194 (Roof_RoundTiles_*), Roof_Tower_RoundTiles 0.26 x 0.23, MI_WoodTrim about 0.45. Round towers and cones wrap u to whole tiles. TC_Glass windows and TC_Banner cloths each get their own 0..1 square.",
                "perMaterial": {k: {"u": v[0], "v": v[1]} for k, v in UV_DENSITY.items()},
                "kitTextureFor": {"TC_Limestone": "MI_Brick", "TC_LimestoneDark": "MI_UnevenBrick", "TC_Slate": "MI_RoundTiles", "TC_Copper": "MI_RoundTiles", "TC_Wood": "MI_WoodTrim"},
            },
            "vertexColor": "COLOR_0 = baked ambient occlusion (linear grey, alpha 1); multiply into the base colour",
            "pieces": {},
        }
        for p, holder, ob, tris, lo, hi in built:
            doc["pieces"][p.name] = {
                "triangles": tris,
                "budget": p.budget,
                "bounds": {"min": r3(lo), "max": r3(hi)},
                "size": r3(hi - lo),
                "materials": [m for m in MAT_ORDER if m in set(p.M)],
                "anchors": p.anchors,
                **({"note": p.note} if p.note else {}),
            }
        Path(args.json).write_text(json.dumps(doc, indent=2) + "\n")
    if args.render:
        render_previews(built, Path(args.render))


# ---------------------------------------------------------------------------------------------
# Previews (not part of the export)
# ---------------------------------------------------------------------------------------------
def preview_material(name, textured):
    """Preview shader: base colour (or tinted kit texture) times the baked AO."""
    col, metal, rough, emit = MATS[name]
    m = bpy.data.materials.new(name + ("_tex" if textured else "_flat"))
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    ao = nt.nodes.new("ShaderNodeVertexColor")
    ao.layer_name = "AO"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    base = (*col, 1.0)
    src = None
    kit = {"TC_Limestone": ("MI_Brick", (1.0, 0.95, 0.84), 2.1), "TC_LimestoneDark": ("MI_UnevenBrick", (0.95, 0.9, 0.8), 1.7),
           "TC_Slate": ("MI_RoundTiles", (0.20, 0.38, 0.85), 1.0), "TC_Copper": ("MI_RoundTiles", (0.45, 0.9, 0.75), 1.0),
           "TC_Wood": ("MI_WoodTrim", (1.0, 1.0, 1.0), 1.0)}
    if textured and args.textures and name in kit:
        tex, tint, gain = kit[name]
        img_path = Path(args.textures) / f"{tex}_base.png"
        if img_path.exists():
            img = bpy.data.images.load(str(img_path), check_existing=True)
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.image = img
            src = tn.outputs["Color"]
            if name in ("TC_Slate", "TC_Copper"):
                bw = nt.nodes.new("ShaderNodeRGBToBW")
                nt.links.new(src, bw.inputs[0])
                src = bw.outputs[0]
            tm = nt.nodes.new("ShaderNodeMix")
            tm.data_type = "RGBA"
            tm.blend_type = "MULTIPLY"
            tm.inputs["Factor"].default_value = 1.0
            nt.links.new(src, tm.inputs[6])
            tm.inputs[7].default_value = (tint[0] * gain, tint[1] * gain, tint[2] * gain, 1)
            src = tm.outputs[2]
            nimg = Path(args.textures) / f"{tex}_normal.png"
            if nimg.exists():
                ni = nt.nodes.new("ShaderNodeTexImage")
                ni.image = bpy.data.images.load(str(nimg), check_existing=True)
                ni.image.colorspace_settings.name = "Non-Color"
                nm = nt.nodes.new("ShaderNodeNormalMap")
                nm.inputs["Strength"].default_value = 0.8
                nt.links.new(ni.outputs["Color"], nm.inputs["Color"])
                nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if textured and name == "TC_Banner":
        img = banner_crest_image()
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = img
        src = tn.outputs["Color"]
    if textured and name == "TC_Glass":
        src = stained_glass_nodes(nt)
    if src is None:
        mul.inputs[6].default_value = base
    else:
        nt.links.new(src, mul.inputs[6])
    nt.links.new(ao.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit > 0:
        if src is not None:
            nt.links.new(src, bsdf.inputs["Emission Color"])
        else:
            bsdf.inputs["Emission Color"].default_value = base
        bsdf.inputs["Emission Strength"].default_value = emit
    return m


def stained_glass_nodes(nt):
    """Leaded stained glass from the window's own 0..1 UV square (preview only)."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (5.0, 9.0, 1.0)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 1.0
    nt.links.new(mp.outputs["Vector"], vor.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "CONSTANT"
    cr.elements[0].color = (0.05, 0.25, 0.75, 1)
    cr.elements[1].position = 0.55
    cr.elements[1].color = (0.1, 0.55, 0.9, 1)
    e = cr.elements.new(0.82)
    e.color = (1.0, 0.72, 0.2, 1)
    nt.links.new(vor.outputs["Color"], ramp.inputs["Fac"])
    vor2 = nt.nodes.new("ShaderNodeTexVoronoi")
    vor2.feature = "DISTANCE_TO_EDGE"
    vor2.inputs["Scale"].default_value = 1.0
    nt.links.new(mp.outputs["Vector"], vor2.inputs["Vector"])
    lead = nt.nodes.new("ShaderNodeMapRange")
    lead.inputs["From Min"].default_value = 0.0
    lead.inputs["From Max"].default_value = 0.06
    nt.links.new(vor2.outputs["Distance"], lead.inputs["Value"])
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MULTIPLY"
    mx.inputs["Factor"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], mx.inputs[6])
    nt.links.new(lead.outputs["Result"], mx.inputs[7])
    return mx.outputs[2]


_CREST = None


def banner_crest_image():
    """A simple blue-and-gold crest so banner UVs can be checked (preview only)."""
    global _CREST
    if _CREST:
        return _CREST
    N = 128
    img = bpy.data.images.new("crest", N, N)
    px = [0.0] * (N * N * 4)
    poly = crab_claw_poly(0.22, 26)
    for j in range(N):
        for i in range(N):
            u, v = (i + 0.5) / N, (j + 0.5) / N
            c = (0.06, 0.12, 0.45)
            if u < 0.06 or u > 0.94 or v > 0.95:
                c = (1.0, 0.7, 0.2)
            x, y = u - 0.5, v - 0.6
            inside = False
            for k in range(len(poly)):
                (x1, y1), (x2, y2) = poly[k], poly[(k + 1) % len(poly)]
                if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    inside = not inside
            if inside:
                c = (1.0, 0.7, 0.2)
            k4 = (j * N + i) * 4
            px[k4:k4 + 4] = [c[0], c[1], c[2], 1.0]
    img.pixels = px
    _CREST = img
    return img


def setup_scene(samples):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = samples
    sc.eevee.use_shadows = True
    try:
        sc.eevee.use_raytracing = True
    except Exception:
        pass
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 860
    world = bpy.data.worlds.new("sky")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.92, 0.80, 0.66, 1)
    ramp.color_ramp.elements[1].position = 0.03
    ramp.color_ramp.elements[1].color = (0.42, 0.6, 0.92, 1)
    e = ramp.color_ramp.elements.new(0.22)
    e.color = (0.13, 0.32, 0.82, 1)
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.5
    sun.color = (1.0, 0.82, 0.62)
    sun.angle = math.radians(2.5)
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    # warm late-afternoon sun from the front-left (game -x, +z), about 28 degrees up
    d = Vector((0.75, -0.55, -0.62))  # blender axes (x, y=-game z, z=game y): light travels to +x, -y... see below
    # game direction the light travels: towards +x and -z (from front-left), downward
    g = Vector((0.62, -0.47, -0.62)).normalized()  # game (x, y, z)
    b = Vector((g.x, -g.z, g.y))
    so.rotation_euler = b.to_track_quat("-Z", "Y").to_euler()
    ground = bpy.data.meshes.new("ground")
    G = 600
    ground.from_pydata([(-G, -G, 0), (G, -G, 0), (G, G, 0), (-G, G, 0)], [], [(0, 1, 2, 3)])
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gb = gm.node_tree.nodes.get("Principled BSDF")
    gb.inputs["Base Color"].default_value = (0.30, 0.40, 0.17, 1)
    gb.inputs["Roughness"].default_value = 0.95
    ground.materials.append(gm)
    go = bpy.data.objects.new("ground", ground)
    sc.collection.objects.link(go)
    cube = bpy.data.meshes.new("crab")
    v, f = g_box(-0.5, -0.5, 0, 0.5, 0.5, 1)
    cube.from_pydata(v, [], f)
    cm = bpy.data.materials.new("crabcube")
    cm.use_nodes = True
    cm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.85, 0.12, 0.08, 1)
    cube.materials.append(cm)
    co = bpy.data.objects.new("crab_cube", cube)
    sc.collection.objects.link(co)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 35
    camo = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(camo)
    sc.camera = camo
    root = bpy.data.objects.new("game_root", None)  # game axes (Y up) -> blender (Z up)
    sc.collection.objects.link(root)
    root.rotation_euler = (PI / 2, 0, 0)
    return sc, camo, co, root


def g2b(v):
    return Vector((v[0], -v[2], v[1]))


def frame_camera(camo, lo, hi, dir_game=(0.55, 0.2, 1.0), fov_fill=1.0, target_y=None):
    c = (lo + hi) / 2
    if target_y is not None:
        c.y = target_y
    r = (hi - lo).length / 2
    d = Vector(dir_game).normalized()
    sc = bpy.context.scene
    aspect = sc.render.resolution_y / sc.render.resolution_x
    fov = 2 * math.atan(36 * min(1.0, aspect) / 2 / camo.data.lens)
    dist = r / math.sin(fov / 2) * 0.92 * fov_fill
    pos = c + d * dist
    camo.location = g2b(pos)
    look = g2b(c) - g2b(pos)
    camo.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    camo.data.clip_end = dist * 4 + 500


DETAIL_VIEWS = [
    ("TC_Cathedral", (0.0, 9.0, 27.0), (0.35, 0.12, 1.0), 7.5),
    ("TC_Cathedral", (0.0, 52.0, 21.0), (0.5, 0.25, 1.0), 9.0),
    ("TC_Cathedral", (11.0, 13.0, 0.0), (1.0, 0.35, 0.45), 9.0),
    ("TC_SeaglassTower", (0.0, 52.0, 0.0), (0.5, 0.2, 1.0), 8.0),
    ("TC_Fountain", (0.0, 5.0, 0.0), (0.4, 0.25, 1.0), 4.5),
    ("TC_Forge", (0.0, 5.0, 9.0), (0.3, 0.15, 1.0), 7.0),
]


def render_previews(built, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    sc, camo, cube, root = setup_scene(args.samples)
    for p, holder, ob, tris, lo, hi in built:
        holder.parent = root
    views = set(args.views.split(","))
    for textured in ([False, True] if args.textures else [False]):
        mats = {m: preview_material(m, textured) for m in MAT_ORDER}
        for p, holder, ob, tris, lo, hi in built:
            for i, slot in enumerate(ob.material_slots):
                name = ob.data.materials[i].name.split(".")[0]
                slot.link = "OBJECT"
                slot.material = mats[name]
        tag = "tex" if textured else "flat"
        if "pieces" in views:
            for p, holder, ob, tris, lo, hi in built:
                for q in built:
                    q[1].hide_render = q[0] is not p
                    q[2].hide_render = q[0] is not p
                lift = 0.0 if p.ground or lo.y >= 0 else 0.6 - lo.y
                holder.location = (0, lift, 0)  # holders live in game axes under game_root
                cube.location = g2b((hi.x + 1.4, 0, hi.z - 0.5))
                frame_camera(camo, lo + Vector((0, lift, 0)), hi + Vector((0, lift, 0)))
                sc.render.filepath = str(out / f"{p.name}-{tag}.png")
                bpy.ops.render.render(write_still=True)
                print("RENDER", sc.render.filepath)
        if "detail" in views:
            for di, (name, c, d, r) in enumerate(DETAIL_VIEWS):
                q = next((q for q in built if q[0].name == name), None)
                if q is None:
                    continue
                for o in built:
                    o[1].hide_render = o[2].hide_render = o[0] is not q[0]
                q[1].location = (0, 0, 0)
                cube.location = g2b((c[0] + 2.0, 0, c[2] + 1.0))
                cv = Vector(c)
                frame_camera(camo, cv - Vector((r, r, r)), cv + Vector((r, r, r)), dir_game=d)
                sc.render.filepath = str(out / f"{name}-detail{di}-{tag}.png")
                bpy.ops.render.render(write_still=True)
                print("RENDER", sc.render.filepath)
        if "lineup" in views and len(built) > 1:
            x = 0.0
            order = sorted(built, key=lambda q: -(q[5].y - q[4].y))
            for q in built:
                q[1].hide_render = False
                q[2].hide_render = False
            glo, ghi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
            for p, holder, ob, tris, lo, hi in order:
                w = hi.x - lo.x
                ox = x - lo.x
                yoff = 0.0 if p.ground or lo.y >= 0 else 0.6 - lo.y
                holder.location = (ox, yoff, 0)
                glo.x, glo.y, glo.z = min(glo.x, ox + lo.x), min(glo.y, lo.y + yoff), min(glo.z, lo.z)
                ghi.x, ghi.y, ghi.z = max(ghi.x, ox + hi.x), max(ghi.y, hi.y + yoff), max(ghi.z, hi.z)
                x += w + 4.0
            cube.location = g2b((ghi.x + 1.5, 0, 0))
            frame_camera(camo, glo, ghi, dir_game=(0.15, 0.16, 1.0), fov_fill=0.95)
            sc.render.resolution_x, sc.render.resolution_y = 1800, 760
            sc.render.filepath = str(out / f"lineup-{tag}.png")
            bpy.ops.render.render(write_still=True)
            sc.render.resolution_x, sc.render.resolution_y = 1280, 860
            for p, holder, ob, tris, lo, hi in built:
                holder.location = (0, 0, 0)
            print("RENDER", sc.render.filepath)


main()
