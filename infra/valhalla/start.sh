#!/bin/bash
set -euo pipefail

# Default region extracts (MD, DC, VA) for Baltimore/MARC coverage
PBF_URLS=${PBF_URLS:-"https://download.geofabrik.de/north-america/us/maryland-latest.osm.pbf https://download.geofabrik.de/north-america/us/district-of-columbia-latest.osm.pbf https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf"}

mkdir -p /valhalla
cd /valhalla

if [ ! -f /valhalla/valhalla_tiles.tar ] && [ ! -d /valhalla/tiles ]; then
  echo "Building Valhalla tiles from Geofabrik extracts..."
  mkdir -p /valhalla/pbf
  for url in $PBF_URLS; do
    name=$(basename "$url")
    [ -f "/valhalla/pbf/$name" ] || curl -L "$url" -o "/valhalla/pbf/$name"
  done
  # Merge PBFs into one region file (osmium inside image)
  if command -v osmium >/dev/null 2>&1; then
    osmium merge /valhalla/pbf/*.osm.pbf -o region.osm.pbf
  else
    # fallback: use the first PBF only
    cp /valhalla/pbf/*.osm.pbf region.osm.pbf
  fi
  valhalla_build_tiles -c /valhalla/valhalla.json region.osm.pbf
  # Archive for faster restarts
  tar cf valhalla_tiles.tar tiles
fi

echo "Starting Valhalla service..."
valhalla_service /valhalla/valhalla.json 1
