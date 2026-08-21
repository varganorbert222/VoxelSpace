"use strict";

import Threading from "./threading.js";
import {
  MSG_INIT_MAPS,
  MSG_INIT_PANO,
  MSG_RENDER_CLASSIC,
  MSG_RENDER_PANORAMA,
  MSG_RENDER_PANO_VIEW,
  MSG_RESULT_CLASSIC,
  MSG_RESULT_PANORAMA,
  MSG_RESULT_PANO_VIEW,
  MSG_WORKER_ERROR,
  classicRenderPayload,
  panoramaViewPayload,
  panoramaGeneratePayload,
} from "./jobProtocol.js";
import { PIXEL_OFFSET_ALIGN } from "../constants/classic.js";

function chunkSizeFor(columnCount, workerCount, align) {
  let size = Math.ceil(columnCount / workerCount);
  if ((align > 1) | 0) {
    size = Math.ceil(size / align) * align;
    if ((size < align) | 0) size = align;
  }
  if ((size < 1) | 0) size = 1;
  if ((size > columnCount) | 0) size = columnCount;
  return size;
}

function splitRanges(count, size) {
  const ranges = [];
  let start = 0;
  while ((start < count) | 0) {
    let end = start + size;
    if ((end > count) | 0) end = count;
    ranges.push({ start: start, end: end });
    start = end;
  }
  return ranges;
}

class WorkerPool {
  constructor() {
    this._slots = [];
    this._jobId = 0;
    this._mapsGeneration = null;
    this._panoGeneration = null;
    this._active = null;
  }

  get jobId() {
    return this._jobId;
  }

  get workerCount() {
    this.ensureWorkers();
    return this._slots.length;
  }

  ensureWorkers() {
    if (this._slots.length) {
      return;
    }
    const n = Threading.numberOfCores;
    for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
      const worker = new Worker(new URL("./columnworker.js", import.meta.url), {
        type: "module",
      });
      const slot = { worker: worker, busy: 0, chunkIndex: -1 };
      worker.onerror = (err) => {
        console.error("column worker", err && err.message);
      };
      worker.onmessage = (e) => {
        this._onMessage(slot, e.data);
      };
      this._slots.push(slot);
    }
  }

  cancel() {
    this._jobId = (this._jobId + 1) | 0;
    if (this._active) {
      const finish = this._active.finish;
      this._active = null;
      finish(null);
    }
  }

  initMaps(snapshot) {
    this.ensureWorkers();
    if (this._mapsGeneration === snapshot.generation) {
      return;
    }
    this._mapsGeneration = snapshot.generation;
    const n = snapshot.heightMap.length;
    const mips = snapshot.panoMips;
    const extraCount = mips && mips.count > 1 ? (mips.count - 1) | 0 : 0;
    for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
      const heights = new Uint8Array(n);
      heights.set(snapshot.heightMap);
      const colors = new Uint32Array(n);
      colors.set(snapshot.colorMap);
      const transfer = [heights.buffer, colors.buffer];
      const mipHeightMaps = [];
      const mipColorMaps = [];
      for (let m = 1; (m <= extraCount) | 0; m = (m + 1) | 0) {
        const hm = new Uint8Array(mips.heightMaps[m].length);
        hm.set(mips.heightMaps[m]);
        const cm = new Uint32Array(mips.colorMaps[m].length);
        cm.set(mips.colorMaps[m]);
        mipHeightMaps.push(hm.buffer);
        mipColorMaps.push(cm.buffer);
        transfer.push(hm.buffer, cm.buffer);
      }
      this._slots[i].worker.postMessage(
        {
          type: MSG_INIT_MAPS,
          heightMap: heights.buffer,
          colorMap: colors.buffer,
          width: snapshot.width,
          height: snapshot.height,
          mapShift: snapshot.mapShift,
          altitude: snapshot.altitude,
          maxHeight: snapshot.maxHeight,
          mipCount: mips ? mips.count : 1,
          mipWidths: mips ? mips.widths : [snapshot.width],
          mipHeights: mips ? mips.heights : [snapshot.height],
          mipShifts: mips ? mips.shifts : [snapshot.mapShift],
          mipHeightMaps: mipHeightMaps,
          mipColorMaps: mipColorMaps,
        },
        transfer
      );
    }
  }

  setPanorama(snapshot) {
    this.ensureWorkers();
    if (this._panoGeneration === snapshot.generation) {
      return;
    }
    this._panoGeneration = snapshot.generation;
    const n = snapshot.pixels.length;
    const hn = snapshot.horizon.length;
    for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
      const pixels = new Uint32Array(n);
      pixels.set(snapshot.pixels);
      const horizon = new Int32Array(hn);
      horizon.set(snapshot.horizon);
      const depth = new Float32Array(n);
      if (snapshot.depth) {
        depth.set(snapshot.depth);
      }
      this._slots[i].worker.postMessage(
        {
          type: MSG_INIT_PANO,
          pixels: pixels.buffer,
          horizon: horizon.buffer,
          depth: depth.buffer,
          width: snapshot.width,
          height: snapshot.height,
        },
        [pixels.buffer, horizon.buffer, depth.buffer]
      );
    }
  }

  renderClassic(params) {
    return this._runJob(
      MSG_RENDER_CLASSIC,
      params,
      params.screenWidth,
      PIXEL_OFFSET_ALIGN
    );
  }

  renderPanorama(params) {
    return this._runJob(MSG_RENDER_PANORAMA, params, params.width, 1);
  }

  renderPanoramaView(params) {
    return this._runJob(MSG_RENDER_PANO_VIEW, params, params.screenWidth, 1);
  }

  _runJob(msgType, params, columnCount, align) {
    this.ensureWorkers();
    if (this._active) {
      this.cancel();
    }
    this._jobId = (this._jobId + 1) | 0;
    const jobId = this._jobId;
    const workerCount = this._slots.length;
    const size = chunkSizeFor(columnCount, workerCount, align);
    const ranges = splitRanges(columnCount, size);

    return new Promise((resolve) => {
      if (ranges.length === 0) {
        resolve([]);
        return;
      }

      const results = new Array(ranges.length);
      let remaining = ranges.length;
      let next = 0;
      let settled = 0;

      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = 1;
        if (this._active && this._active.jobId === jobId) {
          this._active = null;
        }
        resolve(value);
      };

      const postNext = (slot) => {
        if (jobId !== this._jobId) {
          return;
        }
        if ((next >= ranges.length) | 0) {
          return;
        }
        const index = next;
        next = (next + 1) | 0;
        const range = ranges[index];
        slot.busy = 1;
        slot.chunkIndex = index;

        if (msgType === MSG_RENDER_CLASSIC) {
          slot.worker.postMessage(classicRenderPayload(jobId, range, params));
        } else if (msgType === MSG_RENDER_PANO_VIEW) {
          slot.worker.postMessage(panoramaViewPayload(jobId, range, params));
        } else {
          slot.worker.postMessage(panoramaGeneratePayload(jobId, range, params));
        }
      };

      this._active = {
        jobId: jobId,
        finish: finish,
        postNext: postNext,
        results: results,
        remaining: remaining,
        onChunk: (index, data) => {
          if (jobId !== this._jobId) {
            return;
          }
          results[index] = data;
          remaining = (remaining - 1) | 0;
          if (this._active) {
            this._active.remaining = remaining;
          }
          if (remaining === 0) {
            finish(results);
          }
        },
      };

      for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
        postNext(this._slots[i]);
      }
    });
  }

  _onMessage(slot, data) {
    slot.busy = 0;
    const active = this._active;
    if (!active || data.jobId !== active.jobId) {
      return;
    }

    const index = slot.chunkIndex;
    if (data.type === MSG_RESULT_CLASSIC) {
      active.onChunk(index, {
        startColumn: data.startColumn,
        endColumn: data.endColumn,
        pixels: new Uint32Array(data.pixels),
      });
    } else if (data.type === MSG_RESULT_PANORAMA) {
      active.onChunk(index, {
        startPx: data.startPx,
        endPx: data.endPx,
        pixels: new Uint32Array(data.pixels),
        horizon: new Int32Array(data.horizon),
        depth: new Float32Array(data.depth),
      });
    } else if (data.type === MSG_RESULT_PANO_VIEW) {
      active.onChunk(index, {
        startColumn: data.startColumn,
        endColumn: data.endColumn,
        pixels: new Uint32Array(data.pixels),
      });
    } else if (data.type === MSG_WORKER_ERROR) {
      console.error(
        "column worker message",
        data.type,
        data.message,
        data.stack
      );
      active.finish(null);
      return;
    }

    if (this._active && this._active.jobId === data.jobId) {
      this._active.postNext(slot);
    }
  }
}

export default WorkerPool;
