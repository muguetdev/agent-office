"""The cars that drive round the street and the scenic loop by themselves (features/traffic): a police
car, a taxi, an SUV and two everyday cars, Quaternius's low-poly ones (CC0: blender/assets/cars/README.md)
as they come, exported to src/client/models/traffic.glb.

    blender --background --factory-startup --python blender/scripts/build_traffic.py

Each car is one root named after it (see TRAFFIC), nose forward (-y here, +z in the office), on the
ground at the origin, about as long as the garage's cars, with its four wheels as children, each with
its origin at its hub so the office can roll it: <name>_wheel_fl, _fr, _rl and _rr (front/rear,
left/right). Its materials keep the source's names with a T prefix (TBlack, TWindows…), which
features/traffic/index.ts paints.
"""
import bmesh, bpy, os, sys
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
    wheels = {"fl": next(o for o in meshes if "FrontLeftWheel" in o.name), "fr": next(o for o in meshes if "FrontRightWheel" in o.name)}
    back = next(o for o in meshes if "BackWheels" in o.name)
    body = next(o for o in meshes if o not in (back, *wheels.values()))
    ao.join(body, [o for o in meshes if o not in (body, back, *wheels.values())])
    pts = [v.co for o in meshes if o.name in bpy.data.objects for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    k = LENGTH / (hi.y - lo.y)
    fit = Matrix.Scale(k, 4) @ Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    for o in (body, back, *wheels.values()):
        o.data.transform(fit)
    # The back wheels are one mesh, both sides: each side on its own. Left is +x, as in the office.
    for side, key in ((1, "rl"), (-1, "rr")):
        w = back.copy()
        w.data = back.data.copy()
        bpy.context.collection.objects.link(w)
        bm = bmesh.new()
        bm.from_mesh(w.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if (v.co.x > 0) != (side > 0)], context='VERTS')
        bm.to_mesh(w.data)
        bm.free()
        wheels[key] = w
    bpy.data.objects.remove(back, do_unlink=True)
    for o in (body, *wheels.values()):
        # One material per source name, T-prefixed; the same name shares one material across the cars.
        for i, m in enumerate(o.data.materials):
            base = m.name.split(".")[0]
            if base.startswith("Material"):
                base = "Trim"
            want = f"T{base}"
            o.data.materials[i] = bpy.data.materials.get(want) or bpy.data.materials.new(want)
        for p in o.data.polygons:
            p.use_smooth = False
    body.name = body.data.name = name
    for key, w in wheels.items():
        w.name = w.data.name = f"{name}_wheel_{key}"
        vs = [v.co for v in w.data.vertices]
        ao.set_origin(w, Vector(((min(v.x for v in vs) + max(v.x for v in vs)) / 2, (min(v.y for v in vs) + max(v.y for v in vs)) / 2, (min(v.z for v in vs) + max(v.z for v in vs)) / 2)))
        w.parent = body
    return body


def main():
    ao.clear()
    for name, file in TRAFFIC.items():
        build(name, file)
    ao.export("traffic")
    for ob in bpy.context.scene.objects:
        print(f"  {ob.name}: {ao.tris(ob)} tris, {sorted({m.name for m in ob.data.materials if m})}, at {tuple(round(v, 3) for v in ob.location)}")


if __name__ == "__main__":
    main()
