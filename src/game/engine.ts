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
  eyeInWater: boolean;
  air: number; // 0-10 air bubbles
  dead: boolean;
  gameMode: 'survival' | 'creative';
  hotbarName: string | null;
  creativeItems: { item: number; name: string }[];
  creativePage: number;
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
  renderDistance = 5; // reduced for performance
  gameMode: 'survival' | 'creative' = 'survival';
  creativePage = 0;
  hotbarNameTimer = 0;
  hotbarName: string | null = null;
  torchLights: THREE.PointLight[] = [];
  maxTorchLights = 8;

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

  // first-person view model (hand + held item)
  viewModelScene!: THREE.Scene;
  viewModelCamera!: THREE.PerspectiveCamera;
  handGroup!: THREE.Group;
  armMesh!: THREE.Object3D;
  itemMesh: THREE.Mesh | null = null;
  lastSelectedItem: number = -2;
  swingT = 0;
  swingDuration = 0.28;
  viewBobX = 0;
  viewBobY = 0;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
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

    // first-person view model scene (rendered on top of world)
    this.viewModelScene = new THREE.Scene();
    // Minecraft uses ~70 FOV but the view model is rendered separately with a custom projection.
    // We use a narrower FOV (50) and position items further away to match Minecraft's look.
    this.viewModelCamera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 10);
    this.viewModelCamera.position.set(0, 0, 0);
    const vmAmbient = new THREE.AmbientLight(0xffffff, 0.9);
    const vmDir = new THREE.DirectionalLight(0xffffff, 0.6);
    vmDir.position.set(0.5, 1, 0.8);
    this.viewModelScene.add(vmAmbient);
    this.viewModelScene.add(vmDir);
    this.handGroup = new THREE.Group();
    this.viewModelScene.add(this.handGroup);
    // arm (hand) — Minecraft-style arm, positioned at bottom-right
    // Arm dimensions: 4x12x4 pixels = 0.25 x 0.75 x 0.25 blocks
    const armGroup = new THREE.Group();
    const armGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
    const armMat = new THREE.MeshLambertMaterial({ color: 0xe8b890 });
    const armMesh = new THREE.Mesh(armGeo, armMat);
    armMesh.position.set(0, -0.3, 0); // pivot at top (shoulder)
    armGroup.add(armMesh);
    // sleeve (shirt color)
    const sleeveGeo = new THREE.BoxGeometry(0.21, 0.24, 0.21);
    const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x4a7ac0 });
    const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
    sleeve.position.set(0, -0.12, 0);
    armGroup.add(sleeve);
    // position arm at bottom-right, angled so it points forward and down
    armGroup.position.set(0.38, -0.42, -0.72);
    armGroup.rotation.x = Math.PI * 0.42; // arm hangs down-forward
    armGroup.rotation.z = -0.12;
    this.armMesh = armGroup;
    this.handGroup.add(armGroup);

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
    // survival: no starter items (like Minecraft)
    // creative: handled separately via creative inventory
  }

  // ----------------- new game / load -----------------
  newGame(seed?: number, mode: 'survival' | 'creative' = 'survival') {
    this.seed = seed ?? ((Math.random() * 2 ** 31) | 0);
    this.gameMode = mode;
    this.world = new World(this.seed, this.reg);
    this.scene.remove(this.world.group);
    this.scene.add(this.world.group);
    this.player = new Player(this.reg);
    this.inv = new Inventory(this.reg, 36);
    this.player.flying = (mode === 'creative');
    this.player.creative = (mode === 'creative');
    this.clearMobs();
    this.giveStarterItems();
    this.spawnOnLand();
    this.world.update(this.player.pos.x, this.player.pos.z, this.renderDistance);
    for (let i = 0; i < 60; i++) this.world.updateMeshes(6);
    this.time = 0;
    this.markDirty();
    this.setMessage(mode === 'creative' ? 'Creative mode' : 'Survival mode');
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
  private attackCooldown = 0;
  private onMouseDown = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    if (e.button === 0) {
      this.mouseDown.left = true;
      // try to attack a mob first; if no mob hit, start mining
      if (!this.attackMob()) this.startMining();
    }
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
    this.showHotbarName();
    this.markDirty();
  };
  private showHotbarName() {
    const stack = this.inv.hotbar(this.selected);
    if (stack) {
      this.hotbarName = this.itemName(stack.item);
    } else {
      this.hotbarName = null;
    }
    this.hotbarNameTimer = 2.0;
  }
  private lastJumpTap = 0;
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
      if (n >= 1 && n <= 9) { this.selected = n - 1; this.showHotbarName(); this.markDirty(); return; }
    }
    if (code === 'KeyF') {
      if (this.gameMode === 'creative') { this.player.flying = !this.player.flying; this.setMessage(this.player.flying ? 'Fly ON' : 'Fly OFF'); }
      else { this.setMessage('Fly is only available in Creative mode'); }
      this.markDirty(); return;
    }
    // double-tap Space to toggle fly (Minecraft creative)
    if (code === 'Space' && this.gameMode === 'creative') {
      const now = performance.now();
      if (now - this.lastJumpTap < 300) {
        this.player.flying = !this.player.flying;
        this.setMessage(this.player.flying ? 'Fly ON' : 'Fly OFF');
        this.markDirty();
      }
      this.lastJumpTap = now;
    }
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
    this.viewModelCamera.aspect = c.clientWidth / c.clientHeight;
    this.viewModelCamera.updateProjectionMatrix();
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

  // ----------------- combat -----------------
  private attackMob(): boolean {
    if (this.attackCooldown > 0) return false;
    const eye = new THREE.Vector3();
    this.player.getEyePosition(eye);
    const dir = new THREE.Vector3();
    this.player.getLookDir(dir);

    // compute attack damage from held item
    const stack = this.inv.hotbar(this.selected);
    const item = stack ? this.reg.getItem(stack.item) : null;
    let dmg = 1; // bare hand
    if (item?.attackDamage) dmg = item.attackDamage;

    const reach = 4.0;
    let bestMob: Mob | null = null;
    let bestT = reach;

    for (const m of this.mobs) {
      if (!m.alive) continue;
      // mob AABB
      const hw = m.def.width / 2;
      const minX = m.pos.x - hw, maxX = m.pos.x + hw;
      const minY = m.pos.y, maxY = m.pos.y + m.def.height;
      const minZ = m.pos.z - hw, maxZ = m.pos.z + hw;
      // ray-AABB intersection (slab method)
      const inv = { x: 1 / dir.x, y: 1 / dir.y, z: 1 / dir.z };
      const t1 = (minX - eye.x) * inv.x;
      const t2 = (maxX - eye.x) * inv.x;
      const t3 = (minY - eye.y) * inv.y;
      const t4 = (maxY - eye.y) * inv.y;
      const t5 = (minZ - eye.z) * inv.z;
      const t6 = (maxZ - eye.z) * inv.z;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
      if (tmax >= 0 && tmin <= tmax && tmin >= 0 && tmin < bestT) {
        bestT = tmin;
        bestMob = m;
      } else if (tmax >= 0 && tmin <= 0 && tmax < bestT) {
        // origin inside AABB (shouldn't happen but handle)
        bestT = 0;
        bestMob = m;
      }
    }

    if (bestMob) {
      const died = bestMob.damage(dmg);
      this.attackCooldown = 0.4;
      this.swingT = this.swingDuration;
      // knockback
      const kb = dir.clone();
      kb.y = 0.3;
      bestMob.vel.add(kb.multiplyScalar(6));
      bestMob.hurtTimer = 0.4;
      this.playSound('hit', 'combat');
      if (died) {
        // drop items
        for (const drop of bestMob.def.drops) {
          const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
          if (count > 0) this.inv.add({ item: drop.item, count });
        }
      }
      this.markDirty();
      return true;
    }
    return false;
  }

  // ----------------- mining / placement -----------------
  private startMining() {
    if (!this.target) { this.mining = null; return; }
    this.mining = { x: this.target.x, y: this.target.y, z: this.target.z, progress: 0 };
    this.swingT = this.swingDuration;
  }

  private miningSpeed(blockId: number): number {
    const bt = this.reg.getBlock(blockId);
    if (bt.hardness < 0) return 0; // unbreakable (bedrock)
    // creative: instant break
    if (this.gameMode === 'creative') return 100;
    const stack = this.inv.hotbar(this.selected);
    let speed = 1;
    let correctTool = false;
    if (stack) {
      const item = this.reg.getItem(stack.item);
      if (item?.toolType) {
        if (item.toolType === bt.tool) { correctTool = true; speed = item.miningSpeed ?? 1; }
      }
    }
    const tierOk = stack ? (this.reg.getItem(stack.item)?.toolTier ?? 0) >= bt.toolTier : bt.toolTier === 0;
    let time = bt.hardness * 1.5;
    if (correctTool) time /= speed;
    else if (bt.tool !== 'none' && bt.toolTier > 0) time *= 5;
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
    this.world.setBlock(x, y, z, B.AIR);
    this.spawnBreakParticles(x, y, z, bt.textures.side);
    this.playSound('break', bt.category);
    // creative: instant break, no drops, no durability
    if (this.gameMode === 'creative') {
      this.markDirty();
      return;
    }
    // survival: tool tier check for drops
    const stack = this.inv.hotbar(this.selected);
    const tier = stack ? (this.reg.getItem(stack.item)?.toolTier ?? 0) : 0;
    const tierOk = tier >= bt.toolTier;
    if (tierOk) {
      for (const drop of bt.drops) {
        const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
        if (count > 0) {
          // spawn dropped item entity instead of adding directly to inventory
          this.spawnDrop(x + 0.5, y + 0.5, z + 0.5, drop.item, count);
        }
      }
    }
    // tool durability
    if (stack && this.reg.getItem(stack.item)?.toolType) {
      this.useToolDurability(this.selected);
    }
    this.markDirty();
  }

  // ----------------- dropped items -----------------
  private drops: { mesh: THREE.Mesh; vel: THREE.Vector3; item: number; count: number; life: number; pickupDelay: number }[] = [];

  private spawnDrop(x: number, y: number, z: number, item: number, count: number) {
    // create a small spinning cube mesh with the item's texture
    const it = this.reg.getItem(item);
    if (!it) return;
    let tile = it.iconTile ?? 0;
    if (it.block !== undefined) {
      const bt = this.reg.getBlock(it.block);
      tile = bt.textures.side;
    }
    const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const mat = new THREE.MeshLambertMaterial({ map: this.atlas.texture });
    // set UVs for all 6 faces to the item tile
    const [u0, v0, u1, v1] = this.atlas.uv(tile);
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < 6; i++) {
      const o = i * 4 * 2;
      uvAttr.setXY(o / 2, u0, v0); uvAttr.setXY(o / 2 + 1, u1, v0); uvAttr.setXY(o / 2 + 2, u1, v1); uvAttr.setXY(o / 2 + 3, u0, v1);
    }
    uvAttr.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2),
      item, count, life: 120, pickupDelay: 0.5,
    });
  }

  private updateDrops(dt: number) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.drops.splice(i, 1);
        continue;
      }
      // physics
      d.vel.y -= 20 * dt;
      // try move
      const np = d.mesh.position.clone();
      np.x += d.vel.x * dt;
      np.y += d.vel.y * dt;
      np.z += d.vel.z * dt;
      // ground collision
      const bx = Math.floor(np.x), by = Math.floor(np.y), bz = Math.floor(np.z);
      if (this.reg.getBlock(this.world.getBlock(bx, by, bz)).solid) {
        // don't move into solid; stop
        d.vel.set(0, 0, 0);
      } else {
        d.mesh.position.copy(np);
      }
      // friction
      d.vel.x *= 0.92;
      d.vel.z *= 0.92;
      // spin
      d.mesh.rotation.y += dt * 2;
      d.mesh.position.y += Math.sin(performance.now() * 0.003 + i) * 0.002;
      // pickup
      if (d.pickupDelay > 0) {
        d.pickupDelay -= dt;
      } else {
        const dx = d.mesh.position.x - this.player.pos.x;
        const dy = d.mesh.position.y - (this.player.pos.y + 0.9);
        const dz = d.mesh.position.z - this.player.pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 1.5) {
          // attract toward player
          if (dist > 0.5) {
            d.mesh.position.x -= dx * dt * 4;
            d.mesh.position.y -= dy * dt * 4;
            d.mesh.position.z -= dz * dt * 4;
          } else {
            // pick up
            const leftover = this.inv.add({ item: d.item, count: d.count });
            if (leftover.count <= 0) {
              this.scene.remove(d.mesh);
              d.mesh.geometry.dispose();
              (d.mesh.material as THREE.Material).dispose();
              this.drops.splice(i, 1);
              this.playSound('pickup', 'item');
            } else {
              d.count = leftover.count;
            }
          }
        }
      }
    }
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
    const item = stack ? this.reg.getItem(stack.item) : null;
    this.swingT = this.swingDuration;

    // right-click on functional blocks opens their UI (even with empty hand)
    if (this.target) {
      const tb = this.world.getBlock(this.target.x, this.target.y, this.target.z);
      if (tb === B.CRAFTING_TABLE) { this.openCraftingTable(); return; }
      if (tb === B.FURNACE) { this.openFurnace(this.target.x, this.target.y, this.target.z); return; }
    }

    if (!stack || !item) return;

    // food: can only eat if hunger is not full
    if (item.category === 'food' && item.food) {
      if (this.player.hunger >= this.player.maxHunger) return; // can't eat at full hunger
      this.player.feed(item.food);
      if (this.gameMode !== 'creative') this.inv.consumeOne(this.selected);
      this.playSound('eat', 'food');
      this.markDirty();
      return;
    }
    // block placement
    if (item.block !== undefined) {
      this.placeBlock(item.block);
    }
  }

  private placeBlock(blockId: number) {
    if (!this.target) return;
    const px = this.target.x + this.target.nx;
    const py = this.target.y + this.target.ny;
    const pz = this.target.z + this.target.nz;
    if (py < 0 || py >= 256) return;
    const bt = this.reg.getBlock(blockId);
    // placement validation: check what we're placing ON (the target block)
    const targetBlock = this.world.getBlock(this.target.x, this.target.y, this.target.z);
    const targetBt = this.reg.getBlock(targetBlock);
    // non-solid blocks (torches, flowers, plants, etc.) require a solid neighbor to attach to
    if (!bt.solid) {
      // for cross-render blocks (torch, flower, plant), need a solid block adjacent
      let hasSolidSupport = false;
      // check the face we're placing against (the target block itself)
      if (targetBt.solid) hasSolidSupport = true;
      // also check if there's a solid block below (for ground placement)
      if (!hasSolidSupport) {
        const below = this.world.getBlock(px, py - 1, pz);
        if (this.reg.getBlock(below).solid) hasSolidSupport = true;
      }
      if (!hasSolidSupport) return; // can't place without support
    }
    // don't place into player
    const pminX = Math.floor(this.player.pos.x - this.player.halfW);
    const pmaxX = Math.floor(this.player.pos.x + this.player.halfW);
    const pminY = Math.floor(this.player.pos.y);
    const pmaxY = Math.floor(this.player.pos.y + this.player.height);
    const pminZ = Math.floor(this.player.pos.z - this.player.halfW);
    const pmaxZ = Math.floor(this.player.pos.z + this.player.halfW);
    if (bt.solid) {
      if (px >= pminX && px <= pmaxX && py >= pminY && py <= pmaxY && pz >= pminZ && pz <= pmaxZ) return;
    }
    // can't place on top of non-air (unless it's replaceable like water — but we disallow for now)
    const existing = this.world.getBlock(px, py, pz);
    if (existing !== B.AIR && !this.reg.getBlock(existing).liquid) return;
    this.world.setBlock(px, py, pz, blockId);
    if (this.gameMode !== 'creative') this.inv.consumeOne(this.selected);
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
    for (const d of this.drops) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); }
    this.drops = [];
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
    // cooldowns
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

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

    // smooth sprint FOV change
    const targetFov = this.player.sprinting ? 82 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 8 * dt);
      this.camera.updateProjectionMatrix();
    }

    // raycast target
    this.updateTarget(eye, dir);

    // mining
    if (!this.inventoryOpen) this.updateMining(dt);

    // mobs
    this.updateMobSpawning(dt);
    const sunY = Math.sin(this.timeOfDay() * Math.PI * 2);
    for (const m of this.mobs) m.update(dt, this.world, this.player, this.projectiles, sunY);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const alive = this.projectiles[i].update(dt, this.world, this.player);
      if (!alive) { this.projectiles[i].dispose(this.scene); this.projectiles.splice(i, 1); }
    }

    // furnace
    this.updateFurnace(dt);

    // particles
    this.updateParticles(dt);

    // dropped items
    this.updateDrops(dt);

    // view model (hand + held item)
    this.updateViewModel(dt);

    // day/night
    this.updateDayNight();

    // torch lights
    this.updateTorchLights(dt);

    // hurt flash decay handled in player

    // autosave
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 30) { this.autosaveTimer = 0; this.autosave(); }

    if (this.messageTimer > 0) { this.messageTimer -= dt; if (this.messageTimer <= 0) this.message = null; }
    if (this.hotbarNameTimer > 0) { this.hotbarNameTimer -= dt; if (this.hotbarNameTimer <= 0) this.hotbarName = null; }
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
    this.renderer.autoClear = false;
    this.renderer.clear(); // color + depth
    this.renderer.render(this.scene, this.camera);
    // view model on top (always visible, not occluded by world)
    this.renderer.clearDepth();
    this.renderer.render(this.viewModelScene, this.viewModelCamera);
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
      eyeInWater: this.player.eyeInLiquid(this.world),
      air: Math.max(0, Math.ceil(10 - (this.player.airTimer / 12) * 10)),
      dead: this.player.dead,
      gameMode: this.gameMode,
      hotbarName: this.hotbarName,
      creativeItems: this.getCreativeItems(),
      creativePage: this.creativePage,
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
      else if (kind === 'hit') { freq = 400; dur = 0.1; type = 'sawtooth'; }
      else if (kind === 'pickup') { freq = 800; dur = 0.08; type = 'sine'; }
      o.type = type;
      o.frequency.setValueAtTime(freq, now);
      o.frequency.exponentialRampToValueAtTime(freq * 0.6, now + dur);
      g.gain.setValueAtTime(0.12, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.start(now); o.stop(now + dur);
    } catch {}
  }

  // ----------------- torch lighting -----------------
  private torchScanTimer = 0;
  private updateTorchLights(dt: number) {
    // only scan for light sources every 0.3s to save performance
    this.torchScanTimer += dt;
    if (this.torchScanTimer < 0.3) {
      // still update flicker on existing lights
      for (let i = 0; i < this.torchLights.length; i++) {
        this.torchLights[i].intensity *= 0.9 + Math.sin(performance.now() * 0.01 + i) * 0.1;
      }
      return;
    }
    this.torchScanTimer = 0;
    // scan for light-emitting blocks near the player and attach point lights
    const px = Math.floor(this.player.pos.x);
    const py = Math.floor(this.player.pos.y);
    const pz = Math.floor(this.player.pos.z);
    const range = 6;
    const found: { x: number; y: number; z: number; level: number }[] = [];
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -range; dz <= range; dz++) {
          const b = this.world.getBlock(px + dx, py + dy, pz + dz);
          const bt = this.reg.getBlock(b);
          if (bt.light > 0) {
            found.push({ x: px + dx, y: py + dy, z: pz + dz, level: bt.light });
          }
        }
      }
    }
    // sort by distance to player, take closest N
    found.sort((a, b) => {
      const da = (a.x - px) ** 2 + (a.y - py) ** 2 + (a.z - pz) ** 2;
      const db = (b.x - px) ** 2 + (b.y - py) ** 2 + (b.z - pz) ** 2;
      return da - db;
    });
    const maxLights = Math.min(this.maxTorchLights, found.length);
    // ensure we have the right number of lights
    while (this.torchLights.length < maxLights) {
      const light = new THREE.PointLight(0xffaa55, 0, 8, 2);
      this.scene.add(light);
      this.torchLights.push(light);
    }
    while (this.torchLights.length > maxLights) {
      const light = this.torchLights.pop()!;
      this.scene.remove(light);
    }
    // update light positions and intensities
    for (let i = 0; i < this.torchLights.length; i++) {
      const t = found[i];
      this.torchLights[i].position.set(t.x + 0.5, t.y + 0.7, t.z + 0.5);
      this.torchLights[i].intensity = (t.level / 15) * 2.5;
      // flicker
      this.torchLights[i].intensity *= 0.9 + Math.sin(performance.now() * 0.01 + i) * 0.1;
    }
  }

  // ----------------- public UI actions -----------------
  selectHotbar(i: number) { this.selected = i; this.showHotbarName(); this.markDirty(); }
  setDayLength(s: number) { this.dayLength = s; this.markDirty(); }
  toggleFly() {
    if (this.gameMode === 'creative') { this.player.flying = !this.player.flying; }
    this.markDirty();
  }
  respawn() {
    this.player.health = this.player.maxHealth;
    this.player.hunger = this.player.maxHunger;
    this.player.dead = false;
    this.spawnOnLand();
    this.player.vel.set(0, 0, 0);
    this.markDirty();
  }

  getCreativeItems(): { item: number; name: string }[] {
    const items: { item: number; name: string }[] = [];
    const perPage = 45;
    let idx = 0;
    const skip = this.creativePage * perPage;
    // add all block items
    for (const [blockId, bt] of this.reg.blocks) {
      if (blockId === 0) continue; // skip air
      if (idx >= skip && idx < skip + perPage) {
        items.push({ item: blockId, name: bt.displayName });
      }
      idx++;
    }
    // add all non-block items
    for (const [itemId, it] of this.reg.items) {
      if (it.block !== undefined) continue; // skip block items (already added)
      if (idx >= skip && idx < skip + perPage) {
        items.push({ item: itemId, name: it.displayName });
      }
      idx++;
    }
    return items;
  }

  giveCreativeItem(itemId: number) {
    const item = this.reg.getItem(itemId);
    if (!item) return;
    this.inv.add({ item: itemId, count: item.maxStack });
    this.markDirty();
  }

  setCreativePage(page: number) {
    this.creativePage = Math.max(0, page);
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

  // ----------------- view model (first-person hand + held item) -----------------
  private rebuildItemMesh() {
    if (this.itemMesh) {
      this.handGroup.remove(this.itemMesh);
      this.itemMesh.geometry.dispose();
      (this.itemMesh.material as THREE.Material).dispose();
      this.itemMesh = null;
    }
    const stack = this.inv.hotbar(this.selected);
    if (!stack) return;
    const item = this.reg.getItem(stack.item);
    if (!item) return;

    if (item.block !== undefined) {
      const bt = this.reg.getBlock(item.block);
      if (bt.render === 'cross') {
        // torch / flower / plant: flat billboard with alphaTest
        const tile = bt.textures.side;
        const [u0, v0, u1, v1] = this.atlas.uv(tile);
        const geo = new THREE.PlaneGeometry(0.14, 0.14);
        const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
        uvAttr.setXY(0, u0, v1); uvAttr.setXY(1, u1, v1); uvAttr.setXY(2, u0, v0); uvAttr.setXY(3, u1, v0);
        uvAttr.needsUpdate = true;
        const mat = new THREE.MeshLambertMaterial({ map: this.atlas.texture, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
        if (bt.light > 0) mat.emissive = new THREE.Color(0xffaa33);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0.28, -0.28, -0.85);
        mesh.rotation.set(0.0, -0.2, 0.0);
        this.itemMesh = mesh;
        this.handGroup.add(mesh);
        return;
      }
      // 3D cube for block items — Minecraft: block is ~0.35 blocks in hand, positioned further away
      const geo = buildItemCubeGeometry(this.reg, item.block);
      const mat = new THREE.MeshLambertMaterial({ map: this.atlas.texture, side: THREE.FrontSide });
      if (bt.light > 0) mat.emissive = new THREE.Color(bt.light > 10 ? 0x332200 : 0x111100);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0.28, -0.22, -0.85);
      mesh.rotation.set(0.15, -0.7, 0.05);
      mesh.scale.setScalar(0.22);
      this.itemMesh = mesh;
      this.handGroup.add(mesh);
    } else {
      // tools: flat plane, ~0.3 blocks, held at proper angle
      const tile = item.iconTile ?? 0;
      const [u0, v0, u1, v1] = this.atlas.uv(tile);
      const geo = new THREE.PlaneGeometry(0.3, 0.3);
      const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
      uvAttr.setXY(0, u0, v1); uvAttr.setXY(1, u1, v1); uvAttr.setXY(2, u0, v0); uvAttr.setXY(3, u1, v0);
      uvAttr.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({ map: this.atlas.texture, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0.25, -0.28, -0.8);
      mesh.rotation.set(0.0, -0.4, 0.1);
      mesh.rotation.order = 'YXZ';
      this.itemMesh = mesh;
      this.handGroup.add(mesh);
    }
  }

  private updateViewModel(dt: number) {
    const curItem = this.inv.hotbar(this.selected)?.item ?? -1;
    if (curItem !== this.lastSelectedItem) {
      this.rebuildItemMesh();
      this.lastSelectedItem = curItem;
      this.showHotbarName();
    }

    if (this.swingT > 0) {
      this.swingT -= dt;
      if (this.swingT < 0) this.swingT = 0;
    }
    if (this.mouseDown.left && this.swingT <= 0) {
      this.swingT = this.swingDuration;
    }

    const swingProgress = this.swingT > 0 ? 1 - (this.swingT / this.swingDuration) : 0;
    const swingAngle = Math.sin(swingProgress * Math.PI) * 1.2;

    const bob = this.player.bobAmt;
    const bobX = Math.cos(this.player.bobPhase) * 0.03 * bob;
    const bobY = Math.sin(this.player.bobPhase * 2) * 0.022 * bob;

    this.viewBobX += (bobX - this.viewBobX) * Math.min(1, 10 * dt);
    this.viewBobY += (bobY - this.viewBobY) * Math.min(1, 10 * dt);

    const t = performance.now() * 0.001;
    const idleX = Math.sin(t * 1.3) * 0.008;
    const idleY = Math.sin(t * 1.7) * 0.006;

    // handGroup holds both arm and item; apply swing to the whole group
    this.handGroup.position.set(this.viewBobX + idleX, this.viewBobY + idleY, 0);
    this.handGroup.rotation.x = -swingAngle * 0.5;
    this.handGroup.rotation.z = Math.sin(t * 0.9) * 0.02;
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

// Build a unit cube geometry with per-face atlas UVs for the held-item view model.
function buildItemCubeGeometry(reg: Registry, blockId: number): THREE.BufferGeometry {
  const bt = reg.getBlock(blockId);
  // faces: +x, -x, +y(top), -y(bottom), +z, -z ; each with 4 corners (CCW from outside)
  const faces = [
    { tex: bt.textures.side, corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { tex: bt.textures.side, corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
    { tex: bt.textures.top, corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { tex: bt.textures.bottom, corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { tex: bt.textures.side, corners: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
    { tex: bt.textures.side, corners: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
  ];
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  let v = 0;
  for (const f of faces) {
    const [u0, v0, u1, v1] = reg.atlas.uv(f.tex);
    const faceUV = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
    // compute normal from first 3 corners
    const a = f.corners[0], b = f.corners[1], c = f.corners[2];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (let i = 0; i < 4; i++) {
      pos.push(f.corners[i][0] * 0.5, f.corners[i][1] * 0.5, f.corners[i][2] * 0.5);
      nor.push(nx, ny, nz);
      uv.push(faceUV[i][0], faceUV[i][1]);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
