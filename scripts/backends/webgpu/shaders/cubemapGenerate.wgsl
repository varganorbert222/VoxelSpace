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

fn sampleHeightByteNN(mip: i32, wx: f32, wy: f32) -> u32 {
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

fn heightByteAt0(ix: i32, iy: i32, wrap: bool) -> u32 {
  let x = wrapOrClamp(ix, i32(frame.mipSize1.w), wrap);
  let y = wrapOrClamp(iy, i32(frame.mipSize1.z), wrap);
  return textureLoad(height0, vec2<i32>(x, y), 0).r;
}

fn sampleHeightPair(mip: i32, wx: f32, wy: f32) -> vec2f {
  let altitude = frame.tMaxMinDzAltMaxH.z;
  let nn = f32(sampleHeightByteNN(mip, wx, wy));
  if ((mip > 0) || !flagHeightLerp(frame.mapFlags.w)) {
    return vec2f(nn * (altitude / 255.0), nn);
  }
  let wrap = flagRepeat(frame.mapFlags.w);
  let x0 = floor(wx);
  let y0 = floor(wy);
  let fx = wx - x0;
  let fy = wy - y0;
  let tx = i32(x0);
  let ty = i32(y0);
  let h00 = f32(heightByteAt0(tx, ty, wrap));
  let h10 = f32(heightByteAt0(tx + 1, ty, wrap));
  let h01 = f32(heightByteAt0(tx, ty + 1, wrap));
  let h11 = f32(heightByteAt0(tx + 1, ty + 1, wrap));
  let h = bilinearHeight(h00, h10, h01, h11, fx, fy);
  return vec2f(h * (altitude / 255.0), clamp(h + 0.5, 0.0, 255.0));
}

fn sampleHeightByte(mip: i32, wx: f32, wy: f32) -> u32 {
  return u32(sampleHeightPair(mip, wx, wy).y);
}

fn sampleHeight(mip: i32, wx: f32, wy: f32) -> f32 {
  return sampleHeightPair(mip, wx, wy).x;
}

fn colorAt0(ix: i32, iy: i32, wrap: bool) -> vec4f {
  let x = wrapOrClamp(ix, i32(frame.mipSize1.w), wrap);
  let y = wrapOrClamp(iy, i32(frame.mipSize1.z), wrap);
  return textureLoad(color0, vec2<i32>(x, y), 0);
}

fn sampleColor(mip: i32, wx: f32, wy: f32) -> vec4f {
  let inv0 = frame.mipInvPixelCenter.x;
  let inv1 = frame.mipInvPixelCenter.y;
  let inv2 = frame.mipInvPixelCenter.z;
  if ((mip <= 0) && flagColorFilter(frame.mapFlags.w)) {
    let wrap = flagRepeat(frame.mapFlags.w);
    let x0 = floor(wx * inv0);
    let y0 = floor(wy * inv0);
    let fx = wx * inv0 - x0;
    let fy = wy * inv0 - y0;
    let tx = i32(x0);
    let ty = i32(y0);
    return bilinearColor(
      colorAt0(tx, ty, wrap),
      colorAt0(tx + 1, ty, wrap),
      colorAt0(tx, ty + 1, wrap),
      colorAt0(tx + 1, ty + 1, wrap),
      fx,
      fy
    );
  }
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

fn horizonDirXY(face: i32, u: f32) -> vec2f {
  if (face == 0) {
    return vec2f(1.0, -u);
  }
  if (face == 1) {
    return vec2f(-1.0, u);
  }
  if (face == 2) {
    return vec2f(u, 1.0);
  }
  return vec2f(-u, -1.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(frame.screenPano.z);
  let col = i32(gid.x);
  if (col >= n) {
    return;
  }
  let face = i32(frame.extra.w);
  var y = 0;
  loop {
    if (y >= n) {
      break;
    }
    let sky = packRgba(skyColorFromDir(cubeDirFromTexel(face, col, y, n), frame.sky, frame.horizonColor));
    textureStore(faceColor, vec2<i32>(col, y), vec4<u32>(sky, 0u, 0u, 0u));
    textureStore(faceDepth, vec2<i32>(col, y), vec4<f32>(0.0, 0.0, 0.0, 0.0));
    textureStore(faceHeight, vec2<i32>(col, y), vec4<u32>(0u, 0u, 0u, 0u));
    textureStore(faceIter, vec2<i32>(col, y), vec4<u32>(0u, 0u, 0u, 0u));
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
  let pixelCenter = frame.mipInvPixelCenter.w;
  let u = (2.0 * (f32(col) + pixelCenter) / f32(n)) - 1.0;
  let dirRaw = horizonDirXY(face, u);
  let lenXY = length(dirRaw);
  var invLen = 1.0;
  if (lenXY > EPSILON) {
    invLen = 1.0 / lenXY;
  }
  let dirX = dirRaw.x * invLen;
  let dirY = dirRaw.y * invLen;
  let halfN = f32(n) * 0.5;
  let dst = halfN * lenXY;
  let horizon = halfN;
  var t0 = frame.camFwdPad.w;
  if (t0 < nearClip) {
    t0 = nearClip;
  }
  var t = t0;
  var step = step0;
  var H = n;
  var wasInside = 0;
  var mip = 0;
  var stepCap = stepCap0;
  var tStopCol = tStop;
  var k = 0u;

  loop {
    if ((t >= tStopCol) || (H <= 0) || (k >= MAX_STEPS)) {
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

    let zScale = dst / t;
    var yHit = i32((camZ - h) * zScale + horizon);
    if (yHit < 0) {
      yHit = 0;
    }
    if (yHit > n - 1) {
      t = t + step;
      step = step + stepGrowth;
      if (step > stepCap) {
        step = stepCap;
      }
      continue;
    }
    if (yHit < H) {
      var yBottom = H;
      var yGround = i32((camZ - clipZ) * zScale + horizon);
      if (yGround < 0) {
        yGround = 0;
      }
      if (yGround < yBottom) {
        yBottom = yGround;
      }
      if (yHit < yBottom) {
        let color = sampleColor(mip, wx, wy);
        let hByte = sampleHeightByte(mip, wx, wy);
        let dh = h - camZ;
        let dist = sqrt(t * t + dh * dh);
        var yy = yHit;
        loop {
          if (yy >= yBottom) {
            break;
          }
          textureStore(faceColor, vec2<i32>(col, yy), vec4<u32>(packRgba(color), 0u, 0u, 0u));
          textureStore(faceDepth, vec2<i32>(col, yy), vec4<f32>(dist, 0.0, 0.0, 0.0));
          textureStore(faceHeight, vec2<i32>(col, yy), vec4<u32>(hByte, 0u, 0u, 0u));
          textureStore(faceIter, vec2<i32>(col, yy), vec4<u32>(k, 0u, 0u, 0u));
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
