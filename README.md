# Baltimore Real-Time Transit (Monorepo)

## Quick start
- Copy env: `cp .env.example .env`. If you have static GTFS, set `GTFS_STATIC_URL`; otherwise skip seeding.
- Start stack: `docker compose up --build`
- Seed GTFS: in another shell, `make seed` (skips automatically if no `GTFS_STATIC_URL`)
- API health: http://localhost:8080/healthz
- Web map: http://localhost:4200

If GTFS-RT URLs are not configured, vehicles are mocked by the ingest service so the map still works.

If static GTFS is not available, `/routes` will fall back to route IDs derived from real-time vehicles in Redis (names/colors default). Shapes and stop lookups require static GTFS and will be empty otherwise.

## Endpoints
- `GET /routes`
- `GET /vehicles`
- `GET /stops/near?lat=&lon=&r=`
- `GET /metrics` (Prometheus)

## Dev notes
- PostGIS geometry in EPSG:4326
- Timezone: America/New_York
- `make openapi` writes `packages/schemas/openapi.json`

### Static GTFS seeding
- Single feed: set `GTFS_STATIC_URL=<zip>` then `make seed`.
- Multiple feeds: set `GTFS_STATIC_SOURCES` as comma‑separated `key=url` pairs, then `make seed`.
  - Example: `GTFS_STATIC_SOURCES=localbus=https://feeds.mta.maryland.gov/gtfs/local-bus,lightrail=https://feeds.mta.maryland.gov/gtfs/light-rail,metro=https://feeds.mta.maryland.gov/gtfs/metro,marc=https://feeds.mta.maryland.gov/gtfs/marc,commuter=https://feeds.mta.maryland.gov/gtfs/commuter-bus`
  - The seed prefixes all IDs with `key:` to avoid collisions across feeds.

### Realtime (Swiftly + others)
- Aggregate multiple realtime feeds by setting `FEEDS` and per‑feed URLs.
- Example configuration in `.env.example` (localbus via Swiftly, marc via S3).

## CI (placeholder)
- Lint/format/tests via `make format` and `make test`.

## TODOs
- Implement bbox filtering and `/stops/{id}/arrivals` from Redis once GTFS-RT TripUpdates are parsed.
