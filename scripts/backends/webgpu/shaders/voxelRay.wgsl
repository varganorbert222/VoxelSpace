@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var heightTex: texture_2d<u32>;
@group(1) @binding(1) var colorTex: texture_2d<f32>;
@group(1) @binding(2) var<storage, read> mipSwitchArr: array<f32, 16>;
@group(2) @binding(0) var outTex: texture_storage_2d<r32uint, write>;

const VOXEL_MAX_STEPS: u32 = 16384u;
const VOXEL_REFINE_MAX_STEPS: u32 = 65536u;
const AABB_Z_EPS: f32 = 1e-4;
const DIR_XY_EPS: f32 = 1e-8;
const DIR_FWD_EPS: f32 = 1e-4;
const SLAB_EPS: f32 = 1e-8;
const HIT_T_EPS: f32 = 1e-4;
const EPS: f32 = 1e-6;
const XY_INF: f32 = 1e30;

struct VoxelXyCell {
  ix: i32,
  iy: i32,
  tFar: f32,
}

fn gridIndex(p: f32, dir: f32, cellSize: f32) -> i32 {
  var i = i32(floor(p / cellSize));
  if (dir < -SLAB_EPS) {
    let edge = f32(i) * cellSize;
    let tol = max(cellSize * 1e-5, abs(p) * 1e-6);
    if (p <= edge + tol) {
      i = i - 1;
    }
  }
  return i;
}

struct SlabExit {
  tx: f32,
  ty: f32,
  t: f32,
}

fn slabExit(camX: f32, camY: f32, dirX: f32, dirY: f32, ix: i32, iy: i32, cellSize: f32) -> SlabExit {
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
  return SlabExit(tFarX, tFarY, min(tFarX, tFarY));
}

fn voxelXyCell(camX: f32, camY: f32, dirX: f32, dirY: f32, s: f32, cellSize: f32) -> VoxelXyCell {
  let e = max(cellSize * 1e-4, 1e-6);
  let px = camX + dirX * (s + e);
  let py = camY + dirY * (s + e);
  var ix = gridIndex(px, dirX, cellSize);
  var iy = gridIndex(py, dirY, cellSize);
  var far = slabExit(camX, camY, dirX, dirY, ix, iy, cellSize);
  if (!(far.t > s)) {
    let tol = max(e, cellSize * 1e-4);
    let stepX = far.tx <= s + tol;
    let stepY = far.ty <= s + tol;
    if (stepX && dirX > SLAB_EPS) {
      ix = ix + 1;
    } else if (stepX && dirX < -SLAB_EPS) {
      ix = ix - 1;
    }
    if (stepY && dirY > SLAB_EPS) {
      iy = iy + 1;
    } else if (stepY && dirY < -SLAB_EPS) {
      iy = iy - 1;
    }
    far = slabExit(camX, camY, dirX, dirY, ix, iy, cellSize);
    if (!(far.t > s)) {
      let ad = max(abs(dirX), abs(dirY));
      far.t = s + select(e, cellSize / ad, ad > e);
    }
  }
  return VoxelXyCell(ix, iy, far.t);
}

struct SurfCorners {
  z00: f32,
  z10: f32,
  z01: f32,
  z11: f32,
  zMax: f32,
}

fn patchHeight(u: f32, v: f32, z00: f32, z10: f32, z01: f32, z11: f32) -> f32 {
  let fu = clamp(u, 0.0, 1.0);
  let fv = clamp(v, 0.0, 1.0);
  if (fv <= fu) {
    return z00 + (z10 - z00) * fu + (z11 - z10) * fv;
  }
  return z00 + (z11 - z01) * fu + (z01 - z00) * fv;
}

fn rayTri(o: vec3f, d: vec3f, a: vec3f, b: vec3f, c: vec3f) -> f32 {
  let e1 = b - a;
  let e2 = c - a;
  let p = cross(d, e2);
  let det = dot(e1, p);
  if (det > -1e-8 && det < 1e-8) {
    return -1.0;
  }
  let inv = 1.0 / det;
  let tvec = o - a;
  let u = dot(tvec, p) * inv;
  if (u < -1e-4 || u > 1.0 + 1e-4) {
    return -1.0;
  }
  let q = cross(tvec, e1);
  let v = dot(d, q) * inv;
  if (v < -1e-4 || u + v > 1.0 + 1e-4) {
    return -1.0;
  }
  return dot(e2, q) * inv;
}

fn patchHit(o: vec3f, d: vec3f, x0: f32, y0: f32, cell: f32, surf: SurfCorners, s: f32, sExit: f32) -> f32 {
  let x1 = x0 + cell;
  let y1 = y0 + cell;
  var best = -1.0;
  let tA = rayTri(o, d, vec3f(x0, y0, surf.z00), vec3f(x1, y0, surf.z10), vec3f(x1, y1, surf.z11));
  let tB = rayTri(o, d, vec3f(x0, y0, surf.z00), vec3f(x1, y1, surf.z11), vec3f(x0, y1, surf.z01));
  if (tA >= s - HIT_T_EPS && tA <= sExit + HIT_T_EPS) {
    best = clamp(tA, s, sExit);
  }
  if (tB >= s - HIT_T_EPS && tB <= sExit + HIT_T_EPS) {
    let hitB = clamp(tB, s, sExit);
    if (best < 0.0 || hitB < best) {
      best = hitB;
    }
  }
  return best;
}

fn sampleCorners(ix: i32, iy: i32, mip: i32, wrap: bool, altitude: f32) -> SurfCorners {
  let scale = altitude / 255.0;
  var z00: f32;
  var z10: f32;
  var z01: f32;
  var z11: f32;
  if (mip <= 0) {
    z00 = f32(terrainHeightAt(heightTex, ix, iy, 0, wrap)) * scale;
    z10 = f32(terrainHeightAt(heightTex, ix + 1, iy, 0, wrap)) * scale;
    z01 = f32(terrainHeightAt(heightTex, ix, iy + 1, 0, wrap)) * scale;
    z11 = f32(terrainHeightAt(heightTex, ix + 1, iy + 1, 0, wrap)) * scale;
  } else {
    z00 = f32(terrainHeightAt(heightTex, ix, iy, mip, wrap)) * scale;
    z10 = f32(terrainHeightAt(heightTex, ix + 1, iy, mip, wrap)) * scale;
    z01 = f32(terrainHeightAt(heightTex, ix, iy + 1, mip, wrap)) * scale;
    z11 = f32(terrainHeightAt(heightTex, ix + 1, iy + 1, mip, wrap)) * scale;
  }
  return SurfCorners(z00, z10, z01, z11, max(max(z00, z10), max(z01, z11)));
}

fn coarseEdgeTop(ix: i32, iy: i32, mip: i32, wrap: bool, altitude: f32) -> f32 {
  let h00 = f32(terrainHeightAt(heightTex, ix, iy, mip, wrap));
  let h10 = f32(terrainHeightAt(heightTex, ix + 1, iy, mip, wrap));
  let h01 = f32(terrainHeightAt(heightTex, ix, iy + 1, mip, wrap));
  let h11 = f32(terrainHeightAt(heightTex, ix + 1, iy + 1, mip, wrap));
  return max(max(h00, h10), max(h01, h11)) * (altitude / 255.0);
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
    if (!(dirZ < 0.0)) {
      return -1.0;
    }
    tHit = (h - camZ) / dirZ;
  } else if (zEnter < 0.0) {
    if (!(dirZ > 0.0)) {
      return -1.0;
    }
    tHit = (0.0 - camZ) / dirZ;
  }
  if (tHit < s - HIT_T_EPS || tHit > sExit + HIT_T_EPS) {
    return -1.0;
  }
  if (tHit < s) {
    tHit = s;
  }
  if (tHit > sExit) {
    tHit = sExit;
  }
  return tHit;
}

fn voxelGridSize(mip: i32) -> f32 {
  if (mip <= 0) {
    return 1.0;
  }
  return exp2(f32(mip));
}

fn detailTargetLevel(depth: f32) -> i32 {
  let subdiv = lod0RefineSubdivAt(lod0RefineMipAt(depth));
  if (subdiv >= 16u) {
    return 0;
  }
  if (subdiv >= 8u) {
    return 1;
  }
  if (subdiv >= 4u) {
    return 2;
  }
  return 3;
}

fn detailSubdivOf(level: i32) -> f32 {
  if (level <= 0) {
    return 16.0;
  }
  if (level == 1) {
    return 8.0;
  }
  if (level == 2) {
    return 4.0;
  }
  return 2.0;
}

fn detailLevelOfSubdiv(subdiv: f32) -> i32 {
  if (subdiv >= 16.0) {
    return 0;
  }
  if (subdiv >= 8.0) {
    return 1;
  }
  if (subdiv >= 4.0) {
    return 2;
  }
  return 3;
}

struct RayHeightSpan {
  s0: f32,
  s1: f32,
  ok: bool,
}

fn rayHeightSpan(camZ: f32, dirZ: f32, ceiling: f32, sNear: f32, sFar: f32) -> RayHeightSpan {
  var s0 = sNear;
  var s1 = sFar;
  if (camZ > ceiling) {
    if (!(dirZ < -SLAB_EPS)) {
      return RayHeightSpan(s0, s1, false);
    }
    let sCeil = (ceiling - camZ) / dirZ;
    if (sCeil > s0) {
      s0 = sCeil;
    }
  } else if (dirZ > SLAB_EPS) {
    let sCeil = (ceiling - camZ) / dirZ;
    if (sCeil < s1) {
      s1 = sCeil;
    }
  }
  if (!(s0 < s1)) {
    return RayHeightSpan(s0, s1, false);
  }
  return RayHeightSpan(s0, s1, true);
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

fn voxelQuantHeight(wx: f32, wy: f32, t: f32, wrap: bool, showFine: bool) -> f32 {
  let tx = i32(floor(wx));
  let ty = i32(floor(wy));
  let nearest = f32(terrainHeightAt(heightTex, tx, ty, 0, wrap));
  if (!showFine || !lod0RefineAt(t, 0)) {
    return nearest;
  }
  let subdiv = lod0RefineSubdivAt(lod0RefineMipAt(t));
  var fx = wx - floor(wx);
  var fy = wy - floor(wy);
  if (subdiv > 1u) {
    fx = subcellCenter(fx, subdiv);
    fy = subcellCenter(fy, subdiv);
  }
  let h00 = f32(terrainHeightAt(heightTex, tx, ty, 0, wrap));
  let h10 = f32(terrainHeightAt(heightTex, tx + 1, ty, 0, wrap));
  let h01 = f32(terrainHeightAt(heightTex, tx, ty + 1, 0, wrap));
  let h11 = f32(terrainHeightAt(heightTex, tx + 1, ty + 1, 0, wrap));
  return bilinearHeight(h00, h10, h01, h11, fx, fy);
}

fn voxelColumn(skipMip: i32, ix: i32, iy: i32, cellSize: f32, t: f32, probeZ: f32) -> VoxelColumn {
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
    hFine = voxelQuantHeight(wx, wy, t, wrap, flagShowDetails(frame.mapFlags.w));
    let bump = detailColumnBump(wx, wy, t);
    let baseWorld = hFine * (altitude / 255.0);
    if (probeZ <= baseWorld + bump.y * (altitude / 255.0)) {
      hFine = hFine + bump.z;
    }
    hByte = u32(clamp(hFine + 0.5, 0.0, 255.0));
  } else {
    let wx = (f32(ix) + 0.5) * cellSize;
    let wy = (f32(iy) + 0.5) * cellSize;
    hFine = f32(terrainHeightAt(heightTex, ix, iy, skipMip, wrap));
    let bump = detailColumnBump(wx, wy, t);
    let baseWorld = hFine * (altitude / 255.0);
    if (probeZ <= baseWorld + bump.y * (altitude / 255.0)) {
      hFine = hFine + bump.z;
    }
    hByte = u32(clamp(hFine + 0.5, 0.0, 255.0));
  }
  var h = hFine * (altitude / 255.0);
  if (!(h > 0.0)) {
    h = AABB_Z_EPS;
  }
  return VoxelColumn(h, hByte, colX, colY);
}

fn voxelQuantColor(wx: f32, wy: f32, dist: f32, wrap: bool, showFine: bool) -> vec4f {
  let tx = i32(floor(wx));
  let ty = i32(floor(wy));
  if (!showFine || !lod0RefineAt(dist, 0)) {
    return terrainColorAt(colorTex, tx, ty, 0, wrap);
  }
  let subdiv = lod0RefineSubdivAt(lod0RefineMipAt(dist));
  var fx = wx - floor(wx);
  var fy = wy - floor(wy);
  if (subdiv > 1u) {
    fx = subcellCenter(fx, subdiv);
    fy = subcellCenter(fy, subdiv);
  }
  return bilinearColor(
    terrainColorAt(colorTex, tx, ty, 0, wrap),
    terrainColorAt(colorTex, tx + 1, ty, 0, wrap),
    terrainColorAt(colorTex, tx, ty + 1, 0, wrap),
    terrainColorAt(colorTex, tx + 1, ty + 1, 0, wrap),
    fx,
    fy
  );
}

fn voxelHitColor(mip: i32, ix: i32, iy: i32, cellSize: f32, colX: i32, colY: i32, dist: f32) -> vec4f {
  let wrap = flagRepeat(frame.mapFlags.w);
  let wx = (f32(ix) + 0.5) * cellSize;
  let wy = (f32(iy) + 0.5) * cellSize;
  var base: vec4f;
  if (mip <= 0) {
    base = voxelQuantColor(wx, wy, dist, wrap, flagShowDetails(frame.mapFlags.w));
  } else {
    base = terrainColorAt(colorTex, colX, colY, mip, wrap);
  }
  return detailColor(base, wx, wy, dist);
}

struct DetailLeaf {
  h: f32,
  hByte: u32,
}

fn detailLeafHeight(ix: i32, iy: i32, cellSize: f32, wrap: bool, altitude: f32) -> DetailLeaf {
  let wx = (f32(ix) + 0.5) * cellSize;
  let wy = (f32(iy) + 0.5) * cellSize;
  let subdiv = u32(max(1.0 / cellSize + 0.5, 1.0));
  let tx = i32(floor(wx));
  let ty = i32(floor(wy));
  var fx = wx - floor(wx);
  var fy = wy - floor(wy);
  if (subdiv > 1u) {
    fx = subcellCenter(fx, subdiv);
    fy = subcellCenter(fy, subdiv);
  }
  let hFine = bilinearHeight(
    f32(terrainHeightAt(heightTex, tx, ty, 0, wrap)),
    f32(terrainHeightAt(heightTex, tx + 1, ty, 0, wrap)),
    f32(terrainHeightAt(heightTex, tx, ty + 1, 0, wrap)),
    f32(terrainHeightAt(heightTex, tx + 1, ty + 1, 0, wrap)),
    fx,
    fy
  );
  let bump = detailSpanAt(wx, wy, detailLevelOfSubdiv(f32(subdiv))).y;
  var h = (hFine + bump) * (altitude / 255.0);
  if (!(h > 0.0)) {
    h = AABB_Z_EPS;
  }
  return DetailLeaf(h, u32(clamp(hFine + bump + 0.5, 0.0, 255.0)));
}

fn detailBilinearAt(wx: f32, wy: f32, wrap: bool) -> f32 {
  let tx = i32(floor(wx));
  let ty = i32(floor(wy));
  let fx = wx - floor(wx);
  let fy = wy - floor(wy);
  return bilinearHeight(
    f32(terrainHeightAt(heightTex, tx, ty, 0, wrap)),
    f32(terrainHeightAt(heightTex, tx + 1, ty, 0, wrap)),
    f32(terrainHeightAt(heightTex, tx, ty + 1, 0, wrap)),
    f32(terrainHeightAt(heightTex, tx + 1, ty + 1, 0, wrap)),
    fx,
    fy
  );
}

fn detailCellTop(ix: i32, iy: i32, cellSize: f32, level: i32, wrap: bool, altitude: f32) -> f32 {
  let x0 = f32(ix) * cellSize;
  let y0 = f32(iy) * cellSize;
  let x1 = x0 + cellSize;
  let y1 = y0 + cellSize;
  let hMax = max(
    max(detailBilinearAt(x0, y0, wrap), detailBilinearAt(x1, y0, wrap)),
    max(detailBilinearAt(x0, y1, wrap), detailBilinearAt(x1, y1, wrap))
  );
  let bump = detailSpanAt(x0 + cellSize * 0.5, y0 + cellSize * 0.5, level).y;
  var h = (hMax + bump) * (altitude / 255.0);
  if (!(h > 0.0)) {
    h = AABB_Z_EPS;
  }
  return h;
}

fn detailMeterTop(ix: i32, iy: i32, wrap: bool, altitude: f32) -> f32 {
  let hMax = max(
    max(
      f32(terrainHeightAt(heightTex, ix, iy, 0, wrap)),
      f32(terrainHeightAt(heightTex, ix + 1, iy, 0, wrap))
    ),
    max(
      f32(terrainHeightAt(heightTex, ix, iy + 1, 0, wrap)),
      f32(terrainHeightAt(heightTex, ix + 1, iy + 1, 0, wrap))
    )
  );
  let x0 = f32(ix);
  let y0 = f32(iy);
  let bump = max(
    max(detailSpanAt(x0 + 0.25, y0 + 0.25, 3).y, detailSpanAt(x0 + 0.75, y0 + 0.25, 3).y),
    max(detailSpanAt(x0 + 0.25, y0 + 0.75, 3).y, detailSpanAt(x0 + 0.75, y0 + 0.75, 3).y)
  );
  var h = (hMax + bump) * (altitude / 255.0);
  if (!(h > 0.0)) {
    h = AABB_Z_EPS;
  }
  return h;
}

struct DetailMarch {
  hit: i32,
  k: u32,
  s: f32,
  depth: f32,
  hByte: u32,
  color: vec4f,
}

fn marchDetail(
  cam: vec3f,
  dir: vec3f,
  dirFwd: f32,
  sIn: f32,
  sLimit: f32,
  kIn: u32,
  maxSteps: u32,
  wrap: bool,
  altitude: f32
) -> DetailMarch {
  var s = sIn;
  var k = kIn;
  var level = 3;
  loop {
    if ((s >= sLimit) || (k >= maxSteps)) {
      break;
    }
    k = k + 1u;
    let depth = s * dirFwd;
    if (!lod0RefineAt(depth, 0)) {
      break;
    }
    let band = detailTargetLevel(depth);
    if (level < band) {
      level = band;
    }
    let cellSize = 1.0 / detailSubdivOf(level);
    let span = voxelXyCell(cam.x, cam.y, dir.x, dir.y, s, cellSize);
    var sExit = span.tFar;
    if (sExit > sLimit) {
      sExit = sLimit;
    }
    if (!(sExit > s)) {
      s = s + max(cellSize * 1e-4, 1e-6);
      continue;
    }
    let zEnter = cam.z + dir.z * s;
    let zExitV = cam.z + dir.z * sExit;
    let zLo = min(zEnter, zExitV);
    let zHi = max(zEnter, zExitV);
    let leafNow = level <= band;
    var hTop = 0.0;
    var leaf = DetailLeaf(0.0, 0u);
    if (leafNow) {
      leaf = detailLeafHeight(span.ix, span.iy, cellSize, wrap, altitude);
      hTop = leaf.h;
    } else {
      hTop = detailCellTop(span.ix, span.iy, cellSize, level, wrap, altitude);
    }
    if ((zHi < 0.0) || (zLo > hTop)) {
      s = sExit;
      if (level < 3) {
        level = level + 1;
      }
      continue;
    }
    if (!leafNow) {
      level = level - 1;
      continue;
    }
    let sHit = voxelColumnHit(cam.z, dir.z, leaf.h, s, sExit);
    if (sHit >= 0.0) {
      let depthHit = sHit * dirFwd;
      return DetailMarch(
        1,
        k,
        sHit,
        depthHit,
        leaf.hByte,
        voxelHitColor(0, span.ix, span.iy, cellSize, 0, 0, depthHit)
      );
    }
    s = sExit;
  }
  return DetailMarch(0, k, s, 0.0, 0u, vec4f(0.0));
}

fn voxelWrite(
  p: vec2i,
  color: vec4f,
  dist: f32,
  hByte: u32,
  iter: u32,
  hatZ: f32,
  farClip: f32,
  nearClip: f32
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
  if ((dist >= farClip) || (dist < nearClip)) {
    outColor = packRgba(skyColorFromHat(hatZ, frame.sky, frame.horizonColor));
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
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, 0.0, farClip, nearClip);
    return;
  }
  let dir = d / len;
  let hatZ = dir.z;
  let dirFwd = dot(dir, fwd);
  let ceiling = frame.tMaxMinDzAltMaxH.w;
  let altitude = frame.tMaxMinDzAltMaxH.z;
  let depthNear = s0 * max(dirFwd, 0.0);
  let camInDetail = flagShowDetails(frame.mapFlags.w) && lod0RefineAt(depthNear, 0);
  var camCell = 1.0;
  var camIx = i32(floor(cam.x));
  var camIy = i32(floor(cam.y));
  var hCamByte = 0u;
  var hCamW = 0.0;
  if (camInDetail) {
    let level = detailTargetLevel(depthNear);
    camCell = 1.0 / detailSubdivOf(level);
    camIx = i32(floor(cam.x / camCell));
    camIy = i32(floor(cam.y / camCell));
    let leaf = detailLeafHeight(camIx, camIy, camCell, wrap, altitude);
    hCamByte = leaf.hByte;
    hCamW = leaf.h;
  } else if (lod0RefineAt(depthNear, 0)) {
    let camPatch = sampleCorners(camIx, camIy, 0, wrap, altitude);
    hCamW = patchHeight(cam.x - f32(camIx), cam.y - f32(camIy), camPatch.z00, camPatch.z10, camPatch.z01, camPatch.z11);
    hCamByte = u32(clamp(hCamW / (altitude / 255.0) + 0.5, 0.0, 255.0));
  } else {
    let camCol = voxelColumn(0, camIx, camIy, 1.0, s0, cam.z);
    hCamByte = camCol.hByte;
    hCamW = camCol.h;
  }
  let camInside = wrap || ((cam.x >= 0.0) && (cam.x < mapW) && (cam.y >= 0.0) && (cam.y < mapH));
  if (camInside && (cam.z <= hCamW)) {
    voxelWrite(
      p,
      voxelHitColor(0, camIx, camIy, camCell, 0, 0, s0),
      s0,
      hCamByte,
      1u,
      hatZ,
      farClip,
      nearClip
    );
    return;
  }
  let lenXY2 = dir.x * dir.x + dir.y * dir.y;
  if (!(dirFwd > DIR_FWD_EPS)) {
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
    return;
  }
  let sNear = s0 / dirFwd;
  let sFar = farClip / dirFwd;
  let spanZ = rayHeightSpan(cam.z, dir.z, ceiling, sNear, sFar);
  if (!spanZ.ok) {
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
    return;
  }
  if (!(lenXY2 > DIR_XY_EPS)) {
    if (!camInside) {
      voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
      return;
    }
    if (dir.z < 0.0) {
      if (cam.z > hCamW) {
        let sHit = (hCamW - cam.z) / dir.z;
        let depthHit = sHit * dirFwd;
        if (sHit >= spanZ.s0 && sHit <= spanZ.s1 && depthHit >= s0 && depthHit <= farClip) {
          voxelWrite(
            p,
            voxelHitColor(0, camIx, camIy, camCell, 0, 0, depthHit),
            depthHit,
            hCamByte,
            1u,
            hatZ,
            farClip,
            nearClip
          );
          return;
        }
      }
    } else if (hCamW > cam.z) {
      let sHit = (hCamW - cam.z) / dir.z;
      let depthHit = sHit * dirFwd;
      if (sHit >= spanZ.s0 && sHit <= spanZ.s1 && depthHit >= s0 && depthHit <= farClip) {
        voxelWrite(
          p,
          voxelHitColor(0, camIx, camIy, camCell, 0, 0, depthHit),
          depthHit,
          hCamByte,
          1u,
          hatZ,
          farClip,
          nearClip
        );
        return;
      }
    }
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
    return;
  }

  var s = spanZ.s0;
  let sEnd = spanZ.s1;
  var mip = lastMip;
  var k = 0u;
  var wasInside = 0;
  let maxSteps = VOXEL_REFINE_MAX_STEPS;
  loop {
    if ((s >= sEnd) || (k >= maxSteps)) {
      break;
    }
    k = k + 1u;
    let depth = s * dirFwd;
    let zHere = cam.z + dir.z * s;
    if (zHere > ceiling && !(dir.z < 0.0)) {
      break;
    }
    let cellSize = voxelGridSize(mip);
    let span = voxelXyCell(cam.x, cam.y, dir.x, dir.y, s, cellSize);
    let ix = span.ix;
    let iy = span.iy;
    var sExit = span.tFar;
    if (sExit > sEnd) {
      sExit = sEnd;
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
    let inDetail = (mip <= 0) && flagShowDetails(frame.mapFlags.w) && lod0RefineAt(depth, 0);
    var hMax = 0.0;
    var col = VoxelColumn(0.0, 0u, ix, iy);
    if (inDetail) {
      hMax = detailMeterTop(ix, iy, wrap, altitude);
    } else {
      col = voxelColumn(mip, ix, iy, cellSize, depth, zLo);
      hMax = col.h;
    }
    if (zHi < 0.0) {
      s = sExit;
      if (mip < lastMip) {
        mip = mip + 1;
      }
      continue;
    }
    let nearPatch = (mip <= 0) && !inDetail;
    var surfMax = hMax;
    if (zLo > hMax) {
      if (nearPatch) {
        let above = sampleCorners(ix, iy, mip, wrap, altitude);
        if (above.zMax > surfMax) {
          surfMax = above.zMax;
        }
      } else if (mip > 0) {
        let edge = coarseEdgeTop(ix, iy, mip, wrap, altitude);
        if (edge > surfMax) {
          surfMax = edge;
        }
      }
      if (zLo > surfMax && !inDetail) {
        let bump = detailElevMaxBytes(depth) * (altitude / 255.0);
        if (bump > 0.0) {
          surfMax = surfMax + bump;
        }
      }
    }
    if (zLo > surfMax) {
      s = sExit;
      let approaching = ((dir.z < 0.0) && (zEnter > surfMax)) || ((dir.z > 0.0) && (zEnter < 0.0));
      if (!approaching && (mip < lastMip)) {
        mip = mip + 1;
      }
      continue;
    }
    let band = bandMipAt(depth, lastMip);
    if (mip > band) {
      mip = mip - 1;
      continue;
    }
    if (mip < band) {
      mip = band;
      continue;
    }
    if (inDetail) {
      let refined = marchDetail(cam, dir, dirFwd, s, sExit, k, maxSteps, wrap, altitude);
      k = refined.k;
      if (refined.hit != 0) {
        let hx = cam.x + dir.x * refined.s;
        let hy = cam.y + dir.y * refined.s;
        if (!wrap) {
          let hitInside = (hx >= 0.0) && (hx < mapW) && (hy >= 0.0) && (hy < mapH);
          if (!hitInside) {
            break;
          }
        }
        voxelWrite(p, refined.color, refined.depth, refined.hByte, refined.k, hatZ, farClip, nearClip);
        return;
      }
      s = sExit;
      continue;
    }
    if (!nearPatch) {
      let columnHit = voxelColumnHit(cam.z, dir.z, col.h, s, sExit);
      if (columnHit < 0.0) {
        s = sExit;
        continue;
      }
      let depthHit = columnHit * dirFwd;
      let hx = cam.x + dir.x * columnHit;
      let hy = cam.y + dir.y * columnHit;
      if (!wrap) {
        let hitInside = (hx >= 0.0) && (hx < mapW) && (hy >= 0.0) && (hy < mapH);
        if (!hitInside) {
          break;
        }
      }
      voxelWrite(
        p,
        voxelHitColor(mip, ix, iy, cellSize, col.colX, col.colY, depthHit),
        depthHit,
        col.hByte,
        k,
        hatZ,
        farClip,
        nearClip
      );
      return;
    }
    let surf = sampleCorners(ix, iy, mip, wrap, altitude);
    var sHit = patchHit(cam, dir, x0, y0, cellSize, surf, s, sExit);
    if (!(sHit >= 0.0)) {
      let u = (cam.x + dir.x * s - x0) / cellSize;
      let v = (cam.y + dir.y * s - y0) / cellSize;
      let zs = patchHeight(u, v, surf.z00, surf.z10, surf.z01, surf.z11);
      if (zEnter <= zs && zEnter >= 0.0) {
        sHit = s;
      }
    }
    if (!(sHit >= 0.0)) {
      s = sExit;
      continue;
    }
    let depthHit = sHit * dirFwd;
    let hx = cam.x + dir.x * sHit;
    let hy = cam.y + dir.y * sHit;
    if (!wrap) {
      let hitInside = (hx >= 0.0) && (hx < mapW) && (hy >= 0.0) && (hy < mapH);
      if (!hitInside) {
        break;
      }
    }
    let colorIx = select(ix, i32(floor(hx)), mip <= 0);
    let colorIy = select(iy, i32(floor(hy)), mip <= 0);
    let colorCell = select(cellSize, 1.0, mip <= 0);
    let zSurf = patchHeight((hx - x0) / cellSize, (hy - y0) / cellSize, surf.z00, surf.z10, surf.z01, surf.z11);
    let hByte = u32(clamp(zSurf / (altitude / 255.0) + 0.5, 0.0, 255.0));
    voxelWrite(
      p,
      voxelHitColor(mip, colorIx, colorIy, colorCell, col.colX, col.colY, depthHit),
      depthHit,
      hByte,
      k,
      hatZ,
      farClip,
      nearClip
    );
    return;
  }
  voxelWrite(p, vec4f(0.0), 0.0, 0u, k, hatZ, farClip, nearClip);
}
