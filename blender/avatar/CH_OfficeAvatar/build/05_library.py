"""
CH_OfficeAvatar, phase 5: the customization library. More pieces for every slot, each a game mesh (LOD0,
with LOD1 and LOD2) fitted to the same base body and, from 06_rig.py, the same skeleton:

  02_HAIR         Hair_Bun (a top knot), Hair_Bob (straight, to the jaw)           (Hair_Wavy from 04)
  03_FACIAL_HAIR  Beard_Stubble, Beard_Full (with a moustache)                     (clean-shaven: none)
  04_TOPS         Top_Jacket (zipped, stand collar)                                (Top_Tee, Top_HoodieOpen)
  05_BOTTOMS      Bottom_Joggers (tapered, ankle cuffs)                            (Bottom_Trousers)
  06_SHOES        Shoes_Runners (low and slim)                                     (Shoes_Sneakers)
  07_ACCESSORIES  Glasses_Round, Glasses_Square

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
    return ob


# ---- hair ---------------------------------------------------------------------------------------

def scalp(name, hairline_z, side_z, nape_z, thick=0.02):
    """A hair cap over the skull, off the face above `hairline_z`, the sides down to `side_z`, the nape to `nape_z`."""
    cx, cy, cz = HEAD_C
    cap = sphere(name, 1.0, "HIGH", location=(cx, cy + 0.005, cz + 0.005), u=48, v=32, scale=(HEAD_R[0] + 0.02, HEAD_R[1] + 0.02, HEAD_R[2] + 0.018))
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    m = cap.matrix_world
    kill = []
    for v in bm.verts:
        p = m @ v.co
        side = abs(p.x) > 0.11 and p.y < cy + 0.11
        if (p.y < cy - 0.05 and p.z < hairline_z and abs(p.x) < 0.17) or (side and p.z < side_z) or (p.z < side_z - 0.03 and p.y < cy + 0.02) or p.z < nape_z:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(cap.data)
    bm.free()
    solidify(cap, thick, offset=1.0)
    apply_all_modifiers(cap)
    return cap


def hair_bun(mat):
    cx, cy, cz = HEAD_C
    parts = [scalp("_bun_cap", 1.36, 1.22, 1.05, 0.018)]
    # Hair drawn back tight: a few long smooth bands over the crown towards the knot, and the knot.
    for i, x in enumerate((-0.11, -0.04, 0.04, 0.11)):
        parts.append(blob(f"_band{i}", (x, cy - 0.03, 1.45), (0.05, 0.16, 0.035), rot=(math.radians(-25), 0, math.radians(8 * (x > 0) - 8 * (x < 0)))))
    parts.append(blob("_knot", (0.0, cy + 0.05, 1.555), (0.085, 0.08, 0.075)))
    parts.append(blob("_knot_base", (0.0, cy + 0.04, 1.5), (0.06, 0.06, 0.03)))
    # Two loose strands in front of the ears.
    for s in (1, -1):
        parts.append(blob(f"_strand{s}", (s * 0.168, cy - 0.07, 1.22), (0.016, 0.02, 0.065), rot=(0, 0, s * math.radians(8))))  # inside the glasses' arms
    return fuse("_bun", parts, 0.005, mat, smooth=4)


def hair_bob(mat):
    cx, cy, cz = HEAD_C
    parts = [scalp("_bob_cap", 1.35, 1.0, 1.06, 0.022)]
    # Curtains either side of a centre parting, falling straight to the jaw; the back cut level above the hood.
    for s in (1, -1):
        parts.append(blob(f"_curtain{s}", (s * 0.2, cy - 0.02, 1.18), (0.05, 0.16, 0.2)))
        parts.append(blob(f"_fringe{s}", (s * 0.075, cy - 0.185, 1.37), (0.085, 0.05, 0.05), rot=(math.radians(-25), 0, s * math.radians(-15))))
    parts.append(blob("_back", (0.0, cy + 0.11, 1.2), (0.19, 0.085, 0.14)))  # cut level above the hood
    parts.append(blob("_crown", (0.0, cy, 1.44), (0.205, 0.215, 0.11)))  # a rounded top, not a brim
    ob = fuse("_bobm", parts, 0.005, mat, smooth=8)
    # Off the face: anything left in front of the cheeks between the curtains.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    face = [v for v in bm.verts if abs(v.co.x) < 0.15 and v.co.y < cy - 0.09 and v.co.z < 1.33]
    bmesh.ops.delete(bm, geom=face, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    return ob


# ---- facial hair --------------------------------------------------------------------------------

def beard_shell(name, thickness, lumpy, mat):
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
        jaw = p.z < MOUTH_Z + 0.035 and p.y < cy - 0.02 and abs(p.x) < 0.175  # the jaw's front: clear of a bob's curtains
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


def beard_full(mat):
    shell = beard_shell("_beard_full", 0.016, 0.006, mat)
    # A moustache over the smile.
    pts = [on_head(0.05 * (2 * t - 1), MOUTH_Z + 0.022 - 0.006 * abs(2 * t - 1), -0.006) for t in [i / 8 for i in range(9)]]
    stache = sweep("_stache", pts, 0.012, mat, radii=[0.007 + 0.006 * math.sin(math.pi * i / 8) for i in range(9)])
    return [shell, stache]


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


def round_rim():
    return [(0.042 * math.cos(a), 0.042 * math.sin(a)) for a in [i * math.tau / 24 for i in range(24)]]


def square_rim():
    pts = []
    for i in range(32):
        a = i * math.tau / 32
        c, s = math.cos(a), math.sin(a)
        # a rounded rectangle, 0.1 wide and 0.072 tall (a superellipse)
        pts.append((0.05 * math.copysign(abs(c) ** 0.4, c), 0.036 * math.copysign(abs(s) ** 0.4, s)))
    return pts


# ---- top, bottom, shoes -------------------------------------------------------------------------

def jacket(mat, trim):
    """A zipped jacket as one piece of cloth (like the hoodie: forms' garment()): the body, rounded
    shoulders, sleeves gathered into rib cuffs, a rib hem and a stand collar, 1.8 cm thick, open at the
    neck, cuffs and hem; the zip and its pull down the closed front."""
    garment, cutter_box, cutter_tube, SLEEVE = F["garment"], F["cutter_box"], F["cutter_tube"], F["SLEEVE"]
    parts = [loft("_jbody", [[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 40 for i in range(40)]] for z, rx, ry in (
        (HEM_Z - 0.005, 0.208, 0.152), (0.66, 0.205, 0.154), (0.82, 0.205, 0.16), (0.885, 0.178, 0.143), (0.94, 0.13, 0.108), (0.975, 0.095, 0.085))], "HIGH")]
    parts.append(loft("_jcollar", [[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 32 for i in range(32)]] for z, rx, ry in ((0.95, 0.1, 0.09), (1.005, 0.088, 0.08))], "HIGH"))
    hem = [(0.212 * math.cos(a), 0.157 * math.sin(a) - 0.01, HEM_Z + 0.012) for a in [i * math.tau / 40 for i in range(41)]]
    parts.append(sweep("_jhem", hem, 0.016, mat, cap=False))
    cutters = [cutter_tube("_cut_neck", (0, -0.01, 0.9), (0, -0.01, 1.12), 0.072),
               cutter_box("_cut_hem", (-0.6, -0.6, -0.5), (0.6, 0.6, HEM_Z - 0.002))]
    for s in (1, -1):
        parts.append(blob(f"_jsh{s}", (s * 0.155, -0.002, 0.875), (0.072, 0.086, 0.068)))
        sl = SLEEVE(s)
        parts.append(sweep(f"_jsl{s}", sl, 0.075, mat, segments=24, radii=[0.066, 0.072, 0.076, 0.07, 0.054]))
        end, axis = sl[-1], (sl[-1] - sl[-2]).normalized()
        n = axis.cross(Vector((0, 1, 0))).normalized()
        b2 = axis.cross(n).normalized()
        parts.append(sweep(f"_jcuff{s}", [end - axis * 0.004 + (n * math.cos(a) + b2 * math.sin(a)) * 0.05 for a in [i * math.tau / 24 for i in range(25)]], 0.016, mat, cap=False))
        cutters.append(cutter_tube(f"_cut_cuff{s}", end - axis * 0.05, end + axis * 0.06, 0.035))
    shell = garment("_jacket", parts, mat, 0.018, cutters)
    zip_line = sweep("_zip", [(0, -0.168, z) for z in (1.0, 0.95, 0.9, 0.8, 0.7, 0.6, HEM_Z + 0.02)], 0.005, trim)
    pull = assign_r(blob("_pull", (0.0, -0.176, 0.955), (0.008, 0.004, 0.016)), trim)
    return [shell, zip_line, pull]


def assign_r(ob, mat):
    assign(ob, mat)
    return ob


def joggers(mat, trim):
    """Joggers as one piece (like the trousers): the waist running into two legs that taper to rib cuffs
    gathered at the ankle, above the shoe; the drawstring's ends at the waist."""
    parts = [loft("_jwaist", [[(rx * math.cos(a), ry * math.sin(a) - 0.012, z) for a in [i * math.tau / 36 for i in range(36)]] for z, rx, ry in (
        (0.44, 0.17, 0.125), (0.5, 0.19, 0.13), (0.6, 0.175, 0.125))], "HIGH"),
             blob("_jcrotch", (0.0, -0.012, 0.46), (0.07, 0.11, 0.05))]
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
    piece("Beard_Stubble", [beard_shell("_stubble", 0.002, 0.0, mats["M_Hair"])], "03_FACIAL_HAIR", 600)
    piece("Beard_Full", beard_full(mats["M_Hair"]), "03_FACIAL_HAIR", 1200)
    piece("Glasses_Round", glasses("Round", round_rim(), 0.005, acc), "07_ACCESSORIES", 700)
    piece("Glasses_Square", glasses("Square", square_rim(), 0.0065, acc), "07_ACCESSORIES", 800)
    piece("Top_Jacket", jacket(mats["M_PrimaryClothing"], mats["M_SecondaryClothing"]), "04_TOPS", 3600)
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
    for h in ("Hair_Wavy", "Hair_Bun", "Hair_Bob"):
        pairs += [(h, g) for g in ("Glasses_Round", "Glasses_Square")] + [(h, b) for b in ("Beard_Stubble", "Beard_Full")]
        pairs += [(h, t) for t in ("Top_HoodieOpen", "Top_Jacket")]
    pairs += [(b, g) for b in ("Beard_Stubble", "Beard_Full") for g in ("Glasses_Round", "Glasses_Square")]
    pairs += [(b, "Face_Mouth") for b in ("Beard_Stubble", "Beard_Full")]
    pairs += [("Top_Tee", t) for t in ("Top_HoodieOpen", "Top_Jacket")]
    pairs += [(t, b) for t in ("Top_Tee", "Top_HoodieOpen", "Top_Jacket") for b in ("Bottom_Trousers", "Bottom_Joggers")]
    pairs += [(b, s) for b in ("Bottom_Trousers", "Bottom_Joggers") for s in ("Shoes_Sneakers", "Shoes_Runners")]
    # Layered by design, the inner piece out of sight inside the outer one: the tee under a top, a top's
    # hem over the trousers' waist, the trousers' hem into the shoe, glasses' arms under a bob. Reported,
    # and checked in the combination renders rather than counted as clipping.
    TUCKED = {("Top_Tee", "Top_HoodieOpen"), ("Top_Tee", "Top_Jacket"), ("Hair_Bob", "Glasses_Round"), ("Hair_Bob", "Glasses_Square"),
              ("Hair_Bob", "Beard_Stubble"), ("Hair_Bob", "Beard_Full")}  # a bob's curtains fall over the beard's sides
    TUCKED |= {(t, b) for t in ("Top_Tee", "Top_HoodieOpen", "Top_Jacket") for b in ("Bottom_Trousers", "Bottom_Joggers")}
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
