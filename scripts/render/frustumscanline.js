"use strict";

import { renderRetailColumns } from "./retail/scanline.js";

// Column ranges stay independent: each two-pixel pair owns its scan state.
export function renderFrustumScanlineColumns(params) {
  return renderRetailColumns(params);
}
