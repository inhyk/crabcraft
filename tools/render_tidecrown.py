"""EEVEE preview renders for the Tidecrown kit (imported by tools/build_tidecrown.py --render DIR).

Late-afternoon warm sun from the left front, sky-blue world light, a 1 x 1 x 1 red cube for crab
scale beside every piece. Flat kit-like colours times the baked AO; with --kit-tex a second pass
tiles the World 1 kit textures by material type (MI_Brick, MI_UnevenBrick, MI_RoundTiles,
MI_WoodTrim) so the texel density can be judged.
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector

TEX_FOR = {
    "TC_Limestone": ("MI_Brick", "#efe6d2", 1.55, False),
    "TC_LimestoneDark": ("MI_UnevenBrick", "#d6c9ad", 1.45, False),
    "TC_Slate": ("MI_RoundTiles", "#35577d", 2.2, True),
    "TC_Wood": ("MI_WoodTrim", "#8a6a46", 1.4, False),
}


def B(p):
    """Game (x, y up, z front) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def preview_material(mat, kit_tex: str | None):
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes["Principled BSDF"]
    base = tuple(bsdf.inputs["Base Color"].default_value)
    for n in list(nodes):
        if n.name not in ("Principled BSDF", "Material Output"):
            nodes.remove(n)
    ao = nodes.new("ShaderNodeVertexColor")
    ao.layer_name = "Col"
    mul = nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    links.new(ao.outputs["Color"], mul.inputs["B"])
    spec = TEX_FOR.get(mat.name)
    if kit_tex and spec and (Path(kit_tex) / f"{spec[0]}__base.png").exists():
        img = bpy.data.images.load(str(Path(kit_tex) / f"{spec[0]}__base.png"), check_existing=True)
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.extension = "REPEAT"
        links.new(uv.outputs["UV"], tex.inputs["Vector"])
        col = tex.outputs["Color"]
        if spec[3]:  # recolour (red roof tiles -> slate)
            bw = nodes.new("ShaderNodeRGBToBW")
            links.new(col, bw.inputs["Color"])
            col = bw.outputs["Val"]
        tint = nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs["Factor"].default_value = 1.0
        links.new(col, tint.inputs["A"])
        tint.inputs["B"].default_value = (*[c * spec[2] for c in srgb(spec[1])], 1)
        links.new(tint.outputs["Result"], mul.inputs["A"])
    else:
        mul.inputs["A"].default_value = base
    links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    if mat.name == "TC_LanternGlow":
        bsdf.inputs["Emission Strength"].default_value = 6.0
    if mat.name == "TC_Glass":
        bsdf.inputs["Emission Color"].default_value = (*srgb("#3f8fd0"), 1)
        bsdf.inputs["Emission Strength"].default_value = 0.35
    if mat.name == "TC_Nacre":  # stand-in for the runtime mother-of-pearl: pale pink-white, hue shifts with the view angle
        lw = nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.5
        ramp = nodes.new("ShaderNodeValToRGB")
        cr = ramp.color_ramp
        cr.elements[0].color = (*srgb("#f7e9ef"), 1)
        cr.elements[1].color = (*srgb("#a9dcd8"), 1)
        for pos, col in ((0.35, "#f3dbe6"), (0.62, "#e9d9b4"), (0.82, "#c6e3e6")):
            e = cr.elements.new(pos)
            e.color = (*srgb(col), 1)
        links.new(lw.outputs["Facing"], ramp.inputs["Fac"])
        # patchy pearl: soft noise patches of pink, lilac, teal and cream over the view-angle shift
        tc = nodes.new("ShaderNodeTexCoord")
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 0.09
        noise.inputs["Detail"].default_value = 3.0
        links.new(tc.outputs["Object"], noise.inputs["Vector"])
        pr = nodes.new("ShaderNodeValToRGB")
        pc = pr.color_ramp
        pc.elements[0].color = (*srgb("#f4d6e4"), 1)
        pc.elements[1].color = (*srgb("#cfeee9"), 1)
        for pos, col in ((0.38, "#efe4f6"), (0.5, "#f6ecd6"), (0.62, "#dfe2f7")):
            e = pc.elements.new(pos)
            e.color = (*srgb(col), 1)
        links.new(noise.outputs["Fac"], pr.inputs["Fac"])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        links.new(ramp.outputs["Color"], mix.inputs["A"])
        links.new(pr.outputs["Color"], mix.inputs["B"])
        gain = nodes.new("ShaderNodeMix")
        gain.data_type = "RGBA"
        gain.blend_type = "MULTIPLY"
        gain.inputs["Factor"].default_value = 1.0
        gain.inputs["B"].default_value = (1.12, 1.12, 1.12, 1)
        links.new(mix.outputs["Result"], gain.inputs["A"])
        links.new(gain.outputs["Result"], mul.inputs["A"])
        bsdf.inputs["Roughness"].default_value = 0.25
        bsdf.inputs["Coat Weight"].default_value = 0.5
        if "Thin Film Thickness" in bsdf.inputs:  # Blender 4.2+: iridescent layer
            bsdf.inputs["Thin Film Thickness"].default_value = 420.0
            bsdf.inputs["Thin Film IOR"].default_value = 1.45


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    try:
        sc.eevee.use_raytracing = True
        sc.eevee.use_shadows = True
    except AttributeError:
        pass
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*srgb("#8fc0ee"), 1)
    bg.inputs["Strength"].default_value = 0.85
    sc.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.2
    sun.data.color = srgb("#ffd6a0")
    sun.data.angle = math.radians(3)
    d = B((-0.62, 0.42, 0.66)).normalized()  # towards the sun: left, up, front
    sun.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    sc.collection.objects.link(sun)
    gm = bpy.data.meshes.new("ground")
    gm.from_pydata([(-2000, -2000, 0), (2000, -2000, 0), (2000, 2000, 0), (-2000, 2000, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("ground", gm)
    gmat = bpy.data.materials.new("ground")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb("#b3a587"), 1)
    gmat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    gm.materials.append(gmat)
    sc.collection.objects.link(ground)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 40
    cam.data.clip_end = 5000
    sc.collection.objects.link(cam)
    sc.camera = cam
    cmat = bpy.data.materials.new("crab")
    cmat.use_nodes = True
    cmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb("#d8301e"), 1)
    return sc, cam, ground, cmat


def crab_cube(cmat, pos_game, name="crab"):
    me = bpy.data.meshes.new(name)
    v = [(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (0, 1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    me.from_pydata(v, [], f)
    me.materials.append(cmat)
    o = bpy.data.objects.new(name, me)
    o.location = B(pos_game)
    bpy.context.scene.collection.objects.link(o)
    return o


def aim(cam, eye_game, target_game, lens=40):
    cam.location = B(eye_game)
    d = B(target_game) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def frame(bb_min, bb_max, direction, fov_deg=30.0, pad=0.9, lift=0.0):
    c = (Vector(bb_min) + Vector(bb_max)) / 2
    c.y += lift
    r = (Vector(bb_max) - Vector(bb_min)).length / 2
    dist = r / math.sin(math.radians(fov_deg) / 2) * pad
    d = Vector(direction).normalized()
    return c + d * dist, c


def render(path: Path, res=(1600, 1000)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"TC_RENDER {path}", flush=True)


def views_for(name, mn, mx):
    """(suffix, eye, target, lens) per piece; game coordinates."""
    c = (Vector(mn) + Vector(mx)) / 2
    out = []
    eye, tgt = frame(mn, mx, (-0.55, 0.32, 0.78))
    out.append(("", eye, tgt, 40))
    if name == "TC_Keep":
        out.append(("_front", Vector((6.0, 14.0, 175.0)), Vector((0.0, 62.0, 0.0)), 32))
        out.append(("_aerial", Vector((-120.0, 150.0, 150.0)), Vector((0.0, 40.0, 0.0)), 40))
        out.append(("_crown", Vector((-22.0, 134.0, 42.0)), Vector((0.0, 142.0, 0.0)), 45))
        out.append(("_dome", Vector((-70.0, 70.0, 75.0)), Vector((0.0, 36.0, 0.0)), 40))
        out.append(("_facade", Vector((-28.0, 10.0, 78.0)), Vector((0.0, 18.0, 30.0)), 35))
        out.append(("_side", Vector((140.0, 40.0, 30.0)), Vector((0.0, 55.0, 0.0)), 35))
        out.append(("_dome34", Vector((-62.0, 88.0, 92.0)), Vector((0.0, 34.0, 2.0)), 38))
        out.append(("_top", Vector((0.0, 400.0, 1.4)), Vector((0.0, 0.0, 1.4)), 0))  # orthographic, front up
        out.append(("_stage", Vector((-26.0, 70.0, 34.0)), Vector((0.0, 55.0, 0.0)), 38))
        out.append(("_margin", Vector((46.0, 36.0, 52.0)), Vector((20.0, 25.0, 14.0)), 35))
    if name == "TC_PincerGate":
        out.append(("_front", Vector((0.0, 8.0, 70.0)), Vector((0.0, 22.0, 0.0)), 35))
        out.append(("_claws", Vector((-14.0, 36.0, 34.0)), Vector((0.0, 38.0, 0.0)), 40))
    if name == "TC_BridgeSpan":
        out.append(("_side", Vector((60.0, 2.0, 18.0)), Vector((0.0, -6.0, 0.0)), 35))
    if name == "TC_WardGate":
        out.append(("_front", Vector((0.0, 6.0, 42.0)), Vector((0.0, 11.0, 0.0)), 35))
    return out


def render_all(pieces, outdir: Path, kit_tex: str, only: str = ""):
    """only: comma list of output names without the pass tag (e.g. TC_Keep_front,lineup) to render a subset."""
    outdir.mkdir(parents=True, exist_ok=True)
    want = {s for s in only.split(",") if s}
    ok = lambda name: not want or name in want
    sc, cam, ground, cmat = setup_scene()
    passes = [("flat", None)]
    if kit_tex:
        passes.append(("tex", kit_tex))
    facts = {pc.name: pc.facts() for pc in pieces}
    crabs = {}
    for pc in pieces:
        mn, mx = facts[pc.name]["bbox"]["min"], facts[pc.name]["bbox"]["max"]
        gy = 0.0 if pc.name != "TC_BridgeSpan" else 0.0
        crabs[pc.name] = crab_cube(cmat, (mn[0] - 1.6, gy if pc.name != "TC_Lantern" else mn[1], mx[2] + 1.2), "crab_" + pc.name)
    for tag, tex in passes:
        for name, _ in [(m.name, m) for m in bpy.data.materials if m.name.startswith("TC_")]:
            preview_material(bpy.data.materials[name], tex)
        for pc in pieces:
            mn, mx = facts[pc.name]["bbox"]["min"], facts[pc.name]["bbox"]["max"]
            for other in pieces:
                vis = other is pc
                other.obj.hide_render = not vis
                crabs[other.name].hide_render = not vis
            ground.location.z = -14.0 if pc.name == "TC_BridgeSpan" else (mn[1] - 0.01 if pc.name == "TC_Lantern" else 0.0)
            lantern = next((o for o in pieces if o.name == "TC_Lantern"), None)
            if pc.name == "TC_Keep" and lantern:
                lantern.obj.hide_render = False
                lantern.holder.location = B(pc.anchors["lantern"]["centre"])
            for suffix, eye, tgt, lens in views_for(pc.name, mn, mx):
                if tag == "tex" and suffix not in ("", "_front", "_facade", "_dome34", "_stage", "_margin"):
                    continue
                if not ok(pc.name + suffix):
                    continue
                if lens:
                    aim(cam, eye, tgt, lens)
                else:  # straight down, orthographic, front (+Z) at the top of the frame
                    cam.data.type = "ORTHO"
                    cam.data.ortho_scale = 92.0
                    cam.location = B(eye)
                    cam.rotation_euler = (0.0, 0.0, math.pi)
                render(outdir / f"{pc.name}{suffix}_{tag}.png")
                cam.data.type = "PERSP"
            if lantern:
                lantern.holder.location = (0, 0, 0)
        if ok("tiling"):
            tiling(pieces, outdir, tag, cam, crabs)
        if not ok("lineup"):
            continue
        # lineup: keep in the middle, the rest along the front
        x = -150.0
        order = [pc for pc in pieces if pc.name != "TC_Keep"]
        for pc in pieces:
            pc.obj.hide_render = False
            crabs[pc.name].hide_render = False
        placed = {}
        for pc in order:
            mn, mx = facts[pc.name]["bbox"]["min"], facts[pc.name]["bbox"]["max"]
            w = mx[0] - mn[0]
            px = x - mn[0]
            pz = 75.0
            py = 14.0 if pc.name == "TC_BridgeSpan" else (4.0 - mn[1] if pc.name == "TC_Lantern" else 0.0)
            placed[pc.name] = (px, py, pz)
            x += w + 8.0
        keep = next((o for o in pieces if o.name == "TC_Keep"), None)
        if keep and "TC_Lantern" in placed:
            placed["TC_Lantern"] = tuple(keep.anchors["lantern"]["centre"])
        for pc in pieces:
            px, py, pz = placed.get(pc.name, (0.0, 0.0, 0.0))
            pc.holder.location = B((px, py, pz))
            mn, mx = facts[pc.name]["bbox"]["min"], facts[pc.name]["bbox"]["max"]
            crabs[pc.name].location = B((px + mn[0] - 1.6, py + (mn[1] if pc.name == "TC_Lantern" else 0.0), pz + mx[2] + 1.2))
        ground.location.z = 0.0
        aim(cam, Vector((x * 0.35 - 60.0, 120.0, 330.0)), Vector((x * 0.35 - 60.0, 62.0, 40.0)), 26)
        render(outdir / f"lineup_{tag}.png", res=(2400, 1200))
        for pc in pieces:
            pc.holder.location = (0, 0, 0)
            mn, mx = facts[pc.name]["bbox"]["min"], facts[pc.name]["bbox"]["max"]
            crabs[pc.name].location = B((mn[0] - 1.6, 0.0 if pc.name != "TC_Lantern" else mn[1], mx[2] + 1.2))


def tiling(pieces, outdir, tag, cam, crabs):
    """City wall run: Pincer Gate, three wall segments, a tower, a wall leaving it at 35 degrees."""
    by = {pc.name: pc for pc in pieces}
    need = ("TC_PincerGate", "TC_CityWall_12", "TC_CityTower", "TC_WardWall_12", "TC_WardTower", "TC_WardGate")
    if not all(n in by for n in need):
        return
    for pc in pieces:
        pc.obj.hide_render = True
        crabs[pc.name].hide_render = True
    made = []

    def put(name, x, z, yaw=0.0):
        src = by[name].obj
        o = bpy.data.objects.new(f"tile_{name}_{len(made)}", src.data)
        bpy.context.scene.collection.objects.link(o)
        o.location = B((x, 0.0, z))
        o.rotation_euler = (0.0, 0.0, yaw)
        made.append(o)

    put("TC_PincerGate", 0.0, 0.0)
    for k in range(3):
        put("TC_CityWall_12", 24.0 + 12.0 * k, 0.0)
        put("TC_CityWall_12", -24.0 - 12.0 * k, 0.0)
    put("TC_CityTower", 54.0, 0.0)
    put("TC_CityTower", -54.0, 0.0)
    a = math.radians(35)
    for k in range(2):
        d = 6.0 + 12.0 * k
        put("TC_CityWall_12", 54.0 + d * math.cos(a), -d * math.sin(a), a)
    # inner ward behind: gate, walls and a tower
    put("TC_WardGate", 0.0, -70.0)
    for k in range(2):
        put("TC_WardWall_12", 14.0 + 12.0 * k, -70.0)
        put("TC_WardWall_12", -14.0 - 12.0 * k, -70.0)
    put("TC_WardTower", 38.0, -70.0)
    put("TC_WardTower", -38.0, -70.0)
    aim(cam, Vector((-30.0, 45.0, 120.0)), Vector((12.0, 14.0, -20.0)), 30)
    render(outdir / f"tiling_{tag}.png", res=(2400, 1200))
    aim(cam, Vector((44.0, 20.0, 24.0)), Vector((54.0, 10.0, 0.0)), 35)
    render(outdir / f"tiling_joint_{tag}.png", res=(1600, 1000))
    for o in made:
        bpy.data.objects.remove(o)
    for pc in pieces:
        pc.obj.hide_render = False
        crabs[pc.name].hide_render = False
