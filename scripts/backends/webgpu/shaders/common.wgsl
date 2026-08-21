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

fn flagFog(flags: u32) -> bool {
  return (flags & 1u) != 0u;
}

fn flagRepeat(flags: u32) -> bool {
  return (flags & 2u) != 0u;
}
