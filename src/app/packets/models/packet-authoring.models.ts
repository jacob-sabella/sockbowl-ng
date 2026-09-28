/**
 * Input/DTO shapes for the packet authoring GraphQL mutations and taxonomy
 * queries. These mirror the backend's GraphQL input types (see
 * questions-schema.graphqls) and are hand-written (not generated) since they
 * are request-only shapes, not response shapes.
 */
import { Packet, Source } from '../../game/models/sockbowl/packet-types.generated';
import { PacketOwner } from '../../game/models/sockbowl/packet-owner';

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

/* ------------------------------ M3 additions ------------------------------ */
// Mirrors questions' `schema.graphqls` M3 block (plan 3.1.11).

/** `PacketVisibility` (M2's enum; M3 reads/writes it but doesn't own it). */
export type PacketVisibility = 'DRAFT' | 'PUBLISHED';

/** `IssueSeverity`. */
export type IssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

/** `ValidationIssue`. */
export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  tossupId?: string | null;
  bonusId?: string | null;
}

/** `PacketValidation`. `playable` is true exactly when there are no ERROR issues. */
export interface PacketValidation {
  playable: boolean;
  tossupCount: number;
  bonusCount: number;
  issues: ValidationIssue[];
}

/** `PacketFilter` input. */
export interface PacketFilter {
  mine?: boolean;
  nameContains?: string;
  difficultyId?: string | null;
  visibility?: PacketVisibility;
  playableOnly?: boolean;
}

/** `PacketSummary`, the answer-free, paginated list projection (PB-19). */
export interface PacketSummary {
  id: string;
  name: string;
  difficulty?: Difficulty | null;
  owner?: PacketOwner | null;
  visibility: PacketVisibility;
  version: number;
  tossupCount: number;
  bonusCount: number;
  playable: boolean;
}

/** `PacketPage`. */
export interface PacketPage {
  items: PacketSummary[];
  total: number;
  page: number;
  size: number;
}

/** `PacketExportFormat`. Only PLAINTEXT exists in M3. */
export type PacketExportFormat = 'PLAINTEXT';

/** `ImportPacketInput`. `dryRun` defaults to true server-side; callers should pass it explicitly. */
export interface ImportPacketInput {
  text: string;
  name?: string | null;
  difficultyId?: string | null;
  dryRun?: boolean;
  skipInvalid?: boolean;
}

/** `ImportIssue`. */
export interface ImportIssue {
  severity: IssueSeverity;
  line?: number | null;
  message: string;
}

export interface ParsedBonusPart {
  line: number;
  question: string;
  answer: string;
}

export interface ParsedTossup {
  number?: number | null;
  line: number;
  question: string;
  answer: string;
  categoryTag?: string | null;
  subcategory?: Subcategory | null;
}

export interface ParsedBonus {
  number?: number | null;
  line: number;
  preamble?: string | null;
  parts: ParsedBonusPart[];
  categoryTag?: string | null;
  subcategory?: Subcategory | null;
}

/** `ParsedPacket`, the dry-run preview of an import before anything is committed. */
export interface ParsedPacket {
  suggestedName?: string | null;
  tossups: ParsedTossup[];
  bonuses: ParsedBonus[];
}

/** `ImportPacketResult`. `packet` is only set when `committed` is true. */
export interface ImportPacketResult {
  committed: boolean;
  packet?: { id: string } | null;
  parsed: ParsedPacket;
  issues: ImportIssue[];
}

/**
 * A packet as returned to an authenticated authoring caller: the base
 * `Packet` shape plus the M3 fields every authoring read now carries.
 */
export type AuthoringPacket = Packet & {
  version: number;
  visibility: PacketVisibility;
  validation: PacketValidation;
};

/**
 * Short, human-readable label for a packet/tossup/bonus/bonus part's
 * `ContentSource` (D13, M4-PV-01), for the packet builder's provenance
 * display (INT1). `TEXT_IMPORT` and `CLONED` are M3's; the rest are M4's.
 */
const SOURCE_LABELS: Record<Source, string> = {
  AUTHORED: 'Authored',
  QBREADER_IMPORT: 'Imported from the question bank',
  AI_GENERATED: 'AI generated',
  TEXT_IMPORT: 'Imported from text',
  CLONED: 'Cloned',
};

/** `SOURCE_LABELS[source]`, falling back to the raw value (or 'Unknown') for anything unrecognized. */
export function packetSourceLabel(source: Source | null | undefined): string {
  if (!source) {
    return 'Unknown';
  }
  return SOURCE_LABELS[source] ?? source;
}
