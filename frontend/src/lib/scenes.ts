import {fileUrl} from '../api/client';
import type {CharacterPosition, SavedCharacter, SavedRequest, StudioRequest} from '../api/types';
import {addReference, addSavedCharacter, applyPreset, applyReference, filesForSubmit, initialWorkspace, placeCharacter,
  requestForSubmit, type Workspace} from '../state/workspace';
import {uuid} from './uuid';
import {load, save} from './storage';
import {imageSize} from './characters';

// "Cenas do conto": a story is a list of scenes. Each scene is a saved request plus the people of the scene (fichas).
export const STORY_KEY = 'prisma.storyScenes';
export const EXTRA_PEOPLE_MAX = 2;
export const EDIT_PRESET_WARNING = 'Esta cena usa um pedido de edição; a fila gera só cenas novas.';

export interface ScenePerson {character: string; position: CharacterPosition | null}   // character: the ficha's id
export interface Scene {id: string; preset: string; main: string | null; people: ScenePerson[]; note: string}
export interface Story {title: string; scenes: Scene[]}

// The values of the position select of a person in the scene; "Ao lado" is no position at all.
export const POSITIONS: {value: CharacterPosition | null; label: string}[] = [
  {value: null, label: 'Ao lado'}, {value: 'left', label: 'À esquerda'}, {value: 'right', label: 'À direita'},
  {value: 'behind', label: 'Atrás'}, {value: 'front', label: 'Na frente'},
];

export function newScene(): Scene {
  return {id: uuid(), preset: '', main: null, people: [], note: ''};
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
}

export interface BuiltScene {request: StudioRequest; files: Record<string, string>}

const photoSize = (hash: string) => imageSize(fileUrl(hash));

async function photoFile(character: SavedCharacter, size: (hash: string) => Promise<{width: number; height: number}>) {
  const hash = character.photos[0];
  if (!hash) throw new Error(`A ficha “${character.name}” não tem foto.`);
  const {width, height} = await size(hash);
  return {hash, width, height, name: character.name};
}

/** The request of one scene, built the way the form builds it: the preset, then the main person (a reference that
 * fills the face, body, skin and hair), then each other person (their photo, notes and position), then the note in
 * the details. Throws when the scene cannot be sent (no photo, a ficha twice). The Studio validates it afterwards. */
export async function buildSceneRequest(input: SceneInput,
  size: (hash: string) => Promise<{width: number; height: number}> = photoSize): Promise<BuiltScene> {
  if (input.preset.request.mode === 'edit') throw new Error(EDIT_PRESET_WARNING);
  const chosen = [input.main, ...input.people.map(p => p.character)].filter((c): c is SavedCharacter => !!c);
  if (new Set(chosen.map(c => c.id)).size !== chosen.length) throw new Error('A mesma ficha aparece mais de uma vez na cena.');

  let ws: Workspace = applyPreset(initialWorkspace('generate'), input.preset.request);
  if (input.main) {
    const id = 'ref-' + uuid().slice(0, 8);
    ws = applyReference(addReference(ws, id, await photoFile(input.main, size)), id, 'character');
  }
  for (const {character, position} of input.people) {
    const id = 'ref-' + uuid().slice(0, 8);
    ws = placeCharacter(addSavedCharacter(ws, id, await photoFile(character, size), character.notes), id, position);
  }
  const note = input.note.trim();
  if (note) ws = {...ws, request: {...ws.request, details: [ws.request.details.trim(), note].filter(Boolean).join('\n')}};
  return {request: requestForSubmit(ws), files: filesForSubmit(ws)};
}
