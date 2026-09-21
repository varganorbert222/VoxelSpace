"use strict";

import time from "./time.js";
import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import { cycleAvailableBackend } from "../backends/contract.js";
import { usesWorkers } from "../constants/backend.js";
import { algorithmsForBackend } from "../constants/algorithm.js";
import { envOverlayAllowed } from "../constants/debugView.js";
import VMath from "../math/vmath.js";

function cycleValue(values, current) {
  if (!values || values.length === 0) {
    return current;
  }
  const i = values.indexOf(current);
  const from = i < 0 ? 0 : i + 1;
  return values[from % values.length];
}

function nudgeRange(current, dir, range) {
  if (!dir) {
    return current;
  }
  return VMath.clamp(range.min, range.max, current + dir * range.step);
}

function applySettingsHotkeys(app) {
  const backendSwitch = app.input.consumeToggleRenderBackend
    ? cycleAvailableBackend(app.renderer.backend)
    : null;
  if (app.input.consumeToggleRenderAlgorithm) {
    app.setRenderAlgorithm(
      cycleValue(
        algorithmsForBackend(
          config.settings.renderAlgorithms.values,
          app.renderer.backend
        ),
        app.renderer.algorithm
      )
    );
  }
  if (app.input.consumeToggleDebugView) {
    app.renderer.setOptions({
      debugView: cycleValue(
        config.settings.debugViews.values,
        app.renderer.debugView
      ),
    });
    app.persistAndSync();
  }
  if (app.input.consumeToggleDebugOverlay) {
    if (envOverlayAllowed(app.renderer.algorithm)) {
      app.renderer.setOptions({
        debugOverlay: !app.renderer.debugOverlay,
      });
      app.persistAndSync();
    }
  }
  if (app.input.consumeToggleFog) {
    app.renderer.setOptions({ applyFog: !app.renderer.applyFog });
    app.persistAndSync();
  }
  if (app.input.consumeToggleRepeat) {
    app.renderer.setOptions({ repeat: !app.renderer.repeat });
    app.persistAndSync();
  }
  if (app.input.consumeToggleThreads) {
    if (usesWorkers(app.renderer.backend)) {
      app.renderer.setOptions({
        multithread: !app.renderer.getOptions().multithread,
      });
      app.persistAndSync();
    }
  }
  if (app.input.consumeCycleMap) {
    const mapNames = maps.map((m) => m.name);
    app.loadMap(cycleValue(mapNames, app.currentMapName));
  }
  if (app.input.consumeCycleCamera) {
    app.setCameraMode(
      cycleValue(config.settings.cameraModes.values, app.camera.mode)
    );
  }
  const quality = app.input.consumeSetQuality;
  if (quality) {
    app.setQuality(quality);
  }
  const nudgeDistance = app.input.consumeNudgeDistance;
  if (nudgeDistance) {
    const prevFar = app.camera.farClip;
    const nextFar = nudgeRange(
      prevFar,
      nudgeDistance,
      config.settings.renderDistance
    );
    app.camera.set({ farClip: nextFar });
    app.renderer.syncFogToFarClip(prevFar, nextFar);
    app.renderer.clampLodSpacingToFarClip();
    app.persistAndSync();
  }
  const nudgeStep = app.input.consumeNudgeStepDivisor;
  if (nudgeStep) {
    app.renderer.setOptions({
      stepDivisor: nudgeRange(
        app.renderer.stepDivisor,
        nudgeStep,
        config.settings.stepDivisor
      ),
    });
    app.persistAndSync();
  }
  const nudgeFov = app.input.consumeNudgeFov;
  if (nudgeFov) {
    app.camera.set({
      fov: nudgeRange(app.camera.fov, nudgeFov, config.settings.fov),
    });
    app.persistAndSync();
  }
  return backendSwitch;
}

export function startGameLoop(app) {
  const run = () => {
    time.tick();
    const backendSwitch = applySettingsHotkeys(app);
    const switchPromise =
      backendSwitch && backendSwitch !== app.renderer.backend
        ? app.setRenderBackend(backendSwitch)
        : Promise.resolve();
    app.camera.move(time.deltaTime, app.input, app.terrain);
    if (app.radar) {
      app.radar.sync(app);
    }
    switchPromise
      .then(() => app.renderer.render(app.terrain))
      .then(() => {
        app.fpsCounter.addFrame();
      })
      .catch((err) => {
        console.error("render", err);
        if (app._setSystemStatus) {
          app._setSystemStatus(
            "Render error",
            err && err.message ? err.message : String(err),
            true
          );
        }
      })
      .then(() => {
        window.requestAnimationFrame(run);
      });
  };
  run();
}
