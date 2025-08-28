import os, time
from google.transit import gtfs_realtime_pb2 as gtfs
from .feeds import fetch_bytes, VEH_FEED, TRIP_FEED, ALERTS_FEED
from .normalize import mock_vehicles
from .writers import (
    write_current_vehicles,
    mark_ingest_now,
    write_trip_updates_raw,
    write_alerts_raw,
    write_derived_routes,
    write_current_vehicles_for,
    update_vehicles_union,
    write_derived_routes_for,
    update_derived_routes_union,
)
from .metrics import serve_metrics, INGEST_CYCLE_SECONDS

VEHICLES_POLL_SECONDS = int(os.getenv("VEHICLES_POLL_SECONDS", "6"))  # default 10/min
TRIP_UPDATES_POLL_SECONDS = int(os.getenv("TRIP_UPDATES_POLL_SECONDS", "60"))  # default 1/min
ALERTS_POLL_SECONDS = int(os.getenv("ALERTS_POLL_SECONDS", "60"))  # default 1/min


def load_feed_configs():
    # Supports multi-feed via FEEDS="localbus,marc" with per-feed vars
    # FEED_localbus_VEHICLES_URL, FEED_localbus_TRIP_UPDATES_URL, FEED_localbus_ALERTS_URL, FEED_localbus_API_KEY
    names = [n.strip() for n in os.getenv("FEEDS", "").split(",") if n.strip()]
    feeds = []
    if names:
        for name in names:
            prefix = f"FEED_{name}"
            feeds.append(
                {
                    "name": name,
                    "veh": os.getenv(f"{prefix}_VEHICLES_URL"),
                    "trip": os.getenv(f"{prefix}_TRIP_UPDATES_URL"),
                    "alerts": os.getenv(f"{prefix}_ALERTS_URL"),
                    "api_key": os.getenv(f"{prefix}_API_KEY"),
                    # allow per-feed intervals; fall back to global
                    "veh_sec": int(os.getenv(f"{prefix}_VEHICLES_POLL_SECONDS", str(VEHICLES_POLL_SECONDS))),
                    "trip_sec": int(os.getenv(f"{prefix}_TRIP_UPDATES_POLL_SECONDS", str(TRIP_UPDATES_POLL_SECONDS))),
                    "alerts_sec": int(os.getenv(f"{prefix}_ALERTS_POLL_SECONDS", str(ALERTS_POLL_SECONDS))),
                }
            )
    else:
        # Legacy single-feed envs
        feeds.append(
            {
                "name": "default",
                "veh": VEH_FEED,
                "trip": TRIP_FEED,
                "alerts": ALERTS_FEED,
                "api_key": os.getenv("SWIFTLY_API_KEY"),
                "veh_sec": VEHICLES_POLL_SECONDS,
                "trip_sec": TRIP_UPDATES_POLL_SECONDS,
                "alerts_sec": ALERTS_POLL_SECONDS,
            }
        )
    return feeds


def _parse_vehicles(pb_bytes: bytes):
    feed = gtfs.FeedMessage()
    feed.ParseFromString(pb_bytes)
    ts_fallback = int(feed.header.timestamp) if feed.header.timestamp else int(time.time())
    out = []
    for ent in feed.entity:
        if not ent.HasField("vehicle"):
            continue
        v = ent.vehicle
        pos = v.position
        if not pos or not pos.latitude or not pos.longitude:
            continue
        vid = v.vehicle.id if v.vehicle and v.vehicle.id else (ent.id or "")
        route_id = v.trip.route_id if v.trip and v.trip.route_id else ""
        ts = int(v.timestamp) if v.timestamp else ts_fallback
        out.append(
            {
                "id": vid or f"veh_{len(out)}",
                "route_id": route_id or "UNKNOWN",
                "lat": float(pos.latitude),
                "lon": float(pos.longitude),
                "speed": float(pos.speed) if pos.speed else None,
                "heading": int(pos.bearing) if pos.bearing else None,
                "ts": ts,
            }
        )
    return out


def run_cycle(fetch_due: dict, feeds_cfg: list[dict]):
    now = time.time()
    feed_names = [f["name"] for f in feeds_cfg]

    for f in feeds_cfg:
        fname = f["name"]
        # Vehicles
        if now >= fetch_due.get((fname, "veh"), 0):
            try:
                headers = (
                    {"Authorization": f.get("api_key"), "X-API-Key": f.get("api_key")}
                    if f.get("api_key")
                    else None
                )
                raw = fetch_bytes(f.get("veh"), headers=headers)
                if raw:
                    vehicles = _parse_vehicles(raw)
                    if vehicles:
                        write_current_vehicles_for(fname, vehicles)
                        mark_ingest_now()
                        write_derived_routes_for(fname, [v.get("route_id") for v in vehicles])
                else:
                    mv = mock_vehicles()
                    write_current_vehicles_for(fname, mv)
                    mark_ingest_now()
                    write_derived_routes_for(fname, [v.get("route_id") for v in mv])
            except Exception as e:
                print(f"{fname} vehicles fetch/parse error:", e)
                mv = mock_vehicles()
                write_current_vehicles_for(fname, mv)
                mark_ingest_now()
                write_derived_routes_for(fname, [v.get("route_id") for v in mv])
            finally:
                fetch_due[(fname, "veh")] = now + max(1, int(f.get("veh_sec") or VEHICLES_POLL_SECONDS))

        # Trip updates
        if now >= fetch_due.get((fname, "trip"), 0):
            try:
                headers = (
                    {"Authorization": f.get("api_key"), "X-API-Key": f.get("api_key")}
                    if f.get("api_key")
                    else None
                )
                raw = fetch_bytes(f.get("trip"), headers=headers)
                if raw:
                    write_trip_updates_raw(raw)
            except Exception as e:
                print(f"{fname} trip updates fetch error:", e)
            finally:
                fetch_due[(fname, "trip")] = now + max(5, int(f.get("trip_sec") or TRIP_UPDATES_POLL_SECONDS))

        # Alerts
        if now >= fetch_due.get((fname, "alerts"), 0):
            try:
                headers = (
                    {"Authorization": f.get("api_key"), "X-API-Key": f.get("api_key")}
                    if f.get("api_key")
                    else None
                )
                raw = fetch_bytes(f.get("alerts"), headers=headers)
                if raw:
                    write_alerts_raw(raw)
            except Exception as e:
                print(f"{fname} alerts fetch error:", e)
            finally:
                fetch_due[(fname, "alerts")] = now + max(5, int(f.get("alerts_sec") or ALERTS_POLL_SECONDS))

    # Update union keys for API consumption
    update_vehicles_union(feed_names)
    update_derived_routes_union(feed_names)


def main():
    serve_metrics()
    feeds_cfg = load_feed_configs()
    due = {}
    while True:
        t0 = time.time()
        try:
            run_cycle(due, feeds_cfg)
        except Exception as e:
            print("ingest cycle error:", e)
        INGEST_CYCLE_SECONDS.set(time.time() - t0)
        # tick every second for due scheduling
        time.sleep(1)


if __name__ == "__main__":
    main()
