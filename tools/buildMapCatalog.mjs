"use strict";

import fs from "node:fs";
import path from "node:path";
import {
  ASSET_ROLES,
  MAP_COLLECTIONS,
  altitudeFromTerrainScale,
  foldersForRole,
  isNightMap,
} from "../scripts/constants/mapLayout.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "maps", "catalog.json");
const COLLECTIONS = MAP_COLLECTIONS;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function existsDir(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function toPosix(rel) {
  return rel.split(path.sep).join("/");
}

function indexPngs(dirRel) {
  const found = new Map();
  const abs = path.join(ROOT, dirRel);
  if (!fs.existsSync(abs)) {
    return found;
  }
  const stack = [abs];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        const key = entry.name.toUpperCase();
        const list = found.get(key) || [];
        list.push(toPosix(path.relative(ROOT, full)));
        found.set(key, list);
      }
    }
  }
  return found;
}

function resolveRole(gameDir, roleKey, filename, pngs) {
  const paths = pngs.get(filename.toUpperCase()) || [];
  for (const folder of foldersForRole(roleKey)) {
    const prefix = gameDir + "/" + folder + "/";
    const hit = paths.find((item) => item.startsWith(prefix));
    if (hit) {
      return hit;
    }
  }
  return paths[0] || null;
}

function titleCase(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function filterColor(row) {
  if (!Array.isArray(row.filter) || row.filter.length < 3) {
    return null;
  }
  const rgb = [Number(row.filter[0]), Number(row.filter[1]), Number(row.filter[2])];
  if (rgb.some((channel) => !Number.isFinite(channel))) {
    return null;
  }
  return rgb;
}

function meters(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "";
  }
  const rounded = Math.round(n * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + " m";
}

function assetFile(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (typeof raw.png === "string" && raw.png) {
    return path.basename(raw.png);
  }
  if (typeof raw.name === "string" && raw.name.trim()) {
    return raw.name.trim().toUpperCase().replace(/\.PNG$/, "") + ".png";
  }
  return null;
}

function assetRecord(raw, pngs, gameDir, roleKey) {
  const filename = assetFile(raw);
  if (!filename && !(raw && raw.name)) {
    return null;
  }
  const name = filename
    ? filename.replace(/\.png$/i, "")
    : String(raw.name).trim().toUpperCase();
  const src = filename ? resolveRole(gameDir, roleKey, filename, pngs) : null;
  return { name, src };
}

function sortMaps(list) {
  list.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return list;
}

function comancheMaps(collection, pngs) {
  const file = path.join(ROOT, collection.dir, "data", "maps.json");
  if (!fs.existsSync(file)) {
    return [];
  }
  const rows = readJson(file);
  if (!Array.isArray(rows)) {
    return [];
  }
  return sortMaps(
    rows.map((row) => {
      const colorName = String(row.colorMap || "");
      const heightName = String(row.heightMap || "");
      const stem = colorName.replace(/_C$/i, "");
      const characterName = stem ? stem + "_M" : "";
      const assets = {
        color: {
          name: colorName,
          src: resolveRole(collection.dir, "color", colorName + ".png", pngs),
        },
        elevation: {
          name: heightName,
          src: resolveRole(collection.dir, "elevation", heightName + ".png", pngs),
        },
        character: {
          name: characterName,
          src: characterName
            ? resolveRole(collection.dir, "character", characterName + ".png", pngs)
            : null,
        },
      };
      const camouflage = titleCase(row.terrainCamo);
      const facts = [];
      if (camouflage) {
        facts.push({ key: "camouflage", value: camouflage });
      }
      if (Number.isFinite(Number(row.altitude))) {
        facts.push({ key: "altitude", value: meters(row.altitude) });
      }
      if (row.skyColor) {
        facts.push({ key: "sky", value: String(row.skyColor) });
      }
      return {
        id: collection.id + "/" + row.name,
        collection: collection.id,
        name: row.name,
        title: row.name,
        summary: camouflage,
        creator: "",
        playable: !!(assets.color.src && assets.elevation.src),
        altitude: Number(row.altitude),
        skyColor: row.skyColor || null,
        assets,
        facts,
      };
    })
  );
}

function uniqueTypes(types) {
  if (!Array.isArray(types)) {
    return "";
  }
  const seen = new Set();
  const names = [];
  for (const entry of types) {
    const raw = entry && entry.name ? String(entry.name) : "";
    const label = raw.replace(/_/g, " ").trim();
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    names.push(label);
  }
  return names.join(", ");
}

function isComancheMission(row) {
  return (
    row.terrain_scale != null ||
    row.owner != null ||
    (row.mission && !row.terrain_name)
  );
}

function pushFact(facts, key, value) {
  if (value == null) {
    return;
  }
  const text = String(value).trim();
  if (text) {
    facts.push({ key, value: text });
  }
}

function comancheFacts(row, fileName) {
  const facts = [];
  const altitude = altitudeFromTerrainScale(row.terrain_scale);
  const missionLabel = row.mission ? String(row.mission).trim() : "";
  if (missionLabel && missionLabel.toUpperCase() !== fileName.toUpperCase()) {
    pushFact(facts, "mission", missionLabel);
  }
  pushFact(facts, "owner", row.owner);
  pushFact(facts, "source", row.source);
  pushFact(facts, "camouflage", titleCase(row.camouflage));
  if (altitude != null) {
    pushFact(facts, "altitude", meters(altitude));
  }
  if (Number.isFinite(Number(row.terrain_scale))) {
    pushFact(facts, "terrainScale", String(row.terrain_scale));
  }
  if (Number.isFinite(Number(row.lowest_elevation))) {
    pushFact(facts, "lowestElevation", meters(row.lowest_elevation));
  }
  if (Number.isFinite(Number(row.sky_height))) {
    pushFact(facts, "skyHeight", meters(row.sky_height));
  }
  if (Number.isFinite(Number(row.ideal_altitude))) {
    pushFact(facts, "idealAltitude", meters(row.ideal_altitude));
  }
  pushFact(facts, "sun", row.sun);
  pushFact(facts, "stars", row.stars);
  if (row.sun_slope != null && row.sun_slope !== "") {
    pushFact(facts, "sunSlope", String(row.sun_slope));
  }
  if (Array.isArray(row.filter) && row.filter.length) {
    pushFact(facts, "filter", row.filter.join(", "));
  }
  if (row.gamma != null && row.gamma !== "") {
    pushFact(facts, "gamma", String(row.gamma));
  }
  if (row.saturation != null && row.saturation !== "") {
    pushFact(facts, "saturation", String(row.saturation));
  }
  const loadout = [
    ["cannon", "cannon_rounds"],
    ["rockets", "rockets"],
    ["stingers", "stingers"],
    ["hellfire", "hellfire"],
    ["artillery", "artillery"],
    ["sidewinders", "sidewinders"],
    ["wingmen", "wingmen"],
    ["music", "music"],
    ["missionType", "mission_type"],
    ["copilot", "copilot"],
    ["lineOfSight", "line_of_sight"],
    ["showEfams", "show_efams"],
  ];
  for (const [key, field] of loadout) {
    if (row[field] != null && row[field] !== "") {
      pushFact(facts, key, String(row[field]));
    }
  }
  return facts;
}

function missionFacts(row) {
  const facts = [];
  const push = (key, value) => pushFact(facts, key, value);
  push("terrain", row.terrain_name);
  push("creator", row.terrain_creator);
  push("source", row.source);
  push("camouflage", row.camouflage);
  if (Number.isFinite(Number(row.sky_height))) {
    push("skyHeight", meters(row.sky_height));
  }
  if (Number.isFinite(Number(row.water_height))) {
    push("waterHeight", meters(row.water_height));
  }
  if (Number.isFinite(Number(row.water_opacity))) {
    push("waterOpacity", String(row.water_opacity));
  }
  if (row.horizon != null && row.horizon !== "") {
    push("horizon", String(row.horizon));
  }
  if (Array.isArray(row.filter) && row.filter.length) {
    push("filter", row.filter.join(", "));
  }
  if (row.gamma != null && row.gamma !== "") {
    push("gamma", String(row.gamma));
  }
  if (row.saturation != null && row.saturation !== "") {
    push("saturation", String(row.saturation));
  }
  if (row.sun_slope != null && row.sun_slope !== "") {
    push("sunSlope", String(row.sun_slope));
  }
  push("types", uniqueTypes(row.types));
  return facts;
}

function missionMaps(collection, pngs) {
  const dataDir = path.join(ROOT, collection.dir, "data");
  if (!fs.existsSync(dataDir)) {
    return [];
  }
  const files = fs
    .readdirSync(dataDir)
    .filter((name) => name.toLowerCase().endsWith(".json") && name !== "maps.json");
  const maps = [];
  for (const file of files) {
    const row = readJson(path.join(dataDir, file));
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const assets = {};
    for (const role of ASSET_ROLES) {
      const record = assetRecord(row[role.field], pngs, collection.dir, role.key);
      if (record) {
        assets[role.key] = record;
      }
    }
    if (!assets.character) {
      assets.character = { name: "", src: null };
    }
    const name = path.basename(file, ".json");
    const comanche = isComancheMission(row);
    const missionLabel = row.mission ? String(row.mission).trim() : "";
    const title = comanche
      ? missionLabel || name
      : (row.terrain_name && String(row.terrain_name).trim()) || name;
    const camouflage = titleCase(row.camouflage);
    maps.push({
      id: collection.id + "/" + name,
      collection: collection.id,
      name,
      title,
      summary: comanche ? camouflage : title === name ? camouflage : title,
      creator: comanche
        ? row.owner
          ? String(row.owner)
          : ""
        : row.terrain_creator
          ? String(row.terrain_creator)
          : "",
      playable: !!(assets.color && assets.color.src && assets.elevation && assets.elevation.src),
      night: isNightMap(name),
      filter: filterColor(row),
      altitude: comanche ? altitudeFromTerrainScale(row.terrain_scale) : null,
      skyColor: null,
      assets,
      facts: comanche ? comancheFacts(row, name) : missionFacts(row),
    });
  }
  return sortMaps(maps);
}

function mapsFor(collection) {
  if (!existsDir(collection.dir)) {
    return [];
  }
  const pngs = indexPngs(collection.dir);
  const missions = missionMaps(collection, pngs);
  if (missions.length) {
    return missions;
  }
  return comancheMaps(collection, pngs);
}

const collections = COLLECTIONS.map((collection) => ({
  id: collection.id,
  label: collection.label,
}));
const maps = COLLECTIONS.flatMap((collection) => mapsFor(collection));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ collections, maps }, null, 2) + "\n");

const counts = collections.map((collection) => {
  const rows = maps.filter((map) => map.collection === collection.id);
  const playable = rows.filter((map) => map.playable).length;
  return collection.label + " " + rows.length + " (" + playable + " playable)";
});
console.log(counts.join("\n"));
console.log("wrote " + path.relative(ROOT, OUT));
