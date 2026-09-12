// One merchant-community scenario: funded civic demand, negotiation, wear, commissioning and migration.
import assert from 'node:assert/strict';
import { createWorld, addPlayer, advanceWorld, command, voyageQuote, cityHouse, craftSeconds, capacity, SEA_SITES, berthPoint, PORT_IDS } from '../src/economy.ts';
import { ANCHORAGES, PORT_SITES, LANTERN_BUOYS } from '../src/region.ts';
const routeCases=[];
for (const [anchorage,at] of Object.entries({original:PORT_SITES.bastion,...ANCHORAGES})) {
  const time=1_800_000_000_000, world=createWorld(time);
  Object.assign(world.ports.bastion,at);
  const player=addPlayer(world,'route','Route QA','reedhaven','refinery',time), boat=world.ships[player.selectedShip];
  for (const from of PORT_IDS) for (const to of PORT_IDS) if (from!==to) {
    Object.assign(boat,berthPoint(world.ports[from]));boat.port=from;
    const lane=voyageQuote(world,boat,to,'sail',time), reef=voyageQuote(world,boat,to,'hazard',time);
    assert.notDeepEqual(lane.waypoints,reef.waypoints);assert(lane.wear<reef.wear);
    assert(LANTERN_BUOYS.some(b=>lane.risk.includes(b.name)&&lane.waypoints.some(p=>p.x===b.x&&p.z===b.z)));
    routeCases.push({anchorage,from,to,lanternDistance:lane.distance,reefDistance:reef.distance,lanternWear:lane.wear,reefWear:reef.wear,lane:lane.risk});
  }
  Object.assign(boat,berthPoint(world.ports.reedhaven));boat.x-=120;boat.port=null;
  assert.throws(()=>voyageQuote(world,boat,'reedhaven','sail',time),/No sheltered lantern lane/,'a short approach must not be sold an excessive lantern detour');
}
console.log('Verified '+routeCases.length+' directed city passages and the short-approach rejection.');
let now = 1_800_000_000_000, w = createWorld(now); const start = now;
for (const [id, home, trade] of [['producer', 'reedhaven', 'refinery'], ['carrier', 'reedhaven', 'foundry'], ['maker', 'bastion', 'shipyard']]) addPlayer(w, id, id, home, trade, now);
const act = (who, action) => { const next = structuredClone(w); command(next, who, action, now); w = JSON.parse(JSON.stringify(next)); };
const tick = seconds => { now += seconds * 1000; advanceWorld(w, now); };
const ship = who => w.ships[w.players[who].selectedShip];
const shop = who => w.workshops.find(s => s.owner === who);
const funds = () => Object.values(w.players).reduce((n,p) => n+p.marks,0) + w.deliveries.filter(d => !['delivered','cancelled'].includes(d.status)).reduce((n,d) => n+d.price,0) + (w.builds??[]).filter(b=>!b.launched).reduce((n,b)=>n+b.price,0);
const allocation = funds();
assert(w.deliveries.filter(d=>d.civic && d.to==='reedhaven').length >= 3);
assert(craftSeconds(w,shop('producer'),'fuel',1) < craftSeconds(w,{...shop('producer'),kind:'foundry'},'fuel',1), 'a house cannot match every specialist');
act('producer',{action:'craft',workshop:shop('producer').id,recipe:'fuel',batches:1});tick(45);
const local = w.deliveries.find(d=>d.civic && d.to==='reedhaven' && d.good==='fuel');
assert.throws(()=>act('producer',{action:'supplyDelivery',delivery:local.id,port:'reedhaven',fee:0}), /travel between harbors/);
act('producer',{action:'supplyCivic',delivery:local.id});
assert.equal(w.deliveries.find(d=>d.id===local.id).local,true);
assert(w.players.producer.marks>600,'the funded city need pays a new producer');
act('maker',{action:'requestDelivery',port:'bastion',good:'fuel',quantity:4,price:80,minutes:15}); const order=w.deliveries.at(-1).id;
act('producer',{action:'craft',workshop:shop('producer').id,recipe:'fuel',batches:2});tick(75);
act('producer',{action:'supplyDelivery',delivery:order,port:'reedhaven',fee:10});
act('carrier',{action:'quoteHaul',delivery:order,fee:20});act('producer',{action:'acceptHaulQuote',delivery:order,carrier:'carrier'});
act('carrier',{action:'takeHaul',delivery:order});
const safe=voyageQuote(w,ship('carrier'),'bastion','sail',now), reef=voyageQuote(w,ship('carrier'),'bastion','hazard',now);
assert.notDeepEqual(safe.waypoints,reef.waypoints,'passages follow different geography');
assert(safe.wear<reef.wear && safe.arriveAt>reef.arriveAt,'shelter trades time for lower wear');
act('carrier',{action:'voyage',port:'bastion',route:'sail'});tick((safe.arriveAt-now)/2000);
assert(ship('carrier').sea.integrity<100,'committed travel also wears the hull'); now=safe.arriveAt+1;advanceWorld(w,now);
assert.equal(w.deliveries.find(d=>d.id===order).status,'delivered');assert.equal(w.players.carrier.career.hauled,1);
const buyerFunds=w.players.carrier.marks,makerFunds=w.players.maker.marks;
act('carrier',{action:'commissionShip',builder:'maker',hull:'lighter',name:'Declined order',price:40});
act('maker',{action:'cancelBuild',build:w.builds.at(-1).id});
assert.equal(w.players.carrier.marks,buyerFunds,'a rejecting shipwright returns payment to the buyer');assert.equal(w.players.maker.marks,makerFunds);
act('carrier',{action:'commissionShip',builder:'maker',hull:'lighter',name:'Lantern Runner',price:80});const build=w.builds.at(-1).id;
for (const [good,quantity] of Object.entries({timber:8,plates:3,fuel:2})) act('maker',{action:'contributeBuild',build,good,quantity});
assert.equal(w.builds.at(-1).readyAt,null,'materials do not force a shipwright to accept a job');
act('maker',{action:'acceptBuild',build});tick(61);assert.equal(w.ships[w.builds.at(-1).launched].quality,1.08);
const oldDistance=voyageQuote(w,ship('producer'),'bastion','sail',now).distance;
act('maker',{action:'moveCity',port:'bastion',anchorage:'scrap'}); now=w.ports.bastion.move.arriveAt+1;advanceWorld(w,now);
assert.equal(w.resources.bastion.good,'timber');assert(SEA_SITES.some(s=>s.good==='timber'));
const newDistance=voyageQuote(w,ship('producer'),'bastion','sail',now).distance;
assert((newDistance-oldDistance)/oldDistance>.25,'migration changes a supply route by more than 25%');
let gathered=0, civicTimber=0;
while(now<start+1_800_000) {
  const p=w.players.maker, resource=w.resources.bastion;
  const need=w.deliveries.find(d=>d.civic && d.to==='bastion' && d.good==='timber' && d.status==='open');
  if(need && (p.warehouse.bastion.timber??0)>=need.quantity) act('maker',{action:'supplyCivic',delivery:need.id});
  if(!w.extraction.some(j=>j.player==='maker') && resource.available>=6 && (p.warehouse.bastion.timber??0)<30) act('maker',{action:'extract',port:'bastion',quantity:6});
  const pending=w.extraction.filter(j=>j.player==='maker').map(j=>({...j}));
  const before=cityHouse(w,'bastion').warehouse.bastion.timber??0;tick(60);
  for(const j of pending) if(!w.extraction.some(next=>next.player===j.player && next.readyAt===j.readyAt)) gathered+=j.quantity;
  civicTimber+=Math.max(0,before-(cityHouse(w,'bastion').warehouse.bastion.timber??0));
}
assert(civicTimber>0 && gathered>0,'recurring needs consume actual gathered goods');assert.equal(funds(),allocation,'all charter and player money remains accounted for');
const beforeUpgrade=funds(), stock=JSON.stringify(Object.values(w.players).map(p=>p.warehouse));
w.regionVersion=1;
for(const port of Object.values(w.ports)){port.x/=10;port.z/=10;}
for(const boat of Object.values(w.ships)){boat.x/=10;boat.z/=10;}
advanceWorld(w,now);
assert.equal(funds(),beforeUpgrade);assert.equal(JSON.stringify(Object.values(w.players).map(p=>p.warehouse)),stock,'the geography upgrade preserves inventory');
console.log(JSON.stringify({check:'merchant community',simulatedMinutes:(now-start)/60000,allocatedMarks:allocation,accountedMarks:funds(),gatheredTimber:gathered,civicTimberConsumed:civicTimber,timberConsumptionShare:civicTimber/gathered,migrationRouteChange:(newDistance-oldDistance)/oldDistance,passed:true},null,2));
act('carrier',{action:'craft',workshop:shop('carrier').id,recipe:'plates',batches:3});tick(150);
act('maker',{action:'requestDelivery',port:'bastion',good:'plates',quantity:6,price:120,minutes:15});const refitOrder=w.deliveries.at(-1).id;
act('carrier',{action:'supplyDelivery',delivery:refitOrder,port:'reedhaven',fee:0});
for(const destination of ['reedhaven','bastion']){
  const q=voyageQuote(w,ship('carrier'),destination,'sail',now);act('carrier',{action:'voyage',port:destination,route:'sail'});tick((q.arriveAt-now)/1000+1);
  if(destination==='reedhaven')act('carrier',{action:'takeHaul',delivery:refitOrder});
}
act('maker',{action:'craft',workshop:shop('maker').id,recipe:'repairKit',batches:1});tick(31);
const priorHold=capacity(w, ship('maker'));act('maker',{action:'refit',kind:'hold'});
assert.equal(capacity(w, ship('maker')),priorHold+4,'standing earned through civic work and production unlocks a useful refit bought with delivered materials');
assert.equal(funds(),allocation);console.log('Earned cargo refit passed: another house produced and delivered the plates; deck capacity increased by four.');
