@group(0) @binding(0) var screenTex: texture_storage_2d<r32uint, read_write>;
@group(0) @binding(1) var<storage, read> skyRows: array<u32>;
@group(1) @binding(0) var<uniform> frame: Frame;

fn paintSky(color: u32, empty: u32, cover: f32) -> u32 {
  var out = color;
  if (out == 0u) {
    out = empty;
  }
  if (cover > 0.0) {
    out = skyBlendCloud(out, skyWord(30u), cover);
  }
  return out;
}

// Full-screen clear. Column marches used to write this marker themselves,
// one thread per column, which serializes with the framebuffer height.
@compute @workgroup_size(16, 16)
fn clearMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(screenTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  textureStore(screenTex, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<u32>(0u, 0u, 0u, 0u));
}

// One thread per sample column. All terrain algorithms sample one pixel
// per pair and write the sky/cloud result to both output pixels.
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(screenTex);
  let paired = flagColumnPair(frame.mapFlags.w);
  let x = select(i32(gid.x), i32(gid.x) * 2, paired);
  let y = i32(gid.y);
  let width = i32(dims.x);
  let height = i32(dims.y);
  if (x >= width || y >= height) {
    return;
  }
  var span = 1;
  if (paired && x + 1 < width) {
    span = 2;
  }
  let c0 = textureLoad(screenTex, vec2<i32>(x, y)).x;
  var c1 = c0;
  if (span == 2) {
    c1 = textureLoad(screenTex, vec2<i32>(x + 1, y)).x;
  }
  let above = skyPacked() && (skyF(9u) < 0.0) && (skyWord(6u) > 0u);
  let needEmpty = (c0 == 0u) || (span == 2 && c1 == 0u);
  if (!needEmpty && !above) {
    return;
  }
  let empty = select(0u, skyColorAt(x, y), needEmpty);
  var cover = 0.0;
  if (above) {
    let o = skyRowBase(y);
    let dir = skyDir(o, x);
    if (dir.z < 0.0) {
      cover = min(62.0, skyCloudLevel(o, dir));
    }
  }
  let out0 = paintSky(c0, empty, cover);
  if (out0 != c0) {
    textureStore(screenTex, vec2<i32>(x, y), vec4<u32>(out0, 0u, 0u, 0u));
  }
  if (span == 2) {
    let out1 = paintSky(c1, empty, cover);
    if (out1 != c1) {
      textureStore(screenTex, vec2<i32>(x + 1, y), vec4<u32>(out1, 0u, 0u, 0u));
    }
  }
}
