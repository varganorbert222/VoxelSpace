self.onmessage = (e) => {
  const map = e.data[0];
  const screendata = e.data[1];
  const camera = e.data[2];

  const drawBackground = (screendata) => {
    var buf32 = screendata.buf32;
    var color = screendata.backgroundcolor | 0;
    for (var i = 0; i < buf32.length; i++) buf32[i] = color | 0;
  };

  const drawVerticalLine = (x, ytop, ybottom, col, screendata) => {
    x = x | 0;
    ytop = ytop | 0;
    ybottom = ybottom | 0;
    col = col | 0;
    var buf32 = screendata.buf32;
    var screenwidth = screendata.canvasWidth | 0;
    if (ytop < 0) ytop = 0;
    if (ytop > ybottom) return;

    // get offset on screen for the vertical line
    var offset = (ytop * screenwidth + x) | 0;
    for (var k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
      buf32[offset | 0] = col | 0;
      offset = (offset + screenwidth) | 0;
    }
  };

  const render = (map, screendata, camera) => {
    var mapwidthperiod = map.width - 1;
    var mapheightperiod = map.height - 1;

    var screenwidth = screendata.canvasWidth | 0;
    var sinang = Math.sin(camera.angle);
    var cosang = Math.cos(camera.angle);

    var hiddeny = new Int32Array(screenwidth);
    for (var i = 0; (i < screendata.canvasWidth) | 0; i = (i + 1) | 0)
      hiddeny[i] = screendata.canvasHeight;

    var deltaz = 1;

    // Draw from front to back
    for (var z = 1; z < camera.distance; z += deltaz) {
      // 90 degree field of view
      var plx = -cosang * z - sinang * z;
      var ply = sinang * z - cosang * z;
      var prx = cosang * z - sinang * z;
      var pry = -sinang * z - cosang * z;

      var dx = (prx - plx) / screenwidth;
      var dy = (pry - ply) / screenwidth;
      plx += camera.x;
      ply += camera.y;
      var invz = (1 / z) * 240;
      for (var i = 0; (i < screenwidth) | 0; i = (i + 1) | 0) {
        var mapoffset =
          (((Math.floor(ply) & mapwidthperiod) << map.shift) +
            (Math.floor(plx) & mapheightperiod)) |
          0;
        var heightonscreen =
          ((camera.height - map.altitude[mapoffset]) * invz + camera.horizon) |
          0;
        drawVerticalLine(
          i,
          heightonscreen | 0,
          hiddeny[i],
          map.color[mapoffset],
          screendata
        );
        if (heightonscreen < hiddeny[i]) hiddeny[i] = heightonscreen;
        plx += dx;
        ply += dy;
      }
      deltaz += 0.005;
    }
  };

  // console.log(screendata);
  drawBackground(screendata);
  render(map, screendata, camera);

  self.postMessage(screendata.buf32);
};
