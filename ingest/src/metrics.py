from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

registry = CollectorRegistry()
INGEST_CYCLE_SECONDS = Gauge("ingest_cycle_seconds", "Seconds per ingest loop", registry=registry)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/metrics":
            self.send_response(404)
            self.end_headers()
            return
        data = generate_latest(registry)
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPE_LATEST)
        self.end_headers()
        self.wfile.write(data)


def serve_metrics(port=9108):
    server = HTTPServer(("0.0.0.0", port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
