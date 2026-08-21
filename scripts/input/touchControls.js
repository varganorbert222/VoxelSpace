"use strict";

import {
  STICK_FORWARD_SCALE,
  STICK_KNOB_TRAVEL_PX,
  TOUCH_UPDOWN_SPEED,
} from "../constants/input.js";
import { HALF } from "../constants/vmath.js";

export function bindTouchControls(input, elements) {
  bindStick(
    elements.moveStick,
    (dx, dy) => {
      input._stickStrafe = dx * STICK_FORWARD_SCALE;
      input._stickForward = -dy * STICK_FORWARD_SCALE;
    },
    () => {
      input._stickStrafe = 0;
      input._stickForward = 0;
    }
  );
  bindStick(
    elements.lookStick,
    (dx, dy) => {
      input._stickLookX = dx;
      input._stickLookY = dy;
    },
    () => {
      input._stickLookX = 0;
      input._stickLookY = 0;
    }
  );
  bindHoldButton(elements.btnUp, (down) => {
    if (down) input._updown = TOUCH_UPDOWN_SPEED;
    else if (input._updown > 0) input._updown = 0;
  });
  bindHoldButton(elements.btnDown, (down) => {
    if (down) input._updown = -TOUCH_UPDOWN_SPEED;
    else if (input._updown < 0) input._updown = 0;
  });
  bindHoldButton(elements.btnRollLeft, (down) => {
    if (down) input._rollHold = -1;
    else if (input._rollHold < 0) input._rollHold = 0;
  });
  bindHoldButton(elements.btnRollRight, (down) => {
    if (down) input._rollHold = 1;
    else if (input._rollHold > 0) input._rollHold = 0;
  });
}

function bindStick(el, onMove, onEnd) {
  if (!el) return;
  const knob = el.querySelector(".stick-knob");
  let activeId = null;

  const read = (e) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * HALF;
    const cy = rect.top + rect.height * HALF;
    let dx = (e.clientX - cx) / (rect.width * HALF);
    let dy = (e.clientY - cy) / (rect.height * HALF);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    if (knob) {
      knob.style.transform =
        "translate(" +
        dx * STICK_KNOB_TRAVEL_PX +
        "px," +
        dy * STICK_KNOB_TRAVEL_PX +
        "px)";
    }
    onMove(dx, dy);
  };

  const up = (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (knob) knob.style.transform = "translate(0,0)";
    onEnd();
  };

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    activeId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    read(e);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    read(e);
  });
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

function bindHoldButton(el, onHold) {
  if (!el) return;
  const down = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onHold(true);
  };
  const up = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onHold(false);
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", up);
}
