"use strict";

import Threading from "./threading.js";
import {
  MSG_INIT_MAPS,
  MSG_INIT_PANO,
  MSG_INIT_CUBE,
  MSG_INIT_KERNEL,
  MSG_KERNEL_READY,
  MSG_RENDER_CLASSIC,
  MSG_RENDER_FRUSTUM_SPACE,
  MSG_RENDER_PANORAMA,
  MSG_RENDER_PANO_VIEW,
  MSG_RENDER_CUBE_VIEW,
  MSG_RENDER_CUBE_GENERATE,
  MSG_RESULT_CLASSIC,
  MSG_RESULT_FRUSTUM_SPACE,
  MSG_RESULT_PANORAMA,
  MSG_RESULT_PANO_VIEW,
  MSG_RESULT_CUBE_VIEW,
  MSG_RESULT_CUBE_GENERATE,
  MSG_WORKER_ERROR,
  classicRenderPayload,
  frustumSpaceRenderPayload,
  panoramaViewPayload,
  panoramaGeneratePayload,
  cubemapViewPayload,
  cubemapGeneratePayload,
} from "./jobProtocol.js";
import { PIXEL_OFFSET_ALIGN } from "../constants/classic.js";
import { BACKEND_JS } from "../constants/backend.js";
import { canShareBuffers, allocU8, allocU32, isShared } from "./sharedBuffers.js";

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
  constructor(options) {
    this._slots = [];
    this._jobId = 0;
    this._mapsGeneration = null;
    this._panoGeneration = null;
    this._cubeGeneration = null;
    this._mapsShared = false;
    this._panoShared = false;
    this._cubeShared = false;
    this._panoSharedBuf = null;
    this._cubeSharedBuf = null;
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

  get atlasShared() {
    return this._panoShared || this._cubeShared;
  }

  get panoShared() {
    return this._panoShared;
  }

  get cubeShared() {
    return this._cubeShared;
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
    this._panoGeneration = null;
    this._cubeGeneration = null;
    this._mapsShared = false;
    this._panoShared = false;
    this._cubeShared = false;
    this._panoSharedBuf = null;
    this._cubeSharedBuf = null;
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
          mipCount: mips ? mips.count : 1,
          mipWidths: mips ? mips.widths : [snapshot.width],
          mipHeights: mips ? mips.heights : [snapshot.height],
          mipShifts: mips ? mips.shifts : [snapshot.mapShift],
          mipHeightMaps: sharedMipH,
          mipColorMaps: sharedMipC,
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
    const share = canShareBuffers() && isShared(snapshot.pixels);
    if (
      this._panoGeneration === snapshot.generation &&
      this._panoShared === share &&
      (!share || this._panoSharedBuf === snapshot.pixels.buffer)
    ) {
      return;
    }
    this._panoGeneration = snapshot.generation;
    this._panoShared = share;
    this._panoSharedBuf = share ? snapshot.pixels.buffer : null;
    const n = snapshot.pixels.length;
    const hn = snapshot.horizon.length;
    for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
      if (share) {
        this._slots[i].worker.postMessage({
          type: MSG_INIT_PANO,
          shared: 1,
          pixels: snapshot.pixels,
          horizon: snapshot.horizon,
          depth: snapshot.depth,
          heightBuf: snapshot.heightBuf || null,
          iter: snapshot.iter || null,
          width: snapshot.width,
          height: snapshot.height,
          generation: snapshot.generation,
        });
        continue;
      }
      const pixels = new Uint32Array(n);
      pixels.set(snapshot.pixels);
      const horizon = new Int32Array(hn);
      horizon.set(snapshot.horizon);
      const depth = new Float32Array(n);
      if (snapshot.depth) {
        depth.set(snapshot.depth);
      }
      const transfer = [pixels.buffer, horizon.buffer, depth.buffer];
      let heightBuf = null;
      let iter = null;
      if (snapshot.heightBuf) {
        heightBuf = new Uint32Array(n);
        heightBuf.set(snapshot.heightBuf);
        transfer.push(heightBuf.buffer);
      }
      if (snapshot.iter) {
        iter = new Uint32Array(n);
        iter.set(snapshot.iter);
        transfer.push(iter.buffer);
      }
      this._slots[i].worker.postMessage(
        {
          type: MSG_INIT_PANO,
          pixels: pixels.buffer,
          horizon: horizon.buffer,
          depth: depth.buffer,
          heightBuf: heightBuf ? heightBuf.buffer : null,
          iter: iter ? iter.buffer : null,
          width: snapshot.width,
          height: snapshot.height,
          generation: snapshot.generation,
        },
        transfer
      );
    }
  }

  setCubemap(snapshot) {
    this.ensureWorkers();
    const share = canShareBuffers() && isShared(snapshot.color);
    if (
      this._cubeGeneration === snapshot.generation &&
      this._cubeShared === share &&
      (!share || this._cubeSharedBuf === snapshot.color.buffer)
    ) {
      return;
    }
    this._cubeGeneration = snapshot.generation;
    this._cubeShared = share;
    this._cubeSharedBuf = share ? snapshot.color.buffer : null;
    const n = snapshot.color.length;
    for (let i = 0; (i < this._slots.length) | 0; i = (i + 1) | 0) {
      if (share) {
        this._slots[i].worker.postMessage({
          type: MSG_INIT_CUBE,
          shared: 1,
          color: snapshot.color,
          depth: snapshot.depth,
          heightBuf: snapshot.heightBuf || null,
          iter: snapshot.iter || null,
          n: snapshot.n,
          generation: snapshot.generation,
        });
        continue;
      }
      const color = new Uint32Array(n);
      color.set(snapshot.color);
      const depth = new Float32Array(n);
      if (snapshot.depth) {
        depth.set(snapshot.depth);
      }
      const transfer = [color.buffer, depth.buffer];
      let heightBuf = null;
      let iter = null;
      if (snapshot.heightBuf) {
        heightBuf = new Uint32Array(n);
        heightBuf.set(snapshot.heightBuf);
        transfer.push(heightBuf.buffer);
      }
      if (snapshot.iter) {
        iter = new Uint32Array(n);
        iter.set(snapshot.iter);
        transfer.push(iter.buffer);
      }
      this._slots[i].worker.postMessage(
        {
          type: MSG_INIT_CUBE,
          color: color.buffer,
          depth: depth.buffer,
          heightBuf: heightBuf ? heightBuf.buffer : null,
          iter: iter ? iter.buffer : null,
          n: snapshot.n,
          generation: snapshot.generation,
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
        PIXEL_OFFSET_ALIGN
      )
    );
  }

  renderPanorama(params) {
    return this._whenReady().then(() =>
      this._runJob(MSG_RENDER_PANORAMA, params, params.width, 1)
    );
  }

  renderPanoramaView(params) {
    return this._whenReady().then(() =>
      this._runJob(MSG_RENDER_PANO_VIEW, params, params.screenWidth, 1)
    );
  }

  renderCubemapView(params) {
    return this._whenReady().then(() =>
      this._runJob(MSG_RENDER_CUBE_VIEW, params, params.screenWidth, 1)
    );
  }

  renderCubemapGenerate(params) {
    this.ensureWorkers();
    const n = params.n | 0;
    const jobs = [];
    for (let face = 0; face < 4; face = (face + 1) | 0) {
      jobs.push({ kind: "horizon", face: face });
    }
    const azCount = n << 2;
    const share = canShareBuffers();
    const maxPolar = share ? 8 : 4;
    const polarJobs = Math.max(
      1,
      Math.min(
        maxPolar,
        this._slots.length <= 4
          ? this._slots.length
          : this._slots.length - 4
      )
    );
    const azChunk = Math.ceil(azCount / polarJobs) | 0;
    for (let i = 0; (i < polarJobs) | 0; i = (i + 1) | 0) {
      const startAz = (i * azChunk) | 0;
      if ((startAz >= azCount) | 0) {
        break;
      }
      let endAz = (startAz + azChunk) | 0;
      if ((endAz > azCount) | 0) {
        endAz = azCount;
      }
      jobs.push({
        kind: "polar",
        startAz: startAz,
        endAz: endAz,
        fillSky: 0,
      });
    }
    return this._whenReady().then(() =>
      this._runJobList(jobs, (worker, jobId, job) => {
        worker.postMessage(cubemapGeneratePayload(jobId, job, params));
      })
    );
  }

  _whenReady() {
    this.ensureWorkers();
    return this._ready || Promise.resolve();
  }

  _runJobList(jobs, postFn) {
    this.ensureWorkers();
    if (this._active) {
      this.cancel();
    }
    this._jobId = (this._jobId + 1) | 0;
    const jobId = this._jobId;
    return new Promise((resolve) => {
      if (!jobs.length) {
        resolve([]);
        return;
      }
      const results = new Array(jobs.length);
      let remaining = jobs.length;
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
        if ((next >= jobs.length) | 0) {
          return;
        }
        const index = next;
        next = (next + 1) | 0;
        slot.busy = 1;
        slot.chunkIndex = index;
        postFn(slot.worker, jobId, jobs[index], index);
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
        } else if (msgType === MSG_RENDER_FRUSTUM_SPACE) {
          slot.worker.postMessage(frustumSpaceRenderPayload(jobId, range, params));
        } else if (msgType === MSG_RENDER_PANO_VIEW) {
          slot.worker.postMessage(panoramaViewPayload(jobId, range, params));
        } else if (msgType === MSG_RENDER_CUBE_VIEW) {
          slot.worker.postMessage(cubemapViewPayload(jobId, range, params));
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
    if (data && data.type === MSG_WORKER_ERROR && this._kernelWait) {
      const wait = this._kernelWait;
      this._kernelWait = null;
      wait.reject(new Error(data.message || "kernel init failed"));
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
    } else if (data.type === MSG_RESULT_PANORAMA) {
      active.onChunk(index, {
        startPx: data.startPx,
        endPx: data.endPx,
        pixels: new Uint32Array(data.pixels),
        horizon: new Int32Array(data.horizon),
        depth: new Float32Array(data.depth),
        heightBuf: data.heightBuf ? new Uint32Array(data.heightBuf) : null,
        iter: data.iter ? new Uint32Array(data.iter) : null,
      });
    } else if (data.type === MSG_RESULT_PANO_VIEW) {
      active.onChunk(index, {
        startColumn: data.startColumn,
        endColumn: data.endColumn,
        pixels: new Uint32Array(data.pixels),
      });
    } else if (data.type === MSG_RESULT_CUBE_VIEW) {
      active.onChunk(index, {
        startColumn: data.startColumn,
        endColumn: data.endColumn,
        pixels: new Uint32Array(data.pixels),
      });
    } else if (data.type === MSG_RESULT_CUBE_GENERATE) {
      if (data.shared) {
        active.onChunk(index, {
          kind: data.kind,
          face: data.face,
          n: data.n,
          shared: 1,
        });
      } else {
        active.onChunk(index, {
          kind: data.kind,
          face: data.face,
          n: data.n,
          pixels: new Uint32Array(data.pixels),
          depth: new Float32Array(data.depth),
          heightBuf: data.heightBuf ? new Uint32Array(data.heightBuf) : null,
          iter: data.iter ? new Uint32Array(data.iter) : null,
        });
      }
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
