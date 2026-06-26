import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "static/images/social");
const TMP_DIR = join(ROOT, ".social-chart-frames");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const W = 1600;
const H = 1000;
const SEGMENTATION_H = 820;
const VLM_H = 1240;

const C = {
  bg: "#fbfaf7",
  card: "#ffffff",
  ink: "#17212b",
  muted: "#687783",
  faint: "#e6edf2",
  legendBg: "#f5f8fa",
  track: "#edf2f5",
  InfoNCE: "#8ea1b4",
  SigLIP: "#c8794a",
  LeVLJEPA: "#226999",
};

const methods = ["InfoNCE", "SigLIP", "LeVLJEPA"];

const charts = [
  {
    file: "levljepa-zero-shot-transfer.png",
    title: "Zero-shot transfer",
    subtitle: "Top-1 accuracy (%) with pooled image-text alignment",
    note: "Higher is better. Shared 0-90% axis across datasets.",
    max: 90,
    ticks: [0, 30, 60, 90],
    groups: [
      { label: "ImageNet", values: { InfoNCE: 47.32, SigLIP: 50.78, LeVLJEPA: 42.45 } },
      { label: "Places365", values: { InfoNCE: 34.46, SigLIP: 33.76, LeVLJEPA: 29.97 } },
      { label: "Aircraft", values: { InfoNCE: 8.10, SigLIP: 10.62, LeVLJEPA: 7.65 } },
      { label: "Pets", values: { InfoNCE: 68.98, SigLIP: 77.27, LeVLJEPA: 59.63 } },
    ],
  },
  {
    file: "levljepa-linear-probing.png",
    title: "Linear probing",
    subtitle: "Accuracy (%) from frozen CLS features",
    note: "Higher is better. Text encoder removed; pooled visual features are close.",
    max: 90,
    ticks: [0, 30, 60, 90],
    groups: [
      { label: "ImageNet", values: { InfoNCE: 65.75, SigLIP: 66.34, LeVLJEPA: 65.42 } },
      { label: "Places365", values: { InfoNCE: 37.11, SigLIP: 36.81, LeVLJEPA: 36.07 } },
      { label: "Aircraft", values: { InfoNCE: 44.10, SigLIP: 47.46, LeVLJEPA: 46.38 } },
      { label: "Pets", values: { InfoNCE: 82.86, SigLIP: 82.64, LeVLJEPA: 81.28 } },
    ],
  },
  {
    file: "levljepa-segmentation.png",
    height: SEGMENTATION_H,
    title: "Linear segmentation",
    subtitle: "mIoU (%) from frozen patch tokens",
    note: "Higher is better. A single linear head reads dense semantic structure.",
    max: 35,
    ticks: [0, 10, 20, 30],
    groups: [
      { label: "ADE20K", values: { InfoNCE: 20.90, SigLIP: 19.24, LeVLJEPA: 23.15 } },
      { label: "COCO-Stuff", values: { InfoNCE: 29.02, SigLIP: 28.88, LeVLJEPA: 31.10 } },
    ],
  },
];

const frozenVlm = {
  file: "levljepa-frozen-vlm-backbone.png",
  title: "Frozen VLM backbone",
  subtitle: "Accuracy gain over a random vision encoder (percentage points)",
  note: "Higher is better. Encoder and LLM stay frozen; only the MLP bridge is trained.",
  max: 25,
  ticks: [0, 5, 10, 15, 20, 25],
  groups: [
    { label: "Llama-1B", sublabel: "GQA", values: { InfoNCE: 6.3, SigLIP: 6.0, LeVLJEPA: 8.2 } },
    { label: "Llama-1B", sublabel: "VQAv2", values: { InfoNCE: 8.4, SigLIP: 6.0, LeVLJEPA: 11.0 } },
    { label: "Llama-1B", sublabel: "POPE", values: { InfoNCE: 16.2, SigLIP: 12.4, LeVLJEPA: 17.3 } },
    { label: "Qwen-1.5B", sublabel: "GQA", values: { InfoNCE: 5.2, SigLIP: 4.6, LeVLJEPA: 6.7 } },
    { label: "Qwen-1.5B", sublabel: "VQAv2", values: { InfoNCE: 5.8, SigLIP: 4.1, LeVLJEPA: 10.5 } },
    { label: "Qwen-1.5B", sublabel: "POPE", values: { InfoNCE: 19.1, SigLIP: 18.0, LeVLJEPA: 22.6 } },
  ],
};

function run(cmd, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${cmd} exited with ${code}`));
    });
  });
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function t(x, y, value, size, attrs = {}) {
  const attr = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<text x="${x}" y="${y}" font-size="${size}" ${attr}>${esc(value)}</text>`;
}

function rect(x, y, width, height, fill, attrs = {}) {
  const attr = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${attr}/>`;
}

function line(x1, y1, x2, y2, attrs = {}) {
  const attr = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attr}/>`;
}

function legend(x, y) {
  const widths = [158, 144, 190];
  let cursor = x;
  return methods.map((method, i) => {
    const dx = cursor;
    cursor += widths[i] + 16;
    return [
      rect(dx, y - 34, widths[i], 48, C.legendBg, { rx: 24, stroke: C.faint, "stroke-width": 2 }),
      rect(dx + 18, y - 19, 30, 18, C[method], { rx: 6 }),
      t(dx + 60, y - 2, method, 24, { fill: C.ink, "font-weight": method === "LeVLJEPA" ? 850 : 700 }),
    ].join("");
  }).join("");
}

function axis(plotX, plotY, plotW, plotH, max, ticks, suffix = "") {
  return ticks.map((tick) => {
    const x = plotX + (tick / max) * plotW;
    return [
      line(x, plotY, x, plotY + plotH, { stroke: C.faint, "stroke-width": 2 }),
      t(x, plotY + plotH + 42, `${tick}${suffix}`, 23, { fill: C.muted, "text-anchor": "middle", "font-weight": 600 }),
    ].join("");
  }).join("");
}

function valueText(value, plus = false) {
  const prefix = plus && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(value >= 10 ? 1 : 1)}`;
}

function drawGroupedBars(config, height = H) {
  const isDense = config.groups.length > 4;
  const plotX = isDense ? 430 : 410;
  const plotY = config.groups.length > 4 ? 255 : 280;
  const plotW = isDense ? 830 : 850;
  const barH = 28;
  const methodGap = 14;
  const groupStep = isDense ? 136 : (config.groups.length === 2 ? 210 : 146);
  const sectionGap = isDense ? 46 : 0;
  const groupY = (i) => plotY + i * groupStep + (isDense && i >= 3 ? sectionGap : 0);
  const lastY = groupY(config.groups.length - 1);
  const plotH = lastY - plotY + methods.length * barH + (methods.length - 1) * methodGap;
  const plus = config.file.includes("frozen");

  const body = [];
  body.push(rect(0, 0, W, height, C.bg));
  body.push(rect(46, 46, W - 92, height - 92, C.card, { rx: 26, stroke: "#edf1f3", "stroke-width": 2 }));
  body.push(t(92, 122, "LeVLJEPA", 24, { fill: C.muted, "font-weight": 800, "letter-spacing": 4 }));
  body.push(t(92, 190, config.title, 64, { fill: C.ink, "font-weight": 850 }));
  body.push(t(94, 236, config.subtitle, 29, { fill: C.muted, "font-weight": 550 }));
  body.push(legend(970, 144));
  body.push(axis(plotX, isDense ? plotY : plotY - 28, plotW, isDense ? plotH : plotH + 56, config.max, config.ticks));

  config.groups.forEach((group, i) => {
    const y0 = groupY(i);
    body.push(t(92, y0 + 24, group.label, 28, { fill: C.ink, "font-weight": 800 }));
    if (group.sublabel) body.push(t(92, y0 + 60, group.sublabel, 25, { fill: C.muted, "font-weight": 700 }));

    methods.forEach((method, j) => {
      const y = y0 + j * (barH + methodGap);
      const value = group.values[method];
      const w = Math.max(4, (value / config.max) * plotW);
      body.push(t(isDense ? 285 : 275, y + 22, method, 24, { fill: method === "LeVLJEPA" ? C.ink : C.muted, "font-weight": method === "LeVLJEPA" ? 850 : 650 }));
      body.push(rect(plotX, y, plotW, barH, C.track, { rx: 14 }));
      body.push(rect(plotX, y, w, barH, C[method], { rx: 14 }));
      if (method === "LeVLJEPA") {
        body.push(`<rect x="${plotX - 5}" y="${y - 5}" width="${w + 10}" height="${barH + 10}" fill="none" stroke="${C.LeVLJEPA}" stroke-width="3" rx="19" opacity=".28"/>`);
      }
      body.push(t(plotX + w + 18, y + 23, valueText(value, plus), 25, { fill: method === "LeVLJEPA" ? C.ink : C.muted, "font-weight": method === "LeVLJEPA" ? 850 : 700 }));
    });
  });

  body.push(t(92, height - 74, config.note, 26, { fill: C.muted, "font-weight": 600 }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">
  <style>
    text { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; dominant-baseline: alphabetic; }
  </style>
  ${body.join("\n")}
</svg>`;
}

async function renderPng(file, svg, height = H) {
  const htmlFile = join(TMP_DIR, `${file}.html`);
  const outFile = join(OUT_DIR, file);
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;background:${C.bg};width:${W}px;height:${height}px;overflow:hidden}svg{display:block}</style></head>
<body>${svg}</body>
</html>`;
  await writeFile(htmlFile, html, "utf8");
  await run(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    `--window-size=${W},${height}`,
    `--screenshot=${outFile}`,
    pathToFileURL(htmlFile).href,
  ]);
  return outFile;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const outputs = [];
  for (const chart of charts) {
    const height = chart.height || H;
    outputs.push(await renderPng(chart.file, drawGroupedBars(chart, height), height));
  }
  outputs.push(await renderPng(frozenVlm.file, drawGroupedBars(frozenVlm, VLM_H), VLM_H));

  await rm(TMP_DIR, { recursive: true, force: true });
  console.log("Wrote:");
  outputs.forEach((file) => console.log(`- ${file.replace(`${ROOT}/`, "")}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
