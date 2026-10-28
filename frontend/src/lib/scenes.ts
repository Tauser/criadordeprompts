import {fileUrl} from '../api/client';
import type {CharacterPosition, Run, SavedCharacter, SavedRequest, StudioRequest} from '../api/types';
import {addReference, addSavedCharacter, applyPreset, applyReference, filesForSubmit, initialWorkspace, placeCharacter,
  requestForSubmit, setSex, type Workspace} from '../state/workspace';
import {uuid} from './uuid';
import {load, save} from './storage';
import {imageSize} from './characters';

// "Cenas do conto": a story is a list of scenes. Each scene is a saved request plus the people of the scene (fichas).
// A scene whose saved request is an edit edits a photo: an uploaded one, or the result of an earlier scene.
export const STORY_KEY = 'prisma.storyScenes';
export const EXTRA_PEOPLE_MAX = 2;
export const NO_PHOTO_WARNING = 'Esta cena edita uma foto: escolha a foto a editar.';

export interface ScenePhoto {hash: string; width: number; height: number; name: string}
export interface ScenePerson {character: string; position: CharacterPosition | null}   // character: the ficha's id
export interface Scene {
  id: string; preset: string; main: string | null; people: ScenePerson[]; note: string;
  photo?: ScenePhoto | null;      // edit scenes: the photo to edit
  fromScene?: string | null;      // edit scenes: the id of an earlier scene whose result is the photo to edit
}
export interface Story {title: string; scenes: Scene[]}

// The values of the position select of a person in the scene; "Ao lado" is no position at all.
export const POSITIONS: {value: CharacterPosition | null; label: string}[] = [
  {value: null, label: 'Ao lado'}, {value: 'left', label: 'À esquerda'}, {value: 'right', label: 'À direita'},
  {value: 'behind', label: 'Atrás'}, {value: 'front', label: 'Na frente'},
];

export function newScene(): Scene {
  return {id: uuid(), preset: '', main: null, people: [], note: '', photo: null, fromScene: null};
}

export function loadStory(): Story {
  const stored = load<Partial<Story> | null>(STORY_KEY, null);
  return {
    title: typeof stored?.title === 'string' ? stored.title : '',
    scenes: Array.isArray(stored?.scenes) ? stored.scenes : [],
  };
}

export function saveStory(story: Story): void {
  save(STORY_KEY, story);
}

export interface SceneInput {
  preset: SavedRequest;
  main: SavedCharacter | null;
  people: {character: SavedCharacter; position: CharacterPosition | null}[];
  note: string;
  photo?: ScenePhoto | null;      // edit scenes only: the photo to edit
  existing?: number;              // edit scenes only: the people counted in the photo
}

export interface BuiltScene {request: StudioRequest; files: Record<string, string>}

export const photoSize = (hash: string) => imageSize(fileUrl(hash));

/** The picture a finished run made: the best task's, else the first one that has a file. */
export function resultHash(run: Run): string | null {
  const image = run.images.find(i => i.task_id === run.best_task_id && i.files.length) ?? run.images.find(i => i.files.length);
  return image?.files[0] ?? null;
}

async function photoFile(character: SavedCharacter, size: (hash: string) => Promise<{width: number; height: number}>) {
  const hash = character.photos[0];
  if (!hash) throw new Error(`A ficha “${character.name}” não tem foto.`);
  const {width, height} = await size(hash);
  return {hash, width, height, name: character.name};
}

/** The request of one scene, built the way the form builds it. A generation: the preset, then the main person (a
 * reference that fills the face, body, skin and hair), then each other person (their photo, notes and position), then
 * the note in the details. An edit: the photo is the target, the preset is applied to it, the main person does not
 * apply (the photo is the person), and each other person is added to the photo. Throws when the scene cannot be sent
 * (no photo for an edit, a ficha twice, a ficha without photo). The Studio validates it afterwards. */
export async function buildSceneRequest(input: SceneInput,
  size: (hash: string) => Promise<{width: number; height: number}> = photoSize): Promise<BuiltScene> {
  return input.preset.request.mode === 'edit' ? buildEditScene(input, size) : buildNewScene(input, size);
}

async function buildNewScene(input: SceneInput,
  size: (hash: string) => Promise<{width: number; height: number}>): Promise<BuiltScene> {
  const chosen = [input.main, ...input.people.map(p => p.character)].filter((c): c is SavedCharacter => !!c);
  if (new Set(chosen.map(c => c.id)).size !== chosen.length) throw new Error('A mesma ficha aparece mais de uma vez na cena.');

  let ws: Workspace = applyPreset(initialWorkspace('generate'), input.preset.request);
  if (input.main) {
    const id = 'ref-' + uuid().slice(0, 8);
    ws = applyReference(addReference(ws, id, await photoFile(input.main, size)), id, 'character');
    if (input.main.sex) ws = setSex(ws, 1, input.main.sex);
  }
  for (const {character, position} of input.people) {
    const id = 'ref-' + uuid().slice(0, 8);
    ws = placeCharacter(addSavedCharacter(ws, id, await photoFile(character, size), character.notes, character.sex ?? null), id, position);
  }
  const note = input.note.trim();
  if (note) ws = {...ws, request: {...ws.request, details: [ws.request.details.trim(), note].filter(Boolean).join('\n')}};
  return {request: requestForSubmit(ws), files: filesForSubmit(ws)};
}

async function buildEditScene(input: SceneInput,
  size: (hash: string) => Promise<{width: number; height: number}>): Promise<BuiltScene> {
  if (!input.photo) throw new Error(NO_PHOTO_WARNING);
  const people = input.people.map(p => p.character);
  if (new Set(people.map(c => c.id)).size !== people.length) throw new Error('A mesma ficha aparece mais de uma vez na cena.');

  // The photo becomes the target when it is added to an edit that has no target yet (as an upload does in the form).
  let ws: Workspace = applyPreset(initialWorkspace('edit'), input.preset.request);
  ws = addReference(ws, 'ref-' + uuid().slice(0, 8), input.photo);
  ws = {...ws, existingFrom: input.photo.hash,
    request: {...ws.request, participants: {...ws.request.participants, existing: input.existing ?? 1}}};
  for (const {character, position} of input.people) {
    const id = 'ref-' + uuid().slice(0, 8);
    ws = placeCharacter(addSavedCharacter(ws, id, await photoFile(character, size), character.notes, character.sex ?? null), id, position);
  }
  const note = input.note.trim();
  if (note) ws = {...ws, request: {...ws.request, details: [ws.request.details.trim(), note].filter(Boolean).join('\n')}};
  return {request: requestForSubmit(ws), files: filesForSubmit(ws)};
}
