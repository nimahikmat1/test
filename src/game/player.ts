import * as THREE from 'three';
import { World } from './world';
import { Registry, B } from './blocks';
import { BlockId } from './types';

export interface InputState {
  forward: boolean; back: boolean; left: boolean; right: boolean;
  jump: boolean; sprint: boolean; crouch: boolean;
}

const GRAVITY = 28;
const JUMP_VEL = 8.4;
const WALK = 4.3;
const SPRINT = 6.2;
const CROUCH = 1.6;
const SWIM = 2.6;
const EPS = 0.001;

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  health = 20;
  maxHealth = 20;
  hunger = 20;
  maxHunger = 20;
  hungerTimer = 0;
  regenTimer = 0;
  starveTimer = 0;
  airTimer = 0;
  fallStart = 0;
  flying = false;
  reg: Registry;
  width = 0.6;
  height = 1.8;
  eye = 1.62;
  bobPhase = 0;
  bobAmt = 0;
  hurtFlash = 0;
  invuln = 0;
  sprinting = false;
  dead = false;
  creative = false; // creative mode: no damage, no hunger

  constructor(reg: Registry) {
    this.reg = reg;
  }

  get halfW() { return this.width / 2; }

  isSolid(world: World, x: number, y: number, z: number): boolean {
    const b = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const bt = this.reg.getBlock(b);
    return bt.solid;
  }
  isLiquid(world: World, x: number, y: number, z: number): boolean {
    const b = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    const bt = this.reg.getBlock(b);
    return bt.liquid;
  }

  feetInLiquid(world: World): boolean {
    return this.isLiquid(world, this.pos.x, this.pos.y + 0.1, this.pos.z);
  }
  eyeInLiquid(world: World): boolean {
    return this.isLiquid(world, this.pos.x, this.pos.y + this.eye - 0.1, this.pos.z);
  }

  // check if AABB at given pos collides with solid terrain
  private collides(world: World, p: THREE.Vector3): boolean {
    const minX = Math.floor(p.x - this.halfW);
    const maxX = Math.floor(p.x + this.halfW);
    const minY = Math.floor(p.y);
    const maxY = Math.floor(p.y + this.height);
    const minZ = Math.floor(p.z - this.halfW);
    const maxZ = Math.floor(p.z + this.halfW);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++) {
          const b = world.getBlock(x, y, z);
          const bt = this.reg.getBlock(b);
          if (bt.solid) return true;
        }
    return false;
  }

  private moveAxis(world: World, axis: 'x' | 'y' | 'z', amount: number) {
    if (amount === 0) return;
    const p = this.pos.clone();
    if (axis === 'x') p.x += amount;
    else if (axis === 'y') p.y += amount;
    else p.z += amount;
    if (!this.collides(world, p)) {
      this.pos.copy(p);
      if (axis === 'y') {
        // landing detection handled below in y block
      }
      return;
    }
    // collision: snap
    if (axis === 'x') {
      if (amount > 0) this.pos.x = Math.floor(this.pos.x + this.halfW + amount) - this.halfW - EPS;
      else this.pos.x = Math.floor(this.pos.x - this.halfW + amount) + 1 + this.halfW + EPS;
      this.vel.x = 0;
    } else if (axis === 'z') {
      if (amount > 0) this.pos.z = Math.floor(this.pos.z + this.halfW + amount) - this.halfW - EPS;
      else this.pos.z = Math.floor(this.pos.z - this.halfW + amount) + 1 + this.halfW + EPS;
      this.vel.z = 0;
    } else {
      if (amount > 0) {
        // hit head
        this.pos.y = Math.floor(this.pos.y + this.height + amount) - this.height - EPS;
        this.vel.y = 0;
      } else {
        // land
        this.pos.y = Math.floor(this.pos.y + amount) + 1;
        if (!this.onGround && this.vel.y < -8) {
          // fall damage
          const fall = Math.max(0, this.fallStart - this.pos.y);
          const dmg = Math.floor(fall - 3);
          if (dmg > 0) this.damage(dmg);
        }
        this.fallStart = this.pos.y;
        this.vel.y = 0;
        this.onGround = true;
      }
    }
  }

  damage(amt: number) {
    if (this.creative || this.invuln > 0 || this.dead) return;
    this.health = Math.max(0, this.health - amt);
    this.hurtFlash = 0.6;
    this.invuln = 0.5;
    if (this.health <= 0) {
      this.dead = true;
      this.vel.set(0, 0, 0);
    }
  }

  heal(amt: number) {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + amt);
  }
  feed(amt: number) {
    this.hunger = Math.min(this.maxHunger, this.hunger + amt);
  }

  update(dt: number, input: InputState, world: World) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.dead) {
      // dead: just apply gravity, no input
      this.vel.y -= GRAVITY * dt;
      this.moveAxis(world, 'y', this.vel.y * dt);
      return;
    }

    const inWater = this.feetInLiquid(world);
    const eyeWater = this.eyeInLiquid(world);

    // movement direction from input
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is -z when yaw=0; we use: forward vector (−sin? ). Define:
    // yaw rotates around Y. forward = (-sin(yaw), 0, -cos(yaw))
    let fx = 0, fz = 0;
    if (input.forward) { fx += -sin; fz += -cos; }
    if (input.back) { fx += sin; fz += cos; }
    if (input.left) { fx += -cos; fz += sin; }
    if (input.right) { fx += cos; fz += -sin; }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    let speed = WALK;
    this.sprinting = input.sprint && input.forward && !input.crouch && this.hunger > 6;
    if (this.flying) speed = SPRINT * 1.8;
    else if (input.crouch) speed = CROUCH;
    else if (this.sprinting) speed = SPRINT;
    if (inWater && !this.flying) speed = SWIM;

    // horizontal velocity with acceleration ramp
    const accel = this.onGround || this.flying ? 12 : 4;
    const targetVx = fx * speed;
    const targetVz = fz * speed;
    this.vel.x += (targetVx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetVz - this.vel.z) * Math.min(1, accel * dt);

    // gravity / swimming / flying
    if (this.flying) {
      this.vel.y += (0 - this.vel.y) * Math.min(1, 10 * dt);
      if (input.jump) this.vel.y = 8;
      if (input.crouch) this.vel.y = -8;
    } else if (inWater) {
      this.vel.y -= GRAVITY * 0.25 * dt;
      this.vel.y *= 0.9; // water drag
      if (input.jump) this.vel.y = SWIM; // swim up
      // water horizontal drag
      this.vel.x *= 0.9;
      this.vel.z *= 0.9;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (input.jump && this.onGround) {
        this.vel.y = JUMP_VEL;
        this.onGround = false;
      }
    }

    // track fall start
    if (!this.onGround && this.vel.y < 0 && this.fallStart < this.pos.y) {
      // record highest point of this fall
    }
    if (this.onGround) this.fallStart = this.pos.y;
    else if (this.vel.y > 0) this.fallStart = this.pos.y;

    // move per-axis with sub-stepping to avoid tunneling
    this.onGround = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt / 0.2));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(world, 'x', this.vel.x * sdt);
      this.moveAxis(world, 'z', this.vel.z * sdt);
      this.moveAxis(world, 'y', this.vel.y * sdt);
    }
    // re-check ground (small downward probe)
    if (!this.flying && !inWater) {
      const probe = this.pos.clone();
      probe.y -= 0.05;
      if (this.collides(world, probe)) this.onGround = true;
    }

    // lava damage (skip in creative)
    if (!this.creative) {
      const feetBlock = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
      if (feetBlock === B.LAVA) this.damage(dt * 4);
    }

    // drowning (skip in creative)
    if (!this.creative && eyeWater) {
      this.airTimer += dt;
      if (this.airTimer > 12) {
        this.damage(2);
        this.airTimer = 8;
      }
    } else if (!this.creative) {
      this.airTimer = 0;
    }

    // hunger (skip in creative)
    if (!this.creative) {
      const moving = len > 0;
      this.hungerTimer += dt * (this.sprinting ? 0.3 : moving ? 0.1 : 0.04);
      if (this.hungerTimer > 1) {
        this.hunger = Math.max(0, this.hunger - 0.1);
        this.hungerTimer = 0;
      }
      if (this.hunger <= 0) {
        this.starveTimer += dt;
        if (this.starveTimer > 4) { this.damage(1); this.starveTimer = 0; }
      } else {
        this.starveTimer = 0;
      }
      if (this.hunger >= 18 && this.health < this.maxHealth) {
        this.regenTimer += dt;
        if (this.regenTimer > 0.5) { this.heal(1); this.regenTimer = 0; this.hunger = Math.max(0, this.hunger - 0.5); }
      } else {
        this.regenTimer = 0;
      }
    }
    const moving = len > 0;

    // head bob
    if (moving && this.onGround && !this.flying) {
      this.bobPhase += dt * (this.sprinting ? 14 : 10);
      this.bobAmt = Math.min(1, this.bobAmt + dt * 5);
    } else {
      this.bobAmt = Math.max(0, this.bobAmt - dt * 5);
    }
  }

  getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    const bob = Math.sin(this.bobPhase) * 0.05 * this.bobAmt;
    out.set(this.pos.x, this.pos.y + this.eye + bob, this.pos.z);
    return out;
  }

  getLookDir(out: THREE.Vector3): THREE.Vector3 {
    out.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    return out;
  }

  spawn(world: World, x: number, z: number) {
    const y = world.topSolid(x, z) + 1;
    this.pos.set(x + 0.5, y, z + 0.5);
    this.vel.set(0, 0, 0);
    this.fallStart = y;
    this.dead = false;
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.airTimer = 0;
  }
}
