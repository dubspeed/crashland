"""Generates the low-poly assets for Crashland and exports them as .glb.

Run:  blender --background --python blender/build_assets.py
"""
import bpy, bmesh, math, os, random

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets")
os.makedirs(OUT, exist_ok=True)
random.seed(7)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False

def export(name):
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"),
                              export_format="GLB", export_apply=True)
    print("exported", name)

# --- Ball: icosphere, subdiv 1 -> 80 faces, two-tone ---------------------
reset()
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5)
ball = bpy.context.active_object; ball.name = "Ball"
ball.data.materials.append(material("BallA", (0.95, 0.35, 0.2), 0.6))
ball.data.materials.append(material("BallB", (1.0, 0.85, 0.3), 0.6))
for p in ball.data.polygons:
    p.material_index = 1 if p.center.z > 0.25 or p.center.z < -0.25 else 0
flat(ball); export("ball")

# --- Rock: jittered icosphere --------------------------------------------
reset()
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5)
rock = bpy.context.active_object; rock.name = "Rock"
for v in rock.data.vertices:
    v.co *= random.uniform(0.8, 1.15)
rock.data.materials.append(material("Rock", (0.45, 0.42, 0.5), 0.95))
flat(rock); export("rock")

# --- Crate: beveled cube --------------------------------------------------
reset()
bpy.ops.mesh.primitive_cube_add(size=1)
crate = bpy.context.active_object; crate.name = "Crate"
bev = crate.modifiers.new("Bevel", "BEVEL"); bev.width = 0.06; bev.segments = 1
crate.data.materials.append(material("Wood", (0.75, 0.5, 0.25), 0.9))
flat(crate); export("crate")

# --- Plate: low-poly octagon platform with rim & grass top ----------------
reset()
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=6, depth=0.6)
plate = bpy.context.active_object; plate.name = "Plate"
plate.data.materials.append(material("Grass", (0.35, 0.7, 0.35), 0.9))
plate.data.materials.append(material("Dirt", (0.5, 0.33, 0.22), 1.0))
bm = bmesh.new(); bm.from_mesh(plate.data)
top = [f for f in bm.faces if f.normal.z > 0.9][0]
# inset the top face a few times and jitter for a hand-made look
r = bmesh.ops.inset_region(bm, faces=[top], thickness=1.2, depth=0.0)
bmesh.ops.inset_region(bm, faces=[top], thickness=1.6, depth=0.0)
for v in bm.verts:
    if v.co.z > 0.2:
        v.co.z += random.uniform(-0.03, 0.03)
for f in bm.faces:
    f.material_index = 0 if f.normal.z > 0.5 else 1
bm.to_mesh(plate.data); bm.free()
# hang a "cliff" underneath: a cone so it looks like a floating island
bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=6, radius2=1.0, depth=4, location=(0, 0, -2.3))
cone = bpy.context.active_object
cone.rotation_euler.x = math.pi; cone.data.materials.append(plate.data.materials[1])
bpy.ops.object.transform_apply(rotation=True)
for v in cone.data.vertices:
    if v.co.z < 1.9:
        v.co.x += random.uniform(-0.3, 0.3); v.co.y += random.uniform(-0.3, 0.3)
cone.select_set(True); plate.select_set(True); bpy.context.view_layer.objects.active = plate
bpy.ops.object.join()
flat(plate); export("plate")
