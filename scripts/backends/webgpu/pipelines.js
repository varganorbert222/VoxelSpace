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

async function loadCompute(device, label, file, onStatus, extras) {
  if (onStatus) {
    onStatus("Compiling shader", label);
  }
  const common = await loadText("./shaders/common.wgsl");
  const body = await loadText("./shaders/" + file);
  const parts = [common];
  for (const extra of extras || []) {
    parts.push(await loadText("./shaders/" + extra));
  }
  parts.push(body);
  return compileShader(device, label, parts.join("\n"));
}

async function loadBlit(device, onStatus) {
  if (onStatus) {
    onStatus("Compiling shader", "blit");
  }
  return compileShader(device, "blit", await loadText("./shaders/blit.wgsl"));
}

export async function createPipelines(device, canvasFormat, onStatus) {
  const classicMod = await loadCompute(
    device,
    "classicMarch",
    "classicMarch.wgsl",
    onStatus,
    ["retailSky.wgsl", "detailBindMaps.wgsl", "detailSample.wgsl"]
  );
  let frustumSpaceMod = classicMod;
  try {
    frustumSpaceMod = await loadCompute(
      device,
      "frustumSpaceMarch",
      "frustumSpaceMarch.wgsl",
      onStatus,
      ["retailSky.wgsl", "detailBindMaps.wgsl", "detailSample.wgsl"]
    );
  } catch (err) {
    console.warn("frustumSpaceMarch compile failed:", err);
  }
  const voxelMod = await loadCompute(device, "voxelRay", "voxelRay.wgsl", onStatus, [
    "detailBindMips1.wgsl",
    "detailSample.wgsl",
  ]);
  let skyCompositeMod = null;
  try {
    skyCompositeMod = await loadCompute(
      device,
      "skyComposite",
      "skyComposite.wgsl",
      onStatus,
      ["retailSky.wgsl"]
    );
  } catch (err) {
    console.warn("skyComposite compile failed:", err);
  }
  const blitMod = await loadBlit(device, onStatus);

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
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
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

  const mipsLayout = device.createBindGroupLayout({
    label: "mips",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
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

  let skyCompositeLayout = null;
  let skyCompositePipe = null;
  if (skyCompositeMod) {
    try {
      device.pushErrorScope("validation");
      const layout = device.createBindGroupLayout({
        label: "skyComposite",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: "read-write", format: "r32uint", viewDimension: "2d" },
          },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        ],
      });
      const pipe = device.createComputePipeline({
        label: "skyComposite",
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: skyCompositeMod, entryPoint: "main" },
      });
      const pipeErr = await device.popErrorScope();
      if (pipeErr) {
        console.warn("skyComposite pipeline failed:", pipeErr.message);
      } else {
        skyCompositeLayout = layout;
        skyCompositePipe = pipe;
      }
    } catch (err) {
      try {
        await device.popErrorScope();
      } catch {
        void 0;
      }
      console.warn("skyComposite pipeline failed:", err);
    }
  }

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

  const voxelPipe = device.createComputePipeline({
    label: "voxelRay",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameLayout, mipsLayout, viewOutLayout],
    }),
    compute: { module: voxelMod, entryPoint: "main" },
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
    voxel: voxelPipe,
    skyComposite: skyCompositePipe,
    blit: blitPipe,
    layouts: {
      frame: frameLayout,
      classicTables: classicTablesLayout,
      maps: mapsLayout,
      classicOut: classicOutLayout,
      mips: mipsLayout,
      viewOut: viewOutLayout,
      skyComposite: skyCompositeLayout,
      blit: blitLayout,
    },
    workgroup1d: 64,
    workgroup2d: 16,
  };
}
