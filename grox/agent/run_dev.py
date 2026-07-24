import uvicorn
from app.config import settings

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=settings.chat_host, port=settings.chat_port, reload=True)
