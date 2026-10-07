"""
CH_OfficeAvatar, phase 5b: facial expressions as shape keys (glTF morph targets) on the face pieces, which
sit rigidly on the head bone: the mouth (rebuilt as a strip on the face, its two lips' edges the shape),
the eyes and the brows. Keys combine (a smile and a blink, a talking shape over any expression).

  Smile, BigSmile, Surprised, Sad, Angry, Blink_Left, Blink_Right, Mouth_Open,
  Talk_A, Talk_E, Talk_O, Talk_M (simple visemes for speech)

The Basis is the neutral face (the sheet's "Neutro": a small closed smile). Every LOD of a face piece is
the same mesh (it's a few hundred triangles), keys and all.

  blender --background --python build/05b_face.py -- --master CH_OfficeAvatar_master.blend

After 05_library.py (the face pieces exist), before 06_rig.py (which binds them to the head).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, "_kit.py")).read())
_forms = {"__file__": os.path.join(HERE, "03_forms.py"), "__name__": "03_forms"}
exec(compile(open(os.path.join(HERE, "03_forms.py")).read().split('\nif __name__ == "__main__":')[0], "03_forms.py", "exec"), _forms)
onto, MOUTH_Z = _forms["onto"], _forms["MOUTH_Z"]

PHASE = "05b_face"
OWNER_TAG = "phase:" + PHASE
A = "CH_OfficeAvatar"
N = 20          # columns across the mouth
HALF_W = 0.042  # half the neutral mouth's width (the sheet's small smile)


def lips(width, top, bottom, lift_z=0.0):
    """The mouth's two edges across it: x at t in 0..1, and the top and bottom edges' heights there."""
    xs = [HALF_W * width * (2 * i / (N - 1) - 1) for i in range(N)]
    ts = [i / (N - 1) for i in range(N)]
    return [(x, MOUTH_Z + lift_z + top(t)) for x, t in zip(xs, ts)], [(x, MOUTH_Z + lift_z + bottom(t)) for x, t in zip(xs, ts)]


arc = lambda t: math.sin(math.pi * t)
oval = lambda t: math.sqrt(max(0.0, 1 - (2 * t - 1) ** 2))

# Each shape: (width, top edge, bottom edge), heights from MOUTH_Z.
MOUTH = {
    "Basis":      (1.0, lambda t: 0.003 - 0.012 * arc(t), lambda t: -0.003 - 0.012 * arc(t)),
    "Smile":      (1.18, lambda t: 0.007 - 0.02 * arc(t), lambda t: 0.001 - 0.021 * arc(t)),
    "BigSmile":   (1.3, lambda t: 0.008 - 0.004 * arc(t), lambda t: 0.006 - 0.05 * arc(t)),
    "Surprised":  (0.5, lambda t: 0.004 + 0.016 * oval(t), lambda t: 0.004 - 0.024 * oval(t)),
    "Sad":        (0.9, lambda t: -0.012 + 0.011 * arc(t), lambda t: -0.018 + 0.011 * arc(t)),
    "Angry":      (0.8, lambda t: -0.004 + 0.004 * arc(t), lambda t: -0.011 + 0.004 * arc(t)),
    "Mouth_Open": (0.75, lambda t: 0.004 + 0.006 * oval(t), lambda t: 0.002 - 0.032 * oval(t)),
    "Talk_A":     (0.65, lambda t: 0.005 + 0.004 * oval(t), lambda t: 0.002 - 0.03 * oval(t)),
    "Talk_E":     (1.05, lambda t: 0.004 + 0.002 * oval(t), lambda t: 0.0 - 0.012 * oval(t)),
    "Talk_O":     (0.45, lambda t: 0.004 + 0.013 * oval(t), lambda t: 0.002 - 0.02 * oval(t)),
    "Talk_M":     (0.85, lambda t: 0.0015, lambda t: -0.0015),
}


def mouth(head, mat, teeth_mat):
    """The mouth strip, its Basis the neutral face, a key per shape; every point on the face's surface.
    Three rows: the top lip's edge, the teeth's lower edge and the bottom lip's edge. The upper teeth
    (white, between the first two) only show as the mouth opens: closed, their row is the top edge."""
    def rows(name):
        w, top, bottom = MOUTH[name]
        t, b = lips(w, top, bottom)
        # The teeth: a band under the top lip, up to 7 mm, never more than a third of the opening.
        m = [(x, zt - min(0.007, max(0.0, (zt - zb)) * 0.33) if (zt - zb) > 0.012 else zt) for (x, zt), (_, zb) in zip(t, b)]
        return [onto(head, [(x, 0, z) for x, z in r], 0.0025) for r in (t, m, b)]
    t0, m0, b0 = rows("Basis")
    bm = bmesh.new()
    top = [bm.verts.new(p) for p in t0]
    mid = [bm.verts.new(p) for p in m0]
    bot = [bm.verts.new(p) for p in b0]
    for i in range(N - 1):
        f = bm.faces.new((mid[i], mid[i + 1], top[i + 1], top[i]))
        f.material_index = 1
        bm.faces.new((bot[i], bot[i + 1], mid[i + 1], mid[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_mesh_object(f"{A}_Face_Mouth_LOD0", bm, "LOW")
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    bpy.data.collections["01_BODY"].objects.link(ob)
    ob.data.materials.append(mat)
    ob.data.materials.append(teeth_mat)
    # Facing out of the face, whatever winding bmesh chose.
    if ob.data.polygons[0].normal.y > 0:
        ob.data.flip_normals()
    ob.shape_key_add(name="Basis")
    for name in MOUTH:
        if name == "Basis":
            continue
        t, m, b = rows(name)
        key = ob.shape_key_add(name=name, from_mix=False)
        for i in range(N):
            key.data[i].co = Vector(t[i])
            key.data[N + i].co = Vector(m[i])
            key.data[2 * N + i].co = Vector(b[i])
    return ob


def eye_keys(ob):
    """Blinks (each eye squeezed to a closed line, its highlight with it), BigSmile's happy "^^" eyes,
    Surprised's wider ones, a little squint in Smile and Angry."""
    me = ob.data
    pts = [v.co.copy() for v in me.vertices]
    sides = {s: [p for p in pts if (p.x > 0) == (s > 0)] for s in (1, -1)}
    centre = {s: Vector((sum(p.x for p in ps) / len(ps), sum(p.y for p in ps) / len(ps), (min(p.z for p in ps) + max(p.z for p in ps)) / 2)) for s, ps in sides.items()}
    ob.shape_key_add(name="Basis") if not me.shape_keys else None

    def key(name, f):
        k = ob.shape_key_add(name=name, from_mix=False)
        for i, p in enumerate(pts):
            s = 1 if p.x > 0 else -1
            k.data[i].co = f(p, s, centre[s])
    def squash(p, c, amount, arch=0.0, lift=0.0):
        dx = p.x - c.x
        return Vector((p.x, p.y, c.z + (p.z - c.z) * amount + lift + arch * (0.0004 - dx * dx * 1.0)))
    key("Blink_Left", lambda p, s, c: squash(p, c, 0.08, lift=-0.008) if s > 0 else p)
    key("Blink_Right", lambda p, s, c: squash(p, c, 0.08, lift=-0.008) if s < 0 else p)
    key("BigSmile", lambda p, s, c: squash(p, c, 0.14, arch=12.0, lift=0.002))
    key("Smile", lambda p, s, c: squash(p, c, 0.85, lift=0.001))
    key("Surprised", lambda p, s, c: Vector((c.x + (p.x - c.x) * 1.15, p.y - 0.001, c.z + (p.z - c.z) * 1.18)))
    key("Angry", lambda p, s, c: squash(p, c, 0.75, lift=-0.002))


def brow_keys(ob):
    """Brows raised in surprise, their inner ends up in sadness and down in anger (each brow's inner end is
    the one nearer the middle of the face), a little lift in a smile."""
    me = ob.data
    pts = [v.co.copy() for v in me.vertices]
    span = {s: (min(abs(p.x) for p in pts if (p.x > 0) == (s > 0)), max(abs(p.x) for p in pts if (p.x > 0) == (s > 0))) for s in (1, -1)}
    ob.shape_key_add(name="Basis") if not me.shape_keys else None

    def key(name, inner, outer, fwd=0.0):
        k = ob.shape_key_add(name=name, from_mix=False)
        for i, p in enumerate(pts):
            s = 1 if p.x > 0 else -1
            lo, hi = span[s]
            u = (abs(p.x) - lo) / max(1e-6, hi - lo)      # 0 at the inner end, 1 at the outer
            dz = inner + (outer - inner) * u
            # On a round head a brow going up also goes back a little.
            k.data[i].co = Vector((p.x, p.y + fwd + 0.15 * max(0.0, dz), p.z + dz))
    key("Surprised", 0.022, 0.018)
    key("Sad", 0.016, -0.006)
    key("Angry", -0.014, 0.006, fwd=-0.002)
    key("Smile", 0.004, 0.004)
    key("BigSmile", 0.01, 0.008)


def build(scene, args):
    head = bpy.data.objects[f"{A}_Body_Head_LOD0"]
    mouth_mat = bpy.data.materials["M_Mouth"]
    # The mouth from 04_topology (a tube along the smile) makes way for the strip.
    for lv in (0, 1, 2):
        old = bpy.data.objects.get(f"{A}_Face_Mouth_LOD{lv}")
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
    m = mouth(head, mouth_mat, material("M_Teeth", (0.95, 0.95, 0.93, 1), 0.7))
    eyes = bpy.data.objects[f"{A}_Face_Eyes_LOD0"]
    brows = bpy.data.objects[f"{A}_Face_Brows_LOD0"]
    for ob in (eyes, brows):
        if ob.data.shape_keys:
            ob.shape_key_clear()
    eye_keys(eyes)
    brow_keys(brows)
    # Every LOD of a face piece is its LOD0, keys and all.
    for base in (m, eyes, brows):
        for lv in (1, 2):
            name = base.name.replace("_LOD0", f"_LOD{lv}")
            old = bpy.data.objects.get(name)
            if old:
                bpy.data.objects.remove(old, do_unlink=True)
            me = base.data.copy()
            me.name = name
            lod = bpy.data.objects.new(name, me)
            bpy.data.collections["10_LOD"].objects.link(lod)
            lod.hide_render = True
            own(lod)
    for ob in (m, eyes, brows):
        log(ob.name, [k.name for k in ob.data.shape_keys.key_blocks])


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    clear_owned()
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
