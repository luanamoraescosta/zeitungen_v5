# Digitale Zeitungen

An open-source digital edition viewer for historical newspapers, combining IIIF Presentation API, Tesseract OCR with historical script support, and an interactive facsimile renderer. 

---

## Overview

The project has two components:

- **`zeitungen_v5/`** — the main web viewer: load any IIIF manifest, run OCR, inspect the facsimile layout, search text, and examine metadata.

---

## zeitungen_v5 — The Viewer

### What it does

1. **Load any IIIF manifest** (v2 or v3) by pasting the URL. Thumbnails appear in the left strip; metadata and links appear in the right panel.
2. **Zoomable facsimile** — scroll to zoom, drag to pan, no external libraries.
3. **OCR with Tesseract** — runs locally on your machine. Preprocesses the image (grayscale → autocontrast → sharpen × 2 → Otsu binarisation) before sending to Tesseract, which improves accuracy on yellowed paper and Fraktur typefaces.
4. **Text overlay** — detected blocks are drawn over the original image as transparent boxes. Hover to read the text; click to select.
5. **Facsimile edition** — the OCR results are rendered as a typographic reproduction, each block positioned according to its bounding box coordinates.
6. **Block selection and analysis** — click blocks in either the image overlay or the facsimile edition to add them to a selection. The Analysis tab shows the full text of selected blocks and supports live search with keyword highlighting.
7. **Batch OCR** — "▶▶ All" runs OCR on every page of the manifest sequentially via Server-Sent Events. Results stream in as each page finishes; thumbnails turn green when done.
8. **Language selector** — choose between `deu Fraktur` (recommended for pre-1945 German newspapers), `deu modern`, `eng`, `fra`, `por`, `nld`, `lat`. The manifest language field is read automatically and sets the selector on load.

### Project structure

```
zeitungen_v5/
├── main.py                  FastAPI entry point
├── requirements.txt
├── core/
│   ├── iiif.py              IIIF manifest parser (v2 + v3)
│   ├── docling_ocr.py       Tesseract OCR pipeline with preprocessing
│   ├── http_client.py       Shared async HTTP client
│   └── ocr_engines.py       Stubs for EasyOCR / TrOCR (future)
├── api/
│   ├── manifest.py          GET /api/manifest
│   └── ocr.py               POST /api/ocr · GET /api/ocr/all (SSE) · GET /api/ocr/status
├── static/
│   ├── css/app.css
│   └── js/zeitungen.js      Single-file frontend (no build step)
└── templates/
    └── index.html
```

### Requirements

**Python packages:**
```
pip install fastapi uvicorn httpx Pillow pytesseract
```

**Tesseract binary (Windows):**
Download the installer from https://github.com/UB-Mannheim/tesseract/wiki

During installation, select Additional Language Data and check at minimum:
- `deu` (German)
- `deu_frak` (German Fraktur — critical for pre-1945 newspapers)

Verify installation:
```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
# Should include: deu  deu_frak  eng
```

### Running

```powershell
cd zeitungen_v5
uvicorn main:app --reload --port 8000
# Open http://localhost:8000
```

### Tested IIIF manifests

| Source | URL |
|--------|-----|
| Berliner Tageblatt — Issue 1 (IIIF Cookbook) | `https://iiif.io/api/cookbook/recipe/0068-newspaper/newspaper_issue_1-manifest.json` |
| Berliner Tageblatt — Issue 2 (IIIF Cookbook) | `https://iiif.io/api/cookbook/recipe/0068-newspaper/newspaper_issue_2-manifest.json` |
| National Library of Wales | `https://damsssl.llgc.org.uk/iiif/2.0/4389767/manifest.json` |
| Österreichische Nationalbibliothek (pre-1885) | `http://iiif.onb.ac.at/presentation/ANNO/nfp18750101/manifest/` |

### OCR performance notes

- Image preprocessing (autocontrast + Otsu binarisation) significantly helps on aged paper.
- `deu_frak+deu` uses both the Fraktur and modern German models simultaneously — Tesseract picks the better result per word.
- OCR time varies: roughly 30–120 seconds per page on CPU depending on image resolution and page complexity.
- Results are cached per image URL + language for the duration of the server session.

---
