# Greasy Fork 投稿指南 · Web迅雷

> 目标脚本：`publish/web-xunlei-downloader.greasyfork.user.js`
> 与主脚本的唯一区别：**已移除 `@downloadURL`/`@updateURL`**（更新交给 Greasy Fork 托管），并新增 `@icon` 指向 GitHub Pages 图标。
> GitHub Pages 直装链接（`https://cat-x.github.io/web-downloader/web-xunlei-downloader.user.js`）保留作"备用/自更新"入口，二者互不影响。

---

## 一、上传步骤（约 3 分钟，需你本人账号操作）

1. 打开 <https://greasyfork.org/zh-CN> → 右上角登录（可用 GitHub 账号 `cat-x` 直接授权登录，最省事）。
2. 顶部「**我的脚本** → **导入脚本**」或「**发布您的脚本**」。
3. 选择「**粘贴代码**」方式：
   - 用编辑器打开 `web-downloader/publish/web-xunlei-downloader.greasyfork.user.js`，**全选复制**整份内容，粘进代码框。
   - 或用「从 URL 导入」临时填 GitHub raw 链接，导入后再切回编辑（注意：raw 链接导入只抓一次，之后更新仍靠你重新粘贴上传）。
4. 按下面「二、投稿描述」把**简介 + 详细描述**填入对应字段。
5. 「授权协议」选 **MIT**（脚本头已声明）。
6. 若弹出"是否为测试/占位脚本"选择，勾「**不是测试**」。
7. 保存 → 等待 Greasy Fork 自动审核（新作者/含远程加载的脚本可能转人工，通常数小时~1 天）。审核通过后会给一个 `https://greasyfork.org/zh-CN/scripts/xxxxx` 安装页。

---

## 二、投稿描述（直接复制粘贴）

### 脚本名（标题）
`Web迅雷【m3u8嗅探+断点续传下载管理器】`

### 简介（一句话，对应 @description）
`类迅雷的网页综合下载工具：m3u8 自动嗅探与分片合并、分块多线程下载、断点续传、暂停/继续、任务排重、MP4 无损转封装。`

### 详细描述（中文，粘贴到"Description"）

```markdown
一个装在浏览器里的"网页版迅雷"。在视频/资源站点自动嗅探 m3u8 与直链，统一管理下载任务，支持断点续传与无损转 MP4。**所有数据仅存本地浏览器（IndexedDB），不上传任何服务器，无需注册。**

## 主要特性
- 🛰️ **自动嗅探**：无需点菜单，自动发现 m3u8 / 视频直链，悬浮球实时反馈资源数量与类型
- 📥 **统一下载主页**：固定网址的下载中心，所有任务跨站点集中管理（主页为作者自有 GitHub Pages 静态壳页，零第三方依赖）
- ⚡ **分块多线程 + 断点续传**：大文件切片并发下载，关页面/暂停后从分片处续传，不重头再来
- ⏸️ **暂停 / 继续**：真正的请求中止（abort）+ 跨标签页状态同步
- 🗂️ **任务管理**：排重合并、更换下载地址、另存为、进度/速度/剩余时间实时刷新
- 🎬 **MP4 无损转封装**：TS→MP4 用 ffmpeg.wasm `-c copy` 重封装（不重编码，秒级），失败不影响已下载的 TS 成品
- 📁 **指定文件夹静默写入**：File System Access API 授权目录后完成即写入，不再弹保存框
- ✍️ **智能文件名**：点击下载一刻取页面标题作默认名；跨平台自动修正非法字符/保留名，Windows/macOS/Linux/Android 均可直接保存

## 使用流程
1. 在视频站点正常播放，脚本嗅探到资源后点「下载」；
2. 在确认面板可改文件名 / 线程数 / 是否转 MP4，点「开始下载」；
3. 任务自动投送统一主页执行，任意页面都能查看进度、暂停/继续。

## 环境要求与注意事项
- 推荐 **Chrome / Edge**（分块下载、指定文件夹、MP4 转封装依赖较新的浏览器能力）。
- 「指定保存文件夹」需 Chrome/Edge 且 HTTPS 环境；浏览器安全策略**禁止网页直接选中「下载/桌面/文稿/主目录」本身**，请在其中新建子文件夹再选择（脚本会给出中文引导）。
- **MP4 转封装**：首次使用时按需联网加载 ffmpeg.wasm（jsDelivr CDN），不转 MP4 则完全不加载；超大文件（>1–2GB）受 wasm 内存限制可能失败；H.265 等不兼容 MP4 容器的编码会转换失败（可重试，不影响 TS 成品）。

## 隐私
所有下载数据、任务状态、设置均保存在本地浏览器（IndexedDB + Tampermonkey 存储），脚本不收集、不上传任何个人信息。

## 开源
源码与更新日志：<https://github.com/cat-x/web-downloader>（MIT）
问题反馈：<https://github.com/cat-x/web-downloader/issues>
```

### 详细描述（English，粘贴到英文描述框 / 或作为补充）

```markdown
A "web-based Thunder" living in your browser. It auto-sniffs m3u8 & direct links on video/resource sites, manages downloads centrally with resume support and lossless TS→MP4 remux. **All data stays in your browser (IndexedDB); nothing is uploaded, no account needed.**

## Features
- 🛰️ Auto sniffing of m3u8 / video links, with a live floating-ball badge showing count & type
- 📥 Unified download hub (a static GitHub Pages shell page, zero third-party dependencies)
- ⚡ Chunked multi-threaded download + resume (slices cached in IndexedDB)
- ⏸️ Real pause/continue via request abort, synced across tabs
- 🎬 Lossless MP4 remux via ffmpeg.wasm `-c copy` (loaded on demand only when converting)
- 📁 Silent write to a chosen folder via File System Access API
- ✍️ Smart, cross-platform-safe filenames (dynamic page-title naming + illegal-char sanitization)

## Notes
- Best on Chrome / Edge.
- Converting to MP4 loads ffmpeg.wasm from a CDN on first use only; very large files (>1–2 GB) may exceed wasm memory; H.265 etc. may fail to remux (TS output unaffected).
- Source (MIT): https://github.com/cat-x/web-downloader · Issues: https://github.com/cat-x/web-downloader/issues
```

---

## 三、必须主动披露的一点（降低审核被拒风险）

Greasy Fork 会对"加载远程代码"敏感。本脚本的 **ffmpeg.wasm（MP4 转封装）在运行时从 jsDelivr CDN 动态加载**，且仅在用户勾选/点击"转 MP4"时才加载，其余功能零远程依赖。请确保上面描述里"环境要求与注意事项 / Notes"这段保留——作者已说明来源、用途与按需加载，符合 Greasy Fork "远程代码须披露"的要求。

---

## 四、每次发新版本后，重新生成投稿副本（一行命令）

主脚本更新后，同步生成去掉自更新链接、补图标的 Greasy Fork 版本：

```bash
cd /Users/mac/Documents/NewCodeSpace/tampermonkey \
&& cp web-xunlei-downloader.user.js web-downloader/publish/web-xunlei-downloader.greasyfork.user.js \
&& perl -0pi -e 's{^// \@downloadURL .*\n^// \@updateURL .*\n}{// \@icon         https://cat-x.github.io/web-downloader/icon.svg\n}m' web-downloader/publish/web-xunlei-downloader.greasyfork.user.js \
&& node --check web-downloader/publish/web-xunlei-downloader.greasyfork.user.js && echo GF_READY
```

然后把新的 `web-xunlei-downloader.greasyfork.user.js` 全文粘到 Greasy Fork 脚本的「Code」标签保存即可（Greasy Fork 会自动识别 `@version` 变化并推送更新给订阅者）。

> 说明：`@icon` 那行若已在副本中存在，则 perl 只替换 download/update 两行；重复运行安全（幂等）。

---

## 五、上架后可选的引流

- 在 GitHub 仓库 `README.md` 的「📥 安装脚本」旁边加一行 Greasy Fork 安装页链接（审核通过后回填 `xxxxx` 数字 ID）。
- 主脚本头部的 `@downloadURL/@updateURL` **保持不变**（继续走 Pages 自更新），与 Greasy Fork 是两个独立分发渠道，用户任选其一。
