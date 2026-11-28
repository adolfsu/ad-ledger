/* 主世界网络采集（配合 probe.js 使用）
 *
 * 为什么单独一份：内容脚本跑在隔离世界，改写 window.fetch / XMLHttpRequest
 * 只影响它自己那份副本，页面发的请求一条都拦不到（第一轮取证就是这个结果：
 * 只有点击、没有请求）。所以这一份用 manifest 的 "world": "MAIN" 注入到页面
 * 自己的 JS 环境里，钩子才真正生效。
 *
 * 主世界拿不到 chrome.*，因此只负责记录，用 postMessage 交给隔离世界的 probe.js，
 * 再由它转给后台。这里不读 cookie、不改页面数据、不做任何业务请求。
 */
"use strict";

(function () {
  if (window.__jstProbeMain) return;
  window.__jstProbeMain = true;

  var CAP = 300;
  var count = 0;
  /* 这几个接口是「一键」的全部依赖，请求体/响应都要完整留档 */
  var DEEP = /(GetShopDrop|GetPFSkuV3List|ExprotPfSkuV3PfNew|GetSearchConditions|GetUserPreference)/i;
  function deep(u) { return DEEP.test(String(u || "")); }

  function cut(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function mask(s) {
    return String(s == null ? "" : s)
      .replace(/((?:token|ticket|sign|signature|session|sessionid|sid|password|pwd|cookie|authorization|access_key|secret)[^=&\s"']{0,12}[=:]\s*)([^&\s"',}]{4,})/gi, "$1***")
      .replace(/\b[0-9a-f]{32,}\b/gi, function (m) { return m.slice(0, 6) + "***"; });
  }

  function absUrl(u) {
    try { return new URL(String(u), location.href).href; } catch (e) { return String(u || ""); }
  }

  function cleanUrl(u) {
    var s = absUrl(u).replace(/([?&](?:token|ticket|sign|signature|session|sid|password|pwd|access_key|secret)=)([^&]*)/gi, "$1***");
    return cut(s, 420);
  }

  function bodySample(b, max) {
    max = max || 900;
    if (b == null || b === "") return "";
    try {
      if (typeof b === "string") return cut(mask(b), max);
      if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) return cut(mask(b.toString()), max);
      if (typeof FormData !== "undefined" && b instanceof FormData) {
        var arr = [];
        b.forEach(function (v, k) {
          if (typeof v === "string") arr.push(k + "=" + cut(mask(v), 60));
          else arr.push(k + "=[file]");
        });
        return cut(arr.join("&"), max);
      }
      if (typeof Blob !== "undefined" && b instanceof Blob) return "[blob " + b.size + "B]";
      return cut(mask(JSON.stringify(b)), max);
    } catch (e) { return "[" + typeof b + "]"; }
  }

  function skip(u) {
    return !u || /^(data|blob|chrome-extension):/i.test(u) ||
      /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|mp4)(\?|#|$)/i.test(u);
  }

  function post(rec) {
    if (count++ > CAP) return;
    try { window.postMessage({ __jstProbeNet: 1, rec: rec }, "*"); } catch (e) {}
  }

  /* ---------- fetch ---------- */
  if (window.fetch) {
    var OF = window.fetch;
    window.fetch = function (input, init) {
      var u = typeof input === "string" ? input : (input && input.url) || "";
      var m = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      var body = init && init.body;
      var t0 = Date.now();
      var pr = OF.apply(this, arguments);
      try {
        pr.then(function (res) {
          if (skip(u)) return;
          var ct = "";
          try { ct = res.headers.get("content-type") || ""; } catch (e) {}
          var dp = deep(u);
          var base = {
            kind: "fetch", method: m, url: cleanUrl(u), req: bodySample(body, dp ? 8000 : 900),
            status: res.status, ct: cut(ct, 60), ms: Date.now() - t0
          };
          try {
            res.clone().text().then(function (t) {
              base.res = cut(mask(t), dp ? 8000 : 600);
              post(base);
            }).catch(function () { post(base); });
          } catch (e) { post(base); }
        }).catch(function () {});
      } catch (e) {}
      return pr;
    };
  }

  /* ---------- XMLHttpRequest ---------- */
  try {
    var XO = XMLHttpRequest.prototype.open;
    var XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { this.__jstProbe = { m: String(m || "GET").toUpperCase(), u: u, t: Date.now() }; } catch (e) {}
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      var x = this;
      try {
        var p = x.__jstProbe || {};
        x.addEventListener("loadend", function () {
          try {
            if (skip(p.u)) return;
            var ct = "";
            try { ct = x.getResponseHeader("content-type") || ""; } catch (e) {}
            var txt = "";
            try {
              if (!x.responseType || x.responseType === "text") txt = String(x.responseText || "");
            } catch (e) {}
            var dp = deep(p.u);
            post({
              kind: "xhr", method: p.m, url: cleanUrl(p.u), req: bodySample(body, dp ? 8000 : 900),
              status: x.status, ct: cut(ct, 60), ms: Date.now() - (p.t || Date.now()),
              res: cut(mask(txt), dp ? 8000 : 600)
            });
          } catch (e) {}
        });
      } catch (e) {}
      return XS.apply(this, arguments);
    };
  } catch (e) {}

  /* ---------- 表单提交 / 新窗口 / beacon ---------- */
  try {
    var OS = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      try {
        var f = this;
        post({
          kind: "form", method: (f.method || "get").toUpperCase(), url: cleanUrl(f.action || location.href),
          req: Array.prototype.map.call(f.elements, function (el) {
            return (el.name || el.id || el.tagName.toLowerCase()) + "=" + cut(mask(el.value || ""), 60);
          }).slice(0, 40).join("&")
        });
      } catch (e) {}
      return OS.apply(this, arguments);
    };
  } catch (e) {}

  try {
    var OO = window.open;
    window.open = function (u) {
      try { if (u) post({ kind: "open", url: cleanUrl(u) }); } catch (e) {}
      return OO.apply(this, arguments);
    };
  } catch (e) {}

  /* 握手：让界面脚本知道主世界这半边真的加载了。没有这条，就是扩展没重载或加载了别的副本 */
  function hello() {
    post({ kind: "hello", v: 3, href: location.href });
  }
  hello();
  try { document.addEventListener("DOMContentLoaded", hello, { once: true }); } catch (e) {}
  setTimeout(hello, 1200);

  try {
    if (navigator.sendBeacon) {
      var OB = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (u, data) {
        try { post({ kind: "beacon", url: cleanUrl(u), req: bodySample(data) }); } catch (e) {}
        return OB(u, data);
      };
    }
  } catch (e) {}
})();
