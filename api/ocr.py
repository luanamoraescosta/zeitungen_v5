"""api/ocr.py — Tesseract OCR endpoint, simples e directo."""
from __future__ import annotations
import io, asyncio, json
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

router  = APIRouter()
_cache: dict[str, dict] = {}


class OcrRequest(BaseModel):
    image_url: str
    lang:      str = "deu_frak+deu"


@router.get("/ocr/status")
async def ocr_status():
    info = {"backend": "tesseract", "ready": False, "cache_size": len(_cache)}
    try:
        import pytesseract, os
        if os.name == "nt":
            win = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
            if os.path.exists(win):
                pytesseract.pytesseract.tesseract_cmd = win
        info["version"] = str(pytesseract.get_tesseract_version())
        info["langs"]   = pytesseract.get_languages()
        info["ready"]   = True
    except Exception as e:
        info["error"] = str(e)
    return JSONResponse(info)


@router.post("/ocr")
async def run_ocr(req: OcrRequest):
    cache_key = f"{req.image_url}::{req.lang}"
    if cache_key in _cache:
        return JSONResponse(_cache[cache_key])

    try:
        import pytesseract
    except ImportError:
        raise HTTPException(500, "pytesseract not installed. Run: pip install pytesseract")

    from core import http_client
    from PIL import Image
    client = await http_client.get()
    try:
        r = await client.get(req.image_url)
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(502, f"Cannot fetch image: {exc}")

    try:
        from core.docling_ocr import run_ocr as _run
        result = await asyncio.get_event_loop().run_in_executor(None, _run, img, req.lang)
    except Exception as exc:
        raise HTTPException(500, str(exc))

    result["image_url"] = req.image_url
    _cache[cache_key] = result
    return JSONResponse(result)


@router.get("/ocr/all")
async def ocr_all_pages(manifest_url: str, lang: str = "deu_frak+deu"):
    from core import http_client
    from core.iiif import parse_manifest
    from PIL import Image

    client = await http_client.get()
    try:
        r = await client.get(manifest_url)
        r.raise_for_status()
        manifest = parse_manifest(r.json(), manifest_url)
    except Exception as exc:
        raise HTTPException(502, f"Cannot fetch manifest: {exc}")

    pages = manifest.get("pages", [])

    async def stream():
        for page in pages:
            num = page["index"]
            url = page.get("image", "")
            if not url:
                yield f"data: {json.dumps({'page':num,'status':'skip'})}\n\n"
                continue

            cache_key = f"{url}::{lang}"
            if cache_key in _cache:
                yield f"data: {json.dumps({'page':num,'status':'done','result':_cache[cache_key]})}\n\n"
                continue

            yield f"data: {json.dumps({'page':num,'status':'running'})}\n\n"
            try:
                r2  = await client.get(url)
                r2.raise_for_status()
                img = Image.open(io.BytesIO(r2.content)).convert("RGB")
                from core.docling_ocr import run_ocr as _run
                result = await asyncio.get_event_loop().run_in_executor(None, _run, img, lang)
                result["image_url"] = url
                _cache[cache_key] = result
                yield f"data: {json.dumps({'page':num,'status':'done','result':result})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'page':num,'status':'error','error':str(exc)})}\n\n"

        yield f"data: {json.dumps({'status':'complete','total':len(pages)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")