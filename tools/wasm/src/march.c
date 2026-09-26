/* VoxelSpace march kernels -- wasm32, no libc. Values for quality / LOD / fog
 * tables are supplied by JS (scripts/constants). Do not grow a second set. */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef int i32;
typedef short i16;
typedef double f64;

#define WASM_EXPORT __attribute__((visibility("default")))

static inline f64 wasm_sqrt(f64 x) { return __builtin_sqrt(x); }

extern unsigned char __heap_base;

static u32 g_bump;
static u32 g_mark;
static u32 g_mem_end;

static i32 g_map_w;
static i32 g_map_h;
static i32 g_map_shift;
static f64 g_altitude;
static f64 g_max_height;
static f64 g_max_slope;
static f64 g_alt_scale;
static i32 g_mip_count;
static u8 *g_mip_h[16];
static u32 *g_mip_c[16];
static i32 g_mip_w[16];
static i32 g_mip_ht[16];
static i32 g_mip_sh[16];
static i32 g_mip_wmask[16];
static i32 g_mip_hmask[16];

static i32 g_pixel_offsets[16];
static f64 g_lod_deltas[16];
static f64 g_lod_fracs[16];
static i32 g_lod_n;
static i32 g_lod_delta_n;
static i32 g_lod_frac_n;
static i32 g_lerp_height;
static i32 g_filter_color;
static f64 g_filter_distance = 500.0;
static f64 g_fwd_x = 0.0;
static f64 g_fwd_y = -1.0;
static i32 g_lod0_refine;
static i32 g_step_divisor;
static f64 g_refine_sw[4];

static i32 g_detail_on;
static f64 g_detail_ends[5];
static i32 g_detail_light[3];
static u8 *g_detail_char;
static i32 g_detail_char_w;
static i32 g_detail_char_h;
static u32 *g_detail_mips[4];
static u8 *g_detail_pal;
static f64 g_detail_pack_x;
static f64 g_detail_pack_y;
static f64 g_detail_pack_dist;
static u32 g_detail_pack_val;
static i32 g_detail_pack_valid;

static f64 *g_tan_min;
static i32 g_tan_len;
static i16 *g_yhit;
static i16 *g_yhit_sin;
static i32 g_yhit_len;
static f64 *g_atan;
static i32 g_atan_len;
static u32 *g_sky;
static i32 g_sky_len;

static f64 T_PI;
static f64 T_HALF_PI;
static f64 T_EPSILON;
static f64 T_HALF;
static f64 T_INV_TWO_PI;
static f64 T_MIN_SAMPLE;
static f64 T_FOG_SAT;
static f64 T_FOG_START;
static f64 T_NON_REPEAT_GROUND;
static f64 T_MIP_STEP_SCALE;
static f64 T_YHIT_SCALE;
static f64 T_PIXEL_CENTER;
static f64 T_NDC_SCALE;
static u32 T_WHITE;
static u32 T_UNFILLED;
static i32 T_SHIFT_A;
static i32 T_SHIFT_R;
static i32 T_SHIFT_G;
static i32 T_CHAN_MASK;
static i32 T_CHAN_MAX;
static i32 T_YHIT_LAST;
static i32 T_ATAN_LAST;
static f64 T_HEIGHTMAP_MAX;

static u32 align8(u32 n) {
  return (n + 7u) & ~7u;
}

static i32 ensure_mem(u32 need) {
  if (need <= g_mem_end) {
    return 1;
  }
  u32 pages = (need - g_mem_end + 65535u) >> 16;
  i32 old = __builtin_wasm_memory_grow(0, pages);
  if (old < 0) {
    return 0;
  }
  g_mem_end = ((u32)__builtin_wasm_memory_size(0)) << 16;
  return need <= g_mem_end;
}

static void heap_init(void) {
  if (g_bump) {
    return;
  }
  g_bump = align8((u32)(unsigned long)&__heap_base);
  g_mark = g_bump;
  g_mem_end = ((u32)__builtin_wasm_memory_size(0)) << 16;
}

WASM_EXPORT i32 alloc(i32 n) {
  heap_init();
  if (n < 0) {
    n = 0;
  }
  u32 size = align8((u32)n);
  u32 ptr = g_bump;
  if (!ensure_mem(ptr + size)) {
    return 0;
  }
  g_bump = ptr + size;
  return (i32)ptr;
}

WASM_EXPORT void reset_all(void) {
  heap_init();
  g_bump = align8((u32)(unsigned long)&__heap_base);
  g_mark = g_bump;
}

WASM_EXPORT void commit_perm(void) {
  g_mark = g_bump;
}

WASM_EXPORT void reset_scratch(void) {
  heap_init();
  g_bump = g_mark;
}

WASM_EXPORT void set_tunables(
    f64 pi,
    f64 half_pi,
    f64 epsilon,
    f64 half,
    f64 inv_two_pi,
    f64 min_sample,
    f64 fog_sat,
    f64 non_repeat_ground,
    f64 mip_step_scale,
    f64 yhit_scale,
    f64 pixel_center,
    f64 ndc_scale,
    f64 heightmap_max,
    i32 white,
    i32 unfilled,
    i32 shift_a,
    i32 shift_r,
    i32 shift_g,
    i32 chan_mask,
    i32 chan_max,
    i32 yhit_last,
    i32 atan_last) {
  T_PI = pi;
  T_HALF_PI = half_pi;
  T_EPSILON = epsilon;
  T_HALF = half;
  T_INV_TWO_PI = inv_two_pi;
  T_MIN_SAMPLE = min_sample;
  T_FOG_SAT = fog_sat;
  T_NON_REPEAT_GROUND = non_repeat_ground;
  T_MIP_STEP_SCALE = mip_step_scale;
  T_YHIT_SCALE = yhit_scale;
  T_PIXEL_CENTER = pixel_center;
  T_NDC_SCALE = ndc_scale;
  T_HEIGHTMAP_MAX = heightmap_max;
  T_WHITE = (u32)white;
  T_UNFILLED = (u32)unfilled;
  T_SHIFT_A = shift_a;
  T_SHIFT_R = shift_r;
  T_SHIFT_G = shift_g;
  T_CHAN_MASK = chan_mask;
  T_CHAN_MAX = chan_max;
  T_YHIT_LAST = yhit_last;
  T_ATAN_LAST = atan_last;
}

WASM_EXPORT void set_classic_tables(
    i32 offsets_ptr,
    i32 offset_n,
    i32 deltas_ptr,
    i32 delta_n,
    i32 fracs_ptr,
    i32 frac_n) {
  i32 i;
  i32 *off = (i32 *)offsets_ptr;
  f64 *del = (f64 *)deltas_ptr;
  f64 *frac = (f64 *)fracs_ptr;
  g_lod_n = offset_n;
  if (g_lod_n > 16) {
    g_lod_n = 16;
  }
  g_lod_delta_n = delta_n;
  if (g_lod_delta_n > 16) {
    g_lod_delta_n = 16;
  }
  g_lod_frac_n = frac_n;
  if (g_lod_frac_n > 16) {
    g_lod_frac_n = 16;
  }
  for (i = 0; i < g_lod_n; i++) {
    g_pixel_offsets[i] = off[i];
  }
  for (i = 0; i < g_lod_delta_n; i++) {
    g_lod_deltas[i] = del[i];
  }
  for (i = 0; i < g_lod_frac_n; i++) {
    g_lod_fracs[i] = frac[i];
  }
}

static inline f64 wasm_floor(f64 x) {
  i32 i = (i32)x;
  f64 t = (f64)i;
  if (x >= 0.0 || t == x) {
    return t;
  }
  return t - 1.0;
}

static inline f64 wasm_ceil(f64 x) {
  i32 i = (i32)x;
  f64 t = (f64)i;
  if (x <= 0.0 || t == x) {
    return t;
  }
  return t + 1.0;
}

static inline u8 height_at_sv(u8 *map, i32 x, i32 y, i32 wmask, i32 hmask, i32 shift, i32 wrap) {
  if (wrap) {
    y &= wmask;
    x &= hmask;
  } else {
    if (x < 0) {
      x = 0;
    }
    if (y < 0) {
      y = 0;
    }
    if (x > hmask) {
      x = hmask;
    }
    if (y > wmask) {
      y = wmask;
    }
  }
  return map[((y << shift) + x) | 0];
}

static inline u32 lerp_named(u32 c0, u32 c1, f64 t);

static inline u32 lerp_packed(u32 c0, u32 c1, i32 t) {
  u32 mask = 0x00ff00ffu;
  u32 u = (u32)t;
  u32 v = 256u - u;
  u32 rb = (((c0 & mask) * v + (c1 & mask) * u) >> 8) & mask;
  u32 ag = ((((c0 >> 8) & mask) * v + ((c1 >> 8) & mask) * u) >> 8) & mask;
  return (ag << 8) | rb;
}

static inline u32 bilinear_packed4(
    u32 c00, u32 c10, u32 c01, u32 c11, f64 fx, f64 fy) {
  i32 tx = (i32)(fx * 256.0);
  i32 ty = (i32)(fy * 256.0);
  if (tx < 0) {
    tx = 0;
  } else if (tx > 256) {
    tx = 256;
  }
  if (ty < 0) {
    ty = 0;
  } else if (ty > 256) {
    ty = 256;
  }
  return lerp_packed(lerp_packed(c00, c10, tx), lerp_packed(c01, c11, tx), ty);
}

static __attribute__((always_inline)) f64 sample_sv_height(
    u8 *map,
    f64 x,
    f64 y,
    i32 wmask,
    i32 hmask,
    i32 shift,
    i32 wrap,
    i32 lerp,
    u32 *h_byte,
    i32 *nn_off) {
  i32 ix = (i32)x;
  i32 iy = (i32)y;
  i32 off = (((iy & wmask) << shift) + (ix & hmask)) | 0;
  u8 base = map[off];
  f64 h00;
  f64 h10;
  f64 h01;
  f64 h11;
  f64 fx;
  f64 fy;
  f64 h;
  i32 b;
  *nn_off = off;
  if (!lerp) {
    *h_byte = (u32)base;
    return (f64)base;
  }
  fx = x - wasm_floor(x);
  fy = y - wasm_floor(y);
  ix = (i32)wasm_floor(x);
  iy = (i32)wasm_floor(y);
  h00 = (f64)height_at_sv(map, ix, iy, wmask, hmask, shift, wrap);
  h10 = (f64)height_at_sv(map, ix + 1, iy, wmask, hmask, shift, wrap);
  h01 = (f64)height_at_sv(map, ix, iy + 1, wmask, hmask, shift, wrap);
  h11 = (f64)height_at_sv(map, ix + 1, iy + 1, wmask, hmask, shift, wrap);
  h = h00 + (h10 - h00) * fx;
  h = h + ((h01 + (h11 - h01) * fx) - h) * fy;
  b = (i32)(h + 0.5);
  if (b < 0) {
    b = 0;
  }
  if (b > 255) {
    b = 255;
  }
  *h_byte = (u32)b;
  return h;
}

static inline u32 color_at_sv(u32 *map, i32 x, i32 y, i32 wmask, i32 hmask, i32 shift, i32 wrap) {
  if (wrap) {
    y &= wmask;
    x &= hmask;
  } else {
    if (x < 0) {
      x = 0;
    }
    if (y < 0) {
      y = 0;
    }
    if (x > hmask) {
      x = hmask;
    }
    if (y > wmask) {
      y = wmask;
    }
  }
  return map[((y << shift) + x) | 0];
}

static __attribute__((always_inline)) u32 sample_sv_color(
    u32 *map,
    f64 x,
    f64 y,
    i32 wmask,
    i32 hmask,
    i32 shift,
    i32 wrap,
    i32 filter,
    i32 nn_off) {
  i32 ix;
  i32 iy;
  f64 x0;
  f64 y0;
  if (!filter) {
    return map[nn_off];
  }
  x0 = wasm_floor(x);
  y0 = wasm_floor(y);
  ix = (i32)x0;
  iy = (i32)y0;
  return bilinear_packed4(
      color_at_sv(map, ix, iy, wmask, hmask, shift, wrap),
      color_at_sv(map, ix + 1, iy, wmask, hmask, shift, wrap),
      color_at_sv(map, ix, iy + 1, wmask, hmask, shift, wrap),
      color_at_sv(map, ix + 1, iy + 1, wmask, hmask, shift, wrap),
      x - x0,
      y - y0);
}

/* LOD 0 refine cell is 1, 1/2, 1/4, 1/8, 1/16. The stored band step is the
   1 m cell divided by Step, so the refine step is that times the cell. */
static f64 lod0_step(f64 base_step, f64 t) {
  i32 m = 0;
  i32 subdiv;
  if (!g_lod0_refine) {
    return base_step;
  }
  while ((m < 4) && (t >= g_refine_sw[m])) {
    m = (m + 1) | 0;
  }
  subdiv = 16 >> m;
  if (subdiv < 1) {
    subdiv = 1;
  }
  return base_step * (1.0 / (f64)subdiv);
}

static void band_limits(i32 mip, f64 t, f64 *lo, f64 *cap) {
  f64 div = g_step_divisor > 0 ? (f64)g_step_divisor : 3.0;
  f64 cell;
  if (g_lod0_refine && (mip == 0)) {
    cell = lod0_step(1.0, t);
  } else {
    cell = (f64)(1 << mip);
  }
  if (!(cell > 0.0)) {
    cell = 1.0;
  }
  *cap = cell;
  *lo = cell / div;
  if (!(*lo > 0.0)) {
    *lo = cell;
  }
}

static f64 fit_step(f64 step, f64 lo, f64 cap) {
  if (!(step >= lo)) {
    step = lo;
  }
  if (step > cap) {
    step = cap;
  }
  return step;
}

WASM_EXPORT void set_sample_flags(
    i32 height_lerp,
    i32 color_filter,
    f64 filter_distance,
    f64 fwd_x,
    f64 fwd_y,
    i32 lod0_refine,
    i32 step_divisor,
    f64 refine_sw0,
    f64 refine_sw1,
    f64 refine_sw2,
    f64 refine_sw3) {
  if (step_divisor < 1) {
    g_step_divisor = 3;
  } else if (step_divisor > 5) {
    g_step_divisor = 5;
  } else {
    g_step_divisor = step_divisor;
  }
  g_lerp_height = height_lerp ? 1 : 0;
  g_filter_color = color_filter ? 1 : 0;
  if (filter_distance < 10.0) {
    g_filter_distance = 10.0;
  } else if (filter_distance > 1000.0) {
    g_filter_distance = 1000.0;
  } else {
    g_filter_distance = filter_distance;
  }
  g_fwd_x = fwd_x;
  g_fwd_y = fwd_y;
  g_lod0_refine = lod0_refine ? 1 : 0;
  g_refine_sw[0] = refine_sw0;
  g_refine_sw[1] = refine_sw1;
  g_refine_sw[2] = refine_sw2;
  g_refine_sw[3] = refine_sw3;
}

WASM_EXPORT void set_fog_range(f64 fog_start) {
  T_FOG_START = fog_start;
}

WASM_EXPORT void set_detail_maps(
    i32 char_ptr,
    i32 char_w,
    i32 char_h,
    i32 mip0,
    i32 mip1,
    i32 mip2,
    i32 mip3,
    i32 pal_ptr) {
  g_detail_char = char_ptr ? (u8 *)char_ptr : 0;
  g_detail_char_w = char_w;
  g_detail_char_h = char_h;
  g_detail_mips[0] = mip0 ? (u32 *)mip0 : 0;
  g_detail_mips[1] = mip1 ? (u32 *)mip1 : 0;
  g_detail_mips[2] = mip2 ? (u32 *)mip2 : 0;
  g_detail_mips[3] = mip3 ? (u32 *)mip3 : 0;
  g_detail_pal = pal_ptr ? (u8 *)pal_ptr : 0;
  g_detail_pack_valid = 0;
}

WASM_EXPORT void set_detail_frame(
    i32 show,
    f64 e0,
    f64 e1,
    f64 e2,
    f64 e3,
    f64 e4,
    i32 light_r,
    i32 light_g,
    i32 light_b) {
  g_detail_on = show && g_detail_char && g_detail_mips[0] && g_detail_pal ? 1 : 0;
  g_detail_ends[0] = e0;
  g_detail_ends[1] = e1;
  g_detail_ends[2] = e2;
  g_detail_ends[3] = e3;
  g_detail_ends[4] = e4;
  g_detail_light[0] = light_r;
  g_detail_light[1] = light_g;
  g_detail_light[2] = light_b;
  g_detail_pack_valid = 0;
}

static i32 detail_wrap_floor(f64 v, i32 size) {
  i32 n = size;
  i32 i;
  if (n <= 0) {
    return 0;
  }
  i = (i32)__builtin_floor(v);
  i %= n;
  if (i < 0) {
    i += n;
  }
  return i;
}

static i32 detail_level_at(f64 dist) {
  f64 far_end;
  i32 band;
  if (!g_detail_on) {
    return -1;
  }
  far_end = g_detail_ends[4];
  if (!(far_end > 0.0) || dist > far_end) {
    return -1;
  }
  band = 0;
  while (band < 4 && dist > g_detail_ends[band]) {
    band = (band + 1) | 0;
  }
  if (band <= 1) {
    return 0;
  }
  if (band == 2) {
    return 1;
  }
  if (band == 3) {
    return 2;
  }
  return 3;
}

static i32 detail_in_range(f64 dist) {
  return detail_level_at(dist) >= 0;
}

static f64 detail_elev_max(f64 dist) {
  return detail_in_range(dist) ? (127.0 / 32.0) : 0.0;
}

static u32 sample_detail_packed(f64 x, f64 y, f64 dist) {
  i32 level;
  i32 subdiv;
  i32 ix;
  i32 iy;
  i32 tile;
  i32 cx;
  i32 cy;
  i32 last;
  i32 idx;
  u32 *mip;
  f64 fx;
  f64 fy;
  if (g_detail_pack_valid && x == g_detail_pack_x && y == g_detail_pack_y &&
      dist == g_detail_pack_dist) {
    return g_detail_pack_val;
  }
  level = detail_level_at(dist);
  if (level < 0) {
    g_detail_pack_valid = 0;
    return 0;
  }
  mip = g_detail_mips[level];
  if (!mip || !g_detail_char) {
    g_detail_pack_valid = 0;
    return 0;
  }
  ix = detail_wrap_floor(x, g_detail_char_w);
  iy = detail_wrap_floor(y, g_detail_char_h);
  tile = g_detail_char[(iy * g_detail_char_w + ix) | 0] | 0;
  subdiv = 16 >> level;
  if (subdiv < 1) {
    subdiv = 1;
  }
  fx = x - __builtin_floor(x);
  fy = y - __builtin_floor(y);
  last = (subdiv - 1) | 0;
  cx = (i32)__builtin_floor(fx * (f64)subdiv);
  cy = (i32)__builtin_floor(fy * (f64)subdiv);
  if (cx < 0) {
    cx = 0;
  }
  if (cy < 0) {
    cy = 0;
  }
  if (cx > last) {
    cx = last;
  }
  if (cy > last) {
    cy = last;
  }
  idx = ((tile * subdiv + cy) * subdiv + cx) | 0;
  g_detail_pack_x = x;
  g_detail_pack_y = y;
  g_detail_pack_dist = dist;
  g_detail_pack_val = mip[idx];
  g_detail_pack_valid = 1;
  return g_detail_pack_val;
}

static f64 detail_height_add(f64 x, f64 y, f64 dist) {
  u32 packed;
  u32 elev;
  if (!detail_in_range(dist)) {
    return 0.0;
  }
  packed = sample_detail_packed(x, y, dist);
  elev = (packed >> 16) & 255u;
  if (elev < 128u) {
    return 0.0;
  }
  return ((f64)(elev - 128u)) / 32.0;
}

static i32 detail_shade_byte(i32 base, i32 light, i32 shade) {
  i32 out;
  if (shade == 0 || shade == 128) {
    return base;
  }
  out = base;
  if (shade <= 64) {
    out = base + ((base * shade) >> 7);
  } else if (shade < 128) {
    out = (base * shade) >> 7;
  } else if (shade < 192) {
    out = base + (((light - base) * (shade - 128)) >> 7);
  } else {
    out = base + (((base - light) * (256 - shade)) >> 7);
  }
  if (out < 0) {
    return 0;
  }
  if (out > 255) {
    return 255;
  }
  return out;
}

static u32 apply_detail(u32 color, f64 x, f64 y, f64 dist) {
  u32 packed;
  i32 shade;
  i32 ci;
  i32 r;
  i32 g;
  i32 b;
  i32 a;
  if (!detail_in_range(dist) || !g_detail_pal) {
    return color;
  }
  packed = sample_detail_packed(x, y, dist);
  shade = (i32)((packed >> 8) & 255u);
  ci = (i32)(packed & 255u);
  a = (i32)((color >> (u32)T_SHIFT_A) & (u32)T_CHAN_MASK);
  if (shade == 0) {
    if (!ci) {
      return color;
    }
    return ((u32)a << (u32)T_SHIFT_A) |
           ((u32)g_detail_pal[(ci << 2)] << (u32)T_SHIFT_R) |
           ((u32)g_detail_pal[(ci << 2) + 1] << (u32)T_SHIFT_G) |
           (u32)g_detail_pal[(ci << 2) + 2];
  }
  r = detail_shade_byte(
      (i32)((color >> (u32)T_SHIFT_R) & (u32)T_CHAN_MASK),
      g_detail_light[0],
      shade);
  g = detail_shade_byte(
      (i32)((color >> (u32)T_SHIFT_G) & (u32)T_CHAN_MASK),
      g_detail_light[1],
      shade);
  b = detail_shade_byte(
      (i32)(color & (u32)T_CHAN_MASK), g_detail_light[2], shade);
  if (ci) {
    r = (r >> 1) + ((i32)g_detail_pal[(ci << 2)] >> 1);
    g = (g >> 1) + ((i32)g_detail_pal[(ci << 2) + 1] >> 1);
    b = (b >> 1) + ((i32)g_detail_pal[(ci << 2) + 2] >> 1);
  }
  return ((u32)a << (u32)T_SHIFT_A) | ((u32)r << (u32)T_SHIFT_R) |
         ((u32)g << (u32)T_SHIFT_G) | (u32)b;
}

WASM_EXPORT void set_map_info(
    i32 map_w,
    i32 map_h,
    i32 map_shift,
    f64 altitude,
    f64 max_height,
    f64 max_slope,
    i32 mip_count) {
  g_map_w = map_w;
  g_map_h = map_h;
  g_map_shift = map_shift;
  g_altitude = altitude;
  g_max_height = max_height;
  g_max_slope = max_slope > 0.0 ? max_slope : altitude;
  g_alt_scale = T_HEIGHTMAP_MAX != 0.0 ? altitude / T_HEIGHTMAP_MAX : 0.0;
  g_mip_count = mip_count;
  if (g_mip_count < 1) {
    g_mip_count = 1;
  }
  if (g_mip_count > 16) {
    g_mip_count = 16;
  }
}

WASM_EXPORT void set_map_level(
    i32 level,
    i32 height_ptr,
    i32 color_ptr,
    i32 width,
    i32 height,
    i32 shift) {
  if (level < 0 || level > 15) {
    return;
  }
  g_mip_h[level] = (u8 *)height_ptr;
  g_mip_c[level] = (u32 *)color_ptr;
  g_mip_w[level] = width;
  g_mip_ht[level] = height;
  g_mip_sh[level] = shift;
  g_mip_wmask[level] = (width - 1) | 0;
  g_mip_hmask[level] = (height - 1) | 0;
}

WASM_EXPORT void set_luts(
    i32 tan_ptr,
    i32 tan_len,
    i32 yhit_ptr,
    i32 yhit_sin_ptr,
    i32 yhit_len,
    i32 atan_ptr,
    i32 atan_len,
    i32 sky_ptr,
    i32 sky_len) {
  g_tan_min = (f64 *)tan_ptr;
  g_tan_len = tan_len;
  g_yhit = (i16 *)yhit_ptr;
  g_yhit_sin = (i16 *)yhit_sin_ptr;
  g_yhit_len = yhit_len;
  g_atan = (f64 *)atan_ptr;
  g_atan_len = atan_len;
  g_sky = (u32 *)sky_ptr;
  g_sky_len = sky_len;
}

static inline u32 fog_pack(u32 color, f64 fog_t) {
  u32 a = (color >> (u32)T_SHIFT_A) & (u32)T_CHAN_MASK;
  u32 r = (color >> (u32)T_SHIFT_R) & (u32)T_CHAN_MASK;
  u32 g = (color >> (u32)T_SHIFT_G) & (u32)T_CHAN_MASK;
  u32 b = color & (u32)T_CHAN_MASK;
  f64 maxc = (f64)T_CHAN_MAX;
  return ((u32)(a + (maxc - (f64)a) * fog_t) << (u32)T_SHIFT_A) |
         ((u32)(r + (maxc - (f64)r) * fog_t) << (u32)T_SHIFT_R) |
         ((u32)(g + (maxc - (f64)g) * fog_t) << (u32)T_SHIFT_G) |
         (u32)(b + (maxc - (f64)b) * fog_t);
}

static inline u32 pack_named(u32 r, u32 g, u32 b) {
  return ((u32)T_CHAN_MAX << (u32)T_SHIFT_A) | (r << (u32)T_SHIFT_R) |
         (g << (u32)T_SHIFT_G) | b;
}

static inline u32 lerp_named(u32 c0, u32 c1, f64 t) {
  u32 a0 = (c0 >> (u32)T_SHIFT_A) & (u32)T_CHAN_MASK;
  u32 r0 = (c0 >> (u32)T_SHIFT_R) & (u32)T_CHAN_MASK;
  u32 g0 = (c0 >> (u32)T_SHIFT_G) & (u32)T_CHAN_MASK;
  u32 b0 = c0 & (u32)T_CHAN_MASK;
  u32 a1 = (c1 >> (u32)T_SHIFT_A) & (u32)T_CHAN_MASK;
  u32 r1 = (c1 >> (u32)T_SHIFT_R) & (u32)T_CHAN_MASK;
  u32 g1 = (c1 >> (u32)T_SHIFT_G) & (u32)T_CHAN_MASK;
  u32 b1 = c1 & (u32)T_CHAN_MASK;
  return ((u32)((f64)a0 + ((f64)a1 - (f64)a0) * t) << (u32)T_SHIFT_A) |
         ((u32)((f64)r0 + ((f64)r1 - (f64)r0) * t) << (u32)T_SHIFT_R) |
         ((u32)((f64)g0 + ((f64)g1 - (f64)g0) * t) << (u32)T_SHIFT_G) |
         (u32)((f64)b0 + ((f64)b1 - (f64)b0) * t);
}

static u32 encode_unit(f64 t) {
  u32 black = pack_named(0, 0, 0);
  u32 white = pack_named(255, 255, 255);
  if (!(t > 0.0)) {
    return black;
  }
  if (t >= 1.0) {
    return white;
  }
  return lerp_named(black, white, t);
}

static u32 encode_height(u32 byte) {
  f64 b = (f64)(byte & 255u);
  return encode_unit(b / 255.0);
}

static u32 encode_iter(i32 iter) {
  u32 red = pack_named(0, 0, 255);
  u32 orange = pack_named(0, 160, 255);
  u32 yellow = pack_named(0, 255, 255);
  u32 purple = pack_named(255, 0, 144);
  u32 magenta = pack_named(255, 0, 255);
  f64 t;
  if (iter <= 0) {
    return pack_named(0, 0, 0);
  }
  if (iter >= 256) {
    return magenta;
  }
  t = (f64)iter / 256.0;
  if (t <= 0.25) {
    return lerp_named(red, orange, t / 0.25);
  }
  if (t <= 0.5) {
    return lerp_named(orange, yellow, (t - 0.25) / 0.25);
  }
  if (t <= 0.75) {
    return lerp_named(yellow, purple, (t - 0.5) / 0.25);
  }
  return lerp_named(purple, magenta, (t - 0.75) / 0.25);
}

#define DEBUG_COLOR 0
#define DEBUG_HEIGHT 1
#define DEBUG_DEPTH 2
#define DEBUG_ITER 3
#define SAMPLE_N_MAX 8192
static i32 g_sample_n[SAMPLE_N_MAX];

static void draw_vertical_line(
    u32 *pixels,
    i32 stride,
    i32 x,
    i32 ytop,
    i32 ybottom,
    u32 col,
    i32 width,
    i32 x_end) {
  i32 j;
  i32 k;
  i32 offset;
  x = x | 0;
  ytop = ytop | 0;
  ybottom = ybottom | 0;
  if (ytop < 0) {
    ytop = 0;
  }
  if (ytop > ybottom) {
    return;
  }
  for (j = 0; (j < width) & (x + j < x_end); j = (j + 1) | 0) {
    offset = (ytop * stride + x + j) | 0;
    for (k = ytop; k < ybottom; k = (k + 1) | 0) {
      pixels[offset] = col;
      offset = (offset + stride) | 0;
    }
  }
}

WASM_EXPORT void classic_columns(
    i32 start_column,
    i32 end_column,
    i32 screen_width,
    i32 screen_height,
    f64 cam_x,
    f64 cam_y,
    f64 cam_z,
    f64 sin_angle,
    f64 cos_angle,
    f64 tan_half_fov_x,
    f64 dst_to_proj,
    f64 screen_horizon,
    f64 near_clip,
    f64 far_clip,
    f64 min_delta_z,
    f64 step_growth,
    f64 step_scale,
    i32 apply_fog,
    i32 repeat,
    i32 fill_unfilled,
    i32 pixels_ptr,
    i32 pixel_width,
    i32 hidden_ptr,
    i32 row_colors_ptr,
    i32 debug_view,
    i32 lerp_height,
    i32 filter_color,
    f64 pixel_budget) {
  g_lerp_height = lerp_height ? 1 : 0;
  g_filter_color = filter_color ? 1 : 0;
  i32 do_lerp = g_lerp_height;
  i32 do_filter = g_filter_color;
  u32 *pixels = (u32 *)pixels_ptr;
  i32 *hidden_y = (i32 *)hidden_ptr;
  u8 *height_map = g_mip_h[0];
  u32 *color_map = g_mip_c[0];
  i32 local_width = (end_column - start_column) | 0;
  i32 stride = pixel_width;
  f64 fog_range = far_clip - T_FOG_START;
  f64 inv_fog = fog_range == 0.0 ? 0.0 : 1.0 / fog_range;
  i32 use_fog = apply_fog | 0;
  f64 ceiling = g_max_height;
  f64 ceiling_sdf = cam_z - ceiling;
  f64 y_ground = cam_z + T_NON_REPEAT_GROUND;
  f64 clearance = 0.0;
  if (g_mip_h[0] && (g_map_w > 0)) {
    i32 cx = (i32)cam_x;
    i32 cy = (i32)cam_y;
    i32 wmask = (g_map_w - 1) | 0;
    i32 hmask = (g_map_h - 1) | 0;
    if (cx < 0) {
      cx = 0;
    }
    if (cy < 0) {
      cy = 0;
    }
    if (cx > hmask) {
      cx = hmask;
    }
    if (cy > wmask) {
      cy = wmask;
    }
    f64 under = (f64)g_mip_h[0][((cy << g_map_shift) + cx) | 0] * g_alt_scale;
    clearance = cam_z - under;
    if (clearance < 0.0) {
      clearance = 0.0;
    }
  }
  i32 map_w_mask = (g_map_w - 1) | 0;
  i32 map_h_mask = (g_map_h - 1) | 0;
  i32 lod_shift = g_map_shift;
  i32 lod;
  i32 i;
  i32 n;
  f64 deltas[16];
  f64 lod_distances[17];
  f64 z_start;
  f64 screen_width_scaler;
  f64 k_right_x;
  f64 k_right_y;
  f64 k_left_x;
  f64 k_left_y;
  f64 k_dx;
  f64 k_dy;

  i32 debug = debug_view | 0;
  i32 count_iter = debug == DEBUG_ITER;
  i32 sample_ok = count_iter && (local_width <= SAMPLE_N_MAX);
  if (sample_ok) {
    for (i = 0; i < local_width; i = (i + 1) | 0) {
      g_sample_n[i] = 0;
    }
  }

  if (row_colors_ptr) {
    u32 *rows = (u32 *)row_colors_ptr;
    i32 y;
    i32 x;
    for (y = 0; y < screen_height; y = (y + 1) | 0) {
      u32 col = rows[y];
      i32 row = (y * stride) | 0;
      for (x = 0; x < local_width; x = (x + 1) | 0) {
        pixels[row + x] = col;
      }
    }
  } else if (fill_unfilled) {
    n = (local_width * screen_height) | 0;
    for (i = 0; i < n; i = (i + 1) | 0) {
      pixels[i] = T_UNFILLED;
    }
  }

  deltas[0] = min_delta_z * step_scale;
  for (i = 0; i < g_lod_delta_n; i = (i + 1) | 0) {
    deltas[i + 1] = g_lod_deltas[i];
  }

  z_start = near_clip;
  if (!(z_start > 0.0)) {
    z_start = 0.0;
  }
  lod_distances[0] = z_start;
  for (i = 0; i < g_lod_frac_n; i = (i + 1) | 0) {
    lod_distances[i + 1] = g_lod_fracs[i] * far_clip;
  }
  lod_distances[g_lod_n] = far_clip;
  for (i = 1; i < g_lod_n; i = (i + 1) | 0) {
    if (lod_distances[i] < lod_distances[i - 1]) {
      lod_distances[i] = lod_distances[i - 1];
    }
  }

  screen_width_scaler = 1.0 / (f64)screen_width;
  k_right_x = cos_angle * tan_half_fov_x;
  k_right_y = -sin_angle * tan_half_fov_x;
  k_left_x = -sin_angle - k_right_x;
  k_left_y = -cos_angle - k_right_y;
  k_dx = (k_right_x + k_right_x) * screen_width_scaler;
  k_dy = (k_right_y + k_right_y) * screen_width_scaler;

  for (lod = g_lod_n; lod > 0; lod = (lod - 1) | 0) {
    f64 start_index = lod_distances[lod - 1];
    f64 end_index = lod_distances[lod];
    i32 px_offset = g_pixel_offsets[lod - 1];
    f64 step = deltas[lod - 1];
    f64 z;
    i32 mip = (lod - 1) | 0;
    f64 lod_scale;

    if (start_index >= far_clip) {
      continue;
    }
    if (mip >= g_mip_count) {
      mip = (g_mip_count - 1) | 0;
    }
    height_map = g_mip_h[mip];
    color_map = g_mip_c[mip];
    map_w_mask = g_mip_wmask[mip];
    map_h_mask = g_mip_hmask[mip];
    lod_shift = g_mip_sh[mip];
    lod_scale = 1.0 / (f64)(1 << mip);

    for (i = 0; i < local_width; i = (i + 1) | 0) {
      hidden_y[i] = screen_height;
    }

    z = start_index;
    if ((ceiling_sdf > 0.0) & (dst_to_proj > 0.0)) {
      f64 y_span = (f64)screen_height - screen_horizon;
      if (y_span > 1.0) {
        f64 z_enter = ceiling_sdf * dst_to_proj / y_span;
        if (z < z_enter) {
          z = z_enter;
        }
      }
    }
    for (; (z < end_index) & (z < far_clip);) {
      f64 lo;
      f64 cap;
      band_limits(mip, z, &lo, &cap);
      step = fit_step(step, lo, cap);
      {
        f64 y_span = (f64)screen_height - screen_horizon;
        if ((clearance > 1.0) & (z > 0.0)) {
          f64 sdf_cap = clearance;
          if (y_span > 1.0) {
            f64 on_screen = y_span * z / dst_to_proj;
            if (on_screen < sdf_cap) {
              sdf_cap = on_screen;
            }
          }
          if (sdf_cap > 1.0) {
            f64 budget = pixel_budget;
            if (!(budget > 0.0)) {
              budget = 1.0;
            }
            f64 screen_step = z * z / (sdf_cap * dst_to_proj) * budget;
            if (screen_step < 0.001) {
              screen_step = 0.001;
            }
            if (step > screen_step) {
              step = screen_step;
            }
          }
        }
      }
      f64 z_scale = dst_to_proj / z;
      i32 ceiling_on_screen = (i32)(ceiling_sdf * z_scale + screen_horizon);
      i32 ground_on_screen = (i32)(y_ground * z_scale + screen_horizon);
      f64 fog_t_raw = fog_range == 0.0 ? T_FOG_SAT : (z - T_FOG_START) * inv_fog;
      f64 fog_t = fog_t_raw < 0.0 ? 0.0 : fog_t_raw > T_FOG_SAT ? T_FOG_SAT : fog_t_raw;
      i32 fog_white = use_fog & (fog_t >= T_FOG_SAT);
      i32 apply_fog_t = use_fog & (fog_t > 0.0) & (fog_white ^ 1);
      f64 dx = k_dx * z;
      f64 dy = k_dy * z;
      f64 plx = k_left_x * z + cam_x + dx * (f64)start_column;
      f64 ply = k_left_y * z + cam_y + dy * (f64)start_column;
      i32 lerp_now = do_lerp && (mip == 0) && (z <= g_filter_distance);
      i32 filter_now = do_filter && (mip == 0) && (z <= g_filter_distance);
      i32 col;
      i32 slice_open = 0;

      for (col = start_column; col < end_column; col = (col + px_offset) | 0) {
        i32 local_i = (col - start_column) | 0;
        i32 col_hidden = hidden_y[local_i];
        i32 inside;
        i32 is_ok;
        if (col_hidden == 0) {
          plx += dx * (f64)px_offset;
          ply += dy * (f64)px_offset;
          continue;
        }

        inside = (plx >= 0.0) & (plx <= (f64)g_map_w) & (ply >= 0.0) &
                 (ply <= (f64)g_map_h);
        is_ok = inside | (repeat | 0);
        if (!((is_ok & (ceiling_on_screen >= col_hidden)) & (ceiling_sdf <= 0.0))) {
          slice_open = 1;
        }

        if (is_ok) {
          if (ceiling_on_screen >= col_hidden) {
            plx += dx * (f64)px_offset;
            ply += dy * (f64)px_offset;
            continue;
          }

          f64 sx = plx * lod_scale;
          f64 sy = ply * lod_scale;
          i32 nn_off =
              ((((i32)sy & map_w_mask) << lod_shift) +
               ((i32)sx & map_h_mask)) |
              0;
          u32 h_byte_sv;
          f64 h_fine;
          if (lerp_now) {
            h_fine = sample_sv_height(
                height_map,
                sx,
                sy,
                map_w_mask,
                map_h_mask,
                lod_shift,
                repeat,
                1,
                &h_byte_sv,
                &nn_off);
          } else {
            h_byte_sv = height_map[nn_off];
            h_fine = (f64)h_byte_sv;
          }
          {
            f64 bump = detail_elev_max(z);
            f64 y_cap_sdf = cam_z - (h_fine + bump) * g_alt_scale;
            i32 y_cap = (i32)(y_cap_sdf * z_scale + screen_horizon);
            if (y_cap < col_hidden) {
              h_fine += detail_height_add(plx, ply, z);
            }
          }
          f64 terrain_height = h_fine * g_alt_scale;
          f64 terrain_sdf = cam_z - terrain_height;
          if (terrain_sdf > clearance) {
            clearance = terrain_sdf;
          }
          i32 height_on_screen = (i32)(terrain_sdf * z_scale + screen_horizon);
          i32 height_on_screen_bottom = col_hidden;
          u32 plot_color = T_WHITE;
          if (!repeat) {
            if (ground_on_screen < height_on_screen_bottom) {
              height_on_screen_bottom = ground_on_screen;
            }
          }
          if (sample_ok) {
            g_sample_n[local_i] = (g_sample_n[local_i] + 1) | 0;
          }
          if (debug) {
            u32 h_byte = h_byte_sv;
            if (debug == DEBUG_HEIGHT) {
              plot_color = encode_height(h_byte);
            } else if (debug == DEBUG_DEPTH) {
              plot_color = encode_unit(far_clip > 0.0 ? z / far_clip : 0.0);
            } else if (debug == DEBUG_ITER) {
              plot_color = encode_iter(sample_ok ? g_sample_n[local_i] : 0);
            }
          } else if (!fog_white) {
            plot_color = filter_now
                            ? sample_sv_color(
                                  color_map,
                                  sx,
                                  sy,
                                  map_w_mask,
                                  map_h_mask,
                                  lod_shift,
                                  repeat,
                                  1,
                                  nn_off)
                            : color_map[nn_off];
            if (detail_in_range(z)) {
              plot_color = apply_detail(plot_color, plx, ply, z);
            }
            if (apply_fog_t) {
              plot_color = fog_pack(plot_color, fog_t);
            }
          }
          if (height_on_screen < col_hidden) {
            i32 draw_width = px_offset;
            i32 j;
            if (col + draw_width > end_column) {
              draw_width = (end_column - col) | 0;
            }
            draw_vertical_line(
                pixels,
                stride,
                local_i,
                height_on_screen,
                height_on_screen_bottom,
                plot_color,
                draw_width,
                local_width);
            for (j = local_i; (j < local_i + draw_width) & (j < local_width);
                 j = (j + 1) | 0) {
              hidden_y[j] = height_on_screen;
            }
          }
        }

        plx += dx * (f64)px_offset;
        ply += dy * (f64)px_offset;
      }

      if (!slice_open) {
        break;
      }
      z = z + step;
      step = step + step_growth * cap;
      if (step > cap) {
        step = cap;
      }
    }
  }
}



#define FS_DRIFT_SPAN_TEXELS 1.0
#define FS_ROW_LIMIT 1.0e9
#define FS_MAX_COLS 4096
static i32 fs_free_n[FS_MAX_COLS];
static u8 fs_dirty[FS_MAX_COLS];

static u32 fs_terrain_color(
    u32 *color_map,
    f64 plx,
    f64 ply,
    f64 world_x,
    f64 world_y,
    i32 offset,
    i32 use_fine,
    i32 do_filter,
    i32 wrap,
    i32 wmask,
    i32 hmask,
    i32 shift,
    f64 z,
    f64 far_clip,
    f64 fog_t,
    i32 fog_white,
    i32 apply_fog_t,
    i32 debug,
    u32 h_byte,
    i32 iter) {
  u32 plot;
  if (debug) {
    if (debug == DEBUG_HEIGHT) {
      return encode_height(h_byte);
    }
    if (debug == DEBUG_DEPTH) {
      return encode_unit(far_clip > 0.0 ? z / far_clip : 0.0);
    }
    if (debug == DEBUG_ITER) {
      return encode_iter(iter);
    }
    return T_WHITE;
  }
  if (fog_white) {
    return T_WHITE;
  }
  plot = (do_filter & use_fine)
             ? sample_sv_color(
                   color_map, plx, ply, wmask, hmask, shift, wrap, 1, offset)
             : color_map[offset];
  if (detail_in_range(z)) {
    plot = apply_detail(plot, world_x, world_y, z);
  }
  if (apply_fog_t) {
    plot = fog_pack(plot, fog_t);
  }
  return plot;
}

WASM_EXPORT void frustum_space_columns(
    i32 start_column,
    i32 end_column,
    i32 screen_width,
    i32 screen_height,
    f64 cam_x,
    f64 cam_y,
    f64 cam_z,
    f64 right_x,
    f64 right_y,
    f64 right_z,
    f64 up_x,
    f64 up_y,
    f64 up_z,
    f64 fwd_x,
    f64 fwd_y,
    f64 fwd_z,
    f64 tan_half_fov_x,
    f64 dst_to_proj,
    f64 near_clip,
    f64 far_clip,
    f64 min_delta_z,
    f64 step_growth,
    f64 step_scale,
    i32 apply_fog,
    i32 repeat,
    i32 fill_unfilled,
    i32 pixels_ptr,
    i32 pixel_width,
    i32 hidden_ptr,
    i32 cover_ptr,
    i32 row_colors_ptr,
    i32 debug_view,
    i32 lerp_height,
    i32 filter_color) {
  u32 *pixels = (u32 *)pixels_ptr;
  i32 *hidden_y = (i32 *)hidden_ptr;
  u8 *cover = (u8 *)cover_ptr;
  u8 *height_map = g_mip_h[0];
  u32 *color_map = g_mip_c[0];
  i32 local_width = (end_column - start_column) | 0;
  i32 stride = pixel_width;
  f64 fog_range = far_clip - T_FOG_START;
  f64 inv_fog = fog_range == 0.0 ? 0.0 : 1.0 / fog_range;
  i32 use_fog = apply_fog | 0;
  f64 ceiling = g_max_height;
  f64 slope_cap = g_max_slope;
  f64 clip_z = -T_NON_REPEAT_GROUND;
  f64 screen_horizon = (f64)screen_height * T_HALF;
  i32 map_w_mask = (g_map_w - 1) | 0;
  i32 map_h_mask = (g_map_h - 1) | 0;
  i32 wrap = repeat | 0;
  i32 do_lerp = lerp_height ? 1 : 0;
  i32 do_filter = filter_color ? 1 : 0;
  i32 debug = debug_view | 0;
  i32 count_iter = debug == DEBUG_ITER;
  i32 sample_ok = count_iter && (local_width <= SAMPLE_N_MAX);
  i32 lod;
  i32 i;
  i32 n;
  f64 deltas[16];
  f64 lod_distances[17];
  f64 z_start;
  f64 screen_width_scaler;
  f64 inv_h2;
  f64 row_base;
  f64 up_xy;
  f64 xn_step;
  f64 xn0;
  i32 y;
  i32 x;
  i32 live_cols;

  g_lerp_height = do_lerp;
  g_filter_color = do_filter;

  if (sample_ok) {
    for (i = 0; i < local_width; i = (i + 1) | 0) {
      g_sample_n[i] = 0;
    }
  }

  if (row_colors_ptr) {
    u32 *rows = (u32 *)row_colors_ptr;
    for (y = 0; y < screen_height; y = (y + 1) | 0) {
      u32 col = rows[y];
      i32 row = (y * stride) | 0;
      for (x = 0; x < local_width; x = (x + 1) | 0) {
        pixels[row + x] = col;
      }
    }
  } else if (fill_unfilled) {
    n = (local_width * screen_height) | 0;
    for (i = 0; i < n; i = (i + 1) | 0) {
      pixels[i] = T_UNFILLED;
    }
  }

  deltas[0] = min_delta_z * step_scale;
  for (i = 0; i < g_lod_delta_n; i = (i + 1) | 0) {
    deltas[i + 1] = g_lod_deltas[i];
  }
  z_start = near_clip;
  if (!(z_start > 0.0)) {
    z_start = 0.0;
  }
  lod_distances[0] = z_start;
  for (i = 0; i < g_lod_frac_n; i = (i + 1) | 0) {
    lod_distances[i + 1] = g_lod_fracs[i] * far_clip;
  }
  lod_distances[g_lod_n] = far_clip;
  for (i = 1; i < g_lod_n; i = (i + 1) | 0) {
    if (lod_distances[i] < lod_distances[i - 1]) {
      lod_distances[i] = lod_distances[i - 1];
    }
  }
  screen_width_scaler = 1.0 / (f64)screen_width;
  inv_h2 = dst_to_proj == 0.0 ? 0.0 : 1.0 / dst_to_proj;
  row_base = screen_horizon - 0.5;
  up_xy = wasm_sqrt(up_x * up_x + up_y * up_y);
  xn_step = 2.0 * screen_width_scaler;
  xn0 = ((f64)start_column + 0.5) * xn_step - 1.0;

  /* One ray per column. The LOD cell sets the step and Step divides it.
     The first hit paints this row, rewinds one step, and moves up a row. */
  {
    i32 step_budget = (screen_height + 64) | 0;
    i32 band;
    for (band = 0; band < g_lod_n; band = (band + 1) | 0) {
      f64 width = lod_distances[band + 1] - lod_distances[band];
      f64 s = deltas[band];
      if (g_lod0_refine && (band == 0)) {
        s = lod0_step(s, 0.0);
      }
      if (!(s > 0.0)) {
        s = 1.0;
      }
      if (width > 0.0) {
        step_budget = (step_budget + (i32)(width / s) + 1) | 0;
      }
    }
    if (step_budget > 2000000) {
      step_budget = 2000000;
    }
    for (i32 col = start_column; col < end_column; col = (col + 1) | 0) {
      i32 local_i = (col - start_column) | 0;
      i32 sy = (screen_height - 1) | 0;
      f64 t = z_start;
      f64 step = 0.0;
      i32 guard = 0;
      f64 xn = ((f64)col + 0.5) * xn_step - 1.0;
      while ((sy >= 0) & (t < far_clip) & (guard < step_budget)) {
        i32 mip = 0;
        f64 lo;
        f64 cap;
        f64 yn;
        f64 bx;
        f64 by;
        f64 bz;
        f64 wx;
        f64 wy;
        f64 wz;
        i32 inside;
        u8 *lod_height_map;
        u32 *lod_color_map;
        i32 lod_w_mask;
        i32 lod_h_mask;
        i32 lod_shift;
        f64 lod_scale;
        i32 nn_off = 0;
        u32 h_byte = 0;
        f64 h_fine;
        i32 use_fine;
        i32 fine_lerp;
        f64 fog_t;
        i32 fog_white;
        i32 apply_fog_t;
        u32 plot;
        guard = (guard + 1) | 0;
        while (((mip + 1) < g_lod_n) & (t >= lod_distances[mip + 1])) {
          mip = (mip + 1) | 0;
        }
        if (mip >= g_mip_count) {
          mip = (g_mip_count - 1) | 0;
        }
        if (mip < 0) {
          mip = 0;
        }
        band_limits(mip, t, &lo, &cap);
        step = fit_step(step, lo, cap);
        yn = (row_base - (f64)sy) * inv_h2;
        bx = fwd_x + xn * tan_half_fov_x * right_x + yn * up_x;
        by = fwd_y + xn * tan_half_fov_x * right_y + yn * up_y;
        bz = fwd_z + xn * tan_half_fov_x * right_z + yn * up_z;
        wx = cam_x + t * bx;
        wy = cam_y + t * by;
        wz = cam_z + t * bz;
        if ((wz > g_max_height) && !(bz < 0.0)) {
          break;
        }
        inside = (wx >= 0.0) & (wx <= (f64)g_map_w) & (wy >= 0.0) & (wy <= (f64)g_map_h);
        if (!inside && !wrap) {
          t = t + step;
          step = step + step_growth * cap;
          if (step > cap) {
            step = cap;
          }
          continue;
        }
        lod_height_map = g_mip_h[mip];
        lod_color_map = g_mip_c[mip];
        lod_w_mask = g_mip_wmask[mip];
        lod_h_mask = g_mip_hmask[mip];
        lod_shift = g_mip_sh[mip];
        lod_scale = 1.0 / (f64)(1 << mip);
        use_fine = (mip == 0) && (t <= g_filter_distance);
        fine_lerp = do_lerp & (use_fine ? 1 : 0);
        h_fine = sample_sv_height(
            lod_height_map, wx * lod_scale, wy * lod_scale, lod_w_mask, lod_h_mask,
            lod_shift, wrap, fine_lerp, &h_byte, &nn_off);
        {
          f64 bump = detail_elev_max(t) * g_alt_scale;
          if (wz < h_fine * g_alt_scale + bump) {
            h_fine += detail_height_add(wx, wy, t);
          }
        }
        if (sample_ok) {
          g_sample_n[local_i] = (g_sample_n[local_i] + 1) | 0;
        }
        if (wz < h_fine * g_alt_scale) {
          f64 fog_t_raw =
              fog_range == 0.0 ? T_FOG_SAT : (t - T_FOG_START) * inv_fog;
          fog_t = fog_t_raw;
          if (fog_t < 0.0) {
            fog_t = 0.0;
          }
          if (fog_t > T_FOG_SAT) {
            fog_t = T_FOG_SAT;
          }
          fog_white = use_fog & (fog_t >= T_FOG_SAT);
          apply_fog_t = use_fog & (fog_t > 0.0) & (fog_white ^ 1);
          plot = fs_terrain_color(
              lod_color_map, wx * lod_scale, wy * lod_scale, wx, wy, nn_off,
              use_fine ? 1 : 0, do_filter, wrap, lod_w_mask, lod_h_mask, lod_shift,
              t, far_clip, fog_t, fog_white, apply_fog_t, debug, h_byte,
              sample_ok ? g_sample_n[local_i] : guard);
          pixels[(sy * stride + local_i) | 0] = plot;
          sy = (sy - 1) | 0;
          {
            f64 prev = t - step;
            t = prev > z_start ? prev : z_start;
          }
        } else {
          t = t + step;
          step = step + step_growth * cap;
          if (step > cap) {
            step = cap;
          }
        }
      }
    }
  }
}
