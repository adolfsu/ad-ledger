/* 云同步界面（扩展版本专属）
 * 只负责：设置表单、状态展示、按钮；真正的网络与合并都在 bg.js 里。
 * 数据读写走 chrome.storage.local（和 app.js 共用同一批键），所以不需要跟页面主逻辑耦合。
 */
(function () {
  "use strict";
  if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;

  var el = function (id) { return document.getElementById(id); };
  var state = { cfg: null, meta: {}, busy: false };

  /* ---------------- 通信 ---------------- */
  function send(type, payload) {
    return new Promise(function (resolve) {
      var msg = Object.assign({ type: type }, payload || {});
      try {
        chrome.runtime.sendMessage(msg, function (r) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, msg: chrome.runtime.lastError.message });
            return;
          }
          resolve(r || { ok: false, msg: "后台没有响应" });
        });
      } catch (e) {
        resolve({ ok: false, msg: String(e.message || e) });
      }
    });
  }

  /* ---------------- 样式 ---------------- */
  var css = `
#syncBtn{position:relative}
#syncBtn .dot{width:6px;height:6px;border-radius:99px;background:var(--red);display:none}
#syncBtn.has-err .dot{display:inline-block}
.smask{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;
  background:rgba(22,25,32,.28);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);padding:20px}
.smask.on{display:flex}
.sbox{width:min(560px,100%);max-height:88vh;overflow:auto;background:var(--panel);border:1px solid var(--border);
  border-radius:18px;box-shadow:0 24px 70px var(--shadow-c);backdrop-filter:saturate(180%) blur(20px)}
.shead{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--border)}
.shead b{font-size:15px;letter-spacing:-.02em}
.shead .sstate{font-size:11.5px;color:var(--text3);padding:3px 9px;border-radius:99px;background:var(--panel2)}
.shead .sx{margin-left:auto;border:0;background:transparent;color:var(--text2);font-size:16px;cursor:pointer;
  width:28px;height:28px;border-radius:50%}
.shead .sx:hover{background:var(--hover);color:var(--text)}
.sbody{padding:14px 18px;display:flex;flex-direction:column;gap:10px}
.srow{display:flex;align-items:center;gap:10px}
.srow>label{width:86px;flex:none;font-size:12.5px;color:var(--text2)}
.srow input[type=text],.srow input[type=password],.srow input[type=number],.srow select{
  flex:1;min-width:0;background:var(--panel2);border:1px solid var(--border2);color:var(--text);
  border-radius:9px;padding:8px 10px;font-size:12.5px;outline:none}
.srow input:focus,.srow select:focus{border-color:var(--accent)}
.srow .unit{font-size:11.5px;color:var(--text3);flex:none}
.switch{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text);cursor:pointer;user-select:none;white-space:nowrap;flex:none}
.switch input{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
.shint{font-size:11.5px;line-height:1.7;color:var(--text3);background:var(--hover2);border:1px solid var(--border);
  border-radius:10px;padding:9px 11px}
.shint b{color:var(--text2);font-weight:600}
.shint code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:var(--panel2);
  padding:1px 5px;border-radius:4px;color:var(--text2)}
.sfoot{display:flex;align-items:center;gap:8px;padding:12px 18px 16px;border-top:1px solid var(--border)}
.sfoot .smsg{flex:1;min-width:0;font-size:11.5px;line-height:1.5;color:var(--text3);word-break:break-word}
.sfoot .smsg.err{color:var(--red)}
.sfoot .smsg.ok{color:var(--green)}
.sfoot .btn{flex:none}
.sbanner{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:210;display:none;align-items:center;gap:10px;
  background:var(--panel);border:1px solid var(--border2);border-radius:12px;padding:9px 14px;font-size:12.5px;
  box-shadow:0 10px 34px var(--shadow-c);backdrop-filter:blur(18px)}
.sbanner.on{display:flex}
.sbanner button{border:0;background:var(--accent);color:#fff;border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer}
`;
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  /* ---------------- 顶栏按钮 ---------------- */
  var themeBtn = el("themeBtn");
  var btn = document.createElement("button");
  btn.className = "btn ghost";
  btn.id = "syncBtn";
  btn.title = "坚果云 WebDAV 云同步";
  btn.innerHTML = '☁ 同步<span class="dot"></span>';
  if (themeBtn && themeBtn.parentNode) themeBtn.insertAdjacentElement("afterend", btn);
  else document.body.appendChild(btn);

  /* ---------------- 弹窗 ---------------- */
  var mask = document.createElement("div");
  mask.className = "smask";
  mask.id = "smask";
  mask.innerHTML = `
<div class="sbox" role="dialog" aria-modal="true" aria-label="云同步设置">
  <div class="shead"><b>☁ 云同步</b><span class="sstate" id="sState">未配置</span>
    <button type="button" class="sx" id="sClose" aria-label="关闭">✕</button></div>
  <div class="sbody">
    <div class="srow"><label>服务器</label>
      <input type="text" id="sBase" placeholder="https://dav.jianguoyun.com/dav/"></div>
    <div class="srow"><label>账号</label>
      <input type="text" id="sUser" placeholder="坚果云登录邮箱" autocomplete="username"></div>
    <div class="srow"><label>应用密码</label>
      <input type="password" id="sPass" placeholder="在坚果云「账户信息 → 安全选项」添加应用密码" autocomplete="off"></div>
    <div class="srow"><label>远端文件</label>
      <input type="text" id="sPath" placeholder="AdLedger/adledger-data.json"></div>
    <div class="srow"><label>加密上传</label>
      <label class="switch"><input type="checkbox" id="sEnc"> 开启</label>
      <input type="password" id="sEncPass" placeholder="加密口令（忘了就解不开）" style="flex:1;min-width:0" autocomplete="off">
    </div>
    <div class="shint">
      <b>坚果云怎么填：</b>网页端右上角 <b>账户信息 → 安全选项 → 添加应用密码</b>，把生成的那串密码填到「应用密码」，
      账号填登录邮箱。别用登录密码，应用密码可随时单独吊销。<br>
      <b>同步规则：</b>只在点「立即同步」时联网，打开页面和改数据都不会自动上传。云端一个 JSON 文件，未变动时不下载（304 跳过），
      变动时按记录逐条合并：两台设备各自新增的记录都会保留，删除也会同步。<br>
      <b>隐私：</b>账号密码只存本机（<code>chrome.storage.local</code>），不经过任何第三方服务器。
    </div>
  </div>
  <div class="sfoot"><span class="smsg" id="sMsg"></span>
    <button type="button" class="btn" id="sTest">测试连接</button>
    <button type="button" class="btn" id="sSave">保存</button>
    <button type="button" class="btn primary" id="sSync">立即同步</button>
  </div>
</div>`;
  document.body.appendChild(mask);

  var banner = document.createElement("div");
  banner.className = "sbanner";
  banner.innerHTML = '<span id="sbText">云端数据已更新</span><button type="button" id="sbGo">刷新</button>';
  document.body.appendChild(banner);

  /* ---------------- 状态渲染 ---------------- */
  function fmtTime(ts) {
    if (!ts) return "从未同步";
    var d = new Date(ts);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function setMsg(text, kind) {
    var m = el("sMsg");
    if (!m) return;
    m.textContent = text || "";
    m.className = "smsg" + (kind ? " " + kind : "");
  }
  function paint() {
    var cfg = state.cfg, meta = state.meta || {};
    var stEl = el("sState");
    if (!cfg || !cfg.hasPass) {
      stEl.textContent = "未配置";
    } else if (meta.error) {
      stEl.textContent = "同步失败";
    } else if (!meta.lastAt) {
      stEl.textContent = "待首次同步";
    } else {
      stEl.textContent = "上次 " + fmtTime(meta.lastAt);
    }
    btn.classList.toggle("has-err", !!(meta.error && cfg && cfg.hasPass));
    btn.title = meta.error
      ? "同步失败：" + meta.error
      : (meta.lastAt ? "上次同步 " + fmtTime(meta.lastAt) : "坚果云 WebDAV 云同步");

    if (cfg) {
      el("sBase").value = cfg.base || "";
      el("sUser").value = cfg.user || "";
      el("sPath").value = cfg.path || "";
      el("sEnc").checked = !!cfg.enc;
      el("sPass").placeholder = cfg.hasPass ? "已保存（留空不改）" : "在坚果云「账户信息 → 安全选项」添加应用密码";
      el("sPass").value = "";
      el("sEncPass").placeholder = cfg.hasEncPass ? "已保存（留空不改）" : "加密口令（忘了就解不开）";
      el("sEncPass").value = "";
    }
    if (meta.error) setMsg("上次同步失败：" + meta.error, "err");
    else if (meta.lastAt) {
      setMsg("上次同步 " + fmtTime(meta.lastAt) +
        (meta.count != null ? " · 云端 " + meta.count + " 条记录" : ""), "ok");
    } else if (cfg && cfg.hasPass) {
      setMsg("已填好账号，点「立即同步」跑第一次", "");
    }
  }

  async function refresh() {
    var r = await send("sync:status");
    if (r && r.ok) {
      state.cfg = r.cfg;
      state.meta = r.meta || {};
      paint();
    }
  }

  function formCfg() {
    var c = {
      base: el("sBase").value.trim(),
      user: el("sUser").value.trim(),
      path: el("sPath").value.trim(),
      enc: el("sEnc").checked
    };
    var p = el("sPass").value;
    if (p) c.pass = p;
    var ep = el("sEncPass").value;
    if (ep) c.encPass = ep;
    return c;
  }

  function open() {
    mask.classList.add("on");
    refresh();
  }
  function close() { mask.classList.remove("on"); }

  btn.addEventListener("click", open);
  el("sClose").addEventListener("click", close);
  mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && mask.classList.contains("on")) close();
  });

  /* 非坚果云地址需要额外授权（host_permissions 只预置了坚果云） */
  async function ensureHost(base) {
    var origin;
    try { origin = new URL(base).origin + "/*"; } catch (_) { return true; }
    if (origin === "https://dav.jianguoyun.com/*") return true;
    try {
      var has = await chrome.permissions.contains({ origins: [origin] });
      if (has) return true;
      return await chrome.permissions.request({ origins: [origin] });
    } catch (_) { return true; }
  }

  var working = false;
  async function withBusy(text, fn) {
    if (working) return;
    working = true;
    var btns = ["sTest", "sSave", "sSync"].map(el);
    btns.forEach(function (b) { if (b) b.disabled = true; });
    setMsg(text + "…", "");
    try { await fn(); } finally {
      working = false;
      btns.forEach(function (b) { if (b) b.disabled = false; });
    }
  }

  el("sTest").addEventListener("click", function () {
    withBusy("正在连接", async function () {
      var ok = await ensureHost(el("sBase").value.trim() || "https://dav.jianguoyun.com/dav/");
      if (!ok) { setMsg("没有拿到该域名的访问授权", "err"); return; }
      var r = await send("sync:test", { cfg: formCfg() });
      setMsg(r.msg || (r.ok ? "连接正常" : "连接失败"), r.ok ? "ok" : "err");
    });
  });

  el("sSave").addEventListener("click", function () {
    withBusy("正在保存", async function () {
      var c = formCfg();
      await ensureHost(c.base || "https://dav.jianguoyun.com/dav/");
      var r = await send("sync:save", { cfg: c });
      if (r.ok) {
        state.cfg = r.cfg;
        paint();
        setMsg("已保存", "ok");
      } else {
        setMsg(r.msg || "保存失败", "err");
      }
    });
  });

  el("sSync").addEventListener("click", function () {
    withBusy("正在同步", async function () {
      var c = formCfg();
      var saved = await send("sync:save", { cfg: c });
      if (!saved.ok) { setMsg(saved.msg || "保存失败", "err"); return; }
      state.cfg = saved.cfg;
      var r = await send("sync:now", { reason: "manual" });
      if (r && r.ok) {
        state.meta = r.meta || {};
        paint();
        setMsg(r.msg || "同步完成", "ok");
        if (r.changed) showBanner("已合并云端更新");
      } else {
        setMsg((r && r.msg) || "同步失败", "err");
        await refresh();
      }
    });
  });

  /* ---------------- 云端有更新：请用户刷新 ---------------- */
  function showBanner(text) {
    el("sbText").textContent = text || "云端数据已更新";
    banner.classList.add("on");
  }
  el("sbGo").addEventListener("click", function () {
    banner.classList.remove("on");
    location.reload();
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.type === "sync:applied") {
      showBanner("云端数据已更新（" + (msg.count || 0) + " 条记录），刷新后生效");
      refresh();
    }
  });

  /* ---------------- 启动：只显示上次同步状态，不联网 ---------------- */
  refresh();
})();
