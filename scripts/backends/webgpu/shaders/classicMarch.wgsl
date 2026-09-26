@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(1) var<storage, read> lodDeltas: array<f32, 16>;
@group(1) @binding(2) var<storage, read> lodDistances: array<f32, 32>;
@group(2) @binding(0) var heightTex: texture_2d<u32>;
@group(2) @binding(1) var colorTex: texture_2d<f32>;
@group(3) @binding(0) var outTex: texture_storage_2d<r32uint, write>;
@group(3) @binding(1) var<storage, read> skyRows: array<u32>;

const MAX_STEPS: u32 = 65536u;

fn classicSampleHeight(plx: f32, ply: f32, mip: i32, lerp: bool, z: f32) -> vec2f {
  let dist = select(frame.sampleLimit.x + 1.0, 0.0, lerp);
  let sampled = terrainSampleHeightPair(heightTex, mip, plx, ply, dist, z);
  let altitude = frame.tMaxMinDzAltMaxH.z;
  var hFine = sampled.y;
  if (altitude > 0.0) {
    hFine = sampled.x * (255.0 / altitude);
  }
  return vec2f(hFine, clamp(hFine + 0.5, 0.0, 255.0));
}

fn classicSampleColor(plx: f32, ply: f32, mip: i32, doFilter: bool, z: f32) -> vec4f {
  let dist = select(frame.sampleLimit.x + 1.0, 0.0, doFilter);
  return detailColor(terrainSampleColor(colorTex, mip, plx, ply, dist, z), plx, ply, z);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let screenW = i32(frame.screenPano.x);
  let screenH = i32(frame.screenPano.y);
  let x = i32(gid.x);
  if (x >= screenW) {
    return;
  }

  let debugView = flagDebugView(frame.mapFlags.w);
  var y = 0;
  loop {
    if (y >= screenH) {
      break;
    }
    var sky = 0u;
    if (debugView == DEBUG_COLOR) {
      if (skyPacked()) {
        sky = skyUnfilledColor();
      } else {
        sky = skyColorAt(x, y);
      }
    }
    textureStore(outTex, vec2<i32>(x, y), vec4<u32>(sky, 0u, 0u, 0u));
    y = y + 1;
  }

  let camX = frame.camPosTanHalfX.x;
  let camY = frame.camPosTanHalfX.y;
  let camZ = frame.camPosTanHalfX.z;
  let tanHalfX = frame.camPosTanHalfX.w;
  let dst = frame.camRightDst.w;
  let screenHorizon = frame.camUpHorizon.w;
  let sinA = frame.sinCosNearFar.x;
  let cosA = frame.sinCosNearFar.y;
  let farClip = frame.sinCosNearFar.w;
  let altitude = frame.tMaxMinDzAltMaxH.z;
  let maxHeight = frame.tMaxMinDzAltMaxH.w;
  let mapW = i32(frame.mapFlags.x);
  let mapH = i32(frame.mapFlags.y);
  let mapShift = frame.mapFlags.z;
  let flags = frame.mapFlags.w;
  let useFog = flagFog(flags);
  let repeat = flagRepeat(flags);
  let lodCount = i32(frame.extraU.y);
  let altScale = altitude / 255.0;
  let underByte = f32(terrainHeightNN(heightTex, 0, camX, camY));
  var clearance = camZ - underByte * altScale;
  if (clearance < 0.0) {
    clearance = 0.0;
  }
  let mapWMask = mapW - 1;
  let mapHMask = mapH - 1;
  let ceilingSdf = camZ - maxHeight;
  let yGround = camZ + 20.0;
  let fogStart = frame.sampleLimit.y;
  let fogEnd = frame.sampleLimit.z;
  let screenWidthScaler = 1.0 / f32(screenW);
  let kRightX = cosA * tanHalfX;
  let kRightY = -sinA * tanHalfX;
  let kLeftX = -sinA - kRightX;
  let kLeftY = -cosA - kRightY;
  let kDx = (kRightX + kRightX) * screenWidthScaler;
  let kDy = (kRightY + kRightY) * screenWidthScaler;
  let dirX = kLeftX + kDx * f32(x);
  let dirY = kLeftY + kDy * f32(x);

  var sampleN = 0u;
  var lod = lodCount;
  loop {
    if (lod <= 0) {
      break;
    }
    let startIndex = lodDistances[lod - 1];
    let endIndex = lodDistances[lod];
    let mip = lod - 1;
    lod = lod - 1;
    if (startIndex >= farClip) {
      continue;
    }

    var hiddenY = screenH;
    var z = startIndex;
    if (ceilingSdf > 0.0) {
      let ySpan = f32(screenH) - screenHorizon;
      if (ySpan > 1.0) {
        let zEnter = ceilingSdf * dst / ySpan;
        if (z < zEnter) {
          z = zEnter;
        }
      }
    }
    var n = 0u;
    var step = 0.0;
    let bandStep = lodDeltas[mip];
    loop {
      if ((z >= endIndex) || (z >= farClip) || (n >= MAX_STEPS)) {
        break;
      }
      n = n + 1u;
      let lo = bandMarchStep(bandStep, mip, z);
      let cell = mipCellSize(mip, z);
      step = fitBandStep(step, lo, cell);
      let ySpan = f32(screenH) - screenHorizon;
      if (clearance > 1.0 && z > 0.0) {
        var sdfCap = clearance;
        if (ySpan > 1.0) {
          let onScreen = ySpan * z / dst;
          if (onScreen < sdfCap) {
            sdfCap = onScreen;
          }
        }
        if (sdfCap > 1.0) {
          var budget = f32(frame.extraU.x);
          if (budget < 2.0) {
            budget = 48.0;
          } else if (budget < 3.0) {
            budget = 32.0;
          } else if (budget < 4.0) {
            budget = 24.0;
          } else if (budget < 5.0) {
            budget = 16.0;
          } else {
            budget = 8.0;
          }
          var screenStep = z * z / (sdfCap * dst) * budget;
          if (screenStep < 0.001) {
            screenStep = 0.001;
          }
          if (step > screenStep) {
            step = screenStep;
          }
        }
      }
      let zScale = dst / z;
      let ceilingOnScreen = i32(ceilingSdf * zScale + screenHorizon);
      let groundOnScreen = i32(yGround * zScale + screenHorizon);
      let fogT = fogAmount(z, fogStart, fogEnd);
      let fogWhite = useFog && (fogT >= 1.0);
      let applyFogT = useFog && (fogT > 0.0) && !fogWhite;
      let dx = kDx * z;
      let dy = kDy * z;
      var plx = kLeftX * z + camX + dx * f32(x);
      var ply = kLeftY * z + camY + dy * f32(x);
      let colHidden = hiddenY;
      let inside = (plx >= 0.0) && (plx <= f32(mapW)) && (ply >= 0.0) && (ply <= f32(mapH));
      let isOk = inside || repeat;
      let ceilingBelow = ceilingOnScreen >= colHidden;
      if (colHidden == 0 || (isOk && ceilingBelow && ceilingSdf <= 0.0)) {
        break;
      }
      if (colHidden != 0) {
        if (isOk && (ceilingOnScreen < colHidden)) {
          let useFine = mip == 0;
          let sampled = classicSampleHeight(plx, ply, mip, flagLod0Refine(flags) && useFine, z);
          var hFine = sampled.x;
          let spanFar = mipSpanFarT(z, step, plx, ply, dirX, dirY, mip);
          let yCap = projectSdfYSpan(
            camZ - (hFine + detailElevMaxBytes(z)) * altScale,
            dst,
            z,
            spanFar,
            screenHorizon
          );
          if (yCap < colHidden) {
            hFine = hFine + detailHeightBytes(plx, ply, z);
          }
          let hByte = u32(clamp(hFine + 0.5, 0.0, 255.0));
          let terrainHeight = hFine * altScale;
          let terrainSdf = camZ - terrainHeight;
          if (terrainSdf > clearance) {
            clearance = terrainSdf;
          }
          let heightOnScreen = projectSdfYSpan(
            terrainSdf,
            dst,
            z,
            spanFar,
            screenHorizon
          );
          var heightOnScreenBottom = colHidden;
          if (!repeat && (groundOnScreen < heightOnScreenBottom)) {
            heightOnScreenBottom = groundOnScreen;
          }
          sampleN = sampleN + 1u;
          if (heightOnScreen < colHidden) {
            var plot = vec4f(1.0);
            var plotPacked = packRgba(plot);
            if (debugView != DEBUG_COLOR) {
              if (debugView == DEBUG_HEIGHT) {
                plotPacked = encodeHeight(hByte);
              } else if (debugView == DEBUG_DEPTH) {
                var t = 0.0;
                if (farClip > 0.0) {
                  t = z / farClip;
                }
                plotPacked = encodeUnit(t);
              } else {
                plotPacked = encodeIter(sampleN);
              }
            } else if (!fogWhite) {
              plot = classicSampleColor(plx, ply, mip, flagLod0Refine(flags) && useFine, z);
              if (applyFogT) {
                plot = fogRgb(plot, fogT);
              }
              plotPacked = packRgba(plot);
            }
            var ytop = heightOnScreen;
            if (ytop < 0) {
              ytop = 0;
            }
            if (ytop < heightOnScreenBottom) {
              var yy = ytop;
              loop {
                if (yy >= heightOnScreenBottom) {
                  break;
                }
                textureStore(
                  outTex,
                  vec2<i32>(x, yy),
                  vec4<u32>(plotPacked, 0u, 0u, 0u)
                );
                yy = yy + 1;
              }
            }
            hiddenY = heightOnScreen;
          }
        }
      }
      z = z + step;
      step = growBandStep(step, lo, cell);
    }
  }
}
