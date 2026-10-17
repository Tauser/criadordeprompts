const collator = new Intl.Collator('pt-BR', {sensitivity: 'base', numeric: true});

export const compareText = (a: string, b: string) => collator.compare(a, b);

export function sortBy<T>(values: readonly T[], label: (value: T) => string): T[] {
  return [...values].sort((a, b) => collator.compare(label(a), label(b)));
}
