"""POST /api/auth/login — returns JWT access token."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from fastapi import Depends

router = APIRouter()

_JWT_SECRET = os.getenv("JWT_SECRET", "vsa-dev-secret")
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRE_HOURS = 24


def create_access_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=_JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


@router.post("/auth/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    expected_user = os.getenv("API_USERNAME", "admin")
    expected_pass = os.getenv("API_PASSWORD", "changeme")
    if form.username != expected_user or form.password != expected_pass:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(form.username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": form.username,
    }
