"""The cars that drive round the street and the scenic loop by themselves (features/traffic): a police
car, a taxi, an SUV and two everyday cars, Quaternius's low-poly ones (CC0: blender/assets/cars/README.md)
as they come, each one piece, exported to src/client/models/traffic.glb.

    blender --background --factory-startup --python blender/scripts/build_traffic.py

Each car is one root named after it (see TRAFFIC), nose forward (-y here, +z in the office), on the
ground at the origin, about as long as the garage's cars. Its materials keep the source's names with a
T prefix (TBlack, TWindows…), which features/traffic/world.ts paints.
"""
import bpy, os, sys
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "cars")
TRAFFIC = {"police": "police.glb", "taxi": "taxi.glb", "suv": "suv.glb", "car": "car.glb", "hatch": "hatch.glb"}
LENGTH = 4.3


def build(name, file):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, file))
    meshes = []
    for ob in [o for o in bpy.data.objects if o not in before]:
        if ob.type != 'MESH':
            bpy.data.objects.remove(ob, do_unlink=True)
            continue
        ob.data.transform(ob.matrix_world)
        ob.parent = None
        ob.matrix_world = Matrix()
        meshes.append(ob)
    body = max(meshes, key=lambda o: len(o.data.polygons))
    ao.join(body, [o for o in meshes if o is not body])
    pts = [v.co for v in body.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    k = LENGTH / (hi.y - lo.y)
    body.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    # One material per source name, T-prefixed; the same name shares one material across the cars.
    for i, m in enumerate(body.data.materials):
        base = m.name.split(".")[0]
        if base.startswith("Material"):
            base = "Trim"
        want = f"T{base}"
        body.data.materials[i] = bpy.data.materials.get(want) or bpy.data.materials.new(want)
    for p in body.data.polygons:
        p.use_smooth = False
    body.name = body.data.name = name
    return body


def main():
    ao.clear()
    for name, file in TRAFFIC.items():
        build(name, file)
    ao.export("traffic")
    for ob in bpy.context.scene.objects:
        print(f"  {ob.name}: {ao.tris(ob)} tris, {sorted({m.name for m in ob.data.materials if m})}")


if __name__ == "__main__":
    main()
