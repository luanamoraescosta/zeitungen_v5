/* zeitungen.js — v6 */
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
  manifest: null, currentPage: 1,
  ocrCache: {},
  textOverlay: false, showWordBoxes: false,
  selectMode: "block",
  selectedBlocks: new Set(), selectedWords: new Set(),
  annotations: [],
  penMode: false, penDrawing: false, penPoints: [], penPaths: [],
  pendingPath: null, pendingPathEl: null,
  penClass: "A",
  scale: 1, tx: 0, ty: 0,
  dragging: false, dragStartX: 0, dragStartY: 0, dragTx: 0, dragTy: 0,
  _ocrTimes: [], _ocrEstimate: 60, _ocrStartTime: 0, _ocrTimer: null,
};

/* ── Boot ───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  on("btnLoad",        "click", loadManifest);
  on("btnOcr",         "click", function(){ runOcr(S.currentPage, false); });
  on("btnRerun",       "click", function(){ runOcr(S.currentPage, true); });
  on("btnOcrAll",      "click", ocrAllPages);
  on("btnOverlayText", "click", toggleTextOverlay);
  on("btnOverlayWords","click", toggleWordOverlay);
  on("btnSelectMode",  "click", toggleSelectMode);
  on("btnPenMode",     "click", togglePenMode);
  on("btnPrev",        "click", function(){ goPage(-1); });
  on("btnNext",        "click", function(){ goPage(1); });
  on("btnZoomIn",      "click", function(){ zoom(1.4); });
  on("btnZoomOut",     "click", function(){ zoom(0.7); });
  on("btnZoomHome",    "click", zoomHome);
  on("manifestUrl",    "keydown", function(e){ if(e.key==="Enter") loadManifest(); });
  on("btnSelAll",      "click", selectAllTextBlocks);
  on("btnClearSel",    "click", clearSelection);
  on("analysisSearch", "input",  function(){ renderAnalysis(this.value); renderFacsHighlight(this.value); });
  on("btnExportAnnotations", "click", exportAnnotations);
  on("importAnnotations",    "change", importAnnotations);
  on("btnPenSave",     "click", savePenAnnotation);
  on("btnPenCancel",   "click", discardPenAnnotation);
  on("modalOverlay",   "click", discardPenAnnotation);

  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){
    b.addEventListener("click", function(){ setView(b.dataset.view); });
  });
  document.querySelectorAll(".side-tab").forEach(function(b){
    b.addEventListener("click", function(){ setSideTab(b.dataset.tab); });
  });
  document.querySelectorAll(".class-pill").forEach(function(p){
    p.addEventListener("click", function(){
      document.querySelectorAll(".class-pill").forEach(function(x){ x.classList.remove("active"); });
      p.classList.add("active"); S.penClass = p.dataset.cls;
    });
  });

  initPanZoom();
  initPenLayer();
  checkModelStatus();
});

/* ── Utils ──────────────────────────────────────────────────────── */
function el(i)         { return document.getElementById(i); }
function on(i,ev,fn)   { var e=el(i); if(e) e.addEventListener(ev,fn); }
function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
var _tt;
function toast(msg,dur){
  if(dur===undefined) dur=2800;
  var t=el("toast"); if(!t) return;
  t.textContent=msg; t.classList.toggle("show",!!msg);
  clearTimeout(_tt); if(msg&&dur>0) _tt=setTimeout(function(){t.classList.remove("show");},dur);
}
function skel(n){
  var h="<div style='padding:12px'>"; n=n||6;
  for(var i=0;i<n;i++) h+="<div class='skeleton-line' style='width:"+(45+Math.random()*50)+"%'></div>";
  return h+"</div>";
}
async function apiFetch(path,opts){
  var r=await fetch(path,opts||{});
  if(!r.ok) throw new Error("HTTP "+r.status+": "+(await r.text()).slice(0,200));
  return r.json();
}
function getLang(){ var s=el("langSelect"); return s?s.value:"deu_frak+deu"; }

/* ── Model status ───────────────────────────────────────────────── */
async function checkModelStatus(){
  try {
    var s=await apiFetch("/api/ocr/status");
    var b=el("modelBadge"); if(!b) return;
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
  } catch(_){ S.annotations = []; }
}

async function postAnnotation(payload){
  var murl = getManifestUrl(); if(!murl) return null;
  try {
    var out = await apiFetch("/api/annotations",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(Object.assign({manifest_url:murl, page:S.currentPage}, payload)),
    });
    S.annotations.push(out);
    renderAnnotationsTab();
    toast("Annotation saved ✓");
    return out;
  } catch(e){ toast("Could not save: "+e.message); return null; }
}

function getManifestUrl(){ return (el("manifestUrl").value||"").trim(); }

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
      toast("Imported "+list.length+" annotations ✓");
    } catch(err){ toast("Invalid JSON file: "+err.message); }
  };
  reader.readAsText(file);
  this.value = "";
}

function exportAnnotations(){
  var murl = getManifestUrl();
  var out  = { manifest_url: murl, exported_at: new Date().toISOString(), annotations: S.annotations };
  var blob = new Blob([JSON.stringify(out, null, 2)], {type:"application/json"});
  var a    = document.createElement("a");
  a.href   = URL.createObjectURL(blob);
  a.download = "annotations.json"; a.click();
  toast("Exported "+S.annotations.length+" annotations");
}

function renderAnnotationsTab(){
  var body = el("annotationsBody"); if(!body) return;
  if(!S.annotations.length){
    body.innerHTML="<div class='empty-state'><strong>No annotations</strong>Select blocks or use the ✏ pen tool.</div>";
    return;
  }
  var pageAnns = S.annotations.filter(function(a){ return !a.page || a.page===S.currentPage; });
  var html = "";
  S.annotations.forEach(function(a,i){
    var cls   = (a.body&&a.body.class)||"";
    var note  = (a.body&&a.body.note)||"";
    var ttype = a.target_type||"";
    var badge = cls ? "<span class='ann-class-badge ann-class-"+esc(cls)+"'>"+esc(cls)+"</span>" : "";
    var text  = note || (a.body&&a.body.text) || (ttype==="drawing"?"[drawing]":"");
    html += "<div class='ann-item'>"
          + "<div class='ann-type'>"+esc(ttype)+" · p"+esc(String(a.page||"?"))+badge+"</div>"
          + "<div class='ann-body'>"+esc(text.slice(0,120))+"</div>"
          + "</div>";
  });
  body.innerHTML = html;
}

/* ── Load manifest ──────────────────────────────────────────────── */
async function loadManifest(){
  var url = getManifestUrl(); if(!url){ toast("Please enter a manifest URL."); return; }
  toast("Loading…",0);
  el("thumbList").innerHTML = skel(4);
  el("facsPage").innerHTML  = "<div class='empty-state'>Run OCR to build the facsimile edition.</div>";
  el("metaPanel").innerHTML = "<div class='empty-state'>Loading…</div>";
  try {
    S.manifest    = await apiFetch("/api/manifest?url="+encodeURIComponent(url));
    S.currentPage = 1; S.ocrCache = {}; S.annotations = [];
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

/* ── Load page ──────────────────────────────────────────────────── */
async function loadPage(num){
  if(!S.manifest) return;
  S.currentPage = num;
  var page = (S.manifest.pages||[])[num-1]; if(!page) return;

  el("pageNum").textContent = num+" / "+S.manifest.total_pages;
  document.querySelectorAll(".thumb-card").forEach(function(c,i){ c.classList.toggle("active",i===num-1); });
  var act = document.querySelector(".thumb-card.active");
  if(act) act.scrollIntoView({block:"nearest"});

  clearOverlay(); clearPenLayer(); setStatus("");
  S.scale=1; S.tx=0; S.ty=0;
  S.selectedBlocks.clear(); S.selectedWords.clear();

  var vp = el("viewport");
  if(page.image){
    vp.innerHTML = "<img id='pageImg' src='"+esc(page.image)+"' style='position:absolute;top:0;left:0;user-select:none' draggable='false'>";
    var img = el("pageImg");
    img.addEventListener("load",function(){ zoomHome(); },  {once:true});
    img.addEventListener("dragstart",function(e){ e.preventDefault(); });
  } else {
    vp.innerHTML = "<div style='color:#666;padding:40px;text-align:center'>No image.</div>";
  }

  if(S.ocrCache[num]){
    renderFacsimile(S.ocrCache[num]);
    renderAnalysis("");
    setTimeout(function(){ repositionOverlay(); redrawPenPaths(); },400);
  } else {
    el("facsPage").innerHTML = "<div class='empty-state'>Click ▶ OCR to build the facsimile.</div>";
    el("textWc").textContent  = "";
  }
  renderAnnotationsTab();
}

/* ── Run OCR ────────────────────────────────────────────────────── */
async function runOcr(num, force){
  if(!S.manifest){ toast("Load a manifest first."); return; }
  var page = (S.manifest.pages||[])[num-1];
  if(!page||!page.image){ toast("No image for this page."); return; }

  if(S.ocrCache[num] && !force){
    renderFacsimile(S.ocrCache[num]);
    renderAnalysis("");
    repositionOverlay();
    return;
  }

  var lang = getLang();
  setStatus("Tesseract ["+lang+"]…", true);
  el("facsPage").innerHTML = skel(8);
  var card = document.querySelector(".thumb-card[data-page='"+num+"']");
  if(card) card.classList.add("running");

  try {
    var result = await apiFetch("/api/ocr",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({image_url:page.image, lang:lang, force:!!force}),
    });
    S.ocrCache[num] = result;
    updateThumbStatus(num,"done");
    var nb = (result.blocks||[]).length;
    setStatus("Done — "+nb+" blocks · "+( result.lang_used||lang),false);
    renderFacsimile(result);
    renderAnalysis("");
    repositionOverlay();
  } catch(err){
    updateThumbStatus(num,"");
    setStatus("",false);
    toast("OCR error: "+err.message);
    el("facsPage").innerHTML = "<div class='empty-state'><strong>Error</strong>"+esc(err.message)+"</div>";
  }
}

/* ── OCR all pages SSE ──────────────────────────────────────────── */
function ocrAllPages(){
  if(!S.manifest){ toast("Load a manifest first."); return; }
  var murl  = getManifestUrl();
  var lang  = getLang();
  var total = S.manifest.total_pages;
  var btn   = el("btnOcrAll");
  if(btn){ btn.disabled=true; btn.textContent="⏳"; }
  toast("OCR started for "+total+" pages…",0);

  var es = new EventSource("/api/ocr/all?manifest_url="+encodeURIComponent(murl)+"&lang="+encodeURIComponent(lang));
  es.onmessage = function(e){
    var data; try{ data=JSON.parse(e.data); }catch(_){ return; }
    var card = document.querySelector(".thumb-card[data-page='"+data.page+"']");

    if(data.status==="complete"){
      es.close();
      if(btn){ btn.disabled=false; btn.textContent="▶▶ All"; }
      toast("All pages done.",3000); setStatus("",false);
      if(S.ocrCache[S.currentPage]) repositionOverlay();
      return;
    }
    if(data.status==="running"){
      updateThumbStatus(data.page,"running");
      S._ocrStartTime = Date.now();
      setStatus("p"+data.page+"/"+total+" ["+lang+"]…",true);
      return;
    }
    if(data.status==="done"){
      S.ocrCache[data.page] = data.result;
      updateThumbStatus(data.page,"done");
      if(data.page===S.currentPage){
        renderFacsimile(data.result); renderAnalysis(""); repositionOverlay();
      }
      return;
    }
    if(data.status==="error") updateThumbStatus(data.page,"");
  };
  es.onerror = function(){
    es.close();
    if(btn){ btn.disabled=false; btn.textContent="▶▶ All"; }
    setStatus("",false); toast("Connection lost.");
  };
}

/* ── Facsimile ──────────────────────────────────────────────────── */
function renderFacsimile(result, highlight){
  var blocks  = result.blocks || [];
  var pw      = result.page_width  || 1000;
  var ph      = result.page_height || 1400;
  var canvas  = el("facsCanvas");
  var page    = el("facsPage");
  var wc      = el("textWc");
  if(!page||!canvas) return;

  if(!blocks.length){
    page.innerHTML="<div class='empty-state'>No blocks detected.</div>"; return;
  }
  var cw    = (canvas.offsetWidth||640)-32;
  var scale = cw/pw;
  var dw    = Math.round(pw*scale), dh = Math.round(ph*scale);
  page.style.width=dw+"px"; page.style.height=dh+"px";

  var pat   = highlight && highlight.trim() ? new RegExp("("+escRe(highlight.trim())+")","gi") : null;
  var fs    = Math.round(11*scale*(pw/800));
  fs        = Math.max(7,Math.min(fs,28));
  var html  = "", wcount = 0;

  blocks.forEach(function(b,idx){
    var l = Math.round(b.x1*dw), t = Math.round(b.y1*dh);
    var w = Math.max(4,Math.round((b.x2-b.x1)*dw));
    var h = Math.max(4,Math.round((b.y2-b.y1)*dh));
    var text = (b.text||"").trim();
    if(!text && b.type!=="illustration") return;
    wcount += text.split(/\s+/).filter(Boolean).length;

    var weight = (b.type==="heading"||b.type==="title") ? "600" : "400";
    var align  = text.length/(Math.max(1,Math.floor(w/(fs*0.55)))) > 0 ? "justify" : "center";
    var content = b.type==="illustration" ? "[illustration]"
                : pat ? esc(text).replace(pat,"<mark>$1</mark>") : esc(text);

    var isSel  = S.selectedBlocks.has(idx);
    html += "<div class='facs-block type-"+esc(b.type||"text")+(isSel?" selected":"")+"' data-index='"+idx+"'"
          + " style='left:"+l+"px;top:"+t+"px;width:"+w+"px;height:"+h+"px;"
          + "font-size:"+fs+"px;font-weight:"+weight+";text-align:"+align+";'>"
          + content
          + "</div>";
  });
  page.innerHTML = html;
  if(wc) wc.textContent = wcount+" words";

  page.querySelectorAll(".facs-block").forEach(function(div){
    div.addEventListener("click",function(e){
      e.stopPropagation();
      toggleBlockSelection(parseInt(div.dataset.index,10));
    });
  });
}

function renderFacsHighlight(query){
  var r = S.ocrCache[S.currentPage]; if(!r) return;
  renderFacsimile(r, query);
}

/* ── Selection ──────────────────────────────────────────────────── */
function toggleBlockSelection(idx){
  if(S.selectedBlocks.has(idx)) S.selectedBlocks.delete(idx);
  else S.selectedBlocks.add(idx);
  updateSelectionUI();
  renderAnalysis(el("analysisSearch").value||"");
}
function clearSelection(){
  S.selectedBlocks.clear(); S.selectedWords.clear();
  updateSelectionUI();
  renderAnalysis("");
}
function selectAllTextBlocks(){
  var r = S.ocrCache[S.currentPage]; if(!r) return;
  (r.blocks||[]).forEach(function(b,i){
    if(b.type==="text"||b.type==="heading"||b.type==="caption") S.selectedBlocks.add(i);
  });
  updateSelectionUI();
  renderAnalysis(el("analysisSearch").value||"");
}
function updateSelectionUI(){
  var n = S.selectedBlocks.size + S.selectedWords.size;
  var sc = el("selCount");
  if(sc) sc.textContent = n ? n+" block"+(n>1?"s":"")+" selected" : "No selection";
  /* Sync facs */
  document.querySelectorAll(".facs-block").forEach(function(d){
    d.classList.toggle("selected", S.selectedBlocks.has(parseInt(d.dataset.index,10)));
  });
  /* Sync overlay */
  document.querySelectorAll(".ocr-block").forEach(function(d){
    var on = S.selectedBlocks.has(parseInt(d.dataset.index,10));
    d.classList.toggle("selected", on);
  });
}

/* ── Analysis panel ─────────────────────────────────────────────── */
function renderAnalysis(query){
  var body = el("analysisBody"); if(!body) return;
  var r    = S.ocrCache[S.currentPage];
  if(!r || S.selectedBlocks.size===0){
    body.innerHTML="<div class='empty-state'><strong>Select blocks</strong>Click on the image overlay or facsimile blocks.</div>";
    return;
  }
  var pat = query&&query.trim() ? new RegExp("("+escRe(query.trim())+")","gi") : null;
  var blocks = r.blocks||[];
  var html = "";
  S.selectedBlocks.forEach(function(idx){
    var b = blocks[idx]; if(!b) return;
    var text = (b.text||"").trim(); if(!text) return;
    var highlighted = pat ? esc(text).replace(pat,"<mark>$1</mark>") : esc(text);
    html += "<div class='sel-block' data-index='"+idx+"'>"
          + "<div class='sel-type'>"+esc(b.type||"text")+" · block "+idx+"</div>"
          + "<div class='sel-text'>"+highlighted+"</div>"
          + "<button class='sel-remove' data-idx='"+idx+"'>×</button>"
          + "</div>";
  });
  body.innerHTML = html || "<div class='empty-state'>No text in selected blocks.</div>";
  body.querySelectorAll(".sel-remove").forEach(function(btn){
    btn.addEventListener("click",function(e){
      e.stopPropagation();
      S.selectedBlocks.delete(parseInt(btn.dataset.idx,10));
      updateSelectionUI(); renderAnalysis(query);
    });
  });
  body.querySelectorAll(".sel-block").forEach(function(div){
    div.addEventListener("click",function(){
      body.querySelectorAll(".sel-block").forEach(function(d){ d.classList.remove("active"); });
      div.classList.add("active");
    });
    /* Right-click to annotate */
    div.addEventListener("contextmenu",function(e){
      e.preventDefault();
      var idx = parseInt(div.dataset.index,10);
      var b   = blocks[idx]; if(!b) return;
      postAnnotation({
        target_type:"block", target:{block_id: b.block_id||String(idx)},
        body:{text:b.text, type:b.type},
      });
    });
  });
}

/* ── OCR Overlay ─────────────────────────────────────────────────── */
function clearOverlay(){
  var o=el("ocr-overlay"); if(o){ o.innerHTML=""; o.classList.remove("overlay-text-on"); }
}

function repositionOverlay(){
  var r = S.ocrCache[S.currentPage]; if(!r) return;
  var blocks  = r.blocks||[];
  var overlay = el("ocr-overlay");
  var img     = el("pageImg");
  if(!overlay||!img||!blocks.length) return;
  var iw=img.naturalWidth, ih=img.naturalHeight; if(!iw||!ih) return;

  overlay.innerHTML = "";
  blocks.forEach(function(block,idx){
    var left  = Math.round(S.tx + block.x1*iw*S.scale);
    var top   = Math.round(S.ty + block.y1*ih*S.scale);
    var width = Math.max(2,Math.round((block.x2-block.x1)*iw*S.scale));
    var height= Math.max(2,Math.round((block.y2-block.y1)*ih*S.scale));

    var div = document.createElement("div");
    div.className     = "ocr-block"+(S.selectedBlocks.has(idx)?" selected":"");
    div.dataset.type  = block.type||"text";
    div.dataset.index = idx;
    div.style.cssText = "left:"+left+"px;top:"+top+"px;width:"+width+"px;height:"+height+"px;";

    if(block.text){
      var tip = document.createElement("div"); tip.className="ocr-tooltip"; tip.textContent=block.text;
      div.appendChild(tip);
      var span = document.createElement("span"); span.className="ocr-text"; span.textContent=block.text;
      span.style.fontSize = Math.max(8,Math.min(height*.75,16))+"px";
      div.appendChild(span);
    }

    div.addEventListener("click",function(e){
      e.stopPropagation();
      if(S.penMode) return;
      if(S.selectMode==="block"){ toggleBlockSelection(idx); }
    });
    div.addEventListener("contextmenu",function(e){
      e.preventDefault();
      postAnnotation({
        target_type:"block", target:{block_id:block.block_id||String(idx)},
        body:{text:block.text, type:block.type},
      });
    });
    overlay.appendChild(div);

    /* Word boxes */
    if(S.showWordBoxes && block.words){
      block.words.forEach(function(w){
        var wl = Math.round(S.tx+w.x1*iw*S.scale);
        var wt = Math.round(S.ty+w.y1*ih*S.scale);
        var ww = Math.max(2,Math.round((w.x2-w.x1)*iw*S.scale));
        var wh = Math.max(2,Math.round((w.y2-w.y1)*ih*S.scale));
        var wd = document.createElement("div");
        wd.className = "ocr-word"+(S.selectedWords.has(w.word_id)?" selected":"");
        wd.dataset.wordId = w.word_id;
        wd.style.cssText  = "left:"+wl+"px;top:"+wt+"px;width:"+ww+"px;height:"+wh+"px;";
        var wt2 = document.createElement("div"); wt2.className="ocr-tooltip"; wt2.textContent=w.text+" ("+Math.round(w.conf)+"%)";
        wd.appendChild(wt2);
        wd.addEventListener("click",function(e){
          e.stopPropagation();
          if(S.selectMode==="word"){
            if(S.selectedWords.has(w.word_id)) S.selectedWords.delete(w.word_id);
            else S.selectedWords.add(w.word_id);
            updateSelectionUI();
          }
        });
        overlay.appendChild(wd);
      });
    }
  });

  if(S.textOverlay) overlay.classList.add("overlay-text-on");
}

/* ── Pen drawing ─────────────────────────────────────────────────── */
function initPenLayer(){
  var svg = el("pen-layer"); if(!svg) return;
  svg.addEventListener("mousedown",function(e){
    if(!S.penMode) return;
    e.stopPropagation();
    S.penDrawing = true;
    S.penPoints  = [];
    var pt = penPoint(e);
    S.penPoints.push(pt);
    /* Create live path */
    var path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("class","pen-path pen-path-class-"+S.penClass);
    path.setAttribute("d","M"+pt.x+" "+pt.y);
    svg.appendChild(path);
    S.pendingPathEl = path;
  });
  svg.addEventListener("mousemove",function(e){
    if(!S.penDrawing || !S.pendingPathEl) return;
    var pt = penPoint(e);
    S.penPoints.push(pt);
    var d = "M";
    S.penPoints.forEach(function(p,i){ d += (i===0?"":i===1?"L":"L")+p.x+" "+p.y+" "; });
    S.pendingPathEl.setAttribute("d",d.trim());
  });
  svg.addEventListener("mouseup",function(e){
    if(!S.penDrawing || !S.pendingPathEl) return;
    S.penDrawing = false;
    if(S.penPoints.length < 3){ svg.removeChild(S.pendingPathEl); S.pendingPathEl=null; return; }
    showPenModal();
  });
}

function penPoint(e){
  var wrap = el("vpwrap");
  var r    = wrap.getBoundingClientRect();
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
  var vp = el("viewport"); if(vp) vp.style.cursor = S.penMode ? "crosshair" : "grab";
  toast(S.penMode ? "Pen mode ON — draw on the image" : "Pen mode OFF");
}

function showPenModal(){
  el("penNote").value = "";
  el("penModal").classList.add("show");
  el("modalOverlay").classList.add("show");
  el("penNote").focus();
}

async function savePenAnnotation(){
  if(!S.pendingPathEl) return;
  var note = (el("penNote").value||"").trim();
  var cls  = S.penClass;

  /* Store the SVG path string and normalise to image coords */
  var pathD = S.pendingPathEl.getAttribute("d");

  /* Mark as permanent */
  S.pendingPathEl.classList.add("permanent");
  S.penPaths.push({ el: S.pendingPathEl, d: pathD, cls: cls, note: note, page: S.currentPage });
  S.pendingPathEl = null;

  /* Save to backend */
  await postAnnotation({
    target_type:"drawing",
    target:{ svg_path: pathD },
    body:{ note: note, class: cls },
  });

  closePenModal();
}

function discardPenAnnotation(){
  if(S.pendingPathEl){
    var svg = el("pen-layer");
    if(svg && S.pendingPathEl.parentNode===svg) svg.removeChild(S.pendingPathEl);
    S.pendingPathEl = null;
  }
  closePenModal();
}

function closePenModal(){
  el("penModal").classList.remove("show");
  el("modalOverlay").classList.remove("show");
}

function clearPenLayer(){
  var svg = el("pen-layer"); if(!svg) return;
  /* Remove non-permanent paths (in-progress ones) */
  Array.from(svg.querySelectorAll("path:not(.permanent)")).forEach(function(p){ p.remove(); });
}

function redrawPenPaths(){
  /* Re-draw saved paths for current page */
  var svg = el("pen-layer"); if(!svg) return;
  /* Remove existing permanent paths */
  Array.from(svg.querySelectorAll("path.permanent")).forEach(function(p){ p.remove(); });
  S.penPaths.forEach(function(pp){
    if(pp.page !== S.currentPage) return;
    var path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("class","pen-path pen-path-class-"+pp.cls+" permanent");
    path.setAttribute("d",pp.d);
    path.title = pp.note || "";
    svg.appendChild(path);
  });
}

/* ── Toggle overlays ────────────────────────────────────────────── */
function toggleTextOverlay(){
  S.textOverlay = !S.textOverlay;
  var o=el("ocr-overlay"); if(o) o.classList.toggle("overlay-text-on",S.textOverlay);
  var b=el("btnOverlayText"); if(b) b.classList.toggle("active",S.textOverlay);
}
function toggleWordOverlay(){
  S.showWordBoxes = !S.showWordBoxes;
  var b=el("btnOverlayWords"); if(b) b.classList.toggle("active",S.showWordBoxes);
  repositionOverlay();
}
function toggleSelectMode(){
  S.selectMode = S.selectMode==="block" ? "word" : "block";
  var b = el("btnSelectMode"); if(b) b.textContent = S.selectMode==="block" ? "Block" : "Word";
  toast("Selection mode: "+S.selectMode);
}

/* ── Status bar ─────────────────────────────────────────────────── */
function setStatus(msg,loading){
  var bar=el("ocrStatusBar"); if(!bar) return;
  bar.style.display = msg?"flex":"none";
  if(!msg){ clearInterval(S._ocrTimer); S._ocrStartTime=0; bar.innerHTML=""; return; }
  if(loading&&!S._ocrStartTime){
    S._ocrStartTime=Date.now();
    clearInterval(S._ocrTimer);
    S._ocrTimer=setInterval(function(){ _updateBar(msg); },300);
    _updateBar(msg);
  }
  if(!loading){
    if(S._ocrStartTime){
      var actual=(Date.now()-S._ocrStartTime)/1000;
      S._ocrTimes.push(actual);
      if(S._ocrTimes.length>5) S._ocrTimes.shift();
      S._ocrEstimate=S._ocrTimes.reduce(function(a,b){return a+b;},0)/S._ocrTimes.length;
    }
    clearInterval(S._ocrTimer); S._ocrStartTime=0;
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
  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){ b.classList.toggle("active",b.dataset.view===mode); });
}
function setSideTab(tab){
  document.querySelectorAll(".side-tab").forEach(function(b){ b.classList.toggle("active",b.dataset.tab===tab); });
  document.querySelectorAll(".tab-content").forEach(function(d){ d.classList.remove("active"); });
  var tc = el("tab"+tab.charAt(0).toUpperCase()+tab.slice(1));
  if(tc) tc.classList.add("active");
}

/* ── Pan / zoom ─────────────────────────────────────────────────── */
function initPanZoom(){
  var vp=el("viewport"); if(!vp) return;
  vp.addEventListener("wheel",function(e){
    if(S.penMode) return;
    e.preventDefault();
    var f=e.deltaY<0?1.12:0.89;
    var wrap=el("vpwrap")||vp;
    var r=wrap.getBoundingClientRect();
    S.tx=(e.clientX-r.left)+(S.tx-(e.clientX-r.left))*f;
    S.ty=(e.clientY-r.top)+(S.ty-(e.clientY-r.top))*f;
    S.scale*=f; applyTransform(); repositionOverlay(); redrawPenPaths();
  },{passive:false});
  vp.addEventListener("mousedown",function(e){
    if(S.penMode||e.button!==0) return;
    S.dragging=true; S.dragStartX=e.clientX; S.dragStartY=e.clientY;
    S.dragTx=S.tx; S.dragTy=S.ty; vp.style.cursor="grabbing";
  });
  window.addEventListener("mousemove",function(e){
    if(!S.dragging) return;
    S.tx=S.dragTx+(e.clientX-S.dragStartX); S.ty=S.dragTy+(e.clientY-S.dragStartY);
    applyTransform(); repositionOverlay(); redrawPenPaths();
  });
  window.addEventListener("mouseup",function(){
    S.dragging=false; var v=el("viewport"); if(v&&!S.penMode) v.style.cursor="grab";
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
  S.scale*=f; applyTransform(); repositionOverlay(); redrawPenPaths();
}
function zoomHome(){
  var img=el("pageImg"), wrap=el("vpwrap")||el("viewport"); if(!img||!wrap) return;
  var iw=img.naturalWidth||800, ih=img.naturalHeight||1000;
  S.scale=Math.min(wrap.offsetWidth/iw,wrap.offsetHeight/ih)*0.95;
  S.tx=(wrap.offsetWidth-iw*S.scale)/2; S.ty=(wrap.offsetHeight-ih*S.scale)/2;
  applyTransform(); repositionOverlay(); redrawPenPaths();
}

/* ── Thumbnails ─────────────────────────────────────────────────── */
function renderThumbs(pages){
  var list=el("thumbList");
  if(!pages||!pages.length){ list.innerHTML="<div class='empty-state'>No pages.</div>"; return; }
  list.innerHTML=pages.map(function(p,i){
    return "<div class='thumb-card "+(i===0?"active":"")+"' data-page='"+p.index+"'>"
      +(p.thumb?"<img src='"+esc(p.thumb)+"' alt='p"+p.index+"' loading='lazy'>"
               :"<div class='thumb-placeholder'>📄</div>")
      +"<div class='thumb-label'>"+esc(p.label)+"</div>"
      +"<div class='thumb-bar'></div>"
      +"</div>";
  }).join("");
  document.querySelectorAll(".thumb-card").forEach(function(c){
    c.addEventListener("click",function(){ loadPage(parseInt(c.dataset.page,10)); });
  });
}
function updateThumbStatus(num,status){
  var card=document.querySelector(".thumb-card[data-page='"+num+"']"); if(!card) return;
  card.classList.remove("running","done");
  if(status) card.classList.add(status);
}

/* ── Metadata ───────────────────────────────────────────────────── */
function autoSetLang(manifest){
  var sel=el("langSelect"); if(!sel) return;
  var raw=(manifest.language||"").toLowerCase().trim();
  if(!raw&&manifest.metadata){
    ["Language","language","Sprache","langue"].forEach(function(k){
      if(!raw&&manifest.metadata[k]) raw=manifest.metadata[k].toLowerCase().trim();
    });
  }
  if(!raw) return;
  var tess=LANG_MAP[raw]||raw;
  for(var j=0;j<sel.options.length;j++){ if(sel.options[j].value===tess){ sel.selectedIndex=j; return; } }
  var opt=document.createElement("option"); opt.value=tess; opt.textContent=tess;
  sel.appendChild(opt); sel.value=tess;
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