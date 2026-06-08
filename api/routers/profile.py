"""GET/PUT /api/profile — profile and password management for the current user."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..deps import get_current_user_info
from ..services.user_store import user_store

router = APIRouter()


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str


@router.get("/profile")
async def get_profile(user: dict = Depends(get_current_user_info)):
    """Return profile data for the currently authenticated user.

    Admin accounts are resolved from .env and have no login history.
    """
    username = user["sub"]
    role = user["role"]

    if role == "admin":
        return {"email": username, "role": "admin", "last_logins": []}

    row = await user_store.get_by_email(username)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    last_logins: list[str] = json.loads(row.get("last_logins") or "[]")
    return {"email": row["email"], "role": row["role"], "last_logins": last_logins}


@router.put("/profile/password", status_code=204)
async def change_password(
    body: ChangePasswordBody,
    user: dict = Depends(get_current_user_info),
):
    """Change the current user's password after verifying the old one.

    Not available for the admin account (password is managed via .env).
    """
    username = user["sub"]
    role = user["role"]

    if role == "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin password is managed via environment variables, not via this endpoint.",
        )

    if body.old_password == body.new_password:
        raise HTTPException(status_code=400, detail="New password must differ from the current one")

    if not await user_store.verify_password(username, body.old_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    await user_store.set_password(username, body.new_password)
