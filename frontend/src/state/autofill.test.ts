import {describe, expect, it} from 'vitest';
import type {Suggestion} from '../api/types';
import {applySuggestion, initialWorkspace, setAttribute, syncAuto} from './workspace';

const cat = (item_id: string) => ({intent: 'set' as const, value: {kind: 'catalog' as const, item_id}});
const full: Suggestion = {field: 'framing', attribute: cat('framing.full'), context: {}, label: 'Usar Corpo inteiro',
  reason: 'A pose precisa de corpo inteiro.', source: 'pose', auto: true};
const freePose: Suggestion = {field: 'pose', attribute: {intent: 'free'}, context: {}, label: 'Deixar a pose livre',
  reason: 'A ação já define a posição do corpo.', source: 'action', auto: true};

describe('filling fields for the pose or action', () => {
  it('fills a field still at its default and marks where the value came from', () => {
    const ws = syncAuto(initialWorkspace('edit'), [full]);
    expect(ws.request.attributes.framing).toEqual(cat('framing.full'));
    expect(ws.auto).toEqual({framing: 'pose'});
    expect(syncAuto(ws, [full])).toBe(ws);                  // stable: nothing to do the second time
  });

  it('never fills a field the person chose, even after choosing the default again', () => {
    const chosen = setAttribute(initialWorkspace('edit'), 'framing', cat('framing.half'));
    expect(syncAuto(chosen, [full])).toBe(chosen);
    const back = setAttribute(chosen, 'framing', {intent: 'keep'});
    expect(syncAuto(back, [full]).request.attributes.framing).toEqual({intent: 'keep'});
  });

  it('gives a filled field back when the pose or action no longer needs it', () => {
    const filled = syncAuto(initialWorkspace('edit'), [freePose]);
    expect(filled.request.attributes.pose).toEqual({intent: 'free'});
    const released = syncAuto(filled, []);
    expect(released.request.attributes.pose).toEqual({intent: 'keep'});
    expect(released.auto).toEqual({});
  });

  it('changing a filled field makes it the person\'s own', () => {
    const filled = syncAuto(initialWorkspace('edit'), [full]);
    const changed = setAttribute(filled, 'framing', cat('framing.wide'));
    expect(changed.auto).toEqual({});
    expect(syncAuto(changed, []).request.attributes.framing).toEqual(cat('framing.wide'));
  });

  it('applies a clicked suggestion with its switches as the person\'s choice, never offered ones by itself', () => {
    const supports: Suggestion = {field: 'environment', attribute: null, context: {allow_new_supports: true},
      label: 'Permitir acrescentar o apoio', reason: 'x', source: 'pose', auto: false};
    const ws = initialWorkspace('generate');
    expect(syncAuto(ws, [supports])).toBe(ws);
    const clicked = applySuggestion(ws, supports);
    expect(clicked.request.context.allow_new_supports).toBe(true);
    expect(clicked.touched).toEqual(['environment']);
  });

  it('never applies a suggestion for a clash between two chosen options, even one marked auto', () => {
    const lens: Suggestion = {field: 'camera', attribute: cat('camera.lens_24'), context: {}, label: 'Grande angular · 24 mm',
      reason: 'O enquadramento é corpo inteiro.', source: 'scene', auto: true};
    const ws = initialWorkspace('generate');
    expect(syncAuto(ws, [lens])).toBe(ws);
    const clicked = applySuggestion(ws, lens);
    expect(clicked.request.attributes.camera).toEqual(cat('camera.lens_24'));
    expect(clicked.auto ?? {}).toEqual({});
  });
});
