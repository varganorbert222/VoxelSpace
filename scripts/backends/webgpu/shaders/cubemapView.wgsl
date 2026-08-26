@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var cubeColor: texture_2d_array<u32>;
@group(1) @binding(1) var cubeDepth: texture_2d_array<f32>;
@group(1) @binding(2) var cubeHeight: texture_2d_array<u32>;
@group(1) @binding(3) var cubeIter: texture_2d_array<u32>;
@group(2) @binding(0) var outTex: texture_storage_2d<r32uint, write>;
@group(3) @binding(0) var<storage, read> skyView: array<u32>;

const EPSILON: f32 = 1e-6;

fn cubeSelect(dx: f32, dy: f32, dz: f32) -> vec3i {
  let ax = abs(dx);
  let ay = abs(dy);
  let az = abs(dz);
  var face = 0;
  var u = 0.0;
  var v = 0.0;
  if (ax >= ay && ax >= az) {
    let inv = 1.0 / max(ax, EPSILON);
    if (dx >= 0.0) {
      face = 0;
      u = -dy * inv;
      v = dz * inv;
    } else {
      face = 1;
      u = dy * inv;
      v = dz * inv;
    }
  } else if (ay >= ax && ay >= az) {
    let inv = 1.0 / max(ay, EPSILON);
    if (dy >= 0.0) {
      face = 2;
      u = dx * inv;
      v = dz * inv;
    } else {
      face = 3;
      u = -dx * inv;
      v = dz * inv;
    }
  } else {
    let inv = 1.0 / max(az, EPSILON);
    if (dz >= 0.0) {
      face = 4;
      u = dx * inv;
      v = dy * inv;
    } else {
      face = 5;
      u = dx * inv;
      v = -dy * inv;
    }
  }
  let n = i32(frame.screenPano.z);
  let last = n - 1;
  var i = i32((u * 0.5 + 0.5) * f32(n));
  var j = i32((0.5 - v * 0.5) * f32(n));
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
  return vec3i(face, i, j);
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
  let sel = cubeSelect(dx, dy, dz);
  let packed = textureLoad(cubeColor, vec2<i32>(sel.y, sel.z), sel.x, 0).r;
  let dist = textureLoad(cubeDepth, vec2<i32>(sel.y, sel.z), sel.x, 0).r;
  let debugView = flagDebugView(frame.mapFlags.w);
  var outColor = packed;
  if (debugView != DEBUG_COLOR) {
    let hByte = textureLoad(cubeHeight, vec2<i32>(sel.y, sel.z), sel.x, 0).r;
    let iter = textureLoad(cubeIter, vec2<i32>(sel.y, sel.z), sel.x, 0).r;
    var viewZ = 0.0;
    if (dist > 0.0) {
      viewZ = dist * invViewLen;
    }
    outColor = encodeCamera(debugView, dist, hByte, iter, viewZ, farClip);
  } else if (dist > 0.0) {
    let viewZ = dist * invViewLen;
    if (!useFog && ((viewZ >= farClip) || (viewZ < nearClip))) {
      let skyIdx = min(
        skyLutIndexFromHat(dz * invViewLen, screenH),
        u32(arrayLength(&skyView) - 1u)
      );
      outColor = skyView[skyIdx];
    } else if (useFog) {
      let fogT = fogAmount(viewZ, fogStart, fogEnd);
      if (fogT >= 1.0) {
        outColor = packRgba(vec4f(1.0));
      } else if (fogT > 0.0) {
        let c = unpackRgba(packed);
        outColor = packRgba(fogRgb(c, fogT));
      }
    }
  }
  textureStore(outTex, vec2<i32>(sx, sy), vec4<u32>(outColor, 0u, 0u, 0u));
}
