/* 聚水潭利润报表接口代理（content script，只跑在 erp321 页面）
 *
 * 为什么必须放在页面里发请求：
 *   接口是 https://pf.erp321.com/WebApi/PF/*，鉴权靠 ss.erp321.com 登录后的 Cookie，
 *   跨域还受服务端 CORS 白名单约束。用页面身份发，Cookie 与 CORS 都天然满足；
 *   在后台 service worker 里发则可能因 SameSite 丢 Cookie，直接被判未登录。
 *
 * 只做转发：不读 DOM、不改页面、不注入任何界面。
 */
(function () {
  "use strict";
  /* 版本号用于判断「已开的旧标签页里跑的是不是这一版」。
     重复注入时先摘掉旧监听再挂新的，否则两个版本会抢着回消息，旧的那个先答就白改了。 */
  var JST_VER = "3.1";
  window.__adledgerJst = JST_VER;

  var BASE = "https://pf.erp321.com/WebApi/PF/";
  var UV = "?uvalue=pfcweb_profit-report.goods-profit";

  function call(path, data, page) {
    var body = {
      uid: "", coid: "", ip: "",
      page: page || { currentPage: 1, pageSize: 25 },
      data: data || {},
      ssProjectType: "SS",
      ssClientType: "Web"
    };
    return fetch(BASE + path + UV, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error(path + " HTTP " + r.status + " " + t.slice(0, 160));
        var j;
        try { j = JSON.parse(t); } catch (e) {
          throw new Error(path + " 返回的不是 JSON（多半是登录已过期，请先在浏览器里登录聚水潭）");
        }
        if (j && typeof j.code === "number" && j.code !== 0) {
          throw new Error(path + " code=" + j.code + " " + (j.msg || ""));
        }
        return j;
      });
    });
  }

  /* ---------- 取导出文件 ----------
   * 服务端返回下载地址时文件通常还在生成，立刻 GET 会拿到 404 或提示页，所以按递增间隔重试。
   * 为什么优先在页面里取：doc.erp321.com 与 ss.erp321.com 同属 erp321.com，
   * 从页面发请求算 same-site，Lax Cookie 会带上；从扩展后台发算 cross-site，Cookie 可能被丢。
   */
  function b64(u8) {
    var s = "", CH = 8192;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    }
    return btoa(s);
  }

  /* 诊断用：前几十字节的 hex + 能读的文本，一眼看出拿到的是什么 */
  function head(u8) {
    try {
      var hex = "", i;
      for (i = 0; i < Math.min(24, u8.length); i++) hex += (u8[i] < 16 ? "0" : "") + u8[i].toString(16);
      var t = "";
      try { t = new TextDecoder("utf-8").decode(u8.subarray(0, Math.min(200, u8.length))); } catch (e2) {}
      t = String(t || "").replace(/\s+/g, " ").trim();
      return hex + (t ? " / " + t.slice(0, 80) : "");
    } catch (e) { return ""; }
  }

  /* 按内容判断到底是哪种文件，而不是假定它是 xlsx。
     实测导出地址返回的 content-type 是 application/octet-stream，
     服务器的附件名/类型都不可靠，只能看字节：zip(xlsx) / OLE(xls) / 文本(csv)。 */
  function sniff(u8) {
    var n = Math.min(1024, u8.length);
    for (var i = 0; i < n - 3; i++) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x03 && u8[i + 3] === 0x04) {
        return { kind: "xlsx", at: i };     /* 前面偶尔有 BOM 之类的前缀，跳过即可 */
      }
    }
    if (u8.length > 4 && u8[0] === 0xd0 && u8[1] === 0xcf) return { kind: "xls", at: 0 };
    var t = "";
    try { t = new TextDecoder("utf-8").decode(u8.subarray(0, Math.min(4096, u8.length))); } catch (e) {}
    if (t) {
      if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
      var ctrl = (t.match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length;
      if (ctrl <= 2 && (t.indexOf(",") >= 0 || t.indexOf("\t") >= 0 || /店铺|日期|商品|利润/.test(t))) {
        return { kind: "csv", at: 0, text: t };
      }
    }
    return null;
  }

  function diag(last) {
    if (!last) return "没有拿到文件";
    var b = [];
    if (last.status) b.push("HTTP " + last.status);
    if (last.ct) b.push(String(last.ct).split(";")[0]);
    var h = String(last.head || "");
    if (/html/i.test(last.ct || "") || /^\s*<(!doctype|html)/i.test(h)) b.push("返回的是网页，多半是登录已过期");
    else if (h) b.push("内容开头：" + h.slice(0, 150));
    return b.join("，") || "未知原因";
  }

  function fetchFile(url) {
    var gaps = [0, 700, 1200, 2000, 3000, 5000, 7000];
    var i = 0, last = null;
    function next() {
      if (i >= gaps.length) {
        var e = new Error(diag(last));
        e.diag = diag(last);
        return Promise.reject(e);
      }
      var w = gaps[i++];
      return new Promise(function (res) { setTimeout(res, w); }).then(function () {
        return fetch(url, { credentials: "include", cache: "no-store" });
      }).then(function (r) {
        var ct = "";
        try { ct = r.headers.get("content-type") || ""; } catch (e2) {}
        return r.arrayBuffer().then(function (ab) {
          var u8 = new Uint8Array(ab);
          if (!u8.length) {
            last = { status: r.status, ct: ct, head: "内容为空（0 字节），文件可能还在生成" };
            return next();
          }
          var sn = sniff(u8);
          if (sn) {
            var body = sn.at ? u8.subarray(sn.at) : u8;
            return { b64: b64(body), ct: ct, size: body.length, kind: sn.kind };
          }
          last = { status: r.status, ct: ct, head: head(u8) };
          return next();
        });
      }, function (e) {
        last = { status: 0, ct: "", head: "请求失败：" + String((e && e.message) || e) };
        return next();
      });
    }
    return next();
  }

  /* 实在取不回来时，让浏览器自己下：浏览器下载栈走的是顶层导航，Cookie / Referer 天然正确 */
  function kickDownload(url) {
    try {
      var a = document.createElement("a");
      a.href = url;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { a.remove(); } catch (e) {} }, 1500);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: String((e && e.message) || e) };
    }
  }

  try {
    var fn = function (m, _s, resp) {
      if (m && m.type === "jst:file") {
        fetchFile(m.url).then(function (r) {
          resp({ ok: true, b64: r.b64, ct: r.ct, size: r.size, kind: r.kind });
        }).catch(function (e) {
          resp({ ok: false, msg: String((e && e.message) || e) });
        });
        return true;
      }
      if (m && m.type === "jst:kick") {
        resp(kickDownload(m.url));
        return;
      }
      if (!m || m.type !== "jst:api") return;
      call(m.path, m.data, m.page).then(function (j) {
        resp({ ok: true, json: j });
      }).catch(function (e) {
        resp({ ok: false, msg: String((e && e.message) || e) });
      });
      return true;
    };
    /* 重复注入：旧监听先摘下，避免两个版本抢答 */
    try { if (window.__adledgerJstFn) chrome.runtime.onMessage.removeListener(window.__adledgerJstFn); } catch (e2) {}
    window.__adledgerJstFn = fn;
    chrome.runtime.onMessage.addListener(fn);
  } catch (e) {}
})();
