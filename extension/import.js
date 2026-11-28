/* 聚水潭导出 → 一键读取（仅扩展版）
 * 后台监听下载完成后，这里负责：提示横幅 → 拿到文件字节 → 交给看板主脚本解析并弹出列对应。
 *
 * 取文件的三种办法，按成功率排：
 *   1. 用下载记录里的 https 链接重新取一次（多数导出的临时链接仍有效）；
 *   2. 直接读本地文件（需要开启「允许访问文件网址」）；
 *   3. 都不行就让用户手动选一次文件——解析与列对应仍然是自动的。
 */
"use strict";

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var item = null;
  var bar = null;
  var busy = false;

  function send(type, extra) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) {
          void chrome.runtime.lastError;
          resolve(r || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  /* 主脚本是异步启动的（先读存储），等它就绪 */
  function coreReady() {
    return new Promise(function (resolve) {
      (function tick() {
        if (window.__imp) return resolve(true);
        setTimeout(tick, 120);
      })();
    });
  }

  function toast(text) {
    var t = $("toast");
    if (!t) return;
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.style.display = "none"; }, 3200);
  }

  function fmtSize(n) {
    if (!n) return "";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function mount() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "jxBar";
    bar.style.cssText = [
      "position:fixed", "left:50%", "bottom:56px", "transform:translateX(-50%)",
      "z-index:180", "display:none", "align-items:center", "gap:10px",
      "padding:9px 12px 9px 14px", "border-radius:12px",
      "background:var(--panel)", "border:1px solid var(--border)",
      "box-shadow:0 10px 30px var(--shadow-c)", "font-size:12.5px",
      "color:var(--text)", "max-width:min(760px,94vw)",
      "-webkit-backdrop-filter:blur(18px)", "backdrop-filter:blur(18px)"
    ].join(";");
    bar.innerHTML =
      '<span style="font-size:15px">📥</span>' +
      '<span id="jxText" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>' +
      '<span style="flex:1"></span>' +
      '<button type="button" class="btn primary" id="jxRead" style="padding:5px 11px">读取</button>' +
      '<button type="button" class="btn ghost" id="jxSkip" style="padding:5px 9px">忽略</button>' +
      '<button type="button" class="btn ghost" id="jxClose" style="padding:5px 7px" title="关闭">✕</button>';
    document.body.appendChild(bar);
    $("jxRead").addEventListener("click", onRead);
    $("jxSkip").addEventListener("click", function () {
      hide();
      send("jx:done");
    });
    $("jxClose").addEventListener("click", hide);
    return bar;
  }

  function show(it) {
    item = it;
    mount();
    var txt = "检测到聚水潭导出：" + it.name + (it.size ? "（" + fmtSize(it.size) + "）" : "");
    $("jxText").textContent = txt;
    $("jxText").title = txt;
    bar.style.display = "flex";
  }

  function hide() {
    if (bar) bar.style.display = "none";
  }

  function setBusy(on, text) {
    busy = on;
    var b = $("jxRead");
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? "读取中…" : "读取";
    if (text) $("jxText").textContent = text;
  }

  /* ---------- 取文件 ---------- */
  /* 先不带 cookie 取（导出链接多半是签名的临时地址，允许跨域通配）；失败再带上 cookie 试一次 */
  function fetchUrl(u) {
    if (!/^https?:/i.test(u || "")) return Promise.resolve(null);
    var tryOnce = function (cred) {
      return fetch(u, { credentials: cred, cache: "no-store" })
        .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .catch(function () { return null; });
    };
    return tryOnce("omit").then(function (b) {
      return b && b.byteLength ? b : tryOnce("include");
    });
  }

  function readLocal(p) {
    return new Promise(function (resolve) {
      if (!p) return resolve(null);
      try {
        var u = "file:///" + String(p).replace(/\\/g, "/").replace(/^\/+/, "");
        var x = new XMLHttpRequest();
        x.open("GET", u, true);
        x.responseType = "arraybuffer";
        x.onload = function () {
          resolve((x.status === 200 || x.status === 0) && x.response ? x.response : null);
        };
        x.onerror = function () { resolve(null); };
        x.send();
      } catch (e) { resolve(null); }
    });
  }

  function pickFile(name) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".xlsx,.xlsm,.csv";
      inp.addEventListener("change", function () { resolve((inp.files && inp.files[0]) || null); });
      toast("浏览器不让直接读本地文件，请在弹窗里选一次：" + name);
      inp.click();
    });
  }

  async function acquire(it) {
    var buf = await fetchUrl(it.url);
    if (buf && buf.byteLength) return { name: it.name, buf: buf, auto: true };
    buf = await readLocal(it.path);
    if (buf && buf.byteLength) return { name: it.name, buf: buf, auto: true };
    var f = await pickFile(it.name);
    if (!f) return null;
    return { name: f.name, buf: await f.arrayBuffer(), auto: false };
  }

  async function onRead() {
    if (busy || !item) return;
    setBusy(true, "正在读取 " + item.name + "…");
    try {
      await coreReady();
      var got = await acquire(item);
      if (!got) { setBusy(false); return; }
      try {
        await window.__imp.buffer(got.name, got.buf);
      } catch (err) {
        /* 自动取到的不是表格（比如取到的是登录页），退回手动选文件 */
        if (!got.auto) throw err;
        console.warn("自动读取失败，改为手动选择", err);
        var f = await pickFile(item.name);
        if (!f) throw err;
        await window.__imp.buffer(f.name, await f.arrayBuffer());
      }
      hide();
      send("jx:done");
    } catch (e) {
      console.error(e);
      toast("读取失败：" + ((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- 启动 / 后台通知 ---------- */
  function boot() {
    send("jx:pending").then(function (r) {
      if (r && r.ok && r.item) show(r.item);
    });
  }

  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "jx:pending" && msg.item) show(msg.item);
    });
  } catch (e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
