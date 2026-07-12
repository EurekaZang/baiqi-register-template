from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

CHAT_ROOT = Path(__file__).resolve().parents[2]  # dashboard/chat

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(CHAT_ROOT / ".env"),
        extra="ignore",
    )
    chat_host: str = "127.0.0.1"
    chat_port: int = 8091
    chat_token: str = "change-me"
    chat_default_model: str = "grok-4.5"
    chat_permission_mode: str = "bypassPermissions"
    chat_root_path: str = "/chat"
    chat_model_router_url: str = "http://127.0.0.1:8088"
    anthropic_base_url: str = "http://127.0.0.1:8088"
    sessions_dir: Path = CHAT_ROOT / "data" / "sessions"
    frontend_dist: Path = CHAT_ROOT / "frontend" / "dist"
    models_cache_ttl_sec: float = 45.0

settings = Settings()
