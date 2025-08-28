from fastapi import APIRouter, Response
from ..db.connection import conn
from ..services.redis_client import get_derived_routes

router = APIRouter()


@router.get("")
def list_routes():
    # Primary: Postgres
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "SELECT route_id, short_name, long_name, color, text_color, type FROM routes ORDER BY route_id"
            )
            rows = cur.fetchall()
            if rows:
                return rows
    except Exception:
        # DB not ready or schema not loaded
        pass

    # Fallback: derive from realtime vehicles stored in Redis
    derived = get_derived_routes()
    return [
        {
            "route_id": rid,
            "short_name": rid,
            "long_name": rid,
            "color": "000000",
            "text_color": "FFFFFF",
            "type": 3,
        }
        for rid in derived
    ]


@router.get("/{route_id}/shape")
def route_shape(route_id: str):
    sql = """
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type','Feature',
            'geometry', ST_AsGeoJSON(geom)::json,
            'properties', json_build_object('shape_id', shape_id)
          )
        )
      ) AS fc
      FROM shapes s
      JOIN trips t ON t.shape_id = s.shape_id
      WHERE t.route_id = %s
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, (route_id,))
        row = cur.fetchone()
        return row["fc"] or {"type": "FeatureCollection", "features": []}


@router.get("/{route_id}/streets")
def route_streets(route_id: str):
    sql = """
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', CASE WHEN geom IS NULL THEN '[]'::json ELSE json_build_array(
          json_build_object('type','Feature','geometry', ST_AsGeoJSON(geom)::json, 'properties', json_build_object('route_id', route_id))
        ) END
      ) AS fc
      FROM route_streets_geom
      WHERE route_id = %s
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, (route_id,))
        row = cur.fetchone()
        return (row and row["fc"]) or {"type": "FeatureCollection", "features": []}


@router.get("/{route_id}/bbox")
def route_bbox(route_id: str):
    """Return [minLon, minLat, maxLon, maxLat] for the route streets geometry.
    Fast to compute and useful to fit map view before loading tiles.
    """
    sql = """
      SELECT 
        ST_XMin(ext)::float AS minx,
        ST_YMin(ext)::float AS miny,
        ST_XMax(ext)::float AS maxx,
        ST_YMax(ext)::float AS maxy
      FROM (
        SELECT ST_Extent(geom) AS ext
        FROM route_streets_geom
        WHERE route_id = %s
      ) t
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, (route_id,))
        row = cur.fetchone()
        if not row or row["minx"] is None:
            return None
        return [row["minx"], row["miny"], row["maxx"], row["maxy"]]


@router.get("/{route_id}/streets.mvt/{z}/{x}/{y}")
def route_streets_mvt(route_id: str, z: int, x: int, y: int):
    """Serve vector tiles (MVT) for a single route's streets geometry.
    Uses PostGIS ST_AsMVT with ST_TileEnvelope for clipping and transform to web mercator.
    """
    sql = """
      WITH bounds AS (
        SELECT ST_TileEnvelope(%s,%s,%s) AS env
      ), data AS (
        SELECT 
          ST_AsMVTGeom(ST_Transform(r.geom, 3857), (SELECT env FROM bounds)) AS geom,
          r.route_id
        FROM route_streets_geom r, bounds
        WHERE r.route_id = %s AND ST_Intersects(ST_Transform(r.geom,3857), (SELECT env FROM bounds))
      )
      SELECT ST_AsMVT(data, 'streets', 4096, 'geom') AS tile
      FROM data
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, (z, x, y, route_id))
        row = cur.fetchone()
        tile = row and row["tile"] or None
        if not tile:
            # Return an empty tile
            empty = b""  # MapLibre accepts empty response
            return Response(content=empty, media_type="application/vnd.mapbox-vector-tile", headers={
                "Cache-Control": "public, max-age=86400"
            })
        return Response(content=bytes(tile), media_type="application/vnd.mapbox-vector-tile", headers={
            "Cache-Control": "public, max-age=86400"
        })
