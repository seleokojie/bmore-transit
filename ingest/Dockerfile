FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY pyproject.toml ./
RUN pip install --no-cache-dir protobuf gtfs-realtime-bindings redis psycopg2-binary python-dotenv requests prometheus-client
COPY src ./src
EXPOSE 9108
CMD ["python", "-m", "src.main"]
