#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
src="$root/tools/wasm/src/march.c"
out_dir="$root/tools/wasm/out"
wasm="$out_dir/march.wasm"
bytes_js="$root/scripts/wasm/march.bytes.js"

mkdir -p "$out_dir"

exports=(
  alloc
  reset_all
  commit_perm
  reset_scratch
  set_tunables
  set_classic_tables
  set_sample_flags
  set_fog_range
  set_map_info
  set_map_level
  set_luts
  classic_columns
  frustum_space_columns
  pano_columns
  pano_view_columns
  voxel_texels
)

export_flags=()
for name in "${exports[@]}"; do
  export_flags+=("-Wl,--export=$name")
done

clang \
  --target=wasm32 \
  -nostdlib \
  -O3 \
  -ffp-contract=off \
  -mbulk-memory \
  -Wl,--no-entry \
  -Wl,--allow-undefined \
  -Wl,--initial-memory=16777216 \
  -Wl,--max-memory=268435456 \
  "${export_flags[@]}" \
  -o "$wasm" \
  "$src"

node "$root/tools/wasm/emit-bytes.js" "$wasm" "$bytes_js"
