/* 生成扩展图标：用 Chromium 把 SVG 渲染成 16/48/128 的 PNG。
 * 用法：node build/icons.js
 * 说明：依赖本地 playwright-core 与 Chromium（路径见下）。图标只是外观、不影响功能，
 *       环境里没有这两个依赖时，用任意工具把同样的 SVG 导出成三种尺寸的 PNG 放到
 *       extension/icons/ 即可，不必强跑这个脚本。
 */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Users/1688/AppData/Local/Temp/domtest/node_modules/playwright-core");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "extension", "icons");
const CHROME = "C:/Users/1688/AppData/Local/ms-playwright/chromium-1254/chrome-win64/chrome.exe";

const svg = (size) => {
  const s = size;
  const r = s * 0.22;
  const pad = s * 0.2;
  const barW = s * 0.13;
  const gap = s * 0.075;
  const baseY = s - pad;
  const bars = [
    { h: s * 0.3 },
    { h: s * 0.48 },
    { h: s * 0.66 },
  ];
  let x = pad;
  let rects = "";
  for (const b of bars) {
    rects += `<rect x="${x.toFixed(2)}" y="${(baseY - b.h).toFixed(2)}" width="${barW.toFixed(2)}" height="${b.h.toFixed(2)}" rx="${(barW / 2.6).toFixed(2)}" fill="#fff" opacity="0.92"/>`;
    x += barW + gap;
  }
  const lw = Math.max(1.2, s * 0.055);
  const line = `M${(pad + barW / 2).toFixed(2)},${(baseY - s * 0.3 - s * 0.09).toFixed(2)} L${(pad + barW + gap + barW / 2).toFixed(2)},${(baseY - s * 0.48 - s * 0.06).toFixed(2)} L${(pad + (barW + gap) * 2 + barW / 2).toFixed(2)},${(baseY - s * 0.66 - s * 0.1).toFixed(2)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2f81f7"/><stop offset="1" stop-color="#0a84ff"/>
  </linearGradient></defs>
  <rect width="${s}" height="${s}" rx="${r}" fill="url(#g)"/>
  ${rects}
  <path d="${line}" fill="none" stroke="#ffe066" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 1 });
  for (const size of [16, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`,
      { waitUntil: "load" }
    );
    await page.screenshot({
      path: path.join(OUT, `icon${size}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    console.log("icon" + size + ".png");
  }
  await browser.close();
})();
