@group(0) @binding(0) var src: texture_2d<u32>;
@group(0) @binding(1) var lutTex: texture_2d<u32>;
@group(0) @binding(2) var<uniform> grade: vec4<u32>;

fn unpackRgba(p: u32) -> vec4f {
  return vec4f(
    f32(p & 255u),
    f32((p >> 8u) & 255u),
    f32((p >> 16u) & 255u),
    f32((p >> 24u) & 255u)
  ) / 255.0;
}

fn clampb(v: i32) -> i32 {
  if (v < 0) {
    return 0;
  }
  if (v > 255) {
    return 255;
  }
  return v;
}

fn graded(v: i32, y: i32, sat: i32, ch: u32) -> f32 {
  let c = clampb(y + (((v - y) * sat) >> 7));
  let row = textureLoad(lutTex, vec2<i32>(c, 0), 0);
  var q = i32(row.r);
  if (ch == 1u) {
    q = i32(row.g);
  }
  if (ch == 2u) {
    q = i32(row.b);
  }
  return f32(q) / 255.0;
}

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
  if (grade.y == 0u) {
    return unpackRgba(packed);
  }
  let r = i32(packed & 255u);
  let g = i32((packed >> 8u) & 255u);
  let b = i32((packed >> 16u) & 255u);
  let a = f32((packed >> 24u) & 255u) / 255.0;
  let y = (r + (g << 1) + b) >> 2;
  let sat = i32(grade.x);
  return vec4f(graded(r, y, sat, 0u), graded(g, y, sat, 1u), graded(b, y, sat, 2u), a);
}
