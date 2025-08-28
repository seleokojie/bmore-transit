from fastapi import APIRouter, Query

router = APIRouter()


@router.get("/vehicles")
def vehicles_replay(minute: str = Query(..., description="YYYYMMDDHHmm")):
    # Placeholder: would fetch compressed snapshot from Redis positions:minute:{minute}
    return []
