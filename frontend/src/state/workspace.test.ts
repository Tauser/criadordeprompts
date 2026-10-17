import {describe, expect, it} from 'vitest';
import {addReference, applyReference, initialWorkspace, removeReference, setAttribute, setTarget} from './workspace';
import {wordDiff} from '../lib/diff';

const file = (name: string) => ({hash: name.padEnd(64, '0'), width: 10, height: 10, name});

describe('workspace', () => {
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
