/* zeitungen.js — clean rewrite */
(function () {
"use strict";

var LANG_MAP = {
  "de":"deu_frak+deu","deu":"deu_frak+deu","german":"deu_frak+deu","deutsch":"deu_frak+deu",
  "en":"eng","eng":"eng","english":"eng",
  "fr":"fra","fra":"fra","french":"fra",
  "nl":"nld","nld":"nld","dutch":"nld",
  "pt":"por","por":"por",
  "la":"lat","lat":"lat","latin":"lat",
  "cy":"cym","cym":"cym","welsh":"cym",
};

var S = {
  manifest: null, currentPage: 1,
  ocrCache: {}, textOverlay: false,
  selectedBlocks: new Set(),   /* Set of block indices */
  scale: 1, tx: 0, ty: 0,
  dragging: false, dragStartX:0, dragStartY:0, dragTx:0, dragTy:0,
  _ocrTimes: [], _ocrEstimate: 60, _ocrStartTime: 0, _ocrTimer: null,
};

/* ── boot ───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  on("btnLoad",        "click", loadManifest);
  on("btnOcr",         "click", function(){ runOcr(S.currentPage); });
  on("btnOcrAll",      "click", ocrAllPages);
  on("btnOverlayText", "click", toggleTextOverlay);
  on("btnPrev",        "click", function(){ goPage(-1); });
  on("btnNext",        "click", function(){ goPage(1); });
  on("btnZoomIn",      "click", function(){ zoom(1.4); });
  on("btnZoomOut",     "click", function(){ zoom(0.7); });
  on("btnZoomHome",    "click", zoomHome);
  on("manifestUrl",    "keydown", function(e){ if(e.key==="Enter") loadManifest(); });
  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){
    b.addEventListener("click", function(){ setView(b.dataset.view); });
  });
  initPanZoom();
  checkModelStatus();

  /* Side tabs */
  document.querySelectorAll(".side-tab").forEach(function(b){
    b.addEventListener("click", function(){
      document.querySelectorAll(".side-tab").forEach(function(x){ x.classList.remove("active"); });
      document.querySelectorAll(".tab-content").forEach(function(x){ x.classList.remove("active"); });
      b.classList.add("active");
      el("tab"+b.dataset.tab.charAt(0).toUpperCase()+b.dataset.tab.slice(1)).classList.add("active");
    });
  });

  /* Analysis search */
  on("analysisSearch", "input", function(){ filterAnalysis(this.value); });
  on("btnClearSel",    "click", clearSelection);
  on("btnSelAll",      "click", selectAllTextBlocks);
});

/* ── utils ──────────────────────────────────────────────────────── */
function el(i)         { return document.getElementById(i); }
function on(i,ev,fn)   { var e=el(i); if(e) e.addEventListener(ev,fn); }
function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
                       .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
var _tt;
function toast(msg,dur) {
  if(dur===undefined) dur=2800;
  var t=el("toast"); if(!t) return;
  t.textContent=msg; t.classList.toggle("show",!!msg);
  clearTimeout(_tt);
  if(msg&&dur>0) _tt=setTimeout(function(){t.classList.remove("show");},dur);
}
function skel(n) {
  var h="<div style='padding:12px'>"; n=n||6;
  for(var i=0;i<n;i++) h+="<div class='skeleton-line' style='width:"+(45+Math.random()*50)+"%'></div>";
  return h+"</div>";
}
async function apiFetch(path,opts) {
  var r=await fetch(path,opts||{});
  if(!r.ok) throw new Error("HTTP "+r.status+": "+(await r.text()).slice(0,200));
  return r.json();
}
function getLang()   { var s=el("langSelect");   return s?s.value:"deu_frak+deu"; }
function syncLangSelector(langUsed) {
  /* Update dropdown to reflect which lang Tesseract actually used */
  var sel=el("langSelect"); if(!sel) return;
  for(var i=0;i<sel.options.length;i++){
    if(sel.options[i].value===langUsed){ sel.selectedIndex=i; return; }
  }
  /* If not in list, add it */
  var opt=document.createElement("option");
  opt.value=langUsed; opt.textContent=langUsed;
  sel.appendChild(opt); sel.value=langUsed;
}

/* ── model status ───────────────────────────────────────────────── */
async function checkModelStatus() {
  try {
    var s=await apiFetch("/api/ocr/status");
    var b=el("modelBadge"); if(!b) return;
    b.textContent = s.ready ? "● Tesseract ready" : "○ Tesseract not detected";
    b.style.color = s.ready ? "#6aaa6a" : "#c4922a";
    if(s.ready && s.langs){
      var frak=s.langs.indexOf("deu_frak")>=0;
      b.textContent += frak ? " + Fraktur" : "";
      b.title = "Languages: "+s.langs.join(", ");
    }
  } catch(_){}
}

/* ── load manifest ──────────────────────────────────────────────── */
async function loadManifest() {
  var url=(el("manifestUrl").value||"").trim();
  if(!url){toast("Please enter a manifest URL.");return;}
  toast("Loading\u2026",0);
  el("thumbList").innerHTML=skel(4);
  el("facsPage").innerHTML="<div class='empty-state'>Run OCR to build the facsimile edition.</div>";
  el("metaPanel").innerHTML="<div class='empty-state'>Loading\u2026</div>";
  try {
    S.manifest=await apiFetch("/api/manifest?url="+encodeURIComponent(url));
    S.currentPage=1; S.ocrCache={};
    el("viewerTitle").textContent=S.manifest.title||url;
    autoSetLang(S.manifest);
    renderMeta(S.manifest);
    renderThumbs(S.manifest.pages);
    await loadPage(1);
    toast("");
  } catch(err) {
    toast("Error: "+err.message);
    el("thumbList").innerHTML="<div class='empty-state'><strong>Error</strong>"+esc(err.message)+"</div>";
  }
}

/* ── load page ──────────────────────────────────────────────────── */
async function loadPage(num) {
  if(!S.manifest) return;
  S.currentPage=num;
  var page=(S.manifest.pages||[])[num-1]; if(!page) return;
  el("pageNum").textContent=num+" / "+S.manifest.total_pages;
  document.querySelectorAll(".thumb-card").forEach(function(c,i){
    c.classList.toggle("active",i===num-1);
  });
  var act=document.querySelector(".thumb-card.active");
  if(act) act.scrollIntoView({block:"nearest"});
  clearOverlay(); setStatus(""); S.selectedBlocks.clear(); renderAnalysis();
  S.scale=1; S.tx=0; S.ty=0;
  var vp=el("viewport");
  if(page.image) {
    vp.innerHTML="<img id='pageImg' src='"+esc(page.image)+"' style='position:absolute;top:0;left:0;user-select:none' draggable='false'>";
    var img=el("pageImg");
    img.addEventListener("load",function(){zoomHome();},{once:true});
    img.addEventListener("dragstart",function(e){e.preventDefault();});
  } else {
    vp.innerHTML="<div style='color:#888;padding:40px;text-align:center'>No image.</div>";
  }
  if(S.ocrCache[num]) {
    renderFacsimile(S.ocrCache[num]);
    setTimeout(repositionOverlay,400);
  } else {
    el("facsPage").innerHTML="<div class='empty-state'>Click ▶ OCR to build the facsimile.</div>";
    el("textWc").textContent="";
  }
}

/* ── single OCR ─────────────────────────────────────────────────── */
async function runOcr(num) {
  if(!S.manifest){toast("Load a manifest first.");return;}
  var page=(S.manifest.pages||[])[num-1];
  if(!page||!page.image){toast("No image for this page.");return;}
  if(S.ocrCache[num]){ renderFacsimile(S.ocrCache[num]); repositionOverlay(); return; }
  var lang=getLang();
  setStatus("Tesseract ["+lang+"]\u2026",true);
  var card=document.querySelector(".thumb-card[data-page='"+num+"']");
  if(card) card.classList.add("running");
  try {
    var result=await apiFetch("/api/ocr",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({image_url:page.image, lang:lang}),
    });
    S.ocrCache[num]=result;
    updateThumbStatus(num,"done");
    /* Sync selector to actual lang used */
    if(result.lang_used){ syncLangSelector(result.lang_used); }
    setStatus("Done \u2014 "+(result.blocks||[]).length+" blocks \u00b7 lang: "+(result.lang_used||lang),false);
    renderFacsimile(result);
    repositionOverlay();
  } catch(err) {
    updateThumbStatus(num,"");
    setStatus("",false);
    toast("OCR error: "+err.message);
  }
}

/* ── OCR all pages SSE ──────────────────────────────────────────── */
function ocrAllPages() {
  if(!S.manifest){toast("Load a manifest first.");return;}
  var murl=(el("manifestUrl").value||"").trim();
  var lang=getLang();
  var total=S.manifest.total_pages;
  var btn=el("btnOcrAll");
  if(btn){btn.disabled=true;btn.textContent="\u23f3";}
  toast("OCR started for "+total+" pages ["+lang+"]\u2026",0);
  var es=new EventSource("/api/ocr/all?manifest_url="+encodeURIComponent(murl)+"&lang="+encodeURIComponent(lang));
  es.onmessage=function(e){
    var data; try{data=JSON.parse(e.data);}catch(_){return;}
    if(data.status==="complete"){
      es.close();
      if(btn){btn.disabled=false;btn.textContent="\u25ba\u25ba All";}
      toast("All pages done.",3000); setStatus("",false);
      if(S.ocrCache[S.currentPage]) repositionOverlay();
      return;
    }
    if(data.status==="running"){
      updateThumbStatus(data.page,"running");
      S._ocrStartTime=Date.now();
      setStatus("Tesseract · page "+data.page+"/"+total+" ["+lang+"]\u2026",true);
      return;
    }
    if(data.status==="done"){
      S.ocrCache[data.page]=data.result;
      updateThumbStatus(data.page,"done");
      if(data.page===S.currentPage){ renderFacsimile(data.result); repositionOverlay(); }
      return;
    }
    if(data.status==="error") updateThumbStatus(data.page,"");
  };
  es.onerror=function(){
    es.close();
    if(btn){btn.disabled=false;btn.textContent="\u25ba\u25ba All";}
    setStatus("",false); toast("Connection lost.");
  };
}

/* ── facsimile renderer ─────────────────────────────────────────── */
/* Font size per hierarchy level — consistent within the same type */
var FACS_FONT = {
  "heading":      { size: 11, weight: "700", transform: "none" },
  "title":        { size: 11, weight: "700", transform: "none" },
  "text":         { size: 11, weight: "400", transform: "none" },
  "caption":      { size: 11, weight: "400", transform: "none" },
  "footer":       { size: 11, weight: "400", transform: "none" },
  "list":         { size: 11, weight: "400", transform: "none" },
  "table":        { size: 11, weight: "400", transform: "none" },
  "illustration": { size: 11, weight: "400", transform: "none" },
};

function renderFacsimile(result) {
  var blocks=result.blocks||[];
  var pw=result.page_width||1000, ph=result.page_height||1400;
  var canvas=el("facsCanvas"), page=el("facsPage"), wc=el("textWc");
  if(!page||!canvas) return;
  if(!blocks.length){
    page.innerHTML="<div class='empty-state'>No text blocks detected.</div>";
    return;
  }
  /* Scale to fit canvas width */
  var cw=(canvas.offsetWidth||640)-32;
  var scale=cw/pw;
  var dw=Math.round(pw*scale), dh=Math.round(ph*scale);
  page.style.width=dw+"px"; page.style.height=dh+"px";

  var html="", wcount=0;
  blocks.forEach(function(b,idx){
    var l=Math.round(b.x1*dw), t=Math.round(b.y1*dh);
    var w=Math.max(4,Math.round((b.x2-b.x1)*dw));
    var h=Math.max(4,Math.round((b.y2-b.y1)*dh));
    var type=b.type||"text", text=(b.text||"").trim();
    if(!text&&type!=="illustration") return;
    wcount+=text.split(/\s+/).filter(Boolean).length;

    var fStyle=FACS_FONT[type]||FACS_FONT["text"];
    /* Fixed size per type, scaled with page — no shrinking */
    var fs=Math.round(fStyle.size*scale*(pw/800));
    fs=Math.max(7,Math.min(fs,36));

    html+="<div class='facs-block type-"+esc(type)+"' data-index='"+idx+"'"
         +" style='"
         +"left:"+l+"px;top:"+t+"px;width:"+w+"px;height:"+h+"px;"
         +"font-size:"+fs+"px;"
         +"font-weight:"+fStyle.weight+";"
         +"text-transform:"+fStyle.transform+";"
         +(Math.floor(text.length/(w/(fs*0.55)))>0?"text-align:justify;":"text-align:center;")
         +"'>"
         +(type==="illustration"?"[illustration]":esc(text))
         +"</div>";
  });
  page.innerHTML=html;
  if(wc) wc.textContent=wcount+" words";
  page.querySelectorAll(".facs-block").forEach(function(div){
    div.addEventListener("click",function(){
      var idx=parseInt(div.dataset.index,10);
      toggleBlockSelection(idx);
    });
  });
}

function toggleBlockSelection(idx) {
  if(S.selectedBlocks.has(idx)) {
    S.selectedBlocks.delete(idx);
  } else {
    S.selectedBlocks.add(idx);
  }
  updateBlockHighlights();
  renderAnalysis();
}

function clearSelection() {
  S.selectedBlocks.clear();
  updateBlockHighlights();
  renderAnalysis();
}

function selectAllTextBlocks() {
  var result=S.ocrCache[S.currentPage]; if(!result) return;
  (result.blocks||[]).forEach(function(b,i){
    if(b.type==="text"||b.type==="heading"||b.type==="caption") S.selectedBlocks.add(i);
  });
  updateBlockHighlights();
  renderAnalysis();
}

function updateBlockHighlights() {
  document.querySelectorAll(".ocr-block").forEach(function(d){
    var i=parseInt(d.dataset.index,10);
    var on=S.selectedBlocks.has(i);
    d.style.background=on?"rgba(196,146,42,.35)":"";
    d.style.borderColor=on?"var(--gold)":"";
    d.style.borderWidth=on?"2px":"";
  });
  document.querySelectorAll(".facs-block").forEach(function(d){
    var i=parseInt(d.dataset.index,10);
    d.classList.toggle("selected",S.selectedBlocks.has(i));
  });
  var sc=el("selCount");
  if(sc) sc.textContent=S.selectedBlocks.size===0
    ? "No blocks selected"
    : S.selectedBlocks.size+" block"+(S.selectedBlocks.size>1?"s":"")+" selected";
}

function renderAnalysis(query) {
  var body=el("analysisBody"); if(!body) return;
  var result=S.ocrCache[S.currentPage];
  if(!result||S.selectedBlocks.size===0){
    body.innerHTML="<div class='empty-state'><strong>Select blocks</strong>Click blocks on the facsimile or the image overlay.</div>";
    return;
  }
  query=query||(el("analysisSearch")?el("analysisSearch").value:"");
  var pat=query.trim()?new RegExp("("+query.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+")","gi"):null;
  var blocks=result.blocks||[];
  var html="";
  S.selectedBlocks.forEach(function(idx){
    var b=blocks[idx]; if(!b) return;
    var text=(b.text||"").trim(); if(!text) return;
    var highlighted=pat
      ? esc(text).replace(pat,"<mark>$1</mark>")
      : esc(text);
    html+="<div class='sel-block' data-index='"+idx+"'>"
        +"<div class='sel-type'>"+esc(b.type||"text")+" · block "+idx+"</div>"
        +"<div class='sel-text'>"+highlighted+"</div>"
        +"<span class='sel-remove' data-idx='"+idx+"'>✕</span>"
        +"</div>";
  });
  body.innerHTML=html||"<div class='empty-state'>No text in selected blocks.</div>";
  body.querySelectorAll(".sel-remove").forEach(function(btn){
    btn.addEventListener("click",function(e){
      e.stopPropagation();
      S.selectedBlocks.delete(parseInt(btn.dataset.idx,10));
      updateBlockHighlights(); renderAnalysis(query);
    });
  });
  body.querySelectorAll(".sel-block").forEach(function(div){
    div.addEventListener("click",function(){
      body.querySelectorAll(".sel-block").forEach(function(d){d.classList.remove("active");});
      div.classList.add("active");
    });
  });
}

function filterAnalysis(query) {
  renderAnalysis(query);
}

/* ── overlay ────────────────────────────────────────────────────── */
function clearOverlay(){ var o=el("ocr-overlay"); if(o){o.innerHTML="";o.classList.remove("overlay-text-on");} }
function repositionOverlay(){
  if(!S.ocrCache[S.currentPage]) return;
  var blocks=S.ocrCache[S.currentPage].blocks||[];
  var overlay=el("ocr-overlay"), img=el("pageImg");
  if(!overlay||!img||!blocks.length) return;
  var iw=img.naturalWidth, ih=img.naturalHeight; if(!iw||!ih) return;
  overlay.innerHTML="";
  blocks.forEach(function(block,idx){
    var left=Math.round(S.tx+block.x1*iw*S.scale);
    var top=Math.round(S.ty+block.y1*ih*S.scale);
    var width=Math.max(2,Math.round((block.x2-block.x1)*iw*S.scale));
    var height=Math.max(2,Math.round((block.y2-block.y1)*ih*S.scale));
    var div=document.createElement("div");
    div.className="ocr-block"; div.dataset.type=block.type||"text"; div.dataset.index=idx;
    div.style.cssText="left:"+left+"px;top:"+top+"px;width:"+width+"px;height:"+height+"px";
    if(block.text){
      var tip=document.createElement("div"); tip.className="ocr-tooltip"; tip.textContent=block.text;
      div.appendChild(tip);
      var span=document.createElement("span"); span.className="ocr-text"; span.textContent=block.text;
      span.style.fontSize=Math.max(8,Math.min(height*.75,18))+"px";
      div.appendChild(span);
    }
    div.addEventListener("click",function(){ toggleBlockSelection(idx); });
    overlay.appendChild(div);
  });
  if(S.textOverlay) overlay.classList.add("overlay-text-on");
}
function toggleTextOverlay(){
  S.textOverlay=!S.textOverlay;
  var o=el("ocr-overlay"); if(o) o.classList.toggle("overlay-text-on",S.textOverlay);
  var b=el("btnOverlayText"); if(b) b.classList.toggle("active",S.textOverlay);
}

/* ── progress bar (adaptive) ────────────────────────────────────── */
function setStatus(msg,loading){
  var bar=el("ocrStatusBar"); if(!bar) return;
  bar.style.display=msg?"flex":"none";
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
    bar.innerHTML="<span style='color:var(--gold)'>✓</span> <span>"+esc(msg)+"</span>";
  }
}
function _updateBar(msg){
  var bar=el("ocrStatusBar"); if(!bar||!S._ocrStartTime) return;
  var elapsed=(Date.now()-S._ocrStartTime)/1000;
  var pct=Math.min(90,Math.round(elapsed/S._ocrEstimate*100));
  var rem=Math.max(0,S._ocrEstimate-elapsed);
  var remStr=rem>5?"~"+Math.round(rem)+"s remaining":"finishing\u2026";
  bar.innerHTML="<div class='spinner-sm'></div>"
    +"<div style='flex:1;display:flex;flex-direction:column;gap:3px'>"
      +"<span style='font-size:10px'>"+esc(msg)+" \u2014 "+elapsed.toFixed(0)+"s / "+remStr+"</span>"
      +"<div style='background:#2e2a24;border-radius:3px;height:4px'>"
        +"<div style='background:var(--gold);height:4px;border-radius:3px;width:"+pct+"%;transition:width .3s'></div>"
      +"</div>"
    +"</div>";
}

/* ── view toggle ────────────────────────────────────────────────── */
function setView(mode){
  el("splitView").className="split-view"+(mode==="both"?"":" view-"+mode);
  document.querySelectorAll(".tbtn[data-view]").forEach(function(b){
    b.classList.toggle("active",b.dataset.view===mode);
  });
}

/* ── pan/zoom ───────────────────────────────────────────────────── */
function initPanZoom(){
  var vp=el("viewport"); if(!vp) return;
  vp.addEventListener("wheel",function(e){
    e.preventDefault();
    var f=e.deltaY<0?1.12:0.89;
    var wrap=el("vpwrap")||vp;
    var r=wrap.getBoundingClientRect();
    S.tx=(e.clientX-r.left)+(S.tx-(e.clientX-r.left))*f;
    S.ty=(e.clientY-r.top)+(S.ty-(e.clientY-r.top))*f;
    S.scale*=f; applyTransform(); repositionOverlay();
  },{passive:false});
  vp.addEventListener("mousedown",function(e){
    if(e.button!==0) return;
    S.dragging=true; S.dragStartX=e.clientX; S.dragStartY=e.clientY;
    S.dragTx=S.tx; S.dragTy=S.ty; vp.style.cursor="grabbing";
  });
  window.addEventListener("mousemove",function(e){
    if(!S.dragging) return;
    S.tx=S.dragTx+(e.clientX-S.dragStartX); S.ty=S.dragTy+(e.clientY-S.dragStartY);
    applyTransform(); repositionOverlay();
  });
  window.addEventListener("mouseup",function(){
    S.dragging=false; var v=el("viewport"); if(v) v.style.cursor="grab";
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
  S.scale*=f; applyTransform(); repositionOverlay();
}
function zoomHome(){
  var img=el("pageImg"), wrap=el("vpwrap")||el("viewport"); if(!img||!wrap) return;
  var iw=img.naturalWidth||800, ih=img.naturalHeight||1000;
  var vw=wrap.offsetWidth, vh=wrap.offsetHeight;
  S.scale=Math.min(vw/iw,vh/ih)*0.95;
  S.tx=(vw-iw*S.scale)/2; S.ty=(vh-ih*S.scale)/2;
  applyTransform(); repositionOverlay();
}

/* ── thumbnails ─────────────────────────────────────────────────── */
function renderThumbs(pages){
  var list=el("thumbList");
  if(!pages||!pages.length){list.innerHTML="<div class='empty-state'>No pages.</div>";return;}
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

/* ── metadata panel ─────────────────────────────────────────────── */
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
  for(var j=0;j<sel.options.length;j++){
    if(sel.options[j].value===tess){sel.selectedIndex=j;return;}
  }
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
    +"<div class='meta-section open'>"
      +"<div class='meta-section-head' onclick='toggleMetaSection(this)'>Metadata <span>▾</span></div>"
      +"<div class='meta-section-body'>"+rows+"</div>"
    +"</div>"
    +"<div class='meta-section open'>"
      +"<div class='meta-section-head' onclick='toggleMetaSection(this)'>Links <span>▾</span></div>"
      +"<div class='meta-section-body'><div style='display:flex;flex-direction:column'>"
        +(linkRows||"<span style='color:var(--ink4);font-size:11px'>No links.</span>")
      +"</div></div>"
    +"</div>";
}
window.toggleMetaSection=function(h){ h.closest(".meta-section").classList.toggle("open"); };

/* ── nav ────────────────────────────────────────────────────────── */
function goPage(delta){
  if(!S.manifest) return;
  loadPage(Math.max(1,Math.min(S.manifest.total_pages,S.currentPage+delta)));
}

}());