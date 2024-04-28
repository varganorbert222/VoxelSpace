// compute vector index from matrix one
function ivect(ix, iy, w) {
  // byte array, r,g,b,a
  return (ix + w * iy) * 4;
}

function Bilinear(srcImg, destImg, scale) {
  // c.f.: wikipedia english article on bilinear interpolation
  // taking the unit square, the inner loop looks like this
  // note: there's a function call inside the double loop to this one
  // maybe a performance killer, optimize this whole code as you need
  function inner(f00, f10, f01, f11, x, y) {
    var un_x = 1.0 - x;
    var un_y = 1.0 - y;
    return f00 * un_x * un_y + f10 * x * un_y + f01 * un_x * y + f11 * x * y;
  }
  var i, j;
  var iyv, iy0, iy1, ixv, ix0, ix1;
  var idxD, idxS00, idxS10, idxS01, idxS11;
  var dx, dy;
  var r, g, b, a;
  for (i = 0; i < destImg.height; ++i) {
    iyv = i / scale;
    iy0 = Math.floor(iyv);
    // Math.ceil can go over bounds
    iy1 =
      Math.ceil(iyv) > srcImg.height - 1 ? srcImg.height - 1 : Math.ceil(iyv);
    for (j = 0; j < destImg.width; ++j) {
      ixv = j / scale;
      ix0 = Math.floor(ixv);
      // Math.ceil can go over bounds
      ix1 =
        Math.ceil(ixv) > srcImg.width - 1 ? srcImg.width - 1 : Math.ceil(ixv);
      idxD = ivect(j, i, destImg.width);
      // matrix to vector indices
      idxS00 = ivect(ix0, iy0, srcImg.width);
      idxS10 = ivect(ix1, iy0, srcImg.width);
      idxS01 = ivect(ix0, iy1, srcImg.width);
      idxS11 = ivect(ix1, iy1, srcImg.width);
      // overall coordinates to unit square
      dx = ixv - ix0;
      dy = iyv - iy0;
      // I let the r, g, b, a on purpose for debugging
      r = inner(
        srcImg.data[idxS00],
        srcImg.data[idxS10],
        srcImg.data[idxS01],
        srcImg.data[idxS11],
        dx,
        dy
      );
      destImg.data[idxD] = r;

      g = inner(
        srcImg.data[idxS00 + 1],
        srcImg.data[idxS10 + 1],
        srcImg.data[idxS01 + 1],
        srcImg.data[idxS11 + 1],
        dx,
        dy
      );
      destImg.data[idxD + 1] = g;

      b = inner(
        srcImg.data[idxS00 + 2],
        srcImg.data[idxS10 + 2],
        srcImg.data[idxS01 + 2],
        srcImg.data[idxS11 + 2],
        dx,
        dy
      );
      destImg.data[idxD + 2] = b;

      a = inner(
        srcImg.data[idxS00 + 3],
        srcImg.data[idxS10 + 3],
        srcImg.data[idxS01 + 3],
        srcImg.data[idxS11 + 3],
        dx,
        dy
      );
      destImg.data[idxD + 3] = a;
    }
  }
}

// Util class for downloading the png
function LoadImagesAsync(urls, width, height) {
  return new Promise(function (resolve, reject) {
    let pending = urls.length;
    const result = [];
    if (pending === 0) {
      resolve([]);
      return;
    }
    urls.forEach(function (url, i) {
      const image = new Image();
      image.onload = function () {
        const tempcanvas = document.createElement("canvas");
        const tempcontext = tempcanvas.getContext("2d");

        tempcanvas.width = width;
        tempcanvas.height = height;
        tempcontext.drawImage(image, 0, 0, width, height);

        // let src = tempcontext.getImageData(0, 0, map.width, map.height);
        // let dst = tempcontext.createImageData(map.width, map.height);
        // Bilinear(src, dst, 1);
        // result[i] = dst.data;
        result[i] = tempcontext.getImageData(0, 0, width, height).data;

        pending--;
        if (pending === 0) {
          resolve(result);
        }
      };
      image.src = url;
    });
  });
}

export { LoadImagesAsync, Bilinear };