#!/usr/bin/env bash
set -euo pipefail

# Load .env so this script can see GTFS_* vars even when run outside containers
if [ -f ./.env ]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

psql_exec() {
  docker compose exec -T db psql -U postgres -d transit -v ON_ERROR_STOP=1 "$@"
}

download_and_unzip() {
  local key="$1"; local url="$2"
  local dir="data/gtfs/${key}"
  echo "Downloading GTFS: ${key} <- ${url}"
  mkdir -p "$dir"
  curl -L "$url" -o "$dir/gtfs.zip"
  echo "Unzipping ${key}..."
  rm -rf "$dir/unzipped"
  mkdir -p "$dir/unzipped"
  unzip -o "$dir/gtfs.zip" -d "$dir/unzipped" > /dev/null
}

create_stage_tables() {
  local skey="$1"
  cat <<SQL | psql_exec
DROP TABLE IF EXISTS staging_stops_${skey};
DROP TABLE IF EXISTS staging_routes_${skey};
DROP TABLE IF EXISTS staging_trips_${skey};
DROP TABLE IF EXISTS staging_stop_times_${skey};
DROP TABLE IF EXISTS staging_shapes_${skey};
CREATE TABLE staging_stops_${skey}(
  stop_id TEXT, 
  stop_code TEXT,
  stop_name TEXT, 
  stop_desc TEXT,
  stop_lat DOUBLE PRECISION, 
  stop_lon DOUBLE PRECISION,
  zone_id TEXT,
  stop_url TEXT,
  location_type TEXT,
  parent_station TEXT,
  stop_timezone TEXT,
  wheelchair_boarding TEXT,
  level_id TEXT,
  platform_code TEXT,
  direction TEXT,
  position TEXT
);
CREATE TABLE staging_routes_${skey}(
  route_id TEXT,
  agency_id TEXT,
  route_short_name TEXT,
  route_long_name TEXT,
  route_desc TEXT,
  route_type INT,
  route_url TEXT,
  route_color TEXT,
  route_text_color TEXT,
  network_id TEXT,
  as_route TEXT
);
CREATE TABLE staging_trips_${skey}(
  route_id TEXT, 
  service_id TEXT, 
  trip_id TEXT, 
  trip_headsign TEXT,
  trip_short_name TEXT,
  direction_id INT, 
  block_id TEXT,
  shape_id TEXT,
  wheelchair_accessible TEXT,
  bikes_allowed TEXT
);
CREATE TABLE staging_stop_times_${skey}(
  trip_id TEXT, 
  arrival_time TEXT, 
  departure_time TEXT, 
  stop_id TEXT, 
  stop_sequence INT,
  stop_headsign TEXT,
  pickup_type INT,
  drop_off_type INT,
  shape_dist_traveled TEXT,
  timepoint TEXT
);
CREATE TABLE staging_shapes_${skey}(
  shape_id TEXT, 
  shape_pt_lat DOUBLE PRECISION, 
  shape_pt_lon DOUBLE PRECISION, 
  shape_pt_sequence INT,
  shape_dist_traveled DOUBLE PRECISION
);
SQL
}

copy_stage_from_files() {
  local skey="$1"; local dir="$2"
  if [ -f "$dir/unzipped/stops.txt" ]; then
    echo "stops -> staging_stops_${skey}"
    # Get the actual header and map to our staging table columns
    header=$(head -1 "$dir/unzipped/stops.txt")
    if [[ "$header" == *"direction"* ]]; then
      # localbus format with direction,position
      cat "$dir/unzipped/stops.txt" | psql_exec -c "\\copy staging_stops_${skey}(stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,stop_timezone,wheelchair_boarding,direction,position) FROM STDIN CSV HEADER"
    elif [[ "$header" == *"level_id"* ]]; then
      # metro format with level_id
      cat "$dir/unzipped/stops.txt" | psql_exec -c "\\copy staging_stops_${skey}(stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,stop_timezone,wheelchair_boarding,level_id) FROM STDIN CSV HEADER"
    else
      # standard GTFS format (lightrail)
      cat "$dir/unzipped/stops.txt" | psql_exec -c "\\copy staging_stops_${skey}(stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,stop_timezone,wheelchair_boarding) FROM STDIN CSV HEADER"
    fi
  fi
  if [ -f "$dir/unzipped/routes.txt" ]; then
    echo "routes -> staging_routes_${skey}"
    # Check route columns based on header
    header=$(head -1 "$dir/unzipped/routes.txt")
    if [[ "$header" == *"as_route"* ]]; then
      # localbus/lightrail format with as_route column (11 cols)
      cat "$dir/unzipped/routes.txt" | psql_exec -c "\\copy staging_routes_${skey}(route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color,network_id,as_route) FROM STDIN CSV HEADER"
    elif [[ "$header" == *"network_id"* ]]; then
      # metro format with network_id but no as_route (10 cols)
      cat "$dir/unzipped/routes.txt" | psql_exec -c "\\copy staging_routes_${skey}(route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color,network_id) FROM STDIN CSV HEADER"
    else
      # marc format - basic GTFS (9 cols)
      cat "$dir/unzipped/routes.txt" | psql_exec -c "\\copy staging_routes_${skey}(route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color) FROM STDIN CSV HEADER"
    fi
  fi
  if [ -f "$dir/unzipped/trips.txt" ]; then
    echo "trips -> staging_trips_${skey}"
    cat "$dir/unzipped/trips.txt" | psql_exec -c "\\copy staging_trips_${skey} FROM STDIN CSV HEADER"
  fi
  if [ -f "$dir/unzipped/stop_times.txt" ]; then
    echo "stop_times -> staging_stop_times_${skey}"
    # Check if stop_times.txt has timepoint column
    header=$(head -1 "$dir/unzipped/stop_times.txt")
    if [[ "$header" == *"timepoint"* ]]; then
      # localbus/lightrail format with timepoint column
      cat "$dir/unzipped/stop_times.txt" | psql_exec -c "\\copy staging_stop_times_${skey}(trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled,timepoint) FROM STDIN CSV HEADER"
    else
      # metro format without timepoint column
      cat "$dir/unzipped/stop_times.txt" | psql_exec -c "\\copy staging_stop_times_${skey}(trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled) FROM STDIN CSV HEADER"
    fi
  fi
  if [ -f "$dir/unzipped/shapes.txt" ]; then
    echo "shapes -> staging_shapes_${skey}"
    cat "$dir/unzipped/shapes.txt" | psql_exec -c "\\copy staging_shapes_${skey} FROM STDIN CSV HEADER"
  fi
}

insert_from_stage_with_prefix() {
  local skey="$1"; local prefix="$2"
  cat <<SQL | psql_exec
-- stops
INSERT INTO stops(stop_id,name,lat,lon)
SELECT concat('${prefix}', ':', stop_id), stop_name, stop_lat, stop_lon
FROM staging_stops_${skey}
ON CONFLICT (stop_id) DO NOTHING;
UPDATE stops SET geom = COALESCE(geom, ST_SetSRID(ST_MakePoint(lon,lat),4326));

-- routes
INSERT INTO routes(route_id,short_name,long_name,color,text_color,type)
SELECT concat('${prefix}', ':', route_id), COALESCE(NULLIF(route_short_name,''), route_id), route_long_name, route_color, route_text_color, route_type
FROM staging_routes_${skey}
ON CONFLICT (route_id) DO NOTHING;

-- trips
INSERT INTO trips(trip_id,route_id,service_id,direction_id,shape_id)
SELECT concat('${prefix}', ':', trip_id), concat('${prefix}', ':', route_id), service_id, direction_id, concat('${prefix}', ':', shape_id)
FROM staging_trips_${skey}
ON CONFLICT (trip_id) DO NOTHING;

-- stop_times
INSERT INTO stop_times(trip_id,arrival_time,departure_time,stop_id,stop_sequence)
SELECT concat('${prefix}', ':', trip_id), arrival_time, departure_time, concat('${prefix}', ':', stop_id), stop_sequence
FROM staging_stop_times_${skey}
ON CONFLICT (trip_id, stop_sequence) DO NOTHING;

-- shapes
INSERT INTO shapes(shape_id, geom)
SELECT concat('${prefix}', ':', shape_id),
       ST_MakeLine(ST_SetSRID(ST_MakePoint(shape_pt_lon, shape_pt_lat), 4326) ORDER BY shape_pt_sequence)
FROM staging_shapes_${skey}
GROUP BY shape_id
ON CONFLICT (shape_id) DO NOTHING;

-- drop staging
DROP TABLE IF EXISTS staging_stops_${skey};
DROP TABLE IF EXISTS staging_routes_${skey};
DROP TABLE IF EXISTS staging_trips_${skey};
DROP TABLE IF EXISTS staging_stop_times_${skey};
DROP TABLE IF EXISTS staging_shapes_${skey};
SQL
}

sanitize_key() {
  echo "$1" | sed 's/[^A-Za-z0-9_]/_/g'
}

echo "Loading schema..."
# Inline local includes (like \i sql/schema.sql) so psql in the container doesn't need host paths
if [ -f scripts/create_db.sql ]; then
  tmp_sql="$(mktemp)"
  # If an included schema exists on host, prepend it
  if [ -f sql/schema.sql ]; then
    cat sql/schema.sql > "$tmp_sql"
  else
    : > "$tmp_sql"
  fi
  # Append create_db.sql with any \i lines removed (so psql won't try to re-include from container FS)
  sed '/^[[:space:]]*\\i[[:space:]]\+.*$/d' scripts/create_db.sql >> "$tmp_sql"
  psql_exec < "$tmp_sql"
  rm -f "$tmp_sql"
else
  echo "scripts/create_db.sql not found. Ensure your schema file exists."
  exit 1
fi

if [ -n "${GTFS_STATIC_SOURCES:-}" ]; then
  IFS=',' read -ra parts <<< "${GTFS_STATIC_SOURCES}"
  for part in "${parts[@]}"; do
    kv=$(echo "$part" | sed 's/^\s*//; s/\s*$//')
    key=${kv%%=*}
    url=${kv#*=}
    if [ -z "$key" ] || [ -z "$url" ]; then
      echo "Skipping invalid source entry: $kv"; continue
    fi
    s_key=$(sanitize_key "$key")
    download_and_unzip "$key" "$url"
    dir="data/gtfs/${key}"
    create_stage_tables "$s_key"
    copy_stage_from_files "$s_key" "$dir"
    insert_from_stage_with_prefix "$s_key" "$key"
  done
else
  if [ -z "${GTFS_STATIC_URL:-}" ] || [ "${GTFS_STATIC_URL}" = "<PUT_STATIC_GTFS_ZIP_URL_HERE>" ]; then
    echo "[seed] Neither GTFS_STATIC_SOURCES nor GTFS_STATIC_URL is set. Skipping static GTFS import."
    echo "      To seed multiple feeds, set GTFS_STATIC_SOURCES=key=url,... in your .env."
    exit 0
  fi
  echo "Downloading GTFS static..."
  mkdir -p data/gtfs/default
  curl -L "$GTFS_STATIC_URL" -o data/gtfs/default/gtfs.zip
  echo "Unzipping..."
  rm -rf data/gtfs/default/unzipped
  mkdir -p data/gtfs/default/unzipped
  unzip -o data/gtfs/default/gtfs.zip -d data/gtfs/default/unzipped > /dev/null

  # Use staging approach for correctness
  s_key=default
  create_stage_tables "$s_key"
  copy_stage_from_files "$s_key" "data/gtfs/default"
  insert_from_stage_with_prefix "$s_key" "default"
fi

echo "Done loading GTFS static."
