from fastapi import FastAPI, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

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


# SPA static assets + catch-all (must be after API routes)
if settings.frontend_dist.exists():
    assets = settings.frontend_dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/")
    def spa_root():
        index = settings.frontend_dist / "index.html"
        return FileResponse(index)

    @app.get("/{full_path:path}")
    def spa_catch_all(full_path: str = ""):
        # Never shadow API (in case a request slips past routers)
        if full_path.startswith("api/") or full_path == "api":
            return Response(
                content='{"error":"not found"}',
                status_code=404,
                media_type="application/json",
            )
        # Prefer real files under dist (favicon, etc.)
        candidate = settings.frontend_dist / full_path
        if (
            full_path
            and candidate.is_file()
            and candidate.resolve().is_relative_to(settings.frontend_dist.resolve())
        ):
            return FileResponse(candidate)
        index = settings.frontend_dist / "index.html"
        return FileResponse(index)
