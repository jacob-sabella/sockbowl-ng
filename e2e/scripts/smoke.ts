import { createGame, joinByCode } from '../harness/rest.js';
import { SockbowlBot } from '../harness/bot.js';

// Proves the harness speaks the protocol: create a game, join it, connect over
// STOMP, and read back the live session state.
const game = await createGame();
console.log('✓ created game, joinCode =', game.joinCode);

const host = await joinByCode(game.joinCode, 'HostBot');
console.log('✓ joined as host, playerSessionId =', host.playerSessionId.slice(0, 8));

const bot = new SockbowlBot('HostBot', host.gameSessionId, host.playerSecret, host.playerSessionId);
await bot.connect();
console.log('✓ STOMP connected');

const gs = await bot.waitFor((g) => !!g.gameSettings, 8000, 'initial session');
console.log('✓ received session state:');
console.log('    matchState :', gs.currentMatch?.matchState);
console.log('    players    :', gs.playerList?.length);
console.log('    teams      :', gs.teamList?.map((t: any) => `${t.teamName}(${t.teamId.slice(0, 6)})`).join(', '));

bot.disconnect();
console.log('\nSMOKE OK');
process.exit(0);
