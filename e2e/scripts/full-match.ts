import { stageMatch, driveFullMatch } from '../harness/orchestrator.js';

// End-to-end: stage a real match (proctor + 4 players on 2 teams, real qbreader
// packet) and drive it through several full rounds — tossup reads, buzzes,
// judging, and bonuses — verifying the game engine handles a complete match.
console.log('Staging match…');
const match = await stageMatch({ set: '2021 SMH', packet: 1 });
console.log(`✓ staged: proctor + ${match.players.length} players, packet ${match.packetId.slice(0, 8)}, code ${match.joinCode}`);

console.log('Driving match…');
const result = await driveFullMatch(match, 3);

console.log('\n=== RESULT ===');
console.log('rounds played:', result.rounds);
console.table(result.scores);
console.log('final matchState:', match.proctor.matchState, '| roundState:', match.proctor.roundState);

match.cleanup();
if (result.rounds >= 1) {
  console.log('\nFULL MATCH OK');
  process.exit(0);
} else {
  console.error('\nFULL MATCH FAILED: no rounds completed');
  process.exit(1);
}
