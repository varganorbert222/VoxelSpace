"use strict";

class Renderer {
  constructor(camera, screenBuffer) {
    this._camera = camera;
    this._screenBuffer = screenBuffer;
  }

  drawBackground() {
    this._screenBuffer.drawBackground();
  }

  flip() {
    this._screenBuffer.flip();
  }

  renderTerrain(terrain) {
    const nearClip = this._camera.nearClip;
    const farClip = this._camera.farClip;
    const pixelOffset = this._camera.pixelOffset;
    const cameraPosX = this._camera.posX;
    const cameraPosY = this._camera.posY;
    const cameraPosZ = this._camera.posZ;
    let step = this._camera.minDeltaZ;

    const screenWidth = this._screenBuffer.canvas.width;
    const screenHeight = this._screenBuffer.canvas.height;
    const sinang = Math.sin(this._camera.angle);
    const cosang = Math.cos(this._camera.angle);

    const hiddenY = new Int32Array(screenWidth);
    for (let i = 0; (i < screenWidth) | 0; i = (i + 1) | 0) {
      hiddenY[i] = screenHeight;
    }

    // Draw from front to back
    for (let z = nearClip; z < farClip; z += step) {
      // 90 degree field of view (TODO: variable fov)
      let plx = -cosang * z - sinang * z;
      let ply = sinang * z - cosang * z;
      let prx = cosang * z - sinang * z;
      let pry = -sinang * z - cosang * z;

      const dx = (prx - plx) / screenWidth;
      const dy = (pry - ply) / screenWidth;
      plx += cameraPosX;
      ply += cameraPosY;

      for (let i = 0; (i < screenWidth) | 0; i += pixelOffset) {
        const terrainSDF = terrain.getTerrainSDF(plx, ply, cameraPosZ);

        const heightonscreen =
          this._camera.projectToScreen(terrainSDF, z) | 0;

        const terrainColor = terrain.terrainShading(plx, ply /*, z*/);

        this._screenBuffer.drawVerticalLine(
          i,
          heightonscreen | 0,
          hiddenY[i],
          terrainColor,
          pixelOffset
        );

        if (heightonscreen < hiddenY[i]) hiddenY[i] = heightonscreen;

        plx += dx * pixelOffset;
        ply += dy * pixelOffset;
      }

      // step += 0.005; // implement LOD (lerp or similar)
      step *= 1.005;
    }
  }

  render(terrain) {
    this.drawBackground();
    this.renderTerrain(terrain);
    this.flip();
  }
}

export default Renderer;
