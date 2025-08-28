import os, requests

VEH_FEED = os.getenv("GTFS_RT_VEHICLES_URL")
TRIP_FEED = os.getenv("GTFS_RT_TRIP_UPDATES_URL")
ALERTS_FEED = os.getenv("GTFS_RT_ALERTS_URL")

SWIFTLY_API_KEY = os.getenv("SWIFTLY_API_KEY")


def _headers_for(url: str | None, extra: dict | None = None):
    # Prefer header-based auth for Swiftly if key is provided
    if not url:
        return extra or {}
    headers = {}
    headers.update(extra or {})

    # Default Accept based on URL (protobuf for .pb, fallback to JSON else)
    if "Accept" not in {k.title(): v for k, v in headers.items()}:
        if url.endswith(".pb") or "/gtfs-rt/" in url or "gtfs-rt-" in url:
            headers.setdefault("Accept", "application/x-protobuf, application/octet-stream")
        else:
            headers.setdefault("Accept", "application/json, application/json; charset=utf-8")

    if "goswift.ly" in url:
        # Support both Authorization and X-API-Key
        key = (
            headers.get("Authorization")
            or headers.get("X-API-Key")
            or SWIFTLY_API_KEY
        )
        if key:
            headers.setdefault("Authorization", key)
            headers.setdefault("X-API-Key", key)
    return headers


def fetch_bytes(url: str | None, headers: dict | None = None):
    if not url:
        return None
    resp = requests.get(url, headers=_headers_for(url, headers), timeout=10)
    resp.raise_for_status()
    return resp.content
