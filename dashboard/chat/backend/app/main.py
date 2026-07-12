# main.py — health only for this task
from fastapi import FastAPI
from .config import settings

app = FastAPI(title="8090 Chat Agent", root_path=settings.chat_root_path)

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "chat-agent"}
