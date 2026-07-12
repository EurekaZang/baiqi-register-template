import hmac
from typing import Annotated

from fastapi import Cookie, Header, HTTPException, Response, status
from pydantic import BaseModel

from .config import settings


class LoginRequest(BaseModel):
    token: str


def _is_valid_token(token: str | None) -> bool:
    if not token:
        return False
    return hmac.compare_digest(token, settings.chat_token)


def _token_from_authorization(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def require_token(
    authorization: Annotated[str | None, Header()] = None,
    chat_token: Annotated[str | None, Cookie()] = None,
) -> None:
    token = _token_from_authorization(authorization) or chat_token
    if not _is_valid_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing token",
        )


def login(payload: LoginRequest, response: Response) -> dict[str, bool]:
    if not _is_valid_token(payload.token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    response.set_cookie(
        key="chat_token",
        value=payload.token,
        httponly=True,
        samesite="lax",
        path="/chat",
    )
    return {"ok": True}
