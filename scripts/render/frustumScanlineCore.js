"use strict";

import { RETAIL_PASS_NAMES } from "./retail/constants.js";
import { buildRetailPasses, retailFocal } from "./retail/frame.js";
import { renderRetailFrame } from "./retail/scanline.js";

export const FRUSTUM_SCANLINE_PASSES = RETAIL_PASS_NAMES;

export function buildFrustumScanlineDescriptors(scene) {
  const width = Math.max(1, Number(scene.output?.width || scene.output?.screenWidth || scene.camera?.screenWidth) || 1);
  const focal = retailFocal(width, scene.camera?.fovDegrees || scene.camera?.fov || 90);
  const quality = scene.render?.quality || 1;
  return buildRetailPasses(focal, quality, scene.render?.lodBias || 0);
}

export function renderFrustumScanlineFrame(scene, output, renderColumns) {
  if (!scene || !scene.terrain || !scene.camera || !scene.render) {
    throw new TypeError("FrustumScanline scene is incomplete");
  }
  if (!output || !output.pixels) {
    throw new TypeError("FrustumScanline output is incomplete");
  }
  const result = renderColumns({
    ...scene.terrain,
    ...scene.camera,
    ...scene.render,
    ...output,
    mapW: scene.terrain.mapW || scene.terrain.width,
    mapH: scene.terrain.mapH || scene.terrain.height,
  });
  return { ...output, descriptors: result ? result.descriptors : buildFrustumScanlineDescriptors(scene) };
}

export function renderFrustumScanlineCpu(scene, output) {
  return renderRetailFrame(scene, output);
}
