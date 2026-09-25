@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var heightTex: texture_2d<u32>;
@group(1) @binding(1) var colorTex: texture_2d<f32>;
@group(1) @binding(2) var<storage, read> mipSwitchArr: array<f32, 32>;
@group(2) @binding(0) var faceColor: texture_storage_2d<r32uint, write>;
@group(2) @binding(1) var faceDepth: texture_storage_2d<r32float, write>;
@group(2) @binding(2) var faceHeight: texture_storage_2d<r32uint, write>;
@group(2) @binding(3) var faceIter: texture_storage_2d<r32uint, write>;

const MAX_STEPS: u32 = 65536u;

// Top (face 4, pitch -90) and bottom (face 5, pitch +90) use the same
// frustum backtrack as the live view: step by LOD cell / Step, and on the
// first hit rewind one step and move up one face row.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(frame.screenPano.z);
  let col = i32(gid.x);
  if (col >= n) {
    return;
  }
  let face = i32(frame.extra.w);
  var fwd = vec3f(0.0, 0.0, 1.0);
  var up = vec3f(0.0, 1.0, 0.0);
  if (face >= 5) {
    fwd = vec3f(0.0, 0.0, -1.0);
    up = vec3f(0.0, -1.0, 0.0);
  }
  let right = vec3f(1.0, 0.0, 0.0);
  let cam = frame.camPosTanHalfX.xyz;
  let xn = (f32(col) + 0.5) * (2.0 / f32(n)) - 1.0;
  let invH2 = 2.0 / f32(n);
  let nearClip = frame.sinCosNearFar.z;
  let farClip = frame.sinCosNearFar.w;
  var t0 = frame.camFwdPad.w;
  if (t0 < nearClip) {
    t0 = nearClip;
  }
  var t = t0;
  var sy = n - 1;
  var step = 0.0;
  var guard = 0u;
  let lastMip = terrainLastMip(heightTex);
  let repeat = flagRepeat(frame.mapFlags.w);
  let mapW = f32(frame.mapFlags.x);
  let mapH = f32(frame.mapFlags.y);
  let rowBase = f32(n) * 0.5 - 0.5;

  loop {
    if ((sy < 0) || (t >= farClip) || (guard >= MAX_STEPS)) {
      break;
    }
    guard = guard + 1u;
    var mip = 0;
    loop {
      if ((mip >= lastMip) || (t < mipSwitchArr[mip])) {
        break;
      }
      mip = mip + 1;
    }
    let lo = max(bandMarchStep(mipSwitchArr[16 + mip], mip, t), 1.0e-4);
    let cell = mipCellSize(mip, t);
    step = fitBandStep(step, lo, cell);
    let yn = (rowBase - f32(sy)) * invH2;
    let dir = fwd + right * xn + up * yn;
    let pos = cam + dir * t;
    if ((pos.z > frame.tMaxMinDzAltMaxH.w) && !(dir.z < 0.0)) {
      break;
    }
    let inside = ((pos.x >= 0.0) && (pos.x < mapW) && (pos.y >= 0.0) && (pos.y < mapH)) || repeat;
    if (!inside) {
      t = t + step;
      step = growBandStep(step, lo, cell);
      continue;
    }
    let sampled = terrainSampleHeightPair(heightTex, mip, pos.x, pos.y, t, t);
    let addBytes = detailHeightBytes(pos.x, pos.y, t);
    let height = sampled.x + addBytes * (frame.tMaxMinDzAltMaxH.z / 255.0);
    if (pos.z < height) {
      let color = detailColor(terrainSampleColor(colorTex, mip, pos.x, pos.y, t, t), pos.x, pos.y, t);
      let dist = t * length(dir);
      let pix = vec2<i32>(col, sy);
      textureStore(faceColor, pix, vec4<u32>(packRgba(color), 0u, 0u, 0u));
      textureStore(faceDepth, pix, vec4<f32>(dist, 0.0, 0.0, 0.0));
      textureStore(faceHeight, pix, vec4<u32>(u32(clamp(sampled.y + addBytes, 0.0, 255.0)), 0u, 0u, 0u));
      textureStore(faceIter, pix, vec4<u32>(guard, 0u, 0u, 0u));
      sy = sy - 1;
      let prev = t - step;
      t = select(t0, prev, prev > t0);
    } else {
      t = t + step;
      step = growBandStep(step, lo, cell);
    }
  }
}
