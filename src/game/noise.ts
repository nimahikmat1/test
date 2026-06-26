// Seeded Perlin noise (2D & 3D) with fractal/octave helpers.
// Deterministic given seed.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise {
  private perm: Uint8Array;
  private permMod12: Uint8Array;
  public seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const rand = mulberry32(this.seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  private static grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  ]);

  private static fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  private static lerp(a: number, b: number, t: number) {
    return a + t * (b - a);
  }
  private static contrib(perm: Uint8Array, hash: number, x: number, y: number) {
    const h = perm[hash] & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }
  private static contrib3(perm: Uint8Array, permMod12: Uint8Array, hash: number, x: number, y: number, z: number) {
    const g = permMod12[hash] * 3;
    const grad = Noise.grad3;
    return x * grad[g] + y * grad[g + 1] + z * grad[g + 2];
  }

  perlin2(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = Noise.fade(x);
    const v = Noise.fade(y);
    const p = this.perm;
    const A = p[X] + Y;
    const B = p[X + 1] + Y;
    return Noise.lerp(
      Noise.lerp(Noise.contrib(p, A, x, y), Noise.contrib(p, B, x - 1, y), u),
      Noise.lerp(Noise.contrib(p, A + 1, x, y - 1), Noise.contrib(p, B + 1, x - 1, y - 1), u),
      v
    );
  }

  perlin3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = Noise.fade(x);
    const v = Noise.fade(y);
    const w = Noise.fade(z);
    const p = this.perm;
    const pm = this.permMod12;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    return Noise.lerp(
      Noise.lerp(
        Noise.lerp(Noise.contrib3(p, pm, AA, x, y, z), Noise.contrib3(p, pm, BA, x - 1, y, z), u),
        Noise.lerp(Noise.contrib3(p, pm, AB, x, y - 1, z), Noise.contrib3(p, pm, BB, x - 1, y - 1, z), u),
        v
      ),
      Noise.lerp(
        Noise.lerp(Noise.contrib3(p, pm, AA + 1, x, y, z - 1), Noise.contrib3(p, pm, BA + 1, x - 1, y, z - 1), u),
        Noise.lerp(Noise.contrib3(p, pm, AB + 1, x, y - 1, z - 1), Noise.contrib3(p, pm, BB + 1, x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  // fractal brownian motion (2D), returns roughly [-1, 1]
  fbm2(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.perlin2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.perlin3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // hash-based pseudo random in [0,1) from int coords (deterministic)
  hash2(x: number, z: number): number {
    let h = (x * 374761393 + z * 668265263) ^ (this.seed * 2147483647);
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) % 100000) / 100000;
  }

  hash3(x: number, y: number, z: number): number {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) ^ (this.seed * 2654435761);
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) % 100000) / 100000;
  }
}
