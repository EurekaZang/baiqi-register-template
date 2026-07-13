from fastapi import FastAPI, Response

from .auth import LoginRequest, login
from .config import settings
from .sessions import router as sessions_router

app = FastAPI(title="8090 Chat Agent", root_path=settings.chat_root_path)
app.include_router(sessions_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "chat-agent"}


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response):
    return login(payload, response)
