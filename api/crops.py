from __future__ import annotations
import io
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from PIL import Image

from services.ocr_service import fetch_iiif_image  # reuse existing image fetcher

router = APIRouter()

def _clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v

class CropRequest(BaseModel):
    image_url: str
    x1: float = Field(..., ge=0.0, le=1.0)
    y1: float = Field(..., ge=0.0, le=1.0)
    x2: float = Field(..., ge=0.0, le=1.0)
    y2: float = Field(..., ge=0.0, le=1.0)
    padding: int = Field(default=0, ge=0, le=200)

@router.post("/crop.png")
async def crop_png(req: CropRequest):
    try:
        img = await fetch_iiif_image(req.image_url)
    except Exception as exc:
        raise HTTPException(502, f"Cannot fetch image: {exc}")

    w, h = img.size
    x1 = int(_clamp01(req.x1) * w)
    y1 = int(_clamp01(req.y1) * h)
    x2 = int(_clamp01(req.x2) * w)
    y2 = int(_clamp01(req.y2) * h)

    if x2 <= x1 or y2 <= y1:
        raise HTTPException(400, "Invalid bbox (x2/x1 or y2/y1).")

    pad = int(req.padding or 0)
    x1 = max(0, x1 - pad); y1 = max(0, y1 - pad)
    x2 = min(w, x2 + pad); y2 = min(h, y2 + pad)

    crop = img.crop((x1, y1, x2, y2))

    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")