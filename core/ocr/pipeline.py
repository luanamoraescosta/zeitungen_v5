# core/ocr/pipeline.py
from __future__ import annotations
from collections import defaultdict
from PIL import Image
from core.ocr.models import BBox, Word, Block, OcrPageResult
from core.ocr.tesseract_engine import run_tesseract_words, stable_id

def _clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v

def _merge_bbox(items: list[dict]) -> BBox:
    x1 = min(w["x1"] for w in items)
    y1 = min(w["y1"] for w in items)
    x2 = max(w["x2"] for w in items)
    y2 = max(w["y2"] for w in items)
    return BBox(_clamp01(x1), _clamp01(y1), _clamp01(x2), _clamp01(y2))

def run_ocr_pipeline(
    image: Image.Image,
    image_url: str,
    lang: str,
    *,
    psm_page: int = 1,
    psm_block: int = 6,
    min_conf: int = 30,
) -> OcrPageResult:
    """
    Estratégia simples:
      - roda Tesseract (psm_page=1) para pegar estrutura de blocos/parágrafos
      - agrupa words por (block_num, par_num) a partir do image_to_data completo
    """
    # Aqui a gente precisa do image_to_data completo incluindo block_num/par_num
    # Então chamamos pytesseract direto (com preprocess) e extraímos campos.
    import pytesseract
    from core.ocr.tesseract_engine import _setup_tesseract, preprocess_historical_news

    _setup_tesseract()
    page_w, page_h = image.size
    img = preprocess_historical_news(image)

    config = f"--psm {psm_page} --oem 1"
    langs_to_try = [lang, "deu", "eng"] if lang not in ("deu", "eng") else [lang, "eng"]

    data = None
    used = lang
    last_err = None
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

    # agrupa words por bloco/parágrafo
    groups: dict[tuple[int, int], list[dict]] = defaultdict(list)
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
        x1 = max(0.0, x / page_w); y1 = max(0.0, y / page_h)
        x2 = min(1.0, (x + w) / page_w); y2 = min(1.0, (y + h) / page_h)

        bnum = int(data.get("block_num", [0]*n)[i] or 0)
        pnum = int(data.get("par_num",   [0]*n)[i] or 0)

        groups[(bnum, pnum)].append({"text": txt, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "conf": conf})

    blocks: list[Block] = []
    for (bnum, pnum), items in sorted(groups.items(), key=lambda k: (k[0][0], k[0][1])):
        bbox = _merge_bbox(items)
        text = " ".join(w["text"] for w in items).strip()

        # ids estáveis
        block_id = stable_id(image_url, used, f"b{bnum}-p{pnum}", f"{bbox.x1:.5f},{bbox.y1:.5f},{bbox.x2:.5f},{bbox.y2:.5f}", text[:80])

        words: list[Word] = []
        for j, w in enumerate(items):
            wb = BBox(w["x1"], w["y1"], w["x2"], w["y2"])
            word_id = stable_id(block_id, str(j), w["text"], f"{wb.x1:.5f},{wb.y1:.5f},{wb.x2:.5f},{wb.y2:.5f}")
            words.append(Word(word_id=word_id, text=w["text"], bbox=wb, conf=float(w["conf"])))

        blocks.append(Block(
            block_id=block_id,
            type="text",
            text=text,
            bbox=bbox,
            words=words
        ))

    return OcrPageResult(
        engine="tesseract",
        lang_used=used,
        image_url=image_url,
        page_width=page_w,
        page_height=page_h,
        blocks=blocks
    )