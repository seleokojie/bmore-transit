import os, json, time
import redis

_redis = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)


def r() -> redis.Redis:
    return _redis


# helpers for vehicles mock/live
def get_current_vehicles():
    raw = r().get("vehicles:current")
    return [] if not raw else json.loads(raw)


def set_current_vehicles(objs):
    r().set("vehicles:current", json.dumps(objs), ex=30)


def set_ingest_timestamp(ts: float | None = None):
    r().set("ingest:last_ts", int(ts or time.time()))


def get_ingest_lag_seconds():
    ts = r().get("ingest:last_ts")
    return None if not ts else max(0, int(time.time()) - int(ts))


def get_derived_routes():
    raw = r().get("routes:derived")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return []
