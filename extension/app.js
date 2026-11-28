/* 由 build/build.js 从 index.html 自动生成，请勿直接修改本文件。
 *  改逻辑请改 index.html，然后执行：node build/build.js
 *  生成时间：2026-11-28 03:30   版本：3.4.1
 */
"use strict";

(async function boot() {
  if (!window.ST) throw new Error("store.js 未加载");
  await ST.load();   // 本地存储整块读进内存，后续读写同步完成

  /* ================= 以下为 index.html 原内联脚本 ================= */

/* ================= 内嵌默认数据（当前导出） ================= */
const EMBEDDED_CSV_B64 = "";
/* 内置记录备份（用户 2026-11-12 导出）：首次打开自动灌入本地存储，只做一次 */
const __SEED__=(()=>{ try{ const n=document.getElementById("seedJson"); return n?JSON.parse(n.textContent||"null"):null; }catch(e){ return null; } })();
window.__SEED__=__SEED__;

/* ================= 配置 ================= */
const DEFAULT_COLS = [
  "店铺名称","日期","店铺款式编码","商品名称","图片",
  "商品销售数据-商品销售金额(扣退)","商品销售数据-商品销售成本(扣退)",
  "利润-经营利润","经营利润-占比","利润-毛利额","毛利额-占比",
  "利润-其中：推广费","其中：推广费-占比"
];
const CLICK_COLS = new Set(["店铺名称","日期","店铺款式编码","商品名称"]);
const COPY_COLS = new Set(["店铺款式编码","商品名称"]);
const MONEY_COLS = new Set(["商品销售数据-商品销售金额(扣退)","商品销售数据-商品销售成本(扣退)","利润-经营利润","利润-毛利额","利润-其中：推广费"]);
const PCT_COLS = new Set(["经营利润-占比","毛利额-占比","其中：推广费-占比"]);
const MONEY_LABELS = {"商品销售数据-商品销售金额(扣退)":"销售金额","商品销售数据-商品销售成本(扣退)":"销售成本","利润-经营利润":"经营利润","利润-毛利额":"毛利额","利润-其中：推广费":"推广费"};
const DEFAULT_SORT = {col:"日期", dir:1};
const REC_COL_W = 214;   // 「调整记录」列宽（固定在最右，不参与列管理）
const NUM_OP_LABEL = {gt:"＞", gte:"≥", lt:"＜", lte:"≤", eq:"=", ne:"≠"};
/* 列显示别名（仅影响展示，内部键保持 CSV 原列名） */
const COL_ALIAS = {
  "店铺款式编码":"链接ID",
  "商品名称":"链接标题",
  "商品销售数据-商品销售金额(扣退)":"成交金额",
  "商品销售数据-商品销售成本(扣退)":"商品成本",
  "利润-经营利润":"净利润",
  "经营利润-占比":"净利润率",
  "利润-毛利额":"毛利润",
  "毛利额-占比":"毛利率",
  "利润-其中：推广费":"推广费用",
  "其中：推广费-占比":"推广费占比"
};
const dispName = c => COL_ALIAS[c] || c;

/* ================= 状态 ================= */
let HEADERS = [];
let ROWS = [];               // 全部行（对象数组）
let visibleCols = [...DEFAULT_COLS];
let searchText = "";
let colFilters = {};         // col -> {type:'values', vals:Set} | {type:'text', text}
let sort = {...DEFAULT_SORT};
let page = 1, pageSize = 100;
let filtered = [];           // 当前筛选+排序结果
let colWidths = {};          // 拖动调整后的列宽（px）
let fixedLayout = false;     // 是否已切换为固定列宽布局

const $ = id => document.getElementById(id);

/* ================= 表格数据本地保存（覆盖式） =================
 * 导入的利润表存在本机，关掉页面再打开会自动恢复；
 * 再次导入新表格时整条覆盖，不累加、不冲突。 */
const TABLE_KEY = "adlog_table_v1";        /* v2.2.0 的旧键：整份 JSON，只用于迁移/兜底 */
const TABLE_META_KEY = "adlog_tmeta_v1";   /* 小索引：文件名、行数、时间、体积（很小，同步可读） */
const IDB_NAME = "adlog_store", IDB_STORE = "kv", IDB_TABLE = "table_v1";
let _noPersist = false;      // 从缓存恢复时不回写，省一次 IO
let _restoring = false;      // 恢复中：提示语换成「已恢复」

/* ---------- IndexedDB：存表格正文 ----------
 * localStorage 只有 5MB（还按 UTF-16 双字节算，中文表格实际只能装两兆多字符）。
 * IndexedDB 的配额是磁盘可用空间的一部分，浏览器实测报到 10GB 量级，
 * 几十万行的利润表也放得下。单文件版与扩展版都走这里，容量一致。 */
let _idbP = null;
function idbOpen(){
  if(_idbP) return _idbP;
  _idbP = new Promise((res, rej) => {
    let req;
    try{ req = indexedDB.open(IDB_NAME, 1); }catch(e){ return rej(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error("indexedDB 打不开"));
    req.onblocked = () => rej(new Error("indexedDB 被其它页面占用"));
  });
  return _idbP;
}
function idbRun(mode, fn){
  return idbOpen().then(db => new Promise((res, rej) => {
    let tx, rq;
    try{ tx = db.transaction(IDB_STORE, mode); rq = fn(tx.objectStore(IDB_STORE)); }
    catch(e){ return rej(e); }
    tx.oncomplete = () => res(rq && ("result" in rq) ? rq.result : true);
    tx.onerror = () => rej(tx.error || new Error("indexedDB 读写失败"));
    tx.onabort = () => rej(tx.error || new Error("indexedDB 中断（多半是空间不足）"));
  }));
}
const idbGet = k => idbRun("readonly", st => st.get(k));
/* 请求「持久化」权限：被授予后浏览器不会在磁盘紧张时自动清掉 IndexedDB。
   不支持或被拒绝都无所谓，只是少一层保险。 */
function idbPersist(){
  try{
    if(!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persisted()
      .then(p => p ? true : navigator.storage.persist())
      .catch(() => {});
  }catch(e){}
}
const idbPut = (k, v) => idbRun("readwrite", st => st.put(v, k));
const idbDel = k => idbRun("readwrite", st => st.delete(k));

const fmtSize = n => {
  const v = Number(n) || 0;
  if(v >= 1073741824) return (v / 1073741824).toFixed(1) + " GB";
  if(v >= 1048576) return (v / 1048576).toFixed(1) + " MB";
  if(v >= 1024) return Math.round(v / 1024) + " KB";
  return v + " B";
};

function tableMetaGet(){
  try{
    const j = JSON.parse(ST.get(TABLE_META_KEY) || "null");
    return (j && (j.rows || j.name)) ? j : null;
  }catch(e){ return null; }
}
/* v2.2.0 存在 localStorage 里的全文：读到就搬进 IndexedDB，再把 localStorage 腾空 */
function tableLegacyTake(){
  try{
    const j = JSON.parse(ST.get(TABLE_KEY) || "null");
    return (j && typeof j.text === "string" && j.text) ? j : null;
  }catch(e){ return null; }
}
function tableCacheLoad(){
  const legacy = tableLegacyTake();
  if(legacy){
    tableCacheSet(legacy.text, legacy.name, legacy);   /* 迁移：写入 IDB + 生成索引 */
    return Promise.resolve(legacy);
  }
  const meta = tableMetaGet();
  if(!meta) return Promise.resolve(null);
  return idbGet(IDB_TABLE).then(rec => (rec && typeof rec.text === "string" && rec.text) ? rec : null)
    .catch(e => { console.warn("[table] IndexedDB 读取失败", e); return null; });
}
function tableCacheSet(text, name, meta){
  if(_noPersist) return;
  const body = String(text || "");
  const rec = {
    v: 2,
    name: name || (meta && meta.name) || "表格",
    at: (meta && meta.at) || Date.now(),
    rows: ROWS.length || (meta && meta.rows) || 0,
    cols: HEADERS.length || (meta && meta.cols) || 0,
    size: body.length
  };
  /* 小索引同步写：徽章要立刻出现，启动时靠它判断「有没有东西要恢复」 */
  try{ ST.set(TABLE_META_KEY, JSON.stringify(rec)); }catch(e){}
  paintSrcChip();
  const full = Object.assign({}, rec, { text: body });
  idbPut(IDB_TABLE, full).then(() => {
    /* 正文已在 IDB，旧的 localStorage 全文可以释放了 */
    try{ ST.set(TABLE_KEY, ""); }catch(e){}
    idbPersist();
  }).catch(err => {
    console.warn("[table] IndexedDB 写入失败，退回 localStorage", err);
    try{
      ST.set(TABLE_KEY, JSON.stringify(full));
      toast("表格已保存到本机（兼容模式，上限约 5 MB）");
    }catch(e2){
      const mb = Math.max(0.1, body.length * 2 / 1048576).toFixed(1);
      toast(`表格较大（约 ${mb} MB），本机存储放不下，本次未保存；下次打开需重新导入`);
    }
  });
}
function tableCacheClear(){
  /* 构建禁止 removeItem：写空串即视为「没有保存」 */
  try{ ST.set(TABLE_META_KEY, ""); ST.set(TABLE_KEY, ""); }catch(e){}
  idbDel(IDB_TABLE).catch(() => {});
  paintSrcChip();
}
function fmtSavedAt(t){
  const d = new Date(Number(t) || 0);
  if(isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  const now = new Date();
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hm = p(d.getHours()) + ":" + p(d.getMinutes());
  return same ? ("今天 " + hm) : (p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + hm);
}
function paintSrcChip(){
  const box = $("srcChip"); if(!box) return;
  const c = tableMetaGet();
  if(!c){ box.classList.remove("on"); box.innerHTML = ""; return; }
  box.classList.add("on");
  const sizeTx = c.size ? fmtSize(c.size) : "";
  box.title = "表格数据已保存在本机：" + (c.name || "") + "（" + (c.rows || 0) + " 行" + (sizeTx ? " · " + sizeTx : "") + "）\n" +
    "关掉页面再打开会自动恢复；导入新表格会直接覆盖它。\n" +
    "存储用 IndexedDB，容量跟着磁盘剩余走，几十万行也放得下。";
  box.innerHTML = '📄 <b>' + esc(c.name) + '</b><span>' + (c.rows || 0) + ' 行 · ' + fmtSavedAt(c.at) + '</span>' +
    '<button id="srcClear" title="清除已保存的表格">✕</button>';
  /* 有 estimate 就补一句可用空间，让人心里有数 */
  try{
    if(navigator.storage && navigator.storage.estimate){
      navigator.storage.estimate().then(est => {
        if(!est || !box.classList.contains("on")) return;
        const free = Math.max(0, (est.quota || 0) - (est.usage || 0));
        box.title = box.title.split("\n可用空间")[0] + "\n可用空间约 " + fmtSize(free) + "（页面存储配额）";
      }).catch(() => {});
    }
  }catch(e){}
}

/* 清除按钮（动态生成，用委托） */
document.addEventListener("click", e => {
  if(!e.target.closest("#srcClear")) return;
  e.preventDefault();
  if(!confirm("清除已保存的表格数据？\n清除后需要重新导入表格才能看到数据。")) return;
  tableCacheClear();
  ROWS = []; HEADERS = []; visibleCols = [...DEFAULT_COLS];
  filtered = []; colFilters = {}; searchText = ""; page = 1;
  const si = $("searchInput"); if(si) si.value = "";
  const tb = $("tbody"), tf = $("tfoot"), mt = $("mainTable");
  if(tb) tb.innerHTML = "";
  if(tf) tf.innerHTML = "";
  if(mt) mt.classList.add("hidden");
  try{ switchView("detail"); buildColPop(); render(); }catch(err){ console.error(err); }
  toast("已清除保存的表格数据");
});

/* ================= CSV 解析 ================= */
function parseCSV(text){
  if(text.charCodeAt(0)===0xFEFF) text = text.slice(1);
  const rows=[]; let row=[], field="", inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else inQ=false; }
      else field+=c;
    }else{
      if(c==='"') inQ=true;
      else if(c===','){ row.push(field); field=""; }
      else if(c==='\n'){ row.push(field); field=""; if(row.length>1||row[0]!=="") rows.push(row); row=[]; }
      else if(c==='\r'){ /* skip */ }
      else field+=c;
    }
  }
  if(field!==""||row.length){ row.push(field); if(row.length>1||row[0]!=="") rows.push(row); }
  return rows;
}
function loadCSVText(text, name){
  const raw = parseCSV(text);
  if(raw.length<2){ toast("文件为空或格式不正确"); return; }
  HEADERS = raw[0].map(h=>h.trim());
  const need = DEFAULT_COLS.filter(c=>c!=="图片");
  const missing = need.filter(c=>!HEADERS.includes(c));
  ROWS = raw.slice(1).map(r=>{
    const o={}; HEADERS.forEach((h,i)=>o[h]=r[i]!==undefined?(r[i]||"").trim():"");
    return o;
  }).filter(o=>Object.values(o).some(v=>v!==""));
  // 重置状态
  visibleCols = DEFAULT_COLS.filter(c=>HEADERS.includes(c));
  HEADERS.forEach(h=>{ if(!visibleCols.includes(h) && DEFAULT_COLS.includes(h)) visibleCols.push(h); });
  searchText=""; $("searchInput").value="";
  colFilters={}; sort={...DEFAULT_SORT}; page=1; closeDrawer(); colWidths={}; fixedLayout=false;
  // 重置汇总视图状态
  dateShops=new Set(); updateShopBtn();
  dateLinks=new Set(); updateLinkBtn();
  dateGroup="date"; dateRange={a:"",b:""}; $("dateRangeA").value=""; $("dateRangeB").value="";
  document.querySelectorAll("#dateGroupTabs .vtab").forEach(x=>x.classList.toggle("on",x.dataset.g==="date"));
  dateSort={key:"date",dir:-1};
  if(window.syncLinkImages) window.syncLinkImages();
  buildColPop(); render();
  if(viewMode==="sum") renderDateSummary();
  toast(_restoring
    ? `已恢复上次导入的「${name}」：${ROWS.length} 行`
    : `已加载「${name||"内嵌数据"}」：${ROWS.length} 行 × ${HEADERS.length} 列` + (missing.length?`（缺少列：${missing.join("、")}）`:""));
  tableCacheSet(text, name);
}

/* ================= 表格导入：CSV / XLSX ================= */
/* 目标字段：利润表所需的列（图片列不参与导入，链接图另有来源） */
const IMP_TARGETS = DEFAULT_COLS.filter(c => c !== "图片");

/* 归一化列名：去空格、去标点、转小写，便于判等 */
function impNorm(s){
  return String(s == null ? "" : s).toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[（）()【】\[\]「」《》〈〉:：;,，.。、\-_/\\|%％"'“”‘’*×+]/g, "");
}
/* 拆词：按标点切段，做关键词命中判断 */
function impTokens(s){
  return String(s == null ? "" : s)
    .split(/[\s\u3000（）()【】\[\]:：;,，、\-_/\\|%％]+/)
    .map(impNorm).filter(Boolean);
}

/* ---------- 列自动匹配：先精确，再按关键词重合度打分，贪心分配 ---------- */
function impGuessMap(headers){
  const cols = headers.map((h, i) => ({ i, h: String(h == null ? "" : h), n: impNorm(h) }));
  const pairs = [];
  IMP_TARGETS.forEach((f, fi) => {
    const nf = impNorm(f);
    const tf = impTokens(f);
    const needPct = /占比/.test(f);
    const needRet = /扣退/.test(f);
    const needCost = /成本/.test(f);
    cols.forEach(c => {
      let sc = 0;
      if (c.n === nf) sc = 100;
      else if (c.n && nf && (c.n.indexOf(nf) >= 0 || nf.indexOf(c.n) >= 0)) sc = 88;
      else {
        let hit = 0;
        tf.forEach(t => { if (t && c.n.indexOf(t) >= 0) hit++; });
        if (hit) sc = Math.round(66 * hit / tf.length);
      }
      if (!sc) return;
      /* 限定词必须对上，否则「经营利润 / 净利润率」「销售金额 / 销售成本」会串 */
      const hasPct = /占比|率/.test(c.h);
      if (needPct && !hasPct) return;
      if (!needPct && hasPct && /利润|毛利|推广/.test(f)) sc -= 30;
      if (needRet && c.n.indexOf("扣退") < 0) return;
      if (needCost && c.n.indexOf("成本") < 0) return;
      if (!needCost && /成本/.test(c.h) && /金额/.test(f)) return;
      if (sc >= 34) pairs.push({ fi, ci: c.i, sc });
    });
  });
  pairs.sort((a, b) => b.sc - a.sc || a.fi - b.fi);
  const map = {}, usedC = new Set(), usedF = new Set();
  pairs.forEach(p => {
    if (usedF.has(p.fi) || usedC.has(p.ci)) return;
    map[IMP_TARGETS[p.fi]] = p.ci;
    usedF.add(p.fi); usedC.add(p.ci);
  });
  return map;
}

/* ---------- 表头行识别：前 30 行里找「字段名最多」的一行 ---------- */
const IMP_KEYS = /日期|店铺|商品|销售|利润|推广|编码|成交|花费|投产/;
function impFindHeader(rows){
  let bi = -1, bs = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++){
    const r = rows[i] || [];
    let filled = 0, key = 0;
    for (let j = 0; j < r.length; j++){
      const s = String(r[j] == null ? "" : r[j]).trim();
      if (!s) continue;
      filled++;
      if (IMP_KEYS.test(s)) key++;
    }
    const sc = filled + key * 4;
    if (filled >= 3 && key >= 2 && sc > bs){ bs = sc; bi = i; }
  }
  if (bi >= 0) return bi;
  let mi = 0, mv = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++){
    const n = (rows[i] || []).filter(v => String(v == null ? "" : v).trim()).length;
    if (n > mv){ mv = n; mi = i; }
  }
  return mi;
}

/* ---------- 最小 ZIP 读取：只解析中央目录，按需解压 ---------- */
async function impInflate(u8){
  if (typeof DecompressionStream === "undefined"){
    throw new Error("当前浏览器不支持解压（需要 Chrome 103+），请改用 CSV 导入");
  }
  const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
async function impZipOpen(buf){
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--){
    if (u8[i] === 0x50 && u8[i+1] === 0x4b && u8[i+2] === 0x05 && u8[i+3] === 0x06){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 xlsx（ZIP 结构缺失）；如果是旧版 .xls，请另存为 xlsx 或 csv");
  const total = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const idx = new Map();
  for (let k = 0; k < total; k++){
    if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder("utf-8").decode(u8.subarray(off + 46, off + 46 + nlen));
    if (name && lho + 30 <= u8.length) idx.set(name, { method, csize, lho });
    off += 46 + nlen + elen + clen;
  }
  async function read(name){
    const e = idx.get(name);
    if (!e) return null;
    const lnlen = dv.getUint16(e.lho + 26, true);
    const lelen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + lnlen + lelen;
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return await impInflate(raw);
    throw new Error("不支持的压缩方式：" + e.method);
  }
  return { names: Array.from(idx.keys()), read };
}

/* ---------- xlsx 取值工具 ---------- */
function impUnesc(s){
  return String(s == null ? "" : s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
function impColIndex(ref){
  let n = 0;
  for (let i = 0; i < ref.length; i++) n = n * 26 + (ref.charCodeAt(i) - 64);
  return n - 1;
}
const IMP_STD_DATE = { 14:1, 15:1, 16:1, 17:1, 18:1, 19:1, 20:1, 21:1, 22:1, 45:1, 46:1, 47:1 };
function impIsDateFmt(id, customs){
  if (IMP_STD_DATE[Number(id)]) return true;
  const c = customs[id];
  if (!c) return false;
  const s = String(c).replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").replace(/\\/g, "");
  return /[ymd]/i.test(s) && !/^[#0.,%\s]+$/.test(s);
}
function impIsPctFmt(id, customs){
  if (Number(id) === 9 || Number(id) === 10) return true;
  const c = customs[id];
  if (!c) return false;
  const s = String(c).replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").replace(/\\/g, "");
  return s.indexOf("%") >= 0;
}
function impSerialDate(n, d1904){
  let days = Math.floor(n);
  const frac = n - days;
  const base = d1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + days * 86400000);
  if (isNaN(d.getTime()) || d.getUTCFullYear() < 1900) return String(n);
  const p = x => (x < 10 ? "0" : "") + x;
  const date = d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  if (frac > 0.0006){
    const mins = Math.round(frac * 1440);
    return date + " " + p(Math.floor(mins / 60) % 24) + ":" + p(mins % 60);
  }
  return date;
}

/* ---------- 读取 xlsx：返回 [{name, rows}] ---------- */
async function impReadXlsx(buf){
  const zip = await impZipOpen(buf);
  const td = new TextDecoder("utf-8");
  const txt = async n => { const b = await zip.read(n); return b ? td.decode(b) : ""; };

  const wbXml = await txt("xl/workbook.xml");
  if (!wbXml) throw new Error("这个文件里没有 Excel 工作簿结构，可能不是 xlsx");
  const d1904 = /date1904\s*=\s*"(1|true)"/i.test(wbXml);

  /* 共享字符串 */
  const shared = [];
  const ssXml = await txt("xl/sharedStrings.xml");
  if (ssXml){
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(ssXml))){
      let s = "", tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm;
      while ((tm = tre.exec(m[1]))) s += tm[1];
      shared.push(impUnesc(s));
    }
  }

  /* 样式 → 哪些单元格格式是日期 */
  const dateXf = new Set();
  const pctXf = new Set();
  const stXml = await txt("xl/styles.xml");
  if (stXml){
    const customs = {};
    let m;
    const fre = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
    while ((m = fre.exec(stXml))) customs[m[1]] = impUnesc(m[2]);
    const block = (stXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || "";
    const xre = /<xf\b[^>]*numFmtId="(\d+)"/g;
    let i = 0;
    while ((m = xre.exec(block))){
      if (impIsDateFmt(m[1], customs)) dateXf.add(i);
      else if (impIsPctFmt(m[1], customs)) pctXf.add(i);
      i++;
    }
  }

  /* 工作表清单 */
  const rels = {};
  const relXml = await txt("xl/_rels/workbook.xml.rels");
  if (relXml){
    /* 属性顺序各家不同（openpyxl 就是 Type → Target → Id），所以逐个属性抓 */
    const re = /<Relationship\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(relXml))){
      const id = (m[1].match(/\bId="([^"]+)"/) || [])[1];
      const tg = (m[1].match(/\bTarget="([^"]+)"/) || [])[1];
      if (id && tg) rels[id] = tg;
    }
  }
  const sheets = [];
  let m2;
  const sre = /<sheet\b([^>]*?)\/?>/g;
  while ((m2 = sre.exec(wbXml))){
    const a = m2[1];
    const nm = (a.match(/\bname="([^"]*)"/) || [])[1];
    const rid = (a.match(/\br:id="([^"]+)"/) || [])[1];
    if (nm === undefined) continue;
    let t = rid ? (rels[rid] || "") : "";
    t = t.replace(/^\/?xl\//i, "").replace(/^\//, "");
    sheets.push({ name: impUnesc(nm), path: t ? "xl/" + t : "" });
  }
  if (!sheets.length){
    zip.names.filter(n => /^xl\/worksheets\/[^/]+\.xml$/i.test(n)).sort()
      .forEach((p, i) => sheets.push({ name: "Sheet" + (i + 1), path: p }));
  }

  function cellValue(attrs, inner){
    const t = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
    const si = Number((attrs.match(/\bs="(\d+)"/) || [])[1] || 0);
    if (t === "inlineStr"){
      let s = "", re = /<t\b[^>]*>([\s\S]*?)<\/t>/g, mm;
      while ((mm = re.exec(inner))) s += mm[1];
      return impUnesc(s);
    }
    const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
    const raw = vm ? impUnesc(vm[1]) : "";
    if (t === "s"){ const i = Number(raw); return shared[i] === undefined ? "" : shared[i]; }
    if (t === "b") return raw === "1" ? "TRUE" : "FALSE";
    if (t === "e" || t === "str") return raw;
    if (raw === "") return "";
    const num = Number(raw);
    if (!isNaN(num)){
      if (dateXf.has(si)) return impSerialDate(num, d1904);
      /* Excel 里百分比存的是小数（0.4231 + 0.00%），看板按「42.31%」字符串处理，这里转好 */
      if (pctXf.has(si)) return String(Math.round(num * 10000) / 100) + "%";
    }
    return raw;
  }

  async function sheetRows(path){
    const xml = await txt(path);
    if (!xml) return [];
    const rows = [];
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml))){
      const rIdx = Number((rm[1].match(/\br="(\d+)"/) || [])[1] || 0) || rows.length + 1;
      const cells = [];
      const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(rm[2]))){
        const attrs = cm[1];
        const ref = (attrs.match(/\br="([A-Z]+)\d+"/i) || [])[1];
        const ci = ref ? impColIndex(ref.toUpperCase()) : cells.length;
        cells[ci] = cellValue(attrs, cm[3] || "");
      }
      const arr = [];
      for (let i = 0; i < cells.length; i++) arr[i] = cells[i] === undefined ? "" : cells[i];
      rows[rIdx - 1] = arr;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  const out = [];
  for (const s of sheets){
    if (!s.path) continue;
    const rows = await sheetRows(s.path);
    if (rows.length) out.push({ name: s.name, rows });
  }
  return out;
}

/* ---------- 列对应关系记忆 ---------- */
function impMapsLoad(){
  try { return JSON.parse(ST.get("adlog_colmap_v1") || "{}") || {}; } catch (e){ return {}; }
}
function impMapsSave(o){
  try { ST.set("adlog_colmap_v1", JSON.stringify(o)); } catch (e){}
}
function impSig(head){
  return impNorm(head.join("|")).slice(0, 160) || "default";
}

/* ---------- 列对应弹窗 ---------- */
let impState = null;

function impEnsureModal(){
  if ($("impModal")) return;
  const d = document.createElement("div");
  d.className = "rmodal";
  d.id = "impModal";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.innerHTML =
    '<div class="mbox" style="width:780px">' +
      '<div class="mhead"><b>导入表格 · 确认列对应</b><button type="button" class="mclose" id="impClose" aria-label="关闭">✕</button></div>' +
      '<div class="mbody" id="impBody" style="grid-template-columns:1fr;gap:0"></div>' +
      '<div class="mfoot"><span class="mhint" id="impHint"></span>' +
        '<button type="button" class="btn" id="impCancel">取消</button>' +
        '<button type="button" class="btn primary" id="impOk">导入</button></div>' +
    '</div>';
  document.body.appendChild(d);

  const close = () => { d.classList.remove("show"); impState = null; };
  $("impClose").onclick = close;
  $("impCancel").onclick = close;
  d.addEventListener("click", e => { if (e.target === d) close(); });
  $("impOk").onclick = impCommit;
  $("impBody").addEventListener("change", e => {
    const t = e.target;
    if (t.id === "impHdr"){ impRereadHeader(Number(t.value)); return; }
    if (t.id === "impAll"){ impAutoMapAll(); return; }
    const s = t.closest("select[data-impf]");
    if (!s || !impState) return;
    const f = s.dataset.impf;
    if (s.value === "") delete impState.map[f]; else impState.map[f] = Number(s.value);
    impPaintSample(s.closest("tr"), f);
    impPaintHint();
  });
}

function impPaintSample(tr, f){
  if (!tr || !impState) return;
  const cell = tr.querySelector("td.v");
  if (!cell) return;
  const ci = impState.map[f];
  tr.classList.toggle("miss", !(ci >= 0));
  if (!(ci >= 0)){ cell.innerHTML = "<i>未匹配</i>"; return; }
  const row = impState.body.find(r => String((r || [])[ci] == null ? "" : (r || [])[ci]).trim() !== "") || [];
  const v = String(row[ci] == null ? "" : row[ci]);
  cell.textContent = v.slice(0, 30);
}

function impPaintHint(){
  if (!impState) return;
  const st = impState;
  const got = IMP_TARGETS.filter(f => st.map[f] >= 0).length;
  const miss = IMP_TARGETS.filter(f => !(st.map[f] >= 0));
  let s = "表头第 " + (st.hIdx + 1) + " 行 · 数据 " + st.body.length + " 行 · 已对应 " + got + "/" + IMP_TARGETS.length + " 列";
  const need = ["日期", "店铺款式编码"].filter(f => !(st.map[f] >= 0));
  if (need.length) s += " · 缺少必填：" + need.join("、");
  else if (miss.length) s += " · 未对应：" + miss.map(dispName).join("、");
  const el = $("impHint");
  el.textContent = s;
  el.classList.toggle("warn", need.length > 0);
}

function impRender(){
  const st = impState;
  if (!st) return;
  const head = st.head;
  const saved = st.remembered;
  const rowsHtml = IMP_TARGETS.map(f => {
    const ci = st.map[f];
    const one = ['<option value="">— 不导入 —</option>']
      .concat(head.map((h, i) => '<option value="' + i + '"' + (ci === i ? " selected" : "") + ">" + esc(h) + "</option>"))
      .join("");
    return '<tr class="' + (ci >= 0 ? "" : "miss") + '">' +
      '<td class="k"><span class="imp-alias">' + esc(dispName(f)) + '</span><span class="imp-raw">' + esc(f) + "</span></td>" +
      '<td class="s"><select data-impf="' + esc(f) + '">' + one + "</select></td>" +
      '<td class="v"><i>未匹配</i></td></tr>';
  }).join("");

  $("impBody").innerHTML =
    '<div class="imp-bar">' +
      '<span class="imp-file" title="' + esc(st.fileName) + '">📄 ' + esc(st.fileName) + (st.sheetName ? " · " + esc(st.sheetName) : "") + "</span>" +
      '<span class="imp-hd">表头在第 <input type="number" id="impHdr" min="1" max="' + st.rows.length + '" value="' + (st.hIdx + 1) + '"> 行</span>' +
      '<button type="button" class="btn ghost" id="impAll">重新自动匹配</button>' +
    "</div>" +
    '<table class="imp-map"><thead><tr><th>看板字段</th><th>文件里的列</th><th>示例值</th></tr></thead><tbody>' + rowsHtml + "</tbody></table>" +
    '<label class="imp-rem"><input type="checkbox" id="impKeep" checked> 记住这个文件格式的列对应关系（下次自动套用）</label>';

  IMP_TARGETS.forEach(f => {
    const sel = $("impBody").querySelector('select[data-impf="' + f.replace(/"/g, '\\"') + '"]');
    if (sel) impPaintSample(sel.closest("tr"), f);
  });
  impPaintHint();
}

function impAutoMapAll(){
  if (!impState) return;
  impState.map = impGuessMap(impState.head);
  impRender();
}

function impRereadHeader(v){
  if (!impState) return;
  const n = Math.max(1, Math.min(impState.rows.length, Number(v) || 1));
  impState.hIdx = n - 1;
  const t = impTableOf(impState.rows, impState.hIdx);
  impState.head = t.head;
  impState.body = t.body;
  const saved = impMapsLoad()[impSig(t.head)];
  impState.remembered = !!(saved && saved.map);
  impState.map = (saved && saved.map) || impGuessMap(t.head);
  Object.keys(impState.map).forEach(k => { const i = impState.map[k]; if (!(i >= 0 && i < t.head.length)) delete impState.map[k]; });
  impRender();
}

function impTableOf(rows, hIdx){
  const raw = (rows[hIdx] || []).map(v => String(v == null ? "" : v).trim());
  const head = raw.map((v, i) => v || ("列" + (i + 1)));
  const body = rows.slice(hIdx + 1).filter(r => (r || []).some(v => String(v == null ? "" : v).trim() !== ""));
  return { head, body };
}

function impOpenTable(fileName, rows, sheetName, auto){
  impEnsureModal();
  const hIdx = impFindHeader(rows);
  const t = impTableOf(rows, hIdx);
  const saved = impMapsLoad()[impSig(t.head)];
  let map = (saved && saved.map) ? Object.assign({}, saved.map) : impGuessMap(t.head);
  Object.keys(map).forEach(k => { const i = map[k]; if (!(i >= 0 && i < t.head.length)) delete map[k]; });
  impState = { fileName: fileName || "表格", sheetName: sheetName || "", rows, hIdx, head: t.head, body: t.body, map, remembered: !!(saved && saved.map) };
  /* 一键抓取：这套表头已经对过一次，就直接按记忆的列对应导入，不再弹窗 */
  if (auto && impState.remembered){ impCommit(); return; }
  impRender();
  $("impModal").classList.add("show");
}

const impCsvCell = v => {
  const s = String(v == null ? "" : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function impCommit(){
  const st = impState;
  if (!st) return;
  const picks = IMP_TARGETS.filter(f => st.map[f] >= 0).map(f => ({ f, c: st.map[f] }));
  const need = ["日期", "店铺款式编码"].filter(f => !picks.some(p => p.f === f));
  if (need.length){ toast("还需要对应「" + need.join("」「") + "」才能导入"); return; }
  const lines = [picks.map(p => p.f)];
  st.body.forEach(r => lines.push(picks.map(p => impCsvCell((r || [])[p.c]))));
  const csv = lines.map(l => l.join(",")).join("\r\n");
  if ($("impKeep") && $("impKeep").checked){
    const all = impMapsLoad();
    all[impSig(st.head)] = { map: st.map, at: Date.now(), name: st.fileName };
    impMapsSave(all);
  }
  const name = st.fileName;
  $("impModal").classList.remove("show");
  impState = null;
  loadCSVText(csv, name);
}

/* ---------- 一入口：按扩展名分流 ---------- */
async function impHandleBuffer(name, buf, opts){
  const nm = String(name || "");
  if (/\.(xlsx|xlsm)$/i.test(nm)){
    const sheets = await impReadXlsx(buf);
    if (!sheets.length) throw new Error("文件里没有可读的工作表");
    const s = sheets.find(x => x.rows.length > 1) || sheets[0];
    impOpenTable(nm, s.rows, s.name, !!(opts && opts.auto));
    return;
  }
  /* 文本类（csv/txt）：UTF-8 优先，出现乱码再按 GBK 解一次 */
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (/\uFFFD/.test(text.slice(0, 3000))){
    try { text = new TextDecoder("gbk").decode(buf); } catch (e){}
  }
  const raw = parseCSV(text);
  if (raw.length < 2) throw new Error("文件为空或格式不正确");
  const head = (raw[0] || []).map(h => String(h == null ? "" : h).trim());
  if (IMP_TARGETS.every(f => head.includes(f))){ loadCSVText(text, nm || "CSV"); return; }
  impOpenTable(nm, raw, "");
}

async function impHandleFile(file){
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    await impHandleBuffer(file.name, buf);
  } catch (e){
    console.error(e);
    toast("读取失败：" + ((e && e.message) || e));
  }
}

window.__imp = { file: impHandleFile, buffer: impHandleBuffer, open: impOpenTable };

/* ================= 一键抓取（聚水潭利润报表 · 接口直连） ================= */
/* 分工：
 *   界面与条件拼装在这里；开页面、发请求、取文件交给后台（bg.js）+ 页面脚本（jst.js）。
 *   条件结构照抄聚水潭页面的真实请求（2026-11-23 取证），字段顺序也保持一致。
 *   条件里存的是「语义 + 具体日期」，日期在点下按钮那一刻才换算，明天再点就是新的一天。
 */
const JST_KEY = "adlog_jst_v1";
const JST_FILE_KEY = "adledger_jst_file_v1";
const JST_DATES = [["last7","近7天"],["last14","近14天"],["last30","近30天"],["cm","本月"],["lm","上月"],["custom","自定义"]];
let JSTUI = { shops: [], picked: new Set(), presetId: "", dateMode: "last7", from: "", to: "", busy: false, q: "" };

function jstExt(){ try { return !!(window.chrome && chrome.runtime && chrome.runtime.id); } catch (e){ return false; } }
function jstCfg(){
  try {
    const o = JSON.parse(ST.get(JST_KEY) || "{}") || {};
    if (!Array.isArray(o.presets)) o.presets = [];
    return o;
  } catch (e){ return { presets: [] }; }
}
function jstCfgSave(o){ try { ST.set(JST_KEY, JSON.stringify(o)); } catch (e){} }
function jstPad(n){ return (n < 10 ? "0" : "") + n; }
function jstD(d){ return d.getFullYear() + "-" + jstPad(d.getMonth() + 1) + "-" + jstPad(d.getDate()); }

/* 近 N 天按「今天往前推」算：8 号点近 7 天 = 1 号~7 号，和聚水潭的「7天」口径一致 */
function jstRange(mode, from, to){
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = n => { const d = new Date(t0); d.setDate(d.getDate() + n); return d; };
  if (mode === "custom") return { a: from || jstD(day(-7)), b: to || jstD(day(-1)) };
  let a, b;
  if (mode === "last14"){ a = day(-14); b = day(-1); }
  else if (mode === "last30"){ a = day(-30); b = day(-1); }
  else if (mode === "cm"){ a = new Date(t0.getFullYear(), t0.getMonth(), 1); b = day(-1); }
  else if (mode === "lm"){ a = new Date(t0.getFullYear(), t0.getMonth() - 1, 1); b = new Date(t0.getFullYear(), t0.getMonth(), 0); }
  else { a = day(-7); b = day(-1); }
  let A = jstD(a), B = jstD(b);
  if (B < A) B = A;                       /* 月初第一天点「本月」时不留反向区间 */
  return { a: A, b: B };
}

/* 报表条件：字段与取值都照搬页面请求，空筛选项也要留着（后端按固定结构解析） */
function jstCond(p){
  const r = jstRange(p.dateMode, p.from, p.to);
  const s = new Date(r.a + "T00:00:00");
  const e = new Date(r.b + "T23:59:59.999");
  return {
    seachType: 0,
    combineDate: [s.toISOString(), e.toISOString()],
    dateFld: "pay_date",
    returnDateType: "cmf",
    shop: p.shops.slice(),
    act: [],
    groupByType: "shop_i_id",
    groupList: ["shop_id", "datevalue", "shop_i_id"],
    effective: "nosplit",
    isShowOnlineSkuName: true,
    backGoodsType: 0,
    splitCombine: true,
    isShowOtherPromotion: true,
    wmsCoidList: [],
    buIdList: [],
    drpCoidtos: [],
    skuIn: { type: "anyonesku", values: [], select: "in" },
    skuOut: { type: "anyonesku", values: [], select: "out" },
    labelIn: { type: "anyonelabel", values: [], select: "in" },
    labelout: { type: "anyonelabel", values: [], select: "out" },
    creatorList: [],
    cusIdList: [],
    skuLabelIn: { type: "anyoneskulabel", values: [], select: "in" },
    skuLabelOut: { type: "anyoneskulabel", values: [], select: "out" },
    brands: [],
    categorys: [],
    vcNames: [],
    goodsCostGroup: { skuCostAmountSearchType: { value: 2, label: "按固定值搜索商品成本" }, value: "", values: ["", ""] },
    onlineSkuName: "",
    beginDate: r.a,
    endDate: r.b,
    skuGroup: "shop_i_id",
    orderType: [],
    skuCostAmountSearchType: 2,
    skuCostAmountList: [],
    isUseCustomizeRate: false,
    isOL: true,
    indexPerferUnType: "pfskuprofit_performance_report",
    isCrossBorder: false
  };
}

function jstStatus(text, kind){
  const el = $("jstHint");
  if (!el) return;
  el.textContent = text || "";
  el.className = "mhint" + (kind === "err" ? " warn" : kind === "ok" ? " ok" : "");
}
function jstBusy(on){
  JSTUI.busy = !!on;
  const b = $("jstGo");
  if (b){ b.disabled = !!on; b.textContent = on ? "正在抓取…" : "开始抓取并导入"; }
}

/* ---------- 界面 ---------- */
function jstEnsureModal(){
  if ($("jstModal")) return;
  const d = document.createElement("div");
  d.className = "rmodal";
  d.id = "jstModal";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.innerHTML =
    '<div class="mbox">' +
      '<div class="mhead"><b>⚡ 一键抓取 · 聚水潭利润报表</b><button type="button" class="mclose" id="jstClose" aria-label="关闭">✕</button></div>' +
      '<div class="mbody">' +
        '<div class="jstrow"><span class="lbl">预设</span><select id="jstPreset"></select>' +
          '<button type="button" class="btn ghost" id="jstPSave" title="把当前店铺和时间存回选中的预设">保存</button>' +
          '<button type="button" class="btn ghost" id="jstPAs">另存为…</button>' +
          '<button type="button" class="btn ghost" id="jstPDel">删除</button>' +
          '<span class="mhint" id="jstPHint"></span></div>' +
        '<div class="jstrow hidden" id="jstNameRow"><span class="lbl">名称</span>' +
          '<input type="text" id="jstName" maxlength="24" placeholder="例如：主力店铺 · 近7天">' +
          '<button type="button" class="btn primary" id="jstNameOk">建立</button></div>' +
        '<div class="jstsec">' +
          '<div class="jstsh"><b>🏪 店铺</b><span class="hint" id="jstShopCnt"></span>' +
            '<input type="text" id="jstShopQ" placeholder="搜索店铺 / 平台">' +
            '<button type="button" class="btn ghost" id="jstShopAll">全选</button>' +
            '<button type="button" class="btn ghost" id="jstShopNone">清空</button>' +
            '<button type="button" class="btn ghost" id="jstShopRefresh">刷新</button></div>' +
          '<div class="jstshops" id="jstShops"></div>' +
        '</div>' +
        '<div class="jstsec">' +
          '<div class="jstsh"><b>📅 时间</b><span class="jstchips" id="jstDates"></span></div>' +
          '<div class="jstdate" id="jstCustomRow"><span>自定义</span><input type="date" id="jstFrom"><span>~</span><input type="date" id="jstTo"></div>' +
        '</div>' +
      '</div>' +
      '<div class="mfoot"><span class="mhint" id="jstHint">只用你已登录的聚水潭账号取数，不上传任何信息</span>' +
        '<button type="button" class="btn" id="jstCancel">取消</button>' +
        '<button type="button" class="btn primary" id="jstGo">开始抓取并导入</button></div>' +
    '</div>';
  document.body.appendChild(d);

  const close = () => { d.classList.remove("show"); };
  $("jstClose").onclick = close;
  $("jstCancel").onclick = close;
  d.addEventListener("click", e => { if (e.target === d) close(); });
  $("jstGo").onclick = jstGo;
  $("jstShopRefresh").onclick = () => jstLoadShops(true);
  $("jstShopAll").onclick = () => { jstShopsNow().forEach(s => JSTUI.picked.add(s.id)); jstPaintShops(); };
  $("jstShopNone").onclick = () => { JSTUI.picked.clear(); jstPaintShops(); };
  $("jstShopQ").oninput = e => { JSTUI.q = e.target.value || ""; jstPaintShops(); };
  $("jstShops").addEventListener("change", e => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.jstshop) return;
    const id = Number(t.dataset.jstshop);
    if (t.checked) JSTUI.picked.add(id); else JSTUI.picked.delete(id);
    jstPaintShopCnt();
  });
  $("jstDates").addEventListener("click", e => {
    const b = e.target.closest ? e.target.closest("[data-jstdate]") : null;
    if (!b) return;
    JSTUI.dateMode = b.dataset.jstdate;
    const r = jstRange(JSTUI.dateMode, $("jstFrom").value, $("jstTo").value);
    $("jstFrom").value = r.a;
    $("jstTo").value = r.b;
    jstPaintDates();
  });
  $("jstFrom").onchange = $("jstTo").onchange = () => { JSTUI.dateMode = "custom"; jstPaintDates(); };
  $("jstPreset").onchange = e => jstApplyPreset(e.target.value);
  $("jstPSave").onclick = () => jstSavePreset(false);
  $("jstPAs").onclick = () => {
    const row = $("jstNameRow");
    row.classList.remove("hidden");
    $("jstName").value = "预设 " + jstD(new Date());
    $("jstName").focus();
    $("jstName").select();
  };
  $("jstNameOk").onclick = () => jstSavePreset(true);
  $("jstName").onkeydown = e => { if (e.key === "Enter") jstSavePreset(true); };
  $("jstPDel").onclick = jstDelPreset;
}

function jstShopsNow(){
  const q = (JSTUI.q || "").trim().toLowerCase();
  if (!q) return JSTUI.shops;
  return JSTUI.shops.filter(s => (s.name || "").toLowerCase().includes(q) || (s.site || "").toLowerCase().includes(q));
}

function jstPaintShopCnt(){
  const el = $("jstShopCnt");
  if (el) el.textContent = JSTUI.picked.size ? ("已选 " + JSTUI.picked.size + " 个") : "未选";
}

function jstPaintShops(){
  const box = $("jstShops");
  if (!box) return;
  const list = jstShopsNow();
  if (!JSTUI.shops.length){
    box.innerHTML = '<div class="jsthint">还没有店铺清单。点「刷新」从聚水潭拉一次（需要浏览器里已登录聚水潭）。</div>';
  } else if (!list.length){
    box.innerHTML = '<div class="jsthint">没有匹配「' + esc(JSTUI.q) + '」的店铺。</div>';
  } else {
    const groups = {};
    list.forEach(s => { const k = s.site || "其他"; (groups[k] = groups[k] || []).push(s); });
    let html = "";
    Object.keys(groups).forEach(g => {
      const arr = groups[g];
      html += '<div class="jstg"><div class="jstgh">' + esc(g) + '（' + arr.length + '）</div><div class="jstgitems">';
      arr.forEach(s => {
        html += '<label class="jsti" title="' + esc(s.name) + '"><input type="checkbox" data-jstshop="' + Number(s.id) + '"' +
          (JSTUI.picked.has(Number(s.id)) ? " checked" : "") + '>' + esc(s.name) + '</label>';
      });
      html += '</div></div>';
    });
    box.innerHTML = html;
  }
  jstPaintShopCnt();
}

function jstPaintDates(){
  const box = $("jstDates");
  if (box){
    box.innerHTML = JST_DATES.map(d =>
      '<button type="button" class="btn ghost' + (JSTUI.dateMode === d[0] ? " on" : "") + '" data-jstdate="' + d[0] + '">' + d[1] + '</button>'
    ).join("");
  }
  const r = jstRange(JSTUI.dateMode, JSTUI.from, JSTUI.to);
  JSTUI.from = r.a; JSTUI.to = r.b;
  if ($("jstFrom")) $("jstFrom").value = r.a;
  if ($("jstTo")) $("jstTo").value = r.b;
}

function jstPaintPresets(){
  const sel = $("jstPreset");
  if (!sel) return;
  const c = jstCfg();
  sel.innerHTML = '<option value="">（临时条件，未保存）</option>' + c.presets.map(p =>
    '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'
  ).join("");
  sel.value = JSTUI.presetId || "";
  const cur = c.presets.filter(p => p.id === JSTUI.presetId)[0];
  const h = $("jstPHint");
  if (h) h.textContent = cur ? ("店铺 " + (cur.shops || []).length + " 个 · 更新于 " + new Date(cur.at || Date.now()).toLocaleDateString("zh-CN")) : "选一个预设，或直接调好条件后「另存为」";
}

function jstApplyPreset(id){
  const c = jstCfg();
  const p = c.presets.filter(x => x.id === id)[0];
  JSTUI.presetId = p ? p.id : "";
  if (p){
    JSTUI.picked = new Set((p.shops || []).map(Number).filter(Boolean));
    JSTUI.dateMode = p.dateMode || "last7";
    JSTUI.from = p.from || "";
    JSTUI.to = p.to || "";
  }
  c.last = JSTUI.presetId;
  jstCfgSave(c);
  jstPaintShops();
  jstPaintDates();
  jstPaintPresets();
}

function jstSavePreset(asNew){
  const c = jstCfg();
  const shops = Array.from(JSTUI.picked);
  if (!shops.length){ toast("先选至少一个店铺"); return; }
  if (asNew){
    const name = ($("jstName") && $("jstName").value || "").trim();
    if (!name){ toast("给预设起个名字"); return; }
    const item = { id: "p" + Date.now().toString(36), name: name.slice(0, 24), shops: shops, dateMode: JSTUI.dateMode, from: JSTUI.from, to: JSTUI.to, at: Date.now() };
    c.presets.push(item);
    JSTUI.presetId = item.id;
    $("jstNameRow").classList.add("hidden");
  } else {
    const item = c.presets.filter(p => p.id === JSTUI.presetId)[0];
    if (!item){ jstSavePreset(true); return; }
    item.shops = shops;
    item.dateMode = JSTUI.dateMode;
    item.from = JSTUI.from;
    item.to = JSTUI.to;
    item.at = Date.now();
  }
  c.last = JSTUI.presetId;
  jstCfgSave(c);
  jstPaintPresets();
  toast("预设已保存");
}

function jstDelPreset(){
  const c = jstCfg();
  const item = c.presets.filter(p => p.id === JSTUI.presetId)[0];
  if (!item){ toast("还没选中预设"); return; }
  c.presets = c.presets.filter(p => p.id !== item.id);
  if (c.last === item.id) c.last = "";
  JSTUI.presetId = "";
  jstCfgSave(c);
  jstPaintPresets();
  toast("已删除预设「" + item.name + "」");
}

/* ---------- 取数与执行 ---------- */
async function jstLoadShops(force){
  if (!jstExt()) return;
  const c = jstCfg();
  if (!force && c.shopCache && Array.isArray(c.shopCache.list) && c.shopCache.list.length){
    JSTUI.shops = c.shopCache.list;
    if (!JSTUI.picked.size) JSTUI.shops.forEach(s => JSTUI.picked.add(Number(s.id)));
    jstPaintShops();
    return;
  }
  const box = $("jstShops");
  if (box) box.innerHTML = '<div class="jsthint">正在从聚水潭获取店铺清单…（没开报表页会自动在后台开一个）</div>';
  try {
    const r = await chrome.runtime.sendMessage({ type: "jst:shops" });
    if (!r || !r.ok) throw new Error((r && r.msg) || "获取失败");
    JSTUI.shops = r.shops || [];
    const c2 = jstCfg();
    c2.shopCache = { at: Date.now(), list: JSTUI.shops };
    jstCfgSave(c2);
    if (!JSTUI.picked.size) JSTUI.shops.forEach(s => JSTUI.picked.add(Number(s.id)));
    jstPaintShops();
  } catch (e){
    if (box) box.innerHTML = '<div class="jsthint">获取店铺失败：' + esc((e && e.message) || e) + '</div>';
  }
}

async function jstGo(){
  if (JSTUI.busy) return;
  const shops = Array.from(JSTUI.picked).filter(Boolean);
  if (!shops.length){ jstStatus("先选至少一个店铺", "err"); return; }
  const r0 = jstRange(JSTUI.dateMode, JSTUI.from, JSTUI.to);
  jstBusy(true);
  jstStatus("正在连接聚水潭…");
  try {
    const cond = jstCond({ shops: shops, dateMode: JSTUI.dateMode, from: r0.a, to: r0.b });
    const r = await chrome.runtime.sendMessage({ type: "jst:run", condition: cond });
    if (!r || !r.ok) throw new Error((r && r.msg) || "执行失败");
    jstStatus("已生成 " + r.count + " 行，正在取回文件…");
    const box = (await chrome.storage.local.get(JST_FILE_KEY))[JST_FILE_KEY];
    if (!box) throw new Error("数据没有落到本地，请重试");
    await chrome.storage.local.remove(JST_FILE_KEY).catch(() => {});
    if (box.kind === "rows" && Array.isArray(box.rows)){
      /* 直接取数通道：已经是二维表，跳过文件解析 */
      jstStatus("正在导入 " + (box.rows.length - 1) + " 行…");
      impOpenTable(box.name || "聚水潭报表.csv", box.rows, "", true);
    } else {
      if (!box.b64) throw new Error("文件没有落到本地，请重试");
      const bin = atob(box.b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      jstStatus("正在解析并导入 " + Math.round(u8.length / 1024) + "KB…");
      await impHandleBuffer(box.name || r.name || "聚水潭导出.xlsx", u8.buffer, { auto: true });
    }
    jstStatus("完成：" + r.count + " 行已导入", "ok");
    setTimeout(() => { const m = $("jstModal"); if (m) m.classList.remove("show"); }, 700);
  } catch (e){
    console.error(e);
    const msg = String((e && e.message) || e);
    /* 文件取不回来但已经交给浏览器下载了：这不是失败，只是慢一步 */
    if (/已改用浏览器下载/.test(msg)) jstStatus(msg);
    else jstStatus("失败：" + msg, "err");
  } finally {
    jstBusy(false);
  }
}

function jstOpen(){
  jstEnsureModal();
  const c = jstCfg();
  if (c.last && !JSTUI.presetId) JSTUI.presetId = c.last;
  jstPaintPresets();
  if (JSTUI.presetId) jstApplyPreset(JSTUI.presetId);
  jstPaintDates();
  jstPaintShops();
  jstStatus("只用你已登录的聚水潭账号取数，不上传任何信息");
  $("jstModal").classList.add("show");
  jstLoadShops(false);
}

/* 只在扩展环境露出入口；单文件版本没有后台，按钮直接不显示 */
(function jstBoot(){
  const btn = $("btnJst");
  if (!btn) return;
  if (!jstExt()){ btn.style.display = "none"; return; }
  btn.style.display = "";
  btn.onclick = jstOpen;
  try {
    chrome.runtime.onMessage.addListener(function (m){
      if (m && m.type === "jst:progress" && $("jstModal") && $("jstModal").classList.contains("show")) jstStatus(m.text);
    });
  } catch (e){}
})();

/* ================= 工具 ================= */
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function isDateStr(v){ return /^\d{4}-\d{1,2}(-\d{1,2})?/.test(String(v).trim()); }
/* 通用比较器：日期列强制按字符串比较，避免 parseFloat 把 "2026-11-04" 截成 2026 导致同年日期全相等 */
function cmpValues(col,va,vb,dir,forceNum){
  va=String(va==null?"":va).trim(); vb=String(vb==null?"":vb).trim();
  if(!(forceNum||MONEY_COLS.has(col)||PCT_COLS.has(col))&&isDateStr(va)&&isDateStr(vb)){
    return va<vb?-dir:va>vb?dir:0;
  }
  const na=toNum(va), nb=toNum(vb);
  if(forceNum||MONEY_COLS.has(col)||PCT_COLS.has(col)||(!isNaN(na)&&!isNaN(nb)&&va!==""&&vb!=="")){
    if(!isNaN(na)&&!isNaN(nb)) return (na-nb)*dir;
    if(isNaN(na)) return 1; if(isNaN(nb)) return -1;
  }
  return va.localeCompare(vb,"zh")*dir;
}

/* ================= 汇总 ================= */
function computeTotals(rows){
  const t={count:rows.length, sm:0, sc:0, pf:0, gl:0, ad:0};
  for(const r of rows){
    const a=toNum(r["商品销售数据-商品销售金额(扣退)"]); if(!isNaN(a)) t.sm+=a;
    const c=toNum(r["商品销售数据-商品销售成本(扣退)"]); if(!isNaN(c)) t.sc+=c;
    const p=toNum(r["利润-经营利润"]); if(!isNaN(p)) t.pf+=p;
    const g=toNum(r["利润-毛利额"]); if(!isNaN(g)) t.gl+=g;
    const d=toNum(r["利润-其中：推广费"]); if(!isNaN(d)) t.ad+=d;
  }
  return t;
}
function totalCell(col, t){
  switch(col){
    case "商品销售数据-商品销售金额(扣退)": return fmtMoney(t.sm);
    case "商品销售数据-商品销售成本(扣退)": return fmtMoney(t.sc);
    case "利润-经营利润": return `<span class="${t.pf>=0?"pos":"neg"}">${fmtMoney(t.pf)}</span>`;
    case "利润-毛利额": return `<span class="${t.gl>=0?"pos":"neg"}">${fmtMoney(t.gl)}</span>`;
    case "利润-其中：推广费": return fmtMoney(t.ad);
    case "经营利润-占比": return t.sm? fmtPct(t.pf/t.sm*100) : "—";
    case "毛利额-占比": return t.sm? fmtPct(t.gl/t.sm*100) : "—";
    case "其中：推广费-占比": return t.sm? fmtPct(t.ad/t.sm*100) : "—";
    default: return "";
  }
}
function toNum(v){ if(v==null||v==="") return NaN; const n=parseFloat(String(v).replace(/,/g,"").replace(/%$/,"")); return isNaN(n)?NaN:n; }
function fmtMoney(v){ const n=toNum(v); if(isNaN(n)) return "—"; return "¥"+n.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtPct(v){ const n=toNum(v); if(isNaN(n)) return "—"; return n.toFixed(2)+"%"; }
/* 小数形式的比率（如效果判据里的平均利润率 0.083）→ "8.3%" */
function fPr(v){ return (typeof v==="number"&&!isNaN(v))?(v*100).toFixed(1)+"%":"—"; }
function moneyCls(v){ const n=toNum(v); return isNaN(n)?"":n>0?"pos":n<0?"neg":""; }
let toastTimer=null;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.style.display="block"; clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.style.display="none",2600); }
/* 一键复制（捕获阶段拦截，避免触发抽屉钻取） */
function copyText(s){
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(s).then(()=>toast("已复制："+(s.length>30?s.slice(0,30)+"…":s))).catch(()=>fallbackCopy(s));
  } else fallbackCopy(s);
}
function fallbackCopy(s){
  const ta=document.createElement("textarea"); ta.value=s;
  ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta);
  ta.focus(); ta.select();
  try{ document.execCommand("copy"); toast("已复制："+(s.length>30?s.slice(0,30)+"…":s)); }
  catch(_){ toast("复制失败，请手动复制"); }
  ta.remove();
}
document.addEventListener("click",e=>{
  const c=e.target.closest(".cpy");
  if(!c) return;
  e.stopPropagation(); e.preventDefault();
  copyText(c.dataset.cpy||"");
},true);

/* ================= 筛选 / 搜索 / 排序 ================= */
function computeFiltered(){
  const kw = searchText.trim().toLowerCase();
  const searchCols = HEADERS.filter(h=>["店铺名称","日期","店铺款式编码","商品名称","款式编码(参考)","商品简称","颜色及规格","商品类目"].includes(h));
  const useSearchCols = searchCols.length?searchCols:["店铺名称","日期","店铺款式编码","商品名称"];
  filtered = ROWS.filter(r=>{
    if(kw){
      let hit=false;
      for(const c of useSearchCols){ if(String(r[c]||"").toLowerCase().includes(kw)){hit=true;break;} }
      if(!hit) return false;
    }
    for(const c in colFilters){
      const f=colFilters[c];
      if(f.type==="values"){ if(!f.vals.has(r[c]||"")) return false; }
      else if(f.type==="text"){ if(String(r[c]||"").toLowerCase().indexOf(f.text)<0) return false; }
      else if(f.type==="num"){ const n=toNum(r[c]); if(isNaN(n)||!numMatch(f,n)) return false; }
      else if(f.type==="daterange"){ const v=r[c]||""; if(!v||v<f.a||v>f.b) return false; }
    }
    return true;
  });
  const col=sort.col, dir=sort.dir;
  filtered.sort((a,b)=>cmpValues(col,a[col],b[col],dir,false));
}

/* ================= 渲染 ================= */
function render(){
  computeFiltered();
  updateSortInfo();
  renderStats(); renderFilterChips(); renderTable(); renderPager();
}

function renderStats(){
  let sm=0,sc=0,pf=0,gl=0,ad=0, hasPf=false;
  for(const r of filtered){
    const a=toNum(r["商品销售数据-商品销售金额(扣退)"]); if(!isNaN(a)) sm+=a;
    const c=toNum(r["商品销售数据-商品销售成本(扣退)"]); if(!isNaN(c)) sc+=c;
    const p=toNum(r["利润-经营利润"]); if(!isNaN(p)) pf+=p;
    const g=toNum(r["利润-毛利额"]); if(!isNaN(g)) gl+=g;
    const d=toNum(r["利润-其中：推广费"]); if(!isNaN(d)){ad+=d;hasPf=true;}
  }
  const f=(v,cls)=>`<div class="stat"><div class="label">${v.label}</div><div class="val ${cls||""}">${v.text}</div></div>`;
  $("statsBar").innerHTML =
    f({label:"数据行数",text:filtered.length.toLocaleString()})+
    f({label:"成交金额合计",text:fmtMoney(sm),"":"money"})+
    f({label:"商品成本合计",text:fmtMoney(sc)})+
    f({label:"净利润合计",text:fmtMoney(pf),cls:pf>=0?"pos":"neg"})+
    f({label:"毛利润合计",text:fmtMoney(gl),cls:gl>=0?"pos":"neg"})+
    (hasPf?f({label:"推广费用合计",text:fmtMoney(ad)}):"");
}

function renderFilterChips(){
  const box=$("filterChips"); box.innerHTML="";
  const entries=Object.entries(colFilters);
  if(!entries.length) return;
  const label = document.createElement("span"); label.style.cssText="font-size:12px;color:var(--text3);align-self:center"; label.textContent="筛选：";
  box.appendChild(label);
  for(const [c,f] of entries){
    const chip=document.createElement("span"); chip.className="filterchip";
    let txt;
    if(f.type==="values") txt = `${dispName(c)}: ${f.vals.size} 项`;
    else if(f.type==="num") txt = f.op==="between" ? `${dispName(c)}: ${f.a}~${f.b}` : `${dispName(c)} ${(NUM_OP_LABEL[f.op]||f.op)} ${f.a}`;
    else if(f.type==="daterange") txt = `${dispName(c)}: ${f.a} ~ ${f.b}`;
    else txt = `${dispName(c)} 含 "${f.text}"`;
    chip.innerHTML = esc(txt)+' <span class="x">✕</span>';
    chip.title = c;
    chip.onclick=()=>{ delete colFilters[c]; page=1; render(); };
    box.appendChild(chip);
  }
}

function sumColWidths(){ return visibleCols.reduce((a,c)=>a+(colWidths[c]||120),0); }
function applyTableLayout(){
  const table=$("mainTable");
  const old=document.getElementById("tcolgroup"); if(old) old.remove();
  if(fixedLayout){
    const cg=document.createElement("colgroup"); cg.id="tcolgroup";
    cg.innerHTML=visibleCols.map(c=>`<col style="width:${colWidths[c]||120}px">`).join("")+`<col style="width:${REC_COL_W}px">`;
    table.insertBefore(cg,table.firstChild);
    table.style.tableLayout="fixed";
    table.style.width=Math.max(sumColWidths()+REC_COL_W, $("tableWrap").clientWidth)+"px";
    table.classList.add("fixed");
  }else{
    table.style.tableLayout=""; table.style.width=""; table.classList.remove("fixed");
  }
}
function setColWidth(col,w){
  colWidths[col]=w;
  const idx=visibleCols.indexOf(col);
  const cg=document.getElementById("tcolgroup");
  if(cg&&idx>=0&&cg.children[idx]) cg.children[idx].style.width=w+"px";
  const table=$("mainTable");
  table.style.width=Math.max(sumColWidths()+REC_COL_W, $("tableWrap").clientWidth)+"px";
  const dg=document.querySelector("#dBody colgroup");
  if(dg&&idx>=0&&dg.children[idx]) dg.children[idx].style.width=w+"px";
  const dt=document.querySelector("#dBody table");
  if(dt&&dt.style.tableLayout==="fixed") dt.style.width=Math.max(sumColWidths(), dt.parentElement.clientWidth)+"px";
}
function renderTable(){
  const thead=$("thead"), tbody=$("tbody"), table=$("mainTable");
  applyTableLayout();
  if(!ROWS.length){ table.classList.add("hidden"); $("emptyState").classList.remove("hidden"); $("pager").style.display="none"; $("statsBar").style.display="none"; return; }
  table.classList.remove("hidden"); $("emptyState").classList.add("hidden"); $("pager").style.display="flex"; $("statsBar").style.display="flex";

  let h="<tr>";
  for(const c of visibleCols){
    const arrow = sort.col===c ? `<span class="arrow">${sort.dir>0?"▲":"▼"}</span>` : `<span class="arrow" style="opacity:.25">⇅</span>`;
    const fon = colFilters[c] ? " on" : "";
    const isNum = MONEY_COLS.has(c)||PCT_COLS.has(c);
    h+=`<th class="${isNum?"num":""}" data-col="${esc(c)}" draggable="true" title="拖动调整列顺序 / 点击排序"><span class="hwrap"><span class="ctitle" title="${esc(c)}">${dispName(c)}</span>${arrow}<span class="ficon${fon}" data-f="${esc(c)}" title="筛选">▾</span></span><span class="rz" data-rz="${esc(c)}" title="拖动调整列宽"></span></th>`;
  }
  h+=`<th class="rec-th" title="该链接最近一次投放调整；点击查看时间线与效果对比"><span class="hwrap"><span>调整记录</span></span></th>`;
  h+="</tr>";
  thead.innerHTML=h;

  const total=filtered.length;
  const maxPage=Math.max(1,Math.ceil(total/pageSize));
  if(page>maxPage) page=maxPage;
  const start=(page-1)*pageSize, rows=filtered.slice(start,start+pageSize);

  let b="";
  for(const r of rows){
    const dmk=(typeof adjDateMark==="function")?adjDateMark(r["店铺款式编码"],r["日期"],true):"";
    b+= dmk?'<tr class="has-adj">':"<tr>";
    for(const c of visibleCols){
      const v=r[c]??"";
      if(c==="图片"){
        b+= v? `<td><img class="thumb" src="${esc(v)}" loading="lazy" data-img="${esc(v)}" data-imgfail="thumb"></td>`
             : `<td><div class="thumb-ph">无图</div></td>`;
        continue;
      }
      const numCls = MONEY_COLS.has(c)||PCT_COLS.has(c) ? " num":"";
      let inner;
      if(MONEY_COLS.has(c)) inner=`<span class="${moneyCls(v)}">${fmtMoney(v)}</span>`;
      else if(PCT_COLS.has(c)) inner=`<span class="pct">${fmtPct(v)}</span>`;
      else inner=esc(v)+(COPY_COLS.has(c)&&v?`<span class="cpy" data-cpy="${esc(v)}" title="点击复制">⧉</span>`:"");
      if(dmk&&c==="日期") inner+=dmk;
      const click = CLICK_COLS.has(c)&&v ? " clickable" : "";
      b+=`<td class="${numCls}${click}"${CLICK_COLS.has(c)?` data-clickcol="${esc(c)}" data-clickval="${esc(v)}"`:""}>${inner}</td>`;
    }
    b+=(typeof recCellHtml==="function"?recCellHtml(r):"<td></td>");
    b+="</tr>";
  }
  tbody.innerHTML=b;

  // 汇总行（基于当前筛选的全部行，吸底常显）
  const t=computeTotals(filtered);
  let f=`<tr>`;
  visibleCols.forEach((c,idx)=>{
    const numCls = MONEY_COLS.has(c)||PCT_COLS.has(c) ? " num":"";
    const label = idx===0 ? `<span class="sumlabel">汇总（${t.count.toLocaleString()} 行）</span>` : totalCell(c,t);
    f+=`<td class="${numCls}">${label}</td>`;
  });
  f+=`<td class="rec-foot"></td>`;
  f+=`</tr>`;
  $("tfoot").innerHTML=f;
}

function renderPager(){
  const total=filtered.length, maxPage=Math.max(1,Math.ceil(total/pageSize));
  $("rowCount").textContent=`共 ${total.toLocaleString()} 行（全部数据 ${ROWS.length.toLocaleString()} 行）`;
  $("pageInfo").textContent=`${page} / ${maxPage}`;
  $("pgFirst").disabled=$("pgPrev").disabled=page<=1;
  $("pgNext").disabled=$("pgLast").disabled=page>=maxPage;
}

/* ================= 列选择器 ================= */
function buildColPop(){
  const list=$("colPopList"); let h="";
  HEADERS.forEach((hd,i)=>{
    h+=`<label class="pitem"><input type="checkbox" data-hcol="${esc(hd)}" ${visibleCols.includes(hd)?"checked":""}><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(hd)}">${dispName(hd)}</span><span class="grp">#${i+1}</span></label>`;
  });
  list.innerHTML=h;
  list.onchange=e=>{
    const cb=e.target; if(!cb.dataset.hcol) return;
    const c=cb.dataset.hcol;
    if(cb.checked){ if(!visibleCols.includes(c)) visibleCols.push(c); }
    else visibleCols=visibleCols.filter(x=>x!==c);
    // 保持 CSV 原顺序
    visibleCols.sort((a,b)=>HEADERS.indexOf(a)-HEADERS.indexOf(b));
    colWidths={}; fixedLayout=false;
    renderTable();
  };
}
function setCols(mode){
  visibleCols = mode==="all" ? [...HEADERS] : DEFAULT_COLS.filter(c=>HEADERS.includes(c));
  colWidths={}; fixedLayout=false;
  buildColPop(); renderTable();
}
function showColPop(anchor){
  const pop=$("colPop"); pop.style.display="flex";
  const r=anchor.getBoundingClientRect();
  let left=r.left-240; if(left<8) left=8;
  pop.style.left=left+"px"; pop.style.top=Math.min(r.bottom+6, innerHeight-480)+"px";
}
function hideColPop(){ $("colPop").style.display="none"; }

/* ================= 筛选弹层 ================= */
let filterPopCol=null;
/* 求除 excludeCol 外、满足搜索+其他筛选的基础行 */
function filterBaseRows(excludeCol){
  const others = {...colFilters}; delete others[excludeCol];
  const kw=searchText.trim().toLowerCase();
  return ROWS.filter(r=>{
    if(kw){ let hit=false; for(const c of ["店铺名称","日期","店铺款式编码","商品名称","款式编码(参考)","商品简称","颜色及规格","商品类目"]){ if(String(r[c]||"").toLowerCase().includes(kw)){hit=true;break;} } if(!hit) return false; }
    for(const c in others){
      const f=others[c];
      if(f.type==="values"){ if(!f.vals.has(r[c]||"")) return false; }
      else if(f.type==="text"){ if(String(r[c]||"").toLowerCase().indexOf(f.text)<0) return false; }
      else if(f.type==="num"){ const n=toNum(r[c]); if(isNaN(n)||!numMatch(f,n)) return false; }
      else if(f.type==="daterange"){ const v=r[c]||""; if(!v||v<f.a||v>f.b) return false; }
    }
    return true;
  });
}
function numMatch(f,n){
  switch(f.op){
    case "gt": return n>f.a;
    case "gte": return n>=f.a;
    case "lt": return n<f.a;
    case "lte": return n<=f.a;
    case "eq": return n===f.a;
    case "ne": return n!==f.a;
    case "between": return n>=f.a&&n<=f.b;
    default: return true;
  }
}
const NUM_OPS=[["gte","≥ 大于等于"],["gt","＞ 大于"],["lte","≤ 小于等于"],["lt","＜ 小于"],["eq","= 等于"],["ne","≠ 不等于"],["between","介于（含边界）"]];

function showFilterPop(anchor, col){
  filterPopCol=col;
  const oldPop=document.querySelector("#fpop"); if(oldPop) oldPop.remove();
  const pop=document.createElement("div"); pop.className="popover"; pop.id="fpop";
  document.body.appendChild(pop);
  const base=filterBaseRows(col);
  const cur=colFilters[col];
  const isNumericCol=MONEY_COLS.has(col)||PCT_COLS.has(col);

  if(col==="日期"){
    /* ---------- 日期列：日历区间选择 + 快捷筛选 ---------- */
    const fmtD=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    const today=new Date();
    const todayStr=fmtD(today), yestStr=fmtD(new Date(today.getFullYear(),today.getMonth(),today.getDate()-1));
    const isDisabled=d=>fmtD(d)>=todayStr;   // 今天及以后不可选
    let selA=null, selB=null;
    if(cur&&cur.type==="daterange"){ selA=cur.a; selB=cur.b; }
    let view=new Date(today.getFullYear(), today.getMonth(), 1);
    if(selA){ const pp=selA.split("-"); view=new Date(+pp[0], +pp[1]-1, 1); }
    pop.style.minWidth="330px";
    pop.innerHTML=`<div class="phead"><span class="title">日期筛选</span></div>
      <div class="ptext">
        <div class="quick">
          <button class="btn" data-q="y">昨天</button><button class="btn" data-q="3">近3天</button><button class="btn" data-q="7">近7天</button>
          <button class="btn" data-q="14">近14天</button><button class="btn" data-q="30">近30天</button>
          <button class="btn" data-q="cm">本月</button><button class="btn" data-q="lm">上月</button>
        </div>
        <div id="calBox"></div>
        <div class="hint" id="calHint" style="margin-top:8px"></div>
      </div>
      <div class="pfoot"><button class="btn" id="fpClear">清除</button><button class="btn primary" id="fpApply">应用</button></div>`;
    const calBox=pop.querySelector("#calBox"), calHint=pop.querySelector("#calHint");
    const inRange=d=>{ const s2=fmtD(d); return selA&&selB&&s2>=selA&&s2<=selB; };
    const isEdge=d=>{ const s2=fmtD(d); return s2===selA||s2===selB; };
    function renderCal(){
      const y=view.getFullYear(), m=view.getMonth();
      let h2=`<div class="calhead"><button class="btn" id="calPrev">‹</button><span class="caltitle">${y} 年 ${m+1} 月</span><button class="btn" id="calNext">›</button></div><div class="grid">`;
      ["一","二","三","四","五","六","日"].forEach(w=>h2+=`<span class="dow">${w}</span>`);
      const firstDow=(new Date(y,m,1).getDay()+6)%7;
      const days=new Date(y,m+1,0).getDate();
      for(let i2=0;i2<firstDow;i2++) h2+=`<span></span>`;
      for(let d=1;d<=days;d++){
        const dt=new Date(y,m,d), s2=fmtD(dt);
        if(isDisabled(dt)){ h2+=`<span class="day off" title="仅可选择昨天及之前的日期">${d}</span>`; continue; }
        const cls="day"+(isEdge(dt)?" sel":inRange(dt)?" inrange":"");
        h2+=`<span class="${cls}" data-d="${s2}">${d}</span>`;
      }
      h2+=`</div>`;
      calBox.innerHTML=h2;
      pop.querySelector("#calPrev").onclick=()=>{ view=new Date(y,m-1,1); renderCal(); };
      pop.querySelector("#calNext").onclick=()=>{ view=new Date(y,m+1,1); renderCal(); };
      calBox.querySelectorAll(".day").forEach(el=>el.onclick=()=>{
        const d=el.dataset.d;
        if(!d||d>=todayStr) return;   // 今天及以后不可选
        if(!selA||(selA&&selB)){ selA=d; selB=null; }
        else if(d<selA){ selA=d; }
        else { selB=d; }
        renderCal(); updateHint();
      });
    }
    function updateHint(){
      calHint.textContent = selA ? (selB?`已选：${selA} ~ ${selB}`:`已选：${selA}（再点一个日期作为结束）`) : "点击日历选择开始与结束日期";
    }
    pop.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{
      const q2=b.dataset.q;
      if(q2==="y"){ selA=selB=yestStr; }
      else if(q2==="cm"){ selA=fmtD(new Date(today.getFullYear(),today.getMonth(),1)); selB=yestStr<selA?selA:yestStr; }
      else if(q2==="lm"){ selA=fmtD(new Date(today.getFullYear(),today.getMonth()-1,1)); selB=fmtD(new Date(today.getFullYear(),today.getMonth(),0)); }
      else { const n=+q2; selA=fmtD(new Date(today.getFullYear(),today.getMonth(),today.getDate()-n)); selB=yestStr; }
      const pp=selA.split("-"); view=new Date(+pp[0],+pp[1]-1,1);
      renderCal(); updateHint();
    });
    pop.querySelector("#fpApply").onclick=()=>{
      if(!selA){ toast("请先选择日期"); return; }
      colFilters[col]={type:"daterange",a:selA,b:selB||selA};
      page=1; render(); pop.remove();
    };
    pop.querySelector("#fpClear").onclick=()=>{ delete colFilters[col]; page=1; render(); pop.remove(); };
    renderCal(); updateHint();
  }else if(isNumericCol){
    /* ---------- 数值列：条件筛选 / 选项勾选 双模式 ---------- */
    const nums=base.map(r=>toNum(r[col])).filter(n=>!isNaN(n));
    const mn=nums.length?Math.min(...nums):0, mx=nums.length?Math.max(...nums):0;
    const f=cur&&cur.type==="num"?cur:null;
    const fmtV=PCT_COLS.has(col)?fmtPct:fmtMoney;
    const counts=new Map();
    for(const r of base){ const v=r[col]||""; counts.set(v,(counts.get(v)||0)+1); }
    const entries=[...counts.entries()].sort((x,y)=>toNum(x[0])-toNum(y[0]));
    pop.style.minWidth="380px";
    pop.innerHTML=`<div class="phead"><span class="title">筛选：${dispName(col)}</span></div>
      <div class="ptext">
        <div class="tabs"><button class="btn fptab on" id="tabCond">条件筛选</button><button class="btn fptab" id="tabVals">选项勾选（${entries.length}）</button></div>
        <div id="fpCond">
          <div class="hint" style="margin:0 0 8px">当前范围：${fmtV(mn)} ~ ${fmtV(mx)}（共 ${base.length.toLocaleString()} 行）</div>
          <select id="fpOp">${NUM_OPS.map(([k,l])=>`<option value="${k}" ${f&&f.op===k?"selected":""}>${l}</option>`).join("")}</select>
          <div class="row" style="margin-top:8px">
            <input type="text" id="fpA" placeholder="数值" value="${f?f.a:""}">
            <span id="fpAnd" style="color:var(--text3)" ${f&&f.op==="between"?"":"hidden"}>~</span>
            <input type="text" id="fpB" placeholder="数值" value="${f&&f.op==="between"?f.b:""}" ${f&&f.op==="between"?"":"hidden"}>
          </div>
          <div class="hint">如：净利润 ＞ 1000；成交金额 介于 500 ~ 2000。可对不同列叠加多个条件。</div>
        </div>
        <div id="fpVals" hidden>
          <input type="text" placeholder="搜索选项…" id="fpSearch">
          <div class="valsbox" id="fpList">
          ${entries.map(([v,cnt])=>{const ck=cur&&cur.type==="values"&&cur.vals.has(v)?"checked":"";return `<label class="pitem" data-v="${esc(v)}"><input type="checkbox" ${ck}><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v)}">${esc(v)}</span><span class="cnt">${cnt}</span></label>`;}).join("")}
          </div>
        </div>
      </div>
      <div class="pfoot" id="fpFoot"></div>`;
    let tab="cond";
    const foot=pop.querySelector("#fpFoot");
    const applyNum=()=>{
      const op=pop.querySelector("#fpOp"), a=pop.querySelector("#fpA"), b=pop.querySelector("#fpB");
      const v=toNum(a.value);
      if(isNaN(v)){ toast("请输入有效数值"); a.focus(); return; }
      if(op.value==="between"){
        const w=toNum(b.value);
        if(isNaN(w)){ toast("请输入有效的第二个数值"); b.focus(); return; }
        colFilters[col]={type:"num",op:"between",a:Math.min(v,w),b:Math.max(v,w)};
      }else colFilters[col]={type:"num",op:op.value,a:v,b:0};
      page=1; render(); pop.remove();
    };
    const applyVals=()=>{
      const list=pop.querySelector("#fpList"); const sel=new Set();
      list.querySelectorAll(".pitem").forEach(it=>{ if(it.querySelector("input").checked) sel.add(it.dataset.v); });
      if(sel.size===0||sel.size===entries.length) delete colFilters[col];
      else colFilters[col]={type:"values",vals:sel};
      page=1; render(); pop.remove();
    };
    const renderFoot=()=>{
      if(tab==="cond"){
        foot.innerHTML=`<button class="btn" id="fpClear">清除</button><button class="btn primary" id="fpApply">应用</button>`;
        pop.querySelector("#fpApply").onclick=applyNum;
        pop.querySelector("#fpClear").onclick=()=>{ delete colFilters[col]; page=1; render(); pop.remove(); };
        const op=pop.querySelector("#fpOp"), a=pop.querySelector("#fpA"), b=pop.querySelector("#fpB"), and=pop.querySelector("#fpAnd");
        op.onchange=()=>{ const isB=op.value==="between"; b.hidden=!isB; and.hidden=!isB; };
        a.onkeydown=b.onkeydown=e=>{ if(e.key==="Enter") applyNum(); };
        a.focus();
      }else{
        foot.innerHTML=`<button class="btn" id="fpAll">全选</button><button class="btn" id="fpInv">反选</button><button class="btn primary" id="fpApply">应用</button>`;
        const list=pop.querySelector("#fpList");
        pop.querySelector("#fpAll").onclick=()=>{ const boxes=[...list.querySelectorAll("input")]; const all=boxes.every(x=>x.checked); boxes.forEach(x=>x.checked=!all); };
        pop.querySelector("#fpInv").onclick=()=>{ list.querySelectorAll("input").forEach(x=>x.checked=!x.checked); };
        pop.querySelector("#fpApply").onclick=applyVals;
        pop.querySelector("#fpSearch").oninput=e=>{ const kw=e.target.value.toLowerCase(); list.querySelectorAll(".pitem").forEach(it=>it.style.display=it.dataset.v.toLowerCase().includes(kw)?"":"none"); };
      }
    };
    const setTab=t=>{
      tab=t;
      pop.querySelector("#tabCond").classList.toggle("on",t==="cond");
      pop.querySelector("#tabVals").classList.toggle("on",t==="vals");
      pop.querySelector("#fpCond").hidden=t!=="cond";
      pop.querySelector("#fpVals").hidden=t!=="vals";
      renderFoot();
    };
    pop.querySelector("#tabCond").onclick=()=>setTab("cond");
    pop.querySelector("#tabVals").onclick=()=>setTab("vals");
    if(cur&&cur.type==="values") setTab("vals"); else setTab("cond");
    }else{
    /* ---------- 文本/日期列：多选勾选（不限选项数量） ---------- */
    const counts=new Map();
    for(const r of base){ const v=r[col]||""; counts.set(v,(counts.get(v)||0)+1); }
    const entries=[...counts.entries()];
    const dateLike=entries.length&&entries.every(([v])=>isDateStr(v));
    if(dateLike) entries.sort((x,y)=>String(x[0]).localeCompare(String(y[0])));
    else entries.sort((x,y)=>y[1]-x[1]||String(x[0]).localeCompare(String(y[0]),"zh"));
    let h=`<div class="phead"><span class="title">筛选：${dispName(col)}（${entries.length} 项）</span></div>`;
    h+=`<div class="psearch"><input type="text" placeholder="搜索选项…" id="fpSearch"></div>`;
    h+=`<div class="plist" id="fpList">`;
    for(const [v,cnt] of entries){
      const checked = cur&&cur.type==="values"&&cur.vals.has(v) ? "checked":"";
      h+=`<label class="pitem" data-v="${esc(v)}"><input type="checkbox" ${checked}><span title="${esc(v)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)||"<i style='color:var(--text3)'>(空)</i>"}</span><span class="cnt">${cnt}</span></label>`;
    }
    h+=`</div>`;
    h+=`<div class="pfoot"><button class="btn" id="fpAll">全选</button><button class="btn" id="fpInv">反选</button><button class="btn primary" id="fpApply">应用</button></div>`;
    pop.innerHTML=h;
    const list=pop.querySelector("#fpList");
    pop.querySelector("#fpSearch").oninput=e=>{
      const kw=e.target.value.toLowerCase();
      list.querySelectorAll(".pitem").forEach(it=>it.style.display=it.dataset.v.toLowerCase().includes(kw)?"":"none");
    };
    pop.querySelector("#fpAll").onclick=()=>{ const boxes=[...list.querySelectorAll("input")]; const all=boxes.every(x=>x.checked); boxes.forEach(x=>x.checked=!all); };
    pop.querySelector("#fpInv").onclick=()=>{ list.querySelectorAll("input").forEach(x=>x.checked=!x.checked); };
    pop.querySelector("#fpApply").onclick=()=>{
      const sel=new Set();
      list.querySelectorAll(".pitem").forEach(it=>{ if(it.querySelector("input").checked) sel.add(it.dataset.v); });
      if(sel.size===0||sel.size===entries.length) delete colFilters[col];
      else colFilters[col]={type:"values",vals:sel};
      page=1; render(); pop.remove();
    };
  }
  pop.style.display="flex";
  const r=anchor.getBoundingClientRect();
  let left=r.left-100; if(left<8) left=8; if(left+300>innerWidth) left=innerWidth-308;
  pop.style.left=left+"px"; pop.style.top="0px";
  setTimeout(()=>{ pop.style.top=Math.min(r.bottom+4, Math.max(8,innerHeight-pop.offsetHeight-10))+"px"; },0);
}

/* ================= 汇总视图 ================= */
let viewMode="detail";
let dateShops=new Set();      // 空 = 全部店铺
let dateLinks=new Set();      // 空 = 所有链接
let dateGroup="date";         // date=按天 | shop=按店铺 | link=按链接
let dateRange={a:"",b:""};    // 汇总页时间范围
let dateSort={key:"date",dir:-1};

const SHOP_SUM_COLS=[
  {key:"shop",label:"店铺"},
  {key:"count",label:"行数",num:true},
  {key:"amount",label:"成交金额",num:true,money:true},
  {key:"cost",label:"商品成本",num:true,money:true},
  {key:"profit",label:"净利润",num:true,money:true},
  {key:"profitRate",label:"净利润率",num:true,rate:true},
  {key:"gm",label:"毛利润",num:true,money:true},
  {key:"gmRate",label:"毛利率",num:true,rate:true},
  {key:"ad",label:"推广费用",num:true,money:true},
  {key:"adRate",label:"推广费占比",num:true,rate:true},
  {key:"roi",label:"平衡投产",num:true,roi:true},
];

/* 平衡投产：扣推广利润率=(推广费+净利润)/成交额（5位小数），平衡投产=1/率（2位小数）；利润率≤0 时无意义 */
function calcRoi(amount,ad,profit){
  const rate=amount?Math.round((ad+profit)/amount*1e5)/1e5:NaN;
  return (isNaN(rate)||rate<=0)?NaN:Math.round(1/rate*100)/100;
}

/* 顶栏控件按页显隐：document 级搜索/排序/显示列/清空筛选 仅在明细页有意义 */
function paintTopbarMode(v){
  const tb=$("topbar"); if(tb) tb.classList.toggle("donly-hide", v!=="detail");
  if(v!=="detail"){ hideColPop(); const cp=document.getElementById("colPop"); if(cp) cp.style.display="none"; }
}

function switchView(v){
  viewMode=v;
  paintTopbarMode(v);
  document.querySelectorAll("#viewTabs .vtab").forEach(t=>t.classList.toggle("on",t.dataset.view===v));
  const detail=v==="detail";
  $("statsBar").classList.toggle("hidden",!detail);
  $("tableWrap").classList.toggle("hidden",!detail);
  $("pager").classList.toggle("hidden",!detail);
  $("sumWrap").classList.toggle("hidden",detail);
  $("dateCtrl").classList.toggle("hidden",detail);
  $("dateSumTableWrap").classList.toggle("hidden",detail);
  if(!detail) renderDateSummary();
}

function aggregateBy(rows,keyCol){
  const map=new Map();
  for(const r of rows){
    const k=r[keyCol]||"(空)";
    let o=map.get(k);
    if(!o){ o={key:k,label:k,count:0,amount:0,cost:0,profit:0,gm:0,ad:0,shopsArr:new Set(),namesArr:new Set()}; map.set(k,o); }
    o.count++;
    o.shopsArr.add(r["店铺名称"]||"(空)");
    o.namesArr.add(r["商品名称"]||"(无名称)");
    let n=toNum(r["商品销售数据-商品销售金额(扣退)"]); if(!isNaN(n)) o.amount+=n;
    n=toNum(r["商品销售数据-商品销售成本(扣退)"]); if(!isNaN(n)) o.cost+=n;
    n=toNum(r["利润-经营利润"]); if(!isNaN(n)) o.profit+=n;
    n=toNum(r["利润-毛利额"]); if(!isNaN(n)) o.gm+=n;
    n=toNum(r["利润-其中：推广费"]); if(!isNaN(n)) o.ad+=n;
  }
  const arr=[...map.values()];
  for(const o of arr){
    o.shop=o.key; o.date=o.key; o.link=o.key; o.code=o.key;
    o.name=[...o.namesArr].sort((a,b)=>a.localeCompare(b,"zh")).join("、");
    o.shopsList=[...o.shopsArr].sort((a,b)=>a.localeCompare(b,"zh"));
    o.shops=o.shopsList.length===1?o.shopsList[0]:`${o.shopsList.length} 家店铺`;
    o.profitRate=o.amount?o.profit/o.amount*100:NaN;
    o.gmRate=o.amount?o.gm/o.amount*100:NaN;
    o.adRate=o.amount?o.ad/o.amount*100:NaN;
    o.roi=calcRoi(o.amount,o.ad,o.profit);
  }
  return arr;
}

function sumCell(c,v){
  if(c.key==="count") return v.toLocaleString();
  if(c.money) return `<span class="${v>0?"pos":v<0?"neg":""}">${fmtMoney(v)}</span>`;
  if(c.rate) return isNaN(v)?"—":`<span class="pct">${v.toFixed(2)}%</span>`;
  if(c.roi) return isNaN(v)?"—":`<span style="color:var(--accent);font-weight:600">${v.toFixed(2)}</span>`;
  return esc(v);
}

function renderSumTable(tableId,cols,rows,sort,totLabel,markFn){
  const sorted=[...rows].sort((x,y)=>{
    if(["shop","date","shops","code","name","link"].includes(sort.key)) return String(x[sort.key]).localeCompare(String(y[sort.key]),"zh")*sort.dir;
    const vx=toNum(x[sort.key]), vy=toNum(y[sort.key]);
    if(isNaN(vx)) return 1; if(isNaN(vy)) return -1;
    return (vx-vy)*sort.dir;
  });
  let h="<thead><tr>";
  for(const c of cols){
    const arrow=sort.key===c.key?`<span class="sarrow">${sort.dir>0?"▲":"▼"}</span>`:"";
    const tip=c.roi
      ?' title="平衡投产=1/扣推广利润率；扣推广利润率=(推广费用+净利润)/成交额。点击数值查看计算过程"'
      :' title="点击排序"';
    h+=`<th class="${c.num?"num":""}" data-sk="${c.key}"${tip}>${c.label}${arrow}</th>`;
  }
  h+="</tr></thead><tbody>";
  for(const r of sorted){
    h+="<tr>";
    const mk=(typeof markFn==="function")?(markFn(r)||""):"";
    cols.forEach((c,ci)=>{
      let inner;
      if(c.key==="name"){
        inner=esc(r.name||"—");
      }else if(c.shops){
        inner=r.shopsList.map(s=>`<span class="linkcell" data-drill="shopLinks" data-val="${esc(s==="(空)"?"":s)}" title="点击查看该店铺各链接的汇总">${esc(s)}</span>`).join("、");
      }else if(c.drill){
        inner=`<span class="linkcell" data-drill="${c.drill}" data-val="${esc(r.key==="(空)"?"":r.key)}" title="点击钻取下一层">${sumCell(c,r[c.key])}</span>`;
      }else inner=sumCell(c,r[c.key]);
      /* 链接ID / 链接标题：加一键复制 */
      if((c.key==="code"||c.key==="name"||c.key==="link")&&r[c.key]&&r[c.key]!=="—"){
        inner+=`<span class="cpy" data-cpy="${esc(r[c.key])}" title="点击复制${c.key==="name"?"链接标题":"链接ID"}">⧉</span>`;
      }
      if(ci===0&&mk) inner+=mk;
      const txtCls=(c.key==="shop"||c.key==="link"||c.key==="code")?" shopname":"";
      h+=`<td class="${c.num?"num":""}${txtCls}${c.roi?" roicell":""}"${txtCls?` title="${esc(c.shops?r.shopsList.join("、"):r[c.key])}"`:""}${c.roi?' title="点击查看计算过程"':""}>${inner}</td>`;
    });
    h+="</tr>";
  }
  h+="</tbody>";
  // 汇总行
  const t={count:0,amount:0,cost:0,profit:0,gm:0,ad:0};
  rows.forEach(r=>{t.count+=r.count;t.amount+=r.amount;t.cost+=r.cost;t.profit+=r.profit;t.gm+=r.gm;t.ad+=r.ad;});
  t.profitRate=t.amount?t.profit/t.amount*100:NaN;
  t.gmRate=t.amount?t.gm/t.amount*100:NaN;
  t.adRate=t.amount?t.ad/t.amount*100:NaN;
  t.roi=calcRoi(t.amount,t.ad,t.profit);
  h+="<tfoot><tr>"+cols.map(c=>{
    const inner=c.key==="shop"||c.key==="date"
      ?`<span class="sumlabel">${totLabel}</span>`
      :sumCell(c,t[c.key]);
    return `<td class="${c.num?"num":""}${c.roi?" roicell":""}"${c.roi?' title="点击查看计算过程"':""}>${inner}</td>`;
  }).join("")+"</tr></tfoot>";
  $(tableId).innerHTML=h;
  $(tableId)._sumRows=sorted; $(tableId)._sumTot=t;
}

function tsum(arr){ let n=0; arr.forEach(r=>n+=r.count); return n.toLocaleString(); }

function renderDateSummary(){
  if(!ROWS.length){ $("dateSumTable").innerHTML=""; $("dateSumHint").textContent=""; return; }
  let rows=ROWS;
  if(dateShops.size) rows=rows.filter(r=>dateShops.has(r["店铺名称"]||""));
  if(dateLinks.size) rows=rows.filter(r=>dateLinks.has(r["店铺款式编码"]||""));
  if(dateRange.a) rows=rows.filter(r=>(r["日期"]||"")>=dateRange.a);
  if(dateRange.b) rows=rows.filter(r=>(r["日期"]||"")<=dateRange.b);
  const keyCol=dateGroup==="shop"?"店铺名称":dateGroup==="link"?"店铺款式编码":"日期";
  const arr=aggregateBy(rows,keyCol);
  if(dateGroup==="date") arr.sort((x,y)=>x.key<y.key?-1:x.key>y.key?1:0);
  const firstCol=dateGroup==="shop"
    ?{key:"shop",label:"店铺",drill:"shopLinks"}
    :dateGroup==="link"
      ?{key:"link",label:"链接ID",drill:"linkDays"}
      :{key:"date",label:"日期",drill:"dayShops"};
  const extra=dateGroup==="link"?[{key:"name",label:"链接标题"}]:[];
  const shopCol={key:"shops",label:"店铺",shops:true};
  const cols=[firstCol,...extra,...(dateGroup!=="shop"?[shopCol]:[]),...SHOP_SUM_COLS.slice(1)];
  const unit=dateGroup==="shop"?"家店铺":dateGroup==="link"?"个链接":"天";
  const scopeTxt=[
    dateGroup==="shop"?"按店铺":dateGroup==="link"?"按链接":"按天",
    dateShops.size?[...dateShops].join("、"):"全部店铺",
    dateLinks.size?(dateLinks.size>3?`${dateLinks.size} 个链接`:[...dateLinks].join("、")):"所有链接",
    dateRange.a||dateRange.b?`日期 ${dateRange.a||"…"} ~ ${dateRange.b||"…"}`:"全部时间",
  ].join(" · ");
  $("dateSumHint").textContent=`${scopeTxt} · ${arr.length} ${unit} · ${rows.length.toLocaleString()} 行`;
  renderSumTable("dateSumTable",cols,arr,dateSort,`汇总（${arr.length} ${unit} · ${tsum(arr)} 行）`);
}
/* 分组维度切换 */
document.querySelectorAll("#dateGroupTabs .vtab").forEach(t=>t.onclick=()=>{
  if(dateGroup===t.dataset.g) return;
  dateGroup=t.dataset.g;
  document.querySelectorAll("#dateGroupTabs .vtab").forEach(x=>x.classList.toggle("on",x===t));
  dateSort=dateGroup==="date"?{key:"date",dir:-1}:{key:"amount",dir:-1};
  renderDateSummary();
});
/* 时间维度页的时间范围 */
function setDateRange(a,b){ dateRange={a:a||"",b:b||""}; $("dateRangeA").value=a||""; $("dateRangeB").value=b||""; renderDateSummary(); }
document.querySelectorAll("#dateCtrl [data-dr]").forEach(b=>b.onclick=()=>{
  const today=new Date(), q=b.dataset.dr;
  const f=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const yest=f(new Date(today.getFullYear(),today.getMonth(),today.getDate()-1));   // 昨天（今天及以后不可选）
  if(q==="all") setDateRange("","");
  else if(q==="7") setDateRange(f(new Date(today.getFullYear(),today.getMonth(),today.getDate()-7)),yest);
  else if(q==="30") setDateRange(f(new Date(today.getFullYear(),today.getMonth(),today.getDate()-30)),yest);
  else if(q==="cm"){ const a=f(new Date(today.getFullYear(),today.getMonth(),1)); setDateRange(a,yest<a?a:yest); }
  else if(q==="lm") setDateRange(f(new Date(today.getFullYear(),today.getMonth()-1,1)),f(new Date(today.getFullYear(),today.getMonth(),0)));
});
$("dateRangeA").onchange=()=>{ dateRange.a=$("dateRangeA").value; renderDateSummary(); };
$("dateRangeB").onchange=()=>{ dateRange.b=$("dateRangeB").value; renderDateSummary(); };

/* --- 汇总：店铺 / 链接筛选（复用通用多选组件） --- */
function updateShopBtn(){ $("dateShopBtn").textContent=dateShops.size?`🏪 ${dateShops.size} 家店铺`:"🏪 全部店铺"; }
$("dateShopBtn").onclick=e=>{
  e.stopPropagation();
  const map=new Map();
  for(const r of ROWS){ const s=r["店铺名称"]||""; map.set(s,(map.get(s)||0)+1); }
  const items=[...map.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"zh")).map(([v,n])=>({value:v,label:v||"(空)",count:n}));
  mpOpen({title:"选择店铺（不选 = 全部店铺）",items:items,sel:dateShops,anchor:"#dateShopBtn",onOk:sel=>{ dateShops=sel; updateShopBtn(); renderDateSummary(); }});
};
function updateLinkBtn(){ $("dateLinkBtn").textContent=dateLinks.size?`🔗 ${dateLinks.size} 个链接`:"🔗 所有链接"; }
$("dateLinkBtn").onclick=e=>{
  e.stopPropagation();
  const map=new Map();
  for(const r of ROWS){
    const code=r["店铺款式编码"]||"";
    if(!map.has(code)) map.set(code,{n:0,name:r["商品名称"]||""});
    map.get(code).n++;
  }
  const items=[...map.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"zh")).map(([v,o])=>({value:v,label:(v||"(空)")+" "+(o.name||""),count:o.n}));
  mpOpen({title:"选择链接（不选 = 所有链接）",items:items,sel:dateLinks,anchor:"#dateLinkBtn",onOk:sel=>{ dateLinks=sel; updateLinkBtn(); renderDateSummary(); }});
};

/* --- 平衡投产：点击任意行 / 汇总行 弹出计算过程 --- */
function showRoiPop(d,label,x,y){
  const rate=d.amount?Math.round((d.ad+d.profit)/d.amount*1e5)/1e5:NaN;
  const roi=(isNaN(rate)||rate<=0)?NaN:Math.round(1/rate*100)/100;
  const pop=$("roiPop");
  pop.innerHTML=`<div class="phead"><span class="title">平衡投产 · ${esc(label)}</span></div>
  <div style="padding:10px 14px;font-size:12.5px;line-height:2">
    <div>成交金额：<b>${fmtMoney(d.amount)}</b></div>
    <div>推广费用：<b>${fmtMoney(d.ad)}</b>　净利润：<b><span class="${d.profit>=0?"pos":"neg"}">${fmtMoney(d.profit)}</span></b></div>
    <div>扣推广利润率 =（推广费 + 净利润）÷ 成交额 = <b>${isNaN(rate)?"—":rate.toFixed(5)}</b></div>
    <div style="margin-top:6px;font-size:14px">平衡投产 = 1 ÷ ${isNaN(rate)?"—":rate.toFixed(5)} = <b style="color:var(--accent);font-size:16px">${isNaN(roi)?"—":roi.toFixed(2)}</b></div>
    ${isNaN(roi)?'<div style="color:var(--text3);font-size:11px;margin-top:4px">扣推广利润率 ≤ 0（扣推广后仍不亏损），无平衡投产概念</div>':""}
  </div>`;
  pop.style.display="flex";
  const pw=pop.offsetWidth||300, ph=pop.offsetHeight||180;
  pop.style.left=Math.max(8,Math.min(x+10,window.innerWidth-pw-10))+"px";
  pop.style.top=Math.max(8,Math.min(y+10,window.innerHeight-ph-10))+"px";
}
/* --- 平衡投产：仅点击"平衡投产"单元格（含汇总行）时弹出计算过程 --- */
/* 汇总表：点单元格钻取 / 点表头排序 */
$("dateSumTableWrap").addEventListener("click",e=>{
  const lc=e.target.closest(".linkcell");
  if(lc){
    e.stopPropagation();
    const v=lc.dataset.val, d=lc.dataset.drill;
    if(d==="dayShops") openView({base:ROWS,stack:[{kind:"date",date:v}],group:"shop",sort:{key:"amount",dir:-1}});
    else if(d==="shopLinks") openView({base:ROWS,stack:[{kind:"shop",shop:v}],group:"date",sort:{key:"date",dir:1}});
    else if(d==="linkDays") openView({base:ROWS,stack:[{kind:"link",code:v}],group:"date",sort:{key:"date",dir:1}});
    return;
  }
  const th=e.target.closest("th[data-sk]"); if(!th) return;
  if(dateSort.key===th.dataset.sk) dateSort.dir*=-1;
  else dateSort={key:th.dataset.sk,dir:th.dataset.sk==="date"||th.dataset.sk==="shops"?1:-1};
  renderDateSummary();
});
$("dateSumTableWrap").addEventListener("click",e=>{
  const cell=e.target.closest("td.roicell");
  if(!cell) return;
  const table=$("dateSumTable");
  let d,label;
  const tr=cell.closest("tr");
  if(cell.closest("tbody")&&table._sumRows){
    const idx=[...table.querySelector("tbody").children].indexOf(tr);
    d=table._sumRows[idx]; label=d?d.label:null;
  } else if(table._sumTot){
    d=table._sumTot; label="全部汇总";
  }
  if(d) showRoiPop(d,label,e.clientX,e.clientY);
});
document.addEventListener("mousedown",e=>{
  const pop=$("roiPop");
  if(pop.style.display!=="flex") return;
  if(e.target.closest&&!pop.contains(e.target)&&!e.target.closest("td.roicell,#dRoiVal")) pop.style.display="none";
});

/* ================= 统一抽屉：Scope + Subject + View =================
   所有入口（明细单元格 / 汇总钻取 / 台账卡片）都只调 openView()，
   差异全部收敛成「默认配置」：base 行集 + subject 主体 + group 分组 + sort 排序。
*/
let V=null;
const V_GROUPS=[["row","明细"],["date","按天"],["shop","按店铺"],["link","按链接"]];
const V_AGG_DRILL={date:"dayShops",shop:"shopLinks",link:"linkDays"};

function vNewScope(){ return {a:"",b:"",shops:new Set(),links:new Set(),kw:""}; }
function vTop(){ return V&&V.stack.length?V.stack[V.stack.length-1]:null; }
function vSubj(col,value){
  const v=String(value==null?"":value);
  if(col==="店铺款式编码") return {kind:"link",code:v};
  if(col==="商品名称") return {kind:"title",title:v};
  if(col==="店铺名称") return {kind:"shop",shop:v};
  if(col==="日期") return {kind:"date",date:v};
  return {kind:"cell",col:col,value:v};
}
function vAdjId(){
  const f=vTop(); if(!f) return "";
  if(f.kind==="link") return String(f.code||"");
  if(f.kind==="title") return String(V.tabId||"");
  return "";
}
function vShopMatch(r,s){
  const raw=r["店铺名称"]||"";
  if(raw===s) return true;
  const sp=window.splitShop?window.splitShop(raw):null;
  return !!(sp&&sp.shop===s);
}
function vCrumb(f){
  const p=[];
  if(f.date) p.push("📅 "+f.date);
  if(f.shop) p.push("🏪 "+f.shop);
  if(f.code) p.push("🔗 "+f.code);
  if(f.kind==="title") p.push("🛒 "+String(f.title||"").slice(0,16));
  if(f.kind==="cell") p.push("「"+dispName(f.col)+"」"+f.value);
  return p.join(" · ")||"—";
}
function vFrameRows(){
  const f=vTop(); let rows=V.base||[];
  if(!f) return rows;
  if(f.kind==="cell") rows=rows.filter(r=>(r[f.col]||"")===(f.value||""));
  if(f.date) rows=rows.filter(r=>(r["日期"]||"")===f.date);
  if(f.shop) rows=rows.filter(r=>vShopMatch(r,f.shop));
  if(f.code) rows=rows.filter(r=>(r["店铺款式编码"]||"")===String(f.code));
  if(f.kind==="title"){
    rows=rows.filter(r=>(r["商品名称"]||"")===f.title);
    if(V.tabId) rows=rows.filter(r=>(r["店铺款式编码"]||"")===V.tabId);
  }
  return rows;
}
function vRows(){
  let rows=vFrameRows();
  const s=V.scope;
  if(s.a) rows=rows.filter(r=>(r["日期"]||"")>=s.a);
  if(s.b) rows=rows.filter(r=>(r["日期"]||"")<=s.b);
  if(s.shops.size) rows=rows.filter(r=>s.shops.has(r["店铺名称"]||""));
  if(s.links.size) rows=rows.filter(r=>s.links.has(r["店铺款式编码"]||""));
  const kw=(s.kw||"").trim().toLowerCase();
  if(kw) rows=rows.filter(r=>[r["店铺名称"],r["店铺款式编码"],r["商品名称"],r["日期"]].join(" ").toLowerCase().indexOf(kw)>=0);
  return rows;
}

/* ---------- 入口：只给默认配置 ---------- */
function openView(cfg){
  const stack=(cfg.stack||[]).filter(Boolean).map(f=>Object.assign({},f));
  if(!stack.length) return;
  V={
    base:cfg.base||ROWS,
    stack:stack,
    group:cfg.group||"row",
    view:cfg.view||"table",
    sort:Object.assign({key:"日期",dir:1},cfg.sort||{}),
    page:1, allFields:false, codes:null, tabId:null,
    fullMode:"daily", fullField:"", fullRange:{a:"",b:""},
    fullWatch:new Set(["商品销售数据-商品销售金额(扣退)","利润-经营利润","利润-其中：推广费","经营利润-占比"].filter(h=>HEADERS.includes(h))),
    fullOpenDates:new Set(), fullFocusDate:"", fullKeyword:"", fullShowEmpty:false, fullChangedOnly:false,
    scope:vNewScope()
  };
  const f=vTop();
  if(f.kind==="title"){
    const codes=[...new Set(V.base.filter(r=>(r["商品名称"]||"")===f.title).map(r=>r["店铺款式编码"]||""))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"zh"));
    V.codes=codes; V.tabId=codes[0]||"";
  }
  /* 没有利润数据但有调整记录 → 直接落记录视图（台账场景） */
  if(!vRows().length && vAdjId()){
    const rs=window.__rec?window.__rec.list(vAdjId()):[];
    if(rs.length) V.view="records";
  }
  $("dDateA").value=""; $("dDateB").value=""; $("dKw").value="";
  $("overlay").style.display="block";
  $("drawer").classList.add("open");
  renderV();
}
/* 明细表单元格点击（沿用旧签名）：主体定位照常，但不继承主表筛选——抽屉内可看条件外的条目 */
function openDrawer(col,value){
  openView({base:ROWS,stack:[vSubj(col,value)],group:"row",sort:{key:"日期",dir:1}});
}
/* 台账 / 记录卡：链接主体，默认表格（无利润数据则记录视图） */
function openRecPanel(id){
  openView({base:ROWS,stack:[{kind:"link",code:String(id||"").trim()}],group:"date",sort:{key:"date",dir:1}});
}
function closeDrawer(){
  $("drawer").classList.remove("open");
  $("overlay").style.display="none";
  V=null;
}

/* ---------- 渲染 ---------- */
function renderV(){
  if(!V) return;
  const f=vTop();
  const rows=vRows();
  const adjId=vAdjId();
  const recs=(adjId&&window.__rec)?window.__rec.list(adjId):[];

  /* 面包屑 */
  const crumb=$("dBase");
  if(V.stack.length>1){
    crumb.style.display="flex";
    crumb.innerHTML=V.stack.map((s,i)=>`<span class="crumb${i===V.stack.length-1?" cur":""}" data-ci="${i}" title="点击返回该层">${esc(vCrumb(s))}</span>`).join('<span class="csep">›</span>');
  }else{ crumb.style.display="none"; crumb.innerHTML=""; }

  /* 主体头部 */
  const thumb=$("dThumb");
  thumb.style.display="none";
  const dates=[...new Set(rows.map(r=>r["日期"]||""))].filter(Boolean).sort();
  const shopsN=[...new Set(rows.map(r=>r["店铺名称"]||""))].filter(Boolean);
  const codesN=[...new Set(rows.map(r=>r["店铺款式编码"]||""))].filter(Boolean);
  let tag="",val="";
  if(f.kind==="cell"){ tag=`「${dispName(f.col)}」的全部数据`; val=f.value; }
  else if(f.kind==="date"){ tag="📅 日期"; val=f.date; }
  else if(f.kind==="shop"||f.kind==="shopDay"){ tag=f.kind==="shopDay"?"📅 当天 · 🏪 店铺":"🏪 店铺"; val=f.shop; }
  else if(f.kind==="link"){ tag="🔗 链接ID"; val=f.code; }
  else if(f.kind==="title"){ tag="🛒 商品标题"; val=f.title; }
  $("dTag").textContent=tag;
  $("dVal").innerHTML=esc(val||"—")+(val?`<span class="cpy" data-cpy="${esc(val)}" title="点击复制">⧉</span>`:"");

  const info=$("dInfo");
  info.style.display="flex";
  if(f.kind==="link"||f.kind==="title"){
    const img=(adjId&&window.imgOf&&window.imgOf(adjId))||(rows.find(r=>r["图片"])||{})["图片"]||"";
    if(img){ thumb.src=img; thumb.style.display="block"; }
    const titles=[...new Set(rows.map(r=>r["商品名称"]||"").filter(Boolean))];
    const ttl=titles[0]||(window.__rec?window.__rec.title(recs[0]):"");
    const shopTxt=shopsN.length?shopsN.join("、"):(window.__rec&&recs[0]?window.__rec.label(recs[0]):"");
    info.innerHTML=`<span>🏪 店铺：${esc(shopTxt||"—")}</span>`
      +(f.kind==="link"
        ? `<span title="${esc(ttl)}">🛒 ${esc(ttl.length>26?ttl.slice(0,26)+"…":ttl)}</span>`
        : `<span>🏷 链接ID：${esc(codesN.join("、")||"—")}</span>`)
      +(dates.length?`<span>📅 ${dates.length>1?dates[0]+" ~ "+dates[dates.length-1]+"（"+dates.length+" 天）":dates[0]}</span>`:"")
      +(recs.length?`<span style="color:var(--accent)">🎯 ${recs.length} 次调整</span>`:"")
      +(adjId?`<span class="cpy" data-cpy="${esc(adjId)}" title="复制链接ID">⧉ 复制ID</span>`:"");
  }else{
    info.innerHTML=`<span>🧾 <b>${rows.length.toLocaleString()}</b> 行</span>`
      +`<span>📅 ${dates.length?(dates.length>1?dates[0]+" ~ "+dates[dates.length-1]:" "+dates[0]):"—"}（${dates.length} 天）</span>`
      +(shopsN.length?`<span>🏪 ${shopsN.length} 家店铺</span>`:"")
      +(codesN.length?(f.kind==="link"?"":`<span>🔗 ${codesN.length} 个链接</span>`):"");
  }

  /* 标题多编码 tab */
  const tabs=$("dTabs");
  if(f.kind==="title"&&V.codes&&V.codes.length>1){
    tabs.style.display="flex";
    tabs.innerHTML=`<span class="dtabhint">该标题下 ${V.codes.length} 个链接ID：</span>`+V.codes.map(c=>`<span class="dtab${c===V.tabId?" on":""}" data-tab="${esc(c)}">${esc(c||"(空)")}</span>`).join("");
  }else tabs.style.display="none";

  /* 调整条 */
  if(window.renderDAdj){
    if(adjId) window.renderDAdj(adjId, (rows[0]||{}).商品名称||"", (window.splitShop?window.splitShop((rows[0]||{})["店铺名称"]||"").shop:""), (window.splitShop?window.splitShop((rows[0]||{})["店铺名称"]||"").platform:""));
    else window.renderDAdj("","","","");
  }

  /* 工具条：视图 / 指标 / 分组 */
  const canChart=window.__chart?window.__chart.series(rows).length>=2:false;
  const canRec=recs.length>0;
  const vs=$("dViewSw");
  vs.innerHTML=`<span class="vs${V.view==="table"?" on":""}" data-dv="table">📋 表格</span>`
    +`<span class="vs${V.view==="chart"?" on":""}${canChart?"":" off"}" data-dv="chart"${canChart?"":' title="至少 2 天数据才能画图"'}>📈 图表</span>`
    +(canRec?`<span class="vs${V.view==="records"?" on":""}" data-dv="records">📝 记录${recs.length>1?" "+recs.length:""}</span>`:"");
  const mb=$("dMetBox");
  if(V.view==="chart"&&window.__chart){ mb.style.display="flex"; mb.innerHTML=window.__chart.chips(); }
  else { mb.style.display="none"; mb.innerHTML=""; }
  const gs=$("dGrpSw");
  gs.style.display=V.view==="records"?"none":"";
  gs.innerHTML=V_GROUPS.map(([k,l])=>`<span class="vs${V.group===k?" on":""}" data-dg="${k}">${l}</span>`).join("");
  $("dFields").style.display=(V.group==="row"&&V.view==="table")?"":"none";
  $("dFields").textContent=V.allFields?"📋 返回表格":"📋 全部字段";
  $("dBack").style.display=V.stack.length>1?"":"none";

  /* 筛选条 */
  const fr=$("dFilterRow");
  fr.style.display=V.view==="records"?"none":"";
  $("dDateA").value=V.scope.a; $("dDateB").value=V.scope.b; $("dKw").value=V.scope.kw;
  $("dShopBtn").textContent=V.scope.shops.size?`🏪 ${V.scope.shops.size} 家店铺`:"🏪 全部店铺";
  $("dLinkBtn").textContent=V.scope.links.size?`🔗 ${V.scope.links.size} 个链接`:"🔗 全部链接";

  /* 汇总条 */
  const ct=computeTotals(rows);
  const roi=calcRoi(ct.sm,ct.ad,ct.pf);
  if(!rows.length){
    $("dSub").innerHTML=`<span style="color:var(--amber)">${adjId?"利润报表里没有这条链接的数据":"当前条件下没有数据"}</span>`
      +(recs.length?`<span>· ${recs.length} 条调整记录仍可查看</span>`:"")
      +(recs.length?`<span id="dRoiVal" style="display:none"></span>`:"");
  }else{
  $("dSub").innerHTML=`<span>共 <b>${rows.length}</b> 行${(V.scope.a||V.scope.b)?` · 已筛日期`:""}</span>`
    +`<span>成交金额 <b>${fmtMoney(ct.sm)}</b></span><span>商品成本 <b>${fmtMoney(ct.sc)}</b></span>`
    +`<span>净利润 <b style="${ct.pf>=0?"":"color:var(--green)"}">${fmtMoney(ct.pf)}</b></span>`
    +`<span>毛利润 <b style="${ct.gl>=0?"":"color:var(--green)"}">${fmtMoney(ct.gl)}</b></span>`
    +`<span>推广费用 <b>${fmtMoney(ct.ad)}</b></span>`
    +`<span>平衡投产 <b id="dRoiVal" style="color:var(--accent);cursor:pointer" title="点击查看计算过程">${isNaN(roi)?"—":roi.toFixed(2)}</b></span>`;
  }
  const rv=$("dRoiVal");
  if(rv) rv.onclick=e=>{ e.stopPropagation(); showRoiPop({amount:ct.sm,ad:ct.ad,profit:ct.pf},(val||"")+"（抽屉汇总）",e.clientX,e.clientY); };

  /* 内容 */
  $("dPager").innerHTML="";
  if(V.view==="records"){
    $("dBody").innerHTML=`<div class="rp-sec">调整时间线（${recs.length} 条，最新在上）</div>`
      +`<div class="rp-list">${recs.map(window.__rec.card).join("")}</div>`;
    return;
  }
  if(V.view==="chart"){
    const CH=window.__chart;
    $("dBody").innerHTML=`<div class="dchart">${CH.svg(CH.series(rows),{marks:CH.marks(V),h:320})}</div>`;
    return;
  }
  if(!rows.length){
    $("dBody").innerHTML=`<div class="rphint" style="margin:18px">当前条件下没有利润数据。${recs.length?"该链接有 "+recs.length+" 条调整记录，可切到「记录」查看。":"可能是还没导入利润表，或这条链接不在报表里。"}</div>`;
    return;
  }
  if(V.group==="row") vTableRows(rows); else vTableAgg(rows);
}

/* ---------- 单链接：按日字段浏览与单字段趋势 ---------- */
function lfNumber(v){
  const s=String(v==null?"":v).trim().replace(/[¥￥元,，\s]/g,"").replace(/%$/,"");
  return s&&/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)?Number(s):NaN;
}
function lfIsNumericField(col,rows){
  if(MONEY_COLS.has(col)||PCT_COLS.has(col)) return true;
  if(/日期|时间|编码|\bid\b|名称|标题|图片|链接|规格|类目|状态|描述|备注|地址|型号/i.test(col)) return false;
  const vals=(rows||[]).map(r=>String(r[col]??"").trim()).filter(Boolean);
  if(!vals.length||!vals.every(v=>!Number.isNaN(lfNumber(v)))) return false;
  return /金额|成本|利润|推广|费|率|占比|数量|销量|库存|价格|产出|收入|退款|订单|点击|访客|转化/i.test(col)||vals.length>0;
}
function lfIsPercentField(col,rows){
  return PCT_COLS.has(col)||(rows||[]).some(r=>/%$/.test(String(r[col]||"").trim()));
}
function lfFormatValue(col,value){
  const s=String(value==null?"":value).trim(); if(!s) return "—";
  if(MONEY_COLS.has(col)) return fmtMoney(value);
  if(PCT_COLS.has(col)) return fmtPct(value);
  return s;
}
function lfFormatDelta(col,delta,pct){
  if(!Number.isFinite(delta)) return "—";
  const sign=delta>0?"+":delta<0?"−":"";
  const mag=Math.abs(delta);
  if(pct) return sign+mag.toFixed(2)+" 个百分点";
  if(MONEY_COLS.has(col)) return sign+fmtMoney(mag);
  return sign+mag.toLocaleString("zh-CN",{maximumFractionDigits:2});
}
function lfSameValue(col,a,b,numeric){
  if(numeric){ const x=lfNumber(a),y=lfNumber(b); if(Number.isFinite(x)&&Number.isFinite(y)) return Math.abs(x-y)<1e-9; }
  return String(a??"")===String(b??"");
}
function lfDateKeys(rows){ return [...new Set((rows||[]).map(r=>String(r["日期"]||"").slice(0,10)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))].sort(); }
function lfShiftDate(date,days){ const d=new Date(date+"T00:00:00"); d.setDate(d.getDate()+days); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function lfAxisValue(col,n,pct){
  if(pct) return n.toFixed(1)+"%";
  if(MONEY_COLS.has(col)) return "¥"+(Math.abs(n)>=10000?(n/10000).toFixed(1)+"万":n.toLocaleString("zh-CN",{maximumFractionDigits:0}));
  return Math.abs(n)>=10000?(n/10000).toFixed(1)+"万":n.toLocaleString("zh-CN",{maximumFractionDigits:1});
}
function lfFieldChart(rows,col){
  const pct=lfIsPercentField(col,rows);
  const pts=(rows||[]).map(r=>({date:String(r["日期"]||"").slice(0,10),value:lfNumber(r[col])})).filter(p=>p.date&&Number.isFinite(p.value)).sort((a,b)=>a.date.localeCompare(b.date));
  if(pts.length<2) return `<div class="lf-chart-empty">至少需要两个有值的日期才能绘制趋势（当前 ${pts.length} 个）</div>`;
  const W=920,H=260,L=82,R=20,T=18,B=38;
  const times=pts.map(p=>Date.parse(p.date+"T00:00:00")), t0=times[0], t1=times[times.length-1];
  let lo=Math.min(...pts.map(p=>p.value)),hi=Math.max(...pts.map(p=>p.value));
  if(lo===hi){ const pad=Math.abs(lo)*.08||1; lo-=pad; hi+=pad; } else { const pad=(hi-lo)*.08; lo-=pad; hi+=pad; }
  const x=i=>L+(W-L-R)*(times[i]-t0)/((t1-t0)||1);
  const y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  let grid="";
  for(let i=0;i<=4;i++){
    const yy=T+(H-T-B)*i/4, val=hi-(hi-lo)*i/4;
    grid+=`<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W-R}" y2="${yy.toFixed(1)}" class="lf-grid"/>`;
    grid+=`<text x="${L-9}" y="${(yy+4).toFixed(1)}" text-anchor="end" class="lf-axis">${esc(lfAxisValue(col,val,pct))}</text>`;
  }
  const paths=[]; let segment=[];
  const flush=()=>{ if(segment.length>1) paths.push(`<path d="${segment.map((p,j)=>`${j?"L":"M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" class="lf-line"/>`); segment=[]; };
  for(let i=0;i<pts.length;i++){
    if(i&&((times[i]-times[i-1])/86400000)>1.5) flush();
    segment.push({x:x(i),y:y(pts[i].value)});
  }
  flush();
  const labels=[...new Set([0,Math.floor((pts.length-1)/2),pts.length-1])].map(i=>`<text x="${x(i).toFixed(1)}" y="${H-12}" text-anchor="middle" class="lf-axis">${esc(pts[i].date.slice(5))}</text>`).join("");
  const circles=pts.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" class="lf-point"><title>${esc(p.date)} · ${esc(lfFormatValue(col,p.value))}</title></circle>`).join("");
  const adjId=vAdjId();
  const adjDates=adjId&&window.__rec?window.__rec.list(adjId).map(r=>String(r.time||"").slice(0,10)).filter(d=>d>=pts[0].date&&d<=pts[pts.length-1].date):[];
  const markers=adjDates.map(d=>{
    const t=Date.parse(d+"T00:00:00"), xx=L+(W-L-R)*(t-t0)/((t1-t0)||1);
    return `<g class="lf-adj-marker" data-adj-open="${esc(adjId)}"><line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H-B}" class="lf-adj-line"/><circle cx="${xx.toFixed(1)}" cy="${T+5}" r="4" class="lf-adj-dot"/><title>${esc(d)} · 投放调整（点击查看记录）</title></g>`;
  }).join("");
  return `<div class="lf-chart">${markers?'<div class="lf-chart-legend"><i></i>投放调整日</div>':''}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(dispName(col))} 按日变化趋势">${grid}${markers}${paths.join("")}${circles}${labels}</svg></div>`;
}
function lfTrendRows(rows,col,range){
  const asc=(rows||[]).filter(r=>{
    const d=String(r["日期"]||"").slice(0,10);
    return d&&(!range.a||d>=range.a)&&(!range.b||d<=range.b);
  }).sort((a,b)=>String(a["日期"]||"").localeCompare(String(b["日期"]||"")));
  let prev=null;
  return asc.map(r=>{
    const value=String(r[col]??"").trim(), numeric=lfIsNumericField(col,rows), n=lfNumber(value);
    let change="—", changed=false;
    if(value&&prev){
      if(numeric&&Number.isFinite(n)&&Number.isFinite(prev.n)) change=lfFormatDelta(col,n-prev.n,lfIsPercentField(col,rows));
      else { changed=value!==prev.value; change=changed?"内容有变化":"未变化"; }
    }
    const item={row:r,date:String(r["日期"]||"").slice(0,10),value,n,change,changed};
    if(value) prev={value,n};
    return item;
  });
}
function lfFieldTrend(rows){
  const dates=lfDateKeys(rows);
  if(!HEADERS.includes(V.fullField)) V.fullField=["利润-经营利润","商品销售数据-商品销售金额(扣退)","利润-其中：推广费"].find(h=>HEADERS.includes(h))||HEADERS.find(h=>lfIsNumericField(h,rows))||HEADERS[0]||"";
  const col=V.fullField;
  const filtered=lfTrendRows(rows,col,V.fullRange);
  const numeric=lfIsNumericField(col,rows), pct=lfIsPercentField(col,rows);
  const valid=filtered.filter(x=>x.value);
  const first=valid[0],last=valid[valid.length-1];
  let summary="";
  if(first&&last){
    summary=`<div class="lf-kpi"><span>区间起点 · ${esc(first.date)}</span><b>${esc(lfFormatValue(col,first.value))}</b></div>`
      +`<div class="lf-kpi"><span>区间终点 · ${esc(last.date)}</span><b>${esc(lfFormatValue(col,last.value))}</b></div>`;
    if(numeric&&valid.length>1&&Number.isFinite(first.n)&&Number.isFinite(last.n)){
      const d=last.n-first.n, rate=first.n>0?` · ${(d/first.n*100>0?"+":"")}${(d/first.n*100).toFixed(1)}%`:"";
      summary+=`<div class="lf-kpi"><span>首尾变化</span><b class="${d>0?"pos":d<0?"neg":""}">${esc(lfFormatDelta(col,d,pct))}${esc(rate)}</b></div>`;
    }else if(!numeric){
      const changes=filtered.filter(x=>x.changed).length;
      summary+=`<div class="lf-kpi"><span>内容变化</span><b>${changes} 次</b></div>`;
    }
  }else summary=`<div class="lf-chart-empty">所选日期范围内，这个字段没有可用数据。</div>`;
  const records=filtered.slice().reverse().map(item=>{
    const mark=(vAdjId()&&window.adjDateMark)?window.adjDateMark(vAdjId(),item.date):"";
    const val=item.value?lfFormatValue(col,item.value):"—";
    const change=item.value?item.change:"—";
    const cls=item.change.startsWith("+")?"pos":item.change.startsWith("−")?"neg":item.changed?"lf-changed":"";
    return `<tr><td>${esc(item.date)}${mark}</td><td class="lf-value${numeric?" num":""}">${esc(val)}</td><td class="${cls}${numeric?" num":""}">${esc(change)}</td></tr>`;
  }).join("");
  const datesLine=dates.length?`数据范围：${esc(dates[0])} ~ ${esc(dates[dates.length-1])} · ${dates.length} 个有数据日期`:"当前无日期数据";
  return `<div class="lf-trend-summary">${summary}</div>`
    +(numeric?lfFieldChart(filtered.map(x=>x.row),col):`<div class="lf-text-hint">文本字段不绘制数值曲线；下表会标出内容发生变化的日期。</div>`)
    +`<div class="lf-table-meta">${datesLine} · 当前范围 ${valid.length} 个有效值</div>`
    +`<div class="lf-table-scroll"><table class="lf-table"><thead><tr><th>日期</th><th class="${numeric?"num":""}">${esc(dispName(col))}</th><th class="${numeric?"num":""}">${numeric?"较上一有值日期":"变化"}</th></tr></thead><tbody>${records||'<tr><td colspan="3" class="lf-no-data">没有可显示的数据</td></tr>'}</tbody></table></div>`;
}
function lfApplyDailyFilters(){
  const body=$("dBody"); if(!body) return;
  const kw=(V.fullKeyword||"").trim().toLowerCase(), only=!!V.fullChangedOnly, showEmpty=!!V.fullShowEmpty;
  let shown=0;
  body.querySelectorAll(".lf-day").forEach(day=>{
    let count=0;
    day.querySelectorAll(".lf-field").forEach(field=>{
      const text=(field.dataset.header+" "+field.dataset.value).toLowerCase();
      const ok=(!kw||text.includes(kw))&&(showEmpty||field.dataset.empty!=="1")&&(!only||field.dataset.changed==="1");
      field.hidden=!ok; if(ok) count++;
    });
    const active=!!kw||only;
    day.hidden=active&&count===0;
    if(!day.hidden) shown++;
  });
  const none=body.querySelector(".lf-no-results");
  if(none) none.hidden=shown>0;
}
function lfJumpToDate(wanted,step){
  const dates=lfDateKeys(vRows()); if(!dates.length) return;
  let target="";
  if(typeof step==="number"){
    const current=dates.includes(V.fullFocusDate)?V.fullFocusDate:dates[dates.length-1];
    const i=dates.indexOf(current); target=dates[Math.max(0,Math.min(dates.length-1,i+step))];
  }else if(wanted==="latest") target=dates[dates.length-1];
  else if(!wanted) target=dates.includes(V.fullFocusDate)?V.fullFocusDate:dates[dates.length-1];
  else if(dates.includes(wanted)) target=wanted;
  else{
    const t=Date.parse(String(wanted||"")+"T00:00:00");
    target=dates.reduce((best,d)=>Math.abs(Date.parse(d+"T00:00:00")-t)<Math.abs(Date.parse(best+"T00:00:00")-t)?d:best,dates[0]);
    if(wanted) toast(`该日期没有记录，已定位到最近的有数据日期：${target}`);
  }
  V.fullMode="daily"; V.fullFocusDate=target; V.fullOpenDates.add(target); renderV();
  requestAnimationFrame(()=>{ const card=document.getElementById("lf-day-"+target); if(card){card.open=true;card.scrollIntoView({behavior:"smooth",block:"center"});} });
}
function lfRenderDaily(rows){
  const asc=rows.slice().sort((a,b)=>String(a["日期"]||"").localeCompare(String(b["日期"]||"")));
  const dates=lfDateKeys(rows), desc=dates.slice().reverse(), map=new Map();
  for(const r of asc){ const d=String(r["日期"]||"").slice(0,10); if(d&&!map.has(d)) map.set(d,r); }
  if(!V.fullFocusDate&&dates.length) V.fullFocusDate=dates[dates.length-1];
  const numeric=new Set(HEADERS.filter(h=>lfIsNumericField(h,rows)));
  const watch=HEADERS.filter(h=>V.fullWatch.has(h)).slice(0,4);
  const recs=(vAdjId()&&window.__rec)?window.__rec.list(vAdjId()):[];
  const adjDates=new Set(recs.map(r=>String(r.time||"").slice(0,10)).filter(Boolean));
  const recent=dates.slice(-12).reverse();
  const rail=recent.map(d=>`<button type="button" class="lf-day-chip${d===V.fullFocusDate?" on":""}${adjDates.has(d)?" has-adj":""}" data-lf-datejump="${esc(d)}" title="${adjDates.has(d)?"当天有投放调整 · ":""}${esc(d)}">${esc(d.slice(5))}${adjDates.has(d)?'<i></i>':""}</button>`).join("");
  const cards=desc.map(d=>{
    const r=map.get(d)||{}, prevIndex=dates.indexOf(d)-1, prev=prevIndex>=0?map.get(dates[prevIndex]):null;
    let changedCount=0;
    const fields=HEADERS.map(h=>{
      const value=String(r[h]??"").trim(), previous=prev?String(prev[h]??"").trim():"";
      const changed=!!prev&&!lfSameValue(h,value,previous,numeric.has(h)); if(changed) changedCount++;
      return `<div class="lf-field" data-header="${esc(h)}" data-value="${esc(value)}" data-empty="${value?"0":"1"}" data-changed="${changed?"1":"0"}">`
        +`<span class="lf-field-name">${esc(dispName(h))}</span><span class="lf-field-value">${esc(lfFormatValue(h,value))}</span>`
        +(changed?`<span class="lf-change-tag" title="与上一有数据日期 ${esc(dates[prevIndex])} 不同">有变化</span>`:`<span class="lf-field-muted">${prev?"未变化":""}</span>`)
        +`</div>`;
    }).join("");
    const watchHtml=watch.map(h=>r[h]?`<span class="lf-watch-item"><i>${esc(dispName(h))}</i><b>${esc(lfFormatValue(h,r[h]))}</b></span>`:"").filter(Boolean).join("");
    const mark=(vAdjId()&&window.adjDateMark)?window.adjDateMark(vAdjId(),d):"";
    return `<details class="lf-day" id="lf-day-${esc(d)}" data-lf-date="${esc(d)}"${V.fullOpenDates.has(d)?" open":""}>`
      +`<summary><span class="lf-day-date">${esc(d)}</span>${mark}<span class="lf-day-change">${changedCount?changedCount+" 项变化":""}</span>`
      +`<span class="lf-watch-line">${watchHtml||'<span class="lf-watch-empty">可在“关注字段”中设置摘要</span>'}</span><span class="lf-chevron">⌄</span></summary>`
      +`<div class="lf-fields">${fields}</div></details>`;
  }).join("");
  return `<div class="lf-shell"><div class="lf-sticky">`
    +`<div class="lf-tabs"><button type="button" class="lf-tab on" data-lf-mode="daily">每日字段</button><button type="button" class="lf-tab" data-lf-mode="trend">字段趋势</button><span class="lf-count">${dates.length} 个有数据日期</span></div>`
    +`<div class="lf-nav"><button type="button" class="btn" data-lf-step="-1" title="更早一个有数据日期">‹ 更早</button><input id="lfDayJump" type="date" min="${dates[0]||""}" max="${dates[dates.length-1]||""}" value="${esc(V.fullFocusDate||"")}"><button type="button" class="btn" data-lf-step="1" title="较新一个有数据日期">较新 ›</button><button type="button" class="btn ghost" data-lf-latest>最近</button><span class="lf-nav-hint">${V.fullFocusDate?esc(V.fullFocusDate):"选择日期跳转"}</span></div>`
    +`<div class="lf-date-rail">${rail||'<span class="lf-watch-empty">暂无日期</span>'}</div>`
    +`<div class="lf-tools"><input id="lfFieldSearch" type="search" placeholder="搜索字段名或内容…" value="${esc(V.fullKeyword)}"><button type="button" class="btn" id="lfWatchBtn">关注字段${watch.length?` · ${watch.length}`:""}</button>`
    +`<label class="lf-check"><input id="lfShowEmpty" type="checkbox" ${V.fullShowEmpty?"checked":""}>显示空字段</label><label class="lf-check"><input id="lfChangedOnly" type="checkbox" ${V.fullChangedOnly?"checked":""}>只看变化</label>`
    +`<button type="button" class="btn ghost" data-lf-action="expand">全部展开</button><button type="button" class="btn ghost" data-lf-action="collapse">全部折叠</button></div></div>`
    +`<div class="lf-day-list">${cards||'<div class="lf-no-data">暂无日期数据</div>'}</div><div class="lf-no-results" hidden>没有符合条件的字段。</div></div>`;
}
function lfRenderTrend(rows){
  const dates=lfDateKeys(rows);
  if(!V.fullField||!HEADERS.includes(V.fullField)) V.fullField=["利润-经营利润","商品销售数据-商品销售金额(扣退)","利润-其中：推广费"].find(h=>HEADERS.includes(h))||HEADERS.find(h=>lfIsNumericField(h,rows))||HEADERS[0]||"";
  const col=V.fullField;
  const opts=HEADERS.map(h=>`<option value="${esc(h)}"${h===col?" selected":""}>${esc(dispName(h))}</option>`).join("");
  const trend=lfTrendRows(rows,col,V.fullRange);
  const body=lfFieldTrend(rows);
  return `<div class="lf-shell"><div class="lf-sticky"><div class="lf-tabs"><button type="button" class="lf-tab" data-lf-mode="daily">每日字段</button><button type="button" class="lf-tab on" data-lf-mode="trend">字段趋势</button><span class="lf-count">逐日查看，不做日聚合</span></div>`
    +`<div class="lf-trend-controls"><label>字段<select id="lfTrendField">${opts}</select></label><label>开始<input id="lfTrendA" type="date" min="${dates[0]||""}" max="${dates[dates.length-1]||""}" value="${esc(V.fullRange.a)}"></label><label>结束<input id="lfTrendB" type="date" min="${dates[0]||""}" max="${dates[dates.length-1]||""}" value="${esc(V.fullRange.b)}"></label><button type="button" class="btn ghost" data-lf-range="all">全部</button><button type="button" class="btn ghost" data-lf-range="30">近30天</button><button type="button" class="btn ghost" data-lf-range="90">近90天</button></div></div>`
    +`<div class="lf-trend-body">${body}</div></div>`;
}
function renderLinkFieldExperience(rows){
  const body=$("dBody");
  body.innerHTML=V.fullMode==="trend"?lfRenderTrend(rows):lfRenderDaily(rows);
  if(V.fullMode!=="trend") lfApplyDailyFilters();
  $("dPager").innerHTML="";
}
/* ---------- 表格：逐行 ---------- */
function vTableRows(rows){
  const f=vTop(), adjId=vAdjId();
  const sorted=[...rows].sort((a,b)=>cmpValues(V.sort.key,a[V.sort.key],b[V.sort.key],V.sort.dir,false));
  const size=100;
  const maxPage=Math.max(1,Math.ceil(sorted.length/size));
  if(V.page>maxPage) V.page=maxPage;
  const slice=sorted.slice((V.page-1)*size,V.page*size);
  const body=$("dBody");

  if(V.allFields && (f.kind==="link"||f.kind==="title")){
    renderLinkFieldExperience(rows);
    return;
  }
  if(V.allFields){
    let h="";
    for(const r of slice){
      const dmk=(adjId&&window.adjDateMark)?window.adjDateMark(adjId,r["日期"]):"";
      h+=`<div class="rowcard${dmk?" has-adj":""}"><div class="rdate">${esc(r["日期"]||"")}${dmk}　${esc(r["店铺名称"]||"")}　${esc(r["店铺款式编码"]||"")}${r["店铺款式编码"]?`<span class="cpy" data-cpy="${esc(r["店铺款式编码"])}" title="复制编码">⧉</span>`:""}</div><div class="kv">`;
      for(const hd of HEADERS){
        const v=r[hd]||""; if(v==="") continue;
        h+=`<div class="item" title="${esc(hd)}: ${esc(v)}">${dispName(hd)}：<b>${esc(v)}</b></div>`;
      }
      h+=`</div></div>`;
    }
    const ct=computeTotals(rows), ctRoi=calcRoi(ct.sm,ct.ad,ct.pf);
    body.innerHTML=(h||'<div style="padding:30px;text-align:center;color:var(--text3)">无数据</div>')
      +`<div class="sumcard"><span>汇总（${ct.count.toLocaleString()} 行）</span>
      <span>成交金额 ${fmtMoney(ct.sm)}</span><span>商品成本 ${fmtMoney(ct.sc)}</span>
      <span class="${ct.pf>=0?"pos":"neg"}">净利润 ${fmtMoney(ct.pf)}</span>
      <span class="${ct.gl>=0?"pos":"neg"}">毛利润 ${fmtMoney(ct.gl)}</span>
      <span>推广费用 ${fmtMoney(ct.ad)}</span>
      <span>平衡投产 <b style="color:var(--accent)">${isNaN(ctRoi)?"—":ctRoi.toFixed(2)}</b></span></div>`;
    return;
  }

  /* 列裁剪：主体已经交代的信息不再重复 */
  let cols=visibleCols.filter(c=>HEADERS.includes(c));
  if(f.kind==="link"||f.kind==="title") cols=cols.filter(c=>c==="日期"||!["店铺名称","店铺款式编码","商品名称","图片"].includes(c));
  else if(f.kind==="cell") cols=cols.filter(c=>c!==f.col);
  else if(f.kind==="shop"||f.kind==="shopDay") cols=cols.filter(c=>c!=="店铺名称");
  else if(f.kind==="date") cols=cols.filter(c=>c!=="日期");
  if(!cols.length) cols=visibleCols.slice(0,6);

  let h="<table><thead><tr>";
  for(const c of cols){
    const arrow=V.sort.key===c?`<span class="arrow">${V.sort.dir>0?"▲":"▼"}</span>`:`<span class="arrow" style="opacity:.25">⇅</span>`;
    const isNum=MONEY_COLS.has(c)||PCT_COLS.has(c);
    h+=`<th class="${isNum?"num":""}" data-dcol="${esc(c)}" draggable="true" style="cursor:pointer" title="拖动调整列顺序 / 点击排序"><span class="hwrap"><span title="${esc(c)}">${dispName(c)}</span>${arrow}</span><span class="rz" data-rz="${esc(c)}" title="拖动调整列宽"></span></th>`;
  }
  h+="</tr></thead><tbody>";
  for(const r of slice){
    const dmk=(adjId&&window.adjDateMark)?window.adjDateMark(adjId,r["日期"]):"";
    h+=dmk?'<tr class="has-adj">':"<tr>";
    for(const c of cols){
      const v=r[c]??"";
      if(c==="图片"){
        h+= v?`<td><img class="thumb" src="${esc(v)}" loading="lazy" data-img="${esc(v)}" data-imgfail="thumb"></td>`
             :`<td><div class="thumb-ph">无图</div></td>`;
        continue;
      }
      const numCls=MONEY_COLS.has(c)||PCT_COLS.has(c)?" num":"";
      let inner;
      if(MONEY_COLS.has(c)) inner=`<span class="${moneyCls(v)}">${fmtMoney(v)}</span>`;
      else if(PCT_COLS.has(c)) inner=`<span class="pct">${fmtPct(v)}</span>`;
      else inner=esc(v)+(COPY_COLS.has(c)&&v?`<span class="cpy" data-cpy="${esc(v)}" title="点击复制">⧉</span>`:"");
      if(dmk&&c==="日期") inner+=dmk;
      h+=`<td class="${numCls}${CLICK_COLS.has(c)&&v?" clickable":""}"${CLICK_COLS.has(c)&&v?` data-clickcol="${esc(c)}" data-clickval="${esc(v)}"`:""}>${inner}</td>`;
    }
    h+="</tr>";
  }
  h+="</tbody>";
  const dt=computeTotals(rows);
  h+="<tfoot><tr>";
  cols.forEach((c,idx)=>{
    const numCls=MONEY_COLS.has(c)||PCT_COLS.has(c)?" num":"";
    const label=idx===0?`<span class="sumlabel">汇总（${dt.count.toLocaleString()} 行）</span>`:totalCell(c,dt);
    h+=`<td class="${numCls}">${label}</td>`;
  });
  h+="</tr></tfoot></table>";
  if(fixedLayout){
    h=h.replace("<table>",'<table class="fixed" style="table-layout:fixed;width:'+Math.max(sumColWidths(),body.clientWidth)+'px"><colgroup>'+cols.map(c=>`<col style="width:${colWidths[c]||120}px">`).join("")+"</colgroup>");
  }
  body.innerHTML=h;
  $("dPager").innerHTML=`<span>共 ${sorted.length} 行</span>
    <button class="btn" id="dPrev" ${V.page<=1?"disabled":""}>‹ 上一页</button>
    <span>${V.page} / ${maxPage}</span>
    <button class="btn" id="dNext" ${V.page>=maxPage?"disabled":""}>下一页 ›</button>`;
  const pv=$("dPrev"),nx=$("dNext");
  if(pv) pv.onclick=()=>{ V.page--; renderV(); };
  if(nx) nx.onclick=()=>{ V.page++; renderV(); };
}

/* ---------- 表格：聚合 ---------- */
function vAggCols(group){
  if(group==="shop") return [{key:"shop",label:"店铺",drill:"shopLinks"},...SHOP_SUM_COLS.slice(1)];
  if(group==="link") return [{key:"code",label:"链接ID",drill:"linkDays"},{key:"name",label:"链接标题"},{key:"shops",label:"店铺",shops:true},...SHOP_SUM_COLS.slice(1)];
  return [{key:"date",label:"日期",drill:"dayShops"},{key:"shops",label:"店铺",shops:true},...SHOP_SUM_COLS.slice(1)];
}
function vTableAgg(rows){
  const group=V.group;
  const keyCol=group==="shop"?"店铺名称":group==="link"?"店铺款式编码":"日期";
  const arr=aggregateBy(rows,keyCol);
  const cols=vAggCols(group);
  const unit=group==="shop"?"家店铺":group==="link"?"个链接":"天";
  /* 主体是链接（或标题下某编码）时，首列日期后挂「改过」标记 */
  const aid=(typeof vAdjId==="function")?vAdjId():"";
  const markFn=(aid&&window.adjDateMark)?(r=>window.adjDateMark(aid,r.key)):null;
  $("dBody").innerHTML=`<div class="tablewrap sumtable"><table id="dSumTable"></table></div>`;
  renderSumTable("dSumTable",cols,arr,V.sort,`汇总（${arr.length} ${unit} · ${rows.length.toLocaleString()} 行）`,markFn);
}

/* ---------- 多选弹窗（店铺 / 链接 通用） ---------- */
function mpOpen(cfg){
  let pop=document.getElementById("mpPop");
  if(!pop){
    pop=document.createElement("div");
    pop.className="popover"; pop.id="mpPop";
    pop.style.cssText="min-width:300px;max-width:340px;display:none;flex-direction:column";
    document.body.appendChild(pop);
    document.addEventListener("mousedown",e=>{
      const p=document.getElementById("mpPop");
      if(p&&p.style.display==="flex"&&!p.contains(e.target)&&!e.target.closest("#dShopBtn,#dLinkBtn,#dateShopBtn,#dateLinkBtn")) p.style.display="none";
    });
  }
  let sel=new Set(cfg.sel||[]);
  const items=cfg.items||[];
  pop.innerHTML=`<div class="phead"><span class="title">${esc(cfg.title||"选择")}</span></div>`
    +`<div class="psearch"><input id="mpSearch" placeholder="搜索…"></div>`
    +`<div class="plist" id="mpList"></div>`
    +`<div style="padding:8px 10px;border-top:1px solid var(--border);display:flex;gap:6px"><button class="btn" id="mpAll">全选</button><button class="btn" id="mpNone">清空</button><button class="btn primary" id="mpOk" style="margin-left:auto">应用</button></div>`;
  const list=pop.querySelector("#mpList");
  const draw=kw=>{
    const k=(kw||"").toLowerCase();
    const arr=k?items.filter(o=>String(o.label).toLowerCase().indexOf(k)>=0):items;
    list.innerHTML=arr.map(o=>`<label class="pitem"><input type="checkbox" data-mv="${esc(o.value)}" ${sel.has(o.value)?"checked":""}><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(o.label)}">${esc(o.label)}</span>${o.count!=null?`<span style="color:var(--text3);font-size:11px">${o.count} 行</span>`:""}</label>`).join("")
      ||'<div style="padding:14px;text-align:center;color:var(--text3)">无匹配</div>';
  };
  draw("");
  pop.querySelector("#mpSearch").oninput=e=>draw(e.target.value.trim());
  list.onchange=e=>{
    const cb=e.target.closest("input[data-mv]"); if(!cb) return;
    if(cb.checked) sel.add(cb.dataset.mv); else sel.delete(cb.dataset.mv);
  };
  pop.querySelector("#mpAll").onclick=()=>{ items.forEach(o=>sel.add(o.value)); draw(pop.querySelector("#mpSearch").value.trim()); };
  pop.querySelector("#mpNone").onclick=()=>{ sel.clear(); draw(pop.querySelector("#mpSearch").value.trim()); };
  pop.querySelector("#mpOk").onclick=()=>{ pop.style.display="none"; (cfg.onOk||function(){})(sel); };
  pop.style.display="flex";
  const ref=(cfg.anchor||"").match(/^#?(.+)$/)[1];
  const el0=document.getElementById(ref);
  const r=el0?el0.getBoundingClientRect():{left:80,top:80,bottom:100};
  pop.style.left=Math.max(8,Math.min(r.left,window.innerWidth-350))+"px";
  pop.style.top=Math.min(r.bottom+6,window.innerHeight-360)+"px";
}

/* ---------- 抽屉内交互 ---------- */
$("dViewSw").addEventListener("click",e=>{
  const t=e.target.closest(".vs"); if(!t||!V) return;
  if(t.classList.contains("off")){ toast("至少需要 2 天数据才能画折线图"); return; }
  if(V.view===t.dataset.dv) return;
  V.view=t.dataset.dv; V.page=1; renderV();
});
$("dGrpSw").addEventListener("click",e=>{
  const t=e.target.closest(".vs"); if(!t||!V) return;
  const g=t.dataset.dg; if(V.group===g) return;
  V.group=g; V.page=1;
  V.sort = g==="row"?{key:"日期",dir:1}:g==="date"?{key:"date",dir:1}:{key:"amount",dir:-1};
  renderV();
});
$("dFields").onclick=()=>{ if(!V) return; V.allFields=!V.allFields; renderV(); };
/* 单链接字段浏览器：日期跳转、关注字段、筛选和趋势范围 */
$("dBody").addEventListener("click",e=>{
  if(!V) return;
  const mode=e.target.closest("[data-lf-mode]");
  if(mode){ V.fullMode=mode.dataset.lfMode; renderV(); return; }
  const jump=e.target.closest("[data-lf-datejump]");
  if(jump){ lfJumpToDate(jump.dataset.lfDatejump); return; }
  if(e.target.closest("[data-lf-step]")){ lfJumpToDate("",Number(e.target.closest("[data-lf-step]").dataset.lfStep)); return; }
  if(e.target.closest("[data-lf-latest]")){ lfJumpToDate("latest"); return; }
  const action=e.target.closest("[data-lf-action]");
  if(action){
    const open=action.dataset.lfAction==="expand";
    $("dBody").querySelectorAll("details.lf-day").forEach(card=>{ card.open=open; if(open)V.fullOpenDates.add(card.dataset.lfDate); else V.fullOpenDates.delete(card.dataset.lfDate); });
    return;
  }
  const range=e.target.closest("[data-lf-range]");
  if(range){
    if(range.dataset.lfRange==="all") V.fullRange={a:"",b:""};
    else{
      const dates=lfDateKeys(vRows()); if(!dates.length) return;
      const end=dates[dates.length-1], days=Number(range.dataset.lfRange);
      const start=lfShiftDate(end,-days+1); V.fullRange={a:dates[0]>start?dates[0]:start,b:end};
    }
    V.fullMode="trend"; renderV(); return;
  }
  if(e.target.closest("#lfWatchBtn")){
    mpOpen({title:"选择关注字段（最多展示前 4 项）",items:HEADERS.map(h=>({value:h,label:dispName(h)})),sel:V.fullWatch,anchor:"#lfWatchBtn",onOk:sel=>{V.fullWatch=sel;renderV();}});
  }
});
$("dBody").addEventListener("input",e=>{
  if(!V||!e.target.matches("#lfFieldSearch")) return;
  V.fullKeyword=e.target.value; lfApplyDailyFilters();
});
$("dBody").addEventListener("change",e=>{
  if(!V) return;
  if(e.target.matches("#lfDayJump")){ lfJumpToDate(e.target.value); return; }
  if(e.target.matches("#lfShowEmpty")){ V.fullShowEmpty=e.target.checked; lfApplyDailyFilters(); return; }
  if(e.target.matches("#lfChangedOnly")){ V.fullChangedOnly=e.target.checked; lfApplyDailyFilters(); return; }
  if(e.target.matches("#lfTrendField")){ V.fullField=e.target.value; renderV(); return; }
  if(e.target.matches("#lfTrendA,#lfTrendB")){
    const a=$("lfTrendA").value,b=$("lfTrendB").value;
    if(a&&b&&a>b){ toast("开始日期不能晚于结束日期"); renderV(); return; }
    V.fullRange={a,b}; renderV();
  }
});
$("dBody").addEventListener("toggle",e=>{
  if(!V||!e.target.matches("details.lf-day")) return;
  const d=e.target.dataset.lfDate;
  if(e.target.open) V.fullOpenDates.add(d); else V.fullOpenDates.delete(d);
},true);
$("dBack").onclick=()=>{ if(!V||V.stack.length<2) return; V.stack.pop(); V.page=1; V.sort={key:"日期",dir:1}; V.allFields=false; renderV(); };
$("dBase").addEventListener("click",e=>{
  const c=e.target.closest(".crumb"); if(!c||!V) return;
  const i=+c.dataset.ci;
  if(i===V.stack.length-1) return;
  V.stack=V.stack.slice(0,i+1); V.page=1; V.sort={key:"日期",dir:1}; renderV();
});
$("dDateA").onchange=()=>{ if(!V) return; V.scope.a=$("dDateA").value; V.page=1; renderV(); };
$("dDateB").onchange=()=>{ if(!V) return; V.scope.b=$("dDateB").value; V.page=1; renderV(); };
document.addEventListener("click",e=>{
  const q=e.target.closest("[data-dq]"); if(!q||!V) return;
  const k=q.dataset.dq, d=new Date(), f=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
  const yest=f(new Date(d.getFullYear(),d.getMonth(),d.getDate()-1));
  if(k==="all") V.scope.a=V.scope.b="";
  else if(k==="7"){ V.scope.a=f(new Date(d.getFullYear(),d.getMonth(),d.getDate()-7)); V.scope.b=yest; }
  else if(k==="30"){ V.scope.a=f(new Date(d.getFullYear(),d.getMonth(),d.getDate()-30)); V.scope.b=yest; }
  V.page=1; renderV();
});
let vKwTimer=null;
$("dKw").addEventListener("input",e=>{
  if(!V) return;
  clearTimeout(vKwTimer);
  vKwTimer=setTimeout(()=>{ if(!V) return; V.scope.kw=e.target.value; V.page=1; renderV(); },220);
});
$("dClear").onclick=()=>{
  if(!V) return;
  V.scope=vNewScope(); V.page=1; $("dKw").value=""; renderV(); toast("已清空抽屉筛选");
};
$("dShopBtn").onclick=()=>{
  if(!V) return;
  const rows=vFrameRows();
  const map=new Map();
  for(const r of rows){ const s=r["店铺名称"]||""; map.set(s,(map.get(s)||0)+1); }
  const items=[...map.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"zh")).map(([v,n])=>({value:v,label:v||"(空)",count:n}));
  mpOpen({title:"筛选店铺（不选=全部）",items:items,sel:V.scope.shops,anchor:"#dShopBtn",onOk:sel=>{ V.scope.shops=sel; V.page=1; renderV(); }});
};
$("dLinkBtn").onclick=()=>{
  if(!V) return;
  const rows=vFrameRows();
  const map=new Map();
  for(const r of rows){ const c=r["店铺款式编码"]||""; if(!map.has(c)) map.set(c,{n:0,name:r["商品名称"]||""}); map.get(c).n++; }
  const items=[...map.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"zh")).map(([v,o])=>({value:v,label:(v||"(空)")+" "+(o.name||""),count:o.n}));
  mpOpen({title:"筛选链接（不选=全部）",items:items,sel:V.scope.links,anchor:"#dLinkBtn",onOk:sel=>{ V.scope.links=sel; V.page=1; renderV(); }});
};
$("dTabs").addEventListener("click",e=>{
  const t=e.target.closest(".dtab"); if(!t||!V) return;
  if(V.tabId===t.dataset.tab) return;
  V.tabId=t.dataset.tab; V.page=1; V.fullOpenDates.clear(); V.fullFocusDate=""; renderV();
});
$("dBody").addEventListener("click",e=>{
  if(!V) return;
  const img=e.target.closest("img.thumb");
  if(img){ $("lightboxImg").src=img.dataset.img; $("lightbox").style.display="flex"; return; }
  const th=e.target.closest("#dBody th[data-dcol]");
  if(th){
    const c=th.dataset.dcol;
    V.sort=(V.sort.key===c)?{key:c,dir:-V.sort.dir}:{key:c,dir:1};
    V.page=1; renderV(); return;
  }
  const sk=e.target.closest("#dBody th[data-sk]");
  if(sk){
    const k=sk.dataset.sk;
    V.sort=(V.sort.key===k)?{key:k,dir:-V.sort.dir}:{key:k,dir:(k==="date"||k==="shops"||k==="shop"||k==="code"||k==="name")?1:-1};
    renderV(); return;
  }
  const roi=e.target.closest("td.roicell");
  if(roi){
    const table=$("dSumTable");
    let d=null,label=null;
    if(table&&roi.closest("tbody")&&table._sumRows){
      const tr=roi.closest("tr");
      const idx=[...table.querySelector("tbody").children].indexOf(tr);
      d=table._sumRows[idx]; label=d?d.label:null;
    }else if(table&&table._sumTot){ d=table._sumTot; label="汇总"; }
    if(d) showRoiPop(d,label||"",e.clientX,e.clientY);
    return;
  }
  const lc=e.target.closest(".linkcell");
  if(lc){
    const v=lc.dataset.val, d=lc.dataset.drill, cur=vTop();
    /* 已经在同一主体里，不再重复下钻 */
    if(d==="shopLinks"&&cur&&cur.shop===v) return;
    if(d==="linkDays"&&cur&&cur.code===v) return;
    if(d==="dayShops"&&cur&&cur.date===v) return;
    if(d==="shopLinks"){ V.stack.push(cur&&cur.date?{kind:"shopDay",date:cur.date,shop:v}:{kind:"shop",shop:v}); }
    else if(d==="linkDays"){ V.stack.push({kind:"link",code:v,shop:cur&&cur.shop?cur.shop:null}); }
    else if(d==="dayShops"){ V.stack.push({kind:"date",date:v}); }
    else return;
    V.page=1; V.sort={key:"日期",dir:1}; V.allFields=false; renderV(); return;
  }
  const cl=e.target.closest("[data-clickcol]");
  if(cl){
    const col=cl.dataset.clickcol, val=cl.dataset.clickval;
    if(!col) return;
    V.stack.push(vSubj(col,val));
    V.page=1; V.sort={key:"日期",dir:1}; renderV(); return;
  }
});

/* ================= 事件绑定 ================= */
// 表头：排序 + 筛选
$("thead").addEventListener("click",e=>{
  const ficon=e.target.closest(".ficon");
  if(ficon){ e.stopPropagation(); showFilterPop(ficon, ficon.dataset.f); return; }
  const th=e.target.closest("th"); if(!th) return;
  const c=th.dataset.col; if(!c) return;
  if(sort.col===c) sort.dir=-sort.dir; else sort={col:c,dir:1};
  page=1; updateSortInfo(); render();
});
// 列宽拖拽调整（主表 + 抽屉通用）
document.addEventListener("mousedown",e=>{
  const rz=e.target.closest(".rz"); if(!rz) return;
  e.preventDefault(); e.stopPropagation();
  const col=rz.dataset.rz;
  const inDrawer=!!rz.closest("#dBody");
  if(!fixedLayout){
    visibleCols.forEach(c=>{
      const th=inDrawer
        ?document.querySelector('#dBody th[data-dcol="'+c.replace(/"/g,'')+'"]')
        :document.querySelector('#thead th[data-col="'+c.replace(/"/g,'')+'"]');
      if(th) colWidths[c]=th.offsetWidth;
    });
    fixedLayout=true;
    if(inDrawer) renderV(); else renderTable();
  }
  const startW=colWidths[col]||120, startX=e.clientX;
  rz.classList.add("drag");
  document.body.style.cursor="col-resize"; document.body.style.userSelect="none";
  const move=ev=>{ setColWidth(col, Math.max(60, startW+ev.clientX-startX)); };
  const up=()=>{
    rz.classList.remove("drag");
    document.body.style.cursor=""; document.body.style.userSelect="";
    document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up);
  };
  document.addEventListener("mousemove",move);
  document.addEventListener("mouseup",up);
});
// 拖动表头调整列顺序（主表 + 抽屉通用）
let dragCol=null;
document.addEventListener("dragstart",e=>{
  const th=e.target.closest("th[data-col],th[data-dcol]"); if(!th) return;
  dragCol=th.dataset.col||th.dataset.dcol;
  th.classList.add("dragging");
  if(e.dataTransfer){ e.dataTransfer.effectAllowed="move"; try{e.dataTransfer.setData("text/plain",dragCol);}catch(_){} }
});
document.addEventListener("dragend",()=>{
  if(!dragCol) return;
  dragCol=null; dragDepth=0;
  const m=$("dropMask"); if(m) m.style.display="none";
  document.querySelectorAll("th.dragging").forEach(t=>t.classList.remove("dragging"));
});
document.addEventListener("dragover",e=>{
  if(!dragCol) return;
  const th=e.target.closest("th[data-col],th[data-dcol]");
  if(th&&(th.dataset.col||th.dataset.dcol)!==dragCol) e.preventDefault();
});
document.addEventListener("drop",e=>{
  e.preventDefault(); dragDepth=0; $("dropMask").style.display="none";
  const f=e.dataTransfer.files[0]; if(!f) return;
  if(!/\.(csv|xlsx|xlsm|txt)$/i.test(f.name)&&!/csv|sheet|excel/i.test(f.type||"")){ toast("请拖入 Excel 或 CSV 文件"); return; }
  impHandleFile(f);
});
document.addEventListener("dragend",()=>{
  dragCol=null;
  document.querySelectorAll("th.dragging").forEach(t=>t.classList.remove("dragging"));
});
function updateSortInfo(){
  const sel=$("sortColSel");
  const opts=[...DEFAULT_COLS.filter(c=>HEADERS.includes(c)&&c!=="图片"), ...HEADERS.filter(h=>!DEFAULT_COLS.includes(h))];
  sel.innerHTML=opts.map(c=>`<option value="${esc(c)}">${dispName(c)}</option>`).join("");
  sel.value=sort.col; if(sel.value!==sort.col){ sel.value=opts[0]; sort.col=opts[0]; }
  $("sortDirSel").value=String(sort.dir);
}
$("sortColSel").onchange=e=>{ sort={col:e.target.value,dir:sort.dir}; page=1; render(); };
$("sortDirSel").onchange=e=>{ sort.dir=parseInt(e.target.value,10)||1; page=1; render(); };
$("btnResetSort").onclick=()=>{ sort={...DEFAULT_SORT}; page=1; updateSortInfo(); render(); };

// 点击单元格 → 抽屉；点击图片 → 灯箱
$("tbody").addEventListener("click",e=>{
  const img=e.target.closest("img.thumb");
  if(img){ $("lightboxImg").src=img.dataset.img; $("lightbox").style.display="flex"; return; }
  const td=e.target.closest("[data-clickcol]");
  if(td) openDrawer(td.dataset.clickcol, td.dataset.clickval);
});
// 搜索
let searchTimer=null;
$("searchInput").addEventListener("input",e=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{ searchText=e.target.value; page=1; render(); },200);
});

// 清空筛选
$("btnClearFilter").onclick=()=>{ colFilters={}; searchText=""; $("searchInput").value=""; page=1; render(); toast("已清空全部筛选"); };

// 分页
$("pgFirst").onclick=()=>{page=1;renderTable();renderPager();};
$("pgPrev").onclick=()=>{page--;renderTable();renderPager();};
$("pgNext").onclick=()=>{page++;renderTable();renderPager();};
$("pgLast").onclick=()=>{page=Math.max(1,Math.ceil(filtered.length/pageSize));renderTable();renderPager();};
$("pageSize").onchange=e=>{pageSize=parseInt(e.target.value,10)||100;page=1;renderTable();renderPager();};

// 列选择器
$("btnCols").onclick=e=>{ e.stopPropagation(); const p=$("colPop"); if(p.style.display==="flex") hideColPop(); else showColPop(e.currentTarget); };
let fpopPressed=false;   // mousedown 时是否按在筛选弹窗内（日历重渲染会把节点移出 DOM，click 时 contains 判断会失灵）
document.addEventListener("mousedown",e=>{ fpopPressed=!!e.target.closest("#fpop"); });
document.addEventListener("click",e=>{
  if(!e.target.closest("#colPop")&&!e.target.closest("#btnCols")) hideColPop();
  const fp=document.getElementById("fpop");
  if(fp&&!fpopPressed&&!fp.contains(e.target)&&!e.target.closest(".ficon")) fp.remove();
});

/* 日期选择限制：今天及以后的日期不可选（原生 date 输入框 max=昨天） */
(function(){
  const yd=new Date(Date.now()-864e5);
  const ys=yd.getFullYear()+"-"+String(yd.getMonth()+1).padStart(2,"0")+"-"+String(yd.getDate()).padStart(2,"0");
  ["dateRangeA","dateRangeB","dDateA","dDateB"].forEach(id=>{
    const el=$(id); if(!el) return;
    el.max=ys;
    el.addEventListener("input",()=>{ if(el.value&&el.value>ys){ el.value=ys; el.dispatchEvent(new Event("change")); } });
  });
})();

// 导入
$("btnImport").onclick=()=>$("fileInput").click();
/* 主题切换（深/浅，localStorage 持久化） */
function applyTheme(t){
  document.documentElement.dataset.theme=t;
  $("themeBtn").textContent=t==="light"?"🌙 深色":"☀️ 浅色";
  $("themeBtn").title=t==="light"?"切换到深色主题":"切换到浅色主题";
  try{ ST.set("gpv-theme",t); }catch(_){}
}
$("themeBtn").onclick=()=>applyTheme((document.documentElement.dataset.theme||"dark")==="dark"?"light":"dark");
try{ const savedTheme=ST.get("gpv-theme"); if(savedTheme==="light"||savedTheme==="dark") applyTheme(savedTheme); }catch(_){}
// 视图页签
document.querySelectorAll("#viewTabs .vtab").forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$("fileInput").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  impHandleFile(f);
  e.target.value="";
};
// 拖放
let dragDepth=0;
document.addEventListener("dragenter",e=>{
  if(dragCol) return; // 列顺序拖拽，不触发文件导入遮罩
  e.preventDefault();dragDepth++;$("dropMask").style.display="flex";});
document.addEventListener("dragleave",e=>{
  if(dragCol) return;
  e.preventDefault();if(--dragDepth<=0){dragDepth=0;$("dropMask").style.display="none";}});
document.addEventListener("dragover",e=>e.preventDefault());

// ESC 关闭
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    closeDrawer(); hideColPop();
    const fp=document.getElementById("fpop"); if(fp) fp.remove();
    const mp=document.getElementById("mpPop"); if(mp) mp.style.display="none";
    $("lightbox").style.display="none";
  }
});

/* ================= 调整记录模块（与利润数据按链接ID打通） ================= */
(function(){
"use strict";
const REC_KEY="adlog_records_v2", SHOP_KEY="adlog_shops_v1", IMG_KEY="adlog_linkimgs_v1", PREF_KEY="plb_prefs_v1", PLAN_KEY="adlog_plans_v1";
const PLANS={"PDD":["稳定成本推广","全店推广","其他"],"抖音":["乘方","全域自选","全域全店托管","其他"],"淘宝":["全站推广","关键词推广","其他"]};
const WINS=[[3,"3天"],[7,"7天"],[14,"14天"],[30,"30天"],[0,"全部"]];

const el=id=>document.getElementById(id);
const H=s=>String(s==null?"":s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const pad=n=>String(n).padStart(2,"0");
const today=()=>{const d=new Date();return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());};
function shiftDate(s,n){const p=String(s||"").split("-").map(Number);if(p.length<3||!p[0])return s;const d=new Date(p[0],p[1]-1,p[2]);d.setDate(d.getDate()+n);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
function dayDiff(a,b){if(!a||!b)return 0;const pa=a.split("-").map(Number),pb=b.split("-").map(Number);if(pa.length<3||pb.length<3)return 0;return Math.round((new Date(pb[0],pb[1]-1,pb[2])-new Date(pa[0],pa[1]-1,pa[2]))/864e5);}
const norm=s=>String(s||"").trim().toLowerCase();
const num=v=>{const n=toNum(v);return isNaN(n)?0:n;};
const fm=v=>"¥"+Math.round(v||0).toLocaleString("zh-CN");
const fr=v=>isNaN(v)?"—":v.toFixed(2);

/* ---------- 本地数据 ---------- */
let recList=[];
try{ recList=JSON.parse(ST.get(REC_KEY)||"[]")||[]; }catch(e){ recList=[]; }
if(!Array.isArray(recList)) recList=[];
recList.forEach(r=>{ if(r.gstat==="未完成") r.gstat="进行中"; });
/* 调整计划：先记下打算怎么调，确认「已调整」后才转成调整记录；计划本身不带时间 */
let planList=[];
try{ planList=JSON.parse(ST.get(PLAN_KEY)||"[]")||[]; }catch(e){ planList=[]; }
if(!Array.isArray(planList)) planList=[];
const savePlans=()=>{ try{ ST.set(PLAN_KEY, JSON.stringify(planList)); }catch(e){ toast("本地存储已满，建议删掉部分计划"); } };
let lgSelected=new Set();
let shops={"PDD":[],"抖音":[],"淘宝":[]};
try{ Object.assign(shops, JSON.parse(ST.get(SHOP_KEY)||"{}")); }catch(e){}
const saveRecs=()=>{ try{ ST.set(REC_KEY, JSON.stringify(recList)); }catch(e){ toast("本地存储已满，建议删除部分记录"); } };
let prefs={win:7};
try{ Object.assign(prefs, JSON.parse(ST.get(PREF_KEY)||"{}")); }catch(e){}
const savePrefs=()=>{ try{ ST.set(PREF_KEY, JSON.stringify(prefs)); }catch(e){} };
let winDays=[0,3,7,14,30].includes(prefs.win)?prefs.win:7;

/* ---------- 索引 ---------- */
let _ridx=null, _pidx=null, _pkey="";
function recIdx(){
  if(_ridx) return _ridx;
  const m=new Map();
  for(const r of recList){ const k=norm(r.linkId); if(!k) continue; if(!m.has(k)) m.set(k,[]); m.get(k).push(r); }
  for(const a of m.values()) a.sort((x,y)=>String(y.time||"").localeCompare(String(x.time||"")));
  _ridx=m; return m;
}
function recsOf(id){ const k=norm(id); return (k&&recIdx().get(k))||[]; }

/* ---------- 店铺解析：利润表店铺列格式为「平台-店铺」 ---------- */
const PLAT_ALIAS=[
  [["pdd","拼多多","pop","多多"],"PDD"],
  [["抖音","抖店","douyin","dy"],"抖音"],
  [["淘宝","天猫","taobao","tmall","tb"],"淘宝"]
];
function splitShop(raw){
  const s=String(raw||"").trim();
  if(!s) return {platform:"",shop:""};
  const m=s.match(/^([^\-－—_\/]{1,10})\s*[\-－—_\/]\s*(.+)$/);
  if(!m) return {platform:"",shop:s};
  const head=m[1].trim().toLowerCase(), tail=m[2].trim();
  for(const [keys,p] of PLAT_ALIAS){
    if(keys.some(k=>head===k||head.includes(k))) return {platform:p,shop:tail};
  }
  return {platform:"",shop:s};
}
window.splitShop=splitShop;
function shopLabel(r){
  if(!r) return "—";
  const p=String(r.platform||"").trim();
  const sp=splitShop(r.shop||"");
  const name=sp.shop||String(r.shop||"").trim();
  const plat=p||sp.platform;
  if(!name) return plat||"—";
  return plat?plat+"-"+name:name;
}

/* ---------- 链接图片：以链接ID为主键，导入 CSV 时自动归集 ---------- */
let linkImgs={};
try{ Object.assign(linkImgs, JSON.parse(ST.get(IMG_KEY)||"{}")); }catch(e){ linkImgs={}; }
const saveImgs=()=>{ try{ ST.set(IMG_KEY, JSON.stringify(linkImgs)); }catch(e){} };
const saveShops=()=>{ try{ ST.set(SHOP_KEY, JSON.stringify(shops)); }catch(e){} };

/* ---------- 内置备份：首次打开自动导入一次（之后一律以本地为准） ---------- */
const SEED_KEY="plb_seed_v1";
/* 旧版备份的商品图主键是「L:平台|链接ID」，统一收敛成纯链接ID */
function normImgKey(k){
  const s=String(k||"").trim();
  const m=s.match(/^L:[^|]*\|(.+)$/i);
  return (m?m[1]:s).trim().toLowerCase();
}
window.normImgKey=normImgKey;
(function seedOnce(){
  const sd=window.__SEED__;
  if(!sd) return;
  let done="";
  try{ done=ST.get(SEED_KEY)||""; }catch(e){}
  if(done==="1") return;
  let add=0;
  if(Array.isArray(sd.records)){
    const has=new Set(recList.map(r=>String(r.id)));
    for(const r of sd.records){
      if(!r||!r.linkId) continue;
      const id=String(r.id||(Date.now()+"_"+Math.random().toString(36).slice(2,7)));
      if(has.has(id)) continue;
      has.add(id); recList.push(Object.assign({},r,{id})); add++;
    }
  }
  if(sd.shops&&typeof sd.shops==="object"){
    for(const p of Object.keys(sd.shops)){
      const arr=Array.isArray(sd.shops[p])?sd.shops[p]:[];
      if(!Array.isArray(shops[p])) shops[p]=[];
      for(const s of arr){ if(s&&shops[p].indexOf(s)<0) shops[p].push(s); }
    }
  }
  if(sd.linkImgs&&typeof sd.linkImgs==="object"){
    for(const k of Object.keys(sd.linkImgs)){
      const v=String(sd.linkImgs[k]||"").trim(); if(!v) continue;
      const key=normImgKey(k);
      if(key&&!linkImgs[key]) linkImgs[key]=v;
    }
  }
  if(add){ saveRecs(); _ridx=null; }
  saveShops(); saveImgs();
  try{ ST.set(SEED_KEY,"1"); }catch(e){}
  window.__SEED_ADDED__=add;
})();
const IMG_COLS=["图片","商品图片","主图","图片链接","商品主图","主图链接"];
const rowImg=r=>{ for(const k of IMG_COLS){ const v=String(r[k]||"").trim(); if(v) return v; } return ""; };
window.syncLinkImages=function(){
  if(!ROWS.length) return;
  let changed=false;
  for(const r of ROWS){
    const id=String(r["店铺款式编码"]||"").trim();
    const img=rowImg(r);
    if(!id||!img) continue;
    if(linkImgs[id]!==img){ linkImgs[id]=img; changed=true; }
  }
  if(changed) saveImgs();
};
function imgOf(linkId){
  const k=String(linkId||"").trim();
  if(!k) return "";
  if(linkImgs[k]) return linkImgs[k];
  const lk=k.toLowerCase();
  if(linkImgs[lk]) return linkImgs[lk];
  /* 兼容旧版备份键：L:平台|链接ID */
  for(const key of Object.keys(linkImgs)){
    if(/^L:/i.test(key)&&normImgKey(key)===lk&&linkImgs[key]) return linkImgs[key];
  }
  const r=ROWS.find(x=>norm(x["店铺款式编码"])===norm(k));
  return (r&&rowImg(r))||"";
}
window.imgOf=imgOf;
function profitIdx(){
  const key=ROWS.length+"|"+(HEADERS.join(","))+"|"+(ROWS[0]?ROWS[0]["店铺名称"]+ROWS[0]["日期"]:"");
  if(_pidx&&_pkey===key) return _pidx;
  const m=new Map();
  for(const r of ROWS){
    const k=norm(r["店铺款式编码"]); if(!k) continue;
    const d=String(r["日期"]||"").slice(0,10); if(!d) continue;
    const o={date:d,amt:num(r["商品销售数据-商品销售金额(扣退)"]),prof:num(r["利润-经营利润"]),ad:num(r["利润-其中：推广费"])};
    if(!m.has(k)) m.set(k,[]);
    m.get(k).push(o);
  }
  for(const a of m.values()) a.sort((x,y)=>x.date.localeCompare(y.date));
  _pidx=m; _pkey=key; return m;
}

/* ---------- 效果计算 ---------- */
function agg(rows){
  let amt=0,prof=0,ad=0; const ds=new Set();
  for(const r of rows){ amt+=r.amt; prof+=r.prof; ad+=r.ad; ds.add(r.date); }
  const d=ds.size||1;
  return {amt,prof,ad,days:ds.size,roi:calcRoi(amt,ad,prof),pr:amt>0?prof/amt:NaN,avgAmt:amt/d,avgProf:prof/d,avgAd:ad/d};
}
function effect(rec){
  const rows=profitIdx().get(norm(rec.linkId));
  const adj=String(rec.time||"").slice(0,10);
  if(!rows||!rows.length||!adj) return null;
  const last=rows[rows.length-1].date;
  let prev,next,elapsed,complete=true;
  if(winDays>0){
    const ps=shiftDate(adj,-winDays), ne=shiftDate(adj,winDays);
    prev=rows.filter(r=>r.date>=ps&&r.date<adj);
    next=rows.filter(r=>r.date>=adj&&r.date<ne);
    /* 观察期按自然日算：数据覆盖到的最后一天与今天取较早者，某天无成交记录不算「未观察」 */
    const availEnd=shiftDate(last,1), todayEnd=shiftDate(today(),1);
    const endLimit=availEnd<todayEnd?availEnd:todayEnd;
    elapsed=Math.max(0,Math.min(winDays,dayDiff(adj,endLimit)));
    complete=elapsed>=winDays;
  }else{
    prev=rows.filter(r=>r.date<adj);
    next=rows.filter(r=>r.date>=adj);
    elapsed=Math.max(0,dayDiff(adj,shiftDate(last,1)));
  }
  const p=agg(prev), n=agg(next);
  return {prev:p,next:n,complete,elapsed,adj,ok:p.days>0&&n.days>0};
}
function verdict(rec,m){
  if(!m) return {k:"no",t:ROWS.length?"该链接无利润数据":"未导入数据",cls:"v-no"};
  if(!m.ok) return {k:"no",t:"前后数据不足",cls:"v-no"};
  if(winDays>0&&!m.complete) return {k:"watch",t:`观察中 ${m.elapsed}/${winDays}天`,cls:"v-watch"};
  /* 判据：观察期平均利润率（Σ经营利润÷Σ成交金额，按成交额加权）的百分点变化 */
  if(!(m.prev.amt>0)||!(m.next.amt>0)) return {k:"no",t:"观察期无成交",cls:"v-no"};
  const a=m.prev.pr,b=m.next.pr;
  if(isNaN(a)||isNaN(b)) return {k:"no",t:"利润率不可比",cls:"v-no"};
  const d=(b-a)*100, p=(d>=0?"+":"")+d.toFixed(1)+"pp";
  if(d>=1) return {k:"up",t:"有效 "+p,cls:"v-up"};
  if(d<=-1) return {k:"down",t:"无效 "+p,cls:"v-down"};
  return {k:"flat",t:"持平 "+p,cls:"v-flat"};
}

/* ---------- 抽屉内联动：该链接的投放调整 ---------- */
function adjChipHtml(r){
  const vd=verdict(r,effect(r));
  const d=String(r.time||"").slice(5,10);
  const it=H(r.item||r.plan||"调整");
  const ba=(r.before||r.after)?` <span class="arw">${H(r.before||"—")}→</span><b>${H(r.after||"—")}</b>`:"";
  const tip=[r.plan,r.item,(r.before||r.after)?`${r.before||"—"} → ${r.after||"—"}`:"",r.reason].filter(Boolean).join(" · ");
  return `<button class="adj-chip" data-adj-open="${H(r.linkId||"")}" title="${H(tip)}">`
    +`<b>${d}</b> ${it}${ba}<span class="jc ${vd.k}">${H(vd.t)}</span></button>`;
}
/* 某天是否改过 → 表格里给那天打标 */
window.adjDateMark=function(linkId,date,compact){
  const k=String(date||"").slice(0,10);
  if(!k||!linkId) return "";
  const rs=recsOf(linkId).filter(r=>String(r.time||"").slice(0,10)===k);
  if(!rs.length) return "";
  const tip=rs.map(r=>{
    const it=r.item||r.plan||"调整";
    const ba=(r.before||r.after)?`${r.before||"—"} → ${r.after||"—"}`:"";
    return [it+"："+(ba||(r.reason||"")),ba&&r.reason?`（${r.reason}）`:""].join("");
  }).filter(Boolean).join("\n");
  return `<span class="dm${compact?" dm-i":""}" data-adj-open="${H(linkId)}" title="当天有投放调整：&#10;${H(tip)}">${compact?"✏️":"✏️ 改过"}</span>`;
};
/* 抽屉顶部的调整条 */
let dAdjLink="";
window.renderDAdj=function(linkId,title,shop,platform){
  const box=el("dAdj"); if(!box) return;
  const id=String(linkId||"").trim();
  dAdjLink=id;
  if(!id){ box.style.display="none"; box.innerHTML=""; return; }
  const rs=recsOf(id);
  box.style.display="block";
  const addBtn=`<button class="dadj-add" data-adj-new="${H(id)}" data-adj-title="${H(title||"")}" data-adj-shop="${H(shop||"")}" data-adj-platform="${H(platform||"")}">＋ 记一笔</button>`;
  if(!rs.length){
    box.innerHTML=`<div class="dadj-row"><span class="dadj-t">🎯 投放调整</span>`
      +`<span class="dadj-meta">还没有记录 · 记一笔后，这里会列出每次改动和前后效果</span>${addBtn}</div>`;
    return;
  }
  const last=rs[0];
  box.innerHTML=`<div class="dadj-row"><span class="dadj-t">🎯 投放调整</span>`
    +`<span class="dadj-meta">${rs.length} 次 · 最近 ${String(last.time||"").slice(5,10).replace("-","/")} · ${H(last.gstat||"进行中")}</span>`
    +`<span class="dadj-meta" style="color:var(--accent);cursor:pointer" data-adj-open="${H(id)}">查看完整时间线 →</span>`
    +`${addBtn}</div>`
    +`<div>${rs.slice(0,4).map(adjChipHtml).join("")}</div>`;
};

/* 点击抽屉里的调整条 / 记一笔 */
document.addEventListener("click",e=>{
  const th=e.target.closest("img.rc-thumb,img.pw-thumb");
  if(th){
    e.preventDefault(); e.stopPropagation();
    const lb=document.getElementById("lightbox");
    if(lb){ document.getElementById("lightboxImg").src=th.src; lb.style.display="flex"; }
    return;
  }
  const nw=e.target.closest("[data-adj-new]");
  if(nw){
    e.preventDefault(); e.stopPropagation();
    openForm({linkId:nw.dataset.adjNew,title:nw.dataset.adjTitle||"",shop:nw.dataset.adjShop||"",platform:nw.dataset.adjPlatform||""});
    return;
  }
  const op=e.target.closest("[data-adj-open]");
  if(op){
    e.preventDefault(); e.stopPropagation();
    const id=String(op.dataset.adjOpen||"");
    if(typeof V!=="undefined"&&V&&typeof vAdjId==="function"&&vAdjId()===id&&$("drawer").classList.contains("open")){
      V.view="records"; renderV();
    } else openRecPanel(id);
  }
},true);

/* ---------- 利润明细表：最近调整列 ---------- */
window.recCellHtml=function(r){
  const id=String(r["店铺款式编码"]||"").trim();
  const rs=recsOf(id);
  const attr=`data-rec-link="${H(id)}"`;
  if(!rs.length) return `<td class="reccell empty" ${attr}><span class="rc-plus">＋ 记一笔</span></td>`;
  const last=rs[0];
  const gap=dayDiff(String(last.time||"").slice(0,10),today());
  const g=last.gstat||"进行中";
  const what=last.item||last.plan||"调整";
  const ba=(last.before||last.after)?`${last.before||"—"}→${last.after||"—"}`:"";
  const ttl=[last.plan,last.item,(last.before||last.after)?`${last.before||"—"} → ${last.after||"—"}`:"",last.reason,`共 ${rs.length} 条记录`].filter(Boolean).join(" · ");
  return `<td class="reccell" ${attr} title="${H(ttl)}">`
    +`<span class="rdot ${g==="已完成"?"done":"watch"}"></span><b>${gap<=0?"今天":gap+"天前"}</b>`
    +`<span class="rc-what">${H(what.length>6?what.slice(0,6)+"…":what)}${ba?` <span class="rc-val">${H(ba)}</span>`:""}</span>`
    +(rs.length>1?`<span class="rc-cnt">${rs.length}</span>`:"")+`</td>`;
};
document.getElementById("tbody").addEventListener("click",e=>{
  const td=e.target.closest("td.reccell"); if(!td) return;
  e.stopPropagation();
  openRecPanel(td.dataset.recLink);
});

/* ================= 折线图：抽屉 / 记录面板共用 ================= */
const CHART_METS=[
  {k:"amt", label:"成交金额", f:fm, color:"var(--accent)"},
  {k:"prof",label:"净利润",   f:fm, color:"var(--green)"},
  {k:"gl",  label:"毛利额",   f:fm, color:"var(--amber)"},
  {k:"ad",  label:"推广费",   f:fm, color:"var(--red)"},
  {k:"roi", label:"平衡投产", f:fr, color:"#a78bfa", axis:2}
];
const CHART_MET_MAP={}; CHART_METS.forEach(m=>CHART_MET_MAP[m.k]=m);
function chartMets(){
  const saved=Array.isArray(prefs.chartM)?prefs.chartM.filter(k=>CHART_MET_MAP[k]):[];
  return saved.length?saved:["prof","ad"];
}
function setChartMets(arr){ prefs.chartM=arr; savePrefs(); }
/* 明细行 → 按日期聚合的日序列（严格升序） */
function dailySeries(rows){
  const m=new Map();
  for(const r of rows||[]){
    const d=String(r["日期"]||"").slice(0,10); if(!d) continue;
    let o=m.get(d); if(!o){ o={date:d,amt:0,prof:0,gl:0,ad:0}; m.set(d,o); }
    const a=toNum(r["商品销售数据-商品销售金额(扣退)"]); if(!isNaN(a)) o.amt+=a;
    const p2=toNum(r["利润-经营利润"]); if(!isNaN(p2)) o.prof+=p2;
    const g2=toNum(r["利润-毛利额"]); if(!isNaN(g2)) o.gl+=g2;
    const d2=toNum(r["利润-其中：推广费"]); if(!isNaN(d2)) o.ad+=d2;
  }
  const arr=[...m.values()].sort((x,y)=>x.date.localeCompare(y.date));
  for(const o of arr) o.roi=calcRoi(o.amt,o.ad,o.prof);
  return arr;
}
function metChipsHtml(sel){
  sel=sel||chartMets();
  return CHART_METS.map(m=>{
    const on=sel.includes(m.k);
    return `<span class="mchip${on?" on":""}" data-mk="${m.k}" style="${on?`color:${m.color}`:""}" title="${on?"点击隐藏":"点击显示"}"><i style="background:${m.color}"></i>${m.label}</span>`;
  }).join("");
}
function chartSvg(series,opt){
  opt=opt||{};
  const mets=(opt.metrics||chartMets()).map(k=>CHART_MET_MAP[k]).filter(Boolean);
  const marks=(opt.marks||[]).filter(Boolean);
  if(!series||series.length<2) return `<div class="chart-empty">折线图至少需要 2 天数据${series&&series.length===1?"（当前只有 1 天）":"（先导入利润表）"}</div>`;
  if(!mets.length) return `<div class="chart-empty">请至少选择一项指标</div>`;
  const H0=opt.h||260, W=opt.w||880, L=58, R=mets.some(m=>m.axis===2)?58:18, T=16, B=30;
  const lm=mets.filter(m=>m.axis!==2), rm=mets.filter(m=>m.axis===2);
  const rng=vals=>{
    if(!vals.length) return [0,1];
    const rawMin=Math.min(...vals), rawMax=Math.max(...vals);
    let a=rawMin, b=rawMax;
    if(a>0&&a<b*0.55) a=0;
    if(b<0&&b>a*0.55) b=0;
    if(a===b) b=a+Math.abs(a||1)*0.1+1;
    const pad=(b-a)*0.08;
    let lo=a-pad, hi=b+pad;
    if(rawMin>=0&&lo<0) lo=0;          /* 数据全为正时不要跌破 0 */
    if(rawMax<=0&&hi>0) hi=0;
    return [lo,hi];
  };
  const lv=[],rv=[];
  for(const m of lm) for(const p of series){ const v=p[m.k]; if(typeof v==="number"&&!isNaN(v)) lv.push(v); }
  for(const m of rm) for(const p of series){ const v=p[m.k]; if(typeof v==="number"&&!isNaN(v)) rv.push(v); }
  const L1=rng(lv), R1=rng(rv);
  const x=i=>L+(W-L-R)*(series.length<=1?0:i/(series.length-1));
  const yL=v=>T+(H0-T-B)*(1-(v-L1[0])/((L1[1]-L1[0])||1));
  const yR=v=>T+(H0-T-B)*(1-(v-R1[0])/((R1[1]-R1[0])||1));
  const ax=v=>Math.abs(v)>=10000?(v/10000).toFixed(1)+"万":Math.abs(v)>=1000?(v/1000).toFixed(1)+"k":String(Math.round(v));
  let g="";
  for(let i=0;i<=4;i++){
    const yy=T+(H0-T-B)*i/4;
    g+=`<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W-R}" y2="${yy.toFixed(1)}" style="stroke:var(--td-border)" stroke-width=".7"/>`;
    if(lm.length) g+=`<text x="${L-8}" y="${(yy+3.5).toFixed(1)}" text-anchor="end" font-size="9.5" style="fill:var(--text3)">${ax(L1[1]-(L1[1]-L1[0])*i/4)}</text>`;
    if(rm.length) g+=`<text x="${W-R+8}" y="${(yy+3.5).toFixed(1)}" font-size="9.5" style="fill:var(--text3)">${(R1[1]-(R1[1]-R1[0])*i/4).toFixed(2)}</text>`;
  }
  const n=series.length, step=Math.max(1,Math.ceil((n-1)/6));
  let xl="";
  for(let i=0;i<n;i+=step) xl+=`<text x="${x(i).toFixed(1)}" y="${H0-9}" text-anchor="middle" font-size="9.5" style="fill:var(--text3)">${series[i].date.slice(5)}</text>`;
  if((n-1)%step!==0) xl+=`<text x="${x(n-1).toFixed(1)}" y="${H0-9}" text-anchor="middle" font-size="9.5" style="fill:var(--text3)">${series[n-1].date.slice(5)}</text>`;
  const dmap=new Map(); series.forEach((p,i)=>dmap.set(p.date,i));
  let mk=""; const seen=new Set();
  for(const m of marks){
    const d=String(m.date||"").slice(0,10), i=dmap.get(d);
    if(i==null||seen.has(d)) continue; seen.add(d);
    const xx=x(i).toFixed(1);
    mk+=`<line x1="${xx}" y1="${T}" x2="${xx}" y2="${H0-B}" style="stroke:var(--accent)" stroke-width="1" stroke-dasharray="3 3" opacity=".65"><title>${H(d)} 调整：${H(m.label||"")}</title></line>`
      +`<circle cx="${xx}" cy="${T-4}" r="2.4" style="fill:var(--accent)"/>`;
  }
  let lines="",dots="";
  for(const m of mets){
    const yf=m.axis===2?yR:yL;
    const pts=series.map((p,i)=>`${x(i).toFixed(1)},${yf(p[m.k]).toFixed(1)}`).join(" ");
    const dash=m.k==="ad"?' stroke-dasharray="4 3" opacity=".9"':"";
    lines+=`<polyline points="${pts}" fill="none" style="stroke:${m.color}" stroke-width="${m.k==="prof"?1.9:1.5}"${dash}/>`;
  }
  if(n<=48){
    for(const m of mets){
      const yf=m.axis===2?yR:yL;
      series.forEach((p,i)=>{
        const tip=`${p.date}｜`+mets.map(mm=>`${mm.label} ${mm.f(p[mm.k])}`).join("｜");
        dots+=`<circle cx="${x(i).toFixed(1)}" cy="${yf(p[m.k]).toFixed(1)}" r="2.2" style="fill:${m.color}"><title>${H(tip)}</title></circle>`;
      });
    }
  }
  return `<svg viewBox="0 0 ${W} ${H0}" role="img">${g}${xl}${mk}${lines}${dots}</svg>`;
}

/* ---------- 卡片 ---------- */
function mc(label,a,b,f,pp){
  let d;
  if(pp){ d=(isNaN(a)||isNaN(b))?null:(b-a)*100; }
  else { d=(isNaN(a)||isNaN(b)||!a)?null:(b-a)/Math.abs(a)*100; }
  const cls=d==null?"":d>0.5?"up":d<-0.5?"down":"";
  const dt=d==null?"—":`${d>0?"+":""}${d.toFixed(pp?1:0)}${pp?"pp":"%"}`;
  return `<div class="mc"><div class="mcl">${label}</div><div class="mcv">${f(a)} → <b>${f(b)}</b></div><div class="mcd ${cls}">${dt}</div></div>`;
}
function metricsHtml(m){
  if(!m) return `<div class="rphint" style="padding:10px">${ROWS.length?"该链接在利润表中暂无数据":"未导入利润表，导入后自动出现前后对比"}</div>`;
  if(!m.ok) return `<div class="rphint" style="padding:10px">调整前或调整后暂无成交数据（可能早于/晚于导入的 CSV 时间范围），无法对比</div>`;
  return `<div class="rc-metrics">
    ${mc("日均成交",m.prev.avgAmt,m.next.avgAmt,fm)}
    ${mc("日均净利润",m.prev.avgProf,m.next.avgProf,fm)}
    ${mc("日均推广费",m.prev.avgAd,m.next.avgAd,fm)}
    ${mc("平均利润率",m.prev.pr,m.next.pr,fPr,true)}
  </div>`;
}
function cardHtml(r){
  const m=effect(r), v=verdict(r,m);
  const t=String(r.time||"").replace("T"," ").slice(0,16);
  const link=r.linkId?`<span class="rc-id">ID ${H(r.linkId)}</span><span class="cpy" data-cpy="${H(r.linkId)}" title="复制链接ID">⧉</span>`:"";
  const head=r.title||r.product||"（未填标题）";
  const chg=(r.before||r.after)
    ? `<div class="rc-chg"><span class="rc-field">${H(r.item||"调整")}</span>${r.before?`<span class="rc-before">${H(r.before)}</span>`:""}${r.before&&r.after?`<span class="rc-arrow">→</span>`:""}${r.after?`<span class="rc-after">${H(r.after)}</span>`:""}</div>`
    : `<div class="rc-chg"><span class="rc-field">${H(r.item||"调整")}</span><span class="rc-after">${H(r.plan||"")}</span></div>`;
  const img=imgOf(r.linkId);
  const thumb=img?`<img class="rc-thumb" src="${H(img)}" loading="lazy" alt="" data-img="${H(img)}" data-imgfail="hide">`:"";
  return `<div class="rcard" data-rid="${H(r.id)}">
    ${thumb}
    <div class="rc-body">
    <div class="rc-top">
      <span class="rc-time">${H(t)}</span>
      <span class="pbadge">${H(r.platform||"—")}</span>
      <span class="vbadge ${v.cls}">${H(v.t)}</span>
      <span class="sbadge" data-act="toggle" title="点击切换进行中/已完成">${H(r.gstat||"进行中")}</span>
      ${r.planId?`<span class="planbadge" title="由调整计划确认后生成，时间是确认那一刻">计划转入</span>`:""}
      <span class="rc-time" style="margin-left:auto">${H(shopLabel(r))}</span>
    </div>
    <div class="rc-title">${H(head)} ${link}</div>
    ${chg}
    ${r.reason?`<div class="rc-reason">${H(r.reason)}</div>`:""}
    ${metricsHtml(m)}
    <div class="rc-actions">
      <button class="btn ghost" data-act="edit">编辑</button>
      <button class="btn ghost" data-act="trend">看趋势</button>
      <button class="btn ghost" data-act="del">删除</button>
      ${r.next?`<span class="rc-time" style="margin-left:auto;font-size:11px;color:var(--text3)">后续：${H(r.next.length>36?r.next.slice(0,36)+"…":r.next)}</span>`:""}
    </div>
    </div>
  </div>`;
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const card=b.closest("[data-rid]"); if(!card) return;
  const r=recList.find(x=>String(x.id)===card.dataset.rid); if(!r) return;
  const act=b.dataset.act;
  if(act==="edit"){ openForm(r); }
  else if(act==="del"){
    if(!confirm(`删除这条记录？\n${String(r.time||"").slice(0,16)} · ${r.title||r.product||""} · ${r.item||""}`)) return;
    recList=recList.filter(x=>x!==r); saveRecs(); _ridx=null; toast("已删除"); refreshAll();
  }
  else if(act==="toggle"){
    r.gstat=(r.gstat||"进行中")==="进行中"?"已完成":"进行中";
    saveRecs(); toast("状态："+r.gstat); refreshAll();
  }
  else if(act==="trend"){ openRecPanel(r.linkId); }
});

/* ---------- 台账：以「链接」为主体（一个链接一块，块内是该链接的调整流水） ---------- */
function ledgerGroups(){
  const list=ledgerList();
  const map=new Map();
  for(const r of list){
    const k=norm(r.linkId)||("_"+String(r.id||""));
    let g=map.get(k);
    if(!g){ g={key:k,linkId:String(r.linkId||""),recs:[]}; map.set(k,g); }
    g.recs.push(r);
  }
  const gs=[...map.values()];
  for(const g of gs) g.recs.sort((a,b)=>String(b.time||"").localeCompare(String(a.time||"")));
  gs.sort((a,b)=>String(b.recs[0].time||"").localeCompare(String(a.recs[0].time||"")));
  const visible=lgStatus?gs.filter(g=>(g.recs[0].gstat||"进行中")===lgStatus):gs;
  return {gs:visible,list:visible.flatMap(g=>g.recs)};
}
function pwCardHtml(g){
  const rs=g.recs, last=rs[0];
  const id=String(g.linkId||"");
  const selected=id&&lgSelected.has(norm(id));
  const img=id?imgOf(id):"";
  const name=last.title||last.product||"（未填标题）";
  const gap=dayDiff(String(last.time||"").slice(0,10),today());
  const when=gap<=0?"今天":gap===1?"昨天":gap+"天前";
  const m=effect(last), v=verdict(last,m);
  const done=(last.gstat||"进行中")==="已完成";
  const media=img
    ?`<img class="pw-thumb" src="${H(img)}" loading="lazy" alt="" data-img="${H(img)}" data-imgfail="pw">`
    :`<div class="pw-ph">无图</div>`;
  const ba=(last.before||last.after)
    ?`<span class="pw-t">${H(last.item||"调整")}</span><span class="pw-b">${H(last.before||"—")}</span><span class="pw-arw">→</span><span class="pw-a">${H(last.after||"—")}</span>`
    :`<span class="pw-t">${H(last.plan||"调整")}</span>`;
  /* pp=true 时变化量按百分点显示（利润率口径），否则按相对百分比（金额口径） */
  const kv=(label,a,b,f,pp)=>{
    if(a==null||b==null||isNaN(a)||isNaN(b)) return "";
    let d,unit,dec;
    if(pp){ d=(b-a)*100; unit="pp"; dec=1; }
    else { d=Math.abs(a)>1e-9?(b-a)/Math.abs(a)*100:0; unit="%"; dec=0; }
    const cls=d>0.05?"up":d<-0.05?"down":"";
    return `<div class="pw-kv"><span class="k">${label}</span><span class="v">${f(a)}<span class="arw">→</span>${f(b)}</span><span class="d ${cls}">${(d>=0?"+":"")+d.toFixed(dec)+unit}</span></div>`;
  };
  const kvs=(m&&m.ok)?kv("净利润",m.prev.avgProf,m.next.avgProf,fm)+kv("利润率",m.prev.pr,m.next.pr,fPr,true):"";
  return `<div class="pw-card${selected?" is-selected":""}" data-open-link="${H(id)}" data-lk="${H(id)}" title="点击查看趋势图与全部调整记录">
    <div class="pw-media">${media}${id?`<label class="pw-select" title="选择该商品及其全部历史调整记录"><input type="checkbox" data-lg-select="${H(norm(id))}" aria-label="选择商品 ${H(name)}"${selected?" checked":""}><span>选择</span></label>`:""}${rs.length>1?`<span class="pw-cnt" title="该链接共有 ${rs.length} 次调整">${rs.length} 次</span>`:""}<span class="pw-hint">点击看趋势与全部记录</span></div>
    <div class="pw-body">
      <div class="pw-name">${H(name)}</div>
      <div class="pw-id">ID ${H(id||"—")}${id?`<span class="cpy" data-cpy="${H(id)}" title="复制链接ID">⧉</span>`:""}</div>
      <div class="pw-shop">${H(shopLabel(last))}</div>
      ${kvs?`<div class="pw-kvs">${kvs}</div>`:""}
      <div class="pw-last"><span class="pw-dot${done?" done":""}" title="${done?"已完成":"进行中"}"></span><span class="pw-date">${H(String(last.time||"").slice(5,10).replace("-","/"))}</span>${ba}</div>
      <div class="pw-foot"><span class="vbadge ${v.cls}" title="${H(v.t)}">${H(v.k==="no"?"无数据":v.t)}</span><span class="pw-when">${H(when)}</span></div>
    </div>
  </div>`;
}
/* 点卡片打开该链接的趋势面板（图片区走灯箱放大） */
document.addEventListener("click",e=>{
  if(e.target.closest(".pw-select")) return;
  if(e.target.closest(".cpy")) return;
  if(e.target.closest(".pw-media img")) return;   /* 图片交给灯箱放大 */
  const op=e.target.closest("[data-open-link]");
  if(!op) return;
  e.preventDefault(); e.stopPropagation();
  if(op.dataset.openLink) openRecPanel(op.dataset.openLink);
},true);

/* ---------- 窗口胶囊 ---------- */
function paintWinChips(){
  const html=WINS.map(([v,l])=>`<span class="wchip${winDays===v?" on":""}" data-win="${v}">${l}</span>`).join("");
  if(el("lgWin")) el("lgWin").innerHTML=html;
}
document.addEventListener("click",e=>{
  const c=e.target.closest(".wchip[data-win]"); if(!c) return;
  winDays=+c.dataset.win; prefs.win=winDays; savePrefs(); paintWinChips();
  if(viewMode==="ledger") renderLedger();
  if(typeof V!=="undefined"&&V) renderV();
});

/* ---------- 台账 ---------- */
let lgRange="30", lgShops=new Set(), lgVerdict="", lgStatus="", lgKw="";
function ledgerList(){
  let from="";
  if(lgRange==="30") from=shiftDate(today(),-29);
  if(lgRange==="7") from=shiftDate(today(),-6);
  const kw=lgKw.trim().toLowerCase();
  let list=recList.filter(r=>{
    const d=String(r.time||"").slice(0,10);
    if(from&&d<from) return false;
    if(lgShops.size&&!lgShops.has(r.shop||"")) return false;
    if(kw){
      const hay=[r.linkId,r.title,r.product,r.item,r.before,r.after,r.reason,r.next,r.shop,r.plan,r.goal].join(" ").toLowerCase();
      if(hay.indexOf(kw)<0) return false;
    }
    return true;
  });
  if(lgVerdict) list=list.filter(r=>verdict(r,effect(r)).k===lgVerdict);
  return list.sort((a,b)=>String(b.time||"").localeCompare(String(a.time||"")));
}
function renderLedger(){
  const groups=ledgerGroups();
  const list=groups.list;
  let up=0,down=0,flat=0,watch=0,no=0;
  for(const r of list){ const k=verdict(r,effect(r)).k; if(k==="up")up++; else if(k==="down")down++; else if(k==="flat")flat++; else if(k==="watch")watch++; else no++; }
  const links=new Set(list.map(r=>norm(r.linkId)).filter(Boolean)).size;
  const f=(label,text,cls)=>`<div class="stat"><div class="label">${label}</div><div class="val ${cls||""}">${text}</div></div>`;
  el("lgStats").innerHTML=
    f("调整次数",list.length.toLocaleString())+
    f("涉及链接",links.toLocaleString())+
    f("◆ 有效",up,"pos")+f("◆ 无效",down,"neg")+
    f("持平",flat)+f("观察中",watch)+
    (no?f("无数据",no):"")+
    `<div class="stat"><div class="label">对比窗口</div><div class="val" style="font-size:13px">${winDays>0?`前后各 ${winDays} 天`:"全部历史"}</div></div>`;
  const note=ROWS.length?"":`<div class="rphint" style="margin:0 0 12px">当前未导入利润表：记录可正常查看与编辑，导入后自动补齐「有效 / 无效」判定与前后对比。</div>`;
  el("lgList").innerHTML=note+(groups.gs.length
    ? `<div class="pw">${groups.gs.map(pwCardHtml).join("")}</div>`
    : `<div class="rphint">${recList.length?"当前筛选条件下没有记录":"还没有任何调整记录 —— 点右上角「✏️ 记一笔」开始，或在利润明细表的「调整记录」列点「＋ 记一笔」。"}</div>`);
  el("ledgerCnt").textContent=recList.length;
  paintLgShopBtn();
  paintLgBulkBar(groups.gs);
}
function paintLgBulkBar(visibleGroups){
  const existing=new Set(recList.map(r=>norm(r&&r.linkId)).filter(Boolean));
  for(const key of lgSelected){ if(!existing.has(key)) lgSelected.delete(key); }
  const visible=new Set((visibleGroups||[]).map(g=>norm(g.linkId)).filter(Boolean));
  const recordCount=recList.filter(r=>lgSelected.has(norm(r&&r.linkId))).length;
  const allVisible=visible.size>0&&[...visible].every(key=>lgSelected.has(key));
  el("lgBulkCount").textContent=lgSelected.size
    ?`已选 ${lgSelected.size} 个商品，共 ${recordCount} 条历史记录`
    :"未选择商品";
  el("lgSelectVisible").disabled=!visible.size;
  el("lgSelectVisible").textContent=allVisible?"取消全选当前结果":"全选当前结果";
  el("lgClearSelected").disabled=!lgSelected.size;
  el("lgDeleteSelected").disabled=!lgSelected.size;
}

/* ---------- 新增 / 编辑表单 ---------- */
let editingId=null;
let formMode="rec";        // rec=记一笔；plan=调整计划（复用同一张表单，只是不填时间）
let planEditingId=null;
let rmTipTimer=null;
function hint(msg,warn){
  const n=el("rmHint"); n.textContent=msg||""; n.className="mhint"+(warn?" warn":"");
  clearTimeout(rmTipTimer); if(msg) rmTipTimer=setTimeout(()=>{ n.textContent=""; },4000);
}
function nowLocal(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fillPlans(selected){
  const p=el("rmPlatform").value;
  el("rmPlan").innerHTML=(PLANS[p]||["其他"]).map(x=>`<option${x===selected?" selected":""}>${x}</option>`).join("");
}
function fillShopList(){
  const set=new Set();
  (shops[el("rmPlatform").value]||[]).forEach(s=>set.add(s));
  recList.forEach(r=>{ if(r.shop) set.add(r.shop); });
  ROWS.forEach(r=>{ const s=splitShop(r["店铺名称"]||"").shop; if(s) set.add(s); });
  el("rmShopList").innerHTML=[...set].map(s=>`<option value="${H(s)}">`).join("");
}
/* 从链接ID反查平台/店铺/标题：记录侧优先，其次利润表（店铺列格式「平台-店铺」） */
function autoFillFromLink(linkId){
  const id=String(linkId||"").trim();
  if(!id) return {};
  const rec=recsOf(id)[0];
  const pr=ROWS.find(x=>norm(x["店铺款式编码"])===norm(id));
  const sp=splitShop((rec&&rec.shop)||(pr&&pr["店铺名称"])||"");
  return {
    platform:(rec&&rec.platform)||sp.platform||"",
    shop:sp.shop||(rec&&rec.shop)||(pr&&pr["店铺名称"])||"",
    title:(rec&&rec.title)||(pr&&pr["商品名称"])||""
  };
}
/* ---------- 记一笔：精简链接信息与自定义快捷项 ---------- */
const RM_QUICK_FIELDS={item:{id:"rmItem",label:"调整项"},reason:{id:"rmReason",label:"为什么改"},next:{id:"rmNext",label:"后续计划"}};
const RM_QUICK_DEFAULTS={item:["日限额","投产目标","计划类型"],reason:["利润率下降","推广费占比偏高","放量测试"],next:["观察3天后复盘","观察7天后复盘","维持当前设置继续观察"]};
function rmCleanQuickValues(values){
  return [...new Set((Array.isArray(values)?values:[]).filter(v=>typeof v==="string").map(v=>v.trim()).filter(v=>v&&v.length<=500))];
}
function rmReadQuickOptions(saved){
  const out={};
  for(const key of Object.keys(RM_QUICK_FIELDS)) out[key]=rmCleanQuickValues(saved&&Array.isArray(saved[key])?saved[key]:RM_QUICK_DEFAULTS[key]);
  return out;
}
let rmQuickOptions=rmReadQuickOptions(prefs.recordQuickOptions);
let rmQuickUI={};
let rmReturnFocus=null;
let rmAutoIdentity={title:"",shop:""};
let rmIdentityTimer=null,rmMatchedLinkId="";
function rmPersistQuickOptions(next){
  const clean=rmReadQuickOptions(next);
  try{ ST.set(PREF_KEY,JSON.stringify(Object.assign({},prefs,{recordQuickOptions:clean}))); }
  catch(e){ return false; }
  prefs.recordQuickOptions=clean;
  rmQuickOptions=clean;
  return true;
}
function rmMergeQuickOptions(saved){
  if(!saved||typeof saved!=="object") return true;
  const merged={};
  for(const key of Object.keys(RM_QUICK_FIELDS)) merged[key]=rmCleanQuickValues(rmQuickOptions[key].concat(Array.isArray(saved[key])?saved[key]:[]));
  return rmPersistQuickOptions(merged);
}
function rmQuickState(key){
  return rmQuickUI[key]||(rmQuickUI[key]={managing:false,editor:false,editIndex:-1,draft:"",error:""});
}
function rmRenderQuick(key){
  const cfg=RM_QUICK_FIELDS[key], root=el("recModal").querySelector(`[data-rm-quick="${key}"]`);
  if(!cfg||!root) return;
  const ui=rmQuickState(key), value=el(cfg.id).value.trim();
  const selected=text=>key==="item"?value===text:value===text||value.split(/\r?\n/).some(line=>line.trim()===text);
  const chips=rmQuickOptions[key].map((text,i)=>`<span class="rm-quick-chip${selected(text)?" is-used":""}"><button type="button" data-rmq-action="apply" data-rmq-index="${i}" title="${H(text)}">${H(text)}</button>${ui.managing?`<button type="button" data-rmq-action="edit" data-rmq-index="${i}" aria-label="编辑快捷项：${H(text)}">编辑</button><button type="button" data-rmq-action="remove" data-rmq-index="${i}" aria-label="删除快捷项：${H(text)}">删除</button>`:""}</span>`).join("");
  root.innerHTML=`<div class="rm-quick-bar"><span class="rm-quick-help">${key==="item"?"点击快捷项填入":"点击快捷项追加，保留已输入内容"}</span><button type="button" class="rm-quick-link" data-rmq-action="add">＋ 添加</button><button type="button" class="rm-quick-link" data-rmq-action="manage" aria-pressed="${ui.managing}">${ui.managing?"完成管理":"管理"}</button></div>`
    +`<div class="rm-quick-list">${chips||'<span class="rm-quick-empty">暂无快捷项，可添加常用内容</span>'}</div>`
    +(ui.editor?`<div class="rm-quick-editor"><label for="rmQuickDraft-${key}">${ui.editIndex<0?"添加":"编辑"}${H(cfg.label)}快捷项</label><textarea id="rmQuickDraft-${key}" data-rmq-draft="${key}" rows="2" maxlength="500" placeholder="输入常用内容">${H(ui.draft)}</textarea><div class="rm-quick-editor-actions"><span class="rm-quick-note">仅保存为快捷项，不会提交调整记录</span><button type="button" class="btn" data-rmq-action="cancel">取消</button><button type="button" class="btn primary" data-rmq-action="save">保存快捷项</button></div></div>`:"")
    +(ui.error?`<div class="rm-quick-error" role="status">${H(ui.error)}</div>`:"");
}
function rmUpdateIdentitySummary(){
  const id=el("rmLinkId").value.trim(), title=el("rmTitleIn").value.trim();
  el("rmIdentityTitle").textContent=title||(id?"链接 "+id:"选择要记录的链接");
  el("rmIdentityTitle").title=title||id;
  el("rmIdentityMeta").textContent=id?[el("rmPlatform").value,el("rmShop").value.trim(),"ID "+id].filter(Boolean).join(" · "):"填写链接 ID 后可自动匹配商品与店铺";
}
function rmFocusIdentity(id){
  el("rmIdentity").open=true;
  const target=el(id); target.focus(); target.scrollIntoView({block:"nearest"});
}
function openForm(pre,mode){
  pre=pre||{};
  formMode=mode==="plan"?"plan":"rec";
  rmReturnFocus=document.activeElement;
  editingId=formMode==="rec"?(pre.id||null):null;
  planEditingId=formMode==="plan"?(pre.id||null):null;
  rmQuickUI={};
  clearTimeout(rmIdentityTimer);
  delete el("rmPlatform").dataset.touched;
  el("rmHead").textContent=formMode==="plan"
    ?(planEditingId?"编辑调整计划":"新增调整计划")
    :(editingId?"编辑调整记录":"新增调整记录");
  el("rmSave").textContent=formMode==="plan"?"保存计划":"保存记录";
  /* 「加入清单」只在记一笔的新建场景出现：编辑已有记录时它是既成事实，不能退回待办 */
  el("rmToList").style.display=(formMode==="rec"&&!editingId)?"":"none";
  el("rmTimeFld").style.display=formMode==="plan"?"none":"";
  el("rmPlanFld").classList.toggle("full",formMode==="plan");
  const linkId=String(pre.linkId||"").trim();
  rmMatchedLinkId=linkId;
  const auto=(linkId&&(!pre.shop||!pre.platform||!pre.title))?autoFillFromLink(linkId):{};
  const sp=splitShop(pre.shop||auto.shop||"");
  const platform=pre.platform||auto.platform||sp.platform||"PDD";
  el("rmPlatform").innerHTML=[...new Set(Object.keys(PLANS).concat(platform))].map(p=>`<option value="${H(p)}">${H(p)}</option>`).join("");
  el("rmPlatform").value=platform;
  fillPlans(pre.plan);
  if(pre.plan&&![...el("rmPlan").options].some(o=>o.value===pre.plan)) el("rmPlan").add(new Option(pre.plan,pre.plan));
  if(pre.plan) el("rmPlan").value=pre.plan;
  fillShopList();
  el("rmTime").value=String(pre.time||nowLocal()).slice(0,16);
  el("rmLinkId").value=linkId;
  el("rmTitleIn").value=pre.title||auto.title||"";
  el("rmShop").value=sp.shop||pre.shop||auto.shop||"";
  rmAutoIdentity={title:el("rmTitleIn").value,shop:el("rmShop").value};
  el("rmItem").value=pre.item||"";
  el("rmBefore").value=pre.before||"";
  el("rmAfter").value=pre.after||"";
  el("rmReason").value=pre.reason||"";
  el("rmNext").value=pre.next||"";
  el("rmConcl").value=pre.concl||"待观察";
  el("rmStat").value=pre.gstat||"进行中";
  el("rmIdentity").open=!linkId;
  rmUpdateIdentitySummary();
  Object.keys(RM_QUICK_FIELDS).forEach(rmRenderQuick);
  el("recModal").classList.add("show");
  el("recModal").querySelector(".mbody").scrollTop=0;
  hint("");
  requestAnimationFrame(()=>{ if(el("recModal").classList.contains("show")) el(linkId?"rmItem":"rmLinkId").focus({preventScroll:true}); });
}
function closeForm(){
  el("recModal").classList.remove("show"); editingId=null; planEditingId=null; formMode="rec";
  el("rmTimeFld").style.display="";
  el("rmSave").textContent="保存记录";
  el("rmToList").style.display="";
  el("rmPlanFld").classList.remove("full");
  clearTimeout(rmTipTimer);
  clearTimeout(rmIdentityTimer);
  if(rmReturnFocus&&rmReturnFocus.isConnected) rmReturnFocus.focus({preventScroll:true});
}

el("rmPlatform").addEventListener("change",()=>{ el("rmPlatform").dataset.touched="1"; fillPlans(); fillShopList(); rmUpdateIdentitySummary(); });
function rmMatchIdentity(){
  clearTimeout(rmIdentityTimer);
  const id=el("rmLinkId").value.trim();
  if(id===rmMatchedLinkId) return;
  rmMatchedLinkId=id;
  if(!id){ rmUpdateIdentitySummary(); return; }
  const rs=recsOf(id), a=autoFillFromLink(id);
  if(!el("rmTitleIn").value||el("rmTitleIn").value===rmAutoIdentity.title) el("rmTitleIn").value=a.title||"";
  if(!el("rmShop").value||el("rmShop").value===rmAutoIdentity.shop) el("rmShop").value=a.shop||"";
  rmAutoIdentity={title:a.title||"",shop:a.shop||""};
  if(a.platform&&!el("rmPlatform").dataset.touched){
    if(![...el("rmPlatform").options].some(o=>o.value===a.platform)) el("rmPlatform").add(new Option(a.platform,a.platform));
    el("rmPlatform").value=a.platform; fillPlans(); fillShopList();
  }
  rmUpdateIdentitySummary();
  if(rs.length) hint(`已匹配 ${rs.length} 条历史记录，最近一条：${String(rs[0].time||"").slice(0,10)}`);
  else if(a.title||a.shop) hint(`已从利润表带入${[a.platform,a.shop].filter(Boolean).join("-")||"标题与店铺"}`);
  else hint("利润表和历史记录里都没有这个链接 ID，请确认是否正确",true);
}
el("rmLinkId").addEventListener("change",rmMatchIdentity);
el("rmLinkId").addEventListener("input",()=>{
  clearTimeout(rmIdentityTimer);
  rmIdentityTimer=setTimeout(()=>{ if(el("recModal").classList.contains("show")) rmMatchIdentity(); },350);
});
for(const id of ["rmLinkId","rmShop","rmTitleIn"]) el(id).addEventListener("input",rmUpdateIdentitySummary);
for(const key of Object.keys(RM_QUICK_FIELDS)) el(RM_QUICK_FIELDS[key].id).addEventListener("input",()=>rmRenderQuick(key));

el("recModal").addEventListener("input",e=>{
  if(e.target.matches("[data-rmq-draft]")) rmQuickState(e.target.dataset.rmqDraft).draft=e.target.value;
});
el("recModal").addEventListener("click",e=>{
  const button=e.target.closest("[data-rmq-action]"); if(!button) return;
  const root=button.closest("[data-rm-quick]"), key=root&&root.dataset.rmQuick, cfg=RM_QUICK_FIELDS[key]; if(!cfg) return;
  const ui=rmQuickState(key), action=button.dataset.rmqAction, index=Number(button.dataset.rmqIndex), target=el(cfg.id);
  ui.error="";
  if(action==="apply"){
    const text=rmQuickOptions[key][index]; if(text==null) return;
    if(key==="item") target.value=text;
    else if(!("\n"+target.value.trim().replace(/\r\n/g,"\n")+"\n").includes("\n"+text.replace(/\r\n/g,"\n")+"\n")) target.value=target.value?target.value.replace(/\s+$/,"")+"\n"+text:text;
    target.dispatchEvent(new Event("input",{bubbles:true}));
    target.focus({preventScroll:true}); target.setSelectionRange(target.value.length,target.value.length);
    return;
  }
  if(action==="manage") ui.managing=!ui.managing;
  if(action==="add"||action==="edit"){
    ui.editor=true; ui.editIndex=action==="edit"?index:-1;
    ui.draft=action==="edit"?rmQuickOptions[key][index]:target.value.trim();
  }
  if(action==="cancel"){ ui.editor=false; ui.draft=""; ui.editIndex=-1; }
  if(action==="save"){
    const text=ui.draft.trim();
    if(!text) ui.error="请先填写快捷项内容。";
    else if(text.length>500) ui.error="快捷项请控制在 500 个字符以内。";
    else if(rmQuickOptions[key].some((value,i)=>value===text&&i!==ui.editIndex)) ui.error="这个快捷项已经存在，无需重复添加。";
    else{
      const values=rmQuickOptions[key].slice();
      if(ui.editIndex>=0) values[ui.editIndex]=text; else values.push(text);
      if(!rmPersistQuickOptions(Object.assign({},rmQuickOptions,{[key]:values}))) ui.error="未能保存到本机，请检查浏览器存储空间后重试。";
      else{ ui.editor=false; ui.draft=""; ui.editIndex=-1; }
    }
  }
  if(action==="remove"){
    const values=rmQuickOptions[key].filter((_,i)=>i!==index);
    if(!rmPersistQuickOptions(Object.assign({},rmQuickOptions,{[key]:values}))) ui.error="未能保存删除结果，请稍后重试。";
    else{ ui.editor=false; ui.draft=""; ui.editIndex=-1; }
  }
  rmRenderQuick(key);
  if(ui.editor&&(action==="add"||action==="edit"||action==="save")){
    const input=el("rmQuickDraft-"+key); input.focus({preventScroll:true});
  }
});
el("recModal").addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    e.preventDefault(); e.stopPropagation();
    const root=e.target.closest("[data-rm-quick]");
    if(root&&rmQuickState(root.dataset.rmQuick).editor){ const ui=rmQuickState(root.dataset.rmQuick); ui.editor=false; ui.error=""; rmRenderQuick(root.dataset.rmQuick); el(RM_QUICK_FIELDS[root.dataset.rmQuick].id).focus(); }
    else closeForm();
    return;
  }
  if(e.key==="Tab"){
    const focusable=[...el("recModal").querySelectorAll("button,input,select,textarea,summary")].filter(node=>!node.disabled&&node.getClientRects().length);
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
});

/* 表单取数：记一笔和调整计划共用同一套字段 */
function readFormData(){
  const shopRaw=el("rmShop").value.trim();
  const spSave=splitShop(shopRaw);
  return {
    time:el("rmTime").value, platform:spSave.platform||el("rmPlatform").value,
    linkId:el("rmLinkId").value.trim(),
    title:el("rmTitleIn").value.trim(), shop:spSave.shop||shopRaw,
    plan:el("rmPlan").value, item:el("rmItem").value.trim(),
    before:el("rmBefore").value.trim(), after:el("rmAfter").value.trim(),
    reason:el("rmReason").value.trim(), next:el("rmNext").value.trim(),
    goal:el("rmGoal")?el("rmGoal").value.trim():"",
    concl:el("rmConcl").value, gstat:el("rmStat").value
  };
}
function saveShopFromRec(data){
  if(!data.shop) return;
  const arr=shops[data.platform]||(shops[data.platform]=[]);
  if(arr.indexOf(data.shop)<0) arr.push(data.shop);
  saveShops();
}
/* 计划与记录共用同一套字段，差别只有「时间」：写计划时把 time 摘掉，其余原样保留 */
function planPayload(data){
  const plan=Object.assign({},data);
  delete plan.time;
  return plan;
}
/* 唯一的入清单出口：新建计划、记一笔里「加入清单」都走这里，保证两条路存的东西完全一致 */
function planAdd(data,extra){
  const item=Object.assign({
    id:"pl"+Date.now()+"_"+Math.random().toString(36).slice(2,7),
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  },planPayload(data),extra||{});
  planList.push(item);
  saveShopFromRec(data);
  savePlans(); paintPlanCnt();
  return item;
}

el("rmSave").addEventListener("click",()=>{
  const data=readFormData();
  /* ---- 调整计划：只存待办，不占调整记录、不落时间 ---- */
  if(formMode==="plan"){
    if(!data.platform){ rmFocusIdentity("rmPlatform"); return hint("请选择平台",true); }
    if(!data.linkId){ rmFocusIdentity("rmLinkId"); return hint("请填写链接 ID——它是记录的唯一主体",true); }
    const wasEdit=!!planEditingId;
    if(wasEdit){
      const plan=planPayload(data);
      const i=planList.findIndex(p=>String(p.id)===String(planEditingId));
      if(i>-1) planList[i]=Object.assign({},planList[i],plan,{updatedAt:new Date().toISOString()});
      saveShopFromRec(data); savePlans(); paintPlanCnt();
    }else{
      planAdd(data);
    }
    closeForm(); renderPlanList();
    toast(wasEdit?"计划已更新":"计划已保存");
    return;
  }
  const wasEdit=!!editingId;
  if(!data.time) return hint("请填写调整时间",true);
  if(!data.platform){ rmFocusIdentity("rmPlatform"); return hint("请选择平台",true); }
  if(!data.linkId){ rmFocusIdentity("rmLinkId"); return hint("请填写链接 ID——它是记录的唯一主体",true); }
  if(editingId){
    const i=recList.findIndex(r=>String(r.id)===String(editingId));
    if(i>-1) recList[i]=Object.assign({},recList[i],data,{updatedAt:new Date().toISOString()});
  }else{
    recList.push(Object.assign({id:Date.now()+"_"+Math.random().toString(36).slice(2,7),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},data));
  }
  saveShopFromRec(data);
  saveRecs(); _ridx=null; closeForm(); toast(wasEdit?"已更新":"已保存");
  refreshAll();
});
el("rmToList").addEventListener("click",()=>{
  if(formMode!=="rec"||editingId) return;
  const data=readFormData();
  if(!data.platform){ rmFocusIdentity("rmPlatform"); return hint("请选择平台",true); }
  if(!data.linkId){ rmFocusIdentity("rmLinkId"); return hint("请填写链接 ID——它是记录的唯一主体",true); }
  /* 同商品同调整项可能是有意的第二次调整，所以只提示不拦截 */
  const key=norm(data.linkId);
  const same=planList.filter(p=>norm(p.linkId)===key&&String(p.item||"")===String(data.item||"")).length;
  planAdd(data,{src:"rec"});
  closeForm(); renderPlanList();
  toast(same
    ?`已加入清单：该商品现在有 ${same+1} 个「${data.item||"未填调整项"}」计划，执行前先核对别重复`
    :"已加入清单（不记时间）：改完在「🗓 调整计划」里点「✅ 已调整」入账");
});
el("rmCancel").addEventListener("click",closeForm);
el("rmClose").addEventListener("click",closeForm);
el("recModal").addEventListener("click",e=>{ if(e.target.id==="recModal") closeForm(); });

/* ---------- 调整计划：列表、编辑、删除、确认入账 ---------- */
function paintPlanCnt(){
  const n=planList.length, badge=el("planCnt");
  if(badge){ badge.textContent=n; badge.style.display=n?"":"none"; }
  const h=el("planHint");
  if(h) h.textContent=n
    ?`共 ${n} 个待执行计划 · 点「已调整」会按确认时间记入调整记录`
    :"计划只是待办，不占调整记录；点「已调整」才按确认时间入账";
}
function planBuiltAt(p){
  const t=Date.parse(p.createdAt||"")||0;
  if(!t) return "";
  const d=new Date(t);
  return `${d.getMonth()+1}/${d.getDate()} 建立`;
}
function renderPlanList(){
  const box=el("planList");
  if(!box) return;
  paintPlanCnt();
  if(!planList.length){
    box.innerHTML='<div class="plempty"><b>还没有调整计划</b>把打算怎么调先写下来（平台、链接、改什么、改成多少）：可以在「记一笔」里填完点「＋ 加入清单」，也可以点下方「＋ 新建计划」。等真的改完再回来点「✅ 已调整」，会按那时的确认时间记成一条正常的调整记录。</div>';
    return;
  }
  const list=planList.slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  box.innerHTML=list.map(p=>{
    const id=H(String(p.id||""));
    const title=p.title||("链接 "+String(p.linkId||""));
    const meta=[p.platform,p.shop].filter(Boolean).map(H).join(" · ");
    const chg=(p.item||p.before||p.after)
      ?`<div class="plchg">${p.plan?`<span class="pltype">${H(p.plan)}</span>`:""}<span>${H(p.item||"调整")}</span><b>${H(p.before||"—")}</b><span class="arw">→</span><b>${H(p.after||"—")}</b></div>`
      :"";
    const reason=p.reason?`<div class="plnote"><em>为什么改</em>${H(p.reason)}</div>`:"";
    const next=p.next?`<div class="plnote"><em>后续计划</em>${H(p.next)}</div>`:"";
    const built=planBuiltAt(p);
    const fromRec=p.src==="rec"?`<span class="plfrom" title="在「记一笔」里点「加入清单」存进来的">来自记一笔</span>`:"";
    const pid=String(p.linkId||"");
    const idCopy=pid?`<span class="cpy" data-cpy="${H(pid)}" title="点击复制链接ID">⧉</span>`:"";
    return `<div class="plcard" data-plan-id="${id}">
      <div class="plmain">
        <div class="pltitle" title="${H(title)}">${H(title)}</div>
        <div class="plmeta"><span class="plid">ID ${H(pid||"—")}${idCopy}</span>${meta?`<span>${meta}</span>`:""}${fromRec}${built?`<span>${H(built)}</span>`:""}</div>
        ${chg}${reason}${next}
      </div>
      <div class="placts">
        <button type="button" class="btn primary" data-plan-act="confirm" data-plan-id="${id}">✅ 已调整</button>
        <button type="button" class="btn" data-plan-act="edit" data-plan-id="${id}">编辑</button>
        <button type="button" class="btn danger" data-plan-act="del" data-plan-id="${id}">删除</button>
      </div>
    </div>`;
  }).join("");
}
function openPlans(){
  renderPlanList();
  el("planModal").classList.add("show");
  el("planList").scrollTop=0;
}
function closePlans(){ el("planModal").classList.remove("show"); }
function planConfirm(id){
  const p=planList.filter(x=>String(x.id)===String(id))[0];
  if(!p) return;
  const data=Object.assign({},p);
  delete data.id; delete data.createdAt; delete data.updatedAt; delete data.src;
  const rec=Object.assign({},data,{
    id:Date.now()+"_"+Math.random().toString(36).slice(2,7),
    time:nowLocal(),
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    planId:String(p.id)
  });
  recList.push(rec);
  saveShopFromRec(rec);
  planList=planList.filter(x=>String(x.id)!==String(p.id));
  saveRecs(); savePlans(); _ridx=null;
  renderPlanList(); refreshAll();
  toast("已按确认时间 "+rec.time.replace("T"," ")+" 记入调整记录");
}
function planRemove(id){
  const p=planList.filter(x=>String(x.id)===String(id))[0];
  if(!p) return;
  planList=planList.filter(x=>String(x.id)!==String(p.id));
  savePlans(); renderPlanList();
  toast("计划已删除");
}

/* ---------- 导出调整计划：手写 store-only ZIP 生成 xlsx（不引第三方库，单文件版同样可用） ---------- */
const PL_COLS=[
  {t:"平台",w:10},{t:"店铺",w:20},{t:"链接ID",w:16},{t:"产品标题",w:44},
  {t:"计划类型",w:18},{t:"调整项",w:16},{t:"改动前",w:11},{t:"改动后",w:11},
  {t:"修改原因",w:46},{t:"后续计划",w:38}
];
const PL_CRC=(()=>{
  const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; }
  return t;
})();
function plCrc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=PL_CRC[(c^u8[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function plXml(s){
  return String(s==null?"":s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function plColName(i){ let s=""; i++; while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); } return s; }
/* ZIP：只用 store（不压缩），xlsx 本来就不要求 deflate，Excel 能正常打开 */
function plZip(files){
  const enc=new TextEncoder(), now=new Date();
  const dosTime=((now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1))&0xFFFF;
  const dosDate=((((now.getFullYear()-1980)&127)<<9)|((now.getMonth()+1)<<5)|now.getDate())&0xFFFF;
  const chunks=[],central=[]; let offset=0;
  for(const f of files){
    const name=enc.encode(f.name), data=typeof f.data==="string"?enc.encode(f.data):f.data, crc=plCrc32(data);
    const lh=new Uint8Array(30+name.length), ld=new DataView(lh.buffer);
    ld.setUint32(0,0x04034b50,true); ld.setUint16(4,20,true); ld.setUint16(6,0x0800,true);
    ld.setUint16(8,0,true); ld.setUint16(10,dosTime,true); ld.setUint16(12,dosDate,true);
    ld.setUint32(14,crc,true); ld.setUint32(18,data.length,true); ld.setUint32(22,data.length,true);
    ld.setUint16(26,name.length,true); ld.setUint16(28,0,true); lh.set(name,30);
    chunks.push(lh,data);
    const ch=new Uint8Array(46+name.length), cd=new DataView(ch.buffer);
    cd.setUint32(0,0x02014b50,true); cd.setUint16(4,20,true); cd.setUint16(6,20,true);
    cd.setUint16(8,0x0800,true); cd.setUint16(10,0,true); cd.setUint16(12,dosTime,true); cd.setUint16(14,dosDate,true);
    cd.setUint32(16,crc,true); cd.setUint32(20,data.length,true); cd.setUint32(24,data.length,true);
    cd.setUint16(28,name.length,true); cd.setUint32(42,offset,true);
    ch.set(name,46); central.push(ch);
    offset+=lh.length+data.length;
  }
  const cdSize=central.reduce((a,b)=>a+b.length,0);
  const eocd=new Uint8Array(22), ev=new DataView(eocd.buffer);
  ev.setUint32(0,0x06054b50,true);
  ev.setUint16(8,central.length,true); ev.setUint16(10,central.length,true);
  ev.setUint32(12,cdSize,true); ev.setUint32(16,offset,true);
  const all=chunks.concat(central,[eocd]);
  const out=new Uint8Array(all.reduce((a,b)=>a+b.length,0));
  let p=0; for(const c of all){ out.set(c,p); p+=c.length; }
  return out;
}
function plSheetXml(rows){
  const last=plColName(PL_COLS.length-1)+rows.length;
  const cols=PL_COLS.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c.w}" customWidth="1"/>`).join("");
  const body=rows.map((row,ri)=>`<row r="${ri+1}"${ri===0?' ht="26" customHeight="1"':""}>`+row.map((v,ci)=>{
    const ref=plColName(ci)+(ri+1), style=ri===0?1:(ri%2===0?3:2), text=String(v==null?"":v).slice(0,32000);
    if(ri>0&&(ci===6||ci===7)&&/^-?\d+(\.\d{1,6})?$/.test(text)) return `<c r="${ref}" s="${style}"><v>${text}</v></c>`;
    if(!text) return `<c r="${ref}" s="${style}"/>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${plXml(text)}</t></is></c>`;
  }).join("")+`</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
const PL_XLSX_STYLES=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><color rgb="FF1F2733"/><name val="微软雅黑"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="微软雅黑"/></font><font><sz val="10.5"/><color rgb="FF1F2733"/><name val="微软雅黑"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F81F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F7FD"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDCE4EE"/></left><right style="thin"><color rgb="FFDCE4EE"/></right><top style="thin"><color rgb="FFDCE4EE"/></top><bottom style="thin"><color rgb="FFDCE4EE"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function plXlsxBytes(rows){
  const files=[
    {name:"[Content_Types].xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`},
    {name:"_rels/.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:"xl/workbook.xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="调整计划" sheetId="1" r:id="rId1"/></sheets></workbook>`},
    {name:"xl/_rels/workbook.xml.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:"xl/styles.xml",data:PL_XLSX_STYLES},
    {name:"xl/worksheets/sheet1.xml",data:plSheetXml(rows)}
  ];
  return plZip(files);
}
function planExportXlsx(){
  if(!planList.length) return toast("清单是空的，没有可导出的计划");
  const list=planList.slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  const rows=[PL_COLS.map(c=>c.t)].concat(list.map(p=>[
    p.platform||"",p.shop||"",p.linkId||"",p.title||"",p.plan||"",p.item||"",p.before||"",p.after||"",p.reason||"",p.next||""
  ]));
  const blob=new Blob([plXlsxBytes(rows)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="调整计划-"+today().replace(/-/g,"")+".xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast(`已导出 ${list.length} 个计划（Excel）`);
}
el("planExport").addEventListener("click",planExportXlsx);
el("btnPlans").addEventListener("click",openPlans);
el("planNew").addEventListener("click",()=>openForm({},"plan"));
el("planClose").addEventListener("click",closePlans);
el("planDone").addEventListener("click",closePlans);
el("planModal").addEventListener("click",e=>{ if(e.target.id==="planModal") closePlans(); });
el("planList").addEventListener("click",e=>{
  const btn=e.target.closest("[data-plan-act]");
  if(!btn) return;
  const id=btn.dataset.planId, act=btn.dataset.planAct;
  if(act==="edit"){
    const p=planList.filter(x=>String(x.id)===String(id))[0];
    if(p) openForm(p,"plan");
    return;
  }
  /* 确认/删除都改成两步：第一次点变成「再点一次」，3 秒内再点才执行，防误触 */
  if(btn.dataset.arm!=="1"){
    btn.dataset.arm="1";
    btn.dataset.label=btn.textContent;
    btn.textContent=act==="confirm"?"确认写入？":"确认删除？";
    setTimeout(()=>{ if(btn.isConnected){ btn.dataset.arm=""; btn.textContent=btn.dataset.label; } },3000);
    return;
  }
  if(act==="confirm") planConfirm(id);
  else if(act==="del") planRemove(id);
});
paintPlanCnt();

/* ---------- 顶栏 / 面板 / 台账事件 ---------- */
el("btnNewRec").addEventListener("click",()=>openForm({}));
el("lgRange").addEventListener("click",e=>{
  const t=e.target.closest(".vtab"); if(!t) return;
  lgRange=t.dataset.r;
  el("lgRange").querySelectorAll(".vtab").forEach(x=>x.classList.toggle("on",x===t));
  renderLedger();
});
el("lgShopBtn").addEventListener("click",()=>{
  const cnt={};
  recList.forEach(r=>{ const s=r.shop||""; if(s) cnt[s]=(cnt[s]||0)+1; });
  const items=Object.keys(cnt).sort((a,b)=>a.localeCompare(b,"zh")).map(s=>({value:s,label:s,count:cnt[s]}));
  if(!items.length) return toast("还没有带店铺的记录");
  mpOpen({title:"筛选店铺（可多选）",items,sel:lgShops,anchor:"#lgShopBtn",onOk:sel=>{
    lgShops=new Set(sel); paintLgShopBtn(); renderLedger();
  }});
});
function paintLgShopBtn(){
  const b=el("lgShopBtn"); if(!b) return;
  if(!lgShops.size){ b.textContent="🏪 全部店铺"; b.classList.remove("primary"); }
  else { b.textContent=`🏪 ${lgShops.size} 个店铺`; b.classList.add("primary"); }
}
el("lgList").addEventListener("change",e=>{
  const input=e.target.closest("input[data-lg-select]"); if(!input) return;
  const key=norm(input.dataset.lgSelect); if(!key) return;
  if(input.checked) lgSelected.add(key); else lgSelected.delete(key);
  renderLedger();
});
el("lgSelectVisible").addEventListener("click",()=>{
  const visible=new Set(ledgerGroups().gs.map(g=>norm(g.linkId)).filter(Boolean));
  if(!visible.size) return;
  const clear=[...visible].every(key=>lgSelected.has(key));
  visible.forEach(key=>clear?lgSelected.delete(key):lgSelected.add(key));
  renderLedger();
});
el("lgClearSelected").addEventListener("click",()=>{
  lgSelected.clear();
  renderLedger();
});
el("lgDeleteSelected").addEventListener("click",()=>{
  const selected=[...lgSelected].filter(key=>recList.some(r=>norm(r&&r.linkId)===key));
  const targets=recList.filter(r=>lgSelected.has(norm(r&&r.linkId)));
  if(!selected.length||!targets.length) return toast("没有可删除的商品记录");
  const details=selected.map(key=>{
    const records=targets.filter(r=>norm(r&&r.linkId)===key);
    const latest=records.slice().sort((a,b)=>String(b.time||"").localeCompare(String(a.time||"")))[0];
    return `${latest.title||latest.product||"未命名商品"}（ID ${latest.linkId}，${records.length} 条）`;
  });
  const shown=details.slice(0,8).join("\n");
  const more=details.length>8?`\n另有 ${details.length-8} 个商品`:"";
  const message=`确定删除所选 ${selected.length} 个商品的全部 ${targets.length} 条调整记录？\n\n${shown}${more}\n\n删除范围包含当前时段、状态和结论筛选之外的历史记录，此操作无法撤销。`;
  if(!confirm(message)) return;
  recList=recList.filter(r=>!lgSelected.has(norm(r&&r.linkId)));
  lgSelected.clear();
  _ridx=null;
  saveRecs();
  toast(`已删除 ${selected.length} 个商品的 ${targets.length} 条调整记录`);
  refreshAll();
});
el("lgVerdict").addEventListener("change",e=>{ lgVerdict=e.target.value; renderLedger(); });
el("lgStatus").addEventListener("change",e=>{ lgStatus=e.target.value; renderLedger(); });
let lgTimer=null;
el("lgSearch").addEventListener("input",e=>{ clearTimeout(lgTimer); lgTimer=setTimeout(()=>{ lgKw=e.target.value; renderLedger(); },200); });
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape") return;
  if(el("recModal").classList.contains("show")){ closeForm(); return; }
  if(el("planModal").classList.contains("show")){ closePlans(); return; }
});

/* ---------- 备份 ---------- */
el("lgExport").addEventListener("click",()=>{
  const data={app:"投放利润看板",version:3,exportedAt:new Date().toISOString(),shops:shops,records:recList,plans:planList,linkImgs:linkImgs,recordQuickOptions:rmQuickOptions};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="投放调整记录-"+today().replace(/-/g,"")+".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast(`已导出 ${recList.length} 条记录`+(planList.length?`、${planList.length} 个调整计划`:""));
});
el("lgImport").addEventListener("click",()=>el("lgFile").click());
el("lgFile").addEventListener("change",e=>{
  const f=e.target.files[0]; e.target.value="";
  if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    let arr=null;
    let j=null;
    try{ j=JSON.parse(rd.result); }catch(err){}
    arr=Array.isArray(j)?j:(j&&Array.isArray(j.records)?j.records:null);
    if(!arr) return toast("文件格式不对，需要本工具导出的 JSON");
    const quickSaved=rmMergeQuickOptions(j&&j.recordQuickOptions);
    if(j&&j.linkImgs&&typeof j.linkImgs==="object"){
      let n=0;
      for(const k of Object.keys(j.linkImgs)){
        const v=String(j.linkImgs[k]||"").trim(); if(!v) continue;
        const key=normImgKey(k);
        if(key&&linkImgs[key]!==v){ linkImgs[key]=v; n++; }
      }
      if(n){ saveImgs(); }
    }
    if(j&&j.shops&&typeof j.shops==="object"){
      for(const p of Object.keys(j.shops)){
        const list=Array.isArray(j.shops[p])?j.shops[p]:[];
        if(!Array.isArray(shops[p])) shops[p]=[];
        for(const s of list){ if(s&&shops[p].indexOf(s)<0) shops[p].push(s); }
      }
      saveShops();
    }
    const has=new Set(recList.map(r=>String(r.id)));
    let add=0;
    for(const r of arr){
      if(!r||!r.linkId) continue;
      const id=String(r.id||Date.now()+"_"+Math.random().toString(36).slice(2,7));
      if(has.has(id)) continue;
      has.add(id); recList.push(Object.assign({},r,{id})); add++;
    }
    /* 调整计划：按 id 去重合并，不动已有的 */
    let addPlan=0;
    if(j&&Array.isArray(j.plans)){
      const hp=new Set(planList.map(p=>String(p.id)));
      for(const p of j.plans){
        if(!p||!p.id||!p.linkId) continue;
        const id=String(p.id);
        if(hp.has(id)) continue;
        hp.add(id); planList.push(Object.assign({},p,{id})); addPlan++;
      }
    }
    saveRecs(); _ridx=null;
    if(addPlan){ savePlans(); renderPlanList(); }
    refreshAll();
    toast((add?`已导入 ${add} 条记录`+(Object.keys(linkImgs).length?`（含 ${Object.keys(linkImgs).length} 个商品图）`:""):"没有新增记录（全部已存在）")+(addPlan?` · 计划 +${addPlan}`:"")+(j&&j.recordQuickOptions?(quickSaved?" · 快捷项已合并":" · 快捷项保存失败，请重试"):""));
  };
  rd.readAsText(f,"utf-8");
});

/* ---------- 视图切换接管 ---------- */
const __switchView=switchView;
switchView=function(v){
  if(v==="ledger"){
    viewMode="ledger";
    paintTopbarMode("ledger");
    document.querySelectorAll("#viewTabs .vtab").forEach(t=>t.classList.toggle("on",t.dataset.view==="ledger"));
    ["statsBar","tableWrap","pager","sumWrap","dateCtrl","dateSumTableWrap"].forEach(id=>{ const n=el(id); if(n) n.classList.add("hidden"); });
    el("ledgerWrap").classList.remove("hidden");
    renderLedger();
    return;
  }
  el("ledgerWrap").classList.add("hidden");
  __switchView(v);
};

const __loadCSVText=loadCSVText;
loadCSVText=function(t,n){
  _pidx=null;
  __loadCSVText(t,n);
  if(viewMode==="ledger") renderLedger();
};

function refreshAll(){
  try{ render(); }catch(e){}
  if(viewMode==="ledger") renderLedger();
  if(typeof V!=="undefined"&&V&&el("drawer").classList.contains("open")){ try{ renderV(); }catch(e){} }
  el("ledgerCnt").textContent=recList.length;
}

/* 折线图上要标记的调整日：链接主体→该链接记录；店铺主体→该店铺所有链接的记录 */
function vChartMarks(){
  const one=r=>({date:String(r.time||"").slice(0,10),label:r.item||r.plan||"调整"});
  const id=(typeof vAdjId==="function")?vAdjId():"";
  if(id) return recsOf(id).map(one);
  const f=(typeof vTop==="function")?vTop():null;
  if(f&&f.shop){
    const name=splitShop(f.shop||"").shop||String(f.shop||"");
    return recList.filter(r=>(splitShop(r.shop||"").shop||String(r.shop||""))===name).map(one);
  }
  return [];
}
window.__chart={
  series:dailySeries,
  svg:chartSvg,
  chips:()=>metChipsHtml(chartMets()),
  marks:()=>vChartMarks()
};
window.__rec={
  list:id=>recsOf(id),
  card:cardHtml,
  label:shopLabel,
  title:r=>r?(r.title||r.product||"（未填标题）"):"—"
};
/* 抽屉图表：指标芯片点选 */
document.addEventListener("click",e=>{
  const c=e.target.closest("#dMetBox .mchip[data-mk]");
  if(!c) return;
  e.preventDefault(); e.stopPropagation();
  const k=c.dataset.mk;
  let sel=chartMets().slice();
  if(sel.includes(k)){
    if(sel.length<=1){ toast("至少保留一项指标"); return; }
    sel=sel.filter(x=>x!==k);
  }else sel.push(k);
  setChartMets(CHART_METS.map(m=>m.k).filter(x=>sel.includes(x)));
  if(typeof V!=="undefined"&&V) renderV();
},true);

/* ---------- 初始化 ---------- */
paintWinChips();
el("ledgerCnt").textContent=recList.length;
})();

updateSortInfo();
(function init(){
  tableCacheLoad().then(cached => {
    if(cached){
      _noPersist = true; _restoring = true;
      try{ loadCSVText(cached.text, cached.name); }
      catch(err){
        console.error(err);
        tableCacheClear();
        toast("上次保存的表格读不出来了，请重新导入");
      }
      finally{ _noPersist = false; _restoring = false; }
      paintSrcChip();
      return;
    }
    /* 没有索引 = 没保存过：顺手清掉可能残留的 IDB 记录 */
    idbDel(IDB_TABLE).catch(() => {});
    paintSrcChip();
    if(EMBEDDED_CSV_B64 && !EMBEDDED_CSV_B64.startsWith("__")){
      try{
        const bin=atob(EMBEDDED_CSV_B64);
        const bytes=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        const text=new TextDecoder("utf-8").decode(bytes);
        loadCSVText(text,"内嵌数据");
      }catch(err){ console.error(err); toast("内嵌数据解析失败，请手动导入表格"); }
    }
  }).catch(e => console.error("[table] 恢复失败", e));
})();

  /* ================= 以上为 index.html 原内联脚本 ================= */

  /* 事件委托：替代被拆掉的内联 onclick / onerror */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1) return;
    var el = t.closest ? t.closest("[data-act]") : null;
    if (!el) return;
    var act = el.dataset.act;
    if (act === "hideColPop") hideColPop();
    else if (act === "closeDrawer") closeDrawer();
    else if (act === "setCols") setCols(el.dataset.arg);
    else if (act === "hideSelf") el.style.display = "none";
  });

  /* 图片加载失败占位（原 onerror="..."） */
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || !t.dataset || !t.dataset.imgfail) return;
    var mode = t.dataset.imgfail;
    if (mode === "hide") { t.style.display = "none"; return; }
    var cls = mode === "pw" ? "pw-ph" : "thumb-ph";
    t.outerHTML = '<div class="' + cls + '">无图</div>';
  }, true);

  document.documentElement.dataset.env = "extension";
})();
