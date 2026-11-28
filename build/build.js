#!/usr/bin/env node
/* 构建脚本：把单文件 index.html 拆成 Chrome 扩展（Manifest V3）可加载的目录。
 *
 * 用法：node build/build.js
 * 输入：../index.html（唯一源码，仍然是可直接双击打开的单文件版本）
 * 输出：../extension/{app.html, app.js, store.js, manifest 版本同步}
 *
 * 为什么要拆：
 *   Chrome 扩展页面的 CSP 禁止内联脚本，所以 index.html 里的 <script> 必须外置成 app.js，
 *   内联的 onclick / onerror 必须换成 data-* 属性 + 事件委托。
 * 为什么保留 index.html 为源码：
 *   单文件版本零依赖、可直接发文件给别人，维护一份代码避免两套逻辑漂移。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "index.html");
const OUT = path.join(ROOT, "extension");

const ts = () => new Date().toISOString().slice(0, 16).replace("T", " ");

function must(str, find, rep, expect) {
  const n = str.split(find).length - 1;
  if (n !== expect) {
    throw new Error(
      `替换失败，期望 ${expect} 处、实际 ${n} 处：${find.slice(0, 80)}`
    );
  }
  return str.split(find).join(rep);
}

/* 统一成 LF：源码是 CRLF，先归一化，替换规则才稳定 */
const html = fs.readFileSync(SRC, "utf8").replace(/\r\n/g, "\n");

/* ---------- 1. 版本号：以 index.html 的 #verBadge 为唯一来源 ---------- */
const verMatch = html.match(/id="verBadge"[^>]*>\s*(v[\d.]+)\s*</);
if (!verMatch) throw new Error("未找到 #verBadge 版本号");
const VERSION = verMatch[1].replace(/^v/, "");

/* ---------- 2. 切分 head / body / script ---------- */
const headEnd = html.indexOf("</head>");
const SCRIPT_OPEN = '\n<script>\n"use strict";';
const scriptOpenAt = html.indexOf(SCRIPT_OPEN);
if (headEnd < 0 || scriptOpenAt < 0) throw new Error("结构切分失败：找不到 </head> 或主脚本");
const bodyStart = html.indexOf("<body>");
if (bodyStart < 0) throw new Error("结构切分失败：找不到 <body>");

const head = html.slice(0, headEnd);
let markup = html.slice(bodyStart, scriptOpenAt);
const scriptEndAt = html.lastIndexOf("</script>");
let script = html.slice(scriptOpenAt + SCRIPT_OPEN.length, scriptEndAt);

/* ---------- 3. 标记转换：内联事件 → data-* ---------- */
markup = must(markup, 'onclick="hideColPop()"', 'data-act="hideColPop"', 1);
markup = must(markup, `onclick="setCols('default')"`, 'data-act="setCols" data-arg="default"', 1);
markup = must(markup, `onclick="setCols('all')"`, 'data-act="setCols" data-arg="all"', 1);
markup = must(markup, 'onclick="closeDrawer()"', 'data-act="closeDrawer"', 2);
markup = must(markup, `onclick="this.style.display='none'"`, 'data-act="hideSelf"', 1);
/* 内嵌 JSON 数据块：<script type="application/json"> 换成隐藏 div，读法不变（textContent） */
markup = must(markup, '<script type="application/json" id="seedJson">', '<div id="seedJson" hidden>', 1);
markup = must(markup, '</script>', '</div>', 1);

/* ---------- 4. 脚本转换 ---------- */
/* 4.1 图片加载失败：onerror → data-imgfail，由全局捕获监听统一处理 */
script = must(
  script,
  `onerror="this.outerHTML='<div class=\\\\'thumb-ph\\\\'>无图</div>'"`,
  'data-imgfail="thumb"',
  2
);
script = must(
  script,
  `onerror="this.outerHTML='<div class=&quot;pw-ph&quot;>无图</div>'"`,
  'data-imgfail="pw"',
  1
);
script = must(script, `onerror="this.style.display='none'"`, 'data-imgfail="hide"', 1);

/* 4.2 存储：localStorage → ST（异步后端，内存缓存 + 写回 chrome.storage.local） */
const nGet = script.split("localStorage.getItem(").length - 1;
const nSet = script.split("localStorage.setItem(").length - 1;
const nDel = script.split("localStorage.removeItem(").length - 1;
if (nGet !== 11 || nSet !== 15 || nDel !== 0) {
  throw new Error(`localStorage 调用数量变了（get=${nGet} set=${nSet} del=${nDel}），请检查存储适配层`);
}
script = script.split("localStorage.getItem(").join("ST.get(");
script = script.split("localStorage.setItem(").join("ST.set(");

/* 4.3 包一层异步启动：先把 chrome.storage.local 的缓存灌进内存，再跑原有初始化 */
const BANNER = `/* 由 build/build.js 从 index.html 自动生成，请勿直接修改本文件。
 *  改逻辑请改 index.html，然后执行：node build/build.js
 *  生成时间：${ts()}   版本：${VERSION}
 */
"use strict";

(async function boot() {
  if (!window.ST) throw new Error("store.js 未加载");
  await ST.load();   // 本地存储整块读进内存，后续读写同步完成

  /* ================= 以下为 index.html 原内联脚本 ================= */
${script}
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
`;

/* ---------- 5. 输出 app.html ---------- */
const headOut =
  head.replace(
    /<meta name="viewport"[^>]*>/,
    (m) => m + '\n<link rel="icon" href="icons/icon48.png">'
  ) + "\n</head>";

const appHtml = `${headOut}\n${markup.trimEnd()}
<script src="store.js"></script>
<script src="app.js"></script>
<script src="sync.js"></script>
<script src="import.js"></script>
</body>
</html>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "app.html"), appHtml, "utf8");
fs.writeFileSync(path.join(OUT, "app.js"), BANNER, "utf8");

/* ---------- 6. manifest 版本跟随 index.html ---------- */
const mfPath = path.join(OUT, "manifest.json");
if (fs.existsSync(mfPath)) {
  const raw = fs.readFileSync(mfPath, "utf8");
  const mf = JSON.parse(raw);
  if (mf.version !== VERSION) {
    mf.version = VERSION;
    fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2) + "\n", "utf8");
    console.log(`manifest 版本已同步为 ${VERSION}`);
  }
}

/* ---------- 7. 自检 ---------- */
const checks = [
  [/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(appHtml), "app.html 仍含内联 <script>"],
  [/\son[a-z]+\s*=\s*["']/i.test(appHtml), "app.html 仍含内联事件属性"],
  [/\son[a-z]+\s*=\s*["']/i.test(script), "app.js 仍含内联事件属性"],
  [/\beval\s*\(|new\s+Function\s*\(/.test(script), "app.js 含动态执行代码"],
  [script.includes("localStorage."), "app.js 仍有未适配的 localStorage 调用"],
];
for (const [bad, msg] of checks) {
  if (bad) throw new Error("自检未通过：" + msg);
}

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + "KB";
console.log(`构建完成 → extension/  (v${VERSION})`);
console.log(`  app.html  ${kb(path.join(OUT, "app.html"))}`);
console.log(`  app.js    ${kb(path.join(OUT, "app.js"))}`);
