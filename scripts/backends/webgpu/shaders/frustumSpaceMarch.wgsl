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
const SLICE_SAMPLES: i32 = 64;
const COVER_WORDS: u32 = 64u;

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

fn frustumOccupiedT(
  cam: vec3f,
  right: vec3f,
  up: vec3f,
  fwd: vec3f,
  xView: f32,
  yTop: f32,
  yBot: f32,
  t: f32,
  z: f32,
  useFine: bool,
  flags: u32,
  repeat: bool,
  mapW: i32,
  mapH: i32,
  mapHMask: i32,
  mapWMask: i32,
  ceiling: f32,
  altScale: f32,
  slack: f32
) -> vec4f {
  let yView = yTop + t * (yBot - yTop);
  let p = cam + xView * right + yView * up + z * fwd;
  var occ = 0.0;
  var hByte = 0.0;
  if (((p.x >= 0.0) && (p.x <= f32(mapW)) && (p.y >= 0.0) && (p.y <= f32(mapH))) || repeat) {
    if ((p.z <= ceiling + slack) && (p.z >= CLIP_Z)) {
      let sampled = classicSampleHeight(p.x, p.y, flagHeightLerp(flags) && useFine, repeat, mapHMask, mapWMask);
      hByte = sampled.y;
      if (p.z <= sampled.x * altScale + slack) {
        occ = 1.0;
      }
    }
  }
  return vec4f(occ, hByte, p.x, p.y);
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
  let _po = pixelOffsets[0];

  var cover: array<u32, 64>;
  var ci = 0u;
  loop {
    if (ci >= COVER_WORDS) { break; }
    cover[ci] = 0u;
    ci = ci + 1u;
  }
  var painted = 0;
  var sampleN = 0u;
  var lod = 1;
  loop {
    if ((lod > lodCount) || (painted >= screenH)) { break; }
    let startIndex = lodDistances[lod - 1];
    let endIndex = lodDistances[lod];
    lod = lod + 1;
    if ((_po > 999u) || (startIndex >= farClip)) { continue; }
    var step = lodDeltas[lod - 2];
    var z = startIndex;
    var zGuard = 0u;
    loop {
      if ((z >= endIndex) || (z >= farClip) || (painted >= screenH) || (zGuard >= MAX_STEPS)) { break; }
      zGuard = zGuard + 1u;
      let fogT = fogAmount(z, fogStart, fogEnd);
      let fogWhite = useFog && (fogT >= 1.0);
      let applyFogT = useFog && (fogT > 0.0) && !fogWhite;
      let useFine = z <= filterDist;
      let xView = (f32(x) + 0.5) * (z * tanHalfX * 2.0 * screenWidthScaler) - z * tanHalfX;
      let yTop = (screenHorizon - 0.5) * z * invH2;
      let yBot = (screenHorizon - (f32(screenH) - 0.5)) * z * invH2;
      let slackCol = abs((yBot - yTop) * up.z);
      let slackCoarse = slackCol / f32(SLICE_SAMPLES);
      let slackRow = select(0.0, slackCol / f32(screenH), screenH != 0);
      var si = 0;
      loop {
        if ((si >= SLICE_SAMPLES) || (painted >= screenH)) { break; }
        let t0 = f32(si) / f32(SLICE_SAMPLES);
        let t1 = f32(si + 1) / f32(SLICE_SAMPLES);
        let tS = (t0 + t1) * 0.5;
        let probe = frustumOccupiedT(cam, right, up, fwd, xView, yTop, yBot, tS, z, useFine, flags, repeat, mapW, mapH, mapHMask, mapWMask, ceiling, altScale, slackCoarse);
        sampleN = sampleN + 1u;
        si = si + 1;
        if (probe.x == 0.0) { continue; }
        var y0 = i32(t0 * f32(screenH));
        var y1 = i32(t1 * f32(screenH));
        if (y0 < 0) { y0 = 0; }
        if (y1 > screenH) { y1 = screenH; }
        if (y1 <= y0) { y1 = y0 + 1; }
        var yy = y0;
        loop {
          if ((yy >= y1) || (yy >= screenH) || (painted >= screenH)) { break; }
          let bit = u32(yy) & 31u;
          let word = u32(yy) >> 5u;
          var already = false;
          if (word < COVER_WORDS) {
            already = (cover[word] & (1u << bit)) != 0u;
          }
          if (!already) {
            let tRow = (f32(yy) + 0.5) / f32(screenH);
            let hit = frustumOccupiedT(cam, right, up, fwd, xView, yTop, yBot, tRow, z, useFine, flags, repeat, mapW, mapH, mapHMask, mapWMask, ceiling, altScale, slackRow);
            sampleN = sampleN + 1u;
            if (hit.x != 0.0) {
              var plotPacked = packRgba(vec4f(1.0));
              let hByte = u32(hit.y);
              if (debugView != DEBUG_COLOR) {
                if (debugView == DEBUG_HEIGHT) { plotPacked = encodeHeight(hByte); }
                else if (debugView == DEBUG_DEPTH) {
                  var depthT = 0.0;
                  if (farClip > 0.0) { depthT = z / farClip; }
                  plotPacked = encodeUnit(depthT);
                } else { plotPacked = encodeIter(sampleN); }
              } else if (!fogWhite) {
                var plot = classicSampleColor(hit.z, hit.w, flagColorFilter(flags) && useFine, repeat, mapHMask, mapWMask);
                if (applyFogT) { plot = fogRgb(plot, fogT); }
                plotPacked = packRgba(plot);
              }
              textureStore(outTex, vec2<i32>(x, yy), vec4<u32>(plotPacked, 0u, 0u, 0u));
              if (word < COVER_WORDS) {
                cover[word] = cover[word] | (1u << bit);
              }
              painted = painted + 1;
            }
          }
          yy = yy + 1;
        }
      }
      z = z + step;
      step = step + stepGrowth;
    }
  }
}
