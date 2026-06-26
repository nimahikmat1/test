import * as THREE from 'three';
import { World } from './world';
import { Registry, B } from './blocks';
import { Player } from './player';
import { ItemId, MobState } from './types';
import { I } from './blocks';

export type MobKind = 'grazer' | 'critter' | 'stalker' | 'shooter';

interface MobDef {
  kind: MobKind;
  name: string;
  hostile: boolean;
  health: number;
  speed: number;
  width: number;
  height: number;
  attack: number;
  detectRange: number;
  attackRange: number;
  color: number;
  headColor: number;
  drops: { item: ItemId; min: number; max: number }[];
  spawnBiomes: string[]; // 'plains','forest','desert','mountains','tundra','ocean'
  maxPerArea: number;
}

export const MOB_DEFS: Record<MobKind, MobDef> = {
  grazer: {
    kind: 'grazer', name: 'Grazer', hostile: false, health: 10, speed: 2.0,
    width: 0.9, height: 1.4, attack: 0, detectRange: 0, attackRange: 0,
    color: 0x9c6b3c, headColor: 0xb08850,
    drops: [{ item: I.RAW_MEAT, min: 1, max: 3 }],
    spawnBiomes: ['plains', 'forest'], maxPerArea: 8,
  },
  critter: {
    kind: 'critter', name: 'Critter', hostile: false, health: 4, speed: 3.2,
    width: 0.5, height: 0.5, attack: 0, detectRange: 0, attackRange: 0,
    color: 0xb0a090, headColor: 0xd0c0b0,
    drops: [{ item: I.RAW_MEAT, min: 0, max: 1 }],
    spawnBiomes: ['plains', 'forest', 'desert', 'tundra'], maxPerArea: 6,
  },
  stalker: {
    kind: 'stalker', name: 'Stalker', hostile: true, health: 16, speed: 3.2,
    width: 0.6, height: 1.9, attack: 3, detectRange: 18, attackRange: 1.6,
    color: 0x3a5a3a, headColor: 0x4a6a4a,
    drops: [{ item: I.RAW_MEAT, min: 0, max: 1 }],
    spawnBiomes: ['plains', 'forest', 'desert', 'mountains', 'tundra'], maxPerArea: 6,
  },
  shooter: {
    kind: 'shooter', name: 'Shooter', hostile: true, health: 12, speed: 2.4,
    width: 0.6, height: 1.9, attack: 2, detectRange: 16, attackRange: 12,
    color: 0x9a9a9a, headColor: 0xc0c0c0,
    drops: [{ item: I.STICK, min: 0, max: 2 }],
    spawnBiomes: ['plains', 'forest', 'mountains', 'tundra'], maxPerArea: 4,
  },
};

export class Projectile {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  life = 4;
  active = true;
  mesh: THREE.Mesh;
  constructor(scene: THREE.Scene, pos: THREE.Vector3, vel: THREE.Vector3) {
    this.pos.copy(pos);
    this.vel.copy(vel);
    const geo = new THREE.SphereGeometry(0.12, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x66ffcc });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
  }
  update(dt: number, world: World, player: Player): boolean {
    this.life -= dt;
    if (this.life <= 0) return false;
    const steps = 4;
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, sdt);
      // collision with terrain
      const b = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
      if (b !== B.AIR) return false;
      // collision with player
      const dx = this.pos.x - player.pos.x;
      const dy = this.pos.y - (player.pos.y + 0.9);
      const dz = this.pos.z - player.pos.z;
      if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.9 && Math.abs(dz) < 0.4) {
        player.damage(2);
        return false;
      }
    }
    this.mesh.position.copy(this.pos);
    return true;
  }
  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

export class Mob {
  def: MobDef;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  health: number;
  onGround = false;
  group: THREE.Group;
  wanderTarget: THREE.Vector3 | null = null;
  wanderTimer = 0;
  attackCooldown = 0;
  hurtTimer = 0;
  fleeTimer = 0;
  alive = true;
  id: string;
  reg: Registry;

  constructor(kind: MobKind, reg: Registry, id: string) {
    this.def = MOB_DEFS[kind];
    this.reg = reg;
    this.id = id;
    this.health = this.def.health;
    this.group = buildMobMesh(this.def);
  }

  get halfW() { return this.def.width / 2; }

  private collides(world: World, p: THREE.Vector3): boolean {
    const minX = Math.floor(p.x - this.halfW);
    const maxX = Math.floor(p.x + this.halfW);
    const minY = Math.floor(p.y);
    const maxY = Math.floor(p.y + this.def.height);
    const minZ = Math.floor(p.z - this.halfW);
    const maxZ = Math.floor(p.z + this.halfW);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++) {
          const b = world.getBlock(x, y, z);
          if (this.reg.getBlock(b).solid) return true;
        }
    return false;
  }

  private moveAxis(world: World, axis: 'x' | 'y' | 'z', amount: number): boolean {
    if (amount === 0) return false;
    const p = this.pos.clone();
    if (axis === 'x') p.x += amount;
    else if (axis === 'y') p.y += amount;
    else p.z += amount;
    if (!this.collides(world, p)) {
      this.pos.copy(p);
      return false;
    }
    if (axis === 'y') {
      if (amount < 0) { this.onGround = true; this.pos.y = Math.floor(this.pos.y + amount) + 1; }
      this.vel.y = 0;
    } else {
      // blocked horizontally → try to jump (step up)
      if (this.onGround) this.vel.y = 7.0;
      this.vel[axis] = 0;
    }
    return true;
  }

  damage(amt: number): boolean {
    if (!this.alive) return false;
    this.health -= amt;
    this.hurtTimer = 0.4;
    if (this.def.hostile === false) this.fleeTimer = 4;
    if (this.health <= 0) {
      this.alive = false;
      return true; // died
    }
    return false;
  }

  update(dt: number, world: World, player: Player, projectiles: Projectile[]) {
    if (!this.alive) return;
    if (this.hurtTimer > 0) this.hurtTimer -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const def = this.def;
    const toPlayer = new THREE.Vector3().subVectors(player.pos, this.pos);
    const dist = toPlayer.length();
    toPlayer.y = 0;
    const distXZ = toPlayer.length();

    let moveDir = new THREE.Vector3();
    if (def.hostile) {
      if (dist < def.detectRange) {
        toPlayer.normalize();
        moveDir.copy(toPlayer);
        this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
        // attack
        if (def.kind === 'stalker' && dist < def.attackRange && this.attackCooldown <= 0) {
          player.damage(def.attack);
          this.attackCooldown = 1.0;
        } else if (def.kind === 'shooter' && dist < def.attackRange && dist > 3 && this.attackCooldown <= 0) {
          // shoot projectile toward player
          const from = this.pos.clone(); from.y += def.height * 0.6;
          const target = player.pos.clone(); target.y += 0.9;
          const dir = new THREE.Vector3().subVectors(target, from).normalize();
          const vel = dir.multiplyScalar(14);
          projectiles.push(new Projectile((this as any)._scene, from, vel));
          this.attackCooldown = 2.2;
        }
      }
    } else {
      // passive
      if (this.fleeTimer > 0 && dist < 12) {
        this.fleeTimer -= dt;
        moveDir.copy(toPlayer).multiplyScalar(-1).normalize();
        this.yaw = Math.atan2(moveDir.x, moveDir.z);
      } else {
        // wander
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0 || !this.wanderTarget) {
          this.wanderTimer = 2 + Math.random() * 3;
          if (Math.random() < 0.4) {
            this.wanderTarget = null; // idle
          } else {
            const ang = Math.random() * Math.PI * 2;
            const r = 3 + Math.random() * 6;
            this.wanderTarget = new THREE.Vector3(this.pos.x + Math.cos(ang) * r, this.pos.y, this.pos.z + Math.sin(ang) * r);
          }
        }
        if (this.wanderTarget) {
          const d = new THREE.Vector3().subVectors(this.wanderTarget, this.pos);
          d.y = 0;
          if (d.length() > 0.5) {
            d.normalize();
            moveDir.copy(d);
            this.yaw = Math.atan2(d.x, d.z);
          } else {
            this.wanderTarget = null;
          }
        }
      }
    }

    // apply horizontal velocity
    const speed = def.speed * (this.fleeTimer > 0 ? 1.4 : 1);
    this.vel.x = moveDir.x * speed;
    this.vel.z = moveDir.z * speed;

    // gravity
    this.vel.y -= 28 * dt;

    // integrate with substeps
    this.onGround = false;
    const maxV = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z));
    const steps = Math.max(1, Math.ceil((maxV * dt) / 0.2));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(world, 'x', this.vel.x * sdt);
      this.moveAxis(world, 'z', this.vel.z * sdt);
      this.moveAxis(world, 'y', this.vel.y * sdt);
    }

    // update mesh
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // hurt flash
    const flash = this.hurtTimer > 0;
    (this.group as any).traverse((o: THREE.Object3D) => {
      if ((o as any).isMesh) {
        const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial;
        if (m && m.emissive) m.emissive.setHex(flash ? 0x661111 : 0x000000);
      }
    });
  }

  serialize(): MobState {
    return {
      id: this.id, type: this.def.kind,
      position: [this.pos.x, this.pos.y, this.pos.z],
      velocity: [this.vel.x, this.vel.y, this.vel.z],
      health: this.health, yaw: this.yaw,
    };
  }
}

function buildMobMesh(def: MobDef): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: def.color });
  const headMat = new THREE.MeshLambertMaterial({ color: def.headColor });
  const w = def.width, h = def.height;
  const bodyH = h * 0.65;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, w * 1.4), bodyMat);
  body.position.y = bodyH / 2 + 0.1;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, w * 0.7, w * 0.7), headMat);
  head.position.set(0, bodyH + 0.2, w * 0.7);
  g.add(head);
  // eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: def.hostile ? 0xff3322 : 0x111111 });
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), eyeMat);
  eye.position.set(-w * 0.2, bodyH + 0.25, w * 0.7 + 0.36);
  g.add(eye);
  const eye2 = eye.clone();
  eye2.position.x = w * 0.2;
  g.add(eye2);
  g.position.y = 0;
  return g;
}

export function spawnMob(kind: MobKind, reg: Registry, scene: THREE.Scene, x: number, y: number, z: number, id: string): Mob {
  const m = new Mob(kind, reg, id);
  m.pos.set(x, y, z);
  (m as any)._scene = scene;
  scene.add(m.group);
  return m;
}
