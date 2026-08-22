"use strict";

import { dismissHudTooltip, initTooltips } from "./tooltip.js";
import { isFormTarget } from "../constants/input.js";
import { RADAR_ELEMENT_ID, RADAR_SHOW_ID } from "../constants/radar.js";

function isTouchLayout() {
  return window.matchMedia("(pointer: coarse), (hover: none)").matches;
}

export function initHud(app) {
  const hudToggle = document.getElementById("id_hud_toggle");
  const menuToggle = document.getElementById("id_menu_toggle");
  const menuHandle = document.getElementById("id_menu_handle");
  const done = document.getElementById("id_hud_done");
  const backdrop = document.getElementById("id_hud_backdrop");
  const hint = document.getElementById("id_hud_hint");
  const radarEl = document.getElementById(RADAR_ELEMENT_ID);
  const radarShow = document.getElementById(RADAR_SHOW_ID);

  function persistUi() {
    if (app && app.persistAndSync) {
      app.persistAndSync();
    }
  }

  function setChromeOpen(open, persist) {
    document.body.classList.toggle("chrome-on", open);
    document.body.classList.toggle("chrome-off", !open);
    hudToggle.setAttribute("aria-expanded", String(open));
    hudToggle.textContent = open ? "Close" : "Toggle HUD";
    if (hint) {
      hint.textContent = open ? "H · Close HUD" : "H · Toggle HUD";
    }
    if (app) {
      app.hudChrome = !!open;
    }
    if (!open) {
      dismissHudTooltip();
      if (backdrop) {
        backdrop.hidden = true;
      }
    } else if (backdrop) {
      backdrop.hidden =
        !document.body.classList.contains("menu-open") || !isTouchLayout();
    }
    if (persist) {
      persistUi();
    }
  }

  function setMenuOpen(open) {
    document.body.classList.toggle("menu-open", open);
    document.body.classList.toggle("menu-closed", !open);
    if (menuToggle) {
      menuToggle.setAttribute("aria-expanded", String(open));
    }
    if (menuHandle) {
      menuHandle.setAttribute("aria-expanded", String(open));
    }
    if (backdrop) {
      backdrop.hidden =
        !open || !isTouchLayout() || document.body.classList.contains("chrome-off");
    }
    if (!open) {
      dismissHudTooltip();
    }
  }

  function setRadarOpen(open, persist) {
    document.body.classList.toggle("radar-open", open);
    document.body.classList.toggle("radar-closed", !open);
    if (app) {
      app.radarOpen = !!open;
    }
    if (app && app.radar) {
      app.radar.setVisible(open);
    }
    if (radarShow) {
      radarShow.hidden = !!open;
    }
    if (persist) {
      persistUi();
    }
  }

  function toggleMenu() {
    setMenuOpen(!document.body.classList.contains("menu-open"));
  }

  setChromeOpen(app && app.hudChrome !== undefined ? !!app.hudChrome : true);
  setMenuOpen(!isTouchLayout());
  setRadarOpen(app && app.radarOpen !== undefined ? !!app.radarOpen : true);

  hudToggle.addEventListener("click", () => {
    setChromeOpen(!document.body.classList.contains("chrome-on"), true);
  });

  if (menuToggle) {
    menuToggle.addEventListener("click", toggleMenu);
  }
  if (menuHandle) {
    menuHandle.addEventListener("click", toggleMenu);
  }

  if (done) {
    done.addEventListener("click", () => setMenuOpen(false));
  }

  if (backdrop) {
    backdrop.addEventListener("click", () => setMenuOpen(false));
  }

  if (radarEl) {
    radarEl.addEventListener("click", () => setRadarOpen(false, true));
  }
  if (radarShow) {
    radarShow.addEventListener("click", () => setRadarOpen(true, true));
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      setMenuOpen(false);
      return;
    }
    if (isFormTarget(e.target) && document.body.classList.contains("menu-open")) {
      return;
    }
    if (e.code === "KeyK" && !e.repeat) {
      setRadarOpen(!document.body.classList.contains("radar-open"), true);
      return;
    }
    if (e.code !== "KeyH" || e.repeat) {
      return;
    }
    setChromeOpen(!document.body.classList.contains("chrome-on"), true);
    if (!document.body.classList.contains("chrome-on") && document.activeElement) {
      document.activeElement.blur();
    }
  });

  initTooltips();
}
