// ==UserScript==
// @name         Web下载器【m3u8嗅探+断点续传下载管理器】
// @name:zh-CN   Web下载器【m3u8嗅探+断点续传下载管理器】
// @name:en      Web Downloader - m3u8 Sniffing & Resumable Download Manager
// @version      2.9.1
// @description  网页综合下载工具：下载主页面板、分块多线程下载、断点续传（可直写本地文件）、暂停/继续、任务排重、更换下载地址、m3u8 自动嗅探与分片合并、视频直链下载。
// @description:zh-CN 网页综合下载工具：下载主页面板、分块多线程下载、断点续传（可直写本地文件）、暂停/继续、任务排重、更换下载地址、m3u8 自动嗅探与分片合并、视频直链下载。
// @description:en A web download manager: download hub UI, multi-threaded chunked download, resume (with direct local file writing), pause/continue, task dedup, url replacement, m3u8 sniffing & merging.
// @author       cat-x
// @license      MIT
// @namespace    wtm-downloader
// @homepageURL  https://github.com/cat-x/web-downloader
// @supportURL   https://github.com/cat-x/web-downloader/issues
// @downloadURL  https://cat-x.github.io/web-downloader/web-xunlei-downloader.user.js
// @updateURL    https://cat-x.github.io/web-downloader/web-xunlei-downloader.user.js
// @match        *://*/*
// @connect      *
// @grant        unsafeWindow
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    /* ==================== GM API 兼容层 ==================== */
    const mgmapi = {
        async getValue(name, defaultVal) {
            return await ((typeof GM_getValue === "function") ? GM_getValue : GM.getValue)(name, defaultVal);
        },
        async setValue(name, value) {
            return await ((typeof GM_setValue === "function") ? GM_setValue : GM.setValue)(name, value);
        },
        async deleteValue(name) {
            return await ((typeof GM_deleteValue === "function") ? GM_deleteValue : GM.deleteValue)(name);
        },
        openInTab(url, open_in_background = false) {
            return ((typeof GM_openInTab === "function") ? GM_openInTab : GM.openInTab)(url, open_in_background);
        },
        xmlHttpRequest(details) {
            return ((typeof GM_xmlhttpRequest === "function") ? GM_xmlhttpRequest : GM.xmlHttpRequest)(details);
        },
        copyText(text) {
            const ta = document.createElement("textarea");
            ta.textContent = text;
            (document.body || document.documentElement).appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        },
        message(text, disappearTime = 5000) {
            const id = "wtm-gm-message-panel";
            let p = document.querySelector(`#${id}`) || document.querySelector(`#wtm-downloader-root`)?.shadowRoot?.querySelector(`#${id}`);
            if (!p) {
                p = document.createElement("div");
                p.id = id;
                p.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;z-index:999999999999;pointer-events:none;`;
                (ui.shadowRoot || document.body || document.documentElement).appendChild(p);
            }
            const mdiv = document.createElement("div");
            mdiv.textContent = text;
            mdiv.style.cssText = `padding:6px 14px;border-radius:8px;background:#1c2432;color:#e6edf7;box-shadow:0 4px 16px rgba(0,0,0,.5);margin-top:8px;font-size:13px;`;
            p.appendChild(mdiv);
            setTimeout(() => { mdiv.remove(); }, disappearTime);
        }
    };

    /* ==================== 工具函数 ==================== */
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    function fmtSize(n) {
        if (n == null || n < 0 || !isFinite(n)) return "--";
        const u = ["B", "KB", "MB", "GB", "TB"];
        let i = 0;
        while (n >= 1024 && i < 4) { n /= 1024; i++; }
        return (i === 0 ? Math.round(n) : n.toFixed(n >= 100 ? 0 : 1)) + " " + u[i];
    }
    function fmtSpeed(bps) {
        if (!bps || bps <= 0) return "空闲";
        return fmtSize(bps) + "/s";
    }
    function fmtEta(sec) {
        if (!isFinite(sec) || sec <= 0) return "";
        sec = Math.round(sec);
        const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s2 = sec % 60;
        const pad = x => String(x).padStart(2, "0");
        return (h ? h + ":" : "") + pad(m) + ":" + pad(s2);
    }

    function nameFromUrl(u) {
        try {
            const url = new URL(u);
            let p = "";
            try { p = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || ""); } catch { p = url.pathname.split("/").filter(Boolean).pop() || ""; }
            if (!p || /^\s+$/.test(p)) p = "download-" + Date.now();
            if (!/\.\w{1,6}$/.test(p)) p += ".bin";
            return p.slice(0, 120);
        } catch { return "download-" + Date.now(); }
    }
    function ensureExt(name, ext) {
        name = String(name || "").trim();
        if (!name || /^\s*$/.test(name)) name = "download-" + Date.now();
        if (!/\.\w{1,6}$/.test(name)) name += ext;
        return name;
    }
    // 判断 URL 尾段是否为“有实际意义”的文件名（排除 index/master 等流媒体占位名），决定要不要改用页面标题
    function looksLikeMeaningfulFile(name) {
        const m = /^(.+?)[.]([\w]{1,6})$/i.exec(String(name || "").trim());
        if (!m) return false;
        const stem = m[1].trim().toLowerCase();
        if (stem.length < 2) return false;
        return !/^(index|master|playlist|stream|video|audio|big|main|media|default|output|data|init|seg|segment|chunk|test|play|v|a|[\d._+-]+)$/.test(stem);
    }
    function cleanFileName(t) {
        return String(t || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
    }
    // 按 UTF-8 字节安全截断文件名（保留扩展名，绝不切断多字节/代理对字符）
    function clampNameBytes(s, maxBytes) {
        const enc = new TextEncoder();
        if (enc.encode(s).length <= maxBytes) return s;
        const m = /[.]([\w]{1,6})$/i.exec(s);
        const ext = m ? m[0] : "";
        const stem = s.slice(0, s.length - ext.length);
        const keep = Math.max(1, maxBytes - enc.encode(ext).length);
        let out = "";
        for (const ch of stem) {
            const t = out + ch;
            if (enc.encode(t).length > keep) break;
            out = t;
        }
        return (out || "download") + ext;
    }
    // 跨平台文件名净化：Windows 非法字符与保留名、macOS 冒号、控制字符、首尾点/空格、长度上限（NTFS/APFS/ext4/FAT 取交集）
    function sanitizeFileName(name) {
        let s = String(name || "").normalize("NFC");
        s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ""); // 控制符 + 零宽/方向标记
        s = s.replace(/[\\/:*?"<>|]/g, "_");                                   // \ / : * ? " < > |（含 macOS 冒号）
        s = s.replace(/^\.+/, "").replace(/[. ]+$/, "").trim();               // Windows：禁前导点（隐藏）与尾随点/空格
        s = s.replace(/\s{2,}/g, " ").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "");
        if (!s) s = "download-" + Date.now();
        const m = /^([^.]*)([.]|$)/.exec(s);
        if (m && /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(m[1])) s = "_" + s; // Windows 保留名（带扩展也非法）
        return clampNameBytes(s, 120);
    }
    // 文件名净化是否生效：任务级勾选（确认面板）优先，未指定时跟随全局设置（默认开）
    function sanitizeOn(spec) {
        if (spec && spec.sanitize !== undefined && spec.sanitize !== null) return !!spec.sanitize;
        return settings.sanitizeName !== false;
    }
    // 任务最终文件名：补扩展名 +（开启时）跨平台净化。addTask 唯一收口，覆盖嗅探/手动/中继/用户手输所有入口
    function finalName(spec, url, type) {
        const ext = type === "m3u8" ? ".ts" : ".bin";
        let nm = ensureExt((spec && spec.name ? String(spec.name) : "").trim() || nameFromUrl(url), ext);
        if (sanitizeOn(spec)) {
            const fixed = sanitizeFileName(nm);
            nm = /\.\w{1,6}$/.test(fixed) ? fixed : ensureExt(fixed, ext); // 净化万一吃掉扩展名则兜底补回
        }
        return nm;
    }
    // 动态文件名：普通文件直链优先用 URL 名；m3u8 或占位名则取“点击下载一刻”的顶层页面标题（对齐老脚本 getTopTitle 体验）
    async function suggestName(url, type) {
        const fromUrl = nameFromUrl(url);
        if (type !== "m3u8" && looksLikeMeaningfulFile(fromUrl)) return fromUrl;
        let title = "";
        try { title = await getTopTitleSafe(); } catch { }
        let base = cleanFileName(title || document.title);
        if (!base) return fromUrl;
        if (type === "m3u8") return ensureExt(base, ".ts");
        // 普通下载：标题无扩展名时沿用 URL 已有扩展（如 video.mp4 → 标题.mp4），忽略 nameFromUrl 兜底补的 .bin
        if (!/\.\w{1,6}$/.test(base)) {
            const m = /[.]([\w]{1,6})$/.exec(fromUrl);
            if (m && m[1].toLowerCase() !== "bin") base += "." + m[1];
        }
        return base;
    }
    function nameFromDisposition(cd) {
        if (!cd) return "";
        let m = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
        if (m) { try { return decodeURIComponent(m[1].replace(/["']/g, "").trim()); } catch { } }
        m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
        return m ? m[1].trim() : "";
    }
    function headerOf(response, name) {
        const raw = (response && response.responseHeaders) || "";
        const m = new RegExp("^" + name + ":\\s*(.+)$", "im").exec(raw);
        return m ? m[1].trim() : "";
    }

    /* Promise 化的 GM_xhr */
    function xhr(details) {
        return new Promise((resolve, reject) => {
            const o = Object.assign({}, details);
            o.onload = resolve;
            o.onerror = e => reject(new Error("网络错误（可能被站点拒绝/需要Cookie）"));
            o.ontimeout = () => reject(new Error("请求超时"));
            mgmapi.xmlHttpRequest(o);
        });
    }
    /* 可被暂停确定性中止的 GM_xhr：abort 时同步 reject，不依赖管理器是否回调事件 */
    function xhrWithHandle(rt, opt) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const entry = {
                abort() {
                    try { h && typeof h.abort === "function" && h.abort(); } catch { }
                    if (!settled) { settled = true; rt.handles.delete(entry); reject(new Error("请求已中止")); }
                },
            };
            const settle = () => { if (settled) return false; settled = true; rt.handles.delete(entry); return true; };
            const o = Object.assign({}, opt, {
                timeout: opt.timeout || 180000,
                onload: r => { if (settle()) resolve(r); },
                onerror: e => { if (settle()) reject(new Error(rt.abort ? "请求已中止" : "网络错误")); },
                ontimeout: () => { if (settle()) reject(new Error("请求超时")); },
            });
            rt.handles.add(entry);
            const h = mgmapi.xmlHttpRequest(o);
        });
    }
    function refHeader(task) {
        const h = {};
        if (task.referer) {
            try {
                const u = new URL(task.referer);
                h.Referer = task.referer;
                h.Origin = u.origin;
            } catch { }
        }
        return h;
    }

    /* ==================== IndexedDB 分片/成品仓库 ==================== */
    const Store = (function () {
        let dbp = null;
        function open() {
            if (dbp) return dbp;
            dbp = new Promise((resolve, reject) => {
                const rq = indexedDB.open("wtm-downloader", 3);
                rq.onupgradeneeded = () => {
                    const db = rq.result;
                    if (!db.objectStoreNames.contains("chunks")) {
                        const s = db.createObjectStore("chunks", { keyPath: "key" });
                        s.createIndex("taskId", "taskId");
                    }
                    if (!db.objectStoreNames.contains("files")) {
                        db.createObjectStore("files", { keyPath: "key" });
                    }
                    if (!db.objectStoreNames.contains("meta")) {
                        db.createObjectStore("meta", { keyPath: "key" }); // 保存目录授权句柄等
                    }
                    if (!db.objectStoreNames.contains("fileplan")) {
                        const s = db.createObjectStore("fileplan", { keyPath: "key" });
                        s.createIndex("taskId", "taskId");
                    } // 直写本地文件模式：只存文件句柄 + 分片完成登记，不存任何文件内容
                };
                rq.onsuccess = () => resolve(rq.result);
                rq.onerror = () => { dbp = null; reject(rq.error); }; // 失败时清除缓存，允许后续重试
            });
            return dbp;
        }
        function pexec(store, mode, fn) {
            return open().then(db => new Promise((resolve, reject) => {
                const t = db.transaction(store, mode);
                let out;
                try { out = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
                t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
                t.onerror = () => reject(t.error);
                t.onabort = () => reject(t.error || new Error("事务中断"));
            }));
        }
        return {
            setMeta(key, value) {
                return pexec("meta", "readwrite", s => s.put({ key, value }));
            },
            getMeta(key) {
                return pexec("meta", "readonly", s => s.get(key));
            },
            putChunk(taskId, index, blob, size) {
                return pexec("chunks", "readwrite", s => s.put({ key: `${taskId}:${index}`, taskId, index, blob, size }));
            },
            getChunk(taskId, index) {
                return pexec("chunks", "readonly", s => s.get(`${taskId}:${index}`));
            },
            deleteChunk(taskId, index) {
                return pexec("chunks", "readwrite", s => s.delete(`${taskId}:${index}`));
            },
            async doneMap(taskId) {
                const records = await new Promise((resolve, reject) => {
                    open().then(db => {
                        const t = db.transaction("chunks", "readonly");
                        const rq = t.objectStore("chunks").index("taskId").getAll(IDBKeyRange.only(taskId));
                        rq.onsuccess = () => resolve(rq.result);
                        rq.onerror = () => reject(rq.error);
                    });
                });
                const map = new Map();
                (records || []).forEach(r => map.set(r.index, r.size || 0));
                return map;
            },
            clearChunks(taskId) { // 按键范围一次事务清空，避免 N 个分片 N 次往返
                return pexec("chunks", "readwrite", s => s.delete(IDBKeyRange.bound(taskId + ":", taskId + ":\uffff\uffff")));
            },
            putPlan(rec) { return pexec("fileplan", "readwrite", s => s.put(rec)); },
            getPlan(key) { return pexec("fileplan", "readonly", s => s.get(key)); },
            deletePlan(key) { return pexec("fileplan", "readwrite", s => s.delete(key)); },
            clearPlans(taskId) { return pexec("fileplan", "readwrite", s => s.delete(IDBKeyRange.bound(taskId + ":", taskId + ":\uffff\uffff"))); },
            putFile(rec) { return pexec("files", "readwrite", s => s.put(rec)); },
            getFile(key) { return pexec("files", "readonly", s => s.get(key)); },
            deleteFile(key) { return pexec("files", "readwrite", s => s.delete(key)); },
        };
    })();

    /* ==================== 直写本地文件（占位 + 分段落盘） ====================
       已授权保存文件夹（设置/确认面板「更改文件夹」）时，任务开始即在生产目录创建 `任务名.wtmpart`，
       分片按偏移 seek 直写落盘（不经 IndexedDB 内容缓存），断点续传只靠 fileplan 里的分片完成登记；
       全部完成后收尾改名成品。浏览器不允许文件夹句柄跨站携带，故直写仅在句柄所属域（通常为统一主页）生效；
       未授权或直写失败的任务自动回退旧的 IDB 分片缓存模式。 */
    const LocalFile = (function () {
        let chain = Promise.resolve(); // 写盘串行链：并发分片各自 seek+write，互不踩踏
        const writers = new Map();     // taskId -> FileSystemWritableFileStream（不可结构化克隆，绝不能进 IDB，只存内存，按需从 handle 重开）
        const tempSuffix = ".wtmpart";
        async function ensurePerm(dir) {
            try {
                let p = await dir.queryPermission({ mode: "readwrite" });
                if (p !== "granted") p = await dir.requestPermission({ mode: "readwrite" });
                return p === "granted";
            } catch { return false; }
        }
        function planKey(taskId, index) { return `${taskId}:${index}`; }
        async function loadPlan(task) {
            if (!task.workingFile) return null;
            const rec = await Store.getPlan(planKey(task.id, "f"));
            return rec && rec.plan ? rec.plan : null;
        }
        /* 打开（或沿用）本地计划：可续传直链预分配总大小；m3u8 按完成分片累计偏移顺序写。失败返回 null=回退缓存模式 */
        async function openPlan(dir, task) {
            if (!("showDirectoryPicker" in window)) return null;
            if (task.singleBlob || !task.resumable || task.totalChunks <= 0) return null;
            let plan = await loadPlan(task);
            const compatible = plan && plan.name === task.name && plan.type === task.type
                && (task.type !== "file" || (plan.totalSize === task.totalSize && plan.chunkSize === task.chunkSize))
                && !(plan.renamed && plan.status !== "done"); // 改名成品后没下完的残局，重开新文件
            if (plan && !compatible) { await dropLocalFile(dir, task, "重建"); plan = null; }
            if (!plan) {
                if (!(await ensurePerm(dir))) return null;
                plan = { taskId: task.id, name: task.name, tempName: task.name + tempSuffix, type: task.type, totalSize: task.totalSize || 0, chunkSize: task.chunkSize || 0, pairs: [], renamed: false, status: "writing", createdAt: Date.now() };
                try {
                    const fh = await dir.getFileHandle(plan.tempName, { create: true });
                    const w = await fh.createWritable();
                    if (task.resumable && task.type === "file" && task.totalSize > 0) { await w.seek(task.totalSize - 1); await w.write(new Uint8Array(1)); } // 占位：先建全长文件，下载中磁盘可见完整大小
                    await w.close();
                } catch (e) { dlog("openPlan 建文件失败", e && e.message); return null; }
            }
            try { plan.handle = await dir.getFileHandle(plan.tempName); } catch { return null; } // 文件被用户在磁盘上删除
            // 仅持久化可结构化克隆的字段与 handle（FileSystemFileHandle 可克隆）；写流留内存 Map，进 IDB 会抛 DataCloneError
            await Store.putPlan({ key: planKey(task.id, "f"), taskId: task.id, plan });
            task.workingFile = true;
            return plan;
        }
        async function getWriter(taskId, plan) {
            let w = writers.get(taskId);
            if (w) return w;
            w = await plan.handle.createWritable(); // 从持久化的文件句柄重开写流（保留原有字节）
            writers.set(taskId, w);
            return w;
        }
        async function closeWriter(taskId) {
            try { const w = writers.get(taskId); if (w) await w.close(); } catch { } finally { writers.delete(taskId); }
        }
        /* 把一块字节 seek 写到成品偏移（串行链保证并发分片互不踩踏），成功后才计入分片登记；
           写流常驻不关闭（关闭后不可再用），仅在异常时丢弃重建重试一次 */
        async function writeAt(taskId, plan, offset, bytes, size, index) {
            const job = chain.then(async () => {
                const data = bytes instanceof Blob ? bytes : new Blob([bytes]);
                for (let a = 0; a < 2; a++) {
                    try {
                        const w = await getWriter(taskId, plan);
                        await w.seek(offset);
                        w.write(data);
                        break;
                    } catch (e) {
                        await closeWriter(taskId); // 句柄/写流失效：关闭后重开写流重试一次
                        if (a === 0) continue;
                        throw e;
                    }
                }
                if (!plan.pairs.some(p => p[0] === index)) plan.pairs.push([index, size]);
                await Store.putPlan({ key: planKey(taskId, "f"), taskId, plan });
            });
            chain = job.then(() => { }, () => { });
            return job;
        }
        function planOffset(plan, task, i) {
            if (task.resumable && task.type === "file") return i * task.chunkSize;
            let off = 0; for (const p of plan.pairs) off += p[1]; return off; // m3u8：按已落盘分片累计（storeChunk 按索引顺序刷盘，此和即当前文件末尾）
        }
        /* 收尾：关闭写流，把 .wtmpart 改名为成品（同名冲突自动加序号），返回成品 File */
        async function finalize(dir, task) {
            const plan = await loadPlan(task);
            if (!plan) return null;
            await closeWriter(task.id); // 关闭写流，确保全部排队字节落盘
            if (!plan.renamed) {
                if (!(await ensurePerm(dir))) throw new Error("保存文件夹权限失效，请在设置里重新选择文件夹后重试");
                const target = await pickName(dir, plan.name);
                await dir.moveEntry(plan.tempName, target); plan.tempName = target; plan.renamed = true; plan.finalName = target;
            }
            plan.status = "done";
            await Store.putPlan({ key: planKey(task.id, "f"), taskId: task.id, plan });
            const f = await plan.handle.getFile();
            return f;
        }
        async function pickName(dir, want) {
            const used = new Set();
            try { for await (const [name] of dir.entries()) used.add(name); } catch { }
            if (!used.has(want)) return want;
            const m = /^(.*)(\.[A-Za-z0-9]{1,6})$/.exec(want) || [want, want, ""];
            for (let n = 2; n < 1000; n++) { const cand = `${m[1]} (${n})${m[2]}`; if (!used.has(cand)) return cand; }
            return want + "." + Date.now();
        }
        /* 放弃本地文件：删 .part 与分片登记，任务回退 IDB 缓存模式从头下载 */
        async function dropLocalFile(dir, task, reason) {
            try {
                const rec = await Store.getPlan(planKey(task.id, "f"));
                const plan = rec && rec.plan;
                task.workingFile = false;
                await Store.deletePlan(planKey(task.id, "f"));
                await Store.clearPlans(task.id);
                await closeWriter(task.id);
                if (!plan || plan.status === "done") return; // 成品（可能已改名交付用户）不静默删除
                try { await dir.removeEntry(plan.tempName); } catch { }
                if (reason !== "重建") mgmapi.message(`已放弃本地直写（${reason}），改用浏览器内缓存继续`, 6000);
            } catch { task.workingFile = false; }
        }
        /* 转封装等场景：取成品 File（未改名时为 .wtmpart，改名后 tempName 即正式名） */
        async function getFileBlob(dir, task) {
            const plan = await loadPlan(task);
            if (!plan) return null;
            try {
                const fh = await dir.getFileHandle(plan.tempName);
                return await fh.getFile();
            } catch { return null; }
        }
        return { ensurePerm, loadPlan, openPlan, closeWriter, writeAt, planOffset, finalize, dropLocalFile, getFileBlob, tempSuffix };
    })();

    /* ==================== 设置 & 任务持久化 ==================== */
    const DEFAULT_SETTINGS = {
        threads: 4,          // 每任务线程数
        chunkMB: 4,          // 分块大小 MB
        concurrency: 2,      // 并发任务数
        autoSave: false,     // 完成后自动另存
        autoResumeOnHome: true, // 下载主页打开时自动续传未完成任务
        showFab: true,          // 页面 ⚡ 悬浮球开关
        showSniff: true,        // 页面嗅探资源列表弹窗开关
        homeUrl: "https://cat-x.github.io/web-downloader/#wtm-home", // 统一下载主页：用户自有 GitHub Pages 壳页（cat-x/web-downloader 仓库，零第三方依赖）
        saveDirName: "",     // 已授权的本地保存文件夹名（File System Access API，引擎页生效）
        convertMp4: true,    // m3u8/TS 完成后默认转封装 MP4（确认面板可改）
        debug: false,        // 调试日志：开启后 F12 控制台输出 [wtm][dbg] 全链路决策日志（默认关，关闭时零开销）
        sanitizeName: true,  // 文件名跨平台自动修正（默认开）：净化 Windows/macOS/Linux/Android 非法字符与保留名，避免无法直接保存
    };
    let settings = Object.assign({}, DEFAULT_SETTINGS);
    const SCRIPT_VER = "2.9.1";
    // 诊断日志：始终记入环形缓冲（dlog.buf，最近 500 条）供面板一键复制；settings.debug 只控制是否同步打到 F12 控制台
    function dlog(...args) {
        try {
            const buf = dlog.buf || (dlog.buf = []);
            buf.push(`[${new Date().toISOString().slice(11, 23)}] ` + args.map(a => (typeof a === "string" ? a : (a && a.message) ? a.message : String(a))).join(" "));
            if (buf.length > 500) buf.splice(0, buf.length - 500);
        } catch { }
        if (!settings.debug) return;
        try { console.log(`[wtm][dbg ${new Date().toISOString().slice(11, 23)}]`, ...args); } catch { }
    }
    // 历史内置默认外壳（IANA 示例域、纯 http 的 neverssl、涂鸦用的梗站）：本地存过旧值时自动迁移到新默认
    const LEGACY_HOME_URLS = ["https://example.com/#wtm-home", "http://neverssl.com/#wtm-home", "https://motherfuckingwebsite.com/#wtm-home"];
    let tasks = [];
    const state = { tab: "active", panelOpen: false, maximized: false, highlightId: "" };

    /* ---- 跨标签页同步：本页唯一 ID + 删除墓碑 + 合并存储 ---- */
    const PAGE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const deletedTs = new Map(); // id -> 删除时间戳（防止已删任务被其它标签页同步回来）
    // Tampermonkey 默认也注入 iframe：子框架只嗅探并把结果投送给最顶层框架，
    // UI/任务管理全部收敛到顶层，避免同一页面多套面板“互不相通”
    const IN_FRAME = (() => { try { return window.top !== window.self; } catch { return true; } })();
    let lastPolledTasksRaw = ""; // 对账轮询基准：与本写入页最近一次落盘原文一致则跳过

    function touch(t) { t.updatedAt = Date.now(); }

    function parseStored(raw) {
        if (!raw || typeof raw !== "string") return { list: [], deleted: {} };
        try {
            const o = JSON.parse(raw);
            if (o && Array.isArray(o.tasks)) return { list: o.tasks, deleted: o.deleted || {} };
            if (Array.isArray(o)) return { list: o, deleted: {} }; // 旧版纯数组格式
        } catch { }
        return { list: [], deleted: {} };
    }

    /* 远程列表 + 本地列表 按 id 合并，updatedAt 新者胜出；本页在跑的任务以本地为准 */
    function mergeTasks(remoteArr, localArr) {
        const map = new Map();
        for (const r of remoteArr) {
            const tb = deletedTs.get(r.id);
            if (tb && (r.updatedAt || 0) <= tb) continue;
            map.set(r.id, r);
        }
        for (const l of localArr) {
            const r = map.get(l.id);
            if (!r || rts.has(l.id)) { map.set(l.id, l); continue; }
            map.set(l.id, (l.updatedAt || 0) >= (r.updatedAt || 0) ? l : r);
        }
        return Array.from(map.values());
    }

    let saveTimer = null;
    function saveTasks() {
        if (saveTimer) return;
        saveTimer = setTimeout(() => { saveTimer = null; saveTasksNow(); }, 500);
    }
    // 落盘串行链：进度驱动的高频即时写入，不允许读-合并-写交错
    let saveChain = Promise.resolve();
    function saveTasksNow() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        saveChain = saveChain.then(doSaveTasksNow).catch(() => { });
        return saveChain;
    }
    async function doSaveTasksNow() {
        try {
            const remote = parseStored(await mgmapi.getValue("wtm-tasks", ""));
            const localPruned = tasks.filter(t => {
                const tb = deletedTs.get(t.id);
                return rts.has(t.id) || !(tb && (t.updatedAt || 0) <= tb);
            });
            const merged = mergeTasks(remote.list, localPruned);
            tasks = merged;
            const raw = JSON.stringify({ v: 2, tasks: merged, deleted: Object.fromEntries(deletedTs) });
            lastPolledTasksRaw = raw; // 自己写的，对账轮询不必再处理
            await mgmapi.setValue("wtm-tasks", raw);
        } catch (e) { console.warn("[wtm] save tasks failed", e); }
    }
    /* 事件驱动落盘：后台标签页的定时器会被浏览器节流（心跳/节流写可能几十秒才跑一次），
       而下载的网络回调不受影响——分片落地/进度回调时即时写盘并续认领时间，
       其它标签页才能实时看到进度、且不会把活着的属主误判为已死 */
    let lastFlushTs = 0;
    function flushProgress(task) {
        const now = Date.now();
        if (now - lastFlushTs < 800) return false;
        lastFlushTs = now;
        task.ownerTs = now;
        touch(task);
        saveTasksNow();
        return true;
    }

    /* ==================== 下载引擎 ==================== */
    const rts = new Map(); // taskId -> runtime

    const STATUS_TEXT = {
        queued: "排队中",
        downloading: "下载中",
        paused: "已暂停",
        merging: "合并中",
        done: "已完成",
        error: "失败",
    };

    function findTask(id) { return tasks.find(t => t.id === id); }

    function setStatus(t, s) {
        t.status = s;
        touch(t);
        if (s === "done") t.finishedAt = Date.now();
        if (s !== "error") t.error = "";
        saveTasks();
        notifyUI();
    }

    function abortRuntime(rt) {
        if (!rt) return;
        rt.abort = true;
        for (const e of rt.handles) { try { e.abort(); } catch { } }
        rt.handles.clear();
    }

    /* ---- 内置轻量 m3u8 解析（零依赖，避免 @require CDN 加载失败导致整个脚本不执行） ---- */
    function parseM3U(text, baseUrl) {
        const lines = String(text).split(/\r?\n/);
        const out = { playlists: [], segments: [], hasKey: false, totalDuration: 0 };
        let pendingStreamInf = null;
        let lastInf = 0;
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            if (line.startsWith("#EXT-X-KEY")) { if (!/METHOD=NONE/.test(line)) out.hasKey = true; continue; }
            if (line.startsWith("#EXT-X-STREAM-INF")) { pendingStreamInf = line; continue; }
            if (line.startsWith("#EXT-X-ENDLIST") || line.startsWith("#EXT-X-MEDIA:") || line.startsWith("#EXT-X-INDEPENDENT-SEGMENTS")) continue;
            if (line.startsWith("#")) {
                const inf = /^#EXTINF:\s*([\d.]+)/.exec(line);
                if (inf) lastInf = +inf[1];
                continue;
            }
            let abs = "";
            try { abs = new URL(line, baseUrl).href; } catch { continue; }
            if (pendingStreamInf !== null) {
                const bw = +( ( /BANDWIDTH=(\d+)/.exec(pendingStreamInf) || [0, "0"])[1] || 0 );
                out.playlists.push({ uri: abs, bandwidth: bw });
                pendingStreamInf = null;
                continue;
            }
            out.segments.push({ url: abs });
            out.totalDuration += lastInf || 0;
            lastInf = 0;
        }
        return out;
    }

    /* ---- m3u8 解析 ---- */
    /* ---- 可中止通道：有运行时一律走 xhrWithHandle，保证任何阶段都能被暂停 ---- */
    function gxhr(rt, opt) { return rt ? xhrWithHandle(rt, opt) : xhr(opt); }
    /* 页面上下文原生 fetch：由站点自身页面发起，Origin/Sec-Fetch-* 等真实身份由浏览器控制、无法伪造，
       与播放器取流完全同构——这是能过 Cloudflare/防盗链的关键。GM_xmlhttpRequest 从扩展后台发起，
       这些头缺失或异常，常被判 403（老脚本 / 早期版本能下正因它用的是页面 fetch）。credentials 用默认
       same-origin：跨源分片不带 Cookie（与播放器一致，靠 URL token 鉴权），避免 CDN 回 ACAO:* 时带 include
       反而被浏览器拦；同源清单则照常带 Cookie。返回原生 Response。 */
    function fetchViaPage(rt, url, init) {
        return new Promise((resolve, reject) => {
            const W = (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;
            const f = (W && typeof W.fetch === "function") ? W.fetch.bind(W) : null;
            if (!f) { reject(new Error("页面上下文 fetch 不可用")); return; }
            let settled = false;
            const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
            const entry = { abort() { try { ctrl && ctrl.abort(); } catch { } if (!settled) { settled = true; if (rt) rt.handles.delete(entry); reject(new Error("请求已中止")); } } };
            if (rt) rt.handles.add(entry);
            const opts = Object.assign({ credentials: "same-origin", cache: "no-store", redirect: "follow" }, init || {});
            if (ctrl) opts.signal = ctrl.signal;
            let p;
            try { p = f(url, opts); } catch (e) { if (rt) rt.handles.delete(entry); reject(e instanceof Error ? e : new Error(String(e))); return; }
            p.then(res => { if (settled) return; settled = true; if (rt) rt.handles.delete(entry); resolve(res); })
             .catch(e => { if (settled) return; settled = true; if (rt) rt.handles.delete(entry); reject(e instanceof Error ? e : new Error(String(e))); });
        });
    }
    function pageReferrerInit(referer) {
        // fetch 的 referrer 仅在同源时生效；referer 与当前页同源才显式携带（异源浏览器会忽略，不影响）
        const init = { method: "GET" };
        if (referer) { try { const u = new URL(referer); if (u.origin === location.origin) init.referrer = referer; } catch { } }
        return init;
    }
    async function fetchText(url, referer, rt) {
        // 1) 优先页面上下文原生 fetch（同源会话，能过 Cloudflare/防盗链）
        try {
            const res = await fetchViaPage(rt, url, pageReferrerInit(referer));
            if (res && res.ok) {
                const text = await res.text();
                if (text && text.length) return text;
                dlog("fetchText 页面fetch空body→回退GM_xhr", String(url).slice(0, 120));
            } else {
                dlog("fetchText 页面fetch非2xx→回退GM_xhr", "HTTP " + (res && res.status), String(url).slice(0, 120));
            }
        } catch (e) {
            if (rt && rt.abort) throw e; // 暂停中止：直接上抛
            dlog("fetchText 页面fetch异常→回退GM_xhr", String(url).slice(0, 120), (e && e.message) || e);
        }
        // 2) 兜底：GM_xmlhttpRequest（扩展后台发起，无页面会话，可能被 CF 拦；保留兼容不支持跨源 fetch 的站点）
        const headers = {};
        if (referer) { try { const u = new URL(referer); headers.Origin = u.origin; headers.Referer = referer; } catch { headers.Referer = referer; } }
        let r;
        try {
            r = await gxhr(rt, { method: "GET", url, headers, timeout: 30000 });
        } catch (e) {
            dlog("fetchText 网络异常", String(url).slice(0, 140), (e && e.message) || e); throw e;
        }
        if ((r.status === 401 || r.status === 403) && headers.Origin) { // 部分 WAF 见跨源 Origin 即拦：去 Origin 只留 Referer 重试一次
            dlog("fetchText 403→去 Origin 重试", "HTTP " + r.status, String(url).slice(0, 140));
            r = await gxhr(rt, { method: "GET", url, headers: referer ? { Referer: referer } : {}, timeout: 30000 });
        }
        if (r.status < 200 || r.status >= 400) { dlog("fetchText 失败", "HTTP " + r.status, String(url).slice(0, 140), "referer=" + (referer || "无")); throw new Error("HTTP " + r.status + (/blocked|cloudflare|attention required/i.test(r.responseText || "") ? "（源站 Cloudflare 防护拦截，需换源或在源站页重试）" : "")); }
        return r.responseText || "";
    }
    async function loadManifest(url, referer, depth = 0, rt = null) {
        dlog("loadManifest 开始", url.slice(0, 120), "depth=" + depth);
        const text = await fetchText(url, referer, rt);
        if (!/#EXTM3U/.test(text)) throw new Error("不是有效的 m3u8 播放列表");
        const m = parseM3U(text, url);
        if (m.hasKey) throw new Error("加密流（EXT-X-KEY）暂不支持");
        if (m.playlists.length) {
            if (depth >= 3) throw new Error("m3u8 层级过深");
            const best = m.playlists.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
            dlog("loadManifest 多码率→选最高", best.bandwidth, best.uri.slice(0, 120));
            return await loadManifest(best.uri, referer, depth + 1, rt);
        }
        if (!m.segments.length) throw new Error("没有可下载的分片（可能是直播流已结束）");
        return { segments: m.segments, duration: m.totalDuration };
    }

    /* ---- 文件任务探测（大小 / Range 支持 / 文件名） ---- */
    async function planFile(task, rt) {
        const h = refHeader(task);
        h.Range = "bytes=0-0";
        let r = null;
        try {
            r = await gxhr(rt, { method: "GET", url: task.url, headers: h, responseType: "arraybuffer", timeout: 25000 });
        } catch (e) { }
        task.mime = headerOf(r, "content-type") || "application/octet-stream";
        const fn = nameFromDisposition(headerOf(r, "content-disposition"));
        if (fn && !task.named) task.name = task.sanitize === false ? fn : sanitizeFileName(fn); // 服务端改名也遵循任务级勾选
        if (r && r.status === 206) {
            const m = /\/\s*(\d+)\s*$/.exec(headerOf(r, "content-range") || "");
            if (m) { task.totalSize = +m[1]; task.resumable = true; }
        }
        if (!task.resumable && r && r.status === 200) {
            // 服务器不支持 Range：探测时已拿到整个文件，直接作为唯一分片入库
            const blob = new Blob([r.response]);
            task.totalSize = blob.size;
            task.resumable = false;
            task.singleBlob = true;
            if (blob.size > 0) await Store.putChunk(task.id, 0, blob, blob.size);
        }
        if (!task.resumable && !task.singleBlob && !task.workingFile) {
            // 探测失败退回 HEAD
            try {
                const hr = await gxhr(rt, { method: "HEAD", url: task.url, headers: refHeader(task), timeout: 20000 });
                task.totalSize = +headerOf(hr, "content-length") || 0;
                task.resumable = /bytes/i.test(headerOf(hr, "accept-ranges"));
                const fn2 = nameFromDisposition(headerOf(hr, "content-disposition"));
                if (fn2 && !task.named) task.name = task.sanitize === false ? fn2 : sanitizeFileName(fn2);
                if (!task.mime || task.mime === "application/octet-stream") task.mime = headerOf(hr, "content-type") || task.mime;
            } catch { }
        }
        if (!task.name) task.name = nameFromUrl(task.url);
        if (task.resumable && task.totalSize > 0) {
            task.chunkSize = Math.max(1, settings.chunkMB) * 1048576;
            task.totalChunks = Math.ceil(task.totalSize / task.chunkSize);
        } else {
            task.chunkSize = task.totalSize || Infinity;
            task.totalChunks = 1;
        }
        // 已授权保存文件夹：直写本地文件——先建占位文件，分片 seek 落盘，不经 IndexedDB；失败自动回退缓存模式
        if (dirHandle && !task.singleBlob && task.resumable && task.totalSize > 0) {
            try { const plan = await LocalFile.openPlan(dirHandle, task); if (plan) dlog("planFile 直写本地", task.name, "总大小 " + task.totalSize); } catch (e) { task.workingFile = false; dlog("planFile 直写不可用", e && e.message); }
        }
        if (!task.workingFile && task.singleBlob && task.totalSize > 0) {
            // 回退场景：此前直写过但本次降级缓存，旧登记作废
            await Store.clearPlans(task.id);
            task.workingFile = false;
        }
        task.planned = true;
    }

    async function planM3U8(task, rt) {
        if (!rt.segments) rt.segments = (await loadManifest(task.url, task.referer, 0, rt)).segments.map(s => s.url);
        const count = rt.segments.length;
        if (task.totalChunks !== count) {
            // 分片数变化（如直播/列表更新），旧缓存/旧直写文件作废
            await Store.clearChunks(task.id);
            if (task.workingFile) { try { await LocalFile.dropLocalFile(dirHandle, task, "分片列表变化"); } catch { } }
            task.downloaded = 0;
            task.doneCount = 0;
            task.totalChunks = count;
            task.bytesOffset = 0;
        }
        task.totalSize = 0;
        task.chunkSize = 1;
        task.resumable = true;
        if (!task.name) task.name = nameFromUrl(task.url).replace(/\.\w{1,6}$/, "") + ".ts";
        else task.name = ensureExt(task.name, ".ts");
        // openPlan 需 resumable/totalChunks/name 就绪后才能生效（旧代码顺序颠倒导致 m3u8 直写从不激活）
        if (!task.workingFile && dirHandle) {
            try { const plan = await LocalFile.openPlan(dirHandle, task); if (plan) dlog("planM3U8 直写本地", task.name, count + " 分片"); } catch (e) { task.workingFile = false; dlog("planM3U8 直写不可用", e && e.message); }
        }
        if (!task.workingFile && task.totalChunks === count) await Store.clearPlans(task.id); // 缓存模式下清除残留登记
        task.planned = true;
    }

    /* ---- 分片下载 ---- */
    async function fetchChunk(task, i, rt) {
        if (task.type === "m3u8") {
            const segUrl = rt.segments[i];
            // 1) 优先页面上下文原生 fetch（同源会话，能过 Cloudflare/防盗链）
            try {
                const res = await fetchViaPage(rt, segUrl, pageReferrerInit(task.referer));
                if (res && res.ok) {
                    const buf = await res.arrayBuffer();
                    if (!buf || !buf.byteLength) throw new Error("空响应");
                    return new Uint8Array(buf);
                }
                dlog("分片页面fetch非2xx→回退GM_xhr", i, "HTTP " + (res && res.status));
            } catch (e) {
                if (rt && rt.abort) throw e;         // 暂停中止：上抛由 worker 处理
                if (e && e.message === "空响应") throw e;
                dlog("分片页面fetch异常→回退GM_xhr", i, (e && e.message) || e);
            }
            // 2) 兜底：GM_xmlhttpRequest
            let r = await xhrWithHandle(rt, {
                method: "GET", url: segUrl, responseType: "arraybuffer",
                headers: refHeader(task),
            });
            if ((r.status === 401 || r.status === 403) && task.referer) { // 部分 WAF 见跨源 Origin 头即 403：去 Origin 只留 Referer 重试一次
                dlog("分片 403→去 Origin 重试", i, "referer=" + task.referer);
                const h = refHeader(task); delete h.Origin;
                r = await xhrWithHandle(rt, { method: "GET", url: segUrl, responseType: "arraybuffer", headers: h });
            }
            if (r.status < 200 || r.status >= 400) { dlog("分片失败", i, "HTTP " + r.status, "referer=" + (task.referer || "无")); throw new Error("HTTP " + r.status); }
            return new Uint8Array(r.response);
        }
        const headers = refHeader(task);
        let expect = 200;
        if (task.resumable) {
            const start = i * task.chunkSize;
            const end = Math.min(start + task.chunkSize - 1, task.totalSize - 1);
            headers.Range = `bytes=${start}-${end}`;
            expect = 206;
        }
        let r = await xhrWithHandle(rt, {
            method: "GET", url: task.url, headers, responseType: "arraybuffer",
            onprogress: ev => { try { if (ev && ev.lengthComputable) { rt.live.set(i, Math.min(ev.loaded, task.resumable ? task.chunkSize : (task.totalSize || ev.loaded))); flushProgress(task); } } catch { } },
        });
        rt.live.delete(i);
        if ((r.status === 401 || r.status === 403) && headers.Origin && task.referer) { // 同上：403 时去 Origin 重试
            dlog("文件分片 403→去 Origin 重试", i, "referer=" + task.referer);
            delete headers.Origin;
            r = await xhrWithHandle(rt, { method: "GET", url: task.url, headers, responseType: "arraybuffer" });
            rt.live.delete(i);
        }
        if (r.status !== expect) { dlog("文件分片失败", i, "HTTP " + r.status, "referer=" + (task.referer || "无")); throw new Error("HTTP " + r.status + (task.resumable ? "（Range 失效？可用「换址」重试）" : "")); }
        if (!r.response || (task.totalSize > 0 && r.response.byteLength === 0)) throw new Error("空响应");
        return new Uint8Array(r.response);
    }

    /* ---- 分片落地：直写本地文件优先（登记成功才算完成），否则入 IDB 缓存 ---- */
    async function storeChunk(task, i, bytes, size, rt) {
        if (task.workingFile) {
            try {
                const plan = await LocalFile.loadPlan(task);
                if (!plan) throw Object.assign(new Error("计划丢失"), { drop: true });
                if (task.type === "m3u8") {
                    // m3u8 偏移=已落盘字节累计，并发完成顺序≠索引顺序，乱序写会串位损坏：入缓冲，按索引顺序刷盘
                    rt.wbuf.set(i, bytes);
                    while (rt.wbuf.has(rt.nextWrite)) {
                        const idx = rt.nextWrite;
                        const b = rt.wbuf.get(idx);
                        rt.wbuf.delete(idx);
                        await LocalFile.writeAt(task.id, plan, LocalFile.planOffset(plan, task, idx), b, b.byteLength, idx);
                        rt.nextWrite++;
                    }
                } else {
                    await LocalFile.writeAt(task.id, plan, LocalFile.planOffset(plan, task, i), bytes, size, i);
                }
            } catch (e) {
                await LocalFile.dropLocalFile(dirHandle, task, (e && e.name === "NotFoundError") ? "本地文件已被删除" : "直写失败");
                await Store.clearChunks(task.id); // 残留旧分片不可信，作废后全量走缓存模式
                task.planned = false;              // 重新规划（回退块大小/分片数），本块重新下载
                throw e;
            }
            return;
        }
        await Store.putChunk(task.id, i, new Blob([bytes]), size);
    }

    async function worker(rt, task) {
        while (rt.queue.length) {
            if (rt.abort) return;
            const i = rt.queue.shift();
            let ok = false, lastErr = null;
            for (let a = 0; a < 3 && !rt.abort; a++) {
                try {
                    const bytes = await fetchChunk(task, i, rt);
                    const size = bytes.byteLength;
                    await storeChunk(task, i, bytes, size, rt);
                    task.downloaded += size;
                    task.doneCount = (task.doneCount || 0) + 1;
                    touch(task);
                    if (!flushProgress(task)) saveTasks();
                    ok = true;
                    break;
                } catch (e) {
                    lastErr = e;
                    if (rt.abort) return;
                    await delay(600 * (a + 1));
                }
            }
            if (!ok) throw new Error(`第 ${i + 1} 个分片下载失败：${lastErr ? lastErr.message : "未知错误"}`);
        }
    }

    /* ---- 完成收尾：直写模式文件已在磁盘只需改名；缓存模式合并分片入库 ---- */
    async function mergeFinish(task, rt) {
        if (task.workingFile) {
            // 直写收尾：全部分片已落盘，关闭写流 + 改名成品即完成，零内存合并
            setStatus(task, "merging");
            if (rt && rt.abort) { setStatus(task, "paused"); return; }
            const f = await LocalFile.finalize(dirHandle, task);
            if (!f) throw new Error("本地文件计划丢失，请点击「继续」重新下载");
            task.finalSize = f.size;
            task.name = f.name; // 改名冲突加了序号时同步显示
            setStatus(task, "done");
            mgmapi.message(`下载完成：${task.name}（已直接保存在文件夹「${dirHandle ? dirHandle.name : "本地"}」）`);
            if (task.mp4 && tsLike(task)) startConvert(task.id); // 转封装完成后由 finishConvert 按 autoSave 另存 MP4
            return;
        }
        setStatus(task, "merging");
        const parts = [];
        for (let i = 0; i < task.totalChunks; i++) {
            if (rt && rt.abort) { setStatus(task, "paused"); return; } // 合并中可暂停：分片全部保留，不算丢缓存
            const rec = await Store.getChunk(task.id, i);
            if (!rec || !rec.blob) {
                task.planned = task.type === "file" ? task.planned : false;
                throw new Error(`分片 ${i + 1} 丢失，请点击「继续」重新补齐`);
            }
            parts.push(rec.blob);
        }
        const type = task.type === "m3u8" ? "video/mp2t" : (task.mime || "application/octet-stream");
        const blob = new Blob(parts, { type });
        parts.length = 0;
        await Store.putFile({ key: task.id, blob, name: task.name, size: blob.size, ts: Date.now() });
        for (let i = 0; i < task.totalChunks; i++) await Store.deleteChunk(task.id, i); // 成功后才清理分片，异常不再删一半
        task.finalSize = blob.size;
        setStatus(task, "done");
        mgmapi.message(`下载完成：${task.name}`);
        if (task.mp4 && tsLike(task)) {
            startConvert(task.id); // 转封装完成后由 finishConvert 按 autoSave 另存 MP4
        } else if (settings.autoSave) { try { await saveAs(task.id); } catch { } }
    }

    /* ---- 主运行流程 ---- */
    async function run(task) {
        if (task.status !== "downloading") return;
        const rt = {
            abort: false, handles: new Set(), live: new Map(), queue: [],
            segments: null, speed: 0, lastBytes: task.downloaded || 0, lastTs: Date.now(), hb: null,
            wbuf: new Map(), nextWrite: 0,
        };
        rts.set(task.id, rt);
        // 心跳：向其它标签页证明“这个任务由本页在跑”，避免重复下载
        task.owner = PAGE_ID;
        task.ownerTs = Date.now();
        task.origin = task.origin || location.origin; // 下载缓存（IDB 分片或本地直写登记）存在当前域名，跨域站点的缓存不互通
        rt.hb = setInterval(() => { task.ownerTs = Date.now(); saveTasks(); }, 3000);
        notifyUI();
        try {
            if (task.type === "m3u8") {
                await planM3U8(task, rt);
            } else if (!task.planned) {
                await planFile(task, rt);
            }
            // 探测/解析阶段被暂停：作废可能不完美的计划，立即归位
            if (rt.abort) { if (task.workingFile) await LocalFile.closeWriter(task.id); task.planned = false; setStatus(task, "paused"); return; }
            let doneIdx = new Set(), downloaded = 0, doneCount = 0;
            if (task.workingFile) {
                // 直写模式：完成分片靠 fileplan 登记重建，已写字节仍在磁盘上
                const plan = await LocalFile.loadPlan(task);
                if (!plan) { task.workingFile = false; task.planned = false; }
                else {
                    await LocalFile.closeWriter(task.id); // 丢弃旧写流，后续按需从 handle 重开
                    for (const [idx, sz] of plan.pairs) { doneIdx.add(idx); downloaded += sz; }
                    doneCount = plan.pairs.length;
                    rt.nextWrite = 0; while (doneIdx.has(rt.nextWrite)) rt.nextWrite++; // m3u8 顺序刷盘从第一个未完成分片继续
                }
            }
            if (!task.workingFile) {
                const dm = await Store.doneMap(task.id);
                let bad = false;
                for (const idx of dm.keys()) if (idx >= task.totalChunks) { bad = true; break; }
                if (bad) { await Store.clearChunks(task.id); dm.clear(); }
                for (const [idx, size] of dm) { downloaded += size; doneCount++; doneIdx.add(idx); }
            }
            task.downloaded = downloaded;
            task.doneCount = doneCount;
            task.bytesOffset = downloaded;
            const queue = [];
            for (let i = 0; i < task.totalChunks; i++) if (!doneIdx.has(i)) queue.push(i);
            rt.queue = queue;
            // 断点续传可视化：明确告知复用了多少已下载分片
            if (doneIdx.size && queue.length) mgmapi.message(`断点续传：复用 ${doneIdx.size} 个已下载分片（${task.workingFile ? "本地文件直写" : "浏览器缓存"}），待补 ${queue.length} 个`, 4000);
            saveTasks();
            const threads = (task.type === "file" && !task.resumable) ? 1 : (task.threads > 0 ? task.threads : settings.threads); // 任务级线程数优先
            if (queue.length) {
                const n = Math.max(1, Math.min(threads, queue.length));
                await Promise.all(Array.from({ length: n }, () => worker(rt, task)));
            }
            if (rt.abort) { if (task.status === "downloading" || task.status === "merging") setStatus(task, "paused"); return; }
            await mergeFinish(task, rt);
        } catch (e) {
            if (rt.abort) {
                if (task.status === "downloading" || task.status === "merging") setStatus(task, "paused");
            } else {
                task.error = (e && e.message) || String(e);
                setStatus(task, "error");
                mgmapi.message(`下载失败：${task.name}（${task.error}）`, 8000);
            }
        } finally {
            clearInterval(rt.hb);
            rts.delete(task.id);
            task.ownerTs = 0; // 释放认领，其它标签页可接管
            await saveTasksNow();
            notifyUI();
            schedule();
        }
    }

    /* ---- 调度器：并发任务数控制（只调度与本页同源、且未被其它存活标签页认领的任务） ---- */
    function schedule() {
        let active = tasks.filter(t => (t.status === "downloading" || t.status === "merging") && rts.has(t.id)).length;
        let slots = Math.max(0, settings.concurrency - active);
        let claimed = false;
        for (const t of tasks) {
            if (slots <= 0) break;
            if (t.status === "queued") {
                if (!canRunHere(t)) continue; // 下载只在任务来源同域页面执行，其它页面/主页只读总览
                if (rts.has(t.id)) { dlog("schedule 跳过", t.id, "旧运行时未退出"); continue; } // 旧运行时还在退出中，由其 finally 末尾的 schedule 接手
                if (ownerAlive(t)) { dlog("schedule 跳过", t.id, "被其它同源标签页认领 owner=" + t.owner); continue; } // 同源另一标签页已认领，不抢任务
                t.owner = PAGE_ID;
                t.ownerTs = Date.now();
                touch(t);
                t.status = "downloading";
                slots--;
                claimed = true;
                dlog("schedule 启动", t.id, t.name, "origin=" + t.origin);
                run(t);
            }
        }
        if (claimed || tasks.some(canRunHere)) saveTasks(); // 只读页不回写，避免覆盖来源页的下载进度
        notifyUI();
    }

    /* ---- 跨标签页同步与命令通道 ---- */
    function ownerAlive(t) { // 配合 flushProgress 事件驱动续期，窗口放宽到 20s，容忍后台页定时器被节流后的写入空档
        return !!(t && t.owner && t.owner !== PAGE_ID && t.ownerTs && (Date.now() - t.ownerTs < 20000)
            && (t.status === "downloading" || t.status === "merging"));
    }

    function sendCmd(id, action, extra) {
        const c = Object.assign({ id, action, by: PAGE_ID, ts: Date.now() }, extra || {});
        dlog("sendCmd", action, id, "by=" + PAGE_ID);
        mgmapi.setValue("wtm-cmd", JSON.stringify(c)).catch(() => { });
    }

    function onCmd(raw) {
        let c;
        try { c = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)); } catch { return; }
        if (!c || c.by === PAGE_ID) return;
        if (Date.now() - (c.ts || 0) > 60000) { dlog("onCmd 丢弃（超 60s 过期）", c.action, c.id, Date.now() - (c.ts || 0) + "ms"); return; } // 60s 过期：引擎可能正被后台唤起，留出启动时间
        const rt = rts.get(c.id);
        dlog("onCmd 收到", c.action, c.id, "rt=" + !!rt, "engine=" + isEngine());
        if (c.action === "pause") { if (rt) abortRuntime(rt); return; }
        const ot = findTask(c.id);
        if (!(ot && canRunHere(ot)) && !rt) return; // 只有与任务同源的页面能操作其本地运行/成品文件
        if (c.action === "delete") {
            if (rt) abortRuntime(rt);
            removeTask(c.id, true);
        } else if (c.action === "changeUrl") {
            if (rt) abortRuntime(rt);
            if (ot) { mgmapi.message(`已更新任务「${ot.name}」地址并从断点续传`); applyUrlChange(ot, c.url); }
        } else if (c.action === "saveAs") {
            saveAsInternal(c.id).then(rec => { if (rec) mgmapi.message(`已开始下载：${rec.name}`); }).catch(e => mgmapi.message("另存失败：" + e.message));
        } else if (c.action === "convert") {
            startConvert(c.id); // 转 MP4 需读同源域的成品文件，仅来源页面执行
        }
    }

    function onRemoteTasksUpdate(raw) {
        const st = parseStored(typeof raw === "string" ? raw : "");
        for (const [id, ts] of Object.entries(st.deleted || {})) {
            if (!deletedTs.has(id) || deletedTs.get(id) < ts) deletedTs.set(id, ts);
        }
        let changed = false;
        for (const r of st.list) {
            if (rts.has(r.id)) { // 本页在跑：数据本地为准，但远端“已暂停”是用户操作意图，必须执行中止
                const lt = tasks.find(x => x.id === r.id);
                if (r.status === "paused" && lt && (lt.status === "downloading" || lt.status === "merging")) { dlog("sync 远端暂停意图→中止本地运行时", r.id); abortRuntime(rts.get(r.id)); }
                continue;
            }
            const tomb = deletedTs.get(r.id);
            if (tomb && (r.updatedAt || 0) <= tomb) continue;
            const i = tasks.findIndex(x => x.id === r.id);
            if (i < 0) {
                if ((r.status === "downloading" || r.status === "merging") && !ownerAlive(r)) r.status = "paused";
                tasks.push(r);
                changed = true;
            } else if ((r.updatedAt || 0) > (tasks[i].updatedAt || 0)) {
                tasks[i] = r;
                changed = true;
            }
        }
        tasks = tasks.filter(t => {
            if (rts.has(t.id)) return true;
            const tb = deletedTs.get(t.id);
            return !(tb && (t.updatedAt || 0) <= tb);
        });
        if (changed) { dlog("sync 远端任务合并生效", st.list.length, "条"); notifyUI(); schedule(); }
    }

    /* 设置跨页同步：homeUrl/入口/嗅探开关变更后所有页面跟随刷新——
       否则各页 settings 漂移：可能出现两个标签都自认主页（双引擎并发）或都没引擎干活 */
    let lastSettingsRaw = "";
    function applyRemoteSettings(raw) {
        try {
            const s = JSON.parse(raw || "null");
            if (!s) return;
            Object.assign(settings, DEFAULT_SETTINGS, s);
            if (LEGACY_HOME_URLS.includes(settings.homeUrl)) settings.homeUrl = DEFAULT_SETTINGS.homeUrl; // 旧默认外壳迁移
            dlog("sync 设置变更应用", "homeUrl=" + settings.homeUrl, "debug=" + settings.debug);
            snifferEnabled = settings.sniff !== false;
            applyEntryVisibility();
            buildMenu();
            if (els.panel) applyRoute(); // homeUrl 变化时主页/引擎身份可能改变
            schedule();
        } catch { }
    }
    
    /* 存储对账一次：GM 事件可能丢，定时比对存储原文自愈（也供面板打开时立即取最新） */
    let lastCmdRaw = "", lastSniffRaw = "";
    async function pollStorageOnce() {
        try {
            const tr = await mgmapi.getValue("wtm-tasks", "");
            if (tr && tr !== lastPolledTasksRaw) { lastPolledTasksRaw = tr; onRemoteTasksUpdate(tr); }
            const cr = await mgmapi.getValue("wtm-cmd", "");
            if (cr && cr !== lastCmdRaw) { lastCmdRaw = cr; onCmd(cr); }
            const sr = await mgmapi.getValue("wtm-sniff-in", "");
            if (sr && sr !== lastSniffRaw) { lastSniffRaw = sr; onSniffRelay(sr); }
            const usr = await mgmapi.getValue("wtm-settings", "");
            if (usr && usr !== lastSettingsRaw) { lastSettingsRaw = usr; applyRemoteSettings(usr); }
        } catch { }
    }
    // 面板打开时快速对账（1.2s）：保证哪个页面打开面板，看到的内容/进度都一致；关闭后停回 4s
    let fastPoll = null;
    function startFastPoll() { if (!fastPoll) fastPoll = setInterval(pollStorageOnce, 1200); }
    function stopFastPoll() { if (fastPoll) { clearInterval(fastPoll); fastPoll = null; } }
    
    function watchStorage() {
        const f = (typeof GM_addValueChangeListener === "function") ? GM_addValueChangeListener
            : ((typeof GM !== "undefined" && GM && GM.addValueChangeListener) ? GM.addValueChangeListener.bind(GM) : null);
        if (f) {
            try {
                f("wtm-tasks", (n, o, nv, remote) => { if (remote) { lastPolledTasksRaw = nv; onRemoteTasksUpdate(nv); } });
                f("wtm-cmd", (n, o, nv, remote) => { if (remote) onCmd(nv); });
                f("wtm-sniff-in", (n, o, nv, remote) => { if (remote) onSniffRelay(nv); });
                f("wtm-settings", (n, o, nv, remote) => { if (remote) { lastSettingsRaw = nv; applyRemoteSettings(nv); } });
            } catch { }
        }
        // 对账兜底：无论监听是否可用都定时比对存储，自愈错过的事件（监听器本身丢事件是常见bug）
        setInterval(pollStorageOnce, 4000);
    }

    /* ==================== 对外的任务操作 ==================== */
    function addTask(spec) {
        dlog("addTask 入口", spec.type || "auto", String(spec.url || "").slice(0, 120), "engine=" + isEngine());
        let url = String(spec.url || "").trim();
        if (!url) return null;
        try { url = new URL(url, location.href).href; } catch { mgmapi.message("链接无效"); return null; }
        if (!/^https?:\/\//i.test(url)) { mgmapi.message("仅支持 http(s) 链接"); return null; }
        const type = spec.type || ((url.split("#")[0].split("?")[0].match(/\.(m3u8?)([?#]|$)/i)) ? "m3u8" : "file");
        // 任务排重
        const dup = tasks.find(t => t.url === url && t.type === type && t.status !== "done");
        if (dup) {
            dlog("addTask 排重命中", dup.id, dup.name, dup.status);
            mgmapi.message(`已有相同任务：${dup.name}`);
            state.tab = "active";
            state.highlightId = dup.id;
            openPanel();
            notifyUI();
            return dup;
        }
        const t = {
            id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type,
            url,
            name: finalName(spec, url, type), // 唯一收口：补扩展名 + 跨平台净化（任务级勾选优先，其次全局设置）
            sanitize: sanitizeOn(spec),       // 逐任务记住净化选择（后续服务端改名等同样遵循）
            referer: spec.referer || location.href,
            named: !!spec.name,
            threads: clamp(parseInt(spec.threads) || 0, 0, 8), // 每任务独立线程数，0=跟随全局默认
            status: spec.startNow === false ? "paused" : "queued", // 确认面板可选“稍后开始（排队）”
            mp4: !!spec.mp4, converting: false, mp4Error: "", // 转封装 MP4 选项与状态
            owner: "", ownerTs: 0, origin: location.origin, updatedAt: Date.now(), // 任务绑定创建页的域：只有同域页面能跑它
            totalSize: 0, chunkSize: 0, totalChunks: 0,
            downloaded: 0, doneCount: 0,
            planned: false, resumable: false, singleBlob: false,
            workingFile: false, bytesOffset: 0, // 直写本地文件模式：成品临时名 + 已写字节偏移
            mime: "", error: "",
            addedAt: Date.now(), finishedAt: 0, finalSize: 0,
        };
        tasks.push(t);
        dlog("addTask 创建", t.id, t.name, t.status, "threads=" + t.threads, "mp4=" + t.mp4);
        state.tab = "active";
        saveTasksNow();          // 写入共享存储：来源同域页立即执行，主页与其它页面同步为只读总览
        schedule();              // 就在当前页面（资源所在站点域）开始下载——网络身份与站点播放器一致，可通过防盗链/Cloudflare
        if (spec.silent !== true) openPanel();
        notifyUI();
        return t;
    }

    function pauseTask(id) {
        const t = findTask(id);
        if (!t) return;
        const rt = rts.get(id);
        dlog("pauseTask", id, t.status, "rt=" + !!rt, "engine=" + isEngine());
        if (rt) { abortRuntime(rt); notifyUI(); return; } // run() 会确定性地将状态落到已暂停
        if (t.status === "done") return;
        if (["queued", "downloading", "merging"].includes(t.status)) {
            // 双通道：有存活引擎先发命令精准中止；无论成败都本地写 paused——
            // 立即反馈不卡顿，引擎端 onRemoteTasksUpdate 检测到 paused 会中止运行中的任务，不会被反写回“下载中”
            if (ownerAlive(t)) sendCmd(id, "pause");
            setStatus(t, "paused");
        }
        notifyUI();
    }

    function resumeTask(id) {
        const t = findTask(id);
        if (!t) return;
        if (rts.has(id) || ownerAlive(t)) { dlog("resumeTask 忽略（已在跑）", id); mgmapi.message("任务已在下载中"); return; }
        if (t.status === "done") return;
        t.error = "";
        setStatus(t, "queued");
        if (canRunHere(t)) schedule();
        else ensureSourceTab(t); // 任务属于其它站点：本页面无法代发其请求，打开来源页由其继续下载
    }

    async function removeTask(id, fromCmd) {
        const t = findTask(id);
        if (!t) return;
        abortRuntime(rts.get(id));
        if (!fromCmd) sendCmd(id, "delete"); // 广播删除：同源的其它标签页据此清理本地成品与直写文件
        deletedTs.set(id, Date.now()); // 墓碑：所有标签页同步删除
        tasks = tasks.filter(x => x.id !== id);
        try { await Store.clearChunks(t.id); await Store.clearPlans(t.id); } catch { }
        try { await Store.deleteFile(id); await Store.deleteFile("mp4:" + id); if (t.workingFile && dirHandle) await LocalFile.dropLocalFile(dirHandle, t, "任务删除"); } catch { }
        await saveTasksNow();
        notifyUI();
        schedule();
    }

    /* 应用地址变更（不判断远程/本地） */
    async function applyUrlChange(t, newUrl) {
        const urlChanged = t.url !== newUrl;
        t.url = newUrl;
        if (t.type === "file" && urlChanged) {
            if (t.singleBlob) {
                // 整包单分片模式：换址后旧分片不再有效，清空重下
                Store.clearChunks(t.id).then(() => { t.downloaded = 0; t.doneCount = 0; saveTasks(); notifyUI(); });
            }
            if (t.workingFile) { try { await LocalFile.dropLocalFile(dirHandle, t, "更换地址"); } catch { } }
            // 直链过期换新：保留已完成分片，重新探测大小后从断点继续
            t.planned = false;
            t.singleBlob = false;
            t.totalSize = 0;
            t.totalChunks = 0;
        }
        if (t.type === "m3u8") t.planned = false;
        t.error = "";
        setStatus(t, "queued");
        if (canRunHere(t)) schedule();
        else ensureSourceTab(t); // 换址续传须在来源同域页执行
    }

    function changeUrl(id, newUrl) {
        const t = findTask(id);
        if (!t || t.status === "done") return;
        newUrl = String(newUrl || "").trim();
        if (!/^https?:\/\//i.test(newUrl)) { mgmapi.message("新地址无效"); return; }
        if (ownerAlive(t)) {
            sendCmd(id, "changeUrl", { url: newUrl });
            mgmapi.message("任务在其它标签页下载中，已转发换址指令，将自动断点续传");
            return;
        }
        const rt = rts.get(id);
        if (rt) abortRuntime(rt); // run() 退出后 schedule() 会接住新队列
        applyUrlChange(t, newUrl);
        mgmapi.message("已更换下载地址，将尽量从断点继续");
    }

    async function saveAsInternal(id) {
        const t = findTask(id);
        if (!t) return;
        let rec = await Store.getFile(t.id);
        if (!rec || !rec.blob) {
            // 直写本地模式：成品已在授权文件夹里，无需重复另存
            if (t.workingFile && dirHandle) {
                try {
                    const plan = await LocalFile.loadPlan(t);
                    if (plan && plan.status === "done") {
                        if (t.status !== "done") { t.status = "done"; t.finalSize = plan.finalSize || t.finalSize || 0; touch(t); }
                        t.name = plan.finalName || plan.tempName; saveTasks(); notifyUI();
                        mgmapi.message(`已保存在文件夹「${dirHandle.name}」：${t.name}`);
                        return { key: t.id, name: t.name, size: t.finalSize };
                    }
                } catch (e) { dlog("saveAs 本地成品检测失败", e && e.message); }
            }
            throw new Error("成品文件不存在，请在来源站点页面重新下载");
        }
        if (t.mp4) { // 已转封装：另存直接用 MP4 成品
            const mrec = await Store.getFile("mp4:" + t.id);
            if (mrec && mrec.blob) rec = { key: mrec.key, blob: mrec.blob, name: mp4Name(t), size: mrec.size, ts: mrec.ts };
        }
        // 已授权本地文件夹：静默直写（Chrome/Edge File System Access API）
        if (dirHandle && isEngine()) {
            try {
                let perm = "prompt";
                try { perm = await dirHandle.queryPermission({ mode: "readwrite" }); } catch { }
                if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "readwrite" });
                if (perm === "granted") {
                    const fh = await dirHandle.getFileHandle(rec.name || t.name, { create: true });
                    const w = await fh.createWritable();
                    await w.write(rec.blob);
                    await w.close();
                    mgmapi.message(`已保存到文件夹「${dirHandle.name}」：${rec.name || t.name}`);
                    return rec;
                }
            } catch (e) { console.warn("[wtm] 文件夹直写失败，回退浏览器下载", e); }
        }
        const url = URL.createObjectURL(rec.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = rec.name || t.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 120000);
        return rec;
    }
    async function saveAs(id) {
        const t = findTask(id);
        if (!t) return;
        if (!canRunHere(t)) { sendCmd(id, "saveAs"); ensureSourceTab(t); return; } // 成品在来源域，交由同源页面另存
        return saveAsInternal(id);
    }

    /* ==================== 转封装 MP4（ffmpeg.wasm 无损 remux，仅主页执行） ==================== */
    // 设计：ffmpeg 组件与转码全部在“页世界”执行（避开隔离世界无法 eval/工作器的限制），
    // 两侧通过同源 IndexedDB（分片存储不受扩展世界隔离影响）交换数据，组件仅在首次使用时懒加载
    const MP4_CONVERTER_JS = `
(function () {
  if (window.__wtmMp4) return;
  var LIB = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.2/dist/ffmpeg.min.js";
  var CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.5/dist/umd/ffmpeg-core.js";
  var ffmpegP = null;
  function loadLib() {
    return new Promise(function (res, rej) {
      if (window.FFmpeg && window.FFmpeg.createFFmpeg) return res();
      var s = document.createElement("script");
      s.src = LIB;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("FFmpeg 组件加载失败（网络问题或被拦截），稍后重试")); };
      document.documentElement.appendChild(s);
    });
  }
  function getFFmpeg() {
    if (!ffmpegP) ffmpegP = loadLib().then(function () {
      var ff = window.FFmpeg.createFFmpeg({ log: false });
      return ff.load({ corePath: CORE }).then(function () { return ff; });
    });
    return ffmpegP;
  }
  function idb(mode, fn) {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open("wtm-downloader", 3);
      rq.onupgradeneeded = function () { var d = rq.result; if (!d.objectStoreNames.contains("files")) d.createObjectStore("files", { keyPath: "key" }); };
      rq.onerror = function () { rej(rq.error); };
      rq.onsuccess = function () {
        try { fn(rq.result.transaction("files", mode).objectStore("files"), res, rej); } catch (e) { rej(e); }
      };
    });
  }
  function post(m) { try { window.postMessage(Object.assign({ wtm: "mp4-result" }, m), "*"); } catch (e) { } }
  window.__wtmMp4 = true;
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.wtm !== "mp4-convert") return;
    var id = d.taskId;
    Promise.resolve()
      .then(function () {
        if (d.bytes && d.bytes.byteLength) return d.bytes; // 直写本地模式：主页已从磁盘读好成品字节，不经 IndexedDB
        return idb("readonly", function (st, res, rej) { var g = st.get(id); g.onsuccess = function () { res(g.result); }; g.onerror = function () { rej(g.error); }; })
          .then(function (rec) {
            if (!rec || !rec.blob) throw new Error("找不到合并成品");
            return rec.blob.arrayBuffer();
          });
      })
      .then(function (buf) {
        return getFFmpeg().then(function (ff) {
          ff.writeFile("in.ts", new Uint8Array(buf));
          return ff.run("-i", "in.ts", "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "out.mp4")
            .then(function () { return ff.readFile("out.mp4"); });
        });
      })
      .then(function (out) {
        var blob = out instanceof Blob ? out : new Blob([out], { type: "video/mp4" });
        if (d.bytes) { post({ taskId: id, ok: true, size: blob.size, local: true, bytes: blob }); return Promise.resolve(); } // 直写模式：成品回传给主页直接落盘，不存 IDB 副本
        return idb("readwrite", function (st, res, rej) {
          var p = st.put({ key: "mp4:" + id, blob: blob, size: blob.size, ts: Date.now() });
          p.onsuccess = function () { res(); }; p.onerror = function () { rej(p.error); };
        }).then(function () { post({ taskId: id, ok: true, size: blob.size }); });
      })
      .catch(function (e) { post({ taskId: id, ok: false, error: (e && e.message) || String(e) }); });
  });
})();`;
    const uw = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;
    const convertBusy = new Set();
    function tsLike(t) { return t.type === "m3u8" || /[.]ts([?#]|$)/i.test(t.url || ""); }
    function mp4Name(t) { return (t.name || "video").replace(/\.[^.]+$/, "") + ".mp4"; }
    function ensurePageConverter() {
        if (uw.__wtmMp4) return Promise.resolve();
        try {
            const s = document.createElement("script");
            s.textContent = MP4_CONVERTER_JS;
            (document.documentElement || document.body).appendChild(s);
            s.remove();
        } catch (e) { return Promise.reject(new Error("无法注入转换组件（当前页 CSP 限制）")); }
        return uw.__wtmMp4 ? Promise.resolve() : Promise.reject(new Error("转换组件初始化失败"));
    }
    function startConvert(id) {
        const t = findTask(id);
        if (!t) return;
        dlog("startConvert", id, "engine=" + isEngine(), "busy=" + convertBusy.has(id));
        if (!canRunHere(t)) { sendCmd(id, "convert"); ensureSourceTab(t); return; } // 转封装读的是本域成品，须在同源页面进行
        if (convertBusy.has(id) || t.converting) return;
        convertBusy.add(id);
        t.converting = true; t.mp4Error = "";
        touch(t); saveTasksNow(); notifyUI();
        mgmapi.message("MP4 转换中（无损重封装，首次需联网加载组件）…", 6000);
        ensurePageConverter().then(() => {
            if (t.workingFile && dirHandle) {
                // 直写模式：成品在磁盘上，读出字节后直接交给转换器（不经 IndexedDB）
                return LocalFile.getFileBlob(dirHandle, t).then(f => {
                    if (!f) throw new Error("本地成品文件不存在，可能被移动或删除");
                    return f.arrayBuffer().then(buf => { postMessage({ wtm: "mp4-convert", taskId: id, bytes: buf }, "*"); });
                });
            }
            postMessage({ wtm: "mp4-convert", taskId: id }, "*");
        }).catch(e => finishConvert(id, false, { error: e.message }));
    }
    async function finishConvert(id, ok, info) {
        convertBusy.delete(id);
        const t = findTask(id);
        if (!t) return;
        dlog("finishConvert", id, ok ? "成功" : "失败: " + ((info && info.error) || ""));
        t.converting = false;
        if (ok) { t.mp4 = true; t.mp4Size = (info && info.size) || 0; }
        else { t.mp4 = false; t.mp4Error = (info && info.error) || "转换失败"; }
        if (ok && info && info.local && info.bytes && dirHandle) {
            // 直写模式：MP4 成品直接写入授权文件夹（同名自动加序号），并清理源 TS
            try {
                await LocalFile.ensurePerm(dirHandle);
                const mp4FileName = mp4Name(t);
                const fh = await dirHandle.getFileHandle(mp4FileName, { create: true });
                const w = await fh.createWritable();
                await w.write(info.bytes instanceof Blob ? info.bytes : new Blob([info.bytes]));
                await w.close();
                t.finalSize = (info && info.size) || t.finalSize;
                try { await dirHandle.removeEntry(t.name); } catch { } // 源 TS 已由 MP4 取代
                const plan = await LocalFile.loadPlan(t);
                if (plan) { plan.tempName = mp4FileName; plan.finalSize = t.finalSize; await Store.putPlan({ key: `${t.id}:f`, taskId: t.id, plan }); } // 后续另存/删除指向 MP4 成品
                dlog("MP4 直写完成", mp4FileName);
            } catch (e) { console.warn("[wtm] MP4 直写失败，回退另存", e); }
        }
        touch(t); await saveTasksNow(); notifyUI();
        if (ok) {
            mgmapi.message(`已转成 MP4（${fmtSize(t.mp4Size)}）：${mp4Name(t)}`);
            if (settings.autoSave) { try { await saveAs(t.id); } catch { } } // 自动另存优先用 MP4 成品
        } else {
            mgmapi.message("MP4 转换失败：" + t.mp4Error + "（TS 成品仍保留，可正常另存）", 8000);
        }
    }

    /* ==================== 嗅探：m3u8 / video ==================== */
    const shownUrls = [];
    function noteShown(u) { if (shownUrls.length > 300) shownUrls.splice(0, 150); shownUrls.push(u); } // 封顶防止长会话无限增长
    let snifferEnabled = true;

    function sniffStart() {
        let _r_text;
        try { _r_text = unsafeWindow.Response.prototype.text; } catch { return; }
        unsafeWindow.Response.prototype.text = function () {
            return new Promise((resolve, reject) => {
                _r_text.call(this).then(text => {
                    resolve(text);
                    try { if (snifferEnabled && text && text.trim().startsWith("#EXTM3U")) doM3U({ url: this.url, content: text }); } catch { }
                }).catch(reject);
            });
        };
        const _open = unsafeWindow.XMLHttpRequest.prototype.open;
        unsafeWindow.XMLHttpRequest.prototype.open = function (...args) {
            this.addEventListener("load", () => {
                try {
                    const content = this.responseText;
                    if (snifferEnabled && content && content.trim().startsWith("#EXTM3U")) doM3U({ url: args[1], content });
                } catch { }
            });
            return _open.apply(this, args);
        };
        setInterval(doVideos, 1500);
    }

    function doVideos() {
        if (!snifferEnabled) return;
        for (const v of Array.from(document.querySelectorAll("video"))) {
            if (v.duration && v.src && v.src.startsWith("http") && !shownUrls.includes(v.src)) {
                noteShown(v.src);
                showSniffItem({
                    type: "video",
                    url: v.src,
                    duration: `${Math.ceil(v.duration * 10 / 60) / 10} 分钟`,
                    onDownload() {
                        askConfirm({ type: "file", url: v.src, referer: location.href }); // 名字交给 askConfirm 动态判定（URL 有意义名优先，否则取顶层标题）
                    }
                });
            }
        }
    }

    async function doM3U({ url, content }) {
        if (!url) return;
        let u;
        try { u = new URL(url, location.href); } catch { return; }
        if (shownUrls.includes(u.href)) return;
        let duration = 0, variantCount = 0;
        try {
            const m = parseM3U(content || "", u.href);
            if (m.segments.length) duration = m.totalDuration;
            else variantCount = m.playlists.length;
        } catch { }
        noteShown(u.href);
        showSniffItem({
            type: "m3u8",
            url: u.href,
            duration: duration ? `${Math.ceil(duration * 10 / 60) / 10} 分钟` : (variantCount ? `多码率(${variantCount})` : "未知"),
            onDownload() {
                askConfirm({ type: "m3u8", url: u.href, referer: location.href }); // m3u8 名恒取动态顶层标题（.ts 由 suggestName 补），URL 名常为 index/master 无意义
                if (variantCount) mgmapi.message("多码率播放列表：将自动选择最高画质变体");
            }
        });
    }

    /* iframe 场景下取顶层标题 */
    window.addEventListener("message", async (e) => {
        if (e.data === "wtm-gm-get-title") {
            const name = `wtm-top-title-${Date.now()}`;
            await mgmapi.setValue(name, document.title);
            e.source && e.source.postMessage(`wtm-gm-top-title-name:${name}`, "*");
        }
    });
    function getTopTitleSafe() {
        if (window.top === window) return Promise.resolve(document.title);
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(document.title), 300);
            window.addEventListener("message", async function l(e2) {
                if (typeof e2.data === "string" && e2.data.startsWith("wtm-gm-top-title-name:")) {
                    const key = e2.data.slice("wtm-gm-top-title-name:".length);
                    await delay(30);
                    clearTimeout(timer);
                    resolve((await mgmapi.getValue(key)) || document.title);
                    mgmapi.deleteValue(key);
                    window.removeEventListener("message", l);
                }
            });
            try { window.top.postMessage("wtm-gm-get-title", "*"); } catch { clearTimeout(timer); resolve(document.title); }
        });
    }

    /* ==================== UI：悬浮球 + 嗅探列表 + 下载面板 ==================== */
    const ui = { shadowRoot: null, pending: null, root: null };
    const els = {};
    const sniffItems = [];
    // 主页 = settings.homeUrl 这个固定 URL（需在设置加载后用 isHomeRoute() 判定）

    const UI_CSS = `
      *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}
      .grow{flex-grow:1;}
      .wtm-float{position:fixed;top:90px;right:10px;display:flex;flex-direction:column;align-items:flex-end;z-index:2147483640;}
      .wtm-fab{position:relative;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#1e6fff,#27c1ff);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(30,111,255,.45);user-select:none;}
      .wtm-fab:active{transform:scale(.94);}
      .wtm-badge{position:absolute;right:-4px;bottom:-4px;min-width:18px;height:18px;border-radius:9px;background:#ff5252;color:#fff;font-size:11px;font-weight:bold;display:none;align-items:center;justify-content:center;padding:0 4px;border:2px solid #fff;}
            .wtm-sbadge{position:absolute;right:-4px;top:-4px;min-width:18px;height:18px;border-radius:9px;background:#18c06b;color:#fff;font-size:11px;font-weight:bold;display:none;align-items:center;justify-content:center;padding:0 4px;border:2px solid #fff;box-shadow:0 2px 6px rgba(24,192,107,.5);z-index:2;}
            .wtm-snip{position:absolute;right:50px;top:50%;transform:translateY(-50%) translateX(8px);background:rgba(20,26,38,.94);color:#e7eefc;font-size:12px;line-height:1.5;padding:6px 10px;border-radius:10px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .35s ease,transform .35s ease;border:1px solid rgba(255,255,255,.1);box-shadow:0 6px 18px rgba(0,0,0,.45);z-index:1;}
            .wtm-snip b{color:#7fe7a6;font-size:13px;}
            .wtm-snip .tp{color:#ffcf6b;}
            .wtm-fab .wtm-fab-ico{transition:transform .3s;}
            .wtm-fab.sniffing{animation:wtm-sniff-pop 1.3s ease;}
            .wtm-fab.sniffing .wtm-snip{opacity:1;transform:translateY(-50%) translateX(0);}
            @keyframes wtm-sniff-pop{0%{transform:scale(1);}30%{transform:scale(1.15);}60%{transform:scale(.96);}100%{transform:scale(1);}}
      .wtm-sitem{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;font-size:12px;color:#cdd7e6;}
      .wtm-sitem:hover{background:#1d2534;}
      .wtm-sitem .tag{flex:none;background:#243044;color:#7fb3ff;border-radius:4px;padding:1px 6px;font-size:11px;}
      .wtm-sitem .tag.m3u{color:#ffd479;}
      .wtm-sitem .slink{flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;color:#9fb4d8;cursor:pointer;}
      .wtm-sitem .slink:hover{color:#fff;text-decoration:underline;}
      .wtm-sitem .sdur{flex:none;color:#8fa1bd;}
      .wtm-modal{position:fixed;inset:0;background:rgba(4,8,16,.55);display:none;align-items:center;justify-content:center;z-index:2147483646;}
      .wtm-modal.open{display:flex;}
      .wtm-confirm{width:460px;max-width:92vw;background:#161b26;border:1px solid #2a3550;border-radius:12px;padding:14px 16px;color:#dfe6f1;box-shadow:0 12px 40px rgba(0,0,0,.6);font-size:13px;}
      .wtm-confirm h4{margin:0 0 10px;font-size:14px;color:#fff;}
      .wtm-confirm .crow{display:flex;align-items:center;gap:8px;margin:7px 0;}
      .wtm-confirm .clb{flex:none;width:70px;color:#8fa1bd;}
      .wtm-confirm input[type=text],.wtm-confirm input[type=number]{background:#0f141e;border:1px solid #2a3550;color:#e6edf7;border-radius:6px;padding:5px 8px;font-size:12px;flex:1;min-width:0;}
      .wtm-confirm .curl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7f95b8;font-size:11px;}
      .wtm-confirm .cnote{color:#7286a6;font-size:11px;margin-top:8px;line-height:1.6;}
      .wtm-confirm .cfoot{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;}
      .wtm-snifffly{position:fixed;top:140px;right:14px;width:300px;max-width:calc(100vw - 28px);background:#151a23;border:1px solid #2a3550;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);color:#dfe6f1;font-size:12px;z-index:2147483644;display:none;flex-direction:column;overflow:hidden;}
      .wtm-snifffly.open{display:flex;}
      .wtm-snifffly .sf-head{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#121722;border-bottom:1px solid #262f42;}
      .wtm-snifffly .sf-title{font-weight:bold;color:#fff;}
      .wtm-snifffly .sf-list{max-height:240px;overflow:auto;padding:4px;}
      .wtm-snifffly .sf-foot{display:flex;gap:6px;justify-content:flex-end;padding:6px 10px;border-top:1px solid #262f42;background:#121722;}
      .btn{background:#243044;color:#cfe2ff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;line-height:1.5;}
      .btn:hover{background:#2d3d59;}
      .btn.primary{background:#1e6fff;color:#fff;}
      .btn.primary:hover{background:#3f83ff;}
      .btn.ghost{background:transparent;color:#8fa1bd;}
      .btn.ghost:hover{color:#fff;background:#222c3e;}
      .btn.mini{padding:2px 8px;font-size:11px;}
      .wtm-panel{display:none;position:fixed;right:24px;bottom:24px;width:780px;height:580px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);background:#151a23;border:1px solid #262f42;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.6);color:#dfe6f1;font-size:13px;flex-direction:column;overflow:hidden;z-index:2147483645;}
      .wtm-panel.open{display:flex;}
      .wtm-panel.max{left:24px;top:24px;width:auto;height:auto;}
      .wtm-panel.home{left:0;top:0;right:0;bottom:0;width:auto;height:auto;max-width:none;max-height:none;border:none;border-radius:0;}
      .wtm-panel .wtm-exit{display:none;}
      .wtm-panel.home .wtm-exit{display:inline-block;}
      .wtm-panel.home .wtm-logo::after{content:" · 下载主页";color:#27c1ff;font-weight:normal;font-size:12px;}
      .wtm-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#121722;border-bottom:1px solid #262f42;}
      .wtm-logo{font-size:15px;font-weight:bold;color:#fff;white-space:nowrap;}
      .wtm-ver{font-size:11px;color:#5d708e;font-weight:normal;margin-left:4px;}
      .wtm-total{font-size:12px;color:#27c1ff;background:#18202e;border-radius:6px;padding:2px 10px;white-space:nowrap;}
      .wtm-add{display:flex;gap:8px;padding:10px 14px;}
      .wtm-input{flex:1;background:#0f141c;border:1px solid #2a3548;color:#e6edf7;border-radius:8px;padding:8px 12px;outline:none;font-size:13px;}
      .wtm-input:focus{border-color:#1e6fff;}
      .wtm-settings{display:none;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 14px;background:#12172e;border-top:1px solid #262f42;border-bottom:1px solid #262f42;color:#8fa1bd;font-size:12px;}
      .wtm-settings.open{display:flex;}
      .wtm-settings input[type=number]{background:#0f141c;border:1px solid #2a3548;color:#e6edf7;border-radius:4px;padding:2px 4px;width:44px;}
      .wtm-settings .ck{display:inline-flex;align-items:center;gap:4px;cursor:pointer;}
      .wtm-tabs{display:flex;gap:4px;padding:0 14px;border-bottom:1px solid #262f42;background:#121722;}
      .wtm-tabs .tab{padding:7px 14px;cursor:pointer;color:#8fa1bd;border-bottom:2px solid transparent;user-select:none;}
      .wtm-tabs .tab.on{color:#fff;border-bottom-color:#1e6fff;}
      .wtm-tabs .tab b{font-size:11px;color:#27c1ff;margin-left:2px;}
      .wtm-list{flex:1;overflow-y:auto;}
      .wtm-empty{padding:40px 20px;text-align:center;color:#5d708e;font-size:13px;line-height:2;}
      .wtm-task{padding:10px 14px;border-bottom:1px solid #1c2432;display:flex;flex-direction:column;gap:6px;}
      .wtm-task:hover{background:#181f2b;}
      .wtm-task.hl{background:#1c2a44;animation:wtmflash 1.5s 3;}
      @keyframes wtmflash{50%{background:#28374f;}}
      .wtm-task .r1{display:flex;align-items:center;gap:8px;}
      .wtm-task .name{color:#fff;font-size:13px;max-width:60%;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;}
      .wtm-task .tag{flex:none;font-size:10px;border-radius:4px;padding:1px 5px;background:#243044;color:#7fb3ff;}
      .wtm-task .tag.m3u{color:#ffd479;}
      .wtm-task .st{font-size:12px;color:#8fa1bd;}
      .wtm-task .st.downloading,.wtm-task .st.merging{color:#27c1ff;}
      .wtm-task .st.done{color:#57d27a;}
      .wtm-task .st.error{color:#ff7b7b;}
      .wtm-task .st.paused{color:#ffb45e;}
      .wtm-bar{height:6px;background:#242b38;border-radius:3px;overflow:hidden;}
      .wtm-bar i{display:block;height:100%;background:linear-gradient(90deg,#1e6fff,#27c1ff);border-radius:3px;transition:width .4s;}
      .wtm-task .r3{display:flex;align-items:center;gap:8px;}
      .wtm-task .info{font-size:12px;color:#8fa1bd;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .wtm-task .ops{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
      .wtm-foot{display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:1px solid #262f42;background:#121722;}
      .wtm-tip{font-size:11px;color:#5d708e;}
    `;

    const UI_HTML = `
      <div class="wtm-float" id="float">
        <div class="wtm-fab" id="fab" title="Web下载器（点击打开 / 拖动移位）"><span class="wtm-fab-ico">⚡</span><span class="wtm-badge" id="badge">0</span><span class="wtm-sbadge" id="sbadge" title="嗅探到的资源数">0</span><span class="wtm-snip" id="snip">📡 嗅探到 <b id="snipn">0</b> 个 <span class="tp" id="sniptype"></span></span></div>
      </div>
      <div class="wtm-snifffly" id="sniff-pop">
        <div class="sf-head"><span class="sf-title">📡 嗅探到资源</span><span id="sf-count"></span><span class="grow"></span><button class="btn ghost mini" data-act="sf-close" title="收起小窗">✕</button></div>
        <div class="sf-list" id="sf-list"></div>
        <div class="sf-foot"><button class="btn ghost mini" data-act="sniff-clear">清空</button><button class="btn mini" data-act="sf-openpanel">查看全部</button></div>
      </div>
      <div class="wtm-panel" id="panel">
        <div class="wtm-head">
          <span class="wtm-logo">⚡ Web下载器<span class="wtm-ver">v${SCRIPT_VER}</span></span>
          <span class="wtm-total" id="total">↓ 空闲</span>
          <span class="grow"></span>
          <button class="btn ghost" data-act="home" title="打开统一下载主页（固定网址，所有任务在此集中管理）">🏠 主页</button>
          <button class="btn ghost wtm-exit" data-act="exit-home" title="退出主页模式，回到悬浮面板">↩ 退出主页</button>
          <button class="btn ghost" data-act="toggle-settings">⚙ 设置</button>
          <button class="btn ghost" data-act="max" id="maxbtn">⬜</button>
          <button class="btn ghost" data-act="close">✕</button>
        </div>
        <div class="wtm-add">
          <input class="wtm-input" id="url-input" placeholder="粘贴 http(s) 直链 / m3u8 地址，回车添加下载任务">
          <button class="btn primary" data-act="add">＋ 添加任务</button>
        </div>
        <div class="wtm-settings" id="settings">
          <label>线程数 <input type="number" id="s-threads" min="1" max="8"></label>
          <label>分块(MB) <input type="number" id="s-chunk" min="1" max="32"></label>
          <label>并发任务 <input type="number" id="s-conc" min="1" max="5"></label>
          <label class="ck"><input type="checkbox" id="s-auto">完成后自动另存</label>
          <span class="grow" style="display:flex;align-items:center;gap:6px;flex-basis:100%;font-size:12px">📁 保存文件夹：<b id="s-dirname">浏览器默认下载目录</b><button class="btn ghost mini" data-act="pick-dir">选择…</button></span>
          <label class="ck"><input type="checkbox" id="s-mp4">TS/m3u8 完成后默认转封装 MP4</label>
          <label class="ck"><input type="checkbox" id="s-sniff">页面资源嗅探</label>
          <label class="ck"><input type="checkbox" id="s-show-sniff">新资源自动弹出小窗提示</label>
          <label class="ck"><input type="checkbox" id="s-fab">显示 ⚡ 悬浮球</label>
          <label class="ck"><input type="checkbox" id="s-debug">调试日志（F12 控制台）</label>
          <button class="btn ghost mini" data-act="copy-diag" title="把最近诊断日志连同版本/环境/设置快照复制到剪贴板，便于反馈问题">📋 复制诊断报告</button>
          <label class="ck"><input type="checkbox" id="s-sanitize">文件名跨平台自动修正</label>
          <label class="grow" style="flex-basis:100%">统一主页 URL <input type="text" id="s-homeurl" style="width:240px" placeholder="https://cat-x.github.io/web-downloader/#wtm-home"></label>
          <button class="btn primary mini" data-act="save-settings">保存设置</button>
        </div>
        <div class="wtm-tabs" id="tabs">
          <span class="tab" data-act="tab" data-tab="active">进行中 <b id="c-active">0</b></span>
          <span class="tab" data-act="tab" data-tab="done">已完成</span>
          <span class="tab" data-act="tab" data-tab="all">全部 <b id="c-all">0</b></span>
          <span class="tab" data-act="tab" data-tab="sniff">📡 嗅探 <b id="c-sniff">0</b></span>
        </div>
        <div class="wtm-list" id="list"></div>
        <div class="wtm-foot">
          <button class="btn ghost" data-act="resume-all">全部继续</button>
          <button class="btn ghost" data-act="pause-all">全部暂停</button>
          <button class="btn ghost" data-act="save-all">另存全部已完成</button>
          <button class="btn ghost" data-act="clear-done">清除已完成</button>
          <span class="grow"></span>
          <span class="wtm-tip">分片缓存存于 IndexedDB · 支持断点续传 / 更换地址续传</span>
        </div>
      </div>
    `;

    const CONFIRM_HTML = `
      <div class="wtm-modal" id="cf-modal">
        <div class="wtm-confirm">
          <h4>🔔 确认下载任务</h4>
          <div class="crow"><span class="clb">资源链接</span><span class="curl" id="cf-url"></span></div>
          <div class="crow"><span class="clb">文件名</span><input type="text" id="cf-name"></div>
          <div class="crow"><span class="clb">保存位置</span><span class="curl" id="cf-dir"></span><button class="btn ghost mini" data-act="cf-pickdir">更改文件夹…</button></div>
          <div class="crow"><span class="clb">线程数</span><input type="number" id="cf-threads" min="1" max="8" style="flex:none;width:72px"><span class="clb" style="width:auto">立即开始</span><input type="checkbox" id="cf-now"></div>
          <div class="crow"><span class="clb" style="width:auto"><input type="checkbox" id="cf-mp4"> 完成后转 MP4</span><span class="cnote" style="margin-top:0">无损重封装（-c copy）；首次使用联网加载组件，失败不影响 TS 成品</span></div>
          <div class="crow"><span class="clb" style="width:auto"><input type="checkbox" id="cf-sanitize"> 文件名跨平台自动修正</span><span class="cnote" style="margin-top:0">取消则按原名保存（可能含目标系统非法字符无法保存）</span></div>
          <div class="cnote">超过并发数的任务会自动排队；取消勾选「立即开始」则放入暂停列表，稍后手动继续。「更改文件夹」在本页直接打开选择器（需 Chrome/Edge，https 页面）：在当前站点授权后，本站新任务分片直接写入该文件夹（先建占位文件、边下边写、完成改名，不占浏览器缓存；各站点分别记住自己的文件夹）；注意浏览器禁止直接选中「下载/桌面/文稿」本身，请在其中建子文件夹再选。</div>
          <div class="cfoot"><button class="btn ghost" data-act="cf-cancel">取消</button><button class="btn primary" data-act="cf-ok">开始下载</button></div>
        </div>
      </div>`;

    function buildUI() {
        if (document.getElementById("wtm-downloader-root")) return; // 防重复注入：一个页面只保留一套 UI
        const root = document.createElement("div");
        root.id = "wtm-downloader-root";
        root.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
        // 挂到 <html> 而非 <body>：避免页面在 body/包裹层设 transform/filter/opacity 形层的
        // 层叠上下文把我们的 fixed UI 困住、被更高阶层元素盖住而点不到
        ui.root = root;
        document.documentElement.appendChild(root);
        const sr = root.attachShadow({ mode: "open" });
        ui.shadowRoot = sr;
        startTopLayerGuard(); // 全屏/重渲染时持续保证置顶可点

        const style = document.createElement("style");
        style.textContent = UI_CSS;
        sr.appendChild(style);
        const box = document.createElement("div");
        sr.appendChild(box);
        box.innerHTML = UI_HTML;
        box.insertAdjacentHTML("beforeend", CONFIRM_HTML); // 任务确认弹窗：仍属于同一套 UI

        const q = s => box.querySelector(s);
        Object.assign(els, {
            float: q("#float"), fab: q("#fab"), badge: q("#badge"), sbadge: q("#sbadge"), snipn: q("#snipn"), sniptype: q("#sniptype"), fabIco: q(".wtm-fab-ico"),
            sniffPop: q("#sniff-pop"), sfCount: q("#sf-count"), sfList: q("#sf-list"), panel: q("#panel"), list: q("#list"), total: q("#total"),
            input: q("#url-input"), settingsBox: q("#settings"), maxbtn: q("#maxbtn"),
            cActive: q("#c-active"), cAll: q("#c-all"), cSniff: q("#c-sniff"),
            cfModal: q("#cf-modal"), cfUrl: q("#cf-url"), cfName: q("#cf-name"), cfDir: q("#cf-dir"), cfThreads: q("#cf-threads"), cfNow: q("#cf-now"), cfMp4: q("#cf-mp4"), cfSanitize: q("#cf-sanitize"),
            sDirName: q("#s-dirname"),
            sThreads: q("#s-threads"), sChunk: q("#s-chunk"), sConc: q("#s-conc"), sAuto: q("#s-auto"), sSniff: q("#s-sniff"), sShowSniff: q("#s-show-sniff"), sFab: q("#s-fab"), sHomeUrl: q("#s-homeurl"), sMp4: q("#s-mp4"), sDebug: q("#s-debug"), sSanitize: q("#s-sanitize"),
        });

        bindFab();
        bindPanel();
        // 任务级净化勾选：当场勾上就把已填的文件名洗一遍（取消勾选不改动现名）
        if (els.cfSanitize) els.cfSanitize.addEventListener("change", () => { if (els.cfSanitize.checked && els.cfName) { try { els.cfName.value = sanitizeFileName(els.cfName.value || ""); } catch { } } });
        renderSniff(); // 补显 UI 就绪前嗅探到的资源
        applyEntryVisibility();
        addEventListener("hashchange", applyRoute); // 地址栏改 #wtm-home 也能进出主页
        if (isHomeRoute()) { openPanel(); applyRoute(); }
        (async function restorePos() {
            const x = await mgmapi.getValue("wtm-x", 10);
            const y = await mgmapi.getValue("wtm-y", 90);
            els.float.style.right = Math.max(0, Math.min(innerWidth - 60, x)) + "px";
            els.float.style.top = Math.max(0, Math.min(innerHeight - 60, y)) + "px";
        })();
    }

    /* ---- 顶层保障：逃出 body 层叠上下文；原生视频全屏时并入全屏元素；被 SPA 移除时自愈重挂 ---- */
    function hostForTopLayer() {
        if (!ui.root) return;
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
        const want = (fsEl && typeof fsEl.appendChild === "function") ? fsEl : document.documentElement;
        if (ui.root.parentElement !== want) { try { want.appendChild(ui.root); } catch { } } // 进出全屏/被移到其它节点：重挂
        else if (want.lastElementChild !== ui.root) { try { want.appendChild(ui.root); } catch { } } // 已是末子时不动，避免周期性 DOM 抖动
        ui.root.style.zIndex = "2147483647";
    }
    function startTopLayerGuard() {
        hostForTopLayer();
        ["fullscreenchange", "webkitfullscreenchange", "fullscreenerror", "webkitfullscreenerror"].forEach(ev => {
            document.addEventListener(ev, hostForTopLayer, true);
        });
        setInterval(hostForTopLayer, 1500); // 自愈：页面把容器移走/置底时重新挂载
    }

    /* ---- 悬浮球：拖动 + 点击 ---- */
    function bindFab() {
        let fx, fy, moved = false;
        els.fab.addEventListener("mousedown", e => {
            moved = false;
            fx = e.clientX; fy = e.clientY;
            const rect = els.float.getBoundingClientRect();
            const sx = innerWidth - rect.right, sy = rect.top;
            const mm = ev => {
                const dx = ev.clientX - fx, dy = ev.clientY - fy;
                if (!moved && Math.abs(dx) + Math.abs(dy) > 5) moved = true;
                if (moved) {
                    els.float.style.right = Math.max(0, Math.min(innerWidth - 60, sx - dx)) + "px";
                    els.float.style.top = Math.max(0, Math.min(innerHeight - 60, sy + dy)) + "px";
                }
            };
            const mu = ev => {
                removeEventListener("mousemove", mm);
                removeEventListener("mouseup", mu);
                if (moved) {
                    const r = els.float.getBoundingClientRect();
                    mgmapi.setValue("wtm-x", innerWidth - r.right);
                    mgmapi.setValue("wtm-y", r.top);
                } else {
                    togglePanel();
                }
            };
            addEventListener("mousemove", mm);
            addEventListener("mouseup", mu);
        });
    }

    function togglePanel() {
        state.panelOpen ? closePanel() : openPanel();
    }
    function openPanel(max) {
        if (!els.panel) return;
        state.panelOpen = true;
        hideSniffPop(); // 开大面板时收起嗅探小窗，避免两个窗体叠加
        pollStorageOnce(); // 打开即取最新存储：不等轮询，其它页的任务/进度立即可见
        els.panel.classList.add("open");
        if (max && !state.maximized) toggleMax();
        fillSettings();
        renderSniff();
        render();
    }
    function closePanel() {
        state.panelOpen = false;
        els.panel.classList.remove("open");
    }
    function toggleMax() {
        state.maximized = !state.maximized;
        els.panel.classList.toggle("max", state.maximized);
        els.maxbtn.textContent = state.maximized ? "🗗" : "⬜";
    }

    /* ---- 嗅探反馈：悬浮球脉冲 + 资源数量常驻角标 ---- */
    function sniffTypeLabel(t) { return t === "m3u8" ? "m3u8" : t === "video" ? "视频" : t === "file" ? "文件" : String(t || "资源"); }
    function updateSniffBadge() {
        if (!els.sbadge) return;
        const n = sniffItems.length;
        els.sbadge.textContent = n > 99 ? "99+" : String(n);
        els.sbadge.style.display = n ? "flex" : "none"; // 无资源时隐藏，不干扰下载中徽章
    }
    let sniffPulseTimer = 0;
    function pulseSniffFab() {
        if (IN_FRAME || !els.fab) return;
        updateSniffBadge();
        const byType = {};
        for (const it of sniffItems) { const k = it.type || "file"; byType[k] = (byType[k] || 0) + 1; }
        const summary = Object.keys(byType).map(k => sniffTypeLabel(k) + (byType[k] > 1 ? "×" + byType[k] : "")).join(" · ");
        const latest = sniffItems[sniffItems.length - 1];
        const glyph = !latest ? "⚡" : latest.type === "m3u8" ? "📡" : latest.type === "video" ? "🎞️" : "📥";
        if (els.fabIco) els.fabIco.textContent = glyph; // 根据最新一条类型换图标
        if (els.snipn) els.snipn.textContent = String(sniffItems.length);
        if (els.sniptype) els.sniptype.textContent = "（" + summary + "）";
        els.fab.classList.remove("sniffing"); void els.fab.offsetWidth; // 强制重启脉冲动画
        els.fab.classList.add("sniffing");
        clearTimeout(sniffPulseTimer);
        sniffPulseTimer = setTimeout(() => {
            els.fab.classList.remove("sniffing"); // 提示条渐隐，仅留绿色资源数量角标
            if (els.fabIco) els.fabIco.textContent = "⚡";
        }, 3000);
    }

    /* ---- 嗅探条目 ---- */
    function showSniffItem({ type, url, duration, onDownload }) {
        if (IN_FRAME) { // iframe 不建 UI：把资源投送给最顶层框架展示
            mgmapi.setValue("wtm-sniff-in", JSON.stringify({ url, type, duration: duration || "", ts: Date.now(), by: PAGE_ID })).catch(() => { });
            return;
        }
        const idx = sniffItems.length;
        dlog("sniff 新资源", type, String(url).slice(0, 120));
        let path = url;
        try { path = decodeURIComponent(new URL(url).pathname); } catch { }
        sniffItems.push({ url, onDownload, type, duration, path });
        renderSniff();
        pulseSniffFab(); // 新资源到达：悬浮球脉冲反馈
        // 新资源：只弹右上角紧凑小窗（可逐条下载），不再自动展开整块大面板
        if (settings.showSniff && !state.panelOpen) showSniffPop();
    }

    // 接收其它框架（iframe）嗅探到的资源，并入本页嗅探列表
    let lastRelayTs = 0;
    function onSniffRelay(raw) {
        let p;
        try { p = JSON.parse(raw); } catch { return; }
        if (!p || !p.url || p.by === PAGE_ID || p.ts <= lastRelayTs) return;
        lastRelayTs = p.ts;
        if (sniffItems.some(x => x.url === p.url)) return;
        showSniffItem({ type: p.type, url: p.url, duration: p.duration, onDownload: () => askConfirm({ url: p.url, type: p.type }) });
    }

    /* ---- 嗅探小窗（右上角紧凑卡片，不抢占整屏）---- */
    function renderSniffPop() {
        if (!els.sfList) return;
        const n = sniffItems.length;
        if (els.sfCount) els.sfCount.textContent = n ? "（" + n + "）" : "";
        els.sfList.innerHTML = n ? sniffItems.map((it, idx) => `
            <div class="wtm-sitem">
                <span class="tag ${it.type === "m3u8" ? "m3u" : ""}">${it.type}</span>
                <span class="slink" title="${esc(it.url)}" data-act="sniff-copy" data-idx="${idx}">${esc(it.path)}</span>
                <span class="sdur">${esc(it.duration || "")}</span>
                <button class="btn mini primary" data-act="sniff-dl" data-idx="${idx}">下载</button>
            </div>`).join("") : '<div class="wtm-empty" style="padding:12px;text-align:center">暂未嗅探到资源</div>';
    }
    function showSniffPop() {
        renderSniffPop();
        if (els.sniffPop) els.sniffPop.classList.add("open");
    }
    function hideSniffPop() { if (els.sniffPop) els.sniffPop.classList.remove("open"); }

    function renderSniff() {
        if (!els.cSniff) return; // UI 未就绪：buildUI 后会再次调用
        render();
    }

    /* ---- 新任务确认面板（文件名/保存文件夹/线程数/排队/文件名修正可改） ---- */
    let pendingConfirm = null;
    let dirHandle = null; // File System Access 目录句柄（仅引擎页有意义，存于本页 IndexedDB meta）
    function updateConfirmDirText() {
        if (!els.cfDir) return;
        els.cfDir.textContent = settings.saveDirName
            ? `📁 ${settings.saveDirName}（下载到本地时直接写入此文件夹）`
            : "浏览器下载目录（可点右侧「更改文件夹」授权固定目录，授权后分片直接写入本地文件、不占浏览器缓存）";
    }
    async function pickSaveDir() {
        if (!window.showDirectoryPicker) { mgmapi.message("当前页面不支持文件夹选择（需 Chrome/Edge 且为 https 安全上下文），将使用浏览器下载目录"); return; }
        try {
            // 当场在当前页面打开原生文件夹选择器（不跳转主页）：句柄存于选择所在域的 IndexedDB，
            // 该域作为统一主页时直接生效；静默写入由主页执行（成品在主页域），浏览器不允许文件夹句柄跨域携带
            const h = await window.showDirectoryPicker({ mode: "readwrite", id: "wtm-save-dir", startIn: "downloads" });
            await Store.setMeta("savedir", h);
            dirHandle = h;
            settings.saveDirName = h.name;
            await persistSettings();
            updateConfirmDirText();
            if (els.sDirName) els.sDirName.textContent = h.name;
            mgmapi.message(isEngine()
                ? `已指定保存文件夹：${h.name}`
                : `已选择文件夹「${h.name}」（名称已同步各页面）。分片直写仅在执行下载的引擎页生效，浏览器不允许文件夹权限跨站携带：要在主页直写这个目录，请在主页标签里选一次同一文件夹`, 12000);
        } catch (e) {
            if (e && (e.name === "AbortError" || (e.name === "NotAllowedError" && /permission is denied|denied by the user/i.test(e.message || "")))) return; // 用户主动取消，不打扰
            // Chrome 安全策略（规范明文，跨平台一致）：禁止直接选中 下载/文稿/桌面/主目录 本身，哪怕完全空也报“含系统文件”；其子文件夹允许
            mgmapi.message("选择被拒：浏览器禁止网页直接选中「下载/桌面/文稿/主目录」本身（防盗取安全策略，各系统一致）。请在选择器里进入下载目录后新建一个子文件夹（如 Web下载器）并选中它", 12000);
        }
    }
    async function askConfirm(spec) {
        if (!els.cfModal) { dlog("askConfirm UI未就绪，跳过确认直接添加", String(spec.url || "").slice(0, 120)); addTask(spec); return null; } // UI 未就绪时不阻塞添加
        dlog("askConfirm 打开确认面板", spec.type || "", String(spec.url || "").slice(0, 120));
        let u;
        try { u = new URL(String(spec.url || "").trim(), location.href); } catch { mgmapi.message("链接无效"); return null; }
        if (!/^https?:/i.test(u.href)) { mgmapi.message("仅支持 http(s) 链接"); return null; }
        const url = u.href;
        const type = spec.type || (/[.]m3u8?([?#]|$)/i.test(url.split("?")[0]) ? "m3u8" : "file");
        const dup = tasks.find(t => t.url === url && t.type === type && t.status !== "done");
        if (dup) { // 排重前置：命中直接定位已有任务，不再弹确认
            mgmapi.message(`已有相同任务：${dup.name}`);
            state.tab = "active";
            state.highlightId = dup.id;
            openPanel();
            notifyUI();
            return dup;
        }
        // 动态文件名：调用方显式给名则用之（m3u8 补 .ts）；否则按“URL 名 vs 顶层标题”智能判定（点击下载一刻实时取标题，对齐老脚本）
        const baseName = spec.name ? (type === "m3u8" ? ensureExt(spec.name, ".ts") : spec.name) : await suggestName(url, type);
        pendingConfirm = { url, type, referer: spec.referer || location.href };
        els.cfUrl.textContent = url;
        els.cfUrl.title = url;
        els.cfName.value = sanitizeOn(spec) ? sanitizeFileName(baseName) : baseName;
        els.cfSanitize.checked = sanitizeOn(spec);
        els.cfThreads.value = (spec.threads > 0 ? spec.threads : settings.threads);
        els.cfNow.checked = spec.startNow !== false;
        const tsish = type === "m3u8" || /[.]ts([?#]|$)/i.test(url); // 只有 TS 类流才能无损转封装
        els.cfMp4.disabled = !tsish;
        els.cfMp4.checked = tsish && (spec.mp4 !== undefined ? !!spec.mp4 : settings.convertMp4 !== false);
        updateConfirmDirText();
        els.cfModal.classList.add("open");
        setTimeout(() => { try { els.cfName.select(); } catch { } }, 30);
        return null;
    }

    /* ---- 诊断报告：版本/环境/设置快照 + 日志缓冲，一键复制用于问题反馈 ---- */
    function buildDiagText() {
        const buf = dlog.buf || [];
        const running = tasks.filter(t => ["downloading", "queued", "merging"].includes(t.status)).length;
        const head = [
            `Web下载器诊断报告 v${SCRIPT_VER}`,
            `时间: ${new Date().toLocaleString()}`,
            `页面: ${location.href.slice(0, 160)}`,
            `身份: ${isEngine() ? "主页/引擎页" : "入口页"}${IN_FRAME ? "（iframe）" : ""}  pageID=${PAGE_ID}`,
            `UA: ${navigator.userAgent}`,
            `任务: 共 ${tasks.length}，进行中 ${running}，嗅探资源 ${sniffItems.length}`,
            `设置: ${JSON.stringify(settings)}`,
            `---- 最近日志 ${buf.length} 条（未开启调试日志也会记录）----`,
        ];
        return head.concat(buf).join("\n");
    }

    /* ---- 面板事件 ---- */
    function bindPanel() {
        els.input.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); ui.shadowRoot.querySelector('[data-act="add"]').click(); }
        });
        ui.shadowRoot.addEventListener("click", async e => {
            const el = e.target.closest("[data-act]");
            if (!el) return;
            const act = el.dataset.act;
            const taskEl = el.closest(".wtm-task");
            const id = el.dataset.id || (taskEl ? taskEl.dataset.id : "");
            try {
                switch (act) {
                    case "add": {
                        const v = els.input.value.trim();
                        if (!v) { mgmapi.message("请先输入链接"); break; }
                        if (!/^https?:\/\//i.test(v)) { mgmapi.message("仅支持 http(s) 链接"); break; }
                        askConfirm({ url: v });
                        els.input.value = "";
                        break;
                    }
                    case "home":
                        // 打开统一下载主页（固定 URL）；本页已是主页则保持全屏
                        if (isHomeRoute()) mgmapi.message("已在统一下载主页");
                        else openHomeNewTab();
                        break;
                    case "exit-home":
                        closePanel();
                        break;
                    case "toggle-settings":
                        els.settingsBox.classList.toggle("open");
                        fillSettings();
                        break;
                    case "save-settings": {
                        settings.threads = clamp(parseInt(els.sThreads.value) || 4, 1, 8);
                        settings.chunkMB = clamp(parseInt(els.sChunk.value) || 4, 1, 32);
                        settings.concurrency = clamp(parseInt(els.sConc.value) || 2, 1, 5);
                        settings.autoSave = !!els.sAuto.checked;
                        snifferEnabled = !!els.sSniff.checked;
                        settings.sniff = snifferEnabled;
                        settings.showSniff = !!els.sShowSniff.checked;
                        settings.convertMp4 = !!els.sMp4.checked;
                        settings.debug = !!(els.sDebug && els.sDebug.checked);
                        settings.sanitizeName = !!(els.sSanitize && els.sSanitize.checked);
                        settings.showFab = !!els.sFab.checked;
                        const hu = (els.sHomeUrl.value || "").trim();
                        if (/^https?:\/\/.+/i.test(hu) && hu.indexOf("#wtm-home") > -1) settings.homeUrl = hu;
                        else if (/^https?:\/\/.+/i.test(hu)) settings.homeUrl = hu.replace(/#.*$/, "") + "#wtm-home";
                        await persistSettings();
                        applyEntryVisibility();
                        buildMenu();
                        mgmapi.message("设置已保存（线程数对下个分片起生效）");
                        schedule();
                        break;
                    }
                    case "max": toggleMax(); break;
                    case "close": closePanel(); break;
                    case "copy-diag": {
                        const txt = buildDiagText();
                        const tell = ok => mgmapi.message(ok ? `已复制诊断报告（${txt.length} 字符），可直接粘贴发送` : "复制失败：请允许剪贴板权限后重试");
                        if (typeof GM_setClipboard === "function") {
                            try { GM_setClipboard(txt, { type: "text", filetype: "plain" }); tell(true); break; } catch { }
                        }
                        try {
                            navigator.clipboard.writeText(txt).then(() => tell(true), () => tell(false));
                        } catch { tell(false); }
                        break;
                    }
                    case "tab":
                        state.tab = el.dataset.tab;
                        render();
                        break;
                    case "pause": pauseTask(id); break;
                    case "resume": resumeTask(id); break;
                    case "save":
                        try { await saveAs(id); } catch (err) { mgmapi.message(err.message); }
                        break;
                    case "edit": {
                        const t = findTask(id);
                        if (!t) break;
                        const nu = prompt("输入新的下载地址（同文件更换直链后，将尽量从断点继续）：", t.url);
                        if (nu && nu.trim() && nu.trim() !== t.url) changeUrl(id, nu.trim());
                        break;
                    }
                    case "del":
                        if (confirm("删除该任务及其下载缓存数据？")) await removeTask(id);
                        break;
                    case "copy": {
                        const t = findTask(id);
                        if (t) { mgmapi.copyText(t.url); mgmapi.message("已复制链接", 2000); }
                        break;
                    }
                    case "open": {
                        const t = findTask(id);
                        if (t) mgmapi.openInTab(t.url, true);
                        break;
                    }
                    case "resume-all":
                        tasks.forEach(t => { if (t.status === "paused" || t.status === "error") resumeTask(t.id); });
                        break;
                    case "pause-all":
                        tasks.slice().forEach(t => { if (t.status === "downloading" || t.status === "queued") pauseTask(t.id); });
                        break;
                    case "save-all": {
                        const doneTasks = tasks.filter(x => x.status === "done");
                        if (!doneTasks.length) { mgmapi.message("没有已完成的文件"); break; }
                        mgmapi.message(`开始另存 ${doneTasks.length} 个文件（浏览器可能询问是否允许多次下载）`);
                        for (const t of doneTasks) { try { await saveAs(t.id); await delay(600); } catch { } }
                        break;
                    }
                    case "clear-done":
                        if (confirm("清除所有已完成任务并删除成品文件？")) {
                            for (const t of tasks.filter(x => x.status === "done").slice()) await removeTask(t.id);
                        }
                        break;
                    case "sniff-dl": {
                        const it = sniffItems[+el.dataset.idx];
                        if (it && it.onDownload) await it.onDownload();
                        break;
                    }
                    case "sniff-copy": {
                        const it = sniffItems[+el.dataset.idx];
                        if (it) { mgmapi.copyText(it.url); mgmapi.message("已复制链接", 2000); }
                        break;
                    }
                    case "sf-close":
                        hideSniffPop();
                        break;
                    case "sf-openpanel":
                        hideSniffPop();
                        state.tab = "sniff";
                        openPanel();
                        break;
                    case "cf-pickdir":
                        await pickSaveDir();
                        break;
                    case "pick-dir":
                        await pickSaveDir();
                        break;
                    case "cf-ok": {
                        if (!pendingConfirm) { els.cfModal.classList.remove("open"); break; }
                        const nm = (els.cfName.value || "").trim();
                        const sp = Object.assign({}, pendingConfirm, {
                            name: nm || undefined,
                            threads: parseInt(els.cfThreads.value) || 0,
                            startNow: els.cfNow.checked,
                            mp4: els.cfMp4.checked,
                            sanitize: els.cfSanitize ? els.cfSanitize.checked : undefined, // 任务级覆盖全局默认
                        });
                        els.cfModal.classList.remove("open");
                        pendingConfirm = null;
                        dlog("cf-ok 用户确认", sp.name, "threads=" + sp.threads, "mp4=" + sp.mp4);
                        addTask(sp);
                        break;
                    }
                    case "cf-cancel":
                        els.cfModal.classList.remove("open");
                        pendingConfirm = null;
                        break;
                    case "to-mp4": startConvert(id); break;
                    case "sniff-clear":
                        sniffItems.length = 0;
                        render();
                        renderSniffPop(); // 小窗同步刷新（空则显“暂未嗅探”）
                        break;
                }
            } catch (err) {
                console.error("[wtm]", err);
                mgmapi.message("操作失败：" + err.message);
            }
            notifyUI();
        });
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function fillSettings() {
        if (!els.sThreads) return;
        els.sThreads.value = settings.threads;
        els.sChunk.value = settings.chunkMB;
        els.sConc.value = settings.concurrency;
        els.sAuto.checked = !!settings.autoSave;
        els.sSniff.checked = !!snifferEnabled;
        els.sShowSniff.checked = settings.showSniff !== false;
        els.sFab.checked = settings.showFab !== false;
        if (els.sMp4) els.sMp4.checked = settings.convertMp4 !== false;
        if (els.sDebug) els.sDebug.checked = !!settings.debug;
        if (els.sSanitize) els.sSanitize.checked = settings.sanitizeName !== false;
        if (els.sDirName) els.sDirName.textContent = settings.saveDirName || "浏览器默认下载目录";
        els.sHomeUrl.value = settings.homeUrl;
    }

    /* ---- 渲染 ---- */
    function notifyUI() {
        if (ui.pending) return;
        ui.pending = setTimeout(() => { ui.pending = null; render(); }, 300);
    }

    function statusClass(t) { return t.status === "error" ? "st error" : `st ${t.status}`; }

    function opsHtml(t) {
        const B = (a, txt, cls) => `<button class="btn ${cls || ""} mini" data-act="${a}" data-id="${t.id}">${txt}</button>`;
        const ops = [];
        if (t.status === "downloading" || t.status === "merging") { if (t.status === "downloading") ops.push(B("pause", "⏸ 暂停")); }
        else if (t.status === "queued") ops.push(B("pause", "取消排队"));
        else if (t.status === "paused") ops.push(B("resume", "▶ 继续", "primary"));
        else if (t.status === "error") ops.push(B("resume", "↻ 重试", "primary"));
        else if (t.status === "done") {
            ops.push(B("save", t.mp4 ? "💾 另存 MP4" : "💾 另存为", "primary"));
            if (tsLike(t) && !t.converting) ops.push(B("to-mp4", t.mp4 ? "🎬 重转 MP4" : "🎬 转 MP4"));
        }
        if (t.status !== "done" && t.status !== "merging") ops.push(B("edit", "换址"));
        ops.push(B("copy", "复制链接"));
        ops.push(B("open", "源地址"));
        ops.push(B("del", "删除"));
        return ops.join("");
    }

    function taskHtml(t) {
        const rt = rts.get(t.id);
        const live = rt ? Array.from(rt.live.values()).reduce((a, b) => a + b, 0) : 0;
        let pct = 0;
        if (t.status === "done") pct = 100;
        else if (t.type === "m3u8") pct = t.totalChunks ? (t.doneCount || 0) / t.totalChunks * 100 : 0;
        else if (t.totalSize > 0) pct = Math.min(100, (t.downloaded + live) / t.totalSize * 100);
        const speed = rt ? rt.speed : (estSpeeds.get(t.id) || 0); // 非本页任务用落盘采样估算速度

        let sizeTxt;
        if (t.status === "done") sizeTxt = fmtSize(t.finalSize || t.downloaded);
        else if (t.type === "m3u8") sizeTxt = `分片 ${t.doneCount || 0}/${t.totalChunks || "?"} · ${fmtSize(t.downloaded + live)}`;
        else if (t.totalSize > 0 && isFinite(t.totalSize)) sizeTxt = `${fmtSize(t.downloaded + live)} / ${fmtSize(t.totalSize)}`;
        else sizeTxt = fmtSize(t.downloaded + live);

        let extra = "";
        if (t.status === "downloading" || t.status === "merging") {
            extra = ` · ${fmtSpeed(speed)}`;
            if (t.type !== "m3u8" && speed > 0 && t.totalSize > t.downloaded + live) {
                const eta = fmtEta((t.totalSize - t.downloaded - live) / speed);
                if (eta) extra += ` · 剩余 ${eta}`;
            }
        } else if (t.status === "queued") extra = " · 等待任务槽位";
        else if (t.status === "error" && t.error) extra = ` · ${t.error}`;
        if (ownerAlive(t)) extra += " · 由其它同源标签页处理中";
        else if (t.origin && t.origin !== location.origin && t.status !== "done") {
            let host = ""; try { host = new URL(t.origin).host; } catch { }
            extra += ` · 需在来源站点${host ? `「${host}」` : ""}页面下载`;
        }
        if (t.converting) extra += " · MP4 转换中…";
        else if (t.mp4) extra += " · 已转 MP4";
        else if (t.mp4Error && tsLike(t)) extra += " · MP4 转换失败，可点按钮重试";

        const stTxt = STATUS_TEXT[t.status] || t.status;
        return `
            <div class="wtm-task ${t.id === state.highlightId ? "hl" : ""}" data-id="${t.id}">
                <div class="r1">
                    <span class="name" title="${esc(t.url)}">${esc(t.name)}</span>
                    <span class="tag ${t.type === "m3u8" ? "m3u" : ""}">${t.type}</span>
                    <span class="${statusClass(t)}"${t.error ? ` title="${esc(t.error)}"` : ""}>${stTxt}</span>
                </div>
                <div class="wtm-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
                <div class="r3">
                    <span class="info">${sizeTxt}${extra}</span>
                    <span class="ops">${opsHtml(t)}</span>
                </div>
            </div>
        `;
    }

    const ORDER = { downloading: 0, merging: 0, queued: 1, paused: 2, error: 3, done: 4 };
    function render() {
        if (!els.list) return;
        const running = tasks.filter(t => ["downloading", "queued", "merging"].includes(t.status)).length;
        els.badge.textContent = running;
        els.badge.style.display = running ? "flex" : "none";

        els.cActive.textContent = tasks.filter(t => t.status !== "done").length;
        els.cAll.textContent = tasks.length;
        els.cSniff.textContent = sniffItems.length;
        updateSniffBadge(); // 常驻角标随渲染同步（含嗅探清空后归零隐藏）
        els.panel.querySelectorAll(".tab").forEach(el => el.classList.toggle("on", el.dataset.tab === state.tab));
        if (!state.panelOpen) return; // 面板未开：只刷新徽标/计数，不重建列表 DOM（省电、不闪烁）

        // 嗅探标签：资源列表就在面板里，不再另弹第二个窗口
        if (state.tab === "sniff") {
            els.list.innerHTML = (sniffItems.length
                ? `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:12px;color:#8fa1bd;">本页嗅探到 ${sniffItems.length} 个资源<span class="grow"></span><button class="btn ghost mini" data-act="sniff-clear">清空</button></div>`
                : `<div class="wtm-empty">暂未嗅探到资源，播放/加载媒体后自动出现</div>`)
                + sniffItems.map((it, idx) => `
                    <div class="wtm-sitem">
                        <span class="tag ${it.type === "m3u8" ? "m3u" : ""}">${it.type}</span>
                        <span class="slink" title="${esc(it.url)}" data-act="sniff-copy" data-idx="${idx}">${esc(it.path)}</span>
                        <span class="sdur">${esc(it.duration || "")}</span>
                        <button class="btn mini primary" data-act="sniff-dl" data-idx="${idx}">下载</button>
                    </div>`).join("");
            state.highlightId = "";
            return;
        }

        let rows = tasks.slice();
        if (state.tab === "active") rows = rows.filter(t => t.status !== "done");
        else if (state.tab === "done") rows = rows.filter(t => t.status === "done");
        rows.sort((a, b) => {
            const d = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
            return d !== 0 ? d : a.addedAt - b.addedAt;
        });
        els.list.innerHTML = rows.length
            ? rows.map(taskHtml).join("")
            : `<div class="wtm-empty">暂无任务<br>粘贴链接，或点击页面右侧 ⚡ 悬浮球旁的嗅探资源「下载」按钮添加</div>`;
        state.highlightId = "";
    }

    /* ---- 速度统计 ---- */
    /* 其它标签页在跑的任务：本页没有本地运行时，用落盘 downloaded 采样估算速度，
       保证任意页面打开面板都能看到速度/剩余时间在变化，而不是一根死进度条 */
    const estSamples = new Map(); // id -> {ts, bytes, speed}
    const estSpeeds = new Map();  // id -> 当前估算速度（taskHtml/总速读取）
    function estSpeed(t) {
        const now = Date.now();
        const bytes = t.downloaded || 0;
        const p = estSamples.get(t.id);
        if (!p || now - p.ts > 15000 || bytes < p.bytes) { estSamples.set(t.id, { ts: now, bytes, speed: 0 }); return 0; }
        let sp = p.speed;
        if (bytes > p.bytes) { const dt = (now - p.ts) / 1000; if (dt > 0.2) sp = (bytes - p.bytes) / dt; }
        else sp = sp * 0.7; // 无增长时衰减，逐步归零
        estSamples.set(t.id, { ts: now, bytes, speed: sp });
        return sp;
    }
    function tickSpeed() {
        const now = Date.now();
        let total = 0;
        for (const [id, rt] of rts) {
            const t = findTask(id);
            if (!t) continue;
            const dt = (now - rt.lastTs) / 1000;
            if (dt >= 0.5) {
                const d = t.downloaded - rt.lastBytes;
                rt.speed = d > 0 ? d / dt : rt.speed * 0.6;
                rt.lastBytes = t.downloaded;
                rt.lastTs = now;
            }
            if (t.status === "downloading") total += rt.speed;
        }
        // 非本页运行的下载中任务：按落盘采样估速并计入总速，各标签页面板显示一致
        for (const t of tasks) {
            if (rts.has(t.id)) { estSamples.delete(t.id); estSpeeds.delete(t.id); continue; }
            if (t.status === "downloading" || t.status === "merging") {
                const sp = estSpeed(t);
                estSpeeds.set(t.id, sp);
                if (t.status === "downloading") total += sp;
            } else { estSamples.delete(t.id); estSpeeds.delete(t.id); }
        }
        if (state.panelOpen) startFastPoll(); else stopFastPoll(); // 面板开着就 1.2s 对账一次
        // 引擎页每 2 秒把实时进度落盘，所有标签页/主页都能看到速度
        if (isEngine() && rts.size && now - lastPersist > 2000) { lastPersist = now; saveTasksNow(); }
        if (els.total) els.total.textContent = "↓ " + fmtSpeed(total);
        if (els.list) render();
    }
    let lastPersist = 0;

    /* ---- 统一主页路由：主页固定为 settings.homeUrl（公共极简站外壳 + #wtm-home），页面由脚本构建为全屏下载中心 ---- */
    function sameBase(a, b) {
        try {
            const ua = new URL(a), ub = new URL(b);
            const norm = u => u.origin + u.pathname.replace(/\/+$/, "");
            return norm(ua) === norm(ub);
        } catch { return false; }
    }
    function isHomeRoute() {
        const hu = settings.homeUrl || DEFAULT_SETTINGS.homeUrl;
        return location.hash.indexOf("wtm-home") > -1 && sameBase(location.href, hu);
    }
    // 主页路由判定（仅用于全屏样式与自动续传触发）；下载不再集中于主页，而是回到任务来源同域页执行
    function isEngine() { return isHomeRoute(); }
    // 下载在“任务来源同域页面”执行：只有与任务 origin 同域（origin === 当前页 origin）的页面才能运行它，
    // 使网络请求携带来源站点的 referer/origin/Cookie/会话，能通过防盗链与 Cloudflare；主页与其它页只作只读总览。
    function canRunHere(t) { return !!t && t.origin === location.origin; }
    async function ensureSourceTab(t) {
        // 任务属于其它站点：本页面无法代发其下载请求。打开其来源页（referer），由该同域标签页认领续跑。
        const target = (t && (t.referer || t.url)) || "";
        let host = "";
        try { host = new URL((t && t.origin) || target).host; } catch { }
        mgmapi.message(`该任务需在来源站点${host ? `「${host}」` : ""}的页面下载，正在为你打开来源页`, 6000);
        if (target) { try { mgmapi.openInTab(target, false); } catch { } }
    }

    async function ensureEngine() {
        try {
            const ping = await mgmapi.getValue("wtm-engine-ping", 0);
            if (Date.now() - (+ping || 0) < 9000) { dlog("ensureEngine 主页存活，不重复打开"); return; } // 已有存活的主页标签页
            dlog("ensureEngine 后台唤起主页", settings.homeUrl);
            await mgmapi.setValue("wtm-engine-ping", 0);   // 抢占一个周期，避免多标签页同时开主页
            mgmapi.openInTab(settings.homeUrl, true);      // 后台打开，不抢焦点
        } catch { }
    }

    let homeResumed = false;
    function applyRoute() {
        if (!els.panel) return;
        const home = isHomeRoute();
        els.panel.classList.toggle("home", home);
        if (home) {
            state.maximized = false;
            els.panel.classList.remove("max");
            els.panel.classList.add("open");
            state.panelOpen = true;
            // 首次进入主页路由：自动续传暂停的任务
            if (settings.autoResumeOnHome && !homeResumed) {
                homeResumed = true;
                let n = 0;
                tasks.forEach(t => {
                    if (t.status === "paused" && canRunHere(t)) { t.status = "queued"; n++; }
                });
                if (n) { saveTasks(); schedule(); mgmapi.message(`主页已自动续传 ${n} 个任务`); }
            }
        }
        render();
    }

    /* ==================== Tampermonkey 菜单命令（点图标/右键图标均可见） ==================== */
    const GMmenu = {
        reg(name, fn) {
            try {
                const f = (typeof GM_registerMenuCommand === "function") ? GM_registerMenuCommand : (GM && GM.registerMenuCommand);
                return f ? f(name, fn) : null;
            } catch (e) { return null; }
        },
        unreg(id) {
            try {
                const f = (typeof GM_unregisterMenuCommand === "function") ? GM_unregisterMenuCommand : (GM && GM.unregisterMenuCommand);
                if (f && id != null) f(id);
            } catch (e) { }
        }
    };

    let menuIds = [];

    function openHomeNewTab() { mgmapi.openInTab(settings.homeUrl, false); }
    function openHomeHere() { if (isHomeRoute()) { applyRoute(); return; } location.href = settings.homeUrl; }

    function persistSettings() {
        lastSettingsRaw = JSON.stringify(settings); // 记录基准，自己写的设置不当作远端变更
        return mgmapi.setValue("wtm-settings", lastSettingsRaw).catch(() => { });
    }

    function applyEntryVisibility() {
        if (els.fab) els.fab.style.display = settings.showFab ? "" : "none";
        renderSniff();
    }

    async function setShowFab(v) {
        settings.showFab = v;
        await persistSettings();
        applyEntryVisibility();
        buildMenu();
        mgmapi.message(v ? "已显示页面 ⚡ 悬浮球" : "已隐藏页面 ⚡ 悬浮球，可在 Tampermonkey 菜单中恢复或打开下载主页");
    }

    async function setShowSniff(v) {
        settings.showSniff = v;
        await persistSettings();
        applyEntryVisibility();
        buildMenu();
        mgmapi.message(v ? "已开启：嗅探到新资源自动打开面板（单一面板）" : "已关闭新资源自动弹出，可手动点 ⚡ 查看嗅探标签");
    }

    function buildMenu() {
        menuIds.forEach(id => GMmenu.unreg(id));
        menuIds = [];
        menuIds.push(GMmenu.reg("📥 打开统一下载主页（新标签）", openHomeNewTab));
        menuIds.push(GMmenu.reg("🏠 在本标签打开主页", openHomeHere));
        menuIds.push(GMmenu.reg(settings.showFab ? "🙈 隐藏页面 ⚡ 悬浮球" : "🐵 显示页面 ⚡ 悬浮球", () => setShowFab(!settings.showFab)));
        menuIds.push(GMmenu.reg(settings.showSniff ? "📡 关闭新资源自动弹出面板" : "📡 开启新资源自动弹出面板", () => setShowSniff(!settings.showSniff)));
        menuIds.push(GMmenu.reg(settings.debug ? "🐞 关闭调试日志" : "🐛 开启调试日志", async () => {
            settings.debug = !settings.debug;
            await persistSettings();
            buildMenu();
            dlog("调试日志已开启", "v" + SCRIPT_VER, "page=" + PAGE_ID);
            mgmapi.message(settings.debug ? "调试日志已开启：F12 控制台看 [wtm][dbg]（已同步到所有标签页）" : "调试日志已关闭");
        }));
        menuIds.push(GMmenu.reg("🗂 打开/收起本页下载面板", () => {
            if (els.panel) togglePanel();
            else mgmapi.message("本页界面尚未就绪，请稍后再试");
        }));
        menuIds.push(GMmenu.reg("🧾 查看任务列表（全部）", () => {
            if (!els.panel) { mgmapi.message("本页界面尚未就绪，请稍后再试"); return; }
            state.tab = "all";
            openPanel();
        }));
    }

    /* ==================== 启动 ==================== */
    sniffStart(); // document-start 立即挂钩，捕捉最早的 m3u8 请求

    (async function boot() {
        try {
            const sRaw = await mgmapi.getValue("wtm-settings", "");
            lastSettingsRaw = sRaw;
            const s = JSON.parse(sRaw || "null");
            if (s) {
                Object.assign(settings, DEFAULT_SETTINGS, s);
                if (LEGACY_HOME_URLS.includes(settings.homeUrl)) settings.homeUrl = DEFAULT_SETTINGS.homeUrl; // 旧默认外壳迁移
            }
        } catch { }
        snifferEnabled = settings.sniff !== false;
        dlog("boot", "v" + SCRIPT_VER, "page=" + PAGE_ID, "IN_FRAME=" + IN_FRAME, "home=" + isHomeRoute(), "engine=" + isEngine(), "homeUrl=" + settings.homeUrl);
        // 重复实例检测：新旧脚本双开是常见故障源（双 UI、双引擎抢任务），同页两个实例在 unsafeWindow 上留痕互见
        try {
            const mark = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;
            if (mark.__wtm_boot && String(mark.__wtm_boot).indexOf(PAGE_ID) !== 0) {
                console.warn("[wtm] 检测到另一个脚本实例：", mark.__wtm_boot, "本页将同时存在两套 UI/引擎，请在 Tampermonkey 中只保留一个");
                mgmapi.message("⚠️ 本页检测到另一个 Web下载器实例（" + mark.__wtm_boot + "），请检查是否重复安装了脚本", 10000);
            }
            mark.__wtm_boot = PAGE_ID + "@" + SCRIPT_VER;
        } catch { }
        if (IN_FRAME) { // iframe：只保留嗅探+投送，不建 UI、不加载任务、不注册菜单，避免同页多实例
            const ff = (typeof GM_addValueChangeListener === "function") ? GM_addValueChangeListener
                : ((typeof GM !== "undefined" && GM && GM.addValueChangeListener) ? GM.addValueChangeListener.bind(GM) : null);
            const applyS = s => { if (s) { Object.assign(settings, DEFAULT_SETTINGS, s); snifferEnabled = settings.sniff !== false; } };
            if (ff) { try { ff("wtm-settings", (n, o, nv, remote) => { if (remote) { try { applyS(JSON.parse(nv)); } catch { } } }); } catch { } }
            setInterval(async () => { // 兜底：定时拉取嗅探开关设置
                try { applyS(JSON.parse(await mgmapi.getValue("wtm-settings", "null") || "null")); } catch { }
            }, 8000);
            return;
        }
        const rawInit = await mgmapi.getValue("wtm-tasks", "");
        lastPolledTasksRaw = rawInit;
        const st = parseStored(rawInit);
        tasks = st.list;
        for (const [id, ts] of Object.entries(st.deleted || {})) deletedTs.set(id, ts);
        // 页面刷新/切页后：进行中状态归位（但保留其它存活标签页正在跑的任务）
        for (const t of tasks) {
            if (["downloading", "queued", "merging"].includes(t.status)) {
                if (ownerAlive(t)) continue;
                t.status = (canRunHere(t) && settings.autoResumeOnHome) ? "queued" : "paused";
                if (t.type === "m3u8") t.planned = false;
            }
        }
        const ready = cb => document.body ? cb() : addEventListener("DOMContentLoaded", cb);
        ready(() => {
            buildUI(); // 内部会在 #wtm-home 路由时自动进入主页模式
            if (tasks.length) notifyUI();
            schedule();
        });
        watchStorage(); // 监听其它标签页的任务/命令变化，实现跨页数据互通
        addEventListener("message", ev => { // 页世界转封装结果回报
            const d = ev.data;
            if (d && d.wtm === "mp4-result") finishConvert(d.taskId, !!d.ok, d);
        });
        tasks.forEach(t => { t.converting = false; }); // 刷新时清理半途而废的转换标记
        // 每个站点页面都可能是自己任务的下载引擎：无条件恢复本域已授权的保存文件夹（直写按域名各存各的）
        try { const m = await Store.getMeta("savedir"); if (m && m.value) { dirHandle = m.value; settings.saveDirName = m.value.name || settings.saveDirName; } } catch { }
        if (isEngine()) { // 主页路由心跳（保留兼容；下载已不再集中于主页）
            setInterval(() => { try { mgmapi.setValue("wtm-engine-ping", Date.now()); } catch { } }, 3000);
        }
        buildMenu(); // Tampermonkey 图标菜单/右键菜单入口
        setInterval(schedule, 2500);
        setInterval(tickSpeed, 1000);
        addEventListener("beforeunload", () => saveTasksNow());
    })();

})();

/* ==================== magnet 链接「播放」按钮（保留原功能） ==================== */
(function () {
    'use strict';

    const reg = /magnet:\?xt=urn:btih:\w{10,}([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

    let l = navigator.language || "en";
    if (l.startsWith("en-")) l = "en";
    else if (l.startsWith("zh-")) l = "zh-CN";
    else l = "en";

    const T = {
        "en": { play: "Play" },
        "zh-CN": { play: '播放' }
    }[l];

    whenDOMReady(() => {
        addStyle(`
            button[data-wtmzjk-mag-url]{
                all: initial; border: none; outline: none; background: none;
                background: #08a6f7; margin: 2px 8px; border-radius: 3px; color: white;
                cursor: pointer; display: inline-flex; height: 1.6em; padding: 0 .8em;
                align-items: center; justify-content: center; transition: background .15s;
                text-decoration: none; border-radius: 0.8em; font-size: small;
            }
            button[data-wtmzjk-mag-url]>svg{ height: 60%; fill: white; pointer-events: none; }
            button[data-wtmzjk-mag-url]:hover{ background: #39b9f9; }
            button[data-wtmzjk-mag-url]:active{ background: #0797df; }
            button[data-wtmzjk-mag-url]>span{ pointer-events: none; font-size: small; margin-right: .5em; font-weight: bold; color: white !important; }
        `);
        watchBodyChange(work);
    });

    function createWatchButton(url, isForPlain = false) {
        let button = document.createElement("button");
        button.setAttribute('data-wtmzjk-mag-url', url);
        if (isForPlain) button.setAttribute('data-wtmzjk-button-for-plain', '');
        button.innerHTML = `<span>${T.play}</span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>`;
        button.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            let a = document.createElement('a');
            a.href = 'https://www.diancigaoshou.com/#' + new URLSearchParams({ url: button.getAttribute('data-wtmzjk-mag-url') });
            a.target = "_blank";
            a.click();
        });
        return button;
    }

    function hasPlainMagUrlThatNotHandled() {
        let m = document.body.textContent.match(new RegExp(reg, 'g'));
        return document.querySelectorAll(`[data-wtmzjk-button-for-plain]`).length != (m ? m.length : 0);
    }

    function work() {
        if (!document.body) return;
        if (hasPlainMagUrlThatNotHandled()) {
            for (let node of getAllTextNodes(document.body)) {
                if (node.nextSibling && node.nextSibling.hasAttribute && node.nextSibling.hasAttribute('data-wtmzjk-mag-url')) continue;
                let text = node.nodeValue;
                if (!reg.test(text)) continue;
                let match = text.match(reg);
                if (match) {
                    let url = match[0];
                    let p = node.parentNode;
                    p.insertBefore(document.createTextNode(text.slice(0, match.index + url.length)), node);
                    p.insertBefore(createWatchButton(url, true), node);
                    p.insertBefore(document.createTextNode(text.slice(match.index + url.length)), node);
                    p.removeChild(node);
                }
            }
        }
        for (let a of Array.from(document.querySelectorAll(
            ['href', 'value', 'data-clipboard-text', 'data-value', 'title', 'alt', 'data-url', 'data-magnet', 'data-copy'].map(n => `[${n}*="magnet:?xt=urn:btih:"]`).join(',')
        ))) {
            if (a.nextSibling && a.nextSibling.hasAttribute && a.nextSibling.hasAttribute('data-wtmzjk-mag-url')) continue;
            if (reg.test(a.textContent)) continue;
            for (let attr of a.getAttributeNames()) {
                let val = a.getAttribute(attr);
                if (!reg.test(val)) continue;
                let url = val.match(reg)[0];
                a.parentNode.insertBefore(createWatchButton(url), a.nextSibling);
            }
        }
    }

    function watchBodyChange(onchange) {
        let timeout;
        let observer = new MutationObserver(() => {
            if (!timeout) {
                timeout = setTimeout(() => { timeout = null; onchange(); }, 300);
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true }); // 只关注节点增删：属性/文本变化高频且与按钮注入无关
    }

    function getAllTextNodes(parent) {
        var re = [];
        if (["STYLE", "SCRIPT", "BASE", "COMMAND", "LINK", "META", "TITLE", "XTRANS-TXT", "XTRANS-TXT-GROUP", "XTRANS-POPUP"].includes(parent.tagName)) return re;
        for (let node of parent.childNodes) {
            if (node.childNodes.length) re = re.concat(getAllTextNodes(node));
            else if (Text.prototype.isPrototypeOf(node) && (!node.nodeValue.match(/^\s*$/))) re.push(node);
        }
        return re;
    }

    function whenDOMReady(f) {
        if (document.body) f();
        else window.addEventListener("DOMContentLoaded", f);
    }

    function addStyle(s) {
        let style = document.createElement("style");
        style.innerHTML = s;
        document.documentElement.appendChild(style);
    }

})();
