#!/usr/bin/env python3
"""ACE 视频解析网页版 —— 启动后在浏览器打开，粘贴视频链接即可解析。"""

import time

from flask import Flask, jsonify, render_template_string, request

from ace import extract

app = Flask(__name__)

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ACE 视频解析</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --border:#30363d; --fg:#e6edf3; --muted:#8b949e; --accent:#2f81f7; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background:var(--bg); color:var(--fg); font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:48px 16px; }
  h1 { font-size:28px; margin-bottom:8px; }
  h1 span { color:var(--accent); }
  .sub { color:var(--muted); margin-bottom:32px; font-size:14px; }
  form { display:flex; gap:10px; width:100%; max-width:720px; }
  input[type=url] { flex:1; padding:12px 16px; font-size:15px; background:var(--card); border:1px solid var(--border); border-radius:8px; color:var(--fg); outline:none; }
  input[type=url]:focus { border-color:var(--accent); }
  button { padding:12px 24px; font-size:15px; font-weight:600; background:var(--accent); border:none; border-radius:8px; color:#fff; cursor:pointer; }
  button:disabled { opacity:.5; cursor:wait; }
  #result { width:100%; max-width:720px; margin-top:28px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; animation:fade .3s ease; }
  @keyframes fade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  .cover { width:100%; max-height:340px; object-fit:cover; display:block; background:#000; }
  .body { padding:20px; }
  .title { font-size:19px; font-weight:600; margin-bottom:12px; line-height:1.4; }
  .meta { display:flex; flex-wrap:wrap; gap:8px 20px; color:var(--muted); font-size:14px; margin-bottom:14px; }
  .meta b { color:var(--fg); font-weight:500; }
  .tags { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
  .tag { font-size:12px; padding:4px 10px; background:#21262d; border:1px solid var(--border); border-radius:999px; color:#c9d1d9; }
  .stream { word-break:break-all; font-size:12px; color:var(--muted); background:#0d1117; border:1px solid var(--border); border-radius:8px; padding:10px; max-height:120px; overflow:auto; }
  .actions { margin-top:14px; display:flex; gap:10px; }
  .actions a { font-size:14px; padding:9px 16px; border-radius:8px; text-decoration:none; border:1px solid var(--border); color:var(--fg); }
  .actions a.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .error { padding:16px 20px; border-radius:12px; background:#3d1416; border:1px solid #f85149; color:#ffb3ad; font-size:14px; }
  .loading { color:var(--muted); text-align:center; padding:32px; }
  .loading::after { content:""; display:block; width:24px; height:24px; margin:12px auto 0; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin .8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
</style>
</head>
<body>
  <h1>ACE <span>视频解析</span></h1>
  <div class="sub">粘贴视频链接，解析标题、封面、清晰度与播放地址 · 支持 B 站及 yt-dlp 支持的站点</div>
  <form id="form">
    <input type="url" id="url" placeholder="https://www.bilibili.com/video/BV..." required autofocus>
    <button id="btn" type="submit">解析</button>
  </form>
  <div id="result"></div>
<script>
const fmtDur = s => s == null ? "-" : (s >= 3600 ? `${Math.floor(s/3600)}时${Math.floor(s%3600/60)}分` : `${Math.floor(s/60)}分${s%60}秒`);
const fmtNum = n => n == null ? "-" : n >= 1e8 ? (n/1e8).toFixed(1)+"亿" : n >= 1e4 ? (n/1e4).toFixed(1)+"万" : n;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const form = document.getElementById("form");
form.addEventListener("submit", async e => {
  e.preventDefault();
  const url = document.getElementById("url").value.trim();
  const btn = document.getElementById("btn"), out = document.getElementById("result");
  btn.disabled = true; out.innerHTML = '<div class="loading">正在解析</div>';
  try {
    const r = await fetch("/api/parse", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({url}) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "解析失败");
    const tags = (d.qualities || []).map(q => `<span class="tag">${esc(q.label)}</span>`).join("");
    out.innerHTML = `
      <div class="card">
        ${d.thumbnail ? `<img class="cover" src="${esc(d.thumbnail)}" alt="封面">` : ""}
        <div class="body">
          <div class="title">${esc(d.title)}</div>
          <div class="meta">
            <span>作者 <b>${esc(d.author) || "-"}</b></span>
            <span>时长 <b>${fmtDur(d.duration)}</b></span>
            <span>播放 <b>${fmtNum(d.views)}</b></span>
            ${d.likes != null ? `<span>点赞 <b>${fmtNum(d.likes)}</b></span>` : ""}
            <span>来源 <b>${esc(d.source)}</b></span>
          </div>
          ${tags ? `<div class="tags">${tags}</div>` : ""}
          ${d.stream_url ? `<div class="stream">${esc(d.stream_url)}</div>` : ""}
          <div class="actions">
            ${d.page_url ? `<a class="primary" href="${esc(d.page_url)}" target="_blank" rel="noopener">打开原视频</a>` : ""}
            ${d.stream_url ? `<a href="/api/download?url=${encodeURIComponent(url)}">下载视频</a>` : ""}
          </div>
        </div>
      </div>`;
  } catch (err) {
    out.innerHTML = `<div class="error">解析失败：${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
});
</script>
</body>
</html>"""


@app.get("/")
def index():
    return render_template_string(PAGE)


@app.post("/api/parse")
def api_parse():
    url = (request.get_json(silent=True) or {}).get("url", "").strip()
    if not url:
        return jsonify(error="请输入视频链接"), 400
    start = time.time()
    try:
        info = extract(url)
    except Exception as e:  # noqa: BLE001 —— 统一转成用户可读的错误
        return jsonify(error=str(e)[:300]), 422
    info["elapsed_ms"] = int((time.time() - start) * 1000)
    return jsonify(info)


@app.get("/api/download")
def api_download():
    """B 站视频流代理下载（CDN 需要浏览器 UA + Referer）。"""
    import requests as rq
    from ace import DL_HEADERS

    url = request.args.get("url", "")
    info = extract(url)
    if not info.get("stream_url"):
        return "该站点不支持直接下载，请在原页面下载", 400
    upstream = rq.get(info["stream_url"], headers=DL_HEADERS, stream=True, timeout=60)
    upstream.raise_for_status()
    ext = info["stream_url"].split("?")[0].rsplit(".", 1)[-1] or "mp4"
    name = (info["title"] or "video").replace("/", "_")[:80]

    def gen():
        for chunk in upstream.iter_content(chunk_size=1 << 16):
            yield chunk

    from flask import Response
    from urllib.parse import quote

    filename = quote(f"{name}.{ext}")
    return Response(
        gen(),
        content_type=upstream.headers.get("Content-Type", "video/mp4"),
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


if __name__ == "__main__":
    import sys

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"ACE 视频解析已启动: http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port)
