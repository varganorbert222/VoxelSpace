@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var cubeColor: texture_2d_array<u32>;
@group(1) @binding(1) var cubeDepth: texture_2d_array<f32>;
@group(1) @binding(2) var cubeHeight: texture_2d_array<u32>;
@group(1) @binding(3) var cubeIter: texture_2d_array<u32>;
@group(2) @binding(0) var outTex: texture_storage_2d<r32uint, write>;

const NET_W: i32 = 4;
const NET_H: i32 = 3;

fn cubeCell(cx: i32, cy: i32) -> vec2i {
  if ((cx == 1) && (cy == 0)) {
    return vec2i(4, 1);
  }
  if ((cx == 0) && (cy == 1)) {
    return vec2i(2, 0);
  }
  if ((cx == 1) && (cy == 1)) {
    return vec2i(0, 0);
  }
  if ((cx == 2) && (cy == 1)) {
    return vec2i(3, 0);
  }
  if ((cx == 3) && (cy == 1)) {
    return vec2i(1, 0);
  }
  if ((cx == 1) && (cy == 2)) {
    return vec2i(5, 3);
  }
  return vec2i(-1, 0);
}

fn applyRot(i: i32, j: i32, last: i32, rot: i32) -> vec2i {
  if (rot == 1) {
    return vec2i(j, last - i);
  }
  if (rot == 2) {
    return vec2i(last - i, last - j);
  }
  if (rot == 3) {
    return vec2i(last - j, i);
  }
  return vec2i(i, j);
}

@compute @workgroup_size(16, 16)
fn overlayCube(@builtin(global_invocation_id) gid: vec3u) {
  if (!flagOverlayCube(frame.mapFlags.w)) {
    return;
  }
  let rect = vec4i(frame.debugRect);
  let dx = i32(gid.x);
  let dy = i32(gid.y);
  if ((dx >= rect.z) || (dy >= rect.w)) {
    return;
  }
  let sx = rect.x + dx;
  let sy = rect.y + dy;
  let screenW = i32(frame.screenPano.x);
  let screenH = i32(frame.screenPano.y);
  if ((sx < 0) || (sx >= screenW) || (sy < 0) || (sy >= screenH)) {
    return;
  }
  let kind = overlayPixelKind(dx, dy, rect.z, rect.w);
  if (kind == OVERLAY_KIND_SKIP) {
    return;
  }
  if (kind != OVERLAY_KIND_CONTENT) {
    textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(overlayKindColor(kind), 0u, 0u, 0u));
    return;
  }
  let inset = OVERLAY_BORDER + OVERLAY_PAD;
  let panelW = rect.z - OVERLAY_SHADOW;
  let panelH = rect.w - OVERLAY_SHADOW;
  let contentW = panelW - inset * 2;
  let contentH = panelH - inset * 2;
  let lx = dx - inset;
  let ly = dy - inset;
  let usableW = contentW - CUBE_NET_GAP * (NET_W - 1);
  let usableH = contentH - CUBE_NET_GAP * (NET_H - 1);
  let cw = usableW / NET_W;
  let ch = usableH / NET_H;
  if ((cw < 1) || (ch < 1)) {
    textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(overlayHudBg(), 0u, 0u, 0u));
    return;
  }
  let strideX = cw + CUBE_NET_GAP;
  let strideY = ch + CUBE_NET_GAP;
  let cx = lx / strideX;
  let cy = ly / strideY;
  let rx = lx - cx * strideX;
  let ry = ly - cy * strideY;
  if ((cx < 0) || (cy < 0) || (cx >= NET_W) || (cy >= NET_H) || (rx >= cw) || (ry >= ch)) {
    textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(overlayHudBg(), 0u, 0u, 0u));
    return;
  }
  let cell = cubeCell(cx, cy);
  let face = cell.x;
  if (face < 0) {
    textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(overlayHudBg(), 0u, 0u, 0u));
    return;
  }
  let bevel = overlaySunkenBevel(rx, ry, cw, ch);
  if (bevel != OVERLAY_KIND_SKIP) {
    textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(overlayKindColor(bevel), 0u, 0u, 0u));
    return;
  }
  let n = i32(frame.screenPano.z);
  let last = n - 1;
  var i = i32(((f32(rx) + 0.5) * f32(n)) / f32(cw));
  var j = i32(((f32(ry) + 0.5) * f32(n)) / f32(ch));
  if (i < 0) {
    i = 0;
  }
  if (i > last) {
    i = last;
  }
  if (j < 0) {
    j = 0;
  }
  if (j > last) {
    j = last;
  }
  let tex = applyRot(i, j, last, cell.y);
  let packed = textureLoad(cubeColor, vec2<i32>(tex.x, tex.y), face, 0).r;
  let dist = textureLoad(cubeDepth, vec2<i32>(tex.x, tex.y), face, 0).r;
  let hByte = textureLoad(cubeHeight, vec2<i32>(tex.x, tex.y), face, 0).r;
  let iter = textureLoad(cubeIter, vec2<i32>(tex.x, tex.y), face, 0).r;
  let color = encodeAtlas(flagDebugView(frame.mapFlags.w), packed, dist, hByte, iter, frame.sinCosNearFar.w);
  textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(color, 0u, 0u, 0u));
}
