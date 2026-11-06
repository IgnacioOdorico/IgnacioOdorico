// Generates assets/langs-dark.svg and assets/langs-light.svg from the GitHub API.
// Zero dependencies: Node 18+ built-ins and global fetch only.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "IgnacioOdorico";
const PROFILE_REPO = "IgnacioOdorico";
// Languages left out of the ranking (notebooks inflate byte counts).
const EXCLUDED = ["Jupyter Notebook"];
const TOP_N = 6;
const OTHERS_MIN_PERCENT = 1;
const API = "https://api.github.com";
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const COLORS = {
  Python: "#3572A5",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Java: "#b07219",
  HTML: "#e34c26",
  CSS: "#663399",
  Shell: "#89e051",
  Dockerfile: "#384d54",
  Kotlin: "#A97BFF",
  Vue: "#41b883",
};
const FALLBACK_COLOR = "#8b949e";
const OTHERS_COLOR = "#6e7681";

const THEMES = {
  dark: { bg: "#0d1117", border: "#30363d", title: "#e6edf3", text: "#c9d1d9", muted: "#8b949e", accent: "#3e9ded" },
  light: { bg: "#ffffff", border: "#d0d7de", title: "#1f2328", text: "#1f2328", muted: "#656d76", accent: "#0969da" },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const headers = {
    "User-Agent": "IgnacioOdorico-profile-stats",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers });
      if (res.ok) return await res.json();
      if (res.status < 500) {
        // 4xx (including rate limiting) is not retryable.
        throw Object.assign(new Error(`HTTP ${res.status} for ${path}`), { fatal: true });
      }
      lastError = new Error(`HTTP ${res.status} for ${path}`);
    } catch (err) {
      if (err.fatal) throw err;
      lastError = err;
    }
    if (attempt < 3) await sleep(1000 * attempt);
  }
  throw lastError;
}

async function listRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/users/${OWNER}/repos?per_page=100&type=owner&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.fork && r.name !== PROFILE_REPO);
}

async function collectLanguages() {
  const repos = await listRepos();
  const totals = new Map();
  for (const repo of repos) {
    const langs = await api(`/repos/${OWNER}/${repo.name}/languages`);
    for (const [name, bytes] of Object.entries(langs)) {
      if (EXCLUDED.includes(name)) continue;
      totals.set(name, (totals.get(name) ?? 0) + bytes);
    }
  }
  return { totals, repoCount: repos.length };
}

function buildEntries(totals) {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((s, [, b]) => s + b, 0);
  if (sum === 0) throw new Error("No language data found");
  const entries = sorted.slice(0, TOP_N).map(([name, bytes]) => ({
    name,
    pct: (bytes / sum) * 100,
    color: COLORS[name] ?? FALLBACK_COLOR,
  }));
  const rest = sorted.slice(TOP_N).reduce((s, [, b]) => s + b, 0);
  const restPct = (rest / sum) * 100;
  if (restPct >= OTHERS_MIN_PERCENT) entries.push({ name: "Otros", pct: restPct, color: OTHERS_COLOR });
  return entries;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtPct = (n) => `${n.toFixed(1).replace(".", ",")} %`;

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function render(entries, t, date) {
  const W = 480, PAD = 24, BAR_W = W - PAD * 2, BAR_Y = 54, BAR_H = 10;
  const LEG_Y = 92, ROW_H = 24, COL_W = BAR_W / 2;
  const rows = Math.ceil(entries.length / 2);
  const footY = LEG_Y + rows * ROW_H + 14;
  const H = footY + 30;

  const totalPct = entries.reduce((s, e) => s + e.pct, 0);
  let x = 0;
  const segs = entries.map((e, i) => {
    const w = (e.pct / totalPct) * BAR_W;
    const seg = `<rect class="seg" style="animation-delay:${(i * 0.15).toFixed(2)}s" x="${(PAD + x).toFixed(2)}" y="${BAR_Y}" width="${w.toFixed(2)}" height="${BAR_H}" fill="${e.color}"/>`;
    x += w;
    return seg;
  });

  const legend = entries.map((e, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = PAD + col * COL_W, ly = LEG_Y + row * ROW_H;
    return `<g class="row" style="animation-delay:${(0.3 + i * 0.15).toFixed(2)}s">
    <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${e.color}"/>
    <text class="label" x="${lx + 18}" y="${ly}" fill="${t.text}">${esc(e.name)}</text>
    <text class="num" x="${lx + COL_W - 24}" y="${ly}" text-anchor="end" fill="${t.muted}">${esc(fmtPct(e.pct))}</text>
  </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lenguajes más usados">
  <title>Lenguajes más usados</title>
  <style>
    .label { font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .title { font: 600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .foot { font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .num { font: 12px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
    .seg { transform-box: fill-box; transform-origin: left center; animation: grow 0.8s ease-out both; }
    .row { animation: fade 0.5s ease-out both; }
    @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .seg, .row { animation: none; } }
  </style>
  <defs>
    <clipPath id="bar"><rect x="${PAD}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="5"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
  <rect x="${PAD}" y="19" width="3" height="14" rx="1.5" fill="${t.accent}"/>
  <text class="title" x="${PAD + 12}" y="32" fill="${t.title}">Lenguajes más usados</text>
  <rect x="${PAD}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="5" fill="${t.border}"/>
  <g clip-path="url(#bar)">
    ${segs.join("\n    ")}
  </g>
  ${legend.join("\n  ")}
  <text class="foot" x="${PAD}" y="${footY}" fill="${t.muted}">Repos públicos propios · se actualiza solo con GitHub Actions</text>
  <text class="foot" x="${PAD}" y="${footY + 16}" fill="${t.muted}">Actualizado: ${fmtDate(date)}</text>
</svg>
`;
}

async function main() {
  const { totals, repoCount } = await collectLanguages();
  const entries = buildEntries(totals);
  const now = new Date();
  // Render everything before writing so a failure never leaves a partial card.
  const out = Object.entries(THEMES).map(([name, t]) => [name, render(entries, t, now)]);
  mkdirSync(ASSETS_DIR, { recursive: true });
  for (const [name, svg] of out) writeFileSync(join(ASSETS_DIR, `langs-${name}.svg`), svg);
  console.log(`Repos: ${repoCount}`);
  for (const e of entries) console.log(`${e.name.padEnd(12)} ${fmtPct(e.pct)}`);
}

main().catch((err) => {
  console.error(`generate-stats failed: ${err.message}`);
  process.exit(1);
});
