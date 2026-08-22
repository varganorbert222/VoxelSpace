@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> pixelOffsets: array<u32, 8>;
@group(1) @binding(1) var<storage, read> lodDeltas: array<f32, 8>;
@group(1) @binding(2) var<storage, read> lodDistances: array<f32, 16>;
@group(2) @binding(0) var heightTex: texture_2d<u32>;
@group(2) @binding(1) var colorTex: texture_2d<f32>;
@group(3) @binding(0) var outTex: texture_storage_2d<r32uint, write>;
@group(3) @binding(1) var<storage, read> skyRows: array<u32>;

const MAX_STEPS: u32 = 16384u;

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
  let nearClip = frame.sinCosNearFar.z;
  let farClip = frame.sinCosNearFar.w;
  let minDeltaZ = frame.tMaxMinDzAltMaxH.y;
  let altitude = frame.tMaxMinDzAltMaxH.z;
  let maxHeight = frame.tMaxMinDzAltMaxH.w;
  let mapW = i32(frame.mapFlags.x);
  let mapH = i32(frame.mapFlags.y);
  let mapShift = frame.mapFlags.z;
  let flags = frame.mapFlags.w;
  let useFog = flagFog(flags);
  let repeat = flagRepeat(flags);
  let stepGrowth = frame.clipDhTanLastGrowth.w;
  let stepScale = frame.stepScaleCaps.x;
  let lodCount = i32(frame.extraU.y);
  let altScale = altitude / 255.0;
  let mapWMask = mapW - 1;
  let mapHMask = mapH - 1;
  let ceilingSdf = camZ - maxHeight;
  let yGround = camZ + 20.0;
  let fogRange = farClip - nearClip;
  var invFog = 0.0;
  if (fogRange != 0.0) {
    invFog = 1.0 / fogRange;
  }
  let screenWidthScaler = 1.0 / f32(screenW);
  let kRightX = cosA * tanHalfX;
  let kRightY = -sinA * tanHalfX;
  let kLeftX = -sinA - kRightX;
  let kLeftY = -cosA - kRightY;
  let kDx = (kRightX + kRightX) * screenWidthScaler;
  let kDy = (kRightY + kRightY) * screenWidthScaler;

  var sampleN = 0u;
  var lod = lodCount;
  loop {
    if (lod <= 0) {
      break;
    }
    let startIndex = lodDistances[lod - 1];
    let endIndex = lodDistances[lod];
    let pxOffset = i32(pixelOffsets[lod - 1]);
    var step = lodDeltas[lod - 1];
    lod = lod - 1;
    if (startIndex >= farClip) {
      continue;
    }
    if ((pxOffset > 1) && ((x % pxOffset) != 0)) {
      continue;
    }

    var hiddenY = screenH;
    var z = startIndex;
    var n = 0u;
    loop {
      if ((z >= endIndex) || (z >= farClip) || (n >= MAX_STEPS)) {
        break;
      }
      n = n + 1u;
      let zScale = dst / z;
      let ceilingOnScreen = i32(ceilingSdf * zScale + screenHorizon);
      let groundOnScreen = i32(yGround * zScale + screenHorizon);
      var fogTRaw = fogRange * 0.0;
      if (fogRange == 0.0) {
        fogTRaw = 1.0;
      } else {
        fogTRaw = (z - nearClip) * invFog;
      }
      var fogT = fogTRaw;
      if (fogT < 0.0) {
        fogT = 0.0;
      }
      if (fogT > 1.0) {
        fogT = 1.0;
      }
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
          let ix = i32(ply) & mapWMask;
          let jx = i32(plx) & mapHMask;
          let hByte = textureLoad(heightTex, vec2<i32>(jx, ix), 0).r;
          let terrainHeight = f32(hByte) * altScale;
          let terrainSdf = camZ - terrainHeight;
          let heightOnScreen = i32(terrainSdf * zScale + screenHorizon);
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
            plot = textureLoad(colorTex, vec2<i32>(jx, ix), 0);
            if (applyFogT) {
              plot = fogRgb(plot, fogT);
            }
            plotPacked = packRgba(plot);
          }
          if (heightOnScreen < colHidden) {
            var drawWidth = pxOffset;
            if (x + drawWidth > screenW) {
              drawWidth = screenW - x;
            }
            var ytop = heightOnScreen;
            if (ytop < 0) {
              ytop = 0;
            }
            if (ytop < heightOnScreenBottom) {
              var j = 0;
              loop {
                if ((j >= drawWidth) || (x + j >= screenW)) {
                  break;
                }
                var yy = ytop;
                loop {
                  if (yy >= heightOnScreenBottom) {
                    break;
                  }
                  textureStore(
                    outTex,
                    vec2<i32>(x + j, yy),
                    vec4<u32>(plotPacked, 0u, 0u, 0u)
                  );
                  yy = yy + 1;
                }
                j = j + 1;
              }
            }
            hiddenY = heightOnScreen;
          }
        }
      }
      step = step + stepGrowth;
      z = z + step;
    }
  }
}
