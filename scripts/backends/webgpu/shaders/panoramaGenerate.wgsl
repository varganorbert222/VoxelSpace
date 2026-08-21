@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> tanMin: array<f32>;
@group(1) @binding(1) var<storage, read> yHitLut: array<i32>;
@group(1) @binding(2) var<storage, read> dirXY: array<vec2<f32>>;
@group(1) @binding(3) var<storage, read> skyPano: array<u32>;
@group(2) @binding(0) var height0: texture_2d<u32>;
@group(2) @binding(1) var color0: texture_2d<f32>;
@group(2) @binding(2) var height1: texture_2d<u32>;
@group(2) @binding(3) var color1: texture_2d<f32>;
@group(2) @binding(4) var height2: texture_2d<u32>;
@group(2) @binding(5) var color2: texture_2d<f32>;
@group(3) @binding(0) var panoColor: texture_storage_2d<r32uint, write>;
@group(3) @binding(1) var panoDepth: texture_storage_2d<r32float, write>;

const MAX_STEPS: u32 = 16384u;
const EPSILON: f32 = 1e-6;

fn sampleHeight(mip: i32, wx: f32, wy: f32) -> f32 {
  let inv0 = frame.mipInvPixelCenter.x;
  let inv1 = frame.mipInvPixelCenter.y;
  let inv2 = frame.mipInvPixelCenter.z;
  let altitude = frame.tMaxMinDzAltMaxH.z;
  let altScale = altitude / 255.0;
  if (mip <= 0) {
    let ix = i32(wx * inv0) & i32(frame.mipSize1.w);
    let iy = i32(wy * inv0) & i32(frame.mipSize1.z);
    return f32(textureLoad(height0, vec2<i32>(ix, iy), 0).r) * altScale;
  }
  if (mip == 1) {
    let ix = i32(wx * inv1) & i32(frame.mipMask1.y);
    let iy = i32(wy * inv1) & i32(frame.mipMask1.x);
    return f32(textureLoad(height1, vec2<i32>(ix, iy), 0).r) * altScale;
  }
  let ix = i32(wx * inv2) & i32(frame.mipMask1.w);
  let iy = i32(wy * inv2) & i32(frame.mipMask1.z);
  return f32(textureLoad(height2, vec2<i32>(ix, iy), 0).r) * altScale;
}

fn sampleColor(mip: i32, wx: f32, wy: f32) -> vec4f {
  let inv0 = frame.mipInvPixelCenter.x;
  let inv1 = frame.mipInvPixelCenter.y;
  let inv2 = frame.mipInvPixelCenter.z;
  if (mip <= 0) {
    let ix = i32(wx * inv0) & i32(frame.mipSize1.w);
    let iy = i32(wy * inv0) & i32(frame.mipSize1.z);
    return textureLoad(color0, vec2<i32>(ix, iy), 0);
  }
  if (mip == 1) {
    let ix = i32(wx * inv1) & i32(frame.mipMask1.y);
    let iy = i32(wy * inv1) & i32(frame.mipMask1.x);
    return textureLoad(color1, vec2<i32>(ix, iy), 0);
  }
  let ix = i32(wx * inv2) & i32(frame.mipMask1.w);
  let iy = i32(wy * inv2) & i32(frame.mipMask1.z);
  return textureLoad(color2, vec2<i32>(ix, iy), 0);
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
  let stepGrowth = frame.clipDhTanLastGrowth.w;
  let step0 = frame.stepScaleCaps.x;
  var stepCap0 = frame.stepScaleCaps.y;
  var stepCap1 = frame.stepScaleCaps.z;
  var stepCap2 = frame.stepScaleCaps.w;
  if (stepCap0 < step0) {
    stepCap0 = step0;
  }
  if (stepCap1 < step0) {
    stepCap1 = step0;
  }
  if (stepCap2 < step0) {
    stepCap2 = step0;
  }
  let switchT0 = frame.mipSwitchYHit.x;
  let switchT1 = frame.mipSwitchYHit.y;
  let mipStepScale = frame.mipSwitchYHit.z;
  let lastMip = i32(frame.mipShiftCount.w) - 1;
  let absGround = abs(dhGround);
  let dir = dirXY[px];
  var dirX = dir.x;
  var dirY = dir.y;
  var t0 = frame.camFwdPad.w;
  var t = t0;
  var step = step0;
  var H = panoH;
  var wasInside = 0;
  var mip = 0;
  var stepCap = stepCap0;
  var tStopCol = tStop;
  var n = 0u;

  loop {
    if ((t >= tStopCol) || (H == 0) || (n >= MAX_STEPS)) {
      break;
    }
    n = n + 1u;
    loop {
      var switchT = switchT0;
      if (mip >= 1) {
        switchT = switchT1;
      }
      if ((mip >= lastMip) || (t < switchT)) {
        break;
      }
      mip = mip + 1;
      step = step * mipStepScale;
      if (mip == 1) {
        stepCap = stepCap1;
      } else {
        stepCap = stepCap2;
      }
      if (step > stepCap) {
        step = stepCap;
      }
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
    if (!repeat) {
      let inside = (wx >= 0.0) && (wx < mapW) && (wy >= 0.0) && (wy < mapH);
      if (!inside) {
        if (wasInside != 0) {
          break;
        }
        t = t + step;
        step = step + stepGrowth;
        if (step > stepCap) {
          step = stepCap;
        }
        continue;
      }
      wasInside = 1;
    }

    let h = sampleHeight(mip, wx, wy);
    if (sealed && (h < camZ + t * tanH - EPSILON)) {
      t = t + step;
      step = step + stepGrowth;
      if (step > stepCap) {
        step = stepCap;
      }
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
        let color = sampleColor(mip, wx, wy);
        let dist = sqrt(t * t + dh * dh);
        var yy = yHit;
        loop {
          if (yy >= yBottom) {
            break;
          }
          textureStore(panoColor, vec2<i32>(px, yy), vec4<u32>(packRgba(color), 0u, 0u, 0u));
          textureStore(panoDepth, vec2<i32>(px, yy), vec4<f32>(dist, 0.0, 0.0, 0.0));
          yy = yy + 1;
        }
      }
      H = yHit;
    }

    t = t + step;
    step = step + stepGrowth;
    if (step > stepCap) {
      step = stepCap;
    }
  }
}
