typedef unsigned int u32;
typedef unsigned char u8;
typedef int i32;

extern u8 __heap_base;

static u32 heap_top;
static u8 *g_lut;
static u8 *g_apply;
static i32 g_mode;

__attribute__((export_name("grade_reset"))) void grade_reset(void) {
  heap_top = (u32)(unsigned long)&__heap_base;
  g_lut = 0;
  g_apply = 0;
  g_mode = 0;
}

__attribute__((export_name("grade_top"))) i32 grade_top(void) {
  return (i32)heap_top;
}

__attribute__((export_name("grade_alloc"))) i32 grade_alloc(i32 bytes) {
  u32 p = (heap_top + 15u) & ~15u;
  heap_top = p + (u32)bytes;
  return (i32)p;
}

__attribute__((export_name("grade_bind"))) void grade_bind(i32 lut_ptr, i32 apply_ptr, i32 mode) {
  g_lut = (u8 *)lut_ptr;
  g_apply = (u8 *)apply_ptr;
  g_mode = mode;
}

__attribute__((export_name("grade_pixels"))) void grade_pixels(i32 src_ptr, i32 dst_ptr, i32 count) {
  u32 *src = (u32 *)src_ptr;
  u32 *dst = (u32 *)dst_ptr;
  u8 *lut = g_lut;
  i32 i;
  if (g_mode == 0) {
    for (i = 0; i < count; i = (i + 1) | 0) {
      u32 p = src[i];
      u32 r = p & 255u;
      u32 g = (p >> 8) & 255u;
      u32 b = (p >> 16) & 255u;
      dst[i] = (p & 0xff000000u) | ((u32)lut[512 + b] << 16) |
               ((u32)lut[256 + g] << 8) | (u32)lut[r];
    }
    return;
  }
  if (g_mode == 2) {
    for (i = 0; i < count; i = (i + 1) | 0) {
      u32 p = src[i];
      u32 r = p & 255u;
      u32 g = (p >> 8) & 255u;
      u32 b = (p >> 16) & 255u;
      u32 y = (r + (g << 1) + b) >> 2;
      dst[i] = (p & 0xff000000u) | ((u32)lut[512 + y] << 16) |
               ((u32)lut[256 + y] << 8) | (u32)lut[y];
    }
    return;
  }
  {
    u8 *apply = g_apply;
    for (i = 0; i < count; i = (i + 1) | 0) {
      u32 p = src[i];
      u32 r = p & 255u;
      u32 g = (p >> 8) & 255u;
      u32 b = (p >> 16) & 255u;
      u32 row = ((r + (g << 1) + b) >> 2) << 8;
      dst[i] = (p & 0xff000000u) | ((u32)apply[131072u + (row | b)] << 16) |
               ((u32)apply[65536u + (row | g)] << 8) | (u32)apply[row | r];
    }
  }
}
