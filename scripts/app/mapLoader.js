"use strict";

import { assetSrc, getMap, resolveMapId } from "./mapCatalog.js";
import { loadImagesAsync } from "../assets/imageLoader.js";
import { readColorFromImage } from "../assets/image.js";
import { isNightMap, NIGHT_FILTER } from "../constants/mapLayout.js";
import { Color } from "../math/color.js";
import { buildCloudMips, buildSkyTable, retailCloudHeight } from "../render/retail/skybox.js";
import { buildWaterMips, buildWaterTable } from "../render/retail/water.js";
import { retailBands } from "../render/retail/schedule.js";
import { prepareRetailDetail } from "../render/retail/detail.js";

const BYTE_HEIGHT_SCALE = 0.25;

function indexedPlane(image) {
  if (!image || !image.indices) {
    return null;
  }
  return {
    data: image.indices,
    width: image.width,
    height: image.height,
    palette: image.palette || null,
  };
}

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
  const characterSrc = assetSrc(selectedMap, "character");
  const detailColorSrc = assetSrc(selectedMap, "detailColor");
  const detailElevationSrc = assetSrc(selectedMap, "detailElevation");
  const detailShadeSrc = assetSrc(selectedMap, "detailShade");
  const cloudSrc = assetSrc(selectedMap, "sky");
  const skySrc = assetSrc(selectedMap, "skyPalette");
  const render = (selectedMap && selectedMap.render) || {};
  const waterHeight = Number(render.waterHeight) || 0;
  const waterSrc = waterHeight ? assetSrc(selectedMap, "water") : null;
  const waterPaletteSrc = waterHeight ? assetSrc(selectedMap, "waterPalette") : null;
  const required = [
    colorSrc,
    heightSrc,
    characterSrc,
    detailColorSrc,
    detailElevationSrc,
    detailShadeSrc,
    cloudSrc,
    skySrc,
  ];
  if (waterHeight) {
    required.push(waterSrc, waterPaletteSrc);
  }
  if (!selectedMap || !selectedMap.playable || required.some((src) => !src)) {
    console.error("Map is missing a required retail texture", selectedMap && selectedMap.id);
    return;
  }
  app.currentMapName = selectedMap.id;
  app.persistAndSync();

  const urls = [
    colorSrc,
    heightSrc,
    characterSrc,
    detailColorSrc,
    detailElevationSrc,
    detailShadeSrc,
    cloudSrc,
    skySrc,
  ];
  if (waterHeight) {
    urls.push(waterSrc, waterPaletteSrc);
  }
  loadImagesAsync(urls).then((images) => {
    if (images.some((image) => !image)) {
      console.error("Failed to load a required retail texture", selectedMap.id);
      return;
    }
    const skyPalette = images[7];
    const sky = paletteSky(skyPalette);
    const skyColor = sky ? sky.top : Color.WHITE;
    const horizonColor = sky && sky.bottom !== sky.top ? sky.bottom : Color.WHITE;
    const altitude = Number.isFinite(selectedMap.altitude)
      ? selectedMap.altitude
      : 255 * BYTE_HEIGHT_SCALE;
    app.terrain.loadData(
      { altitude, skyColor, horizonColor },
      { colorMap: images[0], heightMap: images[1] }
    );
    const exported = app.terrain.exportMaps();
    const builtSky = buildSkyTable(skyPalette, render.saturation, render.gamma);
    exported.retail = {
      character: indexedPlane(images[2]),
      detailColor: indexedPlane(images[3]),
      detailElevation: indexedPlane(images[4]),
      detailShade: indexedPlane(images[5]),
      lightRGB: builtSky.lightRGB,
      sky: {
        table: builtSky.table,
        cloudMips: buildCloudMips(images[6]),
        height: retailCloudHeight(render.skyHeight, altitude),
        horizon: Number.isFinite(render.horizon) ? render.horizon : 1,
        horizonRGB: builtSky.horizonRGB,
        lightRGB: builtSky.lightRGB,
        cloudColor: builtSky.cloudColor,
      },
      water: waterHeight
        ? {
            height: waterHeight,
            opacity: Number.isFinite(render.waterOpacity) ? render.waterOpacity : 0,
            table: buildWaterTable(images[9]),
            mips: buildWaterMips(images[8]),
          }
        : null,
      nearEnd: retailBands()[4].end,
    };
    prepareRetailDetail(exported.retail);
    const built = exported.terrainMips ? exported.terrainMips.count : 1;
    app.renderer.clampMipCountToMap(app.terrain.width, app.terrain.height, built);
    app.renderer.setMaps(exported);
    if (app.radar) {
      app.radar.invalidate();
    }
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
