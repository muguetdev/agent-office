"""
CH_OfficeAvatar, phase 4: topology. The game meshes (LOW, LOD0) over the approved forms, in the modular
layout every avatar shares:

  LOW
    01_BODY      Body_Head (with the ears), Body_Torso (with the neck), Body_Arms, Body_Hands, Body_Legs
                 (with simple feet), and the face's own pieces: Face_Eyes, Face_Brows, Face_Mouth
    02_HAIR      Hair_Wavy
    04_TOPS      Top_Tee, Top_HoodieOpen
    05_BOTTOMS   Bottom_Trousers
    06_SHOES     Shoes_Sneakers
  10_LOD         LOD1 and LOD2 of each

The body is pieces on purpose: a piece the outfit covers (the torso under a hoodie, the legs under
trousers) can be switched off at runtime. Pieces meet at the neck, shoulders, wrists and hips with the
same vertices on both sides, so there's no gap when both show.

Deforming parts get loops where they bend (the body from a skin chain at subdivision 1: loops at every
joint; sleeves and trouser legs cut along their length so the elbows and knees have three or more);
rigid parts (the head, which turns as one, the hair on it, the hands, the hood, the shoes and the small
trims) are reduced with a controlled Decimate.

  blender --background --python build/04_topology.py -- --master CH_OfficeAvatar_master.blend
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, "_kit.py")).read())
_forms = {"__file__": os.path.join(HERE, "03_forms.py"), "__name__": "03_forms"}
exec(compile(open(os.path.join(HERE, "03_forms.py")).read().split('\nif __name__ == "__main__":')[0], "03_forms.py", "exec"), _forms)
for _k in ("CHIN_Z", "CROTCH_Z", "ANKLE_Z", "LEG_X", "FOOT_X", "SHOE_FRONT"):
    globals()[_k] = _forms[_k]

PHASE = "04_topology"
OWNER_TAG = "phase:" + PHASE
A = "CH_OfficeAvatar"

# Target triangles per piece at LOD0 (the brief's 8,000 to 15,000 for the body, base outfit and hair).
TRIS = {
    "Head": 1600, "Hair": 1740, "Hand": 470, "Hood": 500, "ShoulderCap": 160, "Seat": 300,
    "Eye": 160, "Highlight": 40, "Aglet": 60, "ShoeMark": 80, "Ring": 220,
    "Brow": 80, "Cuff": 150, "Hoodie": 1700, "Sleeve": 420, "Trousers": 1450, "Mouth": 100, "Rim": 200, "Upper": 450, "Sole": 220, "Strap": 100,
}
SHOE_PARTS = {"Sole": "Sole", "SoleStripe": None, "Upper": "Upper", "Strap0": "Strap", "Strap1": "Strap"}


def sub(name):
    """A collection under LOW (01_BODY…), or 10_LOD at the top."""
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        parent = bpy.context.scene.collection if name == "10_LOD" else col("LOW")
        parent.children.link(c)
    return c


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def copy_high(name, new, collection):
    """A copy of a HIGH part, its modifiers applied, as a new object in `collection`."""
    src = bpy.data.objects[name]
    me = src.data.copy()
    ob = bpy.data.objects.new(new, me)
    ob.matrix_world = src.matrix_world
    sub(collection).objects.link(ob)
    return own(ob)


def reduce_to(ob, target):
    """Decimate (collapse) to about `target` triangles, keeping the shape's outline."""
    have = tris(ob)
    if have > target:
        d = ob.modifiers.new("Decimate", "DECIMATE")
        d.ratio = target / have
        d.use_collapse_triangulate = False
        apply_all_modifiers(ob)
    return ob


def cut_along(ob, cuts):
    """Adds loops along a tube (a sleeve, a trouser leg): splits every edge that runs along it."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # An edge along the tube runs mostly up and down (the sleeves and the legs hang); a ring edge runs round it.
    along = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().z) > 0.6]
    bmesh.ops.subdivide_edges(bm, edges=along, cuts=cuts, use_grid_fill=True)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def merge(name, objects, collection):
    """Joins pieces into one object (materials kept per face) and deletes the pieces."""
    bpy.context.view_layer.update()
    mats = []
    bm = bmesh.new()
    for o in objects:
        me = o.data.copy()
        me.transform(o.matrix_world)
        idx = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            idx.append(mats.index(m))
        for p in me.polygons:
            p.material_index = idx[p.material_index] if idx else 0
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    for o in objects:
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    sub(collection).objects.link(ob)
    shade_smooth(ob, math.radians(60))
    return own(ob)


def body_pieces(skin):
    """The body from a skin chain at subdivision 1 (a loop at every joint), split into its pieces."""
    chain = skin_chain(
        "_body_low",
        {
            "spine": [(0, 0, CROTCH_Z + 0.02, 0.115), (0, 0, 0.65, 0.12), (0, 0, 0.82, 0.13), (0, 0, 0.9, 0.095), (0, 0, 0.97, 0.05), (0, 0, CHIN_Z + 0.03, 0.045)],
            # Chubby arms (the sheet's), still inside every top's sleeves.
            "arm_L": [(0, 0, 0.9, 0.095), (0.155, 0, 0.885, 0.05), (0.195, -0.005, 0.815, 0.05), (0.23, -0.01, 0.73, 0.047), (0.246, -0.02, 0.66, 0.044), (0.262, -0.03, 0.59, 0.039)],
            "arm_R": [(0, 0, 0.9, 0.095), (-0.155, 0, 0.885, 0.05), (-0.195, -0.005, 0.815, 0.05), (-0.23, -0.01, 0.73, 0.047), (-0.246, -0.02, 0.66, 0.044), (-0.262, -0.03, 0.59, 0.039)],
            "leg_L": [(0, 0, CROTCH_Z + 0.02, 0.115), (0.09, -0.01, 0.47, 0.075), (0.11, -0.012, 0.385, 0.068), (LEG_X, -0.015, 0.3, 0.06), (LEG_X, -0.015, 0.22, 0.052), (LEG_X, -0.015, ANKLE_Z, 0.045), (FOOT_X, -0.06, 0.06, 0.045), (FOOT_X, -0.16, 0.05, 0.04)],
            "leg_R": [(0, 0, CROTCH_Z + 0.02, 0.115), (-0.09, -0.01, 0.47, 0.075), (-0.11, -0.012, 0.385, 0.068), (-LEG_X, -0.015, 0.3, 0.06), (-LEG_X, -0.015, 0.22, 0.052), (-LEG_X, -0.015, ANKLE_Z, 0.045), (-FOOT_X, -0.06, 0.06, 0.045), (-FOOT_X, -0.16, 0.05, 0.04)],
        },
        collection="LOW",
        subdiv=1,
    )
    apply_all_modifiers(chain)
    # Split by region: arms out past the shoulder, legs below the hips, the rest is the torso and neck.
    # The neck is a piece of its own: no top ever covers it, so it shows whatever's worn.
    region = lambda c: "Arms" if abs(c.x) > 0.15 and c.z > 0.55 else "Legs" if c.z < CROTCH_Z + 0.04 else "Neck" if c.z > 0.94 and abs(c.x) < 0.09 else "Torso"
    bm = bmesh.new()
    bm.from_mesh(chain.data)
    pieces = {}
    for name in ("Neck", "Torso", "Arms", "Legs"):
        part = bm.copy()
        part.faces.ensure_lookup_table()
        bmesh.ops.delete(part, geom=[f for f in part.faces if region(f.calc_center_median()) != name], context="FACES")
        me = bpy.data.meshes.new(f"{A}_Body_{name}_LOD0")
        part.to_mesh(me)
        part.free()
        ob = bpy.data.objects.new(me.name, me)
        sub("01_BODY").objects.link(ob)
        assign(own(ob), skin)
        shade_smooth(ob, math.radians(180))
        pieces[name] = ob
    bm.free()
    bpy.data.objects.remove(chain, do_unlink=True)
    return pieces


def build(scene, args):
    for c in ("01_BODY", "02_HAIR", "03_FACIAL_HAIR", "04_TOPS", "05_BOTTOMS", "06_SHOES", "07_ACCESSORIES"):
        sub(c)
    sub("10_LOD")
    # The blockout leaves LOW for a collection of its own (kept, never exported).
    bo = col("BLOCKOUT")
    for ob in [o for o in col("LOW").objects if o.get("owner") == "phase:02_blockout"]:
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        bo.objects.link(ob)
    bpy.context.view_layer.layer_collection.children["BLOCKOUT"].exclude = True

    skin = bpy.data.materials["M_Skin"]
    body_pieces(skin)

    # Head: rigid (it turns on the neck as one; expressions are the face pieces).
    reduce_to(copy_high(f"{A}_Head_HIGH", f"{A}_Body_Head_LOD0", "01_BODY"), TRIS["Head"])
    hands = [reduce_to(copy_high(f"{A}_Hand_{s}_HIGH", f"_hand{s}", "01_BODY"), TRIS["Hand"]) for s in "LR"]
    merge(f"{A}_Body_Hands_LOD0", hands, "01_BODY")

    eyes = []
    for s in "LR":
        eyes.append(reduce_to(copy_high(f"{A}_Eye_{s}_HIGH", f"_eye{s}", "01_BODY"), TRIS["Eye"]))
        eyes.append(reduce_to(copy_high(f"{A}_EyeHighlight_{s}_HIGH", f"_hl{s}", "01_BODY"), TRIS["Highlight"]))
    merge(f"{A}_Face_Eyes_LOD0", eyes, "01_BODY")
    merge(f"{A}_Face_Brows_LOD0", [reduce_to(copy_high(f"{A}_Brow_{s}_HIGH", f"_brow{s}", "01_BODY"), TRIS["Brow"]) for s in "LR"], "01_BODY")
    merge(f"{A}_Face_Mouth_LOD0", [reduce_to(copy_high(f"{A}_Mouth_HIGH", "_mouth", "01_BODY"), TRIS["Mouth"])], "01_BODY")

    reduce_to(copy_high(f"{A}_Hair_HIGH", f"{A}_Hair_Wavy_LOD0", "02_HAIR"), TRIS["Hair"])

    tee = [copy_high(f"{A}_Tee_HIGH", "_tee", "04_TOPS")] + [reduce_to(copy_high(f"{A}_TeeSleeve_{s}_HIGH", f"_teesl{s}", "04_TOPS"), 120) for s in "LR"]
    merge(f"{A}_Top_Tee_LOD0", tee, "04_TOPS")

    # One top at a time (no shirts layered inside each other, which fight as the arms move): the open
    # hoodie brings its own white shirt inside, the tee's body without its sleeves.
    hoodie = [reduce_to(copy_high(f"{A}_Hoodie_HIGH", "_shell", "04_TOPS"), TRIS["Hoodie"]), copy_high(f"{A}_Tee_HIGH", "_inner", "04_TOPS")]
    for s in "LR":
        hoodie.append(reduce_to(copy_high(f"{A}_HoodieSleeve_{s}_HIGH", f"_sleeve{s}", "04_TOPS"), TRIS["Sleeve"]))
        hoodie.append(reduce_to(copy_high(f"{A}_HoodieCuff_{s}_HIGH", f"_cuff{s}", "04_TOPS"), TRIS["Cuff"]))
        hoodie.append(copy_high(f"{A}_Piping_{s}_HIGH", f"_pipe{s}", "04_TOPS"))
        hoodie.append(copy_high(f"{A}_Drawstring_{s}_HIGH", f"_string{s}", "04_TOPS"))
        hoodie.append(reduce_to(copy_high(f"{A}_Aglet_{s}_HIGH", f"_aglet{s}", "04_TOPS"), TRIS["Aglet"]))
    merge(f"{A}_Top_HoodieOpen_LOD0", hoodie, "04_TOPS")

    merge(f"{A}_Bottom_Trousers_LOD0", [reduce_to(copy_high(f"{A}_Trousers_HIGH", "_trousers", "05_BOTTOMS"), TRIS["Trousers"])], "05_BOTTOMS")

    shoes = []
    for s in "LR":
        for part, budget in SHOE_PARTS.items():
            ob = copy_high(f"{A}_{part}_{s}_HIGH", f"_{part}{s}", "06_SHOES")
            shoes.append(reduce_to(ob, TRIS[budget]) if budget else ob)
        shoes.append(reduce_to(copy_high(f"{A}_ShoeMark_{s}_HIGH", f"_mark{s}", "06_SHOES"), TRIS["ShoeMark"]))
    merge(f"{A}_Shoes_Sneakers_LOD0", shoes, "06_SHOES")

    # Clean-up: doubles, slivers and loose bits gone, caps and ngons as triangles, normals outward,
    # each mesh named as its object.
    lod0 = [o for o in col("LOW").all_objects if o.name.endswith("_LOD0") and o.type == "MESH" and o.get("owner") == OWNER_TAG]
    for ob in lod0:
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
    # LOD1 (about half) and LOD2 (about a fifth) of every LOD0 piece.
    for ob in lod0:
        for level, ratio in ((1, 0.5), (2, 0.22)):
            me = ob.data.copy()
            lod = bpy.data.objects.new(ob.name.replace("_LOD0", f"_LOD{level}"), me)
            me.name = lod.name
            sub("10_LOD").objects.link(lod)
            own(lod)
            d = lod.modifiers.new("Decimate", "DECIMATE")
            d.ratio = ratio
            apply_all_modifiers(lod)
    total = sum(tris(o) for o in lod0)
    for o in sorted(lod0, key=lambda o: o.name):
        log(f"{o.name:42s} {tris(o):6d} tris")
    mine = [o for o in col("10_LOD").objects if o.get("owner") == OWNER_TAG]
    # The base avatar as worn: the body pieces a hoodie leaves showing, the face, the hair, the hoodie (with its
    # shirt), the trousers and the shoes.
    worn = [o for o in lod0 if not any(k in o.name for k in ("Body_Torso", "Body_Arms", "Body_Legs", "Top_Tee"))]
    log("base avatar as worn", sum(tris(o) for o in worn))
    log("LOD0 total", total, "| LOD1", sum(tris(o) for o in mine if "_LOD1" in o.name), "| LOD2", sum(tris(o) for o in mine if "_LOD2" in o.name))
    # The forms step aside, as the blockout did: the game meshes are what's reviewed from here.
    for ob in col("HIGH").objects:
        ob.hide_render = True
    for ob in mine:
        ob.hide_render = True


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    clear_owned()
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
