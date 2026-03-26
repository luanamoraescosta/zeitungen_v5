# Digitale Zeitungen

A lightweight web viewer for **historical newspapers**: load an **IIIF (v2/v3) manifest**, run **Tesseract OCR** (incl. Fraktur), inspect **OCR blocks + words**, render a **facsimile layout**, and create **local JSON annotations**.

Planned: **YOLO column detection** (fine-tuned) for better newspaper layout/columns while still using Tesseract.

---

## Features

- Load any IIIF Presentation manifest (v2 or v3)
- Image viewer (zoom + pan) and OCR overlay
- Tesseract OCR with preprocessing tuned for old newspapers
- Facsimile renderer (blocks positioned by OCR coordinates)
- Select blocks (and optionally words) for inspection
- **Annotations** (block/word) saved locally as JSON via API
- Batch OCR over all pages via SSE ("▶▶ All")
- Language selector (auto-set from manifest when possible)

---

## Project structure (current)

```
zeitungen_v5/
├── app.py
├── requirements.txt
├── api/
│   ├── manifest.py
│   ├── ocr.py
│   └── annotations.py
├── core/
│   ├── http_client.py
│   ├── iiif.py
│   ├── security.py
│   └── ocr/
│       ├── models.py
│       ├── pipeline.py
│       └── tesseract_engine.py
├── services/
│   ├── ocr_service.py
│   └── annotation_store.py
├── static/
│   ├── css/app.css
│   └── js/zeitungen.js
└── templates/
    └── index.html
```

Annotations are stored in:
```
data/annotations/<hash-of-manifest>.json
```

---

## Requirements

### Python
Install dependencies:
```bash
pip install -r requirements.txt
```

### Tesseract (Windows)
Install from:
https://github.com/UB-Mannheim/tesseract/wiki

During install, enable at least:
- `deu`
- `deu_frak` (important for pre-1945 newspapers)

Verify:
```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
```

---

## Run locally

```bash
cd zeitungen_v5
uvicorn app:app --reload --port 8000
# open http://localhost:8000
```

---

## API (quick)

- `GET  /api/manifest?url=...`
- `POST /api/ocr` with JSON `{ "image_url": "...", "lang": "deu_frak+deu" }`
- `GET  /api/ocr/all?manifest_url=...&lang=...` (SSE)
- `GET  /api/ocr/status`
- `GET  /api/annotations?manifest_url=...`
- `POST /api/annotations` (stores annotation in local JSON)

---

## Tested manifests

- IIIF Cookbook Newspaper Issue 1  
  https://iiif.io/api/cookbook/recipe/0068-newspaper/newspaper_issue_1-manifest.json
- IIIF Cookbook Newspaper Issue 2  
  https://iiif.io/api/cookbook/recipe/0068-newspaper/newspaper_issue_2-manifest.json

---

## Notes for future changes

- OCR output is designed to stay stable: **blocks + words** with normalized bounding boxes.
- Layout detection is currently Tesseract-based; future plan is to add **YOLO column detection** as a layout stage.
- Annotations are intentionally simple (local JSON) to keep the project hackable.
