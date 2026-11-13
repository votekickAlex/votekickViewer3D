# Test assets

Manual test files for `!votekickViewer3D`. Everything in this folder except
this README is git-ignored (binary files stay out of the repository);
re-download or regenerate locally if you clone fresh.

| Folder | File(s) | What it exercises | Source |
|---|---|---|---|
| `basic/` | `cube.stl` | ASCII STL loading | generated (public domain) |
| `basic/` | `cube.ply` | ASCII PLY loading + vertex colors | generated (public domain) |
| `textures/` | `cube.obj` + `cube.mtl` + `texture.png` | OBJ sidecar material + texture file next to the model | generated; texture is the app icon (project asset) |
| `textures/` | `BoxTextured.glb` | glTF PBR base-color texture | KhronosGroup glTF-Sample-Assets, CC0/CC-BY 4.0 |
| `textures/` | `DamagedHelmet.glb` | full PBR texture set | KhronosGroup glTF-Sample-Assets, CC-BY 4.0 |
| `animation/` | `AnimatedMorphCube.glb` | morph-target animation | KhronosGroup glTF-Sample-Assets, CC-BY 4.0 |
| `animation/` | `CesiumMan.glb` | skinned skeletal animation | KhronosGroup glTF-Sample-Assets, CC-BY 4.0 |
| `animation/` | `Fox.glb` | skinned skeletal animation, one clip ("Run") | KhronosGroup glTF-Sample-Assets, CC0 4.0 |
| `heavy/` | `CarConcept.glb` | ~11 MB performance/stress test | KhronosGroup glTF-Sample-Assets, CC-BY 4.0 |
| `broken/` | `corrupted.stl` | error path: invalid file must fail gracefully | generated |

To re-fetch the Khronos models:

```
https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/<Name>/glTF-Binary/<Name>.glb
```

Still missing: an FBX with textures next to it (real-world FBX sidecar case).
