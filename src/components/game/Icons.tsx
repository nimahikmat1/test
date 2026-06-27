'use client';
import { VoxelEngine } from '@/game/engine';
import { ItemStack } from '@/game/types';

export function Heart({ full }: { full: 'full' | 'half' | 'empty' }) {
  const fill = full === 'empty' ? '#3a1414' : '#e23b3b';
  const halfFill = full === 'half';
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" style={{ imageRendering: 'pixelated', display: 'block' }}>
      <path d="M2 3h2v1H2zM4 2h3v1H4zM7 2h2v1H7zM9 2h3v1H9zM12 3h2v1h-2zM2 4h1v4H2zM13 4h1v4h-1zM3 8h1v2H3zM12 8h1v2h-1zM4 10h1v1H4zM11 10h1v1h-1zM5 11h1v1H5zM10 11h1v1h-1zM6 12h4v1H6z" fill={fill} />
      {halfFill && <path d="M2 3h2v1H2zM4 2h3v1H4zM2 4h1v4H2zM3 8h1v2H3zM4 10h1v1H4zM5 11h1v1H5zM6 12h2v1H6z" fill="#3a1414" />}
    </svg>
  );
}

export function Food({ full }: { full: 'full' | 'half' | 'empty' }) {
  const fill = full === 'empty' ? '#3a2a14' : '#c97a3a';
  const halfFill = full === 'half';
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" style={{ imageRendering: 'pixelated', display: 'block' }}>
      <path d="M4 3h5v1H4zM3 4h7v3H3zM4 7h6v1H4zM5 8h5v1H5zM9 9h2v1H9zM10 10h2v1h-2zM11 11h2v1h-2zM12 12h2v1h-2z" fill={fill} />
      <path d="M9 3h2v1H9zM10 4h2v1h-2zM11 5h2v1h-2zM12 6h2v1h-2z" fill="#caa" />
      {halfFill && <path d="M3 4h3v3H3zM4 7h2v1H4zM5 8h2v1H5z" fill="#3a2a14" />}
    </svg>
  );
}

export function Bubble({ full }: { full: boolean }) {
  const fill = full ? '#cfeaf2' : '#2a4a5a';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ imageRendering: 'pixelated', display: 'block' }}>
      <path d="M5 3h6v1H5zM3 4h2v2H3zM11 4h2v2h-2zM3 9h2v2H3zM11 9h2v2h-2zM5 11h6v1H5zM5 4h6v7H5z" fill={fill} />
      <path d="M5 4h2v2H5z" fill={full ? '#ffffff' : '#3a5a6a'} />
    </svg>
  );
}

export function ItemIcon({ engine, item, size = 36 }: { engine: VoxelEngine; item: ItemStack | null; size?: number }) {
  if (!item) return null;
  const url = engine.iconDataURL(item.item);
  const it = engine.reg.getItem(item.item);
  const durFrac = it?.durability && item.durability != null ? item.durability / it.durability : null;
  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      {url && (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          style={{ imageRendering: 'pixelated', display: 'block', filter: it?.category === 'tool' ? 'drop-shadow(0 1px 0 #0008)' : 'none' }}
        />
      )}
      {item.count > 1 && (
        <span
          style={{
            position: 'absolute', right: 1, bottom: 0, fontSize: 13, fontWeight: 700,
            color: '#fff', textShadow: '1px 1px 0 #000, 2px 2px 0 #000',
            fontFamily: 'monospace', lineHeight: 1,
          }}
        >
          {item.count}
        </span>
      )}
      {durFrac != null && (
        <div style={{ position: 'absolute', left: 1, right: 1, bottom: 1, height: 3, background: '#000' }}>
          <div style={{ width: `${Math.max(0, durFrac) * 100}%`, height: '100%', background: durFrac > 0.5 ? '#5fe35f' : durFrac > 0.2 ? '#e3c85f' : '#e35f5f' }} />
        </div>
      )}
    </div>
  );
}

export function Slot({
  engine, item, id, selected, onClick, size = 44,
}: {
  engine: VoxelEngine; item: ItemStack | null; id: number; selected?: boolean; onClick: (id: number, button: number) => void; size?: number;
}) {
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); onClick(id, e.button); }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: size, height: size, background: 'rgba(120,120,120,0.55)',
        border: selected ? '2px solid #f7f7f7' : '2px solid #2a2a2a',
        boxShadow: 'inset -2px -2px 0 #0006, inset 2px 2px 0 #fff3',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    >
      <ItemIcon engine={engine} item={item} size={size - 8} />
    </div>
  );
}
