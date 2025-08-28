import json, time, os, redis
from prometheus_client import Gauge

r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)


def write_current_vehicles(vehicles):
    r.set("vehicles:current", json.dumps(vehicles), ex=30)


def mark_ingest_now():
    r.set("ingest:last_ts", int(time.time()))


def write_trip_updates_raw(raw: bytes | str, ttl=120):
    # Store raw protobuf (or JSON string) for future processing
    if isinstance(raw, bytes):
        r.set("gtfsrt:trip_updates", raw, ex=ttl)
    else:
        r.set("gtfsrt:trip_updates", raw, ex=ttl)


def write_alerts_raw(raw: bytes | str, ttl=300):
    if isinstance(raw, bytes):
        r.set("gtfsrt:alerts", raw, ex=ttl)
    else:
        r.set("gtfsrt:alerts", raw, ex=ttl)


def write_derived_routes(route_ids):
    # Store as JSON array for easy retrieval by API
    if not route_ids:
        return
    try:
        uniq = sorted({rid for rid in route_ids if rid})
        r.set("routes:derived", json.dumps(uniq), ex=3600)
    except Exception:
        pass


def write_current_vehicles_for(feed: str, vehicles):
    r.set(f"vehicles:current:{feed}", json.dumps(vehicles), ex=30)


def update_vehicles_union(feeds: list[str]):
    all_vs = []
    for f in feeds:
        raw = r.get(f"vehicles:current:{f}")
        if raw:
            try:
                all_vs.extend(json.loads(raw))
            except Exception:
                continue
    write_current_vehicles(all_vs)


def write_derived_routes_for(feed: str, route_ids):
    if not route_ids:
        return
    try:
        uniq = sorted({rid for rid in route_ids if rid})
        r.set(f"routes:derived:{feed}", json.dumps(uniq), ex=3600)
    except Exception:
        pass


def update_derived_routes_union(feeds: list[str]):
    all_routes = set()
    for f in feeds:
        raw = r.get(f"routes:derived:{f}")
        if raw:
            try:
                all_routes.update(json.loads(raw))
            except Exception:
                continue
    write_derived_routes(sorted(all_routes))
