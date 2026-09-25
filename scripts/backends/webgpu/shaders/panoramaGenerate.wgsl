@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> tanMin: array<f32>;
@group(1) @binding(1) var<storage, read> yHitLut: array<i32>;
@group(1) @binding(2) var<storage, read> dirXY: array<vec2<f32>>;
@group(1) @binding(3) var<storage, read> skyPano: array<u32>;
@group(2) @binding(0) var heightTex: texture_2d<u32>;
@group(2) @binding(1) var colorTex: texture_2d<f32>;
@group(2) @binding(2) var<storage, read> mipSwitchArr: array<f32, 32>;
@group(3) @binding(0) var panoColor: texture_storage_2d<r32uint, write>;
@group(3) @binding(1) var panoDepth: texture_storage_2d<r32float, write>;
@group(3) @binding(2) var panoHeight: texture_storage_2d<r32uint, write>;
@group(3) @binding(3) var panoIter: texture_storage_2d<r32uint, write>;

const MAX_STEPS: u32 = 65536u;
const EPSILON: f32 = 1e-6;

fn sampleHeightPair(mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> vec2f {
  let sampled = terrainSampleHeightPair(heightTex, mip, wx, wy, dist, t);
  let addBytes = detailHeightBytes(wx, wy, t);
  let add = addBytes * (frame.tMaxMinDzAltMaxH.z / 255.0);
  return vec2f(sampled.x + add, clamp(sampled.y + addBytes, 0.0, 255.0));
}

fn sampleHeightByte(mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> u32 {
  return u32(sampleHeightPair(mip, wx, wy, dist, t).y);
}

fn sampleHeight(mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> f32 {
  return sampleHeightPair(mip, wx, wy, dist, t).x;
}

fn sampleColor(mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> vec4f {
  return detailColor(terrainSampleColor(colorTex, mip, wx, wy, dist, t), wx, wy, t);
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
  return yHitLut[idx];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let panoW = i32(frame.screenPano.z);
  let panoH = i32(frame.screenPano.w);
  let px = i32(gid.x);
  if (px >= panoW) {
    return;
  }

  var y = 0;
  loop {
    if (y >= panoH) {
      break;
    }
    let sky = skyPano[min(u32(y), u32(arrayLength(&skyPano) - 1u))];
    textureStore(panoColor, vec2<i32>(px, y), vec4<u32>(sky, 0u, 0u, 0u));
    textureStore(panoDepth, vec2<i32>(px, y), vec4<f32>(0.0, 0.0, 0.0, 0.0));
    textureStore(panoHeight, vec2<i32>(px, y), vec4<u32>(0u, 0u, 0u, 0u));
    textureStore(panoIter, vec2<i32>(px, y), vec4<u32>(0u, 0u, 0u, 0u));
    y = y + 1;
  }

  let camX = frame.camPosTanHalfX.x;
  let camY = frame.camPosTanHalfX.y;
  let camZ = frame.camPosTanHalfX.z;
  let nearClip = frame.sinCosNearFar.z;
  let farClip = frame.sinCosNearFar.w;
  var tStop = frame.tMaxMinDzAltMaxH.x;
  if (!(tStop > 0.0)) {
    tStop = farClip * 3.0;
  }
  let repeat = flagRepeat(frame.mapFlags.w);
  let mapW = f32(frame.mapFlags.x);
  let mapH = f32(frame.mapFlags.y);
  let ceiling = frame.tMaxMinDzAltMaxH.w;
  let clipZ = frame.clipDhTanLastGrowth.x;
  let dhGround = frame.clipDhTanLastGrowth.y;
  let tanLast = frame.clipDhTanLastGrowth.z;
  let lastMip = terrainLastMip(heightTex);
  let absGround = abs(dhGround);
  let dir = dirXY[px];
  var dirX = dir.x;
  var dirY = dir.y;
  var t0 = frame.camFwdPad.w;
  var t = t0;
  var H = panoH;
  var wasInside = 0;
  var mip = 0;
  var tStopCol = tStop;
  var n = 0u;

  loop {
    if ((t >= tStopCol) || (H == 0) || (n >= MAX_STEPS)) {
      break;
    }
    n = n + 1u;
    loop {
      if ((mip >= lastMip) || (t < mipSwitchArr[mip])) {
        break;
      }
      mip = mip + 1;
    }

    let sealed = H != panoH;
    var tanH = 0.0;
    if (sealed && (H < i32(arrayLength(&tanMin)))) {
      tanH = tanMin[H];
    }
    if (sealed) {
      let zRay = camZ + t * tanH;
      if (tanH >= 0.0) {
        if (ceiling < zRay - EPSILON) {
          break;
        }
        if (tanH > EPSILON) {
          let tCeil = (ceiling - camZ) / tanH;
          if (tCeil < tStopCol) {
            tStopCol = tCeil;
          }
          if (t >= tStopCol) {
            break;
          }
        } else if (ceiling < camZ - EPSILON) {
          break;
        }
      } else if (zRay > ceiling + EPSILON) {
        let tEnter = (ceiling - camZ) / tanH;
        if (tEnter >= tStopCol) {
          break;
        }
        if (tEnter > t + EPSILON) {
          t = tEnter;
          continue;
        }
      }
    }

    let wx = camX + dirX * t;
    let wy = camY + dirY * t;
    let filterClip = t * (dirX * frame.camFwdPad.x + dirY * frame.camFwdPad.y);
    if (!repeat) {
      let inside = (wx >= 0.0) && (wx < mapW) && (wy >= 0.0) && (wy < mapH);
      if (!inside) {
        if (wasInside != 0) {
          break;
        }
        t = t + bandMarchStep(mipSwitchArr[16 + mip], mip, t);
        continue;
      }
      wasInside = 1;
    }

    let hs = sampleHeightPair(mip, wx, wy, filterClip, t);
    let h = hs.x;
    if (sealed && (h < camZ + t * tanH - EPSILON)) {
      t = t + bandMarchStep(mipSwitchArr[16 + mip], mip, t);
      continue;
    }

    let dh = h - camZ;
    let absS = abs(dh);
    let sHat = dh / (t + absS);
    var yHit = yHitFromHat(sHat);
    if (yHit < 0) {
      yHit = 0;
    }
    if (yHit >= panoH) {
      yHit = panoH - 1;
    }
    if (mip > 0 || lod0RefineAt(t, mip)) {
      let tFar = mipCellFarT(t, wx, wy, dirX, dirY, mip);
      if (tFar > t) {
        let yFar = yHitFromHat(dh / (tFar + absS));
        if (yFar < yHit) {
          yHit = yFar;
        }
        if (yHit < 0) {
          yHit = 0;
        }
        if (yHit >= panoH) {
          yHit = panoH - 1;
        }
      }
    }
    if (yHit < H) {
      var yBottom = H;
      let tanG = dhGround / t;
      var yGround = panoH;
      if (tanG > tanLast) {
        let sHatG = dhGround / (t + absGround);
        yGround = yHitFromHat(sHatG);
      }
      if (yGround < yBottom) {
        yBottom = yGround;
      }
      if (yHit < yBottom) {
        let color = sampleColor(mip, wx, wy, filterClip, t);
        let dist = sqrt(t * t + dh * dh);
        let hByte = u32(hs.y);
        var yy = yHit;
        loop {
          if (yy >= yBottom) {
            break;
          }
          textureStore(panoColor, vec2<i32>(px, yy), vec4<u32>(packRgba(color), 0u, 0u, 0u));
          textureStore(panoDepth, vec2<i32>(px, yy), vec4<f32>(dist, 0.0, 0.0, 0.0));
          textureStore(panoHeight, vec2<i32>(px, yy), vec4<u32>(hByte, 0u, 0u, 0u));
          textureStore(panoIter, vec2<i32>(px, yy), vec4<u32>(n, 0u, 0u, 0u));
          yy = yy + 1;
        }
      }
      H = yHit;
    }

    t = t + bandMarchStep(mipSwitchArr[16 + mip], mip, t);
  }
}
