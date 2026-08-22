@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var faceColor: texture_storage_2d<r32uint, write>;
@group(1) @binding(1) var faceDepth: texture_storage_2d<r32float, write>;
@group(1) @binding(2) var faceHeight: texture_storage_2d<r32uint, write>;
@group(1) @binding(3) var faceIter: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(frame.screenPano.z);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if ((x >= n) || (y >= n)) {
    return;
  }
  let face = i32(frame.extra.w);
  let sky = packRgba(skyColorFromDir(cubeDirFromTexel(face, x, y, n), frame.sky, frame.horizonColor));
  textureStore(faceColor, vec2<i32>(x, y), vec4<u32>(sky, 0u, 0u, 0u));
  textureStore(faceDepth, vec2<i32>(x, y), vec4<f32>(0.0, 0.0, 0.0, 0.0));
  textureStore(faceHeight, vec2<i32>(x, y), vec4<u32>(0u, 0u, 0u, 0u));
  textureStore(faceIter, vec2<i32>(x, y), vec4<u32>(0u, 0u, 0u, 0u));
}
