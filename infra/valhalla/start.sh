#!/bin/bash
set -euo pipefail

# Default region extracts (MD, DC, VA) for Baltimore/MARC coverage
PBF_URLS=${PBF_URLS:-"https://download.geofabrik.de/north-america/us/maryland-latest.osm.pbf https://download.geofabrik.de/north-america/us/district-of-columbia-latest.osm.pbf https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf"}

mkdir -p /valhalla
cd /valhalla

# Generate Valhalla configuration with correct tile directory
echo "Generating Valhalla configuration..."
valhalla_build_config --mjolnir-tile-dir /valhalla/tiles --mjolnir-admin /valhalla/admin.sqlite --mjolnir-timezone /valhalla/tz_world.sqlite > /valhalla/valhalla.json

if [ ! -f /valhalla/valhalla_tiles.tar ] && [ ! -d /valhalla/tiles ]; then
  echo "Building Valhalla tiles from Geofabrik extracts..."
  mkdir -p /valhalla/pbf
  for url in $PBF_URLS; do
    name=$(basename "$url")
    echo "Downloading $name..."
    [ -f "/valhalla/pbf/$name" ] || curl -L "$url" -o "/valhalla/pbf/$name"
  done
  
  echo "Processing downloaded files..."
  ls -la /valhalla/pbf/
  
  # Merge PBFs into one region file (osmium inside image)
  if command -v osmium >/dev/null 2>&1; then
    echo "Using osmium to merge PBF files..."
    osmium merge /valhalla/pbf/*.osm.pbf -o region.osm.pbf
  else
    echo "osmium not available, using Maryland PBF (largest coverage for MARC routes)..."
    maryland_pbf="/valhalla/pbf/maryland-latest.osm.pbf"
    if [ -f "$maryland_pbf" ]; then
      echo "Using Maryland file: $maryland_pbf"
      cp "$maryland_pbf" region.osm.pbf
    else
      echo "Maryland PBF not found, using first available PBF..."
      first_pbf=$(ls /valhalla/pbf/*.osm.pbf | head -n 1)
      echo "Using file: $first_pbf"
      cp "$first_pbf" region.osm.pbf
    fi
  fi
  
  echo "Building Valhalla tiles..."
  if [ -f region.osm.pbf ]; then
    echo "region.osm.pbf exists, building tiles..."
    valhalla_build_tiles -c /valhalla/valhalla.json region.osm.pbf
    # Archive for faster restarts
    tar cf valhalla_tiles.tar tiles
  else
    echo "ERROR: region.osm.pbf not found!"
    exit 1
  fi
fi

echo "Starting Valhalla service..."
valhalla_service /valhalla/valhalla.json 1
