"use strict";

import time from "./time.js";
import config from "../../data/config.json" with { type: "json" };
import { cycleAvailableBackend } from "../backends/contract.js";

function cycleValue(values, current) {
  if (!values || values.length === 0) {
    return current;
  }
  const i = values.indexOf(current);
  const from = i < 0 ? 0 : i + 1;
  return values[from % values.length];
}

export function startGameLoop(app) {
  const algorithms = config.settings.renderAlgorithms.values;
  const run = () => {
    time.tick();
    const backendSwitch = app.input.consumeToggleRenderBackend
      ? cycleAvailableBackend(app.renderer.backend)
      : null;
    if (app.input.consumeToggleRenderAlgorithm) {
      app.setRenderAlgorithm(cycleValue(algorithms, app.renderer.algorithm));
    }
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
