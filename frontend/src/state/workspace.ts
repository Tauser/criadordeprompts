// Pure, serializable workspace logic. No DOM, no network: unit-tested in workspace.test.ts.
import {CATEGORIES, type Attribute, type Category, type StudioRequest} from '../api/types';

export interface FileInfo {hash: string; width: number; height: number; name: string}
export interface Workspace {
  request: StudioRequest;
  files: Record<string, FileInfo>;                                    // reference id -> stored file
  restore: Record<string, Partial<Record<Category, Attribute | null>>>; // reference id -> attributes before it was applied
  maskHash: string | null;
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
    references: [], target_id: null, mask: false, characters: [], participants: {requested: null, existing: null},
    context: {supports: null, allow_new_supports: false, allow_reframing: true, original_framing: null},
    details: '', confirmations: [],
    output: {profile: 'qwen21', resolution: mode === 'edit' ? 0 : 1024, aspect: '3:4', width: null, height: null,
      seed: null, variations: 1, verify: false, refine: false},
    engine: {negative_prompt: ''},
  };
}

export function initialWorkspace(mode: 'generate' | 'edit'): Workspace {
  return {request: initialRequest(mode), files: {}, restore: {}, maskHash: null};
}

const clone = <T>(value: T): T => structuredClone(value);

export function setAttribute(ws: Workspace, category: Category, attribute: Attribute): Workspace {
  const next = clone(ws);
  next.request.attributes[category] = attribute;
  for (const restore of Object.values(next.restore)) delete restore[category];   // an explicit choice wins
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
  for (const category of CATEGORIES) {
    const attribute = next.request.attributes[category];
    if (attribute?.intent === 'transfer' && attribute.reference_id === id) {
      const previous = restore[category];
      if (previous) next.request.attributes[category] = previous;
      else if (next.request.mode === 'edit') next.request.attributes[category] = {intent: 'keep'};
      else delete next.request.attributes[category];
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
  }
  return next;
}

export function setTarget(ws: Workspace, id: string): Workspace {
  const next = clone(ws);
  release(next, id);
  next.request.characters = (next.request.characters ?? []).filter(c => c.reference_id !== id);
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
  if (request.mode === 'generate') {request.target_id = null; request.mask = false;}
  return request;
}

export function filesForSubmit(ws: Workspace): Record<string, string> {
  return Object.fromEntries(Object.entries(ws.files).map(([id, file]) => [id, file.hash]));
}
