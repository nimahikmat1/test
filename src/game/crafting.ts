import { ItemId } from './types';
import { I, B } from './blocks';
import { Recipe } from './types';

export const RECIPES: Recipe[] = [
  // logs -> planks (shapeless, 1 log -> 4 planks)
  { id: 'oak_planks', shaped: false, ingredients: [{ item: B.OAK_LOG, count: 1 }], output: { item: B.OAK_PLANKS, count: 4 } },
  { id: 'pine_planks', shaped: false, ingredients: [{ item: B.PINE_LOG, count: 1 }], output: { item: B.PINE_PLANKS, count: 4 } },
  { id: 'birch_planks', shaped: false, ingredients: [{ item: B.BIRCH_LOG, count: 1 }], output: { item: B.BIRCH_PLANKS, count: 4 } },
  { id: 'acacia_planks', shaped: false, ingredients: [{ item: B.ACACIA_LOG, count: 1 }], output: { item: B.ACACIA_PLANKS, count: 4 } },

  // planks -> sticks (2 planks vertical -> 4 sticks)
  { id: 'sticks', shaped: true, pattern: ['P', 'P'], key: { P: B.OAK_PLANKS }, output: { item: I.STICK, count: 4 } },
  { id: 'sticks_pine', shaped: true, pattern: ['P', 'P'], key: { P: B.PINE_PLANKS }, output: { item: I.STICK, count: 4 } },
  { id: 'sticks_birch', shaped: true, pattern: ['P', 'P'], key: { P: B.BIRCH_PLANKS }, output: { item: I.STICK, count: 4 } },
  { id: 'sticks_acacia', shaped: true, pattern: ['P', 'P'], key: { P: B.ACACIA_PLANKS }, output: { item: I.STICK, count: 4 } },

  // crafting table (4 planks 2x2)
  { id: 'crafting_table', shaped: true, pattern: ['PP', 'PP'], key: { P: B.OAK_PLANKS }, output: { item: B.CRAFTING_TABLE, count: 1 } },

  // furnace (8 cobblestone ring)
  { id: 'furnace', shaped: true, pattern: ['CCC', 'C C', 'CCC'], key: { C: B.COBBLESTONE }, output: { item: B.FURNACE, count: 1 }, requiresTable: true },

  // chest (8 planks ring)
  { id: 'chest', shaped: true, pattern: ['PPP', 'P P', 'PPP'], key: { P: B.OAK_PLANKS }, output: { item: B.CHEST, count: 1 }, requiresTable: true },

  // bookshelf
  { id: 'bookshelf', shaped: true, pattern: ['PPP', 'BBB', 'PPP'], key: { P: B.OAK_PLANKS, B: B.OAK_PLANKS }, output: { item: B.BOOKSHELF, count: 1 }, requiresTable: true },

  // torch (coal + stick)
  { id: 'torch', shaped: true, pattern: ['C', 'S'], key: { C: I.COAL, S: I.STICK }, output: { item: B.TORCH, count: 4 } },

  // tools - pickaxe: 3 material top row, stick center, stick bottom center
  // wood
  toolRecipe('wood_pickaxe', B.OAK_PLANKS, I.WOOD_PICKAXE, 'pickaxe'),
  toolRecipe('wood_axe', B.OAK_PLANKS, I.WOOD_AXE, 'axe'),
  toolRecipe('wood_shovel', B.OAK_PLANKS, I.WOOD_SHOVEL, 'shovel'),
  toolRecipe('wood_sword', B.OAK_PLANKS, I.WOOD_SWORD, 'sword'),
  // stone
  toolRecipe('stone_pickaxe', B.COBBLESTONE, I.STONE_PICKAXE, 'pickaxe'),
  toolRecipe('stone_axe', B.COBBLESTONE, I.STONE_AXE, 'axe'),
  toolRecipe('stone_shovel', B.COBBLESTONE, I.STONE_SHOVEL, 'shovel'),
  toolRecipe('stone_sword', B.COBBLESTONE, I.STONE_SWORD, 'sword'),
  // iron
  toolRecipe('iron_pickaxe', I.IRON_INGOT, I.IRON_PICKAXE, 'pickaxe'),
  toolRecipe('iron_axe', I.IRON_INGOT, I.IRON_AXE, 'axe'),
  toolRecipe('iron_shovel', I.IRON_INGOT, I.IRON_SHOVEL, 'shovel'),
  toolRecipe('iron_sword', I.IRON_INGOT, I.IRON_SWORD, 'sword'),
  // gem
  toolRecipe('gem_pickaxe', I.GEM, I.GEM_PICKAXE, 'pickaxe'),
  toolRecipe('gem_axe', I.GEM, I.GEM_AXE, 'axe'),
  toolRecipe('gem_shovel', I.GEM, I.GEM_SHOVEL, 'shovel'),
  toolRecipe('gem_sword', I.GEM, I.GEM_SWORD, 'sword'),

  // bread (3 wheat... we don't have wheat; use apple -> bread? skip; make planks->stick covered)
  // glass from sand is furnace. sandstone: 4 sand -> 1 sandstone (shapeless-ish 2x2)
  { id: 'sandstone', shaped: true, pattern: ['SS', 'SS'], key: { S: B.SAND }, output: { item: B.SANDSTONE, count: 1 } },
  // cobble -> stone (furnace), etc.
  // wool block from nothing... skip dye.
  // gem block
  { id: 'gem_block', shaped: true, pattern: ['GG', 'GG'], key: { G: I.GEM }, output: { item: B.GEM_BLOCK, count: 1 }, requiresTable: true },
  { id: 'iron_block', shaped: true, pattern: ['II', 'II', 'II'], key: { I: I.IRON_INGOT }, output: { item: B.IRON_BLOCK, count: 1 }, requiresTable: true },
  { id: 'gold_block', shaped: true, pattern: ['GG', 'GG', 'GG'], key: { G: I.GOLD_INGOT }, output: { item: B.GOLD_BLOCK, count: 1 }, requiresTable: true },
  { id: 'coal_block', shaped: true, pattern: ['CC', 'CC', 'CC'], key: { C: I.COAL }, output: { item: B.COAL_BLOCK, count: 1 }, requiresTable: true },
  // mossy cobble (cobble + leaves)
  { id: 'mossy_cobble', shaped: true, pattern: ['CL', 'LC'], key: { C: B.COBBLESTONE, L: B.OAK_LEAVES }, output: { item: B.MOSSY_COBBLE, count: 1 } },
  // brick from clay? we don't smelt clay to brick item; skip. bricks block from... use 4 clay -> bricks
  { id: 'bricks', shaped: true, pattern: ['CC', 'CC'], key: { C: B.CLAY }, output: { item: B.BRICK, count: 1 }, requiresTable: true },
];

function toolRecipe(id: string, material: ItemId, output: ItemId, kind: 'pickaxe' | 'axe' | 'shovel' | 'sword'): Recipe {
  let pattern: string[];
  let key: Record<string, ItemId>;
  if (kind === 'pickaxe') { pattern = ['MMM', ' S ', ' S ']; key = { M: material, S: I.STICK }; }
  else if (kind === 'axe') { pattern = ['MM', 'MS', ' S']; key = { M: material, S: I.STICK }; }
  else if (kind === 'shovel') { pattern = ['M', 'S', 'S']; key = { M: material, S: I.STICK }; }
  else { pattern = ['M', 'M', 'S']; key = { M: material, S: I.STICK }; }
  return { id, shaped: true, pattern, key, output: { item: output, count: 1 }, requiresTable: true };
}

// Furnace smelting recipes: input -> output
export const FURNACE_RECIPES: { input: ItemId; output: ItemId; time: number }[] = [
  { input: B.IRON_ORE, output: I.IRON_INGOT, time: 10 },
  { input: B.GOLD_ORE, output: I.GOLD_INGOT, time: 10 },
  { input: B.GEM_ORE, output: I.GEM, time: 12 },
  { input: I.RAW_MEAT, output: I.COOKED_MEAT, time: 6 },
  { input: B.SAND, output: B.GLASS, time: 8 },
  { input: B.COBBLESTONE, output: B.STONE, time: 10 },
  { input: B.CLAY, output: B.BRICK, time: 8 },
  { input: B.OAK_LOG, output: I.COAL, time: 12 }, // charcoal
];

// Fuels: item -> burn time (seconds of smelting; 1 smelt = 10s baseline)
export const FUELS: { item: ItemId; burn: number }[] = [
  { item: B.OAK_PLANKS, burn: 15 },
  { item: B.PINE_PLANKS, burn: 15 },
  { item: B.BIRCH_PLANKS, burn: 15 },
  { item: B.ACACIA_PLANKS, burn: 15 },
  { item: B.OAK_LOG, burn: 60 },
  { item: B.PINE_LOG, burn: 60 },
  { item: B.BIRCH_LOG, burn: 60 },
  { item: B.ACACIA_LOG, burn: 60 },
  { item: I.STICK, burn: 5 },
  { item: I.COAL, burn: 80 },
  { item: B.COAL_BLOCK, burn: 800 },
  { item: B.WOOL_WHITE, burn: 5 },
];

export function fuelBurn(item: ItemId): number {
  for (const f of FUELS) if (f.item === item) return f.burn;
  return 0;
}

export function furnaceOutput(item: ItemId): { output: ItemId; time: number } | null {
  for (const r of FURNACE_RECIPES) if (r.input === item) return { output: r.output, time: r.time };
  return null;
}

// Match a crafting grid (array of ItemStack|null, row-major, width x height) against recipes.
// gridItems: flat array length w*h (null for empty). w,h are 2 or 3.
export function matchRecipe(grid: (ItemId | null)[], w: number, h: number, hasTable: boolean): { item: ItemId; count: number } | null {
  // trim empty rows/cols to get the actual pattern bounding box
  let minR = h, maxR = -1, minC = w, maxC = -1;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (grid[r * w + c] != null) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  if (maxR < 0) return null; // empty grid
  const ph = maxR - minR + 1;
  const pw = maxC - minC + 1;
  const trimmed: (ItemId | null)[] = [];
  for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
    trimmed.push(grid[r * w + c]);
  }

  for (const recipe of RECIPES) {
    if (recipe.shaped) {
      if (!recipe.pattern || !recipe.key) continue;
      const rh = recipe.pattern.length;
      const rw = recipe.pattern[0].length;
      if (rw !== pw || rh !== ph) continue;
      let ok = true;
      for (let r = 0; r < rh && ok; r++) {
        for (let c = 0; c < rw && ok; c++) {
          const ch = recipe.pattern[r][c];
          const want = ch === ' ' ? null : (recipe.key[ch] ?? null);
          const got = trimmed[r * rw + c] ?? null;
          if (want !== got) ok = false;
        }
      }
      if (ok) {
        if (recipe.requiresTable && !hasTable) continue;
        return recipe.output;
      }
    } else {
      if (!recipe.ingredients) continue;
      // shapeless: multiset match
      const need = new Map<ItemId, number>();
      for (const ing of recipe.ingredients) need.set(ing.item, (need.get(ing.item) ?? 0) + ing.count);
      const have = new Map<ItemId, number>();
      for (const it of trimmed) if (it != null) have.set(it, (have.get(it) ?? 0) + 1);
      if (need.size !== have.size) continue;
      let ok = true;
      for (const [k, v] of need) if (have.get(k) !== v) { ok = false; break; }
      if (ok) {
        if (recipe.requiresTable && !hasTable) continue;
        return recipe.output;
      }
    }
  }
  return null;
}
