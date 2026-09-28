/**
 * Client-side mirror of `sockbowl.packet.limits`/`sockbowl.packet.import` and
 * `sockbowl.packet.taxonomy` (questions `PacketLimitsProperties`, M3 plan
 * 3.1.1), for inline validation (maxlength counters, D7 warnings). The server
 * stays authoritative; these are UI hints only and are not read from a
 * config endpoint, so a server-side override doesn't reach the UI until this
 * file is updated to match.
 */
export const PACKET_LIMITS = {
  nameMax: 200,
  questionMax: 4000,
  answerMax: 1000,
  preambleMax: 2000,
  maxTossups: 60,
  maxBonuses: 60,
  maxPartsPerBonus: 6,
  /** Hard floor; 3 is the D7 "expected" count and only warns. */
  minPartsPerBonus: 1,
  /** D7: the "expected" bonus part count; anything else is a warning, not an error. */
  expectedPartsPerBonus: 3
} as const;

/** `sockbowl.packet.import.max-bytes`: 512 KiB of UTF-8 text. */
export const IMPORT_MAX_BYTES = 524288;

/** `sockbowl.packet.taxonomy.name-max`. */
export const TAXONOMY_NAME_MAX = 100;
