/** Side-by-side prompt comparison gallery — loads data.js / texts.js. */
let PAYLOAD = { prompts: [], stats: {}, records: [] };
let TEXTS = {};
const DISPLAY_STEP = 200;
let displayLimit = DISPLAY_STEP;

function uniq(vals) {
  return [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
}

function fillSelect(id, values) {
  const el = document.getElementById(id);
  el.replaceChildren();
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }
}

function selectedValues(id) {
  const el = document.getElementById(id);
  return Array.from(el.selectedOptions).map((o) => o.value);
}

function activePrompts() {
  const sel = selectedValues("f-prompts");
  if (!sel.length) return [...PAYLOAD.prompts];
  return PAYLOAD.prompts.filter((k) => sel.includes(k));
}

function labelsAgree(d, keys) {
  const labels = keys.map((k) => runOf(d, k)?.label).filter(Boolean);
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

function fillPromptSelect() {
  const el = document.getElementById("f-prompts");
  if (!el) return;
  const catalog = PAYLOAD.prompt_catalog || {};
  el.replaceChildren();
  for (const k of PAYLOAD.prompts) {
    const opt = document.createElement("option");
    opt.value = k;
    const title = catalog[k]?.title_en;
    opt.textContent = title ? `${k} — ${title}` : k;
    opt.selected = true;
    el.appendChild(opt);
  }
}

function selectAllPrompts(selected) {
  const el = document.getElementById("f-prompts");
  if (!el) return;
  Array.from(el.options).forEach((o) => (o.selected = selected));
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

function confGap(d, keys) {
  const vals = keys
    .map((k) => runOf(d, k)?.confidence)
    .filter((v) => v != null && !Number.isNaN(v));
  if (vals.length < 2) return 0;
  return Math.max(...vals) - Math.min(...vals);
}

function filterData() {
  const disagreeOnly = document.getElementById("f-disagree").checked;
  const gt = selectedValues("f-gt");
  const pred = selectedValues("f-pred");
  const vsGt = document.getElementById("f-vs-gt").value;
  const search = document.getElementById("f-search").value.trim().toLowerCase();
  const sort = document.getElementById("f-sort").value;
  const prompts = activePrompts();

  let rows = PAYLOAD.records.filter((d) => {
    if (disagreeOnly && labelsAgree(d, prompts)) return false;
    if (gt.length && !gt.includes(d.ground_truth)) return false;
    if (search && !d.id.toLowerCase().includes(search)) return false;
    if (pred.length) {
      const labels = prompts.map((k) => runOf(d, k)?.label).filter(Boolean);
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
        return (a.ground_truth || "").localeCompare(b.ground_truth || "", "fr")
          || a.id.localeCompare(b.id);
      case "conf-gap":
        return confGap(b, prompts) - confGap(a, prompts) || a.id.localeCompare(b.id);
      case "name":
        return a.id.localeCompare(b.id);
      default:
        const aAg = labelsAgree(a, prompts);
        const bAg = labelsAgree(b, prompts);
        if (aAg !== bAg) return aAg ? 1 : -1;
        return a.id.localeCompare(b.id);
    }
  });
  return rows;
}

function predCell(d, key, texts) {
  const run = runOf(d, key);
  const catalog = PAYLOAD.prompt_catalog || {};
  const titleEn = catalog[key]?.title_en || key;
  if (!run) {
    return `<div class="pred missing"><div class="pred-key prompt-link" data-prompt="${esc(key)}">${esc(key)}</div>
      <div style="color:#8b949e;font-size:0.72rem">${esc(titleEn)}</div>
      <div class="pred-label">absent</div></div>`;
  }
  const cls = d.ground_truth
    ? (run.correct ? "correct" : "incorrect")
    : "";
  const level = run.level1 ? `<div style="color:#8b949e;font-size:0.72rem">${esc(run.level1)}</div>` : "";
  const cues = (run.cues || []).length
    ? `<div style="color:#8b949e;font-size:0.72rem;margin-top:0.2rem">${esc(run.cues.join(" · "))}</div>`
    : "";
  const reason = (texts && texts[key] && texts[key].reasoning) || "";
  return `<div class="pred ${cls}">
    <div class="pred-key prompt-link" data-prompt="${esc(key)}">${esc(key)}</div>
    <div style="color:#8b949e;font-size:0.72rem;margin-bottom:0.2rem">${esc(titleEn)}</div>
    <div class="pred-label">${esc(run.label || "—")} <span class="score">${pct(run.confidence)}</span></div>
    ${level}${cues}
    ${reason ? `<div class="reason-preview">${esc(reason)}</div>` : ""}
  </div>`;
}

function render() {
  if (!PAYLOAD.records.length) return;
  const prompts = activePrompts();
  const rows = filterData();
  const shown = rows.slice(0, displayLimit);
  const nDisagree = rows.filter((d) => !labelsAgree(d, prompts)).length;
  const st = PAYLOAD.stats || {};
  let extra = "";
  if (prompts.length >= 2) {
    const comparable = rows.filter(
      (d) => prompts.filter((k) => runOf(d, k)?.label).length >= 2
    );
    const nAgree = comparable.filter((d) => labelsAgree(d, prompts)).length;
    if (comparable.length) {
      extra += ` · accord ${nAgree}/${comparable.length} (${pct(nAgree / comparable.length)})`;
    }
  }
  const accBits = accuracyForPrompts(prompts);
  if (accBits.length) extra += ` · vs GT: ${accBits.join(" · ")}`;

  document.getElementById("stats").textContent =
    `${rows.length} / ${PAYLOAD.records.length} images · ${nDisagree} désaccords` +
    ` · ${prompts.length} prompt(s)` +
    extra +
    (rows.length > displayLimit ? ` · ${shown.length} affichées` : "");

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
    const gt = d.ground_truth
      ? `<span class="tag tag-gt">GT: ${esc(d.ground_truth)}</span>`
      : "";
    const flag = agree
      ? `<span class="tag tag-agree">accord</span>`
      : `<span class="tag tag-disagree">désaccord</span>`;
    const texts = TEXTS[d.id] || {};
    const cells = prompts.map((k) => predCell(d, k, texts)).join("");
    card.innerHTML = `
      <img src="${esc(d.img)}" alt="${esc(d.id)}" loading="lazy">
      <div class="meta">
        <div class="meta-top">${gt}${flag}</div>
        <div class="preds" style="${colStyle}">${cells || "<span style='color:#8b949e'>Aucun prompt sélectionné</span>"}</div>
        <div class="fname">${esc(d.id)}</div>
      </div>`;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".prompt-link")) return;
      openLightbox(d.id);
    });
    grid.appendChild(card);
  }

  const more = document.getElementById("load-more");
  if (rows.length > displayLimit) {
    more.style.display = "block";
    more.textContent = `Afficher plus (${rows.length - displayLimit} restantes)`;
  } else {
    more.style.display = "none";
  }
}

function openLightbox(id) {
  const d = PAYLOAD.records.find((x) => x.id === id);
  if (!d) return;
  const prompts = activePrompts();
  const texts = TEXTS[id] || {};
  document.getElementById("lb-img").src = d.img;
  const gt = d.ground_truth
    ? `<span class="tag tag-gt">GT: ${esc(d.ground_truth)}</span>`
    : "";
  const agree = labelsAgree(d, prompts);
  const flag = agree
    ? `<span class="tag tag-agree">accord</span>`
    : `<span class="tag tag-disagree">désaccord</span>`;
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
    const thinking = t.thinking
      ? `<div class="reason"><strong>thinking</strong>\n${esc(t.thinking)}</div>`
      : "";
    return `<div class="pred ${cls}">
      <div class="pred-key">${esc(key)}</div>
      <div class="pred-label">${esc(run.label || "—")} <span class="score">${pct(run.confidence)}</span></div>
      ${run.level1 ? `<div style="color:#8b949e">${esc(run.level1)}</div>` : ""}
      ${(run.cues || []).length ? `<div style="color:#8b949e;margin-top:0.35rem">${esc(run.cues.join(" · "))}</div>` : ""}
      <div class="reason">${esc(t.reasoning || "")}</div>
      ${thinking}
    </div>`;
  }).join("");

  document.getElementById("lb-meta").innerHTML = `
    <div>${gt} ${flag}</div>
    <div class="lb-preds" style="${colStyle}">${cells}</div>
    <div class="fname">${esc(d.id)}</div>`;
  document.getElementById("lightbox").classList.add("open");
}

function closeLightbox() {
  document.getElementById("lightbox").classList.remove("open");
  document.getElementById("lb-img").src = "";
}

function openPromptModal(key) {
  const catalog = PAYLOAD.prompt_catalog || {};
  const meta = catalog[key];
  if (!meta) return;
  const inner = document.getElementById("prompt-modal-inner");
  inner.innerHTML = `
    <h2><code>${esc(key)}</code> — ${esc(meta.title_en)}</h2>
    <p class="sub">${meta.chars} caractères · texte envoyé au modèle</p>
    <pre>${esc(meta.text)}</pre>
    <p class="full-link"><a href="prompts.html#${esc(key)}">Ouvrir sur la page prompts</a></p>`;
  document.getElementById("prompt-modal").classList.add("open");
}

function closePromptModal() {
  document.getElementById("prompt-modal").classList.remove("open");
}

function renderPromptSummary() {
  const el = document.getElementById("prompt-summary");
  if (!el) return;
  const catalog = PAYLOAD.prompt_catalog || {};
  const parts = PAYLOAD.prompts.map((k) => {
    const title = catalog[k]?.title_en || k;
    return `<code>${esc(k)}</code> (${esc(title)})`;
  });
  el.innerHTML =
    `${parts.join(" · ")} — ${PAYLOAD.records.length} images. ` +
    "Désaccords affichés par défaut.";
}

function renderPromptChips() {
  const el = document.getElementById("prompt-chips");
  if (!el) return;
  const catalog = PAYLOAD.prompt_catalog || {};
  el.replaceChildren();
  for (const key of PAYLOAD.prompts) {
    const meta = catalog[key];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prompt-chip";
    btn.textContent = meta ? `${key} — ${meta.title_en}` : key;
    btn.title = "Cliquer pour voir le texte du prompt";
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

function resetFilters() {
  document.getElementById("f-disagree").checked = true;
  selectAllPrompts(true);
  document.querySelectorAll(".filters select").forEach((s) => {
    if (s.id === "f-prompts") return;
    if (s.multiple) Array.from(s.options).forEach((o) => (o.selected = false));
    else if (s.id === "f-vs-gt") s.value = "all";
    else if (s.id === "f-sort") s.value = "disagree";
  });
  document.getElementById("f-search").value = "";
  displayLimit = DISPLAY_STEP;
  render();
}

function bindUi() {
  document.getElementById("btn-apply").onclick = () => {
    displayLimit = DISPLAY_STEP;
    render();
  };
  document.getElementById("btn-reset").onclick = resetFilters;
  document.getElementById("btn-prompts-all").onclick = () => {
    selectAllPrompts(true);
    displayLimit = DISPLAY_STEP;
    render();
  };
  document.getElementById("btn-prompts-none").onclick = () => {
    selectAllPrompts(false);
    displayLimit = DISPLAY_STEP;
    render();
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

  const liveInputs = document.querySelectorAll(".filters select, .filters input");
  liveInputs.forEach((el) => {
    const handler = () => {
      if (document.getElementById("f-live").checked) {
        displayLimit = DISPLAY_STEP;
        render();
      }
    };
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  });
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
  document.getElementById("stats").textContent = "Chargement…";
  try {
    const loaded = await loadData();
    PAYLOAD = loaded.payload;
    TEXTS = loaded.texts;
    if (!PAYLOAD.records || !PAYLOAD.records.length) {
      throw new Error("aucune image dans les données");
    }

    fillSelect("f-gt", uniq(PAYLOAD.records.map((d) => d.ground_truth)));
    const predLabels = [];
    for (const d of PAYLOAD.records) {
      for (const k of PAYLOAD.prompts) {
        const lab = runOf(d, k)?.label;
        if (lab) predLabels.push(lab);
      }
    }
    fillSelect("f-pred", uniq(predLabels));
    fillPromptSelect();

    renderPromptSummary();
    renderPromptChips();
    bindUi();
    render();
    errEl.style.display = "none";
  } catch (err) {
    document.getElementById("stats").textContent = "Erreur de chargement";
    errEl.style.display = "block";
    errEl.textContent =
      "Impossible de charger les données (data.js / data.json). " +
      "Relancez: python3 compare_prompt_gallery.py — " +
      err.message;
    console.error(err);
  }
}

init();
