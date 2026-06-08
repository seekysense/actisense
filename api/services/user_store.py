"""UserStore — LanceDB-backed user CRUD with bcrypt password hashing.

All public methods are async and run the sync LanceDB operations in a thread
executor, matching the pattern used by LanceDBReader.

Password hashes never leave this module: callers receive sanitised dicts with
the 'password_hash' field stripped.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import bcrypt

log = logging.getLogger("user_store")

_LANCEDB_PATH = os.getenv("LANCEDB_PATH", "/data/vsa_lancedb")
_TABLE_NAME = "users"
_MAX_LOGINS = 5


def _public_row(row: dict) -> dict:
    """Return row dict without the password_hash field."""
    return {k: v for k, v in row.items() if k != "password_hash"}


class UserStore:
    """Persistent user store backed by the LanceDB table 'users'."""

    def __init__(self, db_path: str = _LANCEDB_PATH):
        self._path = db_path
        self._db = None
        self._table = None

    # ── connection / table bootstrap ──────────────────────────────

    def _connect(self):
        if self._db is None:
            import lancedb
            self._db = lancedb.connect(self._path)
        return self._db

    def _get_table(self):
        if self._table is not None:
            return self._table
        db = self._connect()
        if _TABLE_NAME in db.table_names():
            self._table = db.open_table(_TABLE_NAME)
        else:
            import pyarrow as pa
            schema = pa.schema([
                pa.field("id", pa.string()),
                pa.field("email", pa.string()),
                pa.field("password_hash", pa.string()),
                pa.field("role", pa.string()),
                pa.field("created_at", pa.string()),
                pa.field("last_logins", pa.string()),  # JSON-encoded list[str]
            ])
            self._table = db.create_table(_TABLE_NAME, schema=schema)
        return self._table

    # ── password helpers ──────────────────────────────────────────

    @staticmethod
    def _hash(plain: str) -> str:
        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

    @staticmethod
    def _check(plain: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(plain.encode(), hashed.encode())
        except Exception:
            return False

    # ── sync internals ────────────────────────────────────────────

    def _get_row_sync(self, email: str) -> dict | None:
        """Raw row including password_hash — internal use only."""
        try:
            table = self._get_table()
            safe = email.replace("'", "''")
            rows = table.search().where(f"email = '{safe}'").limit(1).to_list()
            return dict(rows[0]) if rows else None
        except Exception:
            log.exception("UserStore._get_row_sync failed for %s", email)
            return None

    def _get_all_sync(self) -> list[dict]:
        try:
            table = self._get_table()
            rows = table.search().to_list()
            return [_public_row(dict(r)) for r in rows]
        except Exception:
            log.exception("UserStore._get_all_sync failed")
            return []

    def _get_by_email_sync(self, email: str) -> dict | None:
        row = self._get_row_sync(email)
        return _public_row(row) if row else None

    def _create_sync(self, email: str, plain_password: str) -> dict:
        import pyarrow as pa
        table = self._get_table()
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "id": str(uuid.uuid4()),
            "email": email,
            "password_hash": self._hash(plain_password),
            "role": "user",
            "created_at": now,
            "last_logins": "[]",
        }
        table.add(pa.table({k: [v] for k, v in row.items()}))
        log.info("UserStore: created user %s", email)
        return _public_row(row)

    def _delete_sync(self, email: str) -> bool:
        try:
            table = self._get_table()
            safe = email.replace("'", "''")
            table.delete(f"email = '{safe}'")
            log.info("UserStore: deleted user %s", email)
            return True
        except Exception:
            log.exception("UserStore._delete_sync failed for %s", email)
            return False

    def _set_password_sync(self, email: str, new_plain: str) -> bool:
        try:
            table = self._get_table()
            safe = email.replace("'", "''")
            table.update(
                where=f"email = '{safe}'",
                values={"password_hash": self._hash(new_plain)},
            )
            log.info("UserStore: password updated for %s", email)
            return True
        except Exception:
            log.exception("UserStore._set_password_sync failed for %s", email)
            return False

    def _verify_password_sync(self, email: str, plain: str) -> bool:
        row = self._get_row_sync(email)
        if not row:
            return False
        return self._check(plain, row["password_hash"])

    def _record_login_sync(self, email: str) -> None:
        try:
            row = self._get_row_sync(email)
            if not row:
                return
            logins: list[str] = json.loads(row.get("last_logins") or "[]")
            logins.append(datetime.now(timezone.utc).isoformat())
            logins = logins[-_MAX_LOGINS:]
            safe = email.replace("'", "''")
            self._get_table().update(
                where=f"email = '{safe}'",
                values={"last_logins": json.dumps(logins)},
            )
        except Exception:
            log.exception("UserStore._record_login_sync failed for %s", email)

    # ── public async API ──────────────────────────────────────────

    async def get_all(self) -> list[dict]:
        """Return all users (no password_hash)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_all_sync)

    async def get_by_email(self, email: str) -> dict | None:
        """Return a single user by email (no password_hash), or None."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_by_email_sync, email)

    async def create(self, email: str, plain_password: str) -> dict:
        """Create a new user, hashing the password. Returns the created row."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._create_sync, email, plain_password)

    async def delete(self, email: str) -> bool:
        """Delete a user by email. Returns True on success."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._delete_sync, email)

    async def set_password(self, email: str, new_plain: str) -> bool:
        """Replace the stored password hash. Returns True on success."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._set_password_sync, email, new_plain)

    async def verify_password(self, email: str, plain: str) -> bool:
        """Return True if plain matches the stored bcrypt hash."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._verify_password_sync, email, plain)

    async def record_login(self, email: str) -> None:
        """Append a login timestamp; keeps only the last 5 entries."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._record_login_sync, email)


# Module-level singleton — imported by routers that need user operations.
user_store = UserStore()
