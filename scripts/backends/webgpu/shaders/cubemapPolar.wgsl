@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var height0: texture_2d<u32>;
@group(1) @binding(1) var color0: texture_2d<f32>;
@group(1) @binding(2) var height1: texture_2d<u32>;
@group(1) @binding(3) var color1: texture_2d<f32>;
@group(1) @binding(4) var height2: texture_2d<u32>;
@group(1) @binding(5) var color2: texture_2d<f32>;
@group(2) @binding(0) var faceColor: texture_storage_2d<r32uint, write>;
@group(2) @binding(1) var faceDepth: texture_storage_2d<r32float, write>;
@group(2) @binding(2) var faceHeight: texture_storage_2d<r32uint, write>;
@group(2) @binding(3) var faceIter: texture_storage_2d<r32uint, write>;

const MAX_STEPS: u32 = 16384u;
const EPSILON: f32 = 1e-6;
const TWO_PI: f32 = 6.283185307179586;

fn sampleHeightByte(mip: i32, wx: f32, wy: f32) -> u32 {
  let inv0 = frame.mipInvPixelCenter.x;
  let inv1 = frame.mipInvPixelCenter.y;
  let inv2 = frame.mipInvPixelCenter.z;
  if (mip <= 0) {
    let ix = i32(wx * inv0) & i32(frame.mipSize1.w);
    let iy = i32(wy * inv0) & i32(frame.mipSize1.z);
    return textureLoad(height0, vec2<i32>(ix, iy), 0).r;
  }
  if (mip == 1) {
    let ix = i32(wx * inv1) & i32(frame.mipMask1.y);
    let iy = i32(wy * inv1) & i32(frame.mipMask1.x);
    return textureLoad(height1, vec2<i32>(ix, iy), 0).r;
  }
  let ix = i32(wx * inv2) & i32(frame.mipMask1.w);
  let iy = i32(wy * inv2) & i32(frame.mipMask1.z);
  return textureLoad(height2, vec2<i32>(ix, iy), 0).r;
}

fn sampleHeight(mip: i32, wx: f32, wy: f32) -> f32 {
  let altitude = frame.tMaxMinDzAltMaxH.z;
  return f32(sampleHeightByte(mip, wx, wy)) * (altitude / 255.0);
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

fn clampTexel(n: i32, i: i32, j: i32) -> vec2i {
  let last = n - 1;
  var ii = i;
  var jj = j;
  if (ii < 0) {
    ii = 0;
  }
  if (ii > last) {
    ii = last;
  }
  if (jj < 0) {
    jj = 0;
  }
  if (jj > last) {
    jj = last;
  }
  return vec2i(ii, jj);
}

fn uvToTexel(n: i32, u: f32, v: f32) -> vec2i {
  return clampTexel(
    n,
    i32((u * 0.5 + 0.5) * f32(n)),
    i32((0.5 - v * 0.5) * f32(n))
  );
}

fn plotPolar(n: i32, i: i32, j: i32, color: vec4f, dist: f32, hByte: u32, iter: u32) {
  let packed = packRgba(color);
  var dj = 0;
  loop {
    if (dj > 1) {
      break;
    }
    var di = 0;
    loop {
      if (di > 1) {
        break;
      }
      let p = clampTexel(n, i + di, j + dj);
      textureStore(faceColor, p, vec4<u32>(packed, 0u, 0u, 0u));
      textureStore(faceDepth, p, vec4<f32>(dist, 0.0, 0.0, 0.0));
      textureStore(faceHeight, p, vec4<u32>(hByte, 0u, 0u, 0u));
      textureStore(faceIter, p, vec4<u32>(iter, 0u, 0u, 0u));
      di = di + 1;
    }
    dj = dj + 1;
  }
}

fn fillSpoke(n: i32, su: f32, sv: f32, r0: f32, r1: f32, color: vec4f, dist: f32, hByte: u32, iter: u32) {
  let rMax = 1.0 / max(max(abs(su), abs(sv)), EPSILON);
  var a = max(r0, 0.0);
  var b = min(r1, rMax);
  if (!(b > a)) {
    return;
  }
  let p0 = uvToTexel(n, su * a, sv * a);
  let p1 = uvToTexel(n, su * b, sv * b);
  var x0 = p0.x;
  var y0 = p0.y;
  let x1 = p1.x;
  let y1 = p1.y;
  let dx = abs(x1 - x0);
  let dy = abs(y1 - y0);
  var sx = -1;
  if (x0 < x1) {
    sx = 1;
  }
  var sy = -1;
  if (y0 < y1) {
    sy = 1;
  }
  var err = dx - dy;
  var guard = 0u;
  loop {
    if (guard >= 2048u) {
      break;
    }
    plotPolar(n, x0, y0, color, dist, hByte, iter);
    if ((x0 == x1) && (y0 == y1)) {
      break;
    }
    let e2 = err * 2;
    if (e2 > -dy) {
      err = err - dy;
      x0 = x0 + sx;
    }
    if (e2 < dx) {
      err = err + dx;
      y0 = y0 + sy;
    }
    guard = guard + 1u;
  }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(frame.screenPano.z);
  let azCount = n * 4;
  let az = i32(gid.x);
  if (az >= azCount) {
    return;
  }
  let face = i32(frame.extra.w);
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
  var lastMip = i32(frame.mipShiftCount.w) - 1;
  let theta = (f32(az) + 0.5) / f32(azCount) * TWO_PI;
  let dirX = -sin(theta);
  let dirY = -cos(theta);
  let rMaxSpoke = 1.0 / max(max(abs(dirX), abs(dirY)), EPSILON);
  var t0 = frame.camFwdPad.w;
  if (t0 < nearClip) {
    t0 = nearClip;
  }
  var t = t0;
  var step = step0;
  var wasInside = 0;
  var mip = 0;
  var stepCap = stepCap0;
  var tStopCol = tStop;
  var k = 0u;
  var rOuterUp = 2.0;
  var rInnerDown = 0.0;
  var lastDownColor = vec4f(0.0);
  var lastDownDist = 0.0;
  var lastDownHeight = 0u;
  var lastDownIter = 0u;
  var hadDown = 0;

  loop {
    if ((t >= tStopCol) || (k >= MAX_STEPS)) {
      break;
    }
    k = k + 1u;
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
    if (h > ceiling + EPSILON) {
      t = t + step;
      step = step + stepGrowth;
      if (step > stepCap) {
        step = stepCap;
      }
      continue;
    }

    let dh = h - camZ;
    let slope = dh / t;
    let color = sampleColor(mip, wx, wy);
    let hByte = sampleHeightByte(mip, wx, wy);
    let dist = sqrt(t * t + dh * dh);
    if (face == 4 && slope > EPSILON) {
      let r = 1.0 / slope;
      if (r < rOuterUp) {
        fillSpoke(n, dirX, dirY, r, rOuterUp, color, dist, hByte, k);
        rOuterUp = r;
      }
    } else if (face == 5 && slope < -EPSILON) {
      let r = -1.0 / slope;
      if (r > rInnerDown) {
        if (rInnerDown < rMaxSpoke) {
          if (r <= rMaxSpoke) {
            fillSpoke(n, dirX, -dirY, rInnerDown, r, color, dist, hByte, k);
          } else if (rInnerDown > 0.0) {
            fillSpoke(n, dirX, -dirY, rInnerDown, rMaxSpoke, color, dist, hByte, k);
          }
        }
        rInnerDown = r;
        lastDownColor = color;
        lastDownDist = dist;
        lastDownHeight = hByte;
        lastDownIter = k;
        hadDown = 1;
      }
    }
    if (h <= clipZ + EPSILON && slope < 0.0) {
      break;
    }

    t = t + step;
    step = step + stepGrowth;
    if (step > stepCap) {
      step = stepCap;
    }
  }
  if (face == 5 && hadDown != 0 && rInnerDown > 0.0 && rInnerDown < rMaxSpoke) {
    fillSpoke(n, dirX, -dirY, rInnerDown, rMaxSpoke, lastDownColor, lastDownDist, lastDownHeight, lastDownIter);
  }
}
