"use strict";

import { assetSrc, getMap, resolveMapId } from "./mapCatalog.js";
import { loadImagesAsync } from "../assets/imageLoader.js";
import { readColorFromImage } from "../assets/image.js";
import { altitudeFromTerrainScale, isNightMap, NIGHT_FILTER } from "../constants/mapLayout.js";
import { Color } from "../math/color.js";

const DEFAULT_ALTITUDE = altitudeFromTerrainScale(20);
const DEFAULT_SKY = "#A8DAF9";

function paletteSky(image) {
  const count = image.width * image.height;
  if (!count) {
    return null;
  }
  return {
    top: readColorFromImage(image.data, 0),
    bottom: readColorFromImage(image.data, count - 1),
  };
}

export function loadMap(app, mapName) {
  const selectedMap = getMap(resolveMapId(mapName) || mapName);
  const colorSrc = assetSrc(selectedMap, "color");
  const heightSrc = assetSrc(selectedMap, "elevation");
  const skySrc = assetSrc(selectedMap, "skyPalette");
  if (!selectedMap || !selectedMap.playable || !colorSrc || !heightSrc) {
    return;
  }
  app.currentMapName = selectedMap.id;
  app.persistAndSync();

  const urls = [colorSrc, heightSrc];
  if (skySrc) {
    urls.push(skySrc);
  }
  loadImagesAsync(urls).then((images) => {
    if (!images[0] || !images[1]) {
      return;
    }
    const sky = images[2] ? paletteSky(images[2]) : null;
    const skyColor = sky ? sky.top : selectedMap.skyColor || DEFAULT_SKY;
    const horizonColor =
      sky && sky.bottom !== sky.top ? sky.bottom : Color.WHITE;
    app.terrain.loadData(
      {
        altitude: Number.isFinite(selectedMap.altitude)
          ? selectedMap.altitude
          : DEFAULT_ALTITUDE,
        skyColor,
        horizonColor,
      },
      {
        colorMap: images[0],
        heightMap: images[1],
      }
    );
    const exported = app.terrain.exportMaps();
    const built = exported.terrainMips ? exported.terrainMips.count : 1;
    app.renderer.clampMipCountToMap(app.terrain.width, app.terrain.height, built);
    app.renderer.setMaps(exported);
    if (app.radar) {
      app.radar.invalidate();
    }
    app.renderer.invalidatePanorama();
    app.camera.set({
      topColor: app.terrain.skyColor,
      bottomColor: app.terrain.horizonColor,
    });
    if (app.currentMapName === selectedMap.id) {
      presentNight(selectedMap);
    }
    app.persistAndSync();
  });
}

function presentNight(map) {
  const viewport = document.getElementById("id_viewport");
  const matrix = document.getElementById("id_night_matrix");
  const night = isNightMap(map.name);
  if (viewport) {
    viewport.classList.toggle("is-night", night);
  }
  if (!night || !matrix) {
    return;
  }
  const rgb = Array.isArray(map.filter) ? map.filter : NIGHT_FILTER;
  const scale = rgb.map((channel) => Number(channel) / 128);
  matrix.setAttribute(
    "values",
    scale[0] +
      " 0 0 0 0  0 " +
      scale[1] +
      " 0 0 0  0 0 " +
      scale[2] +
      " 0 0  0 0 0 1 0"
  );
}
