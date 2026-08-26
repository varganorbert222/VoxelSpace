$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $PSScriptRoot "src\march.c"))) {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$src = Join-Path $PSScriptRoot "src\march.c"
$outDir = Join-Path $PSScriptRoot "out"
$wasm = Join-Path $outDir "march.wasm"
$bytesJs = Join-Path $repo "scripts\wasm\march.bytes.js"

$clang = $null
$candidates = @(
  "clang",
  "$env:ProgramFiles\LLVM\bin\clang.exe",
  "${env:ProgramFiles(x86)}\LLVM\bin\clang.exe",
  "$env:LOCALAPPDATA\Programs\LLVM\bin\clang.exe"
)
foreach ($c in $candidates) {
  if ($c -eq "clang") {
    $cmd = Get-Command clang -ErrorAction SilentlyContinue
    if ($cmd) {
      $clang = $cmd.Source
      break
    }
  } elseif (Test-Path $c) {
    $clang = $c
    break
  }
}

if (-not $clang) {
  Write-Error "clang not found. Install LLVM (winget install LLVM.LLVM) and re-run."
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$exports = @(
  "alloc",
  "reset_all",
  "commit_perm",
  "reset_scratch",
    "set_tunables",
  "set_classic_tables",
    "set_sample_flags",
    "set_fog_range",
    "set_map_info",
  "set_map_level",
  "set_luts",
  "classic_columns",
  "pano_columns",
  "pano_view_columns"
)
$exportFlags = $exports | ForEach-Object { "-Wl,--export=$_" }

$clangArgs = @(
  "--target=wasm32",
  "-nostdlib",
  "-O3",
  "-ffp-contract=off",
  "-mbulk-memory",
  "-Wl,--no-entry",
  "-Wl,--allow-undefined",
  "-Wl,--initial-memory=16777216",
  "-Wl,--max-memory=268435456"
) + $exportFlags + @(
  "-o", $wasm,
  $src
)

& $clang @clangArgs

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

node (Join-Path $PSScriptRoot "emit-bytes.js") $wasm $bytesJs
