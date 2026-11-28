# 项目维护约定

- 主页面为 `index.html`。
- 用户要求：后续修改项目时，适时同步更新版本号，方便区分版本。每次完成并交付一组用户可见的修改时更新一次；同一次任务内的中间修复不逐次递增。
- 页面版本以 `index.html` 中 `#verBadge` 的文字为准。修复、排版和小幅体验调整递增补丁版本（如 v1.4.0 → v1.4.1）；新增功能或较大界面升级递增次版本（如 v1.4.1 → v1.5.0）；不兼容的大版本变更再递增主版本。
- 更新版本时，同步将徽章的 `title` 改为实际交付日期（Asia/Shanghai，YYYY-MM-DD）及简短更新说明，并在 `CHANGELOG.md` 顶部记录本版改动。
- 不要把页面版本号与 JSON 备份中的 `version` 混用。后者是数据格式版本，仅在备份结构或兼容策略需要升级时单独维护。
- 交付前核对版本徽章与更新记录一致，并在回复中告知用户当前版本号。

## 插件（v2.0.0 起）

- `index.html` 仍是唯一源码：功能逻辑、样式只在它里面改；`extension/` 是构建产物。
- 改完 `index.html` 必须执行 `node build/build.js`（Chrome 扩展页禁止内联脚本，构建负责把内联 `<script>` 拆成 `app.js`、把 `onclick`/`onerror` 换成 `data-*` + 事件委托、把 `localStorage` 换成 `store.js` 的 `ST`）。
- 构建脚本带自检：内联脚本、内联事件、`eval`、残留 `localStorage` 任一命中都会报错退出；替换数量对不上也会报错，别绕过。
- `extension/manifest.json` 的 `version` 由构建自动跟随 `#verBadge`，不要手改。
- `extension/bg.js`（云同步后台 + 下载监听）、`extension/sync.js`（同步面板）、`extension/import.js`（导出文件提示与取文件）是插件独有文件，不参与构建、可以直接改；改完不需要重新构建。
- 抓取回的文件**不能假定是 xlsx**：`jst.js` 的 `sniff()` 与 `bg.js` 的 `jstSniff()` 必须保持同一套判定（zip→xlsx / OLE→xls / 文本→csv），改一处就要改另一处；导出地址的 content-type 实测是 `application/octet-stream`，不可信。
- `bg.js` 的 `jstPull()` 是「文件取不回来」时的兜底：按 `GetPFSkuV3List` 分页拉数据、用响应里的 `fldHeads[].title` 当表头。它靠「元素里含有多少个列字段」自适应找数据数组，不写死 `list/rows/items` 这些字段名。
- `extension/jst.js` 里的 `JST_VER` 改了要一起改注释里的用法：它只在重复注入时用来判断新旧，实际靠 `removeListener` 替换旧监听，所以改逻辑不必动版本号，但**新增消息类型时必须保证幂等**（重注入后只留一个监听）。
- `extension/jst.js` 是「一键抓取」的接口代理（content script，只跑 `erp321.com` 顶层页）：在页面里发 `pf.erp321.com/WebApi/PF/*` 请求，带上登录 Cookie 并绕开 CORS 限制；`bg.js` 里 `jstShops()` / `jstRun()` 负责开页、编排、下载、落盘，页面侧对应 `jst:*` 消息与 `#jstModal` 面板。**接口条件结构是照抄页面真实请求的（字段顺序也一致），少一个字段后端就可能判非法，改之前先对照 `规划-一键筛选导出.md` 里的取证样本。**
- 构建脚本里 `localStorage` 调用数断言（`get=11 set=15 del=0`）是防漂移的：新增一处 `localStorage.getItem/setItem` 就要同步改这个数字。
- `extension/probe.js` 是阶段 0 的临时诊断采集（`manifest.json` 里以 content script 注入，`all_frames`），`bg.js` 里有配套的 `probe:*` 消息与 `storage.session` 暂存。它是临时工具，正式功能落地后整块删除（连同 manifest 的 `content_scripts`）。
- 页面里的 `window.__imp = { file, buffer }` 是给 `import.js` 调用的导入入口，改导入逻辑时保持这个签名。
- Excel 解析（`impReadXlsx` 等）在 `index.html` 里，靠浏览器原生 `DecompressionStream` 解 ZIP，不引入第三方库；单文件版同样可用。
- 云同步数据键：`adlog_records_v2` / `adlog_shops_v1` / `adlog_linkimgs_v1` / `plb_prefs_v1`，配置与状态键：`adledger_sync_cfg_v1` / `adledger_sync_meta_v1`。改同步格式时升 `syncFormat` 并保留向后兼容。
- 调整计划存在 `adlog_plans_v1`（数组，字段与调整记录相同但没有 `time`），**不在云同步键里**，只在 JSON 备份的 `plans` 字段里一起走。计划 → 记录的转换入口是 `planConfirm()`：复制全部字段、`time` 取确认时刻、`id` 新生成、附 `planId` 指回来源计划（同时删掉 `src`）；转换后计划从数组里删除。计划不参与 `recList`，所以台账、有效/无效判定、导出记录都不受它影响。
- 写计划只有两个界面入口，但**只有一个存储出口 `planAdd(data, extra)`**：弹窗里的「＋ 新建计划」和记一笔里的「＋ 加入清单」。任何新增的计划来源都要走它，否则字段补齐、店铺落库、计数刷新会漏。`planAdd` 内部用 `planPayload()` 摘掉 `time`，这是「计划不记时间」的唯一实现点。「加入清单」产生的计划带 `src:"rec"`，列表上显示「来自记一笔」；`planConfirm()` 必须删掉它，别让来源标记污染记录。
- 「＋ 加入清单」（`#rmToList`）只在 `formMode==="rec" && !editingId` 时显示：编辑已有记录是既成事实，不能退回待办；计划编辑模式下它也必须隐藏，保存计划走 `#rmSave`。
- 计划导出 Excel 是**手写 xlsx**（`plXlsxBytes()` + `plZip()` + `plCrc32()`），不引第三方库：ZIP 用 store 方式（不压缩），6 个部件（`[Content_Types].xml`、`_rels/.rels`、`xl/workbook.xml`、`xl/_rels/workbook.xml.rels`、`xl/styles.xml`、`xl/worksheets/sheet1.xml`）。改样式时 `styles.xml` 的 `cellXfs` 索引要和 `plSheetXml()` 里的 `s=1/2/3` 对齐（1 表头、2 正文、3 斑马纹）。表头列定义在 `PL_COLS`，改表头只改这一处，列宽跟着走。数据行不写 `ht`，交给 Excel 自动行高，否则长文本会被截断。
- 复制链接 ID 统一走全局 `document` 捕获阶段的 `.cpy[data-cpy]` 监听（`copyText`），新增复制入口只要输出 `<span class="cpy" data-cpy="值">⧉</span>`，不要另写 click handler；空值不要输出这个 span。
- 导入的表格：正文在 IndexedDB（`adlog_store` / store `kv` / key `table_v1`，值 `{v,name,at,rows,cols,size,text}`），localStorage 只留小索引 `adlog_tmeta_v1`。启动时 `tableCacheLoad()` 异步恢复，徽章用索引同步渲染，**每次导入整条覆盖**；清除写空索引 + 删 IDB 记录（构建禁止 `removeItem`，所以不要用 `del`）。
- `adlog_table_v1` 是 v2.2.0 的旧键，只保留读一次做迁移（搬进 IDB 后写空串），新代码不要再往里写全文。
- 表格数据**不参与云同步**，也不要在同步合并里加它；改存储层时保证 `tableCacheLoad/Set/Clear` 三个入口的签名不变。
- 插件安装与同步规则见 `插件安装说明.md`。
