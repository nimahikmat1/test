import * as THREE from 'three';
import { ChunkData, CHUNK_SIZE, CHUNK_HEIGHT, chunkKey, idx, buildChunkMesh } from './chunk';
import { WorldGen } from './worldgen';
import { Registry } from './blocks';
import { B } from './blocks';
import { BlockId } from './types';

interface ModEntry { lx: number; y: number; lz: number; block: BlockId; }

export class World {
  reg: Registry;
  gen: WorldGen;
  seed: number;
  chunks = new Map<string, ChunkData>();
  meshes = new Map<string, { opaque: THREE.Mesh | null; cutout: THREE.Mesh | null; liquid: THREE.Mesh | null }>();
  modsByChunk = new Map<string, ModEntry[]>();
  group: THREE.Group;
  opaqueMat: THREE.Material;
  cutoutMat: THREE.Material;
  liquidMat: THREE.Material;

  constructor(seed: number, reg: Registry) {
    this.seed = seed;
    this.reg = reg;
    this.gen = new WorldGen(seed, reg);
    this.group = new THREE.Group();
    this.opaqueMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: reg.atlas.texture,
    });
    this.cutoutMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: reg.atlas.texture,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    this.liquidMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: reg.atlas.texture,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  // Ensure chunk voxel data exists (generated + mods applied). Does not mesh.
  ensureChunk(cx: number, cz: number): ChunkData {
    const key = chunkKey(cx, cz);
    let ch = this.chunks.get(key);
    if (ch) return ch;
    ch = new ChunkData(cx, cz);
    this.gen.fillChunk(ch);
    // apply modifications
    const mods = this.modsByChunk.get(key);
    if (mods) {
      for (const m of mods) {
        ch.blocks[idx(m.lx, m.y, m.lz)] = m.block;
      }
      ch.computeHeightMap();
      ch.dirty = true;
    }
    this.chunks.set(key, ch);
    return ch;
  }

  getBlock(wx: number, wy: number, wz: number): BlockId {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return B.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const ch = this.chunks.get(chunkKey(cx, cz));
    if (!ch) {
      // not loaded — generate on demand (rare during play)
      const gen = this.ensureChunk(cx, cz);
      return gen.blocks[idx(lx, wy, lz)];
    }
    return ch.blocks[idx(lx, wy, lz)];
  }

  setBlock(wx: number, wy: number, wz: number, b: BlockId, record = true): boolean {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const ch = this.ensureChunk(cx, cz);
    ch.blocks[idx(lx, wy, lz)] = b;
    ch.computeHeightMap();
    ch.dirty = true;
    if (record) {
      const key = chunkKey(cx, cz);
      let mods = this.modsByChunk.get(key);
      if (!mods) { mods = []; this.modsByChunk.set(key, mods); }
      // replace existing mod entry for same cell
      const existing = mods.find((m) => m.lx === lx && m.y === wy && m.lz === lz);
      if (existing) existing.block = b;
      else mods.push({ lx, y: wy, lz, block: b });
    }
    // mark neighbor chunks dirty if on border
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    // immediate remesh for instant visual feedback (no see-through lag)
    this.remeshChunk(cx, cz);
    if (lx === 0) this.remeshChunk(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.remeshChunk(cx + 1, cz);
    if (lz === 0) this.remeshChunk(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.remeshChunk(cx, cz + 1);
    return true;
  }

  private markDirty(cx: number, cz: number) {
    const ch = this.chunks.get(chunkKey(cx, cz));
    if (ch) ch.dirty = true;
  }

  // Rebuild a single chunk's mesh immediately.
  remeshChunk(cx: number, cz: number) {
    const ch = this.chunks.get(chunkKey(cx, cz));
    if (!ch) return;
    const nx_p = this.ensureChunk(cx + 1, cz);
    const nx_m = this.ensureChunk(cx - 1, cz);
    const nz_p = this.ensureChunk(cx, cz + 1);
    const nz_m = this.ensureChunk(cx, cz - 1);
    const neighbors = [nx_p, nx_m, nz_p, nz_m];
    const geom = buildChunkMesh(ch, neighbors, this.reg);
    const key = chunkKey(cx, cz);
    let m = this.meshes.get(key);
    if (!m) {
      m = { opaque: null, cutout: null, liquid: null };
      this.meshes.set(key, m);
    }
    // replace opaque
    if (m.opaque) {
      this.group.remove(m.opaque);
      m.opaque.geometry.dispose();
      m.opaque = null;
    }
    if (geom.opaque) {
      const mesh = new THREE.Mesh(geom.opaque, this.opaqueMat);
      mesh.frustumCulled = true;
      m.opaque = mesh;
      this.group.add(mesh);
    }
    // replace cutout (torch, plants, glass)
    if (m.cutout) {
      this.group.remove(m.cutout);
      m.cutout.geometry.dispose();
      m.cutout = null;
    }
    if (geom.cutout) {
      const mesh = new THREE.Mesh(geom.cutout, this.cutoutMat);
      mesh.frustumCulled = true;
      m.cutout = mesh;
      this.group.add(mesh);
    }
    // replace liquid (water, lava)
    if (m.liquid) {
      this.group.remove(m.liquid);
      m.liquid.geometry.dispose();
      m.liquid = null;
    }
    if (geom.liquid) {
      const mesh = new THREE.Mesh(geom.liquid, this.liquidMat);
      mesh.frustumCulled = true;
      m.liquid = mesh;
      this.group.add(mesh);
    }
    ch.dirty = false;
  }

  // Mesh up to `budget` dirty chunks per call.
  updateMeshes(budget = 3) {
    let built = 0;
    for (const ch of this.chunks.values()) {
      if (built >= budget) break;
      if (!ch.dirty) continue;
      this.remeshChunk(ch.cx, ch.cz);
      built++;
    }
  }

  // Load chunks around player and unload far ones.
  update(playerX: number, playerZ: number, renderDistance: number) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);
    // ensure data in radius (closest first)
    for (let r = 0; r <= renderDistance; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          this.ensureChunk(pcx + dx, pcz + dz);
        }
      }
    }
    // unload beyond radius + margin
    const unloadR = renderDistance + 2;
    const toRemove: string[] = [];
    for (const key of this.chunks.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > unloadR) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.chunks.delete(key);
      const m = this.meshes.get(key);
      if (m) {
        if (m.opaque) { this.group.remove(m.opaque); m.opaque.geometry.dispose(); }
        if (m.cutout) { this.group.remove(m.cutout); m.cutout.geometry.dispose(); }
        if (m.liquid) { this.group.remove(m.liquid); m.liquid.geometry.dispose(); }
        this.meshes.delete(key);
      }
    }
  }

  // find topmost solid block at (x,z) for spawn
  topSolid(wx: number, wz: number): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const ch = this.ensureChunk(cx, cz);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const b = ch.blocks[idx(lx, y, lz)];
      const bt = this.reg.getBlock(b);
      if (bt.solid) return y;
    }
    return 0;
  }

  // raycast via voxel DDA to find first solid (non-air, non-liquid) block within maxDist.
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { x: number; y: number; z: number; nx: number; ny: number; nz: number; block: BlockId } | null {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x);
    const stepY = Math.sign(dir.y);
    const stepZ = Math.sign(dir.z);
    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    const fracX = stepX > 0 ? (Math.ceil(origin.x) - origin.x) : (origin.x - Math.floor(origin.x));
    const fracY = stepY > 0 ? (Math.ceil(origin.y) - origin.y) : (origin.y - Math.floor(origin.y));
    const fracZ = stepZ > 0 ? (Math.ceil(origin.z) - origin.z) : (origin.z - Math.floor(origin.z));
    let tMaxX = dir.x !== 0 ? tDeltaX * (fracX === 0 ? 1 : fracX) : Infinity;
    let tMaxY = dir.y !== 0 ? tDeltaY * (fracY === 0 ? 1 : fracY) : Infinity;
    let tMaxZ = dir.z !== 0 ? tDeltaZ * (fracZ === 0 ? 1 : fracZ) : Infinity;
    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    for (let i = 0; i < 256; i++) {
      const b = this.getBlock(x, y, z);
      const bt = this.reg.getBlock(b);
      if (b !== B.AIR && !bt.liquid && bt.render !== 'none') {
        return { x, y, z, nx, ny, nz, block: b };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > maxDist) break;
        x += stepX; t = tMaxX; tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > maxDist) break;
        y += stepY; t = tMaxY; tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        if (tMaxZ > maxDist) break;
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
    }
    void t;
    return null;
  }

  // export all modifications as world-coordinate entries
  exportMods(): { x: number; y: number; z: number; block: BlockId }[] {
    const out: { x: number; y: number; z: number; block: BlockId }[] = [];
    for (const [key, mods] of this.modsByChunk) {
      const [cx, cz] = key.split(',').map(Number);
      for (const m of mods) {
        out.push({ x: cx * CHUNK_SIZE + m.lx, y: m.y, z: cz * CHUNK_SIZE + m.lz, block: m.block });
      }
    }
    return out;
  }

  applyMods(mods: { x: number; y: number; z: number; block: BlockId }[]) {
    for (const m of mods) {
      const cx = Math.floor(m.x / CHUNK_SIZE);
      const cz = Math.floor(m.z / CHUNK_SIZE);
      const lx = m.x - cx * CHUNK_SIZE;
      const lz = m.z - cz * CHUNK_SIZE;
      const key = chunkKey(cx, cz);
      let arr = this.modsByChunk.get(key);
      if (!arr) { arr = []; this.modsByChunk.set(key, arr); }
      arr.push({ lx, y: m.y, lz, block: m.block });
    }
  }
}
