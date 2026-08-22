/** Side-by-side prompt comparison gallery — live chip filters, optional depth. */
let PAYLOAD = { prompts: [], stats: {}, records: [] };
let TEXTS = {};
const DISPLAY_STEP = 200;
let displayLimit = DISPLAY_STEP;

const COLORMAPS = {
  turbo: [
    [0.19, 0.07, 0.39], [0.12, 0.28, 0.87], [0.01, 0.65, 0.93], [0.18, 0.87, 0.44],
    [0.63, 0.95, 0.18], [0.99, 0.77, 0.06], [0.91, 0.32, 0.05], [0.55, 0.04, 0.04],
  ],
};
const depthCanvas = document.createElement("canvas");
const depthCtx = depthCanvas.getContext("2d", { willReadFrequently: true });
const colorCache = new Map();

function uniq(vals) {
  return [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
}

function pct(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return (x * 100).toFixed(0) + "%";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runOf(d, key) {
  return (d.runs && d.runs[key]) || null;
}

function toEn(label) {
  if (!label) return "";
  const map = PAYLOAD.label_fr_to_en || {};
  return map[label] || label;
}

function predEn(run) {
  if (!run) return "";
  return run.label_en || run.class_name_en || toEn(run.label) || run.label || "";
}

function gtEn(d) {
  return d.ground_truth_en || toEn(d.ground_truth) || d.ground_truth || "";
}

function liveRender() {
  displayLimit = DISPLAY_STEP;
  render();
}

function checkedValues(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`))
    .map((el) => el.value);
}

function setChipGroup(containerId, selected) {
  document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach((el) => {
    el.checked = selected;
  });
}

function fillChipGroup(containerId, values, { checked = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  for (const v of values) {
    const lab = document.createElement("label");
    lab.className = "chip";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.value = v;
    inp.checked = checked;
    inp.addEventListener("change", liveRender);
    lab.appendChild(inp);
    lab.appendChild(document.createTextNode(" " + v));
    el.appendChild(lab);
  }
}

function activePrompts() {
  const sel = checkedValues("chips-prompts");
  return PAYLOAD.prompts.filter((k) => sel.includes(k));
}

function labelsAgree(d, keys) {
  const labels = keys.map((k) => predEn(runOf(d, k))).filter(Boolean);
  if (labels.length < 2) return true;
  return labels.every((l) => l === labels[0]);
}

function accuracyForPrompts(keys) {
  const st = PAYLOAD.stats || {};
  const acc = st.per_prompt_accuracy || {};
  return keys
    .filter((k) => acc[k] != null)
    .map((k) => `${k} ${pct(acc[k])}`);
}

function confGap(d, keys) {
  const vals = keys
    .map((k) => runOf(d, k)?.confidence)
    .filter((v) => v != null && !Number.isNaN(v));
  if (vals.length < 2) return 0;
  return Math.max(...vals) - Math.min(...vals);
}

function showDepth() {
  return document.getElementById("f-depth")?.checked;
}

function lerpColor(stops, t) {
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const x = t * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

function applyColormap(grayImg) {
  const key = grayImg.src;
  if (colorCache.has(key)) return colorCache.get(key);
  depthCanvas.width = grayImg.naturalWidth;
  depthCanvas.height = grayImg.naturalHeight;
  depthCtx.drawImage(grayImg, 0, 0);
  const imgData = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);
  const d = imgData.data;
  const stops = COLORMAPS.turbo;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] / 255;
    const [r, gb, b] = lerpColor(stops, g);
    d[i] = Math.round(r * 255);
    d[i + 1] = Math.round(gb * 255);
    d[i + 2] = Math.round(b * 255);
    d[i + 3] = g < 0.01 ? 0 : 255;
  }
  depthCtx.putImageData(imgData, 0, 0);
  const url = depthCanvas.toDataURL("image/jpeg", 0.85);
  colorCache.set(key, url);
  return url;
}

function colorizeDepthImages(root) {
  root.querySelectorAll("img.vis-depth[data-gray]").forEach((img) => {
    const graySrc = img.dataset.gray;
    if (!graySrc) return;
    const gray = new Image();
    gray.crossOrigin = "anonymous";
    gray.onload = () => {
      img.src = applyColormap(gray);
    };
    gray.src = graySrc;
  });
}

function buildVisualBlock(d) {
  const rgb = `<img class="vis-rgb" src="${esc(d.img)}" alt="${esc(d.id)}" loading="lazy">`;
  if (!showDepth() || !d.has_depth) {
    return `<div class="visual">${rgb}</div>`;
  }
  return `<div class="visual split">
    ${rgb}
    <img class="vis-depth" data-gray="${esc(d.depth_gray)}" alt="depth" loading="lazy">
  </div>`;
}

function filterData() {
  const disagreeOnly = document.getElementById("f-disagree").checked;
  const gt = checkedValues("chips-gt");
  const pred = checkedValues("chips-pred");
  const vsGt = document.getElementById("f-vs-gt").value;
  const search = document.getElementById("f-search").value.trim().toLowerCase();
  const sort = document.getElementById("f-sort").value;
  const prompts = activePrompts();

  let rows = PAYLOAD.records.filter((d) => {
    if (disagreeOnly && labelsAgree(d, prompts)) return false;
    if (gt.length && !gt.includes(gtEn(d))) return false;
    if (search && !d.id.toLowerCase().includes(search)) return false;
    if (pred.length) {
      const labels = prompts.map((k) => predEn(runOf(d, k))).filter(Boolean);
      if (!labels.some((l) => pred.includes(l))) return false;
    }
    if (vsGt !== "all" && d.ground_truth) {
      const scored = prompts.map((k) => runOf(d, k)).filter(Boolean);
      if (!scored.length) return false;
      const nCorrect = scored.filter((r) => r.correct).length;
      if (vsGt === "any-correct" && nCorrect === 0) return false;
      if (vsGt === "any-wrong" && nCorrect === scored.length) return false;
      if (vsGt === "all-correct" && nCorrect !== scored.length) return false;
      if (vsGt === "all-wrong" && nCorrect !== 0) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    switch (sort) {
      case "gt":
        return (gtEn(a) || "").localeCompare(gtEn(b) || "", "en")
          || a.id.localeCompare(b.id);
      case "conf-gap":
        return confGap(b, prompts) - confGap(a, prompts) || a.id.localeCompare(b.id);
      case "disagree": {
        const aAg = labelsAgree(a, prompts);
        const bAg = labelsAgree(b, prompts);
        if (aAg !== bAg) return aAg ? 1 : -1;
        return a.id.localeCompare(b.id);
      }
      default:
        return a.id.localeCompare(b.id);
    }
  });
  return rows;
}

function explainBlock(run, texts) {
  if (!run) return "";
  const t = texts || {};
  const cues = (run.cues || []).join(" · ");
  const reasoning = t.reasoning || "";
  const thinking = t.thinking || "";
  if (!cues && !reasoning && !thinking) return "";
  const body = [
    cues ? `<div>${esc(cues)}</div>` : "",
    reasoning ? `<div class="reason">${esc(reasoning)}</div>` : "",
    thinking ? `<div class="reason"><strong>thinking</strong>\n${esc(thinking)}</div>` : "",
  ].join("");
  return `<details class="explain"><summary>explanation</summary>${body}</details>`;
}

function predCell(d, key, texts) {
  const run = runOf(d, key);
  if (!run) {
    return `<div class="pred missing"><div class="pred-key prompt-link" data-prompt="${esc(key)}">${esc(key)}</div>
      <div class="pred-label">absent</div></div>`;
  }
  const cls = d.ground_truth
    ? (run.correct ? "correct" : "incorrect")
    : "";
  const level = run.level1 ? `<div style="color:#8b949e;font-size:0.72rem">${esc(run.level1)}</div>` : "";
  const label = predEn(run) || run.label || "—";
  return `<div class="pred ${cls}">
    <div class="pred-key prompt-link" data-prompt="${esc(key)}">${esc(key)}</div>
    <div class="pred-label">${esc(label)} <span class="score">${pct(run.confidence)}</span></div>
    ${level}
    ${explainBlock(run, texts && texts[key])}
  </div>`;
}

function gtTag(d) {
  const en = gtEn(d);
  if (!en && !d.ground_truth) return "";
  const fr = d.ground_truth && d.ground_truth !== en
    ? ` <span class="gt-fr">(${esc(d.ground_truth)})</span>`
    : "";
  return `<span class="tag tag-gt">GT: ${esc(en || d.ground_truth)}${fr}</span>`;
}

function render() {
  if (!PAYLOAD.records.length) return;
  const prompts = activePrompts();
  const rows = filterData();
  const shown = rows.slice(0, displayLimit);
  const nDisagree = rows.filter((d) => !labelsAgree(d, prompts)).length;
  let extra = "";
  if (prompts.length >= 2) {
    const comparable = rows.filter(
      (d) => prompts.filter((k) => runOf(d, k)?.label).length >= 2
    );
    const nAgree = comparable.filter((d) => labelsAgree(d, prompts)).length;
    if (comparable.length) {
      extra += ` · agree ${nAgree}/${comparable.length} (${pct(nAgree / comparable.length)})`;
    }
  }
  const accBits = accuracyForPrompts(prompts);
  if (accBits.length) extra += ` · vs GT: ${accBits.join(" · ")}`;
  const nDepth = rows.filter((d) => d.has_depth).length;
  extra += ` · ${nDepth} with depth`;

  document.getElementById("stats").textContent =
    `${rows.length} / ${PAYLOAD.records.length} images · ${nDisagree} disagreements` +
    ` · ${prompts.length} prompt(s)` +
    extra +
    (rows.length > displayLimit ? ` · ${shown.length} shown` : "");

  const grid = document.getElementById("grid");
  grid.replaceChildren();
  const colStyle =
    prompts.length > 0
      ? `grid-template-columns: repeat(${prompts.length}, minmax(0, 1fr))`
      : "";

  for (const d of shown) {
    const agree = labelsAgree(d, prompts);
    const card = document.createElement("div");
    card.className = "card " + (agree ? "agree" : "disagree");
    card.dataset.id = d.id;
    const flag = agree
      ? `<span class="tag tag-agree">agree</span>`
      : `<span class="tag tag-disagree">disagree</span>`;
    const depthBadge = d.has_depth && showDepth()
      ? `<span class="tag tag-depth">depth</span>`
      : "";
    const texts = TEXTS[d.id] || {};
    const cells = prompts.map((k) => predCell(d, k, texts)).join("");
    card.innerHTML = `
      ${buildVisualBlock(d)}
      <div class="meta">
        <div class="meta-top">${gtTag(d)}${flag}${depthBadge}</div>
        <div class="preds" style="${colStyle}">${cells || "<span style='color:#8b949e'>No prompt selected</span>"}</div>
        <div class="fname">${esc(d.id)}</div>
      </div>`;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".prompt-link")) return;
      if (e.target.closest("details.explain")) return;
      openLightbox(d.id);
    });
    grid.appendChild(card);
  }

  colorizeDepthImages(grid);

  const more = document.getElementById("load-more");
  if (rows.length > displayLimit) {
    more.style.display = "block";
    more.textContent = `Show more (${rows.length - displayLimit} left)`;
  } else {
    more.style.display = "none";
  }
}

function openLightbox(id) {
  const d = PAYLOAD.records.find((x) => x.id === id);
  if (!d) return;
  const prompts = activePrompts();
  const texts = TEXTS[id] || {};
  const lbVisual = document.getElementById("lb-visual");
  lbVisual.innerHTML = buildVisualBlock(d);
  colorizeDepthImages(lbVisual);

  const agree = labelsAgree(d, prompts);
  const flag = agree
    ? `<span class="tag tag-agree">agree</span>`
    : `<span class="tag tag-disagree">disagree</span>`;
  const colStyle =
    prompts.length > 0
      ? `grid-template-columns: repeat(${prompts.length}, minmax(0, 1fr))`
      : "";
  const cells = prompts.map((key) => {
    const run = runOf(d, key);
    const t = texts[key] || {};
    if (!run) {
      return `<div class="pred missing"><div class="pred-key">${esc(key)}</div><div>absent</div></div>`;
    }
    const cls = d.ground_truth ? (run.correct ? "correct" : "incorrect") : "";
    const label = predEn(run) || run.label || "—";
    return `<div class="pred ${cls}">
      <div class="pred-key">${esc(key)}</div>
      <div class="pred-label">${esc(label)} <span class="score">${pct(run.confidence)}</span></div>
      ${run.level1 ? `<div style="color:#8b949e">${esc(run.level1)}</div>` : ""}
      ${explainBlock(run, t)}
    </div>`;
  }).join("");

  document.getElementById("lb-meta").innerHTML = `
    <div>${gtTag(d)} ${flag}</div>
    <div class="lb-preds" style="${colStyle}">${cells}</div>
    <div class="fname">${esc(d.id)}</div>`;
  document.getElementById("lightbox").classList.add("open");
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("open");
  document.getElementById("lb-visual").replaceChildren();
}

function openPromptModal(key) {
  const catalog = PAYLOAD.prompt_catalog || {};
  const meta = catalog[key];
  if (!meta) return;
  const inner = document.getElementById("prompt-modal-inner");
  inner.innerHTML = `
    <h2><code>${esc(key)}</code></h2>
    <p class="sub">${meta.chars} characters · text sent to the model</p>
    <pre>${esc(meta.text)}</pre>
    <p class="full-link"><a href="prompts.html#${esc(key)}">Open full prompts page</a></p>`;
  document.getElementById("prompt-modal").classList.add("open");
}

function closePromptModal() {
  document.getElementById("prompt-modal").classList.remove("open");
}

function renderPromptSummary() {
  const el = document.getElementById("prompt-summary");
  if (!el) return;
  const parts = PAYLOAD.prompts.map((k) => `<code>${esc(k)}</code>`);
  el.innerHTML = `${parts.join(" · ")} — ${PAYLOAD.records.length} images.`;
}

function renderPromptChips() {
  const el = document.getElementById("prompt-chips");
  if (!el) return;
  el.replaceChildren();
  for (const key of PAYLOAD.prompts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prompt-chip";
    btn.textContent = key;
    btn.title = "Click to view prompt text";
    btn.addEventListener("click", () => openPromptModal(key));
    el.appendChild(btn);
  }
}

function bindPromptLinks() {
  document.getElementById("grid").addEventListener("click", (e) => {
    const link = e.target.closest(".prompt-link");
    if (!link) return;
    e.stopPropagation();
    const key = link.getAttribute("data-prompt");
    if (key) openPromptModal(key);
  });
}

function bindUi() {
  document.getElementById("btn-prompts-all").onclick = () => {
    setChipGroup("chips-prompts", true);
    liveRender();
  };
  document.getElementById("btn-prompts-none").onclick = () => {
    setChipGroup("chips-prompts", false);
    liveRender();
  };
  document.getElementById("btn-gt-all").onclick = () => {
    setChipGroup("chips-gt", true);
    liveRender();
  };
  document.getElementById("btn-gt-none").onclick = () => {
    setChipGroup("chips-gt", false);
    liveRender();
  };
  document.getElementById("btn-pred-all").onclick = () => {
    setChipGroup("chips-pred", true);
    liveRender();
  };
  document.getElementById("btn-pred-none").onclick = () => {
    setChipGroup("chips-pred", false);
    liveRender();
  };
  document.getElementById("load-more").onclick = () => {
    displayLimit += DISPLAY_STEP;
    render();
  };
  document.getElementById("lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });
  document.querySelector(".close").onclick = closeLightbox;
  document.getElementById("prompt-modal-close").onclick = closePromptModal;
  document.getElementById("prompt-modal").addEventListener("click", (e) => {
    if (e.target.id === "prompt-modal") closePromptModal();
  });

  bindPromptLinks();

  ["f-disagree", "f-depth", "f-vs-gt", "f-sort"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", liveRender);
  });
  document.getElementById("f-search").addEventListener("input", liveRender);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeLightbox();
      closePromptModal();
    }
  });
}

async function loadData() {
  if (window.GALLERY_DATA && Array.isArray(window.GALLERY_DATA.records)) {
    return {
      payload: window.GALLERY_DATA,
      texts: window.GALLERY_TEXTS || {},
    };
  }
  const [dataRes, textsRes] = await Promise.all([
    fetch("data.json"),
    fetch("texts.json"),
  ]);
  if (!dataRes.ok) throw new Error("data.json introuvable (HTTP " + dataRes.status + ")");
  return {
    payload: await dataRes.json(),
    texts: textsRes.ok ? await textsRes.json() : {},
  };
}

async function init() {
  const errEl = document.getElementById("load-error");
  document.getElementById("stats").textContent = "Loading…";
  try {
    const loaded = await loadData();
    PAYLOAD = loaded.payload;
    TEXTS = loaded.texts;
    if (!PAYLOAD.records || !PAYLOAD.records.length) {
      throw new Error("aucune image dans les données");
    }

    fillChipGroup("chips-prompts", PAYLOAD.prompts, { checked: true });
    fillChipGroup("chips-gt", uniq(PAYLOAD.records.map((d) => gtEn(d))));
    const predLabels = [];
    for (const d of PAYLOAD.records) {
      for (const k of PAYLOAD.prompts) {
        const lab = predEn(runOf(d, k));
        if (lab) predLabels.push(lab);
      }
    }
    fillChipGroup("chips-pred", uniq(predLabels));

    renderPromptSummary();
    renderPromptChips();
    bindUi();
    render();
    errEl.style.display = "none";
  } catch (err) {
    document.getElementById("stats").textContent = "Load error";
    errEl.style.display = "block";
    errEl.textContent =
      "Impossible de charger les données (data.js / data.json). " +
      "Relancez: python3 compare_prompt_gallery.py — " +
      err.message;
    console.error(err);
  }
}

init();
