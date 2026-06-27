import { TextureAtlas } from './textures';
import { BlockId, BlockType, ItemId, ItemType } from './types';

// Block IDs
export const B = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  SANDSTONE: 5,
  GRAVEL: 6,
  CLAY: 7,
  SNOW: 8,
  ICE: 9,
  BEDROCK: 10,
  COBBLESTONE: 11,
  MOSSY_COBBLE: 12,
  BRICK: 13,
  GLASS: 14,
  COAL_ORE: 15,
  IRON_ORE: 16,
  GOLD_ORE: 17,
  GEM_ORE: 18,
  COAL_BLOCK: 19,
  IRON_BLOCK: 20,
  GOLD_BLOCK: 21,
  GEM_BLOCK: 22,
  OAK_LOG: 23,
  OAK_PLANKS: 24,
  OAK_LEAVES: 25,
  PINE_LOG: 26,
  PINE_PLANKS: 27,
  PINE_LEAVES: 28,
  BIRCH_LOG: 29,
  BIRCH_PLANKS: 30,
  BIRCH_LEAVES: 31,
  ACACIA_LOG: 32,
  ACACIA_PLANKS: 33,
  ACACIA_LEAVES: 34,
  WATER: 35,
  LAVA: 36,
  CRAFTING_TABLE: 37,
  FURNACE: 38,
  CHEST: 39,
  TORCH: 40,
  GLOW_CRYSTAL: 41,
  WOOL_WHITE: 42,
  WOOL_RED: 43,
  WOOL_GREEN: 44,
  WOOL_BLUE: 45,
  WOOL_YELLOW: 46,
  WOOL_PURPLE: 47,
  WOOL_ORANGE: 48,
  WOOL_BLACK: 49,
  FLOWER: 50,
  TALLGRASS: 51,
  CACTUS: 52,
  PUMPKIN: 53,
  BOOKSHELF: 54,
  FLOWING_WATER: 55, // alias handled same as water
  // New blocks for variety
  GRANITE: 56,
  DIORITE: 57,
  ANDESITE: 58,
  POLISHED_GRANITE: 59,
  POLISHED_DIORITE: 60,
  POLISHED_ANDESITE: 61,
  DEEPSLATE: 62,
  RED_SAND: 63,
  RED_SANDSTONE: 64,
  OBSIDIAN: 65,
  NETHERRACK: 66,
  LANTERN: 67,
  REDSTONE_ORE: 68,
  COPPER_ORE: 69,
  COPPER_BLOCK: 70,
  REDSTONE_BLOCK: 71,
  BUCKET: 72,
  WATER_BUCKET: 73,
  LAVA_BUCKET: 74,
  SUGAR_CANE: 75,
  VINE: 76,
  MOSS: 77,
  MUSHROOM: 78,
  RED_FLOWER: 79,
  YELLOW_FLOWER: 80,
  WHITE_FLOWER: 81,
  BLUE_FLOWER: 82,
  POTTED_PLANT: 83,
  LADDER: 84,
  FENCE: 85,
  OAK_DOOR: 86,
  IRON_DOOR: 87,
  HAY_BALE: 88,
  MELON: 89,
  RED_MUSHROOM: 90,
  BROWN_MUSHROOM: 91,
} as const;

// Item IDs (non-block items start at 1000)
export const I = {
  STICK: 1001,
  COAL: 1002,
  IRON_INGOT: 1003,
  GOLD_INGOT: 1004,
  GEM: 1005,
  APPLE: 1006,
  BREAD: 1007,
  RAW_MEAT: 1008,
  COOKED_MEAT: 1009,
  WOOD_PICKAXE: 1010,
  WOOD_AXE: 1011,
  WOOD_SHOVEL: 1012,
  WOOD_SWORD: 1013,
  STONE_PICKAXE: 1014,
  STONE_AXE: 1015,
  STONE_SHOVEL: 1016,
  STONE_SWORD: 1017,
  IRON_PICKAXE: 1018,
  IRON_AXE: 1019,
  IRON_SHOVEL: 1020,
  IRON_SWORD: 1021,
  GEM_PICKAXE: 1022,
  GEM_AXE: 1023,
  GEM_SHOVEL: 1024,
  GEM_SWORD: 1025,
  GOLD_PICKAXE: 1026,
  GOLD_AXE: 1027,
  GOLD_SHOVEL: 1028,
  GOLD_SWORD: 1029,
  COPPER_INGOT: 1030,
  REDSTONE: 1031,
  STRING: 1032,
  LEATHER: 1033,
  FLINT: 1034,
  BOW: 1035,
  ARROW: 1036,
  SHIELD: 1037,
  FISHING_ROD: 1038,
  SHEARS: 1039,
  CLOCK: 1040,
  COMPASS_ITEM: 1041,
  MAP: 1042,
  BED: 1043,
} as const;

export class Registry {
  blocks = new Map<BlockId, BlockType>();
  items = new Map<ItemId, ItemType>();
  // map block id -> item id (block-items share display)
  blockToItem = new Map<BlockId, ItemId>();
  itemToBlock = new Map<ItemId, BlockId>();
  atlas: TextureAtlas;

  constructor(atlas: TextureAtlas) {
    this.atlas = atlas;
    this.registerBlocks();
    this.registerItems();
  }

  private t(name: string) {
    return this.atlas.get(name);
  }

  private blk(b: Partial<BlockType> & { id: BlockId; name: string; displayName: string; category: BlockType['category'] }) {
    const full: BlockType = {
      textures: { top: 0, side: 0, bottom: 0 },
      hardness: 1,
      tool: 'none',
      toolTier: 0,
      drops: [],
      solid: true,
      transparent: false,
      liquid: false,
      light: 0,
      render: 'cube',
      opaque: true,
      ...b,
      drops: b.drops ?? [{ item: b.id, min: 1, max: 1 }],
    };
    this.blocks.set(b.id, full);
    this.blockToItem.set(b.id, b.id);
    this.itemToBlock.set(b.id, b.id);
    return full;
  }

  private registerBlocks() {
    const A = this.atlas;
    // helper to set textures by names
    const tex = (top: string, side?: string, bottom?: string) => ({
      top: A.get(top), side: A.get(side ?? top), bottom: A.get(bottom ?? top),
    });

    this.blk({ id: B.AIR, name: 'air', displayName: 'Air', category: 'terrain', textures: tex('stone'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'none', drops: [] });
    this.blk({ id: B.STONE, name: 'stone', displayName: 'Stone', category: 'terrain', textures: tex('stone'), hardness: 1.5, tool: 'pickaxe', toolTier: 1, drops: [{ item: B.COBBLESTONE, min: 1, max: 1 }] });
    this.blk({ id: B.DIRT, name: 'dirt', displayName: 'Dirt', category: 'terrain', textures: tex('dirt'), hardness: 0.5, tool: 'shovel' });
    this.blk({ id: B.GRASS, name: 'grass', displayName: 'Grass Block', category: 'terrain', textures: tex('grass_top', 'grass_side', 'dirt'), hardness: 0.5, tool: 'shovel', drops: [{ item: B.DIRT, min: 1, max: 1 }] });
    this.blk({ id: B.SAND, name: 'sand', displayName: 'Sand', category: 'terrain', textures: tex('sand'), hardness: 0.5, tool: 'shovel' });
    this.blk({ id: B.SANDSTONE, name: 'sandstone', displayName: 'Sandstone', category: 'terrain', textures: tex('sandstone_top', 'sandstone_side', 'sandstone_bottom'), hardness: 1.2, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.GRAVEL, name: 'gravel', displayName: 'Gravel', category: 'terrain', textures: tex('gravel'), hardness: 0.6, tool: 'shovel' });
    this.blk({ id: B.CLAY, name: 'clay', displayName: 'Clay', category: 'terrain', textures: tex('clay'), hardness: 0.6, tool: 'shovel' });
    this.blk({ id: B.SNOW, name: 'snow', displayName: 'Snow Block', category: 'terrain', textures: tex('snow', 'snow_side', 'dirt'), hardness: 0.3, tool: 'shovel' });
    this.blk({ id: B.ICE, name: 'ice', displayName: 'Ice', category: 'terrain', textures: tex('ice'), hardness: 0.5, tool: 'pickaxe', transparent: true, opaque: false });
    this.blk({ id: B.BEDROCK, name: 'bedrock', displayName: 'Bedrock', category: 'terrain', textures: tex('bedrock'), hardness: -1, drops: [] });
    this.blk({ id: B.COBBLESTONE, name: 'cobblestone', displayName: 'Cobblestone', category: 'building', textures: tex('cobblestone'), hardness: 2, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.MOSSY_COBBLE, name: 'mossy_cobble', displayName: 'Mossy Cobblestone', category: 'building', textures: tex('mossy_cobble'), hardness: 2, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.BRICK, name: 'brick', displayName: 'Bricks', category: 'building', textures: tex('brick'), hardness: 2, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.GLASS, name: 'glass', displayName: 'Glass', category: 'building', textures: tex('glass'), hardness: 0.3, solid: true, transparent: true, opaque: false, drops: [] });
    this.blk({ id: B.COAL_ORE, name: 'coal_ore', displayName: 'Coal Ore', category: 'ore', textures: tex('coal_ore'), hardness: 3, tool: 'pickaxe', toolTier: 1, drops: [{ item: I.COAL, min: 1, max: 1 }] });
    this.blk({ id: B.IRON_ORE, name: 'iron_ore', displayName: 'Iron Ore', category: 'ore', textures: tex('iron_ore'), hardness: 3, tool: 'pickaxe', toolTier: 2 });
    this.blk({ id: B.GOLD_ORE, name: 'gold_ore', displayName: 'Gold Ore', category: 'ore', textures: tex('gold_ore'), hardness: 3, tool: 'pickaxe', toolTier: 3 });
    this.blk({ id: B.GEM_ORE, name: 'gem_ore', displayName: 'Gem Ore', category: 'ore', textures: tex('gem_ore'), hardness: 3, tool: 'pickaxe', toolTier: 3, drops: [{ item: I.GEM, min: 1, max: 1 }] });
    this.blk({ id: B.COAL_BLOCK, name: 'coal_block', displayName: 'Block of Coal', category: 'building', textures: tex('coal_block'), hardness: 5, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.IRON_BLOCK, name: 'iron_block', displayName: 'Block of Iron', category: 'building', textures: tex('iron_block'), hardness: 5, tool: 'pickaxe', toolTier: 3 });
    this.blk({ id: B.GOLD_BLOCK, name: 'gold_block', displayName: 'Block of Gold', category: 'building', textures: tex('gold_block'), hardness: 5, tool: 'pickaxe', toolTier: 4 });
    this.blk({ id: B.GEM_BLOCK, name: 'gem_block', displayName: 'Block of Gem', category: 'building', textures: tex('gem_block'), hardness: 5, tool: 'pickaxe', toolTier: 4 });
    // Wood
    const tree = (id: BlockId, name: string, disp: string, logTop: string, logSide: string, planks: string, leaves: string, leafColor: [number, number, number]) => {
      this.blk({ id, name: name + '_log', displayName: disp + ' Log', category: 'wood', textures: tex(logTop, logSide, logTop), hardness: 2, tool: 'axe' });
      this.blk({ id: id + 1, name: name + '_planks', displayName: disp + ' Planks', category: 'wood', textures: tex(planks), hardness: 2, tool: 'axe' });
      this.blk({ id: id + 2, name: name + '_leaves', displayName: disp + ' Leaves', category: 'wood', textures: tex(leaves), hardness: 0.2, transparent: false, opaque: true, color: leafColor, drops: [] });
    };
    tree(B.OAK_LOG, 'oak', 'Oak', 'oak_log_top', 'oak_log_side', 'oak_planks', 'oak_leaves', [0.45, 0.7, 0.3]);
    tree(B.PINE_LOG, 'pine', 'Pine', 'pine_log_top', 'pine_log_side', 'pine_planks', 'pine_leaves', [0.3, 0.55, 0.25]);
    tree(B.BIRCH_LOG, 'birch', 'Birch', 'birch_log_top', 'birch_log_side', 'birch_planks', 'birch_leaves', [0.55, 0.7, 0.4]);
    tree(B.ACACIA_LOG, 'acacia', 'Acacia', 'acacia_log_top', 'acacia_log_side', 'acacia_planks', 'acacia_leaves', [0.55, 0.65, 0.3]);
    this.blk({ id: B.WATER, name: 'water', displayName: 'Water', category: 'liquid', textures: tex('water'), hardness: -1, solid: false, transparent: true, liquid: true, opaque: false, drops: [] });
    this.blk({ id: B.LAVA, name: 'lava', displayName: 'Lava', category: 'liquid', textures: tex('lava'), hardness: -1, solid: false, transparent: true, liquid: true, opaque: false, light: 15, drops: [] });
    // Functional
    this.blk({ id: B.CRAFTING_TABLE, name: 'crafting_table', displayName: 'Crafting Table', category: 'functional', textures: tex('crafting_table_top', 'crafting_table_side', 'oak_planks'), hardness: 2.5, tool: 'axe' });
    this.blk({ id: B.FURNACE, name: 'furnace', displayName: 'Furnace', category: 'functional', textures: tex('furnace_top', 'furnace_side', 'furnace_top'), hardness: 3.5, tool: 'pickaxe', toolTier: 1, drops: [{ item: B.FURNACE, min: 1, max: 1 }] });
    this.blk({ id: B.CHEST, name: 'chest', displayName: 'Chest', category: 'functional', textures: tex('chest_top', 'chest_side', 'chest_top'), hardness: 2.5, tool: 'axe' });
    // Light
    this.blk({ id: B.TORCH, name: 'torch', displayName: 'Torch', category: 'light', textures: tex('torch'), hardness: 0, solid: false, transparent: true, opaque: false, light: 14, render: 'cross' });
    this.blk({ id: B.GLOW_CRYSTAL, name: 'glow_crystal', displayName: 'Glow Crystal', category: 'light', textures: tex('glow_crystal'), hardness: 1, light: 15 });
    // Wool
    const wools: [BlockId, string, string][] = [
      [B.WOOL_WHITE, 'wool_white', 'White Wool'],
      [B.WOOL_RED, 'wool_red', 'Red Wool'],
      [B.WOOL_GREEN, 'wool_green', 'Green Wool'],
      [B.WOOL_BLUE, 'wool_blue', 'Blue Wool'],
      [B.WOOL_YELLOW, 'wool_yellow', 'Yellow Wool'],
      [B.WOOL_PURPLE, 'wool_purple', 'Purple Wool'],
      [B.WOOL_ORANGE, 'wool_orange', 'Orange Wool'],
      [B.WOOL_BLACK, 'wool_black', 'Black Wool'],
    ];
    for (const [id, texName, disp] of wools) this.blk({ id, name: texName, displayName: disp, category: 'decor', textures: tex(texName), hardness: 0.8 });
    // Plants
    this.blk({ id: B.FLOWER, name: 'flower', displayName: 'Flower', category: 'plant', textures: tex('flower'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.FLOWER, min: 1, max: 1 }] });
    this.blk({ id: B.TALLGRASS, name: 'tallgrass', displayName: 'Tall Grass', category: 'plant', textures: tex('tallgrass'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [] });
    this.blk({ id: B.CACTUS, name: 'cactus', displayName: 'Cactus', category: 'plant', textures: tex('cactus_top', 'cactus_side', 'cactus_top'), hardness: 0.4, transparent: false, opaque: true });
    this.blk({ id: B.PUMPKIN, name: 'pumpkin', displayName: 'Pumpkin', category: 'plant', textures: tex('pumpkin_top', 'pumpkin_side', 'pumpkin_top'), hardness: 1, tool: 'axe', drops: [{ item: B.PUMPKIN, min: 1, max: 1 }] });
    this.blk({ id: B.BOOKSHELF, name: 'bookshelf', displayName: 'Bookshelf', category: 'functional', textures: tex('oak_planks', 'bookshelf', 'oak_planks'), hardness: 1.5, tool: 'axe' });
    this.blk({ id: B.FLOWING_WATER, name: 'flowing_water', displayName: 'Water', category: 'liquid', textures: tex('water'), hardness: -1, solid: false, transparent: true, liquid: true, opaque: false, drops: [] });
    // New blocks for variety
    this.blk({ id: B.GRANITE, name: 'granite', displayName: 'Granite', category: 'terrain', textures: tex('granite'), hardness: 1.5, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.DIORITE, name: 'diorite', displayName: 'Diorite', category: 'terrain', textures: tex('diorite'), hardness: 1.5, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.ANDESITE, name: 'andesite', displayName: 'Andesite', category: 'terrain', textures: tex('andesite'), hardness: 1.5, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.POLISHED_GRANITE, name: 'polished_granite', displayName: 'Polished Granite', category: 'building', textures: tex('polished_granite'), hardness: 1.5, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.POLISHED_DIORITE, name: 'polished_diorite', displayName: 'Polished Diorite', category: 'building', textures: tex('polished_diorite'), hardness: 1.5, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.POLISHED_ANDESITE, name: 'polished_andesite', displayName: 'Polished Andesite', category: 'building', textures: tex('polished_andesite'), hardness: 1.5, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.DEEPSLATE, name: 'deepslate', displayName: 'Deepslate', category: 'terrain', textures: tex('deepslate'), hardness: 3, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.RED_SAND, name: 'red_sand', displayName: 'Red Sand', category: 'terrain', textures: tex('red_sand'), hardness: 0.5, tool: 'shovel' });
    this.blk({ id: B.RED_SANDSTONE, name: 'red_sandstone', displayName: 'Red Sandstone', category: 'terrain', textures: tex('red_sandstone_top', 'red_sandstone_side', 'red_sandstone_bottom'), hardness: 1.2, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.OBSIDIAN, name: 'obsidian', displayName: 'Obsidian', category: 'terrain', textures: tex('obsidian'), hardness: 10, tool: 'pickaxe', toolTier: 3 });
    this.blk({ id: B.NETHERRACK, name: 'netherrack', displayName: 'Netherrack', category: 'terrain', textures: tex('netherrack'), hardness: 0.4, tool: 'pickaxe', toolTier: 1 });
    this.blk({ id: B.LANTERN, name: 'lantern', displayName: 'Lantern', category: 'light', textures: tex('lantern'), hardness: 1, light: 15, solid: true });
    this.blk({ id: B.REDSTONE_ORE, name: 'redstone_ore', displayName: 'Redstone Ore', category: 'ore', textures: tex('redstone_ore'), hardness: 3, tool: 'pickaxe', toolTier: 2, drops: [{ item: I.REDSTONE, min: 1, max: 1 }] });
    this.blk({ id: B.COPPER_ORE, name: 'copper_ore', displayName: 'Copper Ore', category: 'ore', textures: tex('copper_ore'), hardness: 3, tool: 'pickaxe', toolTier: 2 });
    this.blk({ id: B.COPPER_BLOCK, name: 'copper_block', displayName: 'Block of Copper', category: 'building', textures: tex('copper_block'), hardness: 5, tool: 'pickaxe', toolTier: 2 });
    this.blk({ id: B.REDSTONE_BLOCK, name: 'redstone_block', displayName: 'Block of Redstone', category: 'building', textures: tex('redstone_block'), hardness: 5, tool: 'pickaxe', toolTier: 2 });
    this.blk({ id: B.SUGAR_CANE, name: 'sugar_cane', displayName: 'Sugar Cane', category: 'plant', textures: tex('sugar_cane'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.SUGAR_CANE, min: 1, max: 1 }] });
    this.blk({ id: B.VINE, name: 'vine', displayName: 'Vines', category: 'plant', textures: tex('vine'), hardness: 0.2, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.VINE, min: 1, max: 1 }] });
    this.blk({ id: B.MOSS, name: 'moss', displayName: 'Moss', category: 'plant', textures: tex('moss'), hardness: 0.2 });
    this.blk({ id: B.MUSHROOM, name: 'mushroom', displayName: 'Mushroom', category: 'plant', textures: tex('mushroom'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.MUSHROOM, min: 1, max: 1 }] });
    this.blk({ id: B.RED_FLOWER, name: 'red_flower', displayName: 'Red Flower', category: 'plant', textures: tex('red_flower'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.RED_FLOWER, min: 1, max: 1 }] });
    this.blk({ id: B.YELLOW_FLOWER, name: 'yellow_flower', displayName: 'Yellow Flower', category: 'plant', textures: tex('yellow_flower'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.YELLOW_FLOWER, min: 1, max: 1 }] });
    this.blk({ id: B.WHITE_FLOWER, name: 'white_flower', displayName: 'White Flower', category: 'plant', textures: tex('white_flower'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.WHITE_FLOWER, min: 1, max: 1 }] });
    this.blk({ id: B.BLUE_FLOWER, name: 'blue_flower', displayName: 'Blue Flower', category: 'plant', textures: tex('blue_flower'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.BLUE_FLOWER, min: 1, max: 1 }] });
    this.blk({ id: B.LADDER, name: 'ladder', displayName: 'Ladder', category: 'functional', textures: tex('ladder'), hardness: 0.4, transparent: true, opaque: false, solid: false });
    this.blk({ id: B.FENCE, name: 'fence', displayName: 'Fence', category: 'building', textures: tex('fence'), hardness: 2, tool: 'axe', transparent: true, opaque: false });
    this.blk({ id: B.OAK_DOOR, name: 'oak_door', displayName: 'Oak Door', category: 'functional', textures: tex('oak_planks'), hardness: 2, tool: 'axe', transparent: true, opaque: false });
    this.blk({ id: B.IRON_DOOR, name: 'iron_door', displayName: 'Iron Door', category: 'functional', textures: tex('iron_block'), hardness: 5, tool: 'pickaxe', toolTier: 2, transparent: true, opaque: false });
    this.blk({ id: B.HAY_BALE, name: 'hay_bale', displayName: 'Hay Bale', category: 'decor', textures: tex('hay_bale'), hardness: 0.5 });
    this.blk({ id: B.MELON, name: 'melon', displayName: 'Melon', category: 'plant', textures: tex('melon_top', 'melon_side', 'melon_top'), hardness: 1, tool: 'axe', drops: [{ item: B.MELON, min: 1, max: 1 }] });
    this.blk({ id: B.RED_MUSHROOM, name: 'red_mushroom', displayName: 'Red Mushroom', category: 'plant', textures: tex('red_mushroom'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.RED_MUSHROOM, min: 1, max: 1 }] });
    this.blk({ id: B.BROWN_MUSHROOM, name: 'brown_mushroom', displayName: 'Brown Mushroom', category: 'plant', textures: tex('brown_mushroom'), hardness: 0, solid: false, transparent: true, opaque: false, render: 'cross', drops: [{ item: B.BROWN_MUSHROOM, min: 1, max: 1 }] });
  }

  private item(id: ItemId, name: string, displayName: string, opts: Partial<ItemType> = {}) {
    const full: ItemType = {
      id, name, displayName, maxStack: 64, category: 'material', ...opts,
    };
    this.items.set(id, full);
    return full;
  }

  private registerItems() {
    const A = this.atlas;
    // block-items: create item entries for all blocks (so inventory has names/icons)
    for (const [blockId, bt] of this.blocks) {
      if (blockId === B.AIR) continue;
      // icon tile = side texture
      this.item(blockId, bt.name, bt.displayName, {
        block: blockId,
        category: 'block',
        iconTile: bt.textures.side,
      });
    }
    // materials
    this.item(I.STICK, 'stick', 'Stick', { iconTile: A.get('stick') });
    this.item(I.COAL, 'coal', 'Coal', { iconTile: A.get('coal') });
    this.item(I.IRON_INGOT, 'iron_ingot', 'Iron Ingot', { iconTile: A.get('iron_ingot') });
    this.item(I.GOLD_INGOT, 'gold_ingot', 'Gold Ingot', { iconTile: A.get('gold_ingot') });
    this.item(I.GEM, 'gem', 'Gem', { iconTile: A.get('gem') });
    // food
    this.item(I.APPLE, 'apple', 'Apple', { category: 'food', food: 4, iconTile: A.get('apple') });
    this.item(I.BREAD, 'bread', 'Bread', { category: 'food', food: 5, iconTile: A.get('bread') });
    this.item(I.RAW_MEAT, 'raw_meat', 'Raw Meat', { category: 'food', food: 3, iconTile: A.get('raw_meat') });
    this.item(I.COOKED_MEAT, 'cooked_meat', 'Cooked Meat', { category: 'food', food: 8, iconTile: A.get('cooked_meat') });
    // tools
    const tiers: [ItemId, ItemId, string, number, number, number][] = [
      [I.WOOD_PICKAXE, I.WOOD_AXE, 'wood', 1, 60, 2, 0],
      [I.STONE_PICKAXE, I.STONE_AXE, 'stone', 2, 130, 4, 1],
      [I.IRON_PICKAXE, I.IRON_AXE, 'iron', 3, 250, 6, 2],
      [I.GEM_PICKAXE, I.GEM_AXE, 'gem', 4, 1500, 8, 3],
      [I.GOLD_PICKAXE, I.GOLD_AXE, 'gold', 3, 32, 12, 2],
    ];
    for (const [pickId, , mat, tier, dur, speed, dmg] of tiers) {
      const names: Record<string, string> = { wood: 'Wood', stone: 'Stone', iron: 'Iron', gem: 'Gem', gold: 'Gold' };
      this.item(pickId, `${mat}_pickaxe`, `${names[mat]} Pickaxe`, { category: 'tool', toolType: 'pickaxe', toolTier: tier, durability: dur, miningSpeed: speed, attackDamage: dmg, maxStack: 1, iconTile: A.get(`${mat}_pickaxe`) });
      this.item(pickId + 1, `${mat}_axe`, `${names[mat]} Axe`, { category: 'tool', toolType: 'axe', toolTier: tier, durability: dur, miningSpeed: speed, attackDamage: dmg + 1, maxStack: 1, iconTile: A.get(`${mat}_axe`) });
      this.item(pickId + 2, `${mat}_shovel`, `${names[mat]} Shovel`, { category: 'tool', toolType: 'shovel', toolTier: tier, durability: dur, miningSpeed: speed, attackDamage: dmg, maxStack: 1, iconTile: A.get(`${mat}_shovel`) });
      this.item(pickId + 3, `${mat}_sword`, `${names[mat]} Sword`, { category: 'tool', toolType: 'sword', toolTier: tier, durability: dur, miningSpeed: 1.5, attackDamage: dmg + 3, maxStack: 1, iconTile: A.get(`${mat}_sword`) });
    }
    // new materials
    this.item(I.COPPER_INGOT, 'copper_ingot', 'Copper Ingot', { iconTile: A.get('copper_ingot') });
    this.item(I.REDSTONE, 'redstone', 'Redstone', { iconTile: A.get('redstone') });
    this.item(I.STRING, 'string', 'String', { iconTile: A.get('string') });
    this.item(I.LEATHER, 'leather', 'Leather', { iconTile: A.get('leather') });
    this.item(I.FLINT, 'flint', 'Flint', { iconTile: A.get('flint') });
    // tools/equipment
    this.item(I.BOW, 'bow', 'Bow', { category: 'tool', maxStack: 1, iconTile: A.get('bow') });
    this.item(I.ARROW, 'arrow', 'Arrow', { iconTile: A.get('arrow') });
    this.item(I.SHIELD, 'shield', 'Shield', { category: 'tool', maxStack: 1, iconTile: A.get('shield') });
    this.item(I.FISHING_ROD, 'fishing_rod', 'Fishing Rod', { category: 'tool', maxStack: 1, iconTile: A.get('fishing_rod') });
    this.item(I.SHEARS, 'shears', 'Shears', { category: 'tool', maxStack: 1, iconTile: A.get('shears') });
    this.item(I.CLOCK, 'clock', 'Clock', { iconTile: A.get('clock') });
    this.item(I.COMPASS_ITEM, 'compass_item', 'Compass', { iconTile: A.get('compass') });
    this.item(I.MAP, 'map', 'Map', { iconTile: A.get('map') });
    this.item(I.BED, 'bed', 'Bed', { category: 'tool', maxStack: 1, iconTile: A.get('bed') });
  }

  getBlock(id: BlockId): BlockType {
    return this.blocks.get(id) ?? this.blocks.get(B.AIR)!;
  }
  getItem(id: ItemId): ItemType | undefined {
    return this.items.get(id);
  }
  isBlockItem(id: ItemId): boolean {
    return this.itemToBlock.has(id);
  }
}
