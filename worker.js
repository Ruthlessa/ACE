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

// ---- app.bilibili.com 移动端签名接口：web 端被整段 IP 风控（412）时的兜底通路 ----
const BILI_APP_KEY = "dfca71928277209b";
const BILI_APP_SEC = "b5475a8825547a4fc26c7d518eaaa02e";
const BILI_APP_UA =
  "Mozilla/5.0 BiliDroid/1.45.0 (bbcallen@gmail.com) os/android model/Pixel6 mobi_app/android_hd build/1450000 channel/bili innerVer/1450000 osVer/13 network/2";

/** 手写 MD5（Workers WebCrypto 无 MD5；输入为 UTF-8 字符串，返回小写 hex）。RFC 1321。 */
function md5Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const buf = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor((len * 8) / 0x100000000), true);

  const S16 = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  // 每轮 x 下标序列（RFC 1321 MD5Transform）
  const XI = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [1, 6, 11, 0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12],
    [5, 8, 11, 14, 1, 4, 7, 10, 13, 0, 3, 6, 9, 12, 15, 2],
    [0, 7, 14, 5, 12, 3, 10, 1, 8, 15, 6, 13, 4, 11, 2, 9],
  ];
  // 每步的目标寄存器与 F 参数（a,b,c,d = 0,1,2,3；步序 a,d,c,b 循环）
  const TGT = [0, 3, 2, 1];
  const ARG = [[1, 2, 3], [0, 1, 2], [3, 0, 1], [2, 3, 0]];
  const R = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const state = [...R];

  for (let off = 0; off < buf.length; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    for (let i = 0; i < 64; i++) {
      const t = TGT[i & 3], [q, r, s] = ARG[i & 3];
      const x = R[q], y = R[r], z = R[s];
      let f;
      const rnd = i >> 4;
      if (rnd === 0) f = (x & y) | (~x & z);
      else if (rnd === 1) f = (x & z) | (y & ~z);
      else if (rnd === 2) f = x ^ y ^ z;
      else f = y ^ (x | ~z);
      const v = (R[t] + f + M[XI[rnd][i & 15]] + K[i]) >>> 0;
      const sIdx = rnd * 4 + (i & 3); // 每轮 4 个移位值循环
      const rot = ((v << S16[sIdx]) | (v >>> (32 - S16[sIdx]))) >>> 0;
      R[t] = (rot + x) >>> 0;
    }
    for (let j = 0; j < 4; j++) {
      state[j] = (state[j] + R[j]) >>> 0;
      R[j] = state[j];
    }
  }
  // digest = 状态字的小端字节序
  const le = (n) =>
    [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return le(state[0]) + le(state[1]) + le(state[2]) + le(state[3]);
}

/** 移动端接口签名：参数按 key 排序 urlencode 后 md5(query+secret)，追加 sign 参数。 */
function appSign(params) {
  const p = { ...params, appkey: BILI_APP_KEY };
  const qs = Object.keys(p)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]))}`)
    .join("&");
  return `${qs}&sign=${md5Hex(qs + BILI_APP_SEC)}`;
}

/** app 端视频信息（与 web 端 view 字段基本一致：title/owner/cid/duration/stat/pic）。 */
async function appViewGet(bvid) {
  const qs = appSign({
    bvid,
    autoplay: "0",
    qn: "32",
    platform: "android",
    channel: "bili",
    mobi_app: "android_hd",
    statistics: JSON.stringify({ appId: 5, platform: 3, version: "1.45.0", abtest: "" }),
    build: "1450000",
    c_locale: "zh_CN",
    s_locale: "zh_CN",
    ts: String(Math.floor(Date.now() / 1000)),
  });
  let r;
  try {
    r = await fetch(`https://app.bilibili.com/x/v2/view?${qs}`, {
      headers: { "User-Agent": BILI_APP_UA, Referer: "https://www.bilibili.com/" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("app-view net");
  }
  if (!r.ok) throw new Error(`app-view HTTP ${r.status}`);
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("app-view badjson");
  }
  if (data.code !== 0) throw new Error(`app-view code ${data.code}`);
  return data.data;
}

/* ---- 页面抓取兜底：视频页 HTML 内嵌 __playinfo__（流）与 __INITIAL_STATE__（元数据） ----
 * 页面供 SEO/分享访问，风控通常松于 API；通了则一次拿到元数据+流。失败抛 page=xxx 明细。 */
async function pageGet(bvid) {
  let r;
  try {
    r = await fetch(`https://www.bilibili.com/video/${bvid}`, {
      headers: {
        "User-Agent": BROWSER_API_HEADERS["User-Agent"],
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error("page=net");
  }
  if (!r.ok) throw new Error(`page=${r.status}`);
  const html = await r.text();
  const pi = html.match(/__playinfo__=(\{[\s\S]*?\})<\/script>/);
  const st = html.match(/__INITIAL_STATE__=(\{[\s\S]*?\});\(function\(/);
  if (!pi && !st) throw new Error("page=noinfo");
  let play = null;
  let view = null;
  try {
    if (pi) play = JSON.parse(pi[1]).data || null;
  } catch {
    /* 保留 view */
  }
  try {
    if (st) {
      const v = JSON.parse(st[1]).videoData;
      if (v && v.cid) view = v; // 页面 videoData 与 view API 同构（title/owner/cid/stat/pic/duration）
    }
  } catch {
    /* 保留 play */
  }
  if (!play && !view) throw new Error("page=badjson");
  return { view, play };
}

/* ---- ParseDock 解析兜底：B 站直连全被风控时，换第三方出口拿元数据 + 流地址 ---- */
/**
 * ParseDock（parsedock.kitt.tools，公开匿名 API）：
 * POST /v1/jobs {url, action:"resolve"} → 202 {job_id, job_token}；
 * GET /v1/jobs/{id}（Authorization: Bearer job_token）轮询 → succeeded 后
 * result.formats[].source_url 为直连流（B 站 CDN mp4），content_metadata 为标题/作者/封面/时长。
 * 失败抛明细（pd-post=..., pd=...）。
 */
async function pdOnce(vurl) {
  // 从 job 对象提取流与元数据；POST 快路径元数据在 content_metadata，轮询路径在 result.*
  const extract = (j) => {
    const fmts = (j.result?.formats || []).filter((f) => f.source_url);
    const fmt = fmts.find((f) => f.browser_usable) || fmts[0];
    if (!fmt) throw new Error("pd=nourl"); // succeeded 但空结果（服务端降级），可重试
    const cm = j.content_metadata || {};
    const rm = j.result || {};
    const pick = (...vs) => vs.find((v) => v != null);
    const meta = {
      title: pick(cm.title, rm.title),
      author: pick(cm.author, rm.author),
      thumbnail_url: pick(cm.thumbnail_url, rm.thumbnail_url),
      duration_seconds: pick(cm.duration_seconds, rm.duration_seconds),
    };
    return { meta, fmt, fmts };
  };
  const done = (j) => j.status === "succeeded"; // POST 快路径响应里 status 已是 succeeded
  let job = null;
  let postErr = "pd-post=net";
  for (let attempt = 0; attempt < 4 && !job; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, attempt * 2000));
    try {
      const r = await fetch("https://api.parsedock.kitt.tools/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        // 随机查询参数绕过服务端同 URL 空结果缓存（B 站页面忽略未知参数，解析目标不变）
        body: JSON.stringify({ url: `${vurl}${vurl.includes("?") ? "&" : "?"}acedl=${crypto.randomUUID().slice(0, 8)}`, action: "resolve" }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        job = await r.json();
        break;
      }
      postErr = `pd-post=${r.status}`;
      if (r.status !== 503 && r.status !== 429 && r.status < 500) break; // 客户端错误不重试
    } catch {
      postErr = "pd-post=net";
    }
  }
  if (!job) throw new Error(postErr);
  if (done(job)) return extract(job);
  if (!job.job_id || !job.job_token) throw new Error("pd-post=badjob");
  let last = "pd=timeout";
  for (let i = 0; i < 16; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    let r;
    try {
      r = await fetch(`https://api.parsedock.kitt.tools/v1/jobs/${job.job_id}`, {
        headers: { Authorization: `Bearer ${job.job_token}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      last = "pd=poll-net";
      continue;
    }
    if (!r.ok) {
      last = `pd=${r.status}`;
      continue;
    }
    let j;
    try {
      j = await r.json();
    } catch {
      last = "pd=badjson";
      continue;
    }
    if (done(j)) return extract(j);
    if (j.status === "failed" || j.status === "expired" || j.status === "cancelled") {
      throw new Error(`pd=${j.status}`);
    }
    last = `pd=${j.status}`;
  }
  throw new Error(last);
}

/** 外层重试：服务端间歇 503 / 空结果（nourl）时重跑整条 resolve；终态失败不重试。 */
async function pdResolve(vurl) {
  const RETRYABLE = /nourl|pd-post=(503|429|net)|pd=poll-net|pd=(timeout|queued|running)|pd=(408|425|429|5\d\d)$/;
  let lastErr;
  for (let round = 0; round < 3; round++) {
    if (round) await new Promise((res) => setTimeout(res, round * 2000));
    try {
      return await pdOnce(vurl);
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE.test(e.message)) throw e;
    }
  }
  throw lastErr;
}

// 412 风控与出口 IP 相关：不同 IP 段对 UA/host 的判定不同，依次尝试多组。
// 数据中心 IP 还要求携带设备指纹 cookie（spi 接口获取 buvid3/buvid4）。
const BROWSER_API_HEADERS = {
  "User-Agent": DL_HEADERS["User-Agent"],
  Referer: "https://www.bilibili.com/",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  Origin: "https://www.bilibili.com",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "sec-fetch-dest": "empty",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};
const CURL_HEADERS = { "User-Agent": "curl/8.5.0", Referer: "https://www.bilibili.com/" };
const BILI_ATTEMPTS = [
  { name: "com-curl", host: "api.bilibili.com", headers: CURL_HEADERS },
  { name: "cn-curl", host: "api.bilibili.cn", headers: CURL_HEADERS },
  { name: "cn-browser", host: "api.bilibili.cn", headers: BROWSER_API_HEADERS },
  { name: "com-browser", host: "api.bilibili.com", headers: BROWSER_API_HEADERS },
  { name: "com-noUA", host: "api.bilibili.com", headers: { Referer: "https://www.bilibili.com/" } },
];

let biliCookie = null;
let biliCookieAt = 0;

/** 取设备指纹 cookie（5 分钟缓存）；spi 本身被风控时返回 null，后续策略照常尝试。 */
async function getBiliCookie() {
  if (biliCookie && Date.now() - biliCookieAt < 5 * 60_000) return biliCookie;
  for (const ua of [CURL_HEADERS["User-Agent"], BROWSER_API_HEADERS["User-Agent"]]) {
    try {
      const r = await fetch("https://api.bilibili.com/x/frontend/finger/spi", {
        headers: { "User-Agent": ua },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const b3 = j?.data?.b_3;
      if (b3) {
        const b4 = j?.data?.b_4;
        biliCookie = `buvid3=${b3}${b4 ? `; buvid4=${b4}` : ""}; b_nut=${Math.floor(Date.now() / 1000)}`;
        biliCookieAt = Date.now();
        return biliCookie;
      }
    } catch {
      /* 换下一个 UA 重试 */
    }
  }
  return null;
}

async function biliGet(path, params) {
  const qs = new URLSearchParams(params);
  const cookie = await getBiliCookie();
  const log = [];
  for (const { name, host, headers } of BILI_ATTEMPTS) {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    let r;
    try {
      r = await fetch(`https://${host}${path}?${qs}`, { headers: h, signal: AbortSignal.timeout(10000) });
    } catch {
      log.push(`${name}=net`);
      continue;
    }
    if (!r.ok) {
      log.push(`${name}=${r.status}`);
      continue;
    }
    let data;
    try {
      data = await r.json();
    } catch {
      log.push(`${name}=badjson`);
      continue;
    }
    if (data.code !== 0) {
      log.push(`${name}=${data.code}`);
      continue;
    }
    return data.data;
  }
  const detail = log.join(", ");
  if (log.length && log.every((l) => l.endsWith("=412"))) {
    throw new Error(`B 站 API HTTP 412（全部 UA 策略被风控: ${detail}）`);
  }
  throw new Error(`B 站 API 请求全部失败（${detail}）`);
}

async function extractBili(url) {
  const bvid = parseBvid(url);
  if (!bvid) throw new Error(`无法从链接提取 BV 号: ${url}`);
  let view = null;
  let viewErr = null;
  try {
    view = await biliGet("/x/web-interface/view", { bvid });
  } catch (e) {
    viewErr = e;
  }
  if (!view) {
    // web 端 view 全策略失败（通常为出口 IP 被整段 412 风控）→ 走 app 签名接口兜底
    try {
      view = await appViewGet(bvid);
      viewErr = null;
    } catch (e) {
      viewErr = new Error(`${viewErr?.message || "view 失败"}；app 兜底: ${e.message}`);
    }
  }
  let play = null;
  let playErr = null;
  if (view) {
    try {
      play = await biliGet("/x/player/playurl", {
        bvid, cid: view.cid, qn: 120, fnval: 1, fourk: 1,
      });
    } catch (e) {
      playErr = e;
    }
  }
  if (!view || !play) {
    // 页面 HTML 兜底：__INITIAL_STATE__ 补 view、__playinfo__ 补 play（一次请求两者都可能拿到）
    try {
      const pg = await pageGet(bvid);
      view = view || pg.view;
      play = play || pg.play;
      if (view) viewErr = null;
      if (play) playErr = null;
    } catch (e) {
      // 页面失败明细只并入 view 段（两段都记会重复输出同一 page 错误）
      if (!view) viewErr = new Error([viewErr?.message, `页面兜底: ${e.message}`].filter(Boolean).join("；"));
    }
  }
  if (!view || !play) {
    // B 站直连取流/元数据不通 → ParseDock 换出口（返回流地址 + 标题/封面）
    let pd = null;
    let pdErr = null;
    try {
      pd = await pdResolve(url);
    } catch (e) {
      pdErr = e;
    }
    if (!pd) {
      const parts = [];
      if (viewErr) parts.push(viewErr.message);
      if (playErr) parts.push(playErr.message);
      parts.push(`ParseDock 兜底: ${pdErr?.message || "失败"}`);
      throw new Error(parts.join("；"));
    }
    const stat = (view && view.stat) || {};
    const { meta, fmt, fmts } = pd;
    const height = fmt.height;
    const quality = height ? `${height}P` : "MP4";
    const qLabels = [...new Set(fmts.map((f) => (f.height ? `${f.height}P` : (f.label || "MP4"))))];
    return {
      source: "bilibili",
      bvid,
      title: view?.title || meta.title || bvid,
      author: view?.owner?.name || meta.author,
      duration: view?.duration || (meta.duration_seconds ? Math.round(meta.duration_seconds) : undefined),
      views: stat.view,
      likes: stat.like,
      danmaku: stat.danmaku,
      thumbnail: view?.pic || meta.thumbnail_url || null,
      qualities: play
        ? (play.support_formats || []).map((q) => ({ qn: q.quality, label: q.new_description || q.display_desc }))
        : qLabels.map((l) => ({ qn: 80, label: l })),
      quality: play
        ? QN_LABELS[play.quality] || String(play.quality)
        : quality,
      stream_url: (play?.durl || [])[0]?.url || fmt.source_url,
      page_url: `https://www.bilibili.com/video/${bvid}`,
    };
  }
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
