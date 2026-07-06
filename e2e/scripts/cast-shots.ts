import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/shots', { recursive: true });
const APP = process.env.SOCKBOWL_APP || 'http://localhost:8899';

const CONFIG = { messageType:'GAME_STATE_UPDATE', theme:'dark', timestamp:1, isConfigStage:true,
  joinCode:'PLAY42', proctorName:'Alex Rivera', packetName:'2021 SMH — Packet 1', gameMode:'QUIZ_BOWL_CLASSIC',
  teamRosters:[{teamId:'t1',teamName:'Team 1',playerNames:['Ada','Cleo','Ravi']},{teamId:'t2',teamName:'Team 2',playerNames:['Blaise','Dov']}]};
const INGAME = { messageType:'GAME_STATE_UPDATE', theme:'dark', timestamp:2, isConfigStage:false,
  roundNumber:5, category:'Literature', subcategory:'American Literature', roundState:'AWAITING_ANSWER',
  questionVisible:true, questionText:'This author wrote that "If I were the Head of the Church or the State, / I’d powder my nose and go to bed" in a poem; for 10 points, name this British-American poet of <b>The Age of Anxiety</b>.',
  answerVisible:false, answerText:'', currentBuzz:{playerName:'Ada', teamName:'Team 1', teamId:'t1', correct:null},
  teamScores:[{teamId:'t1',teamName:'Team 1',score:30},{teamId:'t2',teamName:'Team 2',score:15}]};

const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1280,height:720} });
await p.goto(`${APP}/cast-receiver.html`, { waitUntil:'domcontentloaded' });
await p.waitForFunction(() => typeof (window as any).__castRender === 'function');
await p.addStyleTag({ content:'#status{display:none!important}' });

async function shot(state:any, name:string){
  await p.evaluate(s => (window as any).__castRender(s), state);
  await p.waitForTimeout(350);
  await p.screenshot({ path:`artifacts/shots/${name}.png` });
}
await shot(CONFIG, 'config-dark');
for (const theme of ['dark','light','dracula','nord']) await shot({...INGAME, theme}, `ingame-${theme}`);
await b.close();
console.log('shots done');
