from ingest.src.normalize import mock_vehicles


def test_mock_vehicles_shape():
    vs = mock_vehicles(3)
    assert len(vs) == 3
    assert {"id", "lat", "lon", "ts"}.issubset(vs[0].keys())
