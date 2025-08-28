# Baltimore Real-Time Transit (Monorepo)

## Quick start
- Copy env: `cp .env.example .env`. If you have static GTFS, set `GTFS_STATIC_URL` or multi-source `GTFS_STATIC_SOURCES`; otherwise seeding is optional and the app will still run on realtime or mock data.
- Start stack: `docker compose up --build`
- Seed GTFS: in another shell, `make seed` (skips automatically if no `GTFS_STATIC_URL`/`GTFS_STATIC_SOURCES`)
- API health: http://localhost:8080/healthz
- Web map: http://localhost:4200

If GTFS-RT URLs are not configured, vehicles are mocked by the ingest service so the map still works.

If static GTFS is not available, `/routes` will fall back to route IDs derived from real-time vehicles in Redis (names/colors default). Shapes and stop lookups require static GTFS and will be empty otherwise.

For route geometry overlays, the system uses Valhalla if available. You can also run the fallback route matching based on GTFS shapes via `make streets` (details below).

## Endpoints
- `GET /routes`
- `GET /vehicles`
- `GET /stops/near?lat=&lon=&r=`
- `GET /metrics` (Prometheus)

### OpenAPI schema
- `make openapi` fetches `http://localhost:8080/openapi.json` from the running API and writes it to `packages/schemas/openapi.json`.
- Ensure the API is up before running this target.

## Dev notes
- PostGIS geometry in EPSG:4326
- Timezone: America/New_York
- `make openapi` writes `packages/schemas/openapi.json`

### Web UI
- Basemap (MapLibre): Defaults to OpenFreeMap Liberty style (no token): `https://tiles.openfreemap.org/styles/liberty`. Override at runtime with `MAP_STYLE_URL` in `.env` (injected to `env.js`).
- Vehicles layer: hover shows a vehicle card; click to pin; press ESC or click close to dismiss.
- Units: mph/km/h toggle (top-left control and in the popup). Preference persists via `localStorage`.
- Route picker: select a route to overlay route lines (requires static GTFS and/or Valhalla).
- 3D: optional buildings extrusion when using the 3D style button.

### Static GTFS seeding
- Single feed: set `GTFS_STATIC_URL=<zip>` then `make seed`.
- Multiple feeds: set `GTFS_STATIC_SOURCES` as comma‑separated `key=url` pairs, then `make seed`.
  - Example: `GTFS_STATIC_SOURCES=localbus=https://feeds.mta.maryland.gov/gtfs/local-bus,lightrail=https://feeds.mta.maryland.gov/gtfs/light-rail,metro=https://feeds.mta.maryland.gov/gtfs/metro,marc=https://mdotmta-gtfs.s3.amazonaws.com/mdotmta_gtfs_marc.zip,commuter=https://feeds.mta.maryland.gov/gtfs/commuter-bus`
  - The seed prefixes all IDs with `key:` to avoid collisions across feeds and handles MDOT MTA feed header quirks.

### Realtime (Swiftly + others)
- Aggregate multiple realtime feeds by setting `FEEDS=localbus,marc,...` and per‑feed envs:
  - `FEED_<name>_VEHICLES_URL`, `FEED_<name>_TRIP_UPDATES_URL`, `FEED_<name>_ALERTS_URL`, optional `FEED_<name>_API_KEY`
  - The fetcher sends both `Authorization` and `X-API-Key` when using goswift.ly.
- The ingest writes per‑feed keys to Redis and maintains a union so `/vehicles` returns combined data.
- If URLs are not set, the system falls back to mock vehicles so the web app continues to function.

### Route geometry (Valhalla and fallback)
- Valhalla container runs with tiles for MD/DC/VA and is used to map‑match GTFS shapes into `route_streets_geom`.
- Fallback: if Valhalla is unavailable, GTFS `shapes.txt` is used to build basic route lines.
- To (re)generate route overlays on demand, run: `make streets`
  - You can limit processing to specific routes via `ROUTE_IDS`, e.g.: `ROUTE_IDS=localbus:10,localbus:11 make streets`.
  - Tuning envs you can pass to `make streets`:
    - `MATCH_WORKERS` (default 2): parallel routes to process.
    - `MATCH_OVERWRITE` (default false): reprocess routes even if geometry exists.
    - `MATCH_SAMPLE_METERS` (default 40): densification step; higher = fewer points, faster.
    - `MATCH_SEARCH_RADIUS` (default 50): Valhalla search radius in meters.
    - `VALHALLA_MAX_POINTS` (default 15000): max points per Valhalla request before chunking.

#### Fast display (vector tiles)
- API serves per‑route vector tiles at `GET /routes/{route_id}/streets.mvt/{z}/{x}/{y}` and a fast bbox at `GET /routes/{route_id}/bbox`.
- The web app uses this MVT source for route overlays for snappy rendering of long routes and fits using bbox first. Falls back to GeoJSON if needed.

## CI (placeholder)
- Lint/format/tests via `make format` and `make test`.

## TODOs
- Implement bbox filtering and `/stops/{id}/arrivals` from Redis once GTFS-RT TripUpdates are parsed.
