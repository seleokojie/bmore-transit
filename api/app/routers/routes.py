from fastapi import APIRouter
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
