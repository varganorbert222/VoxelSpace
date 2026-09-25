"use strict";

import { readColorFromImage, readRedFromImage } from "./image.js";
import { decodeIndexedPng, pngPalette } from "./pngPalette.js";

function decodeImageBytes(bytes) {
  const indicesPromise = decodeIndexedPng(bytes);
  return new Promise(function (resolve) {
    const blob = new Blob([bytes], { type: "image/png" });
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    const finish = function (value) {
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    image.onload = function () {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const tempcanvas = document.createElement("canvas");
      const tempcontext = tempcanvas.getContext("2d", { willReadFrequently: true });
      if (!tempcontext) {
        finish(null);
        return;
      }
      tempcanvas.width = width;
      tempcanvas.height = height;
      tempcontext.drawImage(image, 0, 0, width, height);
      indicesPromise.then(function (indices) {
        finish({
          data: tempcontext.getImageData(0, 0, width, height).data,
          width: width,
          height: height,
          palette: pngPalette(bytes),
          indices: indices,
        });
      });
    };
    image.onerror = function () {
      finish(null);
    };
    image.src = objectUrl;
  });
}

function loadImagesAsync(urls) {
  return Promise.all(
    urls.map(function (url) {
      if (!url) {
        return Promise.resolve(null);
      }
      return fetch(url)
        .then(function (response) {
          if (!response.ok) {
            return null;
          }
          return response.arrayBuffer();
        })
        .then(function (buffer) {
          if (!buffer) {
            return null;
          }
          return decodeImageBytes(new Uint8Array(buffer));
        })
        .catch(function () {
          return null;
        });
    })
  );
}

function loadRGBAImageToArray(image) {
  const n = image.width * image.height;
  const data = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = readColorFromImage(image.data, i);
  }
  return data;
}

function loadRImageToArray(image) {
  const n = image.width * image.height;
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = readRedFromImage(image.data, i);
  }
  return data;
}

export { loadImagesAsync, loadRGBAImageToArray, loadRImageToArray };
