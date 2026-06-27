import { SaveData, PlayerState, MobState, BlockId } from './types';
import { World } from './world';
import { Player } from './player';
import { Mob, MobKind } from './mobs';
import { Inventory } from './inventory';

export const SAVE_VERSION = 1;

export function buildSaveData(seed: number, time: number, player: Player, world: World, inv: Inventory, mobs: Mob[], selectedHotbar: number): SaveData {
  const ps: PlayerState = {
    position: [player.pos.x, player.pos.y, player.pos.z],
    yaw: player.yaw,
    pitch: player.pitch,
    health: player.health,
    hunger: player.hunger,
    inventory: inv.serialize(),
    selectedHotbar,
    onGround: player.onGround,
  };
  return {
    formatVersion: SAVE_VERSION,
    seed,
    time,
    player: ps,
    modifications: world.exportMods(),
    mobs: mobs.filter((m) => m.alive).map((m) => m.serialize()),
  };
}

// Local storage autosave key
const AUTOSAVE_KEY = 'voxel_save_autosave';

export function saveToLocal(data: SaveData) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Autosave failed', e);
  }
}

export function loadFromLocal(): SaveData | null {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch (e) {
    console.warn('Load failed', e);
    return null;
  }
}

export function clearLocal() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
}

export function downloadSave(data: SaveData) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voxelworld_${data.seed}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// migration: ensure forward compatibility
export function migrate(data: any): SaveData {
  let v = data.formatVersion ?? 0;
  // future migrations would go here based on v
  if (v < 1) {
    v = 1;
    data.formatVersion = 1;
  }
  data.formatVersion = SAVE_VERSION;
  return data as SaveData;
}
