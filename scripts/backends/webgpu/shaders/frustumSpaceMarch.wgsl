@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> pixelOffsets: array<u32, 8>;
@group(1) @binding(1) var<storage, read> lodDeltas: array<f32, 16>;
@group(1) @binding(2) var<storage, read> lodDistances: array<f32, 16>;
@group(2) @binding(0) var heightTex: texture_2d<u32>;
@group(2) @binding(1) var colorTex: texture_2d<f32>;
@group(3) @binding(0) var outTex: texture_storage_2d<r32uint, write>;
@group(3) @binding(1) var<storage, read> skyRows: array<u32>;

const MAX_STEPS: u32 = 16384u;
const CLIP_Z: f32 = -20.0;
const DRIFT_SPAN_TEXELS: f32 = 1.0;
const ROW_LIMIT: f32 = 1.0e9;

fn coverGet(cover: ptr<function, array<u32, 64>>, row: i32) -> bool {
  let word = u32(row) >> 5u;
  return ((*cover)[word] & (1u << (u32(row) & 31u))) != 0u;
}

fn coverSet(cover: ptr<function, array<u32, 64>>, row: i32) {
  let word = u32(row) >> 5u;
  (*cover)[word] = (*cover)[word] | (1u << (u32(row) & 31u));
}

fn classicHeightAt(texX: i32, texY: i32, mip: i32, wrap: bool, mapHMask: i32, mapWMask: i32) -> u32 {
  let x = wrapOrClamp(texX, mapHMask, wrap);
  let y = wrapOrClamp(texY, mapWMask, wrap);
  return textureLoad(heightTex, vec2<i32>(x, y), mip).r;
}

fn classicSampleHeight(plx: f32, ply: f32, mip: i32, lerp: bool, subdiv: u32, wrap: bool, mapHMask: i32, mapWMask: i32) -> vec2f {
  let base = f32(classicHeightAt(i32(plx), i32(ply), mip, wrap, mapHMask, mapWMask));
  if (!lerp) {
    return vec2f(base, base);
  }
  let x0 = floor(plx);
  let y0 = floor(ply);
  var fx = plx - x0;
  var fy = ply - y0;
  if (subdiv > 1u) {
    fx = subcellCenter(fx, subdiv);
    fy = subcellCenter(fy, subdiv);
  }
  let tx = i32(x0);
  let ty = i32(y0);
  let h00 = f32(classicHeightAt(tx, ty, mip, wrap, mapHMask, mapWMask));
  let h10 = f32(classicHeightAt(tx + 1, ty, mip, wrap, mapHMask, mapWMask));
  let h01 = f32(classicHeightAt(tx, ty + 1, mip, wrap, mapHMask, mapWMask));
  let h11 = f32(classicHeightAt(tx + 1, ty + 1, mip, wrap, mapHMask, mapWMask));
  let h = bilinearHeight(h00, h10, h01, h11, fx, fy);
  return vec2f(h, clamp(h + 0.5, 0.0, 255.0));
}

fn classicColorAt(texX: i32, texY: i32, mip: i32, wrap: bool, mapHMask: i32, mapWMask: i32) -> vec4f {
  let x = wrapOrClamp(texX, mapHMask, wrap);
  let y = wrapOrClamp(texY, mapWMask, wrap);
  return textureLoad(colorTex, vec2<i32>(x, y), mip);
}

fn classicSampleColor(plx: f32, ply: f32, mip: i32, doFilter: bool, subdiv: u32, wrap: bool, mapHMask: i32, mapWMask: i32) -> vec4f {
  if (!doFilter) {
    return classicColorAt(i32(plx), i32(ply), mip, wrap, mapHMask, mapWMask);
  }
  let x0 = floor(plx);
  let y0 = floor(ply);
  var fx = plx - x0;
  var fy = ply - y0;
  if (subdiv > 1u) {
    fx = subcellCenter(fx, subdiv);
    fy = subcellCenter(fy, subdiv);
  }
  let tx = i32(x0);
  let ty = i32(y0);
  let c00 = classicColorAt(tx, ty, mip, wrap, mapHMask, mapWMask);
  let c10 = classicColorAt(tx + 1, ty, mip, wrap, mapHMask, mapWMask);
  let c01 = classicColorAt(tx, ty + 1, mip, wrap, mapHMask, mapWMask);
  let c11 = classicColorAt(tx + 1, ty + 1, mip, wrap, mapHMask, mapWMask);
  return bilinearColor(c00, c10, c01, c11, fx, fy);
}

fn frustumShade(
  px: f32,
  py: f32,
  hByte: u32,
  z: f32,
  farClip: f32,
  useFine: bool,
  mip: i32,
  flags: u32,
  repeat: bool,
  mapHMask: i32,
  mapWMask: i32,
  debugView: u32,
  sampleN: u32,
  worldX: f32,
  worldY: f32
) -> u32 {
  if (debugView != DEBUG_COLOR) {
    if (debugView == DEBUG_HEIGHT) { return encodeHeight(hByte); }
    if (debugView == DEBUG_DEPTH) {
      var depthT = 0.0;
      if (farClip > 0.0) { depthT = z / farClip; }
      return encodeUnit(depthT);
    }
    return encodeIter(sampleN);
  }
  let plot = detailColor(
    classicSampleColor(
      px,
      py,
      mip,
      flagShowDetails(flags) && useFine,
      select(1u, lod0RefineSubdivAt(lod0RefineMipAt(z)), flagShowDetails(flags) && useFine),
      repeat,
      mapHMask,
      mapWMask
    ),
    worldX,
    worldY,
    z
  );
  return packRgba(plot);
}

fn storeColumn(x: i32, y: i32, packed: u32, screenW: i32, pair: i32) {
  var i = 0;
  loop {
    if (i >= pair || x + i >= screenW) {
      break;
    }
    textureStore(outTex, vec2<i32>(x + i, y), vec4<u32>(packed, 0u, 0u, 0u));
    i = i + 1;
  }
}

// One thread per two-pixel column: view-Z slices front-to-back with a
// persistent horizon. See scripts/render/frustumspacemarch.js.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let screenW = i32(frame.screenPano.x);
  let screenH = i32(frame.screenPano.y);
  let pair = i32(max(pixelOffsets[0], 1u));
  let x = i32(gid.x) * pair;
  if (x >= screenW) {
    return;
  }

  let debugView = flagDebugView(frame.mapFlags.w);
  // A 2D clear already wrote the sky marker. The column thread only marches.
  if (!flagScreenClear(frame.mapFlags.w)) {
    var y = 0;
    loop {
      if (y >= screenH) {
        break;
      }
      var sky = 0u;
      if (debugView == DEBUG_COLOR) {
        if (skyPacked()) {
          sky = skyUnfilledColor();
        } else {
          sky = skyColorAt(x, y);
        }
      }
      storeColumn(x, y, sky, screenW, pair);
      y = y + 1;
    }
  }

  let cam = frame.camPosTanHalfX.xyz;
  let tanHalfX = frame.camPosTanHalfX.w;
  let right = frame.camRightDst.xyz;
  let dst = frame.camRightDst.w;
  let up = frame.camUpHorizon.xyz;
  let fwd = frame.camFwdPad.xyz;
  let farClip = frame.sinCosNearFar.w;
  let altitude = frame.tMaxMinDzAltMaxH.z;
  let maxHeight = frame.tMaxMinDzAltMaxH.w;
  let mapW = i32(frame.mapFlags.x);
  let mapH = i32(frame.mapFlags.y);
  let flags = frame.mapFlags.w;
  let repeat = flagRepeat(flags);
  let lodCount = i32(frame.extraU.y);
  let altScale = altitude / 255.0;
  let mapWMask = mapW - 1;
  let mapHMask = mapH - 1;
  let ceiling = maxHeight;
  let screenHorizon = f32(screenH) * 0.5;
  let invH2 = select(1.0 / dst, 0.0, dst == 0.0);
  let screenWidthScaler = 1.0 / f32(screenW);
  let slopeCap = select(altitude, frame.sampleLimit.w, frame.sampleLimit.w > 0.0);

  let rowBase = screenHorizon - 0.5;
  let upXY = length(up.xy);
  let xn = (f32(x) + 0.5) * (2.0 * screenWidthScaler) - 1.0;
  let mapWf = f32(mapW);
  let mapHf = f32(mapH);

  var sampleN = 0u;
  var sy = screenH - 1;
  var t = lodDistances[0];
  var step = 0.0;
  var guard = 0u;
  loop {
    if ((sy < 0) || (t >= farClip) || (guard >= MAX_STEPS)) { break; }
    guard = guard + 1u;
    var mip = 0;
    loop {
      if ((mip + 1 >= lodCount) || (t < lodDistances[mip + 1])) { break; }
      mip = mip + 1;
    }
    let mipScale = exp2(-f32(mip));
    let lodWMask = (mapW >> u32(max(mip, 0))) - 1;
    let lodHMask = (mapH >> u32(max(mip, 0))) - 1;
    step = max(bandMarchStep(lodDeltas[mip], mip, t), 1.0e-4);
    let yn = (rowBase - f32(sy)) * invH2;
    let dir = fwd + right * (xn * tanHalfX) + up * yn;
    var pos = cam + dir * t;
    if ((pos.z > ceiling) && !(dir.z < 0.0)) {
      break;
    }
    let inside = ((pos.x >= 0.0) && (pos.x <= mapWf) && (pos.y >= 0.0) && (pos.y <= mapHf)) || repeat;
    if (!inside) {
      t = t + step;
      continue;
    }
    {
      let useFine = lod0RefineAt(t, mip);
      let refineMip = lod0RefineMipAt(t);
      let level = vmaxLevel(mip, useFine, refineMip);
      let bits = vmaxShift(mip, useFine, refineMip);
      let levels = textureNumLevels(vmaxTex);
      let lv = min(u32(max(level, 0)), levels - 1u);
      let cell = exp2(f32(lv));
      var coarse = step * exp2(f32(bits));
      if (coarse > cell) {
        coarse = cell;
      }
      if (coarse > step * 0.5 && pos.z >= vmaxMeters(pos.x, pos.y, i32(lv), altScale, repeat)) {
        var cursor = t;
        var hops = 0u;
        var bandEnd = farClip;
        if (mip + 1 < lodCount && lodDistances[mip + 1] > t && lodDistances[mip + 1] < bandEnd) {
          bandEnd = lodDistances[mip + 1];
        }
        if (useFine) {
          var nearEdge = frame.detailTail.x;
          if (refineMip <= 0) {
            nearEdge = frame.stepScaleCaps.y;
          } else if (refineMip == 1) {
            nearEdge = frame.stepScaleCaps.z;
          } else if (refineMip == 2) {
            nearEdge = frame.stepScaleCaps.w;
          } else if (refineMip == 3) {
            nearEdge = frame.mipSwitchYHit.y;
          }
          if (nearEdge > t && nearEdge < bandEnd) {
            bandEnd = nearEdge;
          }
        }
        loop {
          if (hops >= 32u) { break; }
          let next = cursor + coarse;
          if (next >= bandEnd) { break; }
          let p2 = cam + dir * next;
          let inMap = (p2.x >= 0.0 && p2.x <= mapWf && p2.y >= 0.0 && p2.y <= mapHf) || repeat;
          if (!inMap || p2.z < vmaxMeters(p2.x, p2.y, i32(lv), altScale, repeat)) { break; }
          cursor = next;
          hops = hops + 1u;
        }
        if (cursor > t) {
          t = cursor;
          pos = cam + dir * t;
          let still = (pos.x >= 0.0 && pos.x <= mapWf && pos.y >= 0.0 && pos.y <= mapHf) || repeat;
          if (!still) {
            t = t + step;
            continue;
          }
        }
      }
    }
    let useFine = lod0RefineAt(t, mip);
    let doLerp = flagShowDetails(flags) && useFine;
    let sampled = classicSampleHeight(
      pos.x * mipScale,
      pos.y * mipScale,
      mip,
      doLerp,
      select(1u, lod0RefineSubdivAt(lod0RefineMipAt(t)), doLerp),
      repeat,
      lodHMask,
      lodWMask);
    let baseWorld = sampled.x * altScale;
    let addBytes = detailHeightBytesReached(pos.x, pos.y, t, baseWorld, pos.z);
    let hFine = sampled.x + addBytes;
    sampleN = sampleN + 1u;
    if (pos.z < hFine * altScale) {
      let plot = frustumShade(
        pos.x * mipScale,
        pos.y * mipScale,
        u32(clamp(hFine + 0.5, 0.0, 255.0)),
        t,
        farClip,
        useFine,
        mip,
        flags,
        repeat,
        lodHMask,
        lodWMask,
        debugView,
        sampleN,
        pos.x,
        pos.y
      );
      storeColumn(x, sy, plot, screenW, pair);
      sy = sy - 1;
      let prev = t - step;
      let t0 = lodDistances[0];
      t = select(t0, prev, prev > t0);
    } else {
      t = t + step;
    }
  }
}
