import {describe, expect, it} from 'vitest';
import {addReference, initialWorkspace, describeSwapBody, removeSwap, requestForSubmit, setSwap, setTarget,
  swapReferenceIds} from './workspace';

const file = (name: string) => ({hash: name.padEnd(64, '0'), width: 10, height: 10, name});
const info = {turn: 4, frontal: true, name: 'ana.png'};
const scene = () => addReference(initialWorkspace('edit'), 'cena', file('a'));

describe('trocar pessoas', () => {
  it('gives a person of the photo the crop of another photo, as a reference only the swap uses', () => {
    const ws = setSwap(scene(), 2, 'swap-1', file('b'), info);
    expect(ws.request.swaps).toEqual([{position: 2, reference_id: 'swap-1', body: ''}]);
    expect(ws.request.target_id).toBe('cena');
    expect([...swapReferenceIds(ws)]).toEqual(['swap-1']);
    expect(ws.swapInfo?.['swap-1']).toEqual(info);
  });

  it('a new photo for the same person replaces the old crop and keeps the body text', () => {
    let ws = setSwap(scene(), 1, 'swap-1', file('b'), info);
    ws = describeSwapBody(ws, 1, ' slim and tall ');
    ws = setSwap(ws, 1, 'swap-2', file('c'), {...info, turn: 60, frontal: false});
    expect(ws.request.swaps).toEqual([{position: 1, reference_id: 'swap-2', body: ' slim and tall '}]);
    expect(ws.request.references.map(r => r.id)).toEqual(['cena', 'swap-2']);
    expect(requestForSubmit(ws).swaps).toEqual([{position: 1, reference_id: 'swap-2', body: 'slim and tall'}]);
  });

  it('keeping the original person removes the crop; another target photo clears every swap', () => {
    let ws = setSwap(setSwap(scene(), 1, 'swap-1', file('b'), info), 2, 'swap-2', file('c'), info);
    ws = removeSwap(ws, 1);
    expect(ws.request.swaps?.map(s => s.position)).toEqual([2]);
    expect(ws.files['swap-1']).toBeUndefined();
    ws = addReference(ws, 'outra', file('d'));
    ws = setTarget(ws, 'outra');
    expect(ws.request.swaps).toEqual([]);
    expect(ws.request.references.map(r => r.id)).toEqual(['cena', 'outra']);
    expect(requestForSubmit(ws).swaps).toBeUndefined();
  });
});
