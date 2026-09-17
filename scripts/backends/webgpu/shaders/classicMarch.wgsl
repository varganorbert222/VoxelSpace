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
  if (lerp && (mip <= 0) && (altitude > 0.0)) {
    hFine = sampled.x * (255.0 / altitude);
  }
  return vec2f(hFine, sampled.y);
}

fn classicSampleColor(plx: f32, ply: f32, mip: i32, doFilter: bool) -> vec4f {
  let dist = select(frame.sampleLimit.x + 1.0, 0.0, doFilter);
  return terrainSampleColor(colorTex, mip, plx, ply, dist);
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
      sky = skyRows[min(u32(y), u32(arrayLength(&skyRows) - 1u))];
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
    var n = 0u;
    var step = 0.0;
    var bandKey = -1;
    loop {
      if ((z >= endIndex) || (z >= farClip) || (n >= MAX_STEPS)) {
        break;
      }
      n = n + 1u;
      let synced = syncBandStep(step, bandKey, mip, z);
      step = synced.x;
      bandKey = i32(synced.y);
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
      if (colHidden != 0) {
        let inside = (plx >= 0.0) && (plx <= f32(mapW)) && (ply >= 0.0) && (ply <= f32(mapH));
        let isOk = inside || repeat;
        if (isOk && (ceilingOnScreen < colHidden)) {
          let useFine = mip == 0;
          let sp = terrainSamplePos(plx, ply, dirX, dirY, mip, z);
          let sampled = classicSampleHeight(sp.x, sp.y, mip, flagHeightLerp(flags) && useFine, z);
          let hByte = u32(sampled.y);
          let terrainHeight = sampled.x * altScale;
          let terrainSdf = camZ - terrainHeight;
          let heightOnScreen = projectSdfYSpan(
            terrainSdf,
            dst,
            z,
            mipSpanFarT(z, step, plx, ply, dirX, dirY, mip),
            screenHorizon
          );
          var heightOnScreenBottom = colHidden;
          if (!repeat && (groundOnScreen < heightOnScreenBottom)) {
            heightOnScreenBottom = groundOnScreen;
          }
          sampleN = sampleN + 1u;
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
            plot = classicSampleColor(sp.x, sp.y, mip, flagColorFilter(flags) && useFine);
            if (applyFogT) {
              plot = fogRgb(plot, fogT);
            }
            plotPacked = packRgba(plot);
          }
          if (heightOnScreen < colHidden) {
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
      let grown = growMarchStep(step, mip, z);
      z = z + step;
      step = grown;
    }
  }
}
