# Builds assets/title.glb: "apple / royale" in the Drawvid Hand font as a
# bevelled 3D mesh (red letters, darker sides, a dark outline behind).
#   blender -b -P tools/title_glb.py -- <font.ttf> <out.glb>
# Blender can't read woff2; make the .ttf with fontTools:
#   python3 -c "from fontTools.ttLib import TTFont; f=TTFont('assets/fonts/DrawvidHandwriting.woff2'); f.flavor=None; f.save('hand.ttf')"
import math
import sys
import bmesh
import bpy

font_path, out_path = sys.argv[sys.argv.index("--") + 1 :]
TEXT = "apple\nroyale"
ARC = 1.1  # radians the words bend through, arching over the apple

bpy.ops.wm.read_factory_settings(use_empty=True)
font = bpy.data.fonts.load(font_path)


def material(name, rgb, rough=0.55):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def lin(h):  # sRGB hex → linear
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# Arch the words over the apple: wrap the text's x around a circle centred
# below it (so the lines stay concentric and each letter leans out along
# the curve), the whole width spanning ARC radians.
def arch(mesh):
    xs = [v.co.x for v in mesh.vertices]
    mid = (max(xs) + min(xs)) / 2
    r = (max(xs) - min(xs)) / ARC
    for v in mesh.vertices:
        t = (v.co.x - mid) / r
        d = r + v.co.y
        v.co.x, v.co.y = d * math.sin(t), d * math.cos(t) - r


def text_mesh(name, extrude, bevel, offset, y):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = TEXT
    cu.font = font
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_line = 0.82
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    cu.offset = offset
    cu.resolution_u = 8
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    ob.select_set(False)
    arch(ob.data)
    # Stand up, facing -Y (Blender's front view).
    ob.rotation_euler = (1.5708, 0, 0)
    ob.location = (0, y, 0)
    return ob


front = text_mesh("TitleText", 0.09, 0.025, 0, 0)
front.data.materials.append(material("TitleRed", lin("d8262b"), 0.65))
front.data.materials.append(material("TitleSide", lin("8a1418")))
# Faces not facing the camera (the extruded sides) get the darker red. The
# text's front is its local +Z (the object is turned to face -Y).
bm = bmesh.new()
bm.from_mesh(front.data)
bm.normal_update()
for f in bm.faces:
    f.material_index = 0 if f.normal.z > 0.7 else 1
bm.to_mesh(front.data)
bm.free()

back = text_mesh("TitleOutline", 0.05, 0.0, 0.055, 0.12)
back.data.materials.append(material("TitleOutlineMat", lin("2a1208"), 0.8))

bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True)
