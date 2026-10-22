import type {Category, Item} from '../api/types';

// Which metadata each category reads; the compiler would still read a field left behind by another category
// (a pose's posture inside a scenery, a scenery's surfaces inside a pose), so moving an item drops the rest.
const REQUIREMENTS: Partial<Record<Category, 'all' | string[]>> = {
  pose: 'all', action: 'all', expression: ['gaze'], subject: ['participants', 'children'],
};
const PROVIDES: Partial<Record<Category, string[]>> = {
  environment: ['supports', 'period', 'place'], lighting: ['period', 'place'], camera: ['view', 'framing'],
  framing: ['framing'],
};

function keep<T extends object>(values: T, allowed: 'all' | string[] | undefined): T {
  if (allowed === 'all') return values;
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed?.includes(key))) as T;
}

/** The item moved to another category, without the metadata the new category does not use. */
export function toCategory(item: Item, category: Category): Item {
  if (category === item.category) return item;
  return {...item, category, requirements: keep(item.requirements, REQUIREMENTS[category]),
    provides: keep(item.provides, PROVIDES[category])};
}

/** Names of the filled fields that moving to `category` would drop, for the warning under the field. */
export function droppedBy(item: Item, category: Category): string[] {
  const moved = toCategory(item, category);
  const filled = (values: object) => Object.entries(values).filter(([, v]) => v !== null && v !== undefined
    && !(Array.isArray(v) && !v.length)).map(([k]) => k);
  const kept = new Set([...filled(moved.requirements), ...filled(moved.provides)]);
  return [...filled(item.requirements), ...filled(item.provides)].filter(key => !kept.has(key));
}
