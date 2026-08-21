"use strict";

import { readColorFromImage, readRedFromImage } from "./image.js";

function loadImagesAsync(urls) {
  return new Promise(function (resolve) {
    let pending = urls.length;
    const result = [];
    if (pending === 0) {
      resolve([]);
      return;
    }
    urls.forEach(function (url, i) {
      const image = new Image();
      image.src = url;
      image.onload = function () {
        const width = image.naturalWidth;
        const height = image.naturalHeight;

        const tempcanvas = document.createElement("canvas");
        const tempcontext = tempcanvas.getContext("2d");

        tempcanvas.width = width;
        tempcanvas.height = height;
        tempcontext.drawImage(image, 0, 0, width, height);

        result[i] = {
          data: tempcontext.getImageData(0, 0, width, height).data,
          width: width,
          height: height,
        };

        pending--;
        if (pending === 0) {
          resolve(result);
        }
      };
    });
  });
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
