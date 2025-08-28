from fastapi import APIRouter, Query
from ..services.redis_client import get_current_vehicles, get_ingest_lag_seconds
from ..metrics import VEHICLE_COUNT, INGEST_LAG_SECONDS

router = APIRouter()


@router.get("")
def vehicles(bbox: str | None = Query(default=None), route_id: str | None = None):
    """Return current vehicles from Redis; bbox/route_id can be used to filter in future."""
    data = get_current_vehicles()
    VEHICLE_COUNT.set(len(data))
    lag = get_ingest_lag_seconds()
    if lag is not None:
        INGEST_LAG_SECONDS.set(lag)
    # Optionally filter here by route_id and bbox.
    return data
