"""The garage's cars: the Lambos, the Ferraris and the BMW parked out front, made from Quaternius's
low-poly cars (CC0, public domain: blender/assets/cars/README.md) and exported to
src/client/models/cars.glb for src/client/features/cars/world.ts, which paints each car its own colour.
This script fits each one to the office: its size, its wheels, the materials the office paints, and
the parts it takes apart while someone's in it. The shared helpers are aokit.py, the conventions
blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet of each car; `--only bmw`
builds and shoots just that one, without exporting):

    blender --background --factory-startup --python blender/scripts/build_cars.py [-- --shots] [--only <kind>]

Each car is seven roots, named after its kind:
  <kind>          the body, with its lights and trim
  <kind>_top      the glass cabin and its painted roof and pillars, which the office takes off while anyone's in it
  <kind>_open     what's left with the roof off: the windshield (see-through Screen), the dashboard, the
                  seats and the steering wheel
  <kind>_wheel_l  the front wheels, each with its origin at its hub: the office turns them to steer, and
  <kind>_wheel_r  rolls them as the car goes
  <kind>_rear_l   the rear wheels, each with its origin at its hub, which the office rolls
  <kind>_rear_r

All stand on the floor at the origin under the car's middle, nose forward, within shared/garage.ts's
CAR footprint (4.6 long, 2 wide), so the colliders stay as they are. Roots and material names are a
contract with features/cars/world.ts and tests/cars-model.test.ts: rename them in all three places.
"""
import bmesh, bpy, os, sys
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "cars")

# Preview colours only: features/cars/world.ts paints every material by name, Paint with each car's own colour.
COLORS = {
    "Paint": "#6c7378",
    "Glass": "#233347",
    "Screen": "#9fc3e6",
    "Dark": "#2b2d42",
    "Tire": "#1f1f26",
    "RimGold": "#e9b949",
    "RimSilver": "#d9dbe3",
    "RimGrey": "#7d838b",
    "Lamp": "#fff6c9",
    "Tail": "#ff2d3f",
    "Seat": "#3a3340",
}


def material(name):
    return ao.material(name, COLORS[name])


def at(x, y, z):
    """Office axes (x left, y up, z forward) to Blender's (x left, -y forward, z up)."""
    return Vector((x, -z, y))


# Each car: its source (Quaternius's, nose to -y, z up), how much it's stretched across, along and up
# to the real car's proportions in the office's footprint, its rims, what its materials become (the
# body's colour is Paint; the wheels' Black and Grey are the tyre and the rim, and elsewhere they, like
# the lower trim, are Dark), and where its front seats are along it (office z, as in shared/garage.ts SEATS_OF).
CARS = {
    # A BMW F30 328i: a long, upright three-box saloon.
    "bmw": {"file": "sports-car.glb", "scale": (1.08, 1.155, 1.2), "rim": "RimGrey", "paint": {"Orange"}, "seats": 0.05},
    # A Lamborghini Huracán: the coupé, lower and on gold rims.
    "lambo": {"file": "sports-car-2.glb", "scale": (1.06, 1.145, 0.92), "rim": "RimGold", "paint": {"White"}, "seats": -0.5},
    # A Ferrari F8: the coupé as it is.
    "ferrari": {"file": "sports-car-2.glb", "scale": (1.06, 1.145, 1.0), "rim": "RimSilver", "paint": {"White"}, "seats": -0.5},
}

def load(kind):
    """The source car, its transforms applied: its "body", "rear" wheels and "left" and "right" front ones."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, CARS[kind]["file"]))
    parts = {}
    for ob in [o for o in bpy.data.objects if o not in before]:
        if ob.type != 'MESH':
            bpy.data.objects.remove(ob, do_unlink=True)
            continue
        ob.data.transform(ob.matrix_world)
        ob.parent = None
        ob.matrix_world = Matrix()
        role = "rear" if "BackWheels" in ob.name else "left" if "FrontLeftWheel" in ob.name else "right" if "FrontRightWheel" in ob.name else "body"
        parts[role] = ob
    return parts


def middle(points):
    lo = Vector((min(v.x for v in points), min(v.y for v in points), min(v.z for v in points)))
    hi = Vector((max(v.x for v in points), max(v.y for v in points), max(v.z for v in points)))
    return (lo + hi) / 2


def stretch(parts, scale):
    """Stretches the body by `scale`; each wheel only grows as much as the body does upward (`scale`'s
    z), about its hub, so it stays round, and its hub goes where the stretched body has it."""
    S = Matrix.Diagonal(Vector(scale)).to_4x4()
    parts["body"].data.transform(S)
    for role in ("rear", "left", "right"):
        me = parts[role].data
        # The rear wheels are one mesh: each side about its own hub.
        for side in (1, -1) if role == "rear" else (0,):
            vs = [v for v in me.vertices if not side or (v.co.x > 0) == (side > 0)]
            hub = middle([v.co for v in vs])
            to = S @ hub
            for v in vs:
                v.co = to + (v.co - hub) * scale[2]


def remap(ob, kind, wheel):
    """Its materials as the office paints them."""
    spec = CARS[kind]
    names = []
    for m in ob.data.materials:
        n = m.name.split(".")[0] if m and not m.name.startswith("Material.") else ""
        if wheel:
            names.append("Tire" if n == "Black" else spec["rim"])
        else:
            names.append("Paint" if n in spec["paint"] else {"Windows": "Glass", "Headlights": "Lamp", "TailLights": "Tail"}.get(n, "Dark"))
    wanted = sorted(set(names))
    faces = [wanted.index(names[p.material_index]) for p in ob.data.polygons]
    # Clearing the slots puts every face on the first: each goes back on its own after.
    ob.data.materials.clear()
    for n in wanted:
        ob.data.materials.append(material(n))
    for p, i in zip(ob.data.polygons, faces):
        p.material_index = i
        p.use_smooth = False


def split_cabin(body, kind):
    """Takes the glass, and the roof and pillars round it, off the body into <kind>_top: the paint over
    the bottom of the windows, between the windshield's foot and the rear window's. Returns it, the
    windshield's faces (they stay behind, see-through) and how high the windows start."""
    me = body.data
    glass, paint = me.materials.find("Glass"), me.materials.find("Paint")
    panes = [me.vertices[i].co for p in me.polygons if p.material_index == glass for i in p.vertices]
    belt = min(v.z for v in panes) - 0.005
    y0, y1 = min(v.y for v in panes) - 0.005, max(v.y for v in panes) + 0.005
    bm = bmesh.new()
    bm.from_mesh(me)
    top = [f for f in bm.faces if f.material_index == glass or (f.material_index == paint and all(v.co.z >= belt and y0 <= v.co.y <= y1 for v in f.verts))]
    shield = [[v.co.copy() for v in f.verts] for f in top if f.material_index == glass and f.normal.y < -0.35]
    out = bmesh.new()
    made = {}
    for f in top:
        nf = out.faces.new([made.setdefault(v.index, out.verts.new(v.co)) for v in f.verts])
        nf.material_index = f.material_index
    bmesh.ops.delete(bm, geom=top, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return ao.mesh_object(f"{kind}_top", out, list(me.materials), smooth=False), shield, belt


def opened(kind, shield, belt):
    """With the roof off: the windshield as see-through Screen, a dashboard under it, two seats (their
    cushions at shared/garage.ts SEAT_HIPS) and a steering wheel in front of the driver."""
    bm = bmesh.new()
    for f in shield:
        bm.faces.new([bm.verts.new(v) for v in f])
    seat = CARS[kind]["seats"]
    # The windshield's foot, in office z (Blender's y runs the other way).
    dash = -max(v.y for f in shield for v in f)
    n = len(bm.faces)
    ao.box(bm, at(0, belt - 0.12, dash - 0.15), (1.5, 0.3, 0.22), bevel=0.04, segments=2)
    ao.cylinder(bm, at(0.42, belt - 0.05, dash - 0.25), at(0.42, 0.9, seat + 0.48), 0.025, segs=8)
    ao.torus(bm, at(0.42, 0.92, seat + 0.42), 0.17, 0.025, rot=(1.2, 0, 0), n=20, m=6)
    for f in bm.faces[n:]:
        f.material_index = 1
    n = len(bm.faces)
    for x in (0.42, -0.42):
        ao.box(bm, at(x, 0.38, seat), (0.5, 0.14, 0.52), bevel=0.04, segments=2)
        ao.box(bm, at(x, 0.72, seat - 0.3), (0.5, 0.62, 0.12), bevel=0.04, rot=(-0.2, 0, 0), segments=2)
    for f in bm.faces[n:]:
        f.material_index = 2
    return ao.mesh_object(f"{kind}_open", bm, [material("Screen"), material("Dark"), material("Seat")], smooth=False)


def build(kind):
    parts = load(kind)
    stretch(parts, CARS[kind]["scale"])
    body, rear, left, right = parts["body"], parts["rear"], parts["left"], parts["right"]
    remap(body, kind, False)
    for w in (rear, left, right):
        remap(w, kind, True)
    # Standing on its tyres at 0, its middle over the origin.
    points = [v.co for o in (body, rear, left, right) for v in o.data.vertices]
    mid = middle(points)
    shift = Matrix.Translation(Vector((-mid.x, -mid.y, -min(v.z for v in points))))
    for o in (body, rear, left, right):
        o.data.transform(shift)
    top, shield, belt = split_cabin(body, kind)
    inside = opened(kind, shield, belt)
    body.name = body.data.name = kind
    # The rear wheels are one mesh, both sides: each side on its own, about its own hub, to roll.
    rears = []
    for side, name in ((1, f"{kind}_rear_l"), (-1, f"{kind}_rear_r")):
        w = rear.copy()
        w.data = rear.data.copy()
        bpy.context.collection.objects.link(w)
        bm = bmesh.new()
        bm.from_mesh(w.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if (v.co.x > 0) != (side > 0)], context='VERTS')
        bm.to_mesh(w.data)
        bm.free()
        w.name = w.data.name = name
        ao.set_origin(w, middle([v.co for v in w.data.vertices]))
        rears.append(w)
    bpy.data.objects.remove(rear, do_unlink=True)
    # The right front wheel is the left one mirrored, so the two are the same, hubs and all.
    mirrored = left.data.copy()
    mirrored.transform(Matrix.Diagonal(Vector((-1, 1, 1, 1))))
    mirrored.flip_normals()
    old, right.data = right.data, mirrored
    bpy.data.meshes.remove(old)
    for w, name in ((left, f"{kind}_wheel_l"), (right, f"{kind}_wheel_r")):
        w.name = w.data.name = name
        ao.set_origin(w, middle([v.co for v in w.data.vertices]))
    return [body, top, inside, left, right, *rears]


def main(write=True, only=None):
    ao.clear()
    roots = []
    for kind in ([only] if only else ("lambo", "ferrari", "bmw")):
        roots += build(kind)
    if write and not only:
        ao.export("cars")
    return roots


def show(kind, roof=True):
    def setup():
        for ob in bpy.context.scene.objects:
            if ob.type == 'MESH':
                hide = not ob.name.startswith(kind) or ob.name.endswith("_open" if roof else "_top")
                ob.hide_render = hide
    return setup


if __name__ == "__main__":
    args = ao.args()
    only = args[args.index("--only") + 1] if "--only" in args else None
    main(only=only)
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            box = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
            span = " ".join(f"{a} {min(v[i] for v in box):.3f}..{max(v[i] for v in box):.3f}" for i, a in enumerate("xyz"))
            print(f"  {ob.name}: {ao.tris(ob)} tris, {[m.name for m in ob.data.materials if m]}, at {tuple(round(v, 3) for v in ob.location)}, {span}")
    if "--shots" in args:
        for kind in ([only] if only else ("lambo", "ferrari", "bmw")):
            print(ao.sheet(f"cars-{kind}", [(show(kind), "tq"), (None, "side"), (None, "front"), (None, "back"), (None, "low"), (None, "top"), (show(kind, False), "tq")], cell=(560, 400), target=(0, 0, 0.6), dist=7.2))
