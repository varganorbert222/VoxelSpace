"use strict";

export const FEET_TO_METERS = 0.3048;

// Comanche mission files store terrain scale as a code. The original MIS
// converter maps those codes to a height range in feet.
export const TERRAIN_SCALE_FEET = {
  19: 192,
  20: 384,
  21: 768,
};

export function altitudeFromTerrainScale(scale) {
  const feet = TERRAIN_SCALE_FEET[Number(scale)];
  if (!feet) {
    return null;
  }
  return feet * FEET_TO_METERS;
}

export const MAP_COLLECTIONS = [
  { id: "comanche3", label: "Comanche 3", dir: "maps/comanche3" },
  { id: "deltaforce", label: "Delta Force", dir: "maps/deltaforce" },
  { id: "deltaforce2", label: "Delta Force 2", dir: "maps/deltaforce2" },
  { id: "armoredfist", label: "Armored Fist", dir: "maps/armoredfist" },
];

// JSON field on a mission file, and the folders that hold that file.
export const ASSET_ROLES = [
  { key: "color", field: "color_map", folders: ["color"] },
  { key: "elevation", field: "elev_map", folders: ["height"] },
  { key: "character", field: "detail_map", folders: ["character"] },
  { key: "detailColor", field: "detail_color", folders: ["detail/color"] },
  { key: "detailElevation", field: "detail_elev", folders: ["detail/height"] },
  { key: "detailShade", field: "detail_shade", folders: ["detail/shading"] },
  { key: "sky", field: "sky_map", folders: ["clouds"] },
  { key: "skyPalette", field: "sky_palette", folders: ["grads"] },
  { key: "water", field: "water_map", folders: ["water", "aqua"] },
  { key: "waterPalette", field: "water_palette", folders: ["aqua", "grads", "water"] },
];

export function foldersForRole(key) {
  const role = ASSET_ROLES.find((item) => item.key === key);
  return role ? role.folders : [];
}

// Detail images are atlases of 16×16 textures. Dividing each side by
// this size gives the index grid: index = y * cols + x.
// A mission whose name ends in N is the night variant. NovaLogic tints the
// whole view with this filter; 128 is neutral, so night green is 80, 160, 30.
export const NIGHT_FILTER = [80, 160, 30];

export function isNightMap(name) {
  return typeof name === "string" && /N$/i.test(name);
}

export const DETAIL_TILE = 16;

export function detailAtlasGrid(width, height) {
  const cols = Math.floor(Number(width) / DETAIL_TILE);
  const rows = Math.floor(Number(height) / DETAIL_TILE);
  if (cols < 1 || rows < 1) {
    return null;
  }
  return { cols, rows, count: cols * rows };
}
