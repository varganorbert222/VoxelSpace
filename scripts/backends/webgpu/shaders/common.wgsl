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
