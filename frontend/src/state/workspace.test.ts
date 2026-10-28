import {describe, expect, it} from 'vitest';
import {addReference, addSavedCharacter, addSavedPrincipal, applyPreset, applyReference, clearSwap, initialWorkspace, removeCharacter, removeReference, requestForSubmit, setAttribute, setSex, setSwap, setTarget, switchMode} from './workspace';
import {wordDiff} from '../lib/diff';
import type {StudioRequest} from '../api/types';

const file = (name: string) => ({hash: name.padEnd(64, '0'), width: 10, height: 10, name});

describe('workspace', () => {
  it('adds a saved character as another person with its notes, without making it the photo to edit', () => {
    const ws = addSavedCharacter(initialWorkspace('edit'), 'ref-ana', file('ana'), 'Roupa de sempre');
    expect(ws.request.target_id).toBeNull();
    expect(ws.request.references).toEqual([{id: 'ref-ana', label: 'ana'}]);
    expect(ws.request.characters).toEqual([{reference_id: 'ref-ana', description: 'Roupa de sempre'}]);
    expect(ws.files['ref-ana'].hash).toBe(file('ana').hash);
  });

  it('takes the sex of each person from the fichas and moves it along when a character leaves', () => {
    let ws = addSavedPrincipal(initialWorkspace('generate'), 'ana', file('ana'), 'female');
    ws = addSavedCharacter(ws, 'bia', file('bia'), '', 'female');
    ws = addSavedCharacter(ws, 'caio', file('caio'), '', 'male');
    expect(ws.request.participants.sexes).toEqual(['female', 'female', 'male']);
    ws = removeCharacter(ws, 'bia');
    expect(ws.request.participants.sexes).toEqual(['female', 'male']);   // Caio is the second person now
    ws = addSavedCharacter(ws, 'dani', file('dani'), '');                  // a ficha without sex leaves the place blank
    expect(ws.request.participants.sexes).toEqual(['female', 'male']);
    expect(setSex(ws, 2, null).request.participants.sexes).toEqual(['female']);
    expect(setSex(ws, 4, 'male').request.participants.sexes).toEqual(['female', 'male', null, 'male']);
  });

  it('refuses a saved character when the scene already has the maximum of extra people', () => {
    let ws = initialWorkspace('generate');
    for (const id of ['a', 'b', 'c']) ws = addSavedCharacter(ws, id, file(id), '');
    expect(() => addSavedCharacter(ws, 'd', file('d'), '')).toThrow();
  });

  it('clears group clothing scope when switching to keeping the original clothing', () => {
    const ws = initialWorkspace('edit');
    ws.request.wardrobe_scope = 'all';
    const next = setAttribute(ws, 'wardrobe', {intent: 'keep'});
    expect(next.request.wardrobe_scope).toBe('primary');
    expect(ws.request.wardrobe_scope).toBe('all');
  });

  it('starts edits keeping every attribute and generations without unrequested choices', () => {
    expect(initialWorkspace('edit').request.attributes.face).toEqual({intent: 'keep'});
    expect(initialWorkspace('generate').request.attributes).toEqual({});
  });

  it('restores the previous choices when a reference is removed', () => {
    let ws = addReference(addReference(initialWorkspace('edit'), 't', file('alvo')), 'p', file('pers'));
    ws = setAttribute(ws, 'hair', {intent: 'set', value: {kind: 'text', text: 'short red hair'}});
    ws = applyReference(ws, 'p', 'character');
    expect(ws.request.attributes.face).toEqual({intent: 'transfer', reference_id: 'p'});
    ws = removeReference(ws, 'p');
    expect(ws.request.attributes.face).toEqual({intent: 'keep'});
    expect(ws.request.attributes.hair).toEqual({intent: 'set', value: {kind: 'text', text: 'short red hair'}});
  });

  it('never promotes another image to target', () => {
    let ws = addReference(addReference(initialWorkspace('edit'), 't', file('alvo')), 'p', file('rosto'));
    ws = applyReference(ws, 'p', 'face');
    ws = removeReference(ws, 't');
    expect(ws.request.target_id).toBeNull();
    expect(ws.request.attributes.face).toEqual({intent: 'transfer', reference_id: 'p'});
  });

  it('choosing a reference as target releases its transferred attributes', () => {
    let ws = addReference(addReference(initialWorkspace('edit'), 't', file('alvo')), 'p', file('rosto'));
    ws = applyReference(ws, 'p', 'face');
    ws = setTarget(ws, 'p');
    expect(ws.request.attributes.face).toEqual({intent: 'keep'});
    expect(() => applyReference(ws, 'p', 'face')).toThrow();
  });

  it('an explicit choice made after applying a reference is not overwritten on removal', () => {
    let ws = addReference(addReference(initialWorkspace('edit'), 't', file('alvo')), 'p', file('pers'));
    ws = applyReference(ws, 'p', 'character');
    ws = setAttribute(ws, 'face', {intent: 'free'});
    ws = removeReference(ws, 'p');
    expect(ws.request.attributes.face).toEqual({intent: 'free'});
  });
});

describe('workspace restoration chains', () => {
  it('removing references in any order never brings back a removed one', () => {
    let ws = addReference(addReference(addReference(initialWorkspace('edit'), 't', file('alvo')), 'a', file('a')), 'b', file('b'));
    ws = applyReference(ws, 'a', 'face');
    ws = applyReference(ws, 'b', 'face');
    ws = removeReference(ws, 'a');
    expect(ws.request.attributes.face).toEqual({intent: 'transfer', reference_id: 'b'});
    ws = removeReference(ws, 'b');
    expect(ws.request.attributes.face).toEqual({intent: 'keep'});
  });

  it('still restores the remaining reference when the newer one is removed', () => {
    let ws = addReference(addReference(addReference(initialWorkspace('edit'), 't', file('alvo')), 'a', file('a')), 'b', file('b'));
    ws = applyReference(ws, 'a', 'face');
    ws = applyReference(ws, 'b', 'face');
    ws = removeReference(ws, 'b');
    expect(ws.request.attributes.face).toEqual({intent: 'transfer', reference_id: 'a'});
  });

  it('a masked edit is submitted without a custom size', () => {
    let ws = addReference(initialWorkspace('edit'), 't', file('alvo'));
    ws = {...ws, request: {...ws.request, mask: true, output: {...ws.request.output, width: 1024, height: 1024}}};
    const request = requestForSubmit(ws);
    expect(request.output.width).toBeNull();
    expect(request.output.height).toBeNull();
  });

  it('a masked edit is submitted without "Ampliar no fim", which the photo size rules out', () => {
    let ws = addReference(initialWorkspace('edit'), 't', file('alvo'));
    ws = {...ws, request: {...ws.request, mask: true, output: {...ws.request.output, upscale: 2}}};
    expect(requestForSubmit(ws).output.upscale).toBeNull();
    expect(ws.request.output.upscale).toBe(2);             // kept: it returns when the mask is removed
    ws = {...ws, request: {...ws.request, mask: false}};
    expect(requestForSubmit(ws).output.upscale).toBe(2);
  });
});

describe('wordDiff', () => {
  it('marks additions and removals', () => {
    const pieces = wordDiff('a red car', 'a blue car');
    expect(pieces.filter(p => p.type !== 'same').map(p => [p.type, p.text.trim()])).toEqual([['removed', 'red'], ['added', 'blue']]);
  });
});

import {missingMetadata} from '../lib/metadata';

describe('missingMetadata', () => {
  it('lists only the fields the rules depend on', () => {
    const base = {id: 'pose.x', label: 'x', prompt: 'x', adult: false, enabled: true, provides: {}};
    expect(missingMetadata({...base, category: 'pose', requirements: {participants: 1, posture: 'seated', gaze: null}})).toEqual(['gaze', 'support_any_of']);
    expect(missingMetadata({...base, category: 'pose', requirements: {participants: 1, posture: 'any', gaze: 'any', support_any_of: []}})).toEqual([]);
    expect(missingMetadata({...base, category: 'environment', requirements: {}})).toEqual(['supports']);
    expect(missingMetadata({...base, category: 'lighting', requirements: {}})).toEqual([]);
  });
});

import {sortBy} from '../lib/sort';

describe('sortBy', () => {
  it('orders labels alphabetically in Portuguese, ignoring accents and case', () => {
    expect(sortBy(['Rua urbana', 'ângulo alto', 'Ângulo baixo', 'Estúdio', 'estrada', 'Item 10', 'Item 2'], s => s))
      .toEqual(['ângulo alto', 'Ângulo baixo', 'estrada', 'Estúdio', 'Item 2', 'Item 10', 'Rua urbana']);
  });
});

describe('characters', () => {
  it('adds a second character from a reference, numbers it and releases it cleanly', async () => {
    const {addCharacter, characterNumber, describeCharacter, removeReference, applyReference, requestForSubmit} = await import('./workspace');
    let ws = initialWorkspace('generate');
    ws = addReference(ws, 'a', {hash: 'h1', width: 1, height: 1, name: 'Ana'});
    ws = addReference(ws, 'b', {hash: 'h2', width: 1, height: 1, name: 'Bia'});
    ws = applyReference(ws, 'b', 'face');
    ws = addCharacter(ws, 'b');
    expect(ws.request.attributes.face).toBeUndefined();
    expect(characterNumber(ws, 'b')).toBe(2);
    ws = describeCharacter(ws, 'b', '  on the left ');
    expect(requestForSubmit(ws).characters).toEqual([{reference_id: 'b', description: 'on the left'}]);
    const {placeCharacter} = await import('./workspace');
    ws = placeCharacter(ws, 'b', 'right');
    expect(requestForSubmit(ws).characters).toEqual([{reference_id: 'b', description: 'on the left', position: 'right'}]);
    ws = removeReference(ws, 'b');
    expect(ws.request.characters).toEqual([]);
  });

  it('loads a saved request: its choices replace the form and the photos attached now stay', () => {
    let ws = addReference(addReference(initialWorkspace('edit'), 't', file('alvo')), 'p', file('pers'));
    ws = setAttribute(ws, 'hair', {intent: 'set', value: {kind: 'text', text: 'short red hair'}});
    ws = {...ws, request: {...ws.request, mask: true, participants: {requested: 1, existing: 2}}, maskHash: 'm'.padEnd(64, '0')};
    const preset: StudioRequest = {...initialWorkspace('edit').request, details: 'noite na rua',
      attributes: {
        environment: {intent: 'set', value: {kind: 'catalog', item_id: 'environment.garden'}},
        face: {intent: 'keep'},
      },
      output: {...initialWorkspace('edit').request.output, seed: null, aspect: '9:16'}};
    const next = applyPreset(ws, preset);
    expect(next.request.attributes.environment).toEqual({intent: 'set', value: {kind: 'catalog', item_id: 'environment.garden'}});
    expect(next.request.attributes.hair).toBeUndefined();
    expect(next.request.details).toBe('noite na rua');
    expect(next.request.output.seed).toBeNull();
    expect(next.request.references.map(r => r.id)).toEqual(['t', 'p']);
    expect(next.files.t.name).toBe('alvo');
    expect(next.request.target_id).toBe('t');
    expect(next.request.mask).toBe(true);
    expect(next.maskHash).toBe('m'.padEnd(64, '0'));
    expect(next.request.participants).toEqual({requested: null, existing: 2});
  });

  it('a saved generation clears the target and mask, and takes its own mode', () => {
    let ws = addReference(initialWorkspace('edit'), 't', file('alvo'));
    ws = {...ws, request: {...ws.request, mask: true}, maskHash: 'm'.padEnd(64, '0')};
    const next = applyPreset(ws, {...initialWorkspace('generate').request, details: 'praia'});
    expect(next.request.mode).toBe('generate');
    expect(next.request.target_id).toBeNull();
    expect(next.request.mask).toBe(false);
    expect(next.maskHash).toBeNull();
    expect(next.request.references.map(r => r.id)).toEqual(['t']);
  });
});

describe('troca de pessoa', () => {
  const editWithTwoPhotos = () => addReference(addReference(initialWorkspace('edit'), 'alvo', file('alvo')), 'ana', file('ana'));

  it('sets the swap with a second photo and offers two variations once', () => {
    const ws = editWithTwoPhotos();
    const next = setSwap(ws, 'ana', 'body');
    expect(next.request.swap).toEqual({reference_id: 'ana', mode: 'body'});
    expect(next.request.output.variations).toBe(2);
    const changed = setSwap({...next, request: {...next.request, output: {...next.request.output, variations: 3}}}, 'ana', 'head');
    expect(changed.request.swap).toEqual({reference_id: 'ana', mode: 'head'});
    expect(changed.request.output.variations).toBe(3);
  });

  it('refuses the target photo, unknown photos and generate mode', () => {
    const ws = editWithTwoPhotos();
    expect(() => setSwap(ws, 'alvo', 'body')).toThrow();
    expect(() => setSwap(ws, 'nao-existe', 'body')).toThrow();
    expect(() => setSwap(initialWorkspace('generate'), 'ana', 'body')).toThrow();
  });

  it('clears the swap when its photo is removed or becomes the photo to edit', () => {
    const ws = setSwap(editWithTwoPhotos(), 'ana', 'body');
    expect(removeReference(ws, 'ana').request.swap).toBeNull();
    expect(setTarget(ws, 'ana').request.swap).toBeNull();
  });

  it('clearSwap removes the swap and sends nothing when unset', () => {
    const ws = setSwap(editWithTwoPhotos(), 'ana', 'head');
    expect(clearSwap(ws).request.swap).toBeNull();
    expect(requestForSubmit(clearSwap(ws)).swap).toBeUndefined();
    expect('swap' in requestForSubmit(editWithTwoPhotos())).toBe(false);
  });

  it('requestForSubmit sends the swap in edit mode, and drops it in generate mode', () => {
    const ws = setSwap(editWithTwoPhotos(), 'ana', 'body');
    expect(requestForSubmit(ws).swap).toEqual({reference_id: 'ana', mode: 'body'});
    const generate = {...ws, request: {...ws.request, mode: 'generate' as const}};
    expect(requestForSubmit(generate).swap).toBeUndefined();
    expect(switchMode({generate: initialWorkspace('generate'), edit: ws}, ws, 'generate').workspace.request.swap).toBeNull();
    expect(switchMode({generate: initialWorkspace('generate'), edit: ws}, ws, 'generate').drafts.edit.request.swap)
      .toEqual({reference_id: 'ana', mode: 'body'});
  });
});
