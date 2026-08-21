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
    if (app.input.consumeToggleRenderAlgorithm) {
      app.setRenderAlgorithm(cycleValue(algorithms, app.renderer.algorithm));
    }
    if (app.input.consumeToggleRenderBackend) {
      const next = cycleAvailableBackend(app.renderer.backend);
      if (next !== app.renderer.backend) {
        app.setRenderBackend(next);
      }
    }
    app.camera.move(time.deltaTime, app.input, app.terrain);
    Promise.resolve(app.renderer.render(app.terrain)).then(() => {
      app.fpsCounter.addFrame();
      window.requestAnimationFrame(run);
    });
  };
  run();
}
