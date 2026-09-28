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

fn vmaxMeters(x: f32, y: f32, level: i32, altScale: f32, wrap: bool) -> f32 {
  let levels = textureNumLevels(vmaxTex);
  let lv = min(u32(max(level, 0)), levels - 1u);
  let size = textureDimensions(vmaxTex, lv);
  let maskX = i32(size.x) - 1;
  let maskY = i32(size.y) - 1;
  var ix = i32(floor(x)) >> lv;
  var iy = i32(floor(y)) >> lv;
  ix = wrapOrClamp(ix, maskX, wrap);
  iy = wrapOrClamp(iy, maskY, wrap);
  return f32(textureLoad(vmaxTex, vec2<i32>(ix, iy), i32(lv)).r) * altScale;
}
