@group(2) @binding(2) var characterTex: texture_2d<u32>;
@group(2) @binding(3) var detailPackedTex: texture_2d<u32>;
@group(2) @binding(4) var detailPalTex: texture_2d<u32>;
@group(2) @binding(5) var vmaxTex: texture_2d<u32>;

fn vmaxLevel(mip: i32, refine: bool, refineMip: i32) -> i32 {
  if (mip <= 0 && refine) {
    if (refineMip >= 4) {
      return 1;
    }
    return 0;
  }
  return min(mip + 2, 9);
}

fn vmaxShift(mip: i32, refine: bool, refineMip: i32) -> i32 {
  if (mip <= 0 && refine) {
    if (refineMip < 2) {
      return 4;
    }
    if (refineMip == 2) {
      return 3;
    }
  }
  return 2;
}

fn vmaxHelperPeriod(mip: i32, refine: bool, refineMip: i32) -> i32 {
  if (mip <= 0 && refine) {
    if (refineMip < 2) {
      return 65536;
    }
    if (refineMip == 2) {
      return 256;
    }
    return 16;
  }
  return 0x7fffffff;
}

fn vmaxIndex(v: f32, lv: i32, mask: i32, wrap: bool) -> i32 {
  return wrapOrClamp(i32(floor(v)) >> u32(lv), mask, wrap);
}

fn vmaxMeters(x: f32, y: f32, lv: i32, maskX: i32, maskY: i32, altScale: f32, wrap: bool) -> f32 {
  let shift = u32(lv);
  var ix = i32(floor(x)) >> shift;
  var iy = i32(floor(y)) >> shift;
  ix = wrapOrClamp(ix, maskX, wrap);
  iy = wrapOrClamp(iy, maskY, wrap);
  return f32(textureLoad(vmaxTex, vec2<i32>(ix, iy), lv).r) * altScale;
}
