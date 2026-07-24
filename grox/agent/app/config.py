from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

AGENT_ROOT = Path(__file__).resolve().parents[1]


def default_data_dir() -> Path:
    # Linux/macOS dev; on Windows Electron will set GROX_DATA_DIR
    return Path.home() / ".local" / "share" / "Grox"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GROX_", env_file=str(AGENT_ROOT / ".env"), extra="ignore")

    chat_host: str = "127.0.0.1"
    chat_port: int = 17890
    chat_token: str = "grox-local-token"
    chat_default_model: str = "grok-4.5"
    chat_permission_mode: str = "bypassPermissions"
    chat_root_path: str = ""  # desktop: no /chat prefix
    # LLM gateway (public grokcli-2api or local router)
    anthropic_base_url: str = "https://kaggleyes.top/grokapi"
    anthropic_api_key: str = ""
    chat_model_router_url: str = "https://kaggleyes.top/grokapi"
    data_dir: Path = default_data_dir()
    sessions_dir: Path | None = None
    frontend_dist: Path = AGENT_ROOT / "static"
    models_cache_ttl_sec: float = 45.0

    def model_post_init(self, __context: object) -> None:
        if self.sessions_dir is None:
            object.__setattr__(self, "sessions_dir", self.data_dir / "sessions")


settings = Settings()
