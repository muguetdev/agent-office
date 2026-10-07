"""
CH_OfficeAvatar, phase 9: the delivery copy. The master as it ships: the pose test clip (a review tool)
and the animators' IK controls left out, every LOD visible, every armature in its rest pose, saved as CH_OfficeAvatar_delivery.blend for export_delivery.py.

  blender --background --python build/09_delivery.py -- --master CH_OfficeAvatar_master.blend
"""
import bpy, os, sys

master = os.path.abspath(sys.argv[sys.argv.index("--") + 2])
bpy.ops.wm.open_mainfile(filepath=master)
for name in ("PoseTest",):
    act = bpy.data.actions.get(name)
    if act:
        bpy.data.actions.remove(act)
rig = bpy.data.objects["CH_OfficeAvatar_Rig"]
# The animators' controls stay in the master: no IK constraints, no ik_/pole_ bones in what ships.
for pb in rig.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for eb in [b for b in rig.data.edit_bones if b.name.startswith(("ik_", "pole_"))]:
    rig.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode="OBJECT")
# Every mesh valid for export (Blender's own check fixes stray loose edges and degenerate loops that
# simplification leaves; the exporter warns about them otherwise).
fixed = [o.name for o in bpy.data.objects if o.type == "MESH" and "_LOD" in o.name and o.data.validate()]
print("[09_delivery] validated, fixed:", fixed)
# Every LOD ships (they're hidden from the master's review renders).
for o in bpy.data.objects:
    if o.type == "MESH" and "_LOD" in o.name:
        o.hide_render = False
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_euler = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
out = os.path.join(os.path.dirname(master), "CH_OfficeAvatar_delivery.blend")
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=out)
print("[09_delivery] saved", out, "clips:", sorted(a.name for a in bpy.data.actions))
