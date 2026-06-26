import { createServer } from "node:http";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "static/images/social");
const TMP_DIR = join(ROOT, ".gif-frames");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HOST = "127.0.0.1";
const HTTP_PORT = 4187;
const DEBUG_PORT = 9337;
const EXPORT_ROUTE = "/gif-export.html";
const SOCIAL_WIDTH = 1920;
const SOCIAL_VIEWPORT = { width: 2160, height: 1600, deviceScaleFactor: 1 };

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
]);

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${cmd} exited with ${code}`));
    });
  });
}

async function rmRetry(path, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await delay(200);
    }
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveStop) => child.once("exit", resolveStop)),
    delay(2000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${HOST}:${HTTP_PORT}`);
      if (url.pathname === EXPORT_ROUTE) {
        const data = await readFile(join(TMP_DIR, "gif-export.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
        return;
      }
      const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const file = normalize(join(ROOT, requested));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME.get(extname(file)) || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });

  return new Promise((resolveServer) => {
    server.listen(HTTP_PORT, HOST, () => resolveServer(server));
  });
}

async function createExportPage() {
  const html = await readFile(join(ROOT, "index.html"), "utf8");
  const css = `
  <style id="gif-export-style">
    html.gif-export, body.gif-export {
      background:#fff !important;
      margin:0 !important;
      overflow:hidden !important;
    }
    html.gif-export .container.is-max-desktop {
      width:${SOCIAL_WIDTH}px !important;
      max-width:${SOCIAL_WIDTH}px !important;
    }
    html.gif-export .results-section .container {
      width:1500px !important;
      max-width:1500px !important;
    }
    html.gif-export #overviewDemo,
    html.gif-export #sigregDemo,
    html.gif-export #vlmBridgeDemo {
      box-sizing:border-box !important;
      width:${SOCIAL_WIDTH}px !important;
      max-width:${SOCIAL_WIDTH}px !important;
      margin:0 !important;
      padding:0 70px 42px !important;
      background:#fff !important;
    }
    html.gif-export #zeroShotChart,
    html.gif-export #linearProbeChart,
    html.gif-export #segmentationBarsChart,
    html.gif-export #frozenBackboneBars {
      box-sizing:border-box !important;
      width:1500px !important;
      max-width:1500px !important;
      margin:0 !important;
      padding:46px 56px !important;
      background:#fff !important;
    }
    html.gif-export #frozenBackboneBars {
      display:grid !important;
      grid-template-columns:repeat(2, minmax(0, 1fr)) !important;
      gap:28px !important;
      border:0 !important;
      border-radius:0 !important;
    }
    html.gif-export #zeroShotChart,
    html.gif-export #linearProbeChart,
    html.gif-export #segmentationBarsChart,
    html.gif-export #frozenBackboneBars .chart-card {
      padding:30px 32px 28px !important;
      border-color:#e7edf2 !important;
      border-radius:8px !important;
    }
    html.gif-export #zeroShotChart h4,
    html.gif-export #linearProbeChart h4,
    html.gif-export #segmentationBarsChart h4,
    html.gif-export #frozenBackboneBars .chart-card h4 {
      font-size:22px !important;
      margin-bottom:18px !important;
    }
    html.gif-export #zeroShotChart .chart-legend,
    html.gif-export #linearProbeChart .chart-legend,
    html.gif-export #segmentationBarsChart .chart-legend,
    html.gif-export #frozenBackboneBars .chart-legend {
      gap:12px 24px !important;
      margin-bottom:22px !important;
    }
    html.gif-export #zeroShotChart .legend-item,
    html.gif-export #linearProbeChart .legend-item,
    html.gif-export #segmentationBarsChart .legend-item,
    html.gif-export #frozenBackboneBars .legend-item {
      font-size:14px !important;
    }
    html.gif-export #zeroShotChart .swatch,
    html.gif-export #linearProbeChart .swatch,
    html.gif-export #segmentationBarsChart .swatch,
    html.gif-export #frozenBackboneBars .swatch {
      width:14px !important;
      height:14px !important;
    }
    html.gif-export #zeroShotChart .bar-group,
    html.gif-export #linearProbeChart .bar-group,
    html.gif-export #segmentationBarsChart .bar-group,
    html.gif-export #frozenBackboneBars .bar-group {
      gap:18px !important;
    }
    html.gif-export #zeroShotChart .bar-row,
    html.gif-export #linearProbeChart .bar-row,
    html.gif-export #segmentationBarsChart .bar-row,
    html.gif-export #frozenBackboneBars .bar-row {
      grid-template-columns:132px 1fr !important;
      gap:20px !important;
    }
    html.gif-export #zeroShotChart .bar-label,
    html.gif-export #linearProbeChart .bar-label,
    html.gif-export #segmentationBarsChart .bar-label,
    html.gif-export #frozenBackboneBars .bar-label {
      font-size:14px !important;
      letter-spacing:.1em !important;
    }
    html.gif-export #zeroShotChart .bar-stack,
    html.gif-export #linearProbeChart .bar-stack,
    html.gif-export #segmentationBarsChart .bar-stack,
    html.gif-export #frozenBackboneBars .bar-stack {
      gap:7px !important;
    }
    html.gif-export #zeroShotChart .bar,
    html.gif-export #linearProbeChart .bar,
    html.gif-export #segmentationBarsChart .bar,
    html.gif-export #frozenBackboneBars .bar {
      grid-template-columns:98px minmax(0, 1fr) 64px !important;
      gap:12px !important;
      font-size:15px !important;
    }
    html.gif-export #zeroShotChart .bar-track,
    html.gif-export #linearProbeChart .bar-track,
    html.gif-export #segmentationBarsChart .bar-track,
    html.gif-export #frozenBackboneBars .bar-track {
      height:15px !important;
    }
    html.gif-export #zeroShotChart .bar-value,
    html.gif-export #linearProbeChart .bar-value,
    html.gif-export #segmentationBarsChart .bar-value,
    html.gif-export #frozenBackboneBars .bar-value {
      font-size:14px !important;
    }
    html.gif-export #zeroShotChart .result-note,
    html.gif-export #linearProbeChart .result-note,
    html.gif-export #segmentationBarsChart .result-note,
    html.gif-export #frozenBackboneBars .result-note {
      display:none !important;
    }
    html.gif-export .demo-head,
    html.gif-export .figure-caption,
    html.gif-export .cbtn,
    html.gif-export #sigAuto,
    html.gif-export #sigResample {
      display:none !important;
    }
    html.gif-export .controls {
      display:block !important;
      margin:26px 0 0 !important;
    }
    html.gif-export .stage {
      display:block !important;
      min-width:0 !important;
      margin:0 0 20px !important;
      font-size:34px !important;
      line-height:1.25 !important;
      letter-spacing:.02em !important;
    }
    html.gif-export .stage b { font-size:34px !important; }
    html.gif-export .track {
      display:block !important;
      width:100% !important;
      height:12px !important;
      margin:0 !important;
    }
    html.gif-export .track-dot {
      width:18px !important;
      height:18px !important;
      margin:-9px 0 0 -9px !important;
      border-width:2px !important;
    }
    html.gif-export .sig-controls {
      display:block !important;
      margin:28px 0 0 !important;
    }
    html.gif-export .slider-wrap {
      display:flex !important;
      width:100% !important;
      min-width:0 !important;
      flex-basis:auto !important;
      gap:16px !important;
    }
    html.gif-export .slider-scale {
      font-size:30px !important;
      letter-spacing:.12em !important;
      color:#7f8b96 !important;
    }
    html.gif-export input[type=range] {
      display:block !important;
      width:100% !important;
      height:12px !important;
    }
    html.gif-export input[type=range]::-webkit-slider-thumb {
      width:34px !important;
      height:34px !important;
    }
    html.gif-export input[type=range]::-moz-range-thumb {
      width:34px !important;
      height:34px !important;
    }
  </style>`;
  const exportHtml = html
    .replace("<html lang=\"en\">", "<html lang=\"en\" class=\"gif-export\">")
    .replace("<body>", "<body class=\"gif-export\">")
    .replace("</head>", `${css}\n</head>`);
  await writeFile(join(TMP_DIR, "gif-export.html"), exportHtml);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function waitForChrome() {
  const versionUrl = `http://${HOST}:${DEBUG_PORT}/json/version`;
  const pagesUrl = `http://${HOST}:${DEBUG_PORT}/json`;
  for (let i = 0; i < 80; i++) {
    try {
      await fetchJson(versionUrl);
      const pages = await fetchJson(pagesUrl);
      const page = pages.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
    }
    await delay(125);
  }
  throw new Error("Chrome DevTools endpoint did not come up.");
}

function createCdp(wsUrl) {
  let id = 0;
  const pending = new Map();
  const waiters = new Map();
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolveSend, rejectSend } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rejectSend(new Error(JSON.stringify(msg.error)));
      else resolveSend(msg.result || {});
      return;
    }
    if (msg.method && waiters.has(msg.method)) {
      const callbacks = waiters.get(msg.method).splice(0);
      callbacks.forEach((cb) => cb(msg.params || {}));
    }
  });

  const opened = new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", rejectOpen, { once: true });
  });

  async function send(method, params = {}) {
    await opened;
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      pending.set(msgId, { resolveSend, rejectSend });
    });
  }

  function waitFor(method) {
    return new Promise((resolveWait) => {
      if (!waiters.has(method)) waiters.set(method, []);
      waiters.get(method).push(resolveWait);
    });
  }

  return { send, waitFor, close: () => ws.close() };
}

async function evalInPage(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function captureElement(cdp, selector, outFile) {
  const rect = await evalInPage(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
  })()`);

  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    clip: {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: rect.width,
      height: rect.height,
      scale: 1,
    },
  });
  await writeFile(outFile, Buffer.from(shot.data, "base64"));
}

async function waitForPaint(cdp) {
  await evalInPage(cdp, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
}

async function scrollTo(cdp, selector) {
  await evalInPage(cdp, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" })`);
  await delay(180);
  await waitForPaint(cdp);
}

async function prepareExportLayout(cdp) {
  await evalInPage(cdp, `(() => {
    const style = document.createElement("style");
    style.textContent = \`
      .container.is-max-desktop {
        width: ${SOCIAL_WIDTH}px !important;
        max-width: ${SOCIAL_WIDTH}px !important;
      }
      #overviewDemo, #sigregDemo, #vlmBridgeDemo {
        width: ${SOCIAL_WIDTH}px !important;
        max-width: ${SOCIAL_WIDTH}px !important;
        padding: 0 70px 42px !important;
      }
      .demo-head { margin-bottom: 16px; }
      .demo-kicker { font-size: 14px; letter-spacing: .18em; color: #7f8b96; }
      .controls, .sig-controls { margin-top: 26px; gap: 16px; }
      .stage {
        display:block !important;
        font-size: 34px !important;
        line-height: 1.25 !important;
        letter-spacing:.02em !important;
        margin-bottom:20px !important;
        flex-basis:auto !important;
      }
      .stage b { font-size: 34px !important; }
      .cbtn { font-size: 13px; padding: 8px 14px; }
      .track { height: 12px !important; margin-top: 0 !important; }
      .track-dot { width: 18px !important; height: 18px !important; margin: -9px 0 0 -9px !important; }
      .slider-wrap { flex-basis: 640px; }
      .slider-scale { font-size: 30px !important; color: #7f8b96; }
      input[type=range] { height: 12px !important; }
      input[type=range]::-webkit-slider-thumb { width: 34px !important; height: 34px !important; }
      input[type=range]::-moz-range-thumb { width: 34px !important; height: 34px !important; }
    \`;
    document.head.appendChild(style);
  })()`);
  await waitForPaint(cdp);
}

async function scrubDiagram(cdp, u) {
  await evalInPage(cdp, `window.__levljepaExport.renderOverview(${u})`);
  await waitForPaint(cdp);
}

async function scrubSigreg(cdp, u) {
  await evalInPage(cdp, `window.__levljepaExport.renderSigreg(${u})`);
  await waitForPaint(cdp);
}

async function scrubTransfer(cdp, u) {
  await evalInPage(cdp, `window.__levljepaExport.renderTransfer(${u})`);
  await waitForPaint(cdp);
}

async function encodeGif(frameDir, outFile, fps, width) {
  const palette = join(frameDir, "palette.png");
  const input = join(frameDir, "frame-%04d.png");
  await run("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", input,
    "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    "-frames:v", "1",
    "-update", "1",
    palette,
  ]);
  await run("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", input,
    "-i", palette,
    "-lavfi", `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    "-loop", "0",
    outFile,
  ]);
}

async function encodeMp4(frameDir, outFile, fps, width) {
  const input = join(frameDir, "frame-%04d.png");
  await run("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", input,
    "-vf", `fps=${fps},scale=${width}:-2:flags=lanczos`,
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "16",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outFile,
  ]);
}

function smoothstep(x) {
  return x * x * (3 - 2 * x);
}

function continuousRange(from, to) {
  return (phase) => from + (to - from) * smoothstep(Math.max(0, Math.min(1, phase)));
}

function heldKeyframes(points, holdWeight = 0.55, moveWeight = 1) {
  const pieces = [];
  for (let i = 0; i < points.length; i++) {
    pieces.push({ type: "hold", from: points[i], to: points[i], weight: holdWeight });
    if (i < points.length - 1) {
      pieces.push({ type: "move", from: points[i], to: points[i + 1], weight: moveWeight });
    }
  }
  const total = pieces.reduce((sum, piece) => sum + piece.weight, 0);
  return (phase) => {
    let cursor = Math.max(0, Math.min(1, phase)) * total;
    for (const piece of pieces) {
      if (cursor <= piece.weight) {
        if (piece.type === "hold") return piece.from;
        const t = smoothstep(cursor / piece.weight);
        return piece.from + (piece.to - piece.from) * t;
      }
      cursor -= piece.weight;
    }
    return points[points.length - 1];
  };
}

async function exportAnimation(cdp, config) {
  const frameDir = join(TMP_DIR, config.name);
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
  await scrollTo(cdp, config.selector);

  const frames = Math.round(config.seconds * config.fps);
  for (let i = 0; i < frames; i++) {
    const phase = frames <= 1 ? 0 : i / (frames - 1);
    await config.scrub(cdp, config.mapPhase(phase));
    await captureElement(cdp, config.selector, join(frameDir, `frame-${String(i).padStart(4, "0")}.png`));
    if ((i + 1) % 20 === 0 || i + 1 === frames) {
      process.stdout.write(`${config.name}: ${i + 1}/${frames} frames\r`);
    }
  }
  process.stdout.write("\n");

  const gifFile = join(OUT_DIR, `${config.name}.gif`);
  const mp4File = join(OUT_DIR, `${config.name}.mp4`);
  await encodeGif(frameDir, gifFile, config.fps, config.width);
  await encodeMp4(frameDir, mp4File, config.fps, config.width);
  return [gifFile, mp4File];
}

async function exportStill(cdp, config) {
  if (config.hide?.length) {
    await evalInPage(cdp, `(() => {
      for (const selector of ${JSON.stringify(config.hide)}) {
        document.querySelectorAll(selector).forEach((el) => {
          el.dataset.gifExportDisplay = el.style.display || "";
          el.style.display = "none";
        });
      }
    })()`);
  }
  await scrollTo(cdp, config.selector);
  await waitForPaint(cdp);
  const outFile = join(OUT_DIR, `${config.name}.png`);
  await captureElement(cdp, config.selector, outFile);
  if (config.hide?.length) {
    await evalInPage(cdp, `(() => {
      for (const selector of ${JSON.stringify(config.hide)}) {
        document.querySelectorAll(selector).forEach((el) => {
          el.style.display = el.dataset.gifExportDisplay || "";
          delete el.dataset.gifExportDisplay;
        });
      }
    })()`);
  }
  return outFile;
}

async function exportSocialCharts() {
  await run(process.execPath, [join(ROOT, "scripts/export-social-charts.mjs")]);
  return [
    join(OUT_DIR, "levljepa-zero-shot-transfer.png"),
    join(OUT_DIR, "levljepa-linear-probing.png"),
    join(OUT_DIR, "levljepa-segmentation.png"),
    join(OUT_DIR, "levljepa-frozen-vlm-backbone.png"),
  ];
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });
  await createExportPage();

  const server = await startServer();
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    `--user-data-dir=${join(TMP_DIR, "chrome-profile")}`,
    `http://${HOST}:${HTTP_PORT}/index.html`,
  ], { stdio: ["ignore", "ignore", "ignore"] });

  let cdp;
  try {
    const { webSocketDebuggerUrl } = await waitForChrome();
    cdp = createCdp(webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: SOCIAL_VIEWPORT.width,
      height: SOCIAL_VIEWPORT.height,
      deviceScaleFactor: SOCIAL_VIEWPORT.deviceScaleFactor,
      mobile: false,
    });
    const loaded = cdp.waitFor("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `http://${HOST}:${HTTP_PORT}${EXPORT_ROUTE}` });
    await loaded;
    await delay(500);
    await prepareExportLayout(cdp);

    const outputs = [];
    outputs.push(...await exportAnimation(cdp, {
      name: "levljepa-overview",
      selector: "#overviewDemo",
      fps: 30,
      seconds: 17.6,
      width: SOCIAL_WIDTH,
      scrub: scrubDiagram,
      mapPhase: continuousRange(0.06, 0.99),
    }));
    outputs.push(...await exportAnimation(cdp, {
      name: "levljepa-sigreg",
      selector: "#sigregDemo",
      fps: 30,
      seconds: 12.8,
      width: SOCIAL_WIDTH,
      scrub: scrubSigreg,
      mapPhase: continuousRange(0, 1),
    }));
    outputs.push(...await exportAnimation(cdp, {
      name: "levljepa-mlp-bridge",
      selector: "#vlmBridgeDemo",
      fps: 30,
      seconds: 14,
      width: SOCIAL_WIDTH,
      scrub: scrubTransfer,
      mapPhase: continuousRange(0.04, 0.96),
    }));
    outputs.push(...await exportSocialCharts());

    console.log("Wrote:");
    for (const file of outputs) {
      console.log(`- ${file.replace(`${ROOT}/`, "")}`);
    }
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    server.close();
    await rmRetry(TMP_DIR);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
