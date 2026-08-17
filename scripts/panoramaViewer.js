"use strict";

import VMath from "./vmath.js";

export function renderPanoramaView({
  panorama,
  panoramaWidth,
  panoramaHeight,
  yaw,
  pitch,
  fovY,
  frameBuffer,
}) {
  const width = frameBuffer.width;
  const height = frameBuffer.height;
  const buffer = frameBuffer.buffer32bit;

  const aspect = width / height;
  const tanHalf = Math.tan(fovY * VMath.DEG_TO_RAD * 0.5);

  const pitchRad = VMath.clamp(-89, 89, pitch) * VMath.DEG_TO_RAD;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  const invWidth = 1 / width;
  const invHeight = 1 / height;
  const twoPi = Math.PI * 2;
  const panoLast = (panoramaHeight - 1) | 0;

  for (let sy = 0; (sy < height) | 0; sy = (sy + 1) | 0) {
    const ndcY = 1 - (sy + 0.5) * invHeight * 2;
    const cyBase = ndcY * tanHalf;
    const row = (sy * width) | 0;

    for (let sx = 0; (sx < width) | 0; sx = (sx + 1) | 0) {
      const ndcX = (sx + 0.5) * invWidth * 2 - 1;
      let cx = ndcX * aspect * tanHalf;
      let cy = cyBase;
      let cz = 1;
      const invLen = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz);
      cx *= invLen;
      cy *= invLen;
      cz *= invLen;

      const py_ = cy * cosP + cz * sinP;
      const pz_ = -cy * sinP + cz * cosP;
      const px_ = cx;

      const worldX = px_ * cosY + pz_ * -sinY;
      const worldY = px_ * -sinY + pz_ * -cosY;
      const worldZ = py_;

      const theta = Math.atan2(-worldX, -worldY);
      const phi = Math.asin(VMath.clamp(-1, 1, worldZ));
      let u = theta / twoPi;
      u = ((u % 1) + 1) % 1;
      const v = VMath.clamp(0, 1, 0.5 - phi / Math.PI);

      let px = (u * panoramaWidth) | 0;
      if ((px >= panoramaWidth) | 0) px = 0;
      let py = (v * panoramaHeight) | 0;
      if ((py > panoLast) | 0) py = panoLast;

      buffer[row + sx] = panorama[(py * panoramaWidth + px) | 0];
    }
  }
}
