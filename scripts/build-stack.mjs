// Builds assets/stack/stack-{dark,light}.svg: every technology with its name under the icon,
// grouped by category. Icons are fetched once at build time (skillicons.dev and simple-icons)
// and embedded, so the profile never depends on those services when someone visits it.
// Usage: node scripts/build-stack.mjs   (Node 18+, no dependencies)
import { writeFileSync } from "node:fs";

const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@16.36.0/icons";

// skill: skillicons.dev id | simple: simple-icons slug | sparkle: neutral glyph (brand removed its logo)
const CATEGORIES = [
  { title: "Backend", items: [["Python", { skill: "py" }], ["FastAPI", { skill: "fastapi" }], ["Java", { skill: "java" }], ["Spring Boot", { skill: "spring" }], ["Node.js", { skill: "nodejs" }], ["Express", { skill: "express" }]] },
  { title: "Frontend", items: [["React", { skill: "react" }], ["TypeScript", { skill: "ts" }], ["JavaScript", { skill: "js" }], ["Tailwind CSS", { skill: "tailwind" }], ["Vite", { skill: "vite" }], ["HTML", { skill: "html" }], ["CSS", { skill: "css" }]] },
  { title: "Datos", items: [["PostgreSQL", { skill: "postgres" }], ["MySQL", { skill: "mysql" }], ["SQLite", { skill: "sqlite" }], ["MongoDB", { skill: "mongodb" }]] },
  { title: "IA y automatización", items: [["n8n", { simple: "n8n", color: "#EA4B71" }], ["OpenAI API", { sparkle: true }], ["Claude Code", { simple: "claude", color: "#D97757" }], ["MCP", { simple: "modelcontextprotocol" }]] },
  { title: "DevOps y herramientas", items: [["Docker", { skill: "docker" }], ["GitHub Actions", { skill: "githubactions" }], ["Git", { skill: "git" }], ["GitHub", { skill: "github" }], ["Postman", { skill: "postman" }], ["VS Code", { skill: "vscode" }]] },
];

const THEMES = {
  dark: { bg: "#0d1117", border: "#30363d", title: "#3e9ded", label: "#c9d1d9", tile: "#242938", mono: "#ffffff" },
  light: { bg: "#ffffff", border: "#d0d7de", title: "#0969da", label: "#1f2328", tile: "#F4F2ED", mono: "#1f2328" },
};

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "IgnacioOdorico-profile-stack" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes("<svg")) throw new Error("not an SVG");
      return text;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

// skillicons wraps each icon in an outer <svg><g>; keep the inner 256x256 <svg> and namespace its ids.
function innerSkillIcon(svg, prefix) {
  const start = svg.indexOf("<svg", svg.indexOf("<g"));
  const end = svg.lastIndexOf("</svg>", svg.lastIndexOf("</svg>") - 1) + "</svg>".length;
  return svg.slice(start, end)
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
}

function tile(t, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="60" fill="${t.tile}"/>${content}</svg>`;
}

function simpleIconTile(svg, color, t) {
  const path = svg.match(/<path[^>]*d="([^"]+)"/)[1];
  return tile(t, `<path transform="translate(52 52) scale(${(152 / 24).toFixed(4)})" fill="${color || t.mono}" d="${path}"/>`);
}

function sparkleTile(t) {
  // Neutral four-point sparkle: a generic "generative AI" mark, not a brand logo.
  const d = "M128 40c6 44 24 62 68 68-44 6-62 24-68 68-6-44-24-62-68-68 44-6 62-24 68-68z M190 150c3 20 10 27 30 30-20 3-27 10-30 30-3-20-10-27-30-30 20-3 27-10 30-30z";
  return tile(t, `<path fill="#10a37f" d="${d}"/>`);
}

async function loadIcons(theme) {
  const t = THEMES[theme];
  const icons = {};
  let n = 0;
  for (const cat of CATEGORIES) {
    for (const [name, src] of cat.items) {
      const prefix = `${theme[0]}${n++}`;
      if (src.skill) icons[name] = innerSkillIcon(await get(`https://skillicons.dev/icons?i=${src.skill}&theme=${theme}`), prefix);
      else if (src.simple) icons[name] = simpleIconTile(await get(`${SIMPLE_ICONS}/${src.simple}.svg`), src.color, t);
      else icons[name] = sparkleTile(t);
    }
  }
  return icons;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildSvg(theme, icons) {
  const t = THEMES[theme];
  const W = 900, PAD = 24, TITLE_W = 196, ICON = 46, STEP = 100, ROW_H = 86;
  const H = PAD * 2 + CATEGORIES.length * ROW_H - 10;
  let delay = 0.1;
  const rows = CATEGORIES.map((cat, r) => {
    const y = PAD + r * ROW_H;
    const items = cat.items.map(([name], i) => {
      const x = PAD + TITLE_W + i * STEP;
      const cx = x + ICON / 2;
      const el = `<g class="it" style="animation-delay:${delay.toFixed(2)}s"><svg x="${x}" y="${y}" width="${ICON}" height="${ICON}" viewBox="0 0 256 256">${icons[name]}</svg><text class="lb" x="${cx}" y="${y + ICON + 17}" text-anchor="middle">${esc(name)}</text></g>`;
      delay += 0.04;
      return el;
    }).join("");
    const sep = r > 0 ? `<line x1="${PAD}" y1="${y - 13}" x2="${W - PAD}" y2="${y - 13}" stroke="${t.border}" stroke-dasharray="2 5"/>` : "";
    return `${sep}<text class="cat" x="${PAD}" y="${y + ICON / 2 + 5}">${esc(cat.title)}</text>${items}`;
  }).join("\n  ");

  const all = CATEGORIES.flatMap((c) => c.items.map(([n]) => n)).join(", ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title">
  <title id="title">Stack: ${esc(all)}</title>
  <style>
    .cat { font: 700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: ${t.title}; }
    .lb { font: 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: ${t.label}; }
    .it { animation: pop .45s ease-out both; }
    @keyframes pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
  ${rows}
</svg>
`;
}

for (const theme of ["dark", "light"]) {
  const icons = await loadIcons(theme);
  const out = new URL(`../assets/stack/stack-${theme}.svg`, import.meta.url);
  writeFileSync(out, buildSvg(theme, icons));
  console.log("wrote", decodeURIComponent(out.pathname));
}
