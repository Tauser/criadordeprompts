import {describe, expect, it} from 'vitest';
import type {SavedCharacter, SavedRequest} from '../api/types';
import {initialRequest} from '../state/workspace';
import {buildSceneRequest, NO_PHOTO_WARNING} from './scenes';

const size = async () => ({width: 800, height: 1000});
const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);

const ficha = (id: string, name: string, notes: string, photos: string[]): SavedCharacter =>
  ({id, name, notes, photos, created_at: 1, updated_at: 1});
const ana = ficha('f-ana', 'Ana', '', [hashA]);
const bruno = ficha('f-bruno', 'Bruno', 'holding a red umbrella', [hashB]);

const generatePreset = (): SavedRequest => {
  const request = initialRequest('generate');
  request.details = 'Rua à noite, chuva.';
  request.attributes.style = {intent: 'set', value: {kind: 'text', text: 'film still'}};
  return {id: 'p-rua', name: 'Rua à noite', request, created_at: 1, updated_at: 1};
};

const editPreset = (): SavedRequest => {
  const request = initialRequest('edit');
  request.details = 'Troca a roupa.';
  request.attributes.wardrobe = {intent: 'set', value: {kind: 'text', text: 'red coat'}};
  return {id: 'p-roupa', name: 'Trocar roupa', request, created_at: 1, updated_at: 1};
};

describe('buildSceneRequest', () => {
  it('builds the request of a scene: preset, main person, other person with notes and position, note in the details', async () => {
    const built = await buildSceneRequest({preset: generatePreset(), main: ana, people: [{character: bruno, position: 'left'}],
      note: '  Ela sorri.  '}, size);
    const [anaId, brunoId] = built.request.references.map(r => r.id);

    expect(built.request.mode).toBe('generate');
    expect(built.request.target_id).toBeNull();
    expect(built.request.references.map(r => r.label)).toEqual(['Ana', 'Bruno']);
    for (const category of ['face', 'body', 'skin', 'hair'] as const) {
      expect(built.request.attributes[category]).toEqual({intent: 'transfer', reference_id: anaId});
    }
    expect(built.request.attributes.style).toEqual({intent: 'set', value: {kind: 'text', text: 'film still'}});
    expect(built.request.characters).toEqual([{reference_id: brunoId, description: 'holding a red umbrella', position: 'left'}]);
    expect(built.request.details).toBe('Rua à noite, chuva.\nEla sorri.');
    expect(built.files).toEqual({[anaId]: hashA, [brunoId]: hashB});
  });

  it('a scene with no main person and no note keeps the preset as it is', async () => {
    const built = await buildSceneRequest({preset: generatePreset(), main: null, people: [], note: '   '}, size);
    expect(built.request.references).toEqual([]);
    expect(built.request.characters).toBeUndefined();
    expect(built.request.details).toBe('Rua à noite, chuva.');
    expect(built.request.attributes.face).toBeUndefined();
  });

  it('each scene starts from a fresh workspace: nothing of one scene reaches the next', async () => {
    await buildSceneRequest({preset: generatePreset(), main: ana, people: [{character: bruno, position: null}], note: 'x'}, size);
    const next = await buildSceneRequest({preset: generatePreset(), main: null, people: [], note: ''}, size);
    expect(next.request.references).toEqual([]);
    expect(next.request.details).toBe('Rua à noite, chuva.');
  });

  it('an edit scene without its photo is refused with the warning', async () => {
    await expect(buildSceneRequest({preset: editPreset(), main: null, people: [], note: ''}, size)).rejects.toThrow(NO_PHOTO_WARNING);
  });

  it('an edit scene edits its photo: the photo is the target, the extra ficha is added to it, the count is kept', async () => {
    const photo = {hash: 'c'.repeat(64), width: 900, height: 1200, name: 'foto.png'};
    const built = await buildSceneRequest({preset: editPreset(), main: ana, people: [{character: bruno, position: 'right'}],
      note: '  Chuva.  ', photo, existing: 2}, size);
    const [photoId, brunoId] = built.request.references.map(r => r.id);

    expect(built.request.mode).toBe('edit');
    expect(built.request.target_id).toBe(photoId);
    expect(built.request.references.map(r => r.label)).toEqual(['foto.png', 'Bruno']);
    expect(built.request.characters).toEqual([{reference_id: brunoId, description: 'holding a red umbrella', position: 'right'}]);
    expect(built.request.participants.existing).toBe(2);
    expect(built.request.attributes.face).toEqual({intent: 'keep'});   // the main person does not apply to an edit
    expect(built.request.attributes.wardrobe).toEqual({intent: 'set', value: {kind: 'text', text: 'red coat'}});
    expect(built.request.details).toBe('Troca a roupa.\nChuva.');
    expect(built.files).toEqual({[photoId]: photo.hash, [brunoId]: hashB});
  });

  it('an edit scene without a count of people says one person', async () => {
    const photo = {hash: 'c'.repeat(64), width: 900, height: 1200, name: 'foto.png'};
    const built = await buildSceneRequest({preset: editPreset(), main: null, people: [], note: '', photo}, size);
    expect(built.request.participants.existing).toBe(1);
    expect(built.request.characters).toBeUndefined();
  });

  it('a ficha without a photo stops only its own scene', async () => {
    const empty = ficha('f-x', 'Sem foto', '', []);
    await expect(buildSceneRequest({preset: generatePreset(), main: empty, people: [], note: ''}, size))
      .rejects.toThrow('não tem foto');
  });

  it('the same ficha cannot be the main person and another person of one scene', async () => {
    await expect(buildSceneRequest({preset: generatePreset(), main: ana, people: [{character: ana, position: null}], note: ''}, size))
      .rejects.toThrow('mais de uma vez');
  });
});
