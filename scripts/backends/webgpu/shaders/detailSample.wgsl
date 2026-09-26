fn detailLevelAt(dist: f32) -> i32 {
  if ((frame.mapFlags.w & 32768u) == 0u) {
    return -1;
  }
  let farEnd = frame.detailTail.x;
  if (!(farEnd > 0.0) || dist > farEnd) {
    return -1;
  }
  if (dist <= frame.detailNear.y) {
    return 0;
  }
  if (dist <= frame.detailNear.z) {
    return 1;
  }
  if (dist <= frame.detailNear.w) {
    return 2;
  }
  return 3;
}

fn detailWrapIndex(v: f32, size: i32) -> i32 {
  let n = max(size, 1);
  var i = i32(floor(v)) % n;
  if (i < 0) {
    i = i + n;
  }
  return i;
}

fn sampleDetailPacked(wx: f32, wy: f32, dist: f32) -> u32 {
  let level = detailLevelAt(dist);
  if (level < 0) {
    return 0u;
  }
  let dims = textureDimensions(characterTex);
  let ix = detailWrapIndex(wx, i32(dims.x));
  let iy = detailWrapIndex(wy, i32(dims.y));
  let tile = textureLoad(characterTex, vec2i(ix, iy), 0).r;
  let subdiv = 16u >> u32(level);
  let fx = wx - floor(wx);
  let fy = wy - floor(wy);
  let last = i32(subdiv) - 1;
  let cx = clamp(i32(floor(fx * f32(subdiv))), 0, last);
  let cy = clamp(i32(floor(fy * f32(subdiv))), 0, last);
  return textureLoad(
    detailPackedTex,
    vec2i(cx, i32(tile) * i32(subdiv) + cy),
    level
  ).r;
}

fn detailHeightBytes(wx: f32, wy: f32, dist: f32) -> f32 {
  let elev = (sampleDetailPacked(wx, wy, dist) >> 16u) & 255u;
  if (elev < 128u) {
    return 0.0;
  }
  return f32(elev - 128u) / 32.0;
}

// Retail skips the detail map until the coarse height says the sample can
// meet the surface. A bump is at most (255 - 128) / 32 height bytes.
fn detailElevMaxBytes(dist: f32) -> f32 {
  if (detailLevelAt(dist) < 0) {
    return 0.0;
  }
  return 127.0 / 32.0;
}

fn detailHeightBytesReached(wx: f32, wy: f32, dist: f32, baseWorld: f32, probeZ: f32) -> f32 {
  let cap = baseWorld + detailElevMaxBytes(dist) * (frame.tMaxMinDzAltMaxH.z / 255.0);
  if (probeZ > cap) {
    return 0.0;
  }
  return detailHeightBytes(wx, wy, dist);
}

fn detailShadeByte(base: i32, light: i32, shade: i32) -> i32 {
  if (shade == 0 || shade == 128) {
    return base;
  }
  var out = base;
  if (shade <= 64) {
    out = base + ((base * shade) >> 7);
  } else if (shade < 128) {
    out = (base * shade) >> 7;
  } else if (shade < 192) {
    out = base + (((light - base) * (shade - 128)) >> 7);
  } else {
    out = base + (((base - light) * (256 - shade)) >> 7);
  }
  return clamp(out, 0, 255);
}

fn detailByte(v: f32) -> i32 {
  return i32(clamp(v, 0.0, 1.0) * 255.0 + 0.5);
}

fn detailColor(base: vec4f, wx: f32, wy: f32, dist: f32) -> vec4f {
  let packed = sampleDetailPacked(wx, wy, dist);
  if (packed == 0u) {
    return base;
  }
  let shade = i32((packed >> 8u) & 255u);
  let ci = packed & 255u;
  if (shade == 0 && ci == 0u) {
    return base;
  }
  if (shade == 0) {
    let dc = textureLoad(detailPalTex, vec2i(i32(ci), 0), 0);
    return vec4f(f32(dc.r) / 255.0, f32(dc.g) / 255.0, f32(dc.b) / 255.0, base.a);
  }
  let light = vec3i(
    i32(frame.detailTail.y),
    i32(frame.detailTail.z),
    i32(frame.detailTail.w)
  );
  var r = detailShadeByte(detailByte(base.r), light.x, shade);
  var g = detailShadeByte(detailByte(base.g), light.y, shade);
  var b = detailShadeByte(detailByte(base.b), light.z, shade);
  if (ci != 0u) {
    let dc = textureLoad(detailPalTex, vec2i(i32(ci), 0), 0);
    r = i32((u32(r) >> 1u) + (dc.r >> 1u));
    g = i32((u32(g) >> 1u) + (dc.g >> 1u));
    b = i32((u32(b) >> 1u) + (dc.b >> 1u));
  }
  return vec4f(f32(r) / 255.0, f32(g) / 255.0, f32(b) / 255.0, base.a);
}
