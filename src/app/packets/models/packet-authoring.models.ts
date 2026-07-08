/**
 * Input/DTO shapes for the packet authoring GraphQL mutations and taxonomy
 * queries. These mirror the backend's GraphQL input types (see
 * questions-schema.graphqls) and are hand-written (not generated) since they
 * are request-only shapes, not response shapes.
 */

export interface CreatePacketInput {
  name: string;
  difficultyId?: string | null;
}

export interface TossupInput {
  question: string;
  answer: string;
  subcategoryId?: string | null;
}

export interface BonusInput {
  preamble?: string | null;
  subcategoryId?: string | null;
  parts?: BonusPartInput[];
}

export interface BonusUpdateInput {
  preamble?: string | null;
  subcategoryId?: string | null;
}

export interface BonusPartInput {
  question: string;
  answer: string;
}

export interface GenerateTossupInput {
  topic: string;
  additionalContext?: string | null;
  subcategoryId?: string | null;
  apiKey?: string | null;
  model?: string | null;
}

export interface Difficulty {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Subcategory {
  id: string;
  name: string;
  category?: Category;
}
