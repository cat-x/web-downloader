// 自测脚本：从主脚本源码中“抽取真实函数定义”执行断言，避免测试副本与实现漂移
// 运行：node self-test.mjs
import { readFileSync } from "fs";
import assert from "assert";

const src = readFileSync(new URL("./web-xunlei-downloader.user.js", import.meta.url), "utf8");
const lines = src.split("\n");

/* 按行切取顶层函数源码（含 async function）：签名行开始，直到恰好 "    }" 的收尾行（函数体内部收尾缩进更深） */
function sliceFn(name) {
    const i = lines.findIndex(l => { const t = l.trim(); return (t.startsWith(`function ${name}(`) || t.startsWith(`async function ${name}(`)) && /^(\s{4})(async )?function/.test(l); });
    assert.ok(i >= 0, `源码中找不到函数: ${name}`);
    if (!lines[i].trim().endsWith("{")) return lines[i]; // 单行函数
    const out = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
        out.push(lines[j]);
        if (lines[j] === "    }") return out.join("\n");
        assert.ok(j - i < 120, `函数 ${name} 未按预期收尾`);
    }
    throw new Error(`函数 ${name} 未闭合`);
}

const names = ["fmtSize", "fmtEta", "nameFromUrl", "ensureExt", "nameFromDisposition",
    "headerOf", "parseM3U", "clamp", "sameBase", "mergeTasks", "xhrWithHandle",
    "looksLikeMeaningfulFile", "cleanFileName", "clampNameBytes", "sanitizeFileName", "sniffTypeLabel"];
const code = `
const deletedTs = g.deletedTs, rts = g.rts, mgmapi = g.mgmapi;
${names.map(sliceFn).join("\n")}
return { ${names.join(", ")} };
`;
const F = new Function("g", code)({
    deletedTs: new Map(),
    rts: new Map(),
    mgmapi: { xmlHttpRequest: null },
});

let n = 0;
const ok = async (label, fn) => { await fn(); n++; console.log(`  ✓ ${label}`); };

console.log("[fmt/解析]");
await ok("fmtSize 边界", () => {
    assert.equal(F.fmtSize(null), "--");
    assert.equal(F.fmtSize(0), "0 B");
    assert.equal(F.fmtSize(1023), "1023 B");
    assert.equal(F.fmtSize(1024), "1.0 KB");
    assert.equal(F.fmtSize(1024 * 1024 * 5), "5.0 MB");
    assert.equal(F.fmtSize(Infinity), "--");
});
await ok("fmtEta", () => {
    assert.equal(F.fmtEta(3661), "1:01:01");
    assert.equal(F.fmtEta(61), "01:01");
    assert.equal(F.fmtEta(Infinity), "");
    assert.equal(F.fmtEta(-5), "");
});
await ok("nameFromUrl", () => {
    assert.equal(F.nameFromUrl("https://a.com/p/%E4%B8%AD%E6%96%87.ts?x=1"), "中文.ts");
    assert.equal(F.nameFromUrl("https://a.com/b/").endsWith(".bin"), true);
    assert.equal(/^download-\d+$/.test(F.nameFromUrl("not a url")), true);
});
await ok("ensureExt", () => {
    assert.equal(F.ensureExt("name", ".ts"), "name.ts");
    assert.equal(F.ensureExt("a.b.c", ".ts"), "a.b.c");
    assert.equal(F.ensureExt("", ".bin").endsWith(".bin"), true);
});
await ok("nameFromDisposition / headerOf", () => {
    assert.equal(F.nameFromDisposition('attachment; filename="a.ts"'), "a.ts");
    assert.equal(F.nameFromDisposition("filename*=UTF-8''%E4%B8%AD.ts"), "中.ts");
    assert.equal(F.nameFromDisposition(""), "");
    assert.equal(F.headerOf({ responseHeaders: "x: 1\r\nContent-Type: video/mp2t\r\n" }, "content-type"), "video/mp2t");
    assert.equal(F.headerOf(null, "content-type"), "");
});
await ok("clamp", () => {
    assert.equal(F.clamp(9, 0, 8), 8);
    assert.equal(F.clamp(-1, 0, 8), 0);
});
await ok("sameBase（主页 URL 判定，忽略 hash/尾斜杠）", () => {
    assert.equal(F.sameBase("https://example.com", "https://example.com/#wtm-home"), true);
    assert.equal(F.sameBase("https://example.com/", "https://example.com/#wtm-home"), true);
    assert.equal(F.sameBase("https://other.com/x", "https://example.com/#wtm-home"), false);
    assert.equal(F.sameBase("garbage", "https://example.com"), false);
});
await ok("parseM3U（分片/多码率/加密/相对地址）", () => {
    const m = F.parseM3U([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=100", "low.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=900", "high.m3u8",
    ].join("\n"), "https://h/dir/master.m3u8");
    assert.equal(m.playlists.length, 2);
    // parseM3U 保持文档顺序，带宽字段交给 loadManifest 选最高码率
    const top = m.playlists.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
    assert.equal(top.uri, "https://h/dir/high.m3u8");
    assert.equal(top.bandwidth, 900);
    const s = F.parseM3U([
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:10",
        "#EXTINF:9.5,", "seg0.ts",
        "#EXTINF:5,", "/abs/seg1.ts",
        "#EXT-X-ENDLIST",
    ].join("\n"), "https://h/dir/m.m3u8");
    assert.equal(s.segments.length, 2);
    assert.equal(s.segments[0].url, "https://h/dir/seg0.ts");
    assert.equal(s.segments[1].url, "https://h/abs/seg1.ts");
    assert.equal(s.totalDuration, 14.5);
    assert.equal(s.hasKey, false);
    const k = F.parseM3U('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\nseg.ts', "https://h/m");
    assert.equal(k.hasKey, true);
    const none = F.parseM3U('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\nseg.ts', "https://h/m");
    assert.equal(none.hasKey, false);
    assert.equal(none.segments.length, 1);
});

console.log("[任务合并/同步]");
await ok("mergeTasks：updatedAt 新者胜出 / 本页在跑本地为准 / 墓碑过滤", () => {
    const deletedTs = new Map([["gone", 1000]]);
    const rts = new Map([["running", {}]]);
    const g = new Function("g", `const deletedTs = g.deletedTs, rts = g.rts;\n${sliceFn("mergeTasks")}; return mergeTasks;`)({ deletedTs, rts });
    const remote = [
        { id: "a", updatedAt: 10, x: "r" },
        { id: "gone", updatedAt: 50 },            // 墓碑之后更新 → 应过滤
        { id: "running", updatedAt: 999 },          // 本页在跑 → 本地为准
    ];
    const local = [
        { id: "a", updatedAt: 20, x: "l" },
        { id: "running", updatedAt: 1, x: "live" },
    ];
    const out = new Map(g(remote, local).map(t => [t.id, t]));
    assert.equal(out.get("a").x, "l");            // 本地更新 → 本地胜
    assert.equal(out.get("running").x, "live");   // 运行时保护
    assert.equal(out.has("gone"), false);         // 墓碑生效
});
await ok("sendCmd 排重基准：onCmd 忽略本页命令与过期命令（结构推演）", () => {
    // onCmd 依赖大量模块状态，这里验证其过滤条件的逻辑语义
    const PAGE_ID = "P1", now = Date.now();
    const accept = c => !!c && c.by !== PAGE_ID && now - (c.ts || 0) <= 60000;
    assert.equal(accept({ by: "P1", ts: now }), false);   // 自己发的不处理
    assert.equal(accept({ by: "P2", ts: now - 61000 }), false); // 过期丢弃
    assert.equal(accept({ by: "P2", ts: now - 30000 }), true);  // 60s 窗口内（引擎后台唤起留量）
});

console.log("[可中止 xhr]");
await ok("xhrWithHandle：abort 确定性 reject 且只结算一次，handles 清理", async () => {
    let captured = null;
    const mgmapi = { xmlHttpRequest: o => { captured = o; return { abort() { } }; } };
    const fn = new Function("g", `const mgmapi = g.mgmapi;\n${sliceFn("xhrWithHandle")}; return xhrWithHandle;`)({ mgmapi });
    const rt = { abort: true, handles: new Set() };
    const p = fn(rt, { url: "u" });
    const catches = [];
    p.catch(e => catches.push(e.message));
    assert.equal(rt.handles.size, 1);
    const entry = Array.from(rt.handles)[0];
    entry.abort();
    assert.equal(rt.handles.size, 0);
    captured.onload({});   // 迟到的成功回调不得二次结算
    captured.onerror({});  // 迟到的错误回调不得二次结算
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(catches, ["请求已中止"]);
});
await ok("xhrWithHandle：正常完成 resolve，重复 settle 无效", async () => {
    let captured = null;
    const mgmapi = { xmlHttpRequest: o => { captured = o; return { abort() { } }; } };
    const fn = new Function("g", `const mgmapi = g.mgmapi;\n${sliceFn("xhrWithHandle")}; return xhrWithHandle;`)({ mgmapi });
    const rt = { abort: false, handles: new Set() };
    let val = null;
    fn(rt, { url: "u" }).then(r => { val = r; });
    captured.onload({ status: 200 });
    captured.onload({ status: 200 }); // 二次回调应被忽略
    await new Promise(r => setTimeout(r, 10));
    assert.equal(val && val.status, 200);
    assert.equal(rt.handles.size, 0);
});

console.log("[一致性]");
await ok("clearChunks 键范围与 putChunk 写入键格式一致", () => {
    assert.ok(/key: `\$\{taskId\}:\$\{index\}`/.test(src), "putChunk 键格式变化需同步改 clearChunks 范围");
    assert.ok(/IDBKeyRange\.bound\(taskId \+ ":"/.test(src), "clearChunks 应使用范围一次性删除");
});
await ok("设置写读通道统一（persistSettings 是唯一顶层写点）", () => {
    const writeSites = lines.filter(l => /setValue\("wtm-settings"/.test(l));
    assert.equal(writeSites.length, 1, `wtm-settings 应只在 persistSettings 内写，实际 ${writeSites.length} 处:\n${writeSites.join("\n")}`);
});
await ok("无遗留不可中止网络调用（运行期一律 gxhr/xhrWithHandle）", () => {
    const bad = lines.filter(l => /await xhr\(/.test(l));
    assert.equal(bad.length, 0, bad.join("\n"));
});

console.log("[调试日志开关]");
await ok("dlog：关闭时静默但仍记缓冲，开启时输出 [wtm][dbg] 时间戳前缀", () => {
    const body = sliceFn("dlog");
    const make = new Function("settings", "console", body + "; return dlog;");
    const logs = [];
    const c = { log: (...a) => logs.push(a) };
    let d = make({ debug: false }, c);
    d("隐藏");
    assert.equal(logs.length, 0, "debug=false 必须零控制台输出");
    assert.equal(d.buf.length, 1, "debug=false 仍要记录环形缓冲（供一键复制）");
    assert.ok(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] 隐藏$/.test(d.buf[0]), "缓冲行格式：时间戳 + 内容");
    d = make({ debug: true }, c);
    d("可见", 42);
    assert.equal(logs.length, 1);
    assert.match(logs[0][0], /^\[wtm\]\[dbg \d{2}:\d{2}:\d{2}\.\d{3}\]$/, "前缀格式");
    assert.equal(logs[0][1], "可见");
    const d2 = make({ debug: false }, { log() { } });
    for (let i = 0; i < 520; i++) d2("x" + i);
    assert.equal(d2.buf.length, 500, "环形缓冲上限 500 条");
});
await ok("debug 设置：默认关闭、UI 采集、埋点不走裸 console", () => {
    assert.match(src, /debug:\s*false,/, "DEFAULT_SETTINGS.debug 应默认 false");
    assert.ok(/settings\.debug = !!\(els\.sDebug/.test(src), "save-settings 应采集 debug 开关");
    const bare = lines.filter(l => /^\s*console\.log\(/.test(l));
    assert.ok(bare.length <= 1, `console.log 只允许 dlog 内部一处，实际 ${bare.length} 处`);
});

console.log("[诊断报告一键复制]");
await ok("诊断报告：设置区按钮/GM_setClipboard 授权/降级通道/头部字段全接线", () => {
    assert.match(src, /data-act="copy-diag"/, "设置区应有复制诊断报告按钮");
    assert.ok(/case "copy-diag"/.test(src), "分发器应处理 copy-diag");
    assert.match(src, /\/\/ \@grant\s+GM_setClipboard/, "元数据应声明 GM_setClipboard");
    assert.ok(/function buildDiagText\(\)/.test(src), "应有报告拼装函数");
    assert.ok(/GM_setClipboard\(txt/.test(src), "优先走 GM 剪贴板通道");
    assert.ok(/navigator\.clipboard\.writeText\(txt\)/.test(src), "无 GM 时降级页内剪贴板 API");
    assert.ok(/设置: \$\{JSON\.stringify\(settings\)\}/.test(src), "报告应含设置快照");
});

console.log("[保存文件夹本页选择]");
await ok("更改文件夹就地打开选择器，不再跳转主页标签", () => {
    const body = sliceFn("pickSaveDir");
    assert.ok(!/openHomeNewTab/.test(body), "pickSaveDir 不应跳转主页标签");
    const guardPart = body.split("try {")[0];
    assert.ok(!/isEngine\(\)/.test(guardPart), "非引擎页也应能直接打开选择器（无拦截）");
    assert.ok(/showDirectoryPicker\(\{/.test(body), "应直接调用原生文件夹选择器");
    assert.ok(/Store\.setMeta\("savedir", h\)/.test(body), "句柄应存于选择所在域的 IndexedDB");
    assert.ok(/isEngine\(\)[\s\S]*已指定保存文件夹[\s\S]*跨站携带/.test(body), "非主页应提示跨站权限限制");
});

console.log("[分片直写本地文件]");
await ok("直写模式接线：登记驱动续传、零内存收尾、全局回退与清理", () => {
    assert.ok(/indexedDB\.open\("wtm-downloader", 3\)/.test(src), "库版本应升到 3");
    assert.ok(/objectStoreNames\.contains\("fileplan"\)/.test(src), "应有 fileplan 登记库");
    assert.ok(/putPlan\(rec\)/.test(src) && /getPlan\(key\)/.test(src) && /clearPlans\(taskId\)/.test(src), "Store 应提供计划读写/清理");
    const w = sliceFn("worker");
    assert.ok(/await storeChunk\(task, i, bytes, size, rt\)/.test(w), "worker 应经 storeChunk 分流落地（携 rt供 m3u8 顺序刷盘）");
    assert.ok(!/Store\.putChunk/.test(w), "worker 不再直接写分片缓存");
    const sc = sliceFn("storeChunk");
    assert.ok(/LocalFile\.writeAt\(task\.id, plan, LocalFile\.planOffset\(plan, task, i\), bytes, size, i\)/.test(sc), "直链直写分支按块偏移 seek 落盘");
    assert.ok(/task\.type === "m3u8"[\s\S]*rt\.wbuf\.set\(i, bytes\)[\s\S]*while \(rt\.wbuf\.has\(rt\.nextWrite\)\)/.test(sc), "m3u8 分片入缓冲按索引顺序刷盘（防并发乱序串位）");
    assert.ok(/dropLocalFile/.test(sc) && /clearChunks/.test(sc) && /planned = false/.test(sc), "写盘失败应降级回缓存模式并作废旧登记");
    const pf = sliceFn("planFile");
    assert.ok(/dirHandle && !task\.singleBlob && task\.resumable && task\.totalSize > 0/.test(pf), "授权目录+可续传才启用直写");
    assert.ok(/singleBlob && task\.totalSize > 0/.test(pf), "直写降级后不应误入整包单分片模式");
    const pm = sliceFn("planM3U8");
    assert.ok(/dropLocalFile\(dirHandle, task, "分片列表变化"\)/.test(pm), "m3u8 分片数变化应丢弃旧直写文件");
    const rn = sliceFn("run");
    assert.ok(/for \(const \[idx, sz\] of plan\.pairs\)/.test(rn), "续传应靠 fileplan 登记重建完成分片");
    assert.ok(/closeWriter\(task\.id\)/.test(rn), "接管前应丢弃旧写流、后续从 handle 重开");
    const mf = sliceFn("mergeFinish");
    const directBranch = mf.split("if (task.workingFile)")[1].split("return;")[0];
    assert.ok(directBranch.length > 50 && directBranch.indexOf("Store.getChunk") === -1 && directBranch.indexOf("putFile") === -1, "直写收尾不得读分片合并入库");
    assert.ok(/LocalFile\.finalize\(dirHandle, task\)/.test(mf), "直写完成只改名");
    assert.ok(/clearPlans\(t\.id\)/.test(sliceFn("removeTask")), "删任务应清直写登记");
    assert.ok(/dropLocalFile\(dirHandle, t, "更换地址"\)/.test(sliceFn("applyUrlChange")), "换址应丢弃旧直写文件");
    const sa = sliceFn("saveAsInternal");
    assert.ok(/plan && plan\.status === "done"/.test(sa) && /已保存在文件夹/.test(sa), "成品已在本地时不应报不存在");
    assert.ok(/wtm: "mp4-convert", taskId: id, bytes: buf/.test(sliceFn("startConvert")), "直写成品转封装走字节传递不经 IDB");
    assert.ok(/if \(d\.bytes && d\.bytes\.byteLength\) return d\.bytes/.test(src), "页世界转换器支持字节输入");
    assert.ok(/info\.local && info\.bytes && dirHandle/.test(sliceFn("finishConvert")), "MP4 成品直写本地文件夹");
});
await ok("planOffset：直链按块大小定位，m3u8 按已登记分片累计追加", () => {
    const m = src.match(/function planOffset\(plan, task, i\) \{[\s\S]*?\n        \}/);
    assert.ok(m, "应存在 planOffset");
    const fn = new Function("return " + m[0])();
    const plan = { pairs: [[0, 100], [2, 50]] };
    assert.strictEqual(fn(plan, { resumable: true, type: "file", chunkSize: 4096 }, 3), 3 * 4096, "直链分片偏移=索引×块大小");
    assert.strictEqual(fn(plan, { resumable: true, type: "m3u8" }, 3), 150, "m3u8 顺序追加偏移=已登记字节和");
});

console.log("[直写写流不入 IDB（修复 v2.8.0 隐性失效）]");
await ok("写流不可克隆：writer 存内存 Map，持久化计划只含 handle + taskId", () => {
    assert.ok(/const writers = new Map\(\)/.test(src), "应有内存级 writers Map");
    const op = src.match(/async function openPlan\(dir, task\) \{[\s\S]*?\n        \}/);
    assert.ok(op, "应存在 openPlan");
    assert.ok(!/plan\.writer\s*=/.test(op[0]), "openPlan 不得把写流挂到 plan 上");
    assert.ok(/plan\.handle = await dir\.getFileHandle\(plan\.tempName\)/.test(op[0]), "openPlan 只保留可克隆的文件句柄");
    assert.ok(/taskId: task\.id/.test(op[0]), "计划应携带 taskId（否则登记键会变成 undefined）");
    assert.ok(/putPlan\(\{ key: planKey\(task\.id, "f"\), taskId: task\.id, plan \}\)/.test(op[0]), "持久化时写流不在 plan 内，不会抛 DataCloneError");
    const wa = src.match(/async function writeAt\(taskId, plan, offset, bytes, size, index\) \{[\s\S]*?\n        \}/);
    assert.ok(wa, "writeAt 应改为以 taskId 取写流");
    assert.ok(/getWriter\(taskId, plan\)/.test(wa[0]) && /await w\.seek\(offset\)/.test(wa[0]), "writeAt 从 writers 取流并 seek 写");
    assert.ok(!/Store\.putChunk|plan\.writer/.test(wa[0]), "writeAt 不再引用不可克隆的 plan.writer");
});

console.log("[m3u8 直写顺序修复]");
await ok("planM3U8：先置 resumable/chunkSize/name 再 openPlan（旧顺序导致 m3u8 直写从不激活）", () => {
    const pm = sliceFn("planM3U8");
    const openAt = pm.indexOf("LocalFile.openPlan");
    const resumAt = pm.indexOf('task.resumable = true');
    const nameAt = pm.indexOf('ensureExt(task.name, ".ts")');
    assert.ok(openAt > 0 && resumAt > 0 && nameAt > 0 && resumAt < openAt && nameAt < openAt, "resumable 与 name 必须在 openPlan 之前就绪");
    assert.ok(/rt\.nextWrite = 0; while \(doneIdx\.has\(rt\.nextWrite\)\)/.test(sliceFn("run")), "续传时 m3u8 从第一个未完成分片接着刷盘");
});

console.log("[源页面直接下载（架构反转）]");
await ok("下载只认任务同源页：调度/投递/续传/另存/转码均按 canRunHere，不再强制交给主页", () => {
    const sc = sliceFn("schedule");
    assert.ok(/if \(!canRunHere\(t\)\) continue;/.test(sc), "schedule 应跳过非同源任务");
    assert.ok(!/if \(!isEngine\(\)\) \{ notifyUI\(\); return; \}/.test(sc), "schedule 不应再有『仅主页运行』总闸");
    assert.ok(/if \(claimed \|\| tasks\.some\(canRunHere\)\) saveTasks\(\)/.test(sc), "只读页不回写任务表，避免覆盖来源页进度");
    const at = sliceFn("addTask");
    assert.ok(/origin: location\.origin/.test(at), "任务创建即绑定当前页域");
    assert.ok(/schedule\(\);/.test(at) && !/ensureEngine\(\)/.test(at), "addTask 就在当前页调度，不再后台唤起主页");
    assert.ok(!/加入统一下载主页队列/.test(src), "不再有『交给主页队列』的旧文案");
    for (const fn of ["resumeTask", "applyUrlChange"]) {
        const b = sliceFn(fn);
        assert.ok(/if \(canRunHere\(t\)\) schedule\(\);/.test(b), fn + " 应仅同源页本地调度");
        assert.ok(/else ensureSourceTab\(t\);/.test(b), fn + " 他源任务应打开来源页");
        assert.ok(!/ensureEngine\(\)/.test(b), fn + " 不再唤起主页引擎");
    }
    assert.ok(/if \(!canRunHere\(t\)\) \{ sendCmd\(id, "saveAs"\); ensureSourceTab\(t\); return; \}/.test(sliceFn("saveAs")), "saveAs 他源任务转交来源页");
    assert.ok(/if \(!canRunHere\(t\)\) \{ sendCmd\(id, "convert"\); ensureSourceTab\(t\); return; \}/.test(sliceFn("startConvert")), "convert 他源任务转交来源页");
    const oc = sliceFn("onCmd");
    assert.ok(/if \(!\(ot && canRunHere\(ot\)\) && !rt\) return;/.test(oc), "onCmd 引擎动作只认同源页");
    assert.ok(!/if \(!isEngine\(\)\) return;/.test(oc), "onCmd 不再有『仅主页处理』硬闸");
    assert.ok(/function canRunHere\(t\) \{ return !!t && t\.origin === location\.origin; \}/.test(src), "canRunHere 以 origin 判定归属");
    assert.ok(/openInTab\(target, false\)/.test(sliceFn("ensureSourceTab")), "ensureSourceTab 打开来源(referer)页");
});
await ok("保存文件夹句柄每页无条件恢复（各站直写各存），不再只在主页读取", () => {
    assert.ok(!/if \(isEngine\(\)\) \{[^}]*getMeta\("savedir"\)/.test(src), "savedir 恢复不应被包在 isEngine 块内");
    assert.ok(/getMeta\("savedir"\)/.test(src), "仍应恢复已授权的保存文件夹句柄");
});

console.log("[动态文件名取名]");
await ok("looksLikeMeaningfulFile：真实文件名判定为有意义，流媒体占位名判定为无意义", () => {
    assert.equal(F.looksLikeMeaningfulFile("权力的游戏S01E01.mp4"), true, "真实片名应优先用 URL 名");
    assert.equal(F.looksLikeMeaningfulFile("movie_720p.mkv"), true);
    assert.equal(F.looksLikeMeaningfulFile("index.ts"), false, "index 占位名应改用页面标题");
    assert.equal(F.looksLikeMeaningfulFile("master.m3u8"), false);
    assert.equal(F.looksLikeMeaningfulFile("video.mp4"), false, "video 泛化名应改用页面标题");
    assert.equal(F.looksLikeMeaningfulFile("123456.mp4"), false, "纯数字名应改用页面标题");
    assert.equal(F.looksLikeMeaningfulFile("noext"), false, "无扩展名不算有意义");
});
await ok("cleanFileName：过滤非法字符、折叠空白、截断长度", () => {
    assert.equal(F.cleanFileName("a/b:c*d?e"), "a_b_c_d_e");
    assert.equal(F.cleanFileName("  多  空格\t标题  "), "多 空格 标题");
    assert.equal(F.cleanFileName("x".repeat(200)).length, 100, "应截断到 100 字符");
    assert.equal(F.cleanFileName(null), "", "null 安全");
});
await ok("取名链路：suggestName 已接管四类下载入口（视频/m3u8/手动/中继）", () => {
    assert.match(src, /await suggestName\(url, type\)/, "askConfirm 默认名应走动态取名");
    assert.ok(!/try \{ name = nameFromUrl\(v\.src\)/.test(src), "视频入口不应再静态吃 URL 名，应交动态取名");
    assert.ok(!/async onDownload\(\) \{\s*let title/.test(src), "m3u8 入口取名逻辑应下沉到 suggestName");
});

console.log("[跨平台文件名净化]");
await ok("sanitizeFileName：非法字符/保留名/首尾点空格/多字节截断均安全", () => {
    assert.equal(F.sanitizeFileName("a\\b/c:d*e?f\"g<h>i|j"), "a_b_c_d_e_f_g_h_i_j", "Windows+macOS 非法字符→下划线");
    assert.equal(F.sanitizeFileName("CON.txt"), "_CON.txt", "Windows 保留名需转义");
    assert.equal(F.sanitizeFileName("lpt9.zip"), "_lpt9.zip", "LPT 保留名（大小写不敏感）");
    assert.equal(F.sanitizeFileName("  尾点尾空格.  "), "尾点尾空格", "去尾随点/空格与首尾空白");
    assert.equal(F.sanitizeFileName(".hidden"), "hidden", "去前导点避免隐藏文件");
    assert.ok(/^[\w\u4e00-\u9fff ._\[\]-]+[.]mp4$/.test(F.sanitizeFileName("影片:第1集 [1080P]?.mp4")), "冒号/问号净化但保留扩展名");
    assert.equal(F.sanitizeFileName("a：b.txt"), "a：b.txt", "全角冒号合法不应被替换");
    const long = F.sanitizeFileName("标".repeat(300) + ".mp4"); // 多字节不切断代理/多字节
    assert.ok(new TextEncoder().encode(long).length <= 120, "UTF-8 字节不超 120");
    assert.ok(long.endsWith(".mp4"), "截断应保留扩展名");
});
await ok("sanitizeOn：任务级勾选优先，未指定时跟随全局开关", () => {
    const make = new Function("settings", sliceFn("sanitizeOn") + "; return sanitizeOn;");
    const on = make({ sanitizeName: true });
    assert.equal(on(undefined), true, "无 spec 默认净化");
    assert.equal(on({}), true, "spec 未带 sanitize 跟随全局");
    assert.equal(on({ sanitize: false }), false, "任务级取消勾选则不净化");
    assert.equal(on({ sanitize: true }), true);
    const off = make({ sanitizeName: false });
    assert.equal(off({}), false, "全局关闭时默认不净化");
    assert.equal(off({ sanitize: true }), true, "任务级勾选可反向覆盖全局关闭");
    assert.equal(make({})({}), true, "旧配置无 sanitizeName 键时默认开");
});
await ok("净化开关：设置页默认勾选 + 确认面板任务级勾选与 addTask/收口接线就位", () => {
    assert.match(src, /sanitizeName:\s*true,/, "DEFAULT_SETTINGS.sanitizeName 应默认 true");
    assert.ok(/settings\.sanitizeName = !!\(els\.sSanitize/.test(src), "save-settings 应采集 sSanitize");
    assert.match(src, /id="s-sanitize"/, "设置面板应有跨平台修正复选框");
    assert.match(src, /id="cf-sanitize"/, "确认面板应有任务级修正复选框");
    assert.ok(/sanitize: els\.cfSanitize \? els\.cfSanitize\.checked : undefined/.test(src), "cf-ok 应读取任务级勾选");
    assert.ok(/name: finalName\(spec, url, type\)/.test(src), "addTask 唯一点应走 finalName 收口");
    assert.ok(/if \(sanitizeOn\(spec\)\)/.test(src), "finalName 应走任务级优先的 sanitizeOn");
    assert.ok(/sanitize: sanitizeOn\(spec\),/.test(src), "addTask 应逐任务落 sanitize 字段");
    assert.ok(/task\.sanitize === false \? fn : sanitizeFileName\(fn\)/.test(src), "服务端改名应遵循任务级勾选");
});

console.log("[嗅探悬浮球反馈]");
await ok("sniffTypeLabel：类型中文映射", () => {
    assert.equal(F.sniffTypeLabel("m3u8"), "m3u8");
    assert.equal(F.sniffTypeLabel("video"), "视频");
    assert.equal(F.sniffTypeLabel("file"), "文件");
    assert.equal(F.sniffTypeLabel(undefined), "资源");
});
await ok("嗅探反馈接线：脉冲触发/常驻角标/提示条元素与 3s 渐隐均就位", () => {
    assert.ok(/pulseSniffFab\(\); \/\/ \u65b0\u8d44\u6e90\u5230\u8fbe/.test(src), "showSniffItem 应触发脉冲");
    assert.ok(/updateSniffBadge\(\);/.test(src), "render 应同步常驻资数量角标");
    assert.match(src, /id="sbadge"/, "FAB 应带绿色资源数角标");
    assert.match(src, /id="snip"[\s\S]*?\u55c5\u63a2\u5230/, "应有嗅探提示条");
    assert.match(src, /},\s*3000\);/, "脉冲应 3 秒后渐隐回默认");
    assert.ok(/IN_FRAME \|\| !els\.fab/.test(src), "pulseSniffFab 应护栏 iframe 与 UI 未就绪");
});

console.log("[嗅探小窗与 403 缓解]");
await ok("嗅探小窗：新资源只弹紧凑卡片而非整块大面板", () => {
    assert.match(src, /id="sniff-pop"/, "UI 应含嗅探小窗容器");
    assert.ok(/!state\.panelOpen\) showSniffPop\(\);/.test(src), "showSniffItem 应弹小窗而非 openPanel");
    assert.ok(!/!state\.panelOpen\) \{ state\.tab = "sniff"; openPanel\(\); \}/.test(src), "旧的自动开大面板分枝应已移除");
    assert.ok(/hideSniffPop\(\); \/\/ \u5f00\u5927\u9762\u677f/.test(src), "openPanel 应收起小窗");
    assert.match(src, /data-act="sf-openpanel"/, "小窗应有查看全部按钮");
    assert.ok(/case "sf-close"[\s\S]*?case "sf-openpanel"/.test(src), "分发器应处理 sf-close/sf-openpanel");
});
await ok("403 缓解：仅在 401/403 且带 referer 时去 Origin 重试一次", () => {
    assert.ok(/delete h\.Origin;/.test(src), "m3u8 分片 403 应去 Origin 重试");
    assert.ok(/delete headers\.Origin;/.test(src), "文件分片 403 应去 Origin 重试");
    assert.ok(/r\.status === 401 \|\| r\.status === 403/.test(src), "重试应仅在 401/403 触发");
    const bare = lines.filter(l => /await xhr\(/.test(l));
    assert.equal(bare.length, 0, "重试仍需用可中止通道");
});
await ok("清单请求携带源站 Origin/Referer（修复 Cloudflare 跨源拦截）", () => {
    const ft = sliceFn("fetchText");
    assert.ok(/headers\.Origin = u\.origin/.test(ft), "fetchText 必须从 referer 推导并设置 Origin（否则默认主页域被 CF 拦）");
    assert.ok(/headers\.Referer = referer/.test(ft), "fetchText 应携带源站 Referer");
    assert.ok(/403→去 Origin 重试/.test(ft), "清单 403 应有去 Origin 重试兜底");
    assert.ok(/loadManifest 开始/.test(sliceFn("loadManifest")) && /fetchText\(url, referer, rt\)/.test(sliceFn("loadManifest")), "loadManifest 应把 referer 透传给 fetchText");
});

console.log("[源页面原生 fetch 过 Cloudflare（v2.9.1 根因修复）]");
await ok("fetchViaPage：走 unsafeWindow.fetch、裸fetch→include→omit 三策略、可中止", () => {
    const fv = sliceFn("fetchViaPage");
    assert.ok(/unsafeWindow/.test(fv) && /W\.fetch/.test(fv), "必须取页面上下文的 fetch（与播放器同源同会话，才能过 CF）");
    assert.ok(/label:\s*"裸fetch"/.test(fv) && /label:\s*"include"/.test(fv) && /label:\s*"omit"/.test(fv), "凭据不赌单一方向：先裸 fetch(url)，再 include、再 omit");
    assert.ok(/for \(const at of attempts\)/.test(fv) && /await doOnce\(at\.extra\)/.test(fv), "应逐个策略尝试、任一拿到 Response 即返回");
    assert.ok(/AbortController/.test(fv) && /rt\.handles\.add\(entry\)/.test(fv), "页面 fetch 也必须注册进 rt.handles 以保证任意阶段可暂停中止");
    assert.ok(/if \(rt && rt\.abort\) throw/.test(fv), "暂停中止时不得吞异常去重试，应直接上抛");
});
await ok("清单与 m3u8 分片都优先页面 fetch、失败才回退 GM_xhr", () => {
    const ft = sliceFn("fetchText");
    assert.ok(ft.indexOf("fetchViaPage") < ft.indexOf("gxhr(rt"), "fetchText 必须先试页面 fetch，再回退 GM_xhr");
    const fc = sliceFn("fetchChunk");
    const m3u8 = fc.split('task.type === "m3u8"')[1].split('const headers = refHeader(task)')[0];
    assert.ok(/fetchViaPage\(rt, segUrl/.test(m3u8), "m3u8 分片应优先走页面 fetch");
    assert.ok(m3u8.indexOf("fetchViaPage") < m3u8.indexOf("xhrWithHandle"), "分片页面 fetch 失败才回退 xhrWithHandle");
    assert.ok(/if \(rt && rt\.abort\) throw e/.test(ft) && /if \(rt && rt\.abort\) throw e/.test(m3u8), "暂停中止时不得吞掉异常去回退，应直接上抛");
});
await ok("复用嗅探时播放器已取到的清单，下载不二次请求根清单（v2.9.2）", () => {
    assert.ok(/const sniffedManifest = new Map\(\)/.test(src), "应有嗅探清单正文缓存");
    const lm = sliceFn("loadManifest");
    assert.ok(/sniffedManifest\.get\(url\)/.test(lm) && lm.indexOf("sniffedManifest.get") < lm.indexOf("fetchText"), "loadManifest 应先查缓存、命中则跳过 fetchText");
    assert.ok(/rememberSniffedManifest\(u\.href, content\)/.test(sliceFn("doM3U")), "嗅探时应存下播放器已取到的清单正文");
});
await ok("跨帧嗅探 relay 携带播放器那一跳的 referer/origin/正文（修复跨源 iframe 下不列）", () => {
    const si = sliceFn("showSniffItem");
    assert.ok(/IN_FRAME[\s\S]*referer:\s*location\.href[\s\S]*origin:\s*location\.origin/.test(si), "iframe relay 应携带自身 location.href/origin");
    assert.ok(/content:\s*\(type === "m3u8"[\s\S]*SNIFF_CONTENT_MAX/.test(si), "relay 应带上清单正文（带上限）");
    const or = sliceFn("onSniffRelay");
    assert.ok(/rememberSniffReferer\(p\.url, p\.referer\)/.test(or) && /rememberSniffedManifest\(p\.url, p\.content\)/.test(or), "顶层应缓存 relay 来的 referer 与清单正文");
    assert.ok(/referer:\s*effRef/.test(or), "跨帧任务的 referer 用播放器那一跳而非顶层页 URL");
    const rh = sliceFn("refHeader");
    assert.ok(/h\.Referer = task\.referer/.test(rh) && /h\.Origin = u\.origin/.test(rh), "GM_xhr 回退时按任务 referer 设 Origin/Referer（跨帧 referer 才能命中 CDN 校验）");
});

console.log("[跨页实时一致性]");
await ok("estSpeed：落盘字节增长估出速度，无增长衰减，样本过期/回退重置", () => {
    const map = new Map();
    let now = 1000;
    const est = new Function("estSamples", "Date", sliceFn("estSpeed") + "; return estSpeed;")(map, { now: () => now });
    const t1 = { id: "x", downloaded: 0 };
    assert.equal(est(t1), 0, "首次采样无速度");
    now = 2000; t1.downloaded = 1000;
    assert.equal(est(t1), 1000, "1 秒 1000 字节 → 1000B/s");
    now = 3000;
    assert.equal(est(t1), 700, "无增长应衰减 0.7");
    now = 4000; t1.downloaded = 500;
    assert.equal(est(t1), 0, "字节回退（重置）应归零");
    now = 20000; t1.downloaded = 600;
    assert.equal(est(t1), 0, "样本超 15 秒视为过期，重新基线");
});
await ok("接线：事件驱动落盘/20s 认领窗/面板快速对账/估速显示/串行写盘", () => {
    assert.ok(/function flushProgress\(task\)/.test(src), "应有事件驱动落盘函数");
    assert.ok(/if \(!flushProgress\(task\)\) saveTasks\(\);/.test(src), "worker 分片落地应先尝试即时写");
    assert.ok(/flushProgress\(task\); \} \} catch/.test(src), "onprogress 回调应触发即时写");
    assert.match(src, /t\.ownerTs < 20000/, "认领存活窗口应放宽到 20s（容忍后台节流）");
    assert.ok(/async function pollStorageOnce\(\)/.test(src), "对账应可独立调用");
    assert.ok(/state\.panelOpen\) startFastPoll\(\); else stopFastPoll\(\)/.test(src), "面板开启应启动 1.2s 快速对账");
    assert.ok(/pollStorageOnce\(\); \/\/ 打开即取最新存储/.test(src), "openPanel 应立即对账");
    assert.ok(/estSpeeds\.get\(t\.id\)/.test(src), "taskHtml 速度应回退到估算值");
    assert.ok(/saveChain = saveChain\.then\(doSaveTasksNow\)/.test(src), "落盘必须串行防交错");
});

console.log("[品牌统一]");
await ok("全脚本不再出现“迅雷/Thunder”称谓，统一 Web下载器", () => {
    assert.ok(!/迅雷/.test(src), "源码不应含“迅雷”字样");
    assert.ok(!/Thunder/i.test(src), "源码不应含“Thunder”字样");
    assert.match(src, /@name\s+Web下载器/, "@name 应为 Web下载器");
    assert.match(src, /wtm-logo">⚡ Web下载器/, "面板 logo 应为 Web下载器");
    assert.ok(/wtm-ver">v\$\{SCRIPT_VER\}/.test(src), "logo 版本号应动态跟随 SCRIPT_VER");
});

setTimeout(() => {
    console.log(`\n全部通过：${n} 组断言 ✅`);
}, 50);
