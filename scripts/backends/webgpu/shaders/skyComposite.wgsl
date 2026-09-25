@group(0) @binding(0) var screenTex: texture_storage_2d<r32uint, read_write>;
@group(0) @binding(1) var<storage, read> skyRows: array<u32>;
// common.wgsl refers to frame; this pass never reads it.
@group(1) @binding(0) var<uniform> frame: Frame;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(screenTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  let p = vec2<i32>(gid.xy);
  let color = textureLoad(screenTex, p).x;
  let out = skyComposite(p.x, p.y, color);
  if (out != color) {
    textureStore(screenTex, p, vec4<u32>(out, 0u, 0u, 0u));
  }
}
