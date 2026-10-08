"""
CH_OfficeAvatar, phase 5: the customization library. More pieces for every slot, each a game mesh (LOD0,
with LOD1 and LOD2) fitted to the same base body and, from 06_rig.py, the same skeleton:

  02_HAIR         Hair_Bun (a top knot), Hair_Bob (straight, to the jaw), Hair_Short (a short textured
                  crop), Hair_Curly (big curls all over), Hair_Long (to the shoulders)  (Hair_Wavy from 04)
  03_FACIAL_HAIR  Beard_Stubble, Beard_Full (with a moustache), Beard_Long (fuller, longer at the chin),
                  Beard_Goatee (a moustache and a chin beard)                      (clean-shaven: none)
  04_TOPS         Top_Jacket (zipped, stand collar), Top_Sweater (a shirt collar out over it), and
                  Print_Squares (the sheet's tee print, worn with Top_Tee)          (Top_Tee, Top_HoodieOpen)
  05_BOTTOMS      Bottom_Joggers (tapered, ankle cuffs)                            (Bottom_Trousers)
  06_SHOES        Shoes_Runners (low and slim)                                     (Shoes_Sneakers)
  07_ACCESSORIES  Glasses_Round, Glasses_Square, Glasses_Thick (heavy frames), Glasses_Sun (dark lenses),
                  Badge_Lanyard (a cord round the neck and an ID card on the chest)

The concept sheet's options (its hair, beard, glasses and outfit rows) are what these follow.

Every piece (old and new) carries `slot` (hair, facial_hair, top, bottom, shoes, glasses) and `covers`
(the body pieces it hides, so the game can switch those off), exported as glTF extras. Pieces that can
be worn together are checked for intersections at the end (a BVH overlap test between their LOD0 meshes).

  blender --background --python build/05_library.py -- --master CH_OfficeAvatar_master.blend

Run after 04_topology.py and before 06_rig.py (which weights every _LOD mesh it finds).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
exec(compile(open(os.path.join(HERE, "04_topology.py")).read().split('\nif __name__ == "__main__":')[0], "04_topology.py", "exec"))
from mathutils.bvhtree import BVHTree

F = _forms  # the forms phase's helpers and measurements (03_forms.py)
blob, sweep, fuse, on_head = F["blob"], F["sweep"], F["fuse"], F["on_head"]
HEAD_C, HEAD_R, EYE_X, EYE_Z, MOUTH_Z, EAR_Z, CHIN_Z = (F[k] for k in ("HEAD_C", "HEAD_R", "EYE_X", "EYE_Z", "MOUTH_Z", "EAR_Z", "CHIN_Z"))
HEM_Z, LEG_X, FOOT_X, ANKLE_Z, SHOE_FRONT, SHOE_LEN = (F[k] for k in ("HEM_Z", "LEG_X", "FOOT_X", "ANKLE_Z", "SHOE_FRONT", "SHOE_LEN"))

PHASE = "05_library"
OWNER_TAG = "phase:" + PHASE

SLOTS = {
    "Hair": ("hair", []), "Beard": ("facial_hair", []), "Glasses": ("glasses", []),
    "Top_Tee": ("top", ["Body_Torso"]), "Top_HoodieOpen": ("top", ["Body_Torso", "Body_Arms"]), "Top_Jacket": ("top", ["Body_Torso", "Body_Arms"]),
    "Top_Sweater": ("top", ["Body_Torso", "Body_Arms"]), "Print": ("print", []), "Badge": ("badge", []),
    "Bottom": ("bottom", ["Body_Legs"]), "Shoes": ("shoes", []),
}


def adopt(ob, collection):
    """Takes an object a forms helper made (in HIGH, owned by that phase) into `collection`, owned here."""
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    sub(collection).objects.link(ob)
    return own(ob)


def piece(name, parts, collection, budget=None):
    """The parts as one LOD0 piece (reduced to `budget` triangles if given), cleaned, with LOD1 and LOD2."""
    parts = [adopt(p, collection) for p in parts]
    ob = merge(f"{A}_{name}_LOD0", parts, collection)
    if budget:
        reduce_to(ob, budget)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.name = ob.name
    for level, ratio in ((1, 0.5), (2, 0.22)):
        me = ob.data.copy()
        lod = bpy.data.objects.new(ob.name.replace("_LOD0", f"_LOD{level}"), me)
        me.name = lod.name
        sub("10_LOD").objects.link(lod)
        own(lod)
        lod.hide_render = True
        d = lod.modifiers.new("Decimate", "DECIMATE")
        d.ratio = ratio
        apply_all_modifiers(lod)
        clean_lod(lod)
    return ob


# ---- hair ---------------------------------------------------------------------------------------

def scalp(name, hairline_z, side_z, nape_z, thick=0.02):
    """A hair cap over the skull: off the face above a curved hairline (`hairline_z` in the middle of the
    forehead, lower towards the temples, so its edge is an arc, not a visor), the sides down to `side_z`,
    the nape to `nape_z`."""
    cx, cy, cz = HEAD_C
    # Fine enough that cutting it along the hairline leaves a smooth edge, not steps.
    cap = sphere(name, 1.0, "HIGH", location=(cx, cy + 0.005, cz + 0.005), u=160, v=110, scale=(HEAD_R[0] + 0.02, HEAD_R[1] + 0.02, HEAD_R[2] + 0.018))
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    m = cap.matrix_world
    kill = []
    for v in bm.verts:
        p = m @ v.co
        # The hairline round the face: an arc from the middle of the forehead down to the temples, then
        # the sides' edge sloping back to the nape behind the ears.
        line = hairline_z - 0.09 * (p.x / 0.2) ** 2 if p.y < cy + 0.02 else side_z + (nape_z - side_z) * min(1.0, (p.y - cy - 0.02) / 0.12)
        front = p.y < cy - 0.03 and abs(p.x) < 0.2
        if (front and p.z < line) or (not front and p.z < max(line, nape_z)) or p.z < nape_z:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(cap.data)
    bm.free()
    solidify(cap, thick, offset=1.0)
    apply_all_modifiers(cap)
    return cap


def lock(name, pts, r0, mat):
    """A tapering lock along `pts` (combed hair), fullest a third of the way along."""
    n = len(pts)
    return sweep(name, pts, r0, mat, segments=14, radii=[r0 * (0.7 + 0.5 * math.sin(math.pi * min(1, i / (n * 0.6)))) * (1 - 0.6 * max(0, i - n * 0.6) / (n * 0.4)) for i in range(n)])


def over_head(x0, z0, x1, z1, lift=0.02, n=10, a0=0.15):
    """Points over the head from (x0, z0) at the front to (x1, z1) behind, on the scalp plus `lift`."""
    cx, cy, cz = HEAD_C
    out = []
    for i in range(n):
        t = i / (n - 1)
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t + 0.08 * math.sin(math.pi * t)
        a = math.pi * (a0 + (0.85 - a0) * t)                     # from the forehead round over the crown
        k = max(0.05, 1 - (x / (HEAD_R[0] + 0.04)) ** 2)
        out.append((x, cy - (HEAD_R[1] + lift) * math.cos(a) * math.sqrt(k), min(z, cz + (HEAD_R[2] + lift) * math.sin(a) * math.sqrt(k) + 0.02)))
    return out


def hair_bun(mat):
    cx, cy, cz = HEAD_C
    parts = [scalp("_bun_cap", 1.37, 1.24, 1.06, 0.018)]
    # Hair combed back from the hairline over the crown to the knot, in a few soft locks.
    for i, (x0, x1) in enumerate(((-0.13, -0.05), (-0.06, -0.02), (0.02, 0.02), (0.09, 0.04), (0.15, 0.06))):
        # Starting just behind the hairline (not over it), so the forehead's edge stays a clean arc.
        parts.append(lock(f"_comb{i}", over_head(x0, 1.42, x1, 1.5, lift=0.012, a0=0.3), 0.026, mat))
    # And up the back from the nape to the knot.
    for i, x0 in enumerate((-0.13, -0.065, 0.0, 0.065, 0.13)):
        pts = []
        for k in range(10):
            t = k / 9
            z = 1.1 + (1.5 - 1.1) * t
            x = x0 * (1 - 0.75 * t)
            kk = max(0.05, 1 - (x / (HEAD_R[0] + 0.02)) ** 2 - ((z - cz) / (HEAD_R[2] + 0.02)) ** 2)
            pts.append((x, cy + (HEAD_R[1] + 0.012) * math.sqrt(kk), z))
        parts.append(lock(f"_nape{i}", pts, 0.026, mat))
    parts.append(blob("_knot", (0.0, cy + 0.05, 1.555), (0.085, 0.08, 0.075)))
    parts.append(blob("_knot_base", (0.0, cy + 0.04, 1.5), (0.06, 0.06, 0.03)))
    # Two loose strands in front of the ears.
    for s in (1, -1):
        parts.append(blob(f"_strand{s}", (s * 0.168, cy - 0.07, 1.22), (0.016, 0.02, 0.065), rot=(0, 0, s * math.radians(8))))  # inside the glasses' arms
    return fuse("_bun", parts, 0.005, mat, smooth=6)


def hair_bob(mat):
    cx, cy, cz = HEAD_C
    parts = [scalp("_bob_cap", 1.36, 1.0, 1.06, 0.02)]
    # A side parting: locks falling from it over either side of the head into the curtains.
    for i, (x1, z1) in enumerate(((-0.2, 1.24), (-0.16, 1.3), (0.17, 1.28), (0.21, 1.22))):
        pts = [(0.03, cy - 0.12 + 0.05 * k, 1.5 - 0.01 * k) for k in range(2)]
        for k in range(1, 8):
            t = k / 7
            x = 0.03 + (x1 - 0.03) * t
            z = 1.49 - (1.49 - z1) * t * t
            y = cy - 0.08 + 0.06 * t
            kk = max(0.05, 1 - (x / (HEAD_R[0] + 0.035)) ** 2 - ((z - cz) / (HEAD_R[2] + 0.035)) ** 2)
            pts.append((x, min(y, cy - (HEAD_R[1] + 0.02) * math.sqrt(kk) * 0.6), z))
        parts.append(lock(f"_part{i}", pts, 0.03, mat))
    # Curtains either side, falling straight to the jaw; a fringe from the parting; the back cut level above the hood.
    for s in (1, -1):
        parts.append(blob(f"_curtain{s}", (s * 0.2, cy - 0.01, 1.18), (0.05, 0.15, 0.2)))
    parts.append(blob("_fringe", (-0.03, cy - 0.19, 1.385), (0.12, 0.045, 0.045), rot=(math.radians(-25), 0, math.radians(8))))
    parts.append(blob("_back", (0.0, cy + 0.1, 1.22), (0.18, 0.08, 0.13)))  # cut level above the hood
    # Locks falling from the crown down the back to the cut, the outer ones curving in at the ends.
    for i, x0 in enumerate((-0.16, -0.08, 0.0, 0.08, 0.16)):
        pts = []
        for k in range(10):
            t = k / 9
            z = 1.5 - (1.5 - (1.13 + 0.025 * abs(x0) / 0.16)) * t
            x = x0 * (1 + 0.15 * t) - 0.02 * (x0 / 0.16) * t * t
            kk = max(0.05, 1 - (x / (HEAD_R[0] + 0.03)) ** 2 - ((z - cz) / (HEAD_R[2] + 0.03)) ** 2)
            pts.append((x, cy + (HEAD_R[1] + 0.03) * math.sqrt(kk) + 0.03 * t, z))
        parts.append(lock(f"_bobback{i}", pts, 0.034, mat))
    return fuse("_bobm", parts, 0.005, mat, smooth=8)


def on_cap(theta, phi, off):
    """A point over the skull: `theta` from the top (0) down, `phi` round from the front (0) to the left (+)."""
    cx, cy, cz = HEAD_C
    return (cx + (HEAD_R[0] + off) * math.sin(theta) * math.sin(phi), cy - (HEAD_R[1] + off) * math.sin(theta) * math.cos(phi), cz + 0.005 + (HEAD_R[2] + off) * math.cos(theta))


def hair_short(mat):
    """A short textured crop (the sheet's second hair): close at the sides, a little height on top, the
    front tufts pushed up and forward."""
    parts = [scalp("_short_cap", 1.385, 1.22, 1.07, 0.016)]
    rng = __import__("random").Random(7)
    for i in range(34):
        theta = math.radians(rng.uniform(0, 62))
        phi = math.radians(rng.uniform(-180, 180))
        if theta > math.radians(45) and abs(phi) < math.radians(60):
            continue                                     # not down over the forehead
        r = 0.03 + 0.012 * math.cos(theta)
        c = on_cap(theta, phi, 0.018 + 0.01 * math.cos(theta))
        parts.append(blob(f"_tuft{i}", c, (r, r * 0.85, r * 0.8), rot=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 3))))
    # The front: tufts pushed up off the hairline.
    for i, x in enumerate((-0.1, -0.05, 0.0, 0.05, 0.1)):
        c = on_head(x, 1.405 + 0.01 * math.cos(x * 20), -0.03)
        parts.append(blob(f"_front{i}", c, (0.035, 0.03, 0.04), rot=(math.radians(-35), 0, math.radians(-25 * x / 0.1))))
    return fuse("_short", parts, 0.005, mat, smooth=8)


def hair_curly(mat):
    """Big curls all over (the sheet's fourth hair): round curls on a cap, a full rounded volume."""
    parts = [scalp("_curly_cap", 1.37, 1.21, 1.07, 0.02)]
    n = 70
    for i in range(n):
        # Even over the cap (a Fibonacci spiral), above the hairline.
        theta = math.acos(1 - (i + 0.5) / n * 1.15)
        phi = i * math.pi * (3 - math.sqrt(5))
        phi = (phi + math.pi) % math.tau - math.pi
        c = on_cap(theta, phi, 0.035)
        front = abs(phi) < math.radians(55)
        if (front and theta > math.radians(52)) or (not front and theta > math.radians(100)) or (abs(abs(phi) - math.pi / 2) < 0.5 and theta > math.radians(78)):
            continue
        r = 0.04 + 0.006 * math.sin(i * 1.7)
        parts.append(blob(f"_curl{i}", c, (r, r, r * 0.92), u=16, v=10))
    return fuse("_curly", parts, 0.006, mat, smooth=6)


def hair_long(mat):
    """Long hair to the shoulders (the sheet's fifth): parted to one side, a swept fringe, falling straight
    either side of the face and down the back, the ends resting on the shoulders."""
    cx, cy, cz = HEAD_C
    parts = [scalp("_long_cap", 1.36, 1.0, 1.0, 0.02)]
    for i, (x1, z1) in enumerate(((-0.2, 1.2), (-0.16, 1.28), (0.17, 1.26), (0.21, 1.18))):
        pts = [(0.03, cy - 0.12 + 0.05 * k, 1.5 - 0.01 * k) for k in range(2)]
        for k in range(1, 8):
            t = k / 7
            x = 0.03 + (x1 - 0.03) * t
            z = 1.49 - (1.49 - z1) * t * t
            y = cy - 0.08 + 0.06 * t
            kk = max(0.05, 1 - (x / (HEAD_R[0] + 0.035)) ** 2 - ((z - cz) / (HEAD_R[2] + 0.035)) ** 2)
            pts.append((x, min(y, cy - (HEAD_R[1] + 0.02) * math.sqrt(kk) * 0.6), z))
        parts.append(lock(f"_lpart{i}", pts, 0.032, mat))
    for s in (1, -1):
        # Falling straight past the jaw, the ends turning out a little over the shoulders.
        parts.append(blob(f"_lcurtain{s}", (s * 0.205, cy + 0.0, 1.12), (0.055, 0.15, 0.25)))
        parts.append(blob(f"_lend{s}", (s * 0.215, cy + 0.03, 0.99), (0.06, 0.12, 0.05)))
    parts.append(blob("_lfringe", (-0.03, cy - 0.19, 1.385), (0.12, 0.045, 0.045), rot=(math.radians(-25), 0, math.radians(8))))
    parts.append(blob("_lback", (0.0, cy + 0.11, 1.13), (0.19, 0.085, 0.21)))
    for i, x0 in enumerate((-0.16, -0.08, 0.0, 0.08, 0.16)):
        pts = []
        for k in range(10):
            t = k / 9
            z = 1.44 - (1.44 - 1.0) * t
            x = x0 * (0.6 + 0.55 * t)                    # in close over the crown, out over the shoulders
            kk = max(0.05, 1 - (x / (HEAD_R[0] + 0.03)) ** 2 - ((z - cz) / (HEAD_R[2] + 0.03)) ** 2)
            pts.append((x, cy + (HEAD_R[1] + 0.03) * math.sqrt(kk) + 0.05 * t, z))
        parts.append(lock(f"_longback{i}", pts, 0.036, mat))
    return fuse("_longm", parts, 0.005, mat, smooth=8)


# ---- facial hair --------------------------------------------------------------------------------

def beard_shell(name, thickness, lumpy, mat, half_w=0.175, top=0.035):
    """A shell over the jaw, chin and upper lip, offset from the head, with the mouth left clear."""
    head = bpy.data.objects[f"{A}_Head_HIGH"]
    me = head.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    m = head.matrix_world
    cx, cy, cz = HEAD_C
    keep = set()
    for f in bm.faces:
        p = m @ f.calc_center_median()
        jaw = p.z < MOUTH_Z + top and p.y < cy - 0.02 and abs(p.x) < half_w  # the jaw's front: clear of a bob's curtains
        mouth = abs(p.x) < 0.05 and abs(p.z - (MOUTH_Z - 0.006)) < 0.017 and p.y < cy - 0.1
        if jaw and not mouth and p.z > CHIN_Z - 0.03:
            keep.add(f)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context="FACES")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (0.0025 + (lumpy * (0.5 + 0.5 * math.sin(v.co.x * 90) * math.sin(v.co.z * 70)) if lumpy else 0))
    ob = new_mesh_object(name, bm, "HIGH")
    solidify(ob, thickness, offset=1.0)
    apply_all_modifiers(ob)
    assign(ob, mat)
    shade_smooth(ob, math.radians(180))
    return ob


def stache(name, mat, w=0.05, r=0.006):
    """A moustache over the smile."""
    pts = [on_head(w * (2 * t - 1), MOUTH_Z + 0.022 - 0.006 * abs(2 * t - 1), -0.006) for t in [i / 8 for i in range(9)]]
    return sweep(name, pts, 0.012, mat, radii=[0.007 + r * math.sin(math.pi * i / 8) for i in range(9)])


def beard_full(mat):
    return [beard_shell("_beard_full", 0.016, 0.006, mat), stache("_stache", mat)]


def beard_long(mat):
    """The sheet's fourth beard: thick, rounder at the chin and longer under it, a heavy moustache."""
    cx, cy, cz = HEAD_C
    shell = beard_shell("_beard_long", 0.026, 0.008, mat)
    chin = blob("_bchin", (0.0, cy - 0.15, CHIN_Z - 0.01), (0.1, 0.07, 0.065))
    assign(chin, mat)
    return [fuse("_beardl", [shell, chin], 0.005, mat, smooth=6), stache("_stachel", mat, 0.055, 0.008)]


def beard_goatee(mat):
    """A moustache and a chin beard (the sheet's fifth): nothing on the cheeks."""
    shell = beard_shell("_goatee", 0.016, 0.005, mat, half_w=0.06, top=-0.012)
    return [shell, stache("_stacheg", mat)]


# ---- glasses ------------------------------------------------------------------------------------

def glasses(name, rim_pts, rim_r, mat):
    """Two rims round the eyes, a bridge, and arms back along the head to the ears."""
    parts = []
    fy = on_head(EYE_X, EYE_Z)[1] - 0.022
    for s in (1, -1):
        ring = [(s * EYE_X + px, fy + 0.004 * (px * s) / 0.04, EYE_Z + pz) for px, pz in rim_pts]
        parts.append(sweep(f"_rim{s}", ring + ring[:1], rim_r, mat, cap=False))
        outer = max(rim_pts, key=lambda p: p[0])[0]
        hinge = (s * (EYE_X + outer), fy + 0.006, EYE_Z + 0.008)
        ear = (s * (HEAD_R[0] + 0.012), HEAD_C[1] + 0.02, EAR_Z + 0.045)
        parts.append(sweep(f"_arm{s}", [hinge, (s * (HEAD_R[0] + 0.01), fy + 0.08, EYE_Z + 0.01), ear, (ear[0] * 0.97, ear[1] + 0.03, ear[2] - 0.03)], rim_r * 0.75, mat))
    inner = min(rim_pts, key=lambda p: p[0])[0]
    parts.append(sweep("_bridge", [(-(EYE_X + inner), fy - 0.004, EYE_Z + 0.01), (0, fy - 0.01, EYE_Z + 0.018), (EYE_X + inner, fy - 0.004, EYE_Z + 0.01)], rim_r * 0.9, mat))
    return parts


def lenses(rim_pts, mat):
    """Dark lenses filling the rims, just behind them."""
    out = []
    fy = on_head(EYE_X, EYE_Z)[1] - 0.022
    for s in (1, -1):
        bm = bmesh.new()
        vs = [bm.verts.new((s * EYE_X + px * 0.97, fy + 0.004 * (px * s) / 0.04 + 0.002, EYE_Z + pz * 0.97)) for px, pz in rim_pts]
        bm.faces.new(vs if s > 0 else vs[::-1])
        bmesh.ops.triangulate(bm, faces=bm.faces)
        ob = new_mesh_object(f"_lens{s}", bm, "HIGH")
        solidify(ob, 0.003, offset=0.0)
        apply_all_modifiers(ob)
        assign(ob, mat)
        out.append(ob)
    return out


def round_rim():
    return [(0.042 * math.cos(a), 0.042 * math.sin(a)) for a in [i * math.tau / 24 for i in range(24)]]


def square_rim(w=0.05, h=0.036):
    pts = []
    for i in range(32):
        a = i * math.tau / 32
        c, s = math.cos(a), math.sin(a)
        # a rounded rectangle, 0.1 wide and 0.072 tall (a superellipse)
        pts.append((w * math.copysign(abs(c) ** 0.4, c), h * math.copysign(abs(s) ** 0.4, s)))
    return pts


# ---- top, bottom, shoes -------------------------------------------------------------------------

def jacket(mat, trim, zipped=True):
    """A zipped jacket as one piece of cloth (like the hoodie: forms' garment()): the body, rounded
    shoulders, sleeves gathered into rib cuffs, a rib hem and a stand collar, 1.8 cm thick, open at the
    neck, cuffs and hem; the zip and its pull down the closed front."""
    garment, cutter_box, cutter_tube, sleeve = F["garment"], F["cutter_box"], F["cutter_tube"], F["sleeve"]
    loose = []
    parts = [loft("_jbody", [[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 40 for i in range(40)]] for z, rx, ry in (
        (HEM_Z - 0.005, 0.208, 0.152), (0.66, 0.205, 0.154), (0.82, 0.205, 0.16), (0.885, 0.178, 0.143), (0.935, 0.13, 0.108), (0.958, 0.1, 0.087))], "HIGH")]
    parts.append(loft("_jcollar", [[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 32 for i in range(32)]] for z, rx, ry in ((0.94, 0.102, 0.092), (0.985, 0.09, 0.082))], "HIGH"))  # a stand collar below the chin
    hem = [(0.212 * math.cos(a), 0.157 * math.sin(a) - 0.01, HEM_Z + 0.012) for a in [i * math.tau / 40 for i in range(41)]]
    parts.append(sweep("_jhem", hem, 0.016, mat, cap=False))
    cutters = [cutter_tube("_cut_neck", (0, -0.01, 0.9), (0, -0.01, 1.12), 0.072),
               cutter_box("_cut_hem", (-0.6, -0.6, -0.5), (0.6, 0.6, HEM_Z - 0.002))]
    for s in (1, -1):
        loose += list(sleeve(f"_jSleeve{s}", s, mat, [0.07, 0.066, 0.072, 0.076, 0.07, 0.054], 0.05, shoulder=(0.072, 0.086, 0.068)))
    shell = garment("_jacket" if zipped else "_sweater", parts, mat, 0.018, cutters)
    if not zipped:
        return [shell] + loose
    # The zip on the cloth down the front (following it in where it narrows to the collar), its pull at the top.
    zp = F["onto"](shell, [(0, 0, z) for z in (0.98, 0.95, 0.92, 0.88, 0.82, 0.74, 0.66, 0.6, HEM_Z + 0.02)], 0.002)
    zip_line = sweep("_zip", zp, 0.005, trim)
    pull = assign_r(blob("_pull", (zp[2][0], zp[2][1] - 0.004, zp[2][2]), (0.008, 0.004, 0.016)), trim)
    return [shell, zip_line, pull] + loose


def sweater(mat, trim):
    """The sheet's green top: a sweater (the jacket's cloth, closed, no zip) with a shirt's collar points
    out over its neck."""
    pieces = jacket(mat, trim, zipped=False)
    shell = pieces[0]
    for s in (1, -1):
        # Each point a flat triangle of cloth from the neck down and out, lying on the sweater.
        a, b, c = F["onto"](shell, [(s * 0.015, 0, 0.958), (s * 0.1, 0, 0.95), (s * 0.035, 0, 0.87)], 0.004)
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in (a, b, c)]
        bm.faces.new(vs if s > 0 else vs[::-1])
        ob = new_mesh_object(f"_collar{s}", bm, "HIGH")
        solidify(ob, 0.006, offset=0.0)
        bevel(ob, 0.003, 2, 60, False)
        apply_all_modifiers(ob)
        assign(ob, trim)
        pieces.append(ob)
    return pieces


def print_squares(mat):
    """The sheet's tee print: four rounded squares, two by two, on the chest of the tee."""
    tee = bpy.data.objects[f"{A}_Top_Tee_LOD0"]
    out = []
    for i, (x, z) in enumerate(((-0.02, 0.795), (0.02, 0.795), (-0.02, 0.755), (0.02, 0.755))):
        p = F["onto"](tee, [(x, 0, z)], 0.0065)[0]
        b = blob(f"_sq{i}", p, (0.016, 0.004, 0.016), u=16, v=8)
        # Squarer than a disc (a superellipse, the same size).
        rx = max(abs(v.co.x) for v in b.data.vertices)
        rz = max(abs(v.co.z) for v in b.data.vertices)
        for v in b.data.vertices:
            v.co.x = math.copysign(abs(v.co.x / rx) ** 0.6 * rx, v.co.x)
            v.co.z = math.copysign(abs(v.co.z / rz) ** 0.6 * rz, v.co.z)
        assign(b, mat)
        out.append(b)
    return out


def lanyard(cord, card, clip):
    """An ID badge on a cord round the neck (the sheet's second and fifth outfits): the cord from behind
    the neck, round its sides and down the chest in a V to a clip and a card, over whatever top is worn."""
    over = bpy.data.objects[f"{A}_Top_Jacket_LOD0"]       # the outermost closed front
    out = []
    for s in (1, -1):
        back = [(s * 0.06 * math.sin(a), 0.07 * math.cos(a) - 0.005, 0.968) for a in [math.radians(d) for d in (5, 45, 80)]]
        front = F["onto"](over, [(s * 0.075, 0, 0.93), (s * 0.06, 0, 0.87), (s * 0.04, 0, 0.82), (s * 0.012, 0, 0.775)], 0.008)
        out.append(sweep(f"_cord{s}", back + front, 0.0045, cord))
    top = F["onto"](over, [(0, 0, 0.765)], 0.01)[0]
    out.append(assign_r(blob("_clip", (top[0], top[1], top[2] - 0.005), (0.009, 0.005, 0.012)), clip))
    c = F["onto"](over, [(0, 0, 0.71)], 0.012)[0]
    badge = blob("_card", c, (0.03, 0.005, 0.042), u=16, v=8)
    rx = max(abs(v.co.x) for v in badge.data.vertices)
    rz = max(abs(v.co.z) for v in badge.data.vertices)
    for v in badge.data.vertices:                      # a card, squarer than a disc, the same size
        v.co.x = math.copysign(abs(v.co.x / rx) ** 0.55 * rx, v.co.x)
        v.co.z = math.copysign(abs(v.co.z / rz) ** 0.55 * rz, v.co.z)
    out.append(assign_r(badge, card))
    return out


def assign_r(ob, mat):
    assign(ob, mat)
    return ob


def joggers(mat, trim):
    """Joggers as one piece (like the trousers): the waist running into two legs that taper to rib cuffs
    gathered at the ankle, above the shoe; the drawstring's ends at the waist."""
    parts = [loft("_jwaist", [[(rx * math.cos(a), ry * math.sin(a) - 0.012, z) for a in [i * math.tau / 36 for i in range(36)]] for z, rx, ry in (
        (0.44, 0.17, 0.125), (0.5, 0.19, 0.13), (0.6, 0.175, 0.125))], "HIGH"),
             blob("_jcrotch", (0.0, -0.012, 0.46), (0.07, 0.11, 0.05))]
    # The seat: rounded glutes at the back.
    for gs in (1, -1):
        parts.append(blob(f"_glute{gs}", (gs * 0.075, 0.06, 0.49), (0.1, 0.085, 0.095)))

    for s in (1, -1):
        secs = []
        for z, r, dx in ((0.52, 0.09, -0.03), (0.45, 0.092, -0.01), (0.38, 0.09, 0.0), (0.3, 0.084, 0.0), (0.24, 0.074, 0.0), (0.215, 0.066, 0.0)):
            secs.append([(s * (LEG_X + dx) + r * math.cos(a), -0.015 + 1.1 * r * math.sin(a), z) for a in [i * math.tau / 28 for i in range(28)]])
        parts.append(loft(f"_jleg{s}", secs, "HIGH"))
        parts.append(loft(f"_jcuffs{s}", [[(s * LEG_X + r * math.cos(a), -0.015 + 1.08 * r * math.sin(a), z) for a in [i * math.tau / 28 for i in range(28)]] for z, r in ((0.215, 0.072), (0.19, 0.072), (0.17, 0.068))], "HIGH"))
    legs = fuse("_joggers", parts, 0.006, mat, smooth=6)
    strings = [sweep(f"_jstr{s}", [(s * 0.02, -0.13, 0.56), (s * 0.025, -0.135, 0.52), (s * 0.022, -0.137, 0.49)], 0.0045, trim) for s in (1, -1)]
    return [legs] + strings


def runners(white, accent):
    """Low, slim running shoes: a thicker heel, a pointed-round toe, a side stripe."""
    parts = []
    L, W = SHOE_LEN * 0.9, 0.2
    for s in (1, -1):
        x0 = s * FOOT_X
        y_toe = SHOE_FRONT + 0.02
        sole_pts = []
        for i in range(40):
            a = math.tau * i / 40
            x = 0.5 * W * math.cos(a)
            y = 0.5 * L * math.sin(a)
            sole_pts.append((math.copysign(abs(x) ** 0.85 * (0.5 * W) ** 0.15, x), y))
        sole = profile_extrude(f"_rsole{s}", sole_pts, 0.04, "HIGH", location=(x0, y_toe + L / 2, 0))
        bevel(sole, 0.012, 3, 40, False)
        apply_all_modifiers(sole)
        assign(sole, accent)
        parts.append(sole)
        secs = []
        for t, h, w in ((0.03, 0.02, 0.1), (0.12, 0.05, 0.17), (0.3, 0.075, 0.19), (0.5, 0.1, 0.19), (0.68, 0.115, 0.18), (0.85, 0.11, 0.17), (0.96, 0.09, 0.14), (0.99, 0.06, 0.08)):
            y = y_toe + L * t
            secs.append([(x0 + 0.5 * w * math.cos(math.pi * i / 19), y, 0.038 + h * math.sin(math.pi * i / 19) ** 0.7) for i in range(20)])
        up = loft(f"_rup{s}", secs, "HIGH", close_sections=True)
        subsurf(up, 1)
        apply_all_modifiers(up)
        assign(up, white)
        shade_smooth(up, math.radians(180))
        parts.append(up)
        # A stripe sweeping back along the outer side.
        stripe = [(x0 + s * 0.093, y_toe + L * t, 0.06 + 0.05 * t) for t in (0.3, 0.45, 0.6, 0.75)]
        parts.append(sweep(f"_rstripe{s}", stripe, 0.008, accent))
    return parts


# ---- intersections ------------------------------------------------------------------------------

def overlaps(a, b):
    """How many triangle pairs of the two meshes intersect (their LOD0s, in world space)."""
    def tree(o):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.transform(bm, matrix=o.matrix_world, verts=bm.verts)
        t = BVHTree.FromBMesh(bm)
        bm.free()
        return t
    return len(tree(a).overlap(tree(b)))


def build(scene, args):
    mats = {n: bpy.data.materials[n] for n in ("M_Hair", "M_PrimaryClothing", "M_SecondaryClothing", "M_Pants", "M_Shoes", "M_ShoesAccent")}
    acc = material("M_Accessories", (0.12, 0.12, 0.14, 1), 0.35)

    piece("Hair_Bun", [hair_bun(mats["M_Hair"])], "02_HAIR", 1800)
    piece("Hair_Bob", [hair_bob(mats["M_Hair"])], "02_HAIR", 2000)
    piece("Hair_Short", [hair_short(mats["M_Hair"])], "02_HAIR", 1800)
    piece("Hair_Curly", [hair_curly(mats["M_Hair"])], "02_HAIR", 2400)
    piece("Hair_Long", [hair_long(mats["M_Hair"])], "02_HAIR", 2400)
    piece("Beard_Stubble", [beard_shell("_stubble", 0.002, 0.0, mats["M_Hair"])], "03_FACIAL_HAIR", 600)
    piece("Beard_Full", beard_full(mats["M_Hair"]), "03_FACIAL_HAIR", 1200)
    piece("Beard_Long", beard_long(mats["M_Hair"]), "03_FACIAL_HAIR", 1400)
    piece("Beard_Goatee", beard_goatee(mats["M_Hair"]), "03_FACIAL_HAIR", 700)
    piece("Glasses_Round", glasses("Round", round_rim(), 0.005, acc), "07_ACCESSORIES", 700)
    piece("Glasses_Square", glasses("Square", square_rim(), 0.0065, acc), "07_ACCESSORIES", 800)
    piece("Glasses_Thick", glasses("Thick", square_rim(0.052, 0.038), 0.011, acc), "07_ACCESSORIES", 900)
    piece("Glasses_Sun", glasses("Sun", square_rim(0.052, 0.04), 0.0075, acc) + lenses(square_rim(0.052, 0.04), bpy.data.materials["M_Eyes"]), "07_ACCESSORIES", 1000)
    piece("Top_Jacket", jacket(mats["M_PrimaryClothing"], mats["M_SecondaryClothing"]), "04_TOPS", 3200)
    piece("Top_Sweater", sweater(mats["M_PrimaryClothing"], mats["M_SecondaryClothing"]), "04_TOPS", 3200)
    piece("Print_Squares", print_squares(material("M_Print", (0.95, 0.55, 0.2, 1), 0.6)), "04_TOPS", 300)
    piece("Badge_Lanyard", lanyard(material("M_Lanyard", (0.18, 0.45, 0.93, 1), 0.6), material("M_Badge", (0.96, 0.96, 0.95, 1), 0.4), acc), "07_ACCESSORIES", 500)
    piece("Bottom_Joggers", joggers(mats["M_Pants"], mats["M_SecondaryClothing"]), "05_BOTTOMS", 1800)
    piece("Shoes_Runners", runners(mats["M_Shoes"], mats["M_ShoesAccent"]), "06_SHOES", 2400)

    # Every piece: its slot, and the body pieces it covers.
    for ob in [o for o in col("LOW").all_objects if o.type == "MESH" and o.name.endswith("_LOD0")]:
        part = ob.name[len(A) + 1:-len("_LOD0")]
        for key, (slot, covers) in SLOTS.items():
            if part == key or part.startswith(key + "_") or (key.count("_") and part == key):
                ob["slot"] = slot
                ob["covers"] = covers
        if "slot" not in ob and not part.startswith(("Body_", "Face_")):
            raise SystemExit(f"no slot for {ob.name}")

    # Pieces worn together must not pass through each other.
    lod0 = {o.name[len(A) + 1:-len("_LOD0")]: o for o in col("LOW").all_objects if o.name.endswith("_LOD0")}
    pairs = []
    HAIRS = ("Hair_Wavy", "Hair_Bun", "Hair_Bob", "Hair_Short", "Hair_Curly", "Hair_Long")
    GLASSES = ("Glasses_Round", "Glasses_Square", "Glasses_Thick", "Glasses_Sun")
    BEARDS = ("Beard_Stubble", "Beard_Full", "Beard_Long", "Beard_Goatee")
    TOPS = ("Top_Tee", "Top_HoodieOpen", "Top_Jacket", "Top_Sweater")
    for h in HAIRS:
        pairs += [(h, g) for g in GLASSES] + [(h, b) for b in BEARDS]
        pairs += [(h, t) for t in TOPS[1:]]
    pairs += [(b, g) for b in BEARDS for g in GLASSES]
    pairs += [(b, "Face_Mouth") for b in BEARDS]
    pairs += [("Badge_Lanyard", t) for t in TOPS] + [("Badge_Lanyard", b) for b in BEARDS] + [("Print_Squares", "Top_Tee")]
    pairs += [(t, b) for t in TOPS for b in ("Bottom_Trousers", "Bottom_Joggers")]
    pairs += [(b, s) for b in ("Bottom_Trousers", "Bottom_Joggers") for s in ("Shoes_Sneakers", "Shoes_Runners")]
    # Layered by design, the inner piece out of sight inside the outer one: the tee under a top, a top's
    # hem over the trousers' waist, the trousers' hem into the shoe, glasses' arms under a bob. Reported,
    # and checked in the combination renders rather than counted as clipping.
    # Glasses' arms under a bob's or long hair's curtains, which fall over a beard's sides; long hair's ends over a top's hood and shoulders.
    TUCKED = {(h, x) for h in ("Hair_Bob", "Hair_Long") for x in GLASSES + BEARDS} | {("Hair_Long", t) for t in TOPS}
    TUCKED |= {(t, b) for t in TOPS for b in ("Bottom_Trousers", "Bottom_Joggers")}
    TUCKED |= {("Badge_Lanyard", t) for t in TOPS}  # the cord runs under each top's collar round the neck
    TUCKED |= {(b, s) for b in ("Bottom_Trousers", "Bottom_Joggers") for s in ("Shoes_Sneakers", "Shoes_Runners")}
    bad, tucked = [], []
    for a, b in pairs:
        n = overlaps(lod0[a], lod0[b])
        if n:
            (tucked if (a, b) in TUCKED else bad).append((a, b, n))
    for a, b, n in tucked:
        log(f"tucked  {a} x {b}: {n} triangle pairs")
    for a, b, n in bad:
        log(f"CLIPPING {a} x {b}: {n} triangle pairs")
    log(f"{len(pairs)} pairs checked: {len(bad)} clipping, {len(tucked)} layered by design")
    for o in sorted(lod0.values(), key=lambda o: o.name):
        if o.get("owner") == OWNER_TAG:
            log(f"{o.name:40s} {tris(o):6d} tris  slot={o.get('slot')}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    clear_owned()
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
