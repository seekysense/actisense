"""Authentication dependencies shared across API routers."""
from __future__ import annotations

import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

JWT_SECRET = os.getenv("JWT_SECRET", "vsa-dev-secret")
JWT_ALGORITHM = "HS256"
CONFIG_API_KEY = os.getenv("CONFIG_API_KEY", "")  # empty = disabled

# Single Bearer scheme for both dashboard JWT and static CONFIG_API_KEY.
# Using HTTPBearer (not OAuth2PasswordBearer) so Swagger shows a plain token
# field instead of a username/password form — both JWT and CONFIG_API_KEY work.
bearer_scheme = HTTPBearer(auto_error=True)

# Alias used by config CRUD endpoints (accepts same tokens, auto_error=False
# so the dependency can raise a custom 401 instead of the default 403).
config_key_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """Validate Bearer token — accepts CONFIG_API_KEY or a valid JWT."""
    token = credentials.credentials
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


def get_current_user_info(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """Return {'sub': username, 'role': role} from a valid JWT."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"sub": payload.get("sub", ""), "role": payload.get("role", "user")}
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """Validate Bearer token and require admin role."""
    token = credentials.credentials
    if CONFIG_API_KEY and token == CONFIG_API_KEY:
        return "api-key-user"
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        role = payload.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Admin role required")
        return payload.get("sub", "")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
