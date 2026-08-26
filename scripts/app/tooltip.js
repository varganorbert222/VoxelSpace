"use strict";

const SHOW_DELAY_MS = 280;
const MARGIN = 8;
const TIP_ID = "id_hud_tip";

function canHover() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function titleFrom(host) {
  const named = host.getAttribute("data-tip-title");
  if (named) {
    return named;
  }
  const label = host.matches("label") ? host : host.querySelector("label");
  if (!label) {
    return "";
  }
  const clone = label.cloneNode(true);
  clone.querySelectorAll("input, .check-box, .tip-mark, .hud-sr").forEach((node) => {
    node.remove();
  });
  return clone.textContent.replace(/\s+/g, " ").trim();
}

function attachMark(host) {
  const mark = document.createElement("button");
  mark.type = "button";
  mark.className = "tip-mark";
  mark.textContent = "?";
  mark.setAttribute("aria-controls", TIP_ID);
  mark.setAttribute("aria-expanded", "false");
  const title = titleFrom(host) || "control";
  mark.setAttribute("aria-label", "About " + title);
  mark.tabIndex = -1;

  if (host.matches("label.check")) {
    const wrap = document.createElement("div");
    wrap.className = "check-wrap";
    host.parentNode.insertBefore(wrap, host);
    wrap.append(host, mark);
    return mark;
  }

  const head = host.querySelector(".control-head");
  if (head) {
    const value = head.querySelector(".control-value");
    if (value) {
      head.insertBefore(mark, value);
    } else {
      head.append(mark);
    }
    return mark;
  }

  host.append(mark);
  return mark;
}

function bindDescribedBy(host, text) {
  const control =
    host.matches("input, select, button")
      ? host
      : host.querySelector("input, select, button");
  if (!control || !control.id) {
    return;
  }
  const sr = document.createElement("span");
  sr.className = "hud-sr";
  sr.id = "tip-sr-" + control.id;
  sr.textContent = text;
  host.append(sr);
  const prev = control.getAttribute("aria-describedby");
  control.setAttribute("aria-describedby", prev ? prev + " " + sr.id : sr.id);
}

let hideHudTooltip = () => {};

export function dismissHudTooltip() {
  hideHudTooltip();
}

export function initTooltips(root = document) {
  const hosts = Array.from(root.querySelectorAll("[data-tip]"));
  if (!hosts.length) {
    return;
  }

  const tip = document.createElement("div");
  tip.id = TIP_ID;
  tip.className = "hud-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  tip.innerHTML =
    '<div class="hud-tip-title"></div><div class="hud-tip-body"></div>';
  document.body.append(tip);

  const titleEl = tip.querySelector(".hud-tip-title");
  const bodyEl = tip.querySelector(".hud-tip-body");

  let activeMark = null;
  let pinned = false;
  let showTimer = 0;

  function place(anchor) {
    tip.style.visibility = "hidden";
    tip.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;
    if (canHover()) {
      left = rect.left - tw - MARGIN;
      top = rect.top;
      if (left < MARGIN) {
        left = rect.right + MARGIN;
      }
    } else {
      left = rect.left + rect.width / 2 - tw / 2;
      top = rect.top - th - MARGIN;
      if (top < MARGIN) {
        top = rect.bottom + MARGIN;
      }
    }
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - tw - MARGIN));
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - th - MARGIN));
    tip.style.left = left + "px";
    tip.style.top = top + "px";
    tip.style.visibility = "";
  }

  function hide() {
    if (showTimer) {
      window.clearTimeout(showTimer);
      showTimer = 0;
    }
    if (activeMark) {
      activeMark.setAttribute("aria-expanded", "false");
    }
    activeMark = null;
    pinned = false;
    tip.hidden = true;
  }

  hideHudTooltip = hide;

  function show(mark, host, pin) {
    if (showTimer) {
      window.clearTimeout(showTimer);
      showTimer = 0;
    }
    if (activeMark && activeMark !== mark) {
      activeMark.setAttribute("aria-expanded", "false");
    }
    titleEl.textContent = titleFrom(host);
    bodyEl.textContent = host.getAttribute("data-tip") || "";
    activeMark = mark;
    pinned = !!pin;
    mark.setAttribute("aria-expanded", "true");
    place(mark);
  }

  function scheduleShow(mark, host) {
    if (pinned) {
      return;
    }
    if (showTimer) {
      window.clearTimeout(showTimer);
    }
    showTimer = window.setTimeout(() => {
      showTimer = 0;
      show(mark, host, false);
    }, SHOW_DELAY_MS);
  }

  hosts.forEach((host) => {
    const text = (host.getAttribute("data-tip") || "").trim();
    if (!text) {
      return;
    }
    const mark = attachMark(host);
    bindDescribedBy(host, text);
    const hoverRoot = host.closest(".check-wrap") || host.querySelector(".control-head") || mark;

    mark.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pinned && activeMark === mark) {
        hide();
        return;
      }
      show(mark, host, true);
    });

    hoverRoot.addEventListener("mouseenter", () => {
      if (canHover()) {
        scheduleShow(mark, host);
      }
    });
    hoverRoot.addEventListener("mouseleave", () => {
      if (canHover() && !pinned) {
        hide();
      }
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".tip-mark") || e.target.closest(".hud-tip")) {
      return;
    }
    hide();
  });

  window.addEventListener("resize", hide);
  const panel = document.getElementById("id_info");
  const panelScroll = panel && panel.querySelector(".hud-panel-scroll");
  if (panelScroll) {
    panelScroll.addEventListener("scroll", hide, { passive: true });
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && activeMark) {
      hide();
    }
  });
}
