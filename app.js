"use strict";

/* ============================================================
   0. 常量
   ============================================================ */

const SESSION_DIR = "sample-upload/20261008_101649";

const SLOTS = [
  { id: "ueCsi", party: "ue", kind: "csi", title: "UE 信道", hint: "CSV", file: `${SESSION_DIR}/UE_PDsch_DMRS_20261008_101649.csv` },
  { id: "nbCsi", party: "nb", kind: "csi", title: "基站信道", hint: "CSV", file: `${SESSION_DIR}/PUSCH_PUsch_DMRS_20261008_101649.csv` },
  { id: "eveCsi", party: "eve", kind: "csi", title: "Eve 信道", hint: "CSV", file: `${SESSION_DIR}/EVE_PEsch_DMRS_20261008_101649.csv` },
  { id: "ueKey", party: "ue", kind: "key", title: "UE 密钥", hint: "TXT", file: `${SESSION_DIR}/UE_UE_key_20261008_101649.txt` },
  { id: "nbKey", party: "nb", kind: "key", title: "基站密钥", hint: "TXT", file: `${SESSION_DIR}/PUSCH_UE_key_20261008_101649.txt` },
  { id: "eveKey", party: "eve", kind: "key", title: "Eve 密钥", hint: "TXT", file: `${SESSION_DIR}/EVE_EVE_key_20261008_101649.txt` },
];

const PARTY_LABEL = { ue: "UE", nb: "基站", eve: "Eve" };
const PARTY_COLOR = { ue: "#2563eb", nb: "#0d7a4b", eve: "#c2410c" };
const LAGS = [1, 2, 4, 8, 16, 32];
const BLOCKS = [4, 8, 16, 32];
const BS = [4, 6, 8, 10, 12];
const MIN_BLOCKS = 30;
const LN2 = Math.LN2;

const PAGES = [
  { id: "scene", name: "场景与模型" },
  { id: "import", name: "数据导入" },
  { id: "analog", name: "模拟域分析" },
  { id: "digital", name: "数字域分析" },
  { id: "recon", name: "调和与放大" },
  { id: "report", name: "报告与历史" },
];

function kicker(id) {
  const i = PAGES.findIndex((p) => p.id === id);
  if (i < 0) return "";
  return `${String(i + 1).padStart(2, "0")} ${PAGES[i].name}`;
}

const state = {
  page: "scene",
  tab: "home",
  seg: "analog",
  risOn: true,
  jamOn: false,
  playing: true,
  slots: {},
  L: 4,
  b: 8,
  scrollFit: false,
  checkOpen: null,
  nistOpen: null,
  synthetic: false,
  env: "室内",
  motion: "静止",
  ris: "无",
  attack: "被动窃听",
  channel: "已认证",
  feature: "CSI",
  csiUse: "幅度",
  eveObs: true,
  eveQuant: true,
  eveOther: false,
  toast: "",
  pN: 131072,
  pRate: 0.75,
  pLeakMode: "rate",
  pActualPublic: 32768,
  pOther: 128,
  pPa: 256,
  pAuthBits: 128,
  pHmin: 90000,
  pSeconds: 193,
  pSucc: 100,
  history: [],
  sampleAvailable: null, // null = 未探测；false = 本站未附带实测示例数据
};

let _session = null;
const _memo = new Map();

/* ============================================================
   1. 工具
   ============================================================ */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function num(x, d) {
  if (x == null || !Number.isFinite(x)) return "—";
  const opt = d == null ? {} : { minimumFractionDigits: d, maximumFractionDigits: d };
  return x.toLocaleString("zh-CN", opt);
}
function fx(x, d) {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(d == null ? 2 : d);
}
function pct(x, d) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(d == null ? 1 : d)}%`;
}
function tex(src, display) {
  const attr = String(src).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<span class="tex${display ? " tex-display" : ""}" data-tex="${attr}"></span>`;
}
function typeset(root) {
  if (typeof katex === "undefined") return;
  const scope = root || document;
  scope.querySelectorAll(".tex").forEach((el) => {
    const src = el.dataset.tex || "";
    if (el.dataset.done === src) return;
    try {
      katex.render(src, el, { throwOnError: false, displayMode: el.classList.contains("tex-display"), output: "html" });
      el.dataset.done = src;
    } catch (e) { /* 保持原文 */ }
  });
}
function chip(text, tone) {
  return `<span class="chip ${tone || ""}">${esc(text)}</span>`;
}
function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 1e-12 || vy <= 1e-12) return null;
  return (sxy - (sx * sy) / n) / Math.sqrt(vx * vy);
}
function miBits(r) {
  if (r == null) return null;
  const c = Math.max(-0.999999, Math.min(0.999999, r));
  return -0.5 * Math.log(1 - c * c) / LN2;
}
/* 确定性随机（截图与复现需要） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootstrap(n, fn, B) {
  const rand = mulberry32(20261008);
  const out = [];
  const idx = new Array(n);
  for (let k = 0; k < (B || 800); k++) {
    for (let i = 0; i < n; i++) idx[i] = (rand() * n) | 0;
    const v = fn(idx);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  if (!out.length) return null;
  out.sort((a, b) => a - b);
  const q = (p) => out[Math.min(out.length - 1, Math.max(0, Math.round(p * (out.length - 1))))];
  return { lo: q(0.05), hi: q(0.95) };
}

/* ============================================================
   2. 解析
   ============================================================ */

function parseCsi(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const acc = new Map();
  let good = 0, bad = 0, t0 = "", t1 = "";
  for (const line of lines) {
    if (!line) continue;
    const p = line.split(",");
    if (p.length < 10) { bad++; continue; }
    const clock = p[3].trim();
    const hm = clock.split(":");
    if (hm.length < 3) { bad++; continue; }
    const sec = Number(hm[0]) * 3600 + Number(hm[1]) * 60 + Number(hm[2]);
    if (!Number.isFinite(sec)) { bad++; continue; }
    let sum = 0, cnt = 0, ok = true;
    for (let i = 8; i + 1 < p.length; i += 4) {
      const I = Number(p[i]);
      const Q = Number(p[i + 1]);
      if (!Number.isFinite(I) || !Number.isFinite(Q)) { ok = false; break; }
      sum += Math.hypot(I, Q);
      cnt++;
    }
    if (!ok || !cnt) { bad++; continue; }
    const v = sum / cnt;
    const cur = acc.get(sec);
    if (cur) { cur.s += v; cur.n++; }
    else acc.set(sec, { s: v, n: 1 });
    if (!t0) t0 = clock;
    t1 = clock;
    good++;
  }
  if (!good) return { ok: false, error: bad ? "没有可用的时刻或 CSI 数值" : "空文件" };
  const secs = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, o]) => ({ t, v: o.s / o.n, n: o.n }));
  return { ok: true, rows: good, bad, t0, t1, secs };
}

function parseKey(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const good = lines.filter((s) => /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0).map((s) => s.toUpperCase());
  if (!good.length) return { ok: false, error: "不是十六进制文本" };
  return {
    ok: true,
    lines: good,
    bad: lines.length - good.length,
    bits: good.reduce((s, l) => s + l.length * 4, 0),
    width: good[0].length * 4,
  };
}

function slotOfFile(file) {
  const path = String(file.webkitRelativePath || file.name).replace(/\\/g, "/").toUpperCase();
  const name = path.split("/").pop();
  const isKey = /KEY/.test(name);
  let party = "";
  if (/EVE/.test(path)) party = "eve";
  else if (/PUSCH/.test(path)) party = "nb";
  else if (/^UE_|_UE_|\/UE\//.test(path)) party = "ue";
  if (!party) return null;
  const id = party + (isKey ? "Key" : "Csi");
  return SLOTS.find((s) => s.id === id) || null;
}

/* ============================================================
   3. 会话装配
   ============================================================ */

function loadSlot(id, file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    const slot = SLOTS.find((s) => s.id === id);
    reader.onload = () => {
      const text = String(reader.result || "");
      const parsed = slot.kind === "csi" ? parseCsi(text) : parseKey(text);
      resolve({ ...parsed, name: file.name, size: file.size });
    };
    reader.onerror = () => resolve({ ok: false, error: "读取失败" });
    reader.readAsText(file, "utf-8");
  });
}

async function importFiles(fileList) {
  const files = [...fileList];
  let n = 0;
  for (const file of files) {
    const slot = slotOfFile(file);
    if (!slot) continue;
    state.slots[slot.id] = await loadSlot(slot.id, file);
    n++;
  }
  invalidate();
  state.synthetic = false;
  state.scrollFit = n > 0;
  snapBlock();
  toast(n ? `已载入 ${n} 个文件` : "没有识别出可用的 CSV / TXT");
}

/* 探测站点是否附带实测示例数据（公开演示版不带 sample-upload/） */
function probeSample() {
  fetch(SLOTS[0].file, { method: "HEAD" })
    .then((r) => { state.sampleAvailable = r.ok; })
    .catch(() => { state.sampleAvailable = false; })
    .then(() => {
      if (state.sampleAvailable === false && state.tab === "input") render();
    });
}

async function loadSample() {
  if (state.sampleAvailable === false) {
    state.tab = "input";
    toast("本站是公开演示版，未附带实测数据 —— 请用「载入合成演示」或上传自己的 CSV / TXT");
    return;
  }
  try {
    const res = await Promise.all(
      SLOTS.map(async (s) => {
        const r = await fetch(s.file);
        if (!r.ok) throw new Error(s.file);
        return [s, await r.text()];
      })
    );
    for (const [s, text] of res) {
      const parsed = s.kind === "csi" ? parseCsi(text) : parseKey(text);
      state.slots[s.id] = { ...parsed, name: s.file.split("/").pop(), size: text.length };
    }
    state.sampleAvailable = true;
    state.synthetic = false;
    invalidate();
    snapBlock();
  } catch (e) {
    state.sampleAvailable = false;
    state.tab = "input";
    invalidate();
    toast("实测示例数据未随本站发布 —— 请载入合成演示，或上传自己的 CSV / TXT");
  }
}

function invalidate() {
  _session = null;
  _memo.clear();
  nistCache = null;
}

/* ---------- 合成演示数据 ----------
   用 AR(1) 生成三方平稳序列：合法端共享 94% 相关，Eve 独立。
   目的是让块长、样本量、平稳性都达标，从而看到「数据合格时」的呈现。
   数值仍由同一套估计器算出，不是写死的常量。 */

function synthSeries() {
  const N = 1800;
  const rnd = mulberry32(20261008);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rnd();
    while (!v) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const A = 0.86;
  const RHO = 0.94;
  const sd = Math.sqrt(1 - A * A);
  let x = 0, y = 0, z = 0;
  const ue = [], nb = [], eve = [];
  for (let t = 0; t < N; t++) {
    x = A * x + sd * gauss();
    y = A * y + sd * gauss();
    z = A * z + sd * gauss();
    ue.push(x);
    nb.push(RHO * x + Math.sqrt(1 - RHO * RHO) * y);
    eve.push(z);
  }
  return { ue, nb, eve, rnd };
}

function synthCsiText(vals, rnd, tag) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const base = 10 * 3600;
  return vals.map((v, t) => {
    const m = 1500 + 160 * v;
    const out = [];
    for (let k = 0; k < 2; k++) {
      const ph = rnd() * Math.PI * 2;
      const I = Math.round(m * Math.cos(ph));
      const Q = Math.round(m * Math.sin(ph));
      out.push(I, Q, I, Q);
    }
    const sec = base + t;
    const clock = `${pad2(Math.floor(sec / 3600) % 24)}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`;
    return `${tag} DMRS,65373,615,${clock},0,0,2,48,${out.join(",")}`;
  }).join("\n");
}

function synthKeyText(lines, rnd) {
  const HEX = "0123456789ABCDEF";
  const arr = [];
  for (let i = 0; i < lines; i++) {
    let s = "";
    for (let j = 0; j < 128; j++) s += HEX[(rnd() * 16) | 0];
    arr.push(s);
  }
  return arr.join("\n");
}

function snapBlock() {
  const rec = recommendedBlock();
  if (rec) state.L = rec.L;
}

function loadSynth() {
  const g = synthSeries();
  const keyA = synthKeyText(107, g.rnd);
  const keyE = synthKeyText(99, g.rnd);
  const jobs = [
    ["ueCsi", "synth-UE-csi.csv", "csi", synthCsiText(g.ue, g.rnd, "PDSCH")],
    ["nbCsi", "synth-基站-csi.csv", "csi", synthCsiText(g.nb, g.rnd, "PUSCH")],
    ["eveCsi", "synth-Eve-csi.csv", "csi", synthCsiText(g.eve, g.rnd, "PEsch")],
    ["ueKey", "synth-UE-key.txt", "key", keyA],
    ["nbKey", "synth-基站-key.txt", "key", keyA],
    ["eveKey", "synth-Eve-key.txt", "key", keyE],
  ];
  for (const [id, name, kind, text] of jobs) {
    const parsed = kind === "csi" ? parseCsi(text) : parseKey(text);
    state.slots[id] = { ...parsed, name, size: text.length };
  }
  state.synthetic = true;
  invalidate();
  snapBlock();
  state.scrollFit = false;
  render();
}

function session() {
  if (_session) return _session;
  const csi = {}, keys = {};
  for (const s of SLOTS) {
    const v = state.slots[s.id];
    if (v && v.ok) (s.kind === "csi" ? csi : keys)[s.party] = v;
  }
  const present = ["ue", "nb", "eve"].filter((p) => csi[p]);
  let align = null;
  if (present.length >= 2) {
    const maps = present.map((p) => new Map(csi[p].secs.map((o) => [o.t, o.v])));
    let common = [...maps[0].keys()];
    for (let i = 1; i < maps.length; i++) common = common.filter((t) => maps[i].has(t));
    common.sort((a, b) => a - b);
    const minLen = Math.min(...present.map((p) => csi[p].secs.length));
    const span = common.length ? common[common.length - 1] - common[0] + 1 : 0;
    const series = {};
    present.forEach((p, i) => { series[p] = common.map((t) => maps[i].get(t)); });
    align = {
      present,
      common,
      series,
      ratio: common.length / minLen,
      span,
      gap: span ? (span - common.length) / span : 1,
      counts: Object.fromEntries(present.map((p) => [p, csi[p].secs.length])),
    };
  }
  _session = { csi, keys, align };
  return _session;
}

const hasAny = () => Object.keys(state.slots).some((k) => state.slots[k] && state.slots[k].ok);
const hasAnalog = () => { const s = session(); return Boolean(s.align && s.align.present.includes("ue") && s.align.present.includes("nb")); };
const hasKeys = () => { const s = session(); return Boolean(s.keys.ue); };

/* ============================================================
   4. 模拟域 A1–A6
   ============================================================ */

function acfAt(common, vals, lag) {
  const map = new Map();
  for (let i = 0; i < common.length; i++) map.set(common[i], vals[i]);
  const xs = [], ys = [];
  for (let i = 0; i < common.length; i++) {
    const t = common[i] + lag;
    if (map.has(t)) { xs.push(vals[i]); ys.push(map.get(t)); }
  }
  return xs.length >= 8 ? pearson(xs, ys) : null;
}

function stationarity(vals) {
  const K = 4;
  const size = Math.floor(vals.length / K);
  if (size < 5) return null;
  const wins = [];
  for (let k = 0; k < K; k++) {
    const seg = vals.slice(k * size, k * size + size);
    wins.push({ mean: mean(seg), sd: sd(seg) });
  }
  const pool = Math.sqrt(mean(wins.map((w) => w.sd * w.sd)));
  const means = wins.map((w) => w.mean);
  const dMu = pool > 1e-12 ? (Math.max(...means) - Math.min(...means)) / pool : 0;
  const sds = wins.map((w) => w.sd).filter((s) => s > 1e-12);
  const F = sds.length > 1 ? (Math.max(...sds) ** 2) / (Math.min(...sds) ** 2) : 1;
  const level = dMu < 1 && F < 2 ? "平稳" : dMu < 2 || F < 4 ? "弱非平稳" : "明显非平稳";
  return { wins, dMu, F, level, tone: level === "平稳" ? "ok" : level === "弱非平稳" ? "warn" : "bad" };
}

function blockMeans(common, vals, L) {
  const base = common[0];
  const map = new Map();
  for (let i = 0; i < common.length; i++) {
    const b = Math.floor((common[i] - base) / L);
    const o = map.get(b) || { s: 0, n: 0 };
    o.s += vals[i]; o.n++;
    map.set(b, o);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, o]) => o.s / o.n);
}

function estimateUL(L) {
  const key = `UL-${L}`;
  if (_memo.has(key)) return _memo.get(key);
  const s = session();
  const A = s.align;
  if (!A || !A.series.ue || !A.series.nb) { _memo.set(key, null); return null; }
  const xs = blockMeans(A.common, A.series.ue, L);
  const ys = blockMeans(A.common, A.series.nb, L);
  const zs = A.series.eve ? blockMeans(A.common, A.series.eve, L) : null;
  const n = xs.length;

  const stat = (idx) => {
    const gx = idx.map((i) => xs[i]);
    const gy = idx.map((i) => ys[i]);
    const gz = zs ? idx.map((i) => zs[i]) : null;
    const rxy = pearson(gx, gy);
    if (rxy == null) return null;
    const Ixy = miBits(rxy);
    if (!gz) return { U: Ixy / L, D: null, raw: null, Ixy, Ixz: null, pxy: null, rxy };
    const rxz = pearson(gx, gz);
    const ryz = pearson(gy, gz);
    if (rxz == null || ryz == null) return null;
    const den = (1 - rxz * rxz) * (1 - ryz * ryz);
    if (den <= 1e-12) return null;
    const p = (rxy - rxz * ryz) / Math.sqrt(den);
    const c = Math.max(-0.999999, Math.min(0.999999, p));
    const Icond = -0.5 * Math.log(1 - c * c) / LN2;
    const Ixz = miBits(rxz);
    const raw = (Ixy - Ixz) / L;
    return { U: Icond / L, D: Math.max(0, raw), raw, Ixy, Ixz, pxy: c, rxy };
  };

  const full = new Array(n).fill(0).map((_, i) => i);
  const base = stat(full);
  if (!base) { _memo.set(key, null); return null; }
  const ciU = bootstrap(n, (idx) => { const r = stat(idx); return r && r.U; });
  const ciD = base.D == null ? null : bootstrap(n, (idx) => { const r = stat(idx); return r && r.raw; });

  const out = {
    L, n, base, ciU, ciD,
    hasEve: Boolean(zs),
    ok: n >= MIN_BLOCKS,
    perBlock: n ? (A.common.length / n).toFixed(1) : "0",
  };
  _memo.set(key, out);
  return out;
}

function blockCandidates() {
  if (_memo.has("blocks")) return _memo.get("blocks");
  const s = session();
  const A = s.align;
  if (!A) { _memo.set("blocks", []); return []; }
  const costOf = { 4: "低", 8: "中", 16: "高", 32: "很高" };
  const rows = BLOCKS.map((L) => {
    const rho = acfAt(A.common, A.series.ue, L);
    const n = Math.floor(A.span / L);
    const cover = rho == null ? "样本不足" : rho <= 0.2 ? "较完整" : rho <= 0.4 ? "部分" : "不足";
    const support = n >= 30 ? "较充分" : n >= 10 ? "偏少" : "不足";
    const cur = estimateUL(L);
    const nxt = L <= 16 ? estimateUL(L * 2) : null;
    let stab = null;
    if (cur && nxt && cur.base.U > 0 && nxt.base.U > 0) {
      stab = Math.abs(cur.base.U - nxt.base.U) / Math.max(cur.base.U, nxt.base.U);
    }
    return { L, rho, n, cover, support, cost: costOf[L], stab, ok: cover === "较完整" && support !== "不足" };
  });
  _memo.set("blocks", rows);
  return rows;
}

/* ============================================================
   5. 数字域 D1–D5
   ============================================================ */

function toBits(lines) {
  let total = 0;
  for (const l of lines) total += l.length * 4;
  const out = new Uint8Array(total);
  let k = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const v = parseInt(line[i], 16);
      out[k++] = (v >> 3) & 1;
      out[k++] = (v >> 2) & 1;
      out[k++] = (v >> 1) & 1;
      out[k++] = v & 1;
    }
  }
  return out;
}

function digital() {
  if (_memo.has("digital")) return _memo.get("digital");
  const s = session();
  if (!s.keys.ue) { _memo.set("digital", null); return null; }
  const bitsA = toBits(s.keys.ue.lines);
  const bitsB = s.keys.nb ? toBits(s.keys.nb.lines) : null;
  const bitsE = s.keys.eve ? toBits(s.keys.eve.lines) : null;

  let diff = 0;
  if (bitsB) {
    const n = Math.min(bitsA.length, bitsB.length);
    for (let i = 0; i < n; i++) if (bitsA[i] !== bitsB[i]) diff++;
  }
  const same = bitsB ? diff === 0 : null;

  let eveDiff = 0;
  let eveComp = 0;
  if (bitsE) {
    eveComp = Math.min(bitsA.length, bitsE.length);
    for (let i = 0; i < eveComp; i++) if (bitsA[i] !== bitsE[i]) eveDiff++;
  }
  const eveRate = eveComp ? eveDiff / eveComp : null;

  const width = s.keys.ue.width;
  let tot = 0;
  for (let i = 0; i < bitsA.length; i++) if (bitsA[i]) tot++;
  const p1 = tot / bitsA.length;

  const groups = {};
  for (const b of BS) {
    const nb = Math.floor(bitsA.length / b);
    const states = 2 ** b;
    const counts = new Uint32Array(states);
    for (let i = 0; i < nb; i++) {
      let v = 0;
      for (let k = 0; k < b; k++) v = (v << 1) | bitsA[i * b + k];
      counts[v]++;
    }
    let max = 0, filled = 0;
    for (let i = 0; i < states; i++) { if (counts[i] > max) max = counts[i]; if (counts[i]) filled++; }
    // 相邻组重复率
    let sameAdj = 0;
    for (let i = 1; i < nb; i++) {
      let a = 0, c = 0;
      for (let k = 0; k < b; k++) { a = (a << 1) | bitsA[(i - 1) * b + k]; c = (c << 1) | bitsA[i * b + k]; }
      if (a === c) sameAdj++;
    }
    groups[b] = {
      b, nb, states, counts, filled, max,
      ratio: nb / states,
      hmin: max ? -Math.log2(max / nb) : null,
      adjRate: nb > 1 ? sameAdj / (nb - 1) : null,
      adjExpect: 1 / states,
      marginalOk: nb >= 10 * states,
    };
  }

  const out = {
    bitsA, bitsB, bitsE,
    nBits: bitsA.length,
    nBitsE: bitsE ? bitsE.length : 0,
    diff, same,
    kdr: bitsB ? diff / Math.min(bitsA.length, bitsB.length) : null,
    eveDiff, eveComp, eveRate,
    lines: s.keys.ue.lines.length,
    linesE: s.keys.eve ? s.keys.eve.lines.length : 0,
    width,
    p1,
    groups,
  };
  _memo.set("digital", out);
  return out;
}

/* ============================================================
   6. NIST SP 800-22（自原实现移植）
   ============================================================ */

function logGamma(z) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = z, y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < c.length; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function igamSeries(a, x) {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 400; n++) {
    ap += 1; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}
function igamCF(a, x) {
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i <= 400; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
function igamc(a, x) {
  if (!(a > 0) || x < 0) return NaN;
  if (x === 0) return 1;
  const q = x < a + 1 ? 1 - igamSeries(a, x) : igamCF(a, x);
  return q < 0 ? 0 : q > 1 ? 1 : q;
}
function erfc(x) { return x < 0 ? 2 - igamc(0.5, x * x) : igamc(0.5, x * x); }
function normCdf(x) { return 0.5 * erfc(-x / Math.SQRT2); }

function fftRadix2(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (invert ? 2 : -2) * Math.PI / len;
    const wr0 = Math.cos(ang), wi0 = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + half] * wr - im[i + j + half] * wi;
        const vi = re[i + j + half] * wi + im[i + j + half] * wr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + half] = ur - vr; im[i + j + half] = ui - vi;
        const nr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nr;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function dftMagHalf(x) {
  const n = x.length;
  const m = 1 << Math.ceil(Math.log2(2 * n - 1));
  const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
  for (let j = 0; j < n; j++) {
    const ang = Math.PI * j * j / n;
    ar[j] = x[j] * Math.cos(ang);
    ai[j] = -x[j] * Math.sin(ang);
  }
  for (let k = 0; k < n; k++) {
    const ang = Math.PI * k * k / n;
    br[k] = Math.cos(ang); bi[k] = Math.sin(ang);
    if (k) { br[m - k] = br[k]; bi[m - k] = bi[k]; }
  }
  fftRadix2(ar, ai, false);
  fftRadix2(br, bi, false);
  for (let i = 0; i < m; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const im = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r; ai[i] = im;
  }
  fftRadix2(ar, ai, true);
  const half = Math.floor(n / 2);
  const mag = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const ang = Math.PI * k * k / n;
    mag[k] = Math.hypot(Math.cos(ang) * ar[k] + Math.sin(ang) * ai[k], Math.cos(ang) * ai[k] - Math.sin(ang) * ar[k]);
  }
  return mag;
}
function gf2Rank32(rows) {
  const a = rows.slice();
  let rank = 0;
  for (let col = 31; col >= 0 && rank < 32; col--) {
    const mask = 1 << col;
    let sel = -1;
    for (let i = rank; i < 32; i++) if (a[i] & mask) { sel = i; break; }
    if (sel < 0) continue;
    const t = a[rank]; a[rank] = a[sel]; a[sel] = t;
    for (let i = 0; i < 32; i++) if (i !== rank && (a[i] & mask)) a[i] ^= a[rank];
    rank++;
  }
  return rank;
}
function patternCounts(bits, m) {
  const n = bits.length;
  const mask = (1 << m) - 1;
  const v = new Array(1 << m).fill(0);
  let w = 0;
  for (let i = 0; i < m - 1; i++) w = (w << 1) | bits[i];
  for (let i = 0; i < n; i++) {
    w = ((w << 1) | bits[(i + m - 1) % n]) & mask;
    v[w]++;
  }
  return v;
}
function psi2(bits, m) {
  const n = bits.length;
  const v = patternCounts(bits, m);
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return (s * (1 << m)) / n - n;
}
function phiApEn(bits, m) {
  const n = bits.length;
  const v = patternCounts(bits, m);
  let phi = 0;
  for (let i = 0; i < v.length; i++) {
    if (!v[i]) continue;
    const p = v[i] / n;
    phi += p * Math.log(p);
  }
  return phi;
}

function nistRow(id, name, param, p, note, req) {
  if (p == null) return { id, name, param, p: null, pass: null, note: note || "样本不足", req };
  const pass = p >= 0.01;
  return { id, name, param, p, pass, note: pass ? "通过" : "未通过", req };
}

function nistSuite(bits) {
  const n = bits.length;
  const rows = [];
  rows.push(nistRow("freq", "频率检验（单比特）", tex(`n=${num(n)}`), (() => {
    if (n < 100) return null;
    let s = 0;
    for (let i = 0; i < n; i++) s += bits[i] ? 1 : -1;
    return erfc(Math.abs(s) / Math.sqrt(n) / Math.SQRT2);
  })(), undefined, "n ≥ 100"));

  rows.push(nistRow("block", "块内频率检验", (() => {
    if (n < 100) return "";
    let M = Math.max(20, Math.floor(n / 99));
    let N = Math.floor(n / M);
    while (N >= 100 && M < n) { M += 1; N = Math.floor(n / M); }
    return tex(`M=${num(M)}\\cdot N=${num(N)}`);
  })(), (() => {
    if (n < 100) return null;
    let M = Math.max(20, Math.floor(n / 99));
    let N = Math.floor(n / M);
    while (N >= 100 && M < n) { M += 1; N = Math.floor(n / M); }
    let chi = 0;
    for (let i = 0; i < N; i++) {
      let ones = 0;
      for (let j = 0; j < M; j++) ones += bits[i * M + j];
      const d = ones / M - 0.5;
      chi += d * d;
    }
    return igamc(N / 2, chi * 2 * M);
  })(), undefined, "n ≥ 100"));

  rows.push(nistRow("runs", "游程检验", "", (() => {
    if (n < 100) return null;
    let ones = 0;
    for (let i = 0; i < n; i++) ones += bits[i];
    const pi = ones / n;
    if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(n)) return null;
    let runs = 1;
    for (let i = 1; i < n; i++) if (bits[i] !== bits[i - 1]) runs++;
    return erfc(Math.abs(runs - 2 * n * pi * (1 - pi)) / (2 * Math.sqrt(2 * n) * pi * (1 - pi)));
  })(), "π 偏离 0.5 过多", "n ≥ 100"));

  rows.push(nistRow("longrun", "块内最长 1 游程", (() => {
    if (n < 128) return "";
    return tex(n < 6272 ? "M=8" : "M=128");
  })(), (() => {
    if (n < 128) return null;
    let M, K, V, pi;
    if (n < 6272) { M = 8; K = 3; V = [1, 2, 3, 4]; pi = [0.21484375, 0.3671875, 0.23046875, 0.1875]; }
    else if (n < 750000) { M = 128; K = 5; V = [4, 5, 6, 7, 8, 9]; pi = [0.1174035788, 0.242955959, 0.249363483, 0.17517706, 0.102701071, 0.112398847]; }
    else { M = 10000; K = 6; V = [10, 11, 12, 13, 14, 15, 16]; pi = [0.0882, 0.2092, 0.2483, 0.1933, 0.1208, 0.0675, 0.0727]; }
    const N = Math.floor(n / M);
    const nu = new Array(K + 1).fill(0);
    for (let i = 0; i < N; i++) {
      let run = 0, longest = 0;
      for (let j = 0; j < M; j++) {
        if (bits[i * M + j]) { run++; if (run > longest) longest = run; } else run = 0;
      }
      if (longest < V[0]) nu[0]++;
      for (let j = 0; j <= K; j++) if (longest === V[j]) nu[j]++;
      if (longest > V[K]) nu[K]++;
    }
    let chi = 0;
    for (let i = 0; i <= K; i++) {
      const e = N * pi[i];
      chi += ((nu[i] - e) ** 2) / e;
    }
    return igamc(K / 2, chi / 2);
  })(), undefined, "n ≥ 128"));

  rows.push(nistRow("rank", "二元矩阵秩检验", (() => {
    const m = Math.floor(n / 1024);
    return tex(`32\\times32\\cdot N=${num(m)}`);
  })(), (() => {
    const matrices = Math.floor(n / 1024);
    if (matrices < 38) return null;
    let full = 0, minus = 0;
    for (let t = 0; t < matrices; t++) {
      const r32 = new Array(32);
      for (let r = 0; r < 32; r++) {
        let w = 0;
        const off = t * 1024 + r * 32;
        for (let c = 0; c < 32; c++) w = (w << 1) | bits[off + c];
        r32[r] = w | 0;
      }
      const rk = gf2Rank32(r32);
      if (rk === 32) full++; else if (rk === 31) minus++;
    }
    const rest = matrices - full - minus;
    const chi = ((full - matrices * 0.2888) ** 2) / (matrices * 0.2888)
      + ((minus - matrices * 0.5776) ** 2) / (matrices * 0.5776)
      + ((rest - matrices * 0.1336) ** 2) / (matrices * 0.1336);
    return Math.exp(-chi / 2);
  })(), undefined, "n ≥ 38,912"));

  rows.push(nistRow("dft", "离散傅里叶变换检验", "", (() => {
    if (n < 1000) return null;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = bits[i] ? 1 : -1;
    const mag = dftMagHalf(x);
    const th = Math.sqrt(Math.log(20) * n);
    let n1 = 0;
    for (let i = 0; i < mag.length; i++) if (mag[i] < th) n1++;
    const n0 = 0.95 * n / 2;
    return erfc(Math.abs((n1 - n0) / Math.sqrt(n * 0.95 * 0.05 / 4)) / Math.SQRT2);
  })(), undefined, "n ≥ 1,000"));

  rows.push(nistRow("nonoverlap", "非重叠模板匹配", tex("n\\ge 10^6"), null, "样本不足", "n ≥ 1,000,000"));
  rows.push(nistRow("overlap", "重叠模板匹配", tex("n\\ge 10^6"), null, "样本不足", "n ≥ 1,000,000"));
  rows.push(nistRow("maurer", "Maurer 通用统计", tex("n\\ge 387{,}840"), null, "样本不足", "n ≥ 387,840"));
  rows.push(nistRow("linear", "线性复杂度检验", tex("n\\ge 10^6"), null, "样本不足", "n ≥ 1,000,000"));

  const logn = Math.floor(Math.log2(n));
  const sm = Math.min(8, logn - 3);
  const serial = (() => {
    if (sm < 2 || n < 100) return null;
    const d1 = psi2(bits, sm) - psi2(bits, sm - 1);
    return igamc(2 ** (sm - 2), d1 / 2);
  })();
  const serial2 = (() => {
    if (sm < 2 || n < 100) return null;
    const d2 = psi2(bits, sm) - 2 * psi2(bits, sm - 1) + psi2(bits, sm - 2);
    return igamc(2 ** (sm - 3), d2 / 2);
  })();
  rows.push(nistRow("serial", "序列检验（一阶差分）", tex(`m=${sm}`), serial, undefined, tex("m\\le\\lfloor\\log_2 n\\rfloor-3")));
  rows.push(nistRow("serial2", "序列检验（二阶差分）", tex(`m=${sm}`), serial2, undefined, tex("m\\le\\lfloor\\log_2 n\\rfloor-3")));

  const am = Math.min(5, logn - 6);
  rows.push(nistRow("apen", "近似熵检验", tex(`m=${am}`), (() => {
    if (am < 1 || n < 100) return null;
    return igamc(2 ** (am - 1), (2 * n * (LN2 - (phiApEn(bits, am) - phiApEn(bits, am + 1)))) / 2);
  })(), undefined, tex("m<\\lfloor\\log_2 n\\rfloor-5")));

  const cusum = (forward) => {
    let s = 0, z = 0;
    if (forward) for (let i = 0; i < n; i++) { s += bits[i] ? 1 : -1; z = Math.max(z, Math.abs(s)); }
    else for (let i = n - 1; i >= 0; i--) { s += bits[i] ? 1 : -1; z = Math.max(z, Math.abs(s)); }
    if (!z) return 1;
    const sq = Math.sqrt(n);
    const e1 = Math.floor((n / z - 1) / 4);
    let s1 = 0;
    for (let k = Math.floor((-n / z + 1) / 4); k <= e1; k++) {
      s1 += normCdf(((4 * k + 1) * z) / sq) - normCdf(((4 * k - 1) * z) / sq);
    }
    let s2 = 0;
    for (let k = Math.floor((-n / z - 3) / 4); k <= e1; k++) {
      s2 += normCdf(((4 * k + 3) * z) / sq) - normCdf(((4 * k + 1) * z) / sq);
    }
    const p = 1 - s1 + s2;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  };
  rows.push(nistRow("cusum", "累加和检验（正向）", "", n < 100 ? null : cusum(true), undefined, "n ≥ 100"));
  rows.push(nistRow("cusumR", "累加和检验（反向）", "", n < 100 ? null : cusum(false), undefined, "n ≥ 100"));

  let walk = 0, cycles = 0;
  for (let i = 0; i < n; i++) { walk += bits[i] ? 1 : -1; if (walk === 0) cycles++; }
  rows.push(nistRow("walk", "随机游动检验", tex(`J=${num(cycles)}`), null, cycles >= 500 ? "未计算" : "样本不足", "J ≥ 500"));
  rows.push(nistRow("walkVar", "随机游动变体检验", tex(`J=${num(cycles)}`), null, cycles >= 500 ? "未计算" : "样本不足", "J ≥ 500"));
  return rows;
}

let nistCache = null;

const NIST_DOC = {
  freq: "统计整串比特里 1 的比例是否接近 1/2。这是最基本的一项，其他检验通常以它为隐含前提。",
  block: "把序列切成 M 位的块，检查每块内 1 的比例是否都落在 1/2 附近，能发现缓慢漂移的偏置。",
  runs: "数连续相同比特形成的段落数。段数太少说明 0/1 交替太慢，太多说明交替过于规律。",
  longrun: "在每个 M 位块里找出最长的连续 1，看它的分布是否符合随机预期，用于发现偶发的长串。",
  rank: "把序列切成 32×32 矩阵并计算 GF(2) 上的秩。随机序列的秩几乎总是 32，秩偏低说明存在线性相关。",
  dft: "检查频域能量的分布，能发现序列中隐藏的周期性。",
  nonoverlap: "用预设的非周期模板逐段匹配，统计命中次数是否偏离随机预期。",
  overlap: "同上，但允许匹配窗口重叠，对连续出现的模板更敏感。",
  maurer: "衡量序列的可压缩性。随机序列接近不可压缩，能被压缩就说明存在可利用的规律。",
  linear: "用线性反馈移位寄存器生成该序列所需的最短级数。随机序列的线性复杂度应接近长度的一半。",
  serial: "统计所有 m 位模式出现的频次，检验它们是否均匀。",
  serial2: "对模式的二阶差分做同样的检验，对局部规律更敏感。",
  apen: "比较 m 位与 m+1 位模式的重复程度，衡量整串序列的规律性。",
  cusum: "把 0/1 映射成 ±1 后累加，看随机游走偏离 0 的最大幅度是否过大。",
  cusumR: "同上，但从序列末尾反向累加，两侧都看。",
  walk: "数随机游走回到 0 的次数，再按循环长度的分布判断。",
  walkVar: "对循环内「恰好访问某个值 k 次」的计数做卡方检验。",
};
function nist() {
  if (nistCache) return nistCache;
  const d = digital();
  if (!d) { nistCache = null; return null; }
  const rows = nistSuite(d.bitsA);
  const judged = rows.filter((r) => r.pass != null);
  nistCache = { rows, judged, passed: judged.filter((r) => r.pass).length, n: d.nBits };
  return nistCache;
}

/* ============================================================
   7. 状态与结论
   ============================================================ */

function recommendedBlock() {
  if (!hasAnalog()) return null;
  const ok = blockCandidates().filter((b) => b.ok);
  return ok.length ? ok[0] : null;
}

/* 评估前提：只决定两个域能否给出数值结论，本身不是结论 */
function premise() {
  if (!hasAny()) {
    return { label: "尚未导入", tone: "mute", note: "导入三方信道与密钥后开始检查。" };
  }
  if (state.attack !== "被动窃听") {
    return { label: "前提不成立", tone: "bad", note: "主动攻击模型下条件互信息的模型不再成立，模拟域与数字域都不给出结论。" };
  }
  if (state.channel !== "已认证") {
    return { label: "前提不成立", tone: "bad", note: "协商信道未认证时需额外建模中间人能力，本版两个域都不给出结论。" };
  }
  return { label: "前提成立", tone: "ok", note: "被动窃听 + 已认证信道：允许按「合法方 ↔ Eve」两路信息分别给出结论。" };
}

/* 块间去相关的滞后外推：用 16 s → 32 s 段的对数斜率，外推到 ρ = 0.2 */
function extrapTau() {
  const s = session();
  const A = s.align;
  if (!A || !A.series.ue) return null;
  const r16 = acfAt(A.common, A.series.ue, 16);
  const r32 = acfAt(A.common, A.series.ue, 32);
  if (!Number.isFinite(r16) || !Number.isFinite(r32)) return null;
  if (!(r16 > 0.2 && r32 > 0 && r32 < r16)) return null;
  const k = Math.log(r16 / r32) / 16;
  if (!(k > 0)) return null;
  return 16 + Math.log(r16 / 0.2) / k;
}

/* ============================================================
   7.1 模拟域安全性结论（定量）
   ============================================================ */

function analogConclusion() {
  if (!hasAnalog()) return null;
  const p = premise();
  const A = session().align;
  const st = stationarity(A.series.ue);
  const blocks = blockCandidates();
  const rec = recommendedBlock();
  const u = estimateUL(state.L);
  const uOK = Boolean(u && u.ok);
  const rho = acfAt(A.common, A.series.ue, state.L);
  const indep = Number.isFinite(rho) && rho <= 0.2;
  const rXY = A.series.nb ? pearson(A.series.ue, A.series.nb) : null;
  const rXZ = A.series.eve ? pearson(A.series.ue, A.series.eve) : null;
  const refVerdict = !uOK ? "样本不足" : indep && p.tone !== "bad" ? "通过" : "仅参考";
  const okTone = (cond) => (cond ? "ok" : "warn");

  const rows = [
    {
      k: "合法链路互易性 ρ(X;Y)",
      v: fx(rXY, 3),
      rule: "≥ 0.5",
      tone: rXY != null && rXY >= 0.5 ? "ok" : "bad",
      verdict: rXY == null ? "缺数据" : rXY >= 0.5 ? "通过" : "不足",
    },
    {
      k: "窃听链路相关性 |ρ(X;Z)|",
      v: rXZ == null ? "—" : fx(Math.abs(rXZ), 3),
      rule: "< 0.3",
      tone: rXZ != null && Math.abs(rXZ) < 0.3 ? "ok" : "bad",
      verdict: rXZ == null ? "缺 Eve 数据" : Math.abs(rXZ) < 0.3 ? "通过" : "偏高",
    },
    {
      k: `块间相关 ρ(${state.L} s)`,
      v: fx(rho, 3),
      rule: "≤ 0.2",
      tone: okTone(indep),
      verdict: indep ? "通过" : "不通过",
    },
    {
      k: "块数 n",
      v: u ? num(u.n) : "—",
      rule: `≥ ${MIN_BLOCKS}`,
      tone: okTone(uOK),
      verdict: uOK ? "通过" : "不足",
    },
    {
      k: "平稳性",
      v: st ? `${fx(st.dMu, 2)}σ / ${fx(st.F, 2)}` : "—",
      rule: "Δμ < 1σ 且 F < 2",
      tone: st ? st.tone : "warn",
      verdict: st ? st.level : "无法判断",
    },
    {
      k: "块条件互信息 U_L",
      v: u ? `${fx(u.base.U, 3)} bit/s` : "—",
      rule: "> 0",
      tone: u && u.base.U > 0 ? "ok" : "bad",
      verdict: refVerdict,
    },
    {
      k: "互信息差 D_L",
      v: u && u.base.D != null ? `${fx(u.base.D, 3)} bit/s` : "—",
      rule: "> 0（保密裕量）",
      tone: u && u.base.D != null && u.base.D > 0 ? "ok" : "bad",
      verdict: u && u.base.D == null ? "缺 Eve 数据" : refVerdict,
    },
  ];

  let label, tone, text, note = null;
  const tau = extrapTau();

  if (p.tone === "bad") {
    label = "前提不成立";
    tone = "bad";
    text = p.note;
  } else if (!uOK) {
    label = "样本不足";
    tone = "warn";
    text = `当前 L = ${state.L} 秒只切出 ${u ? u.n : 0} 个块，低于 ${MIN_BLOCKS} 的下限；三变量偏相关在这个样本量下不可用，模拟域不给出数值结论。`;
  } else if (!indep && rec) {
    const ru = estimateUL(rec.L);
    label = "当前块长不可用";
    tone = "warn";
    text = `所选 L = ${state.L} 秒的 ρ = ${fx(rho, 3)} > 0.2，未通过依赖覆盖；改用建议块长 ${rec.L} 秒（ρ = ${fx(rec.rho, 3)}，${ru ? ru.n : rec.n} 块）后，U_L = ${ru ? fx(ru.base.U, 3) : "—"} bit/s 才可作为模型下结论。上表数值仅作横向对比。`;
  } else if (!indep) {
    label = "不可量化";
    tone = "warn";
    const rhos = blocks.map((b) => `${b.L} s: ${fx(b.rho, 3)}`).join("、");
    text = `块间独立不成立：所测块长的 ρ 为 ${rhos}，且没有块长同时满足 ρ ≤ 0.2 与块数 ≥ ${MIN_BLOCKS}`
      + `${st && st.tone !== "ok" ? `；平稳性判定为「${st.level}」，块均值不来自同一分布` : ""}。`
      + `因此不给「该信道可支撑的密钥率」数值，U_L = ${fx(u.base.U, 3)} bit/s、D_L = ${u.base.D == null ? "—" : fx(u.base.D, 3)} bit/s 只作描述性参考。`;
    note = tau
      ? `缺口量化：按 16 s → 32 s 段的自相关衰减外推，ρ 降到 0.2 需 τ ≈ ${fx(tau, 0)} 秒；凑满 ${MIN_BLOCKS} 个独立块需单次采集 ≥ ${num(Math.round(MIN_BLOCKS * tau))} 秒（约 ${Math.round((MIN_BLOCKS * tau) / 60)} 分钟），当前 ${A.common.length} 秒。`
      : `缺口量化：没有块长同时满足 ρ ≤ 0.2 与块数 ≥ ${MIN_BLOCKS}；最大可测滞后 32 s 处 ρ = ${fx(acfAt(A.common, A.series.ue, 32), 3)}。`;
  } else {
    label = "模型下可达";
    tone = "warn";
    text = `在联合高斯 + 块均值 + 块间独立三项假设下，该信道可支撑的密钥率上限 U_L = ${fx(u.base.U, 3)} bit/s，`
      + `合法方相对 Eve 的信息优势 D_L = ${u.base.D == null ? "—" : fx(u.base.D, 3)} bit/s > 0，即存在正的保密裕量`
      + `（L = ${u.L} 秒，${u.n} 块）。`;
    note = "该值以块均值代表块内全部信息，方向上低估；它衡量的是块均值序列里的信息量，与「512 bit/行」的量化构造不同，不能直接换算成密钥长度。";
  }

  return { label, short: label, tone, text, rows, note };
}

/* ============================================================
   7.2 数字域安全性结论（定量）
   ============================================================ */

function digitalConclusion() {
  if (!hasKeys()) return null;
  const p = premise();
  const d = digital();
  const t = nist();
  const g8 = d.groups[8];
  const nE = d.eveComp;
  const sigma = nE ? Math.sqrt(0.25 / nE) : null;
  const z = sigma && d.eveRate != null ? (d.eveRate - 0.5) / sigma : null;
  const nistAll = t.passed === t.judged.length;
  const eveOK = d.eveRate != null && Math.abs(d.eveRate - 0.5) < 0.05;
  const hminAll = g8.hmin != null ? g8.nb * g8.hmin : null;

  const rows = [
    {
      k: "合法方 KDR",
      v: d.kdr == null ? "—" : pct(d.kdr, 2),
      rule: "= 0",
      tone: d.same ? "ok" : "bad",
      verdict: d.same == null ? "缺数据" : d.same ? "通过" : "硬失败",
    },
    {
      k: "Eve 和合法方的 KDR",
      v: d.eveRate == null ? "—" : pct(d.eveRate, 2),
      rule: "≈ 50%（±5%）",
      tone: d.eveRate == null ? "mute" : eveOK ? "ok" : "bad",
      verdict: d.eveRate == null ? "缺 Eve 数据" : eveOK ? "通过" : "异常",
    },
    {
      k: "NIST SP 800-22",
      v: `${t.passed} / ${t.judged.length}`,
      rule: "全部通过",
      tone: nistAll ? "ok" : "bad",
      verdict: nistAll ? "通过" : "异常",
    },
    {
      k: "单块最小熵 H_min(8 bit)",
      v: g8.hmin == null ? "—" : `${fx(g8.hmin, 3)} bit`,
      rule: "≥ 7 bit（接近均匀）",
      tone: g8.hmin != null && g8.hmin >= 7 ? "ok" : "warn",
      verdict: g8.hmin != null && g8.hmin >= 7 ? "通过" : "偏低",
    },
    {
      k: "整体最小熵（均匀性）",
      v: hminAll == null ? "—" : `${num(Math.round(hminAll))} bit`,
      rule: "块数 × 单块 H_min",
      tone: "mute",
      verdict: "估算",
    },
    {
      k: "条件最小熵 H_min(K|E)",
      v: "不可估计",
      rule: "需放大前量化比特",
      tone: "warn",
      verdict: "未证明",
    },
  ];

  let label, tone, text, note = null;

  if (p.tone === "bad") {
    label = "前提不成立";
    tone = "bad";
    text = p.note;
  } else if (d.same === false) {
    label = "硬失败";
    tone = "bad";
    text = `双方密钥逐位比较有 ${num(d.diff)} bit 不一致（KDR = ${fx(d.kdr, 4)}）。隐私放大后两端必须完全相同，这一项不通过时，数字域的任何质量结论都不成立。`;
  } else if (!nistAll || !eveOK) {
    label = "质量异常";
    tone = "warn";
    text = `双方密钥一致（0 bit 差异），但${!nistAll ? `随机性检验只通过 ${t.passed} / ${t.judged.length} 项` : `Eve 和合法方的 KDR 为 ${pct(d.eveRate, 2)}，偏离 50% 超过 5%`}——需要先排查量化或隐私放大实现。`;
  } else {
    label = "合格 · 保密性未证明";
    tone = "warn";
    text = `密钥 ${num(d.nBits)} bit（${num(d.lines)} 行 × ${d.width}）：双方逐位一致（0 bit 差异），NIST SP 800-22 可判定的 ${t.judged.length} 项全部通过，`
      + `Eve 和合法方的 KDR 为 ${pct(d.eveRate, 2)}（偏离 50% 仅 ${fx(Math.abs(z), 2)}σ，样本 ${num(nE)} bit），`
      + `8 bit 块最小熵 ${fx(g8.hmin, 3)} bit，整体最小熵按块数 × 单块 H_min 估计约 ${num(Math.round(hminAll))} bit（占密钥长度的 ${fx((hminAll / d.nBits) * 100, 1)}%）。`;
    note = `这些是质量与随机性证据。保密强度由条件最小熵 H_min(K|E) 给出，它需要隐私放大前的量化比特；本数据只有放大后的密钥，`
      + `因此数字域不声称「Eve 的剩余不确定性 ≥ X bit」，也不把 ${num(Math.round(hminAll))} bit 当作对 Eve 的保密熵。`;
  }

  return { label, short: label === "合格 · 保密性未证明" ? "合格·未证明" : label, tone, text, rows, note };
}

function statusOf(page) {
  if (!hasAny()) return "mute";
  switch (page) {
    case "scene": return premise().tone === "bad" ? "bad" : "ok";
    case "import": {
      const s = session();
      const csiN = Object.keys(s.csi).length, keyN = Object.keys(s.keys).length;
      return csiN >= 2 && keyN >= 1 ? "ok" : "warn";
    }
    case "analog": {
      const c = analogConclusion();
      return c ? c.tone : "warn";
    }
    case "digital": {
      const c = digitalConclusion();
      return c ? c.tone : "warn";
    }
    case "recon": return hasKeys() && hasAnalog() ? "warn" : "mute";
    case "report": {
      const a = analogConclusion();
      const d = digitalConclusion();
      if (premise().tone === "bad" || (a && a.tone === "bad") || (d && d.tone === "bad")) return "bad";
      return "warn";
    }
    default: return "mute";
  }
}

/* ============================================================
   8. 视图件（对照交接包 reference 重做）
   ============================================================ */

const TABS = [
  { id: "home", name: "总览" },
  { id: "input", name: "评估设置" },
  { id: "results", name: "分析结果" },
  { id: "report", name: "评估报告" },
];

function cv(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) { return fallback; }
}

const ICONS = {
  tower: '<path d="M12 3v3M8.5 21 12 11l3.5 10M6 7c-1.8 1.6-1.8 4.4 0 6M18 7c1.8 1.6 1.8 4.4 0 6M9.5 5h5"/>',
  wave: '<path d="M3 12h2l2-5 3 10 3-8 2 3h4"/>',
  binary: '<path d="M6 5h4v6H6zM14 13h4v6h-4z"/><path d="M10 8h4M14 16h-4"/>',
  merge: '<path d="M6 4v5c0 2 2 3 6 3s6 1 6 3v5"/><path d="M18 4v5c0 2-2 3-6 3s-6 1-6 3v5"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v3M20 12v2"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
  check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
  alert: '<path d="M12 4 3 20h18L12 4z"/><path d="M12 10v4M12 17v.5"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
};

function ico(name, size) {
  const s = size || 16;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function card(title, body, right) {
  return `<section class="card">
    ${title === null ? "" : `<div class="card-head"><h3>${title}</h3>${right ? `<div class="meta">${right}</div>` : ""}</div>`}
    ${body}
  </section>`;
}

function stat(k, v, note, tone) {
  return `<div class="stat"><div class="k">${k}</div><div class="v ${tone || ""}">${v}</div>${note ? `<div class="n">${note}</div>` : ""}</div>`;
}

function kv(k, v, tone) {
  return `<div class="kv"><span>${k}</span><b class="${tone || ""}">${v}</b></div>`;
}

function tag(text, tone) {
  return `<span class="tag ${tone || ""}">${esc(text)}</span>`;
}

function emptyBox(title, body) {
  return `<div class="empty"><h3>${title}</h3>${body || ""}</div>`;
}

/* ============================================================
   9. 图表（SVG）
   ============================================================ */

function lineChart(series, o) {
  const opt = o || {};
  const w = opt.w || 720, h = opt.h || 240;
  const pad = { l: opt.yLabel ? 62 : 42, r: 14, t: 12, b: opt.xLabel ? 44 : 24 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const yMin = opt.yMin == null ? -0.2 : opt.yMin;
  const yMax = opt.yMax == null ? 1 : opt.yMax;
  const xs = series[0].xs;
  const xAt = (i) => pad.l + (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * iw);
  const yAt = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const grid = (opt.gridVals || [0, 0.2, 0.5, 1]).map((v) => {
    const dashed = Math.abs(v - (opt.markY == null ? 0.2 : opt.markY)) < 1e-9;
    return `<line x1="${pad.l}" y1="${yAt(v).toFixed(1)}" x2="${w - pad.r}" y2="${yAt(v).toFixed(1)}" stroke="${dashed ? cv("--orange", "#ad643c") : cv("--line", "#dfe5ed")}" ${dashed ? 'stroke-dasharray="4 4"' : ""}/>
      <text x="${pad.l - 8}" y="${(yAt(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${dashed ? cv("--orange", "#ad643c") : cv("--muted", "#617184")}">${v.toFixed(1)}</text>`;
  }).join("");
  const labels = xs.map((v, i) => `<text x="${xAt(i).toFixed(1)}" y="${h - (opt.xLabel ? 26 : 8)}" text-anchor="middle" font-size="12" fill="${cv("--muted", "#617184")}">${esc(v)}</text>`).join("");
  const xTitle = opt.xLabel ? `<text x="${pad.l + iw / 2}" y="${h - 6}" text-anchor="middle" font-size="12" fill="${cv("--muted", "#617184")}">${esc(opt.xLabel)}</text>` : "";
  const yTitle = opt.yLabel ? `<text x="14" y="${(pad.t + ih / 2).toFixed(1)}" text-anchor="middle" font-size="12" fill="${cv("--muted", "#617184")}" transform="rotate(-90 14 ${(pad.t + ih / 2).toFixed(1)})">${esc(opt.yLabel)}</text>` : "";
  const paths = series.map((s) => {
    let d = "", pen = false;
    s.ys.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      pen = true;
    });
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
  }).join("");
  const legend = `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opt.label || "折线图")}">${grid}${labels}${xTitle}${yTitle}${paths}</svg>${legend}</div>`;
}

function scatterChart(xs, ys, color, xName, yName) {
  const w = 300, h = 220;
  const pad = { l: 36, r: 10, t: 10, b: 32 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const zx = zscore(xs), zy = zscore(ys);
  const xAt = (v) => pad.l + ((Math.max(-3, Math.min(3, v)) + 3) / 6) * iw;
  const yAt = (v) => pad.t + (1 - (Math.max(-3, Math.min(3, v)) + 3) / 6) * ih;
  const dots = [];
  for (let i = 0; i < zx.length; i++) dots.push(`<circle cx="${xAt(zx[i]).toFixed(1)}" cy="${yAt(zy[i]).toFixed(1)}" r="1.8" fill="${color}" opacity="0.45"/>`);
  const axis = `<line x1="${pad.l}" y1="${yAt(0).toFixed(1)}" x2="${w - pad.r}" y2="${yAt(0).toFixed(1)}" stroke="${cv("--line", "#dfe5ed")}"/>
    <line x1="${xAt(0).toFixed(1)}" y1="${pad.t}" x2="${xAt(0).toFixed(1)}" y2="${h - pad.b}" stroke="${cv("--line", "#dfe5ed")}"/>
    <text x="${(pad.l + w - pad.r) / 2}" y="${h - 8}" text-anchor="middle" font-size="11.5" fill="${cv("--muted", "#617184")}">${esc(xName)}</text>
    <text x="12" y="${(pad.t + h - pad.b) / 2}" text-anchor="middle" font-size="11.5" fill="${cv("--muted", "#617184")}" transform="rotate(-90 12 ${(pad.t + h - pad.b) / 2})">${esc(yName)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="散点">${axis}${dots.join("")}</svg>`;
}

function zscore(a) {
  const m = mean(a);
  const s = sd(a) || 1;
  return a.map((v) => (v - m) / s);
}

/* 横向条形：用于熵预算 */
function barRows(items) {
  const max = Math.max.apply(null, items.map((x) => Math.abs(x.value) || 0).concat([1]));
  return `<div class="bar-rows">${items.map((x) => {
    const pct = Math.max(1, Math.round((Math.abs(x.value) / max) * 100));
    return `<div class="bar-row">
      <span class="bar-k">${x.label}</span>
      <span class="bar-track"><i class="${x.tone || ""}" style="width:${pct}%"></i></span>
      <b class="bar-v ${x.tone || ""}">${x.text}</b>
    </div>`;
  }).join("")}</div>`;
}

/* ============================================================
   10. 总览
   ============================================================ */

function sceneSvg() {
  const blue = "var(--blue)", orange = "var(--orange)", green = "var(--green)";
  const buildings = [[60, 90, 90, 110], [180, 120, 70, 80], [700, 110, 80, 90], [880, 80, 100, 120]];
  const windows = buildings.map(([x, y, w, h]) => {
    let out = "";
    for (let r = y + 10; r < y + h - 8; r += 16) {
      for (let c = x + 10; c < x + w - 10; c += 16) out += `<rect class="window" x="${c}" y="${r}" width="7" height="9" rx="1"/>`;
    }
    return out;
  }).join("");
  const ris = state.risOn
    ? `<g class="ris-group"><line class="path-ris" x1="250" y1="180" x2="550" y2="96" stroke="${green}" stroke-width="1.5" fill="none"/>
       <line class="path-ris" x1="550" y1="96" x2="850" y2="180" stroke="${green}" stroke-width="1.5" fill="none"/>
       <rect class="ris-box" x="530" y="76" width="40" height="40" rx="3" stroke-width="1.5"/>
       <rect class="ris-cell" x="535" y="81" width="6" height="6"/><rect class="ris-cell" x="546" y="81" width="6" height="6"/><rect class="ris-cell" x="557" y="81" width="6" height="6"/>
       <rect class="ris-cell" x="535" y="92" width="6" height="6"/><rect class="ris-cell" x="546" y="92" width="6" height="6"/><rect class="ris-cell" x="557" y="92" width="6" height="6"/>
       <rect class="ris-cell" x="535" y="103" width="6" height="6"/><rect class="ris-cell" x="546" y="103" width="6" height="6"/><rect class="ris-cell" x="557" y="103" width="6" height="6"/>
       <text x="550" y="70" text-anchor="middle" class="label" font-size="12">RIS</text></g>`
    : "";
  const jam = state.jamOn
    ? `<g class="jam-group"><circle cx="470" cy="214" r="6" class="jam"/><path d="M470 208l-6-10M470 208l6-10" stroke="${orange}" stroke-width="1.5" fill="none"/>
       <text x="470" y="240" text-anchor="middle" class="label" font-size="12">干扰源</text></g>`
    : "";
  return `<svg viewBox="0 0 1100 300" role="img" aria-label="城市环境中 Alice 与 Bob 通信，Eve 被动窃听，可选 RIS 反射与干扰源">
    <rect x="0" y="0" width="1100" height="300" fill="var(--base)"/>
    ${buildings.map((b) => `<rect class="building" x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" rx="2"/>`).join("")}
    ${windows}
    <g>
      <rect class="road" x="0" y="196" width="1100" height="52"/>
      <line class="dash" x1="0" y1="222" x2="1100" y2="222"/>
      <rect class="car" x="470" y="206" width="34" height="14" rx="3"/>
      <circle cx="480" cy="222" r="4" fill="var(--base)"/><circle cx="496" cy="222" r="4" fill="var(--base)"/>
    </g>
    <g>
      <rect x="150" y="168" width="4" height="26" fill="var(--green)" opacity="0.5"/><circle cx="152" cy="164" r="10" class="tree"/>
      <rect x="610" y="168" width="4" height="26" fill="var(--green)" opacity="0.5"/><circle cx="612" cy="164" r="10" class="tree"/>
      <rect x="980" y="160" width="4" height="30" fill="var(--green)" opacity="0.5"/><circle cx="982" cy="155" r="12" class="tree"/>
    </g>
    <circle cx="250" cy="180" r="12" class="node-legal" stroke-width="2"/>
    <path d="M250 174v6M244 177h12M250 192v4M246 196h8" stroke="var(--blue)" stroke-width="1.5" fill="none"/>
    <text x="250" y="158" text-anchor="middle" class="label">Alice</text>
    <text x="250" y="212" text-anchor="middle" class="bits">101100</text>
    <circle cx="850" cy="180" r="12" class="node-legal" stroke-width="2"/>
    <path d="M850 174v6M844 177h12M850 192v4M846 196h8" stroke="var(--blue)" stroke-width="1.5" fill="none"/>
    <text x="850" y="158" text-anchor="middle" class="label">Bob</text>
    <text x="850" y="212" text-anchor="middle" class="bits">101100</text>
    <line class="path-legal" x1="262" y1="180" x2="838" y2="180" stroke="${blue}" stroke-width="2" fill="none"/>
    <circle cx="560" cy="252" r="12" class="node-eve" stroke-width="2"/>
    <path d="M560 246v6M554 249h12M560 264v4M556 268h8" stroke="var(--orange)" stroke-width="1.5" fill="none"/>
    <text x="560" y="234" text-anchor="middle" class="label">Eve</text>
    <text x="560" y="284" text-anchor="middle" class="bits">011010</text>
    <line class="path-eve" x1="262" y1="186" x2="548" y2="248" stroke="${orange}" stroke-width="1.5" fill="none"/>
    <line class="path-eve" x1="838" y1="186" x2="572" y2="248" stroke="${orange}" stroke-width="1.5" fill="none"/>
    ${ris}
    ${jam}
  </svg>`;
}

function pageHome() {
  const has = hasAny();
  const p = premise();
  const d = hasKeys() ? digital() : null;
  const dataLine = state.synthetic
    ? `数据：合成演示（1 组，1800 秒）`
    : (has ? `数据：当前会话（1 组，${session().align ? session().align.span + " 秒" : "—"}）` : "数据：未导入");
  return `
  <div class="page-head">
    <h2>评估原理</h2>
    <button class="btn primary" data-jump="input">新建评估</button>
  </div>

  <div class="scene ${state.playing ? "" : "is-paused"}" id="scene">
    <div class="scene-bar">
      <label><input type="checkbox" data-act="ris" ${state.risOn ? "checked" : ""}/> RIS</label>
      <label><input type="checkbox" data-act="jam" ${state.jamOn ? "checked" : ""}/> 干扰源</label>
      <button class="btn" data-act="play">${state.playing ? "暂停" : "继续"}</button>
    </div>
    ${sceneSvg()}
  </div>
  <p class="meta" style="margin-top:8px">${dataLine} · 拓扑为概念示意，不表示真实传播仿真</p>

  ${card("物理层密钥生成流程", `<div class="generation-grid">
    <div class="generation-step">${ico("tower")}<div class="step-label">互易信道探测</div><div class="step-output">探测信号</div></div>
    <div class="generation-step">${ico("wave")}<div class="step-label">信道观测</div><div class="step-output mini-wave"><span style="height:8px"></span><span style="height:16px"></span><span style="height:10px"></span><span style="height:22px"></span><span style="height:13px"></span><span style="height:18px"></span><span style="height:7px"></span></div></div>
    <div class="generation-step">${ico("binary")}<div class="step-label">量化</div><div class="step-output"><code>10110010</code></div></div>
    <div class="generation-step">${ico("merge")}<div class="step-label">信息调和</div><div class="step-output">一致密钥</div></div>
    <div class="generation-step">${ico("key")}<div class="step-label">隐私放大</div><div class="step-output">最终密钥</div></div>
  </div>`)}

  ${card("物理层密钥安全性评估位置", `
    <div class="assessment">
      <div class="assessment-title">模拟域</div>
      <div class="assessment-cell"><span class="cell-head">输入</span><span class="cell-value">三方信道特征</span></div>
      <div class="assessment-cell"><span class="cell-head">适用性检查</span><span class="cell-value">时序依赖 · 样本规模</span></div>
      <div class="assessment-cell"><span class="cell-head">评估方法</span><span class="cell-value math">${tex("I(X^{L};Y^{L}\\mid Z^{L})/L")}</span></div>
      <div class="assessment-cell"><span class="cell-head">输出</span><span class="cell-value">源信息量参考</span></div>
    </div>
    <div class="assessment">
      <div class="assessment-title">数字域</div>
      <div class="assessment-cell"><span class="cell-head">输入</span><span class="cell-value">原始比特 · Eve 侧信息</span></div>
      <div class="assessment-cell"><span class="cell-head">适用性检查</span><span class="cell-value">块依赖 · 概率支持</span></div>
      <div class="assessment-cell"><span class="cell-head">评估方法</span><span class="cell-value math">${tex("H_{\\min}(K\\mid E)")}</span></div>
      <div class="assessment-cell"><span class="cell-head">输出</span><span class="cell-value">秘密熵下界</span></div>
    </div>
    <div class="assessment">
      <div class="assessment-title">最终密钥</div>
      <div class="assessment-cell"><span class="cell-head">输入</span><span class="cell-value">调和记录 · 放大参数</span></div>
      <div class="assessment-cell"><span class="cell-head">适用性检查</span><span class="cell-value">熵下界 · 泄露记录</span></div>
      <div class="assessment-cell"><span class="cell-head">评估方法</span><span class="cell-value math">${tex("\\ell\\le H_{\\min}^{\\varepsilon}-\\lambda-\\Delta")}</span></div>
      <div class="assessment-cell"><span class="cell-head">输出</span><span class="cell-value">安全长度 · 净速率</span></div>
    </div>
    <details><summary>指标说明</summary>
      <p>X、Y、Z 分别为 Alice、Bob、Eve 的信道特征；源信息量为模型下的上界参考，不等于实际密钥速率。
      最终长度依赖已验证的整段条件最小熵下界，扣除公开泄露 λ 与隐私放大余量 Δ。</p>
    </details>`)}

  ${card("当前评估状态", `<div class="stats">
    ${stat("评估前提", esc(p.label), `${state.attack} · 信道${state.channel}`, p.tone === "ok" ? "ok" : p.tone === "bad" ? "bad" : "mute")}
    ${stat("模拟域结论", analogConclusion() ? esc(analogConclusion().short) : "—", "信道信息量", analogConclusion() ? analogConclusion().tone : "mute")}
    ${stat("数字域结论", digitalConclusion() ? esc(digitalConclusion().short) : "—", "密钥质量", digitalConclusion() ? digitalConclusion().tone : "mute")}
    ${stat("密钥总长", d ? `${num(d.nBits)} <small>bit</small>` : "—", d ? `${num(d.lines)} 行 × ${d.width}` : "未导入", "mute")}
  </div>
  <p class="card-subnote">数据与参数在「评估设置」里导入和修改；两个域的定量结论在「分析结果」，汇总在「评估报告」。</p>`)}
  `;
}

/* ============================================================
   11. 评估设置
   ============================================================ */

function fieldSelect(label, key, opts) {
  return `<label>${label}<select data-field="${key}">${opts.map((o) => `<option value="${esc(o)}" ${state[key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
}

function fieldNumber(label, key, opt) {
  return `<label>${label}<input type="number" data-field="${key}" value="${state[key]}" ${opt || ""}/></label>`;
}

function slotCard(slot) {
  const v = state.slots[slot.id];
  const ok = Boolean(v && v.ok);
  const detail = ok
    ? (slot.kind === "csi" ? `${num(v.rows)} 行 · ${v.secs.length} 秒` : `${num(v.lines.length)} 行 · ${num(v.bits)} bit`)
    : (v && !v.ok ? (v.error || "解析失败") : "未载入");
  const icon = slot.party === "ue" ? "phone" : slot.party === "nb" ? "radio" : "eye";
  return `<div class="file ${ok ? "ok" : ""}">
    <div class="file-top">
      <span class="file-party">${ico(icon, 14)}${slot.party === "ue" ? "Alice" : slot.party === "nb" ? "Bob" : "Eve"} · ${slot.kind === "csi" ? "信道" : "密钥"}</span>
      ${ok ? `<span class="file-state ok">已解析</span>` : v && !v.ok ? `<span class="file-state err">解析失败</span>` : `<span class="file-state">待载入</span>`}
    </div>
    <div class="file-name">${ok ? esc(v.name) : "—"}</div>
    <div class="file-meta">${esc(detail)}</div>
    <button class="btn file-btn" data-act="pick" data-slot="${slot.id}">${ok ? "替换文件" : "选择文件"}</button>
  </div>`;
}

function analogChecks() {
  const A = session().align;
  if (!A) return [];
  const st = stationarity(A.series.ue);
  const blocks = blockCandidates();
  const rec = recommendedBlock();
  const probe = rec ? rec.L : 4;
  const rho = acfAt(A.common, A.series.ue, probe);
  const cover = rho == null ? "样本不足" : rho <= 0.2 ? "较完整" : rho <= 0.4 ? "部分" : "不足";
  return [
    { k: "数据完整性", rule: "缺口 < 10%", actual: pct(A.gap), verdict: A.gap < 0.1 ? "通过" : "缺口偏大", tone: A.gap < 0.1 ? "ok" : "warn", why: "三方同一秒都有数据的比例；缺口太大会让按块切分出现空块。" },
    { k: "时间对齐", rule: "重叠 ≥ 50%", actual: pct(A.ratio), verdict: A.ratio >= 0.5 ? "通过" : "部分对齐", tone: A.ratio >= 0.5 ? "ok" : "warn", why: "以记录最少的一方为分母，衡量三方共同时段占比。" },
    { k: "时间相关性", rule: `ρ(${probe}s) ≤ 0.2`, actual: fx(rho, 3), verdict: cover === "较完整" ? "通过" : cover, tone: cover === "较完整" ? "ok" : "warn", why: "块间是否近似独立；只低是不够的，还要能凑够块数。" },
    { k: "平稳性", rule: "Δμ<1σ 且 F<2", actual: st ? `${fx(st.dMu, 2)}σ / ${fx(st.F, 2)}` : "—", verdict: st ? st.level : "未知", tone: st ? st.tone : "warn", why: "分四段比较均值漂移与方差比；CSI 慢漂移会让不同时段的块均值失去可比性。" },
    { k: "样本充分性", rule: "n ≥ 30", actual: `${blocks[0].n} 块`, verdict: blocks[0].n >= MIN_BLOCKS ? "通过" : "不足", tone: blocks[0].n >= MIN_BLOCKS ? "ok" : "bad", why: "三变量偏相关需要至少 30 个独立样本。" },
    { k: "计算可行性", rule: "闭式解", actual: "3 变量", verdict: "可计算", tone: "ok", why: "联合高斯下条件互信息有闭式解，不需要迭代。" },
  ];
}

function digitalChecks() {
  const d = digital();
  if (!d) return [];
  const g8 = d.groups[8];
  return [
    { k: "密钥装载", rule: "十六进制 · 偶长度", actual: `${num(d.lines)} 行 × ${d.width}`, verdict: "通过", tone: "ok", why: "每两个十六进制字符是一个字节，行只是存储切分。" },
    { k: "合法方 KDR", rule: "= 0", actual: pct(d.kdr, 2), verdict: d.same ? "通过" : "硬失败", tone: d.same ? "ok" : "bad", why: "隐私放大后两端必须逐位相同，非零即流程失败。" },
    { k: "统计识别性", rule: "样本/状态 ≥ 10", actual: fx(g8.ratio, 1), verdict: g8.marginalOk ? "可估" : "不足", tone: g8.marginalOk ? "ok" : "warn", why: "分组直方图是否被样本撑满；空格子会让最小熵虚高。" },
    { k: "条件最小熵", rule: "需放大前比特", actual: "不可估计", verdict: "未证明", tone: "warn", why: "H_min(K|E) 需要隐私放大前的量化比特与 Eve 同期观测，当前数据没有。" },
  ];
}

function checkTable(items) {
  if (!items.length) return emptyBox("还没有可检查的数据", "<p>先在下方导入三方信道与密钥。</p>");
  return `<table class="data"><thead><tr><th>检查项</th><th>判据</th><th class="num">实测</th><th class="num">判定</th></tr></thead><tbody>
    ${items.map((it) => {
      const open = state.checkOpen === it.k;
      const row = `<tr class="clickable" data-act="check" data-check="${esc(it.k)}">
        <td><b style="font-weight:600">${it.k}</b></td>
        <td class="meta">${it.rule}</td>
        <td class="num">${it.actual}</td>
        <td class="num">${tag(it.verdict, it.tone)}</td></tr>`;
      return open ? row + `<tr class="note-row"><td colspan="4">${it.why}</td></tr>` : row;
    }).join("")}
  </tbody></table>`;
}

function pageInput() {
  const A = hasAnalog() ? session().align : null;
  const d = hasKeys() ? digital() : null;
  const b = budget();
  const summary = [
    stat("三方重叠时长", A ? `${num(A.common.length)} <small>秒</small>` : "—", A ? `占采集 ${pct(A.ratio)}` : "未导入", "mute"),
    stat("采集时长", A ? `${num(A.span)} <small>秒</small>` : "—", A ? `${pct(A.gap)} 无同时数据` : "—", "mute"),
    stat("密钥长度", d ? `${num(d.nBits)} <small>bit</small>` : "—", d ? `${num(d.lines)} 行 × ${d.width}` : "未导入", "mute"),
    stat("合法方 KDR", d ? pct(d.kdr, 2) : "—", d && d.same ? "完全一致" : "未比对", d ? (d.same ? "ok" : "bad") : "mute"),
  ].join("");

  const obs = A ? (() => {
    const n = Math.min(60, A.common.length);
    const idx = [];
    for (let i = 0; i < A.common.length; i += Math.max(1, Math.floor(A.common.length / n))) idx.push(i);
    const series = A.present.map((p) => ({
      name: PARTY_LABEL[p], color: p === "ue" ? cv("--blue", "#245b9a") : p === "nb" ? cv("--green", "#378173") : cv("--orange", "#ad643c"),
      xs: idx.map((i) => i), ys: idx.map((i) => A.series[p][i]),
    }));
    return lineChart(series, { label: "观测预览", yMin: Math.min.apply(null, series.map((s) => Math.min.apply(null, s.ys))), yMax: Math.max.apply(null, series.map((s) => Math.max.apply(null, s.ys))), xLabel: "秒", yLabel: "特征值", gridVals: [] });
  })() : "";

  return `
  <div class="page-head">
    <h2>评估设置</h2>
    <button class="btn primary" data-jump="results">查看分析</button>
  </div>

  ${card("场景与攻击", `<div class="form">
    ${fieldSelect("环境", "env", ["室内", "室外", "车载"])}
    ${fieldSelect("移动状态", "motion", ["静止", "低速", "高速"])}
    ${fieldSelect("可重构智能表面（RIS）", "ris", ["无", "有"])}
    ${fieldSelect("攻击模型", "attack", ["被动窃听", "主动攻击"])}
    ${fieldSelect("协商信道", "channel", ["已认证", "未认证"])}
    <label>特征<div class="field-pair">
      <select data-field="feature">${["CSI", "RSSI"].map((o) => `<option value="${o}" ${state.feature === o ? "selected" : ""}>${o}</option>`).join("")}</select>
      ${state.feature === "CSI" ? `<select data-field="csiUse">${["幅度", "相位", "复数值"].map((o) => `<option value="${o}" ${state.csiUse === o ? "selected" : ""}>${o}</option>`).join("")}</select>` : ""}
    </div></label>
  </div>
  <p class="card-subnote">攻击模型与协商信道直接参与判定；环境、移动状态、RIS 只记录场景、用于报告标明适用范围。</p>`)}

  ${card("数据", `
    <div class="btn-row" style="margin-bottom:14px">
      <button class="btn primary" data-act="pick-dir">${ico("folder", 14)} 选择会话文件夹</button>
      ${state.sampleAvailable === false ? "" : `<button class="btn" data-act="load-sample">载入真实示例</button>`}
      <button class="btn" data-act="load-synth">载入合成演示</button>
      <button class="btn ghost" data-act="clear">清空</button>
    </div>
    ${state.sampleAvailable === false ? `<p class="card-subnote" style="margin:0 0 12px">本站为公开演示版，<b>未附带实测采集数据</b>。可用「载入合成演示」体验完整流程，或上传自己的三方 CSV / TXT（文件名含 UE / PUSCH / EVE 即可自动归位）。</p>` : ""}
    <div class="files">${SLOTS.map(slotCard).join("")}</div>
    <div class="divider"></div>
    <div class="stats">${summary}</div>`)}

  ${card("前置检查", `
    <div class="charts">
      <div class="plot"><h3>模拟域</h3>${checkTable(analogChecks())}</div>
      <div class="plot"><h3>数字域</h3>${checkTable(digitalChecks())}</div>
    </div>
    <p class="card-subnote">未导入数据时显示为空；检查项不通过不会阻止计算，但会让对应结论降级。</p>`, tag(hasAny() ? "已检查" : "未检查", hasAny() ? "info" : ""))}

  ${card("分析参数", `<div class="form">
    ${fieldNumber(`模拟域块长 L（秒）`, "L", 'min="1" step="1"')}
    ${fieldNumber("原始保留比特 n", "pN", 'min="1" step="1024"')}
    ${fieldNumber("码率 r", "pRate", 'min="0.05" max="0.99" step="0.01"')}
    ${fieldNumber(`假设的调和前熵 H̄_min（bit）`, "pHmin", 'min="0" step="1024"')}
    ${fieldNumber("其他公开信息（bit）", "pOther", 'min="0" step="64"')}
    ${fieldNumber(`隐私放大余量 Δ_PA（bit）`, "pPa", 'min="0" step="64"')}
    ${fieldNumber("认证预共享位数（bit）", "pAuthBits", 'min="0" step="32"')}
    ${fieldNumber("处理时长（秒）", "pSeconds", 'min="1" step="1"')}
    ${fieldNumber("调和成功率（%）", "pSucc", 'min="0" max="100" step="1"')}
  </div>
  <p class="card-subnote">改任一格，熵预算与报告立即重算；建议提取长度 ℓ_safe 当前为 <b>${num(b.safe)} bit</b>（假设输入）。</p>`)}

  ${A ? card("观测预览", `${obs}<p class="card-subnote">取对齐后的前 60 个秒级样本，仅用于确认三方是否同步、量级是否可比。</p>`) : ""}
  `;
}

/* ============================================================
   12. 分析结果
   ============================================================ */

function conclusionBlock(c, sub) {
  if (!c) return "";
  return `<div class="concl ${c.tone}">
    <div class="concl-head"><span class="concl-tag">${esc(c.label)}</span><span class="meta">${esc(sub || "")}</span></div>
    <p class="concl-text">${esc(c.text)}</p>
    ${c.note ? `<p class="concl-note">${esc(c.note)}</p>` : ""}
  </div>`;
}

function segAnalog() {
  const A = session().align;
  const u = estimateUL(state.L);
  const rec = recommendedBlock();
  const blocks = blockCandidates();
  const st = stationarity(A.series.ue);
  const acfSeries = A.present.map((p) => ({
    name: PARTY_LABEL[p],
    color: p === "ue" ? cv("--blue", "#245b9a") : p === "nb" ? cv("--green", "#378173") : cv("--orange", "#ad643c"),
    xs: LAGS, ys: LAGS.map((L) => acfAt(A.common, A.series[p], L)),
  }));
  const pairs = [["ue", "nb"], ["ue", "eve"], ["nb", "eve"]]
    .filter(([a, b]) => A.series[a] && A.series[b])
    .map(([a, b]) => ({ a, b, r: pearson(A.series[a], A.series[b]), legal: a === "ue" && b === "nb" }));

  return `
  ${card("时间自相关", `${lineChart(acfSeries, { label: "自相关", yMin: -0.2, yMax: 1, markY: 0.2, xLabel: "滞后（秒，对数刻度）", yLabel: "自相关 ρ" })}
    <p class="card-subnote">横轴为对数刻度。ρ 首次降到 0.2 以下的滞后作为去相关时间，只是诊断依据，不能证明块间独立。</p>`)}

  ${card("互易性", `<div class="charts" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    ${pairs.map((p) => `<div class="plot"><h3>${PARTY_LABEL[p.a]} ↔ ${PARTY_LABEL[p.b]}　<span class="meta">${fx(p.r, 3)}</span></h3>${scatterChart(A.series[p.a], A.series[p.b], p.legal ? cv("--blue", "#245b9a") : cv("--orange", "#ad643c"), PARTY_LABEL[p.a], PARTY_LABEL[p.b])}</div>`).join("")}
  </div>
  <p class="card-subnote">合法链路应显著正相关；窃听链路应接近 0。数值为整段皮尔逊相关。</p>`)}

  ${card("块长候选", `<table class="data">
    <thead><tr><th>块长</th><th class="num">ρ(L)</th><th class="num">块数</th><th>依赖覆盖</th><th>样本支撑</th><th class="num">判定</th></tr></thead>
    <tbody>${blocks.map((b) => `<tr class="${b.L === state.L ? "picked" : ""} clickable" data-act="set-L" data-l="${b.L}">
      <td><b style="font-weight:600">${b.L} s</b></td><td class="num">${fx(b.rho, 3)}</td><td class="num">${b.n}</td>
      <td class="meta">${b.cover}</td><td class="meta">${b.support}</td>
      <td class="num">${b.ok ? tag("可选", "ok") : tag("不满足", "warn")}</td></tr>`).join("")}</tbody>
  </table>
  <p class="card-subnote">点表格行切换当前块长；当前 L = ${state.L} 秒${rec ? `，建议块长 ${rec.L} 秒` : ""}。</p>`, tag(`L = ${state.L} 秒`, "info"))}

  ${card("信息量估计", `<div class="stats">
    ${stat("块条件互信息 U_L", u ? `${fx(u.base.U, 3)} <small>bit/s</small>` : "—", u && u.ciU ? `90% CI ${fx(u.ciU.lo, 3)}–${fx(u.ciU.hi, 3)}` : "样本不足", u && u.ok ? "info" : "mute")}
    ${stat("互信息差 D_L", u && u.base.D != null ? `${fx(u.base.D, 3)} <small>bit/s</small>` : "—", u && u.base.D != null ? `截断前 ${fx(u.base.raw, 3)}` : "缺 Eve 数据", u && u.base.D > 0 ? "info" : "mute")}
    ${stat("块数", u ? num(u.n) : "—", u ? `每块 ${u.perBlock} 个观测` : "—", "mute")}
    ${stat("平稳性", st ? st.level : "—", st ? `${fx(st.dMu, 2)}σ / ${fx(st.F, 2)}` : "—", st ? st.tone : "mute")}
  </div>
  <p class="card-subnote">U_L 与 D_L 是模型下的参考值；当块间不独立时只作描述性参考，不能当作实际密钥速率。</p>`)}

  ${conclusionBlock(analogConclusion(), "模拟域 · 定量依据")}
  `;
}

function segDigital() {
  const d = digital();
  const t = nist();
  const g8 = d.groups[8];
  return `
  ${card("一致性与分组", `<div class="stats">
    ${stat("合法方 KDR", pct(d.kdr, 2), d.same ? "完全一致" : "流程硬失败", d.same ? "ok" : "bad")}
    ${stat("Eve 和合法方的 KDR", pct(d.eveRate, 2), "理想独立序列 ≈ 50%", Math.abs(d.eveRate - 0.5) < 0.05 ? "ok" : "warn")}
    ${stat("密钥总量", `${num(d.nBits)} <small>bit</small>`, `${num(d.lines)} 行 × ${d.width}`, "mute")}
    ${stat("单块最小熵", `${fx(g8.hmin, 3)} <small>bit</small>`, `8 bit 块 · ${num(g8.nb)} 组`, g8.hmin >= 7 ? "ok" : "warn")}
  </div>
  <table class="data" style="margin-top:14px">
    <thead><tr><th>块长 b</th><th class="num">组数</th><th class="num">状态 2^b</th><th class="num">样本/状态</th><th class="num">覆盖</th><th class="num">H_min</th><th class="num">识别性</th></tr></thead>
    <tbody>${BS.map((b) => {
      const g = d.groups[b];
      return `<tr><td>${b}</td><td class="num">${num(g.nb)}</td><td class="num">${num(g.states)}</td><td class="num">${fx(g.ratio, 1)}</td>
        <td class="num">${num(g.filled)}</td><td class="num">${fx(g.hmin, 3)}</td><td class="num">${g.marginalOk ? tag("可估", "ok") : tag("不足", "warn")}</td></tr>`;
    }).join("")}</tbody>
  </table>
  <p class="card-subnote">b 越大 H_min 越高，但样本/状态不足时直方图稀疏、最大频次被低估，数字不可信 —— 这张表不能横向比大小。</p>`)}

  ${card("NIST SP 800-22", `<div class="stats" style="margin-bottom:12px">
    ${stat("通过", `${t.passed} / ${t.judged.length}`, "仅统计可判定项", t.passed === t.judged.length ? "ok" : "warn")}
    ${stat("样本长度", `${num(t.n)} <small>bit</small>`, `共 ${t.rows.length} 项检验`, "mute")}
    ${stat("可判定", `${t.judged.length} 项`, "其余长度不足", "warn")}
  </div>
  <table class="data"><thead><tr><th>检验项</th><th>参数</th><th class="num">p 值</th><th class="num">判定</th></tr></thead>
    <tbody>${t.rows.map((r) => {
      const open = state.nistOpen === r.id;
      const row = `<tr class="clickable" data-act="nist" data-id="${r.id}"><td>${r.name}</td><td class="meta">${r.param || ""}</td>
        <td class="num">${r.p == null ? "—" : fx(r.p, 4)}</td><td class="num">${tag(r.note, r.pass == null ? "warn" : r.pass ? "ok" : "bad")}</td></tr>`;
      return open ? row + `<tr class="note-row"><td colspan="4">${NIST_DOC[r.id] || ""}<br><span class="hint">适用条件：${r.req || "—"}</span></td></tr>` : row;
    }).join("")}</tbody></table>`, `<span class="hint">点击行查看说明</span>`)}
  ${conclusionBlock(digitalConclusion(), "数字域 · 定量依据")}
  `;
}

function segFinal() {
  const b = budget();
  const d = hasKeys() ? digital() : null;
  const actual = d ? d.nBits : null;
  const feasible = actual != null && b.raw >= 0 && actual <= b.safe;
  const seconds = Math.max(1, Number(state.pSeconds) || 1);
  const succ = Math.min(100, Math.max(0, Number(state.pSucc) || 0));
  const netRate = actual == null ? null : (actual * (succ / 100)) / seconds;
  const verdict = actual == null
    ? `<div class="note warn">还缺密钥文件，导入后才能与实际提取长度比对。</div>`
    : b.raw < 0
      ? `<div class="note bad">参数不可行：熵 ${num(b.hmin)} bit 覆盖不了 ${num(b.spent)} bit 的扣除项。</div>`
      : feasible
        ? `<div class="note">当前配置可行：建议最多 ${num(b.safe)} bit，实际 ${num(actual)} bit，余量 ${num(b.safe - actual)} bit。</div>`
        : `<div class="note bad">提取量超出预算：建议最多 ${num(b.safe)} bit，实际 ${num(actual)} bit，超出 ${num(actual - b.safe)} bit。</div>`;

  return `
  ${card("熵预算", `
    <div class="stats" style="margin-bottom:14px">
      ${stat("建议提取长度 ℓ_safe", `${num(b.safe)} <small>bit</small>`, "假设输入下的上界", b.raw < 0 ? "bad" : "info")}
      ${stat("实际提取", actual == null ? "—" : `${num(actual)} <small>bit</small>`, actual == null ? "未导入密钥" : feasible ? "在预算内" : "超出预算", actual == null ? "mute" : feasible ? "ok" : "bad")}
      ${stat("净速率", netRate == null ? "—" : `${fx(netRate, 1)} <small>bit/s</small>`, `按 ${num(seconds)} 秒折算`, "mute")}
      ${stat("调和成功率", `${num(succ)} %`, succ >= 100 ? "全部批次成功" : "按输入值折算", succ >= 100 ? "ok" : "warn")}
    </div>
    ${barRows([
      { label: "调和前熵下界", value: b.hmin, text: `${num(b.hmin)} bit`, tone: "info" },
      { label: "公开泄露 λ", value: b.leak, text: `− ${num(b.leak)} bit` },
      { label: "其他公开信息", value: b.other, text: `− ${num(b.other)} bit` },
      { label: "隐私放大余量", value: b.pa, text: `− ${num(b.pa)} bit` },
      { label: "认证预共享", value: b.auth, text: `− ${num(b.auth)} bit` },
      { label: "建议提取长度", value: b.safe, text: `${num(b.safe)} bit`, tone: "ok" },
    ])}
    ${verdict}
    <p class="card-subnote">协议参数在「评估设置 → 分析参数」里修改；熵与码率是假设输入，不是实测值。</p>`)}
  <div class="concl mute">
    <div class="concl-head"><span class="concl-tag">只给上界，不给认证</span></div>
    <p class="concl-text">预算算的是「不超过多少 bit」，不是「至少有这么多安全熵」。真正可认证的安全长度还缺隐私放大前的量化比特。</p>
  </div>
  `;
}

function pageResults() {
  if (!hasAny()) {
    return `<div class="page-head"><h2>分析结果</h2></div>
      ${card(null, emptyBox("还没有数据", `<p>先在「评估设置」导入三方数据，或载入示例 / 合成演示。</p><p><button class="btn primary" data-jump="input">去评估设置</button></p>`))}`;
  }
  const src = state.synthetic ? "合成演示 · 1 组" : `当前会话 · 1 组`;
  const segs = [["analog", "模拟域"], ["digital", "数字域"], ["final", "最终密钥"]];
  const segBody = state.seg === "analog"
    ? (hasAnalog() ? segAnalog() : card(null, emptyBox("还缺信道数据", "<p>模拟域需要 Alice、Bob 两方（最好三方）的 CSI/RSSI。</p><p><button class=\"btn primary\" data-jump=\"input\">去评估设置</button></p>")))
    : state.seg === "digital"
      ? (hasKeys() ? segDigital() : card(null, emptyBox("还缺密钥文件", "<p>数字域需要 Alice / Bob 的 TXT 密钥。</p><p><button class=\"btn primary\" data-jump=\"input\">去评估设置</button></p>")))
      : segFinal();
  return `
  <div class="page-head"><h2>分析结果</h2><span class="meta">${src}</span></div>
  <div class="toolbar">
    <div class="segments" role="group" aria-label="分析阶段">${segs.map(([id, name]) => `<button data-act="seg" data-seg="${id}" aria-pressed="${state.seg === id}">${name}</button>`).join("")}</div>
    <span class="meta">当前阶段：${(segs.find((s) => s[0] === state.seg) || segs[0])[1]}</span>
  </div>
  ${segBody}
  `;
}

/* ============================================================
   13. 评估报告
   ============================================================ */

function pageReport() {
  const p = premise();
  const ac = analogConclusion();
  const dc = digitalConclusion();
  const b = budget();
  const d = hasKeys() ? digital() : null;
  const actual = d ? d.nBits : null;
  const A = hasAnalog() ? session().align : null;
  const u = hasAnalog() ? estimateUL(state.L) : null;
  const tone = !hasAny() ? "mute" : p.tone === "bad" ? "bad" : "warn";
  const label = !hasAny() ? "尚未导入" : p.tone === "bad" ? "前提不成立" : "分域结论 · 不合并评级";

  const findings = [
    { h: "信道源", t: u ? `块条件互信息 ${fx(u.base.U, 3)} bit/s${ac && ac.label === "模型下可达" ? "" : "（描述性）"}，合法方相对 Eve 的信息优势 ${u.base.D == null ? "—" : fx(u.base.D, 3)} bit/s。` : "未导入信道数据。" },
    { h: "数字域", t: d ? `合法方 KDR ${pct(d.kdr, 2)}，Eve 和合法方的 KDR ${pct(d.eveRate, 2)}，NIST ${nist() ? nist().passed : 0}/${nist() ? nist().judged.length : 0} 通过。` : "未导入密钥。" },
    { h: "最终判断", t: actual == null ? "缺少密钥，无法比对提取长度。" : b.raw < 0 ? "熵假设覆盖不了扣除项，参数不可行。" : `建议提取 ${num(b.safe)} bit，实际 ${num(actual)} bit，${actual <= b.safe ? "在预算内" : "超出预算"}；保密强度仍缺 H_min(K|E)。` },
  ];

  const rows = [
    ["三方数据", A ? `${num(A.common.length)} 秒（${pct(A.ratio)}）` : "—", A && A.ratio >= 0.5 ? tag("已对齐", "ok") : tag("未对齐", "warn")],
    ["模拟域", ac ? ac.label : "—", ac ? tag(ac.tone === "ok" ? "可用" : ac.tone === "bad" ? "不可用" : "参考", ac.tone) : "—"],
    ["数字域", dc ? dc.label : "—", dc ? tag(dc.tone === "ok" ? "通过" : dc.tone === "bad" ? "失败" : "未证明", dc.tone) : "—"],
    ["熵预算", b.raw < 0 ? "参数不可行" : `${num(b.safe)} bit`, b.raw < 0 ? tag("不可行", "bad") : tag("假设输入", "warn")],
    ["安全长度", "不予认证", tag("缺 H_min(K|E)", "warn")],
  ];

  return `
  <div class="page-head"><h2>评估报告</h2><span class="meta">${state.synthetic ? "合成演示" : "当前会话"} · ${d ? num(d.nBits) + " bit" : "无密钥"} · 指纹 #${fingerprint()}</span></div>

  <div class="concl ${tone}">
    <div class="concl-head"><span class="concl-tag">${esc(label)}</span><span class="meta">两域 + 熵预算</span></div>
    <p class="concl-text">${!hasAny()
      ? "导入数据后会在这里给出分域结论：模拟域回答信道里有多少可用的秘密信息，数字域回答提取出的密钥是否合格。"
      : p.tone === "bad" ? esc(p.note) : `本次评估不给出合并的安全等级。模拟域：${ac ? ac.label : "无数据"}；数字域：${dc ? dc.label : "无数据"}；${actual == null ? "熵预算待密钥导入后比对" : b.raw < 0 ? "熵预算参数不可行" : `熵预算留有 ${num(b.safe - actual)} bit 余量`}。`}</p>
  </div>

  ${card("秘密熵预算", barRows([
    { label: "调和前熵下界", value: b.hmin, text: `${num(b.hmin)} bit`, tone: "info" },
    { label: "公开泄露 λ", value: b.leak, text: `− ${num(b.leak)} bit` },
    { label: "其他公开信息", value: b.other, text: `− ${num(b.other)} bit` },
    { label: "隐私放大余量", value: b.pa, text: `− ${num(b.pa)} bit` },
    { label: "认证预共享", value: b.auth, text: `− ${num(b.auth)} bit` },
    { label: "建议提取长度", value: b.safe, text: `${num(b.safe)} bit`, tone: "ok" },
  ]) + `<p class="card-subnote">第一行为假设输入；扣除项来自协议参数。这张图表示账目关系，不是统计分布。</p>`)}

  ${card("关键发现", findings.map((f) => `<p style="margin:0 0 14px"><b style="color:var(--blue);font-weight:600;display:block;margin-bottom:3px">${f.h}</b>${f.t}</p>`).join(""))}

  ${card("评估项", `<table class="data"><thead><tr><th>评估项</th><th>结果</th><th class="num">状态</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td></tr>`).join("")}</tbody></table>
  <details><summary>评估依据与边界</summary>
    <p>结论分模拟域与数字域分别给出，不支持合并为单一安全等级。熵与协议参数为假设输入；随机性检验与 KDR 只排除统计异常，不能证明密钥对 Eve 保密。</p>
    <p>要给出「保密强度 ≥ X bit」，仍缺：① 隐私放大前的量化比特（决定 H_min(K|E)）；② 满足 ρ(L) ≤ 0.2 且块数 ≥ 30 的采集；③ Eve 侧信息量的上界。</p>
  </details>`)}

  ${card("报告与历史", `<div class="btn-row no-print">
      <button class="btn primary" data-act="export">导出 JSON</button>
      <button class="btn" data-act="print">打印 / 另存 PDF</button>
      <button class="btn ghost" data-act="save-history">存入历史</button>
    </div>
    <div class="divider"></div>
    ${state.history.length ? `<table class="data"><thead><tr><th>时间</th><th>场景</th><th class="num">块长</th><th class="num">密钥</th><th>模拟域</th><th>数字域</th></tr></thead>
      <tbody>${state.history.map((h) => `<tr><td>${esc(h.at)}</td><td class="meta">${esc(h.scene)}</td><td class="num">${h.L}s</td><td class="num">${num(h.bits)}</td>
        <td>${h.analog ? tag(h.analog.short, h.analog.tone) : "—"}</td><td>${h.digital ? tag(h.digital.short, h.digital.tone) : "—"}</td></tr>`).join("")}</tbody></table>`
      : `<p class="meta">还没有历史记录。</p>`}`)}
  `;
}

/* ============================================================
   14. 壳与渲染
   ============================================================ */

function topbar() {
  const p = premise();
  const d = hasKeys() ? digital() : null;
  return `<header class="topbar">
    <div class="brand">${ico("tower", 20)}物理层密钥安全评估</div>
    <div class="top-meta">
      <span>项目：城市无线测评</span><span class="sep">｜</span>
      ${state.synthetic ? `<span class="badge synth">合成演示数据</span>` : ""}
      <span class="badge ${p.tone === "bad" ? "bad" : ""}">${esc(state.attack)} · 信道${esc(state.channel)}</span>
      ${d ? `<span class="badge">${num(d.nBits)} bit</span>` : ""}
    </div>
  </header>`;
}

function nav() {
  return `<nav class="nav" aria-label="主导航">${TABS.map((t) => `<button data-tab="${t.id}" ${state.tab === t.id ? 'aria-current="page"' : ""}>${t.name}</button>`).join("")}</nav>`;
}

function footer() {
  return `<footer><span>${hasAny() ? (state.synthetic ? "合成演示数据 · 结果仅用于展示流程" : "真实采集数据 · 分析结果随参数实时计算") : "未导入数据"}</span><span>指纹 #${fingerprint()} · 物理层密钥安全评估</span></footer>`;
}

function pageBody() {
  if (state.tab === "home") return pageHome();
  if (state.tab === "input") return pageInput();
  if (state.tab === "results") return pageResults();
  if (state.tab === "report") return pageReport();
  return pageHome();
}

function render() {
  document.getElementById("app").innerHTML = `<div class="sheet">${topbar()}${nav()}<main>${pageBody()}</main>${footer()}</div>`;
  typeset();
  if (state.toast) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = state.toast;
    document.body.appendChild(t);
    state.toast = "";
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
}

function toast(msg) { state.toast = msg; render(); }

function fingerprint() {
  const parts = SLOTS.map((s) => {
    const v = state.slots[s.id];
    return v && v.ok ? `${s.id}:${v.name}:${v.size || 0}` : `${s.id}:-`;
  }).join("|");
  let h = 0;
  for (let i = 0; i < parts.length; i++) h = (Math.imul(h, 31) + parts.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/* ============================================================
   15. 交互
   ============================================================ */

document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el.dataset) return;
  if (el.dataset.field) {
    const k = el.dataset.field;
    if (el.type === "checkbox") state[k] = el.checked;
    else if (el.type === "number") {
      const v = Number(el.value);
      state[k] = Number.isFinite(v) ? v : 0;
    } else state[k] = el.value;
    render();
    return;
  }
  if (el.dataset.act === "ris") { state.risOn = el.checked; render(); return; }
  if (el.dataset.act === "jam") { state.jamOn = el.checked; render(); return; }
});

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act],[data-tab],[data-jump]");
  if (!el) return;
  const act = el.dataset.act;

  if (el.dataset.tab) { state.tab = el.dataset.tab; render(); return; }
  if (el.dataset.jump) { state.tab = el.dataset.jump; render(); return; }

  if (act === "seg") { state.seg = el.dataset.seg; render(); return; }
  if (act === "set-L") { state.L = Number(el.dataset.l) || state.L; render(); return; }
  if (act === "play") { state.playing = !state.playing; render(); return; }
  if (act === "check") { state.checkOpen = state.checkOpen === el.dataset.check ? null : el.dataset.check; render(); return; }
  if (act === "nist") { state.nistOpen = state.nistOpen === el.dataset.id ? null : el.dataset.id; render(); return; }
  if (act === "clear") {
    state.slots = {}; state.synthetic = false; invalidate(); render(); return;
  }
  if (act === "load-sample") { await loadSample(); render(); return; }
  if (act === "load-synth") { loadSynth(); render(); return; }
  if (act === "pick-dir") { pickDir(); return; }
  if (act === "pick") { pickFiles(el.dataset.slot); return; }
  if (act === "export") { exportJson(); return; }
  if (act === "print") { window.print(); return; }
  if (act === "save-history") {
    const ac = analogConclusion();
    const dc = digitalConclusion();
    state.history.unshift({
      at: new Date().toLocaleTimeString("zh-CN"),
      scene: `${state.env}/${state.motion}/RIS ${state.ris}`,
      L: state.L,
      bits: hasKeys() ? digital().nBits : 0,
      analog: ac ? { label: ac.label, short: ac.short, tone: ac.tone } : null,
      digital: dc ? { label: dc.label, short: dc.short, tone: dc.tone } : null,
    });
    state.history = state.history.slice(0, 8);
    render();
    return;
  }
});

function pickFiles(slotId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,.txt";
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    state.slots[slotId] = await loadSlot(slotId, f);
    invalidate();
    render();
  });
  input.click();
}

function pickDir() {
  const input = document.createElement("input");
  input.type = "file";
  input.webkitdirectory = true;
  input.multiple = true;
  input.addEventListener("change", async () => {
    const files = [...input.files];
    if (!files.length) return;
    await importFiles(files);
    render();
  });
  input.click();
}

function budget() {
  const n = Math.max(1, Math.round(Number(state.pN) || 0));
  const rate = Math.min(0.99, Math.max(0.05, Number(state.pRate) || 0.75));
  const leak = state.pLeakMode === "rate"
    ? Math.round(n * (1 - rate))
    : Math.round(Number(state.pActualPublic) || 0);
  const other = Math.round(Number(state.pOther) || 0);
  const pa = Math.round(Number(state.pPa) || 0);
  const auth = Math.round(Number(state.pAuthBits) || 0);
  const hmin = Math.round(Number(state.pHmin) || 0);
  const spent = leak + other + pa + auth;
  const raw = hmin - spent;
  return { n, rate, leak, other, pa, auth, hmin, spent, raw, safe: Math.max(0, raw) };
}

function exportJson() {
  const p = premise();
  const ac = analogConclusion();
  const dc = digitalConclusion();
  const s = session();
  const u = hasAnalog() ? estimateUL(state.L) : null;
  const d = hasKeys() ? digital() : null;
  const t = nist();
  const b = budget();
  const conclusionOf = (c) => (c ? {
    label: c.label, statement: c.text, note: c.note,
    metrics: c.rows.map((r) => ({ name: r.k, value: r.v, rule: r.rule, verdict: r.verdict })),
  } : null);
  const payload = {
    generatedAt: new Date().toISOString(),
    scope: {
      env: state.env, motion: state.motion, ris: state.ris, attack: state.attack, channel: state.channel,
      feature: state.feature, csiUse: state.csiUse,
      eve: { channelObservation: state.eveObs, quantizationRule: state.eveQuant, otherSideInfo: state.eveOther },
    },
    premise: { label: p.label, note: p.note },
    conclusions: { analog: conclusionOf(ac), digital: conclusionOf(dc) },
    alignment: s.align ? { commonSeconds: s.align.common.length, ratio: s.align.ratio, spanSeconds: s.align.span, gap: s.align.gap } : null,
    analog: u ? {
      blockSeconds: u.L, blocks: u.n, estimator: "E2 块均值 + 偏相关",
      conditionalMI_bitsPerSecond: u.base.U, conditionalMI_ci90: u.ciU,
      mutualInfoDifference_bitsPerSecond: u.base.D, mutualInfoDifference_raw: u.base.raw,
      partialCorrelation: u.base.pxy,
    } : null,
    digital: d ? {
      bits: d.nBits, lines: d.lines, width: d.width, identicalLegalEnds: d.same, kdr: d.kdr, biasP1: d.p1,
      groups: Object.fromEntries(BS.map((bb) => [bb, { groups: d.groups[bb].nb, states: d.groups[bb].states, ratio: d.groups[bb].ratio, hmin: d.groups[bb].hmin }])),
      note: "密钥为隐私放大输出，条件最小熵不可估计",
    } : null,
    randomTests: t ? { n: t.n, passed: t.passed, judged: t.judged.length, rows: t.rows.map((r) => ({ name: r.name, p: r.p, verdict: r.note })) } : null,
    budget: {
      assumed: true, rawBits: b.n, codeRate: b.rate, publicLeakBits: b.leak, otherPublicBits: b.other,
      paMarginBits: b.pa, authBits: b.auth, assumedHminBits: b.hmin, safeLengthBits: b.safe,
      actualBits: d ? d.nBits : null, feasible: d ? b.raw >= 0 && d.nBits <= b.safe : null,
    },
    synthetic: state.synthetic,
    safetyLengthLowerBound: null,
    warnings: [
      "结论分模拟域与数字域分别给出，不支持合并为单一安全等级",
      "熵与协议参数为假设输入，不是实测值",
      "模拟域结论依赖联合高斯、块均值、块间独立三项假设",
      "随机性检验与 KDR 只排除统计异常，不能证明密钥对 Eve 保密",
      "缺少隐私放大前基线，无法估计条件最小熵 H_min(K|E)",
    ],
    fingerprint: fingerprint(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `key-security-${fingerprint()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ============================================================
   16. 启动
   ============================================================ */

(function boot() {
  const params = new URLSearchParams(location.search);
  const t = params.get("tab") || params.get("page");
  const map = {
    home: "home", scene: "input", import: "input", input: "input",
    analog: "results", digital: "results", recon: "results", results: "results", tests: "results",
    report: "report",
  };
  if (t && map[t]) state.tab = map[t];
  if (t === "analog") state.seg = "analog";
  if (t === "digital" || t === "tests") state.seg = "digital";
  if (t === "recon" || t === "fit") state.seg = "final";
  if (t === "fit") state.tab = "input";
  const sg = params.get("seg");
  if (sg === "analog" || sg === "digital" || sg === "final") state.seg = sg;
  const lq = Number(params.get("L"));
  if (Number.isFinite(lq) && lq > 0) state.L = lq;
  if (params.get("synth") === "1") {
    loadSynth();
  } else if (params.get("demo") === "1") {
    loadSample().then(() => render()).catch(() => render());
  } else {
    render();
    probeSample();
  }
})();
