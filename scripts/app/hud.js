"use strict";

import { dismissHudTooltip, initTooltips } from "./tooltip.js";
import { isFormTarget } from "../constants/input.js";

function isTouchLayout() {
  return window.matchMedia("(pointer: coarse), (hover: none)").matches;
}

export function initHud() {
  const toggle = document.getElementById("id_hud_toggle");
  const done = document.getElementById("id_hud_done");
  const backdrop = document.getElementById("id_hud_backdrop");
  const hint = document.getElementById("id_hud_hint");

  function setHudOpen(open) {
    document.body.classList.toggle("hud-open", open);
    document.body.classList.toggle("hud-closed", !open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Close" : "Menu";
    if (backdrop) {
      backdrop.hidden = !open || !isTouchLayout();
    }
    if (hint) {
      hint.textContent = isTouchLayout()
        ? "Menu · Settings"
        : open
          ? "H · Close HUD"
          : "H · Toggle HUD";
    }
    if (!open) {
      dismissHudTooltip();
    }
  }

  setHudOpen(!isTouchLayout());

  toggle.addEventListener("click", () => {
    setHudOpen(!document.body.classList.contains("hud-open"));
  });

  if (done) {
    done.addEventListener("click", () => setHudOpen(false));
  }

  if (backdrop) {
    backdrop.addEventListener("click", () => setHudOpen(false));
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      setHudOpen(false);
      return;
    }
    if (e.code !== "KeyH" || e.repeat) {
      return;
    }
    if (isFormTarget(e.target) && document.body.classList.contains("hud-open")) {
      return;
    }
    setHudOpen(!document.body.classList.contains("hud-open"));
    if (!document.body.classList.contains("hud-open") && document.activeElement) {
      document.activeElement.blur();
    }
  });

  initTooltips();
}
