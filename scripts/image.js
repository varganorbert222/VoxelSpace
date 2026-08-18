import {
  CHANNEL_BLUE,
  CHANNEL_GREEN,
  CHANNEL_RED,
  CHANNEL_ALPHA,
  BYTES_PER_PIXEL,
} from "./constants/image.js";
import { SHIFT_ALPHA, SHIFT_RED, SHIFT_GREEN } from "./constants/color.js";

function readColorFromImage(image, index) {
  const alpha = readAlphaFromImage(image, index);
  const red = readRedFromImage(image, index);
  const green = readGreenFromImage(image, index);
  const blue = readBlueFromImage(image, index);

  return (alpha << SHIFT_ALPHA) | (red << SHIFT_RED) | (green << SHIFT_GREEN) | blue;
}

function readAlphaFromImage(image, index) {
  return image[index * BYTES_PER_PIXEL + CHANNEL_ALPHA];
}

function readRedFromImage(image, index) {
  return image[index * BYTES_PER_PIXEL + CHANNEL_RED];
}

function readGreenFromImage(image, index) {
  return image[index * BYTES_PER_PIXEL + CHANNEL_GREEN];
}

function readBlueFromImage(image, index) {
  return image[index * BYTES_PER_PIXEL + CHANNEL_BLUE];
}

export {
  readAlphaFromImage,
  readRedFromImage,
  readGreenFromImage,
  readBlueFromImage,
  readColorFromImage,
};
