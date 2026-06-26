import { ItemStack, ItemId } from './types';
import { Registry } from './blocks';

export class Inventory {
  slots: (ItemStack | null)[];
  reg: Registry;
  constructor(reg: Registry, size = 36) {
    this.reg = reg;
    this.slots = new Array(size).fill(null);
  }

  // add an item stack, returns leftover that didn't fit
  add(stack: ItemStack): ItemStack {
    const item = this.reg.getItem(stack.item);
    if (!item) return stack;
    const max = item.maxStack;
    // try to stack into existing
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.item === stack.item && s.count < max && s.durability === stack.durability) {
        const space = max - s.count;
        const move = Math.min(space, stack.count);
        s.count += move;
        stack.count -= move;
        if (stack.count <= 0) return stack;
      }
    }
    // place into empty slots
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        const move = Math.min(max, stack.count);
        this.slots[i] = { item: stack.item, count: move, durability: stack.durability };
        stack.count -= move;
        if (stack.count <= 0) return stack;
      }
    }
    return stack;
  }

  // remove count of item from a specific slot; returns true if succeeded
  removeFrom(slot: number, count: number): boolean {
    const s = this.slots[slot];
    if (!s || s.count < count) return false;
    s.count -= count;
    if (s.count <= 0) this.slots[slot] = null;
    return true;
  }

  // consume one item from slot (for placing/using)
  consumeOne(slot: number) {
    this.removeFrom(slot, 1);
  }

  clear() {
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = null;
  }

  // swap two slots
  swap(a: number, b: number) {
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
  }

  // get hotbar slot
  hotbar(i: number): ItemStack | null {
    return this.slots[i];
  }

  serialize(): (ItemStack | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  load(data: (ItemStack | null)[]) {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i] = data[i] ? { ...data[i]! } : null;
    }
  }

  countItem(item: ItemId): number {
    let c = 0;
    for (const s of this.slots) if (s && s.item === item) c += s.count;
    return c;
  }

  removeItems(item: ItemId, count: number): boolean {
    if (this.countItem(item) < count) return false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s || s.item !== item) continue;
      const take = Math.min(s.count, count);
      s.count -= take;
      count -= take;
      if (s.count <= 0) this.slots[i] = null;
      if (count <= 0) return true;
    }
    return true;
  }
}
