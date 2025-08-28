import os, json, time, requests, psycopg2
from psycopg2.extras import RealDictCursor


def pg_url():
    raw = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db:5432/transit")
    return raw.replace("postgresql+psycopg2://", "postgresql://").replace("postgres+psycopg2://", "postgres://")


def conn():
    return psycopg2.connect(pg_url(), cursor_factory=RealDictCursor)


VALHALLA_URL = os.getenv("VALHALLA_URL", "http://valhalla:8002")
SAMPLE_METERS = int(os.getenv("MATCH_SAMPLE_METERS", "40"))
COSTING = os.getenv("MATCH_COSTING", "auto")
SEARCH_RADIUS = int(os.getenv("MATCH_SEARCH_RADIUS", "50"))
VALHALLA_MAX_POINTS = int(os.getenv("VALHALLA_MAX_POINTS", "15000"))
MATCH_WORKERS = int(os.getenv("MATCH_WORKERS", "2"))
MATCH_OVERWRITE = os.getenv("MATCH_OVERWRITE", "false").lower() in ("1", "true", "yes", "y", "on")


def densified_shapes_geojson(route_id: str):
    sql = """
      SELECT DISTINCT s.shape_id,
             ST_AsGeoJSON(ST_Segmentize(s.geom::geography, %s)::geometry) AS g
      FROM trips t
      JOIN shapes s ON s.shape_id = t.shape_id
      WHERE t.route_id = %s
    """
    out = []
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, (SAMPLE_METERS, route_id))
        for row in cur.fetchall():
            out.append(json.loads(row["g"]))
    return out


def geojson_lines_to_points(geojson_line):
    coords = geojson_line["coordinates"]
    # LineString expected
    return [{"lat": lat, "lon": lon} for lon, lat in coords]


def call_valhalla(points):
    url = f"{VALHALLA_URL}/trace_attributes"
    body = {
        "shape": points,
        "costing": COSTING,
        "search_radius": SEARCH_RADIUS,
        "shape_match": "map_snap",
        "filters": {"attributes": ["shape", "edge.way_id", "edge.names"]},
    }
    r = requests.post(url, json=body, timeout=30)
    r.raise_for_status()
    return r.json()


def decode_polyline6(encoded: str):
    # Polyline6 decode to list of [lon, lat]
    result = []
    index = lat = lon = 0
    length = len(encoded)
    factor = 1e-6
    while index < length:
        for coord in (lat, lon):
            shift = result_bits = 0
            b = 0x20
            value = 0
            while b >= 0x20:
                b = ord(encoded[index]) - 63
                index += 1
                value |= (b & 0x1F) << shift
                shift += 5
            d = ~(value >> 1) if (value & 1) else (value >> 1)
            if coord is lat:
                lat += d
            else:
                lon += d
        result.append([lon * factor, lat * factor])
    return result


def edges_to_multilines(resp_json):
    coords_list = []
    edges = resp_json.get("edges") or []
    for e in edges:
        shp = e.get("shape")
        if not shp:
            continue
        coords_list.append(decode_polyline6(shp))
    if coords_list:
        return {"type": "MultiLineString", "coordinates": coords_list}
    # Fallback: top-level shape
    shp = resp_json.get("shape")
    if isinstance(shp, str):
        return {"type": "MultiLineString", "coordinates": [decode_polyline6(shp)]}
    return None


def upsert_route_geom(route_id: str, mls_geojson: dict | None, fallback_lines: list[dict]):
    with conn() as c, c.cursor() as cur:
        if mls_geojson is None:
            # Fallback: merge densified shapes as MultiLineString
            coords = []
            for ln in fallback_lines:
                coords.append(ln["coordinates"])  # already lon/lat pairs
            mls_geojson = {"type": "MultiLineString", "coordinates": coords}
        cur.execute(
            """
            INSERT INTO route_streets_geom(route_id, geom, updated_at)
            VALUES (%s, ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(%s)),4326), now())
            ON CONFLICT (route_id)
            DO UPDATE SET geom = EXCLUDED.geom, updated_at = now()
            """,
            (route_id, json.dumps(mls_geojson)),
        )


def chunk_points(points, max_size=15000):
    """Split points into chunks that respect Valhalla's 16k limit"""
    for i in range(0, len(points), max_size):
        yield points[i:i + max_size]


def process_route(route_id: str):
    t0 = time.time()
    lines = densified_shapes_geojson(route_id)
    if not lines:
        print(f"no shapes for {route_id}")
        return

    total_points = 0
    for ln in lines:
        total_points += len(geojson_lines_to_points(ln))

    print(f"processing {route_id}: {total_points} points across {len(lines)} shapes")

    all_segments: list[list[list[float]]] = []
    for i, ln in enumerate(lines):
        pts = geojson_lines_to_points(ln)
        if not pts:
            continue
        if len(pts) > VALHALLA_MAX_POINTS:
            print(f"  shape {i} large ({len(pts)}), chunking...")
            for chunk_idx, chunk in enumerate(chunk_points(pts, max_size=VALHALLA_MAX_POINTS)):
                try:
                    resp = call_valhalla(chunk)
                    mls = edges_to_multilines(resp)
                    if mls and mls.get("coordinates"):
                        all_segments.extend(mls["coordinates"])  # type: ignore
                    print(f"    chunk {chunk_idx}: {len(chunk)} pts -> matched")
                except Exception as e:
                    print(f"    chunk {chunk_idx} error: {e}")
        else:
            try:
                resp = call_valhalla(pts)
                mls = edges_to_multilines(resp)
                if mls and mls.get("coordinates"):
                    all_segments.extend(mls["coordinates"])  # type: ignore
                print(f"  shape {i}: {len(pts)} pts -> matched")
            except Exception as e:
                print(f"  shape {i} error: {e}")

    combined = {"type": "MultiLineString", "coordinates": all_segments} if all_segments else None
    upsert_route_geom(route_id, combined, lines)
    print(f"done {route_id} in {time.time()-t0:.1f}s; segments={len(all_segments)}")


def main():
    only = os.getenv("ROUTE_IDS")
    if only:
        rids = [x.strip() for x in only.split(",") if x.strip()]
    else:
        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT DISTINCT route_id FROM trips ORDER BY route_id")
            rids = [r["route_id"] for r in cur.fetchall()]

    # Skip routes that already have geometry unless overwrite requested
    if not MATCH_OVERWRITE:
        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT route_id FROM route_streets_geom")
            have = {r["route_id"] for r in cur.fetchall()}
        before = len(rids)
        rids = [r for r in rids if r not in have]
        print(f"skipping {before - len(rids)} routes with existing geometry (set MATCH_OVERWRITE=true to reprocess)")

    if not rids:
        print("nothing to process")
        return

    # Parallel processing across routes
    if MATCH_WORKERS <= 1:
        for rid in rids:
            process_route(rid)
    else:
        from concurrent.futures import ThreadPoolExecutor, as_completed

        print(f"processing {len(rids)} routes with {MATCH_WORKERS} workers")
        with ThreadPoolExecutor(max_workers=MATCH_WORKERS) as ex:
            futs = {ex.submit(process_route, rid): rid for rid in rids}
            for fut in as_completed(futs):
                rid = futs[fut]
                try:
                    fut.result()
                except Exception as e:
                    print(f"route {rid} failed: {e}")


if __name__ == "__main__":
    main()
