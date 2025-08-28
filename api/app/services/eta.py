from typing import Dict


def baseline_eta(
    vehicle_speed_mps: float, remaining_meters: float, scheduled_epoch: int | None, now_epoch: int
) -> Dict:
    """Very simple ETA: distance / speed clamped, blended with schedule if present."""
    speed = max(5 / 3.6, min(vehicle_speed_mps or 0, 22))  # clamp ~1.4..22 m/s
    naive = now_epoch + int(remaining_meters / max(speed, 0.1))
    if scheduled_epoch:
        return {"eta": max(naive, scheduled_epoch), "uncertainty": 60}
    return {"eta": naive, "uncertainty": 90}
