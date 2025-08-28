.PHONY: up down logs seed test format openapi dev

up:
	docker compose up --build

down:
	docker compose down -v

logs:
	docker compose logs -f --tail=200

seed:
	bash scripts/load_gtfs.sh

test:
	PYTHONPATH=api:ingest pytest -q api/tests ingest/tests || true

format:
	black api ingest || true
	ruff api ingest --fix || true

openapi:
	curl -s http://localhost:8080/openapi.json -o packages/schemas/openapi.json || true

.PHONY: streets
streets:
	docker compose exec -T \
	  -e ROUTE_IDS \
	  -e MATCH_SAMPLE_METERS \
	  -e MATCH_SEARCH_RADIUS \
	  -e MATCH_WORKERS \
	  -e MATCH_OVERWRITE \
	  -e VALHALLA_MAX_POINTS \
	  ingest python -m src.match_routes

dev:
	# Start infra in the background
	docker compose up -d db redis valhalla
	# Start API (reload), ingest (watch), and Angular dev server with overlay
	docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up api ingest web-dev
