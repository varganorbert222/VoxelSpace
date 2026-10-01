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

// Approximate adult eye heights above the terrain, in meters.
export const WALK_EYE_HEIGHT = 1.65;
export const WALK_CROUCH_EYE_HEIGHT = 1.05;
export const WALK_PRONE_EYE_HEIGHT = 0.25;
// 0.5 m sweep prevents terrain tunneling; height changes ease at 7 Hz.
export const WALK_SWEEP_STEP = 0.5;
export const WALK_FOLLOW_RATE = 7;
export const WALK_JUMP_SPEED = 8;
export const WALK_GRAVITY = 20;
// Map units are meters: brisk walking and a fast human sprint.
export const WALK_SPEED = 6;
export const WALK_SPRINT_SPEED = 12;
export const WALK_CROUCH_SPEED = 2;
export const WALK_PRONE_SPEED = 2;
