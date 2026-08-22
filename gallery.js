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
  return run.fine || run.label_en || run.class_name_en || toEn(run.label) || run.label || "";
}

function predCoarse(run) {
  if (!run) return "";
  return run.coarse || "";
}

function gtEn(d) {
  return d.ground_truth_fine || d.ground_truth_en || toEn(d.ground_truth_display) || toEn(d.ground_truth) || "";
}

function gtCoarse(d) {
  return d.ground_truth_coarse || "";
}

function uniqCoarse(vals) {
  const set = new Set(vals.filter(Boolean));
  const order = PAYLOAD.coarse_order || [];
  return [...order.filter((k) => set.has(k)), ...[...set].filter((k) => !order.includes(k)).sort()];
}

function gtCell(d) {
  const fine = gtEn(d);
  const coarse = gtCoarse(d);
  const raw = d.ground_truth || d.ground_truth_display || "";
  const missing = !fine && !coarse && !raw;
  const fr = raw && fine && raw !== fine
    ? ` <span class="gt-fr">(${esc(raw)})</span>`
    : "";
  const src = d.ground_truth_source && d.ground_truth_source !== "final"
    ? ` <span class="gt-fr">${esc(d.ground_truth_source)}</span>`
    : "";
  return `<div class="pred gt-cell${missing ? " no-gt" : ""}">
    <div class="pred-key">ground truth</div>
    <div class="pred-row">
      <div><span class="pred-k">coarse</span> <span class="pred-coarse">${esc(missing ? "—" : (coarse || "—"))}</span></div>
      <div class="pred-label"><span class="pred-k">fine</span> ${esc(missing ? "no label in CSV" : (fine || raw || "—"))}${fr}${src}</div>
    </div>
  </div>`;
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

function $(id) {
  return document.getElementById(id);
}

function fillChipGroup(containerId, values, { checked = false } = {}) {
  const el = $(containerId);
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
  const disagreeOnly = $("f-disagree")?.checked;
  const gt = checkedValues("chips-gt");
  const gtCoarseSel = checkedValues("chips-gt-coarse");
  const pred = checkedValues("chips-pred");
  const predCoarseSel = checkedValues("chips-pred-coarse");
  const vsGt = $("f-vs-gt")?.value || "all";
  const search = ($("f-search")?.value || "").trim().toLowerCase();
  const sort = $("f-sort")?.value || "name";
  const prompts = activePrompts();

  let rows = PAYLOAD.records.filter((d) => {
    if (disagreeOnly && labelsAgree(d, prompts)) return false;
    if (gt.length && !gt.includes(gtEn(d) || "(none)")) return false;
    if (gtCoarseSel.length && !gtCoarseSel.includes(gtCoarse(d) || "(none)")) return false;
    if (search && !d.id.toLowerCase().includes(search)) return false;
    if (pred.length) {
      const labels = prompts.map((k) => predEn(runOf(d, k))).filter(Boolean);
      if (!labels.some((l) => pred.includes(l))) return false;
    }
    if (predCoarseSel.length) {
      const coarses = prompts.map((k) => predCoarse(runOf(d, k))).filter(Boolean);
      if (!coarses.some((c) => predCoarseSel.includes(c))) return false;
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
        return (gtCoarse(a) || "").localeCompare(gtCoarse(b) || "", "en")
          || (gtEn(a) || "").localeCompare(gtEn(b) || "", "en")
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
  const fine = predEn(run) || run.label || "—";
  const coarse = predCoarse(run);
  const coarseCls = run.coarse_inferred ? "pred-coarse inferred" : "pred-coarse";
  const coarseNote = run.coarse_inferred ? " (from fine)" : "";
  const model = run.model
    ? `<div class="model-link" data-model="${esc(run.model)}">${esc(run.model)}</div>`
    : "";
  return `<div class="pred ${cls}">
    <div class="pred-key prompt-link" data-prompt="${esc(key)}">${esc(key)}</div>
    ${model}
    <div class="pred-row">
      <div><span class="pred-k">coarse</span> <span class="${coarseCls}">${esc(coarse || "—")}${coarseNote}</span></div>
      <div class="pred-label"><span class="pred-k">fine</span> ${esc(fine)} <span class="score">${pct(run.confidence)}</span></div>
    </div>
    ${explainBlock(run, texts && texts[key])}
  </div>`;
}

function render() {
  if (!PAYLOAD.records.length) return;
  const grid = $("grid");
  if (!grid) return;
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

  const stats = $("stats");
  if (stats) {
    stats.textContent =
      `${rows.length} / ${PAYLOAD.records.length} images · ${nDisagree} disagreements` +
      ` · ${prompts.length} prompt(s)` +
      extra +
      (rows.length > displayLimit ? ` · ${shown.length} shown` : "");
  }

  grid.replaceChildren();

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
    const cells = [gtCell(d), ...prompts.map((k) => predCell(d, k, texts))].join("");
    const nCols = prompts.length + 1;
    const colStyle = `grid-template-columns: repeat(${nCols}, minmax(0, 1fr))`;
    card.innerHTML = `
      ${buildVisualBlock(d)}
      <div class="meta">
        <div class="meta-top">${flag}${depthBadge}</div>
        <div class="preds" style="${colStyle}">${cells}</div>
        <div class="fname">${esc(d.id)}</div>
      </div>`;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".prompt-link")) return;
      if (e.target.closest(".model-link")) return;
      if (e.target.closest("details.explain")) return;
      openLightbox(d.id);
    });
    grid.appendChild(card);
  }

  colorizeDepthImages(grid);

  const more = $("load-more");
  if (!more) return;
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
  const lbVisual = $("lb-visual");
  if (!lbVisual) return;
  lbVisual.innerHTML = buildVisualBlock(d);
  colorizeDepthImages(lbVisual);

  const agree = labelsAgree(d, prompts);
  const flag = agree
    ? `<span class="tag tag-agree">agree</span>`
    : `<span class="tag tag-disagree">disagree</span>`;
  const nCols = prompts.length + 1;
  const colStyle = `grid-template-columns: repeat(${nCols}, minmax(0, 1fr))`;
  const predCells = prompts.map((key) => {
    const run = runOf(d, key);
    const t = texts[key] || {};
    if (!run) {
      return `<div class="pred missing"><div class="pred-key">${esc(key)}</div><div>absent</div></div>`;
    }
    const cls = d.ground_truth ? (run.correct ? "correct" : "incorrect") : "";
    const fine = predEn(run) || run.label || "—";
    const coarse = predCoarse(run);
    const coarseCls = run.coarse_inferred ? "pred-coarse inferred" : "pred-coarse";
    const coarseNote = run.coarse_inferred ? " (from fine)" : "";
    return `<div class="pred ${cls}">
      <div class="pred-key prompt-link" data-prompt="${esc(key)}">${esc(key)}</div>
      ${run.model ? `<div class="model-link" data-model="${esc(run.model)}">${esc(run.model)}</div>` : ""}
      <div class="pred-row">
        <div><span class="pred-k">coarse</span> <span class="${coarseCls}">${esc(coarse || "—")}${coarseNote}</span></div>
        <div class="pred-label"><span class="pred-k">fine</span> ${esc(fine)} <span class="score">${pct(run.confidence)}</span></div>
      </div>
      ${explainBlock(run, t)}
    </div>`;
  }).join("");

  document.getElementById("lb-meta").innerHTML = `
    <div>${flag}</div>
    <div class="lb-preds" style="${colStyle}">${gtCell(d)}${predCells}</div>
    <div class="fname">${esc(d.id)}</div>`;
  document.getElementById("lightbox").classList.add("open");
}

function closeLightbox() {
  const lightbox = $("lightbox");
  if (lightbox) lightbox.classList.remove("open");
  const lbVisual = $("lb-visual");
  if (lbVisual) lbVisual.replaceChildren();
}

function openPromptModal(key) {
  const catalog = PAYLOAD.prompt_catalog || {};
  const meta = catalog[key];
  if (!meta) return;
  openInfoModal(
    `<code>${esc(key)}</code>`,
    `${meta.chars} characters · text sent to the model`,
    meta.text || "",
    `<p class="full-link"><a href="prompts.html#${esc(key)}">Open full prompts page</a></p>`
  );
}

function openModelModal(name) {
  const catalog = PAYLOAD.model_catalog || {};
  const meta = catalog[name] || { name, parameters: {}, token_usage: {} };
  const params = { ...(meta.parameters || {}) };
  if (meta.token_usage && Object.keys(meta.token_usage).length) {
    params.token_usage = meta.token_usage;
  }
  const text = JSON.stringify(params, null, 2);
  openInfoModal(
    `<code>${esc(name)}</code>`,
    "Model inference parameters",
    text || "{}"
  );
}

function openInfoModal(titleHtml, sub, preText, extraHtml = "") {
  const inner = $("prompt-modal-inner");
  if (!inner) return;
  inner.innerHTML = `
    <h2>${titleHtml}</h2>
    <p class="sub">${esc(sub)}</p>
    <pre>${esc(preText)}</pre>
    ${extraHtml}`;
  $("prompt-modal")?.classList.add("open");
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
  const el = $("prompt-chips");
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

function renderModelChips() {
  const el = $("model-chips");
  if (!el) return;
  el.replaceChildren();
  const catalog = PAYLOAD.model_catalog || {};
  const names = Object.keys(catalog).sort();
  for (const name of names) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prompt-chip";
    btn.textContent = name;
    btn.title = "Click to view model parameters";
    btn.addEventListener("click", () => openModelModal(name));
    el.appendChild(btn);
  }
}

function bindPromptLinks() {
  const root = document.body;
  root.addEventListener("click", (e) => {
    const modelLink = e.target.closest(".model-link");
    if (modelLink) {
      e.stopPropagation();
      const name = modelLink.getAttribute("data-model");
      if (name) openModelModal(name);
      return;
    }
    const link = e.target.closest(".prompt-link");
    if (!link) return;
    e.stopPropagation();
    const key = link.getAttribute("data-prompt");
    if (key) openPromptModal(key);
  });
}

function onClick(id, handler) {
  const el = $(id);
  if (el) el.addEventListener("click", handler);
}

function bindChipPair(allId, noneId, groupId) {
  onClick(allId, () => {
    setChipGroup(groupId, true);
    liveRender();
  });
  onClick(noneId, () => {
    setChipGroup(groupId, false);
    liveRender();
  });
}

function bindUi() {
  bindChipPair("btn-prompts-all", "btn-prompts-none", "chips-prompts");
  bindChipPair("btn-gt-all", "btn-gt-none", "chips-gt");
  bindChipPair("btn-gt-coarse-all", "btn-gt-coarse-none", "chips-gt-coarse");
  bindChipPair("btn-pred-all", "btn-pred-none", "chips-pred");
  bindChipPair("btn-pred-coarse-all", "btn-pred-coarse-none", "chips-pred-coarse");
  onClick("load-more", () => {
    displayLimit += DISPLAY_STEP;
    render();
  });
  const lightbox = $("lightbox");
  if (lightbox) {
    lightbox.addEventListener("click", (e) => {
      if (e.target.id === "lightbox") closeLightbox();
    });
  }
  document.querySelectorAll(".close").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeLightbox();
      closePromptModal();
    });
  });
  const promptModal = $("prompt-modal");
  if (promptModal) {
    promptModal.addEventListener("click", (e) => {
      if (e.target.id === "prompt-modal") closePromptModal();
    });
  }

  bindPromptLinks();

  ["f-disagree", "f-depth", "f-vs-gt", "f-sort"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", liveRender);
  });
  const search = $("f-search");
  if (search) search.addEventListener("input", liveRender);
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
    fillChipGroup("chips-gt-coarse", uniqCoarse(PAYLOAD.records.map((d) => gtCoarse(d) || "(none)")));
    fillChipGroup("chips-gt", uniq(PAYLOAD.records.map((d) => gtEn(d) || "(none)")));
    const predLabels = [];
    const predCoarses = [];
    for (const d of PAYLOAD.records) {
      for (const k of PAYLOAD.prompts) {
        const run = runOf(d, k);
        const lab = predEn(run);
        if (lab) predLabels.push(lab);
        const c = predCoarse(run);
        if (c) predCoarses.push(c);
      }
    }
    fillChipGroup("chips-pred-coarse", uniqCoarse(predCoarses));
    fillChipGroup("chips-pred", uniq(predLabels));

    renderPromptSummary();
    renderPromptChips();
    renderModelChips();
    bindUi();
    render();
    errEl.style.display = "none";
  } catch (err) {
    const stats = $("stats");
    if (stats) stats.textContent = "Load error";
    if (errEl) {
      errEl.style.display = "block";
      errEl.textContent =
        "Impossible de charger les données (data.js / data.json). " +
        "Relancez: python3 compare_prompt_gallery.py — " +
        err.message;
    }
    console.error(err);
  }
}

init();
