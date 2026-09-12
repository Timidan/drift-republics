import assert from 'node:assert/strict';
import {createWorld,addPlayer,advanceWorld,command,cityHouse,PORT_IDS} from '../src/economy.ts';
let now=1800000000000,w=createWorld(now),paid=0,upkeep=0; const history=[];
for(const port of PORT_IDS){const p=addPlayer(w,port,port,port,'refinery',now);p.career.rank=1;}
const total=()=>Object.values(w.players).reduce((n,p)=>n+p.marks,0)+w.deliveries.filter(d=>!['delivered','cancelled'].includes(d.status)).reduce((n,d)=>n+d.price,0);
const start=total();
for(let cycle=0;cycle<=48;cycle++){
 const before=PORT_IDS.reduce((n,p)=>n+w.players[p].marks,0);advanceWorld(w,now);upkeep+=before-PORT_IDS.reduce((n,p)=>n+w.players[p].marks,0);
 for(const port of PORT_IDS)for(const d of w.deliveries.filter(d=>d.civic&&d.to===port&&d.status==='open')){
  // Funding stress assumption: every requested good is available; this does not simulate its production.
  w.players[port].warehouse[port][d.good]=(w.players[port].warehouse[port][d.good]??0)+d.quantity;
  command(w,port,{action:'supplyCivic',delivery:d.id},now);paid+=d.price;
 }
 assert.equal(total(),start,'upkeep recirculates rather than creating or destroying Marks');
 if(cycle%12===0)history.push({hours:cycle/12,treasuries:PORT_IDS.map(p=>cityHouse(w,p).marks),houseBalances:PORT_IDS.map(p=>w.players[p].marks),provisionsConsumed:PORT_IDS.map(p=>w.ports[p].civic.consumed)});
 now+=300000;
}
assert(history.at(-1).treasuries.every(n=>n>0));assert(history.at(-1).provisionsConsumed.every(n=>n>0));
const accounted=total();
const p=w.players.reedhaven;p.marks=600;now=w.ports.reedhaven.civic.nextAt;advanceWorld(w,now);assert.equal(p.marks,600,'starter reserve stays protected');
const result={durationHours:4,assumption:'Three established resident houses, every requested good supplied locally from explicit test stock. Funding-only stress test; no production, travel or human play claimed.',target:'Recurring provisioning paid from recirculated existing Marks, with a protected 600-Mark reserve per house.',marksAllocated:start,marksAccounted:accounted,civicPayments:paid,civicUpkeep:upkeep,history,starterReserveProtected:true};
console.log(JSON.stringify(result,null,2));
