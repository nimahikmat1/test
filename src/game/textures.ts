// Procedural pixel-art texture atlas drawn on a canvas. No external assets.
import * as THREE from 'three';

type DrawFn = (ctx: CanvasRenderingContext2D, s: number) => void;

const TILE = 16; // pixels per tile
const COLS = 16; // tiles per row

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function px(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// shade a base color by amount (-1..1)
function shade(hex: string, amt: number): string {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  if (amt >= 0) {
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
  } else {
    const a = 1 + amt;
    r = Math.round(r * a);
    g = Math.round(g * a);
    b = Math.round(b * a);
  }
  return `rgb(${r},${g},${b})`;
}

// noisy fill: base color with random darker/lighter pixels
function noisy(ctx: CanvasRenderingContext2D, s: number, base: string, seed: number, variance = 0.12, density = 0.5) {
  const r = rnd(seed);
  px(ctx, s, 0, 0, s, s, base);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (r() < density) {
        const amt = (r() * 2 - 1) * variance;
        px(ctx, s, x, y, 1, 1, shade(base, amt));
      }
    }
  }
}

export class TextureAtlas {
  canvas: HTMLCanvasElement;
  texture: THREE.Texture;
  private names: string[] = [];
  private index = new Map<string, number>();
  private draws: { name: string; fn: DrawFn }[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.registerAll();
    const rows = Math.ceil(this.draws.length / COLS);
    this.canvas.width = COLS * TILE;
    this.canvas.height = rows * TILE;
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.draws.forEach((d, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      ctx.save();
      ctx.translate(col * TILE, row * TILE);
      // clip to tile
      ctx.beginPath();
      ctx.rect(0, 0, TILE, TILE);
      ctx.clip();
      d.fn(ctx, TILE);
      ctx.restore();
    });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  private reg(name: string, fn: DrawFn) {
    const i = this.draws.length;
    this.draws.push({ name, fn });
    this.names.push(name);
    this.index.set(name, i);
    return i;
  }

  get(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error('Unknown texture: ' + name);
    return i;
  }

  // returns UV rect [u0, v0, u1, v1] in texture space (v0 bottom)
  uv(tile: number): [number, number, number, number] {
    const col = tile % COLS;
    const row = Math.floor(tile / COLS);
    const rows = this.canvas.height / TILE;
    const pad = 0.5 / this.canvas.width;
    const padV = 0.5 / this.canvas.height;
    const u0 = (col * TILE) / this.canvas.width + pad;
    const u1 = ((col + 1) * TILE) / this.canvas.width - pad;
    // flip V (canvas top -> texture top)
    const v1 = 1 - (row * TILE) / this.canvas.height - padV;
    const v0 = 1 - ((row + 1) * TILE) / this.canvas.height + padV;
    return [u0, v0, u1, v1];
  }

  private registerAll() {
    // ---- Terrain ----
    this.reg('stone', (c, s) => noisy(c, s, '#7d7d7d', 11, 0.14, 0.6));
    this.reg('dirt', (c, s) => noisy(c, s, '#8a5a36', 22, 0.16, 0.6));
    this.reg('grass_top', (c, s) => noisy(c, s, '#5fa843', 33, 0.14, 0.6));
    this.reg('grass_side', (c, s) => {
      noisy(c, s, '#8a5a36', 44, 0.16, 0.6);
      // green top band
      for (let x = 0; x < s; x++) {
        const h = 3 + Math.floor(rnd(44 + x)() * 2);
        for (let y = 0; y < h; y++) {
          px(c, s, x, y, 1, 1, shade('#5fa843', (rnd(x * 7 + y)() * 2 - 1) * 0.14));
        }
      }
    });
    this.reg('sand', (c, s) => noisy(c, s, '#e6d9a5', 55, 0.1, 0.5));
    this.reg('sandstone_top', (c, s) => noisy(c, s, '#e6d9a5', 56, 0.08, 0.4));
    this.reg('sandstone_side', (c, s) => {
      noisy(c, s, '#d8c890', 57, 0.08, 0.4);
      px(c, s, 0, 3, s, 1, '#bda873');
      px(c, s, 0, s - 4, s, 1, '#bda873');
    });
    this.reg('sandstone_bottom', (c, s) => noisy(c, s, '#cdb980', 58, 0.08, 0.4));
    this.reg('gravel', (c, s) => noisy(c, s, '#8a8178', 66, 0.2, 0.7));
    this.reg('clay', (c, s) => noisy(c, s, '#a7a3b0', 77, 0.08, 0.4));
    this.reg('snow', (c, s) => noisy(c, s, '#f4f7fb', 88, 0.06, 0.4));
    this.reg('snow_side', (c, s) => {
      noisy(c, s, '#8a5a36', 89, 0.14, 0.5);
      for (let x = 0; x < s; x++) {
        const h = 3 + Math.floor(rnd(89 + x)() * 2);
        for (let y = 0; y < h; y++) px(c, s, x, y, 1, 1, shade('#f4f7fb', (rnd(x + y)() * 2 - 1) * 0.06));
      }
    });
    this.reg('ice', (c, s) => noisy(c, s, '#9fb8e8', 99, 0.1, 0.5));
    this.reg('bedrock', (c, s) => noisy(c, s, '#4a4a4a', 100, 0.25, 0.8));
    this.reg('cobblestone', (c, s) => {
      noisy(c, s, '#6f6f6f', 111, 0.18, 0.5);
      // cracks
      const r = rnd(111);
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(r() * s), y = Math.floor(r() * s);
        px(c, s, x, y, 2, 1, '#444');
        px(c, s, x, y + 1, 1, 2, '#444');
      }
    });
    this.reg('mossy_cobble', (c, s) => {
      noisy(c, s, '#6f6f6f', 112, 0.18, 0.5);
      const r = rnd(112);
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(r() * s), y = Math.floor(r() * s);
        px(c, s, x, y, 1, 1, shade('#5a7d3a', (r() * 2 - 1) * 0.2));
      }
    });
    this.reg('brick', (c, s) => {
      px(c, s, 0, 0, s, s, '#9b4a3a');
      const r = rnd(123);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        if (r() < 0.3) px(c, s, x, y, 1, 1, shade('#9b4a3a', (r() * 2 - 1) * 0.15));
      }
      // mortar lines
      px(c, s, 0, 0, s, 1, '#cfcabe');
      px(c, s, 0, 8, s, 1, '#cfcabe');
      px(c, s, 0, 0, 1, 8, '#cfcabe');
      px(c, s, 8, 8, 1, 8, '#cfcabe');
    });
    this.reg('glass', (c, s) => {
      px(c, s, 0, 0, s, s, 'rgba(180,220,235,0.6)');
      px(c, s, 0, 0, s, 1, '#cfeaf2');
      px(c, s, 0, 0, 1, s, '#cfeaf2');
      px(c, s, s - 1, 0, 1, s, '#cfeaf2');
      px(c, s, 0, s - 1, s, 1, '#cfeaf2');
      px(c, s, 3, 3, 4, 1, '#eaf7fa');
      px(c, s, 3, 3, 1, 4, '#eaf7fa');
    });

    // ---- Ores (stone base + colored specks) ----
    const ore = (seed: number, color: string) => (c: number, s: number) => {
      noisy(c, s, '#7d7d7d', seed, 0.14, 0.6);
      const r = rnd(seed + 1);
      for (let i = 0; i < 14; i++) {
        const x = 1 + Math.floor(r() * (s - 2));
        const y = 1 + Math.floor(r() * (s - 2));
        const sz = r() < 0.5 ? 1 : 2;
        px(c, s, x, y, sz, sz, shade(color, (r() * 2 - 1) * 0.2));
      }
    };
    this.reg('coal_ore', ore(200, '#2b2b2b'));
    this.reg('iron_ore', ore(201, '#c8a079'));
    this.reg('gold_ore', ore(202, '#f4d644'));
    this.reg('gem_ore', ore(203, '#5fe3c0'));
    this.reg('coal_block', (c, s) => noisy(c, s, '#2b2b2b', 204, 0.1, 0.5));
    this.reg('iron_block', (c, s) => noisy(c, s, '#d8d8d8', 205, 0.08, 0.4));
    this.reg('gold_block', (c, s) => noisy(c, s, '#f4d644', 206, 0.08, 0.4));
    this.reg('gem_block', (c, s) => noisy(c, s, '#5fe3c0', 207, 0.1, 0.5));

    // ---- Wood ----
    const log = (seed: number, bark: string, top: string) => ({
      top: (c: number, s: number) => {
        px(c, s, 0, 0, s, s, top);
        // rings
        const cx = 8, cy = 8;
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          if (Math.floor(d) % 2 === 0) px(c, s, x, y, 1, 1, shade(top, -0.12));
        }
      },
      side: (c: number, s: number) => {
        noisy(c, s, bark, seed, 0.12, 0.6);
        // vertical streaks
        for (let x = 0; x < s; x += 3) px(c, s, x, 0, 1, s, shade(bark, -0.18));
      },
    });
    const oak = log(300, '#6b4f2a', '#b8945a');
    this.reg('oak_log_top', oak.top);
    this.reg('oak_log_side', oak.side);
    this.reg('oak_planks', (c, s) => {
      noisy(c, s, '#b8945a', 301, 0.1, 0.5);
      px(c, s, 0, 5, s, 1, shade('#b8945a', -0.2));
      px(c, s, 0, 11, s, 1, shade('#b8945a', -0.2));
      px(c, s, 7, 0, 1, 6, shade('#b8945a', -0.2));
      px(c, s, 4, 6, 1, 5, shade('#b8945a', -0.2));
      px(c, s, 11, 11, 1, 5, shade('#b8945a', -0.2));
    });
    this.reg('oak_leaves', (c, s) => {
      noisy(c, s, '#3f7a2e', 302, 0.22, 0.85);
    });
    const pine = log(310, '#3d2f1f', '#6e5a36');
    this.reg('pine_log_top', pine.top);
    this.reg('pine_log_side', pine.side);
    this.reg('pine_planks', (c, s) => { noisy(c, s, '#6e5a36', 311, 0.1, 0.5); px(c, s, 0, 5, s, 1, shade('#6e5a36', -0.2)); px(c, s, 0, 11, s, 1, shade('#6e5a36', -0.2)); });
    this.reg('pine_leaves', (c, s) => { noisy(c, s, '#2f5a26', 312, 0.2, 0.85); });
    const birch = log(320, '#d7d3c8', '#e3dfd4');
    this.reg('birch_log_top', birch.top);
    this.reg('birch_log_side', (c, s) => {
      noisy(c, s, '#e3dfd4', 321, 0.06, 0.4);
      // black birch streaks
      px(c, s, 3, 2, 1, 4, '#2b2b2b');
      px(c, s, 9, 7, 1, 5, '#2b2b2b');
      px(c, s, 6, 12, 1, 3, '#2b2b2b');
    });
    this.reg('birch_planks', (c, s) => { noisy(c, s, '#e3dfd4', 322, 0.08, 0.4); px(c, s, 0, 5, s, 1, shade('#e3dfd4', -0.18)); px(c, s, 0, 11, s, 1, shade('#e3dfd4', -0.18)); });
    this.reg('birch_leaves', (c, s) => { noisy(c, s, '#8aa15a', 323, 0.18, 0.8); });
    const acacia = log(330, '#7a3b22', '#b07a3a');
    this.reg('acacia_log_top', acacia.top);
    this.reg('acacia_log_side', acacia.side);
    this.reg('acacia_planks', (c, s) => { noisy(c, s, '#b07a3a', 331, 0.1, 0.5); px(c, s, 0, 5, s, 1, shade('#b07a3a', -0.2)); px(c, s, 0, 11, s, 1, shade('#b07a3a', -0.2)); });
    this.reg('acacia_leaves', (c, s) => { noisy(c, s, '#8a9a3a', 332, 0.18, 0.8); });

    // ---- Liquids ----
    this.reg('water', (c, s) => { noisy(c, s, '#2f6fd6', 400, 0.1, 0.5); });
    this.reg('lava', (c, s) => {
      noisy(c, s, '#e0531a', 401, 0.18, 0.7);
      const r = rnd(401);
      for (let i = 0; i < 10; i++) px(c, s, Math.floor(r() * s), Math.floor(r() * s), 2, 2, '#ffd24a');
    });

    // ---- Functional ----
    this.reg('crafting_table_top', (c, s) => {
      noisy(c, s, '#b8945a', 500, 0.1, 0.4);
      // grid
      px(c, s, 0, 0, s, 1, '#6b4f2a'); px(c, s, 0, 0, 1, s, '#6b4f2a');
      px(c, s, 5, 5, 6, 1, '#6b4f2a'); px(c, s, 5, 10, 6, 1, '#6b4f2a');
      px(c, s, 5, 5, 1, 6, '#6b4f2a'); px(c, s, 10, 5, 1, 6, '#6b4f2a');
    });
    this.reg('crafting_table_side', (c, s) => {
      noisy(c, s, '#a07a44', 501, 0.1, 0.4);
      px(c, s, 0, 4, s, 1, '#6b4f2a');
      // tool icon
      px(c, s, 7, 6, 2, 6, '#3a3a3a');
      px(c, s, 6, 6, 4, 2, '#888');
    });
    this.reg('furnace_top', (c, s) => { noisy(c, s, '#6f6f6f', 510, 0.16, 0.5); px(c, s, 4, 4, 8, 8, '#444'); });
    this.reg('furnace_side', (c, s) => { noisy(c, s, '#6f6f6f', 511, 0.16, 0.5); });
    this.reg('furnace_front', (c, s) => {
      noisy(c, s, '#6f6f6f', 512, 0.16, 0.5);
      px(c, s, 4, 5, 8, 6, '#2a2a2a');
      px(c, s, 4, 9, 8, 2, '#e0531a');
      px(c, s, 5, 10, 6, 1, '#ffd24a');
    });
    this.reg('chest_top', (c, s) => { noisy(c, s, '#9b6b3a', 520, 0.1, 0.4); px(c, s, 0, 0, s, 1, '#5a3d20'); });
    this.reg('chest_side', (c, s) => { noisy(c, s, '#9b6b3a', 521, 0.1, 0.4); px(c, s, 0, 6, s, 1, '#5a3d20'); px(c, s, 7, 6, 2, 4, '#3a2814'); });
    this.reg('chest_front', (c, s) => { noisy(c, s, '#9b6b3a', 522, 0.1, 0.4); px(c, s, 7, 7, 2, 3, '#3a2814'); });

    // ---- Light ----
    this.reg('torch', (c, s) => {
      px(c, s, 7, 2, 2, 2, '#ffd24a');
      px(c, s, 7, 4, 2, 8, '#8a5a2a');
      px(c, s, 6, 1, 4, 2, '#ffe88a');
    });
    this.reg('glow_crystal', (c, s) => {
      noisy(c, s, '#5fe3c0', 530, 0.2, 0.6);
      px(c, s, 7, 7, 2, 2, '#bff7e6');
    });

    // ---- Wool ----
    const wool = (name: string, color: string, seed: number) =>
      this.reg(name, (c, s) => { noisy(c, s, color, seed, 0.08, 0.4); px(c, s, 0, 0, s, 1, shade(color, -0.15)); });
    wool('wool_white', '#e8e8e8', 600);
    wool('wool_red', '#b3312c', 601);
    wool('wool_green', '#41802c', 602);
    wool('wool_blue', '#2f4ea0', 603);
    wool('wool_yellow', '#d6c23a', 604);
    wool('wool_purple', '#7a3a8a', 605);
    wool('wool_orange', '#d87a2a', 606);
    wool('wool_black', '#2a2a2a', 607);

    // ---- Plants ----
    this.reg('flower', (c, s) => {
      px(c, s, 7, 10, 2, 6, '#3f7a2e');
      px(c, s, 4, 6, 3, 2, '#e0456a');
      px(c, s, 9, 5, 3, 2, '#e0456a');
      px(c, s, 7, 4, 2, 2, '#ffd24a');
      px(c, s, 7, 6, 2, 4, '#e0456a');
    });
    this.reg('tallgrass', (c, s) => {
      const r = rnd(620);
      for (let x = 2; x < s - 2; x++) {
        const h = 5 + Math.floor(r() * 5);
        for (let y = s - h; y < s; y++) px(c, s, x, y, 1, 1, shade('#4a8a35', (r() * 2 - 1) * 0.2));
      }
    });
    this.reg('cactus_top', (c, s) => { noisy(c, s, '#3f7a3a', 630, 0.1, 0.4); px(c, s, 4, 4, 8, 8, '#2f5a2a'); });
    this.reg('cactus_side', (c, s) => { noisy(c, s, '#3f7a3a', 631, 0.1, 0.4); px(c, s, 3, 0, 1, s, '#2f5a2a'); px(c, s, 12, 0, 1, s, '#2f5a2a'); });
    this.reg('pumpkin_top', (c, s) => { noisy(c, s, '#d6801a', 640, 0.1, 0.5); px(c, s, 7, 7, 2, 2, '#8a5a1a'); });
    this.reg('pumpkin_side', (c, s) => {
      noisy(c, s, '#d6801a', 641, 0.1, 0.5);
      for (let y = 0; y < s; y += 4) px(c, s, 0, y, s, 1, shade('#d6801a', -0.2));
    });
    this.reg('pumpkin_front', (c, s) => {
      noisy(c, s, '#d6801a', 642, 0.1, 0.5);
      // jack-o face
      px(c, s, 4, 5, 3, 3, '#2a1a0a');
      px(c, s, 9, 5, 3, 3, '#2a1a0a');
      px(c, s, 3, 10, 10, 1, '#2a1a0a');
      px(c, s, 4, 11, 2, 2, '#2a1a0a');
      px(c, s, 7, 11, 2, 2, '#2a1a0a');
      px(c, s, 10, 11, 2, 2, '#2a1a0a');
    });
    this.reg('bookshelf', (c, s) => {
      noisy(c, s, '#b8945a', 650, 0.1, 0.4);
      px(c, s, 0, 0, s, 2, '#6b4f2a');
      px(c, s, 0, s - 2, s, 2, '#6b4f2a');
      const cols = ['#b3312c', '#41802c', '#2f4ea0', '#d6c23a', '#7a3a8a'];
      for (let x = 0; x < s; x += 2) {
        const col = cols[(x / 2) % cols.length];
        px(c, s, x, 2, 2, 9, col);
        px(c, s, x, 11, 2, 3, col);
      }
    });

    // ---- Item icons ----
    this.reg('stick', (c, s) => {
      for (let y = 4; y < s - 3; y++) {
        const x = Math.round((y - 4) * 0.3) + 5;
        px(c, s, x, y, 2, 1, '#8a5a2a');
      }
    });
    this.reg('coal', (c, s) => { noisy(c, s, '#2b2b2b', 700, 0.12, 0.6); });
    this.reg('iron_ingot', (c, s) => {
      noisy(c, s, '#d8d8d8', 701, 0.08, 0.4);
      px(c, s, 3, 6, 10, 4, '#b8b8b8');
      px(c, s, 3, 6, 10, 1, '#f0f0f0');
    });
    this.reg('gold_ingot', (c, s) => {
      noisy(c, s, '#f4d644', 702, 0.08, 0.4);
      px(c, s, 3, 6, 10, 4, '#e0bf2a');
      px(c, s, 3, 6, 10, 1, '#fff0a0');
    });
    this.reg('gem', (c, s) => {
      noisy(c, s, '#5fe3c0', 703, 0.1, 0.4);
      px(c, s, 6, 3, 4, 2, '#bff7e6');
      px(c, s, 4, 5, 8, 6, '#5fe3c0');
      px(c, s, 6, 11, 4, 2, '#3aa888');
      px(c, s, 5, 4, 2, 1, '#ffffff');
    });
    this.reg('apple', (c, s) => {
      px(c, s, 6, 2, 2, 2, '#5a3a1a');
      px(c, s, 8, 1, 3, 2, '#4a8a35');
      px(c, s, 4, 4, 8, 8, '#d8362a');
      px(c, s, 5, 5, 2, 2, '#f06a5a');
    });
    this.reg('bread', (c, s) => {
      noisy(c, s, '#c98a3a', 710, 0.1, 0.4);
      px(c, s, 3, 6, 10, 5, '#c98a3a');
      px(c, s, 3, 6, 10, 1, '#e0a85a');
      px(c, s, 5, 7, 1, 2, '#8a5a1a');
      px(c, s, 9, 8, 1, 2, '#8a5a1a');
    });
    this.reg('raw_meat', (c, s) => {
      noisy(c, s, '#d8a8a8', 711, 0.1, 0.4);
      px(c, s, 4, 5, 8, 7, '#d8a8a8');
      px(c, s, 6, 4, 4, 1, '#f0d0d0');
      px(c, s, 4, 11, 8, 1, '#b08080');
    });
    this.reg('cooked_meat', (c, s) => {
      noisy(c, s, '#8a5a2a', 712, 0.1, 0.4);
      px(c, s, 4, 5, 8, 7, '#8a5a2a');
      px(c, s, 6, 6, 1, 2, '#5a3a1a');
      px(c, s, 10, 7, 1, 3, '#5a3a1a');
    });

    // Tools: head color by material, handle brown
    const tool = (kind: 'pickaxe' | 'axe' | 'shovel' | 'sword', headColor: string, seed: number) =>
      (c: CanvasRenderingContext2D, s: number) => {
        // handle
        for (let y = 6; y < s - 2; y++) {
          const x = 7;
          px(c, s, x, y, 2, 1, '#8a5a2a');
        }
        if (kind === 'pickaxe') {
          px(c, s, 3, 3, 4, 2, headColor);
          px(c, s, 9, 3, 4, 2, headColor);
          px(c, s, 6, 5, 4, 1, headColor);
        } else if (kind === 'axe') {
          px(c, s, 8, 2, 5, 6, headColor);
          px(c, s, 9, 3, 3, 4, shade(headColor, 0.2));
        } else if (kind === 'shovel') {
          px(c, s, 6, 2, 4, 5, headColor);
          px(c, s, 7, 3, 2, 3, shade(headColor, 0.2));
        } else {
          // sword
          px(c, s, 7, 1, 2, 9, headColor);
          px(c, s, 8, 1, 1, 9, shade(headColor, 0.25));
          px(c, s, 5, 9, 6, 1, '#6b4f2a');
          px(c, s, 7, 10, 2, 3, '#6b4f2a');
        }
      };
    const mats: [string, string][] = [['wood', '#8a5a2a'], ['stone', '#9a9a9a'], ['iron', '#e0e0e0'], ['gem', '#5fe3c0'], ['gold', '#f4d644']];
    let ts = 800;
    for (const [m, col] of mats) {
      this.reg(`${m}_pickaxe`, tool('pickaxe', col, ts++));
      this.reg(`${m}_axe`, tool('axe', col, ts++));
      this.reg(`${m}_shovel`, tool('shovel', col, ts++));
      this.reg(`${m}_sword`, tool('sword', col, ts++));
    }

    // ---- New terrain/decor blocks ----
    this.reg('granite', (c, s) => { noisy(c, s, '#9b6b5a', 900, 0.18, 0.6); });
    this.reg('diorite', (c, s) => { noisy(c, s, '#c4c4c0', 901, 0.14, 0.5); });
    this.reg('andesite', (c, s) => { noisy(c, s, '#8a8a86', 902, 0.14, 0.55); });
    this.reg('polished_granite', (c, s) => { noisy(c, s, '#a67a6a', 903, 0.08, 0.3); });
    this.reg('polished_diorite', (c, s) => { noisy(c, s, '#d4d4d0', 904, 0.06, 0.3); });
    this.reg('polished_andesite', (c, s) => { noisy(c, s, '#9a9a96', 905, 0.06, 0.3); });
    this.reg('deepslate', (c, s) => { noisy(c, s, '#3a3a3e', 906, 0.15, 0.6); });
    this.reg('red_sand', (c, s) => { noisy(c, s, '#c87a3a', 907, 0.1, 0.5); });
    this.reg('red_sandstone_top', (c, s) => { noisy(c, s, '#c87a3a', 908, 0.08, 0.4); });
    this.reg('red_sandstone_side', (c, s) => {
      noisy(c, s, '#b86a2a', 909, 0.08, 0.4);
      px(c, s, 0, 3, s, 1, '#9a5a1a');
      px(c, s, 0, s - 4, s, 1, '#9a5a1a');
    });
    this.reg('red_sandstone_bottom', (c, s) => { noisy(c, s, '#a85a1a', 910, 0.08, 0.4); });
    this.reg('obsidian', (c, s) => {
      noisy(c, s, '#1a1a2e', 911, 0.15, 0.5);
      const r = rnd(911);
      for (let i = 0; i < 4; i++) { px(c, s, Math.floor(r() * s), Math.floor(r() * s), 2, 2, '#4a3a6e'); }
    });
    this.reg('netherrack', (c, s) => { noisy(c, s, '#6e2a2a', 912, 0.2, 0.7); });
    this.reg('lantern', (c, s) => {
      px(c, s, 4, 2, 8, 1, '#4a4a4a');
      px(c, s, 5, 3, 6, 8, '#ffe88a');
      px(c, s, 6, 4, 4, 6, '#ffd24a');
      px(c, s, 5, 11, 6, 2, '#4a4a4a');
      px(c, s, 7, 5, 2, 4, '#fff4a0');
    });
    this.reg('redstone_ore', ore(700, '#ff3a3a'));
    this.reg('copper_ore', ore(701, '#e88a4a'));
    this.reg('copper_block', (c, s) => { noisy(c, s, '#e88a4a', 702, 0.1, 0.4); });
    this.reg('redstone_block', (c, s) => { noisy(c, s, '#ff3a3a', 703, 0.1, 0.4); });
    this.reg('sugar_cane', (c, s) => {
      px(c, s, 6, 0, 4, s, '#a8d87a');
      px(c, s, 7, 2, 2, 2, '#c8e89a');
      px(c, s, 7, 6, 2, 2, '#c8e89a');
      px(c, s, 7, 10, 2, 2, '#c8e89a');
    });
    this.reg('vine', (c, s) => {
      const r = rnd(720);
      for (let x = 0; x < s; x += 2) {
        const h = 6 + Math.floor(r() * 8);
        for (let y = s - h; y < s; y++) px(c, s, x, y, 1, 1, shade('#4a8a35', (r() * 2 - 1) * 0.2));
      }
    });
    this.reg('moss', (c, s) => { noisy(c, s, '#5a7d3a', 721, 0.2, 0.7); });
    this.reg('mushroom', (c, s) => {
      px(c, s, 7, 8, 2, 4, '#e8e8d8');
      px(c, s, 5, 5, 6, 4, '#c43a3a');
      px(c, s, 6, 4, 4, 2, '#c43a3a');
      px(c, s, 7, 6, 2, 1, '#ffffff');
    });
    this.reg('red_flower', (c, s) => {
      px(c, s, 7, 10, 2, 6, '#3f7a2e');
      px(c, s, 4, 6, 3, 2, '#e0456a');
      px(c, s, 9, 5, 3, 2, '#e0456a');
      px(c, s, 7, 4, 2, 2, '#ffd24a');
      px(c, s, 7, 6, 2, 4, '#e0456a');
    });
    this.reg('yellow_flower', (c, s) => {
      px(c, s, 7, 10, 2, 6, '#3f7a2e');
      px(c, s, 4, 6, 3, 2, '#f4d644');
      px(c, s, 9, 5, 3, 2, '#f4d644');
      px(c, s, 7, 4, 2, 4, '#f4d644');
      px(c, s, 7, 6, 2, 2, '#a87a1a');
    });
    this.reg('white_flower', (c, s) => {
      px(c, s, 7, 10, 2, 6, '#3f7a2e');
      px(c, s, 4, 6, 3, 2, '#f8f8f8');
      px(c, s, 9, 5, 3, 2, '#f8f8f8');
      px(c, s, 7, 4, 2, 4, '#f8f8f8');
      px(c, s, 7, 6, 2, 2, '#ffd24a');
    });
    this.reg('blue_flower', (c, s) => {
      px(c, s, 7, 10, 2, 6, '#3f7a2e');
      px(c, s, 4, 6, 3, 2, '#3a6acc');
      px(c, s, 9, 5, 3, 2, '#3a6acc');
      px(c, s, 7, 4, 2, 4, '#3a6acc');
      px(c, s, 7, 6, 2, 2, '#ffffff');
    });
    this.reg('ladder', (c, s) => {
      px(c, s, 2, 0, 2, s, '#8a5a2a');
      px(c, s, 12, 0, 2, s, '#8a5a2a');
      for (let y = 0; y < s; y += 3) px(c, s, 3, y, 9, 1, '#6b4f2a');
    });
    this.reg('fence', (c, s) => {
      px(c, s, 7, 0, 2, s, '#b8945a');
      px(c, s, 3, 3, 10, 1, '#b8945a');
      px(c, s, 3, 8, 10, 1, '#b8945a');
    });
    this.reg('hay_bale', (c, s) => {
      noisy(c, s, '#d4c03a', 730, 0.1, 0.5);
      for (let y = 0; y < s; y += 4) px(c, s, 0, y, s, 1, '#b8a42a');
    });
    this.reg('melon_top', (c, s) => { noisy(c, s, '#5a9a3a', 731, 0.08, 0.4); });
    this.reg('melon_side', (c, s) => {
      noisy(c, s, '#7ab84a', 732, 0.08, 0.4);
      px(c, s, 2, 2, 12, 12, '#5a9a3a');
      px(c, s, 3, 3, 10, 10, '#7ab84a');
    });
    this.reg('red_mushroom', (c, s) => {
      px(c, s, 7, 8, 2, 4, '#e8e8d8');
      px(c, s, 4, 4, 8, 5, '#c43a3a');
      px(c, s, 5, 3, 6, 2, '#c43a3a');
      px(c, s, 6, 5, 2, 1, '#ffffff');
      px(c, s, 9, 6, 2, 1, '#ffffff');
    });
    this.reg('brown_mushroom', (c, s) => {
      px(c, s, 7, 8, 2, 4, '#e8e8d8');
      px(c, s, 4, 4, 8, 5, '#8a6a3a');
      px(c, s, 5, 3, 6, 2, '#8a6a3a');
    });
    // gold tools already registered above
    this.reg('gold_ingot', (c, s) => {
      noisy(c, s, '#f4d644', 740, 0.08, 0.4);
      px(c, s, 3, 6, 10, 4, '#e0bf2a');
      px(c, s, 3, 6, 10, 1, '#fff0a0');
    });
    this.reg('copper_ingot', (c, s) => {
      noisy(c, s, '#e88a4a', 741, 0.08, 0.4);
      px(c, s, 3, 6, 10, 4, '#d87a3a');
      px(c, s, 3, 6, 10, 1, '#f0aa6a');
    });
    this.reg('redstone', (c, s) => { noisy(c, s, '#ff3a3a', 742, 0.12, 0.5); });
    this.reg('bucket', (c, s) => {
      px(c, s, 5, 3, 6, 2, '#b8b8b8');
      px(c, s, 4, 5, 8, 8, '#9a9a9a');
      px(c, s, 5, 6, 6, 6, '#7a7a7a');
    });
    this.reg('water_bucket', (c, s) => {
      px(c, s, 5, 3, 6, 2, '#b8b8b8');
      px(c, s, 4, 5, 8, 8, '#9a9a9a');
      px(c, s, 5, 8, 6, 3, '#2f6fd6');
    });
    this.reg('lava_bucket', (c, s) => {
      px(c, s, 5, 3, 6, 2, '#b8b8b8');
      px(c, s, 4, 5, 8, 8, '#9a9a9a');
      px(c, s, 5, 8, 6, 3, '#e0531a');
    });
    this.reg('string', (c, s) => {
      px(c, s, 7, 2, 2, 12, '#e8e8e8');
      px(c, s, 5, 5, 2, 1, '#e8e8e8');
      px(c, s, 9, 9, 2, 1, '#e8e8e8');
    });
    this.reg('leather', (c, s) => { noisy(c, s, '#8a5a3a', 750, 0.1, 0.4); });
    this.reg('flint', (c, s) => { noisy(c, s, '#3a3a3a', 751, 0.1, 0.5); px(c, s, 6, 5, 4, 6, '#5a5a5a'); });
    this.reg('bow', (c, s) => {
      for (let y = 3; y < 13; y++) { const x = Math.round(Math.sin((y - 3) / 10 * Math.PI) * 3) + 8; px(c, s, x, y, 1, 1, '#6b4f2a'); }
      px(c, s, 5, 3, 1, 10, '#e8e8e8');
    });
    this.reg('arrow', (c, s) => {
      px(c, s, 3, 8, 10, 1, '#8a5a2a');
      px(c, s, 12, 7, 3, 3, '#9a9a9a');
      px(c, s, 3, 7, 2, 3, '#e8e8e8');
    });
    this.reg('shield', (c, s) => {
      px(c, s, 4, 2, 8, 12, '#8a5a2a');
      px(c, s, 5, 3, 6, 10, '#b8945a');
      px(c, s, 7, 4, 2, 8, '#9a9a9a');
    });
    this.reg('fishing_rod', (c, s) => {
      for (let y = 2; y < 14; y++) { const x = Math.round((y - 2) * 0.3) + 6; px(c, s, x, y, 1, 1, '#8a5a2a'); }
      px(c, s, 4, 13, 2, 2, '#e8e8e8');
    });
    this.reg('shears', (c, s) => {
      px(c, s, 5, 2, 2, 6, '#9a9a9a');
      px(c, s, 9, 2, 2, 6, '#9a9a9a');
      px(c, s, 5, 8, 6, 2, '#6a6a6a');
    });
    this.reg('clock', (c, s) => {
      px(c, s, 4, 4, 8, 8, '#ffd24a');
      px(c, s, 5, 5, 6, 6, '#fff4a0');
      px(c, s, 7, 5, 2, 4, '#3a3a3a');
      px(c, s, 7, 7, 3, 2, '#3a3a3a');
    });
    this.reg('compass', (c, s) => {
      px(c, s, 4, 4, 8, 8, '#9a9a9a');
      px(c, s, 5, 5, 6, 6, '#cfcfcf');
      px(c, s, 7, 5, 2, 4, '#c43a3a');
      px(c, s, 7, 9, 2, 2, '#3a3a3a');
    });
    this.reg('map', (c, s) => {
      px(c, s, 2, 2, 12, 12, '#e8d8a0');
      px(c, s, 3, 3, 10, 10, '#f4e8b0');
      px(c, s, 5, 5, 3, 3, '#5a9a3a');
      px(c, s, 9, 8, 3, 3, '#3a6acc');
    });
    this.reg('bed', (c, s) => {
      px(c, s, 2, 4, 12, 8, '#b3312c');
      px(c, s, 3, 5, 10, 6, '#c43a3a');
      px(c, s, 4, 6, 8, 4, '#e0456a');
    });
  }
}
