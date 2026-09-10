@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> pixelOffsets: array<u32, 8>;
@group(1) @binding(1) var<storage, read> lodDeltas: array<f32, 8>;
@group(1) @binding(2) var<storage, read> lodDistances: array<f32, 16>;
@group(2) @binding(0) var heightTex: texture_2d<u32>;
@group(2) @binding(1) var colorTex: texture_2d<f32>;
@group(3) @binding(0) var outTex: texture_storage_2d<r32uint, write>;
@group(3) @binding(1) var<storage, read> skyRows: array<u32>;

const MAX_STEPS: u32 = 16384u;
const CLIP_Z: f32 = -20.0;
const DRIFT_SPAN_TEXELS: f32 = 1.0;
const ROW_LIMIT: f32 = 1.0e9;

fn coverGet(cover: ptr<function, array<u32, 64>>, row: i32) -> bool {
  let word = u32(row) >> 5u;
  return ((*cover)[word] & (1u << (u32(row) & 31u))) != 0u;
}

fn coverSet(cover: ptr<function, array<u32, 64>>, row: i32) {
  let word = u32(row) >> 5u;
  (*cover)[word] = (*cover)[word] | (1u << (u32(row) & 31u));
}

fn classicHeightAt(texX: i32, texY: i32, wrap: bool, mapHMask: i32, mapWMask: i32) -> u32 {
  let x = wrapOrClamp(texX, mapHMask, wrap);
  let y = wrapOrClamp(texY, mapWMask, wrap);
  return textureLoad(heightTex, vec2<i32>(x, y), 0).r;
}

fn classicSampleHeight(plx: f32, ply: f32, lerp: bool, wrap: bool, mapHMask: i32, mapWMask: i32) -> vec2f {
  let jx = i32(plx) & mapHMask;
  let ix = i32(ply) & mapWMask;
  let base = f32(textureLoad(heightTex, vec2<i32>(jx, ix), 0).r);
  if (!lerp) {
    return vec2f(base, base);
  }
  let x0 = floor(plx);
  let y0 = floor(ply);
  let fx = plx - x0;
  let fy = ply - y0;
  let tx = i32(x0);
  let ty = i32(y0);
  let h00 = f32(classicHeightAt(tx, ty, wrap, mapHMask, mapWMask));
  let h10 = f32(classicHeightAt(tx + 1, ty, wrap, mapHMask, mapWMask));
  let h01 = f32(classicHeightAt(tx, ty + 1, wrap, mapHMask, mapWMask));
  let h11 = f32(classicHeightAt(tx + 1, ty + 1, wrap, mapHMask, mapWMask));
  let h = bilinearHeight(h00, h10, h01, h11, fx, fy);
  return vec2f(h, clamp(h + 0.5, 0.0, 255.0));
}

fn classicColorAt(texX: i32, texY: i32, wrap: bool, mapHMask: i32, mapWMask: i32) -> vec4f {
  let x = wrapOrClamp(texX, mapHMask, wrap);
  let y = wrapOrClamp(texY, mapWMask, wrap);
  return textureLoad(colorTex, vec2<i32>(x, y), 0);
}

fn classicSampleColor(plx: f32, ply: f32, doFilter: bool, wrap: bool, mapHMask: i32, mapWMask: i32) -> vec4f {
  let jx = i32(plx) & mapHMask;
  let ix = i32(ply) & mapWMask;
  if (!doFilter) {
    return textureLoad(colorTex, vec2<i32>(jx, ix), 0);
  }
  let x0 = floor(plx);
  let y0 = floor(ply);
  let fx = plx - x0;
  let fy = ply - y0;
  let tx = i32(x0);
  let ty = i32(y0);
  let c00 = classicColorAt(tx, ty, wrap, mapHMask, mapWMask);
  let c10 = classicColorAt(tx + 1, ty, wrap, mapHMask, mapWMask);
  let c01 = classicColorAt(tx, ty + 1, wrap, mapHMask, mapWMask);
  let c11 = classicColorAt(tx + 1, ty + 1, wrap, mapHMask, mapWMask);
  return bilinearColor(c00, c10, c01, c11, fx, fy);
}

fn frustumShade(
  px: f32,
  py: f32,
  hByte: u32,
  z: f32,
  farClip: f32,
  fogT: f32,
  fogWhite: bool,
  applyFogT: bool,
  useFine: bool,
  flags: u32,
  repeat: bool,
  mapHMask: i32,
  mapWMask: i32,
  debugView: u32,
  sampleN: u32
) -> u32 {
  if (debugView != DEBUG_COLOR) {
    if (debugView == DEBUG_HEIGHT) { return encodeHeight(hByte); }
    if (debugView == DEBUG_DEPTH) {
      var depthT = 0.0;
      if (farClip > 0.0) { depthT = z / farClip; }
      return encodeUnit(depthT);
    }
    return encodeIter(sampleN);
  }
  if (fogWhite) {
    return packRgba(vec4f(1.0));
  }
  var plot = classicSampleColor(px, py, flagColorFilter(flags) && useFine, repeat, mapHMask, mapWMask);
  if (applyFogT) { plot = fogRgb(plot, fogT); }
  return packRgba(plot);
}

// One thread per column: view-Z slices front-to-back with a persistent
// horizon. See scripts/render/frustumspacemarch.js for the derivation.
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

  let cam = frame.camPosTanHalfX.xyz;
  let tanHalfX = frame.camPosTanHalfX.w;
  let right = frame.camRightDst.xyz;
  let dst = frame.camRightDst.w;
  let up = frame.camUpHorizon.xyz;
  let fwd = frame.camFwdPad.xyz;
  let farClip = frame.sinCosNearFar.w;
  let altitude = frame.tMaxMinDzAltMaxH.z;
  let maxHeight = frame.tMaxMinDzAltMaxH.w;
  let mapW = i32(frame.mapFlags.x);
  let mapH = i32(frame.mapFlags.y);
  let flags = frame.mapFlags.w;
  let useFog = flagFog(flags);
  let repeat = flagRepeat(flags);
  let stepGrowth = frame.clipDhTanLastGrowth.w;
  let lodCount = i32(frame.extraU.y);
  let altScale = altitude / 255.0;
  let mapWMask = mapW - 1;
  let mapHMask = mapH - 1;
  let ceiling = maxHeight;
  let screenHorizon = f32(screenH) * 0.5;
  let invH2 = select(1.0 / dst, 0.0, dst == 0.0);
  let fogStart = frame.sampleLimit.y;
  let fogEnd = frame.sampleLimit.z;
  let screenWidthScaler = 1.0 / f32(screenW);
  let filterDist = frame.sampleLimit.x;
  let slopeCap = select(altitude, frame.sampleLimit.w, frame.sampleLimit.w > 0.0);
  let _po = pixelOffsets[0];

  let rowBase = screenHorizon - 0.5;
  let upXY = length(up.xy);
  let xn = (f32(x) + 0.5) * (2.0 * screenWidthScaler) - 1.0;
  let mapWf = f32(mapW);
  let mapHf = f32(mapH);

  var hiddenY = screenH;
  var freeN = screenH;
  var dirty = false;
  var cover: array<u32, 64>;
  var sampleN = 0u;
  var lod = 1;
  loop {
    if ((lod > lodCount) || (hiddenY <= 0) || (freeN <= 0)) { break; }
    let startIndex = lodDistances[lod - 1];
    let endIndex = lodDistances[lod];
    lod = lod + 1;
    if ((_po > 999u) || (startIndex >= farClip)) { continue; }
    var step = lodDeltas[lod - 2];
    var z = startIndex;
    var zGuard = 0u;
    loop {
      if ((z >= endIndex) || (z >= farClip) || (hiddenY <= 0) || (freeN <= 0) || (zGuard >= MAX_STEPS)) { break; }
      zGuard = zGuard + 1u;
      let fogT = fogAmount(z, fogStart, fogEnd);
      let fogWhite = useFog && (fogT >= 1.0);
      let applyFogT = useFog && (fogT > 0.0) && !fogWhite;
      let useFine = z <= filterDist;
      let doLerp = flagHeightLerp(flags) && useFine;
      let zTanX = z * tanHalfX;
      let zInvH2 = z * invH2;
      let rowStep = up * zInvH2;
      let driftPerRow = zInvH2 * upXY;
      let hasRowStep = rowStep.z != 0.0;
      let invRowStepZ = select(0.0, 1.0 / rowStep.z, hasRowStep);
      let riseMax = slopeCap * (abs(rowStep.x) + abs(rowStep.y));
      let closeRate = riseMax - rowStep.z;
      let canRise = closeRate > 0.0;
      let invCloseRate = select(0.0, 1.0 / closeRate, canRise);
      let driftCheb = max(abs(rowStep.x), abs(rowStep.y));
      var skipTexel = select(screenH, i32(floor(1.0 / driftCheb)), driftCheb > 0.0);
      if (skipTexel < 1) { skipTexel = 1; }
      let colBase = cam + (xn * zTanX) * right + z * fwd;

      var wTop = 0;
      var wBot = hiddenY;
      var skip = false;
      if (hasRowStep) {
        let rCeil = rowBase - (ceiling - colBase.z) * invRowStepZ;
        let rGround = rowBase - (CLIP_Z - colBase.z) * invRowStepZ;
        let lo = clamp(min(rCeil, rGround), -ROW_LIMIT, ROW_LIMIT);
        let hi = clamp(max(rCeil, rGround), -ROW_LIMIT, ROW_LIMIT);
        wTop = max(0, i32(ceil(lo)));
        wBot = min(wBot, i32(floor(hi)) + 1);
      } else if ((colBase.z < CLIP_Z) || (colBase.z > ceiling)) {
        skip = true;
      }
      if (skip || (wTop >= wBot)) {
        continue;
      }

      if (hasRowStep && (driftPerRow * f32(hiddenY - wTop) < DRIFT_SPAN_TEXELS)) {
        // Sub-texel drift across the span: one sample, closed-form hit row.
        let p = colBase + (rowBase - f32(hiddenY - 1)) * rowStep;
        let inside = ((p.x >= 0.0) && (p.x <= mapWf) && (p.y >= 0.0) && (p.y <= mapHf)) || repeat;
        if (inside) {
          let sampled = classicSampleHeight(p.x, p.y, doLerp, repeat, mapHMask, mapWMask);
          sampleN = sampleN + 1u;
          var rHit = i32(ceil(rowBase - (sampled.x * altScale - colBase.z) * invRowStepZ));
          if (rHit < hiddenY) {
            rHit = max(rHit, wTop);
            var bottom = hiddenY;
            if (!repeat) { bottom = min(bottom, wBot); }
            if (rHit < bottom) {
              let plot = frustumShade(p.x, p.y, u32(sampled.y), z, farClip, fogT, fogWhite, applyFogT, useFine, flags, repeat, mapHMask, mapWMask, debugView, sampleN);
              var painted = 0;
              var r = rHit;
              if (dirty) {
                loop {
                  if (r >= bottom) { break; }
                  if (!coverGet(&cover, r)) {
                    textureStore(outTex, vec2<i32>(x, r), vec4<u32>(plot, 0u, 0u, 0u));
                    coverSet(&cover, r);
                    painted = painted + 1;
                  }
                  r = r + 1;
                }
              } else {
                loop {
                  if (r >= bottom) { break; }
                  textureStore(outTex, vec2<i32>(x, r), vec4<u32>(plot, 0u, 0u, 0u));
                  r = r + 1;
                }
                painted = bottom - rHit;
              }
              freeN = freeN - painted;
              hiddenY = rHit;
            }
          }
        }
      } else {
        // Pitched column: walk up from the horizon. Occupied rows paint their
        // own XY; empty rows jump over the rows terrain cannot reach.
        let seed = min(wBot, hiddenY);
        var suffix = seed;
        var firstColor = 0u;
        var painted = 0;
        var r = wBot - 1;
        loop {
          if (r < wTop) { break; }
          if (coverGet(&cover, r)) {
            if ((r + 1) == suffix) { suffix = r; }
            r = r - 1;
            continue;
          }
          let p = colBase + (rowBase - f32(r)) * rowStep;
          let inside = ((p.x >= 0.0) && (p.x <= mapWf) && (p.y >= 0.0) && (p.y <= mapHf)) || repeat;
          if (!inside) { break; }
          let sampled = classicSampleHeight(p.x, p.y, doLerp, repeat, mapHMask, mapWMask);
          sampleN = sampleN + 1u;
          let gap = p.z - sampled.x * altScale;
          if (gap > 0.0) {
            var skipN = skipTexel;
            if (canRise) {
              let s2 = i32(ceil(gap * invCloseRate));
              if (s2 > skipN) { skipN = s2; }
            }
            if (skipN < 1) { skipN = 1; }
            r = r - skipN;
            continue;
          }
          let plot = frustumShade(p.x, p.y, u32(sampled.y), z, farClip, fogT, fogWhite, applyFogT, useFine, flags, repeat, mapHMask, mapWMask, debugView, sampleN);
          textureStore(outTex, vec2<i32>(x, r), vec4<u32>(plot, 0u, 0u, 0u));
          coverSet(&cover, r);
          if (painted == 0) { firstColor = plot; }
          painted = painted + 1;
          if ((r + 1) == suffix) {
            suffix = r;
          } else {
            dirty = true;
          }
          r = r - 1;
        }
        if (painted > 0) {
          freeN = freeN - painted;
        }
        if (suffix < seed) {
          if (repeat && (wBot < hiddenY)) {
            var f = wBot;
            loop {
              if (f >= hiddenY) { break; }
              if (!coverGet(&cover, f)) {
                textureStore(outTex, vec2<i32>(x, f), vec4<u32>(firstColor, 0u, 0u, 0u));
                coverSet(&cover, f);
                freeN = freeN - 1;
              }
              f = f + 1;
            }
          }
          hiddenY = suffix;
        }
      }
      if ((hiddenY <= 0) || (freeN <= 0)) {
        hiddenY = 0;
        freeN = 0;
      }

      continuing {
        z = z + step;
        step = step + stepGrowth;
      }
    }
  }
}
