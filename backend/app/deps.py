"""Mocked authentication.

There are no passwords: the frontend sends the active user's id in the
`X-User-Id` header (chosen from the "Switch account" menu). Swapping this for
JWT/session auth later only touches this file.
"""
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import User


def get_current_user(
    x_user_id: int | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if x_user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Log in to continue")
    user = db.get(User, x_user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown user")
    return user


def get_current_host(user: User = Depends(get_current_user)) -> User:
    if not user.is_host:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Switch to a host account to manage listings")
    return user
