"""Generates the low-poly assets for Crashland and exports them as .glb.

Run:  blender --background --python blender/build_assets.py
Every ship component is modelled around its own origin; src/sim.js places it
(positions in metres, Y up in the game = Z up in Blender).
"""
import bpy, bmesh, math, os, random
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets")
os.makedirs(OUT, exist_ok=True)
random.seed(7)
MATS = {}

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()

def mat(name, rgb, rough=0.7, metal=0.0, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.5
    MATS[name] = m
    return m

WHITE = lambda: mat("Hull", (0.86, 0.87, 0.9), 0.55)
GREY = lambda: mat("Metal", (0.42, 0.44, 0.48), 0.45, 0.6)
DARK = lambda: mat("Dark", (0.12, 0.13, 0.15), 0.6, 0.3)
ORANGE = lambda: mat("Orange", (0.95, 0.45, 0.12), 0.6)
GOLD = lambda: mat("Foil", (0.85, 0.65, 0.2), 0.35, 0.8)

def put(obj, m):
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return obj

def cyl(r, depth, loc=(0, 0, 0), verts=8, m=None, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc)
    o = bpy.context.active_object
    return put(o, m) if m else o

def box(size, loc=(0, 0, 0), m=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return put(o, m) if m else o

def strut(a, b, r=0.06, m=None, verts=6):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = d.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(rotation=True)
    return put(o, m) if m else o

def finish(name):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in objs:
        o.select_set(True)
        for p in o.data.polygons:
            p.use_smooth = False
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", export_apply=True)
    print("exported", name, len(obj.data.polygons), "faces")

# ---------------- Kommandokapsel ----------------
reset()
cyl(1.1, 1.5, (0, 0, -0.1), 8, WHITE(), r2=0.55)              # hull frustum
cyl(1.15, 0.12, (0, 0, -0.86), 8, DARK())                       # heat-shield ring
cyl(0.35, 0.3, (0, 0, 0.8), 8, GREY())                           # docking port
cyl(0.42, 0.06, (0, 0, 0.66), 8, DARK())
for i in range(3):                                                # windows
    a = math.radians(-60 + i * 30) + math.pi / 2
    w = box((0.32, 0.08, 0.26), (math.cos(a) * 0.86, math.sin(a) * 0.86, 0.05), mat("Glass", (0.1, 0.25, 0.45), 0.1, 0.2, emit=(0.15, 0.4, 0.7)))
    w.rotation_euler.z = a + math.pi / 2
    w.rotation_euler.x = -0.33
    bpy.ops.object.transform_apply(rotation=True)
for i in range(4):                                                # RCS quads
    a = i * math.pi / 2 + math.pi / 4
    box((0.16, 0.16, 0.22), (math.cos(a) * 0.82, math.sin(a) * 0.82, -0.45), DARK())
strut((0, 0, 0.95), (0, 0, 1.5), 0.03, GREY(), 4)                  # antenna
finish("capsule")

# ---------------- Antrieb ----------------
reset()
cyl(0.78, 1.0, (0, 0, -0.3), 12, DARK(), r2=0.3)                 # bell
cyl(0.72, 0.9, (0, 0, -0.32), 12, mat("Burn", (0.6, 0.25, 0.1), 0.4, 0.5, emit=(0.9, 0.3, 0.05)), r2=0.26)  # hot inner
cyl(0.36, 0.5, (0, 0, 0.45), 8, GREY())                           # chamber
cyl(0.36, 0.3, (0, 0, 0.85), 8, GREY(), r2=0.8)                   # mount cone
box((0.22, 0.22, 0.34), (0.42, 0, 0.45), ORANGE())                # turbopumps
box((0.22, 0.22, 0.34), (-0.42, 0, 0.45), ORANGE())
strut((0.42, 0, 0.3), (0.2, 0, 0.0), 0.04, GREY())
strut((-0.42, 0, 0.3), (-0.2, 0, 0.0), 0.04, GREY())
finish("engine")

# ---------------- Rahmen (struktur) ----------------
reset()
cyl(1.25, 0.14, (0, 0, -0.6), 8, GREY())                          # lower deck
cyl(1.05, 0.14, (0, 0, 0.65), 8, GREY())                          # upper deck
for i in range(4):
    a = i * math.pi / 2 + math.pi / 4
    strut((math.cos(a) * 1.0, math.sin(a) * 1.0, -0.55), (math.cos(a) * 0.85, math.sin(a) * 0.85, 0.6), 0.07, GREY())
    b = a + math.pi / 4
    strut((math.cos(a) * 1.0, math.sin(a) * 1.0, -0.55), (math.cos(b + math.pi / 4) * 0.85, math.sin(b + math.pi / 4) * 0.85, 0.6), 0.035, DARK(), 4)
cyl(0.5, 1.1, (0, 0, 0.02), 8, GOLD())                            # core with foil
finish("frame")

# ---------------- Treibstofftank ----------------
reset()
cyl(0.55, 1.2, (0, 0, 0), 8, WHITE())
cyl(0.55, 0.4, (0, 0, 0.8), 8, WHITE(), r2=0.2)
cyl(0.55, 0.4, (0, 0, -0.8), 8, WHITE(), r2=0.2).rotation_euler.x = math.pi
cyl(0.57, 0.25, (0, 0, 0.15), 8, ORANGE())                        # band
cyl(0.57, 0.08, (0, 0, -0.45), 8, DARK())
strut((0, 0, 1.0), (0, 0, 1.15), 0.08, GREY())                    # valve
finish("tank")

# ---------------- Solarpaneel (wing pointing +X) ----------------
reset()
strut((-1.25, 0, 0), (-0.95, 0, 0), 0.05, GREY())                  # arm
box((2.1, 1.3, 0.05), (0.1, 0, 0), GREY())                         # frame
cells = mat("Cells", (0.08, 0.14, 0.4), 0.25, 0.5)
for ix in range(4):
    for iy in range(2):
        box((0.46, 0.58, 0.03), (-0.68 + ix * 0.52, -0.31 + iy * 0.62, 0.03), cells)
finish("solar")

# ---------------- Bordcomputer ----------------
reset()
box((0.6, 0.35, 0.5), (0, 0, 0), mat("Case", (0.3, 0.32, 0.36), 0.5, 0.4))
box((0.44, 0.04, 0.26), (0, -0.18, 0.06), mat("Screen", (0.1, 0.6, 0.3), 0.2, emit=(0.15, 0.9, 0.45)))
for i in range(3):
    box((0.08, 0.04, 0.05), (-0.15 + i * 0.15, -0.18, -0.16), ORANGE())
strut((0.22, 0, 0.25), (0.22, 0, 0.6), 0.02, GREY(), 4)
finish("computer")

# ---------------- Batterien ----------------
reset()
box((0.75, 0.4, 0.12), (0, 0, -0.26), DARK())
for i in range(3):
    x = -0.24 + i * 0.24
    cyl(0.11, 0.42, (x, 0, 0), 8, mat("Cell", (0.95, 0.78, 0.1), 0.5))
    cyl(0.115, 0.08, (x, 0, 0.12), 8, DARK())
    cyl(0.04, 0.06, (x, 0, 0.24), 6, GREY())
finish("battery")

# ---------------- Landebeine (4 legs, feet on z=0 at radius 2) ----------------
reset()
for i in range(4):
    a = i * math.pi / 2
    c, s = math.cos(a), math.sin(a)
    foot = (c * 2.0, s * 2.0, 0.12)
    strut((c * 1.05, s * 1.05, 2.3), foot, 0.07, GREY())           # main strut
    strut((c * 0.8, s * 0.8, 1.6), (c * 1.55, s * 1.55, 1.0), 0.05, DARK())   # damper
    cyl(0.32, 0.1, (c * 2.0, s * 2.0, 0.05), 8, GREY(), r2=0.22)  # pad
finish("legs")

# ---------------- Fallschirm-Paket (sits on the capsule's docking port) ----------------
reset()
cyl(0.36, 0.34, (0, 0, 0), 8, mat("Pack", (0.85, 0.42, 0.12), 0.8))
cyl(0.38, 0.06, (0, 0, 0.17), 8, DARK())
cyl(0.38, 0.06, (0, 0, -0.17), 8, DARK())
finish("chutepack")

# ---------------- Fallschirm (origin = riser confluence, canopy above) ----------------
reset()
GORES = 12
R, TOP, RIM = 6.0, 9.5, 7.0       # canopy radius, apex height, rim height above the confluence
bm = bmesh.new()
ring_r = [R, R * 0.93, R * 0.72, R * 0.38, R * 0.12]
ring_z = [RIM, RIM + 1.2, RIM + 2.2, RIM + 2.8, TOP]
rings = []
for r, z in zip(ring_r, ring_z):
    rings.append([bm.verts.new((math.cos(2 * math.pi * i / GORES) * r, math.sin(2 * math.pi * i / GORES) * r, z)) for i in range(GORES)])
orange = mat("ChuteA", (0.95, 0.4, 0.1), 0.85)
white = mat("ChuteB", (0.95, 0.94, 0.9), 0.85)
for k in range(len(rings) - 1):
    for i in range(GORES):
        j = (i + 1) % GORES
        f = bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
        f.material_index = i % 2
mesh = bpy.data.meshes.new("Canopy")
bm.to_mesh(mesh); bm.free()
canopy = bpy.data.objects.new("Canopy", mesh)
bpy.context.collection.objects.link(canopy)
canopy.data.materials.append(orange); canopy.data.materials.append(white)
for i in range(0, GORES, 2):                                   # suspension lines
    a = 2 * math.pi * i / GORES
    strut((0, 0, 0), (math.cos(a) * R, math.sin(a) * R, RIM), 0.025, mat("Line", (0.9, 0.9, 0.85), 0.9), 3)
finish("parachute")

# ---------------- Felsbrocken ----------------
reset()
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5)
rock = bpy.context.active_object
for v in rock.data.vertices:
    v.co *= random.uniform(0.75, 1.15)
    v.co.z *= 0.7
put(rock, mat("Rock", (0.55, 0.53, 0.52), 0.95))
finish("rock")
