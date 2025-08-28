.PHONY: up down logs seed test format openapi

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
	docker compose exec -T ingest python -m src.match_routes
