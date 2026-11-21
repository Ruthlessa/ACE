# ACE 视频解析

解析视频链接信息、下载视频的工具，提供网页版和命令行两种方式。

- **B 站链接**：走公开 API（数据中心 IP 访问网页端常被 412 风控，API 可用）
- **其他站点**：走 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 通用提取器

## 安装

```bash
pip install -r requirements.txt
```

## 网页版

```bash
python3 web.py        # 默认 8000 端口
# 或 python3 web.py 9000
```

浏览器打开 `http://127.0.0.1:8000`，粘贴视频链接即可解析：

- 标题、作者、时长、播放/点赞数、封面图
- 可用清晰度/格式标签
- 视频流地址，可直接打开原视频或一键下载（服务端代理，绕过 CDN 防盗链）

接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 解析页面 |
| POST | `/api/parse` | `{"url": "..."}` → 解析结果 JSON |
| GET | `/api/download?url=...` | 代理下载视频文件 |

## Cloudflare Workers 部署

仓库根目录的 `wrangler.jsonc` + `worker.js` 是网页版的 Worker 实现（功能与 `web.py` 一致），可直接部署：

```bash
npx wrangler deploy
```

- 部署命令为 `npx wrangler deploy` 的项目（如 Cloudflare 集成部署）开箱即用
- Worker 版对非 B 站链接回退为页面 og 元数据解析（无法运行 yt-dlp，仅提供标题/封面等基础信息）

## 命令行

```bash
# 解析（--json 输出原始 JSON）
python3 ace.py parse "https://www.bilibili.com/video/BV1xx411c7mD"

# 下载
python3 ace.py download "https://www.bilibili.com/video/BV1xx411c7mD" -o "%(title)s.%(ext)s"
```

## 支持范围

| 来源 | 解析 | 下载 |
|------|------|------|
| B 站 (bilibili.com) | ✅ | ✅ |
| 其他 yt-dlp 支持站点 | ✅ | 取决于网络可达性 |

> 注意：部分站点（如 YouTube、Twitter）可能在某些网络环境下不可达。
