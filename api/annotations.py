from __future__ import annotations
import time, uuid
from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from services.annotation_store import add_annotation, list_annotations, delete_annotations


from services.annotation_store import add_annotation, list_annotations
from core.security import validate_public_http_url

router = APIRouter()

TargetType = Literal["block", "word", "image", "text_range", "drawing"]  # <-- added drawing

class ImageTarget(BaseModel):
    image_url: str
    x1: float; y1: float; x2: float; y2: float

class BlockTarget(BaseModel):
    block_id: str

class WordTarget(BaseModel):
    word_id: str
    block_id: Optional[str] = None

class TextRangeTarget(BaseModel):
    block_id: str
    start: int
    end: int

class AnnotationIn(BaseModel):
    manifest_url: str = Field(..., description="IIIF manifest URL")
    page: int = Field(..., ge=1)
    target_type: TargetType
    target: dict
    body: dict = Field(default_factory=dict)

class AnnotationOut(BaseModel):
    id: str
    created_at: int
    manifest_url: str
    page: int
    target_type: TargetType
    target: dict
    body: dict

@router.get("/annotations")
async def get_annotations(manifest_url: str = Query(...)):
    try:
        validate_public_http_url(manifest_url)
    except ValueError:
        raise HTTPException(400, "Invalid manifest_url")
    return JSONResponse(list_annotations(manifest_url))

@router.post("/annotations")
async def post_annotation(ann: AnnotationIn):
    try:
        validate_public_http_url(ann.manifest_url)
    except ValueError:
        raise HTTPException(400, "Invalid manifest_url")

    out = {
        "id": str(uuid.uuid4()),
        "created_at": int(time.time()),
        "manifest_url": ann.manifest_url,
        "page": ann.page,
        "target_type": ann.target_type,
        "target": ann.target,
        "body": ann.body,
    }
    add_annotation(ann.manifest_url, out)
    return JSONResponse(out)

@router.delete("/annotations")
async def delete_anns(manifest_url: str = Query(...), page: Optional[int] = Query(None)):
    try:
        validate_public_http_url(manifest_url)
    except ValueError:
        raise HTTPException(400, "Invalid manifest_url")

    removed = delete_annotations(manifest_url, page=page)
    return JSONResponse({"removed": removed, "page": page})