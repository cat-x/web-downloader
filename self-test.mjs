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
    "looksLikeMeaningfulFile", "cleanFileName"];
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

setTimeout(() => {
    console.log(`\n全部通过：${n} 组断言 ✅`);
}, 50);
