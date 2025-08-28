import os
import psycopg2
from psycopg2.extras import RealDictCursor

raw = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db:5432/transit")
# psycopg2 does not understand the "+psycopg2" dialect suffix
DATABASE_URL = raw.replace("postgresql+psycopg2://", "postgresql://").replace(
    "postgres+psycopg2://", "postgres://"
)


def conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
