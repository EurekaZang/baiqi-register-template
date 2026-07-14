from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse

from .agent_bridge import router as agent_router
from .auth import LoginRequest, login
from .config import settings
from .image_gen import router as image_router
from .models_api import router as models_router
from .sessions import router as sessions_router

app = FastAPI(title="8090 Chat Agent", root_path=settings.chat_root_path)
app.include_router(sessions_router)
app.include_router(models_router)
app.include_router(agent_router)
app.include_router(image_router)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "chat-agent",
        "image": {
            "upstream": settings.chat_grok2api_url,
            "model": settings.chat_image_model,
        },
    }


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response):
    return login(payload, response)


def _safe_dist_file(rel: str) -> Path | None:
    """Resolve a file under frontend dist; None if missing or path-escape."""
    if not rel or rel.startswith("/") or "\\" in rel:
        return None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    root = settings.frontend_dist.resolve()
    candidate = root.joinpath(*parts).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


# SPA static assets + catch-all (must be after API routes).
# Note: Starlette 1.3 StaticFiles+Mount can 404 hashed assets (absolute path
# after get_route_path); serve dist files explicitly instead.
if settings.frontend_dist.exists():

    @app.get("/assets/{file_path:path}")
    def spa_assets(file_path: str):
        fp = _safe_dist_file(f"assets/{file_path}")
        if fp is None:
            return Response(
                content='{"error":"not found"}',
                status_code=404,
                media_type="application/json",
            )
        return FileResponse(fp)

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
        fp = _safe_dist_file(full_path)
        if fp is not None:
            return FileResponse(fp)
        index = settings.frontend_dist / "index.html"
        return FileResponse(index)
