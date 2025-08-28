from fastapi import APIRouter
from ..db.connection import conn

router = APIRouter()


@router.get("/near")
def near(lat: float, lon: float, r: int = 500):
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
          SELECT stop_id, name, ST_Y(geom) AS lat, ST_X(geom) AS lon
          FROM stops
          WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography, %s)
        """,
            (lon, lat, r),
        )
        return cur.fetchall()


@router.get("/{stop_id}/arrivals")
def arrivals(stop_id: str):
    # Placeholder: would read Redis "trip_eta:{stop_id}"
    return []
