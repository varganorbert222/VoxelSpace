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

fn rayCellExit(t: f32, bx: f32, by: f32, camX: f32, camY: f32, cell: f32) -> f32 {
  let x = camX + t * bx;
  let y = camY + t * by;
  var dt = 1.0e30;
  if (bx > 1.0e-8 || bx < -1.0e-8) {
    let origin = floor(x / cell) * cell;
    let edge = select(origin, origin + cell, bx > 0.0);
    let step = (edge - x) / bx;
    if (step > 1.0e-8 && step < dt) {
      dt = step;
    }
  }
  if (by > 1.0e-8 || by < -1.0e-8) {
    let origin = floor(y / cell) * cell;
    let edge = select(origin, origin + cell, by > 0.0);
    let step = (edge - y) / by;
    if (step > 1.0e-8 && step < dt) {
      dt = step;
    }
  }
  return dt;
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
