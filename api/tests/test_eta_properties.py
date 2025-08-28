from app.services.eta import baseline_eta
import time


def test_eta_not_in_past():
    now = int(time.time())
    eta = baseline_eta(10, 1000, None, now)
    assert eta["eta"] >= now
