import { stageMatch, driveFullMatch } from '../harness/orchestrator.js';
import { findSeededPacket } from '../harness/rest.js';

// End-to-end: stage a real match (proctor + 4 players on 2 teams, a real
// seeded packet) and drive it through every one of its tossups — reads,
// buzzes, judging, and bonuses — verifying the game engine handles a
// complete match. Works against both auth-on and auth-off stacks: SetMatchPacket
// on a PUBLISHED packet is allowed either way.
//
// The packet comes from a search against the local, already-seeded packet
// bank (the same one the ng Playwright specs use via "Search Existing"),
// not from `import-random`: that endpoint draws from a separate bank of
// `:BankTossup`/`:BankBonus` nodes this compose stack doesn't seed, so it
// 404s here even though the harness itself is guest-allowed either way
// (D15) — see audit/m2-verify-round2.json's NG-R2-02.
const PACKET_NAME = process.env.SOCKBOWL_E2E_PACKET_NAME || '2010 Collaborative MS Tournament - Round 05';

console.log(`Looking up seeded packet "${PACKET_NAME}"…`);
const packet = await findSeededPacket(PACKET_NAME);
console.log(`✓ found packet ${packet.id.slice(0, 8)}: ${packet.tossupCount} tossups, ${packet.bonusCount} bonuses`);

console.log('Staging match…');
const match = await stageMatch({ packetId: packet.id, tossupCount: packet.tossupCount, bonusCount: packet.bonusCount });
console.log(`✓ staged: proctor + ${match.players.length} players, packet ${match.packetId.slice(0, 8)}, code ${match.joinCode}`);

// Every requested round must complete, not just one — a stalled round (e.g.
// the PLAYER_NOT_IN_SESSION lost-update failure tracked as M2R2-LIVE-01)
// would otherwise still print "OK" as long as round 1 got through.
const requestedRounds = match.tossupCount;
console.log(`Driving match through all ${requestedRounds} rounds…`);
const result = await driveFullMatch(match, requestedRounds);

console.log('\n=== RESULT ===');
console.log('rounds played:', result.rounds, 'of', requestedRounds, 'requested');
console.table(result.scores);
console.log('final matchState:', match.proctor.matchState, '| roundState:', match.proctor.roundState);

match.cleanup();
if (result.rounds === requestedRounds) {
  console.log('\nFULL MATCH OK');
  process.exit(0);
} else {
  console.error(`\nFULL MATCH FAILED: only ${result.rounds} of ${requestedRounds} requested rounds completed`);
  process.exit(1);
}
