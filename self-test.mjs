// 自测脚本：从主脚本源码中“抽取真实函数定义”执行断言，避免测试副本与实现漂移
// 运行：node self-test.mjs
import { readFileSync } from "fs";
import assert from "assert";

const src = readFileSync(new URL("./web-xunlei-downloader.user.js", import.meta.url), "utf8");
const lines = src.split("\n");

/* 按行切取顶层函数源码：签名行开始，直到恰好 "    }" 的收尾行（函数体内部收尾缩进更深） */
function sliceFn(name) {
    const i = lines.findIndex(l => l.trim().startsWith(`function ${name}(`) && /^(\s{4})function/.test(l));
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
await ok("dlog：关闭时静默，开启时输出 [wtm][dbg] 时间戳前缀", () => {
    const body = sliceFn("dlog");
    const make = new Function("settings", "console", body + "; return dlog;");
    const logs = [];
    const c = { log: (...a) => logs.push(a) };
    let d = make({ debug: false }, c);
    d("隐藏");
    assert.equal(logs.length, 0, "debug=false 必须零输出");
    d = make({ debug: true }, c);
    d("可见", 42);
    assert.equal(logs.length, 1);
    assert.match(logs[0][0], /^\[wtm\]\[dbg \d{2}:\d{2}:\d{2}\.\d{3}\]$/, "前缀格式");
    assert.equal(logs[0][1], "可见");
});
await ok("debug 设置：默认关闭、UI 采集、埋点不走裸 console", () => {
    assert.match(src, /debug:\s*false,/, "DEFAULT_SETTINGS.debug 应默认 false");
    assert.ok(/settings\.debug = !!\(els\.sDebug/.test(src), "save-settings 应采集 debug 开关");
    const bare = lines.filter(l => /^\s*console\.log\(/.test(l));
    assert.ok(bare.length <= 1, `console.log 只允许 dlog 内部一处，实际 ${bare.length} 处`);
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
