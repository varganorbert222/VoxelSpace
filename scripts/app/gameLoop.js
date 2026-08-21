"use strict";

import time from "./time.js";
import { ALGORITHM_CLASSIC, ALGORITHM_PANORAMA } from "../constants/algorithm.js";

export function startGameLoop(app) {
  const run = () => {
    time.tick();
    if (app.input.consumeToggleRenderAlgorithm) {
      const next =
        app.renderer.algorithm === ALGORITHM_CLASSIC
          ? ALGORITHM_PANORAMA
          : ALGORITHM_CLASSIC;
      app.setRenderAlgorithm(next);
    }
    app.camera.move(time.deltaTime, app.input, app.terrain);
    Promise.resolve(app.renderer.render(app.terrain)).then(() => {
      app.fpsCounter.addFrame();
      window.requestAnimationFrame(run);
    });
  };
  run();
}
