// Authored geography shared by navigation, the sea chart and the rendered world.
import type { Obstacle } from './boat.ts';
export const WORLD_RADIUS = 900;
export const REGION_VERSION = 2;
// Full-size neighborhoods join the old market quay on its west and north edges.
export const CITY_DISTRICTS = [
  { x: -61, z: 5, hx: 34, hz: 24, r: 0 },
  { x: -35, z: 53, hx: 60, hz: 24, r: 0 },
] as const;
export const PORT_SITES = {
  reedhaven: { x: -480, z: -180 },
  ironwake: { x: 460, z: 320 },
  bastion: { x: 0, z: 80 },
} as const;
export const ANCHORAGES = {
  kelp: { x: -300, z: 50 },
  scrap: { x: 300, z: 130 },
} as const;
export const LANTERN_BUOYS = [
  { name: 'Garden Watch', x: -180, z: -160 },
  { name: 'Ember Watch', x: 240, z: 220 },
  { name: 'South Watch', x: 20, z: -300 },
] as const;
export const CITY_STYLE = {
  reedhaven: { color: '#54bd97', dark: '#245c49', title: 'The lantern gardens', specialty: 'refinery', crest: 'leaf', keeper: 'Iona, keeper of the lights', story: 'Kelp cutters bring their harvest to Reedhaven’s refineries. The lanterns burn on locally made fuel. Visiting crews bring the fish and metal the city needs.' },
  ironwake: { color: '#ee9977', dark: '#89482f', title: 'The ember foundries', specialty: 'foundry', crest: 'forge', keeper: 'Brann, master of the ember bell', story: 'The foundry bell marks the end of each shift. Scrap becomes plates for boats and workshops. The furnaces need fuel, and their crews need food from other harbors.' },
  bastion: { color: '#b6a3ec', dark: '#625195', title: 'The wandering shipyard', specialty: 'shipyard', crest: 'wheel', keeper: 'Tavi, the tide surveyor', story: 'Bastion’s shipwrights build beside living timber gardens. Both travel with the city when it moves. Residents choose where to anchor and which trade routes to open.' },
} as const;
export const LANDMARKS = [
  { id: 'timber-isle', name: 'The Rootbound Crown', kind: 'timber', x: -340, z: 260, radius: 46, height: 38 },
  { id: 'bellwether', name: 'Bellwether Spires', kind: 'scrap', x: 260, z: -300, radius: 34, height: 42 },
  { id: 'iron-reef', name: 'Ember Reef', kind: 'scrap', x: 480, z: 440, radius: 36, height: 25 },
  { id: 'lantern-crown', name: 'Lantern Crown', kind: 'kelp', x: -640, z: -360, radius: 42, height: 44 },
  { id: 'tidal-gate', name: 'The Tide Gate', kind: 'gate', x: 120, z: -560, radius: 35, height: 54 },
  { id: 'north-lantern', name: 'Northlight', kind: 'beacon', x: -100, z: 620, radius: 24, height: 62 },
] as const;
export const REGION_OBSTACLES = LANDMARKS.flatMap<Obstacle>(l => l.kind === 'gate'
  ? [-1, 1].map(side => ({ x: l.x + side * 20, z: l.z, hx: 0, hz: 0, r: 7.5 }))
  : [{ x: l.x, z: l.z, hx: 0, hz: 0, r: l.radius }]);
export const SHOALS = [
  { x: -180, z: -430, radius: 90, depth: 1 },
  { x: 350, z: -20, radius: 60, depth: 1.35 },
];
export const SEA_SITES = [
  { id: 'shoal-fish', name: 'Silver shoal', x: -210, z: -520, good: 'fish', quantity: 3, gear: 'fishing' },
  { id: 'wreck', name: 'Bellwether wreck', x: 590, z: -130, good: 'scrap', quantity: 3, gear: 'salvage' },
  { id: 'kelp-cove', name: 'Hidden kelp cove', x: -630, z: 290, good: 'kelp', quantity: 4, gear: 'sounder' },
  { id: 'driftwood', name: 'Rootbound driftwood', x: -385, z: 190, good: 'timber', quantity: 3, gear: 'sounder' },
] as const;
