from fastapi import Depends, FastAPI, Response

from .auth import LoginRequest, login, require_token
from .config import settings

app = FastAPI(title="8090 Chat Agent", root_path=settings.chat_root_path)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "chat-agent"}


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response):
    return login(payload, response)


@app.get("/api/sessions")
def list_sessions(_=Depends(require_token)):
    return []
