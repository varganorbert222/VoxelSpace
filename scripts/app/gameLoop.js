"use strict";

import time from "./time.js";
import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import { cycleAvailableBackend } from "../backends/contract.js";
import { usesWorkers } from "../constants/backend.js";
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
      cycleValue(config.settings.renderAlgorithms.values, app.renderer.algorithm)
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
      app.renderer.setOptions({ multithread: !app.renderer.multithread });
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
    app.camera.set({
      farClip: nudgeRange(
        app.camera.farClip,
        nudgeDistance,
        config.settings.renderDistance
      ),
    });
    app.persistAndSync();
  }
  const nudgeDeltaZ = app.input.consumeNudgeDeltaZ;
  if (nudgeDeltaZ) {
    app.camera.set({
      minDeltaZ: nudgeRange(
        app.camera.minDeltaZ,
        nudgeDeltaZ,
        config.settings.deltaZ
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
    switchPromise
      .then(() => app.renderer.render(app.terrain))
      .then(() => {
        app.fpsCounter.addFrame();
      })
      .catch((err) => {
        console.error("render", err);
      })
      .then(() => {
        window.requestAnimationFrame(run);
      });
  };
  run();
}
