"use strict";

import {
  DEBUG_LEGEND_ID,
  DEBUG_VIEW_LEGEND,
  isDebugColor,
} from "../constants/debugView.js";

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

export function syncDebugLegend(debugView) {
  const panel = document.getElementById(DEBUG_LEGEND_ID);
  if (!panel) {
    return;
  }
  if (isDebugColor(debugView)) {
    panel.hidden = true;
    panel.removeAttribute("aria-label");
    return;
  }
  const spec = DEBUG_VIEW_LEGEND[debugView];
  if (!spec) {
    panel.hidden = true;
    panel.removeAttribute("aria-label");
    return;
  }
  panel.hidden = false;
  panel.setAttribute("aria-label", spec.title + " color key");
  setText("id_debug_legend_title", spec.title);
  setText("id_debug_legend_low", spec.low);
  setText("id_debug_legend_high", spec.high);
  setText("id_debug_legend_caption", spec.caption);
  setText("id_debug_legend_miss_label", spec.miss);
  const bar = document.getElementById("id_debug_legend_bar");
  if (bar) {
    bar.dataset.ramp = spec.ramp;
  }
}
