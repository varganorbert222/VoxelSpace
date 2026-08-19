"use strict";

import { renderPanoramaColumns } from "./panoramamarch.js";

export function generateSphericalPanorama({
  terrain,
  camX,
  camY,
  camZ,
  width,
  height,
  farClip,
  nearClip,
  repeat,
  skyColor,
  initialStep,
  pixels,
  horizon,
  depth,
  tMax,
}) {
  const maps = terrain.exportMaps();
  return renderPanoramaColumns({
    heightMap: maps.heightMap,
    colorMap: maps.colorMap,
    mapW: maps.width,
    mapH: maps.height,
    mapShift: maps.mapShift,
    altitude: maps.altitude,
    camX,
    camY,
    camZ,
    width,
    height,
    startPx: 0,
    endPx: width,
    farClip,
    nearClip,
    repeat,
    skyColor,
    initialStep,
    pixels,
    horizon,
    depth,
    tMax,
  });
}
