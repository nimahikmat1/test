// Shared types for the voxel game engine.

export type BlockId = number;
export type ItemId = number;

export interface BlockType {
  id: BlockId;
  name: string; // internal id name
  displayName: string;
  category: 'terrain' | 'ore' | 'wood' | 'liquid' | 'building' | 'light' | 'functional' | 'plant' | 'decor';
  // texture tile indices into atlas for each face.
  textures: { top: number; side: number; bottom: number };
  hardness: number; // seconds to break by hand baseline (0 = instant)
  tool: 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'none';
  toolTier: number; // minimum tier required to drop (0 = hand works)
  drops: { item: ItemId; min: number; max: number }[];
  solid: boolean;
  transparent: boolean; // doesn't fully cull neighbor faces
  liquid: boolean;
  light: number; // 0-15 emitted light
  render: 'cube' | 'cross' | 'none';
  opaque: boolean; // fully blocks light / culls neighbor faces
  color?: [number, number, number]; // optional tint
}

export interface ItemStack {
  item: ItemId;
  count: number;
  durability?: number; // for tools (remaining uses)
}

export interface ItemType {
  id: ItemId;
  name: string;
  displayName: string;
  block?: BlockId;
  maxStack: number;
  category: 'block' | 'tool' | 'food' | 'material';
  toolType?: 'pickaxe' | 'axe' | 'shovel' | 'sword';
  toolTier?: number;
  durability?: number;
  miningSpeed?: number;
  attackDamage?: number;
  food?: number;
  iconTile?: number;
}

export interface Recipe {
  id: string;
  shaped: boolean;
  pattern?: string[];
  key?: Record<string, ItemId>;
  ingredients?: { item: ItemId; count: number }[];
  output: { item: ItemId; count: number };
  requiresTable?: boolean;
}

export interface PlayerState {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  inventory: (ItemStack | null)[];
  selectedHotbar: number;
  onGround: boolean;
}

export interface MobState {
  id: string;
  type: string;
  position: [number, number, number];
  velocity: [number, number, number];
  health: number;
  yaw: number;
}

export interface SaveData {
  formatVersion: number;
  seed: number;
  time: number;
  player: PlayerState;
  modifications: { x: number; y: number; z: number; block: BlockId }[];
  mobs: MobState[];
}
