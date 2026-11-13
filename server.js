// World Brief - local server.
// Serves the app, collects news headlines per country (Google News RSS),
// and forwards AI requests to OpenRouter, Claude, ChatGPT or Gemini using the key the user pasted in the app.
// No dependencies: needs Node 18+ (built-in fetch).

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 3000;
// Locally only this computer can open the app. Hosting services (Render, Railway, Fly) set PORT,
// and then the app listens on all addresses so visitors can reach it.
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8"
};

/* ------------------------------ News ------------------------------ */

const newsCache = new Map(); // key -> { at, data }
const NEWS_TTL = 10 * 60 * 1000;

function decode(s = "") {
  return s
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .trim();
}

function pick(chunk, tag) {
  const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
}

function parseRss(xml) {
  return xml.split(/<item>/).slice(1).map((chunk) => {
    const src = chunk.match(/<source url="([^"]*)">([\s\S]*?)<\/source>/);
    const source = src ? decode(src[2]) : "";
    let title = pick(chunk, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return {
      title,
      source,
      sourceUrl: src ? decode(src[1]) : "",
      link: pick(chunk, "link"),
      date: new Date(pick(chunk, "pubDate")).toISOString()
    };
  }).filter((i) => i.title && i.link && !Number.isNaN(Date.parse(i.date)));
}

async function getNews(country, days) {
  const key = `${country}|${days}`;
  const hit = newsCache.get(key);
  if (hit && Date.now() - hit.at < NEWS_TTL) return hit.data;

  const q = `"${country}" when:${days}d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (WorldBrief local app)" } });
  if (!res.ok) throw new Error(`News service answered ${res.status}`);
  const since = Date.now() - days * 24 * 3600 * 1000;
  const seen = new Set();
  const items = parseRss(await res.text())
    .filter((i) => Date.parse(i.date) >= since)
    .filter((i) => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, days >= 7 ? 40 : 25) // keep Google's relevance order, then newest first
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const data = { country, days, fetchedAt: new Date().toISOString(), items };
  newsCache.set(key, { at: Date.now(), data });
  return data;
}

/* ------------------------------ AI providers ------------------------------ */

async function readUpstream(res, who) {
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error?.type || body?.message || text.slice(0, 300) || res.statusText;
    const err = new Error(`${who}: ${msg}`);
    err.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw err;
  }
  return body;
}

const providers = {
  openrouter: {
    async chat({ key, model, system, messages }) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "World Brief" },
        body: JSON.stringify({ model: model || "openrouter/auto", messages: [{ role: "system", content: system }, ...messages] })
      });
      const b = await readUpstream(res, "OpenRouter");
      return { text: b.choices?.[0]?.message?.content ?? "", model: b.model || model };
    },
    async models({ key }) {
      const res = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      const b = await readUpstream(res, "OpenRouter");
      // The model list is public, so also check the key itself.
      const kr = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
      await readUpstream(kr, "OpenRouter");
      return ["openrouter/auto", ...b.data.map((m) => m.id).sort()];
    }
  },

  claude: {
    async chat({ key, model, system, messages }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: model || "claude-sonnet-5-5", max_tokens: 4096, system, messages })
      });
      const b = await readUpstream(res, "Claude");
      return { text: (b.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""), model: b.model || model };
    },
    async models({ key }) {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }
      });
      const b = await readUpstream(res, "Claude");
      return b.data.map((m) => m.id);
    }
  },

  chatgpt: {
    async chat({ key, model, system, messages }) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: model || "gpt-4o-mini", messages: [{ role: "system", content: system }, ...messages] })
      });
      const b = await readUpstream(res, "ChatGPT");
      return { text: b.choices?.[0]?.message?.content ?? "", model: b.model || model };
    },
    async models({ key }) {
      const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      const b = await readUpstream(res, "ChatGPT");
      return b.data.map((m) => m.id)
        .filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search|instruct)/.test(id))
        .sort().reverse();
    }
  },

  gemini: {
    async chat({ key, model, system, messages }) {
      const m = (model || "gemini-2.5-flash").replace(/^models\//, "");
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((x) => ({ role: x.role === "assistant" ? "model" : "user", parts: [{ text: x.content }] }))
        })
      });
      const b = await readUpstream(res, "Gemini");
      const parts = b.candidates?.[0]?.content?.parts || [];
      return { text: parts.map((p) => p.text || "").join(""), model: m };
    },
    async models({ key }) {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
      const b = await readUpstream(res, "Gemini");
      return (b.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name))
        .map((m) => m.name.replace(/^models\//, ""))
        .sort().reverse();
    }
  }
};

// OpenRouter's model list is public, so the app can show it (with free models) before a key is added.
let orCache = null;
async function openRouterModels() {
  if (orCache && Date.now() - orCache.at < 60 * 60 * 1000) return orCache.data;
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const b = await readUpstream(res, "OpenRouter");
  const models = b.data
    .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes("text"))
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      free: Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0 && !m.id.startsWith("openrouter/auto")
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const data = { free: models.filter((m) => m.free), paid: models.filter((m) => !m.free) };
  orCache = { at: Date.now(), data };
  return data;
}

/* ------------------------------ HTTP ------------------------------ */

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  return JSON.parse(raw || "{}");
}

async function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname)).replace(/^([/\\])+/, "");
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/news" && req.method === "GET") {
      const country = (url.searchParams.get("country") || "").trim().slice(0, 80);
      const days = [1, 2, 7].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 1;
      if (!country) return send(res, 400, { error: "Missing country" });
      return send(res, 200, await getNews(country, days));
    }

    if (url.pathname === "/api/openrouter-models" && req.method === "GET") {
      return send(res, 200, await openRouterModels());
    }

    if ((url.pathname === "/api/ai" || url.pathname === "/api/models") && req.method === "POST") {
      const body = await readJson(req);
      const p = providers[body.provider];
      if (!p) return send(res, 400, { error: "Unknown provider" });
      if (!body.key) return send(res, 400, { error: "Missing API key" });
      if (url.pathname === "/api/models") return send(res, 200, { models: await p.models(body) });
      const messages = (body.messages || []).filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"));
      if (!messages.length) return send(res, 400, { error: "No messages" });
      return send(res, 200, await p.chat({ key: body.key, model: body.model, system: body.system || "", messages }));
    }

    if (req.method === "GET") return serveStatic(req, res, url.pathname);
    res.writeHead(405); res.end();
  } catch (err) {
    console.error(err.message);
    send(res, err.status || 500, { error: err.message || "Something went wrong" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`World Brief is running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});
