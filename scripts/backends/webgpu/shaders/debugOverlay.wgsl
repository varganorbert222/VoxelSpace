@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var panoColor: texture_2d<u32>;
@group(1) @binding(1) var panoDepth: texture_2d<f32>;
@group(1) @binding(2) var panoHeight: texture_2d<u32>;
@group(1) @binding(3) var panoIter: texture_2d<u32>;
@group(2) @binding(0) var outTex: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(16, 16)
fn overlayPano(@builtin(global_invocation_id) gid: vec3u) {
  if (!flagOverlay(frame.mapFlags.w)) {
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
  let bevel = overlaySunkenBevel(lx, ly, contentW, contentH);
  if (bevel != OVERLAY_KIND_SKIP) {
    textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(overlayKindColor(bevel), 0u, 0u, 0u));
    return;
  }
  let panoW = i32(frame.screenPano.z);
  let panoH = i32(frame.screenPano.w);
  var i = i32(((f32(lx) + 0.5) * f32(panoW)) / f32(contentW));
  var j = i32(((f32(ly) + 0.5) * f32(panoH)) / f32(contentH));
  if (i < 0) {
    i = 0;
  }
  if (i >= panoW) {
    i = panoW - 1;
  }
  if (j < 0) {
    j = 0;
  }
  if (j >= panoH) {
    j = panoH - 1;
  }
  let packed = textureLoad(panoColor, vec2<i32>(i, j), 0).r;
  let dist = textureLoad(panoDepth, vec2<i32>(i, j), 0).r;
  let hByte = textureLoad(panoHeight, vec2<i32>(i, j), 0).r;
  let iter = textureLoad(panoIter, vec2<i32>(i, j), 0).r;
  let color = encodeAtlas(flagDebugView(frame.mapFlags.w), packed, dist, hByte, iter, frame.sinCosNearFar.w);
  textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(color, 0u, 0u, 0u));
}
