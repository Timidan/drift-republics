// Run with node scripts/check-art.mjs; no browser or stock models needed to build the original geometry.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { buildMerchantCutter, buildRepublicHarbor, buildRegionLandmarks, buildSeabird, buildFrontierOutpost, buildWorkshopAnnex } from '../src/drift-art.ts';
import { newSeamanship } from '../src/economy.ts';

const engine = new NullEngine(), scene = new Scene(engine);
const boat = new TransformNode('boat', scene), art = buildMerchantCutter(boat, null);
for (const port of ['bastion', 'reedhaven', 'ironwake']) buildRepublicHarbor(new TransformNode(port, scene), port, null);
buildRegionLandmarks(new TransformNode('region',scene));
buildFrontierOutpost(new TransformNode('frontier',scene)); buildWorkshopAnnex(new TransformNode('annex',scene));
assert.equal(buildSeabird(new TransformNode('bird',scene)).wings.length,2);
assert(boat.getChildMeshes().some(m=>m.getVerticesData('uv2')?.some(v=>v>0)), 'sail attachment weights survive mesh merging');
art.details(newSeamanship()); art.rig.setEnabled(false); art.engine.setEnabled(false); art.cargo.forEach(c => c.setEnabled(false));
assert(boat.getChildMeshes().filter(m => m.isEnabled()).length <= 36, 'empty boat and articulated captain should stay within 36 active meshes');
for (const mesh of scene.meshes) {
  assert(mesh.getTotalVertices() > 0, mesh.name + ' has no geometry');
  for (const field of ['position', 'normal']) assert(mesh.getVerticesData(field).every(Number.isFinite), mesh.name + ' has invalid ' + field);
}
art.paint({ hull: '#a63f32', sail: '#f4e8cf' });
assert(scene.getMaterialByName('boat-cutter-enamel').albedoColor.equals(Color3.FromHexString('#a63f32').toLinearSpace()));
art.rig.setEnabled(false); assert(art.rig.getChildMeshes().every(m => !m.isEnabled()));
art.rig.setEnabled(true); assert(art.rig.getChildMeshes().every(m => m.isEnabled()));
const lighter=buildMerchantCutter(new TransformNode('lighter',scene),null,'lighter'), barge=buildMerchantCutter(new TransformNode('barge',scene),null,'barge');
assert(lighter.kind==='lighter'&&barge.kind==='barge'&&lighter.yards.length===1&&barge.yards.length===2,'workboats need different hull classes and sail plans');
lighter.stock(['timber','fish','kelp']);assert.equal(lighter.cargo.filter(c=>c.isEnabled()).length,3,'mixed freight remains separately visible');
console.log('Original art checks passed: finite geometry, merged meshes, saved paint and fitting visibility.');
scene.dispose(); engine.dispose();
