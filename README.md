# Digitale Zeitungen — OCR + Facsimile + Annotations (IIIF)

A lightweight web viewer for **historical newspapers**:

- Load an **IIIF Presentation manifest (v2 or v3)**
- Run **Tesseract OCR** (including **Fraktur**)
- Inspect OCR **blocks + words**
- Render a **facsimile layout** positioned by OCR coordinates
- Perform **keyword search** (page or whole issue)
- Create **image** and **text-block** annotations
- Export **TEI XML** and **cropped PNG snippets** of annotated regions

Planned / ideas:
- YOLO-based column detection (fine-tuned) to improve layout segmentation before OCR

---

## Features

### IIIF
- Works with IIIF Presentation **v2 and v3**
- Loads pages from the manifest (images + thumbnails)

### OCR (Tesseract)
- OCR per page (`▶ OCR`)
- Batch OCR over all pages via SSE (`▶▶ All`)
- Preprocessing tuned for historical prints
- Outputs stable structure:
  - blocks with normalized bounding boxes (0..1)
  - words with confidence scores

### Facsimile view
- “Paper” edition view (blocks positioned using OCR bbox)
- Keyword highlights rendered inside facsimile blocks

### Analysis (Keyword retrieval)
- Search by keyword
- Scope: **this page** or **whole issue**
- When searching the whole issue, missing OCR pages are run automatically
- Export keyword results as JSON

### Annotations
- **Image annotation** (pen tool) → saves bbox (0..1) + label + optional class + note
- **Text annotation mode** → click a text block (image overlay or facsimile), select excerpt, add label + note
- Annotated blocks show an **info dot**
- Clear annotations (page/all) also clears backend JSON storage (if DELETE endpoint is enabled)
- Export:
  - JSON
  - TEI XML (`<facsimile><surface><zone ...>`)
  - Cropped PNG snippets via backend crop endpoint

---

## Project structure

```
zeitungen_v5/
├── app.py
├── requirements.txt
├── api/
│   ├── manifest.py
│   ├── ocr.py
│   ├── annotations.py
│   └── crops.py
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
data/annotations/<sha1-of-manifest-url>.json
```

---

## Requirements

### Python
Install dependencies:

```bash
pip install -r requirements.txt
```

### Tesseract

#### Windows
Install from:
https://github.com/UB-Mannheim/tesseract/wiki

During install, enable at least:
- `deu`
- `deu_frak` (important for pre-1945 newspapers)

Verify:

```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
```

#### macOS (Homebrew)
```bash
brew install tesseract
brew install tesseract-lang
```

#### Linux (Debian/Ubuntu)
```bash
sudo apt-get update
sudo apt-get install -y tesseract-ocr tesseract-ocr-deu
```

---

## Run locally

```bash
cd zeitungen_v5
uvicorn app:app --reload --port 8000
# open http://localhost:8000
```

---

## API overview

### Manifest
- `GET /api/manifest?url=...`

### OCR
- `GET  /api/ocr/status`
- `POST /api/ocr`
  ```json
  { "image_url": "...", "lang": "deu_frak+deu", "force": false }
  ```
- `GET  /api/ocr/all?manifest_url=...&lang=...` (Server-Sent Events)

### Annotations
- `GET    /api/annotations?manifest_url=...`
- `POST   /api/annotations`
- `DELETE /api/annotations?manifest_url=...&page=...` (optional, if enabled)
- `DELETE /api/annotations?manifest_url=...` (optional, if enabled)

### Crops (PNG)
- `POST /api/crop.png`
  ```json
  {
    "image_url": "...",
    "x1": 0.10, "y1": 0.20, "x2": 0.50, "y2": 0.60,
    "padding": 10
  }
  ```

---

## Tested manifests (examples)

- IIIF Cookbook Newspaper Issue 1  
  https://iiif.io/api/cookbook/recipe/0068-newspaper/newspaper_issue_1-manifest.json

- IIIF Cookbook Newspaper Issue 2  
  https://iiif.io/api/cookbook/recipe/0068-newspaper/newspaper_issue_2-manifest.json

---

## Notes

- OCR bounding boxes are normalized (0..1) to remain stable across different image sizes.
- If your IIIF images are served from private hosts (localhost / intranet), you may need to relax URL validation in `core/security.py` for development.
- Crop export depends on backend image fetching; if a server blocks hotlinking or requires auth, cropping may fail.

---
## License

MIT © Luana Moraes Costa
