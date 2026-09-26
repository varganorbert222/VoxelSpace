struct Frame {
  camPosTanHalfX: vec4f,
  camRightDst: vec4f,
  camUpHorizon: vec4f,
  camFwdPad: vec4f,
  sinCosNearFar: vec4f,
  tMaxMinDzAltMaxH: vec4f,
  screenPano: vec4u,
  mapFlags: vec4u,
  sky: vec4f,
  horizonColor: vec4f,
  clipDhTanLastGrowth: vec4f,
  stepScaleCaps: vec4f,
  mipSwitchYHit: vec4f,
  mipInvPixelCenter: vec4f,
  extra: vec4f,
  extraU: vec4u,
  mipShiftCount: vec4u,
  mipSize0: vec4u,
  mipSize1: vec4u,
  mipMask1: vec4u,
  debugRect: vec4u,
  sampleLimit: vec4f,
  detailNear: vec4f,
  detailTail: vec4f,
};

fn packRgba(c: vec4f) -> u32 {
  let r = u32(clamp(c.r, 0.0, 1.0) * 255.0 + 0.5);
  let g = u32(clamp(c.g, 0.0, 1.0) * 255.0 + 0.5);
  let b = u32(clamp(c.b, 0.0, 1.0) * 255.0 + 0.5);
  let a = u32(clamp(c.a, 0.0, 1.0) * 255.0 + 0.5);
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}

fn unpackRgba(p: u32) -> vec4f {
  return vec4f(
    f32(p & 255u),
    f32((p >> 8u) & 255u),
    f32((p >> 16u) & 255u),
    f32((p >> 24u) & 255u)
  ) / 255.0;
}

fn fogRgb(c: vec4f, fogT: f32) -> vec4f {
  return c + (vec4f(1.0) - c) * fogT;
}

fn fogAmount(z: f32, fogStart: f32, fogEnd: f32) -> f32 {
  let span = fogEnd - fogStart;
  if (span == 0.0) {
    return 1.0;
  }
  var t = (z - fogStart) / span;
  if (t < 0.0) {
    t = 0.0;
  }
  if (t > 1.0) {
    t = 1.0;
  }
  return t;
}

const PI: f32 = 3.141592653589793;
const SKY_PALETTE_STEPS: f32 = 24.0;
const SKY_PALETTE_T_MAX: f32 = 23.0 / 24.0;
const SKY_ZENITH_POWER: f32 = 2.75;
fn skyPaletteT(linearT: f32) -> f32 {
  var t = clamp(linearT, 0.0, 1.0);
  t = pow(t, SKY_ZENITH_POWER);
  if (t > SKY_PALETTE_T_MAX) {
    t = SKY_PALETTE_T_MAX;
  }
  return t;
}

fn skyLinearFromHat(hat: f32) -> f32 {
  return (2.0 * acos(clamp(hat, -1.0, 1.0))) / PI;
}

fn skyColorFromHat(hat: f32, sky: vec4f, horizon: vec4f) -> vec4f {
  let t = skyPaletteT(skyLinearFromHat(hat));
  let idx = min(u32(t * SKY_PALETTE_STEPS), 23u);
  return mix(sky, horizon, f32(idx) / SKY_PALETTE_STEPS);
}

fn flagFog(flags: u32) -> bool {
  return (flags & 1u) != 0u;
}

fn flagRepeat(flags: u32) -> bool {
  return (flags & 2u) != 0u;
}

fn flagDebugView(flags: u32) -> u32 {
  return (flags >> 8u) & 3u;
}

fn flagHeightLerp(flags: u32) -> bool {
  return (flags & 4096u) != 0u;
}

fn flagColorFilter(flags: u32) -> bool {
  return (flags & 8192u) != 0u;
}

fn flagLod0Refine(flags: u32) -> bool {
  return (flags & 16384u) != 0u;
}

fn lod0RefineAt(t: f32, mip: i32) -> bool {
  return (mip <= 0) && flagLod0Refine(frame.mapFlags.w);
}

fn lod0RefineMipAt(t: f32) -> i32 {
  var m = 0;
  if (t >= frame.stepScaleCaps.y) {
    m = 1;
  }
  if (t >= frame.stepScaleCaps.z) {
    m = 2;
  }
  if (t >= frame.stepScaleCaps.w) {
    m = 3;
  }
  if (t >= frame.mipSwitchYHit.y) {
    m = 4;
  }
  return m;
}

fn lod0RefineCellAt(t: f32) -> f32 {
  let subdiv = max(16u >> u32(lod0RefineMipAt(t)), 1u);
  return 1.0 / f32(subdiv);
}

fn wrapOrClamp(v: i32, mask: i32, wrap: bool) -> i32 {
  if (wrap) {
    return v & mask;
  }
  var x = v;
  if (x < 0) {
    x = 0;
  }
  if (x > mask) {
    x = mask;
  }
  return x;
}

fn terrainInv(mip: i32) -> f32 {
  return exp2(-f32(max(mip, 0)));
}

fn terrainMaskH(mip: i32) -> i32 {
  let mapH = i32(frame.mapFlags.y);
  let m = u32(max(mip, 0));
  return max((mapH >> m) - 1, 0);
}

fn terrainMaskW(mip: i32) -> i32 {
  let mapW = i32(frame.mapFlags.x);
  let m = u32(max(mip, 0));
  return max((mapW >> m) - 1, 0);
}

fn clampMipU(tex: texture_2d<u32>, mip: i32) -> i32 {
  return clamp(mip, 0, max(i32(textureNumLevels(tex)) - 1, 0));
}

fn clampMipF(tex: texture_2d<f32>, mip: i32) -> i32 {
  return clamp(mip, 0, max(i32(textureNumLevels(tex)) - 1, 0));
}

fn terrainLastMip(tex: texture_2d<u32>) -> i32 {
  var last = i32(frame.mipShiftCount.w) - 1;
  let texLast = i32(textureNumLevels(tex)) - 1;
  if (last > texLast) {
    last = texLast;
  }
  if (last < 0) {
    last = 0;
  }
  return last;
}

fn terrainHeightNN(tex: texture_2d<u32>, mip: i32, wx: f32, wy: f32) -> u32 {
  let m = clampMipU(tex, mip);
  let inv = terrainInv(m);
  let ix = i32(floor(wx * inv)) & terrainMaskH(m);
  let iy = i32(floor(wy * inv)) & terrainMaskW(m);
  return textureLoad(tex, vec2<i32>(ix, iy), m).r;
}

fn terrainHeightAt(tex: texture_2d<u32>, ix: i32, iy: i32, mip: i32, wrap: bool) -> u32 {
  let m = clampMipU(tex, mip);
  let x = wrapOrClamp(ix, terrainMaskH(m), wrap);
  let y = wrapOrClamp(iy, terrainMaskW(m), wrap);
  return textureLoad(tex, vec2<i32>(x, y), m).r;
}

fn terrainColorNN(tex: texture_2d<f32>, mip: i32, wx: f32, wy: f32) -> vec4f {
  let m = clampMipF(tex, mip);
  let inv = terrainInv(m);
  let ix = i32(floor(wx * inv)) & terrainMaskH(m);
  let iy = i32(floor(wy * inv)) & terrainMaskW(m);
  return textureLoad(tex, vec2<i32>(ix, iy), m);
}

fn terrainColorAt(tex: texture_2d<f32>, ix: i32, iy: i32, mip: i32, wrap: bool) -> vec4f {
  let m = clampMipF(tex, mip);
  let x = wrapOrClamp(ix, terrainMaskH(m), wrap);
  let y = wrapOrClamp(iy, terrainMaskW(m), wrap);
  return textureLoad(tex, vec2<i32>(x, y), m);
}

fn lod0RefineHash(x: i32, y: i32) -> u32 {
  var n = u32(x) * 374761393u + u32(y) * 668265263u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  n = n ^ (n >> 16u);
  return n;
}

fn lod0RefineHashMax(x0: i32, y0: i32, span: u32) -> u32 {
  var maxH = 0u;
  var dy = 0u;
  loop {
    if (dy >= span) {
      break;
    }
    var dx = 0u;
    loop {
      if (dx >= span) {
        break;
      }
      let h = lod0RefineHash(x0 + i32(dx), y0 + i32(dy));
      if (h > maxH) {
        maxH = h;
      }
      dx = dx + 1u;
    }
    dy = dy + 1u;
  }
  return maxH;
}

fn bilinearHeight(h00: f32, h10: f32, h01: f32, h11: f32, fx: f32, fy: f32) -> f32 {
  return mix(mix(h00, h10, fx), mix(h01, h11, fx), fy);
}

fn bilinearColor(c00: vec4f, c10: vec4f, c01: vec4f, c11: vec4f, fx: f32, fy: f32) -> vec4f {
  return mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
}

fn lod0RefineCellFromM(m: i32) -> f32 {
  let subdiv = max(16u >> u32(max(m, 0)), 1u);
  return 1.0 / f32(subdiv);
}

fn easeLodSample(t: f32, wx: f32, wy: f32, mip: i32) -> vec4f {
  let sampleMip = mip;
  var sampleRm = 0;
  var noise = 0.0;
  var filt = 0.0;
  if (lod0RefineAt(t, sampleMip)) {
    sampleRm = lod0RefineMipAt(t);
    noise = 1.0;
  }
  if (sampleMip == 0) {
    filt = 1.0;
  }
  return vec4f(f32(sampleMip), f32(sampleRm), noise, filt);
}

fn applyLod0RefineHeight(hFine: f32, wx: f32, wy: f32, mip: i32, rm: i32, amp: f32) -> f32 {
  if ((mip != 0) || !(amp > 0.0) || !flagLod0Refine(frame.mapFlags.w)) {
    return hFine;
  }
  let s = lod0RefineCellFromM(rm);
  let span = 1u << u32(max(rm, 0));
  let ix = i32(floor(wx / s));
  let iy = i32(floor(wy / s));
  let u = f32(lod0RefineHashMax(ix * i32(span), iy * i32(span), span)) * (1.0 / 4294967296.0);
  var h = hFine + (u - 0.5) * amp;
  if (h < 0.0) {
    h = 0.0;
  }
  if (h > 255.0) {
    h = 255.0;
  }
  return h;
}

fn terrainSampleHeightPair(tex: texture_2d<u32>, mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> vec2f {
  let ease = easeLodSample(t, wx, wy, mip);
  let useMip = i32(ease.x);
  let useRm = i32(ease.y);
  var sx = wx;
  var sy = wy;
  if ((useMip == 0) && flagLod0Refine(frame.mapFlags.w)) {
    let s = lod0RefineCellFromM(useRm);
    sx = (floor(wx / s) + 0.5) * s;
    sy = (floor(wy / s) + 0.5) * s;
  }
  let altitude = frame.tMaxMinDzAltMaxH.z;
  var h: f32;
  let lerp = flagHeightLerp(frame.mapFlags.w) && (useMip == 0) && (ease.w > 0.0);
  if (!lerp) {
    h = f32(terrainHeightNN(tex, useMip, sx, sy));
  } else {
    let wrap = flagRepeat(frame.mapFlags.w);
    let inv = terrainInv(useMip);
    let x0 = floor(sx * inv);
    let y0 = floor(sy * inv);
    let fx = sx * inv - x0;
    let fy = sy * inv - y0;
    let tx = i32(x0);
    let ty = i32(y0);
    let h00 = f32(terrainHeightAt(tex, tx, ty, 0, wrap));
    let h10 = f32(terrainHeightAt(tex, tx + 1, ty, 0, wrap));
    let h01 = f32(terrainHeightAt(tex, tx, ty + 1, 0, wrap));
    let h11 = f32(terrainHeightAt(tex, tx + 1, ty + 1, 0, wrap));
    h = bilinearHeight(h00, h10, h01, h11, fx, fy);
    if (ease.w < 1.0) {
      let nearest = f32(terrainHeightNN(tex, useMip, sx, sy));
      h = nearest + (h - nearest) * ease.w;
    }
  }
  h = applyLod0RefineHeight(h, wx, wy, useMip, useRm, ease.z);
  return vec2f(h * (altitude / 255.0), clamp(h + 0.5, 0.0, 255.0));
}

fn terrainSampleColor(tex: texture_2d<f32>, mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> vec4f {
  let ease = easeLodSample(t, wx, wy, mip);
  let useMip = i32(ease.x);
  let useRm = i32(ease.y);
  var sx = wx;
  var sy = wy;
  if ((useMip == 0) && flagLod0Refine(frame.mapFlags.w)) {
    let s = lod0RefineCellFromM(useRm);
    sx = (floor(wx / s) + 0.5) * s;
    sy = (floor(wy / s) + 0.5) * s;
  }
  let inv = terrainInv(useMip);
  if ((useMip <= 0) && flagColorFilter(frame.mapFlags.w) && (ease.w > 0.0)) {
    let wrap = flagRepeat(frame.mapFlags.w);
    let x0 = floor(sx * inv);
    let y0 = floor(sy * inv);
    let fx = sx * inv - x0;
    let fy = sy * inv - y0;
    let tx = i32(x0);
    let ty = i32(y0);
    let bi = bilinearColor(
      terrainColorAt(tex, tx, ty, 0, wrap),
      terrainColorAt(tex, tx + 1, ty, 0, wrap),
      terrainColorAt(tex, tx, ty + 1, 0, wrap),
      terrainColorAt(tex, tx + 1, ty + 1, 0, wrap),
      fx,
      fy
    );
    if (ease.w >= 1.0) {
      return bi;
    }
    return mix(terrainColorNN(tex, useMip, sx, sy), bi, ease.w);
  }
  return terrainColorNN(tex, useMip, sx, sy);
}

fn mipCellSize(mip: i32, t: f32) -> f32 {
  if (mip <= 0) {
    if (lod0RefineAt(t, mip)) {
      return lod0RefineCellAt(t);
    }
    return 1.0;
  }
  return exp2(f32(mip));
}

fn mipDdaDelta(wx: f32, wy: f32, dirX: f32, dirY: f32, mip: i32, t: f32) -> f32 {
  let s = mipCellSize(mip, t);
  let ix = floor(wx / s);
  let iy = floor(wy / s);
  var tMaxX = 1e30;
  var tMaxY = 1e30;
  if (dirX > 0.0) {
    tMaxX = ((ix + 1.0) * s - wx) / dirX;
  } else if (dirX < 0.0) {
    tMaxX = (ix * s - wx) / dirX;
  }
  if (dirY > 0.0) {
    tMaxY = ((iy + 1.0) * s - wy) / dirY;
  } else if (dirY < 0.0) {
    tMaxY = (iy * s - wy) / dirY;
  }
  var dt = min(tMaxX, tMaxY);
  if (!(dt > 0.0)) {
    dt = 0.0;
  }
  return dt;
}

fn mipCellFarT(t: f32, wx: f32, wy: f32, dirX: f32, dirY: f32, mip: i32) -> f32 {
  if (mip <= 0 && !lod0RefineAt(t, mip)) {
    return t;
  }
  let tFar = t + mipDdaDelta(wx, wy, dirX, dirY, mip, t);
  if (tFar > t) {
    return tFar;
  }
  return t;
}

fn mipSpanFarT(t: f32, step: f32, wx: f32, wy: f32, dirX: f32, dirY: f32, mip: i32) -> f32 {
  if (mip <= 0 && !lod0RefineAt(t, mip)) {
    return t;
  }
  var tFar = t + step;
  let cellFar = mipCellFarT(t, wx, wy, dirX, dirY, mip);
  if (cellFar > tFar) {
    tFar = cellFar;
  }
  if (tFar > t) {
    return tFar;
  }
  return t;
}

fn projectSdfYSpan(sdf: f32, dst: f32, z: f32, zFar: f32, horizon: f32) -> i32 {
  var y = i32(sdf * (dst / z) + horizon);
  if (zFar > z) {
    let yFar = i32(sdf * (dst / zFar) + horizon);
    if (yFar < y) {
      y = yFar;
    }
  }
  return y;
}

fn mipDdaEps(s: f32) -> f32 {
  let e = s * 1.0e-4;
  if (e < 1.0e-6) {
    return 1.0e-6;
  }
  return e;
}

fn terrainSamplePos(wx: f32, wy: f32, dirX: f32, dirY: f32, mip: i32, t: f32) -> vec2f {
  if (mip <= 0) {
    if (!lod0RefineAt(t, mip)) {
      return vec2f(wx, wy);
    }
    let s = lod0RefineCellAt(t);
    let e = mipDdaEps(s);
    let ix = floor((wx + dirX * e) / s);
    let iy = floor((wy + dirY * e) / s);
    return vec2f((ix + 0.5) * s, (iy + 0.5) * s);
  }
  let e = mipDdaEps(mipCellSize(mip, t));
  return vec2f(wx + dirX * e, wy + dirY * e);
}

fn qualityQ() -> f32 {
  var q = frame.tMaxMinDzAltMaxH.y;
  if (q < 1.0) {
    q = 1.0;
  }
  if (q > 5.0) {
    q = 5.0;
  }
  return q;
}

fn fitBandStep(step: f32, lo: f32, cell: f32) -> f32 {
  var hi = cell;
  var s = step;
  if (hi < lo) {
    hi = lo;
  }
  if (s < lo) {
    s = lo;
  }
  if (s > hi) {
    s = hi;
  }
  return s;
}

fn growBandStep(step: f32, lo: f32, cell: f32) -> f32 {
  return fitBandStep(step + frame.clipDhTanLastGrowth.w * cell, lo, cell);
}

fn bandMarchStep(bandStep: f32, mip: i32, t: f32) -> f32 {
  let cell = mipCellSize(mip, t);
  var base = 1.0;
  if (mip > 0) {
    base = exp2(f32(mip));
  }
  var s = bandStep;
  if (!(s > 0.0)) {
    s = cell / qualityQ();
  }
  if (cell < base) {
    s = s * (cell / base);
  }
  if (!(s > 0.0)) {
    s = cell / qualityQ();
  }
  return s;
}

const DEBUG_COLOR: u32 = 0u;
const DEBUG_HEIGHT: u32 = 1u;
const DEBUG_DEPTH: u32 = 2u;
const DEBUG_ITER: u32 = 3u;
const ITER_VIS_MAX: f32 = 256.0;

fn encodeUnit(t: f32) -> u32 {
  if (!(t > 0.0)) {
    return packRgba(vec4f(0.0, 0.0, 0.0, 1.0));
  }
  var u = t;
  if (u >= 1.0) {
    return packRgba(vec4f(1.0, 1.0, 1.0, 1.0));
  }
  return packRgba(vec4f(u, u, u, 1.0));
}

fn encodeHeight(byte: u32) -> u32 {
  return encodeUnit(f32(byte & 255u) / 255.0);
}

fn encodeIter(iter: u32) -> u32 {
  if (iter == 0u) {
    return packRgba(vec4f(0.0, 0.0, 0.0, 1.0));
  }
  var t = f32(iter) / ITER_VIS_MAX;
  if (t > 1.0) {
    t = 1.0;
  }
  if (t <= 0.25) {
    let f = t / 0.25;
    return packRgba(mix(vec4f(1.0, 0.0, 0.0, 1.0), vec4f(1.0, 0.627, 0.0, 1.0), f));
  }
  if (t <= 0.5) {
    let f = (t - 0.25) / 0.25;
    return packRgba(mix(vec4f(1.0, 0.627, 0.0, 1.0), vec4f(1.0, 1.0, 0.0, 1.0), f));
  }
  if (t <= 0.75) {
    let f = (t - 0.5) / 0.25;
    return packRgba(mix(vec4f(1.0, 1.0, 0.0, 1.0), vec4f(0.565, 0.0, 1.0, 1.0), f));
  }
  let f = (t - 0.75) / 0.25;
  return packRgba(mix(vec4f(0.565, 0.0, 1.0, 1.0), vec4f(1.0, 0.0, 1.0, 1.0), f));
}

fn encodeCamera(debugView: u32, dist: f32, heightByte: u32, iter: u32, viewZ: f32, farClip: f32) -> u32 {
  if (debugView == DEBUG_HEIGHT) {
    if (dist <= 0.0) {
      return packRgba(vec4f(0.0, 0.0, 0.0, 1.0));
    }
    return encodeHeight(heightByte);
  }
  if (debugView == DEBUG_DEPTH) {
    if (dist <= 0.0) {
      return packRgba(vec4f(0.0, 0.0, 0.0, 1.0));
    }
    var t = 0.0;
    if (farClip > 0.0) {
      t = viewZ / farClip;
    }
    return encodeUnit(t);
  }
  return encodeIter(iter);
}

