import {useState} from 'react';
import {load, save} from './storage';

// Remembers, per card, whether the person folded it away.
export function useCollapsed(key: string): [boolean, () => void] {
  const storageKey = `prisma.collapsed.${key}`;
  const [collapsed, setCollapsed] = useState<boolean>(load<boolean>(storageKey, false));
  const toggle = () => setCollapsed(current => {save(storageKey, !current); return !current;});
  return [collapsed, toggle];
}
