"""GET/POST/DELETE/PUT /api/users — admin-only user management."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, field_validator

from ..deps import require_admin
from ..services.user_store import user_store

router = APIRouter()


class CreateUserBody(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("email is required")
        return v

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("password must be at least 6 characters")
        return v


class SetPasswordBody(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("password must be at least 6 characters")
        return v


@router.get("/users")
async def list_users(_: str = Depends(require_admin)):
    """Return all LanceDB users (password hashes excluded)."""
    return await user_store.get_all()


@router.post("/users", status_code=201)
async def create_user(body: CreateUserBody, _: str = Depends(require_admin)):
    """Create a new user. Email must be unique."""
    existing = await user_store.get_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")
    return await user_store.create(body.email, body.password)


@router.delete("/users/{email}", status_code=204)
async def delete_user(email: str, _: str = Depends(require_admin)):
    """Delete a user by email."""
    existing = await user_store.get_by_email(email)
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    await user_store.delete(email)


@router.put("/users/{email}/password", status_code=204)
async def set_user_password(email: str, body: SetPasswordBody, _: str = Depends(require_admin)):
    """Set a new password for any user (admin override, no old-password check)."""
    existing = await user_store.get_by_email(email)
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    await user_store.set_password(email, body.password)
