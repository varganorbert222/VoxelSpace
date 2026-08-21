@group(0) @binding(0) var src: texture_2d<u32>;

struct VsOut {
  @builtin(position) pos: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var out: VsOut;
  let x = f32(i32(i & 1u) * 4 - 1);
  let y = f32(i32(i >> 1u) * 4 - 1);
  out.pos = vec4f(x, y, 0.0, 1.0);
  return out;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2<i32>(i32(pos.x), i32(pos.y));
  let packed = textureLoad(src, p, 0).r;
  return unpackRgba(packed);
}
