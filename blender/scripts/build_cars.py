"""The garage's cars, at the real cars' proportions: a Lamborghini Huracán (a low, sharp wedge with a
wing), a Ferrari F8 (curvy, long-nosed, four round taillights) and the BMW parked out front (an F30
328i sedan in M Sport trim). Modelled by this script and exported to src/client/models/cars.glb for
src/client/features/cars/world.ts, which paints each car its own colour. The modelling kit is
carkit.py (a subdivided body cage, a cabin with its pillars, details projected onto the body), the
shared helpers aokit.py, and the conventions blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet of each car; `--only bmw`
builds and shoots just that one, without exporting):

    blender --background --factory-startup --python blender/scripts/build_cars.py [-- --shots] [--only <kind>]

Each car is five roots, named after its kind:
  <kind>          the body, with the rear wheels, lights, grilles, intakes, plates and mirrors
  <kind>_top      the glass cabin and its painted roof, which the office takes off while anyone's in it
  <kind>_open     what's left with the roof off: the windshield (see-through Screen), the dashboard, the
                  seats and the steering wheel
  <kind>_wheel_l  the front wheels, each with its origin at its hub: the office turns them to steer
  <kind>_wheel_r

All stand on the floor at the origin under the car's middle, nose forward, within shared/garage.ts's
CAR footprint (4.6 long, 2 wide), so the colliders stay as they are. Roots and material names are a
contract with features/cars/world.ts and tests/cars-model.test.ts: rename them in all three places.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
import carkit as ck
from carkit import at, rounded, mirror

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
    "Caliper": "#e63946",
    "CaliperBlue": "#1c69d4",
    "Roundel": "#1c69d4",
    "Lamp": "#fff6c9",
    "Tail": "#ff2d3f",
    "Chrome": "#c9ccd6",
    "Badge": "#ffd400",
    "Seat": "#3a3340",
    "Plate": "#f4f6f8",
    "PlateBand": "#1d4fa8",
}


def material(name):
    return ao.material(name, COLORS[name])


# ---- Each car ---------------------------------------------------------------------------------------
#
# body: the cage's stations nose to tail, (z, bottom, six points up the left side (x, y), top middle);
#   the fourth point is the shoulder line, creased.
# cabin: the cabin's stations (z, belt y, belt half-width, rail y, rail half-width, roof y), and what each
#   stretch between them is along the side and over the top.
# axles (front, rear), wheel (radius, width, rim radius, x out to its middle, spokes, double spokes),
#   rim and caliper materials, arch radius.
# seats: where the front seats are (x, z), and a back bench (z) for the sedan; the cockpit (front, back, floor).
# screen: the windshield with the roof off (its foot z, y; its top z, y); the dashboard (z, y).

CARS = {
    "bmw": {
        "body": [
            (2.29, 0.26, [(0.52, 0.26), (0.60, 0.36), (0.62, 0.54), (0.60, 0.66), (0.50, 0.72), (0.25, 0.74)], 0.74),
            (2.265, 0.22, [(0.70, 0.22), (0.77, 0.33), (0.79, 0.52), (0.78, 0.67), (0.69, 0.755), (0.34, 0.775)], 0.78),
            (2.22, 0.20, [(0.76, 0.20), (0.83, 0.32), (0.85, 0.52), (0.84, 0.69), (0.75, 0.79), (0.38, 0.81)], 0.815),
            (2.12, 0.19, [(0.80, 0.19), (0.87, 0.31), (0.885, 0.52), (0.875, 0.72), (0.80, 0.82), (0.42, 0.845)], 0.85),
            (1.95, 0.17, [(0.83, 0.17), (0.89, 0.30), (0.90, 0.52), (0.895, 0.78), (0.84, 0.86), (0.45, 0.87)], 0.875),
            (1.50, 0.17, [(0.84, 0.17), (0.90, 0.30), (0.905, 0.54), (0.90, 0.82), (0.85, 0.90), (0.45, 0.91)], 0.92),
            (1.05, 0.16, [(0.84, 0.16), (0.90, 0.29), (0.905, 0.55), (0.90, 0.84), (0.84, 0.96), (0.45, 0.98)], 0.985),
            (0.50, 0.15, [(0.85, 0.15), (0.90, 0.28), (0.905, 0.56), (0.90, 0.85), (0.84, 0.98), (0.45, 1.00)], 1.0),
            (-0.20, 0.15, [(0.85, 0.15), (0.90, 0.28), (0.905, 0.57), (0.90, 0.86), (0.84, 0.99), (0.45, 1.01)], 1.01),
            (-0.85, 0.16, [(0.86, 0.16), (0.905, 0.29), (0.915, 0.58), (0.91, 0.88), (0.84, 1.01), (0.45, 1.02)], 1.02),
            (-1.31, 0.18, [(0.87, 0.18), (0.91, 0.31), (0.92, 0.60), (0.91, 0.90), (0.84, 1.03), (0.45, 1.04)], 1.04),
            (-1.75, 0.20, [(0.86, 0.20), (0.90, 0.33), (0.91, 0.60), (0.90, 0.90), (0.83, 1.04), (0.45, 1.05)], 1.05),
            (-2.10, 0.24, [(0.83, 0.24), (0.88, 0.36), (0.89, 0.60), (0.88, 0.88), (0.80, 1.02), (0.42, 1.04)], 1.04),
            (-2.24, 0.27, [(0.80, 0.27), (0.86, 0.38), (0.875, 0.60), (0.865, 0.87), (0.78, 1.0), (0.40, 1.02)], 1.02),
            (-2.27, 0.30, [(0.74, 0.30), (0.80, 0.40), (0.82, 0.60), (0.81, 0.85), (0.72, 0.97), (0.36, 0.99)], 0.99),
            (-2.29, 0.34, [(0.62, 0.34), (0.68, 0.43), (0.70, 0.60), (0.69, 0.82), (0.60, 0.92), (0.30, 0.94)], 0.94),
        ],
        "crease": (2, 4, 5),
        "cabin": [
            (1.02, 0.97, 0.80, 0.985, 0.78, 0.99),
            (0.30, 0.985, 0.82, 1.34, 0.66, 1.445),
            (0.02, 0.99, 0.83, 1.37, 0.65, 1.465),
            (-0.12, 0.995, 0.83, 1.375, 0.65, 1.465),
            (-0.78, 1.005, 0.82, 1.34, 0.64, 1.435),
            (-1.00, 1.01, 0.81, 1.20, 0.70, 1.35),
            (-1.62, 1.03, 0.76, 1.045, 0.73, 1.06),
        ],
        "segments": [("glass", "glass"), ("glass", "paint"), ("dark", "paint"), ("glass", "paint"), ("glass", "glass"), ("paint", "glass")],
        "axles": (1.50, -1.31),
        "wheel": (0.335, 0.24, 0.24, 0.77, 5, True),
        "rim": "RimGrey",
        "caliper": "CaliperBlue",
        "arch": 0.37,
        "seats": ((0.38, 0.05), -0.75),
        "cockpit": (0.92, -1.15, 0.32),
        "screen": (1.0, 0.99, 0.32, 1.28),
        "dash": (0.78, 0.92),
    },
    "lambo": {
        "body": [
            (2.30, 0.20, [(0.40, 0.20), (0.55, 0.24), (0.60, 0.30), (0.58, 0.36), (0.45, 0.40), (0.20, 0.41)], 0.41),
            (2.20, 0.15, [(0.80, 0.15), (0.88, 0.20), (0.90, 0.30), (0.89, 0.44), (0.80, 0.52), (0.35, 0.50)], 0.50),
            (1.90, 0.12, [(0.90, 0.12), (0.95, 0.18), (0.96, 0.36), (0.955, 0.66), (0.86, 0.76), (0.42, 0.64)], 0.63),
            (1.25, 0.12, [(0.92, 0.12), (0.965, 0.18), (0.97, 0.38), (0.965, 0.72), (0.87, 0.84), (0.44, 0.71)], 0.70),
            (0.70, 0.11, [(0.92, 0.11), (0.96, 0.18), (0.965, 0.38), (0.95, 0.66), (0.86, 0.80), (0.42, 0.77)], 0.77),
            (0.0, 0.11, [(0.92, 0.11), (0.95, 0.20), (0.94, 0.40), (0.93, 0.62), (0.86, 0.78), (0.42, 0.80)], 0.80),
            (-0.55, 0.11, [(0.92, 0.11), (0.95, 0.20), (0.89, 0.40), (0.94, 0.64), (0.87, 0.82), (0.42, 0.84)], 0.84),
            (-1.37, 0.13, [(0.94, 0.13), (0.975, 0.20), (0.98, 0.40), (0.975, 0.70), (0.90, 0.86), (0.45, 0.90)], 0.90),
            (-1.90, 0.16, [(0.92, 0.16), (0.96, 0.24), (0.965, 0.42), (0.96, 0.70), (0.88, 0.86), (0.45, 0.90)], 0.90),
            (-2.18, 0.22, [(0.86, 0.22), (0.90, 0.30), (0.91, 0.45), (0.90, 0.68), (0.82, 0.82), (0.42, 0.86)], 0.86),
            (-2.25, 0.30, [(0.70, 0.30), (0.76, 0.36), (0.78, 0.48), (0.77, 0.66), (0.70, 0.78), (0.36, 0.80)], 0.80),
        ],
        "crease": (2, 4, 5),
        "cabin": [
            (0.85, 0.70, 0.80, 0.71, 0.78, 0.72),
            (-0.05, 0.80, 0.84, 1.08, 0.62, 1.16),
            (-0.55, 0.84, 0.84, 1.08, 0.60, 1.15),
            (-1.10, 0.88, 0.78, 0.96, 0.62, 1.00),
            (-2.00, 0.90, 0.70, 0.91, 0.66, 0.92),
        ],
        "segments": [("glass", "glass"), ("glass", "paint"), ("paint", "dark"), ("paint", "dark")],
        "axles": (1.25, -1.37),
        "wheel": (0.35, 0.27, 0.26, 0.80, 5, False),
        "rim": "RimGold",
        "caliper": "Caliper",
        "arch": 0.39,
        "seats": ((0.42, -0.5), None),
        "cockpit": (0.70, -0.95, 0.26),
        "screen": (0.82, 0.72, -0.02, 1.06),
        "dash": (0.55, 0.70),
    },
    "ferrari": {
        "body": [
            (2.30, 0.22, [(0.45, 0.22), (0.58, 0.27), (0.62, 0.36), (0.58, 0.44), (0.45, 0.47), (0.20, 0.47)], 0.47),
            (2.20, 0.16, [(0.80, 0.16), (0.88, 0.22), (0.92, 0.34), (0.90, 0.50), (0.80, 0.57), (0.35, 0.55)], 0.55),
            (1.90, 0.13, [(0.90, 0.13), (0.96, 0.20), (0.98, 0.37), (0.97, 0.66), (0.88, 0.75), (0.42, 0.64)], 0.63),
            (1.24, 0.12, [(0.92, 0.12), (0.975, 0.19), (0.985, 0.39), (0.975, 0.72), (0.88, 0.83), (0.44, 0.72)], 0.72),
            (0.70, 0.11, [(0.92, 0.11), (0.96, 0.19), (0.96, 0.38), (0.95, 0.64), (0.86, 0.78), (0.42, 0.78)], 0.78),
            (0.0, 0.11, [(0.92, 0.11), (0.95, 0.20), (0.94, 0.40), (0.93, 0.64), (0.86, 0.80), (0.42, 0.82)], 0.82),
            (-0.60, 0.11, [(0.93, 0.11), (0.95, 0.20), (0.91, 0.40), (0.95, 0.66), (0.88, 0.84), (0.42, 0.86)], 0.86),
            (-1.41, 0.13, [(0.96, 0.13), (0.99, 0.21), (0.995, 0.42), (0.99, 0.72), (0.90, 0.88), (0.45, 0.92)], 0.92),
            (-1.95, 0.17, [(0.94, 0.17), (0.97, 0.25), (0.975, 0.44), (0.97, 0.70), (0.88, 0.86), (0.45, 0.90)], 0.90),
            (-2.20, 0.24, [(0.86, 0.24), (0.90, 0.32), (0.91, 0.46), (0.90, 0.68), (0.82, 0.82), (0.42, 0.85)], 0.85),
            (-2.28, 0.32, [(0.70, 0.32), (0.76, 0.38), (0.78, 0.50), (0.77, 0.66), (0.70, 0.77), (0.36, 0.79)], 0.79),
        ],
        "crease": (4,),
        "cabin": [
            (0.80, 0.72, 0.80, 0.73, 0.78, 0.74),
            (-0.10, 0.82, 0.84, 1.10, 0.62, 1.20),
            (-0.60, 0.86, 0.84, 1.10, 0.60, 1.19),
            (-1.20, 0.90, 0.80, 0.98, 0.64, 1.02),
            (-1.95, 0.91, 0.72, 0.92, 0.68, 0.93),
        ],
        "segments": [("glass", "glass"), ("glass", "paint"), ("paint", "dark"), ("paint", "dark")],
        "axles": (1.24, -1.41),
        "wheel": (0.35, 0.27, 0.26, 0.81, 5, True),
        "rim": "RimSilver",
        "caliper": "Caliper",
        "arch": 0.39,
        "seats": ((0.42, -0.5), None),
        "cockpit": (0.66, -1.0, 0.26),
        "screen": (0.78, 0.74, -0.06, 1.08),
        "dash": (0.52, 0.72),
    },
}


# ---- Details, by car --------------------------------------------------------------------------------

def details(kind, surf):
    """Everything laid onto the body: lights, grilles, intakes, plates, handles, badges."""
    parts = ck.Parts()
    m = {n: material(n) for n in ("Lamp", "Tail", "Dark", "Chrome", "Badge", "Paint", "Plate", "PlateBand", "Roundel")}

    def decal(mat, outline, view, lift=0.004, rings=3):
        surf.decal(parts.of(m[mat]), outline, view, lift, rings)

    def both(mat, outline, view, lift=0.004, rings=3):
        decal(mat, outline, view, lift, rings)
        decal(mat, mirror(outline), view, lift, rings)

    def plate(view, y0, y1, w=0.26):
        decal("Plate", rounded(-w, y0, w, y1, 0.012, 2), view, 0.006, 2)
        decal("PlateBand", rounded(-w, y1 - (y1 - y0) * 0.24, w, y1, 0.008, 2), view, 0.009, 1)

    if kind == "bmw":
        # The kidney grille: a chrome surround, the dark slats inside it.
        for sx in (-1, 1):
            k = rounded(0.06, 0.585, 0.27, 0.715, 0.045)
            k2 = rounded(0.085, 0.605, 0.245, 0.695, 0.03)
            decal("Chrome", k if sx > 0 else mirror(k), "front", 0.005)
            decal("Dark", k2 if sx > 0 else mirror(k2), "front", 0.009)
        # The headlights reaching in to the grille, each with its two angel-eye rings.
        head = [(0.29, 0.62), (0.40, 0.612), (0.62, 0.622), (0.79, 0.65), (0.80, 0.70), (0.74, 0.742), (0.55, 0.748), (0.30, 0.722)]
        both("Dark", head, "front", 0.004)
        inner = [(0.31, 0.632), (0.40, 0.626), (0.62, 0.634), (0.77, 0.66), (0.78, 0.695), (0.73, 0.73), (0.55, 0.736), (0.32, 0.712)]
        both("Lamp", inner, "front", 0.007)
        for sx in (-1, 1):
            for u in (0.40, 0.61):
                surf.ring(parts.of(m["Chrome"]), sx * u, 0.68, "front", 0.05, 0.009, 0.01)
        # The M Sport bumper: a wide intake across the middle, a big one each side, and the plate.
        decal("Dark", [(-0.38, 0.26), (0.38, 0.26), (0.42, 0.42), (-0.42, 0.42)], "front")
        both("Dark", [(0.50, 0.29), (0.72, 0.28), (0.74, 0.47), (0.60, 0.45), (0.51, 0.38)], "front", 0.005, 4)
        plate("front", 0.44, 0.535)
        # The roundel on the hood.
        circle = lambda r: [(math.cos(a) * r, 2.06 + math.sin(a) * r) for a in (2 * math.pi * i / 20 for i in range(20))]
        decal("Chrome", circle(0.048), "top", 0.005, 2)
        decal("Roundel", circle(0.036), "top", 0.008, 2)
        # L-shaped taillights: out on the corner and in across the trunk lid, in a dark surround.
        tail = [(0.32, 0.855), (0.56, 0.85), (0.60, 0.80), (0.84, 0.815), (0.865, 0.88), (0.82, 0.935), (0.32, 0.938)]
        both("Dark", tail, "back", 0.004)
        both("Tail", [(0.34, 0.865), (0.57, 0.86), (0.61, 0.815), (0.83, 0.828), (0.85, 0.88), (0.81, 0.925), (0.34, 0.926)], "back", 0.007)
        plate("back", 0.56, 0.66)
        decal("Dark", [(-0.74, 0.20), (0.74, 0.20), (0.71, 0.34), (-0.71, 0.34)], "back")
        # Door handles, front and back, each side.
        for z0 in (0.28, -0.62):
            h = rounded(z0, 0.858, z0 + 0.13, 0.882, 0.01, 2)
            surf.decal(parts.of(m["Chrome"]), h, "left", 0.006, 1)
            surf.decal(parts.of(m["Chrome"]), h, "right", 0.006, 1)
        # The doors' shut lines down each side.
        for z, top in ((1.0, 0.96), (-0.06, 0.99), (-1.0, 1.0)):
            seam = [(z - 0.005, 0.30), (z + 0.005, 0.30), (z + 0.005, top), (z - 0.005, top)]
            for view in ("left", "right"):
                surf.decal(parts.of(m["Dark"]), seam, view, 0.003, 1)
        # Twin tailpipes on the left, under the bumper.
        for x in (0.43, 0.56):
            ao.cylinder(parts.of(m["Chrome"]), at(x, 0.27, -2.16), at(x, 0.27, -2.30), 0.04, segs=16)
            ao.cylinder(parts.of(m["Dark"]), at(x, 0.27, -2.299), at(x, 0.27, -2.301), 0.032, segs=16)
        mirror_at = (0.92, 1.03, 0.86)
    elif kind == "lambo":
        # Slit headlights in a dark surround, and the big intakes under them.
        both("Dark", [(0.42, 0.395), (0.82, 0.46), (0.90, 0.52), (0.86, 0.555), (0.46, 0.45)], "front", 0.004)
        both("Lamp", [(0.46, 0.408), (0.80, 0.468), (0.87, 0.515), (0.84, 0.54), (0.48, 0.44)], "front", 0.007)
        both("Dark", [(0.40, 0.17), (0.78, 0.18), (0.80, 0.33), (0.56, 0.31), (0.42, 0.25)], "front", 0.005, 4)
        decal("Dark", [(-0.36, 0.14), (0.36, 0.14), (0.34, 0.22), (-0.34, 0.22)], "front")
        plate("front", 0.24, 0.32, 0.22)
        # The triangle intake behind each door.
        tri = [(-0.25, 0.42), (-0.95, 0.40), (-0.95, 0.70), (-0.55, 0.66)]
        surf.decal(parts.of(m["Dark"]), tri, "left", 0.004)
        surf.decal(parts.of(m["Dark"]), tri, "right", 0.004)
        # The back: a dark grille across it, the thin taillights over it, two pipes, the plate.
        decal("Dark", [(-0.86, 0.30), (0.86, 0.30), (0.86, 0.66), (-0.86, 0.66)], "back", 0.004)
        both("Tail", [(0.38, 0.68), (0.86, 0.71), (0.85, 0.765), (0.38, 0.74)], "back", 0.008)
        plate("back", 0.46, 0.56, 0.22)
        for x in (-0.26, 0.26):
            ao.cylinder(parts.of(m["Chrome"]), at(x, 0.36, -2.10), at(x, 0.36, -2.29), 0.05, segs=6)
        # The wing, on two struts.
        ao.box(parts.of(m["Dark"]), at(0, 1.08, -2.02), (1.86, 0.32, 0.035), bevel=0.012, rot=(0.1, 0, 0), segments=2)
        for sx in (-1, 1):
            ao.box(parts.of(m["Dark"]), at(sx * 0.5, 0.98, -1.98), (0.035, 0.12, 0.2), bevel=0.008, segments=1)
            ao.box(parts.of(m["Dark"]), at(sx * 0.93, 1.03, -2.02), (0.02, 0.34, 0.12), bevel=0.005, segments=1)
        mirror_at = (0.91, 0.86, 0.55)
    else:
        # Long swept headlights, the intakes either side, the grille in the middle.
        both("Dark", [(0.46, 0.475), (0.84, 0.545), (0.92, 0.60), (0.88, 0.635), (0.50, 0.53)], "front", 0.004)
        both("Lamp", [(0.50, 0.485), (0.82, 0.553), (0.89, 0.598), (0.86, 0.622), (0.52, 0.52)], "front", 0.007)
        both("Dark", [(0.40, 0.18), (0.76, 0.20), (0.78, 0.36), (0.43, 0.34)], "front", 0.005, 4)
        decal("Dark", [(-0.32, 0.17), (0.32, 0.17), (0.28, 0.33), (-0.28, 0.33)], "front")
        plate("front", 0.36, 0.45, 0.22)
        badge = rounded(-0.04, 2.08, 0.04, 2.16, 0.015, 2)
        decal("Badge", badge, "top", 0.006, 1)
        side = rounded(0.86, 0.54, 0.96, 0.62, 0.015, 2)
        surf.decal(parts.of(m["Badge"]), side, "left", 0.006, 1)
        surf.decal(parts.of(m["Badge"]), side, "right", 0.006, 1)
        scoop = [(-0.25, 0.40), (-0.85, 0.42), (-0.85, 0.66), (-0.45, 0.60)]
        surf.decal(parts.of(m["Dark"]), scoop, "left", 0.004)
        surf.decal(parts.of(m["Dark"]), scoop, "right", 0.004)
        # Four round taillights, two a side, each in a chrome ring; the grille under them; two pipes.
        decal("Dark", [(-0.84, 0.32), (0.84, 0.32), (0.84, 0.58), (-0.84, 0.58)], "back", 0.004)
        for sx in (-1, 1):
            for u in (0.38, 0.64):
                c = [(sx * u + math.cos(a) * 0.08, 0.70 + math.sin(a) * 0.08) for a in (2 * math.pi * i / 20 for i in range(20))]
                decal("Tail", c, "back", 0.006, 2)
                surf.ring(parts.of(m["Dark"]), sx * u, 0.70, "back", 0.085, 0.007, 0.007)
        plate("back", 0.44, 0.54, 0.22)
        for x in (-0.44, 0.44):
            ao.cylinder(parts.of(m["Chrome"]), at(x, 0.36, -2.12), at(x, 0.36, -2.31), 0.05, segs=16)
        mirror_at = (0.92, 0.88, 0.40)
    # Mirrors on stalks, out by the windshield's foot.
    mx, my, mz = mirror_at
    for sx in (-1, 1):
        ao.ellipsoid(parts.of(m["Paint"]), at(sx * mx, my, mz), (0.065, 0.11, 0.055), segs=16, rings=8)
        ao.cylinder(parts.of(m["Dark"]), at(sx * (mx - 0.14), my - 0.04, mz + 0.03), at(sx * (mx - 0.04), my - 0.01, mz), 0.014, segs=8)
    return parts.build(f"_{kind}_details")


# ---- Putting a car together -------------------------------------------------------------------------

def opened(kind, spec):
    """With the roof off: the windshield in its frame, the dashboard, the seats and the steering wheel."""
    parts = ck.Parts()
    screen, dark, seat = material("Screen"), material("Dark"), material("Seat")
    z0, y0, z1, y1 = spec["screen"]
    length = math.hypot(z0 - z1, y1 - y0)
    rake = math.atan2(y1 - y0, z0 - z1)
    mid = at(0, (y0 + y1) / 2, (z0 + z1) / 2)
    ao.box(parts.of(screen), mid, (1.36, length, 0.02), bevel=0.008, rot=(rake, 0, 0), segments=2)
    d = parts.of(dark)
    for sx in (-1, 1):
        ao.box(d, mid + Vector((sx * 0.69, 0, 0)), (0.035, length + 0.03, 0.035), bevel=0.01, rot=(rake, 0, 0), segments=2)
    ao.box(d, at(0, y1 + 0.005, z1), (1.4, 0.035, 0.03), bevel=0.01, segments=2)
    dz, dy = spec["dash"]
    ao.box(d, at(0, dy, dz), (1.4, 0.34, 0.14), bevel=0.04, segments=2)
    (sx0, sz), bench = spec["seats"]
    ao.torus(d, at(sx0, dy + 0.06, sz + 0.48), 0.16, 0.025, rot=(math.pi / 2 - 0.45, 0, 0), n=24, m=8)
    ao.cylinder(d, at(sx0, dy + 0.06, sz + 0.48), at(sx0, dy - 0.04, sz + 0.78), 0.03, segs=10)
    c = parts.of(seat)
    floor = spec["cockpit"][2]
    for sx in (-1, 1):
        x = sx * sx0
        ao.box(c, at(x, floor + 0.2, sz - 0.02), (0.46, 0.48, 0.1), bevel=0.04, segments=2)
        ao.box(c, at(x, floor + 0.55, sz - 0.3), (0.46, 0.1, 0.6), bevel=0.04, rot=(-0.2, 0, 0), segments=2)
        for bx in (-1, 1):
            ao.box(c, at(x + bx * 0.22, floor + 0.48, sz - 0.25), (0.07, 0.16, 0.46), bevel=0.03, rot=(-0.2, 0, 0), segments=2)
        ao.box(c, at(x, floor + 0.92, sz - 0.38), (0.28, 0.1, 0.16), bevel=0.04, rot=(-0.2, 0, 0), segments=2)
    if bench is not None:
        ao.box(c, at(0, floor + 0.2, bench), (1.3, 0.44, 0.12), bevel=0.04, segments=2)
        ao.box(c, at(0, floor + 0.55, bench - 0.25), (1.3, 0.1, 0.6), bevel=0.04, rot=(-0.25, 0, 0), segments=2)
    return parts.build(f"{kind}_open")


def build(kind):
    spec = CARS[kind]
    paint, dark = material("Paint"), material("Dark")
    body = ck.body_cage(kind, spec["body"], paint, crease_at=spec["crease"])
    ck.subdivide(body, 2)
    front, rear = spec["axles"]
    radius, width, rim_r, wx, spokes, double = spec["wheel"]
    liner = ck.arches(body, (front, rear), spec["arch"], radius, 0.55, dark)
    cz0, cz1, floor = spec["cockpit"]
    ck.cockpit(body, cz0, cz1, floor, 1.5, dark)
    surf = ck.Surface(body)
    deco = details(kind, surf)
    mats = (material("Tire"), material(spec["rim"]), material(spec["caliper"]))
    rear_wheels = []
    for sx in (-1, 1):
        w = ck.wheel("_rear", sx, radius, width, rim_r, mats, spokes, double)
        w.data.transform(Matrix.Translation(at(sx * wx, radius, rear)))
        rear_wheels.append(w)
    ao.join(body, [liner, deco, *rear_wheels])
    top = ck.greenhouse(f"{kind}_top", spec["cabin"], spec["segments"], {"glass": material("Glass"), "paint": paint, "dark": dark})
    ck.subdivide(top, 2)
    inside = opened(kind, spec)
    wheels = []
    for name, sx in ((f"{kind}_wheel_l", 1), (f"{kind}_wheel_r", -1)):
        w = ck.wheel(name, sx, radius, width, rim_r, mats, spokes, double)
        w.location = at(sx * wx, radius, front)
        wheels.append(w)
    return [body, top, inside, *wheels]


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
            print(f"  {ob.name}: {ao.tris(ob)} tris, {[m.name for m in ob.data.materials if m]}")
    if "--shots" in args:
        for kind in ([only] if only else ("lambo", "ferrari", "bmw")):
            print(ao.sheet(f"cars-{kind}", [(show(kind), "tq"), (None, "side"), (None, "front"), (None, "back"), (None, "low"), (None, "top"), (show(kind, False), "tq")], cell=(560, 400), target=(0, 0, 0.6), dist=7.2))
