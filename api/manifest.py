"""api/manifest.py — GET /api/manifest"""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from core import http_client
from core.iiif import parse_manifest

router  = APIRouter()
STATIC  = Path(__file__).parent.parent / "static"


@router.get("/manifest")
async def proxy_manifest(url: str = Query(...)):
    # Local static file (demo manifest)
    if "localhost" in url or "127.0.0.1" in url:
        fname = url.split("/static/")[-1] if "/static/" in url else ""
        fpath = STATIC / fname
        if fname and fpath.exists():
            raw = json.loads(fpath.read_text(encoding="utf-8"))
            return JSONResponse(parse_manifest(raw, url))
        raise HTTPException(404, f"Local file not found: {fname}")

    client = await http_client.get()
    try:
        r = await client.get(url)
        r.raise_for_status()
        raw = r.json()
    except Exception as exc:
        raise HTTPException(502, f"Cannot fetch manifest: {exc}")

    return JSONResponse(parse_manifest(raw, url))
