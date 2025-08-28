import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import health, routes, stops, vehicles, replay
from .metrics import metrics_app

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:4200").split(",")

app = FastAPI(title="Baltimore Transit API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/healthz", tags=["health"])
app.include_router(routes.router, prefix="/routes", tags=["routes"])
app.include_router(stops.router, prefix="/stops", tags=["stops"])
app.include_router(vehicles.router, prefix="/vehicles", tags=["vehicles"])
app.include_router(replay.router, prefix="/replay", tags=["replay"])

# Expose Prometheus metrics at /metrics
app.mount("/metrics", metrics_app)
