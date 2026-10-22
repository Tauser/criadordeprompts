import {describe, expect, it} from 'vitest';
import {addReference, applyReference, initialWorkspace, removeReference, requestForSubmit, setAttribute, setTarget} from './workspace';
import {wordDiff} from '../lib/diff';

const file = (name: string) => ({hash: name.padEnd(64, '0'), width: 10, height: 10, name});

describe('workspace', () => {
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
});
