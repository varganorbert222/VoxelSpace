struct Params {
  viewportI: vec4<i32>,
  cameraQ: vec4<i32>,
  cameraWorld: vec4<f32>,
  forwardQ: vec4<i32>,
  rightQ: vec4<i32>,
  upQ: vec4<i32>,
  projectionF: vec4<f32>,
  projectionI: vec4<i32>,
  environment: vec4<f32>,
  detailLightI: vec4<i32>,
  passes: array<vec4<i32>,11>,
};
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var heightTex: texture_2d<u32>;
@group(0) @binding(2) var colorTex: texture_2d<u32>;
@group(0) @binding(3) var detailMapTex: texture_2d<u32>;
@group(0) @binding(4) var detailPackedTex: texture_2d<u32>;
@group(0) @binding(5) var nearBasePalTex: texture_2d<u32>;
@group(0) @binding(6) var detailPalTex: texture_2d<u32>;
@group(0) @binding(7) var voxPalTex: texture_2d<u32>;
@group(0) @binding(8) var cloudTex: texture_2d<u32>;
@group(0) @binding(9) var skyTableTex: texture_2d<f32>;
@group(0) @binding(10) var outTex: texture_storage_2d<r32uint,write>;
struct SkyRow { a: vec4<u32>, b: vec4<u32> };
@group(0) @binding(11) var<storage,read> skyRows: array<SkyRow>;
@group(0) @binding(12) var ownerTex: texture_storage_2d<r32uint,write>;
@group(0) @binding(13) var vmaxTex: texture_2d<u32>;
struct VMaxStats {
  helperCalls: atomic<u32>, helperReentries: atomic<u32>, vmaxLookups: atomic<u32>, skippedFine: atomic<u32>,
  passMaxPixel: array<atomic<u32>,11>,
};
@group(0) @binding(14) var<storage,read_write> vmaxStats: VMaxStats;
// Retail Df.exe scan state is exactly 0x30 bytes per two-pixel column pair:
// +00 distance cursor, +04 done flag, +08 screen-row cursor, +0c..14 XYZ,
// +18..20 step XYZ, +24..2c accumulated vertical delta XYZ.
struct ScanState {
  scanIndex:i32, done:i32, sy:i32, posX:i32,
  posY:i32, posZ:i32, stepX:i32, stepY:i32,
  stepZ:i32, accX:i32, accY:i32, accZ:i32,
};
@group(0) @binding(15) var<storage,read_write> scanStates: array<ScanState>;
fn recordDescriptorCoverage(passId:u32,sy:i32,x:i32,width:i32){
  if(sy>=0){atomicMax(&vmaxStats.passMaxPixel[passId],u32(sy*width+x));}
}
// Water is a separate post-pass in Df.exe. When active we preserve the terrain ray-Z
// at each written pixel so the post-pass can make the same front/behind decision.
@group(0) @binding(16) var waterDepthTex: texture_storage_2d<r32uint,write>;
@group(0) @binding(17) var<storage,read> terrainDepthLUT: array<u32>;
override PASS_ID:u32=0u;

fn fixedMulQ20(a:i32,b:i32)->i32{
  let ah=a>>16u; let bh=b>>16u;
  let al=i32(bitcast<u32>(a)&65535u); let bl=i32(bitcast<u32>(b)&65535u);
  let lowHi=i32((u32(al)*u32(bl))>>16u);
  let cross=ah*bl+al*bh;
  return ((ah*bh)<<12u)+((cross+lowHi)>>4u);
}
fn fixedMulQ16(a:i32,b:i32)->i32{
  let al=i32(bitcast<u32>(a)&65535u); let ah=a>>16u;
  let bl=i32(bitcast<u32>(b)&65535u); let bh=b>>16u;
  let low=i32((u32(al)*u32(bl))>>16u);
  return low+ah*bl+al*bh+((ah*bh)<<16u);
}
fn scanStoreSar2(v:i32)->i32{return (v+2)>>2u;}
fn scaledScanStep(v:i32,scale:f32)->i32{let q=scanStoreSar2(v);if(abs(scale-1.0)<0.0000001){return q;}return i32(f32(q)*scale);}
fn qCell(q:i32)->u32{return bitcast<u32>(q)>>22u;}
fn mapMask()->i32{return p.projectionI.w;}
fn wrapCell(q:i32)->i32{
  let cell=i32(qCell(q));
  let mask=mapMask();
  if(p.detailLightI.a!=0){return cell&mask;}
  if(q<0){return 0;}
  if(cell>mask){return mask;}
  return cell;
}
fn neighborCell(cell:i32)->i32{
  let mask=mapMask();
  if(p.detailLightI.a!=0){return (cell+1)&mask;}
  return min(cell+1,mask);
}
fn subBits(subdiv:i32)->u32{if(subdiv==16){return 4u;}if(subdiv==8){return 3u;}if(subdiv==4){return 2u;}return 1u;}
fn detailLevel(subdiv:i32)->i32{if(subdiv==16){return 0;}if(subdiv==8){return 1;}if(subdiv==4){return 2;}return 3;}
fn paletteRGB(texel:vec4<u32>)->vec3<i32>{return vec3<i32>(i32(texel.r),i32(texel.g),i32(texel.b));}
fn nearPal(idx:u32)->vec3<i32>{return paletteRGB(textureLoad(nearBasePalTex,vec2<i32>(i32(idx&255u),0),0));}
fn detailPal(idx:u32)->vec3<i32>{return paletteRGB(textureLoad(detailPalTex,vec2<i32>(i32(idx&255u),0),0));}
fn voxPal(idx:u32,row:i32)->vec3<i32>{return paletteRGB(textureLoad(voxPalTex,vec2<i32>(i32(idx&255u),row),0));}
fn detailPackedQ(qx:i32,qy:i32,subdiv:i32)->u32{
  let bits=subBits(subdiv);let mask=u32(subdiv-1);
  let x=wrapCell(qx);let y=wrapCell(qy);
  let cx=i32((bitcast<u32>(qx)>>(22u-bits))&mask);let cy=i32((bitcast<u32>(qy)>>(22u-bits))&mask);
  let tile=textureLoad(detailMapTex,vec2<i32>(x,y),0).x&255u;
  return textureLoad(detailPackedTex,vec2<i32>(cx,i32(tile)*subdiv+cy),detailLevel(subdiv)).x;
}
fn cachedHeightQ20(qx:i32,qy:i32,subdiv:i32)->i32{
  let bits=subBits(subdiv);let mask=u32(subdiv-1);
  let x0=wrapCell(qx);let y0=wrapCell(qy);let x1=neighborCell(x0);let y1=neighborCell(y0);
  let cx=i32((bitcast<u32>(qx)>>(22u-bits))&mask);let cy=i32((bitcast<u32>(qy)>>(22u-bits))&mask);
  let den=subdiv<<1u;let wx=(cx<<1u)+1;let wy=(cy<<1u)+1;let iwX=den-wx;let iwY=den-wy;
  let h00=i32(textureLoad(heightTex,vec2<i32>(x0,y0),0).x);let h10=i32(textureLoad(heightTex,vec2<i32>(x1,y0),0).x);
  let h01=i32(textureLoad(heightTex,vec2<i32>(x0,y1),0).x);let h11=i32(textureLoad(heightTex,vec2<i32>(x1,y1),0).x);
  let a=h00*iwX+h10*wx;let b=h01*iwX+h11*wx;let numerator=a*iwY+b*wy;
  let qShift=18-i32(bits<<1u);var out=numerator<<u32(qShift);
  let d=detailPackedQ(qx,qy,subdiv);let e=i32((d>>16u)&255u);if(e>=128){out+=((e-128)<<15u);}return out;
}
fn shadeChannel(base:i32,lightTarget:i32,shade:i32)->i32{
  // Exact behavior of the original Near WASM/DF detail-shade path.
  // The byte is not one continuous 0..255 lerp: the retail integer path has
  // four distinct ranges with discontinuities at 64/65 and 191/192.
  if(shade==0||shade==128){return base;}
  var out=base;
  if(shade<=64){
    out=base+((base*shade)>>7u);
  }else if(shade<128){
    out=(base*shade)>>7u;
  }else if(shade<192){
    out=base+(((lightTarget-base)*(shade-128))>>7u);
  }else{
    out=base+(((base-lightTarget)*(256-shade))>>7u);
  }
  return clamp(out,0,255);
}
fn retailLerpByte(a:i32,b:i32,frac:i32,bits:u32)->i32{
  let aa=(a*257)>>bits;
  let bb=(b*257)>>bits;
  return ((a*257+(bb-aa)*frac)>>8u)&255;
}
fn retailNearBaseByte(p00:i32,p10:i32,p01:i32,p11:i32,cx:i32,cy:i32,subdiv:i32,bits:u32)->i32{
  // Df.exe 0x489FF0 (Near16), 0x48A9C0 (Near8), and 0x48B420 (Near4)
  // quantize each vertical edge to bytes first, then interpolate horizontally
  // across those quantized bytes. The order matters because the intermediate
  // pack-to-byte loses precision.
  if(subdiv==16||subdiv==8||subdiv==4){
    let left=retailLerpByte(p00,p01,cy,bits);
    let right=retailLerpByte(p10,p11,cy,bits);
    return retailLerpByte(left,right,cx,bits);
  }
  // Df.exe 0x48BEDD..0x48BF18: Near2 is a separate retail-specialized path.
  // Its four cached colors are p00, half(p00,p10), half(p00,p01), and
  // half(p00,p11); the (1,1) sample is deliberately diagonal, not bilinear.
  if(subdiv==2){
    if(cy==0){return select(p00,(p10>>1u)+(p00>>1u),cx!=0);}
    return select((p01>>1u)+(p00>>1u),(p11>>1u)+(p00>>1u),cx!=0);
  }
  let top=retailLerpByte(p00,p10,cx,bits);
  let bottom=retailLerpByte(p01,p11,cx,bits);
  return retailLerpByte(top,bottom,cy,bits);
}
fn cachedColorBytes(qx:i32,qy:i32,subdiv:i32)->vec3<i32>{
  let bits=subBits(subdiv);let mask=u32(subdiv-1);
  let x0=wrapCell(qx);let y0=wrapCell(qy);let x1=neighborCell(x0);let y1=neighborCell(y0);
  let cx=i32((bitcast<u32>(qx)>>(22u-bits))&mask);let cy=i32((bitcast<u32>(qy)>>(22u-bits))&mask);
  let p00=nearPal(textureLoad(colorTex,vec2<i32>(x0,y0),0).x);let p10=nearPal(textureLoad(colorTex,vec2<i32>(x1,y0),0).x);
  let p01=nearPal(textureLoad(colorTex,vec2<i32>(x0,y1),0).x);let p11=nearPal(textureLoad(colorTex,vec2<i32>(x1,y1),0).x);
  var c=vec3<i32>(
    retailNearBaseByte(p00.r,p10.r,p01.r,p11.r,cx,cy,subdiv,bits),
    retailNearBaseByte(p00.g,p10.g,p01.g,p11.g,cx,cy,subdiv,bits),
    retailNearBaseByte(p00.b,p10.b,p01.b,p11.b,cx,cy,subdiv,bits)
  );
  let d=detailPackedQ(qx,qy,subdiv);let shade=i32((d>>8u)&255u);let ci=d&255u;
  // Retail has a special shade==0 path: a nonzero SNIP_C index replaces the
  // interpolated terrain color outright instead of entering the 50/50 blend.
  if(shade==0){if(ci!=0u){return detailPal(ci);}return c;}
  c=vec3<i32>(shadeChannel(c.r,p.detailLightI.r,shade),shadeChannel(c.g,p.detailLightI.g,shade),shadeChannel(c.b,p.detailLightI.b,shade));
  if(ci!=0u){let dc=detailPal(ci);c=vec3<i32>((c.r>>1u)+(dc.r>>1u),(c.g>>1u)+(dc.g>>1u),(c.b>>1u)+(dc.b>>1u));}
  return clamp(c,vec3<i32>(0),vec3<i32>(255));
}
// Retail Direct0..Direct5 audit: Df.exe 0x48C440 patches the 32-bit fast path
// at 0x458BFE with mip-dependent masks/shifts. Its linear texel address is
// exactly q>>(22+mip), wrapped to 1024>>mip. Height is a point-sampled byte
// shifted by 20. The true-color palette pointer is base + (mip<<11), so the
// Direct fog/VoxPal bank is exactly the terrain mip number.
fn directCoordQ(qx:i32,qy:i32,mip:u32)->vec2<i32>{
  let size=u32(mapMask()+1)>>mip;
  if(p.detailLightI.a!=0){
    let ix=(qCell(qx)>>mip)&(size-1u);let iy=(qCell(qy)>>mip)&(size-1u);
    return vec2<i32>(i32(ix),i32(iy));
  }
  let ix=u32(wrapCell(qx))>>mip;let iy=u32(wrapCell(qy))>>mip;
  let limit=size-1u;
  return vec2<i32>(i32(min(ix,limit)),i32(min(iy,limit)));
}
fn directHeightQ20(qx:i32,qy:i32,mip:u32)->i32{return (i32(textureLoad(heightTex,directCoordQ(qx,qy,mip),i32(mip)).x)<<20u);}
fn directColorBytes(qx:i32,qy:i32,mip:u32,bank:i32)->vec3<i32>{let ci=textureLoad(colorTex,directCoordQ(qx,qy,mip),i32(mip)).x;return voxPal(ci,bank);}
fn passHeightQ20(passId:u32,qx:i32,qy:i32)->i32{if(passId<5u){return cachedHeightQ20(qx,qy,p.passes[passId].z);}return directHeightQ20(qx,qy,u32(p.passes[passId].w));}
fn passColorBytes(passId:u32,qx:i32,qy:i32)->vec3<i32>{if(passId<5u){return cachedColorBytes(qx,qy,p.passes[passId].z);}return directColorBytes(qx,qy,u32(p.passes[passId].w),i32(passId)-5);}
fn vmaxLevelForPass(passId:u32)->u32{
  if(passId<4u){return 0u;}
  if(passId==4u){return 1u;}
  // Df.exe 0x48C45F/0x4592E8/0x459392: Direct mip m uses the VMax
  // hierarchy at m+2. Direct0..5 therefore map to VMax levels 2..7.
  return min(9u,(passId-5u)+2u);
}
fn vmaxHeightQ20(passId:u32,qx:i32,qy:i32)->i32{
  let level=vmaxLevelForPass(passId);
  let c=directCoordQ(qx,qy,level);
  return i32(textureLoad(vmaxTex,c,i32(level)).x)<<20u;
}
fn coarseShiftForPass(passId:u32)->u32{
  if(passId<2u){return 4u;}
  if(passId==2u){return 3u;}
  // Direct setup stores helper shift 2 at params+0x28; 0x459392 uses it
  // for a four-fine-step coarse advance and backs up one block on exit.
  return 2u;
}
fn helperFinePeriodForPass(passId:u32)->u32{
  // Cached true-color path (Df.exe 0x458F14): the scalar counter at 0x456FE4
  // is patched to 1 << (1 << coarseShift), giving 65536, 256, 16, 16.
  if(passId<2u){return 65536u;}
  if(passId==2u){return 256u;}
  if(passId<5u){return 16u;}
  // Direct true-color path (Df.exe 0x458BFE) does NOT use that scalar cadence.
  // It carries the residual MMX mm7 token from the preceding cached path. In the
  // normal Near2 -> Direct sequence the low lane is < 0x100, and 0x458D82's
  // psrld mm7,30 clears it after the mandatory entry helper. Therefore Direct0..5
  // do not periodically re-enter 0x459392 during the fine scan. Keep only the
  // descriptor-entry helper by making the fine threshold unreachable here.
  return 0xffffffffu;
}
fn debugColor(passId:u32,c:vec3<i32>)->vec3<i32>{let mode=p.projectionI.z;if(mode==0||mode==2){return c;}if(mode==3){return select(vec3<i32>(255,80,70),vec3<i32>(40,230,90),passId<5u);}let colors=array<vec3<i32>,11>(vec3<i32>(255,70,70),vec3<i32>(255,145,50),vec3<i32>(255,225,55),vec3<i32>(120,235,70),vec3<i32>(30,210,150),vec3<i32>(50,195,255),vec3<i32>(70,115,255),vec3<i32>(145,80,255),vec3<i32>(220,70,240),vec3<i32>(255,65,155),vec3<i32>(245,245,245));return colors[min(passId,10u)];}
fn byteLuma(c:vec3<i32>)->i32{return (c.r+(c.g<<1u)+c.b)>>2u;}
fn packRgb(c:vec3<i32>)->vec4<u32>{
  let r=u32(clamp(c.r,0,255));
  let g=u32(clamp(c.g,0,255));
  let b=u32(clamp(c.b,0,255));
  // Framebuffer words are ImageData order: R in the low byte.
  return vec4<u32>(r|(g<<8u)|(b<<16u)|(255u<<24u),0u,0u,0u);
}
fn storeBytes(x:i32,y:i32,c:vec3<i32>){textureStore(outTex,vec2<i32>(x,y),packRgb(c));}
fn terrainDepth16(scanIndex:i32)->u32{
  // ScanState's cursor is the same depth-table pointer index used by the x86
  // rasterizers. Index 0 is the camera-distance entry; the fine loop increments
  // before sampling, just as 0x458D8C advances EBP by four bytes.
  if(scanIndex<0){return 65535u;}
  return terrainDepthLUT[u32(scanIndex)]&65535u;
}

fn skyColor(pair:i32,y:i32)->vec4<u32>{
  let row=skyRows[u32(y)];let mode=row.a.x;
  if(mode==0u){return packRgb(vec3<i32>(0,0,0));}
  if(mode==1u){return packRgb(vec3<i32>(p.environment.rgb*255.0+vec3<f32>(0.5)));}
  let mip=row.a.y;let size=512u>>mip;
  let uq=bitcast<i32>(row.a.z)+pair*bitcast<i32>(row.b.x);let vq=bitcast<i32>(row.a.w)+pair*bitcast<i32>(row.b.y);
  let u=bitcast<u32>(uq>>16u)&(size-1u);let vv=bitcast<u32>(vq>>16u)&(size-1u);
  let level=textureLoad(cloudTex,vec2<i32>(i32(u),i32(vv)),i32(mip)).x&63u;let gradRow=row.b.z>>6u;
  let rgb=textureLoad(skyTableTex,vec2<i32>(i32(level),i32(gradRow)),0).rgb;
  return packRgb(vec3<i32>(rgb*255.0+vec3<f32>(0.5)));
}
@compute @workgroup_size(64,1,1)
fn initFrame(@builtin(global_invocation_id) gid:vec3<u32>){
  let width=p.viewportI.x;let height=p.viewportI.y;let pair=i32(gid.x);let x=pair*2;if(x>=width){return;}
  for(var y=0;y<height;y++){
    let c0=skyColor(pair,y);textureStore(outTex,vec2<i32>(x,y),c0);if(p.viewportI.w!=0){textureStore(waterDepthTex,vec2<i32>(x,y),vec4<u32>(65535u,0u,0u,0u));}
    if(p.projectionI.z==2){textureStore(ownerTex,vec2<i32>(x,y),vec4<u32>(255u,0u,0u,0u));}
    if(x+1<width){
      textureStore(outTex,vec2<i32>(x+1,y),c0);if(p.viewportI.w!=0){textureStore(waterDepthTex,vec2<i32>(x+1,y),vec4<u32>(65535u,0u,0u,0u));}if(p.projectionI.z==2){textureStore(ownerTex,vec2<i32>(x+1,y),vec4<u32>(255u,0u,0u,0u));}
    }
  }
  let cx=width>>1u;let cy=height>>1u;let invF=p.projectionI.x;let hQ=(x-cx)*invF;let bottomV=(cy-(height-1))*invF;
  // forwardQ is pre-scaled on the CPU by focal*trunc(2^20/focal), preserving
  // the retail sub-unit Q20 loss without adding three fixed-point multiplies
  // to the GPU init shader.
  let rayX=p.forwardQ.x+fixedMulQ20(p.rightQ.x,hQ)+fixedMulQ20(p.upQ.x,bottomV);
  let rayY=p.forwardQ.y+fixedMulQ20(p.rightQ.y,hQ)+fixedMulQ20(p.upQ.y,bottomV);
  let rayZ=p.forwardQ.z+fixedMulQ20(p.upQ.z,bottomV);
  let firstStep=p.projectionF.y;
  var st:ScanState;
  st.scanIndex=0;st.done=0;st.sy=height-1;
  st.posX=p.cameraQ.x;st.posY=p.cameraQ.y;st.posZ=p.cameraQ.z;
  st.stepX=scaledScanStep(rayX,firstStep);st.stepY=scaledScanStep(rayY,firstStep);st.stepZ=scaledScanStep(rayZ,firstStep);
  st.accX=0;st.accY=0;st.accZ=0;
  scanStates[gid.x]=st;
}

@compute @workgroup_size(64,1,1)
fn terrainPass(@builtin(global_invocation_id) gid:vec3<u32>){
  let width=p.viewportI.x;let height=p.viewportI.y;let pair=i32(gid.x);let x=pair*2;if(x>=width){return;}
  let passId=PASS_ID;
  var st=scanStates[gid.x];
  // Completed columns bypass descriptor work, but 0x4892E0 still scans their persistent record.
  if(st.done!=0){recordDescriptorCoverage(passId,st.sy,x,width);return;}
  var sy=st.sy;var scanIndex=st.scanIndex;var posX=st.posX;var posY=st.posY;var posZ=st.posZ;
  var stepX=st.stepX;var stepY=st.stepY;var stepZ=st.stepZ;
  var accX=st.accX;var accY=st.accY;var accZ=st.accZ;
  let invF=p.projectionI.x;let firstStep=p.projectionF.y;
  let rowX=-fixedMulQ20(p.upQ.x,invF);let rowY=-fixedMulQ20(p.upQ.y,invF);let rowZ=-fixedMulQ20(p.upQ.z,invF);
  var deltaX=scaledScanStep(rowX,firstStep);var deltaY=scaledScanStep(rowY,firstStep);var deltaZ=scaledScanStep(rowZ,firstStep);
  if(passId>0u){
    for(var q=0u;q<passId;q++){
      let dscale=p.passes[q].y;deltaX=fixedMulQ16(deltaX,dscale);deltaY=fixedMulQ16(deltaY,dscale);deltaZ=fixedMulQ16(deltaZ,dscale);
    }
    // Retail scales +18/+1c/+20 at the end of the previous descriptor. Doing it
    // here is state-equivalent, while preserving the retail rule that done columns
    // are never scaled again.
    let scale=p.passes[passId-1u].y;stepX=fixedMulQ16(stepX,scale);stepY=fixedMulQ16(stepY,scale);stepZ=fixedMulQ16(stepZ,scale);
  }
  // Df.exe 0x458D04..0x458D1D and 0x45971A..0x459733 test this once
  // when entering a descriptor, not after every fine sample.
  if(posZ>0x10000000&&stepZ>=0){st.done=1;st.stepX=stepX;st.stepY=stepY;st.stepZ=stepZ;scanStates[gid.x]=st;recordDescriptorCoverage(passId,st.sy,x,width);return;}
  let endScan=p.passes[passId].x;
  let coarseShift=coarseShiftForPass(passId);let coarseScale=1u<<coarseShift;let helperPeriod=helperFinePeriodForPass(passId);
  let coarseDeltaX=deltaX<<coarseShift;let coarseDeltaY=deltaY<<coarseShift;let coarseDeltaZ=deltaZ<<coarseShift;
  var advance=true;var done=false;
  var helperPending=true;var fineSinceHelper=0u;var helperHasRun=false;
  var statHelper=0u;var statReentry=0u;var statVmax=0u;var statSkipped=0u;
  for(var iter=0u;iter<48000u;iter++){
    if(done||sy<0){break;}
    if(advance){
      if(helperPending){
        let coarseStepX=stepX<<coarseShift;let coarseStepY=stepY<<coarseShift;let coarseStepZ=stepZ<<coarseShift;
        var coarseMoves=0u;statHelper++;
        if(helperHasRun){statReentry++;}else{helperHasRun=true;}
        for(var coarseIter=0u;coarseIter<48000u;coarseIter++){
          posX+=coarseStepX;posY+=coarseStepY;posZ+=coarseStepZ;
          accX+=coarseDeltaX;accY+=coarseDeltaY;accZ+=coarseDeltaZ;
          scanIndex+=i32(coarseScale);coarseMoves++;statVmax++;
          let vmaxZ=vmaxHeightQ20(passId,posX,posY);
          if(posZ<vmaxZ||scanIndex>endScan){break;}
        }
        posX-=coarseStepX;posY-=coarseStepY;posZ-=coarseStepZ;
        accX-=coarseDeltaX;accY-=coarseDeltaY;accZ-=coarseDeltaZ;
        scanIndex-=i32(coarseScale);
        if(coarseMoves>1u){statSkipped+=(coarseMoves-1u)*coarseScale;}
        helperPending=false;fineSinceHelper=0u;
      }
      scanIndex++;posX+=stepX;posY+=stepY;posZ+=stepZ;accX+=deltaX;accY+=deltaY;accZ+=deltaZ;fineSinceHelper++;
    }
    var terrainZ=passHeightQ20(passId,posX,posY);
    if(passId<5u){terrainZ=terrainZ&(-65536);}
    if(posZ<terrainZ){
      let baseC=passColorBytes(passId,posX,posY);var c=debugColor(passId,baseC);storeBytes(x,sy,c);if(p.viewportI.w!=0){textureStore(waterDepthTex,vec2<i32>(x,sy),vec4<u32>(terrainDepth16(scanIndex),0u,0u,0u));}
      if(p.projectionI.z==2){textureStore(ownerTex,vec2<i32>(x,sy),vec4<u32>(passId,0u,0u,0u));}
      if(x+1<width){
        storeBytes(x+1,sy,c);if(p.viewportI.w!=0){textureStore(waterDepthTex,vec2<i32>(x+1,sy),vec4<u32>(terrainDepth16(scanIndex),0u,0u,0u));}if(p.projectionI.z==2){textureStore(ownerTex,vec2<i32>(x+1,sy),vec4<u32>(passId,0u,0u,0u));}
      }
      sy--;
      // Retail hit rewind, e.g. Df.exe 0x458DD9..0x458E09, happens even
      // when this write filled the last visible row.
      // pos -= acc; step -= rowDelta; pos -= step; acc -= rowDelta; cursor--.
      posX-=accX;posY-=accY;posZ-=accZ;stepX-=deltaX;stepY-=deltaY;stepZ-=deltaZ;
      posX-=stepX;posY-=stepY;posZ-=stepZ;accX-=deltaX;accY-=deltaY;accZ-=deltaZ;scanIndex--;
      if(sy<0){done=true;break;}
      advance=false;fineSinceHelper=0u;helperPending=false;continue;
    }
    // Retail checks the descriptor endpoint only after testing the current sample
    // (0x458E29/0x459867). Thus the first sample beyond the endpoint is intentional.
    if(scanIndex>endScan){break;}
    advance=true;if(fineSinceHelper>=helperPeriod){helperPending=true;}
  }
  st.scanIndex=scanIndex;st.done=select(0,1,done);st.sy=sy;
  st.posX=posX;st.posY=posY;st.posZ=posZ;st.stepX=stepX;st.stepY=stepY;st.stepZ=stepZ;st.accX=accX;st.accY=accY;st.accZ=accZ;
  scanStates[gid.x]=st;
  recordDescriptorCoverage(passId,sy,x,width);
  atomicAdd(&vmaxStats.helperCalls,statHelper);atomicAdd(&vmaxStats.helperReentries,statReentry);atomicAdd(&vmaxStats.vmaxLookups,statVmax);atomicAdd(&vmaxStats.skippedFine,statSkipped);
}