"""
CH_OfficeAvatar, phase 8: the test clips every avatar shares (11_ANIMATIONS): Idle, Walk, Sit, Typing,
Wave, and PoseTest, the extreme poses the rig is checked in. Plain rotations of the deforming bones
(what glTF carries), 30 fps, in place; loops marked with the `loop` property, the walk with its speed.

  blender --background --python build/08_anim.py -- --master CH_OfficeAvatar_master.blend

Axes (see 06_rig.py): a limb's or the spine's local X runs across the body, +X swings it forward (the
thigh lifts, the spine bends forward, the forearm comes up); a knee bends with -X. Raising an arm out to
the side is +Z on the left and -Z on the right; a head turns about its own Y.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, "_kit.py")).read())

PHASE = "08_anim"
OWNER_TAG = "phase:" + PHASE
RIG = "CH_OfficeAvatar_Rig"
FPS = 30


def clip(rig, name, frames, poses, loop=True, **props):
    """An action from {frame: {bone: (rx, ry, rz) degrees, or ('loc', (x, y, z))}}; bones not named rest."""
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    act["loop"] = loop
    for k, v in props.items():
        act[k] = v
    rig.animation_data_create()
    rig.animation_data.action = act
    used = sorted({b for pose in poses.values() for b in pose})
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
    for f, pose in sorted(poses.items()):
        for b in used:
            pb = rig.pose.bones[b]
            v = pose.get(b, (0, 0, 0))
            if isinstance(v, tuple) and len(v) == 2 and v[0] == "loc":
                pb.location = Vector(v[1])
                pb.keyframe_insert("location", frame=f)
                continue
            pb.rotation_euler = Euler([math.radians(a) for a in v], "XYZ")
            pb.keyframe_insert("rotation_euler", frame=f)
    act.frame_range = (min(poses), frames)
    log(name, frames, "frames", "loop" if loop else "")
    return act


def mirror(pose):
    """A left-side pose for the right side: the same X, mirrored Y and Z."""
    out = {}
    for b, v in pose.items():
        if b.endswith("_L"):
            out[b[:-2] + "_R"] = (v[0], -v[1], -v[2])
    return out


ARMS_DOWN = {"upperarm_L": (0, 0, -8), "upperarm_R": (0, 0, 8)}  # the A-pose's arms a little closer in, at rest in clips


def build(scene, args):
    rig = bpy.data.objects[RIG]
    scene.render.fps = FPS

    # Idle: breathing, a little sway of the head and arms (2 s loop).
    idle = {}
    for f, t in ((1, 0), (16, 1), (31, 0), (46, -1), (61, 0)):
        idle[f] = {"spine_02": (1.5 * t, 0, 0), "chest": (1.5 * abs(t), 0, 0), "head": (-1.5 * t, 2 * t, 0), **ARMS_DOWN,
                   "lowerarm_L": (6 + 2 * t, 0, 0), "lowerarm_R": (6 - 2 * t, 0, 0)}
    clip(rig, "Idle", 61, idle)

    # Walk: a 0.8 s stride, in place, legs and arms opposite, the pelvis bobbing at each step.
    walk = {}
    for f, ph in ((1, 0), (7, 1), (13, 2), (19, 3), (25, 4)):
        c = [1, 0, -1, 0, 1][ph]          # left leg forward 1, back -1
        up = [0, 1, 0, 1, 0][ph]          # passing: the body at its highest
        pose = {
            "pelvis": (0, 4 * c, 0), "spine_02": (3, -6 * c, 0), "head": (-2, 0, 0),
            "thigh_L": (28 * c, 0, 0), "shin_L": (-8 - 30 * up * (1 if ph == 3 else 0.3) - 10 * max(0, -c), 0, 0), "foot_L": (-12 * max(0, c) + 10 * max(0, -c), 0, 0),
            "thigh_R": (-28 * c, 0, 0), "shin_R": (-8 - 30 * up * (1 if ph == 1 else 0.3) - 10 * max(0, c), 0, 0), "foot_R": (-12 * max(0, -c) + 10 * max(0, c), 0, 0),
            "upperarm_L": (-22 * c, 0, -8), "upperarm_R": (22 * c, 0, 8),
            "lowerarm_L": (18 + 10 * max(0, -c), 0, 0), "lowerarm_R": (18 + 10 * max(0, c), 0, 0),
            "root": ("loc", (0, 0.025 * up, 0)),
        }
        walk[f] = pose
    clip(rig, "Walk", 25, walk, speed_mps=1.3)

    # Sit: on a chair seat at 0.45 m, thighs level, shins down, hands on the thighs.
    sit_pose = {"thigh_L": (88, 0, -4), "thigh_R": (88, 0, 4), "shin_L": (-88, 0, 0), "shin_R": (-88, 0, 0), "foot_L": (0, 0, 0), "foot_R": (0, 0, 0),
                "spine_01": (-4, 0, 0), "upperarm_L": (30, 0, -6), "upperarm_R": (30, 0, 6), "lowerarm_L": (35, 0, 0), "lowerarm_R": (35, 0, 0)}
    clip(rig, "Sit", 31, {1: sit_pose, 31: sit_pose})

    # Typing: seated, forearms out over a desk, fingers tapping in turn (1 s loop).
    typing = {}
    for f, k in ((1, 0), (6, 1), (11, 0), (16, 2), (21, 0), (26, 1), (31, 0)):
        pose = dict(sit_pose)
        pose.update({"spine_02": (6, 0, 0), "head": (8, 0, 0), "upperarm_L": (38, 0, -10), "upperarm_R": (38, 0, 10),
                     "lowerarm_L": (62, 0, 6), "lowerarm_R": (62, 0, -6), "hand_L": (-14, 0, 0), "hand_R": (-14, 0, 0),
                     "fingers_L": (20 if k == 1 else 6, 0, 0), "fingers_R": (20 if k == 2 else 6, 0, 0)})
        typing[f] = pose
    clip(rig, "Typing", 31, typing)

    # Wave: the left arm up and out, the forearm raised, the hand rocking side to side (1 s loop).
    wave = {}
    for f, t in ((1, 0), (8, 1), (16, 0), (23, -1), (31, 0)):
        wave[f] = {"upperarm_L": (10, 0, 72), "lowerarm_L": (0, 0, 70 + 6 * t), "hand_L": (0, 0, 22 * t), "fingers_L": (-10, 0, 0), "thumb_L": (0, 0, -10),
                   "upperarm_R": (0, 0, 8), "lowerarm_R": (10, 0, 0), "chest": (0, 0, -3), "head": (0, 8, -4)}
    clip(rig, "Wave", 31, wave)

    # PoseTest: one extreme pose a frame, for the deformation sheet.
    tests = {
        1: {},
        2: {"upperarm_L": (0, 0, 150), "upperarm_R": (0, 0, -150), "clavicle_L": (0, 0, 15), "clavicle_R": (0, 0, -15)},     # arms overhead
        3: {"upperarm_L": (85, 0, -5), "upperarm_R": (85, 0, 5), "lowerarm_L": (100, 0, 0), "lowerarm_R": (100, 0, 0)},     # deep elbows, reach
        4: {"thigh_L": (110, 0, -10), "thigh_R": (110, 0, 10), "shin_L": (-125, 0, 0), "shin_R": (-125, 0, 0), "spine_01": (25, 0, 0)},  # crouch
        5: {"head": (0, 60, 0), "neck": (0, 15, 0), "spine_02": (0, 25, 0), "chest": (0, 15, 0)},                            # head and torso turned
        6: {"thigh_L": (45, 0, 0), "shin_L": (-20, 0, 0), "thigh_R": (-30, 0, 0), "shin_R": (-40, 0, 0)},                   # full stride
    }
    clip(rig, "PoseTest", 6, tests, loop=False)

    rig.animation_data.action = bpy.data.actions["Idle"]
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
