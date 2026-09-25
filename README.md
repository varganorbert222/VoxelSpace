# Voxel Space

**Fly the classic Comanche voxel landscape — in the browser, on CPU or GPU.**

A modern, HUD-driven voxel-space renderer: four algorithms, three runtimes, eighty-six Comanche missions, and a cockpit you can actually fly.

[**Launch the demo**](https://varganorbert222.github.io/VoxelSpace/index.html) · [YouTube (Unity series)](https://www.youtube.com/channel/UCEOzw2b5SALP72s9TMlW3ug) · [License: MIT](LICENSE)

---

The original algorithm comes from [s-macke/VoxelSpace](https://github.com/s-macke/VoxelSpace). Please look around there first.

I also have to thank the [hanatos/sioux](https://github.com/hanatos/sioux) repository, where I found the C program I used to extract the maps from the Comanche 3 game.

You can try this implementation here: **[VoxelSpace Demo](https://varganorbert222.github.io/VoxelSpace/index.html)**.

Take a look around my [YouTube channel](https://www.youtube.com/channel/UCEOzw2b5SALP72s9TMlW3ug), where I implemented the algorithm in Unity.

---

## Why this project

Voxel space is the technique behind *Comanche*: a height map plus a color map, marched column by column until the horizon. This repo keeps that spirit and turns it into a full playground.

| You get | What it means |
| --- | --- |
| **Classic columns** | The original voxel-space picture, every frame |
| **Frustum-space** | View-Z slices with real pitch, live every frame |
| **360° panorama** | Equirectangular environment, cached, then sampled as you look |
| **Cubemap** | Six-face skybox, cached like panorama, sampled as you look |
| **Voxel raycast** | Per-pixel 3D rays through height columns, max-mip empty skip |
| **CPU · JS** | Readable kernels on a Canvas 2D swap |
| **CPU · WASM** | The same kernels, compiled `-O3` for wasm32 |
| **GPU · WebGPU** | Compute shaders, swapchain present |
| **LOD mips** | Coarser height/color rasters with distance; count and curve are yours |
| **86 missions** | Color + height maps extracted from Comanche 3 |

No build step to play. Open the demo, pick a map, fly.

---

## Live demo

**[varganorbert222.github.io/VoxelSpace](https://varganorbert222.github.io/VoxelSpace/index.html)**

Works in a current desktop or mobile browser. WebGPU is optional (Chrome / Edge / recent Safari). Settings persist in `localStorage` so the next visit opens on the same map, engine, and HUD layout.

---

## How it works

Height and color maps are 1024×1024 raster pairs. Classic marches world-vertical columns. Frustum-space samples the same height field along camera rays at discrete view-Z planes so pitch is real, not a horizon shift. Panorama and cubemap cache an environment atlas, then sample it as you look. Distant samples use mipmaps and growing step size so the far clip stays cheap.
Height and color maps are 1024×1024 raster pairs. Each camera ray steps across the height field, samples color, and writes a column (or an environment texel).

A mip chain sits on the maps. Classic, panorama, cubemap, and voxel drop to coarser LODs farther from the camera. How many levels and where they switch is a View control. On LOD 0, optional bilinear height and color sampling smooths the nearest voxels; LOD0 refine snaps those samples onto the inner 1/16…1 m cell grid, then adds height noise. Higher LODs stay nearest-texel so coarse blocks stay flat. Voxel occupancy at a cell is that same mipmap sample (bilinear + refine at LOD 0, nearest on coarser mips). Voxel step size is the mip / refine cell at that distance, so empty-space skip naturally lengthens with LOD.

```
  maps/color + maps/height
            │
            ▼
        Terrain  ── mip chain, collision, sky
            │
            ▼
        Renderer
     ┌──────┼──────┬──────┐
  Classic  Frustum  Pano   Cube   Voxel
       │         │      │      │      │
       └──────── backends ───────────┘
        JS · WASM · WebGPU
            │
            ▼
     Canvas 2D  or  WebGPU swapchain
            │
            ▼
     HUD · radar · command panel
```

**Classic** redraws the camera frustum every frame: one ray per screen column, LOD bands, fog, optional world wrap.

**Voxel** also redraws every frame, but with one 3D ray per pixel. Height-map texels are solid columns; a max-height mip pyramid skips empty air. Looking around is not free — there is no environment cache.

**Panorama** and **cubemap** first fill a cached environment (equirect or six cube faces). As long as the camera *position* and march settings stay put, looking around is a cheap resample — free look, roll, and orbital inspection without re-marching the world. Move, or change distance / delta Z / quality / FOV / LOD / sampling / repeat, and the cache rebuilds. Fog is applied when the environment is sampled, so toggling it does not rebuild the cache.

Runtimes plug in behind the same contract:

| Runtime | Present | Threads | Notes |
| --- | --- | --- | --- |
| **CPU · JS** | Canvas 2D | Optional workers | Default. Same math as the source kernels. |
| **CPU · WASM** | Canvas 2D | Optional workers | Embedded `march.wasm` bytes. No extra fetch. |
| **GPU · WebGPU** | Swapchain | Off | Finer march. **Ultra** quality is desktop WebGPU only. |

Unavailable backends are disabled in the menu. Cycle with `B` among whatever the browser actually supports.

---

## Quick start

This is a static ES-module app. Serve the repo root over HTTP (file:// cannot import JSON modules).

```bash
# COOP/COEP (needed for SharedArrayBuffer / fast worker sharing)
python tools/serve.py 8080

# Python without isolation headers (Threads still work, workers copy maps)
python -m http.server 8080

# Node
npx --yes serve .
```

Then open [http://localhost:8080](http://localhost:8080).

**WebGPU** only works on `localhost` or HTTPS. A clone does **not** need clang, Node, or a bundler to play — WASM is already committed as `scripts/wasm/march.bytes.js`.

### Browser

| Need | Recommendation |
| --- | --- |
| Play (JS / WASM) | Any current Chromium, Firefox, or Safari |
| GPU path | Chrome, Edge, or recent Safari with WebGPU |
| Mobile | Touch sticks appear automatically on coarse pointers |

---

## Flying

### Keyboard — movement

| Keys | Action |
| --- | --- |
| **W A S D** | Move / strafe |
| **Shift** | Sprint (3×) |
| **R** or **Space** | Up |
| **F** or **Ctrl** | Down |
| **Arrow keys** | Look |
| **Q E** | Roll (panorama / cubemap / voxel only) |
| **Click** the view | Mouse look (pointer lock in fly mode) |
| **Esc** | Close the command panel (browser also exits pointer lock) |

### Keyboard — engine

| Key | Action |
| --- | --- |
| **M** | Cycle map |
| **L** | Cycle algorithm |
| **B** | Cycle runtime |
| **C** | Cycle camera |
| **1 – 5** | Quality (Low → Ultra) |
| **I** / **Shift+I** | Distance − / + |
| **Z** / **Shift+Z** | Delta Z − / + |
| **O** / **Shift+O** | FOV − / + |
| **V** | Cycle debug view |
| **N** | Toggle env atlas (panorama / cubemap) |
| **G** | Toggle fog |
| **P** | Toggle repeat (world wrap) |
| **T** | Toggle worker threads (CPU only) |
| **H** | Toggle HUD chrome |
| **K** | Toggle radar |

Letters match the first unused letter of each HUD label. Hold **Shift** on distance / delta Z / FOV to nudge the other way. LOD, height interp, and color filter live in the command panel only.

### Mouse

| Input | Fly | Orbital |
| --- | --- | --- |
| Click canvas | Pointer lock, look | — |
| Drag | — | Orbit around map center |
| Wheel | — | Zoom radius |

The camera stays a clearance above the height field so you cannot sink into terrain.

### Touch

On phones and tablets the on-screen pad appears automatically.

| Control | Fly | Orbital |
| --- | --- | --- |
| Left stick | Move / strafe | Zoom |
| Right stick | Look | Orbit |
| **Up** / **Down** | Altitude | — |
| **L** / **R** | Bank (panorama / cubemap / voxel) | — |
| Menu handle | Open / close command panel | same |
| Tap radar | Hide radar (tab to show again) | same |

---

## HUD and command panel

The top bar is always-on chrome: map, algorithm, runtime, camera, quality, debug view, and FPS. **Menu** opens the command panel. **Close** / **H** hides the chrome for a clean screenshot.

| Section | What it does |
| --- | --- |
| **01 Mission** | Pick one of 86 Comanche maps (color + height + sky + altitude). |
| **02 Engine** | Algorithm, runtime, quality, camera mode. |
| **03 View** | Distance, fog range, delta Z, LOD, LOD curve, LOD step, FOV. Scale is derived from quality. |
| **04 Debug** | Recolor the picture; optional unwrapped env atlas. Height / Depth / Iterations show a color key next to the radar. |
| **05 Flags** | Fog, world wrap, height interp, color filter, worker threads. |
| **06 Input / Touch** | Built-in legend for the current device. |
| **07 Link** | This GitHub project. |

Tooltips sit on every control. Settings (including HUD and radar visibility) are saved locally.

### Radar

A 256×256 top-down of the current map, with heading, FOV wedge, and craft mark. In **Height** debug view the radar switches to grayscale elevation. **K** toggles it; tap / click the radar to tuck it away.

---

## Modes and knobs

### Algorithms

| Algorithm | Picture | Look | Cache |
| --- | --- | --- | --- |
| **classic** | Column voxel space | Yaw + limited pitch | None — every frame |
| **frustum-space** | View-Z slices, per-pixel first hit | Yaw + real pitch (±80°), no roll | None — every frame |
| **panorama** | 360° equirect | Full Euler + roll | Rebuild on move / march change |
| **cubemap** | 6-face environment | Full Euler + roll | Same as panorama |
| **voxel** | Per-pixel 3D column raycast | Full Euler + roll | None — every frame |

### Camera

| Mode | Behavior |
| --- | --- |
| **fly** | Free flight from the craft. Click to lock the mouse. |
| **orbital** | Circle the map center. Drag to orbit, wheel to zoom. |

Switching camera respawns over the map center, above terrain.

### Quality

Internal resolution and march density follow quality. Scale is automatic.

| Key | Label | Panorama | Cube face | Who |
| --- | --- | --- | --- | --- |
| **1** | Low | 1024 × 512 | 256 | Everyone |
| **2** | Medium | 1536 × 768 | 384 | Everyone |
| **3** | High | 2048 × 1024 | 512 | Everyone |
| **4** | Very-high | 3072 × 1536 | 768 | Everyone |
| **5** | Ultra | 4096 × 2048 | 1024 | Desktop **WebGPU** only |

### View

| Control | Range | Role |
| --- | --- | --- |
| **Distance** | 100 – 74500 | Far clip (HUD value; march may stop sooner if Fog is on and Fog range end is lower). The max is the retail Direct5 end at 640×480 / FOV 90 (≈74473). |
| **Fog range** | 0 – Distance | Dual thumbs: fog starts at the lower bound and saturates at the upper. The track max follows Distance. |
| **Delta Z** | 0.1 – 2.0 | Ray step for classic / panorama / cubemap. Unused by voxel (mip cell size steps). |
| **LOD** | 1 – map log₂ | How many mip rasters the march uses. 1 is full resolution only. On a 1024 map, 5 stops at 64×64 and 10 at 2×2. Default is the middle of the range. Voxel uses the same distance bands: hit voxel size is `2^mip` (or lod0 refine 1/16…1 m); coarser max-mips may still skip empty air. |
| **LOD curve** | Linear / Doubling / Logarithmic | How switch distances fill 0…Distance. Linear: equal range per level. Doubling: each switch is twice as far as the previous. Logarithmic: log-spaced from the first switch to Distance. |
| **LOD step** | 10 m – Distance | Meters to the first LOD switch. Editable on Logarithmic; Linear and Doubling fill 0…Distance on their own and show the first switch here. |
| **FOV** | 10° – 90° | Horizontal field of view |
| **Scale** | auto | Internal resolution from quality × viewport |

### Debug views

| View | Picture |
| --- | --- |
| **Color** | Production landscape |
| **Height** | Elevation as luminance (radar follows) |
| **Depth** | Distance along the ray |
| **Iterations** | How hard the march worked |

**Env atlas** (`N`) overlays the unwrapped panorama strip or cubemap net. Hidden on classic and frustum-space. The overlay uses the same debug view as the 3D picture.
Height / Depth / Iterations show a floating color key next to the radar (grayscale for Height and Depth; red → magenta for Iterations). Sky / miss stays off the ramp.

**Env atlas** (`N`) overlays the unwrapped panorama strip or cubemap net. Hidden on classic and voxel. The overlay uses the same debug view as the 3D picture.
It is hidden on classic, frustum-space, and voxel.

### Flags

| Flag | Default | Notes |
| --- | --- | --- |
| **Fog** | On | Fade distant terrain into the sky. Distances come from **Fog range**. |
| **Repeat** | On | Tile the map so the world wraps |
| **Height interp** | On | Bilinear height on LOD 0. Higher LODs stay nearest-texel. Off is nearest everywhere. |
| **Color filter** | On | World-space bilinear color on LOD 0. Higher LODs stay nearest-texel so coarse blocks stay flat. |
| **Threads** | Off | Split columns across workers (JS / WASM). Forced off on WebGPU. |

---

## Maps

Missions live in `data/maps.json`. Each entry names a color PNG, a height PNG, a camo family, spawn altitude, and sky color. Shared rasters live under `maps/color/` and `maps/height/` (70 unique pairs, 86 named missions).

The extractor lineage is the C program from [sioux](https://github.com/hanatos/sioux), kept here as `tools/comanche3extract`. Mission metadata is parsed from Comanche `.MIS` files by `tools/MISToJSON`.

---

## Operate and develop

### Layout

| Path | Role |
| --- | --- |
| `index.html` | HUD shell, command panel, canvas, radar, touch pad |
| `styles/` | Cockpit chrome |
| `scripts/app/` | Boot, game loop, HUD, settings, radar, map load |
| `scripts/render/` | Classic / frustum-space / panorama / cubemap / voxel, workers, overlay |
| `scripts/backends/` | JS, WASM, WebGPU (+ WGSL) |
| `scripts/camera/` | Fly, orbit, projection, collision |
| `scripts/terrain/` | Height/color, mip chain, wrap, LOD-0 sampling |
| `data/config.json` | Ranges, defaults, allowed modes |
| `data/maps.json` | Mission table |
| `maps/` | Color and height rasters |
| `tools/wasm/` | Rebuild CPU kernels |
| `tools/MISToJSON/` | Mission → JSON |
| `tools/comanche3extract/` | Comanche 3 map extract |

`data/config.json` is the product spec for sliders and enums. Constants under `scripts/constants/` own the numbers the kernels actually use.

### Rebuild WASM (optional)

Only needed after editing `tools/wasm/src/march.c`. Requires clang targeting `wasm32` and Node.

```powershell
powershell -File tools/wasm/build.ps1
```

The committed artifact is `scripts/wasm/march.bytes.js`. Do not `fetch("*.wasm")`. SIMD is not the product module. Details: [`tools/wasm/README.md`](tools/wasm/README.md).

### Persistence

Key `voxelspace.settings` in `localStorage`: map, algorithm, backend, quality, camera, view knobs (including LOD), flags (including height interp and color filter), debug view, HUD chrome, radar. Invalid values fall back to `data/config.json`.

---

## Credits

- **[s-macke/VoxelSpace](https://github.com/s-macke/VoxelSpace)** — the original voxel-space algorithm and explanation.
- **[hanatos/sioux](https://github.com/hanatos/sioux)** — C extractor used for Comanche 3 maps.
- **Comanche 3** — source of the height and color landscapes.
- **[Unity series](https://www.youtube.com/channel/UCEOzw2b5SALP72s9TMlW3ug)** — the same algorithm, implemented in Unity on YouTube.

## License

[MIT](LICENSE) © 2022–2026 Norbert Varga
