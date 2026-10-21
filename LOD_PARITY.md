# VoxelSpace / Unity LOD parity setup

Open the reference with `?lod-parity=1`, for example `http://localhost:PORT/?lod-parity=1`. It selects `deltaforce/C5M5`, WebGPU voxel rendering, LOD debug, 10 mip levels, bias 0, detail enabled, 74,500 m far clip, FOV 90°, and 0.5 render scale. The camera is at map pixel `(512, 512)`, 50 m above sampled terrain, yaw `+0.15 rad`, and 5° downward pitch. The preset displays an error if WebGPU voxel rendering is unavailable.

In the Unity port, open the Game scene and run **Delta Force > Testing > Apply VoxelSpace LOD Parity Setup**. It uses the same map pixel, terrain-relative height, pitch, vertical FOV, far clip, render scale, mip count, bias, and LOD debug view. Unity applies the reference yaw plus a 180° rotation around its Y axis; the ref map origin is first pixel `(0,0)`, and Unity reflects both source raster axes into world XZ. C5M5 origin `(-1023,-1023)` maps ref pixel `(0,0)` to Unity world `(0,0)`.

Set both the reference viewport and Unity Game view to **1024×768**. Both render at **512×384** with scale 0.5. Compare the terrain image area, excluding app/editor chrome and the reference legend. The reference preset is opt-in.
