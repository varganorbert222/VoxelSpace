"use strict";

import Threading from "./threading.js";
import {
  MSG_INIT_MAPS,
  MSG_INIT_KERNEL,
  MSG_KERNEL_READY,
  MSG_RENDER_CLASSIC,
  MSG_RENDER_FRUSTUM_SPACE,
  MSG_RESULT_CLASSIC,
  MSG_RESULT_FRUSTUM_SPACE,
  MSG_WORKER_ERROR,
  classicRenderPayload,
  frustumSpaceRenderPayload,
  voxelRenderPayload,
  MSG_RENDER_VOXEL,
  MSG_RESULT_VOXEL,
} from "./jobProtocol.js";
import { BACKEND_JS } from "../constants/backend.js";
import { canShareBuffers, allocU8, allocU32 } from "./sharedBuffers.js";

// Measured: splitting into more chunks than workers costs more in messages,
// allocations and blits than the load balancing wins back.
const FRUSTUM_CHUNKS_PER_WORKER = 1;

function chunkSizeFor(columnCount, workerCount, align, chunksPerWorker) {
  const parts = Math.max(1, (workerCount * (chunksPerWorker || 1)) | 0);
  let size = Math.ceil(columnCount / parts);
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
  constructor(options) {
    this._slots = [];
    this._jobId = 0;
    this._mapsGeneration = null;
    this._mapsShared = false;
    this._active = null;
    this._kernelBackend =
      options && options.kernelBackend ? options.kernelBackend : BACKEND_JS;
    this._ready = Promise.resolve();
    this._kernelWait = null;
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
    if (this._kernelBackend !== BACKEND_JS) {
      this._ready = new Promise((resolve, reject) => {
        this._kernelWait = {
          left: this._slots.length,
          resolve,
          reject,
        };
      });
      this._ready.catch(() => {});
      for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
        this._slots[i].worker.postMessage({
          type: MSG_INIT_KERNEL,
          backend: this._kernelBackend,
        });
      }
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

  dispose() {
    this.cancel();
    if (this._kernelWait) {
      const wait = this._kernelWait;
      this._kernelWait = null;
      wait.reject(new Error("worker pool disposed"));
    }
    for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
      this._slots[i].worker.terminate();
    }
    this._slots = [];
    this._mapsGeneration = null;
    this._mapsShared = false;
  }

  initMaps(snapshot) {
    this.ensureWorkers();
    if (this._mapsGeneration === snapshot.generation) {
      return;
    }
    this._mapsGeneration = snapshot.generation;
    const n = snapshot.heightMap.length;
    const mips = snapshot.terrainMips;
    const extraCount = mips && mips.count > 1 ? (mips.count - 1) | 0 : 0;
    const share = canShareBuffers();
    this._mapsShared = share;
    let sharedHeights = null;
    let sharedColors = null;
    let sharedMipH = null;
    let sharedMipC = null;
    if (share) {
      sharedHeights = allocU8(n, true);
      sharedHeights.set(snapshot.heightMap);
      sharedColors = allocU32(n, true);
      sharedColors.set(snapshot.colorMap);
      sharedMipH = [];
      sharedMipC = [];
      for (let m = 1; (m <= extraCount) | 0; m = (m + 1) | 0) {
        const hm = allocU8(mips.heightMaps[m].length, true);
        hm.set(mips.heightMaps[m]);
        const cm = allocU32(mips.colorMaps[m].length, true);
        cm.set(mips.colorMaps[m]);
        sharedMipH.push(hm);
        sharedMipC.push(cm);
      }
    }
    for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
      if (share) {
        this._slots[i].worker.postMessage({
          type: MSG_INIT_MAPS,
          shared: 1,
          heightMap: sharedHeights,
          colorMap: sharedColors,
          width: snapshot.width,
          height: snapshot.height,
          mapShift: snapshot.mapShift,
          altitude: snapshot.altitude,
          maxHeight: snapshot.maxHeight,
          maxSlope: snapshot.maxSlope,
          mipCount: mips ? mips.count : 1,
          mipWidths: mips ? mips.widths : [snapshot.width],
          mipHeights: mips ? mips.heights : [snapshot.height],
          mipShifts: mips ? mips.shifts : [snapshot.mapShift],
          mipHeightMaps: sharedMipH,
          mipColorMaps: sharedMipC,
          retail: snapshot.retail || null,
        });
        continue;
      }
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
          maxSlope: snapshot.maxSlope,
          mipCount: mips ? mips.count : 1,
          mipWidths: mips ? mips.widths : [snapshot.width],
          mipHeights: mips ? mips.heights : [snapshot.height],
          mipShifts: mips ? mips.shifts : [snapshot.mapShift],
          mipHeightMaps: mipHeightMaps,
          mipColorMaps: mipColorMaps,
          retail: snapshot.retail || null,
        },
        transfer
      );
    }
  }

  renderClassic(params) {
    return this._whenReady().then(() =>
      this._runJob(
        MSG_RENDER_CLASSIC,
        params,
        params.screenWidth,
        1
      )
    );
  }

  renderFrustumSpace(params) {
    return this._whenReady().then(() =>
      this._runJob(
        MSG_RENDER_FRUSTUM_SPACE,
        params,
        params.screenWidth,
        1,
        FRUSTUM_CHUNKS_PER_WORKER
      )
    );
  }

  renderVoxel(params) {
    return this._whenReady().then(() =>
      this._runJob(MSG_RENDER_VOXEL, params, params.screenWidth, 1)
    );
  }

  _whenReady() {
    this.ensureWorkers();
    return this._ready || Promise.resolve();
  }

  _runJob(msgType, params, columnCount, align, chunksPerWorker) {
    this.ensureWorkers();
    if (this._active) {
      this.cancel();
    }
    this._jobId = (this._jobId + 1) | 0;
    const jobId = this._jobId;
    const workerCount = this._slots.length;
    const size = chunkSizeFor(columnCount, workerCount, align, chunksPerWorker);
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
        } else if (msgType === MSG_RENDER_FRUSTUM_SPACE) {
          slot.worker.postMessage(frustumSpaceRenderPayload(jobId, range, params));
        } else if (msgType === MSG_RENDER_VOXEL) {
          slot.worker.postMessage(voxelRenderPayload(jobId, range, params));
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
    if (data && data.type === MSG_KERNEL_READY) {
      const wait = this._kernelWait;
      if (wait) {
        wait.left = (wait.left - 1) | 0;
        if (wait.left <= 0) {
          this._kernelWait = null;
          wait.resolve();
        }
      }
      return;
    }
    if (data && data.type === MSG_WORKER_ERROR) {
      if (this._kernelWait) {
        const wait = this._kernelWait;
        this._kernelWait = null;
        wait.reject(new Error(data.message || "kernel init failed"));
      }
      slot.busy = 0;
      const active = this._active;
      if (active && (!data.jobId || data.jobId === active.jobId)) {
        const finish = active.finish;
        this._active = null;
        finish(null);
      }
      return;
    }
    slot.busy = 0;
    const active = this._active;
    if (!active || data.jobId !== active.jobId) {
      return;
    }

    const index = slot.chunkIndex;
    if (data.type === MSG_RESULT_CLASSIC || data.type === MSG_RESULT_FRUSTUM_SPACE) {
      active.onChunk(index, {
        startColumn: data.startColumn,
        endColumn: data.endColumn,
        pixels: new Uint32Array(data.pixels),
      });
    } else if (data.type === MSG_RESULT_VOXEL) {
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
