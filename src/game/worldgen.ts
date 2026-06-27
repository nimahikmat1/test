import { Noise } from './noise';
import { ChunkData, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL, idx } from './chunk';
import { B } from './blocks';
import { Registry } from './blocks';

export enum Biome {
  OCEAN = 0,
  PLAINS = 1,
  FOREST = 2,
  DESERT = 3,
  MOUNTAINS = 4,
  TUNDRA = 5,
}

export const BiomeName: Record<Biome, string> = {
  [Biome.OCEAN]: 'Ocean',
  [Biome.PLAINS]: 'Plains',
  [Biome.FOREST]: 'Forest',
  [Biome.DESERT]: 'Desert',
  [Biome.MOUNTAINS]: 'Mountains',
  [Biome.TUNDRA]: 'Tundra',
};

interface ColumnInfo {
  biome: Biome;
  height: number;
  surface: number; // surface block id
}

export class WorldGen {
  noise: Noise;
  reg: Registry;
  constructor(seed: number, reg: Registry) {
    this.noise = new Noise(seed);
    this.reg = reg;
  }

  // Compute biome + height + surface block for a column.
  column(x: number, z: number): ColumnInfo {
    const n = this.noise;
    // multiple noise layers for varied terrain
    const c = n.fbm2(x * 0.006, z * 0.006, 4); // continental shape
    const hills = n.fbm2(x * 0.025 + 500, z * 0.025, 3); // local hills
    const ridge = Math.abs(n.fbm2(x * 0.008 + 300, z * 0.008, 4)); // ridge noise for mountains
    const mtn = n.fbm2(x * 0.0014 + 900, z * 0.0014, 3); // large-scale mountain regions
    const temp = n.fbm2(x * 0.003 + 100, z * 0.003, 3);
    const moist = n.fbm2(x * 0.003 + 200, z * 0.003, 3);

    let baseHeight = SEA_LEVEL + c * 8 + hills * 5;
    baseHeight = Math.max(2, baseHeight);
    // more dramatic mountains: use ridge noise for sharp peaks
    const mountainMask = mtn > 0.3 ? Math.min(1, (mtn - 0.3) / 0.4) : 0;
    const ridgeHeight = Math.pow(1 - ridge, 2) * 80 * mountainMask; // sharp ridges
    const mountainRaise = mountainMask * 30 + ridgeHeight;
    let height = Math.floor(baseHeight + mountainRaise);
    if (height < 1) height = 1;
    if (height > CHUNK_HEIGHT - 8) height = CHUNK_HEIGHT - 8;

    let biome: Biome;
    if (height <= SEA_LEVEL) {
      biome = Biome.OCEAN;
    } else if (mountainRaise > 20) {
      biome = Biome.MOUNTAINS;
    } else if (temp > 0.4) {
      biome = Biome.DESERT;
    } else if (temp < -0.35) {
      biome = Biome.TUNDRA;
    } else if (moist > 0.1) {
      biome = Biome.FOREST;
    } else {
      biome = Biome.PLAINS;
    }

    let surface = B.GRASS;
    if (biome === Biome.OCEAN) surface = B.SAND;
    else if (biome === Biome.DESERT) surface = B.SAND;
    else if (biome === Biome.TUNDRA) surface = B.SNOW;
    else if (biome === Biome.MOUNTAINS) surface = height > 92 ? B.SNOW : (height > 78 ? B.STONE : B.GRASS);
    else surface = B.GRASS;

    return { biome, height, surface };
  }

  fillChunk(chunk: ChunkData) {
    const n = this.noise;
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;

    // 1. Terrain + ores + caves + water + lava
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = ox + lx, wz = oz + lz;
        const col = this.column(wx, wz);
        const h = col.height;
        const biome = col.biome;

        for (let y = 0; y <= h; y++) {
          let b: number = B.STONE;
          if (y === 0) b = B.BEDROCK;
          else if (y <= 2 && n.hash3(wx, y, wz) < 0.5) b = B.BEDROCK;
          else {
            const depth = h - y;
            if (depth === 0) b = col.surface;
            else if (depth <= 3) {
              if (biome === Biome.DESERT) b = depth <= 1 ? B.SAND : B.SANDSTONE;
              else if (biome === Biome.OCEAN) b = depth <= 1 ? B.SAND : B.DIRT;
              else if (biome === Biome.MOUNTAINS && h > 74) b = B.STONE;
              else b = B.DIRT;
            } else {
              b = B.STONE;
            }
          }
          // ores (replace stone)
          if (b === B.STONE) {
            const ore = this.oreAt(wx, y, wz, h);
            if (ore !== B.AIR) b = ore;
          }
          chunk.blocks[idx(lx, y, lz)] = b;
        }

        // caves carve (below surface, above bedrock)
        const caveMax = h - 3;
        for (let y = 3; y <= caveMax; y++) {
          if (chunk.blocks[idx(lx, y, lz)] === B.AIR) continue;
          if (this.isCave(wx, y, wz)) {
            chunk.blocks[idx(lx, y, lz)] = B.AIR;
          }
        }

        // water fill for ocean/lake columns — fill any air below sea level
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) {
            if (chunk.blocks[idx(lx, y, lz)] === B.AIR) {
              chunk.blocks[idx(lx, y, lz)] = B.WATER;
            }
          }
        }
        // also fill caves that are below sea level and connected to ocean (simple heuristic)
        if (h <= SEA_LEVEL + 1) {
          for (let y = 1; y <= SEA_LEVEL; y++) {
            if (chunk.blocks[idx(lx, y, lz)] === B.AIR && y < h) {
              // check if this is a cave near water — fill with water if below sea level
              chunk.blocks[idx(lx, y, lz)] = B.WATER;
            }
          }
        }

        // lava at deep caves
        for (let y = 1; y < 7; y++) {
          if (chunk.blocks[idx(lx, y, lz)] === B.AIR) {
            chunk.blocks[idx(lx, y, lz)] = B.LAVA;
          }
        }
      }
    }

    // 2. Features (trees, cacti, flowers, tallgrass) scanning expanded region
    const M = 3; // tree radius margin
    for (let ex = -M; ex < CHUNK_SIZE + M; ex++) {
      for (let ez = -M; ez < CHUNK_SIZE + M; ez++) {
        const wx = ox + ex, wz = oz + ez;
        const col = this.column(wx, wz);
        if (col.biome === Biome.OCEAN) continue;
        const r = n.hash2(wx + 13, wz + 7);
        const r2 = n.hash2(wx + 31, wz + 19);

        if (col.biome === Biome.DESERT) {
          if (r < 0.012) {
            this.placeCactus(chunk, wx, col.height, wz);
          }
          continue;
        }

        // tree?
        const treeChance = col.biome === Biome.FOREST ? 0.06 : col.biome === Biome.PLAINS ? 0.012 : col.biome === Biome.TUNDRA ? 0.02 : col.biome === Biome.MOUNTAINS ? (col.height > 70 && col.height < 90 ? 0.03 : 0) : 0;
        if (r < treeChance && col.surface !== B.SNOW || (col.biome === Biome.TUNDRA && r < 0.015)) {
          // pick tree type
          const treeType = col.biome === Biome.TUNDRA ? 'pine' : col.biome === Biome.FOREST ? (r2 < 0.5 ? 'oak' : 'birch') : col.biome === Biome.MOUNTAINS ? 'pine' : 'oak';
          this.placeTree(chunk, wx, col.height, wz, treeType, r2);
        } else {
          // ground decoration
          if (col.surface === B.GRASS) {
            if (r2 < 0.06) this.setBlockClipped(chunk, wx, col.height + 1, wz, B.TALLGRASS);
            else if (r2 < 0.075) this.setBlockClipped(chunk, wx, col.height + 1, wz, B.FLOWER);
          } else if (col.surface === B.SNOW && r2 < 0.01) {
            this.setBlockClipped(chunk, wx, col.height + 1, wz, B.FLOWER);
          }
        }
      }
    }

    chunk.computeHeightMap();
    chunk.generated = true;
    chunk.dirty = true;
  }

  oreAt(x: number, y: number, z: number, h: number): number {
    const n = this.noise;
    if (y < h - 3 && n.perlin3(x * 0.1, y * 0.1, z * 0.1) > 0.5) return B.COAL_ORE;
    if (y < h - 8 && n.perlin3(x * 0.12 + 50, y * 0.12, z * 0.12 + 50) > 0.55) return B.IRON_ORE;
    if (y < 22 && n.perlin3(x * 0.15 + 100, y * 0.15, z * 0.15 + 100) > 0.6) return B.GOLD_ORE;
    if (y < 16 && n.perlin3(x * 0.2 + 200, y * 0.2, z * 0.2 + 200) > 0.66) return B.GEM_ORE;
    return B.AIR;
  }

  isCave(x: number, y: number, z: number): boolean {
    const n1 = this.noise.perlin3(x * 0.045, y * 0.06, z * 0.045);
    const n2 = this.noise.perlin3(x * 0.045 + 100, y * 0.06 + 50, z * 0.045 + 100);
    // worm-tunnel style: intersect two ridges
    return n1 > 0.55 && n2 > 0.5;
  }

  private setBlockClipped(chunk: ChunkData, wx: number, y: number, wz: number, b: number) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const lx = wx - chunk.cx * CHUNK_SIZE;
    const lz = wz - chunk.cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    // don't overwrite solid terrain with decoration
    const existing = chunk.blocks[idx(lx, y, lz)];
    if (existing !== B.AIR && existing !== B.WATER) return;
    chunk.blocks[idx(lx, y, lz)] = b;
  }

  private placeTree(chunk: ChunkData, wx: number, groundY: number, wz: number, type: string, rnd: number) {
    const logBlock = type === 'pine' ? B.PINE_LOG : type === 'birch' ? B.BIRCH_LOG : type === 'acacia' ? B.ACACIA_LOG : B.OAK_LOG;
    const leafBlock = type === 'pine' ? B.PINE_LEAVES : type === 'birch' ? B.BIRCH_LEAVES : type === 'acacia' ? B.ACACIA_LEAVES : B.OAK_LEAVES;
    const trunkH = type === 'pine' ? 7 + Math.floor(rnd * 4) : 4 + Math.floor(rnd * 3);

    // leaves
    if (type === 'pine') {
      // stacked rings decreasing
      let top = groundY + trunkH;
      let radius = 0;
      for (let layer = 0; layer < 4; layer++) {
        const ly = top - layer;
        const rr = layer === 0 ? 0 : layer === 1 ? 1 : 2;
        for (let dx = -rr; dx <= rr; dx++) {
          for (let dz = -rr; dz <= rr; dz++) {
            if (dx === 0 && dz === 0 && layer < 3) continue;
            if (Math.abs(dx) === rr && Math.abs(dz) === rr && rr > 1) continue;
            this.setLeaf(chunk, wx + dx, ly, wz + dz, leafBlock);
          }
        }
      }
      // a couple lower rings
      for (let layer = 0; layer < 2; layer++) {
        const ly = groundY + 2 + layer * 2;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          this.setLeaf(chunk, wx + dx, ly, wz + dz, leafBlock);
        }
      }
      void radius;
    } else {
      const top = groundY + trunkH;
      // canopy: 5x5x2 then 3x3x1, plus top
      for (let dy = -2; dy <= 0; dy++) {
        const ly = top + dy;
        const rad = dy >= -1 ? 2 : 1;
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad) {
            if (this.noise.hash2(wx + dx + dy, wz + dz + dy) < 0.5) continue;
          }
          this.setLeaf(chunk, wx + dx, ly, wz + dz, leafBlock);
        }
      }
      this.setLeaf(chunk, wx, top + 1, wz, leafBlock);
    }

    // trunk
    for (let i = 1; i <= trunkH; i++) {
      this.setBlockForce(chunk, wx, groundY + i, wz, logBlock);
    }
  }

  private setLeaf(chunk: ChunkData, wx: number, y: number, wz: number, b: number) {
    const lx = wx - chunk.cx * CHUNK_SIZE;
    const lz = wz - chunk.cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    if (chunk.blocks[idx(lx, y, lz)] === B.AIR) chunk.blocks[idx(lx, y, lz)] = b;
  }

  private setBlockForce(chunk: ChunkData, wx: number, y: number, wz: number, b: number) {
    const lx = wx - chunk.cx * CHUNK_SIZE;
    const lz = wz - chunk.cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    chunk.blocks[idx(lx, y, lz)] = b;
  }

  private placeCactus(chunk: ChunkData, wx: number, groundY: number, wz: number) {
    const h = 1 + Math.floor(this.noise.hash2(wx, wz) * 3);
    for (let i = 1; i <= h; i++) this.setBlockForce(chunk, wx, groundY + i, wz, B.CACTUS);
  }

  // light level 0-15 at a world position (simple skylight + block light)
  lightAt(wx: number, wy: number, wz: number, getBlock: (x: number, y: number, z: number) => number): number {
    if (wy < 0) return 0;
    // skylight: 15 if can see sky (no opaque above)
    let sky = 15;
    for (let y = wy + 1; y < CHUNK_HEIGHT; y++) {
      const b = getBlock(wx, y, wz);
      const bt = this.reg.getBlock(b);
      if (bt.opaque) { sky = 0; break; }
      if (b === B.WATER) sky = Math.min(sky, 3);
    }
    // block light from nearby light sources (cheap: check 5-block radius via getBlock)
    let bl = 0;
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -4; dy <= 4; dy++)
        for (let dz = -4; dz <= 4; dz++) {
          const b = getBlock(wx + dx, wy + dy, wz + dz);
          const bt = this.reg.getBlock(b);
          if (bt.light > 0) {
            const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            const l = Math.max(0, bt.light - d);
            bl = Math.max(bl, l);
          }
        }
    return Math.max(sky, bl);
  }
}
