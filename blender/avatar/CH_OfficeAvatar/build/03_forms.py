"""
CH_OfficeAvatar, phase 3: forms. Each part of the base character shaped over the approved blockout, in
HIGH, still as separate parts (the avatar is modular): the head with its ears and face marks, the hair,
the hands, the body under the clothing, the open hoodie with its hood, cuffs, hem, piping and drawstrings,
the tee, the trousers and the sneakers.

  blender --background --python build/03_forms.py -- --master CH_OfficeAvatar_master.blend

Same conventions and measurements as 02_blockout.py (imported from it), which this phase refines.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, "_kit.py")).read())
_blockout = {"__file__": os.path.join(HERE, "02_blockout.py"), "__name__": "02_blockout"}
exec(compile(open(os.path.join(HERE, "02_blockout.py")).read().split('\nif __name__ == "__main__":')[0], "02_blockout.py", "exec"), _blockout)
for _k in ("H", "CHIN_Z", "SKULL", "HEAD_C", "HEAD_R", "EYE_Z", "EYE_X", "EYE_SIZE", "BROW_Z", "MOUTH_Z", "EAR_Z", "EAR_R", "HAIR_TOP",
           "SHOULDER_Z", "HEM_Z", "CROTCH_Z", "FIST_C_Z", "FIST_X", "FOOT_X", "LEG_X", "ANKLE_Z", "SHOE_LEN", "SHOE_H", "SHOE_W",
           "SHOE_FRONT", "LEG_R", "SKIN", "HAIR", "BLUE", "WHITE", "NAVY", "INK"):
    globals()[_k] = _blockout[_k]

# Forms refinements of the blockout's measurements (world gate, side and front views).
HEAD_C = (HEAD_C[0], HEAD_C[1] - 0.01, HEAD_C[2])   # the face 1 cm further forward
LEG_X = 0.13                                         # the legs a little apart (a 9 cm gap at the knee)
FOOT_X = 0.14                                        # each shoe under its leg, not splayed out as the sheet draws them
SHOE_W = 0.23                                        # so the two shoes keep a 5 cm gap between them
EYE_SIZE = (0.027, 0.013, 0.05)                      # two sizes up: the sheet's eyes are its face's biggest feature
EYE_X = 0.079                                        # a little further apart, as they've grown

PHASE = "03_forms"
OWNER_TAG = "phase:" + PHASE
COLL = "HIGH"
SHOE_BLUE = (0.2, 0.45, 0.9, 1)


# ---- helpers ------------------------------------------------------------------------------------

def blob(name, c, r, rot=(0, 0, 0), u=24, v=14):
    """An ellipsoid, rotated, for building organic unions (hair locks, finger pads, cheeks)."""
    ob = sphere(name, 1.0, COLL, location=c, u=u, v=v, scale=r)
    ob.rotation_euler = rot
    return ob


def fuse(name, parts, voxel, mat, smooth=6):
    """Joins `parts` into one closed surface (voxel remesh) and smooths it; the parts are deleted."""
    bpy.context.view_layer.update()
    ob = join_meshes(name, parts, COLL)
    for p in parts:
        bpy.data.objects.remove(p, do_unlink=True)
    remesh_voxel(ob, voxel)
    if smooth:
        s = ob.modifiers.new("Smooth", "SMOOTH")
        s.iterations = smooth
        s.factor = 0.5
    apply_all_modifiers(ob)
    assign(ob, mat)
    shade_smooth(ob, math.radians(180))
    return ob


def sweep(name, points, radius, mat, segments=12, radii=None, cap=True):
    """A round tube along a polyline (brows, the mouth, piping, drawstrings, the hood's rim)."""
    pts = [Vector(p) for p in points]
    bm = bmesh.new()
    rings = []
    # Each ring's frame carried along from the last one (parallel transport), so the tube never twists
    # where it turns steep (choosing a fresh reference axis per ring flipped a sleeve's rings over).
    n = None
    prev_t = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if n is None:
            a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(a).normalized()
        else:
            n = (prev_t.rotation_difference(t) @ n).normalized()
        prev_t = t
        b = t.cross(n).normalized()
        r = radii[i] if radii else radius
        rings.append([bm.verts.new(p + (n * math.cos(k * math.tau / segments) + b * math.sin(k * math.tau / segments)) * r) for k in range(segments)])
    for ra, rb in zip(rings, rings[1:]):
        for k in range(segments):
            bm.faces.new((ra[k], ra[(k + 1) % segments], rb[(k + 1) % segments], rb[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_mesh_object(name, bm, COLL)
    assign(ob, mat)
    shade_smooth(ob, math.radians(70))
    return ob


def on_head(x, z, inset=0.0):
    cx, cy, cz = HEAD_C
    rx, ry, rz = HEAD_R
    k = 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2
    return (x, cy - ry * math.sqrt(max(0.0, k)) + inset, z)


def mirror_x(ob, name):
    """A mirrored copy across x = 0 (a real mirror: the thumb stays in front, not a rotated copy)."""
    me = ob.data.copy()
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    me.flip_normals()
    new = bpy.data.objects.new(name, me)
    col(COLL).objects.link(new)
    return own(new)


# ---- parts --------------------------------------------------------------------------------------

def head(skin):
    """A chibi head: wide at the cheeks, round chin, a flat-ish face and a tiny nose; ears with a bowl."""
    hd = sphere("_head", 1.0, COLL, location=HEAD_C, u=64, v=40, scale=HEAD_R)
    bpy.context.view_layer.update()
    cx, cy, cz = HEAD_C
    for s in (1, -1):
        push(hd, (cx + s * 0.15, cy - 0.1, CHIN_Z + 0.07), 0.14, 0.024)       # full cheeks (front view: the face widest at the mouth)
    for s in (1, -1):
        push(hd, (cx + s * 0.12, cy - 0.06, CHIN_Z + 0.04), 0.12, 0.018, direction=(s, -0.3, -0.5))  # a wide, soft jaw (the sheet's face is nearly as wide at the mouth as at the eyes)
    push(hd, (cx, cy - 0.16, CHIN_Z + 0.03), 0.14, 0.008, direction=(0, -0.6, -0.8))  # round chin, a little forward and down, broad
    push(hd, (cx, cy - 0.21, EYE_Z), 0.16, 0.012, direction=(0, 1, 0))       # a flatter face
    push(hd, (cx, cy - 0.205, 1.15), 0.035, 0.006, direction=(0, -1, 0))     # nose: barely a bump (the sheet draws none from the front)
    parts = [hd]
    for side, s in (("L", 1), ("R", -1)):
        ear = blob(f"_ear{side}", (s * (HEAD_R[0] + 0.004), cy + 0.03, EAR_Z), (0.03, 0.022, 0.054), rot=(0, 0, s * math.radians(-12)), u=20, v=12)  # small ears, close in (the sheet's half hidden by the hair)
        parts.append(ear)
    ob = fuse("CH_OfficeAvatar_Head_HIGH", parts, 0.004, skin, smooth=4)
    # The ear bowls, pressed in after the fuse.
    for s in (1, -1):
        push(ob, (s * (HEAD_R[0] + 0.022), cy + 0.025, EAR_Z), 0.022, 0.008, direction=(-s, 0, 0))
    return ob


def face(ink, white, brow_mat, mouth_mat):
    for side, s in (("L", 1), ("R", -1)):
        eye = blob(f"CH_OfficeAvatar_Eye_{side}_HIGH", on_head(s * EYE_X, EYE_Z, 0.006), EYE_SIZE, u=24, v=16)
        assign(eye, ink)
        shade_smooth(eye, math.radians(180))
        hl = blob(f"CH_OfficeAvatar_EyeHighlight_{side}_HIGH", on_head(s * EYE_X + 0.008, EYE_Z + 0.018, -0.007), (0.008, 0.005, 0.009), u=12, v=8)
        assign(hl, white)
        # A thick rounded brow, a gentle arch tilted down to the outside.
        # Thick and dark, as on the sheet: nearly straight, a soft arch, the inner end the fullest.
        pts = [on_head(s * (0.042 + 0.075 * t), BROW_Z - 0.012 + 0.01 * math.sin(math.pi * t) - 0.006 * t, -0.002) for t in [i / 8 for i in range(9)]]
        sweep(f"CH_OfficeAvatar_Brow_{side}_HIGH", pts, 0.015, brow_mat, radii=[0.011 + 0.007 * math.sin(math.pi * (0.35 + 0.65 * i / 8)) for i in range(9)])
    # A small closed smile.
    pts = [on_head(0.042 * (2 * t - 1), MOUTH_Z - 0.012 * math.sin(math.pi * t), -0.002) for t in [i / 10 for i in range(11)]]
    sweep("CH_OfficeAvatar_Mouth_HIGH", pts, 0.0065, mouth_mat)


def hair(mat):
    """Short wavy hair: a cap over the skull and the back of the head, chunky swept locks on top."""
    cx, cy, cz = HEAD_C
    cap = sphere("_cap", 1.0, COLL, location=(cx, cy + 0.005, cz + 0.005), u=48, v=32, scale=(HEAD_R[0] + 0.022, HEAD_R[1] + 0.022, HEAD_R[2] + 0.02))
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    m = cap.matrix_world
    # Off the face and below the hairline: the forehead from 1.33 up, the temples to the top of the ears, the nape at 1.03.
    kill = []
    for v in bm.verts:
        p = m @ v.co
        front = p.y < cy - 0.05
        side = abs(p.x) > 0.11 and p.y < cy + 0.11
        if (front and p.z < 1.335 and abs(p.x) < 0.17) or (side and p.z < 1.23) or (p.z < 1.2 and p.y < cy + 0.02) or p.z < 1.05:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(cap.data)
    bm.free()
    solidify(cap, 0.022, offset=1.0)
    apply_all_modifiers(cap)
    parts = [cap]
    # Locks: (centre, radii, rotation), read off the front, side and back views.
    locks = [
        # the front swoop: two big rolls sweeping from the parting over the forehead, out to either side
        ((-0.06, cy - 0.17, 1.43), (0.13, 0.075, 0.066), (math.radians(-20), 0, math.radians(15))),
        ((0.085, cy - 0.16, 1.45), (0.13, 0.075, 0.066), (math.radians(-20), 0, math.radians(-20))),
        ((-0.155, cy - 0.1, 1.37), (0.055, 0.07, 0.07), (0, 0, 0)),
        ((0.155, cy - 0.09, 1.38), (0.055, 0.07, 0.07), (0, 0, 0)),
        # the crown: piled-up waves (the side view's tallest point a little ahead of the middle)
        ((-0.03, cy - 0.08, 1.485), (0.09, 0.07, 0.055), (math.radians(10), 0, math.radians(25))),
        ((0.06, cy - 0.01, 1.48), (0.09, 0.075, 0.055), (math.radians(-10), 0, math.radians(-30))),
        ((-0.08, cy + 0.05, 1.46), (0.09, 0.07, 0.055), (0, math.radians(20), 0)),
        ((0.03, cy + 0.09, 1.44), (0.1, 0.08, 0.06), (math.radians(30), 0, 0)),
        # the sides over the temples, down to the ears
        ((-0.19, cy + 0.0, 1.29), (0.04, 0.09, 0.085), (0, 0, 0)),
        ((0.19, cy + 0.0, 1.29), (0.04, 0.09, 0.085), (0, 0, 0)),
        # the back: rounded clumps down to the nape
        ((0.0, cy + 0.14, 1.16), (0.12, 0.05, 0.08), (0, 0, 0)),  # the nape, clear of the hood
    ]
    # The back: rows of rounded curls down to the nape (the back view's swirl of locks).
    # The back: chunky locks that start at the crown and sweep down and round to the nape, alternately to
    # either side (the back view's swirl), each a tapering tube lying on the scalp, fuller in the middle.
    def on_scalp(phi, z, off):
        k = math.sqrt(max(0.02, 1 - ((z - cz) / (HEAD_R[2] + off)) ** 2))
        return (cx + (HEAD_R[0] + off) * math.sin(phi) * k, cy + (HEAD_R[1] + off) * math.cos(phi) * k, z)
    curls = []
    for phi0, dphi, z1 in ((-0.95, -0.35, 1.13), (-0.55, 0.3, 1.08), (-0.18, -0.3, 1.06), (0.18, 0.3, 1.06), (0.55, -0.3, 1.08), (0.95, 0.35, 1.13), (0.0, 0.25, 1.2)):
        pts = []
        for i in range(11):
            t = i / 10
            pts.append(on_scalp(phi0 + dphi * t * t, 1.47 - (1.47 - z1) * t, 0.012 + 0.02 * math.sin(math.pi * t)))
        curls.append(sweep(f"_curl{len(curls)}", pts, 0.04, mat, segments=16, radii=[0.035 + 0.012 * math.sin(math.pi * min(1, i / 6)) - 0.03 * max(0, i - 6) / 4 for i in range(11)]))
    # The fringe: rounded locks hanging over the hairline at uneven heights, so its edge waves
    # (front view: the forehead shows between the brows and the locks, more of it on the right).
    # Three big smooth locks (the sheet's fringe is a few broad swept waves, not many small curls).
    for x, zb, tilt in ((-0.11, 1.35, 20), (-0.005, 1.345, -8), (0.105, 1.37, -28)):
        fy = on_head(x, zb + 0.05)[1] - 0.026
        locks.append(((x, fy, zb + 0.05), (0.075, 0.045, 0.058), (math.radians(-30), 0, math.radians(tilt))))
    for i, (c, r, rot) in enumerate(locks):
        parts.append(blob(f"_lock{i}", c, r, rot))
    parts += curls
    return fuse("CH_OfficeAvatar_Hair_HIGH", parts, 0.006, mat, smooth=12)


def hand(side, s, skin):
    """A relaxed fist hanging at the side, as on the sheet: a smooth round fist growing straight out of the
    sleeve's cuff (the wrist where the hand bone starts), the fingers curled under it showing only as soft
    knuckles, the thumb lying along the front."""
    # Built for the left hand (+X) from the wrist, where the sleeve ends; the right one is its mirror.
    W = Vector((0.268, -0.03, 0.6))
    parts = [
        blob("_wrist", W + Vector((0.0, 0.0, -0.012)), (0.034, 0.036, 0.03)),
        blob("_core", W + Vector((0.012, -0.006, -0.066)), (0.05, 0.058, 0.058)),
    ]
    for i, fy in enumerate((-0.04, -0.014, 0.012, 0.037)):
        parts.append(blob(f"_f{i}", W + Vector((-0.004, fy - 0.006, -0.108 + 0.004 * abs(fy) / 0.04)), (0.026, 0.018, 0.026)))
    parts.append(blob("_thumb", W + Vector((-0.028, -0.052, -0.068)), (0.019, 0.021, 0.034), rot=(math.radians(20), 0, math.radians(-15))))
    bpy.context.view_layer.update()
    for p in parts:   # two sizes up (the sheet's fists are nearly as wide as its face is tall), about the wrist
        p.location = W + (p.location - W) * 1.3
        p.scale = p.scale * 1.3
    return fuse("CH_OfficeAvatar_Hand_L_HIGH", parts, 0.0035, skin, smooth=12)


def body(skin):
    """The body under the clothing: a smooth mannequin with the joints where the rig bends."""
    ob = skin_chain(
        "_body",
        {
            "spine": [(0, 0, CROTCH_Z + 0.02, 0.115), (0, 0, 0.65, 0.12), (0, 0, 0.82, 0.13), (0, 0, 0.9, 0.095), (0, 0, 0.97, 0.05), (0, 0, CHIN_Z + 0.03, 0.045)],
            "arm_L": [(0, 0, 0.9, 0.095), (0.155, 0, 0.885, 0.05), (0.23, -0.01, 0.73, 0.047), (0.262, -0.03, 0.59, 0.039)],
            "arm_R": [(0, 0, 0.9, 0.095), (-0.155, 0, 0.885, 0.05), (-0.23, -0.01, 0.73, 0.047), (-0.262, -0.03, 0.59, 0.039)],
            "leg_L": [(0, 0, CROTCH_Z + 0.02, 0.115), (0.09, -0.01, 0.47, 0.075), (LEG_X, -0.015, 0.3, 0.06), (LEG_X, -0.015, ANKLE_Z, 0.045)],
            "leg_R": [(0, 0, CROTCH_Z + 0.02, 0.115), (-0.09, -0.01, 0.47, 0.075), (-LEG_X, -0.015, 0.3, 0.06), (-LEG_X, -0.015, ANKLE_Z, 0.045)],
        },
        collection=COLL,
        subdiv=2,
    )
    apply_all_modifiers(ob)
    ob.name = ob.data.name = "CH_OfficeAvatar_Body_HIGH"
    assign(ob, skin)
    shade_smooth(ob, math.radians(180))
    return ob


def tee(white):
    """The tee as one piece of cloth (as the tops are, see garment()): the body, short sleeves to the
    middle of the upper arm and the crew neck's rib, 1.2 cm thick, open at the neck, sleeves and hem."""
    body = loft("_teebody", collection=COLL, sections=[[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 32 for i in range(32)]] for z, rx, ry in (
        (HEM_Z + 0.015, 0.18, 0.13), (0.7, 0.18, 0.13), (0.85, 0.175, 0.13), (0.91, 0.112, 0.092), (0.955, 0.07, 0.065))])  # the neck shows above it, inside the tops' shoulders
    parts = [body, sweep("_teecollar", [(0.072 * math.cos(a), 0.067 * math.sin(a) - 0.01, 0.956) for a in [i * math.tau / 24 for i in range(25)]], 0.012, white, cap=False)]
    cutters = [cutter_tube("_cut_neck", (0, -0.01, 0.9), (0, -0.01, 1.1), 0.06), cutter_box("_cut_hem", (-0.6, -0.6, -0.5), (0.6, 0.6, HEM_Z + 0.018))]
    # Short sleeves of their own (like the tops', see sleeve()): fused to the body they'd stay behind
    # when the arm rises and stick out under a top's sleeve.
    # (Each sleeve fused with its shoulder, rooted deep in the body, like the tops' sleeves: see sleeve().)
    tee_path = lambda s: [Vector((s * 0.06, 0.0, 0.86)), Vector((s * 0.12, 0.0, 0.885)), Vector((s * 0.18, -0.003, 0.83)), Vector((s * 0.205, -0.007, 0.77))]
    for side, s in (("L", 1), ("R", -1)):
        sleeve(f"CH_OfficeAvatar_TeeSleeve_{side}_HIGH", s, white, [0.064, 0.062, 0.06, 0.058], 0.058, thick=0.01, shoulder=(0.072, 0.084, 0.064),
               path=tee_path, cuff_thick=0.008, shoulder_at=(0.145, 0.0, 0.865))
    hem = [(0.182 * math.cos(a), 0.132 * math.sin(a) - 0.01, HEM_Z + 0.02) for a in [i * math.tau / 40 for i in range(41)]]
    parts.append(sweep("_teehem", hem, 0.009, white, cap=False))
    return garment("CH_OfficeAvatar_Tee_HIGH", parts, white, 0.012, cutters, outer_tris=1100, smooth=6)


GAP = 0.07  # half the hoodie's open front at the chest (front view: the tee shows 44 px wide)


def garment(name, parts, mat, thickness, cutters, voxel=0.006, smooth=6, outer_tris=1700):
    """One piece of clothing as a single continuous surface: the parts fused into one smooth volume,
    hollowed to the fabric's thickness, then opened where the cutters are (the front, the neck, the
    cuffs, the hem): every face inside one goes (an exact test, where a boolean on a mesh this dense
    can fail without a word). The rolled edges sit over the openings' edges. The outer surface is brought
    down to `outer_tris` before it's given its thickness, so the cloth's two sides stay parallel (reducing
    a thin double wall afterwards collapses one side into the other)."""
    ob = fuse(name, parts, voxel, mat, smooth)
    have = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if have > outer_tris:
        d = ob.modifiers.new("Decimate", "DECIMATE")
        d.ratio = outer_tris / have
        apply_all_modifiers(ob)
    solidify(ob, thickness, offset=-1.0)
    apply_all_modifiers(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    gone = [f for f in bm.faces if any(c(f.calc_center_median()) for c in cutters)]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # The cut's edge, which follows the faces in steps, laid onto the cutter's own surface: a straight,
    # clean edge (a hem, an opening's edge, a cuff), not a staircase.
    for v in bm.verts:
        if v.is_boundary:
            for c in cutters:
                q = c.snap(v.co)
                if q is not None:
                    v.co = q
                    break
    bm.to_mesh(ob.data)
    bm.free()
    assign(ob, mat)
    shade_smooth(ob, math.radians(180))
    return ob


class Cutter:
    def __init__(self, inside, snap):
        self.inside, self.snap = inside, snap

    def __call__(self, p):
        return self.inside(p)


def cutter_box(name, lo, hi, reach=0.02):
    """A test for points inside the box lo..hi, and a snap that lays a point within `reach` of one of its
    faces (and over that face) onto it."""
    def snap(p):
        best = None
        for k in range(3):
            for plane in (lo[k], hi[k]):
                d = abs(p[k] - plane)
                if d < reach and all(lo[j] - reach <= p[j] <= hi[j] + reach for j in range(3) if j != k) and (best is None or d < best[0]):
                    best = (d, k, plane)
        if best is None:
            return None
        q = Vector(p)
        q[best[1]] = best[2]
        return q
    return Cutter(lambda p: all(l <= v <= h for l, v, h in zip(lo, p, hi)), snap)


def cutter_tube(name, a, b, r):
    """A test for points inside the round tube from a to b, radius r."""
    a, b = Vector(a), Vector(b)
    d = b - a
    def inside(p):
        t = (p - a).dot(d) / d.length_squared
        return 0 <= t <= 1 and (p - (a + d * t)).length <= r
    def snap(p, reach=0.02):
        t = (p - a).dot(d) / d.length_squared
        c = a + d * t
        off = p - c
        if -0.1 <= t <= 1.1 and abs(off.length - r) < reach and off.length > 1e-6:
            return c + off.normalized() * r
        return None
    return Cutter(inside, snap)


def sleeve(name, s, mat, radii, cuff_r, thick=0.016, shoulder=(0.075, 0.09, 0.07), path=None, cuff_thick=0.017, shoulder_at=(0.155, -0.002, 0.875)):
    """A sleeve of its own (not fused to the garment's body: in the A-pose it hangs against the side, and
    fused there it would stretch into a web when the arm's raised): the rounded shoulder and a puffy tube
    from deep inside the body to the cuff, fused into one smooth surface (a shoulder that was the body's
    and a sleeve pushed into it met in a ragged seam), hollowed to the cloth's thickness and open at the
    cuff, and its rolled cuff. Returns both."""
    sl = path(s) if path else SLEEVE(s)
    tube = sweep("_tube", sl, 0.08, mat, segments=24, radii=radii)
    cap = blob("_shoulder", (s * shoulder_at[0], shoulder_at[1], shoulder_at[2]), shoulder)
    end, axis = sl[-1], (sl[-1] - sl[-2]).normalized()
    cut = cutter_tube("_cut_cuff", end - axis * 0.03, end + axis * 0.06, cuff_r - 0.012)
    body = garment(name, [tube, cap], mat, thick, [cut], voxel=0.005, outer_tris=900)
    n = axis.cross(Vector((0, 1, 0))).normalized()
    b2 = axis.cross(n).normalized()
    ring = [end - axis * 0.004 + (n * math.cos(a) + b2 * math.sin(a)) * cuff_r for a in [i * math.tau / 24 for i in range(25)]]
    cuff = sweep(name.replace("Sleeve", "Cuff"), ring, cuff_thick, mat, cap=False)
    return body, cuff


def onto(shell, pts, lift=0.004):
    """Each point moved onto `shell`'s front surface (a ray from in front, straight back), `lift` off it."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    bmesh.ops.transform(bm, matrix=shell.matrix_world, verts=bm.verts)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    out = []
    for p in pts:
        hit = tree.ray_cast(Vector((p[0], -1.0, p[2])), Vector((0, 1, 0)))[0]
        out.append(tuple(hit - Vector((0, lift, 0))) if hit else tuple(p))
    return out


# Rooted deep inside the body (from 7 cm off the middle), so as the arm rises the sleeve stretches over the
# armpit like a shoulder instead of opening a gap there.
SLEEVE = lambda s: [Vector((s * 0.07, 0.0, 0.875)), Vector((s * 0.13, 0.0, 0.9)), Vector((s * 0.215, -0.005, 0.8)), Vector((s * 0.248, -0.012, 0.7)), Vector((s * 0.262, -0.018, 0.64)), Vector((s * 0.27, -0.024, 0.6))]


def hoodie(blue, white):
    """The open hoodie as one piece of cloth: the body, the rounded shoulders, puffy sleeves gathered into
    rolled cuffs, the rolled hem, the hood on the back and its thick rim from behind the neck down both
    front edges, all one surface, 2 cm thick; open at the front, the neck, the cuffs and the hem. The white
    piping along the opening and the drawstrings are their own small pieces."""
    parts = []
    body = loft("_hbody", [[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 40 for i in range(40)]] for z, rx, ry in (
        (HEM_Z - 0.005, 0.208, 0.15), (0.66, 0.205, 0.152), (0.82, 0.205, 0.158), (0.885, 0.178, 0.142), (0.935, 0.13, 0.108), (0.96, 0.098, 0.085))], COLL)
    parts.append(body)
    hem = [(0.212 * math.cos(a), 0.155 * math.sin(a) - 0.01, HEM_Z + 0.014) for a in [i * math.tau / 40 for i in range(41)]]
    parts.append(sweep("_hhem", hem, 0.017, blue, cap=False))
    parts.append(blob("_hood", (0.0, 0.125, 0.93), (0.155, 0.08, 0.1), rot=(math.radians(-10), 0, 0)))
    # The hood bunched round the back and sides of the neck, up to the chin (the sheet shows no neck).
    collar = [(0.108 * math.sin(a), -0.005 + 0.1 * math.cos(a), 0.975 + 0.012 * math.cos(a)) for a in [math.radians(d) for d in range(-120, 121, 15)]]
    parts.append(sweep("_hcollar", collar, 0.032, blue, radii=[0.022, 0.026] + [0.032] * 13 + [0.026, 0.022]))
    cutters = [cutter_box("_cut_front", (-(GAP + 0.002), -0.4, HEM_Z - 0.1), (GAP + 0.002, -0.07, 1.02)),
               cutter_tube("_cut_neck", (0, -0.005, 0.9), (0, -0.005, 1.12), 0.078),
               cutter_box("_cut_hem", (-0.6, -0.6, -0.5), (0.6, 0.6, HEM_Z - 0.002))]
    for side, s in (("L", 1), ("R", -1)):
        # Puffy to the forearm, then gathered into the cuff (front view: the cuff narrower than the sleeve).
        sleeve(f"CH_OfficeAvatar_HoodieSleeve_{side}_HIGH", s, blue, [0.075, 0.072, 0.08, 0.086, 0.078, 0.058], 0.052)
        # The hood's rim: from behind the neck, over the shoulder and down the front edge to the hem.
        # Over the shoulder it lies on the cloth, a flatter roll (seen from above, as the scale-model camera
        # does, a round one stood up off the shoulder like a bar).
        rim = [(s * (0.075 + 0.035 * t), 0.06 - 0.21 * t, 0.945 - 0.035 * t) for t in [i / 6 for i in range(7)]]
        rim += [(s * (GAP + 0.025), -0.152, z) for z in (0.9, 0.85, 0.8, 0.75, 0.7, 0.65, HEM_Z + 0.02)]
        parts.append(sweep(f"_rim{side}", rim, 0.022, blue, radii=[0.014] * 7 + [0.018, 0.021] + [0.022] * 5))
    shell = garment("CH_OfficeAvatar_Hoodie_HIGH", parts, blue, 0.018, cutters)
    for side, s in (("L", 1), ("R", -1)):
        # The trims on the cloth itself (straight lines in space would stand off it where it curves).
        sweep(f"CH_OfficeAvatar_Piping_{side}_HIGH", onto(shell, [(s * (GAP + 0.013), 0, z) for z in (0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6, HEM_Z + 0.01)], 0.006), 0.006, white)
        string = onto(shell, [(s * 0.062, 0, z) for z in (0.925, 0.86, 0.8)], 0.008)
        sweep(f"CH_OfficeAvatar_Drawstring_{side}_HIGH", string, 0.0055, white)
        assign(blob(f"CH_OfficeAvatar_Aglet_{side}_HIGH", (string[-1][0], string[-1][1], string[-1][2] - 0.01), (0.008, 0.008, 0.016)), white)
    return shell


def trousers(navy):
    """The trousers as one piece: a waist and seat that run smoothly into two straight legs (no seam at
    the crotch), resting on the shoes at the hem."""
    parts = [loft("_waist", [[(rx * math.cos(a), ry * math.sin(a) - 0.012, z) for a in [i * math.tau / 36 for i in range(36)]] for z, rx, ry in (
        (0.44, 0.17, 0.125), (0.5, 0.19, 0.13), (0.6, 0.175, 0.125))], COLL)]
    parts.append(blob("_crotch", (0.0, -0.012, 0.45), (0.085, 0.115, 0.065)))
    # The seat: rounded glutes at the back.
    for gs in (1, -1):
        parts.append(blob(f"_glute{gs}", (gs * 0.075, 0.06, 0.49), (0.1, 0.085, 0.095)))
    for side, s in (("L", 1), ("R", -1)):
        secs = []
        for z, r, dx in ((0.52, 0.09, -0.03), (0.45, 0.092, -0.01), (0.33, 0.088, 0.0), (0.22, 0.085, 0.0), (ANKLE_Z, 0.086, 0.0), (ANKLE_Z - 0.03, 0.086, 0.0)):
            secs.append([(s * (LEG_X + dx) + r * math.cos(a), -0.015 + 1.12 * r * math.sin(a), z) for a in [i * math.tau / 28 for i in range(28)]])
        parts.append(loft(f"_leg{side}", secs, COLL))
    return fuse("CH_OfficeAvatar_Trousers_HIGH", parts, 0.006, navy, smooth=6)


def ribbon(name, pts, width, thick, mat, out):
    """A flat strap along `pts`, `width` across (along `out` x the path) and `thick` deep."""
    secs = []
    P = [Vector(p) for p in pts]
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        n = out(p)                                   # the strap's outward normal here
        w = t.cross(n).normalized() * (width / 2)
        h = n * (thick / 2)
        secs.append([p - w - h, p + w - h, p + w + h, p - w + h])
    ob = loft(name, secs, COLL)
    assign(ob, mat)
    return ob


def sneaker(side, s, white, blue):
    """A chunky sneaker as on the sheet: a thick white sole with a blue line round its bottom edge, a padded
    upper with a rounded rubber toe cap and a padded collar round the ankle (one smooth piece), two wide
    straps across the instep, and the blue mark sweeping along the outer side."""
    x0 = s * FOOT_X
    L, W = SHOE_LEN * 0.95, SHOE_W   # side view: the heel 2 cm shorter than the blockout's box
    y_toe, y_heel = SHOE_FRONT, SHOE_FRONT + L
    def foot(w, l, n=48):
        pts = []
        for i in range(n):
            a = math.tau * i / n
            x = 0.5 * w * math.cos(a)
            y = 0.5 * l * math.sin(a)
            pts.append((math.copysign(abs(x) ** 0.8 * (0.5 * w) ** 0.2, x), math.copysign(abs(y) ** 0.85 * (0.5 * l) ** 0.15, y)))
        return pts
    SOLE = 0.055
    sole = profile_extrude(f"CH_OfficeAvatar_Sole_{side}_HIGH", foot(W, L), SOLE, COLL, location=(x0, (y_toe + y_heel) / 2, 0))
    bevel(sole, 0.02, 4, 40, False)
    apply_all_modifiers(sole)
    assign(sole, white)
    shade_smooth(sole, math.radians(50))
    stripe = profile_extrude(f"CH_OfficeAvatar_SoleStripe_{side}_HIGH", foot(W + 0.006, L + 0.006), 0.013, COLL, location=(x0, (y_toe + y_heel) / 2, 0.0))
    bevel(stripe, 0.005, 2, 40, False)
    apply_all_modifiers(stripe)
    assign(stripe, blue)
    # Upper: the arch over the foot from the toe box to the heel, a rubber toe cap and the padded collar, fused.
    secs = []
    for t, h, w in ((0.04, 0.03, 0.13), (0.12, 0.065, 0.2), (0.26, 0.09, 0.215), (0.45, 0.12, 0.215), (0.62, 0.135, 0.205), (0.8, 0.13, 0.195), (0.93, 0.115, 0.165), (0.975, 0.08, 0.1)):
        y = y_toe + L * t
        secs.append([(x0 + 0.5 * w * math.cos(math.pi * i / 23), y, SOLE - 0.01 + h * math.sin(math.pi * i / 23) ** 0.7) for i in range(24)])
    parts = [loft("_upper", secs, COLL, close_sections=True)]
    parts.append(blob("_toecap", (x0, y_toe + 0.065, SOLE + 0.012), (0.5 * W - 0.012, 0.07, 0.035)))
    collar_c = Vector((x0, y_toe + L * 0.76, SOLE + 0.105))
    parts.append(sweep("_collar", [collar_c + Vector((0.062 * math.cos(a), 0.068 * math.sin(a), 0.01 * math.sin(a))) for a in [k * math.tau / 24 for k in range(25)]], 0.016, white, cap=False))
    up = fuse(f"CH_OfficeAvatar_Upper_{side}_HIGH", parts, 0.004, white, smooth=6)
    # Two wide straps across the instep, over the upper.
    cx_arch = lambda y: Vector((x0, y, SOLE - 0.01))
    for k, t in enumerate((0.43, 0.57)):
        y = y_toe + L * t
        h = 0.12 + 0.015 * (t - 0.43) / 0.14
        arch = [(x0 + (0.5 * 0.212) * math.cos(math.pi * i / 12), y, SOLE - 0.01 + (h + 0.008) * math.sin(math.pi * i / 12) ** 0.7) for i in range(13)]
        ribbon(f"CH_OfficeAvatar_Strap{k}_{side}_HIGH", arch, 0.038, 0.012, white, lambda p, y=y: (Vector(p) - Vector((x0, y, SOLE - 0.01))).normalized())
    # The blue mark: a soft zigzag sweeping back along the outer side.
    side_x = x0 + s * (0.5 * 0.213 + 0.002)
    # A flat band lying on the upper (not a tube stood off it): the sheet's zigzag, seen from the front too.
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(up.data)
    bmesh.ops.transform(bm, matrix=up.matrix_world, verts=bm.verts)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    mark, normals = [], {}
    keys = ((0.26, 0.078), (0.38, 0.082), (0.46, 0.128), (0.56, 0.088), (0.66, 0.132), (0.74, 0.138))
    # Each leg of the zigzag straight, in short steps (so the band follows the upper's curve without twisting).
    path = [(f0 + (f1 - f0) * k / 4, z0 + (z1 - z0) * k / 4) for (f0, z0), (f1, z1) in zip(keys, keys[1:]) for k in range(4)] + [keys[-1]]
    for f, z in path:
        # Onto the upper's outer side, a ray in from beside the shoe.
        hit, n, _, _ = tree.ray_cast(Vector((x0 + s * 0.4, y_toe + L * f, z)), Vector((-s, 0, 0)))
        p = (hit + n * 0.005) if hit else Vector((side_x, y_toe + L * f, z))
        mark.append(tuple(p))
        normals[tuple(p)] = n if hit else Vector((s, 0, 0))
    ribbon(f"CH_OfficeAvatar_ShoeMark_{side}_HIGH", mark, 0.034, 0.006, blue, lambda p: min(normals.items(), key=lambda kv: (Vector(kv[0]) - Vector(p)).length)[1])


def build(scene, args):
    skin = material("M_Skin", SKIN, 0.7)
    hair_m = material("M_Hair", HAIR, 0.55)
    blue = material("M_PrimaryClothing", BLUE, 0.85)
    white = material("M_SecondaryClothing", WHITE, 0.85)
    navy = material("M_Pants", NAVY, 0.8)
    shoes = material("M_Shoes", WHITE, 0.45)
    shoe_blue = material("M_ShoesAccent", SHOE_BLUE, 0.5)
    ink = material("M_Eyes", INK, 0.2)
    eye_white = material("M_EyeHighlight", (1, 1, 1, 1), 0.2)
    mouth = material("M_Mouth", (0.45, 0.13, 0.1, 1), 0.4)

    body(skin)
    head(skin)
    face(ink, eye_white, hair_m, mouth)
    hair(hair_m)
    left = hand("L", 1, skin)
    mirror_x(left, "CH_OfficeAvatar_Hand_R_HIGH")
    tee(white)
    hoodie(blue, white)
    trousers(navy)
    for side, s in (("L", 1), ("R", -1)):
        sneaker(side, s, shoes, shoe_blue)
    # The blockout steps aside: its silhouette was approved, the forms replace it.
    for ob in col("LOW").objects:
        ob.hide_render = True
        ob.hide_viewport = True
    log("forms built")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    clear_owned()
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
