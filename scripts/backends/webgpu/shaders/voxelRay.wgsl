@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var heightTex: texture_2d<u32>;
@group(1) @binding(1) var colorTex: texture_2d<f32>;
@group(1) @binding(2) var<storage, read> mipSwitchArr: array<f32, 16>;
@group(2) @binding(0) var outTex: texture_storage_2d<r32uint, write>;

const VOXEL_MAX_STEPS: u32 = 16384u;
const VOXEL_REFINE_MAX_STEPS: u32 = 65536u;
const AABB_Z_EPS: f32 = 1e-4;
const DIR_XY_EPS: f32 = 1e-8;
const SLAB_EPS: f32 = 1e-8;
const EPS: f32 = 1e-6;
const XY_INF: f32 = 1e30;

struct VoxelXyCell {
  ix: i32,
  iy: i32,
  tFar: f32,
}

fn voxelXyCell(camX: f32, camY: f32, dirX: f32, dirY: f32, s: f32, cellSize: f32) -> VoxelXyCell {
  let e = max(cellSize * 1e-4, 1e-6);
  let px = camX + dirX * (s + e);
  let py = camY + dirY * (s + e);
  let ix = i32(floor(px / cellSize));
  let iy = i32(floor(py / cellSize));
  let x0 = f32(ix) * cellSize;
  let y0 = f32(iy) * cellSize;
  var tFarX = XY_INF;
  var tFarY = XY_INF;
  if (dirX > SLAB_EPS) {
    tFarX = (x0 + cellSize - camX) / dirX;
  } else if (dirX < -SLAB_EPS) {
    tFarX = (x0 - camX) / dirX;
  }
  if (dirY > SLAB_EPS) {
    tFarY = (y0 + cellSize - camY) / dirY;
  } else if (dirY < -SLAB_EPS) {
    tFarY = (y0 - camY) / dirY;
  }
  var tFar = min(tFarX, tFarY);
  if (!(tFar > s)) {
    tFar = s + e;
  }
  return VoxelXyCell(ix, iy, tFar);
}

fn voxelColumnHit(camZ: f32, dirZ: f32, h: f32, s: f32, sExit: f32) -> f32 {
  let zEnter = camZ + dirZ * s;
  let zExitV = camZ + dirZ * sExit;
  let zLo = min(zEnter, zExitV);
  let zHi = max(zEnter, zExitV);
  if (zHi < 0.0 || zLo > h) {
    return -1.0;
  }
  var tHit = s;
  if (zEnter > h) {
    if (dirZ < 0.0) {
      tHit = (h - camZ) / dirZ;
    }
  } else if (zEnter < 0.0) {
    if (dirZ > 0.0) {
      tHit = (0.0 - camZ) / dirZ;
    }
  }
  if (tHit < s) {
    tHit = s;
  }
  if (tHit > sExit) {
    tHit = sExit;
  }
  return tHit;
}

fn bandMipAt(t: f32, lastMip: i32) -> i32 {
  var m = 0;
  loop {
    if (m >= lastMip) {
      break;
    }
    if (t < mipSwitchArr[m]) {
      break;
    }
    m = m + 1;
  }
  return m;
}

struct VoxelColumn {
  h: f32,
  hByte: u32,
  colX: i32,
  colY: i32,
}

fn voxelColumn(skipMip: i32, ix: i32, iy: i32, cellSize: f32, t: f32) -> VoxelColumn {
  let wrap = flagRepeat(frame.mapFlags.w);
  let altitude = frame.tMaxMinDzAltMaxH.z;
  var colX = ix;
  var colY = iy;
  var hFine: f32;
  var hByte: u32;
  if (skipMip <= 0) {
    let wx = (f32(ix) + 0.5) * cellSize;
    let wy = (f32(iy) + 0.5) * cellSize;
    colX = i32(floor(wx));
    colY = i32(floor(wy));
    hFine = f32(terrainHeightAt(heightTex, colX, colY, 0, wrap));
    var rm = 0;
    var amp = 0.0;
    if (lod0RefineAt(t, 0)) {
      rm = lod0RefineMipAt(t);
      amp = 1.0;
    }
    hFine = applyLod0RefineHeight(hFine, wx, wy, 0, rm, amp);
    hFine = hFine + detailHeightBytes(wx, wy, t);
    hByte = u32(clamp(hFine + 0.5, 0.0, 255.0));
  } else {
    let wx = (f32(ix) + 0.5) * cellSize;
    let wy = (f32(iy) + 0.5) * cellSize;
    hFine = f32(terrainHeightAt(heightTex, ix, iy, skipMip, wrap)) + detailHeightBytes(wx, wy, t);
    hByte = u32(clamp(hFine + 0.5, 0.0, 255.0));
  }
  var h = hFine * (altitude / 255.0);
  if (!(h > 0.0)) {
    h = AABB_Z_EPS;
  }
  return VoxelColumn(h, hByte, colX, colY);
}

fn voxelHitColor(mip: i32, colX: i32, colY: i32, wx: f32, wy: f32, dist: f32) -> vec4f {
  let base = terrainColorAt(
    colorTex,
    colX,
    colY,
    mip,
    flagRepeat(frame.mapFlags.w)
  );
  return detailColor(base, wx, wy, dist);
}

fn voxelWrite(
  p: vec2i,
  color: vec4f,
  dist: f32,
  hByte: u32,
  iter: u32,
  hatZ: f32,
  farClip: f32,
  nearClip: f32,
  useFog: bool,
  fogStart: f32,
  fogEnd: f32
) {
  let debugView = flagDebugView(frame.mapFlags.w);
  if (debugView != DEBUG_COLOR) {
    textureStore(
      outTex,
      p,
      vec4<u32>(encodeCamera(debugView, dist, hByte, iter, dist, farClip), 0u, 0u, 0u)
    );
    return;
  }
  if (!(dist > 0.0)) {
    textureStore(
      outTex,
      p,
      vec4<u32>(packRgba(skyColorFromHat(hatZ, frame.sky, frame.horizonColor)), 0u, 0u, 0u)
    );
    return;
  }
  var outColor = packRgba(color);
  if (!useFog && ((dist >= farClip) || (dist < nearClip))) {
    outColor = packRgba(skyColorFromHat(hatZ, frame.sky, frame.horizonColor));
  } else if (useFog) {
    let fogT = fogAmount(dist, fogStart, fogEnd);
    if (fogT >= 1.0) {
      outColor = packRgba(vec4f(1.0));
    } else if (fogT > 0.0) {
      outColor = packRgba(fogRgb(color, fogT));
    }
  }
  textureStore(outTex, p, vec4<u32>(outColor, 0u, 0u, 0u));
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let screenW = i32(frame.screenPano.x);
  let screenH = i32(frame.screenPano.y);
  let sx = i32(gid.x);
  let sy = i32(gid.y);
  if (sx >= screenW || sy >= screenH) {
    return;
  }
  let p = vec2<i32>(sx, sy);
  let cam = frame.camPosTanHalfX.xyz;
  let right = frame.camRightDst.xyz;
  let up = frame.camUpHorizon.xyz;
  let fwd = frame.camFwdPad.xyz;
  var tanHalfY = frame.extra.y;
  let pixelCenter = frame.mipInvPixelCenter.w;
  let ndcScale = frame.extra.z;
  let nearClip = frame.sinCosNearFar.z;
  let farClip = frame.sinCosNearFar.w;
  let wrap = flagRepeat(frame.mapFlags.w);
  let useFog = flagFog(frame.mapFlags.w);
  let fogStart = frame.sampleLimit.y;
  let fogEnd = frame.sampleLimit.z;
  let mapW = f32(frame.mapFlags.x);
  let mapH = f32(frame.mapFlags.y);
  var lastMip = i32(frame.extraU.y) - 1;
  let texLast = i32(textureNumLevels(heightTex)) - 1;
  if (lastMip > texLast) {
    lastMip = texLast;
  }
  if (lastMip < 0) {
    lastMip = 0;
  }
  var s0 = nearClip;
  if (!(s0 > 0.0)) {
    s0 = EPS;
  }
  let invW = 1.0 / f32(screenW);
  let invH = 1.0 / f32(screenH);
  let tanHalfX = tanHalfY * (f32(screenW) / f32(screenH));
  let camXndc = ((f32(sx) + pixelCenter) * invW * ndcScale - 1.0) * tanHalfX;
  let camYndc = (1.0 - (f32(sy) + pixelCenter) * invH * ndcScale) * tanHalfY;
  var d = right * camXndc + up * camYndc + fwd;
  let len = length(d);
  if (!(len > EPS)) {
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, 0.0, farClip, nearClip, useFog, fogStart, fogEnd);
    return;
  }
  let dir = d / len;
  let hatZ = dir.z;
  let camCell = mipCellSize(0, s0);
  let camIx = i32(floor(cam.x / camCell));
  let camIy = i32(floor(cam.y / camCell));
  let camCol = voxelColumn(0, camIx, camIy, camCell, s0);
  let camInside = wrap || ((cam.x >= 0.0) && (cam.x < mapW) && (cam.y >= 0.0) && (cam.y < mapH));
  let hCamByte = camCol.hByte;
  let hCamW = camCol.h;
  if (camInside && (cam.z <= hCamW)) {
    voxelWrite(
      p,
      voxelHitColor(0, camCol.colX, camCol.colY, cam.x, cam.y, s0),
      s0,
      hCamByte,
      1u,
      hatZ,
      farClip,
      nearClip,
      useFog,
      fogStart,
      fogEnd
    );
    return;
  }
  let lenXY2 = dir.x * dir.x + dir.y * dir.y;
  if (!(lenXY2 > DIR_XY_EPS)) {
    if (!camInside) {
      voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip, useFog, fogStart, fogEnd);
      return;
    }
    if (dir.z < 0.0) {
      if (cam.z > hCamW) {
        let sHit = (hCamW - cam.z) / dir.z;
        if (sHit >= s0 && sHit <= farClip) {
          voxelWrite(
            p,
            voxelHitColor(0, camCol.colX, camCol.colY, cam.x, cam.y, sHit),
            sHit,
            hCamByte,
            1u,
            hatZ,
            farClip,
            nearClip,
            useFog,
            fogStart,
            fogEnd
          );
          return;
        }
      }
    } else if (hCamW > cam.z) {
      let sHit = (hCamW - cam.z) / dir.z;
      if (sHit >= s0 && sHit <= farClip) {
        voxelWrite(
          p,
          voxelHitColor(0, camCol.colX, camCol.colY, cam.x, cam.y, sHit),
          sHit,
          hCamByte,
          1u,
          hatZ,
          farClip,
          nearClip,
          useFog,
          fogStart,
          fogEnd
        );
        return;
      }
    }
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip, useFog, fogStart, fogEnd);
    return;
  }

  var s = s0;
  var mip = lastMip;
  var k = 0u;
  var wasInside = 0;
  let maxSteps = select(VOXEL_MAX_STEPS, VOXEL_REFINE_MAX_STEPS, flagLod0Refine(frame.mapFlags.w));
  loop {
    if ((s >= farClip) || (k >= maxSteps)) {
      break;
    }
    k = k + 1u;
    let hitMip = bandMipAt(s, lastMip);
    if (mip < hitMip) {
      mip = hitMip;
    }
    let cellSize = mipCellSize(mip, s);
    let span = voxelXyCell(cam.x, cam.y, dir.x, dir.y, s, cellSize);
    let ix = span.ix;
    let iy = span.iy;
    var sExit = span.tFar;
    if (sExit > farClip) {
      sExit = farClip;
    }
    if (!(sExit > s)) {
      s = s + max(cellSize * 1e-4, 1e-6);
      continue;
    }
    let x0 = f32(ix) * cellSize;
    let y0 = f32(iy) * cellSize;
    if (!wrap) {
      let overlap = (x0 < mapW) && (y0 < mapH) && ((x0 + cellSize) > 0.0) && ((y0 + cellSize) > 0.0);
      if (!overlap) {
        if (wasInside != 0) {
          break;
        }
        s = sExit;
        continue;
      }
      wasInside = 1;
    }
    let zEnter = cam.z + dir.z * s;
    let zExitV = cam.z + dir.z * sExit;
    let zLo = min(zEnter, zExitV);
    let zHi = max(zEnter, zExitV);
    let col = voxelColumn(mip, ix, iy, cellSize, s);
    let hMax = col.h;
    let occEps = max(1e-3, max(abs(zEnter), abs(zExitV)) * 1e-5);
    let stepE = max(cellSize * 1e-4, 1e-6);
    if (zHi < 0.0) {
      s = max(sExit, s + stepE);
      if (mip < lastMip) {
        mip = mip + 1;
      }
      continue;
    }
    if (zLo > hMax + occEps) {
      s = max(sExit, s + stepE);
      let approaching = ((dir.z < 0.0) && (zEnter > hMax)) || ((dir.z > 0.0) && (zEnter < 0.0));
      if (!approaching && (mip < lastMip)) {
        mip = mip + 1;
      }
      continue;
    }
    if (mip > hitMip) {
      mip = mip - 1;
      continue;
    }
    var sHit = voxelColumnHit(cam.z, dir.z, col.h, s, sExit);
    if (sHit < 0.0) {
      sHit = s;
    }
    let hx = cam.x + dir.x * sHit;
    let hy = cam.y + dir.y * sHit;
    if (!wrap) {
      let hitInside = (hx >= 0.0) && (hx < mapW) && (hy >= 0.0) && (hy < mapH);
      if (!hitInside) {
        break;
      }
    }
    voxelWrite(
      p,
      voxelHitColor(mip, col.colX, col.colY, hx, hy, sHit),
      sHit,
      col.hByte,
      k,
      hatZ,
      farClip,
      nearClip,
      useFog,
      fogStart,
      fogEnd
    );
    return;
  }
  voxelWrite(p, vec4f(0.0), 0.0, 0u, k, hatZ, farClip, nearClip, useFog, fogStart, fogEnd);
}
