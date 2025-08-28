from prometheus_client import CollectorRegistry, CONTENT_TYPE_LATEST, Counter, Gauge, generate_latest
from starlette.applications import Starlette
from starlette.responses import Response
from starlette.routing import Route

registry = CollectorRegistry()
INGEST_LAG_SECONDS = Gauge("ingest_lag_seconds", "Age of last GTFS-RT payload", registry=registry)
VEHICLE_COUNT = Gauge("vehicle_count", "Current vehicles in cache", registry=registry)

async def metrics_endpoint(request):
    data = generate_latest(registry)
    return Response(data, media_type=CONTENT_TYPE_LATEST)

metrics_app = Starlette(routes=[Route("/", metrics_endpoint)])
