/* zeitungen.js — v11 (analysis unchanged; text selection via overlay+facsimile in mode; clear deletes backend; modal scroll fixed via CSS) */
(function () {
"use strict";

/* ── Lang map ───────────────────────────────────────────────────── */
var LANG_MAP = {
  "de":"deu_frak+deu","deu":"deu_frak+deu","german":"deu_frak+deu","deutsch":"deu_frak+deu",
  "en":"eng","eng":"eng","english":"eng",
  "fr":"fra","fra":"fra","french":"fra",
  "nl":"nld","nld":"nld","dutch":"nld",
  "pt":"por","por":"por",
  "la":"lat","lat":"lat","latin":"lat",
  "cy":"cym","cym":"cym","welsh":"cym",
};

/* ── State ──────────────────────────────────────────────────────── */
var S = {
  manifest: null,
  currentPage: 1,
  ocrCache: {},

  textOverlay: false,
  showWordBoxes: false,

  annotations: [],

  // pen annotation
  penMode: false,
  penDrawing: false,
  penPoints: [],
  penPaths: [],
  pendingPathEl: null,

  // text annotation mode
  textAnnoMode: false,
  pendingTextBlock: null, // { page, blockIndex, block }

  // panzoom
  scale: 1, tx: 0, ty: 0,
  dragging: false, dragStartX: 0, dragStartY: 0, dragTx: 0, dragTy: 0,

  // per-page status ETA
  _ocrTimes: [],
  _ocrEstimate: 60,
  _ocrStartTime: 0,
  _ocrTimer: null,

  // keyword search state (analysis)
  lastKeyword: "",
  lastScope: "page",
  matchMap: {},

  // OCR all timeline state
  ocrAll: { running:false, total:0, done:0, errors:0, times:[] },

  // suggestions
  labelSet: new Set(),
  classSet: new Set()
};

/* ── Boot ───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  on("btnLoad",        "click", loadManifest);

  on("btnOcr",         "click", function(){ runOcr(S.currentPage, false); });
  on("btnRerun",       "click", function(){ runOcr(S.currentPage, true); });
  on("btnOcrAll",      "click", ocrAllPages);

  on("btnOverlayText", "click", toggleTextOverlay);
  on("btnOverlayWords","click", toggleWordOverlay);

  on("btnPenMode",     "click", togglePenMode);

  on("btnPrev",        "click", function(){ goPage(-1); });
  on("btnNext",        "click", function(){ goPage(1); });

  on("btnZoomIn",      "click", function(){ zoom(1.4); });
  on("btnZoomOut",     "click", function(){ zoom(0.7); });
  on("btnZoomHome",    "click", zoomHome);

  on("manifestUrl",    "keydown", function(e){ if(e.key==="Enter") loadManifest(); });

  // Analysis (unchanged)
  on("btnRunSearch",     "click", runKeywordSearch);
  on("analysisSearch",   "keydown", function(e){ if(e.key==="Enter") runKeywordSearch(); });
  on("btnExportMatches", "click", exportKeywordMatches);

  // Annotations
  on("btnExportAnnotations", "click", exportAnnotations);
  on("importAnnotations",    "change", importAnnotations);

  on("btnClearAnnotations", "click", clearAnnotationsUI);

  // Text annotation mode + modal
  on("btnAnnotateText", "click", toggleTextAnnotateMode);
  on("btnTextAnnCancel","click", closeTextAnnotateModal);
  on("textModalOverlay","click", closeTextAnnotateModal);
  on("btnTextAnnSave",  "click", saveTextBlockAnnotation);

  // fill excerpt from selection in textarea
  var ta = el("textAnnBlockText");
  if(ta){
    ta.addEventListener("mouseup", fillSelectedExcerptFromTextarea);
    ta.addEventListener("keyup",  fillSelectedExcerptFromTextarea);
  }

  // Export TEI/Crops
  on("btnExportCrops", "click", exportAnnotationCrops);
  on("btnExportTEI",   "click", exportAnnotationsTEI);

  // Pen modal
  on("btnPenSave",     "click", savePenAnnotation);
  on("btnPenCancel",   "click", discardPenAnnotation);
  on("modalOverlay",   "click", discardPenAnnotation);

  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){
    b.addEventListener("click", function(){ setView(b.dataset.view); });
  });
  document.querySelectorAll(".side-tab").forEach(function(b){
    b.addEventListener("click", function(){ setSideTab(b.dataset.tab); });
  });

  initPanZoom();
  initPenLayer();
  checkModelStatus();
});

/* ── Utils ──────────────────────────────────────────────────────── */
function el(i) { return document.getElementById(i); }
function on(i, ev, fn) { var e = el(i); if (e) e.addEventListener(ev, fn); }

function esc(s) {
  return String(s || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}
function xmlEsc(s){
  return String(s??"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function escRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp01(v){ return v<0?0:v>1?1:v; }

var _tt;
function toast(msg, dur){
  if(dur === undefined) dur = 2800;
  var t = el("toast"); if(!t) return;
  t.textContent = msg;
  t.classList.toggle("show", !!msg);
  clearTimeout(_tt);
  if(msg && dur > 0) _tt = setTimeout(function(){ t.classList.remove("show"); }, dur);
}

function skel(n){
  var h="<div style='padding:12px'>"; n=n||6;
  for(var i=0;i<n;i++) h+="<div class='skeleton-line' style='width:"+(45+Math.random()*50)+"%'></div>";
  return h+"</div>";
}

async function apiFetch(path, opts){
  var r = await fetch(path, opts || {});
  if(!r.ok) throw new Error("HTTP "+r.status+": "+(await r.text()).slice(0,400));
  return r.json();
}
async function apiFetchBlob(path, opts){
  var r = await fetch(path, opts || {});
  if(!r.ok) throw new Error("HTTP "+r.status+": "+(await r.text()).slice(0,400));
  return r.blob();
}

function getLang(){
  var s = el("langSelect");
  return s ? s.value : "deu_frak+deu";
}
function getManifestUrl(){
  return (el("manifestUrl").value || "").trim();
}

/* ── Suggestions (label/class autocomplete) ─────────────────────── */
function refreshSuggestionLists(){
  var labelDL = document.getElementById("labelSuggestions");
  var classDL = document.getElementById("classSuggestions");
  if(labelDL){
    labelDL.innerHTML = Array.from(S.labelSet).sort().map(function(v){
      return "<option value='"+esc(v)+"'></option>";
    }).join("");
  }
  if(classDL){
    classDL.innerHTML = Array.from(S.classSet).sort().map(function(v){
      return "<option value='"+esc(v)+"'></option>";
    }).join("");
  }
}
function learnSuggestionsFromAnnotations(){
  S.labelSet = new Set();
  S.classSet = new Set();
  (S.annotations||[]).forEach(function(a){
    if(a.body && a.body.label) S.labelSet.add(String(a.body.label));
    if(a.body && a.body.class) S.classSet.add(String(a.body.class));
  });
  refreshSuggestionLists();
}

/* ── Model status ───────────────────────────────────────────────── */
async function checkModelStatus(){
  try {
    var s = await apiFetch("/api/ocr/status");
    var b = el("modelBadge"); if(!b) return;
    b.textContent = s.ready ? "● Tesseract ready" : "○ Tesseract not detected";
    b.style.color = s.ready ? "#6aaa6a" : "#c4922a";
    if(s.ready && s.langs){
      b.title = "Languages: "+s.langs.join(", ");
      if(s.langs.indexOf("deu_frak")>=0) b.textContent += " + Fraktur";
    }
  } catch(_){}
}

/* ── Annotations API ────────────────────────────────────────────── */
async function loadAnnotations(){
  var murl = getManifestUrl(); if(!murl) return;
  try {
    var list = await apiFetch("/api/annotations?manifest_url="+encodeURIComponent(murl));
    S.annotations = list || [];
    renderAnnotationsTab();
    learnSuggestionsFromAnnotations();
    renderAnnotationDots();
  } catch(_){
    S.annotations = [];
  }
}

async function postAnnotation(payload){
  var murl = getManifestUrl(); if(!murl) return null;
  try {
    var out = await apiFetch("/api/annotations",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(Object.assign({manifest_url:murl, page:S.currentPage}, payload)),
    });
    S.annotations.push(out);
    renderAnnotationsTab();
    learnSuggestionsFromAnnotations();
    renderAnnotationDots();
    toast("Annotation saved ✓");
    return out;
  } catch(e){
    toast("Could not save: "+e.message);
    return null;
  }
}

/* ── Import / Export annotations ────────────────────────────────── */
function importAnnotations(){
  var file = this.files && this.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    try {
      var data = JSON.parse(e.target.result);
      var list = Array.isArray(data) ? data : (data.annotations || []);
      S.annotations = S.annotations.concat(list);
      renderAnnotationsTab();
      learnSuggestionsFromAnnotations();
      renderAnnotationDots();
      toast("Imported "+list.length+" annotations ✓");
    } catch(err){
      toast("Invalid JSON file: "+err.message);
    }
  };
  reader.readAsText(file);
  this.value = "";
}

function exportAnnotations(){
  var murl = getManifestUrl();
  var out  = { manifest_url: murl, exported_at: new Date().toISOString(), annotations: S.annotations };
  var blob = new Blob([JSON.stringify(out, null, 2)], {type:"application/json"});
  var url = URL.createObjectURL(blob);

  var a = document.createElement("a");
  a.href = url;
  a.download = "annotations.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  toast("Exported "+S.annotations.length+" annotations");
}

/* ── Clear annotations (backend + UI) ───────────────────────────── */
async function clearAnnotationsUI(){
  var murl = getManifestUrl();
  if(!murl){ toast("Load a manifest first."); return; }

  var mode = prompt("Type 'page' to clear this page, or 'all' to clear everything:", "page");
  if(mode === null) return;
  mode = mode.trim().toLowerCase();
  if(mode !== "page" && mode !== "all"){ toast("Cancelled."); return; }

  try {
    if(mode === "page"){
      var p = S.currentPage;
      await apiFetch("/api/annotations?manifest_url="+encodeURIComponent(murl)+"&page="+encodeURIComponent(String(p)), { method: "DELETE" });

      S.annotations = S.annotations.filter(function(a){ return a.page !== p; });
      S.penPaths = S.penPaths.filter(function(pp){ return pp.page !== p; });
      toast("Cleared page annotations (backend + UI).");
    } else {
      await apiFetch("/api/annotations?manifest_url="+encodeURIComponent(murl), { method: "DELETE" });

      S.annotations = [];
      S.penPaths = [];
      toast("Cleared all annotations (backend + UI).");
    }

    // Remove all SVG paths and redraw remaining
    var svg = el("pen-layer");
    if(svg) Array.from(svg.querySelectorAll("path")).forEach(function(p){ p.remove(); });
    redrawPenPaths();

    renderAnnotationsTab();
    learnSuggestionsFromAnnotations();
    renderAnnotationDots();

  } catch(e){
    toast("Clear failed: " + e.message);
  }
}

/* ── Annotations UI (human readable) ────────────────────────────── */
function renderAnnotationsTab(){
  var body = el("annotationsBody"); if(!body) return;

  if(!S.annotations.length){
    body.innerHTML="<div class='empty-state'><strong>No annotations</strong>Use ✏ pen or “Annotate text”.</div>";
    return;
  }

  var html = "";
  S.annotations
    .slice()
    .sort(function(a,b){ return (a.page||0)-(b.page||0); })
    .forEach(function(a){
      var ttype = a.target_type || "annotation";
      var page  = a.page || "?";
      var label = (a.body && a.body.label) ? a.body.label : "";
      var cls   = (a.body && a.body.class) ? a.body.class : "";
      var note  = (a.body && (a.body.note || a.body.text)) ? (a.body.note || a.body.text) : "";

      var title =
        label ? label :
        (ttype === "image" ? "Image annotation" :
         ttype === "text_range" ? "Text annotation" : "Annotation");

      var meta = "Page " + page + (cls ? (" · "+cls) : "");

      html +=
        "<div class='ann-item'>" +
          "<div class='ann-type'>" + esc(title) + " <span style='color:var(--ink4)'>· " + esc(meta) + "</span></div>" +
          "<div class='ann-body'>" + esc(String(note).slice(0,180) || "(no note)") + "</div>" +
        "</div>";
    });

  body.innerHTML = html;
}

/* ── Text annotation mode + modal ───────────────────────────────── */
function toggleTextAnnotateMode(){
  if(!S.manifest){ toast("Load a manifest first."); return; }
  if(!S.ocrCache[S.currentPage]){
    toast("Run OCR for this page first.");
    return;
  }

  S.textAnnoMode = !S.textAnnoMode;

  var wrap = el("vpwrap");
  if(wrap) wrap.classList.toggle("text-annotate-on", S.textAnnoMode);

  var btn = el("btnAnnotateText");
  if(btn) btn.classList.toggle("active", S.textAnnoMode);

  var lbl = el("textModeLabel");
  if(lbl) lbl.style.display = S.textAnnoMode ? "inline" : "none";

  toast(S.textAnnoMode ? "Text mode ON: click a text block (image or facsimile)." : "Text mode OFF");
}

function openTextAnnotateModalForBlock(blockIndex){
  var r = S.ocrCache[S.currentPage];
  if(!r) return;
  var block = (r.blocks||[])[blockIndex];
  if(!block || !block.text){
    toast("This block has no text.");
    return;
  }

  S.pendingTextBlock = { page: S.currentPage, blockIndex: blockIndex, block: block };

  refreshSuggestionLists();

  el("textAnnLabel").value = "";
  el("textAnnClass").value = "";
  el("textAnnNote").value  = "";
  el("textAnnExact").value = "";
  el("textAnnBlockText").value = (block.text || "").trim();

  el("textModal").classList.add("show");
  el("textModalOverlay").classList.add("show");
  el("textAnnLabel").focus();
}

function closeTextAnnotateModal(){
  el("textModal").classList.remove("show");
  el("textModalOverlay").classList.remove("show");
  S.pendingTextBlock = null;
}

function fillSelectedExcerptFromTextarea(){
  var ta = el("textAnnBlockText");
  if(!ta) return;
  var s = ta.value.substring(ta.selectionStart, ta.selectionEnd).trim();
  if(s) el("textAnnExact").value = s;
}

async function saveTextBlockAnnotation(){
  if(!S.pendingTextBlock){
    toast("No block selected.");
    return;
  }

  var label = (el("textAnnLabel").value||"").trim();
  var cls   = (el("textAnnClass").value||"").trim();
  var note  = (el("textAnnNote").value||"").trim();
  var exact = (el("textAnnExact").value||"").trim();

  if(!label){
    toast("Please provide a label.");
    return;
  }

  var b = S.pendingTextBlock.block;
  var pageObj = (S.manifest.pages||[])[S.currentPage-1] || {};
  var imageUrl = pageObj.image || "";

  // Save ONLY ONE annotation, but include bbox inside target
  await postAnnotation({
    target_type: "text_range",
    target: {
      block_id: b.block_id,
      exact: exact,
      image_url: imageUrl,
      x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2
    },
    body: { label: label, class: cls, note: note }
  });

  closeTextAnnotateModal();
  renderAnnotationDots();
  toast("Text annotation saved ✓");
}

/* ── Dots on annotated blocks ───────────────────────────────────── */
function renderAnnotationDots(){
  var overlay = el("ocr-overlay");
  if(!overlay) return;

  var blockIds = new Set();
  (S.annotations||[]).forEach(function(a){
    if(a.page !== S.currentPage) return;

    if(a.target_type === "text_range" && a.target && a.target.block_id){
      blockIds.add(a.target.block_id);
    }
    // keep image pen-annotations working too:
    if(a.target_type === "image" && a.body && a.body.block_id){
      blockIds.add(a.body.block_id);
    }
  });

  overlay.querySelectorAll(".ocr-block").forEach(function(div){
    var idx = parseInt(div.dataset.index, 10);
    var r = S.ocrCache[S.currentPage];
    var b = r && r.blocks ? r.blocks[idx] : null;
    if(!b) return;
    div.classList.toggle("annotated", blockIds.has(b.block_id));
  });
}


/* ── TEI export ─────────────────────────────────────────────────── */
function exportAnnotationsTEI(){
  var murl = getManifestUrl();
  if(!murl){ toast("Load a manifest first."); return; }

  var title = (S.manifest && S.manifest.title) ? S.manifest.title : "Digitale Zeitungen";
  var xml = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push('<TEI xmlns="http://www.tei-c.org/ns/1.0">');
  xml.push('  <teiHeader>');
  xml.push('    <fileDesc>');
  xml.push('      <titleStmt><title>'+xmlEsc(title)+' — Annotations</title></titleStmt>');
  xml.push('      <publicationStmt><p>Generated by Digitale Zeitungen viewer</p></publicationStmt>');
  xml.push('      <sourceDesc><p>'+xmlEsc(murl)+'</p></sourceDesc>');
  xml.push('    </fileDesc>');
  xml.push('  </teiHeader>');
  xml.push('  <facsimile>');

  var byPage = {};
  (S.annotations||[]).forEach(function(a){
    var p = a.page || 0;
    if(!byPage[p]) byPage[p] = [];
    byPage[p].push(a);
  });

  Object.keys(byPage).sort(function(a,b){return parseInt(a,10)-parseInt(b,10);}).forEach(function(pStr){
    var p = parseInt(pStr,10);
    var pageObj = (S.manifest.pages||[])[p-1] || {};
    var imageUrl = pageObj.image || "";

    xml.push('    <surface xml:id="p'+p+'" n="'+p+'">');
    if(imageUrl) xml.push('      <graphic url="'+xmlEsc(imageUrl)+'"/>');

    byPage[p].forEach(function(a){
      var t = a.target_type || "";
      var body = a.body || {};
      var label = body.label || "";
      var note  = body.note || body.text || "";
      var cls   = body.class || "";

      if(t === "image" && a.target){
        xml.push('      <zone xml:id="'+xmlEsc(a.id||"")+'" type="annotation" subtype="'+xmlEsc(label)+'" rendition="'+xmlEsc(cls)+'" unit="norm" ulx="'+xmlEsc(a.target.x1)+'" uly="'+xmlEsc(a.target.y1)+'" lrx="'+xmlEsc(a.target.x2)+'" lry="'+xmlEsc(a.target.y2)+'">');
        if(note) xml.push('        <note>'+xmlEsc(note)+'</note>');
        xml.push('      </zone>');
      } else if(t === "text_range" && a.target){
        xml.push('      <zone xml:id="'+xmlEsc(a.id||"")+'" type="text" subtype="'+xmlEsc(label)+'" rendition="'+xmlEsc(cls)+'">');
        if(a.target.block_id) xml.push('        <ptr type="block" target="#'+xmlEsc(a.target.block_id)+'"/>');
        if(a.target.exact) xml.push('        <quote>'+xmlEsc(a.target.exact)+'</quote>');
        if(note) xml.push('        <note>'+xmlEsc(note)+'</note>');
        xml.push('      </zone>');
      }
    });

    xml.push('    </surface>');
  });

  xml.push('  </facsimile>');
  xml.push('</TEI>');

  var blob = new Blob([xml.join("\n")], {type:"application/xml"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "annotations.tei.xml";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Exported TEI XML.");
}

/* ── Export crops via backend ───────────────────────────────────── */
async function exportAnnotationCrops(){
  if(!S.annotations.length){ toast("No annotations."); return; }

  // collect annotations that have a bbox + image_url (either image or text_range)
  var anns = (S.annotations||[])
    .filter(function(a){
      if(a.target_type === "image" && a.target && a.target.image_url) return true;
      if(a.target_type === "text_range" && a.target && a.target.image_url) return true;
      return false;
    })
    .map(function(a){
      if(a.target_type === "image"){
        return {
          page: a.page,
          id: a.id,
          label: (a.body && a.body.label) || "annotation",
          target: a.target
        };
      }
      // text_range with bbox stored in target
      return {
        page: a.page,
        id: a.id,
        label: (a.body && a.body.label) || "text",
        target: {
          image_url: a.target.image_url,
          x1: a.target.x1, y1: a.target.y1,
          x2: a.target.x2, y2: a.target.y2
        }
      };
    })
    // ensure bbox exists
    .filter(function(a){
      var t = a.target || {};
      return typeof t.x1==="number" && typeof t.y1==="number" && typeof t.x2==="number" && typeof t.y2==="number";
    });

  if(!anns.length){ toast("No crop-enabled annotations (missing bbox)."); return; }

  toast("Downloading "+anns.length+" crops…", 0);

  for(var i=0;i<anns.length;i++){
    var a = anns[i];
    try {
      var blob = await apiFetchBlob("/api/crop.png",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          image_url: a.target.image_url,
          x1: a.target.x1, y1: a.target.y1,
          x2: a.target.x2, y2: a.target.y2,
          padding: 10
        })
      });

      var url = URL.createObjectURL(blob);
      var dl = document.createElement("a");
      dl.href = url;
      dl.download = ("crop_p"+(a.page||"")+"_"+a.label+"_"+(a.id||i)+".png").replace(/\s+/g,"_");
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
      URL.revokeObjectURL(url);

    } catch(err){
      console.error(err);
      toast("Crop failed (see console).", 2500);
      break;
    }
  }

  toast("Crop downloads started.", 2000);
}

/* ── Load manifest/page/OCR + analysis ──────────────────────────── */
async function loadManifest(){
  var url = getManifestUrl();
  if(!url){ toast("Please enter a manifest URL."); return; }

  toast("Loading…",0);
  el("thumbList").innerHTML = skel(4);
  el("facsPage").innerHTML  = "<div class='empty-state'>Run OCR to build the facsimile edition.</div>";
  el("metaPanel").innerHTML = "<div class='empty-state'>Loading…</div>";

  try {
    S.manifest = await apiFetch("/api/manifest?url="+encodeURIComponent(url));
    S.currentPage = 1;
    S.ocrCache = {};
    S.annotations = [];
    S.matchMap = {};
    S.lastKeyword = "";
    S.lastScope = "page";

    el("viewerTitle").textContent = S.manifest.title || url;

    autoSetLang(S.manifest);
    renderMeta(S.manifest);
    renderThumbs(S.manifest.pages);
    await loadPage(1);
    await loadAnnotations();

    toast("");
  } catch(err){
    toast("Error: "+err.message);
    el("thumbList").innerHTML = "<div class='empty-state'><strong>Error</strong>"+esc(err.message)+"</div>";
  }
}

async function loadPage(num){
  if(!S.manifest) return;
  S.currentPage = num;

  var page = (S.manifest.pages||[])[num-1];
  if(!page) return;

  el("pageNum").textContent = num+" / "+S.manifest.total_pages;

  document.querySelectorAll(".thumb-card").forEach(function(c,i){
    c.classList.toggle("active", i===num-1);
  });
  var act = document.querySelector(".thumb-card.active");
  if(act) act.scrollIntoView({block:"nearest"});

  clearOverlay();
  clearPenLayer();
  setStatus("");

  S.scale=1; S.tx=0; S.ty=0;

  var vp = el("viewport");
  if(page.image){
    vp.innerHTML = "<img id='pageImg' src='"+esc(page.image)+"' style='position:absolute;top:0;left:0;user-select:none' draggable='false'>";
    var img = el("pageImg");
    img.addEventListener("load", function(){ zoomHome(); }, {once:true});
    img.addEventListener("dragstart", function(e){ e.preventDefault(); });
  } else {
    vp.innerHTML = "<div style='color:#666;padding:40px;text-align:center'>No image.</div>";
  }

  if(S.ocrCache[num]){
    renderFacsimile(S.ocrCache[num], S.lastKeyword);
    setTimeout(function(){
      repositionOverlay();
      redrawPenPaths();
      applyMatchClasses();
      renderAnnotationDots();
    }, 250);
  } else {
    el("facsPage").innerHTML = "<div class='empty-state'>Click ▶ OCR to build the facsimile.</div>";
    el("textWc").textContent  = "";
  }
}

async function runOcr(num, force){
  if(!S.manifest){ toast("Load a manifest first."); return; }

  var page = (S.manifest.pages||[])[num-1];
  if(!page || !page.image){ toast("No image for this page."); return; }

  if(S.ocrCache[num] && !force){
    renderFacsimile(S.ocrCache[num], S.lastKeyword);
    repositionOverlay();
    applyMatchClasses();
    renderAnnotationDots();
    return;
  }

  var lang = getLang();
  setStatus("Tesseract ["+lang+"]…", true);
  el("facsPage").innerHTML = skel(8);
  updateThumbStatus(num,"running");

  try {
    var result = await apiFetch("/api/ocr",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({image_url:page.image, lang:lang, force:!!force}),
    });

    S.ocrCache[num] = result;
    updateThumbStatus(num,"done");

    var nb = (result.blocks||[]).length;
    setStatus("Done — "+nb+" blocks · "+( result.lang_used||lang), false);

    renderFacsimile(result, S.lastKeyword);
    repositionOverlay();
    applyMatchClasses();
    renderAnnotationDots();

  } catch(err){
    updateThumbStatus(num,"");
    setStatus("", false);
    toast("OCR error: "+err.message);
    el("facsPage").innerHTML = "<div class='empty-state'><strong>Error</strong>"+esc(err.message)+"</div>";
  }
}

/* ── OCR all timeline ───────────────────────────────────────────── */
function setOcrAllBar(msg, pct, etaSec){
  var bar = el("ocrAllBar"); if(!bar) return;
  bar.style.display = msg ? "flex" : "none";
  if(!msg){ bar.innerHTML=""; return; }
  var eta = etaSec > 0 ? ("~"+Math.round(etaSec)+"s remaining") : "finishing…";
  bar.innerHTML =
    "<div class='spinner-sm'></div>" +
    "<div style='flex:1;display:flex;flex-direction:column;gap:3px'>" +
      "<span style='font-size:10px'>" + esc(msg) + " — " + esc(eta) + "</span>" +
      "<div style='background:#2a2418;border-radius:3px;height:4px'>" +
        "<div style='background:var(--accent);height:4px;border-radius:3px;width:"+pct+"%;transition:width .3s'></div>" +
      "</div>" +
    "</div>";
}
function ocrAllUpdateBar(){
  var a = S.ocrAll;
  if(!a.running) return;
  var avg = a.times.length ? a.times.reduce(function(x,y){return x+y;},0)/a.times.length : 30;
  var remainingPages = Math.max(0, a.total - a.done - a.errors);
  var eta = remainingPages * avg;
  var pct = a.total ? Math.round(((a.done + a.errors) / a.total) * 100) : 0;
  setOcrAllBar("OCR all: " + (a.done+a.errors) + "/" + a.total + " (ok: "+a.done+", err: "+a.errors+")",
               Math.min(99,pct), eta);
}
function ocrAllPages(){
  if(!S.manifest){ toast("Load a manifest first."); return; }

  var murl  = getManifestUrl();
  var lang  = getLang();
  var total = S.manifest.total_pages;

  var btn = el("btnOcrAll");
  if(btn){ btn.disabled=true; btn.textContent="⏳"; }

  toast("OCR started for "+total+" pages…", 0);

  S.ocrAll.running=true;
  S.ocrAll.total=total;
  S.ocrAll.done=0;
  S.ocrAll.errors=0;
  S.ocrAll.times=[];
  setOcrAllBar("OCR all started…", 1, 0);

  var es = new EventSource("/api/ocr/all?manifest_url="+encodeURIComponent(murl)+"&lang="+encodeURIComponent(lang));
  es.onmessage = function(e){
    var data; try{ data=JSON.parse(e.data); }catch(_){ return; }

    if(data.status==="complete"){
      es.close();
      if(btn){ btn.disabled=false; btn.textContent="▶▶ All"; }
      S.ocrAll.running=false;
      setOcrAllBar("OCR all complete.", 100, 0);
      setTimeout(function(){ setOcrAllBar("",0,0); }, 2500);
      toast("All pages done.", 2500);
      setStatus("", false);
      return;
    }

    if(data.status==="running"){
      updateThumbStatus(data.page,"running");
      setStatus("p"+data.page+"/"+total+" ["+lang+"]…", true);
      return;
    }

    if(data.status==="done"){
      if(typeof data.seconds === "number") S.ocrAll.times.push(data.seconds);
      S.ocrAll.done++;
      ocrAllUpdateBar();

      S.ocrCache[data.page] = data.result;
      updateThumbStatus(data.page,"done");

      if(data.page===S.currentPage){
        renderFacsimile(data.result, S.lastKeyword);
        repositionOverlay();
        applyMatchClasses();
        renderAnnotationDots();
      }
      return;
    }

    if(data.status==="error"){
      if(typeof data.seconds === "number") S.ocrAll.times.push(data.seconds);
      S.ocrAll.errors++;
      ocrAllUpdateBar();
      updateThumbStatus(data.page,"");
    }
  };

  es.onerror = function(){
    es.close();
    if(btn){ btn.disabled=false; btn.textContent="▶▶ All"; }
    S.ocrAll.running=false;
    setOcrAllBar("OCR all stopped (connection lost).", 0, 0);
    setTimeout(function(){ setOcrAllBar("",0,0); }, 2500);
    setStatus("",false);
    toast("Connection lost.");
  };
}

/* ── Analysis (unchanged) ───────────────────────────────────────── */
async function ensureOcrForAllPages(){
  if(!S.manifest) return;

  var total = S.manifest.total_pages;
  var missing = [];
  for(var p=1;p<=total;p++){
    if(!S.ocrCache[p]) missing.push(p);
  }
  if(!missing.length) return;

  toast("Running OCR for missing pages ("+missing.length+")…", 0);

  await new Promise(function(resolve){
    var murl = getManifestUrl();
    var lang = getLang();

    var es = new EventSource("/api/ocr/all?manifest_url="+encodeURIComponent(murl)+"&lang="+encodeURIComponent(lang));
    es.onmessage = function(e){
      var data; try{ data=JSON.parse(e.data); }catch(_){ return; }
      if(data.status==="done"){
        S.ocrCache[data.page] = data.result;
        updateThumbStatus(data.page,"done");
      }
      if(data.status==="complete"){
        es.close();
        toast("", 0);
        resolve();
      }
    };
    es.onerror = function(){
      es.close();
      toast("OCR missing pages failed (connection lost).", 3000);
      resolve();
    };
  });
}
function findMatches(keyword, scope){
  keyword = (keyword||"").trim();
  if(!keyword) return [];

  var re = new RegExp(escRe(keyword), "gi");

  var pages = [];
  if(scope === "issue"){
    pages = Object.keys(S.ocrCache).map(function(n){ return parseInt(n,10); })
      .sort(function(a,b){return a-b;});
  } else {
    pages = [S.currentPage];
  }

  var out = [];
  pages.forEach(function(pn){
    var r = S.ocrCache[pn]; if(!r) return;
    (r.blocks||[]).forEach(function(b, idx){
      if(!b.text) return;
      var m = b.text.match(re);
      if(m && m.length){
        out.push({ page: pn, blockIndex: idx, block: b, count: m.length });
      }
    });
  });

  return out;
}
async function runKeywordSearch(){
  if(!S.manifest){ toast("Load a manifest first."); return; }

  var q = (el("analysisSearch").value||"").trim();
  var scope = el("searchScope") ? el("searchScope").value : "page";
  S.lastKeyword = q;
  S.lastScope = scope;

  if(!q){
    S.matchMap = {};
    var mc0 = el("matchCount"); if(mc0) mc0.textContent = "No search";
    renderAnalysisResults([], "");
    if(S.ocrCache[S.currentPage]){
      renderFacsimile(S.ocrCache[S.currentPage], "");
      repositionOverlay();
      applyMatchClasses();
      renderAnnotationDots();
    }
    return;
  }

  if(scope === "issue"){
    await ensureOcrForAllPages();
  } else {
    if(!S.ocrCache[S.currentPage]){
      await runOcr(S.currentPage, false);
    }
  }

  var matches = findMatches(q, scope);

  S.matchMap = {};
  matches.forEach(function(m){
    if(!S.matchMap[m.page]) S.matchMap[m.page] = new Set();
    S.matchMap[m.page].add(m.blockIndex);
  });

  var totalHits = matches.reduce(function(a,m){ return a + m.count; }, 0);
  var mc = el("matchCount");
  if(mc) mc.textContent = matches.length+" blocks · "+totalHits+" hits";

  if(S.ocrCache[S.currentPage]){
    renderFacsimile(S.ocrCache[S.currentPage], q);
    repositionOverlay();
    applyMatchClasses();
    renderAnnotationDots();
  }

  renderAnalysisResults(matches, q);
}
function renderAnalysisResults(matches, keyword){
  var body = el("analysisBody"); if(!body) return;

  if(!keyword || !keyword.trim()){
    body.innerHTML =
      "<div class='empty-state'><strong>Keyword search</strong>Type a keyword and click “Search”.</div>";
    return;
  }

  if(!matches.length){
    body.innerHTML =
      "<div class='empty-state'><strong>No results</strong>No blocks matched “" + esc(keyword) + "”.</div>";
    return;
  }

  var pat = new RegExp("(" + escRe(keyword.trim()) + ")", "gi");
  var html = "";

  matches.forEach(function(m){
    var b = m.block || {};
    var raw = (b.text || "").trim();
    var snippet = esc(raw).replace(pat, "<mark>$1</mark>");

    html +=
      "<div class='sel-block' data-page='"+m.page+"' data-index='"+m.blockIndex+"'>" +
        "<div class='sel-type'>Page "+esc(String(m.page))+" · "+esc(String(m.count))+" hit(s)</div>" +
        "<div class='sel-text'>"+snippet+"</div>" +
      "</div>";
  });

  body.innerHTML = html;

  body.querySelectorAll(".sel-block").forEach(function(div){
    div.addEventListener("click", async function(){
      var p = parseInt(div.dataset.page, 10);
      var idx = parseInt(div.dataset.index, 10);
      await loadPage(p);
      flashFacsBlock(idx);
    });
  });
}
function flashFacsBlock(idx){
  var b = document.querySelector(".facs-block[data-index='"+idx+"']");
  if(!b) return;
  b.classList.add("selected");
  b.scrollIntoView({block:"center", behavior:"smooth"});
  setTimeout(function(){ b.classList.remove("selected"); }, 1200);
}
function exportKeywordMatches(){
  var q = (S.lastKeyword||"").trim();
  if(!q){ toast("Enter a keyword first."); return; }

  var matches = findMatches(q, S.lastScope);
  if(!matches.length){ toast("No matches."); return; }

  var exportObj = {
    manifest_url: getManifestUrl(),
    keyword: q,
    scope: S.lastScope,
    exported_at: new Date().toISOString(),
    results: matches.map(function(m){
      return {
        page: m.page,
        block_id: m.block.block_id,
        block_index: m.blockIndex,
        hit_count: m.count,
        bbox: {x1:m.block.x1, y1:m.block.y1, x2:m.block.x2, y2:m.block.y2},
        text: m.block.text
      };
    })
  };

  var blob = new Blob([JSON.stringify(exportObj,null,2)], {type:"application/json"});
  var url = URL.createObjectURL(blob);

  var a = document.createElement("a");
  a.href = url;
  a.download = "keyword_results.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  toast("Exported "+matches.length+" results.");
}

/* ── Facsimile / overlay ────────────────────────────────────────── */
function renderFacsimile(result, highlight){
  var blocks  = result.blocks || [];
  var pw      = result.page_width  || 1000;
  var ph      = result.page_height || 1400;
  var canvas  = el("facsCanvas");
  var page    = el("facsPage");
  var wc      = el("textWc");
  if(!page||!canvas) return;

  if(!blocks.length){
    page.innerHTML="<div class='empty-state'>No blocks detected.</div>";
    if(wc) wc.textContent = "";
    return;
  }

  var cs = getComputedStyle(canvas);
  var pad = parseFloat(cs.paddingLeft||"0") + parseFloat(cs.paddingRight||"0");
  var cw  = (canvas.clientWidth || canvas.offsetWidth || 640) - pad;
  cw = Math.max(320, cw);

  var scale = cw/pw;
  var dw    = Math.round(pw*scale), dh = Math.round(ph*scale);
  page.style.width = dw+"px";
  page.style.height= dh+"px";

  var pat = highlight && highlight.trim() ? new RegExp("("+escRe(highlight.trim())+")","gi") : null;
  var fs  = Math.round(11*scale*(pw/800));
  fs      = Math.max(7,Math.min(fs,28));

  var html = "", wcount = 0;

  blocks.forEach(function(b, idx){
    var l = Math.round(b.x1*dw), t = Math.round(b.y1*dh);
    var w = Math.max(4,Math.round((b.x2-b.x1)*dw));
    var h = Math.max(4,Math.round((b.y2-b.y1)*dh));
    var text = (b.text||"").trim();
    if(!text && b.type!=="illustration") return;

    wcount += text.split(/\s+/).filter(Boolean).length;

    l = Math.max(0, Math.min(l, dw - 2));
    t = Math.max(0, Math.min(t, dh - 2));
    w = Math.max(2, Math.min(w, dw - l));
    h = Math.max(2, Math.min(h, dh - t));

    var weight = (b.type==="heading"||b.type==="title") ? "600" : "400";
    var content = b.type==="illustration" ? "[illustration]"
      : pat ? esc(text).replace(pat,"<mark>$1</mark>") : esc(text);

    html +=
      "<div class='facs-block type-"+esc(b.type||"text")+"' data-index='"+idx+"' style='left:"+l+"px;top:"+t+"px;width:"+w+"px;height:"+h+"px;font-size:"+fs+"px;font-weight:"+weight+";text-align:justify;'>" +
        content +
      "</div>";
  });

  page.innerHTML = html;
  if(wc) wc.textContent = wcount + " words";

  // Allow selecting text-block by facsimile click, only in text mode
  page.querySelectorAll(".facs-block").forEach(function(div){
    div.addEventListener("click", function(e){
      if(!S.textAnnoMode) return;
      e.stopPropagation();
      var idx = parseInt(div.dataset.index, 10);
      openTextAnnotateModalForBlock(idx);
    });
  });

  applyMatchClasses();
}
function applyMatchClasses(){
  var set = S.matchMap[S.currentPage];
  if(set){
    document.querySelectorAll(".facs-block").forEach(function(d){
      var idx = parseInt(d.dataset.index,10);
      d.classList.toggle("match", set.has(idx));
    });
  } else {
    document.querySelectorAll(".facs-block").forEach(function(d){
      d.classList.remove("match");
    });
  }
}
function clearOverlay(){
  var o = el("ocr-overlay");
  if(o){
    o.innerHTML = "";
    o.classList.remove("overlay-text-on");
  }
}
function repositionOverlay(){
  var r = S.ocrCache[S.currentPage]; if(!r) return;
  var blocks = r.blocks || [];
  var overlay = el("ocr-overlay");
  var img = el("pageImg");
  if(!overlay || !img || !blocks.length) return;

  var iw = img.naturalWidth, ih = img.naturalHeight;
  if(!iw || !ih) return;

  overlay.innerHTML = "";
  var matchSet = S.matchMap[S.currentPage];

  blocks.forEach(function(block, idx){
    var left  = Math.round(S.tx + block.x1*iw*S.scale);
    var top   = Math.round(S.ty + block.y1*ih*S.scale);
    var width = Math.max(2,Math.round((block.x2-block.x1)*iw*S.scale));
    var height= Math.max(2,Math.round((block.y2-block.y1)*ih*S.scale));

    var div = document.createElement("div");
    div.className     = "ocr-block";
    div.dataset.type  = block.type || "text";
    div.dataset.index = idx;
    div.style.cssText = "left:"+left+"px;top:"+top+"px;width:"+width+"px;height:"+height+"px;";

    if(matchSet && matchSet.has(idx)) div.classList.add("match");

    if(block.text){
      var tip = document.createElement("div");
      tip.className="ocr-tooltip";
      tip.textContent=block.text;
      div.appendChild(tip);

      var span = document.createElement("span");
      span.className="ocr-text";
      span.textContent=block.text;
      span.style.fontSize = Math.max(8,Math.min(height*.75,16))+"px";
      div.appendChild(span);
    }

    // Click selects block for text annotation, ONLY in text mode
    div.addEventListener("click", function(e){
      if(!S.textAnnoMode) return;
      e.stopPropagation();
      openTextAnnotateModalForBlock(idx);
    });

    overlay.appendChild(div);
  });

  if(S.textOverlay) overlay.classList.add("overlay-text-on");

  renderAnnotationDots();
}

/* ── Pen drawing (image annotation) ─────────────────────────────── */
function initPenLayer(){
  var svg = el("pen-layer"); if(!svg) return;

  svg.addEventListener("mousedown", function(e){
    if(!S.penMode) return;
    e.stopPropagation();
    S.penDrawing = true;
    S.penPoints = [];
    var pt = penPoint(e);
    S.penPoints.push(pt);

    var path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("class","pen-path pen-path-class-A");
    path.setAttribute("d","M"+pt.x+" "+pt.y);
    svg.appendChild(path);
    S.pendingPathEl = path;
  });

  svg.addEventListener("mousemove", function(e){
    if(!S.penDrawing || !S.pendingPathEl) return;
    var pt = penPoint(e);
    S.penPoints.push(pt);

    var d = "M";
    for(var i=0;i<S.penPoints.length;i++){
      d += (i===0 ? "" : "L") + S.penPoints[i].x + " " + S.penPoints[i].y + " ";
    }
    S.pendingPathEl.setAttribute("d", d.trim());
  });

  svg.addEventListener("mouseup", function(){
    if(!S.penDrawing || !S.pendingPathEl) return;
    S.penDrawing = false;
    if(S.penPoints.length < 3){
      svg.removeChild(S.pendingPathEl);
      S.pendingPathEl = null;
      return;
    }
    showPenModal();
  });
}
function penPoint(e){
  var wrap = el("vpwrap");
  var r = wrap.getBoundingClientRect();
  return { x: Math.round(e.clientX-r.left), y: Math.round(e.clientY-r.top) };
}
function togglePenMode(){
  S.penMode = !S.penMode;
  var btn = el("btnPenMode");
  var lbl = el("penModeLabel");
  var svg = el("pen-layer");
  if(btn) btn.classList.toggle("active", S.penMode);
  if(lbl) lbl.style.display = S.penMode ? "inline" : "none";
  if(svg){
    svg.style.pointerEvents = S.penMode ? "all" : "none";
    svg.style.cursor        = S.penMode ? "crosshair" : "default";
  }
  var vp = el("viewport");
  if(vp) vp.style.cursor = S.penMode ? "crosshair" : "grab";
  toast(S.penMode ? "Pen mode ON — draw on the image" : "Pen mode OFF");
}
function showPenModal(){
  el("penNote").value = "";
  el("penLabel").value = "";
  el("penClassInput").value = "";
  refreshSuggestionLists();
  el("penModal").classList.add("show");
  el("modalOverlay").classList.add("show");
  el("penLabel").focus();
}
function closePenModal(){
  el("penModal").classList.remove("show");
  el("modalOverlay").classList.remove("show");
}
function discardPenAnnotation(){
  if(S.pendingPathEl){
    var svg = el("pen-layer");
    if(svg && S.pendingPathEl.parentNode===svg) svg.removeChild(S.pendingPathEl);
    S.pendingPathEl = null;
  }
  closePenModal();
}
function drawingBBoxFromPoints(points){
  var xs = points.map(function(p){return p.x;});
  var ys = points.map(function(p){return p.y;});
  return { x1: Math.min.apply(null,xs), y1: Math.min.apply(null,ys),
           x2: Math.max.apply(null,xs), y2: Math.max.apply(null,ys) };
}
function viewportToImageNormBBox(bb){
  var img = el("pageImg");
  if(!img) return null;
  var iw = img.naturalWidth, ih = img.naturalHeight;

  var ix1 = (bb.x1 - S.tx) / S.scale;
  var iy1 = (bb.y1 - S.ty) / S.scale;
  var ix2 = (bb.x2 - S.tx) / S.scale;
  var iy2 = (bb.y2 - S.ty) / S.scale;

  ix1 = Math.max(0, Math.min(iw, ix1));
  iy1 = Math.max(0, Math.min(ih, iy1));
  ix2 = Math.max(0, Math.min(iw, ix2));
  iy2 = Math.max(0, Math.min(ih, iy2));

  return { x1: ix1/iw, y1: iy1/ih, x2: ix2/iw, y2: iy2/ih };
}
async function savePenAnnotation(){
  if(!S.pendingPathEl) return;

  var note  = (el("penNote").value||"").trim();
  var label = (el("penLabel").value||"").trim();
  var cls   = (el("penClassInput").value||"").trim();

  if(!label){
    toast("Please provide a label.");
    return;
  }

  var pathD = S.pendingPathEl.getAttribute("d");
  S.pendingPathEl.classList.add("permanent");
  S.penPaths.push({ d: pathD, note: note, label: label, cls: cls, page: S.currentPage });
  S.pendingPathEl = null;

  var bbVp = drawingBBoxFromPoints(S.penPoints);
  var bbNorm = viewportToImageNormBBox(bbVp);
  if(!bbNorm){
    toast("Could not compute bbox.");
    closePenModal();
    return;
  }

  var pageObj = (S.manifest.pages||[])[S.currentPage-1] || {};
  var imageUrl = pageObj.image || "";

  await postAnnotation({
    target_type:"image",
    target:{
      image_url: imageUrl,
      x1: clamp01(bbNorm.x1), y1: clamp01(bbNorm.y1),
      x2: clamp01(bbNorm.x2), y2: clamp01(bbNorm.y2)
    },
    body:{ note: note, class: cls, label: label, svg_path: pathD }
  });

  closePenModal();
}
function clearPenLayer(){
  var svg = el("pen-layer"); if(!svg) return;
  Array.from(svg.querySelectorAll("path:not(.permanent)")).forEach(function(p){ p.remove(); });
}
function redrawPenPaths(){
  var svg = el("pen-layer"); if(!svg) return;
  Array.from(svg.querySelectorAll("path.permanent")).forEach(function(p){ p.remove(); });
  S.penPaths.forEach(function(pp){
    if(pp.page !== S.currentPage) return;
    var path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("class","pen-path pen-path-class-A permanent");
    path.setAttribute("d",pp.d);
    path.title = pp.label ? (pp.label + (pp.note?(": "+pp.note):"")) : (pp.note||"");
    svg.appendChild(path);
  });
}

/* ── Toggle overlays ────────────────────────────────────────────── */
function toggleTextOverlay(){
  S.textOverlay = !S.textOverlay;
  var o = el("ocr-overlay");
  if(o) o.classList.toggle("overlay-text-on", S.textOverlay);
  var b = el("btnOverlayText");
  if(b) b.classList.toggle("active", S.textOverlay);
}
function toggleWordOverlay(){
  S.showWordBoxes = !S.showWordBoxes;
  var b = el("btnOverlayWords");
  if(b) b.classList.toggle("active", S.showWordBoxes);
  repositionOverlay();
}

/* ── Status bar (single page) ───────────────────────────────────── */
function setStatus(msg, loading){
  var bar = el("ocrStatusBar"); if(!bar) return;
  bar.style.display = msg ? "flex" : "none";
  if(!msg){
    clearInterval(S._ocrTimer); S._ocrStartTime=0; bar.innerHTML="";
    return;
  }
  if(loading && !S._ocrStartTime){
    S._ocrStartTime = Date.now();
    clearInterval(S._ocrTimer);
    S._ocrTimer = setInterval(function(){ _updateBar(msg); }, 300);
    _updateBar(msg);
  }
  if(!loading){
    if(S._ocrStartTime){
      var actual = (Date.now()-S._ocrStartTime)/1000;
      S._ocrTimes.push(actual);
      if(S._ocrTimes.length>5) S._ocrTimes.shift();
      S._ocrEstimate = S._ocrTimes.reduce(function(a,b){return a+b;},0)/S._ocrTimes.length;
    }
    clearInterval(S._ocrTimer);
    S._ocrStartTime=0;
    bar.innerHTML="<span style='color:#6aaa6a'>✓</span> <span>"+esc(msg)+"</span>";
  }
}
function _updateBar(msg){
  var bar=el("ocrStatusBar"); if(!bar||!S._ocrStartTime) return;
  var elapsed=(Date.now()-S._ocrStartTime)/1000;
  var pct=Math.min(90,Math.round(elapsed/S._ocrEstimate*100));
  var rem=Math.max(0,S._ocrEstimate-elapsed);
  var remStr=rem>5?"~"+Math.round(rem)+"s remaining":"finishing…";
  bar.innerHTML="<div class='spinner-sm'></div>"
    +"<div style='flex:1;display:flex;flex-direction:column;gap:3px'>"
      +"<span style='font-size:10px'>"+esc(msg)+" — "+elapsed.toFixed(0)+"s / "+remStr+"</span>"
      +"<div style='background:#2a2418;border-radius:3px;height:4px'>"
        +"<div style='background:var(--accent);height:4px;border-radius:3px;width:"+pct+"%;transition:width .3s'></div>"
      +"</div>"
    +"</div>";
}

/* ── View / tab ─────────────────────────────────────────────────── */
function setView(mode){
  el("splitView").className="split-view"+(mode==="both"?"":" view-"+mode);
  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){
    b.classList.toggle("active", b.dataset.view===mode);
  });
}
function setSideTab(tab){
  document.querySelectorAll(".side-tab").forEach(function(b){
    b.classList.toggle("active", b.dataset.tab===tab);
  });
  document.querySelectorAll(".tab-content").forEach(function(d){
    d.classList.remove("active");
  });
  var tc = el("tab"+tab.charAt(0).toUpperCase()+tab.slice(1));
  if(tc) tc.classList.add("active");
}

/* ── Pan / zoom ─────────────────────────────────────────────────── */
function initPanZoom(){
  var vp=el("viewport"); if(!vp) return;

  vp.addEventListener("wheel", function(e){
    if(S.penMode) return;
    e.preventDefault();
    var f=e.deltaY<0?1.12:0.89;
    var wrap=el("vpwrap")||vp;
    var r=wrap.getBoundingClientRect();
    S.tx=(e.clientX-r.left)+(S.tx-(e.clientX-r.left))*f;
    S.ty=(e.clientY-r.top)+(S.ty-(e.clientY-r.top))*f;
    S.scale*=f;
    applyTransform();
    repositionOverlay();
    redrawPenPaths();
  }, {passive:false});

  vp.addEventListener("mousedown", function(e){
    if(S.penMode || e.button!==0) return;
    S.dragging=true;
    S.dragStartX=e.clientX; S.dragStartY=e.clientY;
    S.dragTx=S.tx; S.dragTy=S.ty;
    vp.style.cursor="grabbing";
  });

  window.addEventListener("mousemove", function(e){
    if(!S.dragging) return;
    S.tx=S.dragTx+(e.clientX-S.dragStartX);
    S.ty=S.dragTy+(e.clientY-S.dragStartY);
    applyTransform();
    repositionOverlay();
    redrawPenPaths();
  });

  window.addEventListener("mouseup", function(){
    S.dragging=false;
    var v=el("viewport");
    if(v && !S.penMode) v.style.cursor="grab";
  });
}
function applyTransform(){
  var img=el("pageImg"); if(!img) return;
  img.style.transform="translate("+S.tx+"px,"+S.ty+"px) scale("+S.scale+")";
  img.style.transformOrigin="0 0";
}
function zoom(f){
  var wrap=el("vpwrap")||el("viewport"); if(!wrap) return;
  S.tx=wrap.offsetWidth/2+(S.tx-wrap.offsetWidth/2)*f;
  S.ty=wrap.offsetHeight/2+(S.ty-wrap.offsetHeight/2)*f;
  S.scale*=f;
  applyTransform();
  repositionOverlay();
  redrawPenPaths();
}
function zoomHome(){
  var img=el("pageImg"), wrap=el("vpwrap")||el("viewport");
  if(!img||!wrap) return;
  var iw=img.naturalWidth||800, ih=img.naturalHeight||1000;
  S.scale=Math.min(wrap.offsetWidth/iw,wrap.offsetHeight/ih)*0.95;
  S.tx=(wrap.offsetWidth-iw*S.scale)/2;
  S.ty=(wrap.offsetHeight-ih*S.scale)/2;
  applyTransform();
  repositionOverlay();
  redrawPenPaths();
}

/* ── Thumbnails ─────────────────────────────────────────────────── */
function renderThumbs(pages){
  var list=el("thumbList");
  if(!pages||!pages.length){
    list.innerHTML="<div class='empty-state'>No pages.</div>";
    return;
  }
  list.innerHTML=pages.map(function(p,i){
    return "<div class='thumb-card "+(i===0?"active":"")+"' data-page='"+p.index+"'>"
      +(p.thumb?"<img src='"+esc(p.thumb)+"' alt='p"+p.index+"' loading='lazy'>"
               :"<div class='thumb-placeholder'>📄</div>")
      +"<div class='thumb-label'>"+esc(p.label)+"</div>"
      +"<div class='thumb-bar'></div>"
      +"</div>";
  }).join("");

  document.querySelectorAll(".thumb-card").forEach(function(c){
    c.addEventListener("click", function(){
      loadPage(parseInt(c.dataset.page,10));
    });
  });
}
function updateThumbStatus(num,status){
  var card=document.querySelector(".thumb-card[data-page='"+num+"']");
  if(!card) return;
  card.classList.remove("running","done");
  if(status) card.classList.add(status);
}

/* ── Metadata ───────────────────────────────────────────────────── */
function autoSetLang(manifest){
  var sel=el("langSelect"); if(!sel) return;

  var raw=(manifest.language||"").toLowerCase().trim();
  if(!raw && manifest.metadata){
    ["Language","language","Sprache","langue"].forEach(function(k){
      if(!raw && manifest.metadata[k]) raw=String(manifest.metadata[k]).toLowerCase().trim();
    });
  }
  if(!raw) return;

  var tess=LANG_MAP[raw]||raw;

  for(var j=0;j<sel.options.length;j++){
    if(sel.options[j].value===tess){
      sel.selectedIndex=j;
      return;
    }
  }

  var opt=document.createElement("option");
  opt.value=tess; opt.textContent=tess;
  sel.appendChild(opt);
  sel.value=tess;
}
function renderMeta(data){
  var panel=el("metaPanel"); if(!panel) return;

  var meta=data.metadata||{};
  var rows=Object.keys(meta).map(function(k){
    return "<div class='meta-row'><span class='mk'>"+esc(k)+"</span><span class='mv'>"+esc(meta[k])+"</span></div>";
  }).join("");

  var allLinks=[].concat(
    Array.isArray(data.related)?data.related:(data.related?[data.related]:[]),
    Array.isArray(data.seeAlso)?data.seeAlso:(data.seeAlso?[data.seeAlso]:[]),
    [{id:data.manifest_url,label:"IIIF manifest",format:"application/ld+json"}]
  );

  var linkRows=allLinks.filter(function(l){return l&&(l["@id"]||l.id);}).map(function(l){
    var href=l["@id"]||l.id||"#";
    var label=l.label||href.split("/").pop()||"Link";
    var fmt=(l.format||l["@type"]||"").split("/").pop().toUpperCase().slice(0,12);
    return "<a class='link-row' href='"+esc(href)+"' target='_blank' rel='noopener'>"
          +"<span class='link-badge'>"+esc(fmt||"LINK")+"</span>"+esc(label)+"</a>";
  }).join("");

  panel.innerHTML=
    "<div class='item-header'>"
      +"<h2>"+esc(data.title)+"</h2>"
      +"<div class='item-badges'>"
        +"<span class='item-badge'>"+data.total_pages+" pages</span>"
        +(data.date?"<span class='item-badge'>"+esc(data.date)+"</span>":"")
        +(data.language?"<span class='item-badge'>"+esc(data.language)+"</span>":"")
      +"</div>"
    +"</div>"
    +"<div class='meta-section open'><div class='meta-section-head' onclick='toggleMetaSection(this)'>Metadata <span>▾</span></div><div class='meta-section-body'>"+rows+"</div></div>"
    +"<div class='meta-section open'><div class='meta-section-head' onclick='toggleMetaSection(this)'>Links <span>▾</span></div><div class='meta-section-body'><div style='display:flex;flex-direction:column'>"+(linkRows||"<span style='color:var(--ink4);font-size:11px'>No links.</span>")+"</div></div></div>";
}
window.toggleMetaSection=function(h){ h.closest(".meta-section").classList.toggle("open"); };

/* ── Nav ────────────────────────────────────────────────────────── */
function goPage(delta){
  if(!S.manifest) return;
  loadPage(Math.max(1,Math.min(S.manifest.total_pages,S.currentPage+delta)));
}

}());