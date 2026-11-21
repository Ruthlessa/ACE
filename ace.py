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


# ---------- B 站 ----------

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


def bili_parse(url: str, json_out: bool) -> int:
    bvid = parse_bvid(url)
    if not bvid:
        print(f"无法从链接提取 BV 号: {url}", file=sys.stderr)
        return 1
    view = bili_get("/x/web-interface/view", {"bvid": bvid})
    cid = view["cid"]

    if json_out:
        print(json.dumps(view, ensure_ascii=False, indent=2))
        return 0

    stat = view.get("stat", {})
    print(f"标题:   {view.get('title')}")
    print(f"UP 主:  {view.get('owner', {}).get('name')}")
    print(f"时长:   {view.get('duration')} 秒")
    print(f"播放:   {stat.get('view')}  点赞: {stat.get('like')}  弹幕: {stat.get('danmaku')}")
    print(f"封面:   {view.get('pic')}")
    print(f"BV:     {bvid}  cid: {cid}")

    play = bili_get(
        "/x/player/playurl",
        {"bvid": bvid, "cid": cid, "qn": 120, "fnval": 1, "fourk": 1},
    )
    qualities = play.get("support_formats") or []
    print("\n可用清晰度:")
    for q in qualities:
        print(f"  qn={q.get('quality'):<4} {q.get('new_description') or q.get('display_desc')}")
    durl = play.get("durl") or []
    if durl:
        print(f"\n默认线路 ({QN_LABELS.get(play.get('quality'), play.get('quality'))}):")
        print(f"  {durl[0]['url'][:110]}...")
    return 0


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


# ---------- 通用 (yt-dlp) ----------

def generic_parse(url: str, json_out: bool) -> int:
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)

    if json_out:
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    print(f"标题:   {info.get('title')}")
    print(f"作者:   {info.get('uploader') or info.get('channel')}")
    print(f"时长:   {info.get('duration')} 秒")
    print(f"播放量: {info.get('view_count')}")
    print(f"封面:   {info.get('thumbnail')}")

    formats = info.get("formats") or []
    print(f"\n可用格式 ({len(formats)}):")
    for f in formats[-10:]:
        res = f.get("resolution") or f.get("format_note") or "?"
        print(f"  [{f.get('format_id')}] {res:>10}  {f.get('ext')}  {f.get('vcodec') or 'audio'}")
    return 0


def generic_download(url: str, output: str, fmt: str) -> int:
    with yt_dlp.YoutubeDL(
        {"quiet": True, "no_warnings": True, "outtmpl": output, "format": fmt}
    ) as ydl:
        info = ydl.extract_info(url, download=True)
    print(f"已下载: {ydl.prepare_filename(info)}")
    return 0


# ---------- CLI ----------

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
        if parse_bvid(args.url):
            if args.command == "parse":
                return bili_parse(args.url, args.json)
            return bili_download(args.url, args.output)
        if args.command == "parse":
            return generic_parse(args.url, args.json)
        return generic_download(args.url, args.output, args.format)
    except (yt_dlp.utils.DownloadError, RuntimeError, requests.RequestException) as e:
        print(f"解析失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
