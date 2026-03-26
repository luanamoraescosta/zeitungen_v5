# api/ocr.py
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services.ocr_service import ocr_image_url

router = APIRouter()

class OcrRequest(BaseModel):
    image_url: str
    lang: str = "deu_frak+deu"

@router.post("/ocr")
async def run_ocr(req: OcrRequest):
    try:
        result = await ocr_image_url(req.image_url, req.lang)
        return JSONResponse(result)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))