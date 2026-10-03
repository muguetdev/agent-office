"""The car modelling kit build_cars.py uses: a body from a control cage smoothed by subdivision (the way a
car is modelled by hand, with creases where its character lines are), a glass cabin on top of it with
its pillars, wheel arches and a cockpit cut in, and details projected onto the finished surface (lights,
grilles, intakes, plates), so they follow its curves instead of sitting on it like stickers.

Office axes throughout (x left, y up, z forward, metres), turned into Blender's by `at`.
"""
import bpy, bmesh, math
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import aokit as ao
from aokit import TAU


def at(x, y, z):
    """Office axes (x left, y up, z forward) to Blender's (x left, -y forward, z up)."""
    return Vector((x, -z, y))


def office(v):
    """Blender's axes back to the office's."""
    return Vector((v.x, v.z, -v.y))


class Parts:
    """Shapes by material: each goes into its material's own mesh, joined into one object at the end."""

    def __init__(self):
        self.meshes = {}

    def of(self, mat):
        return self.meshes.setdefault(mat.name, bmesh.new())

    def build(self, name, smooth=True):
        obs = [ao.mesh_object(f"{name}.{m}", bm, [bpy.data.materials[m]], smooth=smooth) for m, bm in self.meshes.items()]
        ob = ao.join(obs[0], obs[1:])
        ob.name = ob.data.name = name
        return ob


def subdivide(ob, levels=2):
    mod = ob.modifiers.new("subsurf", 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    mod.use_creases = True
    ao.apply_modifier(ob, "subsurf")


def boolean(ob, cutter, transfer=False):
    mod = ob.modifiers.new("cut", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    if transfer:
        mod.material_mode = 'TRANSFER'
    mod.object = cutter
    ao.apply_modifier(ob, "cut")
    bpy.data.objects.remove(cutter, do_unlink=True)


# ---- The body ---------------------------------------------------------------------------------------

def body_cage(name, stations, mat, crease_at=(4,), crease=0.85):
    """
    The body's control cage: at each station (z, bottom, [six points up the left side], top) a ring from
    the bottom middle up the left side to the top middle and back down the right, quads between the
    stations, the nose and the tail closed. The longitudinal edges through the side points `crease_at`
    (1-based) are creased, for a character line that subdivision keeps sharp.
    """
    bm = bmesh.new()
    cl = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    rings = []
    for z, bottom, side, top in stations:
        half = [(0.0, bottom)] + list(side) + [(0.0, top)]
        ring = [(x, y) for x, y in half] + [(-x, y) for x, y in reversed(side)]
        rings.append([bm.verts.new(at(x, y, z)) for x, y in ring])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bm.edges.ensure_lookup_table()
    marks = set()
    for k in crease_at:
        marks.add(k)
        marks.add(n - k)
    for a, b in zip(rings, rings[1:]):
        for i in marks:
            e = bm.edges.get((a[i], b[i]))
            if e:
                e[cl] = crease
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return ao.mesh_object(name, bm, [mat], smooth=True)


def arches(ob, axles, r, wheel_y, inner, liner_mat):
    """Wheel arches cut up into the fenders over each axle, and their dark linings inside."""
    for z in axles:
        for sx in (-1, 1):
            bm = bmesh.new()
            ao.cylinder(bm, at(sx * inner, wheel_y, z), at(sx * 1.4, wheel_y, z), r, segs=40)
            boolean(ob, ao.mesh_object("_arch", bm))
    bm = bmesh.new()
    rr = r - 0.008
    a0 = math.asin(max(-1.0, min(1.0, (0.12 - wheel_y) / rr)))
    for z in axles:
        for sx in (-1, 1):
            ring = []
            for i in range(25):
                a = a0 + (math.pi - 2 * a0) * i / 24
                ring.append([bm.verts.new(at(x, wheel_y + rr * math.sin(a), z + rr * math.cos(a))) for x in (sx * inner, sx * 0.88)])
            for p, q in zip(ring, ring[1:]):
                bm.faces.new((p[0], q[0], q[1], p[1]))
    return ao.mesh_object("_liner", bm, [liner_mat])


def cockpit(ob, front, back, floor, width, mat):
    """Hollows the cockpit out of the body, its floor and walls in `mat`, so with the roof off you sit in the car."""
    bm = bmesh.new()
    ao.box(bm, at(0, floor + 0.6, (front + back) / 2), (width, front - back, 1.2), bevel=0.1, segments=3)
    cutter = ao.mesh_object("_cockpit", bm, [mat])
    boolean(ob, cutter, transfer=True)


# ---- The cabin --------------------------------------------------------------------------------------

def greenhouse(name, stations, segments, mats, trim=0.035):
    """
    The cabin over the body: at each station (z, belt y, belt half-width, rail y, rail half-width, roof y)
    a ring from the left beltline up the side window to the roof rail, over the roof, and down the right.
    `segments` gives, between each pair of stations, what the side is and what the top is ('glass',
    'paint', 'dark'): the windshield, the roof and the back window along the top, the windows and
    pillars down the sides. Along the bottom of the side windows runs a thin dark trim.
    """
    bm = bmesh.new()
    rings = []
    for z, by, bx, ry, rx, top in stations:
        half = [(bx, by), (bx - 0.006, by + trim), (rx, ry), (rx - 0.07, ry + 0.035), (0.0, top)]
        ring = half + [(-x, y) for x, y in reversed(half[:-1])]
        rings.append([bm.verts.new(at(x, y, z)) for x, y in ring])
    n = len(rings[0])
    order = {'glass': 0, 'paint': 1, 'dark': 2}
    for k, (a, b) in enumerate(zip(rings, rings[1:])):
        side, topm = segments[k]
        for i in range(n - 1):
            f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
            band = min(i, n - 2 - i)
            # 0: the trim; 1: the side window (or pillar); 2: the rail; 3: the top.
            m = 'dark' if band == 0 else side if band == 1 else 'paint' if band == 2 else topm
            f.material_index = order[m]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    if sum(f.normal.z for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    ob = ao.mesh_object(name, bm, [mats['glass'], mats['paint'], mats['dark']], smooth=True)
    return ob


# ---- Projected details ------------------------------------------------------------------------------

class Surface:
    """The finished body, for laying details onto it: a ray cast at it from the front, the back, a side or above."""

    def __init__(self, ob):
        dg = bpy.context.evaluated_depsgraph_get()
        self.tree = BVHTree.FromObject(ob, dg)

    def hit(self, u, v, view):
        """Where a ray from `view` ('front', 'back', 'left', 'right', 'top') lands at (u, v) across it: (point, normal) in office axes."""
        if view == 'front':
            o, d = at(u, v, 5), Vector((0, 1, 0))
        elif view == 'back':
            o, d = at(u, v, -5), Vector((0, -1, 0))
        elif view == 'left':
            o, d = at(3, v, u), Vector((-1, 0, 0))
        elif view == 'right':
            o, d = at(-3, v, u), Vector((1, 0, 0))
        else:
            o, d = at(u, 4, v), Vector((0, 0, -1))
        loc, nor, _, _ = self.tree.ray_cast(o, d, 20)
        if loc is None:
            return None
        return loc, nor

    def decal(self, bm, outline, view, lift=0.004, rings=3):
        """A patch shaped like `outline` (points across the view: x and y, or z and y from a side, x and z
        from above), laid onto the surface and lifted `lift` off it, filled with rings toward its middle so
        it bends with the body. Points the ray misses are dropped."""
        cx = sum(p[0] for p in outline) / len(outline)
        cy = sum(p[1] for p in outline) / len(outline)
        grid = []
        for k in range(rings + 1):
            t = 1 - k / (rings + 1)
            row = []
            for u, v in outline:
                h = self.hit(cx + (u - cx) * t, cy + (v - cy) * t, view)
                row.append(bm.verts.new(h[0] + h[1] * lift) if h else None)
            grid.append(row)
        h = self.hit(cx, cy, view)
        mid = bm.verts.new(h[0] + h[1] * lift) if h else None
        n = len(outline)
        for a, b in zip(grid, grid[1:]):
            for i in range(n):
                q = (a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])
                if all(q):
                    bm.faces.new(q)
        if mid:
            for i in range(n):
                tri = (grid[-1][i], grid[-1][(i + 1) % n], mid)
                if all(tri):
                    bm.faces.new(tri)
        # Every face looks out of the body, the way the surface does under it (the office draws one side only).
        out = h[1] if h else None
        if out is not None:
            ours = {v for row in grid for v in row if v} | ({mid} if mid else set())
            for f in {f for v in ours for f in v.link_faces}:
                f.normal_update()
                if f.normal.dot(out) < 0:
                    f.normal_flip()

    def ring(self, bm, u, v, view, r, tube, lift=0.006):
        """A ring (an angel eye, a light's surround) lying on the surface at (u, v)."""
        h = self.hit(u, v, view)
        if not h:
            return
        loc, nor = h
        verts = ao.torus(bm, (0, 0, 0), r, tube, n=24, m=6)
        turn = nor.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(loc + nor * lift) @ turn, verts=verts)


def rounded(x0, y0, x1, y1, r, n=4):
    """A rounded rectangle's outline, counter-clockwise."""
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -math.pi / 2), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, math.pi / 2), (x0 + r, y0 + r, math.pi)):
        for i in range(n + 1):
            a = a0 + (math.pi / 2) * i / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def mirror(pts):
    """An outline drawn for the left, for the right side (x mirrored, order kept counter-clockwise)."""
    return [(-x, y) for x, y in reversed(pts)]


# ---- Wheels -----------------------------------------------------------------------------------------

def wheel(name, side, radius, width, rim_r, mats, spokes=5, double=False):
    """A wheel at the origin, its outside to `side` (+1 left): a tire, a rim of spokes, its hub, and the
    brake caliper behind the spokes. `mats` gives tire, rim and caliper."""
    tire, rim, cal = mats
    parts = Parts()
    w = width
    prof = [(rim_r, -w / 2), (rim_r + 0.03, -w / 2 - 0.004), (radius - 0.02, -w / 2 + 0.02), (radius, -w / 4), (radius, w / 4),
            (radius - 0.02, w / 2 - 0.02), (rim_r + 0.03, w / 2 + 0.004), (rim_r, w / 2)]
    ao.lathe(parts.of(tire), prof, rot=(0, math.pi / 2, 0), segs=24)
    o = side * (w / 2 - 0.02)
    r = parts.of(rim)
    ao.cylinder(r, (-side * w / 2 * 0.6, 0, 0), (o - side * 0.02, 0, 0), rim_r, segs=24)
    ao.torus(r, (o, 0, 0), rim_r - 0.005, 0.014, rot=(0, math.pi / 2, 0), n=24, m=4)
    ao.cylinder(r, (o - side * 0.05, 0, 0), (o + side * 0.01, 0, 0), 0.05, segs=16)
    for i in range(spokes):
        for d in ((-0.11, 0.11) if double else (0.0,)):
            a = TAU * i / spokes + d
            c, s = math.cos(a), math.sin(a)
            reach = rim_r * 0.58
            ao.box(r, (o - side * 0.01, -s * reach, c * reach), (0.03, 0.026 if double else 0.045, rim_r * 0.9), bevel=0.008, rot=(a, 0, 0), segments=1)
    ao.box(parts.of(cal), (o - side * 0.075, -rim_r * 0.5, rim_r * 0.45), (0.05, rim_r * 0.5, rim_r * 0.32), bevel=0.015, rot=(-0.8, 0, 0), segments=2)
    return parts.build(name)
