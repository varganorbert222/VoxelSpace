"use strict";

function snapToStep(value, min, step) {
  if (!(step > 0)) {
    return value;
  }
  return min + Math.round((value - min) / step) * step;
}

function clamp(min, max, value) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function initDualRangeElement(id, rangeConfig, start, end, onInput, onChange) {
  const root = document.getElementById(id);
  const fill = root.querySelector(".range-dual-fill");
  const thumbStart = root.querySelector('[data-thumb="start"]');
  const thumbEnd = root.querySelector('[data-thumb="end"]');
  const min = Number(rangeConfig.min);
  const step = Number(rangeConfig.step);
  let max = Number(rangeConfig.max);
  let startVal = Number.isFinite(Number(start)) ? Number(start) : min;
  let endVal = Number.isFinite(Number(end)) ? Number(end) : max;
  let dragThumb = null;

  function gap() {
    return step > 0 ? step : 0;
  }

  function applyClamp() {
    const g = gap();
    endVal = snapToStep(endVal, min, step);
    startVal = snapToStep(startVal, min, step);
    endVal = clamp(min + g, max, endVal);
    startVal = clamp(min, endVal - g, startVal);
    if (startVal < min) {
      startVal = min;
    }
  }

  function layout() {
    const span = max - min;
    const startPct = span === 0 ? 0 : ((startVal - min) / span) * 100;
    const endPct = span === 0 ? 100 : ((endVal - min) / span) * 100;
    fill.style.left = startPct + "%";
    fill.style.width = Math.max(0, endPct - startPct) + "%";
    thumbStart.style.left = startPct + "%";
    thumbEnd.style.left = endPct + "%";
    thumbStart.setAttribute("aria-valuemin", String(min));
    thumbStart.setAttribute("aria-valuemax", String(endVal));
    thumbStart.setAttribute("aria-valuenow", String(startVal));
    thumbEnd.setAttribute("aria-valuemin", String(startVal));
    thumbEnd.setAttribute("aria-valuemax", String(max));
    thumbEnd.setAttribute("aria-valuenow", String(endVal));
  }

  function emitInput() {
    if (onInput) {
      onInput({ start: startVal, end: endVal });
    }
  }

  function emitChange() {
    if (onChange) {
      onChange({ start: startVal, end: endVal });
    }
  }

  function valueFromClientX(clientX) {
    const rect = root.getBoundingClientRect();
    const width = rect.width || 1;
    const t = (clientX - rect.left) / width;
    return snapToStep(min + t * (max - min), min, step);
  }

  function setThumbValue(which, raw) {
    const g = gap();
    if (which === "start") {
      startVal = clamp(min, endVal - g, raw);
    } else {
      endVal = clamp(startVal + g, max, raw);
    }
    applyClamp();
    layout();
    emitInput();
  }

  function nearestThumb(clientX) {
    const v = valueFromClientX(clientX);
    const dStart = Math.abs(v - startVal);
    const dEnd = Math.abs(v - endVal);
    if (dStart === dEnd) {
      return v < (startVal + endVal) * 0.5 ? "start" : "end";
    }
    return dStart < dEnd ? "start" : "end";
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    const fromThumb = e.target && e.target.getAttribute
      ? e.target.getAttribute("data-thumb")
      : null;
    const which = fromThumb || nearestThumb(e.clientX);
    dragThumb = which;
    root.setPointerCapture(e.pointerId);
    setThumbValue(which, valueFromClientX(e.clientX));
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragThumb) {
      return;
    }
    setThumbValue(dragThumb, valueFromClientX(e.clientX));
  }

  function onPointerUp(e) {
    if (!dragThumb) {
      return;
    }
    dragThumb = null;
    if (root.hasPointerCapture && root.hasPointerCapture(e.pointerId)) {
      root.releasePointerCapture(e.pointerId);
    }
    emitChange();
  }

  function nudge(which, dir, large) {
    const delta = (large ? step * 10 : step) * dir;
    const current = which === "start" ? startVal : endVal;
    setThumbValue(which, current + delta);
    emitChange();
  }

  function onThumbKey(which, e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      nudge(which, -1, e.shiftKey);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      nudge(which, 1, e.shiftKey);
      e.preventDefault();
    } else if (e.key === "Home") {
      setThumbValue(which, which === "start" ? min : startVal + gap());
      emitChange();
      e.preventDefault();
    } else if (e.key === "End") {
      setThumbValue(which, which === "end" ? max : endVal - gap());
      emitChange();
      e.preventDefault();
    } else if (e.key === "PageDown") {
      nudge(which, -1, true);
      e.preventDefault();
    } else if (e.key === "PageUp") {
      nudge(which, 1, true);
      e.preventDefault();
    }
  }

  applyClamp();
  layout();

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  thumbStart.addEventListener("keydown", (e) => onThumbKey("start", e));
  thumbEnd.addEventListener("keydown", (e) => onThumbKey("end", e));
  thumbStart.setAttribute("role", "slider");
  thumbEnd.setAttribute("role", "slider");

  return {
    get start() {
      return startVal;
    },
    get end() {
      return endVal;
    },
    setValues(nextStart, nextEnd) {
      startVal = Number.isFinite(Number(nextStart)) ? Number(nextStart) : min;
      endVal = Number.isFinite(Number(nextEnd)) ? Number(nextEnd) : max;
      applyClamp();
      layout();
    },
    setMax(nextMax) {
      max = Number(nextMax);
      applyClamp();
      layout();
    },
  };
}
