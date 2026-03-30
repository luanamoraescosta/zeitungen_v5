from __future__ import annotations

import json
import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from services.ocr_service import ocr_image_url
from core.security import validate_public_http_url
from core import http_client
from core.iiif import parse_manifest

router = APIRouter()

class OcrRequest(BaseModel):
    image_url: str
    lang: str = "deu_frak+deu"
    force: bool = False   # if True, bypass cache and re-run

@router.get("/ocr/status")
async def ocr_status():
    info = {"backend": "tesseract", "ready": False}
    try:
        import pytesseract
        info["version"] = str(pytesseract.get_tesseract_version())
        info["langs"] = pytesseract.get_languages()
        info["ready"] = True
    except Exception as e:
        info["error"] = str(e)
    return JSONResponse(info)

@router.post("/ocr")
async def run_ocr(req: OcrRequest):
    try:
        if req.force:
            from services.ocr_service import _OCR_CACHE, _cache_key
            key = _cache_key(req.image_url, req.lang)
            if key in _OCR_CACHE:
                del _OCR_CACHE[key]
        result = await ocr_image_url(req.image_url, req.lang)
        return JSONResponse(result)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/ocr/all")
async def ocr_all_pages(manifest_url: str, lang: str = "deu_frak+deu"):
    try:
        validate_public_http_url(manifest_url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    client = await http_client.get()
    try:
        r = await client.get(manifest_url)
        r.raise_for_status()
        manifest = parse_manifest(r.json(), manifest_url)
    except Exception as exc:
        raise HTTPException(502, f"Cannot fetch manifest: {exc}")

    pages = manifest.get("pages", [])

    async def stream():
        total = len(pages)
        for page in pages:
            num = page.get("index")
            url = page.get("image") or ""
            if not url:
                yield f"data: {json.dumps({'page': num, 'status': 'skip', 'total': total})}\n\n"
                continue

            t0 = time.time()
            yield f"data: {json.dumps({'page': num, 'status': 'running', 'total': total, 't0': t0})}\n\n"

            try:
                result = await ocr_image_url(url, lang)
                dt = time.time() - t0
                yield f"data: {json.dumps({'page': num, 'status': 'done', 'total': total, 'seconds': dt, 'result': result})}\n\n"
            except Exception as exc:
                dt = time.time() - t0
                yield f"data: {json.dumps({'page': num, 'status': 'error', 'total': total, 'seconds': dt, 'error': str(exc)})}\n\n"

        yield f"data: {json.dumps({'status': 'complete', 'total': total})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")