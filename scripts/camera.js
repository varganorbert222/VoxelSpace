"use strict";

const DEG_TO_RAD = 0.01745329;

class Camera {
    constructor(settings) {
        this._nearClip = settings.nearClip | 0.001;
        this._farClip = settings.farClip | 1000;
        this._minDeltaZ = settings.minDeltaZ | 1;
        this._posX = settings.posX | 512;                         // x position on the map
        this._posZ = settings.posZ | 800;                         // y position on the map
        this._posY = settings.posY | 78;                          // height of the camera
        this._angle = settings.angle | 0;                          // direction of the camera
        this._horizon = settings.horizon | window.innerHeight / 2.0; // horizon position (look up and down)
        this._renderScale = settings.renderScale | 0.7;
        this._pixelOffset = settings.pixelOffset | 2;
    }
    // ProjectToViewport?
    projectToScreen(screenWidth, camFOV, horizon, depth, terrainSDF) {
        const dstToProjPlane =
          (screenWidth * 0.5) / Math.tan(camFOV * 0.5 * DEG_TO_RAD);
        const terrainProjectedHeight = (terrainSDF / depth) * dstToProjPlane;
        const scaledHorizon = horizon * this._renderScale;
        const drawHeight = Math.floor(terrainProjectedHeight + scaledHorizon);
      
        return drawHeight;
      }
}

export default Camera;