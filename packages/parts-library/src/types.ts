import type { PartCategory, Anchor } from '@sketchflat/svg-schema';

export interface PartLibraryEntry {
  id: string;
  category: PartCategory;
  label_ko: string;
  label_en: string;
  svg_path: string;
  anchors: Anchor[];
  tags: string[];
}
