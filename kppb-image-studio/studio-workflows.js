"use strict";

let workflowMetadata = {
  profiles: {
    qwen21: { label: "Qwen Image 2.1 completo", defaults: { steps: 40, cfg: 1, sampler: "euler", scheduler: "simple", resolution: 0, cache_device: "cpu", cache_dtype: "default", decode: "normal", bit_depth: "16-bit", denoise: 1 } },
    turbo: { label: "Qwen Image 2.1 Turbo", defaults: { steps: 8, cfg: 1, sampler: "euler", scheduler: "turbo_sigmas", resolution: 1024, cache_device: "cpu", cache_dtype: "int8", decode: "tiled", bit_depth: "8-bit", denoise: 1 } },
  },
  samplers: ["euler"], schedulers: ["simple"],
};
let previousWorkflow = "", previousWorkflowMode = app.mode;
const workflowResolution = { edit: 0, generate: 1024 };
const workflowFields = {
  steps: "engineSteps", cfg: "engineCfg", sampler: "engineSampler", scheduler: "engineScheduler",
  cache_device: "engineCacheDevice", cache_dtype: "engineCacheDtype", decode: "engineDecode",
  bit_depth: "engineBitDepth", denoise: "engineDenoise", width: "engineWidth", height: "engineHeight",
  max_length: "engineMaxLength", temperature: "engineTemperature", top_k: "engineTopK",
  top_p: "engineTopP", min_p: "engineMinP", repetition_penalty: "engineRepetition",
  presence_penalty: "enginePresence", sampling_mode: "engineSampling", mtp: "engineMtp",
};
const numericWorkflowFields = new Set(["steps", "cfg", "denoise", "width", "height", "max_length", "temperature", "top_k", "top_p", "min_p", "repetition_penalty", "presence_penalty"]);

function setWorkflowChoices(id, choices, selected) {
  const node = $(id);
  node.replaceChildren();
  for (const choice of choices) {
    const item = document.createElement("option");
    item.value = choice;
    item.textContent = choice === "turbo_sigmas" ? "Sigmas próprios do Turbo" : choice;
    node.append(item);
  }
  node.value = choices.includes(selected) ? selected : choices[0];
}

function hydrateWorkflowOptions(data) {
  if (data.profiles) workflowMetadata = data;
  const sampler = val("engineSampler"), scheduler = val("engineScheduler");
  setWorkflowChoices("engineSampler", workflowMetadata.samplers, sampler);
  setWorkflowChoices("engineScheduler", [...workflowMetadata.schedulers, "turbo_sigmas"], scheduler);
  syncWorkflowControls();
}

function syncWorkflowControls(target) {
  const profile = val("workflowProfile"), turbo = profile === "turbo";
  const defaults = workflowMetadata.profiles[profile].defaults;
  if (previousWorkflow !== profile) {
    for (const [key, id] of Object.entries(workflowFields)) {
      if (Object.hasOwn(defaults, key)) $(id).value = defaults[key];
    }
    setWorkflowChoices("engineSampler", workflowMetadata.samplers, defaults.sampler);
    setWorkflowChoices("engineScheduler", [...workflowMetadata.schedulers, "turbo_sigmas"], defaults.scheduler);
    $("engineCustomSize").checked = false;
    $("engineRefine").checked = false;
    workflowResolution.edit = defaults.resolution;
    workflowResolution.generate = defaults.resolution || 1024;
    $("resolution").value = workflowResolution[app.mode];
    previousWorkflow = profile;
  }
  if (previousWorkflowMode !== app.mode) {
    $("resolution").value = workflowResolution[app.mode];
    previousWorkflowMode = app.mode;
  }
  if (target?.id === "resolution") workflowResolution[app.mode] = Number(val("resolution"));
  $("resolution").querySelector('option[value="0"]').disabled = app.mode !== "edit";
  if (app.mode !== "edit" && val("resolution") === "0") $("resolution").value = "1024";
  for (const id of ["engineSteps", "engineCfg", "engineSampler", "engineScheduler", "engineDenoise"])
    $(id).disabled = turbo;
  if (turbo) $("engineRefine").checked = false;
  const customSize = $("engineCustomSize").checked;
  $("engineWidth").disabled = $("engineHeight").disabled = !customSize;
  $("aspect").disabled = app.mode === "edit" || customSize;
  $("aspect").title = customSize ? "O tamanho usa os campos Largura e Altura." : app.mode === "edit" ? "A edição segue a proporção da primeira referência." : "Formato aplicado à geração.";
  const negativeActive = !turbo && Number(val("engineCfg")) > 1;
  $("engineNegative").disabled = !negativeActive;
  $("negativeHint").textContent = negativeActive ? "Prompt negativo ativo; alterar CFG também altera o comportamento da geração." : "Com CFG 1, o prompt negativo não influencia o resultado.";
  $("refinerPanel").classList.toggle("engine-unavailable", turbo);
  for (const id of ["engineRefine", "engineThinking", "engineMaxLength", "engineSampling", "engineMtp"])
    $(id).disabled = turbo;
  const sampledText = !turbo && val("engineSampling") === "on";
  for (const id of ["engineTemperature", "engineTopK", "engineTopP", "engineMinP", "engineRepetition", "enginePresence"])
    $(id).disabled = !sampledText;
  $("engineBadge").textContent = (turbo ? "Turbo" : "Completo") + " · " + val("engineSteps") + " passos";
  $("workflowHint").textContent = turbo
    ? "Modelo Turbo, oito passos e sequência própria de sigmas. Aprimorador indisponível neste perfil."
    : "Modelo completo do Qwen35_image21_i2i. Original mantém as dimensões da referência em múltiplos de 32. O aprimorador é opcional.";
  if ($("heroWorkflow")) $("heroWorkflow").textContent = workflowMetadata.profiles[profile].label + " · " + val("engineSteps") + " passos · CFG " + val("engineCfg");
  syncWorkflowBusy();
}

function syncWorkflowBusy() {
  $("previewRefine").disabled = generationBusy || !comfyReady || val("workflowProfile") !== "qwen21";
  $("useRefinedPrompt").disabled = generationBusy;
  $("stopGeneration").disabled = !generationBusy || !currentJob || generationStopping;
  $("stopGeneration").textContent = generationStopping ? "Parando…" : "■ Parar geração";
  $("resumeGeneration").disabled = generationBusy;
}

function readWorkflowConfig() {
  const settings = Object.fromEntries(Object.entries(workflowFields).map(([key, id]) =>
    [key, numericWorkflowFields.has(key) ? Number(val(id)) : val(id)]));
  settings.custom_size = $("engineCustomSize").checked;
  settings.refine_prompt = val("workflowProfile") === "qwen21" && $("engineRefine").checked;
  settings.thinking = $("engineThinking").checked;
  settings.negative_prompt = val("engineNegative");
  return { profile: val("workflowProfile"), settings };
}

function showRefinedPreview(text) {
  $("refinedPromptPreview").value = text;
  $("refinedPreview").classList.remove("hidden");
}

function showGenerationProgress(data) {
  const root = $("generationProgress"), bar = $("generationProgressBar");
  const running = data.status === "running", completed = data.status === "completed" && data.kind !== "refine";
  root.classList.toggle("hidden", !running && !completed);
  if (!running && !completed) return;
  const progress = data.progress || {}, percent = Number(progress.percent);
  const hasPercent = data.kind !== "refine" && Number.isFinite(percent) && progress.percent != null;
  const labels = {preparing: "Preparando modelos e referências…", sampling: "Gerando imagem", decoding: "Decodificando imagem…", saving: "Salvando imagem…", refining: "Aprimorando o prompt…"};
  $("generationProgressLabel").textContent = completed ? "Imagem concluída" : data.kind === "refine" ? "Aprimorando o prompt…" : labels[progress.phase] || "Preparando geração…";
  $("generationProgressPercent").textContent = completed ? "100%" : hasPercent ? Math.round(percent) + "%" : "";
  if (completed || hasPercent) bar.value = completed ? 100 : Math.max(0, Math.min(100, percent));
  else bar.removeAttribute("value");
  $("generationProgressHint").textContent = completed ? "Resultado pronto e salvo." : hasPercent
    ? (progress.phase === "sampling" ? `Passo ${progress.value} de ${progress.maximum}.` : "Passos de geração concluídos; finalizando a imagem.") + " A porcentagem acompanha os passos, não o tempo total."
    : data.kind === "refine" ? "A quantidade final de tokens pode variar." : "A porcentagem aparece quando o ComfyUI informar os passos de geração.";
}

function appendImageComparison(card, job, index) {
  const details = document.createElement("details"), summary = document.createElement("summary");
  details.className = "image-comparison";
  summary.textContent = "Comparar antes / depois";
  const frame = document.createElement("div"), before = document.createElement("img"), after = document.createElement("img");
  frame.className = "comparison-frame";
  before.src = "/api/reference?job=" + encodeURIComponent(job) + "&index=0";
  after.src = "/api/image?job=" + encodeURIComponent(job) + "&index=" + index;
  before.alt = "Imagem original enviada neste pedido";
  after.alt = "Imagem editada";
  before.className = "comparison-before";
  after.className = "comparison-after";
  const label = document.createElement("label"), slider = document.createElement("input"), hint = document.createElement("p");
  slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.value = "50";
  slider.setAttribute("aria-label", "Comparação antes e depois");
  label.textContent = "Original ← mover → Resultado";
  label.append(slider);
  hint.className = "hint";
  hint.textContent = "Comparação de enquadramento. Dimensões diferentes podem impedir o alinhamento exato.";
  const adjust = () => { before.style.clipPath = `inset(0 ${100 - Number(slider.value)}% 0 0)`; };
  slider.addEventListener("input", adjust);
  after.addEventListener("load", () => { frame.style.aspectRatio = `${after.naturalWidth} / ${after.naturalHeight}`; });
  frame.append(after, before);
  details.append(summary, frame, label, hint);
  card.append(details);
  adjust();
}

$("previewRefine").addEventListener("click", () => sendToComfy(true));
$("useRefinedPrompt").addEventListener("click", () => {
  if (generationBusy || !val("refinedPromptPreview").trim()) return;
  manualPromptBackup = val("outputEn");
  $("restoreManualPrompts").classList.remove("hidden");
  $("outputEn").value = val("refinedPromptPreview");
  manualPrompts.en = true;
  $("engineRefine").checked = false;
  $("liveStatus").textContent = "● Prompt aprimorado selecionado";
  syncPromptStatus("Texto da prévia selecionado. Aprimoramento automático desligado para evitar outra reescrita.");
  updateCounts(); refreshInputValidation(); syncWorkflowControls();
});
syncWorkflowControls();
