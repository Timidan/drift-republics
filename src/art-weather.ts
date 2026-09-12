import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { Scene } from '@babylonjs/core/scene.js';

const wind = new WeakMap<Scene, [number, number, number, number]>();
const surfaces = new WeakMap<Scene, PBRMaterial[]>();

export function weatherSurface(mat: PBRMaterial): void {
  const list = surfaces.get(mat.getScene()) ?? [];
  list.push(mat); surfaces.set(mat.getScene(), list);
  mat.clearCoat.isEnabled = true;
  mat.clearCoat.intensity = 0;
  mat.clearCoat.roughness = .2;
}

export function updateArtWeather(scene: Scene, time: number, strength: number, heading: number, wetness: number): void {
  wind.set(scene, [time, strength, Math.sin(heading), Math.cos(heading)]);
  for (const mat of surfaces.get(scene) ?? []) mat.clearCoat.intensity = wetness * .8;
}

// UV2 stores attachment weight and phase, so the same deformation survives material merging.
export class WindCloth extends MaterialPluginBase {
  constructor(mat: PBRMaterial) {
    super(mat, 'DriftWind', 200, {}, true, true);
    this.registerForExtraEvents = true;
  }
  getAttributes(attributes: string[]): void { if (!attributes.includes('uv2')) attributes.push('uv2'); }
  getUniforms() { return { ubo: [{name:'driftWind',size:4,type:'vec4'}], vertex:'uniform vec4 driftWind;' }; }
  hardBindForSubMesh(buffer: UniformBuffer, scene: Scene): void {
    buffer.updateFloat4('driftWind', ...(wind.get(scene) ?? [0, 0, 0, 1]));
  }
  getCustomCode(type: string) {
    if (type !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: '#ifndef UV2\nattribute vec2 uv2;\n#endif',
      CUSTOM_VERTEX_UPDATE_POSITION: `
        float flutterPhase = driftWind.x * 2.8 + uv2.y * 6.283 + positionUpdated.y * .8;
        float flutter = (sin(flutterPhase) + .35 * sin(flutterPhase * 2.3)) * uv2.x * driftWind.y;
        vec3 localWind = vec3(dot(world[0].xz, driftWind.zw), 0., dot(world[2].xz, driftWind.zw));
        positionUpdated += (normalUpdated * .2 + localWind * .12) * flutter;
        normalUpdated = normalize(normalUpdated + vec3(0., cos(flutterPhase) * uv2.x * driftWind.y * .12, 0.));`,
    };
  }
}
