/* 云同步后台（Service Worker）
 * 职责：坚果云 WebDAV 读写 + 与本地数据做「记录级合并」，不做任何界面。
 *
 * 同步模型（为什么不是简单的整份覆盖）：
 *   1. 远端只有一个 JSON 文件，写入是整份上传（几十~几百 KB），省心；
 *   2. 未变更时不下载：GET 带 If-None-Match，服务端回 304，不消耗流量；
 *   3. 变更时不盲覆盖：先拉远端、按记录 id 合并、再写回本机并上传，冲突不会丢数据；
 *   4. 删除靠墓碑（tombstone）：本机少了哪条记录就记一条墓碑并同步出去，
 *      否则「另一台设备一合并，删掉的记录又回来了」；
 *   5. 上传用 If-Match: ETag 做乐观锁，被别的设备抢先写入（412）就重来一轮。
 *
 * 触发方式：只在用户点「立即同步」时执行。页面打开、数据改动、定时任务都不会联网。
 */
"use strict";

const CFG_KEY = "adledger_sync_cfg_v1";
const META_KEY = "adledger_sync_meta_v1";
const TAB_KEY = "adledger_sync_tab_v1";
const K = {
  recs: "adlog_records_v2",
  shops: "adlog_shops_v1",
  imgs: "adlog_linkimgs_v1",
  prefs: "plb_prefs_v1"
};
const TOMB_TTL = 90 * 864e5;
/* 聚水潭导出文件监听：只认这些域名下载的 Excel / CSV */
const JX_KEY = "adledger_jx_pending_v1";
const JX_HOST = /^https?:\/\/([^/]+\.)?(erp321\.com|jushuitan\.com)(\/|:|$)/i;
const JX_EXT = /\.(xlsx|xlsm|csv)$/i;
const DEF = {
  base: "https://dav.jianguoyun.com/dav/",
  user: "",
  pass: "",
  path: "AdLedger/adledger-data.json",
  enc: false,
  encPass: ""
};

/* ---------------- 基础工具 ---------------- */
const sget = async (k) => (await chrome.storage.local.get(k))[k];
const sset = (obj) => chrome.storage.local.set(obj);

function b64(buf) {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64str(str) {
  return b64(new TextEncoder().encode(str));
}
/* 稳定序列化：对象键排序后比较，避免顺序不同被误判成“有变化” */
function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}
const same = (a, b) => stable(a) === stable(b);
/* 记录是数组且合并后会重排，比较时要去掉顺序影响，否则会被误判成「有改动」 */
const byId = (arr) => (arr || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
const sameRecs = (a, b) => stable(byId(a)) === stable(byId(b));

/* ---------------- 配置 / 状态 ---------------- */
async function getCfg() {
  const saved = (await sget(CFG_KEY)) || {};
  const cfg = Object.assign({}, DEF, saved);
  if (cfg.base && !/\/$/.test(cfg.base)) cfg.base += "/";
  return cfg;
}
async function getMeta() {
  return (await sget(META_KEY)) || {};
}
function publicCfg(cfg) {
  return {
    base: cfg.base,
    user: cfg.user,
    path: cfg.path,
    enc: cfg.enc,
    hasPass: !!cfg.pass,
    hasEncPass: !!cfg.encPass
  };
}
async function patchMeta(patch) {
  const meta = await getMeta();
  const next = Object.assign({}, meta, patch);
  await sset({ [META_KEY]: next });
  return next;
}

/* ---------------- 加密（可选） ---------------- */
async function deriveKey(pass, saltU8) {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltU8, iterations: 120000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}
async function encryptJSON(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj))
  );
  return { app: "ads-change-log-enc", v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function decryptJSON(obj, pass) {
  const key = await deriveKey(pass, unb64(obj.salt));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(obj.iv) }, key, unb64(obj.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------------- WebDAV ---------------- */
function url(cfg, p) {
  let base = String(cfg.base || DEF.base).trim();
  if (!/\/$/.test(base)) base += "/";
  const parts = String(p || "").split("/").filter(Boolean);
  return base + parts.map(encodeURIComponent).join("/");
}
async function dav(cfg, method, p, opt) {
  opt = opt || {};
  const headers = Object.assign({}, opt.headers || {});
  if (cfg.user) headers["Authorization"] = "Basic " + b64str(cfg.user + ":" + cfg.pass);
  return fetch(url(cfg, p), {
    method,
    headers,
    body: opt.body,
    cache: "no-store",
    credentials: "omit"
  });
}
async function ensureDirs(cfg) {
  const dirs = String(cfg.path || "").split("/").slice(0, -1).filter(Boolean);
  let cur = "";
  for (const d of dirs) {
    cur = cur ? cur + "/" + d : d;
    const r = await dav(cfg, "MKCOL", cur);
    if (r.status === 401 || r.status === 403) throw new Error("账号或应用密码不正确（" + r.status + "）");
    if (r.status >= 400 && ![405, 409].includes(r.status)) {
      throw new Error("创建远端目录失败：/" + cur + " → HTTP " + r.status);
    }
  }
}
async function fetchRemote(cfg, meta) {
  const headers = {};
  if (meta && meta.etag) headers["If-None-Match"] = meta.etag;
  const r = await dav(cfg, "GET", cfg.path, { headers });
  if (r.status === 304) return { status: "same" };
  /* 404 = 文件不存在；409 = 父目录不存在。首次同步时两者都当作「远端还没有」 */
  if (r.status === 404 || r.status === 409) return { status: "missing" };
  if (r.status === 401 || r.status === 403) throw new Error("账号或应用密码不正确（" + r.status + "）");
  if (!r.ok) throw new Error("读取远端文件失败 HTTP " + r.status);
  const text = (await r.text()).trim();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) {
      throw new Error("远端文件不是合法 JSON，可能不是本应用生成的同步文件");
    }
  }
  if (data && data.app === "ads-change-log-enc") {
    if (!cfg.encPass) throw new Error("远端文件已加密，请先在上方填写加密口令");
    try {
      data = await decryptJSON(data, cfg.encPass);
    } catch (_) {
      throw new Error("加密口令不对，无法解密远端文件");
    }
    return { status: "ok", data, etag: r.headers.get("ETag") || "", enc: true };
  }
  if (data && data.app && data.app !== "ads-change-log") {
    throw new Error("远端文件格式不对（app=" + data.app + "），已停止以免覆盖");
  }
  return { status: "ok", data, etag: r.headers.get("ETag") || "", enc: false };
}
async function putRemote(cfg, data, etag, remoteEnc) {
  /* 远端已经是加密的，就不能被未开加密的设备写成明文（避免悄悄降级） */
  const useEnc = !!cfg.enc || !!remoteEnc;
  let body;
  if (useEnc) {
    if (!cfg.encPass) throw new Error("远端文件是加密的，请填写加密口令后再同步");
    body = JSON.stringify(await encryptJSON(data, cfg.encPass));
  } else {
    body = JSON.stringify(data);
  }
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (etag) headers["If-Match"] = etag;
  const r = await dav(cfg, "PUT", cfg.path, { headers, body });
  if (r.status === 412) return { conflict: true };
  if (r.status === 409) return { ok: false, status: 409 };
  if (r.status === 401 || r.status === 403) throw new Error("账号或应用密码不正确（" + r.status + "）");
  if (!r.ok) throw new Error("写入远端失败 HTTP " + r.status);
  return { ok: true, etag: r.headers.get("ETag") || "" };
}

/* ---------------- 本地数据 ---------------- */
async function readLocal() {
  const kv = await chrome.storage.local.get([K.recs, K.shops, K.imgs, K.prefs]);
  const pj = (s, def) => {
    try {
      const v = JSON.parse(s || "");
      return v && typeof v === "object" ? v : def;
    } catch (_) { return def; }
  };
  const recs = pj(kv[K.recs], []);
  return {
    records: Array.isArray(recs) ? recs : [],
    shops: pj(kv[K.shops], {}),
    imgs: pj(kv[K.imgs], {}),
    prefs: pj(kv[K.prefs], {})
  };
}
const recStamp = (r) =>
  Date.parse(r.updatedAt || r.createdAt || r.time || "") || 0;

/* ---------------- 合并 ---------------- */
function mergeData(local, remote, meta) {
  remote = remote || {};
  const now = Date.now();

  /* 墓碑：本机删掉的记录要能“删得掉”，否则别的设备一合并就复活 */
  const tomb = Object.assign({}, meta.tombstones || {});
  for (const id in (remote.tombstones || {})) {
    tomb[id] = Math.max(tomb[id] || 0, remote.tombstones[id] || 0);
  }
  const known = new Set(meta.knownIds || []);
  const curIds = new Set((local.records || []).map((r) => String(r.id)));
  let tombAdded = 0;
  for (const id of known) {
    if (!curIds.has(id) && !tomb[id]) { tomb[id] = now; tombAdded++; }
  }
  const alive = (r) => {
    const t = tomb[String(r.id)];
    return !t || recStamp(r) > t;
  };

  const map = new Map();
  const put = (r) => {
    if (!r || !r.id || !alive(r)) return;
    const id = String(r.id);
    const old = map.get(id);
    if (!old || recStamp(r) >= recStamp(old)) map.set(id, r);
  };
  (Array.isArray(remote.records) ? remote.records : []).forEach(put);
  (local.records || []).forEach(put);

  const records = Array.from(map.values()).sort((a, b) => {
    const t = String(b.time || "").localeCompare(String(a.time || ""));
    return t !== 0 ? t : String(b.id).localeCompare(String(a.id));
  });

  const shops = {};
  [remote.shops, local.shops].forEach((src) => {
    if (!src || typeof src !== "object") return;
    for (const p of Object.keys(src)) {
      if (!Array.isArray(src[p])) continue;
      if (!shops[p]) shops[p] = [];
      for (const s of src[p]) if (s && shops[p].indexOf(s) < 0) shops[p].push(s);
    }
  });

  /* 图片：链接图以本机为准（远端多出来的补进来，本机有的不覆盖）
     远端文件名是 linkImgs（沿用备份格式 v3），兼容一下不同写法 */
  const remoteImgs = remote.linkImgs || remote.imgs || {};
  const imgs = Object.assign({}, remoteImgs, local.imgs || {});

  /* 偏好：设备各自的界面偏好不互相覆盖，本机为空时才用远端的 */
  const prefs = Object.keys(local.prefs || {}).length ? local.prefs : (remote.prefs || {});

  return { records, shops, imgs, prefs, tombstones: tomb, tombAdded };
}

function pruneTomb(tomb) {
  const now = Date.now();
  const out = {};
  for (const id in tomb) if (now - (tomb[id] || 0) < TOMB_TTL) out[id] = tomb[id];
  return out;
}

/* ---------------- 主流程 ---------------- */
let running = null;

const dataHash = (d) => stable({ r: byId(d.records), s: d.shops, i: d.imgs, p: d.prefs });

async function syncNow() {
  if (running) return running;
  running = (async () => {
    const cfg = await getCfg();
    if (!cfg.user || !cfg.pass) {
      return { ok: false, code: "nocfg", msg: "还没填同步账号" };
    }
    const meta = await getMeta();
    const local = await readLocal();
    const hash = dataHash(local);

    let remote = null, etag = "", remoteEnc = false, got304 = false;
    try {
      const fr = await fetchRemote(cfg, meta);
      if (fr.status === "ok") { remote = fr.data; etag = fr.etag; remoteEnc = !!fr.enc; }
      else if (fr.status === "same") { got304 = true; etag = meta.etag || ""; }
    } catch (e) {
      await patchMeta({ error: e.message, lastTryAt: Date.now() });
      return { ok: false, code: "net", msg: e.message };
    }

    /* 远端没变（304）+ 本机也没变 + 上次没有失败的推送 → 什么都不做，省一次上传 */
    if (got304 && meta.etag && meta.localHash === hash) {
      const m2 = await patchMeta({ lastAt: Date.now(), lastCheckAt: Date.now(), error: "" });
      return { ok: true, code: "same", changed: false, msg: "已是最新", meta: m2 };
    }

    const merged = mergeData(local, remote, meta);
    const localChanged =
      !sameRecs(local.records, merged.records) ||
      !same(local.shops, merged.shops) ||
      !same(local.imgs, merged.imgs) ||
      !same(local.prefs, merged.prefs);

    if (localChanged) {
      const patch = {};
      if (!sameRecs(local.records, merged.records)) patch[K.recs] = JSON.stringify(merged.records);
      if (!same(local.shops, merged.shops)) patch[K.shops] = JSON.stringify(merged.shops);
      if (!same(local.imgs, merged.imgs)) patch[K.imgs] = JSON.stringify(merged.imgs);
      if (!same(local.prefs, merged.prefs)) patch[K.prefs] = JSON.stringify(merged.prefs);
      await sset(patch);
      /* 通知已打开的页面：数据变了，刷新一下才不会拿旧数据继续写 */
      chrome.runtime.sendMessage({ type: "sync:applied", count: merged.records.length }).catch(() => {});
    }

    const build = (m) => ({
      app: "ads-change-log",
      version: 3,
      syncFormat: 1,
      exportedAt: new Date().toISOString(),
      device: meta.deviceId || "",
      shops: m.shops,
      records: m.records,
      linkImgs: m.imgs,
      prefs: m.prefs,
      tombstones: pruneTomb(m.tombstones)
    });

    let data = merged;
    let payload = build(merged);
    const firstSync = !remote && !got304;
    /* 304 时拿不到远端内容，但远端就等于上次合并的结果：只有本机指纹变了才需要上传，
       否则每次同步都会白传一遍（也白耗一次请求） */
    const needPush = got304
      ? (meta.localHash !== hash || localChanged)
      : (firstSync ||
         localChanged ||
         !sameRecs(remote.records || [], merged.records) ||
         !same(remote.shops || {}, merged.shops) ||
         !same(remote.linkImgs || remote.imgs || {}, merged.imgs));

    let pushed = false, newEtag = etag;
    if (needPush) {
      const deviceId = await ensureDevice();
      payload.device = deviceId;
      try {
        let res = await pushSafely(cfg, payload, etag, meta, remoteEnc);
        if (res.conflict) {
          /* 别的设备刚写过：重拉、重合并、再写一次 */
          const again = await fetchRemote(cfg, {});
          if (again.status !== "ok") throw new Error("远端持续被占用，请稍后再试");
          remoteEnc = !!again.enc;
          const merged2 = mergeData(await readLocal(), again.data, meta);
          data = merged2;
          payload = build(merged2);
          payload.device = deviceId;
          res = await pushSafely(cfg, payload, again.etag, meta, remoteEnc);
          if (res.conflict) throw new Error("远端持续被占用，请稍后再试");
          /* 第二轮合并可能又带回了远端的新数据，落到本机 */
          const local2 = await readLocal();
          const patch2 = {};
          if (!sameRecs(local2.records, merged2.records)) patch2[K.recs] = JSON.stringify(merged2.records);
          if (!same(local2.shops, merged2.shops)) patch2[K.shops] = JSON.stringify(merged2.shops);
          if (!same(local2.imgs, merged2.imgs)) patch2[K.imgs] = JSON.stringify(merged2.imgs);
          if (Object.keys(patch2).length) await sset(patch2);
        }
        newEtag = res.etag || newEtag;
        pushed = true;
      } catch (e) {
        await patchMeta({ error: e.message, lastTryAt: Date.now() });
        return { ok: false, code: "net", msg: e.message, changed: localChanged };
      }
    }

    const nextMeta = await patchMeta({
      etag: newEtag,
      deviceId: payload.device || meta.deviceId,
      knownIds: data.records.map((r) => String(r.id)),
      tombstones: pruneTomb(data.tombstones),
      lastAt: Date.now(),
      lastCheckAt: Date.now(),
      error: "",
      count: data.records.length,
      localHash: dataHash(data)
    });
    return {
      ok: true,
      changed: localChanged,
      pushed,
      count: data.records.length,
      msg: firstSync ? "已上传（首次同步）"
        : (localChanged ? "已合并云端更新" : (pushed ? "已上传" : "已是最新")),
      meta: nextMeta
    };
  })();
  try { return await running; } finally { running = null; }
}

/* 目录只在第一次或 409 时创建，其余时候直接 PUT，省请求配额 */
async function pushSafely(cfg, payload, etag, meta, remoteEnc) {
  const dirKey = cfg.base + "|" + cfg.path;
  if (meta.dirsReady !== dirKey) {
    await ensureDirs(cfg);
    await patchMeta({ dirsReady: dirKey });
  }
  let res = await putRemote(cfg, payload, etag, remoteEnc);
  if (res.conflict || res.ok) return res;
  if (res.status === 409) {
    await ensureDirs(cfg);
    return putRemote(cfg, payload, etag, remoteEnc);
  }
  return res;
}

async function ensureDevice() {
  const meta = await getMeta();
  if (meta.deviceId) return meta.deviceId;
  const id = "dev_" + Math.random().toString(36).slice(2, 10);
  await patchMeta({ deviceId: id });
  return id;
}

/* ---------------- 诊断采集（阶段 0 · 临时工具，可整体删除） ---------------- */
/* 内容脚本把页面上的请求记录发过来，按标签页暂存在 storage.session（关浏览器即清）。
 * 只在用户点「保存诊断文件」时读出去拼 JSON，不上传、不参与云同步。 */
const PROBE_KEY = "adledger_probe_v1";
const PROBE_MAX = 800;

function probeArea() {
  try {
    if (chrome.storage && chrome.storage.session) return chrome.storage.session;
  } catch (_) {}
  return chrome.storage.local;
}
async function probeAll() {
  try { return (await probeArea().get(PROBE_KEY))[PROBE_KEY] || {}; } catch (e) { return {}; }
}
async function probeSave(all) {
  try { await probeArea().set({ [PROBE_KEY]: all }); } catch (e) {}
}

/* 报表有可能整个在 iframe 里，所以每个框架各存一份 DOM 快照，保存时一起带走 */
const PROBE_DOM_KEY = "adledger_probe_dom_v1";
async function probeDomAll() {
  try { return (await probeArea().get(PROBE_DOM_KEY))[PROBE_DOM_KEY] || {}; } catch (e) { return {}; }
}
async function probeDomSave(all) {
  try { await probeArea().set({ [PROBE_DOM_KEY]: all }); } catch (e) {}
}

/* ---------------- 聚水潭接口直连（一键抓取） ----------------
 * 流程：找到/打开一个已登录的利润报表页 → 让页面脚本替我们发请求
 *   GetShopDrop（店铺清单） / GetPFSkuV3List（行数） / ExprotPfSkuV3PfNew（拿下载地址）
 *   → 后台把文件下载下来 → 存成 base64 交给看板页面解析导入。
 * 全部走接口，不模拟页面点击；页面只是「带 Cookie 的请求通道」。
 */
const JST_TMP = "adledger_jst_file_v1";
const JST_REPORT_URL = "https://ss.erp321.com/profit-report/goods-profit";
const jstWait = (ms) => new Promise((r) => setTimeout(r, ms));

function jstStep(text) {
  try {
    const p = chrome.runtime.sendMessage({ type: "jst:progress", text: text });
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}

/* 优先复用已打开的报表页，没有就后台开一个（用户看不到切页），用完关掉 */
async function jstEnsureTab() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: "https://ss.erp321.com/*" }); } catch (_) {}
  if (tabs && tabs.length) return { id: tabs[0].id, created: false };

  jstStep("打开聚水潭利润报表页…");
  const t = await chrome.tabs.create({ url: JST_REPORT_URL, active: false });
  for (let i = 0; i < 60; i++) {
    await jstWait(500);
    let cur = null;
    try { cur = await chrome.tabs.get(t.id); } catch (_) { break; }
    if (cur && cur.status === "complete") break;
  }
  await jstWait(1500);   /* 再给页面的框架脚本和登录态一点时间 */
  return { id: t.id, created: true };
}

/* 老版本扩展升级后，已经开着的页面没有注入新的内容脚本，主动补一次 */
async function jstEnsureScript(tabId) {
  try {
    if (chrome.scripting && chrome.scripting.executeScript) {
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ["jst.js"] });
    }
  } catch (_) {}
}

async function jstCall(tabId, path, data, page) {
  let last = null;
  for (let i = 0; i < 14; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: "jst:api", path: path, data: data, page: page });
      if (r) return r;
    } catch (e) { last = e; }
    await jstWait(500);
  }
  throw new Error("聚水潭页面没有响应" + (last ? "：" + last.message : "") + "，请打开该页面刷新后重试");
}

/* 大文件转 base64：分块拼，避免 String.fromCharCode 爆栈 */
function jstB64(u8) {
  let s = "";
  const CH = 8192;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
  }
  return btoa(s);
}

/* 打开后台标签页可能要等十几秒，MV3 的 worker 空闲 30 秒会被回收，这里定期碰一下 API 续命 */
function jstKeepAlive() {
  const t = setInterval(() => {
    try {
      const p = chrome.runtime.getPlatformInfo && chrome.runtime.getPlatformInfo();
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }, 20000);
  return () => clearInterval(t);
}

/* ---------------- 兜底的取数方式：分页查，自己拼表 ----------------
 * 导出接口能生成文件但取不回来时（跨域 / 文件生成慢 / 下载服务抽风），
 * 这条路径完全不碰文件：用同一个查询接口翻页拿数据，按 fldHeads 的中文列名拼成二维表。
 * 数据行字段名不确定（list / rows / items 都可能），所以按「元素里含有多少个列字段」自适应挑数组。
 */
function jstCell(v) {
  if (v == null) return "";
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

function jstPickList(data, flds) {
  let best = null, score = 0;
  Object.keys(data).forEach((k) => {
    if (k === "fldHeads") return;
    const v = data[k];
    if (!Array.isArray(v) || !v.length) return;
    const it = v[0];
    if (!it || typeof it !== "object" || Array.isArray(it)) return;
    let hit = 0;
    for (const f of flds) if (f in it) hit++;
    if (hit > score) { score = hit; best = v; }
  });
  return score ? best : null;
}

async function jstPull(tabId, cond) {
  const page = { currentPage: 1, pageSize: 100 };
  const first = await jstCall(tabId, "OrderSku/GetPFSkuV3List", { isAds: false, condition: cond }, page);
  if (!first || !first.ok) throw new Error((first && first.msg) || "查询失败");
  const d = (first.json && first.json.data) || {};
  const heads = (d.fldHeads || []).filter((h) => h && h.fld && !h.noShow);
  const flds = heads.map((h) => h.fld);
  if (!flds.length) throw new Error("接口没有返回列定义");
  const list = jstPickList(d, flds);
  if (!list) throw new Error("接口没有返回明细数据");

  const pg = (first.json && first.json.page) || {};
  const pages = Math.min(Number(pg.pages) || 1, 200);
  const count = Number(pg.count) || 0;
  const rows = [heads.map((h) => String(h.title || h.fld).replace(/\s+/g, " ").trim())];
  list.forEach((it) => rows.push(flds.map((f) => jstCell(it[f]))));

  if (pages > 1) {
    jstStep("分页读取 1/" + pages + "…");
    let done = 1;
    for (let p = 2; p <= pages; p += 3) {
      const batch = [];
      for (let q = p; q < Math.min(p + 3, pages + 1); q++) {
        batch.push(
          jstCall(tabId, "OrderSku/GetPFSkuV3List", { isAds: false, condition: cond }, { currentPage: q, pageSize: 100 })
            .then((r) => {
              const dd = (r && r.ok && r.json && r.json.data) || {};
              const ll = jstPickList(dd, flds) || [];
              ll.forEach((it) => rows.push(flds.map((f) => jstCell(it[f]))));
              done++;
            })
            .catch(() => {})
        );
      }
      await Promise.all(batch);
      jstStep("已读取 " + done + "/" + pages + " 页…");
    }
  }

  /* 表头可能重复（同名指标多次出现），加序号区分，避免导入时列对不上 */
  const seen = {};
  for (let i = 1; i < rows[0].length; i++) {
    const h = rows[0][i] || ("列" + (i + 1));
    seen[h] = (seen[h] || 0) + 1;
    if (seen[h] > 1) rows[0][i] = h + "_" + seen[h];
  }
  return { rows: rows, count: count, pages: pages };
}

/* 下载地址偶尔带 HTML 转义或省略协议，直接 fetch 会 404 */
function jstNormUrl(u) {
  let s = String(u || "").trim().replace(/&amp;/g, "&");
  if (s.indexOf("//") === 0) s = "https:" + s;
  else if (s.charAt(0) === "/") s = "https://doc.erp321.com" + s;
  return s;
}

/* 导出地址拿到后要真正取回文件。两条通道并联尝试：
 *   ① 页面通道（jst.js）：同站请求，Lax Cookie 天然带上，是主路径
 *   ② 后台通道：Service Worker 有 host_permissions 不受 CORS 限制，但跨站可能丢 Cookie
 * 两边的失败原因都记下来，一起报给用户，免得反复盲试。
 */
function jstU8FromB64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function jstGrabFilePage(tabId, url) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "jst:file", url: url });
    if (r && r.ok && r.b64) {
      return { ok: true, u8: jstU8FromB64(r.b64), kind: r.kind, via: "page" };
    }
    return { ok: false, msg: (r && r.msg) || "页面没有拿到文件" };
  } catch (e) {
    return { ok: false, msg: "页面没有响应：" + ((e && e.message) || e) };
  }
}

/* 和页面侧同一套判定：zip → xlsx，OLE → xls，文本 → csv */
function jstSniff(u8) {
  const n = Math.min(1024, u8.length);
  for (let i = 0; i < n - 3; i++) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x03 && u8[i + 3] === 0x04) return { kind: "xlsx", at: i };
  }
  if (u8.length > 4 && u8[0] === 0xd0 && u8[1] === 0xcf) return { kind: "xls", at: 0 };
  let t = "";
  try { t = new TextDecoder("utf-8").decode(u8.subarray(0, Math.min(4096, u8.length))); } catch (_) {}
  if (t) {
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    const ctrl = (t.match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length;
    if (ctrl <= 2 && (t.indexOf(",") >= 0 || t.indexOf("\t") >= 0 || /店铺|日期|商品|利润/.test(t))) return { kind: "csv", at: 0 };
  }
  return null;
}

/* 诊断用：前几十字节的 hex + 能读的文本，出问题时一眼看出拿到的是什么 */
function jstByteHead(u8) {
  const take = u8.subarray(0, Math.min(48, u8.length));
  let hex = "";
  for (let i = 0; i < take.length; i++) hex += (take[i] < 16 ? "0" : "") + take[i].toString(16);
  let txt = "";
  try { txt = new TextDecoder("utf-8").decode(u8.subarray(0, Math.min(200, u8.length))).replace(/\s+/g, " ").trim(); } catch (_) {}
  return hex + (txt ? " / " + txt.slice(0, 80) : "");
}

async function jstGrabFileBg(url) {
  let last = null;
  for (let i = 0; i < 4; i++) {
    if (i) await jstWait(1200 * i);
    try {
      const resp = await fetch(url, { credentials: "include", cache: "no-store" });
      const ct = (resp.headers.get("content-type") || "").split(";")[0];
      const u8 = new Uint8Array(await resp.arrayBuffer());
      if (!u8.length) { last = "HTTP " + resp.status + " 内容为空（0 字节）"; continue; }
      const sn = jstSniff(u8);
      if (sn) return { ok: true, u8: sn.at ? u8.subarray(sn.at) : u8, kind: sn.kind, via: "bg" };
      last = (resp.ok ? "" : "HTTP " + resp.status + " ") + (ct || "无 type") + "，前 48 字节 " + jstByteHead(u8);
    } catch (e) {
      last = "请求失败：" + ((e && e.message) || e);
    }
  }
  return { ok: false, msg: last || "后台没有拿到文件" };
}

async function jstGrabFile(tabId, url) {
  const a = await jstGrabFilePage(tabId, url);
  if (a.ok) return a;
  jstStep("改用后台通道重试…");
  const b = await jstGrabFileBg(url);
  if (b.ok) return b;
  return { ok: false, msg: "下载失败（页面通道：" + a.msg + "；后台通道：" + b.msg + "）" };
}

async function jstShops() {
  const stopAlive = jstKeepAlive();
  const got = await jstEnsureTab();
  try {
    await jstEnsureScript(got.id);
    jstStep("读取店铺清单…");
    const r = await jstCall(got.id, "Shop/GetShopDrop", { isCm: false, isContainDisabled: false });
    if (!r.ok) throw new Error(r.msg || "接口返回失败");
    const d = (r.json && r.json.data) || {};
    return { ok: true, shops: d.shopList || [], cats: d.categories || [] };
  } finally {
    stopAlive();
    if (got.created) { try { await chrome.tabs.remove(got.id); } catch (_) {} }
  }
}

async function jstRun(cond) {
  if (!cond || !Array.isArray(cond.shop) || !cond.shop.length) throw new Error("没有选择店铺");
  const stopAlive = jstKeepAlive();
  const got = await jstEnsureTab();
  try {
    await jstEnsureScript(got.id);

    jstStep("查询本次数据量…");
    const q = await jstCall(got.id, "OrderSku/GetPFSkuV3List", { isAds: false, condition: cond });
    if (!q.ok) throw new Error(q.msg || "查询失败");
    const count = (q.json && q.json.page && q.json.page.count) || 0;
    if (!count) throw new Error("这个条件下没有数据，换个时间范围或店铺试试");

    jstStep("已查到 " + count + " 行，正在生成导出文件…");
    const ec = Object.assign({}, cond, {
      isExport: true,
      showCsgTypes: ["last"],
      isExportCond: false,
      exportType: "pfsku3",
      dateOrderType: null,
      isShowProption: true,
      isShowNoFeeCsg: false
    });
    const ex = await jstCall(got.id, "AdaptiveExport/ExprotPfSkuV3PfNew", {
      exportCondition: JSON.stringify({ isAds: false, condition: ec }),
      lineCount: count
    });
    if (!ex.ok) throw new Error(ex.msg || "导出失败");
    const rawUrl = ex.json && ex.json.data && ex.json.data.url;
    if (!rawUrl) throw new Error("接口没有返回下载地址" + (ex.json && ex.json.msg ? "：" + ex.json.msg : ""));
    const url = jstNormUrl(rawUrl);

    jstStep("等待服务端生成文件…");
    const got2 = await jstGrabFile(got.id, url);
    if (!got2.ok) {
      /* 文件取不回来就换一条路：直接分页查数据自己拼表，完全不依赖文件 */
      jstStep("文件取不回来，改为直接读取数据…");
      try {
        const pulled = await jstPull(got.id, cond);
        const dd = new Date();
        const p2 = (n) => (n < 10 ? "0" : "") + n;
        const nm = "利润报表-" + dd.getFullYear() + p2(dd.getMonth() + 1) + p2(dd.getDate()) + "-" + p2(dd.getHours()) + p2(dd.getMinutes()) + ".csv";
        await chrome.storage.local.set({ [JST_TMP]: { name: nm, rows: pulled.rows, count: pulled.count, at: Date.now(), kind: "rows" } });
        return { ok: true, count: pulled.count, name: nm, size: 0, via: "pull", rows: true, note: got2.msg };
      } catch (e2) {
        /* 两条路都断了：让浏览器自己下，文件落到下载目录，看板那边的下载监听会提示读取 */
        let kicked = false;
        try {
          const k = await chrome.tabs.sendMessage(got.id, { type: "jst:kick", url: url });
          kicked = !!(k && k.ok);
        } catch (_) {}
        const err = new Error(got2.msg + "；直接取数也失败：" + ((e2 && e2.message) || e2) + (kicked ? "。已改用浏览器下载，文件在下载目录，稍后点提示条读取" : ""));
        err.kicked = kicked;
        throw err;
      }
    }

    const u8 = got2.u8;
    const d = new Date();
    const pad = (n) => (n < 10 ? "0" : "") + n;
    const ext = got2.kind === "csv" ? ".csv" : got2.kind === "xls" ? ".xls" : ".xlsx";
    const name = "利润报表-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ext;
    await chrome.storage.local.set({ [JST_TMP]: { name: name, b64: jstB64(u8), count: count, at: Date.now() } });
    return { ok: true, count: count, name: name, size: u8.length, url: url, via: got2.via };
  } finally {
    stopAlive();
    if (got.created) { try { await chrome.tabs.remove(got.id); } catch (_) {} }
  }
}

/* ---------------- 消息接口 ---------------- */
function reply(fn, sendResponse) {
  Promise.resolve()
    .then(fn)
    .then((r) => sendResponse(r))
    .catch((e) => sendResponse({ ok: false, msg: String((e && e.message) || e) }));
  return true;
}

async function resolveCfg(input) {
  const cfg = await getCfg();
  if (input) {
    for (const k of ["base", "user", "path"]) {
      if (input[k] != null) cfg[k] = String(input[k]).trim();
    }
    if (input.pass) cfg.pass = String(input.pass);
    if (input.encPass) cfg.encPass = String(input.encPass);
  }
  if (cfg.base && !/\/$/.test(cfg.base)) cfg.base += "/";
  return cfg;
}

/* ---------------- 聚水潭导出：下载监听 ---------------- */
/* 用户点导出后，浏览器会下载一个 xlsx/csv；这里记住它，等页面打开时提示「要不要读取」。
 * 只保存最新一个：连着导多个文件时，靠后的覆盖靠前的，避免列表越滚越长。 */
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener(function (delta) {
    if (!delta || !delta.state || delta.state.current !== "complete") return;
    jxCapture(delta.id);
  });
}

async function jxCapture(id) {
  try {
    const list = await chrome.downloads.search({ id });
    const it = list && list[0];
    if (!it) return;
    const name = String(it.filename || "").split(/[\\/]/).pop() || "";
    if (!JX_EXT.test(name)) return;
    const seen = [it.url, it.finalUrl, it.referrer].filter(Boolean);
    if (!seen.some((u) => JX_HOST.test(u))) return;
    const item = {
      id: it.id,
      name: name,
      url: it.finalUrl || it.url || "",
      path: it.filename || "",
      size: it.fileSize || it.totalBytes || 0,
      at: Date.now()
    };
    await sset({ [JX_KEY]: [item] });
    try {
      await chrome.action.setBadgeBackgroundColor({ color: "#007aff" });
      await chrome.action.setBadgeText({ text: "1" });
    } catch (_) {}
    chrome.runtime.sendMessage({ type: "jx:pending", item }).catch(() => {});
  } catch (e) {
    console.warn("聚水潭导出文件识别失败", e);
  }
}

async function jxClear() {
  await sset({ [JX_KEY]: [] });
  try { await chrome.action.setBadgeText({ text: "" }); } catch (_) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = (msg && msg.type) || "";

  if (type === "jx:pending") {
    return reply(async () => {
      const arr = await sget(JX_KEY);
      return { ok: true, item: (Array.isArray(arr) && arr[0]) || null };
    }, sendResponse);
  }

  if (type === "jx:done") {
    return reply(async () => {
      await jxClear();
      return { ok: true };
    }, sendResponse);
  }

  if (type === "sync:status") {
    return reply(async () => {
      const cfg = await getCfg();
      const meta = await getMeta();
      return { ok: true, cfg: publicCfg(cfg), meta };
    }, sendResponse);
  }

  if (type === "sync:save") {
    return reply(async () => {
      const c = msg.cfg || {};
      const old = await getCfg();
      const next = Object.assign({}, old, {
        base: String(c.base || DEF.base).trim(),
        user: String(c.user || "").trim(),
        path: String(c.path || DEF.path).trim().replace(/^\/+/, ""),
        enc: !!c.enc
      });
      if (c.pass) next.pass = String(c.pass);
      if (c.clearPass) next.pass = "";
      if (c.encPass) next.encPass = String(c.encPass);
      if (c.clearEncPass) next.encPass = "";
      if (!/\/$/.test(next.base)) next.base += "/";
      await sset({ [CFG_KEY]: next });
      return { ok: true, cfg: publicCfg(next) };
    }, sendResponse);
  }

  if (type === "sync:test") {
    return reply(async () => {
      const cfg = await resolveCfg(msg.cfg);
      if (!cfg.user) return { ok: false, msg: "请先填写账号（坚果云登录邮箱）" };
      if (!cfg.pass) return { ok: false, msg: "请先填写应用密码" };
      try {
        /* 第一步：PROPFIND 根目录。GET 一个还不存在的文件，不同服务器会回 404 或 409，
           分不清「路径还没建」和「地址/权限有问题」，所以先确认认证与服务器地址。 */
        const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
        const root = await dav(cfg, "PROPFIND", "", {
          headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
          body: PROPFIND_BODY
        });
        if (root.status === 401 || root.status === 403) {
          return { ok: false, msg: "认证失败：账号或应用密码不对（HTTP " + root.status + "）" };
        }
        if (root.status === 404) return { ok: false, msg: "服务器地址不对（HTTP 404），检查「服务器」是否填了 https://dav.jianguoyun.com/dav/" };
        if (root.status !== 207 && !root.ok) return { ok: false, msg: "连接异常 HTTP " + root.status + "（服务器：" + cfg.base + "）" };

        /* 第二步：看目标文件存不存在。404/409 都说明还没建，首次同步会自动建目录+写文件 */
        const r = await dav(cfg, "GET", cfg.path);
        if (r.status === 401 || r.status === 403) return { ok: false, msg: "认证失败：账号或应用密码不对（HTTP " + r.status + "）" };
        if (r.status === 404 || r.status === 409) {
          return { ok: true, msg: "连接正常；远端文件还不存在，首次同步会自动创建目录与文件" };
        }
        if (!r.ok && r.status !== 206) return { ok: false, msg: "读取远端文件异常 HTTP " + r.status };
        return { ok: true, msg: "连接正常，远端文件已存在" };
      } catch (e) {
        return {
          ok: false,
          msg: "连接失败：" + ((e && e.message) || e) + "（检查网络、账号与应用密码）"
        };
      }
    }, sendResponse);
  }

  if (type === "sync:now") {
    return reply(async () => {
      const r = await syncNow();
      const meta = await getMeta();
      return Object.assign({}, r, { meta });
    }, sendResponse);
  }

  if (type === "jst:shops") {
    return reply(async () => jstShops(), sendResponse);
  }

  if (type === "jst:run") {
    return reply(async () => jstRun(msg.condition), sendResponse);
  }

  if (type === "probe:need-main") {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId == null) return false;
    return reply(async () => {
      try {
        if (chrome.scripting && chrome.scripting.executeScript) {
          await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            world: "MAIN",
            files: ["probe-main.js"]
          });
        }
      } catch (e) {
        return { ok: false, msg: String((e && e.message) || e) };
      }
      return { ok: true };
    }, sendResponse);
  }

  if (type === "probe:snap-request") {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId == null) return false;
    return reply(async () => {
      try { await chrome.tabs.sendMessage(tabId, { type: "probe:snap" }); } catch (e) {}
      return { ok: true };
    }, sendResponse);
  }

  if (type === "probe:dom") {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId == null) return false;
    return reply(async () => {
      const all = await probeDomAll();
      const k = String(tabId);
      const url = String(msg.url || "").slice(0, 300);
      const arr = (all[k] || []).filter((d) => !(d.url === url && d.top === !!msg.top));
      arr.push({ top: !!msg.top, url: url, at: Date.now(), dom: msg.dom || {} });
      all[k] = arr.slice(-10);
      await probeDomSave(all);
      return { ok: true, n: all[k].length };
    }, sendResponse);
  }

  if (type === "probe:log" || type === "probe:dump" || type === "probe:clear") {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId == null) return false;
    return reply(async () => {
      const all = await probeAll();
      const k = String(tabId);
      if (type === "probe:clear") {
        delete all[k];
        await probeSave(all);
        const doms = await probeDomAll();
        delete doms[k];
        await probeDomSave(doms);
        return { ok: true, recs: [], doms: [] };
      }
      if (type === "probe:log") {
        const add = Array.isArray(msg.recs) ? msg.recs : [];
        const arr = (all[k] || []).concat(add);
        all[k] = arr.slice(-PROBE_MAX);
        await probeSave(all);
        return { ok: true, n: all[k].length };
      }
      const doms = (await probeDomAll())[k] || [];
      return { ok: true, recs: all[k] || [], doms: doms };
    }, sendResponse);
  }

  return false;
});

/* 点图标：已经开着就切过去，没开就新开一个标签页 */
chrome.action.onClicked.addListener(async () => {
  const target = chrome.runtime.getURL("app.html");
  const saved = await sget(TAB_KEY);
  if (saved) {
    try {
      const tab = await chrome.tabs.update(saved, { active: true, url: target });
      if (tab) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        return;
      }
    } catch (_) {}
  }
  const tab = await chrome.tabs.create({ url: target });
  if (tab && tab.id) await sset({ [TAB_KEY]: tab.id });
});
