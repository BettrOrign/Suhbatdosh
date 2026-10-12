"""Pytest fixtures: a throwaway DATA_DIR and a TestClient over the real app.

The environment is configured before ``app`` is imported because
``app.config`` reads env at import time and creates the data directories.
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

_TMP = tempfile.mkdtemp(prefix="suhbatdosh-test-")
os.environ["DATA_DIR"] = _TMP
os.environ["TELEGRAM_ENABLED"] = "false"
os.environ["YOUTUBE_ENABLED"] = "false"
# No demo accounts with well-known passwords in the test database.
os.environ["APP_ENV"] = "prod"
os.environ.pop("ADMIN_EMAIL", None)
os.environ.pop("ADMIN_PASSWORD", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.auth import hash_password  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def data_dir() -> str:
    return _TMP


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_token(data_dir) -> str:
    """Create an admin account directly and return a fresh session token."""
    email = "test-admin@example.com"
    user = db.get_user_by_email(email)
    if not user:
        uid = db.create_user("Test Admin", email, hash_password("admin-pass"), role="admin")
    else:
        uid = user["id"]
    from app.auth import new_session
    return new_session(uid)


@pytest.fixture
def manager_token() -> str:
    """Create a plain manager account and return a fresh session token."""
    email = "test-manager@example.com"
    user = db.get_user_by_email(email)
    if not user:
        uid = db.create_user("Test Manager", email, hash_password("manager-pass"), role="manager")
    else:
        uid = user["id"]
    from app.auth import new_session
    return new_session(uid)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}