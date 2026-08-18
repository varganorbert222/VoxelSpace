"use strict";

import VMath from "./vmath.js";
import { PIXEL_CENTER, NDC_SCALE } from "./constants/panoramaViewer.js";
import { HALF, TWO_PI } from "./constants/vmath.js";

export function renderPanoramaView({
  panorama,
  panoramaWidth,
  panoramaHeight,
  fovY,
  frameBuffer,
  horizon,
  rightX,
  rightY,
  rightZ,
  upX,
  upY,
  upZ,
  fwdX,
  fwdY,
  fwdZ,
}) {
  const width = frameBuffer.width;
  const height = frameBuffer.height;
  const buffer = frameBuffer.buffer32bit;

  const aspect = width / height;
  const tanHalf = Math.tan(fovY * VMath.DEG_TO_RAD * HALF);

  const invWidth = 1 / width;
  const invHeight = 1 / height;
  const panoLast = (panoramaHeight - 1) | 0;

  for (let sy = 0; (sy < height) | 0; sy = (sy + 1) | 0) {
    const ndcY = 1 - (sy + PIXEL_CENTER) * invHeight * NDC_SCALE;
    const cyBase = ndcY * tanHalf;
    const row = (sy * width) | 0;

    for (let sx = 0; (sx < width) | 0; sx = (sx + 1) | 0) {
      const ndcX = (sx + PIXEL_CENTER) * invWidth * NDC_SCALE - 1;
      let cx = ndcX * aspect * tanHalf;
      let cy = cyBase;
      let cz = 1;
      const invLen = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz);
      cx *= invLen;
      cy *= invLen;
      cz *= invLen;

      const worldX = rightX * cx + upX * cy + fwdX * cz;
      const worldY = rightY * cx + upY * cy + fwdY * cz;
      const worldZ = rightZ * cx + upZ * cy + fwdZ * cz;

      const theta = Math.atan2(-worldX, -worldY);
      const phi = Math.asin(VMath.clamp(-1, 1, worldZ));
      let u = theta / TWO_PI;
      u = ((u % 1) + 1) % 1;
      const v = VMath.clamp(0, 1, HALF - phi / Math.PI);

      let px = (u * panoramaWidth) | 0;
      if ((px >= panoramaWidth) | 0) px = 0;
      let py = (v * panoramaHeight) | 0;
      if ((py > panoLast) | 0) py = panoLast;
      if ((py < horizon[px]) | 0) continue;

      buffer[row + sx] = panorama[(py * panoramaWidth + px) | 0];
    }
  }
}
