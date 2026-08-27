"use strict";

import { compileShader } from "./device.js";

async function loadText(rel) {
  const url = new URL(rel, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to load " + rel + " (" + res.status + ")");
  }
  return res.text();
}

async function loadCompute(device, label, file) {
  const common = await loadText("./shaders/common.wgsl");
  const body = await loadText("./shaders/" + file);
  return compileShader(device, label, common + "\n" + body);
}

export async function createPipelines(device, canvasFormat) {
  const classicMod = await loadCompute(device, "classicMarch", "classicMarch.wgsl");
  let frustumSpaceMod = classicMod;
  try {
    frustumSpaceMod = await loadCompute(
      device,
      "frustumSpaceMarch",
      "frustumSpaceMarch.wgsl"
    );
  } catch (err) {
    console.warn("frustumSpaceMarch compile failed:", err);
  }
  const genMod = await loadCompute(device, "panoGenerate", "panoramaGenerate.wgsl");
  const viewMod = await loadCompute(device, "panoView", "panoramaView.wgsl");
  const cubeGenMod = await loadCompute(device, "cubeGenerate", "cubemapGenerate.wgsl");
  const cubePolarMod = await loadCompute(device, "cubePolar", "cubemapPolar.wgsl");
  const cubeFillMod = await loadCompute(device, "cubeFill", "cubemapFill.wgsl");
  const cubeStitchMod = await loadCompute(device, "cubeStitch", "cubemapStitch.wgsl");
  const cubeViewMod = await loadCompute(device, "cubeView", "cubemapView.wgsl");
  const overlayPanoMod = await loadCompute(device, "overlayPano", "debugOverlay.wgsl");
  const overlayCubeMod = await loadCompute(device, "overlayCube", "debugOverlayCube.wgsl");
  const blitMod = await loadCompute(device, "blit", "blit.wgsl");

  const frameLayout = device.createBindGroupLayout({
    label: "frame",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const classicTablesLayout = device.createBindGroupLayout({
    label: "classicTables",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });

  const mapsLayout = device.createBindGroupLayout({
    label: "maps",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
    ],
  });

  const classicOutLayout = device.createBindGroupLayout({
    label: "classicOut",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "r32uint", viewDimension: "2d" },
      },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });

  const panoLutLayout = device.createBindGroupLayout({
    label: "panoLut",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });

  const mipsLayout = device.createBindGroupLayout({
    label: "mips",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
    ],
  });

  const panoOutLayout = device.createBindGroupLayout({
    label: "panoOut",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "r32uint", viewDimension: "2d" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "r32float", viewDimension: "2d" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "r32uint", viewDimension: "2d" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "r32uint", viewDimension: "2d" },
      },
    ],
  });

  const viewLutLayout = device.createBindGroupLayout({
    label: "viewLut",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });

  const panoSampleLayout = device.createBindGroupLayout({
    label: "panoSample",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
    ],
  });

  const viewOutLayout = device.createBindGroupLayout({
    label: "viewOut",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "r32uint", viewDimension: "2d" },
      },
    ],
  });

  const blitLayout = device.createBindGroupLayout({
    label: "blit",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "uint" } },
    ],
  });

  const cubeSampleLayout = device.createBindGroupLayout({
    label: "cubeSample",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "uint", viewDimension: "2d-array" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "uint", viewDimension: "2d-array" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "uint", viewDimension: "2d-array" },
      },
    ],
  });

  const cubeSkyLayout = device.createBindGroupLayout({
    label: "cubeSky",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });

  const classicLayout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, classicTablesLayout, mapsLayout, classicOutLayout],
  });

  const classicPipe = device.createComputePipeline({
    label: "classic",
    layout: classicLayout,
    compute: { module: classicMod, entryPoint: "main" },
  });

  let frustumSpacePipe = classicPipe;
  try {
    device.pushErrorScope("validation");
    const pipe = device.createComputePipeline({
      label: "frustumSpace",
      layout: classicLayout,
      compute: { module: frustumSpaceMod, entryPoint: "main" },
    });
    const pipeErr = await device.popErrorScope();
    if (pipeErr) {
      console.warn("frustumSpace pipeline failed:", pipeErr.message);
    } else {
      frustumSpacePipe = pipe;
    }
  } catch (err) {
    try {
      await device.popErrorScope();
    } catch {
      void 0;
    }
    console.warn("frustumSpace pipeline failed:", err);
  }

  const genPipe = device.createComputePipeline({
    label: "panoGen",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, panoLutLayout, mipsLayout, panoOutLayout],
    }),
    compute: { module: genMod, entryPoint: "main" },
  });

  const viewPipe = device.createComputePipeline({
    label: "panoView",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, viewLutLayout, panoSampleLayout, viewOutLayout],
    }),
    compute: { module: viewMod, entryPoint: "main" },
  });

  const cubeGenPipe = device.createComputePipeline({
    label: "cubeGen",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, mipsLayout, panoOutLayout],
    }),
    compute: { module: cubeGenMod, entryPoint: "main" },
  });

  const cubePolarPipe = device.createComputePipeline({
    label: "cubePolar",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, mipsLayout, panoOutLayout],
    }),
    compute: { module: cubePolarMod, entryPoint: "main" },
  });

  const cubeFillPipe = device.createComputePipeline({
    label: "cubeFill",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, panoOutLayout],
    }),
    compute: { module: cubeFillMod, entryPoint: "main" },
  });

  const cubeStitchPipe = device.createComputePipeline({
    label: "cubeStitch",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, cubeSampleLayout, panoOutLayout],
    }),
    compute: { module: cubeStitchMod, entryPoint: "main" },
  });

  const cubeViewPipe = device.createComputePipeline({
    label: "cubeView",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, cubeSampleLayout, viewOutLayout, cubeSkyLayout],
    }),
    compute: { module: cubeViewMod, entryPoint: "main" },
  });

  const overlayPanoPipe = device.createComputePipeline({
    label: "overlayPano",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, panoSampleLayout, viewOutLayout],
    }),
    compute: { module: overlayPanoMod, entryPoint: "overlayPano" },
  });

  const overlayCubePipe = device.createComputePipeline({
    label: "overlayCube",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, cubeSampleLayout, viewOutLayout],
    }),
    compute: { module: overlayCubeMod, entryPoint: "overlayCube" },
  });

  const blitPipe = device.createRenderPipeline({
    label: "blit",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [blitLayout],
    }),
    vertex: { module: blitMod, entryPoint: "vs" },
    fragment: {
      module: blitMod,
      entryPoint: "fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  return {
    classic: classicPipe,
    frustumSpace: frustumSpacePipe,
    generate: genPipe,
    view: viewPipe,
    cubeGenerate: cubeGenPipe,
    cubePolar: cubePolarPipe,
    cubeFill: cubeFillPipe,
    cubeStitch: cubeStitchPipe,
    cubeView: cubeViewPipe,
    overlayPano: overlayPanoPipe,
    overlayCube: overlayCubePipe,
    blit: blitPipe,
    layouts: {
      frame: frameLayout,
      classicTables: classicTablesLayout,
      maps: mapsLayout,
      classicOut: classicOutLayout,
      panoLut: panoLutLayout,
      mips: mipsLayout,
      panoOut: panoOutLayout,
      viewLut: viewLutLayout,
      panoSample: panoSampleLayout,
      viewOut: viewOutLayout,
      cubeSample: cubeSampleLayout,
      cubeSky: cubeSkyLayout,
      blit: blitLayout,
    },
    workgroup1d: 64,
    workgroup2d: 16,
  };
}
