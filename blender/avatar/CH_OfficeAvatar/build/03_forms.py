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
LEG_X = 0.125                                        # the gap between the legs 8 cm at the knee
EYE_SIZE = (0.022, 0.012, 0.04)                      # a size up: the sheet's eyes read bigger than 22 px at the game camera

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
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        n = t.cross(a).normalized()
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
    push(hd, (cx, cy - 0.16, CHIN_Z + 0.03), 0.12, 0.012, direction=(0, -0.6, -0.8))  # round chin, a little forward and down
    push(hd, (cx, cy - 0.21, EYE_Z), 0.16, 0.012, direction=(0, 1, 0))       # a flatter face
    push(hd, (cx, cy - 0.205, 1.15), 0.035, 0.012, direction=(0, -1, 0))     # nose (side view: a small bump)
    parts = [hd]
    for side, s in (("L", 1), ("R", -1)):
        ear = blob(f"_ear{side}", (s * (HEAD_R[0] + 0.016), cy + 0.03, EAR_Z), (0.04, 0.028, 0.072), rot=(0, 0, s * math.radians(-15)), u=20, v=12)
        parts.append(ear)
    ob = fuse("CH_OfficeAvatar_Head_HIGH", parts, 0.004, skin, smooth=4)
    # The ear bowls, pressed in after the fuse.
    for s in (1, -1):
        push(ob, (s * (HEAD_R[0] + 0.035), cy + 0.025, EAR_Z), 0.03, 0.012, direction=(-s, 0, 0))
    return ob


def face(ink, white, brow_mat, mouth_mat):
    for side, s in (("L", 1), ("R", -1)):
        eye = blob(f"CH_OfficeAvatar_Eye_{side}_HIGH", on_head(s * EYE_X, EYE_Z, 0.006), EYE_SIZE, u=24, v=16)
        assign(eye, ink)
        shade_smooth(eye, math.radians(180))
        hl = blob(f"CH_OfficeAvatar_EyeHighlight_{side}_HIGH", on_head(s * EYE_X + 0.006, EYE_Z + 0.014, -0.006), (0.006, 0.004, 0.007), u=12, v=8)
        assign(hl, white)
        # A thick rounded brow, a gentle arch tilted down to the outside.
        pts = [on_head(s * (0.045 + 0.06 * t), BROW_Z + 0.012 * math.sin(math.pi * t) - 0.008 * t, -0.002) for t in [i / 8 for i in range(9)]]
        sweep(f"CH_OfficeAvatar_Brow_{side}_HIGH", pts, 0.011, brow_mat, radii=[0.008 + 0.005 * math.sin(math.pi * i / 8) for i in range(9)])
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
        ((-0.07, cy - 0.18, 1.42), (0.11, 0.065, 0.06), (math.radians(-20), 0, math.radians(15))),
        ((0.08, cy - 0.17, 1.44), (0.11, 0.065, 0.06), (math.radians(-20), 0, math.radians(-20))),
        ((-0.17, cy - 0.11, 1.36), (0.065, 0.075, 0.075), (0, 0, 0)),
        ((0.17, cy - 0.1, 1.37), (0.065, 0.075, 0.075), (0, 0, 0)),
        # the crown: piled-up waves (the side view's tallest point a little ahead of the middle)
        ((-0.03, cy - 0.08, 1.485), (0.09, 0.07, 0.055), (math.radians(10), 0, math.radians(25))),
        ((0.06, cy - 0.01, 1.48), (0.09, 0.075, 0.055), (math.radians(-10), 0, math.radians(-30))),
        ((-0.08, cy + 0.05, 1.46), (0.09, 0.07, 0.055), (0, math.radians(20), 0)),
        ((0.03, cy + 0.09, 1.44), (0.1, 0.08, 0.06), (math.radians(30), 0, 0)),
        # the sides over the temples, down to the ears
        ((-0.195, cy + 0.0, 1.29), (0.05, 0.09, 0.085), (0, 0, 0)),
        ((0.195, cy + 0.0, 1.29), (0.05, 0.09, 0.085), (0, 0, 0)),
        # the back: rounded clumps down to the nape
        ((-0.09, cy + 0.15, 1.3), (0.09, 0.055, 0.1), (0, 0, math.radians(10))),
        ((0.09, cy + 0.15, 1.3), (0.09, 0.055, 0.1), (0, 0, math.radians(-10))),
        ((0.0, cy + 0.14, 1.16), (0.12, 0.05, 0.08), (0, 0, 0)),  # the nape, clear of the hood
    ]
    # The fringe: rounded locks hanging over the hairline at uneven heights, so its edge waves
    # (front view: the forehead shows between the brows and the locks, more of it on the right).
    for x, zb, tilt in ((-0.14, 1.33, 25), (-0.075, 1.315, 10), (-0.005, 1.325, -5), (0.065, 1.345, -20), (0.13, 1.36, -30)):
        fy = on_head(x, zb + 0.045)[1] - 0.022
        locks.append(((x, fy, zb + 0.045), (0.05, 0.04, 0.05), (math.radians(-30), 0, math.radians(tilt))))
    for i, (c, r, rot) in enumerate(locks):
        parts.append(blob(f"_lock{i}", c, r, rot))
    return fuse("CH_OfficeAvatar_Hair_HIGH", parts, 0.005, mat, smooth=3)


def hand(side, s, skin):
    """A relaxed fist hanging at the side: palm toward the leg, fingers curled under, the thumb in front."""
    # Built for the left hand (+X) in a frame at the wrist; the right one is its mirror.
    wx, wy, wz = FIST_X + 0.012, -0.07, FIST_C_Z + 0.055
    parts = [
        blob("_palm", (wx + 0.005, wy, wz - 0.06), (0.045, 0.062, 0.058)),
        blob("_back", (wx + 0.02, wy + 0.005, wz - 0.055), (0.035, 0.058, 0.055)),
    ]
    for i, fy in enumerate((-0.042, -0.014, 0.014, 0.04)):
        parts.append(blob(f"_f{i}", (wx - 0.012, wy + fy, wz - 0.125 + 0.006 * abs(fy) / 0.04), (0.03, 0.017, 0.03)))
    parts.append(blob("_thumb", (wx - 0.03, wy - 0.06, wz - 0.07), (0.022, 0.024, 0.04), rot=(math.radians(25), 0, math.radians(-20))))
    parts.append(blob("_wrist", (wx + 0.005, wy + 0.0, wz - 0.005), (0.035, 0.042, 0.03)))
    bpy.context.view_layer.update()
    for p in parts:   # the fist a size up (front view: 0.16 m across), about the wrist
        p.location = Vector((wx, wy, wz)) + (p.location - Vector((wx, wy, wz))) * 1.12
        p.scale = p.scale * 1.12
    ob = fuse("CH_OfficeAvatar_Hand_L_HIGH", parts, 0.0035, skin, smooth=6)
    return ob


def body(skin):
    """The body under the clothing: a smooth mannequin with the joints where the rig bends."""
    ob = skin_chain(
        "_body",
        {
            "spine": [(0, 0, CROTCH_Z + 0.02, 0.115), (0, 0, 0.65, 0.12), (0, 0, 0.82, 0.13), (0, 0, 0.9, 0.105), (0, 0, 0.97, 0.05), (0, 0, CHIN_Z + 0.03, 0.045)],
            "arm_L": [(0, 0, 0.9, 0.105), (0.16, 0, 0.9, 0.05), (0.23, -0.01, 0.73, 0.042), (0.262, -0.03, 0.59, 0.033)],
            "arm_R": [(0, 0, 0.9, 0.105), (-0.16, 0, 0.9, 0.05), (-0.23, -0.01, 0.73, 0.042), (-0.262, -0.03, 0.59, 0.033)],
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
    ob = loft("CH_OfficeAvatar_Tee_HIGH", collection=COLL, sections=[[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 32 for i in range(32)]] for z, rx, ry in (
        (HEM_Z + 0.02, 0.18, 0.13), (0.7, 0.18, 0.13), (0.85, 0.175, 0.13), (0.93, 0.13, 0.1), (0.975, 0.07, 0.065))])
    assign(ob, white)
    # Short sleeves to the middle of the upper arm (inside a top's sleeves when one's worn).
    for side, s in (("L", 1), ("R", -1)):
        sweep(f"CH_OfficeAvatar_TeeSleeve_{side}_HIGH", [(s * 0.13, 0.0, 0.915), (s * 0.175, -0.003, 0.86), (s * 0.205, -0.007, 0.79)], 0.055, white, segments=20, radii=[0.06, 0.056, 0.052])
    # The crew neck's rib.
    sweep("CH_OfficeAvatar_TeeCollar_HIGH", [(0.072 * math.cos(a), 0.067 * math.sin(a) - 0.01, 0.972) for a in [i * math.tau / 24 for i in range(25)]], 0.012, white, cap=False)
    return ob


GAP = 0.07  # half the hoodie's open front at the chest (front view: the tee shows 44 px wide)


def hoodie(blue, white):
    """The open hoodie: the body as an open shell, the hood on the back with its rim round the neck and
    down the front edges, puffy sleeves with cuffs, the hem band, the white piping and the drawstrings."""
    def arc(z, rx, ry, gap, dy=-0.01, n=40):
        # From the left front edge round the back to the right front edge (the front stays open).
        a0 = math.asin(min(0.99, gap / rx))
        pts = []
        for i in range(n + 1):
            a = -math.pi / 2 + a0 + (math.tau - 2 * a0) * i / n
            pts.append((rx * math.cos(a), ry * math.sin(a) + dy, z))
        return pts
    stations = ((HEM_Z, 0.21, 0.14, GAP), (0.66, 0.205, 0.15, GAP), (0.82, 0.205, 0.16, GAP + 0.005), (0.9, 0.17, 0.135, GAP + 0.01), (0.955, 0.11, 0.095, GAP - 0.005))
    shell = loft("CH_OfficeAvatar_Hoodie_HIGH", [arc(z, rx, ry, g) for z, rx, ry, g in stations], COLL, close_sections=False, cap_ends=False)
    solidify(shell, 0.022, offset=1.0)
    apply_all_modifiers(shell)
    assign(shell, blue)
    shade_smooth(shell, math.radians(60))
    # Hem band: a thicker rib round the bottom.
    # Hem band: a soft roll along the bottom edge, ends tucked into the front edges.
    hem = arc(HEM_Z + 0.012, 0.212, 0.157, GAP + 0.012)
    sweep("CH_OfficeAvatar_HoodieHem_HIGH", hem, 0.018, blue, radii=[0.012] + [0.018] * (len(hem) - 2) + [0.012])
    # The hood lying on the back, and its rim from the back of the neck down both front edges.
    hood = blob("_hood", (0.0, 0.125, 0.93), (0.15, 0.075, 0.095), rot=(math.radians(-10), 0, 0))
    hood_ob = fuse("CH_OfficeAvatar_Hood_HIGH", [hood], 0.006, blue, smooth=2)
    for side, s in (("L", 1), ("R", -1)):
        rim = [(s * (0.03 + 0.09 * t), 0.06 - 0.21 * t, 0.985 - 0.05 * t) for t in [i / 6 for i in range(7)]]
        rim += [(s * (GAP + 0.016), -0.15, z) for z in (0.9, 0.85, 0.8, 0.75, 0.7, 0.65, HEM_Z + 0.03)]
        sweep(f"CH_OfficeAvatar_HoodRim_{side}_HIGH", rim, 0.021, blue)
        # White piping just inside the open edge.
        sweep(f"CH_OfficeAvatar_Piping_{side}_HIGH", [(s * (GAP + 0.003), -0.157, z) for z in (0.93, 0.85, 0.75, 0.65, HEM_Z + 0.01)], 0.006, white)
        # Drawstrings out of the hood rim, with aglets.
        sweep(f"CH_OfficeAvatar_Drawstring_{side}_HIGH", [(s * 0.058, -0.15, 0.93), (s * 0.06, -0.162, 0.86), (s * 0.058, -0.166, 0.8)], 0.0055, white)
        assign(blob(f"CH_OfficeAvatar_Aglet_{side}_HIGH", (s * 0.058, -0.167, 0.79), (0.008, 0.008, 0.016)), white)
        # Puffy sleeve: rounded at the shoulder, widest at the elbow, gathered into a cuff.
        sl = [Vector((s * 0.16, 0.0, 0.905)), Vector((s * 0.215, -0.005, 0.8)), Vector((s * 0.25, -0.012, 0.7)), Vector((s * 0.268, -0.02, 0.63))]
        sweep(f"CH_OfficeAvatar_Sleeve_{side}_HIGH", sl, 0.08, blue, segments=20, radii=[0.064, 0.077, 0.084, 0.081])
        cuff_c = Vector((s * 0.27, -0.024, 0.61))
        ring = [cuff_c + Vector((0.064 * math.cos(a), 0.066 * math.sin(a), 0)) for a in [i * math.tau / 24 for i in range(25)]]
        sweep(f"CH_OfficeAvatar_Cuff_{side}_HIGH", ring, 0.02, blue, cap=False)
        shoulder = blob(f"_sh{side}", (s * 0.158, 0.0, 0.88), (0.062, 0.078, 0.06))
        fuse(f"CH_OfficeAvatar_ShoulderCap_{side}_HIGH", [shoulder], 0.006, blue, smooth=2)
    return shell


def trousers(navy):
    for side, s in (("L", 1), ("R", -1)):
        # A straight leg, a little fuller at the seat, resting on the shoe at the hem.
        secs = []
        # The waist drawn in under the top's hem (the hips 0.19 m out at most), straight from the thigh down.
        for z, r, dx in ((0.56, 0.09, -0.03), (0.45, 0.092, -0.01), (0.33, 0.088, 0.0), (0.22, 0.085, 0.0), (ANKLE_Z, 0.086, 0.0), (ANKLE_Z - 0.03, 0.086, 0.0)):
            secs.append([(s * (LEG_X + dx) + r * math.cos(a), -0.015 + 1.12 * r * math.sin(a), z) for a in [i * math.tau / 28 for i in range(28)]])
        leg = loft(f"CH_OfficeAvatar_TrouserLeg_{side}_HIGH", secs, COLL)
        assign(leg, navy)
    seat = blob("_seat", (0.0, -0.01, 0.5), (0.2, 0.125, 0.09))
    fuse("CH_OfficeAvatar_TrouserSeat_HIGH", [seat], 0.008, navy, smooth=2)


def sneaker(side, s, white, blue):
    """A chunky sneaker: a thick rounded sole with a blue stripe, a padded upper rounded at the toe, two
    straps across the top and the blue mark on the outer side."""
    x0 = s * FOOT_X
    L, W = SHOE_LEN * 0.95, SHOE_W   # side view: the heel 2 cm shorter than the blockout's box
    y_toe, y_heel = SHOE_FRONT, SHOE_FRONT + L
    # Footprint (top view): rounded toe and heel.
    def foot(w, l, n=40):
        pts = []
        for i in range(n):
            a = math.tau * i / n
            x = 0.5 * w * math.cos(a)
            y = 0.5 * l * math.sin(a)
            # squarer than an ellipse
            x = math.copysign(abs(x) ** 0.8 * (0.5 * w) ** 0.2, x)
            y = math.copysign(abs(y) ** 0.85 * (0.5 * l) ** 0.15, y)
            pts.append((x, y))
        return pts
    sole = profile_extrude(f"CH_OfficeAvatar_Sole_{side}_HIGH", foot(W, L), 0.05, COLL, location=(x0, (y_toe + y_heel) / 2, 0))
    bevel(sole, 0.015, 3, 40, False)
    apply_all_modifiers(sole)
    assign(sole, white)
    stripe = profile_extrude(f"CH_OfficeAvatar_SoleStripe_{side}_HIGH", foot(W + 0.008, L + 0.008), 0.014, COLL, location=(x0, (y_toe + y_heel) / 2, 0.006))
    assign(stripe, blue)
    # Upper: sections from toe to heel, rising from the toe box to the collar.
    secs = []
    for t, h, w in ((0.02, 0.035, 0.12), (0.1, 0.075, 0.19), (0.25, 0.1, 0.21), (0.45, 0.13, 0.21), (0.62, 0.145, 0.2), (0.8, 0.14, 0.19), (0.93, 0.12, 0.16), (0.97, 0.08, 0.1)):
        y = y_toe + L * t
        ring = []
        for i in range(20):
            a = math.pi * i / 19
            ring.append((x0 + 0.5 * w * math.cos(a), y, 0.045 + h * math.sin(a) ** 0.7))
        secs.append(ring)  # the arch over the foot; the loop closes along the sole
    upper = loft(f"CH_OfficeAvatar_Upper_{side}_HIGH", secs, COLL, close_sections=True)
    subsurf(upper, 1)
    apply_all_modifiers(upper)
    assign(upper, white)
    shade_smooth(upper, math.radians(180))
    # Two straps across the instep.
    for k, t in enumerate((0.42, 0.56)):
        y = y_toe + L * t
        pts = [(x0 + 0.5 * 0.2 * math.cos(math.pi * i / 10), y, 0.05 + 0.135 * math.sin(math.pi * i / 10) ** 0.7 + 0.006) for i in range(11)]
        sweep(f"CH_OfficeAvatar_Strap{k}_{side}_HIGH", pts, 0.016, white, radii=[0.014] * 11)
    # The blue mark on the outer side.
    mark = blob(f"CH_OfficeAvatar_ShoeMark_{side}_HIGH", (x0 + s * (0.5 * 0.225 - 0.004), y_toe + L * 0.5, 0.1), (0.008, 0.06, 0.03), rot=(math.radians(-25), 0, 0))
    assign(mark, blue)


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
