// Seeds a small :BankTossup/:BankBonus fixture for the "Generate" tab
// (import-random draws from these bank nodes, not from :Packet). M2's compose
// stack ships no bank seed (M3 adds one), so auth-generate.spec.ts seeds its
// own when it can reach Neo4j, and otherwise relies on a bank seeded
// beforehand (e.g. the round-3 live run's seed-bank step).
//
// Plain fetch only, no Playwright import (same rule as login.ts).

/** Tag on every node this fixture creates, so it is easy to find and remove. */
export const BANK_FIXTURE_TAG = process.env.SOCKBOWL_E2E_BANK_TAG || 'e2e-auth-generate';

/** Matches the Generate tab's defaults: 'Regular HS' is difficulty 5; no category filter. */
const SEED_CYPHER = `
UNWIND range(1, 40) AS i
MERGE (t:BankTossup {remoteId: $tag + '-t' + i})
  ON CREATE SET t.question = 'Generate e2e tossup ' + i + '?', t.answer = 'Generated answer ' + i,
                t.category = 'Science', t.subcategory = 'Science', t.difficulty = 5,
                t.year = 2020, t.standard = true
MERGE (b:BankBonus {remoteId: $tag + '-b' + i})
  ON CREATE SET b.preamble = 'Generate e2e bonus ' + i, b.category = 'Science', b.subcategory = 'Science',
                b.difficulty = 5, b.year = 2020, b.standard = true
WITH b
WHERE NOT (b)-[:HAS_PART]->()
FOREACH (n IN range(0, 2) |
  CREATE (b)-[:HAS_PART {order: n}]->(:BankBonusPart {question: 'Part ' + (n + 1) + '?', answer: 'Part answer ' + (n + 1)}))
`;

/**
 * Idempotently seeds the bank fixture through Neo4j's HTTP API when
 * SOCKBOWL_E2E_NEO4J_PASSWORD (or NEO4J_PASSWORD) is set. Returns whether it
 * seeded; false means the caller relies on an already-seeded bank.
 */
export async function seedBankFixture(): Promise<boolean> {
  const password = process.env.SOCKBOWL_E2E_NEO4J_PASSWORD || process.env.NEO4J_PASSWORD;
  if (!password) {
    return false;
  }
  const url = process.env.SOCKBOWL_E2E_NEO4J_URL || 'http://localhost:7474';
  const user = process.env.SOCKBOWL_E2E_NEO4J_USER || process.env.NEO4J_USER || 'neo4j';
  const response = await fetch(`${url}/db/neo4j/tx/commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64'),
    },
    body: JSON.stringify({ statements: [{ statement: SEED_CYPHER, parameters: { tag: BANK_FIXTURE_TAG } }] }),
  });
  if (!response.ok) {
    throw new Error(`seedBankFixture: Neo4j returned HTTP ${response.status}`);
  }
  const body = await response.json() as { errors?: { code: string; message: string }[] };
  if (body.errors && body.errors.length) {
    throw new Error(`seedBankFixture: ${body.errors.map(e => `${e.code}: ${e.message}`).join('; ')}`);
  }
  return true;
}
