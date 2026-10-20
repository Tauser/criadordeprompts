import {compareText, sortBy} from './sort';

export const OTHER_GROUP = 'Outras opções';

/** Groups items by the label prefix before " · " ("Diversão · Karaokê" → "Diversão"). A prefix shared by a single
 * item is not a group: that item joins the others at the end, so a long list never turns into many one-line groups. */
export function groupByPrefix<T>(values: readonly T[], label: (value: T) => string): {name: string; items: T[]}[] {
  const prefixOf = (value: T) => {
    const at = label(value).indexOf(' · ');
    return at > 0 ? label(value).slice(0, at).trim() : null;
  };
  const counts = new Map<string, number>();
  for (const value of values) {
    const prefix = prefixOf(value);
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  const groups = new Map<string, T[]>();
  for (const value of sortBy(values, label)) {
    const prefix = prefixOf(value);
    const name = prefix && (counts.get(prefix) ?? 0) > 1 ? prefix : OTHER_GROUP;
    groups.set(name, [...(groups.get(name) ?? []), value]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a === OTHER_GROUP ? 1 : b === OTHER_GROUP ? -1 : compareText(a, b))
    .map(([name, items]) => ({name, items}));
}
