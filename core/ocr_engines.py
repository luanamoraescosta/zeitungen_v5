"""core/ocr_engines.py
Three OCR engines with a common interface:
  run(image, lang) -> {"text": str, "words": [{text, x1,y1,x2,y2}]}

Engines:
  tesseract  — fast, 100+ langs, good for printed historical
  easyocr    — neural, 80+ langs, good for modern + historical printed
  trocr      — Microsoft transformer, best for handwritten
"""
from __future__ import annotations
import os
from PIL import Image

_WIN_TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# ── Shared normaliser ─────────────────────────────────────────────
def _norm(x1, y1, x2, y2, w, h):
    return max(0.0, x1/w), max(0.0, y1/h), min(1.0, x2/w), min(1.0, y2/h)


# ── Tesseract ─────────────────────────────────────────────────────
def run_tesseract(image: Image.Image, lang: str = "deu_frak+deu") -> dict:
    import pytesseract
    if os.name == "nt" and os.path.exists(_WIN_TESS):
        pytesseract.pytesseract.tesseract_cmd = _WIN_TESS
    w, h = image.size
    data = pytesseract.image_to_data(
        image, lang=lang, config="--psm 1 --oem 1",
        output_type=pytesseract.Output.DICT,
    )
    words = []
    for i, txt in enumerate(data["text"]):
        txt = txt.strip()
        if not txt or int(data["conf"][i]) < 30:
            continue
        x, y = data["left"][i], data["top"][i]
        bw, bh = data["width"][i], data["height"][i]
        nx1, ny1, nx2, ny2 = _norm(x, y, x+bw, y+bh, w, h)
        words.append({"text": txt, "x1": nx1, "y1": ny1, "x2": nx2, "y2": ny2,
                       "conf": int(data["conf"][i])})
    return {"text": " ".join(d["text"] for d in words), "words": words}


# ── EasyOCR ───────────────────────────────────────────────────────
_easy_readers: dict = {}

def run_easyocr(image: Image.Image, lang: str = "de") -> dict:
    import easyocr, numpy as np
    # Map common codes
    lang_map = {
        "deu_frak+deu": "de", "deu": "de", "german": "de", "deutsch": "de",
        "eng": "en", "english": "en",
        "fra": "fr", "french": "fr",
        "por": "pt", "portuguese": "pt",
        "nld": "nl", "dutch": "nl",
        "lat": "la", "latin": "la",
    }
    easy_lang = lang_map.get(lang.lower(), lang[:2])
    key = easy_lang
    if key not in _easy_readers:
        _easy_readers[key] = easyocr.Reader([easy_lang], gpu=_has_gpu())
    reader = _easy_readers[key]
    img_np = np.array(image)
    w, h = image.size
    results = reader.readtext(img_np, detail=1, paragraph=False)
    words = []
    for (bbox, txt, conf) in results:
        txt = txt.strip()
        if not txt or conf < 0.3:
            continue
        xs = [p[0] for p in bbox]; ys = [p[1] for p in bbox]
        nx1, ny1, nx2, ny2 = _norm(min(xs), min(ys), max(xs), max(ys), w, h)
        words.append({"text": txt, "x1": nx1, "y1": ny1, "x2": nx2, "y2": ny2,
                       "conf": round(conf, 2)})
    return {"text": " ".join(d["text"] for d in words), "words": words}


# ── TrOCR (handwritten) ───────────────────────────────────────────
_trocr_models: dict = {}

TROCR_MODELS = {
    "handwritten": "microsoft/trocr-large-handwritten",
    "printed":     "microsoft/trocr-large-printed",
    "printed-sm":  "microsoft/trocr-base-printed",
}

def run_trocr(image: Image.Image, variant: str = "handwritten") -> dict:
    """
    TrOCR processes the full image as one line — designed for single-line crops.
    For full pages, pass block crops from layout detection.
    variant: "handwritten" | "printed" | "printed-sm"
    """
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    import torch
    model_id = TROCR_MODELS.get(variant, TROCR_MODELS["handwritten"])
    if model_id not in _trocr_models:
        print(f"[TrOCR] Loading {model_id}…")
        proc  = TrOCRProcessor.from_pretrained(model_id)
        model = VisionEncoderDecoderModel.from_pretrained(model_id)
        if _has_gpu():
            model = model.cuda()
        model.eval()
        _trocr_models[model_id] = (proc, model)
        print("[TrOCR] Loaded.")
    proc, model = _trocr_models[model_id]
    import torch
    device = "cuda" if _has_gpu() else "cpu"
    img = image.convert("RGB")
    pixel_values = proc(images=img, return_tensors="pt").pixel_values.to(device)
    with torch.no_grad():
        ids = model.generate(pixel_values)
    text = proc.batch_decode(ids, skip_special_tokens=True)[0].strip()
    # TrOCR gives no word boxes — return one block for the whole image
    w, h = image.size
    words = [{"text": text, "x1": 0.0, "y1": 0.0, "x2": 1.0, "y2": 1.0, "conf": 1.0}] if text else []
    return {"text": text, "words": words}


# ── Layout detection (LayoutParser) ──────────────────────────────
_layout_model = None

def detect_layout(image: Image.Image) -> list[dict]:
    """
    Detect layout blocks using LayoutParser + PubLayNet model.
    Returns list of {type, x1, y1, x2, y2} normalised.
    Falls back to full-page single block if LayoutParser not installed.
    """
    try:
        import layoutparser as lp
        import numpy as np
        global _layout_model
        if _layout_model is None:
            # PubLayNet — trained on scientific docs but generalises well
            # For newspapers use: lp.models.Detectron2LayoutModel(
            #   "lp://NewspaperNavigator/faster_rcnn_R_50_FPN_3x/config")
            _layout_model = lp.models.Detectron2LayoutModel(
                "lp://PubLayNet/faster_rcnn_R_50_FPN_3x/config",
                extra_config=["MODEL.ROI_HEADS.SCORE_THRESH_TEST", 0.5],
                label_map={0:"Text", 1:"Title", 2:"List", 3:"Table", 4:"Figure"},
            )
        img_np = np.array(image.convert("RGB"))
        layout  = _layout_model.detect(img_np)
        w, h    = image.size
        blocks  = []
        for block in layout:
            b    = block.block
            nx1, ny1, nx2, ny2 = _norm(b.x_1, b.y_1, b.x_2, b.y_2, w, h)
            type_map = {"Text":"text","Title":"heading","List":"list",
                        "Table":"table","Figure":"illustration"}
            blocks.append({
                "type": type_map.get(block.type, "text"),
                "x1": nx1, "y1": ny1, "x2": nx2, "y2": ny2,
            })
        return sorted(blocks, key=lambda b: (b["y1"], b["x1"]))
    except Exception:
        # Fallback: single full-page block
        return [{"type": "text", "x1": 0.0, "y1": 0.0, "x2": 1.0, "y2": 1.0}]


# ── Combine layout + OCR into blocks ─────────────────────────────
def run_with_layout(image: Image.Image, engine: str, lang: str) -> dict:
    """
    1. Detect layout blocks
    2. Crop each block
    3. Run chosen OCR engine on each crop
    4. Return same format as docling_ocr.run_ocr()
    """
    import numpy as np
    layout_blocks = detect_layout(image)
    w, h = image.size
    blocks = []

    for lb in layout_blocks:
        # Crop block from image
        x1p, y1p = int(lb["x1"]*w), int(lb["y1"]*h)
        x2p, y2p = int(lb["x2"]*w), int(lb["y2"]*h)
        if x2p - x1p < 10 or y2p - y1p < 10:
            continue
        crop = image.crop((x1p, y1p, x2p, y2p))

        # Run OCR
        try:
            if engine == "easyocr":
                result = run_easyocr(crop, lang)
            elif engine in ("trocr-handwritten", "trocr-printed"):
                variant = "handwritten" if "handwritten" in engine else "printed"
                result  = run_trocr(crop, variant)
            else:
                result = run_tesseract(crop, lang)
        except Exception as exc:
            result = {"text": "", "words": [], "error": str(exc)}

        if not result["text"].strip():
            continue

        # Re-map word coords back to full page coords
        remapped_words = []
        for word in result.get("words", []):
            wx1 = lb["x1"] + word["x1"] * (lb["x2"] - lb["x1"])
            wy1 = lb["y1"] + word["y1"] * (lb["y2"] - lb["y1"])
            wx2 = lb["x1"] + word["x2"] * (lb["x2"] - lb["x1"])
            wy2 = lb["y1"] + word["y2"] * (lb["y2"] - lb["y1"])
            remapped_words.append({**word, "x1":wx1,"y1":wy1,"x2":wx2,"y2":wy2})

        blocks.append({
            "type":  lb["type"],
            "text":  result["text"],
            "words": remapped_words,
            "x1": lb["x1"], "y1": lb["y1"],
            "x2": lb["x2"], "y2": lb["y2"],
        })

    return {
        "blocks":      blocks,
        "raw_doctags": "",
        "page_width":  w,
        "page_height": h,
        "engine":      engine,
        "lang_used":   lang,
    }


def _has_gpu() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False
