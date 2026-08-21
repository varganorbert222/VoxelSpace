"use strict";

export function mapOffsetAt(x, y, width, height, shift) {
  const mapWidthPeriod = width - 1;
  const mapHeightPeriod = height - 1;
  return (
    ((((y | 0) & mapWidthPeriod) << shift) + ((x | 0) & mapHeightPeriod)) |
    0
  );
}
