/* VoxelSpace march kernels — wasm32, no libc. Values for quality / LOD / fog
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
static f64 g_alt_scale;
static i32 g_mip_count;
static u8 *g_mip_h[4];
static u32 *g_mip_c[4];
static i32 g_mip_w[4];
static i32 g_mip_ht[4];
static i32 g_mip_sh[4];
static i32 g_mip_wmask[4];
static i32 g_mip_hmask[4];

static i32 g_pixel_offsets[8];
static f64 g_lod_deltas[8];
static f64 g_lod_fracs[8];
static i32 g_lod_n;
static i32 g_lod_delta_n;
static i32 g_lod_frac_n;
static i32 g_lerp_height;
static i32 g_filter_color;
static f64 g_filter_distance = 500.0;
static f64 g_fwd_x = 0.0;
static f64 g_fwd_y = -1.0;

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
  if (g_lod_n > 8) {
    g_lod_n = 8;
  }
  g_lod_delta_n = delta_n;
  if (g_lod_delta_n > 8) {
    g_lod_delta_n = 8;
  }
  g_lod_frac_n = frac_n;
  if (g_lod_frac_n > 8) {
    g_lod_frac_n = 8;
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

WASM_EXPORT void set_sample_flags(
    i32 height_lerp,
    i32 color_filter,
    f64 filter_distance,
    f64 fwd_x,
    f64 fwd_y) {
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
}

WASM_EXPORT void set_fog_range(f64 fog_start) {
  T_FOG_START = fog_start;
}

WASM_EXPORT void set_map_info(
    i32 map_w,
    i32 map_h,
    i32 map_shift,
    f64 altitude,
    f64 max_height,
    i32 mip_count) {
  g_map_w = map_w;
  g_map_h = map_h;
  g_map_shift = map_shift;
  g_altitude = altitude;
  g_max_height = max_height;
  g_alt_scale = T_HEIGHTMAP_MAX != 0.0 ? altitude / T_HEIGHTMAP_MAX : 0.0;
  g_mip_count = mip_count;
  if (g_mip_count < 1) {
    g_mip_count = 1;
  }
  if (g_mip_count > 4) {
    g_mip_count = 4;
  }
}

WASM_EXPORT void set_map_level(
    i32 level,
    i32 height_ptr,
    i32 color_ptr,
    i32 width,
    i32 height,
    i32 shift) {
  if (level < 0 || level > 3) {
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
    i32 filter_color) {
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
  i32 map_w_mask = (g_map_w - 1) | 0;
  i32 map_h_mask = (g_map_h - 1) | 0;
  i32 lod;
  i32 i;
  i32 n;
  f64 deltas[8];
  f64 lod_distances[9];
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
  if (deltas[0] > z_start) {
    z_start = deltas[0];
  }
  if (T_MIN_SAMPLE > z_start) {
    z_start = T_MIN_SAMPLE;
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

    if (start_index >= far_clip) {
      continue;
    }

    for (i = 0; i < local_width; i = (i + 1) | 0) {
      hidden_y[i] = screen_height;
    }

    for (z = start_index; (z < end_index) & (z < far_clip); z = z + step) {
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
      i32 lerp_now = do_lerp && (z <= g_filter_distance);
      i32 filter_now = do_filter && (z <= g_filter_distance);
      i32 col;

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

        if (is_ok) {
          if (ceiling_on_screen >= col_hidden) {
            plx += dx * (f64)px_offset;
            ply += dy * (f64)px_offset;
            continue;
          }

          i32 nn_off =
              ((((i32)ply & map_w_mask) << g_map_shift) +
               ((i32)plx & map_h_mask)) |
              0;
          u32 h_byte_sv;
          f64 h_fine;
          if (lerp_now) {
            h_fine = sample_sv_height(
                height_map,
                plx,
                ply,
                map_w_mask,
                map_h_mask,
                g_map_shift,
                repeat,
                1,
                &h_byte_sv,
                &nn_off);
          } else {
            h_byte_sv = height_map[nn_off];
            h_fine = (f64)h_byte_sv;
          }
          f64 terrain_height = h_fine * g_alt_scale;
          f64 terrain_sdf = cam_z - terrain_height;
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
                                  plx,
                                  ply,
                                  map_w_mask,
                                  map_h_mask,
                                  g_map_shift,
                                  repeat,
                                  1,
                                  nn_off)
                            : color_map[nn_off];
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

      step += step_growth;
    }
  }
}

static void fill_sky_slice(u32 *pixels, i32 local_width, i32 height) {
  i32 y;
  i32 x;
  for (y = 0; y < height; y = (y + 1) | 0) {
    u32 color = (y < g_sky_len) ? g_sky[y] : T_WHITE;
    i32 row = (y * local_width) | 0;
    for (x = 0; x < local_width; x = (x + 1) | 0) {
      pixels[row + x] = color;
    }
  }
}

WASM_EXPORT void pano_columns(
    i32 start_px,
    i32 end_px,
    i32 width,
    i32 height,
    f64 cam_x,
    f64 cam_y,
    f64 cam_z,
    f64 t0,
    f64 step0,
    f64 step_growth,
    f64 t_stop,
    f64 dir_x0,
    f64 dir_y0,
    f64 rot_c,
    f64 rot_s,
    f64 dh_ground,
    f64 clip_z,
    i32 repeat,
    i32 pixels_ptr,
    i32 horizon_ptr,
    i32 depth_ptr,
    f64 switch_t0,
    f64 switch_t1,
    f64 step_cap0,
    f64 step_cap1,
    f64 step_cap2,
    f64 inv0,
    f64 inv1,
    f64 inv2,
    i32 height_ptr,
    i32 iter_ptr,
    i32 lerp_height,
    i32 filter_color) {
  g_lerp_height = lerp_height ? 1 : 0;
  g_filter_color = filter_color ? 1 : 0;
  i32 do_lerp = g_lerp_height;
  i32 do_filter = g_filter_color;
  u32 *pixels = (u32 *)pixels_ptr;
  i32 *horizon = (i32 *)horizon_ptr;
  float *depth = depth_ptr ? (float *)depth_ptr : 0;
  u32 *height_buf = height_ptr ? (u32 *)height_ptr : 0;
  u32 *iter_buf = iter_ptr ? (u32 *)iter_ptr : 0;
  i32 local_width = (end_px - start_px) | 0;
  i32 last_row = (height - 1) | 0;
  f64 tan_last = (g_tan_min && last_row < g_tan_len) ? g_tan_min[last_row] : 0.0;
  f64 abs_ground = dh_ground < 0.0 ? -dh_ground : dh_ground;
  f64 dir_x = dir_x0;
  f64 dir_y = dir_y0;
  f64 mip_switch_t[3];
  f64 mip_inv[3];
  i32 last_mip;
  i32 px;

  mip_switch_t[0] = switch_t0;
  mip_switch_t[1] = switch_t1;
  mip_inv[0] = inv0;
  mip_inv[1] = inv1;
  mip_inv[2] = inv2;
  last_mip = (g_mip_count - 1) | 0;

  fill_sky_slice(pixels, local_width, height);
  {
    i32 nfill = (local_width * height) | 0;
    if (depth) {
      __builtin_memset(depth, 0, (unsigned)nfill * sizeof(float));
    }
    if (height_buf) {
      __builtin_memset(height_buf, 0, (unsigned)nfill * sizeof(u32));
    }
    if (iter_buf) {
      __builtin_memset(iter_buf, 0, (unsigned)nfill * sizeof(u32));
    }
  }

  for (px = start_px; px < end_px; px = (px + 1) | 0) {
    i32 local_x = (px - start_px) | 0;
    i32 H = height;
    f64 t = t0;
    f64 step = step0;
    i32 was_inside = 0;
    i32 mip = 0;
    f64 step_cap = step_cap0;
    f64 t_stop_col = t_stop;
    i32 k = 0;
    horizon[local_x] = H;

    while (t < t_stop_col) {
      i32 sealed;
      f64 tan_h;
      f64 wx;
      f64 wy;
      k = (k + 1) | 0;
      if (H == 0) {
        break;
      }
      while ((mip < last_mip) && t >= mip_switch_t[mip]) {
        mip = (mip + 1) | 0;
        step *= T_MIP_STEP_SCALE;
        step_cap = mip == 1 ? step_cap1 : step_cap2;
        if (step > step_cap) {
          step = step_cap;
        }
      }

      sealed = (H != height) | 0;
      tan_h = sealed && H < g_tan_len ? g_tan_min[H] : 0.0;
      if (sealed) {
        f64 z_ray = cam_z + t * tan_h;
        if (tan_h >= 0.0) {
          if (g_max_height < z_ray - T_EPSILON) {
            break;
          }
          if (tan_h > T_EPSILON) {
            f64 t_ceil = (g_max_height - cam_z) / tan_h;
            if (t_ceil < t_stop_col) {
              t_stop_col = t_ceil;
            }
            if (t >= t_stop_col) {
              break;
            }
          } else if (g_max_height < cam_z - T_EPSILON) {
            break;
          }
        } else if (z_ray > g_max_height + T_EPSILON) {
          f64 t_enter = (g_max_height - cam_z) / tan_h;
          if (t_enter >= t_stop_col) {
            break;
          }
          if (t_enter > t + T_EPSILON) {
            t = t_enter;
            continue;
          }
        }
      }

      wx = cam_x + dir_x * t;
      wy = cam_y + dir_y * t;

      if (!repeat) {
        i32 inside = (wx >= 0.0) & (wx < (f64)g_map_w) & (wy >= 0.0) &
                     (wy < (f64)g_map_h);
        if (!inside) {
          if (was_inside) {
            break;
          }
          t += step;
          step += step_growth;
          if (step > step_cap) {
            step = step_cap;
          }
          continue;
        }
        was_inside = 1;
      }

      {
        f64 inv = mip_inv[mip];
        f64 sx = wx * inv;
        f64 sy = wy * inv;
        i32 shift = g_mip_sh[mip];
        i32 wmask = g_mip_wmask[mip];
        i32 hmask = g_mip_hmask[mip];
        i32 nn_off =
            ((((i32)sy & wmask) << shift) + ((i32)sx & hmask)) | 0;
        u32 h_byte_sv;
        f64 h_fine;
        i32 lerp = (mip == 0) && do_lerp &&
                   (t * (dir_x * g_fwd_x + dir_y * g_fwd_y) <= g_filter_distance);
        if (lerp) {
          h_fine = sample_sv_height(
              g_mip_h[mip],
              sx,
              sy,
              wmask,
              hmask,
              shift,
              repeat,
              1,
              &h_byte_sv,
              &nn_off);
        } else {
          h_byte_sv = g_mip_h[mip][nn_off];
          h_fine = (f64)h_byte_sv;
        }
        f64 h = h_fine * g_alt_scale;
        i32 offset = nn_off;
        f64 dh;
        f64 abs_s;
        f64 s_hat;
        i32 idx;
        i32 y_hit;
        if (sealed && h < cam_z + t * tan_h - T_EPSILON) {
          t += step;
          step += step_growth;
          if (step > step_cap) {
            step = step_cap;
          }
          continue;
        }
        dh = h - cam_z;
        abs_s = dh < 0.0 ? -dh : dh;
        s_hat = dh / (t + abs_s);
        idx = (i32)((s_hat + 1.0) * T_YHIT_SCALE);
        if (idx < 0) {
          idx = 0;
        }
        if (idx > T_YHIT_LAST) {
          idx = T_YHIT_LAST;
        }
        y_hit = g_yhit[idx];
        if (y_hit < 0) {
          y_hit = 0;
        }
        if (y_hit >= height) {
          y_hit = (height - 1) | 0;
        }
        if (y_hit < H) {
          i32 y_bottom = H;
          f64 tan_g = dh_ground / t;
          i32 y_ground;
          if (tan_g > tan_last) {
            f64 s_hat_g = dh_ground / (t + abs_ground);
            i32 g_idx = (i32)((s_hat_g + 1.0) * T_YHIT_SCALE);
            if (g_idx < 0) {
              g_idx = 0;
            }
            if (g_idx > T_YHIT_LAST) {
              g_idx = T_YHIT_LAST;
            }
            y_ground = g_yhit[g_idx];
          } else {
            y_ground = height;
          }
          if (y_ground < y_bottom) {
            y_bottom = y_ground;
          }
          if (y_hit < y_bottom) {
            u32 color =
                ((mip == 0) && do_filter &&
                 (t * (dir_x * g_fwd_x + dir_y * g_fwd_y) <= g_filter_distance))
                    ? sample_sv_color(
                          g_mip_c[mip],
                          sx,
                          sy,
                          wmask,
                          hmask,
                          shift,
                          repeat,
                          1,
                          offset)
                    : g_mip_c[mip][offset];
            f64 dist = wasm_sqrt(t * t + dh * dh);
            i32 y;
            if (height_buf || iter_buf) {
              u32 h_byte = height_buf ? h_byte_sv : 0;
              for (y = y_hit; y < y_bottom; y = (y + 1) | 0) {
                i32 pix = (y * local_width + local_x) | 0;
                pixels[pix] = color;
                if (depth) {
                  depth[pix] = (float)dist;
                }
                if (height_buf) {
                  height_buf[pix] = h_byte;
                }
                if (iter_buf) {
                  iter_buf[pix] = (u32)k;
                }
              }
            } else {
              for (y = y_hit; y < y_bottom; y = (y + 1) | 0) {
                i32 pix = (y * local_width + local_x) | 0;
                pixels[pix] = color;
                if (depth) {
                  depth[pix] = (float)dist;
                }
              }
            }
          }
          H = y_hit;
          horizon[local_x] = H;
        }
      }

      t += step;
      step += step_growth;
      if (step > step_cap) {
        step = step_cap;
      }
    }

    {
      f64 next_x = dir_x * rot_c + dir_y * rot_s;
      f64 next_y = dir_y * rot_c - dir_x * rot_s;
      dir_x = next_x;
      dir_y = next_y;
    }
  }
  (void)clip_z;
  (void)width;
}

static f64 atan2_lut(f64 y, f64 x) {
  f64 ax = x < 0.0 ? -x : x;
  f64 ay = y < 0.0 ? -y : y;
  f64 ang;
  i32 last = T_ATAN_LAST;
  if (ay > ax) {
    if (ay < T_EPSILON) {
      ang = 0.0;
    } else {
      i32 idx = (i32)((ax / ay) * (f64)last);
      if (idx > last) {
        idx = last;
      }
      ang = T_HALF_PI - g_atan[idx];
    }
  } else if (ax < T_EPSILON) {
    ang = 0.0;
  } else {
    i32 idx = (i32)((ay / ax) * (f64)last);
    if (idx > last) {
      idx = last;
    }
    ang = g_atan[idx];
  }
  if (x < 0.0) {
    ang = T_PI - ang;
  }
  if (y < 0.0) {
    ang = -ang;
  }
  return ang;
}

static i32 yhit_from_hat(f64 s_hat, i16 *table) {
  i32 idx = (i32)((s_hat + 1.0) * T_YHIT_SCALE);
  if (idx < 0) {
    idx = 0;
  }
  if (idx > T_YHIT_LAST) {
    idx = T_YHIT_LAST;
  }
  return table[idx];
}

WASM_EXPORT void pano_view_columns(
    i32 start_column,
    i32 end_column,
    i32 screen_width,
    i32 screen_height,
    i32 pano_w,
    i32 pano_h,
    f64 fov_y,
    f64 dst_to_proj,
    f64 tan_half_y_in,
    f64 near_clip,
    f64 far_clip,
    i32 apply_fog,
    i32 fill_unfilled,
    i32 pixels_ptr,
    i32 pixel_width,
    i32 pano_ptr,
    i32 depth_ptr,
    f64 right_x,
    f64 right_y,
    f64 right_z,
    f64 up_x,
    f64 up_y,
    f64 up_z,
    f64 fwd_x,
    f64 fwd_y,
    f64 fwd_z,
    i32 height_ptr,
    i32 iter_ptr,
    i32 debug_view) {
  u32 *pixels = (u32 *)pixels_ptr;
  u32 *panorama = (u32 *)pano_ptr;
  float *depth_buf = (float *)depth_ptr;
  u32 *height_buf = height_ptr ? (u32 *)height_ptr : 0;
  u32 *iter_buf = iter_ptr ? (u32 *)iter_ptr : 0;
  i32 debug = debug_view | 0;
  i32 stride = pixel_width;
  i32 pano_last = (pano_h - 1) | 0;
  i32 sy;
  f64 aspect = (f64)screen_width / (f64)screen_height;
  f64 tan_half_y = tan_half_y_in;
  f64 tan_half_x;
  f64 inv_w;
  f64 inv_h;
  f64 fog_range;
  f64 inv_fog;
  i32 use_fog;
  f64 d_cam_x;
  f64 cam_x0;
  f64 px_scale;
  f64 rdx;
  f64 rdy;
  f64 rdz;
  (void)fov_y;
  (void)dst_to_proj;

  if (fill_unfilled) {
    i32 n = (((end_column - start_column) | 0) * screen_height) | 0;
    i32 i;
    for (i = 0; i < n; i = (i + 1) | 0) {
      pixels[i] = T_UNFILLED;
    }
  }

  if (!(tan_half_y > 0.0) && dst_to_proj > 0.0) {
    tan_half_y = ((f64)screen_height * T_HALF) / dst_to_proj;
  }
  tan_half_x = tan_half_y * aspect;
  inv_w = 1.0 / (f64)screen_width;
  inv_h = 1.0 / (f64)screen_height;
  fog_range = far_clip - T_FOG_START;
  inv_fog = fog_range == 0.0 ? 0.0 : 1.0 / fog_range;
  use_fog = apply_fog | 0;
  d_cam_x = T_NDC_SCALE * tan_half_x * inv_w;
  cam_x0 = (((f64)start_column + T_PIXEL_CENTER) * inv_w * T_NDC_SCALE - 1.0) *
           tan_half_x;
  px_scale = (f64)pano_w * T_INV_TWO_PI;
  rdx = right_x * d_cam_x;
  rdy = right_y * d_cam_x;
  rdz = right_z * d_cam_x;

  for (sy = 0; sy < screen_height; sy = (sy + 1) | 0) {
    f64 cam_y = (1.0 - ((f64)sy + T_PIXEL_CENTER) * inv_h * T_NDC_SCALE) * tan_half_y;
    i32 row = (sy * stride) | 0;
    f64 view_len2_base = cam_y * cam_y + 1.0;
    f64 cam_x = cam_x0;
    f64 dx = right_x * cam_x0 + up_x * cam_y + fwd_x;
    f64 dy = right_y * cam_x0 + up_y * cam_y + fwd_y;
    f64 dz = right_z * cam_x0 + up_z * cam_y + fwd_z;
    i32 sx;
    i32 local_x;
    for (sx = start_column, local_x = 0; sx < end_column;
         sx = (sx + 1) | 0, local_x = (local_x + 1) | 0) {
      f64 inv_view_len = 1.0 / wasm_sqrt(cam_x * cam_x + view_len2_base);
      i32 py = yhit_from_hat(dz * inv_view_len, g_yhit_sin);
      f64 theta;
      i32 px;
      i32 dest;
      i32 pano_idx;
      float dist;
      if (py < 0) {
        py = 0;
      }
      if (py > pano_last) {
        py = pano_last;
      }
      theta = atan2_lut(-dx, -dy);
      px = (i32)(theta * px_scale + (f64)pano_w);
      if (px >= pano_w) {
        px = (px - pano_w) | 0;
      }
      if (px < 0) {
        px = (px + pano_w) | 0;
      }
      dest = (row + local_x) | 0;
      pano_idx = (py * pano_w + px) | 0;
      dist = depth_buf[pano_idx];
      if (debug) {
        f64 view_z = (f64)dist * inv_view_len;
        u32 h_byte = height_buf ? height_buf[pano_idx] : 0;
        u32 it = iter_buf ? iter_buf[pano_idx] : 0;
        if (debug == DEBUG_HEIGHT) {
          pixels[dest] = dist <= 0.0f ? pack_named(0, 0, 0) : encode_height(h_byte);
        } else if (debug == DEBUG_DEPTH) {
          pixels[dest] =
              dist <= 0.0f ? pack_named(0, 0, 0)
                           : encode_unit(far_clip > 0.0 ? view_z / far_clip : 0.0);
        } else {
          pixels[dest] = encode_iter((i32)it);
        }
      } else if (dist <= 0.0f) {
        pixels[dest] = panorama[pano_idx];
      } else {
        f64 view_z = (f64)dist * inv_view_len;
        if (((use_fog ^ 1) | 0) & ((view_z >= far_clip) | (view_z < near_clip))) {
          pixels[dest] = (py < g_sky_len) ? g_sky[py] : T_WHITE;
        } else if (use_fog) {
          f64 fog_t =
              fog_range == 0.0 ? T_FOG_SAT : (view_z - T_FOG_START) * inv_fog;
          if (fog_t >= T_FOG_SAT) {
            pixels[dest] = T_WHITE;
          } else if (fog_t > 0.0) {
            pixels[dest] = fog_pack(panorama[pano_idx], fog_t);
          } else {
            pixels[dest] = panorama[pano_idx];
          }
        } else {
          pixels[dest] = panorama[pano_idx];
        }
      }
      cam_x += d_cam_x;
      dx += rdx;
      dy += rdy;
      dz += rdz;
    }
  }
}
