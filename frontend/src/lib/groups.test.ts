import {describe, expect, it} from 'vitest';
import {groupByPrefix, OTHER_GROUP} from './groups';

describe('groupByPrefix', () => {
  it('groups shared prefixes and sends single ones to the end', () => {
    const labels = ['Sexy · Quase beijo', 'Abraçar (dois adultos)', 'Diversão · Karaokê', 'Acenar · mão direita',
      'Diversão · Selfie', 'Sexy · Dança lenta'];
    const groups = groupByPrefix(labels, l => l);
    expect(groups.map(g => g.name)).toEqual(['Diversão', 'Sexy', OTHER_GROUP]);
    expect(groups[0].items).toEqual(['Diversão · Karaokê', 'Diversão · Selfie']);
    expect(groups[2].items).toEqual(['Abraçar (dois adultos)', 'Acenar · mão direita']);
  });
});
