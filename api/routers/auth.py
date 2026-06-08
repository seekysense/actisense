"""POST /api/auth/login — returns JWT access token.

Login priority:
  1. Admin credentials from .env (API_USERNAME / API_PASSWORD) — plaintext,
     never stored in LanceDB.
  2. Regular users stored in LanceDB with bcrypt-hashed passwords.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from ..services.user_store import user_store

router = APIRouter()

_JWT_SECRET = os.getenv("JWT_SECRET", "vsa-dev-secret")
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRE_HOURS = 24

_ADMIN_USER = os.getenv("API_USERNAME", "admin")
_ADMIN_PASS = os.getenv("API_PASSWORD", "changeme")

_INVALID = HTTPException(status_code=401, detail="Incorrect username or password")


def create_access_token(username: str, role: str) -> str:
    payload = {
        "sub": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=_JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


@router.post("/auth/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    username = form.username
    password = form.password

    # ── 1. admin from .env ────────────────────────────────────────
    if username == _ADMIN_USER:
        if password != _ADMIN_PASS:
            raise _INVALID
        token = create_access_token(username, "admin")
        return {"access_token": token, "token_type": "bearer", "username": username, "role": "admin"}

    # ── 2. regular user from LanceDB ──────────────────────────────
    if not await user_store.verify_password(username, password):
        raise _INVALID

    await user_store.record_login(username)
    token = create_access_token(username, "user")
    return {"access_token": token, "token_type": "bearer", "username": username, "role": "user"}
