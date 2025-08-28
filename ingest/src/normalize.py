import random, time
from typing import List, Dict


def mock_vehicles(n=12) -> List[Dict]:
    base = {"route_id": "MOCK", "speed": 8.0, "heading": 90}
    out = []
    for i in range(n):
        out.append(
            {
                "id": f"veh_{i}",
                "route_id": base["route_id"],
                "lat": 39.2904 + random.uniform(-0.02, 0.02),
                "lon": -76.6122 + random.uniform(-0.02, 0.02),
                "speed": base["speed"] + random.uniform(-3, 3),
                "heading": base["heading"],
                "ts": int(time.time()),
            }
        )
    return out
