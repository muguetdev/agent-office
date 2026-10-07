"""
CH_OfficeAvatar, phase 2: blockout. The base character's primary masses at the brief's measurements:
the body under the clothing, the head with its ears and face marks, the hair mass, and the base outfit
(open hoodie over a tee, trousers, chunky sneakers) as separate volumes. Joint centres are placed here.

  blender --background --python build/02_blockout.py -- --master CH_OfficeAvatar_master.blend

Metres, Z up, facing -Y, +X is the character's left. Measurements are from asset-brief.md (front view
unless noted; H = 1.55 m, 1 px of the 252x520 crops = 3.14 mm); "inferred" marks what the sheet doesn't show.
"""
import os
import sys

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_kit.py")).read())

PHASE = "02_blockout"
OWNER_TAG = "phase:" + PHASE

H = 1.55

# Head (brief 1-4, 9-10; side view for depth)
CHIN_Z = 0.649 * H                  # 1.006
SKULL = 0.30 * H                    # chin to skull top, 0.465
HEAD_C = (0.0, -0.03, CHIN_Z + SKULL / 2)  # world-gate side view: 3 cm ahead of the body axis
HEAD_R = (0.19, 0.21, SKULL / 2)    # face width 0.243 H plus cheeks; face front 0.23 m ahead of the axis (side view)
EYE_Z = 0.771 * H                   # 1.195
EYE_X = 0.072                       # pupils 46 px apart
EYE_SIZE = (0.019, 0.012, 0.034)    # 12 x 22 px, upright ovals
BROW_Z = 1.289
MOUTH_Z = 1.091
EAR_Z = 1.144
EAR_R = (0.03, 0.022, 0.062)        # 23 x 42 px

# Hair (top of hair at H; side view: hangs to about z 1.03 at the back)
HAIR_TOP = H

# Torso and arms
SHOULDER_Z = 0.609 * H              # 0.944, hoodie shoulder line
HEM_Z = 0.355 * H                   # 0.550
CROTCH_Z = 0.314 * H                # 0.487
FIST_C_Z = 0.325 * H                # 0.504
FIST_X = 0.283                      # 90 px off the centre line
FIST_R = (0.07, 0.07, 0.086)        # 46 x 55 px fists; side view: 0.07 m ahead of the axis

# Legs and shoes
FOOT_X = 0.165                      # shoe centres 0.213 H apart: they splay out from the legs
LEG_X = 0.12                        # trouser legs straight down, centres 76 px apart
ANKLE_Z = 0.157
SHOE_LEN = 0.284 * H                # 0.44 (side view)
SHOE_H = 0.122 * H                  # 0.19
SHOE_W = 0.25                       # 70 px in front, inside the outline
SHOE_FRONT = -0.275                 # toe 95 px ahead of the body axis (side view)
LEG_R = 0.094                       # trousers 0.122 H wide at the knee

SKIN = (0.98, 0.78, 0.62, 1)
HAIR = (0.30, 0.19, 0.14, 1)
BLUE = (0.16, 0.42, 0.90, 1)
WHITE = (0.96, 0.96, 0.95, 1)
NAVY = (0.17, 0.20, 0.30, 1)
INK = (0.08, 0.06, 0.06, 1)


def ellipsoid(name, c, r, mat, u=32, v=16):
    ob = sphere(name, 1.0, "LOW", location=c, u=u, v=v, scale=r)
    assign(ob, mat)
    shade_smooth(ob, math.radians(80))
    return ob


def tube(name, p0, p1, r0, r1, mat, segments=24):
    """A tapered tube from p0 to p1 (a limb or a sleeve)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r0, radius2=r1, depth=d.length)
    bmesh.ops.translate(bm, vec=(0, 0, d.length / 2), verts=bm.verts)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    ob = new_mesh_object(name, bm, "LOW", location=p0)
    assign(ob, mat)
    shade_smooth(ob, math.radians(60))
    return ob


def on_head(x, z, inset=0.004):
    """The point on the head's front surface at (x, z), pushed in by `inset`."""
    cx, cy, cz = HEAD_C
    rx, ry, rz = HEAD_R
    k = 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2
    return (x, cy - ry * math.sqrt(max(0.0, k)) + inset, z)


def build(scene, args):
    skin = material("M_Skin", SKIN, 0.7)
    hair = material("M_Hair", HAIR, 0.55)
    blue = material("M_PrimaryClothing", BLUE, 0.85)
    white = material("M_SecondaryClothing", WHITE, 0.85)
    navy = material("M_Pants", NAVY, 0.8)
    shoes = material("M_Shoes", WHITE, 0.45)
    ink = material("M_Eyes", INK, 0.2)

    # The body under the clothing: one skin chain, joints where the rig will bend.
    body = skin_chain(
        "CH_OfficeAvatar_Body_Blockout",
        {
            "spine": [(0, 0, CROTCH_Z + 0.02, 0.12), (0, 0, 0.65, 0.125), (0, 0, 0.82, 0.135), (0, 0, 0.9, 0.11), (0, 0, 0.97, 0.05), (0, 0, CHIN_Z + 0.03, 0.045)],
            "arm_L": [(0, 0, 0.9, 0.11), (0.17, 0, 0.9, 0.055), (0.235, 0, 0.73, 0.045), (0.268, 0, 0.575, 0.038)],
            "arm_R": [(0, 0, 0.9, 0.11), (-0.17, 0, 0.9, 0.055), (-0.235, 0, 0.73, 0.045), (-0.268, 0, 0.575, 0.038)],
            "leg_L": [(0, 0, CROTCH_Z + 0.02, 0.12), (0.09, 0, 0.47, 0.08), (0.125, 0, 0.3, 0.065), (FOOT_X - 0.01, 0.01, ANKLE_Z, 0.05)],
            "leg_R": [(0, 0, CROTCH_Z + 0.02, 0.12), (-0.09, 0, 0.47, 0.08), (-0.125, 0, 0.3, 0.065), (-FOOT_X + 0.01, 0.01, ANKLE_Z, 0.05)],
        },
        collection="LOW",
        subdiv=1,
    )
    assign(body, skin)

    # Head, ears, face marks.
    ellipsoid("CH_OfficeAvatar_Head_Blockout", HEAD_C, HEAD_R, skin, 40, 24)
    for side, s in (("L", 1), ("R", -1)):
        ellipsoid(f"CH_OfficeAvatar_Ear_{side}_Blockout", (s * (HEAD_R[0] + 0.012), HEAD_C[1] + 0.03, EAR_Z), EAR_R, skin, 16, 10)
        ellipsoid(f"CH_OfficeAvatar_Eye_{side}_Blockout", on_head(s * EYE_X, EYE_Z), EYE_SIZE, ink, 16, 10)
        brow = ellipsoid(f"CH_OfficeAvatar_Brow_{side}_Blockout", on_head(s * 0.075, BROW_Z, 0.0), (0.042, 0.012, 0.012), hair, 16, 8)
        brow.rotation_euler = (0, s * math.radians(-6), 0)
    ellipsoid("CH_OfficeAvatar_Mouth_Blockout", on_head(0.0, MOUTH_Z, 0.0), (0.045, 0.008, 0.01), ink, 16, 8)

    # Hair: the crown mass over the skull and the back of the head, down to the nape.
    ellipsoid("CH_OfficeAvatar_Hair_Top_Blockout", (0.0, -0.035, HAIR_TOP - 0.175), (0.215, 0.235, 0.165), hair)
    for side, s in (("L", 1), ("R", -1)):
        ellipsoid(f"CH_OfficeAvatar_Hair_Side_{side}_Blockout", (s * 0.172, 0.01, 1.3), (0.085, 0.17, 0.13), hair)
    ellipsoid("CH_OfficeAvatar_Hair_Back_Blockout", (0.0, 0.06, 1.23), (0.2, 0.15, 0.2), hair)

    # Base outfit: the open hoodie (body, hood, sleeves), the tee showing in its opening.
    hoodie = loft(
        "CH_OfficeAvatar_Hoodie_Blockout",
        [[(rx * math.cos(a), ry * math.sin(a) - 0.01, z) for a in [i * math.tau / 24 for i in range(24)]] for z, rx, ry in (
            (HEM_Z, 0.205, 0.15),
            (0.66, 0.2, 0.15),
            (0.82, 0.2, 0.155),
            (0.9, 0.165, 0.13),
            (0.965, 0.1, 0.09),
        )],
    )
    assign(hoodie, blue)
    ellipsoid("CH_OfficeAvatar_Hood_Blockout", (0.0, 0.11, 0.935), (0.16, 0.085, 0.09), blue)
    ellipsoid("CH_OfficeAvatar_Tee_Blockout", (0.0, -0.115, 0.78), (0.085, 0.04, 0.2), white)
    for side, s in (("L", 1), ("R", -1)):
        # Puffy sleeves: narrow at the rounded shoulder, widest at the cuff (shoulder 66 px, cuff 86 px off the centre line).
        ellipsoid(f"CH_OfficeAvatar_ShoulderCap_{side}_Blockout", (s * 0.168, 0, 0.885), (0.07, 0.085, 0.07), blue)
        tube(f"CH_OfficeAvatar_Sleeve_{side}_Blockout", (s * 0.185, 0, 0.89), (s * 0.268, -0.02, 0.615), 0.066, 0.088, blue)
        ellipsoid(f"CH_OfficeAvatar_Fist_{side}_Blockout", (s * FIST_X, -0.07, FIST_C_Z), FIST_R, skin, 24, 14)
        # Trousers: from the hip to the shoe, a little wider at the bottom.
        leg = tube(f"CH_OfficeAvatar_TrouserLeg_{side}_Blockout", (s * LEG_X, -0.015, 0.53), (s * LEG_X, -0.015, ANKLE_Z - 0.01), 0.092, LEG_R, navy)
        leg.scale = (1.0, 1.12, 1.0)  # side view: the trousers are deeper than they are wide
        # Chunky sneakers: a flat sole and a rounded upper, the toe well ahead of the ankle.
        sole = box(f"CH_OfficeAvatar_Sole_{side}_Blockout", (SHOE_W, SHOE_LEN - 0.05, 0.05), location=(s * FOOT_X, SHOE_FRONT + SHOE_LEN / 2, 0), base_at_origin=True)
        bevel(sole, width=0.02, segments=3, angle_limit=40, harden=False)
        assign(sole, shoes)
        ellipsoid(f"CH_OfficeAvatar_Upper_{side}_Blockout", (s * FOOT_X, SHOE_FRONT + SHOE_LEN * 0.5, 0.045 + (SHOE_H - 0.045) / 2), (SHOE_W / 2 - 0.005, SHOE_LEN / 2 - 0.01, (SHOE_H - 0.045) / 2 + 0.01), shoes)
    ellipsoid("CH_OfficeAvatar_TrouserSeat_Blockout", (0.0, -0.01, 0.5), (0.19, 0.12, 0.08), navy)
    log("blockout built")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    clear_owned()
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
