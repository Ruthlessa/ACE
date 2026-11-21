#!/usr/bin/env python3
"""ACE 视频解析工具 —— 解析视频链接信息并下载视频。

- B 站链接走公开 API（网页端在数据中心 IP 常被 412 风控）
- 其他站点走 yt-dlp 通用提取器
"""

import argparse
import json
import re
import sys

import requests
import yt_dlp

BILI_API = "https://api.bilibili.com"
# API 端点对浏览器 UA 返回 412 风控，用 curl UA；CDN 下载则要求浏览器 UA
API_HEADERS = {
    "User-Agent": "curl/8.5.0",
    "Referer": "https://www.bilibili.com/",
}
DL_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com/",
}
QN_LABELS = {16: "360P", 32: "480P", 64: "720P", 80: "1080P", 112: "1080P+", 116: "1080P60", 120: "4K"}


# ---------- 解析核心（CLI 与网页共用） ----------

def parse_bvid(url: str) -> str | None:
    m = re.search(r"(BV[0-9A-Za-z]{10})", url)
    return m.group(1) if m else None


def bili_get(path: str, params: dict) -> dict:
    r = requests.get(f"{BILI_API}{path}", params=params, headers=API_HEADERS, timeout=20)
    r.raise_for_status()
    data = r.json()
    if data.get("code") != 0:
        raise RuntimeError(f"B 站 API 错误: {data.get('code')} {data.get('message')}")
    return data["data"]


def extract_bili(url: str) -> dict:
    """解析 B 站链接，返回统一结构的字典。"""
    bvid = parse_bvid(url)
    if not bvid:
        raise ValueError(f"无法从链接提取 BV 号: {url}")
    view = bili_get("/x/web-interface/view", {"bvid": bvid})
    play = bili_get(
        "/x/player/playurl",
        {"bvid": bvid, "cid": view["cid"], "qn": 120, "fnval": 1, "fourk": 1},
    )
    stat = view.get("stat", {})
    qualities = [
        {"qn": q.get("quality"), "label": q.get("new_description") or q.get("display_desc")}
        for q in (play.get("support_formats") or [])
    ]
    durl = play.get("durl") or []
    return {
        "source": "bilibili",
        "bvid": bvid,
        "title": view.get("title"),
        "author": view.get("owner", {}).get("name"),
        "duration": view.get("duration"),
        "views": stat.get("view"),
        "likes": stat.get("like"),
        "danmaku": stat.get("danmaku"),
        "thumbnail": view.get("pic"),
        "qualities": qualities,
        "quality": QN_LABELS.get(play.get("quality"), str(play.get("quality"))),
        "stream_url": durl[0]["url"] if durl else None,
        "page_url": f"https://www.bilibili.com/video/{bvid}",
    }


def extract_generic(url: str) -> dict:
    """用 yt-dlp 解析其他站点，返回统一结构的字典。"""
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    formats = info.get("formats") or []
    return {
        "source": info.get("extractor_key") or "generic",
        "title": info.get("title"),
        "author": info.get("uploader") or info.get("channel"),
        "duration": info.get("duration"),
        "views": info.get("view_count"),
        "likes": None,
        "danmaku": None,
        "thumbnail": info.get("thumbnail"),
        "qualities": [
            {
                "qn": f.get("format_id"),
                "label": f.get("resolution") or f.get("format_note") or f.get("ext") or "?",
            }
            for f in formats[-10:]
        ],
        "quality": None,
        "stream_url": None,
        "page_url": url,
    }


def extract(url: str) -> dict:
    """根据链接自动选择解析器。"""
    if parse_bvid(url):
        return extract_bili(url)
    return extract_generic(url)


# ---------- 下载 ----------

def bili_download(url: str, output: str) -> int:
    bvid = parse_bvid(url)
    if not bvid:
        print(f"无法从链接提取 BV 号: {url}", file=sys.stderr)
        return 1
    view = bili_get("/x/web-interface/view", {"bvid": bvid})
    play = bili_get(
        "/x/player/playurl",
        {"bvid": bvid, "cid": view["cid"], "qn": 80, "fnval": 1},
    )
    durl = play.get("durl") or []
    if not durl:
        print("未获取到视频流地址", file=sys.stderr)
        return 1

    title = re.sub(r'[\\/:*?"<>|]', "_", view.get("title") or bvid)
    url_ext = durl[0]["url"].split("?")[0].rsplit(".", 1)[-1]
    filename = output.replace("%(title)s", title).replace("%(ext)s", url_ext)
    total = 0
    with requests.get(durl[0]["url"], headers=DL_HEADERS, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(filename, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 16):
                f.write(chunk)
                total += len(chunk)
    print(f"已下载: {filename} ({total / 1e6:.1f} MB, {QN_LABELS.get(play.get('quality'), '?')})")
    return 0


def generic_download(url: str, output: str, fmt: str) -> int:
    with yt_dlp.YoutubeDL(
        {"quiet": True, "no_warnings": True, "outtmpl": output, "format": fmt}
    ) as ydl:
        info = ydl.extract_info(url, download=True)
    print(f"已下载: {ydl.prepare_filename(info)}")
    return 0


# ---------- CLI ----------

def cmd_parse(url: str, json_out: bool) -> int:
    info = extract(url)
    if json_out:
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0
    print(f"标题:   {info['title']}")
    print(f"作者:   {info['author']}")
    print(f"时长:   {info['duration']} 秒")
    print(f"播放:   {info['views']}  点赞: {info['likes']}  弹幕: {info['danmaku']}")
    print(f"封面:   {info['thumbnail']}")
    print(f"来源:   {info['source']}")
    if info["qualities"]:
        print("\n可用清晰度/格式:")
        for q in info["qualities"]:
            print(f"  {q['qn']}: {q['label']}")
    if info["stream_url"]:
        print(f"\n默认线路 ({info['quality']}):")
        print(f"  {info['stream_url'][:110]}...")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="ace", description="ACE 视频解析工具")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("parse", help="解析视频链接，显示信息")
    p.add_argument("url", help="视频 URL")
    p.add_argument("--json", action="store_true", help="输出原始 JSON")

    d = sub.add_parser("download", help="下载视频")
    d.add_argument("url", help="视频 URL")
    d.add_argument("-o", "--output", default="%(title)s.%(ext)s", help="输出文件名模板")
    d.add_argument("-f", "--format", default="bv*+ba/b", help="格式选择 (yt-dlp，默认最佳)")

    args = parser.parse_args()
    try:
        if args.command == "parse":
            return cmd_parse(args.url, args.json)
        if parse_bvid(args.url):
            return bili_download(args.url, args.output)
        return generic_download(args.url, args.output, args.format)
    except (yt_dlp.utils.DownloadError, RuntimeError, ValueError, requests.RequestException) as e:
        print(f"解析失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
