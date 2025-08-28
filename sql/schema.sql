CREATE TABLE IF NOT EXISTS stops(
  stop_id TEXT PRIMARY KEY,
  name TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  geom geometry(Point, 4326)
);

CREATE TABLE IF NOT EXISTS routes(
  route_id TEXT PRIMARY KEY,
  short_name TEXT,
  long_name TEXT,
  color TEXT,
  text_color TEXT,
  type INT
);

CREATE TABLE IF NOT EXISTS trips(
  trip_id TEXT PRIMARY KEY,
  route_id TEXT REFERENCES routes(route_id),
  service_id TEXT,
  direction_id INT,
  shape_id TEXT
);

CREATE TABLE IF NOT EXISTS stop_times(
  trip_id TEXT REFERENCES trips(trip_id),
  stop_id TEXT REFERENCES stops(stop_id),
  stop_sequence INT,
  arrival_time TEXT,
  departure_time TEXT,
  PRIMARY KEY (trip_id, stop_sequence)
);

CREATE TABLE IF NOT EXISTS shapes(
  shape_id TEXT PRIMARY KEY,
  geom geometry(LineString, 4326)
);

CREATE INDEX IF NOT EXISTS idx_stops_geom ON stops USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_routes_type ON routes(type);
CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(route_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id);
