import * as THREE from 'three';
import { TextureAtlas } from './textures';
import { Registry, B, I } from './blocks';
import { World } from './world';
import { Player, InputState } from './player';
import { Inventory } from './inventory';
import { Mob, MobKind, MOB_DEFS, Projectile, spawnMob } from './mobs';
import { matchRecipe, furnaceOutput, fuelBurn } from './crafting';
import { buildSaveData, migrate, saveToLocal, loadFromLocal, downloadSave, SAVE_VERSION } from './save';
import { Biome, BiomeName } from './worldgen';
import { ItemStack, ItemId, SaveData } from './types';
import { CHUNK_SIZE } from './chunk';

export interface EngineSnapshot {
  health: number; maxHealth: number;
  hunger: number; maxHunger: number;
  hotbar: (ItemStack | null)[];
  selected: number;
  fps: number;
  timeOfDay: number; // 0..1
  dayLength: number;
  biome: string;
  paused: boolean;
  inventoryOpen: boolean;
  craftSize: number;
  craftGrid: (ItemStack | null)[];
  craftOutput: ItemStack | null;
  held: ItemStack | null;
  inventory: (ItemStack | null)[];
  furnaceOpen: boolean;
  furnace: { input: ItemStack | null; fuel: ItemStack | null; output: ItemStack | null; burn: number; progress: number; maxProgress: number };
  fly: boolean;
  targetBlock: string | null;
  miningProgress: number;
  loadedChunks: number;
  mobCount: number;
  message: string | null;
}

export class VoxelEngine {
  container!: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  ambient!: THREE.AmbientLight;
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;

  atlas!: TextureAtlas;
  reg!: Registry;
  world!: World;
  player!: Player;
  inv!: Inventory;

  mobs: Mob[] = [];
  projectiles: Projectile[] = [];
  particles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  seed = 0;
  time = 0; // seconds since start of day cycle (wraps dayLength)
  dayLength = 600; // 10 minutes default
  renderDistance = 6;

  paused = false;
  inventoryOpen = false;
  craftSize = 2;
  craftGrid: (ItemStack | null)[] = [null, null, null, null];
  craftOutput: ItemStack | null = null;
  furnaceOpen = false;
  furnacePos: [number, number, number] = [0, 0, 0];
  furnace = { input: null as ItemStack | null, fuel: null as ItemStack | null, output: null as ItemStack | null, burn: 0, progress: 0, maxProgress: 10 };
  held: ItemStack | null = null;

  selected = 0;
  input: InputState = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };
  keys = new Set<string>();
  pointerLocked = false;

  target: { x: number; y: number; z: number; nx: number; ny: number; nz: number; block: number } | null = null;
  mining: { x: number; y: number; z: number; progress: number } | null = null;
  selectionMesh!: THREE.LineSegments;
  breakMesh!: THREE.Mesh;
  placeFlash: { x: number; y: number; z: number; t: number } | null = null;

  lastTime = 0;
  fps = 60;
  fpsAccum = 0;
  fpsFrames = 0;
  mobSpawnTimer = 0;
  autosaveTimer = 0;
  message: string | null = null;
  messageTimer = 0;

  raf = 0;
  disposed = false;
  audioCtx: AudioContext | null = null;

  onState: (s: EngineSnapshot) => void = () => {};
  private dirty = true;

  init(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x88bbff);
    this.scene.fog = new THREE.Fog(0x88bbff, this.renderDistance * CHUNK_SIZE * 0.6, this.renderDistance * CHUNK_SIZE);

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.05, 1000);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x554433, 0.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2cc, 0.9);
    this.sun.position.set(50, 100, 30);
    this.scene.add(this.sun);

    this.atlas = new TextureAtlas();
    this.reg = new Registry(this.atlas);
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.world = new World(this.seed, this.reg);
    this.scene.add(this.world.group);
    this.player = new Player(this.reg);
    this.inv = new Inventory(this.reg, 36);

    // selection + break overlay
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(box);
    this.selectionMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    this.selectionMesh.visible = false;
    this.scene.add(this.selectionMesh);
    const breakMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    this.breakMesh = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), breakMat);
    this.breakMesh.visible = false;
    this.scene.add(this.breakMesh);

    // starter items
    this.giveStarterItems();

    // spawn player on land (search spiral for non-ocean, above sea level)
    this.spawnOnLand();
    // ensure initial chunks
    this.world.update(this.player.pos.x, this.player.pos.z, this.renderDistance);
    for (let i = 0; i < 60; i++) this.world.updateMeshes(6);

    this.bindEvents();
    window.addEventListener('resize', this.onResize);
    if (typeof window !== 'undefined') (window as any).__engine = this;
  }

  private spawnOnLand() {
    const sea = 40;
    for (let r = 0; r < 200; r += 2) {
      for (let a = 0; a < Math.max(8, r * 6); a++) {
        const ang = (a / Math.max(8, r * 6)) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r);
        const z = Math.round(Math.sin(ang) * r);
        const col = this.world.gen.column(x, z);
        if (col.biome === 0 /* OCEAN */) continue; // skip ocean
        const top = this.world.topSolid(x, z);
        if (top >= sea) {
          this.player.pos.set(x + 0.5, top + 1, z + 0.5);
          this.player.fallStart = top + 1;
          this.player.vel.set(0, 0, 0);
          return;
        }
      }
    }
    // fallback
    this.player.spawn(this.world, 0, 0);
  }

  private giveStarterItems() {
    // give a wood pickaxe and a few torches to start exploring
    this.inv.add({ item: I.WOOD_PICKAXE, count: 1, durability: 60 });
    this.inv.add({ item: B.OAK_PLANKS, count: 16 });
    this.inv.add({ item: B.TORCH, count: 16 });
    this.inv.add({ item: I.APPLE, count: 5 });
    this.inv.add({ item: B.CRAFTING_TABLE, count: 1 });
  }

  // ----------------- new game / load -----------------
  newGame(seed?: number) {
    this.seed = seed ?? ((Math.random() * 2 ** 31) | 0);
    this.world = new World(this.seed, this.reg);
    this.scene.remove(this.world.group);
    this.scene.add(this.world.group);
    this.player = new Player(this.reg);
    this.inv = new Inventory(this.reg, 36);
    this.clearMobs();
    this.giveStarterItems();
    this.spawnOnLand();
    this.world.update(this.player.pos.x, this.player.pos.z, this.renderDistance);
    for (let i = 0; i < 60; i++) this.world.updateMeshes(6);
    this.time = 0;
    this.markDirty();
    this.setMessage('New world created. Seed: ' + this.seed);
  }

  loadGame(data: SaveData) {
    data = migrate(data);
    this.seed = data.seed;
    this.time = data.time;
    this.world = new World(this.seed, this.reg);
    this.scene.remove(this.world.group);
    this.scene.add(this.world.group);
    this.world.applyMods(data.modifications);
    this.player = new Player(this.reg);
    this.inv = new Inventory(this.reg, 36);
    if (data.player.inventory) this.inv.load(data.player.inventory);
    this.player.pos.set(data.player.position[0], data.player.position[1], data.player.position[2]);
    this.player.yaw = data.player.yaw;
    this.player.pitch = data.player.pitch;
    this.player.health = data.player.health;
    this.player.hunger = data.player.hunger;
    this.selected = data.player.selectedHotbar ?? 0;
    this.clearMobs();
    // restore mobs
    for (const ms of data.mobs) {
      const m = spawnMob(ms.type as MobKind, this.reg, this.scene, ms.position[0], ms.position[1], ms.position[2], ms.id);
      m.health = ms.health;
      m.yaw = ms.yaw;
      this.mobs.push(m);
    }
    this.world.update(this.player.pos.x, this.player.pos.z, this.renderDistance);
    for (let i = 0; i < 40; i++) this.world.updateMeshes(6);
    this.markDirty();
    this.setMessage('World loaded.');
  }

  autosave() {
    const data = buildSaveData(this.seed, this.time, this.player, this.world, this.inv, this.mobs, this.selected);
    saveToLocal(data);
  }
  exportSave() {
    const data = buildSaveData(this.seed, this.time, this.player, this.world, this.inv, this.mobs, this.selected);
    downloadSave(data);
    this.setMessage('Save exported.');
  }
  importSave(data: SaveData) {
    this.loadGame(data);
  }
  loadAutosaveIfExists(): boolean {
    const data = loadFromLocal();
    if (data) { this.loadGame(data); return true; }
    return false;
  }

  // ----------------- events -----------------
  private bindEvents() {
    const dom = this.renderer.domElement;
    dom.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('contextmenu', this.onContext);
  }

  private onContext = (e: Event) => {
    if (this.pointerLocked) e.preventDefault();
  };

  private onCanvasClick = () => {
    if (!this.pointerLocked && !this.inventoryOpen && !this.paused) {
      this.renderer.domElement.requestPointerLock();
    }
  };
  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    this.markDirty();
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    const sens = 0.0022;
    this.player.yaw -= e.movementX * sens;
    this.player.pitch -= e.movementY * sens;
    const lim = Math.PI / 2 - 0.01;
    this.player.pitch = Math.max(-lim, Math.min(lim, this.player.pitch));
  };
  private mouseDown = { left: false, right: false };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    if (e.button === 0) { this.mouseDown.left = true; this.startMining(); }
    if (e.button === 2) { this.mouseDown.right = true; this.useItem(); }
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) { this.mouseDown.left = false; this.mining = null; this.breakMesh.visible = false; }
    if (e.button === 2) this.mouseDown.right = false;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.inventoryOpen || this.paused) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    this.selected = (this.selected + dir + 9) % 9;
    this.markDirty();
  };
  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (code === 'KeyE') {
      e.preventDefault();
      this.toggleInventory();
      return;
    }
    if (code === 'Escape') {
      if (this.inventoryOpen) { this.closeInventory(); }
      else { this.togglePause(); }
      return;
    }
    if (this.paused || this.inventoryOpen) return;
    if (code.startsWith('Digit')) {
      const n = parseInt(code.slice(5));
      if (n >= 1 && n <= 9) { this.selected = n - 1; this.markDirty(); return; }
    }
    if (code === 'KeyF') { this.player.flying = !this.player.flying; this.setMessage(this.player.flying ? 'Fly ON' : 'Fly OFF'); this.markDirty(); return; }
    this.keys.add(code);
    this.updateInput();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    this.updateInput();
  };
  private updateInput() {
    this.input.forward = this.keys.has('KeyW');
    this.input.back = this.keys.has('KeyS');
    this.input.left = this.keys.has('KeyA');
    this.input.right = this.keys.has('KeyD');
    this.input.jump = this.keys.has('Space');
    this.input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.input.crouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
  }

  private onResize = () => {
    const c = this.container;
    this.renderer.setSize(c.clientWidth, c.clientHeight);
    this.camera.aspect = c.clientWidth / c.clientHeight;
    this.camera.updateProjectionMatrix();
  };

  // ----------------- inventory / crafting UI -----------------
  toggleInventory() {
    if (this.furnaceOpen) { this.closeFurnace(); return; }
    if (this.inventoryOpen) { this.closeInventory(); return; }
    this.inventoryOpen = true;
    this.craftSize = 2;
    this.craftGrid = new Array(4).fill(null);
    this.recomputeCraft();
    if (this.pointerLocked) document.exitPointerLock();
    this.markDirty();
  }
  closeInventory() {
    // return held + crafting grid items to inventory
    if (this.held) { this.inv.add(this.held); this.held = null; }
    for (let i = 0; i < this.craftGrid.length; i++) {
      if (this.craftGrid[i]) { this.inv.add(this.craftGrid[i]!); this.craftGrid[i] = null; }
    }
    this.craftOutput = null;
    this.inventoryOpen = false;
    this.markDirty();
  }
  openCraftingTable() {
    this.inventoryOpen = true;
    this.craftSize = 3;
    this.craftGrid = new Array(9).fill(null);
    this.recomputeCraft();
    if (this.pointerLocked) document.exitPointerLock();
    this.markDirty();
  }
  openFurnace(x: number, y: number, z: number) {
    this.furnaceOpen = true;
    this.furnacePos = [x, y, z];
    this.furnace = { input: null, fuel: null, output: null, burn: 0, progress: 0, maxProgress: 10 };
    this.inventoryOpen = true;
    if (this.pointerLocked) document.exitPointerLock();
    this.markDirty();
  }
  closeFurnace() {
    // return items
    if (this.held) { this.inv.add(this.held); this.held = null; }
    if (this.furnace.input) { this.inv.add(this.furnace.input); this.furnace.input = null; }
    if (this.furnace.fuel) { this.inv.add(this.furnace.fuel); this.furnace.fuel = null; }
    if (this.furnace.output) { this.inv.add(this.furnace.output); this.furnace.output = null; }
    this.furnaceOpen = false;
    this.inventoryOpen = false;
    this.markDirty();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) { if (this.pointerLocked) document.exitPointerLock(); }
    this.markDirty();
  }

  private recomputeCraft() {
    const ids: (ItemId | null)[] = this.craftGrid.map((s) => (s ? s.item : null));
    const out = matchRecipe(ids, this.craftSize, this.craftSize, this.craftSize === 3);
    this.craftOutput = out ? { item: out.item, count: out.count } : null;
    this.markDirty();
  }

  // slot id scheme: 0..35 inventory; 100..(100+craftSize^2-1) craft; 200 output; 300 furnace input; 301 fuel; 302 furnace output
  private getSlot(id: number): ItemStack | null {
    if (id >= 0 && id < 36) return this.inv.slots[id] ?? null;
    if (id >= 100 && id < 100 + this.craftGrid.length) return this.craftGrid[id - 100] ?? null;
    if (id === 200) return this.craftOutput;
    if (this.furnaceOpen) {
      if (id === 300) return this.furnace.input;
      if (id === 301) return this.furnace.fuel;
      if (id === 302) return this.furnace.output;
    }
    return null;
  }
  private setSlot(id: number, val: ItemStack | null) {
    if (id >= 0 && id < 36) { this.inv.slots[id] = val; return; }
    if (id >= 100 && id < 100 + this.craftGrid.length) { this.craftGrid[id - 100] = val; return; }
    if (id === 200) { this.craftOutput = val; return; }
    if (this.furnaceOpen) {
      if (id === 300) { this.furnace.input = val; return; }
      if (id === 301) { this.furnace.fuel = val; return; }
      if (id === 302) { this.furnace.output = val; return; }
    }
  }
  private isOutput(id: number): boolean { return id === 200; }

  clickSlot(id: number, button: number) {
    if (!this.inventoryOpen) return;
    const cur = this.getSlot(id);
    const held = this.held;
    const itemDef = (it: ItemStack | null) => (it ? this.reg.getItem(it.item) : null);
    const maxStack = (it: ItemStack | null) => itemDef(it)?.maxStack ?? 64;
    const sameKind = (a: ItemStack | null, b: ItemStack | null) => !!a && !!b && a.item === b.item && (a.durability ?? 0) === (b.durability ?? 0);

    if (this.isOutput(id)) {
      // crafting output: left click takes output into held, consuming one of each ingredient
      if (button !== 0) return;
      if (!this.craftOutput) return;
      if (held) {
        if (!sameKind(held, this.craftOutput) || held.count + this.craftOutput.count > maxStack(held)) return;
        held.count += this.craftOutput.count;
      } else {
        this.held = { ...this.craftOutput };
      }
      for (let i = 0; i < this.craftGrid.length; i++) {
        const s = this.craftGrid[i];
        if (s) { s.count -= 1; if (s.count <= 0) this.craftGrid[i] = null; }
      }
      this.recomputeCraft();
      this.markDirty();
      return;
    }

    if (button === 0) {
      // left click
      if (held && cur && sameKind(held, cur) && cur.count + held.count <= maxStack(cur)) {
        cur.count += held.count;
        this.held = null;
      } else {
        // swap
        this.setSlot(id, held ? { ...held } : null);
        this.held = cur ? { ...cur } : null;
      }
    } else if (button === 2) {
      // right click: place one / split half
      if (held) {
        if (!cur) {
          this.setSlot(id, { item: held.item, count: 1, durability: held.durability });
          held.count -= 1;
          if (held.count <= 0) this.held = null;
        } else if (sameKind(held, cur) && cur.count < maxStack(cur)) {
          cur.count += 1;
          held.count -= 1;
          if (held.count <= 0) this.held = null;
        }
      } else if (cur) {
        const half = Math.ceil(cur.count / 2);
        this.held = { item: cur.item, count: half, durability: cur.durability };
        cur.count -= half;
        if (cur.count <= 0) this.setSlot(id, null);
      }
    }
    // recompute crafting if a craft-grid slot changed
    if (id >= 100 && id < 100 + this.craftGrid.length) this.recomputeCraft();
    this.markDirty();
  }

  // ----------------- mining / placement -----------------
  private startMining() {
    if (!this.target) { this.mining = null; return; }
    this.mining = { x: this.target.x, y: this.target.y, z: this.target.z, progress: 0 };
  }

  private miningSpeed(blockId: number): number {
    const bt = this.reg.getBlock(blockId);
    if (bt.hardness < 0) return 0; // unbreakable (bedrock)
    const stack = this.inv.hotbar(this.selected);
    let speed = 1;
    let correctTool = false;
    if (stack) {
      const item = this.reg.getItem(stack.item);
      if (item?.toolType) {
        if (item.toolType === bt.tool) { correctTool = true; speed = item.miningSpeed ?? 1; }
      }
    }
    // base time = hardness * factor; if wrong tool for required-tier blocks, much slower and no drop later
    const tierOk = stack ? (this.reg.getItem(stack.item)?.toolTier ?? 0) >= bt.toolTier : bt.toolTier === 0;
    let time = bt.hardness * 1.5;
    if (correctTool) time /= speed;
    else if (bt.tool !== 'none' && bt.toolTier > 0) time *= 5; // wrong tool penalty
    if (!tierOk) time *= 3;
    return 1 / Math.max(0.05, time);
  }

  private updateMining(dt: number) {
    if (!this.mouseDown.left) { this.mining = null; this.breakMesh.visible = false; return; }
    if (!this.target) { this.mining = null; this.breakMesh.visible = false; return; }
    if (!this.mining || this.mining.x !== this.target.x || this.mining.y !== this.target.y || this.mining.z !== this.target.z) {
      this.mining = { x: this.target.x, y: this.target.y, z: this.target.z, progress: 0 };
    }
    const speed = this.miningSpeed(this.target.block);
    if (speed <= 0) { this.mining = null; this.breakMesh.visible = false; return; }
    this.mining.progress += speed * dt;
    // break overlay
    this.breakMesh.visible = true;
    this.breakMesh.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    (this.breakMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.6, this.mining.progress * 0.6);
    if (this.mining.progress >= 1) {
      this.breakBlock(this.target.x, this.target.y, this.target.z);
      this.mining = null;
      this.breakMesh.visible = false;
    }
  }

  private breakBlock(x: number, y: number, z: number) {
    const b = this.world.getBlock(x, y, z);
    const bt = this.reg.getBlock(b);
    if (b === B.AIR || bt.hardness < 0) return;
    // tool tier check for drops
    const stack = this.inv.hotbar(this.selected);
    const tier = stack ? (this.reg.getItem(stack.item)?.toolTier ?? 0) : 0;
    const tierOk = tier >= bt.toolTier;
    this.world.setBlock(x, y, z, B.AIR);
    this.spawnBreakParticles(x, y, z, bt.textures.side);
    this.playSound('break', bt.category);
    if (tierOk) {
      for (const drop of bt.drops) {
        const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
        if (count > 0) this.inv.add({ item: drop.item, count });
      }
    }
    // tool durability
    if (stack && this.reg.getItem(stack.item)?.toolType) {
      this.useToolDurability(this.selected);
    }
    this.markDirty();
  }

  private useToolDurability(slot: number) {
    const s = this.inv.slots[slot];
    if (!s) return;
    const item = this.reg.getItem(s.item);
    if (!item?.durability) return;
    s.durability = (s.durability ?? item.durability) - 1;
    if ((s.durability ?? 0) <= 0) {
      this.inv.slots[slot] = null;
      this.playSound('break', 'wood');
    }
  }

  private useItem() {
    const stack = this.inv.hotbar(this.selected);
    if (!stack) return;
    const item = this.reg.getItem(stack.item);
    if (!item) return;
    // food
    if (item.category === 'food' && this.player.health < this.player.maxHealth || (item.food && this.player.hunger < this.player.maxHunger)) {
      if (item.food) {
        this.player.feed(item.food);
        this.inv.consumeOne(this.selected);
        this.playSound('eat', 'food');
        this.markDirty();
        return;
      }
    }
    // block placement
    if (item.block !== undefined) {
      const b = item.block;
      // if functional block and right-click on same type, open its UI instead
      if (this.target) {
        const tb = this.world.getBlock(this.target.x, this.target.y, this.target.z);
        if (tb === B.CRAFTING_TABLE && b === B.CRAFTING_TABLE) { this.openCraftingTable(); return; }
        if (tb === B.FURNACE && b === B.FURNACE) { this.openFurnace(this.target.x, this.target.y, this.target.z); return; }
      }
      this.placeBlock(b);
    }
  }

  private placeBlock(blockId: number) {
    if (!this.target) return;
    const px = this.target.x + this.target.nx;
    const py = this.target.y + this.target.ny;
    const pz = this.target.z + this.target.nz;
    if (py < 0 || py >= 256) return;
    // don't place into player
    const pminX = Math.floor(this.player.pos.x - this.player.halfW);
    const pmaxX = Math.floor(this.player.pos.x + this.player.halfW);
    const pminY = Math.floor(this.player.pos.y);
    const pmaxY = Math.floor(this.player.pos.y + this.player.height);
    const pminZ = Math.floor(this.player.pos.z - this.player.halfW);
    const pmaxZ = Math.floor(this.player.pos.z + this.player.halfW);
    const bt = this.reg.getBlock(blockId);
    if (bt.solid) {
      if (px >= pminX && px <= pmaxX && py >= pminY && py <= pmaxY && pz >= pminZ && pz <= pmaxZ) return;
    }
    if (this.world.getBlock(px, py, pz) !== B.AIR) return;
    this.world.setBlock(px, py, pz, blockId);
    this.inv.consumeOne(this.selected);
    this.placeFlash = { x: px, y: py, z: pz, t: 0.25 };
    this.playSound('place', bt.category);
    this.markDirty();
  }

  // ----------------- particles -----------------
  private spawnBreakParticles(x: number, y: number, z: number, tile: number) {
    const [u0, v0, u1, v1] = this.atlas.uv(tile);
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.atlas.texture });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x + 0.5 + (Math.random() - 0.5) * 0.6, y + 0.5 + (Math.random() - 0.5) * 0.6, z + 0.5 + (Math.random() - 0.5) * 0.6);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 4 + 1, (Math.random() - 0.5) * 3);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel, life: 0.8 });
    }
    void u0; void v0; void u1; void v1;
  }
  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 12 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(Math.max(0.1, p.life));
    }
    if (this.placeFlash) {
      this.placeFlash.t -= dt;
      if (this.placeFlash.t <= 0) this.placeFlash = null;
    }
  }

  // ----------------- mobs -----------------
  private clearMobs() {
    for (const m of this.mobs) this.scene.remove(m.group);
    this.mobs = [];
    for (const p of this.projectiles) p.dispose(this.scene);
    this.projectiles = [];
  }

  private spawnLight(wx: number, wy: number, wz: number, timeFactor: number): number {
    // sky light: 15 if no opaque above, scaled by time of day
    let sky = 15;
    for (let y = wy + 1; y < 256; y++) {
      const b = this.world.getBlock(wx, y, wz);
      const bt = this.reg.getBlock(b);
      if (bt.opaque) { sky = 0; break; }
      if (b === B.WATER) sky = Math.min(sky, 3);
    }
    const effSky = sky * timeFactor;
    // block light from nearby light sources
    let bl = 0;
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -4; dy <= 4; dy++)
        for (let dz = -4; dz <= 4; dz++) {
          const b = this.world.getBlock(wx + dx, wy + dy, wz + dz);
          const bt = this.reg.getBlock(b);
          if (bt.light > 0) {
            const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            bl = Math.max(bl, Math.max(0, bt.light - d));
          }
        }
    return Math.max(effSky, bl);
  }

  private updateMobSpawning(dt: number) {
    this.mobSpawnTimer -= dt;
    const sunY = Math.sin(this.timeOfDay() * Math.PI * 2);
    const isNight = sunY < -0.1;
    const timeFactor = Math.max(0.15, 0.15 + Math.max(0, sunY) * 0.85);
    // spawn passives during day if under cap
    if (this.mobSpawnTimer <= 0) {
      this.mobSpawnTimer = 2;
      const cap = 14;
      if (this.mobs.filter((m) => m.alive).length < cap) {
        // choose a spawn position near player
        const ang = Math.random() * Math.PI * 2;
        const r = 16 + Math.random() * 16;
        const sx = Math.floor(this.player.pos.x + Math.cos(ang) * r);
        const sz = Math.floor(this.player.pos.z + Math.sin(ang) * r);
        const sy = this.world.topSolid(sx, sz) + 1;
        if (sy > 0) {
          // biome
          const col = this.world.gen.column(sx, sz);
          const biome = col.biome;
          // light check (hostile only at night/low light), time-aware
          const light = this.spawnLight(sx, sy, sz, timeFactor);
          let kind: MobKind | null = null;
          if (isNight && light < 8) {
            // hostile
            const choices: MobKind[] = ['stalker', 'shooter'];
            const k = choices[Math.floor(Math.random() * choices.length)];
            if (MOB_DEFS[k].spawnBiomes.includes(biomeToName(biome))) kind = k;
          } else if (light > 8) {
            // passive
            const choices: MobKind[] = ['grazer', 'critter'];
            const k = choices[Math.floor(Math.random() * choices.length)];
            if (MOB_DEFS[k].spawnBiomes.includes(biomeToName(biome))) kind = k;
          }
          if (kind) {
            const id = 'm' + Math.random().toString(36).slice(2, 9);
            const m = spawnMob(kind, this.reg, this.scene, sx + 0.5, sy, sz + 0.5, id);
            this.mobs.push(m);
          }
        }
      }
    }
    // despawn far mobs
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (!m.alive) {
        this.scene.remove(m.group);
        this.mobs.splice(i, 1);
        continue;
      }
      const d = Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z);
      if (d > 60) {
        this.scene.remove(m.group);
        this.mobs.splice(i, 1);
      }
    }
  }

  // ----------------- furnace tick -----------------
  private updateFurnace(dt: number) {
    if (!this.furnaceOpen) return;
    const f = this.furnace;
    const recipe = f.input ? furnaceOutput(f.input.item) : null;
    const outItem = recipe ? recipe.output : null;
    const canSmelt = recipe && f.input && f.input.count > 0 && (!f.output || (f.output.item === outItem && f.output.count < (this.reg.getItem(outItem!)?.maxStack ?? 64)));
    if (f.burn > 0) {
      f.burn -= dt;
      if (canSmelt) {
        f.progress += dt;
        f.maxProgress = recipe!.time;
        if (f.progress >= recipe!.time) {
          f.progress = 0;
          f.input!.count -= 1;
          if (f.input!.count <= 0) f.input = null;
          if (!f.output) f.output = { item: outItem!, count: 1 };
          else f.output.count += 1;
        }
      } else {
        f.progress = 0;
      }
    } else if (canSmelt && f.fuel && f.fuel.count > 0) {
      const burn = fuelBurn(f.fuel.item);
      if (burn > 0) {
        f.burn = burn;
        f.fuel.count -= 1;
        if (f.fuel.count <= 0) f.fuel = null;
      }
    }
    this.markDirty();
  }

  // ----------------- day/night -----------------
  timeOfDay(): number {
    return (this.time % this.dayLength) / this.dayLength;
  }
  private updateDayNight() {
    const t = this.timeOfDay();
    // sun angle: t=0 dawn (horizon, rising), t=0.25 noon (top), t=0.5 dusk, t=0.75 midnight
    const ang = t * Math.PI * 2;
    const sunY = Math.sin(ang);
    const sunX = Math.cos(ang);
    this.sun.position.set(sunX * 100, sunY * 100, 40);
    // intensity
    const day = Math.max(0, sunY);
    this.sun.intensity = 0.15 + day * 1.0;
    this.ambient.intensity = 0.2 + day * 0.5;
    this.hemi.intensity = 0.12 + day * 0.4;
    // colors
    const dayCol = new THREE.Color(0x88bbff);
    const nightCol = new THREE.Color(0x0b1130);
    const duskCol = new THREE.Color(0xe8703a);
    let sky: THREE.Color;
    if (sunY > 0.2) sky = dayCol;
    else if (sunY > -0.2) {
      const k = (sunY + 0.2) / 0.4;
      sky = nightCol.clone().lerp(duskCol, k).lerp(dayCol, k * 0.5);
    } else sky = nightCol;
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.sun.color.setHex(sunY > 0 ? 0xfff2cc : 0x445599);
  }

  // ----------------- main loop -----------------
  start() {
    this.lastTime = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (dt > 0.1) dt = 0.1;
      this.fpsAccum += dt; this.fpsFrames++;
      if (this.fpsAccum >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsAccum); this.fpsAccum = 0; this.fpsFrames = 0; }
      if (!this.paused) this.update(dt);
      this.render();
      this.pushState();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private update(dt: number) {
    // world time
    if (!this.inventoryOpen) this.time += dt;

    // chunk streaming
    this.world.update(this.player.pos.x, this.player.pos.z, this.renderDistance);
    this.world.updateMeshes(3);

    // player
    if (!this.inventoryOpen) {
      this.player.update(dt, this.input, this.world);
    }

    // camera follows player eye
    const eye = new THREE.Vector3();
    this.player.getEyePosition(eye);
    this.camera.position.copy(eye);
    const dir = new THREE.Vector3();
    this.player.getLookDir(dir);
    this.camera.lookAt(eye.clone().add(dir));

    // raycast target
    this.updateTarget(eye, dir);

    // mining
    if (!this.inventoryOpen) this.updateMining(dt);

    // mobs
    this.updateMobSpawning(dt);
    for (const m of this.mobs) m.update(dt, this.world, this.player, this.projectiles);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const alive = this.projectiles[i].update(dt, this.world, this.player);
      if (!alive) { this.projectiles[i].dispose(this.scene); this.projectiles.splice(i, 1); }
    }

    // furnace
    this.updateFurnace(dt);

    // particles
    this.updateParticles(dt);

    // day/night
    this.updateDayNight();

    // hurt flash decay handled in player

    // autosave
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 30) { this.autosaveTimer = 0; this.autosave(); }

    if (this.messageTimer > 0) { this.messageTimer -= dt; if (this.messageTimer <= 0) this.message = null; }
  }

  private updateTarget(eye: THREE.Vector3, dir: THREE.Vector3) {
    const hit = this.world.raycast(eye, dir, 6);
    this.target = hit;
    if (hit) {
      this.selectionMesh.visible = true;
      this.selectionMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      this.selectionMesh.visible = false;
    }
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private stateTimer = 0;
  private pushState() {
    this.stateTimer += 1 / 60;
    if (!this.dirty && this.stateTimer < 0.1) return;
    this.stateTimer = 0;
    this.dirty = false;
    const hotbar: (ItemStack | null)[] = [];
    for (let i = 0; i < 9; i++) hotbar.push(this.inv.slots[i] ? { ...this.inv.slots[i]! } : null);
    const biome = biomeToName(this.world.gen.column(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z)).biome);
    const s: EngineSnapshot = {
      health: this.player.health, maxHealth: this.player.maxHealth,
      hunger: this.player.hunger, maxHunger: this.player.maxHunger,
      hotbar, selected: this.selected, fps: this.fps,
      timeOfDay: this.timeOfDay(), dayLength: this.dayLength, biome,
      paused: this.paused, inventoryOpen: this.inventoryOpen,
      craftSize: this.craftSize,
      craftGrid: this.craftGrid.map((s) => (s ? { ...s } : null)),
      craftOutput: this.craftOutput ? { ...this.craftOutput } : null,
      held: this.held ? { ...this.held } : null,
      inventory: this.inv.serialize(),
      furnaceOpen: this.furnaceOpen,
      furnace: {
        input: this.furnace.input ? { ...this.furnace.input } : null,
        fuel: this.furnace.fuel ? { ...this.furnace.fuel } : null,
        output: this.furnace.output ? { ...this.furnace.output } : null,
        burn: this.furnace.burn, progress: this.furnace.progress, maxProgress: this.furnace.maxProgress,
      },
      fly: this.player.flying,
      targetBlock: this.target ? this.reg.getBlock(this.target.block).displayName : null,
      miningProgress: this.mining?.progress ?? 0,
      loadedChunks: this.world.meshes.size,
      mobCount: this.mobs.length,
      message: this.message,
    };
    this.onState(s);
  }
  markDirty() { this.dirty = true; }
  setMessage(msg: string) { this.message = msg; this.messageTimer = 3; this.markDirty(); }

  // ----------------- sound -----------------
  private playSound(kind: string, mat: string) {
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = this.audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime;
      let freq = 200, dur = 0.12, type: OscillatorType = 'square';
      if (kind === 'break') { freq = mat === 'stone' ? 140 : mat === 'wood' ? 220 : 320; dur = 0.14; type = 'square'; }
      else if (kind === 'place') { freq = 300; dur = 0.08; type = 'sine'; }
      else if (kind === 'eat') { freq = 180; dur = 0.18; type = 'sine'; }
      o.type = type;
      o.frequency.setValueAtTime(freq, now);
      o.frequency.exponentialRampToValueAtTime(freq * 0.6, now + dur);
      g.gain.setValueAtTime(0.12, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.start(now); o.stop(now + dur);
    } catch {}
  }

  // ----------------- public UI actions -----------------
  selectHotbar(i: number) { this.selected = i; this.markDirty(); }
  setDayLength(s: number) { this.dayLength = s; this.markDirty(); }
  toggleFly() { this.player.flying = !this.player.flying; this.markDirty(); }
  respawn() {
    this.player.health = this.player.maxHealth;
    this.player.hunger = this.player.maxHunger;
    this.player.spawn(this.world, 0, 0);
    this.player.vel.set(0, 0, 0);
    this.markDirty();
  }

  // icon cache for UI rendering
  private iconCache = new Map<number, string>();
  iconDataURL(itemId: number): string {
    const cached = this.iconCache.get(itemId);
    if (cached) return cached;
    const item = this.reg.getItem(itemId);
    if (!item) return '';
    let tile = item.iconTile ?? 0;
    if (item.block !== undefined) {
      const bt = this.reg.getBlock(item.block);
      tile = bt.textures.side;
    }
    const col = tile % 16;
    const row = Math.floor(tile / 16);
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas.canvas, col * 16, row * 16, 16, 16, 0, 0, 32, 32);
    const url = cv.toDataURL();
    this.iconCache.set(itemId, url);
    return url;
  }
  itemName(itemId: number): string {
    return this.reg.getItem(itemId)?.displayName ?? '?';
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('contextmenu', this.onContext);
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) this.container.removeChild(this.renderer.domElement);
  }
}

function biomeToName(b: Biome): string {
  return BiomeName[b].toLowerCase();
}
