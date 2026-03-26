/* zeitungen.js — OCR viewer + block/word annotations (English UI) */
(function () {
"use strict";

/* ----------------------------- constants ----------------------------- */
var LANG_MAP = {
  "de":"deu_frak+deu","deu":"deu_frak+deu","german":"deu_frak+deu","deutsch":"deu_frak+deu",
  "en":"eng","eng":"eng","english":"eng",
  "fr":"fra","fra":"fra","french":"fra",
  "nl":"nld","nld":"nld","dutch":"nld",
  "pt":"por","por":"por",
  "la":"lat","lat":"lat","latin":"lat",
  "cy":"cym","cym":"cym","welsh":"cym"
};

var S = {
  manifest: null,
  currentPage: 1,

  ocrCache: {},

  textOverlay: false,
  showWordBoxes: false,
  selectMode: "block",          // "block" | "word"

  selectedBlocks: new Set(),    // indices
  selectedWords: new Set(),     // word_id strings

  annotations: [],
  annIndex: { block: new Map(), word: new Map() },

  scale: 1, tx: 0, ty: 0,
  dragging: false, dragStartX:0, dragStartY:0, dragTx:0, dragTy:0,

  _ocrTimes: [],
  _ocrEstimate: 60,
  _ocrStartTime: 0,
  _ocrTimer: null
};

/* ------------------------------- boot -------------------------------- */
document.addEventListener("DOMContentLoaded", function () {
  on("btnLoad", "click", loadManifest);
  on("manifestUrl", "keydown", function(e){ if(e.key==="Enter") loadManifest(); });

  on("btnOcr", "click", function(){ runOcr(S.currentPage); });
  on("btnOcrAll", "click", ocrAllPages);

  on("btnOverlayText", "click", toggleTextOverlay);
  on("btnOverlayWords", "click", toggleWordOverlay);
  on("btnSelectMode", "click", toggleSelectMode);

  on("btnPrev", "click", function(){ goPage(-1); });
  on("btnNext", "click", function(){ goPage(1); });

  on("btnZoomIn", "click", function(){ zoom(1.4); });
  on("btnZoomOut", "click", function(){ zoom(0.7); });
  on("btnZoomHome", "click", zoomHome);

  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){
    b.addEventListener("click", function(){ setView(b.dataset.view); });
  });

  // side tabs
  document.querySelectorAll(".side-tab").forEach(function(b){
    b.addEventListener("click", function(){
      document.querySelectorAll(".side-tab").forEach(function(x){ x.classList.remove("active"); });
      document.querySelectorAll(".tab-content").forEach(function(x){ x.classList.remove("active"); });
      b.classList.add("active");
      el("tab"+capitalize(b.dataset.tab)).classList.add("active");
    });
  });

  on("analysisSearch", "input", function(){ renderAnalysis(this.value); });
  on("btnClearSel", "click", clearSelection);
  on("btnSelAll", "click", selectAllTextBlocks);

  initPanZoom();
  checkModelStatus();
});

/* ------------------------------- utils -------------------------------- */
function el(id) { return document.getElementById(id); }
function on(id, ev, fn) { var e = el(id); if(e) e.addEventListener(ev, fn); }
function capitalize(s){ s=String(s||""); return s ? (s.charAt(0).toUpperCase()+s.slice(1)) : s; }

function esc(s) {
  return String(s||"")
    .replace(new RegExp("&","g"), "&amp;")
    .replace(new RegExp("<","g"), "&lt;")
    .replace(new RegExp(">","g"), "&gt;")
    .replace(new RegExp("\"","g"), "&quot;");
}

// IMPORTANT: no regex literal here
function escapeRegExp(s) {
  return String(s||"").replace(new RegExp("[.*+?^${}()|\$\$\\\$", "g"), "\\$&");
}

var _toastTimer = null;
function toast(msg, dur) {
  if(dur === undefined) dur = 2800;
  var t = el("toast"); if(!t) return;
  t.textContent = msg || "";
  t.classList.toggle("show", !!msg);
  if(_toastTimer) clearTimeout(_toastTimer);
  if(msg && dur > 0) _toastTimer = setTimeout(function(){ t.classList.remove("show"); }, dur);
}

function skel(n) {
  var h = "<div style='padding:12px'>";
  n = n || 6;
  for(var i=0;i<n;i++){
    h += "<div class='skeleton-line' style='width:"+(45+Math.random()*50)+"%'></div>";
  }
  return h + "</div>";
}

async function apiFetch(path, opts) {
  var r = await fetch(path, opts || {});
  if(!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0,200));
  return r.json();
}

function getManifestUrl() {
  var i = el("manifestUrl");
  return i ? String(i.value||"").trim() : "";
}

function getLang() {
  var s = el("langSelect");
  return s ? s.value : "deu_frak+deu";
}

function syncLangSelector(langUsed) {
  if(!langUsed) return;
  var sel = el("langSelect"); if(!sel) return;
  for(var i=0;i<sel.options.length;i++){
    if(sel.options[i].value === langUsed){ sel.selectedIndex = i; return; }
  }
  var opt = document.createElement("option");
  opt.value = langUsed;
  opt.textContent = langUsed;
  sel.appendChild(opt);
  sel.value = langUsed;
}

/* --------------------------- model status ---------------------------- */
async function checkModelStatus() {
  try {
    var s = await apiFetch("/api/ocr/status");
    var b = el("modelBadge"); if(!b) return;
    b.textContent = s.ready ? "● Tesseract ready" : "○ Tesseract not detected";
    b.style.color = s.ready ? "#6aaa6a" : "#c4922a";
    if(s.ready && s.langs){
      var frak = (s.langs.indexOf("deu_frak") >= 0);
      if(frak) b.textContent += " + Fraktur";
      b.title = "Languages: " + s.langs.join(", ");
    }
  } catch(_){}
}

/* ---------------------------- annotations ---------------------------- */
async function loadAnnotations() {
  var murl = getManifestUrl();
  if(!murl) return;
  try {
    var anns = await apiFetch("/api/annotations?manifest_url=" + encodeURIComponent(murl));
    S.annotations = Array.isArray(anns) ? anns : [];
  } catch(_) {
    S.annotations = [];
  }
  buildAnnotationIndex();
  applyAnnotationStyles();
}

function buildAnnotationIndex() {
  S.annIndex = { block: new Map(), word: new Map() };
  S.annotations.forEach(function(a){
    if(!a || !a.target_type || !a.target) return;
    if(a.target_type === "block" && a.target.block_id) S.annIndex.block.set(a.target.block_id, a);
    if(a.target_type === "word"  && a.target.word_id)  S.annIndex.word.set(a.target.word_id, a);
  });
}

async function postAnnotation(payload) {
  var saved = await apiFetch("/api/annotations", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  S.annotations.push(saved);
  buildAnnotationIndex();
  return saved;
}

async function saveBlockAnnotation(block, body) {
  var murl = getManifestUrl();
  if(!murl) { toast("No manifest URL.", 1600); return; }
  if(!block || !block.block_id) { toast("Block has no block_id (backend not updated?).", 2200); return; }

  var payload = {
    manifest_url: murl,
    page: S.currentPage,
    target_type: "block",
    target: { block_id: block.block_id },
    body: body || { comment: "Block annotation" }
  };
  await postAnnotation(payload);
}

async function saveWordAnnotation(word, block, body) {
  var murl = getManifestUrl();
  if(!murl) { toast("No manifest URL.", 1600); return; }
  if(!word || !word.word_id) { toast("Word has no word_id (backend not updated?).", 2200); return; }

  var payload = {
    manifest_url: murl,
    page: S.currentPage,
    target_type: "word",
    target: { word_id: word.word_id, block_id: (block && block.block_id) ? block.block_id : null },
    body: body || { comment: "Word annotation" }
  };
  await postAnnotation(payload);
}

function applyAnnotationStyles() {
  updateBlockHighlights();
  updateWordHighlights();
}

/* ---------------------- selection mode / overlays --------------------- */
function toggleSelectMode() {
  S.selectMode = (S.selectMode === "block") ? "word" : "block";
  var b = el("btnSelectMode");
  if(b) b.textContent = (S.selectMode === "block") ? "Block" : "Word";
  toast("Selection mode: " + (S.selectMode === "block" ? "Block" : "Word"), 1200);
}

function toggleWordOverlay() {
  S.showWordBoxes = !S.showWordBoxes;
  var b = el("btnOverlayWords");
  if(b) b.classList.toggle("active", S.showWordBoxes);
  repositionOverlay();
}

function toggleTextOverlay() {
  S.textOverlay = !S.textOverlay;
  var o = el("ocr-overlay");
  if(o) o.classList.toggle("overlay-text-on", S.textOverlay);
  var b = el("btnOverlayText");
  if(b) b.classList.toggle("active", S.textOverlay);
}

/* ----------------------------- manifest ------------------------------ */
async function loadManifest() {
  var url = getManifestUrl();
  if(!url){ toast("Please enter a manifest URL."); return; }

  toast("Loading…", 0);
  el("thumbList").innerHTML = skel(4);
  el("facsPage").innerHTML = "<div class='empty-state'>Run OCR to build the facsimile edition.</div>";
  el("metaPanel").innerHTML = "<div class='empty-state'>Loading…</div>";

  try {
    S.manifest = await apiFetch("/api/manifest?url=" + encodeURIComponent(url));
    S.currentPage = 1;
    S.ocrCache = {};
    S.selectedBlocks.clear();
    S.selectedWords.clear();

    el("viewerTitle").textContent = S.manifest.title || url;

    autoSetLang(S.manifest);
    renderMeta(S.manifest);
    renderThumbs(S.manifest.pages);

    await loadAnnotations();
    await loadPage(1);

    toast("", 0);
  } catch(err) {
    toast("Error: " + err.message);
    el("thumbList").innerHTML = "<div class='empty-state'><strong>Error</strong> "+esc(err.message)+"</div>";
  }
}

/* ------------------------------- pages -------------------------------- */
async function loadPage(num) {
  if(!S.manifest) return;

  S.currentPage = num;
  var page = (S.manifest.pages||[])[num-1];
  if(!page) return;

  el("pageNum").textContent = num + " / " + S.manifest.total_pages;

  document.querySelectorAll(".thumb-card").forEach(function(c,i){
    c.classList.toggle("active", i === num-1);
  });
  var act = document.querySelector(".thumb-card.active");
  if(act) act.scrollIntoView({block:"nearest"});

  clearOverlay();
  setStatus("");
  S.selectedBlocks.clear();
  S.selectedWords.clear();
  renderAnalysis("");

  S.scale = 1; S.tx = 0; S.ty = 0;

  var vp = el("viewport");
  if(page.image) {
    vp.innerHTML = "<img id='pageImg' src='"+esc(page.image)+"' style='position:absolute;top:0;left:0;user-select:none' draggable='false'>";
    var img = el("pageImg");
    img.addEventListener("load", function(){ zoomHome(); repositionOverlay(); }, {once:true});
    img.addEventListener("dragstart", function(e){ e.preventDefault(); });
  } else {
    vp.innerHTML = "<div style='color:#888;padding:40px;text-align:center'>No image.</div>";
  }

  if(S.ocrCache[num]) {
    renderFacsimile(S.ocrCache[num]);
    setTimeout(function(){ repositionOverlay(); applyAnnotationStyles(); }, 150);
  } else {
    el("facsPage").innerHTML = "<div class='empty-state'>Click ▶ OCR to build the facsimile.</div>";
    el("textWc").textContent = "";
  }
}

/* ------------------------------- OCR ---------------------------------- */
async function runOcr(num) {
  if(!S.manifest){ toast("Load a manifest first."); return; }

  var page = (S.manifest.pages||[])[num-1];
  if(!page || !page.image){ toast("No image for this page."); return; }

  if(S.ocrCache[num]) {
    renderFacsimile(S.ocrCache[num]);
    repositionOverlay();
    applyAnnotationStyles();
    return;
  }

  var lang = getLang();
  setStatus("Tesseract ["+lang+"]…", true);

  var card = document.querySelector(".thumb-card[data-page='"+num+"']");
  if(card) card.classList.add("running");

  try {
    var result = await apiFetch("/api/ocr", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({image_url: page.image, lang: lang})
    });

    S.ocrCache[num] = result;
    updateThumbStatus(num, "done");

    if(result.lang_used) syncLangSelector(result.lang_used);

    setStatus("Done — " + (result.blocks||[]).length + " blocks · lang: " + (result.lang_used||lang), false);

    renderFacsimile(result);
    repositionOverlay();
    applyAnnotationStyles();
  } catch(err) {
    updateThumbStatus(num, "");
    setStatus("", false);
    toast("OCR error: " + err.message);
  }
}

function ocrAllPages() {
  if(!S.manifest){ toast("Load a manifest first."); return; }

  var murl = getManifestUrl();
  var lang = getLang();
  var total = S.manifest.total_pages;

  var btn = el("btnOcrAll");
  if(btn){ btn.disabled=true; btn.textContent="⏳"; }

  toast("OCR started for " + total + " pages ["+lang+"]…", 0);

  var es = new EventSource("/api/ocr/all?manifest_url="+encodeURIComponent(murl)+"&lang="+encodeURIComponent(lang));

  es.onmessage = function(e){
    var data;
    try { data = JSON.parse(e.data); } catch(_) { return; }

    if(data.status === "complete") {
      es.close();
      if(btn){ btn.disabled=false; btn.textContent="▶▶ All"; }
      toast("All pages done.", 2500);
      setStatus("", false);
      if(S.ocrCache[S.currentPage]) { repositionOverlay(); applyAnnotationStyles(); }
      return;
    }

    if(data.status === "running") {
      updateThumbStatus(data.page, "running");
      S._ocrStartTime = Date.now();
      setStatus("Tesseract · page "+data.page+"/"+total+" ["+lang+"]…", true);
      return;
    }

    if(data.status === "done") {
      S.ocrCache[data.page] = data.result;
      updateThumbStatus(data.page, "done");
      if(data.page === S.currentPage) {
        renderFacsimile(data.result);
        repositionOverlay();
        applyAnnotationStyles();
      }
      return;
    }

    if(data.status === "error") {
      updateThumbStatus(data.page, "");
    }
  };

  es.onerror = function(){
    es.close();
    if(btn){ btn.disabled=false; btn.textContent="▶▶ All"; }
    setStatus("", false);
    toast("Connection lost.");
  };
}

/* --------------------------- facsimile view --------------------------- */
var FACS_FONT = {
  "heading":      { size: 11, weight: "700", transform: "none" },
  "title":        { size: 11, weight: "700", transform: "none" },
  "text":         { size: 11, weight: "400", transform: "none" },
  "caption":      { size: 11, weight: "400", transform: "none" },
  "footer":       { size: 11, weight: "400", transform: "none" },
  "list":         { size: 11, weight: "400", transform: "none" },
  "table":        { size: 11, weight: "400", transform: "none" },
  "illustration": { size: 11, weight: "400", transform: "none" }
};

function renderFacsimile(result) {
  var blocks = result.blocks || [];
  var pw = result.page_width || 1000;
  var ph = result.page_height || 1400;

  var canvas = el("facsCanvas");
  var page = el("facsPage");
  var wc = el("textWc");
  if(!canvas || !page) return;

  if(!blocks.length) {
    page.innerHTML = "<div class='empty-state'>No text blocks detected.</div>";
    if(wc) wc.textContent = "";
    return;
  }

  var cw = (canvas.offsetWidth || 640) - 32;
  var scale = cw / pw;
  var dw = Math.round(pw * scale);
  var dh = Math.round(ph * scale);

  page.style.width = dw + "px";
  page.style.height = dh + "px";

  var html = "";
  var wcount = 0;

  for(var i=0;i<blocks.length;i++){
    var b = blocks[i];
    var type = b.type || "text";
    var text = String(b.text || "").trim();

    if(!text && type !== "illustration") continue;

    var l = Math.round(b.x1 * dw);
    var t = Math.round(b.y1 * dh);
    var w = Math.max(4, Math.round((b.x2 - b.x1) * dw));
    var h = Math.max(4, Math.round((b.y2 - b.y1) * dh));

    if(text) wcount += text.split(/\s+/).filter(Boolean).length;

    var fspec = FACS_FONT[type] || FACS_FONT.text;
    var fs = Math.round(fspec.size * scale * (pw/800));
    fs = Math.max(7, Math.min(fs, 36));

    html += "<div class='facs-block type-"+esc(type)+"' data-index='"+i+"'"
      + " style='left:"+l+"px;top:"+t+"px;width:"+w+"px;height:"+h+"px;"
      + "font-size:"+fs+"px;font-weight:"+fspec.weight+";text-transform:"+fspec.transform+";'>"
      + (type==="illustration" ? "[illustration]" : esc(text))
      + "</div>";
  }

  page.innerHTML = html;
  if(wc) wc.textContent = wcount + " words";

  page.querySelectorAll(".facs-block").forEach(function(div){
    div.addEventListener("click", function(){
      var idx = parseInt(div.dataset.index, 10);
      toggleBlockSelection(idx);
    });
    div.addEventListener("contextmenu", function(e){
      e.preventDefault();
      var idx = parseInt(div.dataset.index, 10);
      var r = S.ocrCache[S.currentPage];
      if(!r || !r.blocks || !r.blocks[idx]) return;
      saveBlockAnnotation(r.blocks[idx], { comment: "Block annotation" })
        .then(function(){ toast("Saved block annotation.", 1400); repositionOverlay(); })
        .catch(function(err){ toast("Save failed: "+err.message, 2200); });
    });
  });

  updateBlockHighlights();
}

/* ----------------------------- selection ------------------------------ */
function toggleBlockSelection(idx) {
  if(S.selectedBlocks.has(idx)) S.selectedBlocks.delete(idx);
  else S.selectedBlocks.add(idx);
  updateBlockHighlights();
  renderAnalysis(el("analysisSearch") ? el("analysisSearch").value : "");
}

function toggleWordSelection(wordId) {
  if(!wordId) return;
  if(S.selectedWords.has(wordId)) S.selectedWords.delete(wordId);
  else S.selectedWords.add(wordId);
  updateWordHighlights();
}

function clearSelection() {
  S.selectedBlocks.clear();
  S.selectedWords.clear();
  updateBlockHighlights();
  updateWordHighlights();
  renderAnalysis("");
}

function selectAllTextBlocks() {
  var r = S.ocrCache[S.currentPage];
  if(!r) return;
  var blocks = r.blocks || [];
  for(var i=0;i<blocks.length;i++){
    var t = blocks[i].type || "text";
    if(t==="text" || t==="heading" || t==="caption") S.selectedBlocks.add(i);
  }
  updateBlockHighlights();
  renderAnalysis(el("analysisSearch") ? el("analysisSearch").value : "");
}

/* ----------------------------- highlights ----------------------------- */
function updateBlockHighlights() {
  // overlay blocks
  document.querySelectorAll(".ocr-block").forEach(function(d){
    var i = parseInt(d.dataset.index, 10);
    var on = S.selectedBlocks.has(i);

    d.style.background = on ? "rgba(196,146,42,.35)" : "";
    d.style.borderColor = on ? "var(--gold)" : "";
    d.style.borderWidth = on ? "2px" : "";

    // annotated cue
    var bid = d.dataset.blockId || "";
    if(!on && bid && S.annIndex.block.has(bid)) {
      d.style.borderColor = "rgba(196,146,42,.85)";
      d.style.borderWidth = "2px";
    }
  });

  // facsimile blocks
  document.querySelectorAll(".facs-block").forEach(function(d){
    var i = parseInt(d.dataset.index, 10);
    d.classList.toggle("selected", S.selectedBlocks.has(i));
  });

  var sc = el("selCount");
  if(sc) {
    if(S.selectedBlocks.size===0 && S.selectedWords.size===0) sc.textContent = "No selection";
    else {
      var s1 = S.selectedBlocks.size + " block" + (S.selectedBlocks.size===1 ? "" : "s");
      var s2 = S.selectedWords.size ? (" · " + S.selectedWords.size + " word" + (S.selectedWords.size===1 ? "" : "s")) : "";
      sc.textContent = s1 + s2;
    }
  }
}

function updateWordHighlights() {
  var overlay = el("ocr-overlay");
  if(!overlay) return;
  overlay.querySelectorAll(".ocr-word").forEach(function(w){
    var id = w.dataset.wordId || "";
    var selected = id && S.selectedWords.has(id);
    var annotated = id && S.annIndex.word.has(id);
    w.classList.toggle("selected", !!selected || !!annotated);
  });
}

/* ----------------------------- analysis ------------------------------- */
function renderAnalysis(query) {
  var body = el("analysisBody"); if(!body) return;

  var r = S.ocrCache[S.currentPage];
  if(!r || (S.selectedBlocks.size===0 && S.selectedWords.size===0)) {
    body.innerHTML =
      "<div class='empty-state'><strong>Select blocks or words</strong>"
      + "Left-click selects. Right-click saves an annotation.</div>";
    return;
  }

  query = String(query || "").trim();
  var pat = null;
  if(query) pat = new RegExp("(" + escapeRegExp(query) + ")", "gi");

  var blocks = r.blocks || [];
  var html = "";

  if(S.selectedBlocks.size) {
    html += "<div style='padding:8px 12px;font-size:10px;color:var(--ink3);letter-spacing:.08em;text-transform:uppercase'>Selected blocks</div>";

    S.selectedBlocks.forEach(function(idx){
      var b = blocks[idx]; if(!b) return;
      var text = String(b.text || "").trim();
      if(!text) return;

      var safe = esc(text);
      if(pat) safe = safe.replace(pat, "<mark>$1</mark>");

      var hasAnn = b.block_id && S.annIndex.block.has(b.block_id);

      html += "<div class='sel-block' data-index='"+idx+"'>"
        + "<div class='sel-type'>" + esc(b.type||"text") + " · block " + idx + (hasAnn ? " · annotated" : "") + "</div>"
        + "<div class='sel-text'>" + safe + "</div>"
        + "<div style='display:flex;gap:6px;margin-top:6px'>"
          + "<button class='btn ghost' data-save-block='"+idx+"' style='font-size:11px;padding:3px 8px'>Save annotation</button>"
        + "</div>"
        + "<span class='sel-remove' data-idx='"+idx+"'>✕</span>"
        + "</div>";
    });
  }

  if(S.selectedWords.size) {
    html += "<div style='padding:8px 12px;font-size:10px;color:var(--ink3);letter-spacing:.08em;text-transform:uppercase'>Selected words</div>";

    S.selectedWords.forEach(function(wid){
      html += "<div class='sel-block'>"
        + "<div class='sel-type'>word · " + esc(wid) + "</div>"
        + "<div class='sel-text' style='font-family:var(--mono);font-size:11px'>" + esc(wid) + "</div>"
        + "<div style='display:flex;gap:6px;margin-top:6px'>"
          + "<button class='btn ghost' data-save-word='"+esc(wid)+"' style='font-size:11px;padding:3px 8px'>Save annotation</button>"
          + "<button class='btn ghost' data-remove-word='"+esc(wid)+"' style='font-size:11px;padding:3px 8px;color:var(--red)'>Remove</button>"
        + "</div>"
        + "</div>";
    });
  }

  body.innerHTML = html;

  // remove blocks
  body.querySelectorAll(".sel-remove").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      S.selectedBlocks.delete(parseInt(btn.dataset.idx, 10));
      updateBlockHighlights();
      renderAnalysis(query);
    });
  });

  // save block annotations
  body.querySelectorAll("[data-save-block]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var idx = parseInt(btn.getAttribute("data-save-block"), 10);
      var rr = S.ocrCache[S.currentPage];
      if(!rr || !rr.blocks || !rr.blocks[idx]) return;
      saveBlockAnnotation(rr.blocks[idx], { comment: "Block annotation" })
        .then(function(){ toast("Saved block annotation.", 1400); repositionOverlay(); })
        .catch(function(err){ toast("Save failed: "+err.message, 2200); });
    });
  });

  // save word annotations
  body.querySelectorAll("[data-save-word]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var wid = btn.getAttribute("data-save-word");
      var rr = S.ocrCache[S.currentPage];
      if(!rr || !rr.blocks) return;

      var found = null, foundBlock = null;
      for(var i=0;i<rr.blocks.length;i++){
        var b = rr.blocks[i];
        if(!b || !Array.isArray(b.words)) continue;
        for(var j=0;j<b.words.length;j++){
          if(b.words[j].word_id === wid) { found = b.words[j]; foundBlock = b; break; }
        }
        if(found) break;
      }

      if(!found) { toast("Word not found in OCR result (backend not updated?).", 2200); return; }

      saveWordAnnotation(found, foundBlock, { comment: "Word annotation" })
        .then(function(){ toast("Saved word annotation.", 1400); repositionOverlay(); })
        .catch(function(err){ toast("Save failed: "+err.message, 2200); });
    });
  });

  // remove words
  body.querySelectorAll("[data-remove-word]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var wid = btn.getAttribute("data-remove-word");
      S.selectedWords.delete(wid);
      updateWordHighlights();
      updateBlockHighlights();
      renderAnalysis(query);
    });
  });
}

/* --------------------------- overlay drawing -------------------------- */
function clearOverlay(){
  var o = el("ocr-overlay");
  if(o){
    o.innerHTML = "";
    o.classList.remove("overlay-text-on");
  }
}

function repositionOverlay() {
  var r = S.ocrCache[S.currentPage];
  if(!r) return;

  var blocks = r.blocks || [];
  var overlay = el("ocr-overlay");
  var img = el("pageImg");
  if(!overlay || !img || !blocks.length) return;

  var iw = img.naturalWidth, ih = img.naturalHeight;
  if(!iw || !ih) return;

  overlay.innerHTML = "";

  for(var i=0;i<blocks.length;i++){
    var b = blocks[i];

    var left = Math.round(S.tx + b.x1*iw*S.scale);
    var top  = Math.round(S.ty + b.y1*ih*S.scale);
    var w    = Math.max(2, Math.round((b.x2-b.x1)*iw*S.scale));
    var h    = Math.max(2, Math.round((b.y2-b.y1)*ih*S.scale));

    var div = document.createElement("div");
    div.className = "ocr-block";
    div.dataset.type = b.type || "text";
    div.dataset.index = String(i);
    div.dataset.blockId = b.block_id || "";
    div.style.cssText = "left:"+left+"px;top:"+top+"px;width:"+w+"px;height:"+h+"px";

    if(b.text){
      var tip = document.createElement("div");
      tip.className = "ocr-tooltip";
      tip.textContent = b.text;
      div.appendChild(tip);

      var span = document.createElement("span");
      span.className = "ocr-text";
      span.textContent = b.text;
      span.style.fontSize = Math.max(8, Math.min(h*0.75, 18)) + "px";
      div.appendChild(span);
    }

    div.addEventListener("click", (function(idx){
      return function(e){
        e.stopPropagation();
        if(S.selectMode === "block") toggleBlockSelection(idx);
        else toast("Word mode: click a word box.", 1100);
      };
    })(i));

    div.addEventListener("contextmenu", (function(block){
      return function(e){
        e.preventDefault();
        saveBlockAnnotation(block, { comment: "Block annotation" })
          .then(function(){ toast("Saved block annotation.", 1400); repositionOverlay(); })
          .catch(function(err){ toast("Save failed: "+err.message, 2200); });
      };
    })(b));

    overlay.appendChild(div);

    // optional word boxes
    if(S.showWordBoxes && Array.isArray(b.words)){
      for(var j=0;j<b.words.length;j++){
        var word = b.words[j];
        if(!word) continue;

        var wl = Math.round(S.tx + word.x1*iw*S.scale);
        var wt = Math.round(S.ty + word.y1*ih*S.scale);
        var ww = Math.max(1, Math.round((word.x2-word.x1)*iw*S.scale));
        var wh = Math.max(1, Math.round((word.y2-word.y1)*ih*S.scale));
        if(ww < 2 || wh < 2) continue;

        var wdiv = document.createElement("div");
        wdiv.className = "ocr-word";
        wdiv.dataset.wordId = word.word_id || "";
        wdiv.dataset.blockId = b.block_id || "";
        wdiv.title = String(word.text || "").trim();
        wdiv.style.cssText = "left:"+wl+"px;top:"+wt+"px;width:"+ww+"px;height:"+wh+"px";

        wdiv.addEventListener("click", (function(wordObj){
          return function(e){
            e.stopPropagation();
            if(S.selectMode !== "word") { toast("Block mode: click the block.", 1100); return; }
            toggleWordSelection(wordObj.word_id);
            renderAnalysis(el("analysisSearch") ? el("analysisSearch").value : "");
          };
        })(word));

        wdiv.addEventListener("contextmenu", (function(wordObj, blockObj){
          return function(e){
            e.preventDefault();
            saveWordAnnotation(wordObj, blockObj, { comment: "Word annotation" })
              .then(function(){ toast("Saved word annotation.", 1400); repositionOverlay(); })
              .catch(function(err){ toast("Save failed: "+err.message, 2200); });
          };
        })(word, b));

        overlay.appendChild(wdiv);
      }
    }
  }

  if(S.textOverlay) overlay.classList.add("overlay-text-on");
  updateBlockHighlights();
  updateWordHighlights();
}

/* --------------------------- progress bar ---------------------------- */
function setStatus(msg, loading) {
  var bar = el("ocrStatusBar"); if(!bar) return;
  bar.style.display = msg ? "flex" : "none";

  if(!msg){
    if(S._ocrTimer) clearInterval(S._ocrTimer);
    S._ocrStartTime = 0;
    bar.innerHTML = "";
    return;
  }

  if(loading && !S._ocrStartTime){
    S._ocrStartTime = Date.now();
    if(S._ocrTimer) clearInterval(S._ocrTimer);
    S._ocrTimer = setInterval(function(){ _updateBar(msg); }, 300);
    _updateBar(msg);
  }

  if(!loading){
    if(S._ocrStartTime){
      var actual = (Date.now()-S._ocrStartTime)/1000;
      S._ocrTimes.push(actual);
      if(S._ocrTimes.length > 5) S._ocrTimes.shift();
      var sum = 0;
      for(var i=0;i<S._ocrTimes.length;i++) sum += S._ocrTimes[i];
      S._ocrEstimate = sum / S._ocrTimes.length;
    }
    if(S._ocrTimer) clearInterval(S._ocrTimer);
    S._ocrStartTime = 0;
    bar.innerHTML = "<span style='color:var(--gold)'>✓</span> <span>"+esc(msg)+"</span>";
  }
}

function _updateBar(msg) {
  var bar = el("ocrStatusBar"); if(!bar || !S._ocrStartTime) return;
  var elapsed = (Date.now()-S._ocrStartTime)/1000;
  var pct = Math.min(90, Math.round(elapsed/S._ocrEstimate*100));
  var rem = Math.max(0, S._ocrEstimate - elapsed);
  var remStr = (rem>5) ? ("~"+Math.round(rem)+"s remaining") : "finishing…";

  bar.innerHTML =
    "<div class='spinner-sm'></div>"
    + "<div style='flex:1;display:flex;flex-direction:column;gap:3px'>"
      + "<span style='font-size:10px'>"+esc(msg)+" — "+elapsed.toFixed(0)+"s / "+remStr+"</span>"
      + "<div style='background:#2e2a24;border-radius:3px;height:4px'>"
        + "<div style='background:var(--gold);height:4px;border-radius:3px;width:"+pct+"%;transition:width .3s'></div>"
      + "</div>"
    + "</div>";
}

/* ------------------------------ view mode ---------------------------- */
function setView(mode){
  var sv = el("splitView");
  if(!sv) return;
  sv.className = "split-view" + (mode==="both" ? "" : (" view-" + mode));
  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){
    b.classList.toggle("active", b.dataset.view === mode);
  });
}

/* ------------------------------- pan/zoom ---------------------------- */
function initPanZoom(){
  var vp = el("viewport"); if(!vp) return;

  vp.addEventListener("wheel", function(e){
    e.preventDefault();
    var f = (e.deltaY < 0) ? 1.12 : 0.89;

    var wrap = el("vpwrap") || vp;
    var r = wrap.getBoundingClientRect();

    S.tx = (e.clientX - r.left) + (S.tx - (e.clientX - r.left)) * f;
    S.ty = (e.clientY - r.top)  + (S.ty - (e.clientY - r.top)) * f;
    S.scale *= f;

    applyTransform();
    repositionOverlay();
  }, {passive:false});

  vp.addEventListener("mousedown", function(e){
    if(e.button !== 0) return;
    S.dragging = true;
    S.dragStartX = e.clientX;
    S.dragStartY = e.clientY;
    S.dragTx = S.tx;
    S.dragTy = S.ty;
    vp.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", function(e){
    if(!S.dragging) return;
    S.tx = S.dragTx + (e.clientX - S.dragStartX);
    S.ty = S.dragTy + (e.clientY - S.dragStartY);
    applyTransform();
    repositionOverlay();
  });

  window.addEventListener("mouseup", function(){
    S.dragging = false;
    var v = el("viewport");
    if(v) v.style.cursor = "grab";
  });
}

function applyTransform(){
  var img = el("pageImg"); if(!img) return;
  img.style.transform = "translate("+S.tx+"px,"+S.ty+"px) scale("+S.scale+")";
  img.style.transformOrigin = "0 0";
}

function zoom(f){
  var wrap = el("vpwrap") || el("viewport"); if(!wrap) return;
  S.tx = wrap.offsetWidth/2 + (S.tx - wrap.offsetWidth/2)*f;
  S.ty = wrap.offsetHeight/2 + (S.ty - wrap.offsetHeight/2)*f;
  S.scale *= f;
  applyTransform();
  repositionOverlay();
}

function zoomHome(){
  var img = el("pageImg");
  var wrap = el("vpwrap") || el("viewport");
  if(!img || !wrap) return;

  var iw = img.naturalWidth || 800;
  var ih = img.naturalHeight || 1000;
  var vw = wrap.offsetWidth;
  var vh = wrap.offsetHeight;

  S.scale = Math.min(vw/iw, vh/ih) * 0.95;
  S.tx = (vw - iw*S.scale)/2;
  S.ty = (vh - ih*S.scale)/2;

  applyTransform();
  repositionOverlay();
}

/* ----------------------------- thumbnails ---------------------------- */
function renderThumbs(pages){
  var list = el("thumbList");
  if(!list) return;

  if(!pages || !pages.length){
    list.innerHTML = "<div class='empty-state'>No pages.</div>";
    return;
  }

  var html = "";
  for(var i=0;i<pages.length;i++){
    var p = pages[i];
    html += "<div class='thumb-card "+(i===0?"active":"")+"' data-page='"+p.index+"'>"
      + (p.thumb ? ("<img src='"+esc(p.thumb)+"' alt='p"+p.index+"' loading='lazy'>")
                 : "<div class='thumb-placeholder'>📄</div>")
      + "<div class='thumb-label'>"+esc(p.label)+"</div>"
      + "<div class='thumb-bar'></div>"
      + "</div>";
  }
  list.innerHTML = html;

  document.querySelectorAll(".thumb-card").forEach(function(c){
    c.addEventListener("click", function(){ loadPage(parseInt(c.dataset.page, 10)); });
  });
}

function updateThumbStatus(num, status){
  var card = document.querySelector(".thumb-card[data-page='"+num+"']");
  if(!card) return;
  card.classList.remove("running","done");
  if(status) card.classList.add(status);
}

/* ------------------------------ metadata ----------------------------- */
function autoSetLang(manifest){
  var sel = el("langSelect"); if(!sel) return;
  var raw = String(manifest.language || "").toLowerCase().trim();

  if(!raw && manifest.metadata){
    var keys = ["Language","language","Sprache","langue"];
    for(var i=0;i<keys.length;i++){
      var k = keys[i];
      if(!raw && manifest.metadata[k]) raw = String(manifest.metadata[k]).toLowerCase().trim();
    }
  }
  if(!raw) return;

  var tess = LANG_MAP[raw] || raw;
  for(var j=0;j<sel.options.length;j++){
    if(sel.options[j].value === tess){ sel.selectedIndex = j; return; }
  }
  var opt = document.createElement("option");
  opt.value = tess;
  opt.textContent = tess;
  sel.appendChild(opt);
  sel.value = tess;
}

function renderMeta(data){
  var panel = el("metaPanel"); if(!panel) return;

  var meta = data.metadata || {};
  var rows = "";
  Object.keys(meta).forEach(function(k){
    rows += "<div class='meta-row'><span class='mk'>"+esc(k)+"</span><span class='mv'>"+esc(meta[k])+"</span></div>";
  });

  var allLinks = []
    .concat(Array.isArray(data.related)?data.related:(data.related?[data.related]:[]))
    .concat(Array.isArray(data.seeAlso)?data.seeAlso:(data.seeAlso?[data.seeAlso]:[]))
    .concat([{id:data.manifest_url,label:"IIIF manifest",format:"application/ld+json"}]);

  var linkRows = "";
  allLinks.filter(function(l){ return l && (l["@id"] || l.id); }).forEach(function(l){
    var href = l["@id"] || l.id || "#";
    var label = l.label || href.split("/").pop() || "Link";
    var fmt = String(l.format || l["@type"] || "");
    fmt = fmt ? fmt.split("/").pop().toUpperCase().slice(0,12) : "LINK";
    linkRows += "<a class='link-row' href='"+esc(href)+"' target='_blank' rel='noopener'>"
      + "<span class='link-badge'>"+esc(fmt)+"</span>"+esc(label)+"</a>";
  });

  panel.innerHTML =
    "<div class='item-header'>"
      + "<h2>"+esc(data.title)+"</h2>"
      + "<div class='item-badges'>"
        + "<span class='item-badge'>"+data.total_pages+" pages</span>"
        + (data.date ? "<span class='item-badge'>"+esc(data.date)+"</span>" : "")
        + (data.language ? "<span class='item-badge'>"+esc(data.language)+"</span>" : "")
      + "</div>"
    + "</div>"
    + "<div class='meta-section open'>"
      + "<div class='meta-section-head' onclick='toggleMetaSection(this)'>Metadata <span>▾</span></div>"
      + "<div class='meta-section-body'>"+rows+"</div>"
    + "</div>"
    + "<div class='meta-section open'>"
      + "<div class='meta-section-head' onclick='toggleMetaSection(this)'>Links <span>▾</span></div>"
      + "<div class='meta-section-body'><div style='display:flex;flex-direction:column'>"
        + (linkRows || "<span style='color:var(--ink4);font-size:11px'>No links.</span>")
      + "</div></div>"
    + "</div>";
}

window.toggleMetaSection = function(h){
  h.closest(".meta-section").classList.toggle("open");
};

/* ------------------------------ navigation ---------------------------- */
function goPage(delta){
  if(!S.manifest) return;
  loadPage(Math.max(1, Math.min(S.manifest.total_pages, S.currentPage + delta)));
}

}());