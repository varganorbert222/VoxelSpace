@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var cubeColor: texture_2d_array<u32>;
@group(1) @binding(1) var cubeDepth: texture_2d_array<f32>;
@group(2) @binding(0) var faceColor: texture_storage_2d<r32uint, write>;
@group(2) @binding(1) var faceDepth: texture_storage_2d<r32float, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(frame.screenPano.z);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if ((x >= n) || (y >= n)) {
    return;
  }
  let last = n - 1;
  var srcFace = 5;
  var si = x;
  var sj = y;
  if (y == last) {
    srcFace = 2;
    si = x;
    sj = last;
  } else if (y == 0) {
    srcFace = 3;
    si = last - x;
    sj = last;
  } else if (x == last) {
    srcFace = 0;
    si = last - y;
    sj = last;
  } else if (x == 0) {
    srcFace = 1;
    si = y;
    sj = last;
  }
  let packed = textureLoad(cubeColor, vec2<i32>(si, sj), srcFace, 0).r;
  let dist = textureLoad(cubeDepth, vec2<i32>(si, sj), srcFace, 0).r;
  textureStore(faceColor, vec2<i32>(x, y), vec4<u32>(packed, 0u, 0u, 0u));
  textureStore(faceDepth, vec2<i32>(x, y), vec4<f32>(dist, 0.0, 0.0, 0.0));
}
