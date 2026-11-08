"""Builder variants of the lander parts (src/sim.js PART_VARIANTS places them by their attachment points).

Run:  blender --background --python blender/build_variants.py
Same conventions as build_assets.py (whose helpers this reuses): each part around its own origin, Z up.
The standard parts stay in build_assets.py; only the variants are generated here.
"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_assets import reset, mat, cyl, box, strut, finish, WHITE, GREY, DARK, ORANGE, GOLD

BURN = lambda: mat("Burn", (0.6, 0.25, 0.1), 0.4, 0.5, emit=(0.9, 0.3, 0.05))
NIOBIUM = lambda: mat("Niobium", (0.5, 0.46, 0.6), 0.3, 0.85)

# ---------------- Antrieb "Stark": short, wide bell, bigger chamber, four turbopumps ----------------
# mount on top at z = 1.0 like the standard engine; nozzle exit at z = -0.7 (radius 0.98)
reset()
cyl(0.98, 0.9, (0, 0, -0.25), 14, DARK(), r2=0.36)
cyl(0.92, 0.8, (0, 0, -0.27), 14, BURN(), r2=0.32)
cyl(1.0, 0.07, (0, 0, -0.05), 14, ORANGE(), r2=0.84)               # cooling manifold ring
cyl(0.44, 0.5, (0, 0, 0.45), 10, GREY())
cyl(0.44, 0.3, (0, 0, 0.85), 10, GREY(), r2=0.85)
for i in range(4):
    a = i * math.pi / 2 + math.pi / 4
    c, s = math.cos(a), math.sin(a)
    box((0.22, 0.22, 0.36), (c * 0.55, s * 0.55, 0.45), ORANGE())
    strut((c * 0.55, s * 0.55, 0.28), (c * 0.3, s * 0.3, 0.05), 0.04, GREY())
finish("engine_strong")

# ---------------- Antrieb "Effizient": long vacuum bell with a radiative extension ----------------
# nozzle exit at z = -1.15 (radius 0.66)
reset()
cyl(0.55, 0.9, (0, 0, -0.25), 14, DARK(), r2=0.22)                   # regeneratively cooled part
cyl(0.66, 0.45, (0, 0, -0.925), 14, NIOBIUM(), r2=0.55)             # radiative extension
cyl(0.62, 1.2, (0, 0, -0.52), 14, BURN(), r2=0.19)
cyl(0.3, 0.5, (0, 0, 0.45), 8, GREY())
cyl(0.32, 0.26, (0, 0, 0.3), 8, GOLD())                              # foil-wrapped chamber
cyl(0.3, 0.3, (0, 0, 0.85), 8, GREY(), r2=0.8)
box((0.2, 0.2, 0.3), (0.38, 0, 0.5), ORANGE())
strut((0.38, 0, 0.35), (0.18, 0, 0.1), 0.035, GREY())
finish("engine_eco")

# ---------------- Tanks ----------------
def tank(name, r, mid, dome, bands):
    reset()
    cyl(r, mid, (0, 0, 0), 8, WHITE())
    cyl(r, dome, (0, 0, mid / 2 + dome / 2), 8, WHITE(), r2=r * 0.36)
    cyl(r, dome, (0, 0, -mid / 2 - dome / 2), 8, WHITE(), r2=r * 0.36).rotation_euler.x = math.pi
    for z, h, m in bands:
        cyl(r + 0.02, h, (0, 0, z), 8, m())
    top = mid / 2 + dome
    strut((0, 0, top), (0, 0, top + 0.15), 0.08, GREY())
    return top

# "Klein": short and slim (half height 0.75)
tank("tank_small", 0.5, 0.8, 0.35, [(0.1, 0.2, ORANGE), (-0.3, 0.07, DARK)])
finish("tank_small")
# "Groß": taller and fatter (half height 1.2), two bands and stringers
tank("tank_large", 0.66, 1.5, 0.45, [(0.45, 0.22, ORANGE), (-0.25, 0.22, ORANGE), (-0.7, 0.08, DARK)])
for i in range(8):
    a = i * math.pi / 4 + math.pi / 8
    strut((math.cos(a) * 0.69, math.sin(a) * 0.69, -0.75), (math.cos(a) * 0.69, math.sin(a) * 0.69, 0.75), 0.022, DARK(), 4)
finish("tank_large")

# ---------------- Landebeine ----------------
# all attach under the frame at radius 1.05, z = 2.3; feet on z = 0
def legs(name, foot, r_main, r_pad, damper, vee):
    reset()
    for i in range(4):
        a = i * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        f = (c * foot, s * foot, 0.12)
        if vee:   # two struts per leg, splayed sideways at the top
            for side in (-1, 1):
                b = a + side * 0.22
                strut((math.cos(b) * 1.05, math.sin(b) * 1.05, 2.3), f, r_main, GREY())
        else:
            strut((c * 1.05, s * 1.05, 2.3), f, r_main, GREY())
        if damper:
            k = foot / 2.0
            strut((c * 0.8, s * 0.8, 1.6), (c * 1.55 * k, s * 1.55 * k, 1.0), 0.05 if r_main < 0.08 else 0.065, DARK())
        else:     # light: a thin tie rod instead of the damper
            strut((c * 0.9, s * 0.9, 1.3), (c * foot * 0.75, s * foot * 0.75, 0.6), 0.025, DARK(), 4)
        cyl(r_pad, 0.1, (c * foot, s * foot, 0.05), 8, GREY(), r2=r_pad * 0.7)
    finish(name)

legs("legs_light", 1.8, 0.05, 0.24, False, False)
legs("legs_wide", 2.5, 0.075, 0.42, True, True)

# ---------------- Große Batterie: five bigger cells on a wider tray ----------------
reset()
box((1.05, 0.46, 0.12), (0, 0, -0.3), DARK())
for i in range(5):
    x = -0.4 + i * 0.2
    cyl(0.09, 0.5, (x, 0, 0), 8, mat("Cell", (0.95, 0.78, 0.1), 0.5))
    cyl(0.095, 0.08, (x, 0, 0.16), 8, DARK())
    cyl(0.035, 0.06, (x, 0, 0.28), 6, GREY())
box((0.08, 0.5, 0.36), (0.55, 0, -0.06), ORANGE())                   # power distribution box
finish("battery_big")

# ---------------- Großes Fallschirm-Paket (half height 0.22) ----------------
reset()
cyl(0.44, 0.44, (0, 0, 0), 8, mat("Pack", (0.85, 0.42, 0.12), 0.8))
for z in (0.22, 0.0, -0.22):
    cyl(0.46, 0.06, (0, 0, z), 8, DARK())
finish("chutepack_large")
