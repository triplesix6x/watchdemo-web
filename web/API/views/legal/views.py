from fastapi import APIRouter, Response

from APP.dependencies import AnnLegalService
from APP.entities.legal import SignupPolicy

router = APIRouter(prefix="/legal", tags=["legal"])


@router.get("/signup-policy", response_model=SignupPolicy)
async def signup_policy(service: AnnLegalService, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await service.signup_policy()
