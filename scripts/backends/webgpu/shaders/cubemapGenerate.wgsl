@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var heightTex: texture_2d<u32>;
@group(1) @binding(1) var colorTex: texture_2d<f32>;
@group(1) @binding(2) var<storage, read> mipSwitchArr: array<f32, 16>;
@group(2) @binding(0) var faceColor: texture_storage_2d<r32uint, write>;
@group(2) @binding(1) var faceDepth: texture_storage_2d<r32float, write>;
@group(2) @binding(2) var faceHeight: texture_storage_2d<r32uint, write>;
@group(2) @binding(3) var faceIter: texture_storage_2d<r32uint, write>;

const MAX_STEPS: u32 = 65536u;

fn sampleHeightPair(mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> vec2f {
  return terrainSampleHeightPair(heightTex, mip, wx, wy, dist, t);
}

fn sampleColor(mip: i32, wx: f32, wy: f32, dist: f32, t: f32) -> vec4f {
  return terrainSampleColor(colorTex, mip, wx, wy, dist, t);
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
  let tanHalfX = frame.camPosTanHalfX.w;
  let dst = frame.camRightDst.w;
  let screenHorizon = frame.camUpHorizon.w;
  let sinA = frame.sinCosNearFar.x;
  let cosA = frame.sinCosNearFar.y;
  let farClip = frame.sinCosNearFar.w;
  let maxHeight = frame.tMaxMinDzAltMaxH.w;
  let mapW = i32(frame.mapFlags.x);
  let mapH = i32(frame.mapFlags.y);
  let flags = frame.mapFlags.w;
  let repeat = flagRepeat(flags);
  let lodCount = i32(frame.extraU.y);
  let ceilingSdf = camZ - maxHeight;
  let yGround = camZ + 20.0;
  let pixelCenter = frame.mipInvPixelCenter.w;
  var zFar = frame.tMaxMinDzAltMaxH.x;
  if (!(zFar > 0.0)) {
    zFar = farClip * 3.0;
  }
  var t0 = frame.camFwdPad.w;
  let nearClip = frame.sinCosNearFar.z;
  if (t0 < nearClip) {
    t0 = nearClip;
  }

  var lodDistances: array<f32, 17>;
  lodDistances[0] = t0;
  {
    var i = 0;
    loop {
      if (i >= lodCount - 1) {
        break;
      }
      let s = mipSwitchArr[i];
      if (s < zFar) {
        if (s > t0) {
          lodDistances[i + 1] = s;
        } else {
          lodDistances[i + 1] = t0;
        }
      } else {
        lodDistances[i + 1] = zFar;
      }
      i = i + 1;
    }
    lodDistances[lodCount] = zFar;
    i = 1;
    loop {
      if (i >= lodCount) {
        break;
      }
      if (lodDistances[i] < lodDistances[i - 1]) {
        lodDistances[i] = lodDistances[i - 1];
      }
      if (lodDistances[i] > zFar) {
        lodDistances[i] = zFar;
      }
      i = i + 1;
    }
  }

  let screenWidthScaler = 1.0 / f32(n);
  let kRightX = cosA * tanHalfX;
  let kRightY = -sinA * tanHalfX;
  let kLeftX = -sinA - kRightX;
  let kLeftY = -cosA - kRightY;
  let kDx = (kRightX + kRightX) * screenWidthScaler;
  let kDy = (kRightY + kRightY) * screenWidthScaler;
  let colF = f32(col) + pixelCenter;
  let dirX = kLeftX + kDx * colF;
  let dirY = kLeftY + kDy * colF;
  let lenXY = length(vec2f(dirX, dirY));

  var lod = lodCount;
  loop {
    if (lod <= 0) {
      break;
    }
    let startIndex = lodDistances[lod - 1];
    let endIndex = lodDistances[lod];
    let mip = lod - 1;
    lod = lod - 1;
    if (startIndex >= zFar) {
      continue;
    }

    var hiddenY = n;
    var z = startIndex;
    var k = 0u;
    var step = 0.0;
    var bandKey = -1;
    loop {
      if ((z >= endIndex) || (z >= zFar) || (k >= MAX_STEPS)) {
        break;
      }
      k = k + 1u;
      let synced = syncBandStep(step, bandKey, mip, z);
      step = synced.x;
      bandKey = i32(synced.y);
      let zScale = dst / z;
      let ceilingOnScreen = i32(ceilingSdf * zScale + screenHorizon);
      let groundOnScreen = i32(yGround * zScale + screenHorizon);
      let dx = kDx * z;
      let dy = kDy * z;
      let plx = kLeftX * z + camX + dx * colF;
      let ply = kLeftY * z + camY + dy * colF;
      let colHidden = hiddenY;
      if (colHidden != 0) {
        let inside = (plx >= 0.0) && (plx <= f32(mapW)) && (ply >= 0.0) && (ply <= f32(mapH));
        let isOk = inside || repeat;
        if (isOk && (ceilingOnScreen < colHidden)) {
          let sampled = sampleHeightPair(mip, plx, ply, 0.0, z);
          let hByte = u32(sampled.y);
          let terrainHeight = sampled.x;
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
          if (heightOnScreen < colHidden) {
            var ytop = heightOnScreen;
            if (ytop < 0) {
              ytop = 0;
            }
            if (ytop < heightOnScreenBottom) {
              let color = sampleColor(mip, plx, ply, 0.0, z);
              let dh = terrainHeight - camZ;
              let dist = sqrt(z * z * lenXY * lenXY + dh * dh);
              var yy = ytop;
              loop {
                if (yy >= heightOnScreenBottom) {
                  break;
                }
                textureStore(faceColor, vec2<i32>(col, yy), vec4<u32>(packRgba(color), 0u, 0u, 0u));
                textureStore(faceDepth, vec2<i32>(col, yy), vec4<f32>(dist, 0.0, 0.0, 0.0));
                textureStore(faceHeight, vec2<i32>(col, yy), vec4<u32>(hByte, 0u, 0u, 0u));
                textureStore(faceIter, vec2<i32>(col, yy), vec4<u32>(k, 0u, 0u, 0u));
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
