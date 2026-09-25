// Per-pixel retail sky. The skyRows buffer holds either one color per row or
// the packed sky from scripts/render/retail/skybox.js (header, color table,
// cloud mip bytes, one ray per row). The layout must match that file.
const SKY_MAGIC: u32 = 0x00534b59u;
const SKY_HORIZON_DIR_Z: f32 = 0.00006103515625;
const SKY_ROW_STEP: u32 = 32u;

fn skyWord(i: u32) -> u32 {
  return skyRows[min(i, arrayLength(&skyRows) - 1u)];
}

fn skyF(i: u32) -> f32 {
  return bitcast<f32>(skyWord(i));
}

fn skyPacked() -> bool {
  return skyWord(0u) == SKY_MAGIC;
}

fn skyCloudByte(cloudOffset: u32, byteIndex: u32) -> f32 {
  let word = skyWord(cloudOffset + (byteIndex >> 2u));
  return f32((word >> ((byteIndex & 3u) * 8u)) & 255u);
}

fn skyCloudNearest(cloudOffset: u32, baseSize: u32, mip: u32, u: f32, v: f32) -> f32 {
  var size = baseSize >> mip;
  if (size < 1u) {
    size = 1u;
  }
  let mask = i32(size) - 1;
  let base = skyWord(14u + mip);
  let texel = f32(1u << mip);
  let ix = u32(i32(floor(u / texel)) & mask);
  let iy = u32(i32(floor(v / texel)) & mask);
  return skyCloudByte(cloudOffset, base + iy * size + ix);
}

fn skyRowBase(y: i32) -> u32 {
  return skyWord(3u) + u32(y) * 8u;
}

fn skyDir(o: u32, x: i32) -> vec3f {
  let fxp = f32(x);
  return vec3f(
    skyF(o) + skyF(o + 3u) * fxp,
    skyF(o + 1u) + skyF(o + 4u) * fxp,
    skyF(o + 2u) + skyF(o + 5u) * fxp
  );
}

const CLOUD_TEXEL_WORLD: f32 = 8.0;

// Retail plane hit is shifted by 3 (one mip-0 texel is 8 world units). The
// mip rises while one pixel steps more than one texel. The sample is nearest.
fn skyCloudLevel(o: u32, dir: vec3f) -> f32 {
  let plane = skyF(9u);
  let t = plane / dir.z;
  let a = vec3f(skyF(o + 3u), skyF(o + 4u), skyF(o + 5u));
  let b = vec3f(skyF(SKY_ROW_STEP), skyF(SKY_ROW_STEP + 1u), skyF(SKY_ROW_STEP + 2u));
  let pa = t * (a.xy - dir.xy * (a.z / dir.z)) / CLOUD_TEXEL_WORLD;
  let pb = t * (b.xy - dir.xy * (b.z / dir.z)) / CLOUD_TEXEL_WORLD;
  var foot = sqrt(max(dot(pa, pa), dot(pb, pb)));
  let mipCount = skyWord(6u);
  let last = mipCount - 1u;
  var mip = 0u;
  loop {
    if (!(foot > 1.0) || mip >= last) {
      break;
    }
    foot = foot * 0.5;
    mip = mip + 1u;
  }
  let u = (skyF(11u) + t * dir.x) / CLOUD_TEXEL_WORLD;
  let v = (skyF(12u) + t * dir.y) / CLOUD_TEXEL_WORLD;
  return skyCloudNearest(skyWord(5u), skyWord(13u), mip, u, v);
}

fn skyGradientOn() -> bool {
  return (skyWord(31u) & 1u) != 0u;
}

fn skyCloudsBelow() -> bool {
  return skyF(9u) > 0.0 && skyWord(6u) > 0u;
}

fn skyColorAt(x: i32, y: i32) -> u32 {
  if (!skyPacked()) {
    return skyWord(u32(y));
  }
  if (skyWord(8u) != 0u) {
    return 0xff000000u;
  }
  let gradient = skyGradientOn();
  let clouds = skyCloudsBelow();
  if (!gradient && !clouds) {
    return skyWord(7u);
  }
  let o = skyRowBase(y);
  let dir = skyDir(o, x);
  let horiz = length(dir.xy);
  if (!(dir.z > SKY_HORIZON_DIR_Z * length(dir))) {
    return skyWord(7u);
  }
  var grad = 0u;
  if (gradient) {
    grad = u32(clamp(floor((dir.z / horiz) * skyF(10u)), 0.0, 255.0));
  }
  var level = 0.0;
  if (clouds) {
    level = skyCloudLevel(o, dir);
  }
  let q = u32(clamp(round(level), 0.0, 62.0));
  return skyWord(skyWord(4u) + q * 256u + grad);
}

fn skyBlendCloud(color: u32, cloud: u32, level: f32) -> u32 {
  let k = level / 64.0;
  let c = vec3f(f32(color & 255u), f32((color >> 8u) & 255u), f32((color >> 16u) & 255u));
  let l = vec3f(f32(cloud & 255u), f32((cloud >> 8u) & 255u), f32((cloud >> 16u) & 255u));
  let m = vec3u(c + (l - c) * k);
  return 0xff000000u | (m.z << 16u) | (m.y << 8u) | m.x;
}

// Paints the 0 sky marker and, with the camera above the cloud plane, lays
// the clouds over every downward ray (terrain included).
fn skyComposite(x: i32, y: i32, color: u32) -> u32 {
  var out = color;
  if (out == 0u) {
    out = skyColorAt(x, y);
  }
  if (!skyPacked() || !(skyF(9u) < 0.0) || skyWord(6u) == 0u) {
    return out;
  }
  let o = skyRowBase(y);
  let dir = skyDir(o, x);
  if (!(dir.z < 0.0)) {
    return out;
  }
  let level = min(62.0, skyCloudLevel(o, dir));
  if (level > 0.0) {
    out = skyBlendCloud(out, skyWord(30u), level);
  }
  return out;
}
