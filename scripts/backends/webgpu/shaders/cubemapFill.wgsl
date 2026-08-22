@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var faceColor: texture_storage_2d<r32uint, write>;
@group(1) @binding(1) var faceDepth: texture_storage_2d<r32float, write>;

fn skyColorAt(y: i32, n: i32) -> vec4f {
  let tLin = f32(y) / max(f32(n) * 0.5, 1.0);
  var t = clamp(tLin, 0.0, 1.0);
  t = pow(t, 2.75);
  let tmax = 23.0 / 24.0;
  if (t > tmax) {
    t = tmax;
  }
  return mix(frame.sky, vec4f(1.0), t);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(frame.screenPano.z);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if ((x >= n) || (y >= n)) {
    return;
  }
  let face = i32(frame.extra.w);
  var sky = 0u;
  if (face == 4) {
    sky = packRgba(frame.sky);
  } else if (face == 5) {
    sky = packRgba(vec4f(1.0));
  } else {
    sky = packRgba(skyColorAt(y, n));
  }
  textureStore(faceColor, vec2<i32>(x, y), vec4<u32>(sky, 0u, 0u, 0u));
  textureStore(faceDepth, vec2<i32>(x, y), vec4<f32>(0.0, 0.0, 0.0, 0.0));
}
