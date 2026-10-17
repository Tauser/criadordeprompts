import type {Item} from '../api/types';

// Metadata the compiler and the rules use. Missing values make the rules report "unknown" and skip guidance.
const LABELS: Record<string, string> = {
  participants: 'pessoas', posture: 'postura', gaze: 'olhar', support_any_of: 'apoios', supports: 'apoios do cenário',
  framing: 'área visível',
};

export function missingMetadata(item: Item): string[] {
  const r = item.requirements ?? {};
  const missing: string[] = [];
  if (item.category === 'pose' || item.category === 'action') {
    for (const key of ['participants', 'posture', 'gaze', 'support_any_of'] as const)
      if (r[key] === null || r[key] === undefined) missing.push(key);
  } else if (item.category === 'expression') {
    if (!r.gaze) missing.push('gaze');
  } else if (item.category === 'subject') {
    if (!r.participants) missing.push('participants');
  } else if (item.category === 'environment') {
    if (item.provides?.supports == null) missing.push('supports');
  } else if (item.category === 'framing') {
    if (!item.provides?.framing) missing.push('framing');
  }
  return missing;
}

export const metadataLabel = (key: string) => LABELS[key] ?? key;
