/**
 * How long a word takes to read relative to an average word (about 1.0), so revealed
 * text reads like a person: longer words take longer, with a beat after a comma and a
 * longer one at the end of a sentence. Mirrors the game server's
 * QuestionTokenizer.wordWeight, which paces the multiplayer reveal; keep them in step.
 */
export function wordWeight(word: string): number {
  if (!word) {
    return 0.75;
  }
  const letters = (word.match(/[\p{L}\p{N}]/gu) || []).length;
  let weight = 0.75 + Math.min(0.6, 0.06 * Math.max(0, letters - 4));
  const end = word.replace(/["'”’)\]]+$/, '');
  if (/[.?!]$/.test(end)) {
    weight += 1.0;
  } else if (/[,;:]$/.test(end)) {
    weight += 0.5;
  }
  return weight;
}
