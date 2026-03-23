"""core/docling_ocr.py — Tesseract com preprocessamento optimizado para jornais históricos."""
from __future__ import annotations
import os, re
from PIL import Image, ImageOps, ImageFilter

_WIN_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def _setup():
    import pytesseract
    if os.name == "nt" and os.path.exists(_WIN_PATH):
        pytesseract.pytesseract.tesseract_cmd = _WIN_PATH


def preprocess(image: Image.Image) -> Image.Image:
    """
    Pipeline de preprocessamento para jornais históricos:
    1. Grayscale          — elimina coloração amarelada do papel
    2. Autocontrast       — maximiza contraste tinta/papel automaticamente
    3. Sharpen            — afia bordas das letras (especialmente Fraktur)
    4. Binarização Otsu   — converte para preto/branco puro via numpy/PIL threshold
    """
    # 1. Grayscale
    img = image.convert("L")

    # 2. Autocontrast — ajusta níveis automaticamente (melhor que contrast fixo)
    img = ImageOps.autocontrast(img, cutoff=2)

    # 3. Sharpen
    img = img.filter(ImageFilter.SHARPEN)
    img = img.filter(ImageFilter.SHARPEN)  # duas passagens para Fraktur

    # 4. Binarização — threshold adaptativo via numpy se disponível, senão PIL
    try:
        import numpy as np
        arr = np.array(img)
        # Otsu threshold
        from PIL import Image as PILImage
        hist, _ = np.histogram(arr.flatten(), 256, [0, 256])
        total   = arr.size
        best_t, best_var = 0, 0
        wB = cB = wF = cF = 0
        for t in range(256):
            wB += hist[t]
            if wB == 0: continue
            wF = total - wB
            if wF == 0: break
            cB += t * hist[t]
            mB  = cB / wB
            mF  = (arr.sum() - cB) / wF
            var = wB * wF * (mB - mF) ** 2
            if var > best_var:
                best_var, best_t = var, t
        img = PILImage.fromarray((arr > best_t).astype(np.uint8) * 255)
    except ImportError:
        # Fallback: simples threshold sem numpy
        img = img.point(lambda p: 255 if p > 128 else 0)

    return img


def _parse_hocr(hocr: str, small_w: int, small_h: int,
                orig_w: int, orig_h: int) -> list[dict]:
    sx, sy  = orig_w / small_w, orig_h / small_h
    blocks  = []
    word_re = re.compile(
        r"<span[^>]+class=['\"]ocrx_word['\"][^>]*>([^<]*)</span>",
        re.IGNORECASE,
    )
    par_re = re.compile(
        r"<p[^>]+class=['\"]ocr_par['\"][^>]*title=['\"]bbox (\d+) (\d+) (\d+) (\d+)['\"][^>]*>(.*?)</p>",
        re.DOTALL | re.IGNORECASE,
    )
    for m in par_re.finditer(hocr):
        x1 = int(m.group(1)) * sx
        y1 = int(m.group(2)) * sy
        x2 = int(m.group(3)) * sx
        y2 = int(m.group(4)) * sy
        text = " ".join(w.strip() for w in word_re.findall(m.group(5)) if w.strip())
        if not text:
            continue
        blocks.append({
            "type": "heading" if (y2-y1) > 60*sy and len(text) < 80 else "text",
            "text": text,
            "x1": x1/orig_w, "y1": y1/orig_h,
            "x2": x2/orig_w, "y2": y2/orig_h,
        })

    # fallback: linhas individuais
    if not blocks:
        line_re = re.compile(
            r"<span[^>]+class=['\"]ocr_line['\"][^>]*title=['\"][^'\"]*"
            r"bbox (\d+) (\d+) (\d+) (\d+)[^'\"]*['\"][^>]*>(.*?)</span>",
            re.DOTALL | re.IGNORECASE,
        )
        for m in line_re.finditer(hocr):
            x1 = int(m.group(1)) * sx
            y1 = int(m.group(2)) * sy
            x2 = int(m.group(3)) * sx
            y2 = int(m.group(4)) * sy
            text = " ".join(w.strip() for w in word_re.findall(m.group(5)) if w.strip())
            if text:
                blocks.append({
                    "type": "text", "text": text,
                    "x1": x1/orig_w, "y1": y1/orig_h,
                    "x2": x2/orig_w, "y2": y2/orig_h,
                })
    return blocks


def run_ocr(image: Image.Image, lang: str = "deu_frak+deu",
            max_new_tokens: int = 4096) -> dict:
    import pytesseract
    _setup()

    orig_w, orig_h = image.size
    processed      = preprocess(image)
    sw, sh         = processed.size

    hocr, lang_used = "", lang
    for attempt in (lang, "deu", "eng"):
        try:
            hocr = pytesseract.image_to_pdf_or_hocr(
                processed,
                lang=attempt,
                extension="hocr",
                config="--psm 1 --oem 1",
            ).decode("utf-8", errors="replace")
            lang_used = attempt
            break
        except pytesseract.TesseractError:
            continue
        except Exception as exc:
            raise RuntimeError(f"Tesseract error: {exc}")

    if not hocr:
        raise RuntimeError("Tesseract failed — check installation.")

    return {
        "raw_doctags": hocr,
        "blocks":      _parse_hocr(hocr, sw, sh, orig_w, orig_h),
        "page_width":  orig_w,
        "page_height": orig_h,
        "lang_used":   lang_used,
    }