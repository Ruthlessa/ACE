# ACE 视频解析

解析视频链接信息并下载视频的命令行工具。

- **B 站链接**：走公开 API（数据中心 IP 访问网页端常被 412 风控，API 可用）
- **其他站点**：走 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 通用提取器

## 安装

```bash
pip install -r requirements.txt
```

## 使用

解析（显示标题、时长、清晰度、流地址等）：

```bash
python3 ace.py parse "https://www.bilibili.com/video/BV1xx411c7mD"
python3 ace.py parse "<任意 yt-dlp 支持的链接>" --json   # 原始 JSON 输出
```

下载：

```bash
# B 站：默认 720P，输出为 MP4
python3 ace.py download "https://www.bilibili.com/video/BV1xx411c7mD" -o "%(title)s.%(ext)s"

# 其他站点：yt-dlp 格式语法
python3 ace.py download "<URL>" -f "bv*+ba/b" -o "%(title)s.%(ext)s"
```

## 支持范围

| 来源 | 解析 | 下载 |
|------|------|------|
| B 站 (bilibili.com) | ✅ | ✅ |
| 其他 yt-dlp 支持站点 | ✅ | ✅（取决于网络可达性） |

> 注意：部分站点（如 YouTube、Twitter）可能在某些网络环境下不可达。
