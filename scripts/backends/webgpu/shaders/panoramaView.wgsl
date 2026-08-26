@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> atanLut: array<f32>;
@group(1) @binding(1) var<storage, read> yHitSin: array<i32>;
@group(1) @binding(2) var<storage, read> skyView: array<u32>;
@group(2) @binding(0) var panoColor: texture_2d<u32>;
@group(2) @binding(1) var panoDepth: texture_2d<f32>;
@group(2) @binding(2) var panoHeight: texture_2d<u32>;
@group(2) @binding(3) var panoIter: texture_2d<u32>;
@group(3) @binding(0) var outTex: texture_storage_2d<r32uint, write>;

const EPSILON: f32 = 1e-6;
const HALF_PI: f32 = 1.5707963267948966;
const INV_TWO_PI: f32 = 0.15915494309189535;

fn atan2Lut(y: f32, x: f32) -> f32 {
  let ax = abs(x);
  let ay = abs(y);
  var ang = 0.0;
  let last = i32(frame.extraU.w);
  if (ay > ax) {
    if (ay < EPSILON) {
      ang = 0.0;
    } else {
      var idx = i32((ax / ay) * f32(last));
      if (idx > last) {
        idx = last;
      }
      ang = HALF_PI - atanLut[idx];
    }
  } else if (ax < EPSILON) {
    ang = 0.0;
  } else {
    var idx = i32((ay / ax) * f32(last));
    if (idx > last) {
      idx = last;
    }
    ang = atanLut[idx];
  }
  if (x < 0.0) {
    ang = PI - ang;
  }
  if (y < 0.0) {
    ang = -ang;
  }
  return ang;
}

fn yHitFromHat(sHat: f32) -> i32 {
  let scale = frame.mipSwitchYHit.w;
  let last = i32(frame.extraU.z);
  var idx = i32((sHat + 1.0) * scale);
  if (idx < 0) {
    idx = 0;
  }
  if (idx > last) {
    idx = last;
  }
  return yHitSin[idx];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let screenW = i32(frame.screenPano.x);
  let screenH = i32(frame.screenPano.y);
  let sx = i32(gid.x);
  let sy = i32(gid.y);
  if ((sx >= screenW) || (sy >= screenH)) {
    return;
  }

  let panoW = i32(frame.screenPano.z);
  let panoH = i32(frame.screenPano.w);
  let panoLast = panoH - 1;
  let nearClip = frame.sinCosNearFar.z;
  let farClip = frame.sinCosNearFar.w;
  let useFog = flagFog(frame.mapFlags.w);
  let fogStart = frame.sampleLimit.y;
  let fogEnd = frame.sampleLimit.z;
  let tanHalfY = frame.extra.y;
  let tanHalfX = tanHalfY * (f32(screenW) / f32(screenH));
  let pixelCenter = frame.mipInvPixelCenter.w;
  let ndcScale = frame.extra.z;
  let invW = 1.0 / f32(screenW);
  let invH = 1.0 / f32(screenH);
  let camY = (1.0 - (f32(sy) + pixelCenter) * invH * ndcScale) * tanHalfY;
  let camX = ((f32(sx) + pixelCenter) * invW * ndcScale - 1.0) * tanHalfX;
  let right = frame.camRightDst.xyz;
  let up = frame.camUpHorizon.xyz;
  let fwd = frame.camFwdPad.xyz;
  let dx = right.x * camX + up.x * camY + fwd.x;
  let dy = right.y * camX + up.y * camY + fwd.y;
  let dz = right.z * camX + up.z * camY + fwd.z;
  let invViewLen = 1.0 / sqrt(camX * camX + camY * camY + 1.0);
  var py = yHitFromHat(dz * invViewLen);
  if (py < 0) {
    py = 0;
  }
  if (py > panoLast) {
    py = panoLast;
  }
  let theta = atan2Lut(-dx, -dy);
  var px = i32(theta * f32(panoW) * INV_TWO_PI + f32(panoW));
  if (px >= panoW) {
    px = px - panoW;
  }
  if (px < 0) {
    px = px + panoW;
  }
  let packed = textureLoad(panoColor, vec2<i32>(px, py), 0).r;
  let dist = textureLoad(panoDepth, vec2<i32>(px, py), 0).r;
  let debugView = flagDebugView(frame.mapFlags.w);
  var outColor = packed;
  if (debugView != DEBUG_COLOR) {
    let hByte = textureLoad(panoHeight, vec2<i32>(px, py), 0).r;
    let iter = textureLoad(panoIter, vec2<i32>(px, py), 0).r;
    var viewZ = 0.0;
    if (dist > 0.0) {
      viewZ = dist * invViewLen;
    }
    outColor = encodeCamera(debugView, dist, hByte, iter, viewZ, farClip);
  } else if (dist > 0.0) {
    let viewZ = dist * invViewLen;
    if (!useFog && ((viewZ >= farClip) || (viewZ < nearClip))) {
      outColor = skyView[min(u32(py), u32(arrayLength(&skyView) - 1u))];
    } else if (useFog) {
      let fogT = fogAmount(viewZ, fogStart, fogEnd);
      if (fogT >= 1.0) {
        outColor = packRgba(vec4f(1.0));
      } else if (fogT > 0.0) {
        outColor = packRgba(fogRgb(unpackRgba(packed), fogT));
      }
    }
  }
  textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(outColor, 0u, 0u, 0u));
}
