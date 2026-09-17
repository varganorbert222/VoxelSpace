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
const CUBE_FACE_C = array<vec3f, 6>(
  vec3f(1.0, 0.0, 0.0),
  vec3f(-1.0, 0.0, 0.0),
  vec3f(0.0, 1.0, 0.0),
  vec3f(0.0, -1.0, 0.0),
  vec3f(0.0, 0.0, 1.0),
  vec3f(0.0, 0.0, -1.0)
);
const CUBE_FACE_U = array<vec3f, 6>(
  vec3f(0.0, -1.0, 0.0),
  vec3f(0.0, 1.0, 0.0),
  vec3f(1.0, 0.0, 0.0),
  vec3f(-1.0, 0.0, 0.0),
  vec3f(1.0, 0.0, 0.0),
  vec3f(1.0, 0.0, 0.0)
);
const CUBE_FACE_V = array<vec3f, 6>(
  vec3f(0.0, 0.0, 1.0),
  vec3f(0.0, 0.0, 1.0),
  vec3f(0.0, 0.0, 1.0),
  vec3f(0.0, 0.0, 1.0),
  vec3f(0.0, 1.0, 0.0),
  vec3f(0.0, -1.0, 0.0)
);

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

fn skyLutIndexFromHat(hat: f32, height: i32) -> u32 {
  let last = u32(max(height, 1) - 1);
  var idx = u32(skyLinearFromHat(hat) * f32(height) * 0.5);
  if (idx > last) {
    idx = last;
  }
  return idx;
}

fn skyColorFromHat(hat: f32, sky: vec4f, horizon: vec4f) -> vec4f {
  let t = skyPaletteT(skyLinearFromHat(hat));
  let idx = min(u32(t * SKY_PALETTE_STEPS), 23u);
  return mix(sky, horizon, f32(idx) / SKY_PALETTE_STEPS);
}

fn cubePixelUV(i: i32, n: i32) -> f32 {
  return (2.0 * (f32(i) + 0.5)) / f32(n) - 1.0;
}

fn cubeDirFromTexel(face: i32, i: i32, j: i32, n: i32) -> vec3f {
  let u = cubePixelUV(i, n);
  let v = -cubePixelUV(j, n);
  var fi = face;
  if (fi < 0) {
    fi = 0;
  }
  if (fi > 5) {
    fi = 5;
  }
  let k = u32(fi);
  return CUBE_FACE_C[k] + CUBE_FACE_U[k] * u + CUBE_FACE_V[k] * v;
}

fn skyColorFromDir(dir: vec3f, sky: vec4f, horizon: vec4f) -> vec4f {
  let len = length(dir);
  var hat = 0.0;
  if (len > 1e-6) {
    hat = dir.z / len;
  }
  return skyColorFromHat(hat, sky, horizon);
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

fn flagOverlay(flags: u32) -> bool {
  return (flags & 1024u) != 0u;
}

fn flagOverlayCube(flags: u32) -> bool {
  return (flags & 2048u) != 0u;
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

fn lod0RefineCellFromM(m: i32) -> f32 {
  let subdiv = max(16u >> u32(max(m, 0)), 1u);
  return 1.0 / f32(subdiv);
}

fn lod0RefineSwitchAt(m: i32) -> f32 {
  if (m <= 0) {
    return frame.stepScaleCaps.y;
  }
  if (m == 1) {
    return frame.stepScaleCaps.z;
  }
  if (m == 2) {
    return frame.stepScaleCaps.w;
  }
  return frame.mipSwitchYHit.y;
}

fn lodBandU(t: f32, start: f32, end: f32) -> f32 {
  let span = end - start;
  if (!(span > 0.0)) {
    return 0.0;
  }
  var u = (t - start) / span;
  if (!(u > 0.0)) {
    return 0.0;
  }
  if (u > 1.0) {
    return 1.0;
  }
  return u;
}

fn lodEdgePick(u: f32, wx: f32, wy: f32, cell: f32) -> bool {
  if (!(u > 0.0)) {
    return false;
  }
  if (u >= 1.0) {
    return true;
  }
  var s = cell;
  if (!(s > 0.0)) {
    s = 1.0;
  }
  let ix = i32(floor(wx / s));
  let iy = i32(floor(wy / s));
  return u > f32(lod0RefineHash(ix, iy)) * (1.0 / 4294967296.0);
}

struct LodEase {
  mip: i32,
  rm: i32,
  noiseAmp: f32,
  filterFade: f32,
}

fn easeLodSample(t: f32, wx: f32, wy: f32, mip: i32) -> LodEase {
  var sampleMip = mip;
  let lastR = 4;
  var sampleRm = 0;
  var noise = 0.0;
  var filt = 0.0;
  let refineOn = lod0RefineAt(t, sampleMip);
  if (refineOn) {
    sampleRm = lod0RefineMipAt(t);
    noise = 1.0;
  }
  if (sampleMip == 0) {
    filt = 1.0;
  }
  let lod0Far = frame.mipSwitchYHit.x;
  let nMips = i32(frame.mipShiftCount.w);
  if (refineOn) {
    var start = 0.0;
    if (sampleRm > 0) {
      start = lod0RefineSwitchAt(sampleRm - 1);
    }
    var end = lod0Far;
    if (sampleRm < lastR) {
      end = lod0RefineSwitchAt(sampleRm);
    }
    if (sampleRm >= lastR) {
      let u = lodBandU(t, start, end);
      noise = 1.0 - u;
      filt = 1.0 - u;
      if (lodEdgePick(u, wx, wy, 1.0) && (nMips > 1)) {
        sampleMip = 1;
        sampleRm = 0;
        noise = 0.0;
        filt = 0.0;
      }
    } else {
      let span = end - start;
      let u = lodBandU(t, end - span * 0.25, end);
      if (lodEdgePick(u, wx, wy, lod0RefineCellFromM(sampleRm))) {
        sampleRm = sampleRm + 1;
      }
    }
  } else if (sampleMip == 0) {
    let start = lod0Far * 0.75;
    let u = lodBandU(t, start, lod0Far);
    filt = 1.0 - u;
    if (lodEdgePick(u, wx, wy, 1.0) && (nMips > 1)) {
      sampleMip = 1;
      filt = 0.0;
    }
  } else if ((sampleMip == 1) && (nMips > 2)) {
    let start = lod0Far;
    let end = frame.sampleLimit.w;
    if ((end > start) && (end < 1.0e20)) {
      let inW = (end - start) * 0.25;
      if (t < start + inW) {
        let uIn = 1.0 - lodBandU(t, start, start + inW);
        if (lodEdgePick(uIn, wx, wy, 2.0)) {
          sampleMip = 0;
          filt = 0.0;
        }
      } else {
        let span = end - start;
        let u = lodBandU(t, end - span * 0.25, end);
        if (lodEdgePick(u, wx, wy, 2.0)) {
          sampleMip = 2;
        }
      }
    }
  }
  return LodEase(sampleMip, sampleRm, noise, filt);
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
  let useMip = ease.mip;
  var sx = wx;
  var sy = wy;
  if ((useMip == 0) && flagLod0Refine(frame.mapFlags.w)) {
    let s = lod0RefineCellFromM(ease.rm);
    sx = (floor(wx / s) + 0.5) * s;
    sy = (floor(wy / s) + 0.5) * s;
  }
  let altitude = frame.tMaxMinDzAltMaxH.z;
  var h: f32;
  let lerp = flagHeightLerp(frame.mapFlags.w) && (useMip == 0) && (ease.filterFade > 0.0);
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
    if (ease.filterFade < 1.0) {
      let nearest = f32(terrainHeightNN(tex, useMip, sx, sy));
      h = nearest + (h - nearest) * ease.filterFade;
    }
  }
  h = applyLod0RefineHeight(h, wx, wy, useMip, ease.rm, ease.noiseAmp);
  return vec2f(h * (altitude / 255.0), clamp(h + 0.5, 0.0, 255.0));
}

fn terrainSampleColor(tex: texture_2d<f32>, mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> vec4f {
  let ease = easeLodSample(t, wx, wy, mip);
  let useMip = ease.mip;
  var sx = wx;
  var sy = wy;
  if ((useMip == 0) && flagLod0Refine(frame.mapFlags.w)) {
    let s = lod0RefineCellFromM(ease.rm);
    sx = (floor(wx / s) + 0.5) * s;
    sy = (floor(wy / s) + 0.5) * s;
  }
  let inv = terrainInv(useMip);
  if ((useMip <= 0) && flagColorFilter(frame.mapFlags.w) && (ease.filterFade > 0.0)) {
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
    if (ease.filterFade >= 1.0) {
      return bi;
    }
    return mix(terrainColorNN(tex, useMip, sx, sy), bi, ease.filterFade);
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

fn stepDivisor() -> f32 {
  var d = frame.tMaxMinDzAltMaxH.y;
  if (d < 1.0) {
    d = 3.0;
  }
  if (d > 5.0) {
    d = 5.0;
  }
  return d;
}

fn marchStep(mip: i32, t: f32) -> f32 {
  return mipCellSize(mip, t) / stepDivisor();
}

fn clampMarchStep(step: f32, mip: i32, t: f32) -> f32 {
  let lo = marchStep(mip, t);
  let hi = mipCellSize(mip, t);
  var s = step;
  if (!(s >= lo)) {
    s = lo;
  }
  if (s > hi) {
    s = hi;
  }
  return s;
}

fn growMarchStep(step: f32, mip: i32, t: f32) -> f32 {
  var g = frame.clipDhTanLastGrowth.w;
  if (!(g > 0.0)) {
    g = 0.0;
  }
  return clampMarchStep(step + g, mip, t);
}

fn marchBandKey(mip: i32, t: f32) -> i32 {
  var rm = 0;
  if (lod0RefineAt(t, mip)) {
    rm = lod0RefineMipAt(t);
  }
  return (mip << 8) | rm;
}

fn syncBandStep(step: f32, prevKey: i32, mip: i32, t: f32) -> vec2f {
  let key = marchBandKey(mip, t);
  return vec2f(clampMarchStep(step + f32(prevKey) * 0.0, mip, t), f32(key));
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

fn advanceRayT(t: f32, mip: i32, step: f32) -> vec2f {
  let s = clampMarchStep(step, mip, t);
  var next = t + s;
  if (!(next > t)) {
    next = t + 0.5;
  }
  return vec2f(next, growMarchStep(s, mip, t));
}

fn takeMarchStep(t: f32, step: f32, bandKey: i32, mip: i32) -> vec3f {
  let synced = syncBandStep(step, bandKey, mip, t);
  let adv = advanceRayT(t, mip, synced.x);
  return vec3f(adv.x, adv.y, synced.y);
}

fn bilinearHeight(h00: f32, h10: f32, h01: f32, h11: f32, fx: f32, fy: f32) -> f32 {
  return mix(mix(h00, h10, fx), mix(h01, h11, fx), fy);
}

fn bilinearColor(c00: vec4f, c10: vec4f, c01: vec4f, c11: vec4f, fx: f32, fy: f32) -> vec4f {
  return mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
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

const OVERLAY_BORDER: i32 = 2;
const OVERLAY_SHADOW: i32 = 4;
const OVERLAY_PAD: i32 = 6;
const CUBE_NET_GAP: i32 = 8;
const OVERLAY_KIND_SKIP: u32 = 0u;
const OVERLAY_KIND_SHADOW: u32 = 1u;
const OVERLAY_KIND_FILL: u32 = 2u;
const OVERLAY_KIND_HI: u32 = 3u;
const OVERLAY_KIND_LO: u32 = 4u;
const OVERLAY_KIND_CONTENT: u32 = 5u;

fn overlayHudBg() -> u32 {
  return packRgba(vec4f(18.0 / 255.0, 22.0 / 255.0, 12.0 / 255.0, 1.0));
}

fn overlayHudHi() -> u32 {
  return packRgba(vec4f(212.0 / 255.0, 224.0 / 255.0, 106.0 / 255.0, 1.0));
}

fn overlayHudLo() -> u32 {
  return packRgba(vec4f(58.0 / 255.0, 64.0 / 255.0, 32.0 / 255.0, 1.0));
}

fn overlayHudShadow() -> u32 {
  return packRgba(vec4f(0.0, 0.0, 0.0, 1.0));
}

fn overlayKindColor(kind: u32) -> u32 {
  if (kind == OVERLAY_KIND_SHADOW) {
    return overlayHudShadow();
  }
  if (kind == OVERLAY_KIND_FILL) {
    return overlayHudBg();
  }
  if (kind == OVERLAY_KIND_HI) {
    return overlayHudHi();
  }
  if (kind == OVERLAY_KIND_LO) {
    return overlayHudLo();
  }
  return overlayHudBg();
}

fn overlayPixelKind(dx: i32, dy: i32, fullW: i32, fullH: i32) -> u32 {
  let panelW = fullW - OVERLAY_SHADOW;
  let panelH = fullH - OVERLAY_SHADOW;
  if ((dx >= 0) && (dx < panelW) && (dy >= 0) && (dy < panelH)) {
    if ((dx >= panelW - OVERLAY_BORDER) || (dy >= panelH - OVERLAY_BORDER)) {
      return OVERLAY_KIND_LO;
    }
    if ((dx < OVERLAY_BORDER) || (dy < OVERLAY_BORDER)) {
      return OVERLAY_KIND_HI;
    }
    let inset = OVERLAY_BORDER + OVERLAY_PAD;
    if ((dx >= inset) && (dy >= inset) && (dx < panelW - inset) && (dy < panelH - inset)) {
      return OVERLAY_KIND_CONTENT;
    }
    return OVERLAY_KIND_FILL;
  }
  if ((dx >= OVERLAY_SHADOW) && (dx < fullW) && (dy >= OVERLAY_SHADOW) && (dy < fullH)) {
    return OVERLAY_KIND_SHADOW;
  }
  return OVERLAY_KIND_SKIP;
}

fn overlaySunkenBevel(lx: i32, ly: i32, w: i32, h: i32) -> u32 {
  if ((lx >= w - OVERLAY_BORDER) || (ly >= h - OVERLAY_BORDER)) {
    return OVERLAY_KIND_HI;
  }
  if ((lx < OVERLAY_BORDER) || (ly < OVERLAY_BORDER)) {
    return OVERLAY_KIND_LO;
  }
  return OVERLAY_KIND_SKIP;
}

fn encodeAtlas(debugView: u32, color: u32, dist: f32, heightByte: u32, iter: u32, farClip: f32) -> u32 {
  if (debugView == DEBUG_COLOR) {
    return color;
  }
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
      t = dist / farClip;
    }
    return encodeUnit(t);
  }
  return encodeIter(iter);
}
