// Pure, serializable workspace logic. No DOM, no network: unit-tested in workspace.test.ts.
import {CATEGORIES, type Attribute, type Category, type CharacterPosition, type StudioRequest, type Suggestion} from '../api/types';

export interface FileInfo {hash: string; width: number; height: number; name: string}
export interface Workspace {
  request: StudioRequest;
  files: Record<string, FileInfo>;                                    // reference id -> stored file
  restore: Record<string, Partial<Record<Category, Attribute | null>>>; // reference id -> attributes before it was applied
  maskHash: string | null;
  existingFrom?: string | null;     // hash of the photo whose detected people filled "Pessoas na foto"
  auto?: Partial<Record<Category, 'pose' | 'action'>>;   // fields the Studio filled for the pose or action
  touched?: Category[];             // fields the person chose: the Studio never fills them again
}

export const ROLES: Record<string, {label: string; categories: Category[]}> = {
  character: {label: 'Personagem principal (rosto, corpo, pele e cabelo)', categories: ['face', 'body', 'skin', 'hair']},
  face: {label: 'Rosto', categories: ['face']},
  hair: {label: 'Cabelo', categories: ['hair']},
  body: {label: 'Corpo e pele', categories: ['body', 'skin']},
  wardrobe: {label: 'Roupa', categories: ['wardrobe']},
  pose: {label: 'Pose', categories: ['pose']},
  expression: {label: 'Expressão', categories: ['expression']},
  environment: {label: 'Cenário', categories: ['environment']},
  lighting: {label: 'Iluminação', categories: ['lighting']},
  style: {label: 'Estilo', categories: ['style']},
};

export function initialRequest(mode: 'generate' | 'edit'): StudioRequest {
  const attributes: StudioRequest['attributes'] = {};
  if (mode === 'edit') for (const category of CATEGORIES) attributes[category] = {intent: 'keep'};
  return {
    schema_version: 1, mode, content_mode: 'standard', prompt_mode: 'structured', manual_prompt: null, attributes,
    references: [], target_id: null, mask: false, characters: [], wardrobe_scope: 'primary',
    participants: {requested: null, existing: null},
    context: {supports: null, allow_new_supports: false, allow_reframing: true, original_framing: null},
    details: '', confirmations: [],
    output: {profile: 'qwen21', resolution: mode === 'edit' ? 0 : 1024, aspect: '3:4', width: null, height: null,
      seed: null, variations: 1, verify: false, refine: false, face_detail: null},
    engine: {negative_prompt: ''},
  };
}

export function initialWorkspace(mode: 'generate' | 'edit'): Workspace {
  return {request: initialRequest(mode), files: {}, restore: {}, maskHash: null};
}

const clone = <T>(value: T): T => structuredClone(value);

const mark = (next: Workspace, category: Category) => {
  next.touched = [...new Set([...(next.touched ?? []), category])];
  if (next.auto) delete next.auto[category];
};

export function setAttribute(ws: Workspace, category: Category, attribute: Attribute): Workspace {
  const next = clone(ws);
  next.request.attributes[category] = attribute;
  if (category === 'wardrobe' && attribute.intent !== 'set') next.request.wardrobe_scope = 'primary';
  for (const restore of Object.values(next.restore)) delete restore[category];   // an explicit choice wins
  mark(next, category);
  return next;
}

const defaultAttribute = (mode: 'generate' | 'edit'): Attribute => mode === 'edit' ? {intent: 'keep'} : {intent: 'free'};
const isDefault = (ws: Workspace, category: Category) => {
  const current = ws.request.attributes[category];
  return !current || current.intent === defaultAttribute(ws.request.mode).intent || current.intent === 'free';
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A suggestion the person clicked: it becomes their own choice, like any other change of the field. */
export function applySuggestion(ws: Workspace, suggestion: Suggestion): Workspace {
  const next = suggestion.attribute ? setAttribute(ws, suggestion.field, suggestion.attribute) : clone(ws);
  Object.assign(next.request.context, suggestion.context);
  if (!suggestion.attribute) mark(next, suggestion.field);
  return next;
}

/** Fills the fields the person has not touched with the values the pose or action needs, and gives back the ones
 * it filled before when the pose or action no longer needs them. Returns the same workspace when nothing changes. */
export function syncAuto(ws: Workspace, suggestions: Suggestion[]): Workspace {
  const touched = new Set(ws.touched ?? []);
  const wanted = new Map<Category, Suggestion>();
  for (const s of suggestions) {
    if (s.auto && s.source !== 'scene' && s.attribute && !touched.has(s.field) && !wanted.has(s.field) && !Object.keys(s.context).length
        && (ws.auto?.[s.field] || isDefault(ws, s.field))) wanted.set(s.field, s);
  }
  const stale = (Object.keys(ws.auto ?? {}) as Category[]).filter(c => !wanted.has(c));
  const changes = [...wanted.values()].filter(s => !same(ws.request.attributes[s.field], s.attribute)
    || ws.auto?.[s.field] !== s.source);
  if (!changes.length && !stale.length) return ws;
  const next = clone(ws);
  next.auto = {...next.auto};
  for (const s of changes) {
    next.request.attributes[s.field] = s.attribute!;
    if (s.source !== 'scene') next.auto[s.field] = s.source;
  }
  for (const category of stale) {
    next.request.attributes[category] = defaultAttribute(next.request.mode);
    delete next.auto[category];
  }
  return next;
}

export function addReference(ws: Workspace, id: string, file: FileInfo): Workspace {
  if (ws.request.references.length >= 10) throw new Error('Use até dez imagens.');
  const next = clone(ws);
  next.request.references.push({id, label: file.name});
  next.files[id] = file;
  if (next.request.mode === 'edit' && !next.request.target_id) next.request.target_id = id;
  return next;
}

export function applyReference(ws: Workspace, id: string, role: keyof typeof ROLES): Workspace {
  if (id === ws.request.target_id) throw new Error('A foto alvo já é a base da edição; use "Manter".');
  const next = clone(ws);
  next.request.characters = (next.request.characters ?? []).filter(c => c.reference_id !== id);
  const restore = next.restore[id] ?? {};
  for (const category of ROLES[role].categories) {
    const current = next.request.attributes[category] ?? null;
    if (!(category in restore) && !(current?.intent === 'transfer' && current.reference_id === id)) {
      restore[category] = current;
    }
    next.request.attributes[category] = {intent: 'transfer', reference_id: id};
  }
  next.restore[id] = restore;
  return next;
}

function release(next: Workspace, id: string) {
  const restore = next.restore[id] ?? {};
  // A saved choice is only worth restoring if it does not point at this or any other missing reference.
  const exists = (ref: string) => ref !== id && next.request.references.some(r => r.id === ref);
  const usable = (attribute: Attribute | null | undefined) =>
    attribute && !(attribute.intent === 'transfer' && !exists(attribute.reference_id ?? '')) ? attribute : null;
  for (const category of CATEGORIES) {
    const attribute = next.request.attributes[category];
    if (attribute?.intent === 'transfer' && attribute.reference_id === id) {
      const previous = usable(restore[category]);
      if (previous) next.request.attributes[category] = previous;
      else if (next.request.mode === 'edit') next.request.attributes[category] = {intent: 'keep'};
      else delete next.request.attributes[category];
    }
  }
  // Other references remember what to bring back when they are released; that must never be this one.
  for (const [other, chain] of Object.entries(next.restore)) {
    if (other === id) continue;
    for (const category of Object.keys(chain) as Category[]) {
      const saved = chain[category];
      if (saved?.intent === 'transfer' && saved.reference_id === id) chain[category] = usable(restore[category]);
    }
  }
  delete next.restore[id];
}

export const MAX_CHARACTERS = 3;

// Another person in the scene, with the appearance of a reference photo. Order = second, third, fourth person.
export function addCharacter(ws: Workspace, id: string): Workspace {
  if (id === ws.request.target_id) throw new Error('A foto editada não pode ser também a de outro personagem.');
  const characters = ws.request.characters ?? [];
  if (characters.some(c => c.reference_id === id)) return ws;
  if (characters.length >= MAX_CHARACTERS) throw new Error(`Use até ${MAX_CHARACTERS} personagens extras.`);
  const next = clone(ws);
  release(next, id);                         // a character photo describes that person only
  next.request.characters = [...characters, {reference_id: id, description: ''}];
  return next;
}

export function removeCharacter(ws: Workspace, id: string): Workspace {
  const next = clone(ws);
  next.request.characters = (next.request.characters ?? []).filter(c => c.reference_id !== id);
  return next;
}

export function describeCharacter(ws: Workspace, id: string, description: string): Workspace {
  const next = clone(ws);
  next.request.characters = (next.request.characters ?? []).map(c => c.reference_id === id ? {...c, description} : c);
  return next;
}

export function placeCharacter(ws: Workspace, id: string, position: CharacterPosition | null): Workspace {
  const next = clone(ws);
  next.request.characters = (next.request.characters ?? []).map(c => c.reference_id === id ? {...c, position} : c);
  return next;
}

export function characterNumber(ws: Workspace, id: string): number | null {
  const index = (ws.request.characters ?? []).findIndex(c => c.reference_id === id);
  return index < 0 ? null : index + 2;
}

export function removeReference(ws: Workspace, id: string): Workspace {
  const next = clone(ws);
  release(next, id);
  next.request.characters = (next.request.characters ?? []).filter(c => c.reference_id !== id);
  next.request.references = next.request.references.filter(ref => ref.id !== id);
  delete next.files[id];
  if (next.request.target_id === id) {      // never promote another image silently
    next.request.target_id = null;
    next.request.mask = false;
    next.maskHash = null;
    next.request.participants.existing = null; next.existingFrom = null;
  }
  return next;
}

export function setTarget(ws: Workspace, id: string): Workspace {
  const next = clone(ws);
  release(next, id);
  next.request.characters = (next.request.characters ?? []).filter(c => c.reference_id !== id);
  if (next.request.target_id !== id) {     // another photo: its people are counted again
    next.request.participants.existing = null; next.existingFrom = null;
  }
  next.request.target_id = id;
  next.request.mask = false;
  next.maskHash = null;
  return next;
}

export function referenceRoles(ws: Workspace, id: string): Category[] {
  return CATEGORIES.filter(c => {
    const a = ws.request.attributes[c];
    return a?.intent === 'transfer' && a.reference_id === id;
  });
}

export function switchMode(drafts: Record<'generate' | 'edit', Workspace>, from: Workspace, to: 'generate' | 'edit') {
  const saved = {...drafts, [from.request.mode]: from};
  const target = clone(saved[to]);
  target.request.content_mode = from.request.content_mode;
  return {drafts: saved, workspace: target};
}

export function enterManual(ws: Workspace, composed: string): Workspace {
  const next = clone(ws);
  next.request.prompt_mode = 'manual';
  next.request.manual_prompt = composed;
  return next;
}

export function leaveManual(ws: Workspace): Workspace {
  const next = clone(ws);
  next.request.prompt_mode = 'structured';
  next.request.manual_prompt = null;
  return next;
}

export function requestForSubmit(ws: Workspace): StudioRequest {
  const request = clone(ws.request);
  request.characters = (request.characters ?? []).map(c => ({...c, description: c.description.trim()}));
  if (!request.characters.length) delete request.characters;   // older Studio servers do not know this field
  if (request.prompt_mode === 'structured') request.manual_prompt = null;
  if (request.attributes.wardrobe?.intent !== 'set') request.wardrobe_scope = 'primary';
  if (request.mode === 'generate') {request.target_id = null; request.mask = false;}
  if (request.mask) {request.output.width = null; request.output.height = null;}   // a mask keeps the photo's size
  return request;
}

export function filesForSubmit(ws: Workspace): Record<string, string> {
  return Object.fromEntries(Object.entries(ws.files).map(([id, file]) => [id, file.hash]));
}
