"use strict";

// Registro próprio da edição, inicializado antes de montar as ações básicas.
const editorActionParticipants = Object.freeze({
  embrace: 2,
  handshake: 2,
  dance_pair: 2,
  conversation: 2,
  ...Object.fromEntries(
    Object.keys(dict.sensualGroupActions).map((key) => [key, 2]),
  ),
});

// 1. Ações Básicas e Gestos do Dia a Dia
const basicActions = {
  ...Object.fromEntries(
    [
      "smile",
      "eye",
      "hair",
      "lookback",
      "confidence",
      "embrace",
      "handshake",
      "dance_pair",
      "conversation",
    ].map((key) => [
      "basic:" + key,
      {
        label: builtinActionNames[key],
        prompt: dict.actions[key][0],
        expression: ["smile", "eye", "confidence"].includes(key),
        pair: actionNeedsPartner(key),
        participants: actionRequiredParticipants(key),
      },
    ]),
  ),
  wave: {
    label: "Acenar · mão direita",
    prompt: "waving with the right hand raised, palm facing the camera",
  },
  thumbs_up: {
    label: "Sinal de positivo · mão direita",
    prompt: "giving a thumbs-up with the right hand",
  },
  point: {
    label: "Apontar · indicador direito",
    prompt: "pointing to the subject's right with the right index finger",
  },
  folded_arms: {
    label: "Cruzar os braços",
    prompt: "folding both arms naturally across the chest",
  },
  hold_mug: {
    label: "Segurar uma caneca",
    prompt: "holding a ceramic mug in the right hand at chest height",
    prop: true,
  },
  drink_mug: {
    label: "Beber numa caneca",
    prompt: "bringing a ceramic mug to the lips with the right hand",
    prop: true,
  },
  hold_book: {
    label: "Segurar um livro aberto",
    prompt: "holding an open book with both hands at waist height",
    prop: true,
  },
  read_book: {
    label: "Ler um livro",
    prompt:
      "reading an open book held in both hands, looking down at its pages",
    prop: true,
  },
  use_phone: {
    label: "Usar o celular",
    prompt:
      "holding a smartphone in the left hand and tapping its screen with the right index finger",
    prop: true,
  },
  phone_call: {
    label: "Telefone junto ao ouvido",
    prompt: "holding a smartphone against the right ear with the right hand",
    prop: true,
  },
  adjust_glasses: {
    label: "Ajustar os óculos",
    prompt: "adjusting the frame of worn eyeglasses with the right hand",
    prop: true,
  },
  carry_bag: {
    label: "Carregar uma bolsa",
    prompt:
      "holding a small bag by its handles in the left hand beside the hip",
    prop: true,
  },
};

// 2. Ações Sensuais / Adultas Individuais
const sensualActions = Object.fromEntries(
  Object.keys(dict.sensualActions).map((key) => [
    "sensual:" + key,
    {
      label: dict.sensualActions[key][1] || key,
      prompt: dict.sensualActions[key][0] || key,
      expression: ["moaning expression"].includes(key),
      prop: ["holding vibrator", "grinding on pillow"].includes(key),
    },
  ]),
);

// 3. Ações Sensuais em Dupla ou Grupo
const groupActions = Object.fromEntries(
  Object.keys(dict.sensualGroupActions).map((key) => [
    "group:" + key,
    {
      label: dict.sensualGroupActions[key][1] || key,
      prompt: dict.sensualGroupActions[key][0] || key,
      pair: true,
      participants: 2,
    },
  ]),
);

// Dicionário completo de ações congelado para leitura
const editorActions = Object.freeze({
  ...basicActions,
  ...sensualActions,
  ...groupActions,
});

function actionRequiredParticipants(key) {
  const cleanKey = String(key || "").replace(/^(basic:|group:|sensual:)/, "");
  return editorActionParticipants[cleanKey] || 1;
}

function actionNeedsPartner(key) {
  return actionRequiredParticipants(key) > 1;
}

function selectedEditAction() {
  if (app.mode !== "edit" || !activeOperations().includes("action"))
    return null;
  return editorActions[val("editAction")] || null;
}

function syncEditorActionExpression(target) {
  if (
    app.mode !== "edit" ||
    !target ||
    !editorActions[val("editAction")]?.expression
  )
    return;
  const action = $("editOps").querySelector('input[value="action"]');
  const expression = $("editOps").querySelector('input[value="expression"]');
  if ((target.id === "editAction" || target === action) && action.checked)
    expression.checked = false;
  else if (
    (target.id === "editExpression" || target === expression) &&
    expression.checked
  )
    action.checked = false;
}

const composeBeforeEditActions = compose;
const preserveBeforeEditActions = preservePhrase;

preservePhrase = function (key, lang, changePose) {
  const action = selectedEditAction();
  return preserveBeforeEditActions(
    key,
    lang,
    changePose || (key === "body" && Boolean(action) && !action.expression),
  );
};

compose = function (lang) {
  const original = composeBeforeEditActions(lang),
    selected = selectedEditAction();
  if (lang !== "en" || !selected) return original;
  const partner = partnerRequirement(val("editAction"), lang, true);
  const instruction =
    "Change the subject's action to: " +
    selected.prompt +
    ". " +
    (selected.expression
      ? "Change only the expression and gaze; preserve facial identity."
      : activeOperations().includes("pose")
        ? "Fit the action to the requested pose."
        : "Preserve the source posture wherever compatible with the action; allow only the body position and gaze changes needed to perform it.") +
    (selected.prop ? " Add only the object needed for this action." : "") +
    (partner
      ? " " + partner
      : selected.pair
        ? " Use only the two people already present in <image1>."
        : "");
  const separator = getEditStrategy() === "detailed" ? "\n\n" : "\n";
  return original.replace(
    /^Edit <image1>\./,
    (header) => header + separator + instruction,
  );
};

// Povoa o select no HTML com os grupos bem divididos
const actionSelect = $("editAction");
if (actionSelect) {
  actionSelect.replaceChildren();

  // Opção Padrão
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "none";
  defaultOpt.textContent = "Manter ação original";
  actionSelect.append(defaultOpt);

  // Grupo 1: Ações / Gestos Normais
  const groupBasic = document.createElement("optgroup");
  groupBasic.label = "Ações e gestos cotidianos";
  for (const [key, value] of Object.entries(basicActions)) {
    const entry = document.createElement("option");
    entry.value = key;
    entry.textContent = value.label;
    groupBasic.append(entry);
  }
  actionSelect.append(groupBasic);

  // Grupo 2: Ações Sensuais / Adultas
  const groupSensual = document.createElement("optgroup");
  groupSensual.label = "Ações / Gestos sensuais (25+)";
  for (const [key, value] of Object.entries(sensualActions)) {
    const entry = document.createElement("option");
    entry.value = key;
    entry.textContent = value.label;
    groupSensual.append(entry);
  }
  actionSelect.append(groupSensual);

  // Grupo 3: Ações em Dupla / Grupo
  const groupGroup = document.createElement("optgroup");
  groupGroup.label = "Ações em dupla / casal";
  for (const [key, value] of Object.entries(groupActions)) {
    const entry = document.createElement("option");
    entry.value = key;
    entry.textContent = value.label;
    groupGroup.append(entry);
  }
  actionSelect.append(groupGroup);
}

update();
