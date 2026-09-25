#!/usr/bin/env bash
# Re-export Envoy's logo PNGs (transparent) from the SVG sources using headless Chrome.
# Usage: bash docs/brand/render.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../../frontend/public
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT=../..
TMP=$(mktemp -d)

# render <svg> <width> <height> <out.png> [css-color-override] [full-bleed]
render() {
  local svg=$1 w=$2 h=$3 out=$4 color=${5:-} bleed=${6:-}
  local args=(-e 's/^//')
  [[ -n $color ]] && args+=(-e "s/color=\"#[0-9A-Fa-f]*\"/color=\"$color\"/")
  [[ -n $bleed ]] && args+=(-e 's/rx="14.5"/rx="0"/' -e '/stroke-opacity/d')
  local src; src=$(sed "${args[@]}" "$svg")
  printf '<html><body style="margin:0;background:transparent">%s</body></html>' \
    "$(sed "s/<svg /<svg width=\"$w\" height=\"$h\" style=\"display:block\" /" <<<"$src")" > "$TMP/p.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size="$w,$h" --screenshot="$out" "file://$TMP/p.html" 2>/dev/null
  echo "  $out (${w}x${h})"
}

echo "Exporting Envoy logos…"
# Logo = the transparent mark. Indigo for light backgrounds, lavender/white for dark ones.
render envoy-logo.svg 1024 1024 envoy-logo.png
render envoy-logo.svg 1024 1024 envoy-logo-light.png "#818CF8"
render envoy-logo.svg 1024 1024 envoy-logo-white.png "#FFFFFF"
render envoy-logo.svg 256 256 "$ROOT/frontend/public/logo.png"
render envoy-logo.svg 256 256 "$ROOT/frontend/public/logo-dark.png" "#818CF8"
render envoy-logo.svg 256 256 "$ROOT/frontend/app/icon.png"                     # favicon (Next.js file convention)
# App icon (rounded square) - only where a platform needs an opaque tile.
render envoy-app-icon.svg 1024 1024 envoy-app-icon.png
render envoy-app-icon.svg 180 180 "$ROOT/frontend/app/apple-icon.png" "" bleed  # iOS fills transparency with black
rm -rf "$TMP"
