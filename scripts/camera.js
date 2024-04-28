const DEG_TO_RAD = 0.01745329;

class Camera {
    constructor(settings) {
        this.nearClip = settings.nearClip | 0.001;
        this.farClip = settings.farClip | 1000;
        this.minDeltaZ = settings.minDeltaZ | 1;
        this.posX = settings.posX | 512;                         // x position on the map
        this.posZ = settings.posZ | 800;                         // y position on the map
        this.posY = settings.posY | 78;                          // height of the camera
        this.angle = settings.angle | 0;                          // direction of the camera
        this.horizon = settings.horizon | window.innerHeight / 2.0; // horizon position (look up and down)
        this.renderScale = settings.renderScale | 0.7;
        this.pixelOffset = settings.pixelOffset | 2;
    }
    
}

export default Camera;