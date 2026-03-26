# services/ocr_service.py
from __future__ import annotations
import io
import asyncio
from cachetools import TTLCache
from PIL import Image

from core import http_client
from core.security import validate_public_http_url
from core.ocr.pipeline import run_ocr_pipeline

# cache LRU+TTL
_OCR_CACHE = TTLCache(maxsize=512, ttl=60 * 60)  # 1h

PIPELINE_VERSION = "v1-tess-words"

def _cache_key(image_url: str, lang: str) -> str:
    return f"{PIPELINE_VERSION}::{lang}::{image_url}"

async def fetch_iiif_image(image_url: str) -> Image.Image:
    validate_public_http_url(image_url)
    client = await http_client.get()
    r = await client.get(image_url)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    return img

async def ocr_image_url(image_url: str, lang: str) -> dict:
    key = _cache_key(image_url, lang)
    if key in _OCR_CACHE:
        return _OCR_CACHE[key]

    img = await fetch_iiif_image(image_url)

    loop = asyncio.get_running_loop()
    page = await loop.run_in_executor(None, run_ocr_pipeline, img, image_url, lang)

    # serializa dataclasses -> dict “API friendly”
    out = {
        "engine": page.engine,
        "lang_used": page.lang_used,
        "image_url": page.image_url,
        "page_width": page.page_width,
        "page_height": page.page_height,
        "blocks": [
            {
                "block_id": b.block_id,
                "type": b.type,
                "text": b.text,
                "x1": b.bbox.x1, "y1": b.bbox.y1, "x2": b.bbox.x2, "y2": b.bbox.y2,
                "words": [
                    {
                        "word_id": w.word_id,
                        "text": w.text,
                        "x1": w.bbox.x1, "y1": w.bbox.y1, "x2": w.bbox.x2, "y2": w.bbox.y2,
                        "conf": w.conf,
                    }
                    for w in b.words
                ]
            }
            for b in page.blocks
        ],
        "pipeline_version": PIPELINE_VERSION,
    }
    _OCR_CACHE[key] = out
    return out