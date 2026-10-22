import {describe, expect, it} from 'vitest';
import {faceWordsIn} from './characters';

describe('faceWordsIn', () => {
  it('finds the face and hair words in Portuguese and English, once each, in lowercase', () => {
    expect(faceWordsIn('Blond hair, Olhos azuis, cabelo curto, Barba, loira, sardas, ruiva, bigode, beard, freckles, eyes'))
      .toEqual(['blond', 'hair', 'olhos', 'cabelo', 'barba', 'loira', 'sardas', 'ruiva', 'bigode', 'beard', 'freckles', 'eyes']);
    expect(faceWordsIn('Olhos e olhos')).toEqual(['olhos']);
  });

  it('leaves notes about clothes and manner alone', () => {
    expect(faceWordsIn('Roupa de sempre, jeito calmo, camiseta azul')).toEqual([]);
    expect(faceWordsIn('')).toEqual([]);
  });

  it('does not match words that only contain a listed word', () => {
    expect(faceWordsIn('Cabeleireiro, olhar sereno')).toEqual([]);
  });
});
