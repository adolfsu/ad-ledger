/* 聚水潭页面诊断采集（阶段 0 · 临时工具）
 *
 * 目的：在真实页面上抓一次「筛选 + 导出」的过程，产出 jst-probe.json，
 *       用来确定店铺清单和导出按钮到底走接口还是 DOM，避免靠猜写选择器。
 *
 * 采集内容（都在本机，不上传）：
 *   - meta：页面地址、标题、iframe 结构、本地存储的键名
 *   - dom：筛选/导出相关的按钮、输入框、下拉、含「店铺」的节点、表单
 *   - net：XHR / fetch 的地址、方法、参数、状态、响应前 600 字（token 类字段已打码）
 *   - acts：用户点过的「导出/筛选/店铺/日期」类控件
 *
 * 只在 erp321.com / jushuitan.com 注入；界面只出现在顶层框架，
 * 且仅当路径像报表页、或地址栏带 #jstprobe 时显示，平时不打扰。
 * 采集本身始终在后台进行（上限 400 条），点「保存」时才组装文件。
 */
"use strict";

(function () {
  if (window.__jstProbeHooked) return;
  window.__jstProbeHooked = true;

  var TOP = false;
  try { TOP = window.top === window; } catch (e) { TOP = false; }

  var CAP = 400;          // 每个框架最多记多少条
  var SEQ = 0;
  var BUF = [];
  var TOTAL = 0;          // 后台汇总的条数（含 iframe），比本帧计数准
  var PROBE_VER = 3;      // 采集脚本版本，写进 JSON，便于判断跑的是哪一版
  var MAIN_OK = false;    // 主世界脚本（probe-main.js）是否已握手
  var FLUSH_T = 0;
  var LOG = [];           // 本次会话记录（顶层保存时只用后台汇总，这里仅用于计数）

  /* ---------------- 工具 ---------------- */
  function snd(type, extra) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) {
          void chrome.runtime.lastError;
          resolve(r || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  function cut(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  /* token / 签名 / 密码一类的值打码，保留键名 */
  function mask(s) {
    return String(s == null ? "" : s)
      .replace(/((?:token|ticket|sign|signature|session|sessionid|sid|password|pwd|cookie|authorization|access_key|secret)[^=&\s"']{0,12}[=:]\s*)([^&\s"',}]{4,})/gi, "$1***")
      .replace(/\b[0-9a-f]{32,}\b/gi, function (m) { return m.slice(0, 6) + "***"; });
  }

  function absUrl(u) {
    try { return new URL(String(u), location.href).href; } catch (e) { return String(u || ""); }
  }

  function cleanUrl(u) {
    var s = absUrl(u);
    s = s.replace(/([?&](?:token|ticket|sign|signature|session|sid|password|pwd|access_key|secret)=)([^&]*)/gi, "$1***");
    return cut(s, 420);
  }

  function bodySample(b) {
    if (b == null || b === "") return "";
    try {
      if (typeof b === "string") return cut(mask(b), 900);
      if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) return cut(mask(b.toString()), 900);
      if (typeof FormData !== "undefined" && b instanceof FormData) {
        var arr = [];
        b.forEach(function (v, k) {
          if (typeof v === "string") arr.push(k + "=" + cut(mask(v), 60));
          else arr.push(k + "=[file]");
        });
        return cut(arr.join("&"), 900);
      }
      if (typeof Blob !== "undefined" && b instanceof Blob) return "[blob " + b.size + "B]";
      return cut(mask(JSON.stringify(b)), 900);
    } catch (e) { return "[" + typeof b + "]"; }
  }

  /* 静态资源不记；其余都记（宁可多，后面能筛） */
  function skip(u) {
    return !u || /^(data|blob|chrome-extension):/i.test(u) ||
      /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|mp4)(\?|#|$)/i.test(u);
  }

  function rec(o) {
    BUF.push(o);
    if (BUF.length >= 8) flush();
    else if (!FLUSH_T) FLUSH_T = setTimeout(flush, 700);
  }

  function flush() {
    if (FLUSH_T) { clearTimeout(FLUSH_T); FLUSH_T = 0; }
    if (!BUF.length) return;
    var arr = BUF.splice(0, BUF.length);
    if (arr.length > CAP) arr = arr.slice(-CAP);
    snd("probe:log", { recs: arr }).then(function (r) {
      if (r && typeof r.n === "number") TOTAL = r.n;
    });
  }

  function frameInfo() {
    var path = [];
    try {
      var w = window;
      while (w && w !== w.parent && path.length < 6) {
        path.unshift(w.name || "(匿名)");
        w = w.parent;
      }
    } catch (e) {}
    return { top: TOP, url: cut(location.href, 300), name: window.name || "", chain: path };
  }

  /* 点过的关键控件（找导出按钮、店铺下拉最直接） */
  function hookClick() {
    document.addEventListener("click", function (e) {
      try {
        if (e.target && e.target.closest && e.target.closest("#jstProbe")) return;
        var el = e.target;
        for (var i = 0; el && i < 4; i++) {
          var t = (el.innerText || el.textContent || "").trim();
          if (t && t.length <= 40 && /导出|下载|筛选|查询|搜索|店铺|日期|时间|重置|另存/.test(t)) {
            rec({
              kind: "click", seq: ++SEQ, at: Date.now(), f: frameInfo(),
              text: cut(t, 40), path: pathOf(el)
            });
            setTimeout(function () { snapMenus(t); }, 420);
            return;
          }
          el = el.parentElement;
        }
      } catch (err) {}
    }, true);
  }

  /* AntD 的菜单、日期面板、店铺下拉都在浮层里，点完立刻抓一份文本与选项 */
  function snapMenus(trigger) {
    try {
      var out = [];
      var els = document.querySelectorAll(".ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown, .ant-modal");
      for (var i = 0; i < els.length && out.length < 6; i++) {
        var el = els[i];
        if (/hidden/.test(el.className || "")) continue;
        var box = el.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        var txt = (el.innerText || "").trim().replace(/\s+/g, " ");
        if (!txt) continue;
        var opts = Array.prototype.map.call(
          el.querySelectorAll('[role="option"], .ant-select-item-option, .ant-dropdown-menu-item, .ant-picker-cell-inner'),
          function (o) { return cut((o.innerText || "").trim(), 30); }
        ).filter(Boolean).slice(0, 100);
        out.push({ cls: cls(el), text: cut(txt, 700), options: opts });
      }
      if (out.length) rec({ kind: "menu", seq: ++SEQ, at: Date.now(), f: frameInfo(), trigger: cut(trigger, 30), menus: out });
    } catch (e) {}
  }

  /* 主世界脚本（probe-main.js）抓不到 chrome.*，把请求记录用 postMessage 递过来 */
  window.addEventListener("message", function (e) {
    try {
      if (e.source !== window) return;
      var d = e.data;
      if (!d || d.__jstProbeNet !== 1 || !d.rec) return;
      var r = d.rec;
      if (!r || typeof r !== "object" || !r.kind) return;
      if (r.kind === "hello") {
        MAIN_OK = true;
        updateConn();
        return;
      }
      if (["fetch", "xhr", "form", "open"].indexOf(r.kind) < 0) return;
      r.seq = ++SEQ;
      r.at = Date.now();
      r.f = frameInfo();
      rec(r);
    } catch (err) {}
  });

  /* ---------------- DOM 快照 ---------------- */
  function cls(el) {
    var c = el.getAttribute && el.getAttribute("class");
    return c ? String(c).trim().split(/\s+/).slice(0, 4).join(".") : "";
  }

  function pathOf(el) {
    var out = [];
    try {
      var n = el;
      for (var i = 0; n && i < 4; i++) {
        var s = n.tagName.toLowerCase();
        if (n.id) s += "#" + n.id;
        var c = cls(n);
        if (c) s += "." + c;
        out.unshift(s);
        n = n.parentElement;
      }
    } catch (e) {}
    return out.join(" > ");
  }

  function desc(el) {
    var o = {
      tag: el.tagName.toLowerCase(),
      path: pathOf(el),
      text: cut((el.innerText || el.textContent || "").trim().replace(/\s+/g, " "), 50),
      id: el.id || "",
      cls: cls(el),
      name: el.getAttribute("name") || "",
      type: el.getAttribute("type") || "",
      placeholder: el.getAttribute("placeholder") || "",
      role: el.getAttribute("role") || "",
      value: cut(mask(el.value || ""), 40)
    };
    var box = null;
    try { box = el.getBoundingClientRect(); } catch (e) {}
    if (box) o.box = [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)];
    return o;
  }

  function snapDom() {
    var out = { buttons: [], inputs: [], selects: [], shopNodes: [], forms: [], iframes: [], storageKeys: [] };
    var seen = new Set();
    function add(list, el, max) {
      if (list.length >= max || seen.has(el)) return;
      seen.add(el);
      list.push(desc(el));
    }

    try {
      Array.prototype.forEach.call(document.querySelectorAll('button, [role="button"], a, .btn, [class*="btn"], [class*="Btn"]'), function (el) {
        var t = (el.innerText || el.textContent || "").trim();
        if (t && t.length <= 30 && /导出|下载|筛选|查询|搜索|店铺|日期|时间|重置|确定/.test(t)) add(out.buttons, el, 70);
      });
      Array.prototype.forEach.call(document.querySelectorAll("input, textarea"), function (el) { add(out.inputs, el, 60); });
      Array.prototype.forEach.call(document.querySelectorAll("select"), function (el) {
        var d = desc(el);
        d.options = Array.prototype.map.call(el.options || [], function (o) { return cut(o.text, 20); }).slice(0, 30);
        if (!seen.has(el) && out.selects.length < 30) { seen.add(el); out.selects.push(d); }
      });
      Array.prototype.forEach.call(document.querySelectorAll("body *"), function (el) {
        if (out.shopNodes.length >= 40) return;
        if (el.children.length > 3) return;
        var t = (el.textContent || "").trim();
        if (t && t.length <= 40 && /店铺|商家|门店/.test(t)) add(out.shopNodes, el, 40);
      });
      Array.prototype.forEach.call(document.querySelectorAll("form"), function (el) { add(out.forms, el, 15); });
      Array.prototype.forEach.call(document.querySelectorAll("iframe, frame"), function (f) {
        var d = { tag: f.tagName.toLowerCase(), src: cut(f.getAttribute("src") || "", 200), id: f.id || "", name: f.name || "" };
        try { d.accessible = !!f.contentDocument; } catch (e) { d.accessible = false; }
        out.iframes.push(d);
      });
      try { out.storageKeys = Object.keys(localStorage).slice(0, 120); } catch (e) {}
      try { out.sessionKeys = Object.keys(sessionStorage).slice(0, 120); } catch (e) {}
      /* 筛选条件/店铺选择这类键的值，能看出平台是怎么存筛选状态的（token 已打码） */
      try {
        var pick = /export|condition|filter|shop|date|multi|user|select/i;
        var lsSample = {}, ssSample = {};
        Object.keys(localStorage).forEach(function (k) {
          if (pick.test(k)) lsSample[k] = cut(mask(localStorage.getItem(k) || ""), 400);
        });
        Object.keys(sessionStorage).forEach(function (k) {
          if (pick.test(k)) ssSample[k] = cut(mask(sessionStorage.getItem(k) || ""), 400);
        });
        out.storageSample = lsSample;
        out.sessionSample = ssSample;
      } catch (e) {}
      out.resources = [];
      try {
        performance.getEntriesByType("resource").forEach(function (r) {
          if (out.resources.length >= 120) return;
          if (/xmlhttprequest|fetch/i.test(r.initiatorType)) out.resources.push(cleanUrl(r.name));
        });
      } catch (e) {}
    } catch (e) {}
    return out;
  }

  function meta() {
    return {
      app: "jst-probe", v: PROBE_VER, at: new Date().toISOString(),
      probeVer: PROBE_VER, mainOk: MAIN_OK,
      url: location.href, title: document.title,
      ua: navigator.userAgent, screen: [screen.width, screen.height],
      lang: navigator.language, tz: new Date().getTimezoneOffset(),
      top: TOP, name: window.name || ""
    };
  }

  /* ---------------- 界面（仅顶层） ---------------- */
  var box = null, panel = null, stat = null, tip = null, conn = null;

  function updateConn() {
    if (!conn) return;
    conn.textContent = MAIN_OK ? "✓ 已连接页面请求采集" : "✗ 未连接：扩展没重载成功，请到扩展页点 🔄";
    conn.style.color = MAIN_OK ? "#0a7d32" : "#c0392b";
  }
  var HOLD = 0;   // 提示语保留到什么时候，避免被每秒刷新的计数盖掉

  function setStat(text, holdMs) {
    if (!stat) return;
    stat.textContent = text;
    HOLD = Date.now() + (holdMs || 0);
  }

  function ensureCss() {
    /* 用 CSSOM 写样式，避开页面 CSP 对 style 属性的限制 */
    if (box) return;
    box = document.createElement("div");
    box.id = "jstProbe";
    box.style.cssText = [
      "position:fixed", "right:16px", "bottom:88px", "z-index:2147483000",
      "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif",
      "color:#111", "display:flex", "flex-direction:column", "align-items:flex-end", "gap:8px"
    ].join(";");

    panel = document.createElement("div");
    panel.style.cssText = [
      "width:270px", "padding:12px 13px", "border-radius:12px",
      "background:#fff", "border:1px solid rgba(0,0,0,.10)",
      "box-shadow:0 12px 32px rgba(0,0,0,.18)", "display:none"
    ].join(";");

    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
    var hb = document.createElement("b");
    hb.textContent = "聚水潭采集 · 诊断 v" + PROBE_VER;
    hb.style.cssText = "font-size:13px;color:#111";
    var sp = document.createElement("span");
    sp.style.cssText = "flex:1";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "收起";
    close.style.cssText = btnCss("ghost");
    close.onclick = function () { panel.style.display = "none"; pill.style.display = "inline-flex"; };
    head.appendChild(hb); head.appendChild(sp); head.appendChild(close);

    conn = document.createElement("div");
    conn.style.cssText = "font-size:11.5px;margin-bottom:6px;font-weight:600";

    stat = document.createElement("div");
    stat.style.cssText = "font-size:12px;color:#444;margin-bottom:6px";
    stat.textContent = "正在后台记录…";

    tip = document.createElement("div");
    tip.style.cssText = "font-size:11.5px;color:#777;line-height:1.6;margin-bottom:9px";
    tip.textContent = "步骤：① 清空 ② 刷新本页 ③ 正常筛一次并点「导出」 ④ 保存诊断文件发我。";

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px";
    var bClear = mkBtn("清空", "ghost", doClear);
    var bSave = mkBtn("保存诊断文件", "primary", doSave);
    row.appendChild(bClear); row.appendChild(bSave);

    panel.appendChild(head); panel.appendChild(conn); panel.appendChild(stat); panel.appendChild(tip); panel.appendChild(row);
    updateConn();

    var pill = document.createElement("button");
    pill.type = "button";
    pill.textContent = "🔍 诊断";
    pill.style.cssText = [
      btnCss("pill"), "display:inline-flex", "align-items:center", "gap:4px"
    ].join(";");
    pill.onclick = function () { panel.style.display = "block"; pill.style.display = "none"; };

    box.appendChild(panel);
    box.appendChild(pill);
    document.documentElement.appendChild(box);

    setInterval(function () {
      if (!stat || Date.now() < HOLD) return;
      stat.textContent = "已记录 " + Math.max(TOTAL, LOG.length) + " 条 · " + (TOP ? "当前页" : "子框架");
    }, 1000);
  }

  function btnCss(kind) {
    var base = "border-radius:8px;cursor:pointer;font:12px/1 inherit;padding:7px 10px;border:1px solid transparent";
    if (kind === "primary") return base + ";background:#0a84ff;color:#fff;border-color:#0a84ff;font-weight:600";
    if (kind === "pill") return base + ";background:#111;color:#fff;padding:8px 12px;box-shadow:0 6px 18px rgba(0,0,0,.22)";
    return base + ";background:#f2f2f4;color:#333;border-color:rgba(0,0,0,.08)";
  }

  function mkBtn(text, kind, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = btnCss(kind) + ";flex:1";
    b.onclick = fn;
    return b;
  }

  function doClear() {
    flush();
    snd("probe:clear").then(function () {
      LOG.length = 0;
      TOTAL = 0;
      setStat("已清空，刷新页面后重新筛一次", 6000);
    });
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.style.display = "none";
      document.documentElement.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(a.href); } catch (e) {}
        a.remove();
      }, 8000);
      return true;
    } catch (e) { return false; }
  }

  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.documentElement.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      if (ok) return true;
    } catch (e) {}
    try { navigator.clipboard.writeText(text); return true; } catch (e) {}
    return false;
  }

  function doSave() {
    flush();
    setStat("正在整理…", 3000);
    /* 报表可能整个在 iframe 里：先让每个框架把自己那份 DOM 交上来，再取汇总 */
    snd("probe:snap-request").then(function () {
      setTimeout(collectAndSave, 600);
    });
  }

  function collectAndSave() {
    snd("probe:dump").then(function (r) {
      var net = (r && Array.isArray(r.recs)) ? r.recs : [];
      var frames = (r && Array.isArray(r.doms)) ? r.doms : [];
      var data = {
        meta: meta(),
        dom: snapDom(),
        frames: frames,
        net: net,
        note: "净请求 " + net.length + " 条、框架快照 " + frames.length + " 份；接口/控件结构以本文件为准"
      };
      var text = JSON.stringify(data, null, 2);
      var d = new Date();
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      var name = "jst-probe-v" + PROBE_VER + "-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".json";
      var ok = download(name, text);
      if (!ok && !copyFallback(text)) {
        setStat("保存失败，请把控制台里的数据发我", 8000);
        return;
      }
      setStat(ok ? ("已保存 " + name + "（" + Math.round(text.length / 1024) + " KB）") : "已复制到剪贴板", 8000);
    });
  }

  function mountUi() {
    if (!TOP || document.documentElement == null) return;
    var path = location.pathname + location.hash;
    var looksReport = /profit|report|goods|sale|finance/i.test(path) || /#jstprobe/i.test(path);
    if (!looksReport) return;
    ensureCss();
  }

  /* ---------------- 启动 ---------------- */
  try { hookClick(); } catch (e) { console.warn("诊断钩子失败", e); }

  /* 顶层点「保存」时由后台转发这条消息，每个框架各自回一份 DOM */
  try {
    chrome.runtime.onMessage.addListener(function (m, _s, resp) {
      if (!m || m.type !== "probe:snap") return;
      try { snd("probe:dom", { top: TOP, url: location.href, dom: snapDom() }); } catch (e) {}
      try { resp({ ok: true }); } catch (e) {}
    });
  } catch (e) {}

  if (TOP) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountUi, { once: true });
    } else {
      mountUi();
    }
    /* 单页应用切换路由后路径才变成报表页，晚一点再试一次 */
    setTimeout(mountUi, 2500);
    /* 主世界脚本没握手：先让后台用 scripting 补一次注入（不依赖 manifest 的 world 支持） */
    setTimeout(function () {
      if (MAIN_OK) return;
      snd("probe:need-main").then(function () {});
    }, 1500);
    setTimeout(function () {
      if (MAIN_OK) return;
      updateConn();
      setStat("主世界脚本没加载：请在 chrome://extensions/ 点 🔄，再刷新本页", 15000);
    }, 4500);
    window.addEventListener("hashchange", mountUi);
  }

  /* 本页记录计数（只用于面板显示） */
  var _rec = rec;
  rec = function (o) { LOG.push(1); if (LOG.length > CAP) LOG.shift(); _rec(o); };
})();
