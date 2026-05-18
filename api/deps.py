"""Authentication dependencies shared across API routers."""
from __future__ import annotations

import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, OAuth2PasswordBearer

JWT_SECRET = os.getenv("JWT_SECRET", "vsa-dev-secret")
JWT_ALGORITHM = "HS256"
CONFIG_API_KEY = os.getenv("CONFIG_API_KEY", "")  # empty = disabled

# JWT bearer for dashboard frontend
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# Static API key bearer for programmatic config CRUD
config_key_scheme = HTTPBearer(auto_error=False)


def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    """Validate JWT token. Also accepts CONFIG_API_KEY as a Bearer fallback."""
    if CONFIG_API_KEY and token == CONFIG_API_KEY:
        return "api-key-user"
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub", "")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_config_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(config_key_scheme),
) -> str:
    """Validate CONFIG_API_KEY or JWT for config CRUD endpoints.

    Accepts:
    - Static CONFIG_API_KEY bearer (for programmatic / CI access)
    - Valid JWT token (for dashboard frontend users)
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    token = credentials.credentials
    # Static key
    if CONFIG_API_KEY and token == CONFIG_API_KEY:
        return "config-api"
    # JWT fallback — lets logged-in dashboard users access config CRUD
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("sub"):
            return payload["sub"]
    except jwt.PyJWTError:
        pass
    raise HTTPException(status_code=401, detail="Invalid or missing API key")
