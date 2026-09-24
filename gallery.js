/** Side-by-side prompt comparison gallery — live chip filters, optional depth. */
let PAYLOAD = { prompts: [], stats: {}, records: [] };
let TEXTS = {};
let SWEEP_RUNS = {};
let textsPromise = null;
const DISPLAY_STEP = 12;
const DEFAULT_PROMPT_KEYS = ["hierarchical_en_no_comment"];
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
  if (isSweepKey(key)) {
    const img = SWEEP_RUNS[d.id];
    return (img && img[key]) || null;
  }
  return (d.runs && d.runs[key]) || null;
}

function modelTitle(key) {
  const display = PAYLOAD.model_display_names || {};
  const catalog = PAYLOAD.model_catalog || {};
  return display[key] || (catalog[key] && catalog[key].title) || key;
}

function canonicalModel(id) {
  const aliases = PAYLOAD.model_aliases || {};
  return aliases[id] || id || "";
}

function selectedModels() {
  return checkedValues("chips-models");
}

function promptModelId(key) {
  for (const d of PAYLOAD.records || []) {
    const run = runOf(d, key);
    if (run?.model) return run.model;
  }
  return "";
}

function promptSourceKey(key) {
  const catalog = PAYLOAD.prompt_catalog || {};
  return (catalog[key] && catalog[key].prompt_key) || key;
}

function promptMatchesModelFilter(key) {
  const sel = selectedModels();
  if (!sel.length) return true;
  const mid = canonicalModel(promptModelId(key));
  return mid ? sel.includes(mid) : false;
}

function uniqueIds(ids, canonicalize) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const c = canonicalize(id);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
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

function gtFr(d) {
  const raw = (d.ground_truth_display || d.ground_truth || "").trim();
  const fine = gtEn(d);
  return raw && fine && raw !== fine ? raw : "";
}

function recordMatchesGtCrop(d, sel) {
  if (!sel) return true;
  const fine = gtEn(d);
  const coarse = gtCoarse(d);
  const raw = (d.ground_truth_display || d.ground_truth || "").trim();
  if (sel.startsWith("fine:")) {
    const want = sel.slice(5);
    return fine === want || raw === want;
  }
  if (sel.startsWith("coarse:")) {
    return coarse === sel.slice(7);
  }
  const q = sel.toLowerCase();
  return [fine, coarse, raw].filter(Boolean).some((v) => v.toLowerCase().includes(q));
}

function fillGtCropSelect() {
  const el = $("f-gt-crop");
  if (!el) return;
  const fines = new Set();
  const coarses = new Set();
  const frByFine = new Map();
  for (const d of PAYLOAD.records || []) {
    const fine = gtEn(d);
    const coarse = gtCoarse(d);
    if (fine) {
      fines.add(fine);
      const fr = gtFr(d);
      if (fr && !frByFine.has(fine)) frByFine.set(fine, fr);
    }
    if (coarse) coarses.add(coarse);
  }
  const prev = el.value;
  el.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All crops";
  el.appendChild(all);

  const coarseOrder = PAYLOAD.coarse_order || [];
  const coarseSorted = [...coarses].sort((a, b) => {
    const ia = coarseOrder.indexOf(a);
    const ib = coarseOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b, "en");
  });
  if (coarseSorted.length) {
    const og = document.createElement("optgroup");
    og.label = "Coarse class";
    for (const c of coarseSorted) {
      const opt = document.createElement("option");
      opt.value = `coarse:${c}`;
      opt.textContent = c.replace(/_/g, " ");
      og.appendChild(opt);
    }
    el.appendChild(og);
  }

  const fineSorted = [...fines].sort((a, b) => a.localeCompare(b, "en"));
  if (fineSorted.length) {
    const og = document.createElement("optgroup");
    og.label = "Fine crop / class";
    for (const fine of fineSorted) {
      const opt = document.createElement("option");
      opt.value = `fine:${fine}`;
      const fr = frByFine.get(fine);
      opt.textContent = fr ? `${fine} (${fr})` : fine;
      og.appendChild(opt);
    }
    el.appendChild(og);
  }
  if (prev && [...el.options].some((o) => o.value === prev)) el.value = prev;
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

function fillChipGroup(containerId, values, { checked = false, labels = {}, selected = null } = {}) {
  const el = $(containerId);
  if (!el) return;
  el.replaceChildren();
  const sel = selected == null ? null : new Set(selected.map(String));
  for (const v of values) {
    const lab = document.createElement("label");
    lab.className = "chip";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.value = v;
    inp.checked = sel ? sel.has(String(v)) : checked;
    inp.addEventListener("change", liveRender);
    lab.appendChild(inp);
    lab.appendChild(document.createTextNode(" " + (labels[v] ?? labels[String(v)] ?? v)));
    el.appendChild(lab);
  }
}

function setChipGroupSelected(containerId, values) {
  const want = new Set((values || []).map(String));
  document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach((el) => {
    el.checked = want.has(el.value);
  });
}

function promptTitle(key) {
  const catalog = PAYLOAD.prompt_catalog || {};
  return (catalog[key] && catalog[key].title_en) || key;
}

function promptText(key) {
  const catalog = PAYLOAD.prompt_catalog || {};
  const meta = catalog[key] || {};
  const src = meta.prompt_key || key;
  const texts = PAYLOAD.prompt_texts || {};
  return texts[src] || meta.text || "";
}

function runInputMode(run) {
  if (!run) return "rgb";
  return run.input_mode || "rgb";
}

function inputModeForPrompt(key) {
  for (const d of PAYLOAD.records || []) {
    const run = runOf(d, key);
    if (run) return runInputMode(run);
  }
  return "rgb";
}

function selectedInputModes() {
  return checkedValues("chips-input-mode");
}

function isSweepKey(key) {
  return (PAYLOAD.sweep_keys || []).includes(key) || String(key).startsWith("gemma_sweep_");
}

function firstRun(key) {
  for (const d of PAYLOAD.records || []) {
    const run = runOf(d, key);
    if (run) return run;
  }
  return null;
}

function sweepChipValues(groupId) {
  return checkedValues(groupId);
}

function sweepMaskChipsPresent() {
  const el = $("chips-sweep-mask");
  return Boolean(el && el.querySelectorAll('input[type="checkbox"]').length);
}

function sweepTopkChipsPresent() {
  const el = $("chips-sweep-topk");
  return Boolean(el && el.querySelectorAll('input[type="checkbox"]').length);
}

function sweepRepChipsPresent() {
  const el = $("chips-sweep-rep");
  return Boolean(el && el.querySelectorAll('input[type="checkbox"]').length);
}

function sweepFiltersActive() {
  const base = (
    sweepChipValues("chips-sweep-thinking").length > 0
    && sweepChipValues("chips-sweep-temperature").length > 0
    && sweepChipValues("chips-sweep-soft").length > 0
  );
  if (!base) return false;
  if (sweepTopkChipsPresent() && sweepChipValues("chips-sweep-topk").length === 0) return false;
  if (sweepRepChipsPresent() && sweepChipValues("chips-sweep-rep").length === 0) return false;
  if (sweepMaskChipsPresent() && sweepChipValues("chips-sweep-mask").length === 0) return false;
  return true;
}

function sweepChipNum(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function sweepRunMatches(key) {
  if (!sweepFiltersActive()) return false;
  const run = firstRun(key);
  if (!run) return false;
  const thinking = sweepChipValues("chips-sweep-thinking");
  const temps = sweepChipValues("chips-sweep-temperature");
  const softs = sweepChipValues("chips-sweep-soft");
  if (!thinking.includes(String(Boolean(run.enable_thinking)))) return false;
  if (!temps.includes(sweepChipNum(run.temperature))) return false;
  if (!softs.includes(sweepChipNum(run.max_soft_tokens))) return false;
  if (sweepTopkChipsPresent()) {
    const topks = sweepChipValues("chips-sweep-topk");
    if (!topks.includes(sweepChipNum(run.top_k ?? 64))) return false;
  }
  if (sweepRepChipsPresent()) {
    const reps = sweepChipValues("chips-sweep-rep");
    if (!reps.includes(sweepChipNum(run.repetition_penalty ?? 1))) return false;
  }
  if (sweepMaskChipsPresent()) {
    const masks = sweepChipValues("chips-sweep-mask");
    if (!masks.includes(String(run.mask || "none"))) return false;
  }
  return true;
}

function activePrompts() {
  const sel = checkedValues("chips-prompts");
  const modes = selectedInputModes();
  return PAYLOAD.prompts.filter((k) => {
    const src = promptSourceKey(k);
    if (!sel.includes(k) && !sel.includes(src)) return false;
    if (!modes.includes(inputModeForPrompt(k))) return false;
    if (!promptMatchesModelFilter(k)) return false;
    if ((PAYLOAD.sweep_keys || []).length && isSweepKey(k) && !sweepRunMatches(k)) {
      return false;
    }
    return true;
  });
}

function activeColumns() {
  return activePrompts().map((k) => ({ kind: "prompt", key: k }));
}

function runForColumn(d, col) {
  return runOf(d, col.key);
}

function columnTitle(col) {
  return promptTitle(col.key);
}

function labelsAgree(d, keys, columns) {
  const cols = columns || keys.map((k) => ({ kind: "prompt", key: k }));
  const labels = cols.map((c) => predEn(runForColumn(d, c))).filter(Boolean);
  if (labels.length < 2) return true;
  return labels.every((l) => l === labels[0]);
}

const CONF_THRESHOLDS = [0.7, 0.8, 0.9];

function columnLabel(col) {
  if (isSweepKey(col.key)) return promptTitle(col.key);
  const mid = promptModelId(col.key);
  const prompt = promptTitle(col.key);
  return mid ? `${prompt} · ${modelTitle(mid)}` : prompt;
}

function activeModelIds() {
  const ids = new Set();
  for (const col of activeColumns()) {
    const mid = promptModelId(col.key);
    if (mid) ids.add(canonicalModel(mid));
  }
  return [...ids].sort((a, b) => modelTitle(a).localeCompare(modelTitle(b), "en"));
}

function runInferenceParams(run, colKey) {
  if (!run) return {};
  const base = { ...((PAYLOAD.model_catalog[run.model] || {}).parameters || {}) };
  if (run.enable_thinking != null) base.enable_thinking = run.enable_thinking;
  if (run.temperature != null) base.temperature = run.temperature;
  if (run.max_soft_tokens != null) base.max_soft_tokens = run.max_soft_tokens;
  if (run.top_k != null) base.top_k = run.top_k;
  if (run.repetition_penalty != null) base.repetition_penalty = run.repetition_penalty;
  if (run.input_mode) base.input_mode = run.input_mode;
  if (run.run_name) base.run_name = run.run_name;
  base.column = colKey;
  return base;
}

function scoredAt(col, minConf) {
  const runs = [];
  for (const d of PAYLOAD.records || []) {
    if (!d.ground_truth) continue;
    const run = runForColumn(d, col);
    if (!run) continue;
    if (minConf != null) {
      const conf = run.confidence;
      if (conf == null || conf < minConf) continue;
    }
    runs.push(run);
  }
  return runs;
}

function fmtAcc(runs) {
  if (!runs.length) return "—";
  const nOk = runs.filter((r) => r.correct).length;
  return `${pct(nOk / runs.length)}<span class="acc-n">${nOk}/${runs.length}</span>`;
}

function renderAccTable(columns) {
  const el = $("acc-panel");
  if (!el) return;
  if (!columns.length) {
    el.innerHTML = "";
    return;
  }
  const heads = ["run", "all", ...CONF_THRESHOLDS.map((t) => `≥${Math.round(t * 100)}%`)]
    .map((h) => `<th>${esc(h)}</th>`)
    .join("");
  const body = columns
    .map((col) => {
      const cells = [null, ...CONF_THRESHOLDS]
        .map((t) => `<td>${fmtAcc(scoredAt(col, t))}</td>`)
        .join("");
      return `<tr><th>${esc(columnLabel(col))}</th>${cells}</tr>`;
    })
    .join("");
  el.innerHTML = `
    <table>
      <caption>Précision vs GT (classe fine) parmi les prédictions avec confiance ≥ seuil. Fraction = correct / conservés.</caption>
      <thead><tr>${heads}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function confGap(d, keys, columns) {
  const cols = columns || keys.map((k) => ({ kind: "prompt", key: k }));
  const vals = cols
    .map((c) => runForColumn(d, c)?.confidence)
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
  const rgb = `<img class="vis-rgb" src="${esc(d.img)}" alt="${esc(d.id)}" loading="lazy" decoding="async">`;
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
  const vsGt = $("f-vs-gt")?.value || "all";
  const search = ($("f-search")?.value || "").trim().toLowerCase();
  const gtCrop = $("f-gt-crop")?.value || "";
  const sort = $("f-sort")?.value || "name";
  const columns = activeColumns();
  const colKeys = columns.map((c) => c.key);

  let rows = PAYLOAD.records.filter((d) => {
    if (disagreeOnly && labelsAgree(d, colKeys, columns)) return false;
    if (!recordMatchesGtCrop(d, gtCrop)) return false;
    if (search) {
      const idMatch = d.id.toLowerCase().includes(search);
      const cropMatch = [gtEn(d), gtCoarse(d), gtFr(d), d.ground_truth || ""]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(search));
      if (!idMatch && !cropMatch) return false;
    }
    if (vsGt !== "all" && d.ground_truth) {
      const scored = columns.map((c) => runForColumn(d, c)).filter(Boolean);
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
        return confGap(b, colKeys, columns) - confGap(a, colKeys, columns) || a.id.localeCompare(b.id);
      case "disagree": {
        const aAg = labelsAgree(a, colKeys, columns);
        const bAg = labelsAgree(b, colKeys, columns);
        if (aAg !== bAg) return aAg ? 1 : -1;
        return a.id.localeCompare(b.id);
      }
      default:
        return a.id.localeCompare(b.id);
    }
  });
  return rows;
}

function explainBody(t) {
  const reasoning = (t && t.reasoning) || "";
  const thinking = (t && t.thinking) || "";
  if (!reasoning && !thinking) return "";
  return [
    reasoning ? `<div class="reason">${esc(reasoning)}</div>` : "",
    thinking ? `<div class="reason"><strong>thinking</strong>\n${esc(thinking)}</div>` : "",
  ].join("");
}

function explainBlock(run, imageId, colKey) {
  if (!run) return "";
  const cues = (run.cues || []).join(" · ");
  const t = imageId && colKey && TEXTS[imageId] ? TEXTS[imageId][colKey] : null;
  const extra = explainBody(t);
  if (!cues && !extra && !imageId) return "";
  if (!imageId) {
    if (!cues && !extra) return "";
    return `<details class="explain"><summary>explanation</summary>${
      cues ? `<div>${esc(cues)}</div>` : ""
    }${extra}</details>`;
  }
  return `<details class="explain" data-img="${esc(imageId)}" data-col="${esc(colKey)}">
    <summary>explanation</summary>
    ${cues ? `<div>${esc(cues)}</div>` : ""}
    ${extra ? extra : '<div class="reason lazy-body"></div>'}
  </details>`;
}

async function hydrateExplain(det) {
  if (!det || det.dataset.hydrated) return;
  const lazy = det.querySelector(".lazy-body");
  if (!lazy) {
    det.dataset.hydrated = "1";
    return;
  }
  await ensureTexts();
  const t = TEXTS[det.dataset.img]?.[det.dataset.col] || {};
  const extra = explainBody(t);
  if (extra) lazy.outerHTML = extra;
  else lazy.remove();
  det.dataset.hydrated = "1";
}

function inputModeBadge(run) {
  const mode = runInputMode(run);
  return `<span class="tag tag-input">${esc(mode)}</span>`;
}

function predCell(d, col) {
  const title = columnTitle(col);
  const run = runForColumn(d, col);
  const head = `<div class="pred-key prompt-link" data-prompt="${esc(col.key)}">${esc(title)}</div>`;
  if (!run) {
    return `<div class="pred missing">${head}<div class="pred-label">absent</div></div>`;
  }
  const cls = d.ground_truth
    ? (run.correct ? "correct" : "incorrect")
    : "";
  const fine = predEn(run) || run.label || "—";
  const coarse = predCoarse(run);
  const coarseCls = run.coarse_inferred ? "pred-coarse inferred" : "pred-coarse";
  const coarseNote = run.coarse_inferred ? " (from fine)" : "";
  const subModel = run.model
    ? `<div class="model-link" data-model="${esc(run.model)}" data-col="${esc(col.key)}">${esc(modelTitle(run.model))}</div>`
    : "";
  return `<div class="pred ${cls}">
    ${head}
    ${subModel}
    ${inputModeBadge(run)}
    <div class="pred-row">
      <div><span class="pred-k">coarse</span> <span class="${coarseCls}">${esc(coarse || "—")}${coarseNote}</span></div>
      <div class="pred-label"><span class="pred-k">fine</span> ${esc(fine)} <span class="score">${pct(run.confidence)}</span></div>
    </div>
    ${explainBlock(run, d.id, col.key)}
  </div>`;
}

function render() {
  if (!PAYLOAD.records.length) return;
  const grid = $("grid");
  if (!grid) return;
  const columns = activeColumns();
  const rows = filterData();
  const shown = rows.slice(0, displayLimit);
  const colKeys = columns.map((c) => c.key);
  const nDisagree = rows.filter((d) => !labelsAgree(d, colKeys, columns)).length;
  let extra = "";
  if (columns.length >= 2) {
    const comparable = rows.filter(
      (d) => columns.filter((c) => runForColumn(d, c)?.label).length >= 2
    );
    const nAgree = comparable.filter((d) => labelsAgree(d, colKeys, columns)).length;
    if (comparable.length) {
      extra += ` · agree ${nAgree}/${comparable.length} (${pct(nAgree / comparable.length)})`;
    }
  }
  const nDepth = rows.filter((d) => d.has_depth).length;
  extra += ` · ${nDepth} with depth`;

  const stats = $("stats");
  if (stats) {
    stats.textContent =
      `${rows.length} / ${PAYLOAD.records.length} images · ${nDisagree} disagreements` +
      ` · ${columns.length} column(s)` +
      extra +
      (rows.length > displayLimit ? ` · ${shown.length} shown` : "");
  }
  renderAccTable(columns);
  renderModelChips();

  grid.replaceChildren();

  for (const d of shown) {
    const agree = labelsAgree(d, colKeys, columns);
    const card = document.createElement("div");
    card.className = "card " + (agree ? "agree" : "disagree");
    card.dataset.id = d.id;
    const flag = agree
      ? `<span class="tag tag-agree">agree</span>`
      : `<span class="tag tag-disagree">disagree</span>`;
    const depthBadge = d.has_depth && showDepth()
      ? `<span class="tag tag-depth">depth</span>`
      : "";
    const cells = [gtCell(d), ...columns.map((c) => predCell(d, c))].join("");
    const nCols = columns.length + 1;
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

async function openLightbox(id) {
  await ensureTexts();
  const d = PAYLOAD.records.find((x) => x.id === id);
  if (!d) return;
  const columns = activeColumns();
  const colKeys = columns.map((c) => c.key);
  const lbVisual = $("lb-visual");
  if (!lbVisual) return;
  lbVisual.innerHTML = buildVisualBlock(d);
  colorizeDepthImages(lbVisual);

  const agree = labelsAgree(d, colKeys, columns);
  const flag = agree
    ? `<span class="tag tag-agree">agree</span>`
    : `<span class="tag tag-disagree">disagree</span>`;
  const nCols = columns.length + 1;
  const colStyle = `grid-template-columns: repeat(${nCols}, minmax(0, 1fr))`;
  const predCells = columns.map((col) => predCell(d, col)).join("");

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
  const src = meta.prompt_key || key;
  const text = promptText(key);
  const title = isSweepKey(key) && meta.title_en
    ? esc(meta.title_en)
    : `<code>${esc(key)}</code>`;
  openInfoModal(
    title,
    `${meta.chars || text.length} characters · text sent to the model`,
    text,
    `<p class="full-link"><a href="prompts.html#${esc(src)}">Open full prompts page</a></p>`
  );
}

function openModelModal(name, colKey) {
  const canon = canonicalModel(name);
  let params;
  let sub = "Model inference parameters";
  if (colKey) {
    params = runInferenceParams(firstRun(colKey), colKey);
    sub = `${columnLabel({ key: colKey })} · parameters for this column`;
  } else {
    const cols = activeColumns().filter(
      (c) => canonicalModel(promptModelId(c.key)) === canon
    );
    if (!cols.length) return;
    if (cols.length === 1) {
      params = runInferenceParams(firstRun(cols[0].key), cols[0].key);
      sub = `${columnLabel(cols[0])} · parameters for this column`;
      const meta = (PAYLOAD.model_catalog || {})[name] || {};
      if (meta.token_usage && Object.keys(meta.token_usage).length) {
        params.token_usage = meta.token_usage;
      }
    } else {
      params = Object.fromEntries(
        cols.map((c) => [columnLabel(c), runInferenceParams(firstRun(c.key), c.key)])
      );
      sub = `${cols.length} visible runs for ${modelTitle(name)}`;
    }
  }
  const text = JSON.stringify(params, null, 2);
  openInfoModal(`<code>${esc(name)}</code>`, sub, text || "{}");
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

function renderPromptChips() {
  const el = $("prompt-chips");
  if (!el) return;
  el.replaceChildren();
  const seen = new Set();
  for (const key of PAYLOAD.prompts) {
    const meta = (PAYLOAD.prompt_catalog || {})[key] || {};
    const id = meta.prompt_key || key;
    if (seen.has(id)) continue;
    seen.add(id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prompt-chip";
    btn.textContent = promptTitle(key);
    btn.title = "Click to view prompt text";
    btn.addEventListener("click", () => openPromptModal(key));
    el.appendChild(btn);
  }
}

function renderModelChips() {
  const el = $("model-chips");
  if (!el) return;
  el.replaceChildren();
  const names = activeModelIds();
  for (const name of names) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prompt-chip";
    btn.textContent = modelTitle(name);
    btn.title = name;
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
      const col = modelLink.getAttribute("data-col");
      if (name) openModelModal(name, col || null);
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

function applySweepDefaults() {
  const defaults = PAYLOAD.sweep_defaults || {
    thinking: [false],
    temperature: [1],
    max_soft_tokens: [280],
    top_k: [64],
    repetition_penalty: [1],
  };
  setChipGroupSelected("chips-sweep-thinking", (defaults.thinking || []).map((v) => String(v)));
  setChipGroupSelected("chips-sweep-temperature", (defaults.temperature || []).map((v) => sweepChipNum(v)));
  setChipGroupSelected("chips-sweep-soft", (defaults.max_soft_tokens || []).map((v) => sweepChipNum(v)));
  if (sweepTopkChipsPresent()) {
    setChipGroupSelected("chips-sweep-topk", (defaults.top_k || [64]).map((v) => sweepChipNum(v)));
  }
  if (sweepRepChipsPresent()) {
    setChipGroupSelected(
      "chips-sweep-rep",
      (defaults.repetition_penalty || [1]).map((v) => sweepChipNum(v)),
    );
  }
  if (sweepMaskChipsPresent()) {
    setChipGroupSelected("chips-sweep-mask", (defaults.mask || ["none"]).map((v) => String(v)));
  }
}

function bindUi() {
  bindChipPair("btn-prompts-all", "btn-prompts-none", "chips-prompts");
  bindChipPair("btn-models-all", "btn-models-none", "chips-models");
  bindChipPair("btn-input-mode-all", "btn-input-mode-none", "chips-input-mode");
  onClick("btn-sweep-best", () => {
    applySweepDefaults();
    liveRender();
  });
  onClick("btn-sweep-none", () => {
    setChipGroup("chips-sweep-thinking", false);
    setChipGroup("chips-sweep-temperature", false);
    setChipGroup("chips-sweep-soft", false);
    setChipGroup("chips-sweep-topk", false);
    setChipGroup("chips-sweep-rep", false);
    setChipGroup("chips-sweep-mask", false);
    liveRender();
  });
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

  document.addEventListener("toggle", (e) => {
    const det = e.target;
    if (!(det instanceof HTMLDetailsElement) || !det.classList.contains("explain")) return;
    if (det.open) hydrateExplain(det);
  }, true);

  ["f-disagree", "f-depth", "f-vs-gt", "f-sort", "f-gt-crop"].forEach((id) => {
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

async function ensureTexts() {
  if (TEXTS && Object.keys(TEXTS).length) return TEXTS;
  if (!textsPromise) {
    textsPromise = fetch(cacheBustedUrl("texts.json"))
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        TEXTS = data || {};
        return TEXTS;
      })
      .catch(() => {
        TEXTS = {};
        return TEXTS;
      });
  }
  return textsPromise;
}

function galleryCacheBust() {
  if (window.GALLERY_CACHE_BUST) return String(window.GALLERY_CACHE_BUST);
  const src = document.querySelector('script[src*="gallery.js"]')?.getAttribute("src") || "";
  const match = src.match(/[?&]v=([^&]+)/);
  return match ? match[1] : String(Date.now());
}

function cacheBustedUrl(path) {
  const sep = path.includes("?") ? "&" : "?";
  return path + sep + "v=" + encodeURIComponent(galleryCacheBust());
}

function softsFromSweepKeys(keys) {
  const found = new Set();
  for (const key of keys || []) {
    const match = String(key).match(/soft(\d+)/i);
    if (match) found.add(match[1]);
  }
  return [...found].sort((a, b) => Number(a) - Number(b));
}

async function loadData() {
  if (window.GALLERY_DATA && Array.isArray(window.GALLERY_DATA.records)) {
    return { payload: window.GALLERY_DATA, sweeps: window.GALLERY_SWEEPS || {} };
  }
  const [dataRes, sweepRes] = await Promise.all([
    fetch(cacheBustedUrl("data.json")),
    fetch(cacheBustedUrl("sweeps.json")),
  ]);
  if (!dataRes.ok) throw new Error("data.json introuvable (HTTP " + dataRes.status + ")");
  return {
    payload: await dataRes.json(),
    sweeps: sweepRes.ok ? await sweepRes.json() : {},
  };
}

async function init() {
  const errEl = document.getElementById("load-error");
  const statsEl = document.getElementById("stats");
  if (statsEl) statsEl.textContent = "Chargement des données…";
  try {
    const loaded = await loadData();
    PAYLOAD = loaded.payload;
    SWEEP_RUNS = loaded.sweeps || {};
    if (!PAYLOAD.records || !PAYLOAD.records.length) {
      throw new Error("aucune image dans les données");
    }

    const promptChipIds = uniqueIds(PAYLOAD.prompts, promptSourceKey);
    const promptLabels = Object.fromEntries(
      promptChipIds.map((k) => [k, promptTitle(k)])
    );
    const defaultPrompts = DEFAULT_PROMPT_KEYS.filter((k) => promptChipIds.includes(k));
    fillChipGroup("chips-prompts", promptChipIds, {
      checked: false,
      labels: promptLabels,
      selected: defaultPrompts.length ? defaultPrompts : promptChipIds.slice(0, 1),
    });
    const modelIds = uniqueIds(
      Object.keys(PAYLOAD.model_catalog || {}),
      canonicalModel
    );
    const modelLabels = Object.fromEntries(
      modelIds.map((k) => [k, modelTitle(k)])
    );
    fillChipGroup("chips-models", modelIds, { checked: true, labels: modelLabels });
    const inputModes = PAYLOAD.input_modes && PAYLOAD.input_modes.length
      ? PAYLOAD.input_modes
      : ["rgb"];
    fillChipGroup("chips-input-mode", inputModes, {
      checked: false,
      selected: inputModes.includes("rgb") ? ["rgb"] : inputModes.slice(0, 1),
    });

    const sweepKeys = PAYLOAD.sweep_keys || [];
    const sweepGroup = $("filter-gemma-sweep");
    if (sweepGroup) sweepGroup.hidden = !sweepKeys.length;
    if (sweepKeys.length) {
      const dims = PAYLOAD.sweep_dims || {};
      const defaults = PAYLOAD.sweep_defaults || {
        thinking: [false],
        temperature: [1],
        max_soft_tokens: [280],
        top_k: [64],
        repetition_penalty: [1],
      };
      const thinkingVals = dims.thinking && dims.thinking.length
        ? dims.thinking.map((v) => String(v))
        : ["false", "true"];
      fillChipGroup("chips-sweep-thinking", thinkingVals, {
        labels: { false: "off", true: "on" },
        selected: (defaults.thinking || []).map((v) => String(v)),
      });
      const tempVals = (dims.temperature || []).map((v) => sweepChipNum(v));
      fillChipGroup("chips-sweep-temperature", tempVals, {
        selected: (defaults.temperature || []).map((v) => sweepChipNum(v)),
      });
      const softVals = [
        ...new Set([
          ...(dims.max_soft_tokens || []).map((v) => sweepChipNum(v)),
          ...softsFromSweepKeys(sweepKeys),
        ]),
      ].sort((a, b) => Number(a) - Number(b));
      fillChipGroup("chips-sweep-soft", softVals, {
        selected: (defaults.max_soft_tokens || []).map((v) => sweepChipNum(v)),
      });
      const topkVals = (dims.top_k || []).map((v) => sweepChipNum(v));
      fillChipGroup("chips-sweep-topk", topkVals, {
        selected: (defaults.top_k || [64]).map((v) => sweepChipNum(v)),
      });
      const repVals = (dims.repetition_penalty || [1]).map((v) => sweepChipNum(v));
      fillChipGroup("chips-sweep-rep", repVals, {
        selected: (defaults.repetition_penalty || [1]).map((v) => sweepChipNum(v)),
      });
      const maskOrder = ["none", "3-25", "3-35", "v2"];
      const maskSeen = new Set((dims.mask || []).map((v) => String(v)));
      const maskVals = [
        ...maskOrder.filter((v) => maskSeen.has(v)),
        ...[...maskSeen].filter((v) => !maskOrder.includes(v)).sort(),
      ];
      fillChipGroup("chips-sweep-mask", maskVals, {
        selected: (defaults.mask || ["none"]).map((v) => String(v)),
      });
    }

    fillGtCropSelect();
    const gtPreview = !PAYLOAD.prompts.length;
    if (gtPreview) {
      document.querySelectorAll(".filter-group").forEach((el) => {
        const id = el.querySelector(".chip-list")?.id || "";
        if (id.startsWith("chips-prompts") || id.startsWith("chips-models") || id.startsWith("chips-input-mode")) {
          el.hidden = true;
        }
      });
      if ($("filter-gemma-sweep")) $("filter-gemma-sweep").hidden = true;
    }
    renderPromptChips();
    renderModelChips();
    bindUi();
    requestAnimationFrame(() => render());
    ensureTexts();
    errEl.style.display = "none";
  } catch (err) {
    const stats = $("stats");
    if (stats) stats.textContent = "Load error";
    if (errEl) {
      errEl.style.display = "block";
      errEl.textContent =
        "Impossible de charger les données (data.json). " +
        "Relancez: python3 compare_prompt_gallery.py — " +
        err.message;
    }
    console.error(err);
  }
}

init();
