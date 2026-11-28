/* 存储适配层（扩展版本）
 * 原程序的读写是同步的 localStorage，扩展里换成异步的 chrome.storage.local：
 *   - load() 在启动时把全部键整块读进内存，之后 get() 同步返回，业务代码零改动；
 *   - set() 先写内存再异步落盘（120ms 防抖合并），页面里不会因为等待 IO 卡顿；
 *   - 没有 chrome.storage 时自动回退 localStorage，方便直接用浏览器打开 app.html 调试。
 * 以字符串存值，和 localStorage 语义一致（业务代码自己 JSON.parse）。
 */
(function () {
  "use strict";
  var mem = Object.create(null);        // 内存缓存：键 -> 字符串
  var dirty = Object.create(null);      // 待写入
  var removed = Object.create(null);    // 待删除
  var timer = null;
  var flushing = null;
  var useChrome = !!(window.chrome && chrome.storage && chrome.storage.local);

  function emit() {
    try { window.dispatchEvent(new CustomEvent("st:flushed")); } catch (_) {}
  }

  function flush() {
    if (flushing) return flushing;
    if (timer) { clearTimeout(timer); timer = null; }
    var setObj = {}, delKeys = [];
    for (var k in dirty) setObj[k] = dirty[k];
    for (var d in removed) delKeys.push(d);
    dirty = Object.create(null);
    removed = Object.create(null);
    if (!Object.keys(setObj).length && !delKeys.length) return Promise.resolve();

    if (!useChrome) {
      try {
        for (var i = 0; i < delKeys.length; i++) localStorage.removeItem(delKeys[i]);
        for (var j in setObj) localStorage.setItem(j, setObj[j]);
      } catch (e) { console.warn("[ST] 本地存储写入失败", e); }
      emit();
      return Promise.resolve();
    }

    var p = Promise.resolve();
    if (Object.keys(setObj).length) p = p.then(function () { return chrome.storage.local.set(setObj); });
    if (delKeys.length) p = p.then(function () { return chrome.storage.local.remove(delKeys); });
    flushing = p
      .catch(function (e) { console.warn("[ST] chrome.storage 写入失败", e); })
      .then(function () { flushing = null; emit(); });
    return flushing;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; flush(); }, 120);
  }

  window.ST = {
    backend: useChrome ? "chrome" : "local",
    load: function () {
      if (!useChrome) {
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            var v = localStorage.getItem(k);
            if (typeof v === "string") mem[k] = v;
          }
        } catch (_) {}
        return Promise.resolve();
      }
      return chrome.storage.local.get(null).then(function (kv) {
        for (var k in kv) if (typeof kv[k] === "string") mem[k] = kv[k];
      }).catch(function (e) { console.warn("[ST] 读取本地存储失败", e); });
    },
    get: function (k) {
      return (k in mem) ? mem[k] : null;
    },
    set: function (k, v) {
      var s = String(v);
      mem[k] = s;
      delete removed[k];
      dirty[k] = s;
      schedule();
    },
    del: function (k) {
      delete mem[k];
      delete dirty[k];
      removed[k] = 1;
      schedule();
    },
    keys: function () { return Object.keys(mem); },
    flush: flush
  };
})();
