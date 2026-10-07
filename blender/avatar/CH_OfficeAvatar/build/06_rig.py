"""
CH_OfficeAvatar, phase 6: articulation. One humanoid skeleton every avatar shares (08_RIG / RIG_DEF), the
skin weights of every game mesh (LOD0, LOD1, LOD2) on it, IK controls for animators and the sockets
accessories attach to.

  blender --background --python build/06_rig.py -- --master CH_OfficeAvatar_master.blend

Bones are named as the avatar brief asks (root, pelvis, spine_01 … toe_R); fingers are simplified to a
thumb and one bone for the four fingers per hand. The rest pose is the modelled relaxed A-pose. Every
deforming bone's local X runs across the body, so elbows, knees and the spine bend about X.

Weights: each piece is weighted only to the bones that can move it (trousers to the pelvis and legs, the
head, hair and face rigidly to the head), by distance to each bone's segment, then smoothed along the
mesh, at most four influences per vertex, normalised. The ik_ and pole_ bones don't deform; the IK
constraints on the arms and legs are there for animators and start switched off (influence 0), so the
clips are plain rotations of the deforming bones, which is what glTF carries.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, "_kit.py")).read())

PHASE = "06_rig"
OWNER_TAG = "phase:" + PHASE
A = "CH_OfficeAvatar"
RIG = f"{A}_Rig"

# Joint centres (A-pose), from the forms: hips and knees at the trousers' sections, shoulders and elbows
# at the sleeve's bends, the wrist at the cuff, the ankle above the shoe's heel.
SIDES = (("L", 1), ("R", -1))


def bones():
    b = [
        # name, head, tail, parent, forward-axis hint (the bone's Z points this way), deform
        ("root", (0, 0, 0), (0, -0.15, 0), None, (0, 0, 1), True),
        ("pelvis", (0, -0.005, 0.5), (0, -0.005, 0.58), "root", (0, -1, 0), True),
        ("spine_01", (0, -0.005, 0.58), (0, -0.005, 0.68), "pelvis", (0, -1, 0), True),
        ("spine_02", (0, -0.005, 0.68), (0, -0.005, 0.78), "spine_01", (0, -1, 0), True),
        ("chest", (0, -0.005, 0.78), (0, -0.005, 0.93), "spine_02", (0, -1, 0), True),
        ("neck", (0, -0.005, 0.93), (0, -0.01, 1.01), "chest", (0, -1, 0), True),
        ("head", (0, -0.01, 1.01), (0, -0.02, 1.35), "neck", (0, -1, 0), True),
    ]
    for side, s in SIDES:
        x = lambda v: s * v
        b += [
            (f"clavicle_{side}", (x(0.03), -0.005, 0.9), (x(0.15), -0.005, 0.9), "chest", (0, 0, 1), True),
            (f"upperarm_{side}", (x(0.16), 0.0, 0.9), (x(0.23), -0.01, 0.73), f"clavicle_{side}", (0, -1, 0), True),
            (f"lowerarm_{side}", (x(0.23), -0.01, 0.73), (x(0.262), -0.03, 0.6), f"upperarm_{side}", (0, -1, 0), True),
            (f"hand_{side}", (x(0.262), -0.03, 0.6), (x(0.29), -0.06, 0.52), f"lowerarm_{side}", (0, -1, 0), True),
            (f"fingers_{side}", (x(0.29), -0.06, 0.52), (x(0.285), -0.075, 0.45), f"hand_{side}", (0, -1, 0), True),
            (f"thumb_{side}", (x(0.27), -0.09, 0.56), (x(0.262), -0.13, 0.52), f"hand_{side}", (0, 0, 1), True),
            # The leg straight down to the ankle, the foot straight ahead under it (forms: LEG_X 0.13, FOOT_X 0.14).
            (f"thigh_{side}", (x(0.1), -0.01, 0.49), (x(0.13), -0.015, 0.3), "pelvis", (0, -1, 0), True),
            (f"shin_{side}", (x(0.13), -0.015, 0.3), (x(0.13), -0.015, 0.155), f"thigh_{side}", (0, -1, 0), True),
            (f"foot_{side}", (x(0.13), -0.015, 0.155), (x(0.14), -0.17, 0.05), f"shin_{side}", (0, 0, 1), True),
            (f"toe_{side}", (x(0.14), -0.17, 0.05), (x(0.14), -0.27, 0.045), f"foot_{side}", (0, 0, 1), True),
            # Animator controls (no deforming): IK targets at the wrist and the ankle, poles ahead of the knee, behind the elbow.
            (f"ik_hand_{side}", (x(0.262), -0.03, 0.6), (x(0.262), -0.03, 0.52), "root", (0, -1, 0), False),
            (f"pole_arm_{side}", (x(0.25), 0.3, 0.73), (x(0.25), 0.3, 0.68), "root", (0, -1, 0), False),
            (f"ik_foot_{side}", (x(0.13), -0.015, 0.155), (x(0.13), -0.12, 0.155), "root", (0, 0, 1), False),
            (f"pole_leg_{side}", (x(0.13), -0.45, 0.3), (x(0.13), -0.45, 0.35), "root", (0, -1, 0), False),
        ]
    return b


# Which bones may move each piece (by its name), and the pieces held rigidly by one bone.
ALLOWED = {
    "Body_Neck": ["chest", "neck", "head"],
    "Body_Torso": ["pelvis", "spine_01", "spine_02", "chest", "neck", "clavicle_L", "clavicle_R", "upperarm_L", "upperarm_R"],
    "Body_Arms": ["chest", "clavicle_L", "clavicle_R", "upperarm_L", "upperarm_R", "lowerarm_L", "lowerarm_R", "hand_L", "hand_R"],
    "Body_Hands": ["lowerarm_L", "lowerarm_R", "hand_L", "hand_R", "fingers_L", "fingers_R", "thumb_L", "thumb_R"],
    "Body_Legs": ["pelvis", "thigh_L", "thigh_R", "shin_L", "shin_R", "foot_L", "foot_R", "toe_L", "toe_R"],
    "Top_Tee": ["pelvis", "spine_01", "spine_02", "chest", "neck", "clavicle_L", "clavicle_R", "upperarm_L", "upperarm_R"],
    "Top_HoodieOpen": ["pelvis", "spine_01", "spine_02", "chest", "neck", "clavicle_L", "clavicle_R", "upperarm_L", "upperarm_R", "lowerarm_L", "lowerarm_R"],
    "Bottom_Trousers": ["pelvis", "spine_01", "thigh_L", "thigh_R", "shin_L", "shin_R"],
    "Shoes_Sneakers": ["foot_L", "foot_R", "toe_L", "toe_R"],
}
ALLOWED["Top_Jacket"] = ALLOWED["Top_HoodieOpen"]
ALLOWED["Bottom_Joggers"] = ALLOWED["Bottom_Trousers"]
ALLOWED["Shoes_Runners"] = ALLOWED["Shoes_Sneakers"]
RIGID = {p: "head" for p in ("Body_Head", "Face_Eyes", "Face_Brows", "Face_Mouth", "Hair_Wavy", "Hair_Bun", "Hair_Bob",
                             "Beard_Stubble", "Beard_Full", "Glasses_Round", "Glasses_Square")}


def make_rig():
    arm = bpy.data.armatures.new(RIG)
    ob = bpy.data.objects.new(RIG, arm)
    col("RIG_DEF").objects.link(ob)
    own(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent, z_axis, deform in bones():
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.align_roll(Vector(z_axis))
        eb.use_deform = deform
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = deform and (eb.head - eb.parent.tail).length < 1e-5
    bpy.ops.object.mode_set(mode="OBJECT")
    ctrl = arm.collections.new("CTRL")
    defs = arm.collections.new("DEF")
    for b in arm.bones:
        (defs if b.use_deform else ctrl).assign(b)
    # IK for animators, off by default.
    for side, _ in SIDES:
        for bone, target, pole, angle in ((f"lowerarm_{side}", f"ik_hand_{side}", f"pole_arm_{side}", -90), (f"shin_{side}", f"ik_foot_{side}", f"pole_leg_{side}", -90)):
            c = ob.pose.bones[bone].constraints.new("IK")
            c.target, c.subtarget = ob, target
            c.pole_target, c.pole_subtarget = ob, pole
            c.pole_angle = math.radians(angle)
            c.chain_count = 2
            c.influence = 0.0
    return ob


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


# Where a garment's body ends and its sleeves begin: inside this, the arm bones don't pull on it (so
# raising an arm doesn't lift the hoodie's or the tee's side and open a gap at the waist).
ARM_BONES = {"upperarm_L", "upperarm_R", "lowerarm_L", "lowerarm_R"}
SLEEVE_X = 0.17
# The tops' body (forms' hoodie stations: height, half-width, half-depth), centred 1 cm forward. A vertex
# on or inside it is the garment's body and doesn't follow the arms; one well outside it is sleeve.
TORSO = ((0.5, 0.208, 0.15), (0.66, 0.205, 0.152), (0.82, 0.205, 0.158), (0.885, 0.178, 0.142), (0.935, 0.13, 0.108), (0.97, 0.098, 0.085))


def outside_torso(p):
    """How far outside the tops' body `p` is, as a multiple of its radius there (1 on its surface)."""
    z = min(max(p.z, TORSO[0][0]), TORSO[-1][0])
    for (z0, x0, y0), (z1, x1, y1) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            rx, ry = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            break
    e = math.hypot(p.x / rx, (p.y + 0.01) / ry)
    return e if p.z < 0.99 else 0.0


def weigh(ob, rig, allowed, power=4.0, smooth=3, body_only=False):
    """Distance-to-bone weights over the allowed bones, smoothed along the mesh, 4 at most, normalised."""
    me = ob.data
    mw = ob.matrix_world
    segs = {n: (rig.matrix_world @ rig.data.bones[n].head_local, rig.matrix_world @ rig.data.bones[n].tail_local) for n in allowed}
    W = []
    for v in me.vertices:
        p = mw @ v.co
        # The garment's body (on or inside the torso, the shoulders' tops above the arm's start) doesn't follow the arms.
        # (Sleeves are pieces of their own, weighted whole to the arm below, so all of the body stays off it.)
        body = body_only
        near = segs if not body else {n: ab for n, ab in segs.items() if n not in ARM_BONES}
        w = {n: 1.0 / (seg_dist(p, a, b) + 0.004) ** power for n, (a, b) in near.items()}
        t = sum(w.values())
        W.append({n: x / t for n, x in w.items()})
    # Smooth along the mesh's edges.
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        i, j = e.vertices
        nb[i].append(j)
        nb[j].append(i)
    for _ in range(smooth):
        W2 = []
        for i, w in enumerate(W):
            if not nb[i]:
                W2.append(w)
                continue
            acc = {n: 0.5 * x for n, x in w.items()}
            k = 0.5 / len(nb[i])
            for j in nb[i]:
                for n, x in W[j].items():
                    acc[n] = acc.get(n, 0.0) + k * x
            W2.append(acc)
        W = W2
    groups = {n: ob.vertex_groups.new(name=n) for n in allowed}
    if body_only:
        # A sleeve is a piece of its own (an island well out to the side): all of it follows the arm,
        # none of the body's rule applies to it.
        sleeve = set()
        root_of = [0] * len(me.vertices)
        seen = [False] * len(me.vertices)
        for i0 in range(len(me.vertices)):
            if seen[i0]:
                continue
            stack, island = [i0], []
            seen[i0] = True
            while stack:
                i = stack.pop()
                island.append(i)
                for j in nb[i]:
                    if not seen[j]:
                        seen[j] = True
                        stack.append(j)
            for i in island:
                root_of[i] = i0
            xs = [(mw @ me.vertices[i].co).x for i in island]
            # A sleeve (or its cuff) is all on one side and reaches well out from the middle (rooted deep in
            # the body, its average can be close in); the body crosses the middle, and the front's trims
            # (piping, drawstrings) stay near it.
            if (min(xs) > 0 or max(xs) < 0) and max(abs(x) for x in xs) > 0.2:
                sleeve.update(island)
        for i in sleeve:
            p = mw @ me.vertices[i].co
            w = {n: 1.0 / (seg_dist(p, a, b) + 0.004) ** power for n, (a, b) in segs.items()}
            t = sum(w.values())
            W[i] = {n: x / t for n, x in w.items()}
        # The trims (zip, piping, drawstrings: small pieces that aren't sleeves) move exactly as the cloth
        # under them does: each vertex takes the weights of the nearest vertex of the biggest piece.
        from mathutils.kdtree import KDTree
        islands_of = {}
        for i in range(len(me.vertices)):
            islands_of.setdefault(root_of[i], []).append(i)
        main = max(islands_of.values(), key=len)
        kd = KDTree(len(main))
        for i in main:
            kd.insert(me.vertices[i].co, i)
        kd.balance()
        for isl in islands_of.values():
            if isl is main or len(isl) > 0.15 * len(main) or isl[0] in sleeve:
                continue
            for i in isl:
                W[i] = dict(W[kd.find(me.vertices[i].co)[1]])
    for i, w in enumerate(W):
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        top = [(n, x) for n, x in top if x > 0.02] or top[:1]
        t = sum(x for _, x in top)
        for n, x in top:
            groups[n].add([i], x / t, "REPLACE")


def bind_rigid(ob, bone):
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")


def attach(ob, rig):
    ob.parent = rig
    ob.matrix_parent_inverse = rig.matrix_world.inverted()
    m = ob.modifiers.new("Armature", "ARMATURE")
    m.object = rig


def build(scene, args):
    rig = make_rig()
    meshes = [o for o in list(col("LOW").all_objects) + list(col("10_LOD").objects) if o.type == "MESH" and "_LOD" in o.name]
    for ob in meshes:
        ob.vertex_groups.clear()
        for m in [m for m in ob.modifiers if m.type == "ARMATURE"]:
            ob.modifiers.remove(m)
        part = ob.name[len(A) + 1:].rsplit("_LOD", 1)[0]
        if part in RIGID:
            bind_rigid(ob, RIGID[part])
        elif part in ALLOWED:
            weigh(ob, rig, ALLOWED[part], body_only=part in ("Top_HoodieOpen", "Top_Jacket", "Top_Tee", "Body_Torso"))
        else:
            raise SystemExit(f"no weighting rule for {ob.name}")
        attach(ob, rig)
    # Sockets for what attaches: hats on the head, glasses on the face, things in the hands, a badge on the chest.
    socket("SOCKET_head", (0, -0.02, 1.47), rig, "head")
    socket("SOCKET_face", (0, -0.235, 1.2), rig, "head")
    socket("SOCKET_chest", (0, -0.17, 0.82), rig, "chest")
    for side, s in SIDES:
        socket(f"SOCKET_hand_{side}", (s * 0.285, -0.075, 0.5), rig, f"hand_{side}")
    log("rig", len(rig.data.bones), "bones,", len(meshes), "meshes bound")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    clear_owned()
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
