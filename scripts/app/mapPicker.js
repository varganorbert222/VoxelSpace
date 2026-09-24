"use strict";

import {
  collectionById,
  collections,
  getMap,
  mapInputLabel,
  maps,
} from "./mapCatalog.js";

const VARIANT_KEY = { C: "color", D: "elevation", M: "character" };

const ASSET_META = {
  color: {
    label: "Color",
    code: "C",
    description: "Terrain color map (_C).",
  },
  elevation: {
    label: "Elevation",
    code: "D",
    description: "Terrain elevation map (_D).",
  },
  character: {
    label: "Character",
    code: "M",
    description: "Character map (_M).",
  },
  detailColor: {
    label: "Detail color",
    description: "Close-range color texture.",
  },
  detailElevation: {
    label: "Detail elevation",
    description: "Close-range elevation texture.",
  },
  detailShade: {
    label: "Detail shade",
    description: "Close-range shading texture.",
  },
  sky: {
    label: "Sky",
    description: "Sky texture named by the mission file.",
  },
  skyPalette: {
    label: "Sky palette",
    description: "Sky color gradient named by the mission file.",
  },
  water: {
    label: "Water",
    description: "Water texture named by the mission file.",
  },
  waterPalette: {
    label: "Water palette",
    description: "Water color gradient named by the mission file.",
  },
};

const FACT_LABEL = {
  terrain: "Terrain",
  creator: "Creator",
  owner: "Owner",
  source: "Source",
  camouflage: "Camouflage",
  altitude: "Altitude",
  terrainScale: "Terrain scale",
  lowestElevation: "Lowest elevation",
  idealAltitude: "Ideal altitude",
  sky: "Sky color",
  skyHeight: "Sky height",
  sun: "Sun",
  stars: "Stars",
  waterHeight: "Water height",
  waterOpacity: "Water opacity",
  horizon: "Horizon",
  filter: "Filter",
  gamma: "Gamma",
  saturation: "Saturation",
  sunSlope: "Sun slope",
  types: "Surfaces",
  cannon: "Cannon",
  rockets: "Rockets",
  stingers: "Stingers",
  hellfire: "Hellfire",
  artillery: "Artillery",
  sidewinders: "Sidewinders",
  wingmen: "Wingmen",
  music: "Music",
  missionType: "Mission type",
  copilot: "Copilot",
  lineOfSight: "Line of sight",
  showEfams: "Show EFAMS",
};

const GROUPS = [
  {
    id: "terrain",
    label: "Terrain",
    blurb: "Color, elevation, and character variants.",
    assets: ["color", "elevation", "character"],
    facts: [],
    always: true,
  },
  {
    id: "detail",
    label: "Detail",
    blurb: "Textures used up close.",
    assets: ["detailColor", "detailElevation", "detailShade"],
    facts: [],
  },
  {
    id: "sky",
    label: "Sky",
    blurb: "Sky color and imagery from the mission file.",
    assets: ["sky", "skyPalette"],
    facts: ["sky", "skyHeight", "sun", "stars"],
  },
  {
    id: "water",
    label: "Water",
    blurb: "Water imagery and level.",
    assets: ["water", "waterPalette"],
    facts: ["waterHeight", "waterOpacity"],
  },
  {
    id: "record",
    label: "Record",
    blurb: "The rest of the mission file.",
    assets: [],
    facts: [
      "terrain",
      "creator",
      "owner",
      "source",
      "camouflage",
      "altitude",
      "terrainScale",
      "lowestElevation",
      "idealAltitude",
      "types",
      "horizon",
      "filter",
      "gamma",
      "saturation",
      "sunSlope",
    ],
  },
  {
    id: "loadout",
    label: "Loadout",
    blurb: "Ordnance and setup stored in the mission file.",
    assets: [],
    facts: [
      "cannon",
      "rockets",
      "stingers",
      "hellfire",
      "artillery",
      "sidewinders",
      "wingmen",
      "music",
      "missionType",
      "copilot",
      "lineOfSight",
      "showEfams",
    ],
  },
];

function variantKey(code) {
  return VARIANT_KEY[code] || "color";
}

function assetSrc(map, code) {
  const asset = map.assets[variantKey(code)];
  return asset && asset.src ? asset.src : "";
}

function preferredVariant(map, saved) {
  if (saved && assetSrc(map, saved)) {
    return saved;
  }
  for (const code of ["C", "D", "M"]) {
    if (assetSrc(map, code)) {
      return code;
    }
  }
  return "C";
}

function matchesQuery(map, query) {
  if (!query) {
    return true;
  }
  const parts = [map.name, map.title, map.summary, map.creator];
  for (const asset of Object.values(map.assets)) {
    if (asset && asset.name) {
      parts.push(asset.name);
    }
  }
  for (const fact of map.facts) {
    parts.push(fact.value);
  }
  return parts.join("\n").toLowerCase().includes(query);
}

function emptyCopy(text) {
  const note = document.createElement("p");
  note.className = "map-empty";
  note.textContent = text;
  return note;
}

export function initMapPicker(app) {
  const root = document.getElementById("id_map_modal");
  const field = document.getElementById("id_mapselector");
  const browse = document.getElementById("id_map_browse");
  const tabs = document.getElementById("id_map_tabs");
  const filter = document.getElementById("id_map_filter");
  const gallery = document.getElementById("id_map_gallery");
  const detail = document.getElementById("id_map_detail");
  const status = document.getElementById("id_map_status");
  const note = document.getElementById("id_map_note");
  const loadBtn = document.getElementById("id_map_load");
  if (!root || !field || !browse || !tabs || !gallery || !detail) {
    return;
  }

  let activeCollection = collections.length ? collections[0].id : "";
  let pendingId = "";
  let filterText = "";
  const variantById = new Map();

  function open() {
    pendingId = app.currentMapName;
    const current = getMap(pendingId);
    activeCollection = current
      ? current.collection
      : collections.length
        ? collections[0].id
        : "";
    filterText = "";
    if (filter) {
      filter.value = "";
    }
    root.hidden = false;
    document.body.classList.add("map-picker-open");
    render(true);
    if (filter) {
      filter.focus();
    }
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove("map-picker-open");
    browse.focus();
  }

  function confirmLoad() {
    const map = getMap(pendingId);
    if (!map || !map.playable) {
      return;
    }
    app.loadMap(map.id);
    close();
  }

  function choose(id) {
    pendingId = id;
    for (const card of gallery.querySelectorAll(".map-card")) {
      const on = card.dataset.mapId === id;
      card.classList.toggle("is-selected", on);
      card.setAttribute("aria-current", on ? "true" : "false");
    }
    renderDetail();
    renderFooter();
  }

  function paintPreview(card, map, code) {
    const frame = card.querySelector(".map-card-frame");
    if (!frame) {
      return;
    }
    frame.replaceChildren();
    const src = assetSrc(map, code);
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      frame.append(img);
    } else {
      const missing = document.createElement("span");
      missing.className = "map-card-missing";
      missing.textContent = "No _" + code;
      frame.append(missing);
    }
    for (const btn of card.querySelectorAll(".map-variant")) {
      const on = btn.dataset.variant === code;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function renderTabs() {
    tabs.replaceChildren();
    for (const collection of collections) {
      const count = maps.reduce(
        (total, map) => total + (map.collection === collection.id ? 1 : 0),
        0
      );
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "map-tab";
      btn.setAttribute("role", "tab");
      const on = collection.id === activeCollection;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.classList.toggle("is-on", on);
      btn.append(document.createTextNode(collection.label));
      const badge = document.createElement("span");
      badge.className = "map-tab-count";
      badge.textContent = String(count);
      btn.append(badge);
      btn.addEventListener("click", () => {
        activeCollection = collection.id;
        render(true);
      });
      tabs.append(btn);
    }
  }

  function renderGallery(scrollSelected) {
    const query = filterText.trim().toLowerCase();
    const inCollection = maps.filter((map) => map.collection === activeCollection);
    gallery.replaceChildren();
    if (!inCollection.length) {
      gallery.append(emptyCopy("No maps in this library yet."));
      return;
    }
    const rows = inCollection.filter((map) => matchesQuery(map, query));
    if (!rows.length) {
      gallery.append(emptyCopy("No maps match."));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const map of rows) {
      fragment.append(renderCard(map));
    }
    gallery.append(fragment);
    if (!scrollSelected) {
      return;
    }
    const selected = gallery.querySelector(".map-card.is-selected");
    if (selected && selected.scrollIntoView) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  function renderCard(map) {
    const card = document.createElement("article");
    card.className = "map-card";
    card.dataset.mapId = map.id;
    card.tabIndex = 0;
    const selected = map.id === pendingId;
    card.classList.toggle("is-selected", selected);
    card.classList.toggle("is-loaded", map.id === app.currentMapName);
    card.setAttribute("aria-current", selected ? "true" : "false");

    const frame = document.createElement("div");
    frame.className = "map-card-frame";
    card.append(frame);

    const variants = document.createElement("div");
    variants.className = "map-variants";
    variants.setAttribute("role", "group");
    variants.setAttribute("aria-label", map.name + " preview");
    for (const code of ["C", "D", "M"]) {
      const meta = ASSET_META[variantKey(code)];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "map-variant";
      btn.dataset.variant = code;
      btn.textContent = code;
      btn.title = meta.label + " (_" + code + ")";
      btn.disabled = !assetSrc(map, code);
      variants.append(btn);
    }
    card.append(variants);

    const name = document.createElement("h3");
    name.className = "map-card-name";
    name.textContent = map.name;
    card.append(name);

    if (map.summary && map.summary !== map.name) {
      const summary = document.createElement("p");
      summary.className = "map-card-summary";
      summary.textContent = map.summary;
      card.append(summary);
    }

    if (map.id === app.currentMapName) {
      const live = document.createElement("span");
      live.className = "map-card-live";
      live.textContent = "Live";
      card.append(live);
    }

    paintPreview(card, map, preferredVariant(map, variantById.get(map.id)));
    return card;
  }

  function renderDetail() {
    detail.replaceChildren();
    const map = getMap(pendingId);
    if (!map) {
      detail.append(emptyCopy("Select a map."));
      return;
    }
    const head = document.createElement("header");
    head.className = "map-detail-head";
    const kicker = document.createElement("p");
    kicker.className = "map-detail-kicker";
    const collection = collectionById(map.collection);
    kicker.textContent = collection ? collection.label : map.collection;
    const title = document.createElement("h3");
    title.className = "map-detail-title";
    title.textContent = map.name;
    head.append(kicker, title);
    if (map.summary && map.summary !== map.name) {
      const summary = document.createElement("p");
      summary.className = "map-detail-summary";
      summary.textContent = map.summary;
      head.append(summary);
    }
    detail.append(head);

    const factByKey = new Map(map.facts.map((fact) => [fact.key, fact.value]));
    for (const group of GROUPS) {
      const assetRows = [];
      for (const key of group.assets) {
        const asset = map.assets[key] || null;
        if (asset || group.always) {
          assetRows.push({ key, asset });
        }
      }
      const factKeys = group.facts.filter((key) => factByKey.has(key));
      if (!assetRows.length && !factKeys.length) {
        continue;
      }
      detail.append(renderGroup(map, group, assetRows, factKeys, factByKey));
    }
  }

  function renderGroup(map, group, assetRows, factKeys, factByKey) {
    const section = document.createElement("section");
    section.className = "map-asset-group";
    const title = document.createElement("h4");
    title.className = "map-asset-group-title";
    title.textContent = group.label;
    section.append(title);
    const blurb = document.createElement("p");
    blurb.className = "map-asset-group-blurb";
    blurb.textContent = group.blurb;
    section.append(blurb);

    if (assetRows.length) {
      const grid = document.createElement("div");
      grid.className = "map-asset-grid";
      for (const row of assetRows) {
        grid.append(renderAsset(map, row.key, row.asset));
      }
      section.append(grid);
    }

    if (factKeys.length) {
      const list = document.createElement("dl");
      list.className = "map-facts";
      for (const key of factKeys) {
        const label = document.createElement("dt");
        label.textContent = FACT_LABEL[key] || key;
        const value = document.createElement("dd");
        const text = factByKey.get(key);
        if (key === "sky" && /^#[0-9a-fA-F]{6}$/.test(text)) {
          const swatch = document.createElement("span");
          swatch.className = "map-swatch";
          swatch.style.background = text;
          value.append(swatch);
        }
        value.append(document.createTextNode(text));
        list.append(label, value);
      }
      section.append(list);
    }
    return section;
  }

  function renderAsset(map, key, asset) {
    const meta = ASSET_META[key];
    const row = document.createElement("article");
    row.className = "map-asset";
    const src = asset && asset.src ? asset.src : "";
    if (!src) {
      row.classList.add("map-asset--missing");
    }
    row.append(thumb(src, meta.label));

    const body = document.createElement("div");
    body.className = "map-asset-body";
    const label = document.createElement("p");
    label.className = "map-asset-label";
    label.textContent = meta.label;
    if (meta.code) {
      const code = document.createElement("span");
      code.className = "map-asset-code";
      code.textContent = "_" + meta.code;
      label.append(code);
    }
    const name = document.createElement("p");
    name.className = "map-asset-name";
    name.textContent = asset && asset.name ? asset.name : "Not listed";
    const description = document.createElement("p");
    description.className = "map-asset-desc";
    description.textContent = meta.description;
    body.append(label, name, description);
    if (asset && asset.name && !src) {
      const missing = document.createElement("p");
      missing.className = "map-asset-missing";
      missing.textContent = "File not in the library";
      body.append(missing);
    }
    row.append(body);

    if (src && meta.code) {
      row.tabIndex = 0;
      row.classList.add("map-asset--switch");
      row.title = "Show _" + meta.code + " in the gallery";
      const show = () => {
        variantById.set(map.id, meta.code);
        const card = gallery.querySelector(
          '[data-map-id="' + CSS.escape(map.id) + '"]'
        );
        if (card) {
          paintPreview(card, map, meta.code);
        }
      };
      row.addEventListener("click", show);
      row.addEventListener("keydown", (event) => {
        if (event.code === "Enter" || event.code === "Space") {
          event.preventDefault();
          show();
        }
      });
    }
    return row;
  }

  function thumb(src, label) {
    const frame = document.createElement("div");
    frame.className = "map-asset-thumb";
    if (!src) {
      const mark = document.createElement("span");
      mark.textContent = "—";
      frame.append(mark);
      return frame;
    }
    const img = document.createElement("img");
    img.src = src;
    img.alt = label;
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    frame.append(img);
    return frame;
  }

  function renderFooter() {
    const map = getMap(pendingId);
    if (status) {
      status.textContent = map ? mapInputLabel(map.id) : "No map selected";
    }
    if (note) {
      if (map && !map.playable) {
        note.textContent = "Color or elevation file is missing.";
      } else if (map && map.summary && map.summary !== map.name) {
        note.textContent = map.summary;
      } else {
        note.textContent = "";
      }
    }
    if (loadBtn) {
      loadBtn.disabled = !map || !map.playable;
    }
  }

  function render(scrollSelected) {
    renderTabs();
    renderGallery(scrollSelected);
    renderDetail();
    renderFooter();
  }

  field.addEventListener("click", open);
  field.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "Space") {
      event.preventDefault();
      open();
    }
  });
  browse.addEventListener("click", open);

  gallery.addEventListener("click", (event) => {
    const variantBtn = event.target.closest(".map-variant");
    const card = event.target.closest(".map-card");
    if (!card || !gallery.contains(card)) {
      return;
    }
    const map = getMap(card.dataset.mapId);
    if (!map) {
      return;
    }
    if (variantBtn) {
      if (variantBtn.disabled) {
        return;
      }
      variantById.set(map.id, variantBtn.dataset.variant);
      paintPreview(card, map, variantBtn.dataset.variant);
      return;
    }
    choose(map.id);
  });

  gallery.addEventListener("dblclick", (event) => {
    if (event.target.closest(".map-variant")) {
      return;
    }
    const card = event.target.closest(".map-card");
    if (!card) {
      return;
    }
    choose(card.dataset.mapId);
    confirmLoad();
  });

  gallery.addEventListener("keydown", (event) => {
    const card = event.target.closest(".map-card");
    if (!card || event.target !== card) {
      return;
    }
    if (event.code === "Enter") {
      event.preventDefault();
      choose(card.dataset.mapId);
      confirmLoad();
    }
  });

  if (filter) {
    filter.addEventListener("input", () => {
      filterText = filter.value;
      renderGallery(false);
      renderDetail();
      renderFooter();
    });
  }

  const cancel = document.getElementById("id_map_cancel");
  const closeBtn = document.getElementById("id_map_close");
  if (cancel) {
    cancel.addEventListener("click", close);
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", close);
  }
  if (loadBtn) {
    loadBtn.addEventListener("click", confirmLoad);
  }
  root.addEventListener("click", (event) => {
    if (event.target === root) {
      close();
    }
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (root.hidden) {
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
    true
  );
}
