import httpx
from src.config.env import settings
from src.lib.logger import logger

async def html_to_pdf(html_content: str) -> bytes:
    url = f"{settings.GOTENBERG_URL}/forms/chromium/convert/html"
    files = {
        "files": ("index.html", html_content.encode("utf-8"), "text/html")
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, files=files)
        if resp.status_code != 200:
            logger.error(f"Gotenberg error {resp.status_code}: {resp.text}")
            raise RuntimeError("Failed to generate PDF via Gotenberg")
        return resp.content
