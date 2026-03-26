# core/ocr/models.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal, Optional

BlockType = Literal["text", "heading", "list", "table", "caption", "footer", "illustration"]

@dataclass(frozen=True)
class BBox:
    # normalizado 0..1
    x1: float
    y1: float
    x2: float
    y2: float

@dataclass(frozen=True)
class Word:
    word_id: str
    text: str
    bbox: BBox
    conf: float

@dataclass(frozen=True)
class Block:
    block_id: str
    type: BlockType
    text: str
    bbox: BBox
    words: list[Word]

@dataclass(frozen=True)
class OcrPageResult:
    engine: str
    lang_used: str
    image_url: str
    page_width: int
    page_height: int
    blocks: list[Block]