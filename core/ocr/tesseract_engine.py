# core/ocr/tesseract_engine.py
from __future__ import annotations
import os
import hashlib
from typing import Optional
from PIL import Image, ImageOps, ImageFilter

_WIN_TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

def _setup_tesseract() -> None:
    import pytesseract
    if os.name == "nt" and os.path.exists(_WIN_TESS):
        pytesseract.pytesseract.tesseract_cmd = _WIN_TESS

def preprocess_historical_news(image: Image.Image) -> Image.Image:
    img = image.convert("L")
    img = ImageOps.autocontrast(img, cutoff=2)
    # Sharpen leve (duas passagens às vezes piora ruído)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=160, threshold=3))
    # binarização simples (mantém dependências mínimas)
    img = img.point(lambda p: 255 if p > 140 else 0)
    return img

def _norm_bbox(x: int, y: int, w: int, h: int, page_w: int, page_h: int):
    x1 = max(0.0, x / page_w)
    y1 = max(0.0, y / page_h)
    x2 = min(1.0, (x + w) / page_w)
    y2 = min(1.0, (y + h) / page_h)
    return x1, y1, x2, y2

def stable_id(*parts: str) -> str:
    raw = "||".join(parts).encode("utf-8", errors="ignore")
    return hashlib.sha1(raw).hexdigest()[:16]

def run_tesseract_words(
    image: Image.Image,
    lang: str,
    psm: int = 6,
    oem: int = 1,
    min_conf: int = 30,
    preprocess: bool = True,
) -> dict:
    """
    Returns:
      {
        page_width, page_height, lang_used,
        words: [{text, x1,y1,x2,y2, conf}]
      }
    """
    import pytesseract

    _setup_tesseract()

    page_w, page_h = image.size
    img = preprocess_historical_news(image) if preprocess else image

    config = f"--psm {psm} --oem {oem}"
    # tentativa de fallback de idioma
    langs_to_try = [lang, "deu", "eng"] if lang not in ("deu", "eng") else [lang, "eng"]

    last_err: Optional[Exception] = None
    data = None
    used = lang
    for attempt in langs_to_try:
        try:
            data = pytesseract.image_to_data(
                img, lang=attempt, config=config, output_type=pytesseract.Output.DICT
            )
            used = attempt
            break
        except Exception as exc:
            last_err = exc

    if data is None:
        raise RuntimeError(f"Tesseract failed: {last_err}")

    words = []
    n = len(data.get("text", []))
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        if not txt:
            continue
        try:
            conf = float(data["conf"][i])
        except Exception:
            conf = -1.0
        if conf < min_conf:
            continue
        x, y = int(data["left"][i]), int(data["top"][i])
        w, h = int(data["width"][i]), int(data["height"][i])
        x1, y1, x2, y2 = _norm_bbox(x, y, w, h, page_w, page_h)
        words.append({"text": txt, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "conf": conf})

    return {
        "page_width": page_w,
        "page_height": page_h,
        "lang_used": used,
        "words": words,
    }