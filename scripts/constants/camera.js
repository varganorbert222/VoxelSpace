"use strict";

export const MODE_FLY = "fly";
export const MODE_ORBITAL = "orbital";
export const MODE_WALK = "walking";

export const DEFAULT_NEAR_CLIP = 1;
export const DEFAULT_FAR_CLIP = 8000;
export const DEFAULT_POS_X = 512;
export const DEFAULT_POS_Y = 512;
export const DEFAULT_POS_Z = 150;
export const DEFAULT_RENDER_SCALE = 0.5;
export const DEFAULT_QUALITY = 1;
export const DEFAULT_FOV = 90;
export const DEFAULT_ORBIT_RADIUS = 500;

export const MOVE_DT_SCALE = 30;
export const MOUSE_LOOK_SENSITIVITY = 0.12;
export const STICK_LOOK_SENSITIVITY = 2.4;
export const KEY_LOOK_SENSITIVITY = 2;

export const CLASSIC_PITCH_MIN = -30;
export const CLASSIC_PITCH_MAX = 30;
export const SCANLINE_PITCH_MIN = -80;
export const SCANLINE_PITCH_MAX = 80;

export const ORBIT_RADIUS_MIN = 500;
export const ORBIT_RADIUS_MAX = 2000;
export const ORBIT_THETA_MIN_CLASSIC = 0.5;
export const ORBIT_THETA_MIN_SCANLINE = 0.15;
export const ORBIT_THETA_MIN_PANORAMA = 0.05;
export const ORBIT_PITCH_SCALE = 60;

export const COLLISION_CLEARANCE = 1;

// Ground follow from the DF renderer: eye height above the height field,
// 0.5 m sweep so a rise lifts the camera before it tunnels, then a 7 Hz ease.
export const WALK_EYE_HEIGHT = 2;
export const WALK_SWEEP_STEP = 0.5;
export const WALK_FOLLOW_RATE = 7;
// Map units are meters. 12 m/s reads as a walk on this terrain; Shift keeps the sprint multiplier.
export const WALK_SPEED = 12;
