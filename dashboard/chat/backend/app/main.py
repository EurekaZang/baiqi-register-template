from fastapi import FastAPI, Response

from .agent_bridge import router as agent_router
from .auth import LoginRequest, login
from .config import settings
from .models_api import router as models_router
from .sessions import router as sessions_router

app = FastAPI(title="8090 Chat Agent", root_path=settings.chat_root_path)
app.include_router(sessions_router)
app.include_router(models_router)
app.include_router(agent_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "chat-agent"}


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response):
    return login(payload, response)
