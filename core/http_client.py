"""core/http_client.py — shared async HTTP client."""
from typing import Optional
import httpx

_client: Optional[httpx.AsyncClient] = None

HEADERS = {"User-Agent": "DigitaleZeitungen/0.5 (research project)"}


async def get() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(headers=HEADERS, timeout=30.0, follow_redirects=True)
    return _client


async def close() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
