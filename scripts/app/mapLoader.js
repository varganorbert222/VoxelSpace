"use strict";

import maps from "../../data/maps.json" with { type: "json" };
import { loadImagesAsync } from "../assets/imageLoader.js";
import { Color } from "../math/color.js";

export function loadMap(app, mapName) {
  const selectedMap = maps.find((x) => x.name === mapName);
  if (!selectedMap) return;
  app.currentMapName = mapName;
  app.persistAndSync();

  loadImagesAsync([
    `maps/color/${selectedMap.colorMap}.png`,
    `maps/height/${selectedMap.heightMap}.png`,
  ]).then((images) => {
    app.terrain.loadData(selectedMap, {
      colorMap: images[0],
      heightMap: images[1],
    });
    app.renderer.invalidatePanorama();
    app.camera.set({
      topColor: app.terrain.skyColor,
      bottomColor: Color.WHITE,
    });
  });
}
