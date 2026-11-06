// Builds the animated "neofetch" hero card (dark + light) with a colored ASCII portrait
// generated from assets/source/avatar.png. Zero dependencies: PNG decoding uses zlib.
// Usage: node scripts/build-hero.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// ---------- PNG decoding (8-bit RGB/RGBA, non-interlaced) ----------
function decodePng(path) {
  const buf = readFileSync(path);
  let pos = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("Only 8-bit, non-interlaced PNGs are supported");
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const bpp = { 2: 3, 6: 4 }[colorType];
  if (!bpp) throw new Error(`Unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { width, height, bpp, px };
}

// ---------- Colored grid with an elliptical background mask ----------
const RAMP = " .'`^,:;Il!i><~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

function sampleGrid(img, { cols, rows, crop, mask, background, sharpen }) {
  const { x0, y0, x1, y1 } = crop;
  const cw = (x1 - x0) / cols, ch = (y1 - y0) / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let R = 0, G = 0, B = 0, n = 0;
      for (let y = Math.floor(y0 + r * ch); y < Math.floor(y0 + (r + 1) * ch); y++) {
        for (let x = Math.floor(x0 + c * cw); x < Math.floor(x0 + (c + 1) * cw); x++) {
          const i = (y * img.width + x) * img.bpp;
          R += img.px[i]; G += img.px[i + 1]; B += img.px[i + 2]; n++;
        }
      }
      R /= n; G /= n; B /= n;
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max > 0 ? (max - min) / max : 0;
      const cx = x0 + (c + 0.5) * cw, cy = y0 + (r + 0.5) * ch;
      const d = Math.hypot((cx - mask.cx) / mask.rx, (cy - mask.cy) / mask.ry);
      const keep = Math.min(1, Math.max(0, (1 - d) / mask.feather + 1)); // 1 inside, fades to 0 past the edge
      cells.push({ R, G, B, sat, lum: (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255, keep });
    }
  }

  // Mark the bright, unsaturated wall: flood-fill from the borders so pale spots inside the face survive.
  const isBg = (c) => c.lum > background.minLum && c.sat < background.maxSat;
  const queue = [];
  for (let r = 0; r < rows; r++) for (const c of [0, cols - 1]) queue.push(r * cols + c);
  for (let c = 0; c < cols; c++) for (const r of [0, rows - 1]) queue.push(r * cols + c);
  const seen = new Uint8Array(cells.length);
  while (queue.length) {
    const i = queue.pop();
    if (seen[i] || !isBg(cells[i])) continue;
    seen[i] = 1;
    cells[i].wall = true;
    const r = Math.floor(i / cols), c = i % cols;
    if (r > 0) queue.push(i - cols);
    if (r < rows - 1) queue.push(i + cols);
    if (c > 0) queue.push(i - 1);
    if (c < cols - 1) queue.push(i + 1);
  }

  const inside = cells.filter((c) => c.keep > 0.5).map((c) => c.lum).sort((a, b) => a - b);
  const lo = inside[Math.floor(inside.length * 0.02)], hi = inside[Math.floor(inside.length * 0.98)];
  const base = cells.map((c) => Math.min(1, Math.max(0, (c.lum - lo) / (hi - lo))));
  // Local contrast (unsharp mask over a 3x3 neighbourhood) so the eyes, nose and mouth stand out.
  cells.forEach((cell, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    let sum = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) { sum += base[rr * cols + cc]; n++; }
    }
    cell.v = Math.min(1, Math.max(0, base[i] + sharpen * (base[i] - sum / n)));
  });
  return { cols, rows, cells };
}

const hex = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

function tint({ R, G, B }) {
  // True pixel color with a saturation boost: the color carries the likeness, the glyphs add texture.
  // Dark pixels stay dark on purpose (they read as shadows on the dark terminal).
  const m = (R + G + B) / 3, s = 1.6, gain = 1.12;
  const ch = [R, G, B].map((x) => (m + (x - m) * s) * gain);
  const q = 12; // quantize so neighbouring glyphs share a <tspan>
  return "#" + ch.map((x) => hex(Math.round(x / q) * q)).join("");
}

// Halftone portrait: one dot per cell, true color, radius grows with brightness.
// (Plain ASCII was tried first: at 6px the glyphs carry too little ink and the likeness is lost.)
function portraitRows(grid, cell) {
  const rows = [];
  for (let r = 0; r < grid.rows; r++) {
    const dots = [];
    for (let c = 0; c < grid.cols; c++) {
      const px = grid.cells[r * grid.cols + c];
      if (px.keep < 0.05) continue;
      // The bright, colorless wall that peeks in at the edge of the ellipse: shrink and dim it.
      const wall = px.wall === true;
      const radius = (cell / 2) * (0.28 + 0.72 * Math.sqrt(px.v)) * Math.min(1, px.keep) * (wall ? 0.32 : 1);
      if (radius < 0.45) continue;
      const fill = wall ? "#30363d" : tint(px);
      dots.push(`<circle cx="${((c + 0.5) * cell).toFixed(1)}" cy="${((r + 0.5) * cell).toFixed(1)}" r="${radius.toFixed(2)}" fill="${fill}"/>`);
    }
    rows.push(dots.join(""));
  }
  return rows;
}

// ---------- Card content (same claims as the CV) ----------
const INFO = [
  ["Rol", "Programador UTN · Desarrollador Full Stack"],
  ["Enfoque", "IA aplicada y automatización"],
  ["Ubicación", "Mendoza, Argentina · remoto o híbrido"],
  ["Backend", "Python · FastAPI · Java · Spring Boot · Node.js"],
  ["Frontend", "React · TypeScript · Tailwind CSS"],
  ["Datos", "PostgreSQL · MySQL · SQLite · MongoDB"],
  ["IA", "n8n · OpenAI · LLMs · bots de WhatsApp y Telegram"],
  ["IA dev", "Claude Code · SDD/OpenSpec · ODD · Engram · MCP"],
  ["Calidad", "+3.000 tests · TDD · Docker · GitHub Actions"],
  ["Proyectos", "Anzuelo · Active Trace · Atendo · FoodStore · +2"],
  ["Estado", "Buscando mi próximo equipo"],
];

const THEMES = {
  dark: { bg: "#0d1117", panel: "#161b22", border: "#30363d", text: "#c9d1d9", muted: "#8b949e", key: "#3e9ded", title: "#e6edf3", prompt: "#3fb950", scan: "#3e9ded" },
  light: { bg: "#0d1117", panel: "#161b22", border: "#8c959f", text: "#c9d1d9", muted: "#8b949e", key: "#3e9ded", title: "#e6edf3", prompt: "#3fb950", scan: "#3e9ded" },
};
const PALETTE = ["#f85149", "#f0883e", "#d29922", "#3fb950", "#3e9ded", "#a371f7", "#db61a2", "#8b949e"];

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildSvg(grid, theme) {
  const t = THEMES[theme];
  const W = 900, H = 440;
  const CELL = 6, PX = 22, PY = 56;
  const rows = portraitRows(grid, CELL);
  const portrait = rows.map((dots, r) => {
    const cls = r % 13 === 6 ? "row g" : "row";
    return `<g class="${cls}" style="animation-delay:${(0.2 + r * 0.03).toFixed(3)}s">${dots}</g>`;
  }).join("\n    ");

  const IX = 354, KEYW = 92;
  let y = 82;
  let delay = 0.5;
  const lines = [];
  const reveal = (content) => {
    lines.push(`<g class="type" style="animation-delay:${delay.toFixed(2)}s">${content}</g>`);
    delay += 0.22;
  };
  const prompt = `<tspan fill="${t.prompt}">ignacio@odorico</tspan><tspan fill="${t.muted}">:~$ </tspan>`;
  reveal(`<text x="${IX}" y="${y}">${prompt}<tspan fill="${t.text}">neofetch</tspan></text>`);
  y += 30;
  reveal(`<text x="${IX}" y="${y}" class="name">Ignacio Martin Odorico</text>`);
  y += 12;
  reveal(`<rect x="${IX}" y="${y}" width="250" height="2" rx="1" fill="${t.key}"/>`);
  y += 24;
  for (const [k, v] of INFO) {
    reveal(`<text x="${IX}" y="${y}" fill="${t.key}" font-weight="700">${esc(k)}</text><text x="${IX + KEYW}" y="${y}" fill="${t.text}">${esc(v)}</text>`);
    y += 21;
  }
  y += 6;
  reveal(PALETTE.map((c, i) => `<rect x="${IX + i * 26}" y="${y}" width="22" height="14" rx="3" fill="${c}"/>`).join(""));
  y += 40;
  reveal(`<text x="${IX}" y="${y}">${prompt}</text><rect class="cursor" x="${IX + 160}" y="${y - 12}" width="9" height="16" fill="${t.text}"/>`);

  const scanH = rows.length * CELL;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
  <title id="title">Ignacio Martin Odorico · Programador UTN · Desarrollador Full Stack</title>
  <desc id="desc">Retrato de puntos a color y tarjeta estilo terminal con rol, stack, IA aplicada, calidad y proyectos.</desc>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 13px; white-space: pre; }
    .name { font-size: 20px; font-weight: 700; fill: ${t.title}; }
    .title { font-size: 12px; fill: ${t.muted}; }
    .row { animation: rowIn .5s ease-out both; }
    .g { animation: rowIn .5s ease-out both, glitch 7s steps(1) 3s infinite; }
    .type { animation: typeIn .6s steps(28) both; }
    .scan { animation: scan 5s linear 2s infinite; }
    .cursor { animation: blink 1s steps(1) infinite; }
    @keyframes rowIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes typeIn { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
    @keyframes glitch { 0%, 94%, 100% { transform: translateX(0); } 95% { transform: translateX(4px); } 97% { transform: translateX(-3px); } }
    @keyframes scan { 0% { transform: translateY(0); opacity: 0; } 8% { opacity: .55; } 92% { opacity: .55; } 100% { transform: translateY(${scanH.toFixed(0)}px); opacity: 0; } }
    @keyframes blink { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  <path d="M0.5 14.5a14 14 0 0 1 14-14h${W - 29}a14 14 0 0 1 14 14v21.5h-${W - 1}z" fill="${t.panel}"/>
  <line x1="0.5" y1="36" x2="${W - 0.5}" y2="36" stroke="${t.border}"/>
  <circle cx="22" cy="18" r="6" fill="#ff5f56"/><circle cx="42" cy="18" r="6" fill="#ffbd2e"/><circle cx="62" cy="18" r="6" fill="#27c93f"/>
  <text class="title" x="${W / 2}" y="22" text-anchor="middle">ignacio@odorico: ~ — zsh</text>
  <g class="portrait" transform="translate(${PX} ${PY})">
    ${portrait}
  </g>
  <rect class="scan" x="${PX - 4}" y="${PY}" width="${grid.cols * CELL + 8}" height="2" fill="${t.scan}" opacity="0"/>
  <line x1="334" y1="56" x2="334" y2="${H - 22}" stroke="${t.border}" stroke-dasharray="2 4"/>
  ${lines.join("\n  ")}
</svg>
`;
}

// ---------- Main ----------
const img = decodePng(new URL("../assets/source/avatar.png", import.meta.url));
const grid = sampleGrid(img, {
  cols: 48, rows: 62,
  crop: { x0: 68, y0: 28, x1: 332, y1: 369 },
  // Ellipse fitted to the hood (measured on a color mosaic): it separates the face from the bright wall.
  mask: { cx: 200, cy: 196, rx: 130, ry: 170, feather: 0.05 },
  background: { minLum: 0.72, maxSat: 0.14 }, // strict: the lit side of the face is close to the wall color
  sharpen: 0.35,
});
// The card is a terminal, so it is dark in both GitHub themes; only the outer border adapts.
for (const theme of ["dark", "light"]) {
  const out = new URL(`../assets/hero-${theme}.svg`, import.meta.url);
  writeFileSync(out, buildSvg(grid, theme));
  console.log("wrote", decodeURIComponent(out.pathname));
}
