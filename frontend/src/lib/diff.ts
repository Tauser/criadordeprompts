// Word-level diff (LCS) to show exactly what the enhancer changed.
export type Piece = {type: 'same' | 'added' | 'removed'; text: string};

export function wordDiff(before: string, after: string): Piece[] {
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [{type: 'removed', text: before}, {type: 'added', text: after}];
  const table = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: Piece[] = [];
  const push = (type: Piece['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text; else out.push({type, text});
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {push('same', a[i]); i++; j++;}
    else if (table[i + 1][j] >= table[i][j + 1]) push('removed', a[i++]);
    else push('added', b[j++]);
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}
