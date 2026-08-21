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
  const genMod = await loadCompute(device, "panoGenerate", "panoramaGenerate.wgsl");
  const viewMod = await loadCompute(device, "panoView", "panoramaView.wgsl");
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

  const classicPipe = device.createComputePipeline({
    label: "classic",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, classicTablesLayout, mapsLayout, classicOutLayout],
    }),
    compute: { module: classicMod, entryPoint: "main" },
  });

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
    generate: genPipe,
    view: viewPipe,
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
      blit: blitLayout,
    },
    workgroup1d: 64,
    workgroup2d: 16,
  };
}
