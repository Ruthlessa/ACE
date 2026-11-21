/**
 * ACE 视频解析 —— Cloudflare Worker 版
 * 与本地 Flask 版 (web.py) 功能一致：解析页 + /api/parse + /api/download
 * B 站走公开 API；其他站点回退为页面 og 元数据解析。
 */

const API_HEADERS = {
  "User-Agent": "curl/8.5.0",
  Referer: "https://www.bilibili.com/",
};
const DL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
};
const QN_LABELS = { 16: "360P", 32: "480P", 64: "720P", 80: "1080P", 112: "1080P+", 116: "1080P60", 120: "4K" };

const PAGE = `<!DOCTYPE html>
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
  .sub { color:var(--muted); margin-bottom:32px; font-size:14px; text-align:center; }
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
  <div class="sub">粘贴视频链接，解析标题、封面、清晰度与播放地址 · 支持 B 站及常用站点</div>
  <form id="form">
    <input type="url" id="url" placeholder="https://www.bilibili.com/video/BV..." required autofocus>
    <button id="btn" type="submit">解析</button>
  </form>
  <div id="result"></div>
<script>
const fmtDur = s => s == null ? "-" : (s >= 3600 ? \`\${Math.floor(s/3600)}时\${Math.floor(s%3600/60)}分\` : \`\${Math.floor(s/60)}分\${s%60}秒\`);
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
    const tags = (d.qualities || []).map(q => \`<span class="tag">\${esc(q.label)}</span>\`).join("");
    out.innerHTML = \`
      <div class="card">
        \${d.thumbnail ? \`<img class="cover" src="\${esc(d.thumbnail)}" alt="封面">\` : ""}
        <div class="body">
          <div class="title">\${esc(d.title)}</div>
          <div class="meta">
            <span>作者 <b>\${esc(d.author) || "-"}</b></span>
            <span>时长 <b>\${fmtDur(d.duration)}</b></span>
            <span>播放 <b>\${fmtNum(d.views)}</b></span>
            \${d.likes != null ? \`<span>点赞 <b>\${fmtNum(d.likes)}</b></span>\` : ""}
            <span>来源 <b>\${esc(d.source)}</b></span>
          </div>
          \${tags ? \`<div class="tags">\${tags}</div>\` : ""}
          \${d.stream_url ? \`<div class="stream">\${esc(d.stream_url)}</div>\` : ""}
          <div class="actions">
            \${d.page_url ? \`<a class="primary" href="\${esc(d.page_url)}" target="_blank" rel="noopener">打开原视频</a>\` : ""}
            \${d.stream_url ? \`<a href="/api/download?url=\${encodeURIComponent(url)}">下载视频</a>\` : ""}
          </div>
        </div>
      </div>\`;
  } catch (err) {
    out.innerHTML = \`<div class="error">解析失败：\${esc(err.message)}</div>\`;
  } finally {
    btn.disabled = false;
  }
});
</script>
</body>
</html>`;

function parseBvid(url) {
  const m = url.match(/(BV[0-9A-Za-z]{10})/);
  return m ? m[1] : null;
}

// 412 风控按出口 IP + 请求指纹判定：浏览器全套头（sec-ch-ua/sec-fetch）
// + spi 下发的 buvid3 Cookie + Referer 指向具体视频页才能过，curl UA 仅部分 IP 可用。
const BROWSER_UA = DL_HEADERS["User-Agent"];
const SEC_CH_UA = '"Chromium";v="126", "Not:A-Brand";v="24"';

let buvid3Cache = null;
async function getBuvid3() {
  if (buvid3Cache) return buvid3Cache;
  try {
    const r = await fetch("https://api.bilibili.com/x/frontend/finger/spi", {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (r.ok) {
      const d = await r.json();
      if (d?.data?.b_3) buvid3Cache = d.data.b_3;
    }
  } catch {
    /* 拿不到就无 Cookie 重试 */
  }
  return buvid3Cache;
}

async function biliGet(path, params, referer) {
  const qs = new URLSearchParams(params);
  const ref = referer || "https://www.bilibili.com/";
  const buvid3 = await getBuvid3();

  const browserHeaders = (cookie) => ({
    "User-Agent": BROWSER_UA,
    Referer: ref,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-site": "same-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    ...(cookie ? { Cookie: `buvid3=${cookie}` } : {}),
  });

  const attempts = [
    { host: "api.bilibili.com", headers: browserHeaders(buvid3) },
    { host: "api.bilibili.com", headers: browserHeaders(null) },
    { host: "api.bilibili.cn", headers: browserHeaders(buvid3) },
    { host: "api.bilibili.com", headers: { "User-Agent": "curl/8.5.0", Referer: ref } },
    { host: "api.bilibili.cn", headers: { "User-Agent": "curl/8.5.0", Referer: ref } },
  ];

  let lastStatus = 0;
  for (const { host, headers } of attempts) {
    let r;
    try {
      r = await fetch(`https://${host}${path}?${qs}`, { headers });
    } catch {
      continue;
    }
    if (r.status === 412) { // 风控，换下一组
      lastStatus = 412;
      continue;
    }
    if (!r.ok) throw new Error(`B 站 API HTTP ${r.status}`);
    const data = await r.json();
    if (data.code !== 0) throw new Error(`B 站 API 错误: ${data.code} ${data.message}`);
    return data.data;
  }
  throw new Error(`B 站 API HTTP ${lastStatus || "网络错误"}（全部请求指纹被风控）`);
}

async function extractBili(url) {
  const bvid = parseBvid(url);
  if (!bvid) throw new Error(`无法从链接提取 BV 号: ${url}`);
  // Referer 必须指向具体视频页（首页 Referer 会 412）
  const ref = `https://www.bilibili.com/video/${bvid}`;
  const view = await biliGet("/x/web-interface/view", { bvid }, ref);
  const play = await biliGet(
    "/x/player/playurl",
    { bvid, cid: view.cid, qn: 120, fnval: 1, fourk: 1 },
    ref
  );
  const stat = view.stat || {};
  const qualities = (play.support_formats || []).map((q) => ({
    qn: q.quality,
    label: q.new_description || q.display_desc,
  }));
  const durl = play.durl || [];
  return {
    source: "bilibili",
    bvid,
    title: view.title,
    author: view.owner?.name,
    duration: view.duration,
    views: stat.view,
    likes: stat.like,
    danmaku: stat.danmaku,
    thumbnail: view.pic,
    qualities,
    quality: QN_LABELS[play.quality] || String(play.quality),
    stream_url: durl[0]?.url || null,
    page_url: `https://www.bilibili.com/video/${bvid}`,
  };
}

/** 非 B 站：抓取页面 og 元数据做基础解析（Worker 内无法跑 yt-dlp）。 */
async function extractGeneric(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": DL_HEADERS["User-Agent"] },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`抓取页面失败: HTTP ${r.status}`);
  const html = await r.text();
  const meta = (name) => {
    const m =
      html.match(new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]+content="([^"]*)"`, "i")) ||
      html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${name}"`, "i"));
    return m ? m[1].replace(/&amp;/g, "&") : null;
  };
  const title = meta("og:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
  if (!title) throw new Error("页面中未找到视频标题");
  return {
    source: new URL(url).hostname,
    title: title.trim(),
    author: meta("og:site_name"),
    duration: null,
    views: null,
    likes: null,
    danmaku: null,
    thumbnail: meta("og:image"),
    qualities: [],
    quality: null,
    stream_url: meta("og:video") || meta("og:video:url") || null,
    page_url: url,
  };
}

async function extract(url) {
  if (parseBvid(url)) return extractBili(url);
  return extractGeneric(url);
}

export default {
  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);

    if (pathname === "/") {
      return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (pathname === "/api/parse" && request.method === "POST") {
      let url = "";
      try {
        url = ((await request.json()) || {}).url || "";
      } catch {
        /* 空 body */
      }
      url = url.trim();
      if (!url) return Response.json({ error: "请输入视频链接" }, { status: 400 });
      const start = Date.now();
      try {
        const info = await extract(url);
        info.elapsed_ms = Date.now() - start;
        return Response.json(info);
      } catch (e) {
        return Response.json({ error: String(e?.message || e).slice(0, 300) }, { status: 422 });
      }
    }

    if (pathname === "/api/download" && request.method === "GET") {
      try {
        const info = await extract(searchParams.get("url") || "");
        if (!info.stream_url) {
          return new Response("该站点不支持直接下载，请在原页面下载", { status: 400 });
        }
        const upstream = await fetch(info.stream_url, { headers: DL_HEADERS });
        if (!upstream.ok) return new Response(`上游返回 ${upstream.status}`, { status: 502 });
        const ext = (info.stream_url.split("?")[0].match(/\.([a-z0-9]+)$/i) || [])[1] || "mp4";
        const name = encodeURIComponent(`${(info.title || "video").replace(/[/"<>|:*?]/g, "_").slice(0, 80)}.${ext}`);
        return new Response(upstream.body, {
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") || "video/mp4",
            "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
          },
        });
      } catch (e) {
        return new Response(String(e?.message || e), { status: 422 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
