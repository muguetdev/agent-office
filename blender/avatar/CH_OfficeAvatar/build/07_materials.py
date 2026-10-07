"""
CH_OfficeAvatar, phase 7: the customizable material system. Every game mesh (all LODs) uses a small set of
shared materials, one per role, by name; the game paints each role with the player's colour at runtime
(three.js: a toon material per role per avatar, or shared ones per palette), so no mesh or texture is
duplicated for a skin tone, a hair colour or a hoodie colour.

  Role (material)        What uses it                                          Runtime colour
  M_Skin                 head, neck, torso, arms, hands, legs                  skin tone
  M_Hair                 every hairstyle, the brows, both beards               hair colour
  M_PrimaryClothing      the hoodie, the jacket, a tee worn on its own         clothing colour
  M_SecondaryClothing    the hoodie's shirt, piping and drawstrings, the zip   trim colour
  M_Pants                trousers, joggers                                     pants colour
  M_Shoes                the shoes' uppers and soles                           shoe colour
  M_ShoesAccent          the shoes' stripes and side marks                     shoe accent colour
  M_Accessories          glasses                                               accessory colour
  M_Eyes, M_EyeHighlight, M_Mouth, M_Teeth                                     fixed

The roles, their defaults (the concept sheet's base outfit) and the palettes offered for each (the sheet's
"Cores base") are written to avatar-palette.json. Every mesh is also unwrapped (Smart UV), so a print or
a logo can go on later without re-cutting.

  blender --background --python build/07_materials.py -- --master CH_OfficeAvatar_master.blend
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, "_kit.py")).read())

PHASE = "07_materials"
OWNER_TAG = "phase:" + PHASE
A = "CH_OfficeAvatar"


def srgb(h):
    """'#rrggbb' as a linear RGBA tuple (Blender's base colour is linear)."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


ROLES = {
    "M_Skin": {"default": "#F7D2B4", "roughness": 0.7, "palette": ["#F7D2B4", "#E3A97F", "#B07A57", "#5E3B2A"]},
    "M_Hair": {"default": "#4A2C22", "roughness": 0.55, "palette": ["#4A2C22", "#1E1A1A", "#E9B95B", "#E8642C"]},
    "M_PrimaryClothing": {"default": "#3E7DF1", "roughness": 0.85, "palette": ["#3E7DF1", "#2E8A84", "#FFC21F", "#F26B4F", "#8E5CC9", "#F3EEE4", "#2B2F37"]},
    "M_SecondaryClothing": {"default": "#F4F4F2", "roughness": 0.85, "palette": ["#F4F4F2", "#2B2F37", "#FFC21F"]},
    "M_Pants": {"default": "#2A3044", "roughness": 0.8, "palette": ["#2A3044", "#3B4256", "#7F858F", "#B8A486"]},
    "M_Shoes": {"default": "#F4F4F4", "roughness": 0.45, "palette": ["#F4F4F4", "#2F7FF0", "#2B2F37", "#B9BCC2"]},
    "M_ShoesAccent": {"default": "#2F7FF0", "roughness": 0.5, "palette": ["#2F7FF0", "#F4F4F4", "#2B2F37", "#2E8A84"]},
    "M_Accessories": {"default": "#22252B", "roughness": 0.35, "palette": ["#22252B", "#2F7FF0", "#B07A57", "#C9A227"]},
}
FIXED = {"M_Eyes": ("#17120F", 0.2), "M_EyeHighlight": ("#FFFFFF", 0.2), "M_Mouth": ("#8A2E22", 0.9), "M_Teeth": ("#FAFAF7", 0.7)}


def build(scene, args):
    for name, r in ROLES.items():
        material(name, srgb(r["default"]), r["roughness"])
    for name, (h, rough) in FIXED.items():
        material(name, srgb(h), rough)

    meshes = [o for o in list(col("LOW").all_objects) + list(col("10_LOD").objects) if o.type == "MESH" and "_LOD" in o.name]
    # A tee worn on its own is the outfit's main colour (inside the hoodie it's the shirt, the trim colour).
    for ob in meshes:
        if "_Top_Tee_" in ob.name:
            ob.data.materials.clear()
            ob.data.materials.append(bpy.data.materials["M_PrimaryClothing"])
            for p in ob.data.polygons:
                p.material_index = 0
    # Nothing but the role materials.
    known = set(ROLES) | set(FIXED)
    for ob in meshes:
        for m in ob.data.materials:
            if m.name not in known:
                raise SystemExit(f"{ob.name} uses {m.name}, which isn't a role material")
    # UVs on every mesh that lacks them.
    for ob in meshes:
        if not ob.data.uv_layers:
            smart_uv(ob, angle=66.0, margin=0.01, seams_from_sharp=False)
    # The palette for the game.
    out = os.path.join(os.path.dirname(os.path.abspath(args.master)), "avatar-palette.json")
    with open(out, "w") as f:
        json.dump({"roles": {k: {"default": v["default"], "palette": v["palette"]} for k, v in ROLES.items()},
                   "fixed": {k: v[0] for k, v in FIXED.items()}}, f, indent=2)
    log(len(meshes), "meshes on", len(known), "role materials; palette at", out)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--master", required=True)
    a = p.parse_args(argv_after_dashes())
    scene = open_master(a.master)
    build(scene, a)
    save_master(a.master)
    log("saved", a.master)
