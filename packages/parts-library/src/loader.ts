import type { PartCategory } from '@sketchflat/svg-schema';
import type { PartLibraryEntry } from './types';

const REGISTRY: PartLibraryEntry[] = [];

export function listParts(): PartLibraryEntry[] {
  return REGISTRY;
}

export function listPartsByCategory(category: PartCategory): PartLibraryEntry[] {
  return REGISTRY.filter((entry) => entry.category === category);
}

export function getPart(id: string): PartLibraryEntry | undefined {
  return REGISTRY.find((entry) => entry.id === id);
}
