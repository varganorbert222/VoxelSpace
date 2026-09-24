"use strict";

import catalog from "../../maps/catalog.json" with { type: "json" };

export const collections = catalog.collections;
export const maps = catalog.maps;

const byId = new Map(maps.map((map) => [map.id, map]));
const nameCounts = new Map();
for (const map of maps) {
  nameCounts.set(map.name, (nameCounts.get(map.name) || 0) + 1);
}

const SHORT_LABEL = {
  comanche3: "C3",
  deltaforce: "DF",
  deltaforce2: "DF2",
  armoredfist: "AF",
};

export function getMap(id) {
  return byId.get(id) || null;
}

export function collectionById(id) {
  return collections.find((collection) => collection.id === id) || null;
}

export function playableMapIds() {
  return maps.filter((map) => map.playable).map((map) => map.id);
}

export function firstMapId() {
  const playable = maps.find((map) => map.playable);
  if (playable) {
    return playable.id;
  }
  return maps.length ? maps[0].id : "";
}

export function resolveMapId(saved) {
  if (typeof saved !== "string" || !saved) {
    return null;
  }
  if (byId.has(saved)) {
    return saved;
  }
  const named = maps.filter((map) => map.name === saved);
  const legacy = named.find((map) => map.collection === "comanche3") || named[0];
  return legacy ? legacy.id : null;
}

export function mapInputLabel(id) {
  const map = getMap(id);
  if (!map) {
    return "";
  }
  const collection = collectionById(map.collection);
  const label = collection ? collection.label : map.collection;
  return label + " / " + map.name;
}

export function assetSrc(map, key) {
  const asset = map && map.assets && map.assets[key];
  return asset && asset.src ? asset.src : "";
}

export function mapChipLabel(id) {
  const map = getMap(id);
  if (!map) {
    return "----";
  }
  if ((nameCounts.get(map.name) || 0) > 1) {
    return (SHORT_LABEL[map.collection] || map.collection) + " " + map.name;
  }
  return map.name;
}
