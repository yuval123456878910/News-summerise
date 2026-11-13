import { T, PROVIDERS } from "./i18n.js";
import { COUNTRIES } from "./countries.js";

/* ============================== State ============================== */

const RANGES = { today: 1, two: 2, week: 7 };
const PER_COUNTRY = { today: 12, two: 16, week: 22 };
const STORE_KEY = "worldbrief.v1";

const defaults = {
  lang: "en", range: "today", sel: [], active: "claude",
  keys: {}, models: {}, verified: {}, summaryLang: "app", defRange: "today"
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const st = { ...defaults, ...s };
    st.range = st.defRange || "today";
    return st;
  } catch { return { ...defaults }; }
}
function save() {
  try {
    const { lang, sel, active, keys, models, verified, summaryLang, defRange } = S;
    localStorage.setItem(STORE_KEY, JSON.stringify({ lang, sel, active, keys, models, verified, summaryLang, defRange }));
  } catch { /* storage blocked: settings last for this visit only */ }
}

const S = load();
const R = {
  news: new Map(),        // `${iso}|${days}` -> { items, fetchedAt }
  feed: null,             // { key, status: loading|ready|error, items, counts, fetchedAt }
  brief: new Map(),       // briefKey -> { status, data, error, model }
  storyTr: new Map(),     // `${briefKey}|${i}` -> { status, title, text, show }
  chat: [],               // { role, content, alt, showAlt, altStatus, err }
  chatBusy: false,
  settings: false,
  tab: "brief",
  query: "",
  gen: 0,
  testing: {}, testMsg: {}, modelList: {}, customModel: {}, orModels: null, orLoading: false
};

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const t = () => T[S.lang];
const contentLang = () => (S.summaryLang === "app" ? S.lang : S.summaryLang);
const provider = () => PROVIDERS.find((p) => p.id === S.active) || PROVIDERS[1];
const hasKey = () => !!S.keys[S.active];
const country = (iso) => COUNTRIES.find((c) => c[0] === iso);
const cname = (iso, lang = S.lang) => { const c = country(iso); return c ? (lang === "he" ? c[2] : c[1]) : iso; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isHebrew = (s) => { const he = (s.match(/[֐-׿]/g) || []).length; const la = (s.match(/[A-Za-z]/g) || []).length; return he > la; };

/* ============================== Helpers ============================== */

const ic = {
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  link: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  globe: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>'
};

let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

const locale = () => (S.lang === "he" ? "he-IL" : "en-GB");
function ago(iso) {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const a = Math.abs(diff);
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const dayLabel = (key) => new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short" }).format(new Date(key + "T12:00:00"));
const clock = (iso) => new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function countryTitle(lang = S.lang) {
  const names = S.sel.map((i) => cname(i, lang));
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + T[lang].and + names.at(-1);
}

/* ============================== API ============================== */

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  let data = {};
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function ai(system, messages) {
  const p = provider();
  return api("/api/ai", { provider: p.id, key: S.keys[p.id], model: S.models[p.id] || p.model, system, messages });
}

function parseJson(text) {
  const s = text.replace(/```(?:json)?/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("The AI did not return a readable answer. Try again or pick another model.");
  return JSON.parse(s.slice(a, b + 1));
}

/* ============================== News ============================== */

const feedKey = () => `${[...S.sel].sort().join(",")}|${S.range}`;

async function loadFeed(force = false) {
  const gen = ++R.gen;
  if (!S.sel.length) { R.feed = null; renderMain(); renderSideFoot(); return; }
  const days = RANGES[S.range];
  const key = feedKey();
  R.feed = { key, status: "loading", items: [], counts: {} };
  renderMain(); renderSideFoot();

  const results = await Promise.allSettled(S.sel.map(async (iso) => {
    const k = `${iso}|${days}`;
    if (!force && R.news.has(k) && Date.now() - Date.parse(R.news.get(k).fetchedAt) < 10 * 60 * 1000) return [iso, R.news.get(k)];
    const d = await api(`/api/news?country=${encodeURIComponent(cname(iso, "en"))}&days=${days}`);
    R.news.set(k, d);
    return [iso, d];
  }));
  if (gen !== R.gen) return;

  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) { R.feed = { key, status: "error", items: [], counts: {} }; renderMain(); renderSideFoot(); return; }

  const counts = {};
  let items = [];
  for (const [iso, d] of ok) {
    counts[iso] = d.items.length;
    items.push(...d.items.slice(0, PER_COUNTRY[S.range]).map((x) => ({ ...x, iso })));
  }
  items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  items = items.map((x, i) => ({ ...x, n: i + 1 }));
  const fetchedAt = ok.map(([, d]) => d.fetchedAt).sort()[0];
  if (force) for (const k of [...R.brief.keys()]) if (k.startsWith(key)) R.brief.delete(k);
  R.feed = { key, status: "ready", items, counts, fetchedAt };
  renderList(); renderSideFoot();
  summarize();
}

/* ============================== AI: summary ============================== */

const briefKey = () => R.feed ? `${R.feed.key}|${contentLang()}|${S.active}|${S.models[S.active] || provider().model}` : "";

function headlineList(items) {
  return items.map((x) => `[${x.n}] (${x.iso}, ${dayKey(x.date)}) ${x.title} — ${x.source}`).join("\n");
}

async function summarize(force = false) {
  const feed = R.feed;
  if (!feed || feed.status !== "ready" || !feed.items.length || !hasKey()) { renderMain(); return; }
  const key = briefKey();
  if (!force && R.brief.has(key) && R.brief.get(key).status !== "error") { renderMain(); return; }
  R.brief.set(key, { status: "loading" });
  renderMain();

  const lang = contentLang() === "he" ? "Hebrew" : "English";
  const days = RANGES[S.range];
  const nStories = S.range === "today" ? "4 to 6" : S.range === "two" ? "5 to 8" : "5 to 7";
  const system = `You are the editor of a daily news brief. You summarize real news headlines for a busy reader.
Rules: use only the headlines provided, never invent facts, names or numbers. Merge headlines about the same event into one story. Skip trivia, ads, and product reviews unless nothing else exists. Write plain, neutral, clear ${lang}. Reply with JSON only, no other text.`;
  const user = `Today is ${dayKey(Date.now())}. Countries: ${S.sel.map((i) => `${i} = ${cname(i, "en")}`).join(", ")}. Time range: last ${days} day(s).

Headlines (number, country code, date, title — source):
${headlineList(feed.items)}

Return this JSON:
{
  "summary": "a formatted brief in Markdown (see SUMMARY FORMAT)",
  "stories": [
    { "country": "two-letter code", "topic": "one or two words, e.g. Politics, Economy, Climate", "title": "short clear headline", "text": "1 to 2 sentences explaining what happened and why it matters", "sources": [headline numbers] }
  ]${S.range === "week" ? `,
  "days": [ { "date": "YYYY-MM-DD", "items": [ { "country": "two-letter code", "line": "one short line, the day's most important event for that country" } ] } ]` : ""}
}
SUMMARY FORMAT (Markdown inside the JSON string, use \\n for new lines):
- First line: one key-takeaway sentence in **bold** that sums up the period.
- Then 2 to 4 short sections. Each starts with "### " and a short title (a theme, or a country when one country dominates), followed by 1 to 3 sentences.
- Put the most important names, places and numbers in **bold**.
- In each section, wrap the single most important fact in ==double equals== to highlight it.
- After every claim, add the headline numbers it comes from in square brackets, like [3] or [2][7].
- No bullet lists, no links, no other Markdown.

Write ${nStories} stories, the most important first. Every story must list the headline numbers it is based on.${S.range === "week" ? " Include every day in the range that has headlines, newest first." : ""} All text in ${lang}.`;

  // Free and small models sometimes return broken JSON, so try twice before showing an error.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await ai(system, [{ role: "user", content: user }]);
      const data = parseJson(res.text);
      if (!data.summary || !Array.isArray(data.stories)) throw new Error("The AI answer was incomplete. Try again or pick another model.");
      R.brief.set(key, { status: "ready", data, model: res.model });
      break;
    } catch (e) {
      const providerError = /^(OpenRouter|Claude|ChatGPT|Gemini):/.test(e.message);
      if (attempt === 2 || providerError) { R.brief.set(key, { status: "error", error: e.message }); break; }
    }
  }
  if (briefKey() === key) renderMain();
}

async function translateStory(i) {
  const key = briefKey(); const b = R.brief.get(key); const s = b?.data?.stories?.[i]; if (!s) return;
  const tk = `${key}|${i}`;
  const cur = R.storyTr.get(tk);
  if (cur?.status === "ready") { cur.show = !cur.show; renderMain(); return; }
  if (cur?.status === "loading") return;
  const target = isHebrew(s.title + s.text) ? "English" : "Hebrew";
  R.storyTr.set(tk, { status: "loading" }); renderMain();
  try {
    const res = await ai(`You translate news text into ${target}. Keep names accurate. Reply with JSON only.`,
      [{ role: "user", content: `Translate to ${target} and return {"topic": "...", "title": "...", "text": "..."}:\n${JSON.stringify({ topic: s.topic, title: s.title, text: s.text })}` }]);
    const d = parseJson(res.text);
    R.storyTr.set(tk, { status: "ready", show: true, ...d });
  } catch (e) {
    R.storyTr.delete(tk); toast(e.message);
  }
  renderMain();
}

/* ============================== AI: chat ============================== */

function chatSystem() {
  const lang = S.lang === "he" ? "Hebrew" : "English";
  const feed = R.feed;
  const b = R.brief.get(briefKey());
  const ctx = feed?.items?.length ? headlineList(feed.items) : "(no headlines loaded)";
  return `You are World Brief, a news assistant. The user is reading news about: ${countryTitle("en") || "no countries yet"} for the last ${RANGES[S.range]} day(s). Today is ${dayKey(Date.now())}.
Answer questions using the numbered headlines below. Cite the headlines you use like [3] or [2][7]. If the headlines do not cover the question, say so clearly; you may add short general background, labelled as background.
Answer in ${lang} unless the user writes in another language or asks for a translation. You can translate any text between Hebrew and English when asked.
Keep answers short and clear. Use short paragraphs or "- " bullet lists. No headings.

${b?.status === "ready" ? `Current summary: ${b.data.summary}\n\n` : ""}Headlines:
${ctx}`;
}

async function sendChat(text) {
  text = text.trim();
  if (!text || R.chatBusy) return;
  if (!hasKey()) { openSettings(); return; }
  R.chat.push({ role: "user", content: text });
  R.chatBusy = true; renderMsgs(); updateSend();
  try {
    const history = R.chat.filter((m) => !m.err).slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const res = await ai(chatSystem(), history);
    R.chat.push({ role: "assistant", content: res.text.trim() || "…" });
  } catch (e) {
    R.chat.push({ role: "assistant", content: e.message, err: true });
  }
  R.chatBusy = false; renderMsgs(); updateSend();
}

async function translateMsg(i) {
  const m = R.chat[i]; if (!m) return;
  if (m.alt) { m.showAlt = !m.showAlt; renderMsgs(); return; }
  if (m.altStatus === "loading") return;
  const target = isHebrew(m.content) ? "English" : "Hebrew";
  m.altStatus = "loading"; m.altLang = target; renderMsgs();
  try {
    const res = await ai(`You translate text into ${target}. Keep citation marks like [3] exactly as they are. Reply with the translation only.`, [{ role: "user", content: m.content }]);
    m.alt = res.text.trim(); m.showAlt = true;
  } catch (e) { toast(e.message); }
  m.altStatus = null; renderMsgs();
}

// Small Markdown renderer: ### titles, **bold**, ==highlight==, "- " lists, [n] headline links.
// named: show the source name on each link instead of the headline number.
function md(text, { named = false } = {}) {
  const items = R.feed?.items || [];
  const link = (it, label, cls = "") => `<a class="cite${cls}" href="${esc(it.link)}" target="_blank" rel="noopener" title="${esc(it.title + " — " + it.source)}">${label}</a>`;
  // A run of citations like [6][9][1] becomes one group of links; named groups show up to 3 sources and "+N".
  const cite = (s) => s.replace(/(?:\s*\[\d{1,3}\])+/g, (run) => {
    const found = [...run.matchAll(/\[(\d{1,3})\]/g)].map((m) => items.find((x) => x.n === Number(m[1]))).filter(Boolean);
    if (!found.length) return "";
    if (!named) return " " + found.map((it) => link(it, it.n)).join("");
    const bySource = [...new Map(found.map((it) => [it.source, it])).values()];
    const shown = bySource.slice(0, 3).map((it) => link(it, `${ic.link}${esc(it.source)}`, " named")).join("");
    const more = bySource.length > 3 ? `<span class="cite named more" title="${esc(bySource.slice(3).map((x) => x.source).join(", "))}">+${bySource.length - 3}</span>` : "";
    return ` <span class="cites">${shown}${more}</span>`;
  });
  const inline = (s) => cite(esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>"));
  const out = []; let list = null;
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    const li = line.match(/^[-*•]\s+(.*)/) || line.match(/^\d+[.)]\s+(.*)/);
    if (li) { (list ||= []).push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) out.push(`<h3>${inline(h[1].replace(/\*\*/g, ""))}</h3>`);
    else if (line) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  return out.join("");
}

/* ============================== Render ============================== */

function renderShell() {
  const L = t();
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === "he" ? "rtl" : "ltr";
  document.title = L.brand;
  const draft = $("#q")?.value || "";
  app.dataset.tab = R.tab;
  app.innerHTML = `<div class="grid">
    <header class="top">
      <div class="brand"><span class="mark"><i></i></span>${L.brand}</div>
      <div class="lang" role="group" aria-label="Language"><button data-act="lang" data-v="en" aria-pressed="${S.lang === "en"}">EN</button><button data-act="lang" data-v="he" aria-pressed="${S.lang === "he"}">עב</button></div>
      <button class="prov" id="provBtn" data-act="open"></button>
    </header>
    <aside class="side">
      <span class="label">${L.countries}</span>
      <div class="search">${ic.search}<label class="sr" for="find">${L.search}</label><input id="find" type="search" placeholder="${L.search}" autocomplete="off" value="${esc(R.query)}"></div>
      <div id="results"></div>
      <div class="clist" id="clist"></div>
      <div class="foot" id="sideFoot"></div>
    </aside>
    <section class="main" id="main"></section>
    <section class="chat" aria-label="${L.chat}">
      <div class="h"><b>${L.chat}</b><span class="r"><button data-act="clear">${L.clear}</button><span id="chatProv"></span></span></div>
      <div class="msgs" id="msgs" aria-live="polite"></div>
      <div class="sugg" id="sugg">${L.sugg.map((s) => `<button class="chip" data-act="sugg">${esc(s)}</button>`).join("")}</div>
      <form class="inbox" id="inbox"><label class="sr" for="q">${L.ph}</label><textarea id="q" rows="1" placeholder="${L.ph}"></textarea><button class="send" id="sendBtn" aria-label="${L.send}">${ic.send}</button></form>
    </section>
  </div>
  <nav class="tabs"><button data-act="tab" data-v="brief" aria-pressed="${R.tab === "brief"}"><i></i>${L.brief}</button><button data-act="tab" data-v="ask" aria-pressed="${R.tab === "ask"}"><i></i>${L.askTab}</button></nav>
  <div id="modal"></div>`;
  $("#q").value = draft;
  renderTop(); renderResults(); renderList(); renderSideFoot(); renderMain(); renderMsgs(); updateSend(); renderModal();
}

function renderTop() {
  const p = provider(), L = t();
  $("#provBtn").innerHTML = `<span class="dot${hasKey() ? "" : " off"}"></span>${p.name}<small>· ${hasKey() ? L.keyok : L.nokey}</small>`;
  const cp = $("#chatProv"); if (cp) cp.textContent = p.name;
}

function renderResults() {
  const el = $("#results"); const q = R.query.trim().toLowerCase();
  if (!q) { el.innerHTML = ""; return; }
  const hits = COUNTRIES.filter((c) => !S.sel.includes(c[0]) && (c[1].toLowerCase().includes(q) || c[2].includes(R.query.trim()) || c[0].toLowerCase() === q)).slice(0, 8);
  el.innerHTML = `<div class="results">${hits.length ? hits.map((c) => `<button data-act="add" data-id="${c[0]}"><span class="iso">${c[0]}</span>${esc(S.lang === "he" ? c[2] : c[1])}</button>`).join("") : `<span class="empty">${t().noMatch}</span>`}</div>`;
}

function renderList() {
  const counts = R.feed?.counts || {};
  $("#clist").innerHTML = S.sel.map((iso) => `<button class="ct" data-act="ct" data-id="${iso}" aria-pressed="true" title="${esc(cname(iso))}"><span class="chk"></span><span class="iso">${iso}</span>${esc(cname(iso))}<span class="cnt">${counts[iso] ?? ""}</span></button>`).join("")
    + (S.sel.length ? "" : SUGGESTED.map((iso) => `<button class="ct" data-act="ct" data-id="${iso}" aria-pressed="false"><span class="chk"></span><span class="iso">${iso}</span>${esc(cname(iso))}</button>`).join(""));
}
const SUGGESTED = ["IL", "US", "GB", "FR", "JP"];

function renderSideFoot() {
  const L = t(); const loading = R.feed?.status === "loading";
  $("#sideFoot").innerHTML = `<button class="refresh${loading ? " spin" : ""}" data-act="refresh" ${!S.sel.length || loading ? "disabled" : ""}>${ic.refresh}${L.refresh}</button><span class="upd">${R.feed?.fetchedAt ? L.updated(clock(R.feed.fetchedAt)) : ""}</span>`;
}

function storyCard(s, i, key, items) {
  const L = t();
  const tr = R.storyTr.get(`${key}|${i}`);
  const showTr = tr?.status === "ready" && tr.show;
  const topic = showTr ? tr.topic : s.topic, title = showTr ? tr.title : s.title, text = showTr ? tr.text : s.text;
  const srcs = (s.sources || []).map((n) => items.find((x) => x.n === Number(n))).filter(Boolean);
  const latest = srcs.map((x) => x.date).sort().at(-1);
  const isHe = isHebrew(title + text);
  const trLabel = tr?.status === "loading" ? t().translating : showTr ? L.original : (isHebrew(s.title + s.text) ? T.he.translate : T.en.translate);
  return `<article class="story" dir="${isHe ? "rtl" : "ltr"}" lang="${isHe ? "he" : "en"}">
    <div class="meta">${topic ? `<span class="tag">${esc(topic)}</span>` : ""}${s.country ? `<span class="cc">${esc(s.country)}</span>` : ""}<span>${L.sources(srcs.length)}${latest ? " · " + ago(latest) : ""}</span></div>
    <h3>${esc(title)}</h3><p>${esc(text)}</p>
    ${srcs.length ? `<div class="srcs">${srcs.slice(0, 5).map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener" title="${esc(x.title)}">${esc(x.source)}</a>`).join("")}</div>` : ""}
    <div class="acts" dir="${S.lang === "he" ? "rtl" : "ltr"}"><button class="chip" data-act="askStory" data-i="${i}">${L.ask}</button><button class="chip" data-act="trStory" data-i="${i}" ${tr?.status === "loading" ? "disabled" : ""}>${trLabel}</button></div>
  </article>`;
}

function headlinesBlock(items) {
  return `<div class="hl">${items.map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener" dir="ltr" lang="en"><span class="cc">${x.iso}</span><span class="tt">${esc(x.title)}</span><span class="mm">${esc(x.source)} · ${ago(x.date)}</span></a>`).join("")}</div>`;
}

function groupByDay(list, dateOf) {
  const today = dayKey(Date.now()), yest = dayKey(Date.now() - 864e5);
  const g = { today: [], yesterday: [], earlier: [] };
  for (const x of list) { const d = dateOf(x); const k = d ? dayKey(d) : today; (k === today ? g.today : k === yest ? g.yesterday : g.earlier).push(x); }
  return g;
}

function renderMain() {
  const L = t(); const el = $("#main"); if (!el) return;
  if (!S.sel.length) {
    el.innerHTML = `<div class="empty-state"><span class="globe">${ic.globe}</span><h1>${L.none}</h1><p>${L.noneSub}</p></div>`;
    return;
  }
  const feed = R.feed;
  const head = `<div class="mhead"><div class="t"><h1>${esc(countryTitle())}</h1><div class="sub">${L.sub[S.range]}${feed?.status === "ready" ? " · " + L.stories(feed.items.length) : ""}</div></div>
    <div class="range" role="group" aria-label="Time range">${Object.keys(RANGES).map((r) => `<button data-act="range" data-v="${r}" aria-pressed="${S.range === r}">${L[r]}</button>`).join("")}</div></div>`;

  if (!feed || feed.status === "loading") {
    el.innerHTML = head + `<div class="loading-line"><span class="spinner"></span>${L.loadingNews(S.sel.length)}</div><div class="skel"><div></div><div></div><div></div></div>`;
    return;
  }
  if (feed.status === "error") {
    el.innerHTML = head + `<div class="sum err"><p>${L.newsErr}</p><div class="row"><button class="chip solid" data-act="refresh">${L.retry}</button></div></div>`;
    return;
  }
  if (!feed.items.length) { el.innerHTML = head + `<div class="sum"><p>${L.noNews}</p></div>`; return; }

  const items = feed.items;
  if (!hasKey()) {
    el.innerHTML = head + `<div class="sum"><div class="h"><b>${L.summary}</b></div><p>${L.needKey}</p><div class="row"><button class="chip solid" data-act="open">${L.addKey}</button></div></div>` + rawHeadlines(items);
    return;
  }

  const key = briefKey(); const b = R.brief.get(key);
  if (!b || b.status === "loading") {
    el.innerHTML = head + `<div class="sum"><div class="h"><b>${L.summary}</b><span class="by">${esc(provider().name)}</span></div><div class="loading-line"><span class="spinner"></span>${L.summarizing}</div></div>` + rawHeadlines(items);
    return;
  }
  if (b.status === "error") {
    el.innerHTML = head + `<div class="sum err"><div class="h"><b>${L.summary}</b><span class="by">${esc(provider().name)}</span></div><p>${esc(b.error)}</p><div class="row"><button class="chip solid" data-act="resum">${L.retry}</button><button class="chip" data-act="open">${L.setT}</button></div></div>` + rawHeadlines(items);
    return;
  }

  const d = b.data; const cl = contentLang();
  const sumDir = isHebrew(d.summary) ? "rtl" : "ltr";
  let html = head + `<div class="sum"><div class="h"><b>${L.summary}</b><span class="by">${L.by} ${esc(provider().name)}${b.model ? " · " + esc(b.model) : ""}</span></div><div class="sumtext" dir="${sumDir}" lang="${cl}">${md(d.summary.replace(/\\n/g, "\n"), { named: true })}</div></div>`;
  const cards = d.stories.map((s, i) => ({ s, i }));
  const card = ({ s, i }) => storyCard(s, i, key, items);

  if (S.range === "today") {
    html += `<div class="stories">${cards.map(card).join("")}</div>`;
  } else if (S.range === "two") {
    const g = groupByDay(cards, ({ s }) => (s.sources || []).map((n) => items.find((x) => x.n === Number(n))?.date).filter(Boolean).sort().at(-1));
    for (const [k, label] of [["today", L.today], ["yesterday", L.yesterday], ["earlier", L.earlier]]) {
      if (g[k].length) html += `<section class="group"><h2 class="gh">${label}</h2><div class="stories">${g[k].map(card).join("")}</div></section>`;
    }
  } else {
    html += `<section class="group"><h2 class="gh">${L.top}</h2><div class="stories">${cards.map(card).join("")}</div></section>`;
    html += `<section class="group"><h2 class="gh">${L.daybyday}</h2>${timeline(d.days, items)}</section>`;
  }
  el.innerHTML = html;
}

function rawHeadlines(items) {
  const L = t();
  if (S.range === "today") return `<section class="group"><h2 class="gh">${L.headlines}</h2>${headlinesBlock(items.slice(0, 30))}</section>`;
  const byDay = {};
  for (const x of items) (byDay[dayKey(x.date)] ||= []).push(x);
  return Object.keys(byDay).sort().reverse().map((k) => `<section class="group"><h2 class="gh">${k === dayKey(Date.now()) ? L.today : dayLabel(k)}</h2>${headlinesBlock(byDay[k].slice(0, 12))}</section>`).join("");
}

function timeline(days, items) {
  let rows = Array.isArray(days) ? days.filter((d) => d && d.date && Array.isArray(d.items)) : [];
  if (!rows.length) { // fallback: newest headline per country per day
    const m = {};
    for (const x of items) { const k = dayKey(x.date); m[k] ||= {}; m[k][x.iso] ||= x.title; }
    rows = Object.keys(m).map((date) => ({ date, items: Object.entries(m[date]).map(([country, line]) => ({ country, line })) }));
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const today = dayKey(Date.now());
  return `<div class="timeline">${rows.map((r) => `<div class="day${r.date === today ? " today" : ""}"><span class="d">${esc(dayLabel(r.date))}</span><div class="l">${r.items.map((it) => `<span dir="${isHebrew(it.line || "") ? "rtl" : "ltr"}"><span class="cc">${esc(it.country)}</span>${esc(it.line)}</span>`).join("")}</div></div>`).join("")}</div>`;
}

function renderMsgs() {
  const L = t(); const el = $("#msgs"); if (!el) return;
  if (!R.chat.length && !R.chatBusy) { el.innerHTML = `<p class="hint">${L.chatEmpty}</p>`; $("#sugg").hidden = false; return; }
  $("#sugg").hidden = R.chat.length > 2;
  el.innerHTML = R.chat.map((m, i) => {
    if (m.role === "user") return `<div class="bub u" dir="auto">${esc(m.content)}</div>`;
    if (m.err) return `<div class="bub a err" dir="auto">${esc(m.content)}</div>`;
    const showing = m.showAlt && m.alt; const txt = showing ? m.alt : m.content;
    const he = isHebrew(txt);
    const trBtn = m.altStatus === "loading" ? L.translating : showing ? L.original : L.tr;
    return `<div class="bub a">${showing ? `<span class="tr-label">${m.altLang === "Hebrew" ? T.en.translatedTo : T.he.translatedTo}</span>` : ""}
      <div class="body" dir="${he ? "rtl" : "ltr"}" lang="${he ? "he" : "en"}">${md(txt)}</div>
      <span class="ftr"><button class="mini" data-act="trMsg" data-i="${i}">${trBtn}</button><button class="mini" data-act="copy" data-i="${i}">${L.copy}</button></span></div>`;
  }).join("") + (R.chatBusy ? `<div class="bub a"><span class="loading-line"><span class="spinner"></span>${L.thinking}</span></div>` : "");
  el.scrollTop = el.scrollHeight;
}

function updateSend() { const b = $("#sendBtn"); if (b) b.disabled = R.chatBusy; }

/* ---------- Settings ---------- */

function openSettings() { R.settings = true; renderModal(); loadModelLists();setTimeout(() => $(`#k-${S.active}`)?.focus(), 30); }
function closeSettings() { R.settings = false; renderModal(); renderTop(); summarize(); }

function renderModal() {
  const el = $("#modal"); if (!el) return;
  if (!R.settings) { el.innerHTML = ""; return; }
  const L = t();
  el.innerHTML = `<div class="scrim" data-act="closebg"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="setT">
    <div class="mh"><div><h2 id="setT">${L.setT}</h2><p>${L.setS}</p></div><button class="x" data-act="close" aria-label="${L.done}">${ic.x}</button></div>
    <div class="pcards">${PROVIDERS.map((p) => {
      const has = !!S.keys[p.id], act = S.active === p.id, msg = R.testMsg[p.id];
      return `<div class="pc${act ? " active" : ""}" data-p="${p.id}">
        <div class="ph"><span class="logo">${p.logo}</span><span class="nm"><b>${p.name}</b><span>${p.desc[S.lang]}</span></span>
          <span class="st${has ? "" : " off"}" id="st-${p.id}"><i></i>${has ? (S.verified[p.id] ? L.ok : L.saved) : L.notset}</span></div>
        <div class="field"><label for="k-${p.id}">${L.key}</label><div class="in"><input id="k-${p.id}" data-key="${p.id}" type="password" value="${esc(S.keys[p.id] || "")}" placeholder="${p.ph}" autocomplete="off" spellcheck="false"><button type="button" data-act="reveal" data-id="${p.id}">${L.show}</button></div></div>
        ${modelField(p)}
        <div class="row">${act ? `<button class="btn tan" disabled>${L.inuse}</button>` : `<button class="btn" data-act="use" data-id="${p.id}">${L.use}</button>`}
          <button class="btn ghost" data-act="test" data-id="${p.id}" ${R.testing[p.id] ? "disabled" : ""}>${R.testing[p.id] ? L.testing : L.test}</button>
          <a class="get" href="${p.link}" target="_blank" rel="noopener">${L.getkey}</a></div>
        <div class="msg ${msg?.ok ? "ok" : msg ? "bad" : ""}" aria-live="polite">${esc(msg?.text || "")}</div>
      </div>`;
    }).join("")}</div>
    <div class="prefs">
      <div class="field"><label for="pl">${L.prefLang}</label><select id="pl">${["app", "en", "he"].map((v, i) => `<option value="${v}" ${S.summaryLang === v ? "selected" : ""}>${L.langOpts[i]}</option>`).join("")}</select></div>
      <div class="field"><label for="pr">${L.prefRange}</label><select id="pr">${Object.keys(RANGES).map((r) => `<option value="${r}" ${S.defRange === r ? "selected" : ""}>${L[r]}</option>`).join("")}</select></div>
    </div>
    <div class="lock">${ic.lock}<span>${L.lock}</span></div>
    <div class="end"><button class="btn" data-act="close">${L.done}</button></div>
  </div></div>`;
}

/* Model dropdown: recommended presets, OpenRouter's free models, then every model the key can use. */
function modelOptions(p) {
  const L = t(); const cur = S.models[p.id] || p.model;
  const opt = (id, label) => `<option value="${esc(id)}" ${id === cur ? "selected" : ""}>${esc(label)}</option>`;
  const seen = new Set();
  const group = (label, rows) => {
    rows = rows.filter(([id]) => !seen.has(id)); rows.forEach(([id]) => seen.add(id));
    return rows.length ? `<optgroup label="${esc(label)}">${rows.map(([id, l]) => opt(id, l)).join("")}</optgroup>` : "";
  };
  let html = group(L.gRec, p.presets.map(([id, en, he]) => [id, S.lang === "he" ? he : en]));
  if (p.id === "openrouter" && R.orModels) {
    const free = R.orModels.free.filter((m) => !seen.has(m.id));
    html += group(L.gFree(free.length), free.map((m) => [m.id, m.name]));
    html += group(L.gPaid, R.orModels.paid.map((m) => [m.id, m.name]));
  } else if (p.id === "openrouter" && R.orLoading) {
    html += `<option disabled>${esc(L.testing)}</option>`;
  }
  if (p.id !== "openrouter" && R.modelList[p.id]?.length) html += group(L.gKey, R.modelList[p.id].map((id) => [id, id]));
  if (!seen.has(cur)) html = group(L.gCur, [[cur, cur]]) + html;
  return html + `<option value="__other">${esc(L.other)}</option>`;
}

function modelField(p) {
  const L = t();
  if (R.customModel[p.id]) {
    return `<div class="field"><label for="m-${p.id}">${L.model}</label><div class="in"><input id="m-${p.id}" data-model="${p.id}" value="${esc(S.models[p.id] || "")}" placeholder="${L.otherPh}" spellcheck="false" autocomplete="off"><button type="button" data-act="modelList" data-id="${p.id}">${L.backToList}</button></div></div>`;
  }
  const cur = S.models[p.id] || p.model;
  const free = p.id === "openrouter" && (cur === "openrouter/free" || cur.endsWith(":free"));
  return `<div class="field"><label for="m-${p.id}">${L.model}</label><select id="m-${p.id}" data-msel="${p.id}">${modelOptions(p)}</select>${free ? `<span class="note">${L.freeNote}</span>` : ""}</div>`;
}

function refreshModelSelect(id) {
  const sel = $(`#m-${id}`); const p = PROVIDERS.find((x) => x.id === id);
  if (sel && sel.tagName === "SELECT" && p) sel.innerHTML = modelOptions(p);
}

async function loadModelLists() {
  if (!R.orModels && !R.orLoading) {
    R.orLoading = true;
    api("/api/openrouter-models").then((d) => { R.orModels = d; }).catch(() => {}).finally(() => { R.orLoading = false; refreshModelSelect("openrouter"); });
  }
  for (const p of PROVIDERS) {
    if (p.id === "openrouter" || !S.keys[p.id] || R.modelList[p.id]) continue;
    api("/api/models", { provider: p.id, key: S.keys[p.id] }).then(({ models }) => { R.modelList[p.id] = models; refreshModelSelect(p.id); }).catch(() => {});
  }
}

async function testKey(id) {
  const key = S.keys[id];
  if (!key) { R.testMsg[id] = { ok: false, text: t().notset }; renderModal(); return; }
  R.testing[id] = true; R.testMsg[id] = null; renderModal();
  try {
    const { models } = await api("/api/models", { provider: id, key });
    R.modelList[id] = models; S.verified[id] = true; save();
    R.testMsg[id] = { ok: true, text: t().modelsFound(models.length) };
  } catch (e) {
    S.verified[id] = false; save();
    R.testMsg[id] = { ok: false, text: e.message };
  }
  R.testing[id] = false; renderModal(); renderTop();
}

/* ============================== Events ============================== */

let feedTimer;
function scheduleFeed() { clearTimeout(feedTimer); feedTimer = setTimeout(() => loadFeed(), 350); }

function toggleCountry(id) {
  if (S.sel.includes(id)) S.sel = S.sel.filter((x) => x !== id); else S.sel = [...S.sel, id];
  save(); renderList(); scheduleFeed(); renderMain();
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  switch (a) {
    case "lang": if (S.lang !== b.dataset.v) { S.lang = b.dataset.v; save(); renderShell(); summarize(); } break;
    case "range": if (S.range !== b.dataset.v) { S.range = b.dataset.v; loadFeed(); } break;
    case "ct": toggleCountry(b.dataset.id); break;
    case "add": R.query = ""; $("#find").value = ""; renderResults(); toggleCountry(b.dataset.id); $("#find").focus(); break;
    case "refresh": loadFeed(true); break;
    case "resum": summarize(true); break;
    case "open": openSettings(); break;
    case "close": closeSettings(); break;
    case "closebg": if (e.target === b) closeSettings(); break;
    case "use": S.active = b.dataset.id; save(); renderModal(); renderTop(); break;
    case "test": testKey(b.dataset.id); break;
    case "modelList": { const id = b.dataset.id; R.customModel[id] = false; if (!S.models[id]) delete S.models[id]; save(); renderModal(); break; }
    case "reveal": { const inp = $(`#k-${b.dataset.id}`); const show = inp.type === "password"; inp.type = show ? "text" : "password"; b.textContent = show ? t().hide : t().show; break; }
    case "tab": R.tab = b.dataset.v; app.dataset.tab = R.tab; app.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === R.tab)); break;
    case "sugg": sendChat(b.textContent); goAsk(); break;
    case "clear": R.chat = []; renderMsgs(); break;
    case "askStory": {
      const s = R.brief.get(briefKey())?.data?.stories?.[Number(b.dataset.i)]; if (!s) break;
      const q = $("#q"); q.value = `${t().youAsk} "${s.title}"`; goAsk(); q.focus(); autoGrow(); break;
    }
    case "trStory": translateStory(Number(b.dataset.i)); break;
    case "trMsg": translateMsg(Number(b.dataset.i)); break;
    case "copy": {
      const m = R.chat[Number(b.dataset.i)]; const txt = m.showAlt && m.alt ? m.alt : m.content;
      try { await navigator.clipboard.writeText(txt); toast(t().copied); } catch { toast(txt.slice(0, 80)); }
      break;
    }
  }
});

function goAsk() { if (window.matchMedia("(max-width: 760px)").matches) { R.tab = "ask"; app.dataset.tab = "ask"; app.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === "ask")); } }

app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "find") { R.query = el.value; renderResults(); }
  else if (el.id === "q") autoGrow();
  else if (el.dataset.key) {
    const id = el.dataset.key; S.keys[id] = el.value.trim(); S.verified[id] = false; R.testMsg[id] = null; save();
    const st = $(`#st-${id}`); if (st) { st.className = "st" + (S.keys[id] ? "" : " off"); st.innerHTML = `<i></i>${S.keys[id] ? t().saved : t().notset}`; }
    renderTop();
  } else if (el.dataset.model) { S.models[el.dataset.model] = el.value.trim(); save(); }
});
app.addEventListener("change", (e) => {
  const ms = e.target.dataset.msel;
  if (ms) {
    if (e.target.value === "__other") { R.customModel[ms] = true; renderModal(); $(`#m-${ms}`)?.focus(); }
    else { S.models[ms] = e.target.value; save(); renderModal(); $(`#m-${ms}`)?.focus(); }
  }
  if (e.target.id === "pl") { S.summaryLang = e.target.value; save(); }
  if (e.target.id === "pr") { S.defRange = e.target.value; save(); }
});
app.addEventListener("submit", (e) => { if (e.target.id === "inbox") { e.preventDefault(); const q = $("#q"); const v = q.value; q.value = ""; autoGrow(); sendChat(v); } });
app.addEventListener("keydown", (e) => {
  if (e.target.id === "q" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#inbox").requestSubmit(); }
  if (e.target.id === "find" && e.key === "Enter") { e.preventDefault(); $("#results button")?.click(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && R.settings) closeSettings(); });

function autoGrow() { const q = $("#q"); if (!q) return; q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 140) + "px"; }

/* ============================== Start ============================== */

renderShell();
if (S.sel.length) loadFeed();
