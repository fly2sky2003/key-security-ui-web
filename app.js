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
      if (state.sampleAvailable === false && state.page === "import") render();
    });
}

async function loadSample() {
  if (state.sampleAvailable === false) {
    state.page = "import";
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
    state.page = "import";
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
    text = `在联合高斯 + 块均值 + 块间独立三项假设下，该信道可支撑的密钥率上限 U_L = ${fx(u.base.U, 3)} bit/s`
      + `（90% CI ${u.ciU ? `${fx(u.ciU.lo, 3)}–${fx(u.ciU.hi, 3)}` : "—"}），`
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
   8. 通用视图件
   ============================================================ */

function card(title, body, right) {
  return `<article class="card">
    <div class="card-head"><h3>${title}</h3>${right ? `<div class="chips">${right}</div>` : ""}</div>
    ${body}
  </article>`;
}
function readLine(title, value, tone) {
  return `<div class="read"><span>${title}</span><b class="${tone || ""}">${value}</b></div>`;
}
function fig(label, value, note, tone) {
  return `<div class="fig"><span>${label}</span><b class="${tone || ""}">${value}</b>${note ? `<em>${note}</em>` : ""}</div>`;
}
function checkTable(items) {
  const body = items.map((it) => {
    const on = state.checkOpen === it.id;
    const row = `<tr class="check-tr ${on ? "open" : ""}" data-act="check" data-check="${it.id}">
      <td class="c-idx">${it.idx}</td>
      <td class="c-name">${it.name}</td>
      <td class="c-rule">${it.rule}</td>
      <td class="c-actual">${it.actual}</td>
      <td class="c-state">${chip(it.verdict, it.tone)}</td>
    </tr>`;
    if (!on) return row;
    return row + `<tr class="check-note"><td colspan="5"><div class="check-pop">
      <div class="check-pop-head"><strong>${it.name}</strong></div>
      ${it.formula ? `<div class="formula">${tex(it.formula, true)}</div>` : ""}
      <p>${it.explain}</p>
    </div></td></tr>`;
  }).join("");
  return `<table class="compact checks-table">
    <thead><tr><th></th><th>检查项</th><th>判据</th><th>实测</th><th class="c-state">判定</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}
function meter(v, tone) {
  return `<div class="meter"><i class="${tone || ""}" style="width:${Math.max(0, Math.min(1, v)) * 100}%"></i></div>`;
}
function lineChart(series, opts) {
  const o = opts || {};
  const w = o.w || 660, h = o.h || 210;
  const pad = { l: o.yLabel ? 64 : 44, r: 16, t: 14, b: o.xLabel ? 46 : 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const yMin = o.yMin == null ? -0.2 : o.yMin;
  const yMax = o.yMax == null ? 1 : o.yMax;
  const xs = series[0].xs;
  const xAt = (i) => pad.l + (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * iw);
  const yAt = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const grid = (o.gridVals || [0, 0.2, 0.5, 1]).map((v) => {
    const dash = Math.abs(v - (o.markY == null ? 0.2 : o.markY)) < 1e-9;
    return `<line x1="${pad.l}" y1="${yAt(v)}" x2="${w - pad.r}" y2="${yAt(v)}" stroke="${dash ? "#c99a2e" : "#e6edf5"}" ${dash ? 'stroke-dasharray="4 3"' : ""}/>
      <text x="${pad.l - 8}" y="${yAt(v) + 4}" text-anchor="end" font-size="12" fill="${dash ? "#8d5b00" : "#6b7280"}">${v.toFixed(1)}</text>`;
  }).join("");
  const tickY = o.xLabel ? h - 26 : h - 8;
  const labels = xs.map((v, i) => `<text x="${xAt(i)}" y="${tickY}" text-anchor="middle" font-size="12" fill="#6b7280">${esc(v)}</text>`).join("");
  const xTitle = o.xLabel
    ? `<text x="${pad.l + iw / 2}" y="${h - 6}" text-anchor="middle" font-size="13" fill="#4b5563">${esc(o.xLabel)}</text>`
    : "";
  const yTitle = o.yLabel
    ? `<text x="16" y="${pad.t + ih / 2}" text-anchor="middle" font-size="13" fill="#4b5563" transform="rotate(-90 16 ${pad.t + ih / 2})">${esc(o.yLabel)}</text>`
    : "";
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
  const aria = esc(o.label || "折线图");
  if (!o.interactive) {
    return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${aria}">${grid}${labels}${xTitle}${yTitle}${paths}</svg>${legend}</div>`;
  }
  const meta = {
    w, h, pad, xs, yMin, yMax,
    series: series.map((s) => ({ name: s.name, color: s.color, ys: s.ys })),
  };
  const hv = `<g class="hv" style="opacity:0">
      <line class="hv-line" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" stroke="#94a3b8" stroke-dasharray="3 3"/>
      ${series.map((s, k) => `<circle class="hv-dot" data-k="${k}" r="4.5" fill="${s.color}" stroke="#fff" stroke-width="2"/>`).join("")}
    </g>`;
  return `<div class="chart-wrap chart-interactive">
    <svg class="chart" viewBox="0 0 ${w} ${h}" data-meta="${esc(JSON.stringify(meta))}" role="img" aria-label="${aria}">${grid}${labels}${xTitle}${yTitle}${paths}${hv}</svg>
    <div class="chart-tip" hidden></div>
    ${legend}
  </div>`;
}

function scatterChart(xs, ys, color, xName, yName) {
  const w = 320, h = 250;
  const pad = { l: 40, r: 12, t: 12, b: 36 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const zx = zscore(xs), zy = zscore(ys);
  const xAt = (v) => pad.l + ((Math.max(-3, Math.min(3, v)) + 3) / 6) * iw;
  const yAt = (v) => pad.t + (1 - (Math.max(-3, Math.min(3, v)) + 3) / 6) * ih;
  const dots = [];
  for (let i = 0; i < zx.length; i++) {
    dots.push(`<circle cx="${xAt(zx[i]).toFixed(1)}" cy="${yAt(zy[i]).toFixed(1)}" r="2" fill="${color}" opacity="0.4"/>`);
  }
  const axis = `<line x1="${pad.l}" y1="${yAt(0)}" x2="${w - pad.r}" y2="${yAt(0)}" stroke="#e6edf5"/>
    <line x1="${xAt(0)}" y1="${pad.t}" x2="${xAt(0)}" y2="${h - pad.b}" stroke="#e6edf5"/>
    <text x="${(pad.l + w - pad.r) / 2}" y="${h - 6}" text-anchor="middle" font-size="12" fill="#334155">${esc(xName)}</text>
    <text x="12" y="${(pad.t + h - pad.b) / 2}" text-anchor="middle" font-size="12" fill="#334155" transform="rotate(-90 12 ${(pad.t + h - pad.b) / 2})">${esc(yName)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="散点">${axis}${dots.join("")}</svg>`;
}
function zscore(a) {
  const m = mean(a);
  const s = sd(a) || 1;
  return a.map((v) => (v - m) / s);
}

/* ============================================================
   9. 页面：场景与模型
   ============================================================ */

function fieldSelect(label, key, opts) {
  return `<label class="field"><span>${label}</span>
    <select data-field="${key}">${opts.map((o) => `<option value="${esc(o)}" ${state[key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
  </label>`;
}

function pageScene() {
  const p = premise();
  return `
  ${premiseBlock(p)}
  ${card("评估范围", `<div class="grid-3 form-grid">
    ${fieldSelect("环境", "env", ["室内", "室外", "车载"])}
    ${fieldSelect("移动状态", "motion", ["静止", "低速", "高速"])}
    ${fieldSelect("可重构智能表面（RIS）", "ris", ["无", "有"])}
    ${fieldSelect("攻击模型", "attack", ["被动窃听", "主动攻击"])}
    ${fieldSelect("协商信道", "channel", ["已认证", "未认证"])}
    <label class="field"><span>特征</span>
      <div class="field-pair">
        <select data-field="feature">${["CSI", "RSSI"].map((o) => `<option value="${o}" ${state.feature === o ? "selected" : ""}>${o}</option>`).join("")}</select>
        ${state.feature === "CSI" ? `<select data-field="csiUse">${["幅度", "相位", "复数值"].map((o) => `<option value="${o}" ${state.csiUse === o ? "selected" : ""}>${o}</option>`).join("")}</select>` : ""}
      </div>
    </label>
  </div>`)}

  ${card("Eve 能力", `<div class="checkline-row">
    <div class="checkline"><input type="checkbox" data-field="eveObs" ${state.eveObs ? "checked" : ""}/> 掌握信道观测</div>
    <div class="checkline"><input type="checkbox" data-field="eveQuant" ${state.eveQuant ? "checked" : ""}/> 知道公开量化规则</div>
    <div class="checkline"><input type="checkbox" data-field="eveOther" ${state.eveOther ? "checked" : ""}/> 掌握其他侧信息</div>
  </div>`)}

  <div class="note-block danger page-note">
    <h4>能力边界</h4>
    <ul>
      <li>第一版只覆盖<strong>被动窃听 + 已认证公开信道</strong>。改动上面两项会立即把两个域的结论降为「前提不成立」。</li>
      <li>「室内」「有 RIS」这类标签只用于记录场景；<strong>是否启用某个安全公式，由攻击能力、统计假设、协议条件决定</strong>，不由标签决定。</li>
      <li>结论<strong>分模拟域与数字域各自给出</strong>：模拟域回答「信道里有多少可用的秘密信息」，数字域回答「提取出的密钥是否合格」。两者都不足以单独证明保密强度，因此本工作台<strong>不给出合并的安全等级</strong>。</li>
    </ul>
  </div>
  `;
}

function premiseBlock(p) {
  return `<div class="grade ${p.tone}">
    <div class="g-label">评估前提</div>
    <div class="g-value">${esc(p.label)}</div>
    <p class="g-note">${esc(p.note)}</p>
  </div>`;
}

/* 安全性结论：判定 → 定量依据表 → 边界 / 缺口 */
function secConclusion(c, sub) {
  const body = c.rows.map((r) => `<tr>
      <td class="sc-k">${esc(r.k)}</td>
      <td class="num sc-v">${r.v}</td>
      <td class="sc-rule">${esc(r.rule)}</td>
      <td class="sc-v">${chip(r.verdict, r.tone)}</td>
    </tr>`).join("");
  return `<div class="concl ${c.tone}">
      <div class="concl-head">
        <span class="concl-tag">${esc(c.label)}</span>
        <span class="concl-sub">${esc(sub)}</span>
      </div>
      <p class="concl-text">${esc(c.text)}</p>
    </div>
    <table class="compact concl-table">
      <thead><tr><th>安全指标</th><th class="num">实测</th><th>判据</th><th class="sc-v">判定</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${c.note ? `<p class="concl-note">${esc(c.note)}</p>` : ""}`;
}

/* ============================================================
   10. 页面：数据导入
   ============================================================ */

function slotCard(slot) {
  const v = state.slots[slot.id];
  const ok = Boolean(v && v.ok);
  let detail = "等待载入";
  if (ok && slot.kind === "csi") detail = `${num(v.rows)} 行 · ${v.secs.length} 秒`;
  if (ok && slot.kind === "key") detail = `${num(v.lines.length)} 行 · ${num(v.bits)} bit`;
  if (v && !v.ok) detail = v.error || "解析失败";
  return `<div class="slot" data-party="${slot.party}" data-ok="${ok ? 1 : 0}">
    <div class="slot-top">
      <div class="slot-name">${slot.title}</div>
      <span class="slot-tag">${slot.hint}</span>
    </div>
    <div class="slot-file">${ok ? esc(v.name) : "未载入"}</div>
    <div class="slot-meta">${esc(detail)}</div>
    <div class="slot-foot">
      ${ok ? `<span class="slot-ok">✓ 已解析</span>` : `<span></span>`}
      <button class="btn ghost slot-btn" data-act="pick" data-slot="${slot.id}">${ok ? "替换" : "选择文件"}</button>
    </div>
  </div>`;
}

function pageImport() {
  const s = session();
  const A = s.align;
  const d = hasKeys() ? digital() : null;
  const summary = [];
  if (A) {
    summary.push(fig("三方重叠时长", `${A.common.length} <small>秒</small>`, `占采集时长 ${pct(A.ratio)}`, A.ratio >= 0.5 ? "ok" : "warn"));
    summary.push(fig("采集时长", `${A.span} <small>秒</small>`, `其中 ${pct(A.gap)} 无同时数据`, "mute"));
  } else {
    summary.push(fig("三方重叠时长", "—", "至少需要两方信道数据", "mute"));
  }
  if (d) {
    summary.push(fig("密钥长度", `${num(d.nBits)} <small>bit</small>`, `${num(d.lines)} 行 × ${d.width} bit`, "mute"));
    summary.push(fig("双方密钥", d.same ? "完全一致" : `${num(d.diff)} bit 不同`, d.same ? "隐私放大输出" : "流程异常", d.same ? "ok" : "bad"));
  } else {
    summary.push(fig("密钥长度", "—", "未载入", "mute"));
  }

  return `
  <div class="page-head">
    <p class="kicker">${kicker("import")}</p>
    <h2>三方数据</h2>
  </div>
  ${card("数据来源", `<div class="btn-row">
    <button class="btn primary" data-act="pick-dir">选择会话文件夹</button>
    ${state.sampleAvailable === false ? "" : `<button class="btn" data-act="load-sample">载入真实示例</button>`}
    <button class="btn" data-act="load-synth">载入合成演示</button>
    <button class="btn ghost" data-act="clear">清空</button>
  </div>
  ${state.sampleAvailable === false
    ? `<p class="card-subnote">本站是公开演示版，<strong>未附带实测采集数据</strong>。可以直接点「载入合成演示」体验完整流程，也可以上传自己的三方 CSV / TXT（文件名含 UE / PUSCH / EVE 即可自动归位）。</p>`
    : ""}`)}

  <div class="grid-3">
    ${["ue", "nb", "eve"].map((p) => {
      const csi = SLOTS.find((x) => x.party === p && x.kind === "csi");
      const key = SLOTS.find((x) => x.party === p && x.kind === "key");
      return `<div>${slotCard(csi)}<div style="height:10px"></div>${slotCard(key)}</div>`;
    }).join("")}
  </div>

  ${card("会话摘要", `<div class="figures">${summary.join("")}</div>`)}

  ${hasAny() ? fitSection() : ""}
  `;
}

/* ============================================================
   11. 适用性检查（并入数据导入页）
   ============================================================ */

function fitSection() {
  return `
  <div class="sec-head" id="fit-section">
    <h2>适用性检查</h2>
    <span class="fit-hint">两域各自独立判定</span>
  </div>
  ${analogFit()}
  ${digitalFit()}
  `;
}

function analogFit() {
  if (!hasAnalog()) {
    return card("模拟域检查", `<div class="empty"><h3>还缺信道数据</h3>
      <p>至少需要 UE 与基站两方 CSV 才能做模拟域检查。</p></div>`, chip("待导入", "warn"));
  }
  const s = session();
  const A = s.align;
  const st = stationarity(A.series.ue);
  const blocks = blockCandidates();
  const rec = recommendedBlock();
  const recL = rec ? rec.L : null;
  const probeL = recL || 4;
  const rhoProbe = acfAt(A.common, A.series.ue, probeL);
  const cover = rhoProbe == null ? "样本不足" : rhoProbe <= 0.2 ? "较完整" : rhoProbe <= 0.4 ? "部分" : "不足";

  const items = [
    {
      id: "integrity", idx: 1, name: "数据完整性",
      rule: "缺口 < 10%",
      actual: pct(A.gap),
      verdict: A.gap < 0.1 ? "通过" : A.gap < 0.25 ? "可接受" : "缺口偏大",
      tone: A.gap < 0.1 ? "ok" : "warn",
      formula: "\\text{gap}=1-\\frac{|\\mathcal{T}_{\\text{common}}|}{\\max\\mathcal{T}-\\min\\mathcal{T}+1}",
      explain: "整段采集时间里，有多少整秒是三方都同时采到数据的。缺口来自丢包、采集启停不同步或设备离线；缺口越大，按块切分时出现的空块越多，后续统计的有效样本就越少。",
    },
    {
      id: "align", idx: 2, name: "时间对齐",
      rule: "重叠比例 ≥ 50%",
      actual: pct(A.ratio),
      verdict: A.ratio >= 0.5 ? "通过" : A.ratio >= 0.1 ? "部分对齐" : "无法对齐",
      tone: A.ratio >= 0.5 ? "ok" : A.ratio >= 0.1 ? "warn" : "bad",
      formula: "\\rho_{\\text{align}}=\\frac{|\\mathcal{T}_{\\text{common}}|}{\\min_i|\\mathcal{T}_i|}",
      explain: "分母取三方中记录最少的一方，避免比例被最长的那一路稀释。低于 50% 说明三方几乎没有共同时段，模拟域的任何统计都失去意义；低于 10% 直接拒绝分析。",
    },
    {
      id: "acf", idx: 3, name: "时间相关性",
      rule: `${tex(`\\rho(${probeL}\\,\\mathrm{s})\\le 0.2`)}`,
      actual: fx(rhoProbe, 3),
      verdict: cover === "较完整" ? "通过" : cover === "部分" ? "部分" : "不足",
      tone: cover === "较完整" ? "ok" : "warn",
      formula: "\\rho(\\tau)=\\frac{\\sum_t (x_t-\\bar x)(x_{t+\\tau}-\\bar x)}{\\sum_t (x_t-\\bar x)^2}",
      explain: `块长 ${tex("L")} 秒意味着把连续 ${tex("L")} 秒当作一次独立观测。${tex("\\rho(\\tau)")} 衡量相隔 ${tex("\\tau")} 秒的两个样本还残留多少线性相关；若 ${tex("\\rho(L)")} 仍显著大于 0，块与块之间就没有真正独立。分档：${tex("\\le 0.2")} 依赖较完整，${tex("\\le 0.4")} 部分覆盖，${tex(">0.4")} 不足。自相关低只是必要诊断，<strong>不能证明独立</strong>。`,
    },
    {
      id: "station", idx: 4, name: "平稳性",
      rule: `${tex("\\Delta_\\mu<1\\sigma")} 且 ${tex("F<2")}`,
      actual: st ? `${fx(st.dMu, 2)}σ / ${fx(st.F, 2)}` : "—",
      verdict: st ? st.level : "无法判断",
      tone: st ? st.tone : "warn",
      formula: "\\Delta_\\mu=\\frac{\\max_k \\mu_k-\\min_k \\mu_k}{\\sigma_{\\text{pool}}},\\qquad F=\\frac{\\max_k \\sigma_k^{2}}{\\min_k \\sigma_k^{2}}",
      explain: `把序列等分成四段，逐段算均值 ${tex("\\mu_k")} 与标准差 ${tex("\\sigma_k")}。${tex("\\Delta_\\mu")} 用池化标准差归一化，衡量整体均值是否漂移；${tex("F")} 是各段方差的比值，衡量波动是否一致。CSI 幅度的慢漂移（AGC 调整、路径损耗变化、终端位移）会同时推高这两个量，使不同时段的块均值不再代表同一个统计分布。`,
    },
    {
      id: "nblk", idx: 5, name: "样本充分性",
      rule: `${tex("n_{\\text{blk}}\\ge 30")}`,
      actual: `${blocks[0].n} 块`,
      verdict: blocks[0].n >= MIN_BLOCKS ? "通过" : "不足",
      tone: blocks[0].n >= MIN_BLOCKS ? "ok" : "bad",
      formula: "n_{\\text{blk}}=\\left\\lfloor\\frac{T}{L}\\right\\rfloor\\ \\ge\\ 30",
      explain: `三个变量的相关系数估计，经验上需要至少 30 个独立样本才能把置信区间压到可用宽度。块数由采集时长 ${tex("T")} 与块长 ${tex("L")} 决定，${tex("L")} 越大块数越少。块数不足时宁可显示“不给数值”，也不给一个看似精确的结果。`,
    },
    {
      id: "cost", idx: 6, name: "计算可行性",
      rule: "闭式解，无需迭代",
      actual: "3 变量",
      verdict: "可计算",
      tone: "ok",
      formula: "I(X;Y\\mid Z)=-\\tfrac{1}{2}\\ln\\!\\left(1-\\rho_{xy|z}^{2}\\right)",
      explain: `在联合高斯假设下，条件互信息 ${tex("I(X;Y\\mid Z)")} 有闭式解，不需要迭代拟合或高维分箱，内存与耗时都可预测。代价是“块均值”会丢掉块内结构，方向上<strong>低估</strong>信息量。`,
    },
  ];

  const verdict = recL
    ? `<div class="verdict">
        <div><b>建议块长：${recL} 秒</b></div>
        <div><b>选择依据：</b>主要时间依赖得到覆盖（ρ(${recL}s)=${fx(rhoProbe, 3)}），样本支撑 ${blocks.find((b) => b.L === recL).n} 块，计算成本${blocks.find((b) => b.L === recL).cost}。</div>
        <div><b>残余问题：</b>跨块依赖仍需纳入所用模型；平稳性判定为「${st ? st.level : "未知"}」。</div>
      </div>`
    : `<div class="verdict bad">
        <div><b>当前数据无法支持可靠的高维直接估计。</b></div>
        <div>建议增加独立采集批次，或选择并验证具有时间依赖的参数模型。</div>
      </div>`;

  return card("模拟域检查", `${checkTable(items)}${verdict}`,
    `<span class="fit-hint">点击行查看公式与释义</span>${chip(`${A.present.length} 方`, "info")}`);
}

function digitalFit() {
  if (!hasKeys()) {
    return card("数字域检查", `<div class="empty"><h3>还缺密钥文件</h3>
      <p>载入 TXT 密钥后自动校验。</p></div>`, chip("待导入", "warn"));
  }
  const d = digital();
  const g8 = d.groups[8];

  const items = [
    {
      id: "kload", idx: 1, name: "密钥装载",
      rule: "十六进制 · 偶长度",
      actual: `${num(d.lines)} 行 × ${d.width}`,
      verdict: "通过", tone: "ok",
      formula: "N_{\\text{bit}}=\\sum_i 4\\,\\ell_i",
      explain: `每两个十六进制字符是一个字节，每个字符 ${tex("4")} bit。行只是存储切分，<strong>没有对齐语义</strong> —— 密钥是隐私放大输出，行号不承载时间信息。`,
    },
    {
      id: "keq", idx: 2, name: "双方密钥一致",
      rule: `${tex("\\mathrm{KDR}=0")}`,
      actual: d.same ? "0 bit" : `${num(d.diff)} bit`,
      verdict: d.same ? "通过" : "硬失败",
      tone: d.same ? "ok" : "bad",
      formula: "\\mathrm{KDR}=\\frac{1}{N}\\sum_{j=1}^{N}\\left(k_j^{A}\\oplus k_j^{B}\\right)=0",
      explain: `${tex("\\mathrm{KDR}")} 是两串密钥逐位异或后 1 的占比。隐私放大后两端必须逐位相同，任何非零差异都说明信息调和失败或隐私放大实现有问题，属于不能容忍的硬失败，而不是可以放行的误差。`,
    },
    {
      id: "ksrc", idx: 3, name: "来源判定",
      rule: "逐字节相同",
      actual: d.same ? "一致" : "不一致",
      verdict: "已确认", tone: "ok",
      formula: "K^{A}=K^{B}",
      explain: `密钥生成分三步：先把信道特征量化成 0/1 比特；再用公开信息纠错，让两端比特完全一致（这一步叫信息调和）；最后把一致的长比特压缩成更短的一段，并使窃听者无法从公开信息反推出结果（这一步叫隐私放大）。两端完全一致只能说明三步都走完了，<strong>不能说明密钥有多安全</strong>。`,
    },
    {
      id: "kstat", idx: 4, name: "统计识别性",
      rule: `${tex("N_b/2^{b}\\ge 10")}`,
      actual: `${fx(g8.ratio, 1)}（b=8）`,
      verdict: g8.marginalOk ? "充分" : "不足",
      tone: g8.marginalOk ? "ok" : "warn",
      formula: "\\frac{N_b}{2^{b}}\\ \\ge\\ 10,\\qquad N_b=\\left\\lfloor\\frac{N_{\\text{bit}}}{b}\\right\\rfloor",
      explain: `把比特按 ${tex("b")} 位分组后有 ${tex("2^b")} 个可能取值，要估计每个取值的概率，每个格子平均至少要有 10 个样本。低于这个数，直方图基本是空的，最大频次被严重低估，最小熵反而会算得偏高。`,
    },
    {
      id: "kcond", idx: 5, name: "条件识别性",
      rule: `${tex("N_b/2^{2b}\\ge 5")}`,
      actual: "需放大前数据",
      verdict: "不适用", tone: "warn",
      formula: "\\frac{N_b}{2^{2b}}\\ \\ge\\ 5",
      explain: `要算 Eve 已知时的条件最小熵，需要 ${tex("(K,E)")} 的联合分布，状态空间是 ${tex("2^{2b}")}：${tex("b=8")} 时就有 65,536 个格子，每格平均要有 5 个样本才能估计 ${tex("P(k\\mid e)")}。密钥经过隐私放大后联合分布本身已不可得，所以这一项是「不适用」而不是「样本不足」。`,
    },
    {
      id: "knist", idx: 6, name: "随机性测试",
      rule: `${tex("n\\ge 10^{6}")}`,
      actual: `${num(d.nBits)} bit`,
      verdict: "部分可跑", tone: "warn",
      formula: "n\\ \\ge\\ 10^{6}\\ \\Rightarrow\\ \\text{full suite}",
      explain: `模板匹配、Maurer 通用统计、线性复杂度等检验项对样本长度有硬要求：需要 ${tex("10^6")} bit 量级。长度不足时显示“样本不足”，<strong>不记作通过</strong> —— 这是 NIST SP 800-22 的要求，不是本工具的保守设定。`,
    },
  ];

  return card("数字域检查", `${checkTable(items)}
    <div class="verdict warn">
      <div><b>数字域定位：质量验证。</b></div>
      <div>密钥已是隐私放大输出，条件最小熵无法估计。本域只回答「隐私放大做得对不对」，不回答「能提多少密钥」。</div>
    </div>`,
    `<span class="fit-hint">点击行查看公式与释义</span>${chip("放大后", "warn")}`);
}

/* ============================================================
   12. 页面：模拟域分析
   ============================================================ */

function pageAnalog() {
  if (!hasAnalog()) {
    return `<div class="page-head"><p class="kicker">${kicker("analog")}</p><h2>信道信息量</h2></div>
      ${card("", `<div class="empty"><h3>还缺信道数据</h3>
      <p><button class="btn primary" data-act="goto" data-page="import">前往导入</button></p></div>`)}`;
  }
  const s = session();
  const A = s.align;
  const st = stationarity(A.series.ue);

  const acfVals = {};
  A.present.forEach((p) => { acfVals[p] = LAGS.map((L) => acfAt(A.common, A.series[p], L)); });
  const decorr = {};
  A.present.forEach((p) => {
    const i = acfVals[p].findIndex((r) => r != null && r <= 0.2);
    decorr[p] = i >= 0 ? LAGS[i] : null;
  });

  const acfSeries = A.present.map((p) => ({
    name: PARTY_LABEL[p],
    color: PARTY_COLOR[p],
    xs: LAGS,
    ys: acfVals[p],
  }));


  const pairs = [["ue", "nb"], ["ue", "eve"], ["nb", "eve"]]
    .filter(([a, b]) => A.series[a] && A.series[b])
    .map(([a, b]) => ({
      a, b,
      legal: a === "ue" && b === "nb",
      r: pearson(A.series[a], A.series[b]),
      color: a === "ue" && b === "nb" ? "#0d7a4b" : "#c2410c",
    }));

  const blocks = blockCandidates();
  const blockPicker = `<div class="btn-row" style="margin:2px 0 16px">
    ${BLOCKS.map((L) => `<button class="btn ${L === state.L ? "primary" : ""}" data-act="set-L" data-l="${L}">L = ${L} 秒</button>`).join("")}
  </div>`;

  const blockTable = `<table class="compact block-table">
    <thead><tr><th>块长</th><th class="num">ρ(L)</th><th class="num">块数</th><th>依赖覆盖</th><th>样本支撑</th><th>成本</th><th>判定</th></tr></thead>
    <tbody>${blocks.map((b) => `<tr class="${b.L === state.L ? "picked" : ""}" data-act="set-L" data-l="${b.L}">
      <td><b>${b.L}s</b></td>
      <td class="num">${fx(b.rho, 3)}</td>
      <td class="num">${b.n}</td>
      <td>${esc(b.cover)}</td>
      <td>${esc(b.support)}</td>
      <td>${esc(b.cost)}</td>
      <td>${b.ok ? chip("可选", "ok") : chip("不满足", "warn")}</td>
    </tr>`).join("")}</tbody></table>`;

  const u = estimateUL(state.L);
  const rec = recommendedBlock();
  const sel = blocks.find((b) => b.L === state.L);
  const qualifies = Boolean(sel && sel.ok);
  const indepSel = Boolean(sel && Number.isFinite(sel.rho) && sel.rho <= 0.2);
  const tone = u && u.ok && qualifies ? "ok" : "mute";

  let alerts = "";
  if (!u) {
    alerts = `<div class="note-block dim">该块长下无法估计（样本或相关性退化）。</div>`;
  } else if (!u.ok) {
    alerts = `<div class="note-block danger">
      <h4>样本不足，不给数值</h4>
      当前 L=${u.L} 秒得到 ${u.n} 个块，低于 ${MIN_BLOCKS} 的下限。需要把采集时长拉伸到约
      ${Math.ceil((MIN_BLOCKS * u.L * A.common.length) / Math.max(1, u.n))} 秒，或改用更小的 L。
    </div>`;
  } else if (!rec) {
    alerts = `<div class="note-block danger">
      <h4>未找到满足条件的块长 —— 下列数值仅为描述性参考</h4>
      信道在 ${A.span} 秒内没有去相关（ρ(4s)=${fx(acfAt(A.common, A.series.ue, 4), 3)}），
      因此块间独立假设不成立；同时拉长块长会让块数跌破 ${MIN_BLOCKS}。
      要得到可用于结论的估计，需<strong>延长单次采集</strong>（约 30 分钟量级）或改用带时间依赖的参数模型。
    </div>`;
  } else if (!qualifies) {
    alerts = `<div class="note-block dim">
      <strong>当前 L = ${state.L} 秒未通过依赖覆盖</strong>（ρ = ${fx(sel ? sel.rho : NaN, 3)} &gt; 0.2），
      下列数值仅作横向对比；建议块长 ${rec.L} 秒。
    </div>`;
  }

  const results = !u ? "" : `<div class="figures">
      ${fig(`块条件互信息 ${tex("U_L")}`, `${fx(u.base.U, 3)} <small>bit/s</small>`, u.ciU ? `90% CI ${fx(u.ciU.lo, 3)}–${fx(u.ciU.hi, 3)}` : "", tone)}
      ${fig(`互信息差 ${tex("D_L")}`, u.base.D == null ? "—" : `${fx(u.base.D, 3)} <small>bit/s</small>`, u.base.D == null ? "缺 Eve 数据" : `截断前 ${fx(u.base.raw, 3)}`, u.base.D == null ? "mute" : tone)}
      ${fig("块数", num(u.n), `每块 ${u.perBlock} 个观测`, "mute")}
      ${fig("估计器", "E2", "块均值 + 偏相关", "mute")}
    </div>`;

  const formula = !u ? "" : `<div class="formula">${tex("U_{L}=\\frac{1}{L}\\,I(X^{L};Y^{L}\\mid Z^{L}),\\qquad D_{L}=\\frac{1}{L}\\left[I(X^{L};Y^{L})-I(X^{L};Z^{L})\\right]^{+}", true)}</div>`;

  const assumptions = !u ? "" : `<div class="note-block" style="margin-top:14px">
      <h4>假设清单（结果只在此前提下成立）</h4>
      <ul>
        <li>X、Y、Z 联合高斯</li>
        <li>块均值代表块内全部信息 —— 方向上<strong>低估</strong> ${tex("U_L")}</li>
        <li>块间独立（近似）—— ${indepSel ? `本数据集满足（ρ = ${fx(sel.rho, 3)} ≤ 0.2）` : "<strong>本数据集未满足</strong>"}</li>
        <li>${tex("L")} 以秒计，故 ${tex("U_L")} 单位即 bit/s</li>
      </ul>
    </div>`;

  return `
  <div class="page-head">
    <p class="kicker">${kicker("analog")}</p>
    <h2>信道信息量参考值</h2>
  </div>

  ${card("时间自相关", `
    ${lineChart(acfSeries, {
      label: "自相关",
      markY: 0.2,
      yMin: -0.2,
      yMax: 1,
      w: 900,
      h: 260,
      interactive: true,
      xLabel: "滞后 τ（秒，对数刻度）",
      yLabel: "自相关 ρ(τ)",
    })}
    <div class="figures" style="margin-top:12px">
      ${A.present.map((p) => fig(
        `${PARTY_LABEL[p]} 去相关时间`,
        decorr[p] ? `${decorr[p]} <small>秒</small>` : `&gt; 32 <small>秒</small>`,
        `${tex("\\rho(1)")} = ${fx(acfVals[p][0], 3)}`,
        decorr[p] ? "ok" : "warn"
      )).join("")}
    </div>
    <div class="note-block dim" style="margin-top:14px">
      把光标移到图上可读取任一滞后下三方的相关系数。去相关时间 = 自相关首次降到 0.2 以下的滞后，它<strong>只是诊断依据</strong>，不能证明块间独立。
    </div>
  `)}

  ${card("互易性", `<div class="split-3">
    ${pairs.map((p) => `<figure class="plot">
      <h3 style="font-size:14px;color:#6b7280;margin:0 0 6px">${PARTY_LABEL[p.a]} ↔ ${PARTY_LABEL[p.b]}</h3>
      ${scatterChart(A.series[p.a], A.series[p.b], p.color, PARTY_LABEL[p.a], PARTY_LABEL[p.b])}
    </figure>`).join("")}
  </div>
  <div class="figures" style="margin-top:14px">
    ${pairs.map((p) => fig(
      `${PARTY_LABEL[p.a]} ↔ ${PARTY_LABEL[p.b]}`,
      fx(p.r, 3),
      p.legal ? "合法链路，应显著正相关" : "窃听链路，应接近 0",
      p.legal ? (p.r >= 0.5 ? "ok" : "warn") : (Math.abs(p.r) < 0.3 ? "ok" : "warn")
    )).join("")}
  </div>`)}

  ${card("块长与信息量", `
    ${state.synthetic ? `<div class="note-block dim" style="margin-bottom:14px"><strong>合成演示数据</strong>　下面这组数值由人工生成的平稳序列算出，用于展示「数据合格时」的完整呈现；换成真实采集后数值会不同。</div>` : ""}
    <div class="premise">
      前提 · 三方对齐 ${pct(A.ratio)} ·
      平稳性 <b class="${st ? st.tone : ""}">${st ? st.level : "未知"}</b>
      （漂移 ${fx(st ? st.dMu : NaN, 2)}σ · 方差比 ${fx(st ? st.F : NaN, 2)}）
      <em>与「数据导入 → 适用性检查」同源，此处不重复展开</em>
    </div>
    ${alerts}
    ${blockPicker}
    ${results}
    <h3 class="block-title">块长候选</h3>
    ${blockTable}
    ${formula}
    ${assumptions}
  `, chip(`L = ${state.L} 秒`, "info"))}

  ${card("安全性结论", secConclusion(analogConclusion(), "模拟域 · 定量依据"), chip("模拟域", "info"))}
  `;
}

/* ============================================================
   13. 页面：数字域分析
   ============================================================ */

function pageDigital() {
  if (!hasKeys()) {
    return `<div class="page-head"><p class="kicker">${kicker("digital")}</p><h2>密钥质量验证</h2></div>
      ${card("", `<div class="empty"><h3>还缺密钥文件</h3>
      <p><button class="btn primary" data-act="goto" data-page="import">前往导入</button></p></div>`)}`;
  }
  const d = digital();
  const t = nist();

  const groupRows = BS.map((bb) => {
    const gg = d.groups[bb];
    return `<tr>
      <td><b>${bb}</b></td>
      <td class="num">${num(gg.nb)}</td>
      <td class="num">${num(gg.states)}</td>
      <td class="num">${fx(gg.ratio, 1)}</td>
      <td class="num">${num(gg.filled)}</td>
      <td class="num">${fx(gg.hmin, 3)}</td>
      <td class="num">${gg.marginalOk ? chip("可估", "ok") : chip("不足", "warn")}</td>
    </tr>`;
  }).join("");

  return `
  <div class="page-head">
    <p class="kicker">${kicker("digital")}</p>
    <h2>密钥质量验证</h2>
  </div>

  ${card("一致性断言", `<div class="figures">
    ${fig("UE ↔ 基站 的 KDR", d.kdr == null ? "—" : pct(d.kdr, 2), d.same ? "完全一致，0 bit 差异" : "流程硬失败", d.same ? "ok" : "bad")}
    ${fig("Eve ↔ UE 的 KDR", d.eveRate == null ? "—" : pct(d.eveRate, 2), "比特差异，独立序列应≈50%", d.eveRate == null ? "mute" : Math.abs(d.eveRate - 0.5) < 0.05 ? "ok" : "warn")}
    ${fig("密钥总量", `${num(d.nBits)} bit`, `${num(d.lines)} 行 × ${d.width}`, "mute")}
    ${fig("Eve 侧长度", `${num(d.nBitsE)} bit`, `${num(d.linesE)} 行`, "mute")}
  </div>
  <p class="card-subnote">
    KDR 是两串密钥逐位异或后 1 的占比。Eve 和合法方的 KDR 接近 50%，说明两串密钥互不相关；若显著低于 50%，说明 Eve 能复现合法密钥，属于严重异常。
  </p>`)}

  ${card("分组与最小熵", `<table class="compact group-table">
    <thead><tr><th>块长 ${tex("b")}</th><th class="num">组数</th><th class="num">状态 ${tex("2^b")}</th><th class="num">样本/状态</th><th class="num">覆盖</th><th class="num">${tex("H_{\\min}")}</th><th class="num">识别性</th></tr></thead>
    <tbody>${groupRows}</tbody>
  </table>
  <div class="note-block dim" style="margin-top:16px">
    <h4>关于 ${tex("H_{\\min}")}</h4>
    <div class="formula">${tex("H_{\\min}(K)=-\\log_{2}\\frac{\\max_{k}N(k)}{N_{b}}")}</div>
    这是隐私放大的输出目标。达标只说明隐私放大实现正确，<strong>不构成保密证据</strong>；
    也不允许把「块级最小熵 × 块数」当作对 Eve 的保密熵。
    <p style="margin:10px 0 0">
      真正的安全指标是<strong>条件最小熵</strong> ${tex("H_{\\min}(K\\mid E)")}（Eve 已知时的熵），
      它需要隐私放大前的量化比特，当前数据不可得 —— 所以本域只做质量验证，不估计秘密随机性。
    </p>
  </div>`)}

  ${card("NIST SP 800-22", `<div class="figures" style="margin-bottom:14px">
      ${fig("通过", `${t.passed} / ${t.judged.length}`, "仅统计可判定项", t.passed === t.judged.length ? "ok" : "warn")}
      ${fig("样本长度", `${num(t.n)} bit`, `共 ${t.rows.length} 项检验`, "mute")}
      ${fig("可判定", `${t.judged.length} 项`, "其余长度不足", "warn")}
    </div>
    <table class="compact nist-table">
      <thead><tr><th>检验项</th><th>参数</th><th class="num">p 值</th><th class="num">判定</th></tr></thead>
      <tbody>${t.rows.map((r) => {
        const on = state.nistOpen === r.id;
        const row = `<tr class="check-tr ${on ? "open" : ""}" data-act="nist" data-id="${r.id}">
          <td>${r.name}</td>
          <td>${r.param || ""}</td>
          <td class="num">${r.p == null ? "—" : fx(r.p, 4)}</td>
          <td class="num">${chip(r.note, r.pass == null ? "warn" : r.pass ? "ok" : "bad")}</td>
        </tr>`;
        if (!on) return row;
        return row + `<tr class="check-note"><td colspan="4"><div class="check-pop">
          <div class="check-pop-head"><strong>${r.name}</strong></div>
          <p>${NIST_DOC[r.id] || ""}</p>
          <div class="check-pop-meta"><b>适用条件</b>${r.req || "-"}</div>
        </div></td></tr>`;
      }).join("")}</tbody>
    </table>`,
    `<span class="fit-hint">点击检验项查看说明</span>${chip(`${t.passed} / ${t.judged.length} 通过`, t.passed === t.judged.length ? "ok" : "warn")}`)}

  ${card("安全性结论", secConclusion(digitalConclusion(), "数字域 · 定量依据"), chip("数字域", "info"))}
  `;
}

/* ============================================================
   14. 页面：调和与放大
   ============================================================ */

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

function pageRecon() {
  const d = hasKeys() ? digital() : null;
  const actual = d ? d.nBits : null;
  const b = budget();
  const feasible = actual != null && b.raw >= 0 && actual <= b.safe;
  const seconds = Math.max(1, Number(state.pSeconds) || 1);
  const succ = Math.min(100, Math.max(0, Number(state.pSucc) || 0));
  const netRate = actual == null ? null : (actual * (succ / 100)) / seconds;

  const verdict = actual == null
    ? `<div class="verdict warn"><div><b>还缺密钥文件</b></div><div>导入密钥后才能与实际提取长度比对。</div></div>`
    : b.raw < 0
      ? `<div class="verdict bad"><div><b>参数不可行</b></div><div>熵 ${num(b.hmin)} bit 覆盖不了 ${num(b.spent)} bit 的扣除项，任何长度的提取都没有依据。</div></div>`
      : feasible
        ? `<div class="verdict"><div><b>当前配置可行</b></div><div>建议最多提取 ${num(b.safe)} bit，实际 ${num(actual)} bit，余量 ${num(b.safe - actual)} bit。</div></div>`
        : `<div class="verdict bad"><div><b>提取量超出预算</b></div><div>建议最多 ${num(b.safe)} bit，实际提取 ${num(actual)} bit，超出 ${num(actual - b.safe)} bit —— 协议参数或熵假设需要重新核对。</div></div>`;

  const field = (label, key, opt) => `<label class="field"><span>${label}</span>
    <input type="number" data-field="${key}" value="${state[key]}" ${opt || ""}/></label>`;

  return `
  <div class="page-head">
    <p class="kicker">${kicker("recon")}</p>
    <h2>熵预算</h2>
  </div>

  ${card("协议参数", `<div class="grid-3 form-grid">
    ${field("原始保留比特 n", "pN", 'min="1" step="1024"')}
    ${field("码率 r", "pRate", 'min="0.05" max="0.99" step="0.01"')}
    <label class="field"><span>公开泄露取值</span>
      <select data-field="pLeakMode">
        <option value="rate" ${state.pLeakMode === "rate" ? "selected" : ""}>按码率推算 n(1−r)</option>
        <option value="actual" ${state.pLeakMode === "actual" ? "selected" : ""}>按实测位数</option>
      </select>
    </label>
    ${state.pLeakMode === "actual" ? field("实测公开位数", "pActualPublic", 'min="0" step="64"') : ""}
    ${field("其他公开信息", "pOther", 'min="0" step="64"')}
    ${field(`隐私放大余量 ${tex("\\Delta_{\\mathrm{PA}}")}`, "pPa", 'min="0" step="64"')}
    ${field("认证预共享位数", "pAuthBits", 'min="0" step="32"')}
    ${field(`假设的调和前熵 ${tex("\\overline{H}_{\\min}")}`, "pHmin", 'min="0" step="1024"')}
    ${field("处理时长（秒）", "pSeconds", 'min="1" step="1"')}
    ${field("调和成功率（%）", "pSucc", 'min="0" max="100" step="1"')}
  </div>`)}

  ${card("熵预算表", `
    <div class="formula">${tex("\\ell_{\\mathrm{safe}}=\\max\\left\\{0,\\ \\overline{H}_{\\min}(K_A\\mid E)-\\lambda_{\\mathrm{public}}-\\Delta_{\\mathrm{PA}}\\right\\}", true)}</div>
    <div class="ledger">
      ${readLine(`原始保留比特 ${tex("n")}`, `${num(b.n)} <small>bit</small>`)}
      ${readLine(`调和前熵下界 ${tex("\\overline{H}_{\\min}")}`, `${num(b.hmin)} <small>bit</small>`)}
      ${readLine(`公开泄露 ${tex("\\lambda_{\\mathrm{public}}")}`, `− ${num(b.leak)} <small>bit</small>`)}
      ${readLine("其他公开信息", `− ${num(b.other)} <small>bit</small>`)}
      ${readLine(`隐私放大余量 ${tex("\\Delta_{\\mathrm{PA}}")}`, `− ${num(b.pa)} <small>bit</small>`)}
      ${readLine("认证预共享密钥", `− ${num(b.auth)} <small>bit</small>`)}
      ${readLine(`建议提取长度 ${tex("\\ell_{\\mathrm{safe}}")}`, `${num(b.safe)} <small>bit</small>`, b.raw < 0 ? "bad" : "ok")}
      ${readLine("实际提取长度", actual == null ? "—" : `${num(actual)} <small>bit</small>`, actual == null ? "mute" : feasible ? "ok" : "bad")}
    </div>
    ${verdict}`,
    chip(b.raw < 0 ? "参数不可行" : `${num(b.safe)} bit`, b.raw < 0 ? "bad" : "info"))}

  ${card("速率与批次", `<div class="figures">
    ${fig("净速率", netRate == null ? "—" : `${fx(netRate, 1)} <small>bit/s</small>`, `按全部 ${num(seconds)} 秒运行时间`, netRate == null ? "mute" : "ok")}
    ${fig("每批次密钥", actual == null ? "—" : `${num(actual)} <small>bit</small>`, "单批次，实际提取", "mute")}
    ${fig("调和成功率", `${num(succ)} %`, succ >= 100 ? "全部批次成功" : "按输入值折算", succ >= 100 ? "ok" : "warn")}
  </div>`)}
  `;
}

/* ============================================================
   15. 页面：报告与历史
   ============================================================ */

function pageReport() {
  const p = premise();
  const s = session();
  const A = s.align;
  const d = hasKeys() ? digital() : null;
  const u = hasAnalog() ? estimateUL(state.L) : null;
  const t = nist();
  const rec = recommendedBlock();
  const b = budget();
  const ac = analogConclusion();
  const dc = digitalConclusion();
  const actual = d ? d.nBits : null;
  const tau = extrapTau();
  const feasible = actual != null && b.raw >= 0 && actual <= b.safe;
  const q = (s) => `<span class="q-group">${s}</span>`;
  const rhoSel = hasAnalog() ? acfAt(A.common, A.series.ue, state.L) : null;
  const indepSel = Number.isFinite(rhoSel) && rhoSel <= 0.2;

  const analogQuant = u
    ? [
      q(`U_L ${fx(u.base.U, 3)} bit/s`),
      q(`D_L ${u.base.D == null ? "—" : `${fx(u.base.D, 3)} bit/s`}`),
      indepSel ? null : q("（描述性）"),
    ].filter(Boolean).join(" · ")
    : "无信道数据";
  const digitalQuant = d && t
    ? [
      q(`NIST ${t.passed}/${t.judged.length}`),
      q(`Eve KDR ${pct(d.eveRate, 2)}`),
      q(`H_min ${fx(d.groups[8].hmin, 3)} / 8 bit`),
    ].join(" · ")
    : "无密钥数据";
  const budgetQuant = actual == null
    ? [q(`ℓ_safe ${num(b.safe)} bit`), q("待导入密钥")].join(" · ")
    : b.raw < 0
      ? [q("ℓ_safe 0 bit"), q(`实际 ${num(actual)} bit`), q("不可行")].join(" · ")
      : [q(`ℓ_safe ${num(b.safe)} bit`), q(`实际 ${num(actual)} bit`), q(`余量 ${num(b.safe - actual)} bit`)].join(" · ");
  const budgetChip = actual == null
    ? { text: "待比对", tone: "mute" }
    : b.raw < 0
      ? { text: "参数不可行", tone: "bad" }
      : feasible
        ? { text: "假设下可行", tone: "warn" }
        : { text: "超出预算", tone: "bad" };

  const domainRow = (name, sub, c, quant, bound) => `<tr>
      <td class="sc-k"><b>${name}</b><div class="sc-sub">${sub}</div></td>
      <td>${c ? chip(c.short, c.tone) : chip("无数据", "mute")}</td>
      <td class="sc-quant">${quant}</td>
      <td class="sc-bound">${bound}</td>
    </tr>`;

  const rows = [
    domainRow("模拟域", "信道信息量", ac, analogQuant, hasAnalog()
      ? (indepSel ? "假设：联合高斯 / 块均值 / 块间独立" : `块间独立未满足（ρ(${state.L} s) = ${fx(rhoSel, 3)}）`)
      : "缺三方信道数据"),
    domainRow("数字域", "密钥质量", dc, digitalQuant, d
      ? "H_min(K|E) 不可得，保密强度未证明"
      : "缺密钥文件"),
    `<tr>
      <td class="sc-k"><b>熵预算</b><div class="sc-sub">提取长度</div></td>
      <td>${chip(budgetChip.text, budgetChip.tone)}</td>
      <td class="sc-quant">${budgetQuant}</td>
      <td class="sc-bound">熵与协议参数为假设输入</td>
    </tr>`,
  ].join("");

  const conclTone = !hasAny() ? "mute" : p.tone === "bad" || (ac && ac.tone === "bad") || (dc && dc.tone === "bad") ? "bad" : "warn";
  const conclLabel = !hasAny() ? "尚未导入" : p.tone === "bad" ? "前提不成立" : "分域结论 · 不合并评级";
  const budgetPhrase = actual == null
    ? `熵预算在假设输入下给出 ${num(b.safe)} bit 的建议长度，尚未与实际提取比对`
    : b.raw < 0
      ? "熵预算参数不可行"
      : `熵预算在假设输入下留有 ${num(b.safe - actual)} bit 余量`;
  const conclText = !hasAny()
    ? "导入三方信道与密钥后，这里会分别给出模拟域与数字域的安全性结论；左表的定量依据随数据自动填充。"
    : p.tone === "bad"
      ? `${p.note}两个域都不给出数值结论。`
      : `本次评估不给出合并的安全等级。模拟域：${ac ? ac.label : "无数据"}；数字域：${dc ? dc.label : "无数据"}；${budgetPhrase}。`
        + `三条结论各自在自身条件下成立，不能相互替代 —— 模拟域回答「信道里有多少可用的秘密信息」，数字域回答「提取出的密钥是否合格」，预算回答「提取长度是否超出假设的熵」。`;

  const gaps = [
    "隐私放大前的量化比特 —— 决定 H_min(K|E)，缺了它就没有保密强度",
    `满足 ρ(L) ≤ 0.2 且块数 ≥ ${MIN_BLOCKS} 的采集 —— 当前 ${A ? `${A.common.length} 秒` : "—"}${tau ? `，按外推需约 ${num(Math.round(MIN_BLOCKS * tau))} 秒` : ""}`,
    "Eve 侧信息量的上界 —— 目前只有 Eve 和合法方的 KDR 作为间接证据",
  ];

  const condRows = [
    readLine("适用范围", esc(`${state.env} · ${state.motion} · RIS ${state.ris} · ${state.attack} · 信道${state.channel}`), ""),
    readLine("数据指纹", `#${fingerprint()}`, ""),
    readLine("重叠时长", A ? `${num(A.common.length)} 秒（占 ${pct(A.ratio)}）` : "—", A && A.ratio >= 0.5 ? "ok" : "warn"),
    readLine("建议块长", rec ? `${rec.L} 秒` : "不满足条件", rec ? "ok" : "warn"),
    readLine("密钥总长", d ? `${num(d.nBits)} bit` : "—", "mute"),
    readLine("建议提取长度", b.raw < 0 ? "参数不可行" : `${num(b.safe)} bit（假设输入）`, b.raw < 0 ? "bad" : "warn"),
  ].join("");

  return `
  <div class="page-head">
    <p class="kicker">${kicker("report")}</p>
    <h2>安全性结论与记录</h2>
  </div>

  ${premiseBlock(p)}

  ${card("安全性结论", `<table class="compact concl-table report-table">
      <thead><tr><th>域</th><th>结论</th><th>关键定量</th><th>边界 / 缺口</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="concl ${conclTone}">
      <div class="concl-head">
        <span class="concl-tag">${esc(conclLabel)}</span>
        <span class="concl-sub">两域 + 熵预算</span>
      </div>
      <p class="concl-text">${esc(conclText)}</p>
    </div>
    ${hasAny() ? `<p class="concl-note">要给出「该密钥对 Eve 的保密强度 ≥ X bit」，仍缺三项证据：${gaps.map((x, i) => `${"①②③"[i]} ${x}`).join("；")}。</p>` : ""}`,
    chip("综合", "info"))}

  ${card("评估条件与输入", `<div class="ledger">${condRows}</div>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn primary" data-act="export">导出 JSON</button>
      <button class="btn" data-act="print">打印 / 另存 PDF</button>
      <button class="btn ghost" data-act="save-history">存入历史</button>
    </div>`)}

  ${card("历史", state.history.length ? `<table class="compact hist-table">
      <thead><tr><th>时间</th><th>场景</th><th class="num">块长</th><th class="num">密钥</th><th>模拟域</th><th>数字域</th></tr></thead>
      <tbody>${state.history.map((h) => `<tr>
        <td>${esc(h.at)}</td><td>${esc(h.scene)}</td><td class="num">${h.L}s</td><td class="num">${num(h.bits)}</td>
        <td>${h.analog ? chip(h.analog.short, h.analog.tone) : "—"}</td>
        <td>${h.digital ? chip(h.digital.short, h.digital.tone) : "—"}</td>
      </tr>`).join("")}</tbody></table>` : `<div class="empty">还没有历史记录。点击「存入历史」保存本次参数与结果。</div>`)}
  `;
}

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
   17. 骨架
   ============================================================ */

function topbar() {
  return `<header class="topbar">
    <div class="brand">
      <div class="mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M3 9h12M9 3v12" stroke="currentColor" stroke-width="1.6"/>
          <circle cx="9" cy="9" r="2.2" fill="currentColor"/>
        </svg>
      </div>
      <div>
        <h1>物理层密钥安全性评估工作台</h1>
        <p>Physical-layer Key Security Workbench</p>
      </div>
    </div>
    <div class="top-meta">
      ${state.synthetic ? `<span class="badge synth">合成演示数据</span>` : ""}
      <span class="badge ${state.attack === "被动窃听" && state.channel === "已认证" ? "" : "bad"}">${esc(state.attack)} · 信道${esc(state.channel)}</span>
    </div>
  </header>`;
}

function sidebar() {
  return `<aside class="sidebar">
    <div class="side-label">流程</div>
    ${PAGES.map((p, i) => {
      const st = statusOf(p.id);
      return `<button class="nav-btn ${state.page === p.id ? "active" : ""}" data-act="goto" data-page="${p.id}">
        <small>${String(i + 1).padStart(2, "0")}</small>
        <span class="nav-txt">${p.name}</span>
        <span class="nav-state ${st === "mute" ? "" : st}"></span>
      </button>`;
    }).join("")}
  </aside>`;
}

function rail() {
  const s = session();
  const A = s.align;
  const d = hasKeys() ? digital() : null;
  const p = premise();
  const ac = analogConclusion();
  const dc = digitalConclusion();
  return `<aside class="rail">
    <div class="card">
      <h4>分析条件</h4>
      <div class="kv"><span>攻击模型</span><b class="${state.attack === "被动窃听" ? "ok" : "bad"}">${esc(state.attack)}</b></div>
      <div class="kv"><span>环境</span><b>${esc(state.env)}</b></div>
      <div class="kv"><span>移动状态</span><b>${esc(state.motion)}</b></div>
      <div class="kv"><span>RIS</span><b>${esc(state.ris)}</b></div>
      <div class="kv"><span>协商信道</span><b class="${state.channel === "已认证" ? "ok" : "bad"}">${esc(state.channel)}</b></div>
    </div>
    <div class="card">
      <h4>Eve 掌握的信息</h4>
      <div class="check ${state.eveObs ? "on" : ""}"><i>✓</i>信道观测</div>
      <div class="check ${state.eveQuant ? "on" : ""}"><i>✓</i>公开量化规则</div>
      <div class="check ${state.eveOther ? "on" : ""}"><i>✓</i>其他侧信息</div>
    </div>
    <div class="card">
      <h4>两域结论</h4>
      <div class="kv"><span>模拟域</span><b class="${ac ? ac.tone : ""}">${ac ? esc(ac.short) : "—"}</b></div>
      <div class="kv"><span>数字域</span><b class="${dc ? dc.tone : ""}">${dc ? esc(dc.short) : "—"}</b></div>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280;line-height:1.5">${esc(p.note)}</p>
    </div>
    <div class="card">
      <h4>数据状态</h4>
      <div class="kv"><span>重叠时长</span><b>${A ? `${A.common.length} s` : "—"}</b></div>
      <div class="kv"><span>重叠比例</span><b class="${A && A.ratio >= 0.5 ? "ok" : "warn"}">${A ? pct(A.ratio) : "—"}</b></div>
      <div class="kv"><span>采集时长</span><b>${A ? `${A.span} s` : "—"}</b></div>
      <div class="kv"><span>密钥</span><b>${d ? `${num(d.nBits)} bit` : "—"}</b></div>
      <div class="kv"><span>双方密钥</span><b class="${d ? (d.same ? "ok" : "bad") : ""}">${d ? (d.same ? "完全一致" : "不一致") : "—"}</b></div>
    </div>
  </aside>`;
}

function pageBody() {
  switch (state.page) {
    case "scene": return pageScene();
    case "import": return pageImport();
    case "analog": return pageAnalog();
    case "digital": return pageDigital();
    case "recon": return pageRecon();
    case "report": return pageReport();
    default: return pageScene();
  }
}

function render() {
  document.getElementById("app").innerHTML = `<div class="app">${topbar()}${sidebar()}<main class="main">${pageBody()}</main>${rail()}</div>`;
  typeset();
  if (state.scrollFit) {
    state.scrollFit = false;
    const el = document.getElementById("fit-section");
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }
  if (state.toast) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = state.toast;
    document.body.appendChild(t);
    const msg = state.toast;
    state.toast = "";
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
}

/* ============================================================
   18. 交互
   ============================================================ */

function toast(msg) {
  state.toast = msg;
  render();
}

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.field) {
    const k = el.dataset.field;
    if (el.type === "checkbox") state[k] = el.checked;
    else if (el.type === "number" || el.type === "range") {
      const v = Number(el.value);
      state[k] = Number.isFinite(v) ? v : 0;
    } else state[k] = el.value;
    render();
    return;
  }
  if (el.id === "file-input") {
    const files = [...el.files];
    el.value = "";
    if (files.length) importFiles(files).then(render);
  }
});

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "goto") {
    state.page = el.dataset.page;
    render();
    window.scrollTo({ top: 0 });
  } else if (act === "check") {
    const id = el.dataset.check;
    state.checkOpen = state.checkOpen === id ? null : id;
    render();
  } else if (act === "nist") {
    const nid = el.dataset.id;
    state.nistOpen = state.nistOpen === nid ? null : nid;
    render();
  } else if (act === "set-L") {
    const v = Number(el.dataset.l);
    if (Number.isFinite(v) && v > 0) state.L = v;
    render();
  } else if (act === "pick") {
    pickFiles(el.dataset.slot);
  } else if (act === "pick-dir") {
    pickDir();
  } else if (act === "load-sample") {
    loadSample()
      .then(() => { state.scrollFit = true; render(); })
      .catch(() => toast("示例载入失败：请用本地 HTTP 服务打开页面"));
  } else if (act === "load-synth") {
    loadSynth();
  } else if (act === "clear") {
    state.slots = {};
    state.synthetic = false;
    invalidate();
    render();
  } else if (act === "export") {
    exportJson();
  } else if (act === "print") {
    window.print();
  } else if (act === "save-history") {
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
    state.scrollFit = true;
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

function exportJson() {
  const p = premise();
  const ac = analogConclusion();
  const dc = digitalConclusion();
  const s = session();
  const u = hasAnalog() ? estimateUL(state.L) : null;
  const d = hasKeys() ? digital() : null;
  const t = nist();
  const conclusionOf = (c) => (c ? {
    label: c.label,
    statement: c.text,
    note: c.note,
    metrics: c.rows.map((r) => ({ name: r.k, value: r.v, rule: r.rule, verdict: r.verdict })),
  } : null);
  const payload = {
    generatedAt: new Date().toISOString(),
    scope: {
      env: state.env, motion: state.motion, ris: state.ris,
      attack: state.attack, channel: state.channel,
      feature: state.feature, csiUse: state.csiUse,
      eve: { channelObservation: state.eveObs, quantizationRule: state.eveQuant, otherSideInfo: state.eveOther },
    },
    premise: { label: p.label, note: p.note },
    conclusions: { analog: conclusionOf(ac), digital: conclusionOf(dc) },
    alignment: s.align ? { commonSeconds: s.align.common.length, ratio: s.align.ratio, spanSeconds: s.align.span, gap: s.align.gap } : null,
    analog: u ? {
      blockSeconds: u.L, blocks: u.n,
      estimator: "E2 块均值 + 偏相关",
      assumptions: ["联合高斯", "块均值代表块内信息（低估）", "块间独立（近似）"],
      conditionalMI_bitsPerSecond: u.base.U,
      conditionalMI_ci90: u.ciU,
      mutualInfoDifference_bitsPerSecond: u.base.D,
      mutualInfoDifference_raw: u.base.raw,
      partialCorrelation: u.base.pxy,
    } : null,
    digital: d ? {
      bits: d.nBits, lines: d.lines, width: d.width,
      identicalLegalEnds: d.same, kdr: d.kdr,
      biasP1: d.p1,
      groups: Object.fromEntries(BS.map((b) => [b, { groups: d.groups[b].nb, states: d.groups[b].states, ratio: d.groups[b].ratio, hmin: d.groups[b].hmin }])),
      note: "密钥为隐私放大输出，条件最小熵不可估计",
    } : null,
    randomTests: t ? { n: t.n, passed: t.passed, judged: t.judged.length, rows: t.rows.map((r) => ({ name: r.name, p: r.p, verdict: r.note })) } : null,
    budget: (() => {
      const b = budget();
      return {
        assumed: true,
        rawBits: b.n,
        codeRate: b.rate,
        leakMode: state.pLeakMode,
        publicLeakBits: b.leak,
        otherPublicBits: b.other,
        paMarginBits: b.pa,
        authBits: b.auth,
        assumedHminBits: b.hmin,
        safeLengthBits: b.safe,
        actualBits: d ? d.nBits : null,
        feasible: d ? b.raw >= 0 && d.nBits <= b.safe : null,
      };
    })(),
    synthetic: state.synthetic,
    safetyLengthLowerBound: null,
    warnings: [
      "结论分模拟域与数字域分别给出，不支持合并为单一安全等级",
      "熵与协议参数为假设输入，不是实测值",
      "模拟域结论依赖联合高斯、块均值、块间独立三项假设，块均值方向上低估信息量",
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

/* ---------- 图表悬浮读数 ---------- */
function hideChartHover(box) {
  if (!box) return;
  const g = box.querySelector(".hv");
  if (g) g.style.opacity = "0";
  const tip = box.querySelector(".chart-tip");
  if (tip) tip.hidden = true;
}

function updateChartHover(box, clientX) {
  const svg = box.querySelector("svg");
  const tip = box.querySelector(".chart-tip");
  const g = box.querySelector(".hv");
  if (!svg || !tip || !g) return;
  let meta;
  try { meta = JSON.parse(svg.dataset.meta || ""); } catch (err) { return; }
  if (!meta || !meta.xs || !meta.series) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return;

  const { pad, xs, yMin, yMax, h } = meta;
  const iw = meta.w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const xAt = (i) => pad.l + (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * iw);
  const yAt = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const vx = ((clientX - rect.left) / rect.width) * meta.w;

  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xAt(i) - vx);
    if (d < bestD) { bestD = d; best = i; }
  }
  const cx = xAt(best);

  const line = svg.querySelector(".hv-line");
  if (line) { line.setAttribute("x1", cx); line.setAttribute("x2", cx); }
  svg.querySelectorAll(".hv-dot").forEach((dot) => {
    const s = meta.series[Number(dot.dataset.k)];
    const v = s ? s.ys[best] : null;
    if (v == null || !Number.isFinite(v)) { dot.style.opacity = "0"; return; }
    dot.style.opacity = "1";
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", yAt(v));
  });
  g.style.opacity = "1";

  tip.innerHTML = `<div class="tip-head">滞后 ${xs[best]} 秒</div>` + meta.series.map((s) => {
    const v = s.ys[best];
    return `<div class="tip-row"><i style="background:${s.color}"></i><span>${s.name}</span><b>${v == null || !Number.isFinite(v) ? "—" : v.toFixed(3)}</b></div>`;
  }).join("");
  tip.hidden = false;

  const boxRect = box.getBoundingClientRect();
  const offset = rect.left - boxRect.left;
  const half = tip.offsetWidth / 2;
  const leftPx = offset + (cx / meta.w) * rect.width;
  tip.style.left = `${Math.max(half + 2, Math.min(boxRect.width - half - 2, leftPx))}px`;
  tip.style.top = "2px";
}

document.addEventListener("mousemove", (e) => {
  const t = e.target;
  const svg = t && t.closest ? t.closest("svg") : null;
  const box = svg ? svg.closest(".chart-interactive") : null;
  if (box) { updateChartHover(box, e.clientX); return; }
  document.querySelectorAll(".chart-interactive").forEach((b) => {
    const tip = b.querySelector(".chart-tip");
    if (tip && !tip.hidden) hideChartHover(b);
  });
});

document.documentElement.addEventListener("mouseleave", () => {
  document.querySelectorAll(".chart-interactive").forEach(hideChartHover);
});

/* ============================================================
   19. 启动
   ============================================================ */

(function boot() {
  const params = new URLSearchParams(location.search);
  const page = params.get("page");
  if (page === "fit") state.page = "import";
  else if (page === "tests") state.page = "digital";
  else if (PAGES.some((p) => p.id === page)) state.page = page;
  const chk = params.get("check");
  if (chk) state.checkOpen = chk;
  const lq = Number(params.get("L"));
  const pinL = Number.isFinite(lq) && lq > 0 ? lq : null;
  if (params.get("synth") === "1") {
    loadSynth();
  } else if (params.get("demo") === "1") {
    loadSample()
      .then(() => { render(); })
      .catch(() => { render(); });
  } else {
    render();
    probeSample();
  }
  if (pinL) { state.L = pinL; render(); }
})();
