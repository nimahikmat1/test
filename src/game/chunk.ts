import * as THREE from 'three';
import { BlockId } from './types';
import { Registry } from './blocks';
import { B } from './blocks';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 256;
export const SEA_LEVEL = 40;

export function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

export function idx(lx: number, y: number, lz: number): number {
  return (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
}

// Lightweight voxel storage for one chunk.
export class ChunkData {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  // skylight: per-column height of highest opaque block (for spawn light + simple AO)
  heightMap: Int16Array; // per (lx,lz) highest solid/opaque y
  maxSolidY = 0; // highest non-air y in chunk (upper bound for meshing)
  generated = false;
  dirty = true; // needs remesh
  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    this.heightMap = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
  }
  get(lx: number, y: number, lz: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return B.AIR;
    return this.blocks[idx(lx, y, lz)];
  }
  set(lx: number, y: number, lz: number, b: BlockId) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[idx(lx, y, lz)] = b;
  }
  // recompute heightmap (highest opaque y per column)
  computeHeightMap() {
    let maxH = 0;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        let h = 0;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const b = this.blocks[idx(lx, y, lz)];
          if (b !== B.AIR && b !== B.WATER && b !== B.FLOWING_WATER) {
            h = y + 1;
            break;
          }
        }
        this.heightMap[lz * CHUNK_SIZE + lx] = h;
        if (h > maxH) maxH = h;
      }
    }
    this.maxSolidY = maxH;
  }
}

// Face directions: +x, -x, +y(top), -y(bottom), +z, -z
const FACES = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], tex: 'side', shade: 0.72, normal: [1, 0, 0] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], tex: 'side', shade: 0.72, normal: [-1, 0, 0] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], tex: 'top', shade: 1.0, normal: [0, 1, 0] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], tex: 'bottom', shade: 0.5, normal: [0, -1, 0] },
  { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], tex: 'side', shade: 0.86, normal: [0, 0, 1] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], tex: 'side', shade: 0.86, normal: [0, 0, -1] },
];

// UV layout for a quad (two triangles) matching FACES corner order (CCW).
// Each face corners are ordered so that triangulation (0,1,2)(0,2,3) is correct.
const QUAD_UV = [
  [0, 0], [0, 1], [1, 1], [1, 0],
];

export interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  cutout: THREE.Mesh | null;
  liquid: THREE.Mesh | null;
}

// Build geometry for a chunk. Needs neighbor chunk data for border face culling.
export function buildChunkMesh(
  chunk: ChunkData,
  neighbors: (ChunkData | null)[], // [ +x, -x, +z, -z ]
  registry: Registry
): { opaque: THREE.BufferGeometry | null; cutout: THREE.BufferGeometry | null; liquid: THREE.BufferGeometry | null } {
  const opaquePos: number[] = [];
  const opaqueNor: number[] = [];
  const opaqueUv: number[] = [];
  const opaqueCol: number[] = [];
  const opaqueIdx: number[] = [];

  // cutout: torch, plants, glass, ice (transparent but not liquid — use alphaTest)
  const cPos: number[] = [];
  const cNor: number[] = [];
  const cUv: number[] = [];
  const cCol: number[] = [];
  const cIdx: number[] = [];

  // liquid: water, lava (use opacity)
  const lPos: number[] = [];
  const lNor: number[] = [];
  const lUv: number[] = [];
  const lCol: number[] = [];
  const lIdx: number[] = [];

  const ox = chunk.cx * CHUNK_SIZE;
  const oz = chunk.cz * CHUNK_SIZE;

  // helper to get block at world-within-chunk coordinates, crossing borders
  const getBlock = (lx: number, y: number, lz: number): BlockId => {
    if (y < 0) return B.BEDROCK;
    if (y >= CHUNK_HEIGHT) return B.AIR;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      return chunk.blocks[idx(lx, y, lz)];
    }
    if (lx < 0) {
      const n = neighbors[1];
      if (!n) return B.AIR;
      return n.blocks[idx(CHUNK_SIZE - 1, y, Math.max(0, Math.min(CHUNK_SIZE - 1, lz)))];
    }
    if (lx >= CHUNK_SIZE) {
      const n = neighbors[0];
      if (!n) return B.AIR;
      return n.blocks[idx(0, y, Math.max(0, Math.min(CHUNK_SIZE - 1, lz)))];
    }
    if (lz < 0) {
      const n = neighbors[3];
      if (!n) return B.AIR;
      return n.blocks[idx(Math.max(0, Math.min(CHUNK_SIZE - 1, lx)), y, CHUNK_SIZE - 1)];
    }
    if (lz >= CHUNK_SIZE) {
      const n = neighbors[2];
      if (!n) return B.AIR;
      return n.blocks[idx(Math.max(0, Math.min(CHUNK_SIZE - 1, lx)), y, 0)];
    }
    return B.AIR;
  };

  for (let y = 0; y <= chunk.maxSolidY; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const b = chunk.blocks[idx(lx, y, lz)];
        if (b === B.AIR) continue;
        const bt = registry.getBlock(b);
        if (bt.render === 'none') continue;

        // determine target geometry: liquid -> liquid, cross -> cutout, transparent solid -> cutout, opaque -> opaque
        const isLiquid = bt.liquid;
        const isCutout = bt.render === 'cross' || (!bt.liquid && bt.transparent);

        if (bt.render === 'cross') {
          // two diagonal quads — always render (no culling)
          const tile = bt.textures.side;
          const [u0, v0, u1, v1] = registry.atlas.uv(tile);
          const shade = 1.0;
          const r = (bt.color ? bt.color[0] : 1) * shade;
          const g = (bt.color ? bt.color[1] : 1) * shade;
          const bl = (bt.color ? bt.color[2] : 1) * shade;
          const x0 = ox + lx, z0 = oz + lz;
          const quads = [
            [[x0 + 0.0, y, z0 + 0.0], [x0 + 1.0, y, z0 + 1.0], [x0 + 1.0, y + 1, z0 + 1.0], [x0 + 0.0, y + 1, z0 + 0.0]],
            [[x0 + 0.0, y, z0 + 1.0], [x0 + 1.0, y, z0 + 0.0], [x0 + 1.0, y + 1, z0 + 0.0], [x0 + 0.0, y + 1, z0 + 1.0]],
          ];
          for (const q of quads) {
            const base = cPos.length / 3;
            for (let i = 0; i < 4; i++) {
              cPos.push(q[i][0], q[i][1], q[i][2]);
              cNor.push(0, 1, 0);
              cCol.push(r, g, bl);
            }
            cUv.push(u0, v0, u1, v0, u1, v1, u0, v1);
            cIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          continue;
        }

        // cube faces
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = lx + face.dir[0];
          const ny = y + face.dir[1];
          const nz = lz + face.dir[2];
          const neighbor = getBlock(nx, ny, nz);
          const nbt = registry.getBlock(neighbor);
          let renderFace = false;
          if (neighbor === B.AIR) renderFace = true;
          else if (nbt.transparent) {
            if (bt.liquid) {
              if (!nbt.liquid && !nbt.opaque) renderFace = true;
            } else if (bt.opaque) {
              renderFace = true;
            } else {
              if (neighbor !== b) renderFace = true;
            }
          }
          if (!renderFace) continue;

          const tile = bt.textures[face.tex as 'top' | 'side' | 'bottom'];
          const [u0, v0, u1, v1] = registry.atlas.uv(tile);
          let r = face.shade;
          let g = face.shade;
          let bl = face.shade;
          if (bt.color) { r *= bt.color[0]; g *= bt.color[1]; bl *= bt.color[2]; }

          // pick target arrays
          let P: number[], N: number[], U: number[], C: number[], Idx: number[];
          if (isLiquid) { P = lPos; N = lNor; U = lUv; C = lCol; Idx = lIdx; }
          else if (isCutout) { P = cPos; N = cNor; U = cUv; C = cCol; Idx = cIdx; }
          else { P = opaquePos; N = opaqueNor; U = opaqueUv; C = opaqueCol; Idx = opaqueIdx; }

          const base = P.length / 3;
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            P.push(ox + lx + c[0], y + c[1], oz + lz + c[2]);
            N.push(face.normal[0], face.normal[1], face.normal[2]);
            C.push(r, g, bl);
          }
          U.push(u0, v0, u0, v1, u1, v1, u1, v0);
          Idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  const makeGeom = (P: number[], N: number[], U: number[], C: number[], Idx: number[]) => {
    if (P.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setIndex(Idx);
    return g;
  };
  return {
    opaque: makeGeom(opaquePos, opaqueNor, opaqueUv, opaqueCol, opaqueIdx),
    cutout: makeGeom(cPos, cNor, cUv, cCol, cIdx),
    liquid: makeGeom(lPos, lNor, lUv, lCol, lIdx),
  };
}
