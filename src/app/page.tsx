'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { VoxelEngine, EngineSnapshot } from '@/game/engine';
import { ItemStack } from '@/game/types';
import { Heart, Food, ItemIcon, Slot } from '@/components/game/Icons';

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [started, setStarted] = useState(false);
  const [hasAutosave, setHasAutosave] = useState(false);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [dayLen, setDayLen] = useState(600);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new VoxelEngine();
    engineRef.current = engine;
    engine.init(containerRef.current);
    engine.onState = (s) => setSnap(s);
    engine.start();
    try { setHasAutosave(!!localStorage.getItem('voxel_save_autosave')); } catch {}
    return () => engine.dispose();
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);

  const eng = () => engineRef.current;

  const newGame = () => { eng()?.newGame(); setStarted(true); };
  const continueGame = () => { if (eng()?.loadAutosaveIfExists()) { setStarted(true); } };
  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result));
        eng()?.importSave(data);
        setStarted(true);
      } catch (err) { alert('Invalid save file'); }
    };
    r.readAsText(f);
  };

  const clickSlot = useCallback((id: number, button: number) => {
    eng()?.clickSlot(id, button);
  }, []);

  const hearts = (hp: number) => {
    const out: ('full' | 'half' | 'empty')[] = [];
    for (let i = 0; i < 10; i++) {
      const v = hp - i * 2;
      out.push(v >= 2 ? 'full' : v === 1 ? 'half' : 'empty');
    }
    return out;
  };

  const timeLabel = (t: number) => {
    const hours = Math.floor(t * 24);
    const mins = Math.floor((t * 24 * 60) % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#000', fontFamily: 'monospace' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Hurt vignette */}
      {started && snap && snap.health < 8 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: `inset 0 0 ${120 + (8 - snap.health) * 16}px rgba(180,0,0,${0.55 + 0.04 * Math.sin(Date.now() / 200)})` }} />
      )}
      {started && snap && snap.health < snap.maxHealth && snap.health > 0 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 80px rgba(180,0,0,0.25)' }} />
      )}

      {/* HUD */}
      {started && snap && !snap.paused && !snap.inventoryOpen && (
        <>
          {/* crosshair */}
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
            <div style={{ position: 'relative', width: snap.targetBlock ? 22 : 18, height: snap.targetBlock ? 22 : 18 }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, width: 2, height: '100%', background: snap.targetBlock ? '#fff' : 'rgba(255,255,255,0.8)', transform: 'translateX(-50%)', mixBlendMode: 'difference' }} />
              <div style={{ position: 'absolute', top: '50%', left: 0, height: 2, width: '100%', background: snap.targetBlock ? '#fff' : 'rgba(255,255,255,0.8)', transform: 'translateY(-50%)', mixBlendMode: 'difference' }} />
            </div>
          </div>

          {/* top-left info */}
          <div style={{ position: 'absolute', left: 8, top: 8, color: '#fff', textShadow: '1px 1px 0 #000', fontSize: 13, lineHeight: 1.5, pointerEvents: 'none' }}>
            <div>FPS: {snap.fps}</div>
            <div>Biome: {snap.biome}</div>
            <div>Time: {timeLabel(snap.timeOfDay)} {snap.timeOfDay > 0.5 ? '🌙' : '☀'}</div>
            <div>Mobs: {snap.mobCount}</div>
            {snap.targetBlock && <div style={{ color: '#ffd24a' }}>► {snap.targetBlock}</div>}
            {snap.message && <div style={{ color: '#9ff7c0' }}>{snap.message}</div>}
          </div>

          {/* hotbar + stats */}
          <div style={{ position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', gap: 2 }}>
              {hearts(snap.health).map((h, i) => <Heart key={i} full={h} />)}
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              {hearts(snap.hunger).map((h, i) => <Food key={i} full={h} />)}
            </div>
            <div style={{ display: 'flex', gap: 2, padding: 4, background: 'rgba(0,0,0,0.45)', border: '2px solid #2a2a2a' }}>
              {snap.hotbar.map((it, i) => (
                <Slot key={i} engine={eng()!} item={it} id={i} selected={i === snap.selected} onClick={clickSlot} size={46} />
              ))}
            </div>
          </div>

          {/* controls hint */}
          <div style={{ position: 'absolute', right: 8, bottom: 8, color: '#fff', textShadow: '1px 1px 0 #000', fontSize: 11, textAlign: 'right', pointerEvents: 'none', opacity: 0.7 }}>
            <div>WASD move · Space jump · Shift sprint</div>
            <div>L-click break · R-click place · Wheel/1-9 select</div>
            <div>E inventory · Esc pause · F fly</div>
          </div>
        </>
      )}

      {/* Inventory / Crafting / Furnace overlay */}
      {started && snap && snap.inventoryOpen && eng() && (
        <InventoryOverlay snap={snap} engine={eng()!} clickSlot={clickSlot} mouse={mouse} dayLen={dayLen} setDayLen={setDayLen} />
      )}

      {/* Pause menu */}
      {started && snap && snap.paused && eng() && (
        <PauseOverlay engine={eng()!} snap={snap} dayLen={dayLen} setDayLen={setDayLen} fileRef={fileRef} onImport={onImport} onQuit={() => { try { setHasAutosave(!!localStorage.getItem('voxel_save_autosave')); } catch {} setStarted(false); }} />
      )}

      {/* Start screen */}
      {!started && (
        <StartScreen hasAutosave={hasAutosave} onNew={newGame} onContinue={continueGame} onImport={() => fileRef.current?.click()} />
      )}
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImport} />
    </div>
  );
}

function StartScreen({ hasAutosave, onNew, onContinue, onImport }: { hasAutosave: boolean; onNew: () => void; onContinue: () => void; onImport: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,20,0.85)', color: '#fff', gap: 16 }}>
      <h1 style={{ fontSize: 42, letterSpacing: 4, textShadow: '3px 3px 0 #000', margin: 0, color: '#7fd0ff' }}>VOXELCRAFT</h1>
      <p style={{ margin: 0, opacity: 0.8, fontSize: 13 }}>A browser-based voxel sandbox</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        <MenuButton onClick={onNew}>New World</MenuButton>
        {hasAutosave && <MenuButton onClick={onContinue}>Continue</MenuButton>}
        <MenuButton onClick={onImport}>Import Save</MenuButton>
      </div>
      <div style={{ position: 'absolute', bottom: 16, fontSize: 11, opacity: 0.6, textAlign: 'center' }}>
        Tip: Click the game to lock the mouse. Press E for inventory, Esc to pause, F to fly.
      </div>
    </div>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 28px', fontFamily: 'monospace', fontSize: 16, fontWeight: 700,
        color: '#fff', background: 'linear-gradient(#6a6a6a,#3a3a3a)', border: '2px solid #1a1a1a',
        boxShadow: 'inset 2px 2px 0 #fff4, inset -2px -2px 0 #0006', cursor: 'pointer', minWidth: 220,
      }}
    >
      {children}
    </button>
  );
}

function PauseOverlay({ engine, snap, dayLen, setDayLen, fileRef, onImport, onQuit }: {
  engine: VoxelEngine; snap: EngineSnapshot; dayLen: number; setDayLen: (n: number) => void; fileRef: React.RefObject<HTMLInputElement | null>; onImport: (e: React.ChangeEvent<HTMLInputElement>) => void; onQuit: () => void;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}>
      <div style={{ background: 'rgba(20,20,28,0.95)', border: '2px solid #000', padding: 24, color: '#fff', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: '0 0 8px 0', textAlign: 'center' }}>Paused</h2>
        <MenuButton onClick={() => engine.togglePause()}>Resume</MenuButton>
        <MenuButton onClick={() => { engine.respawn(); }}>Respawn</MenuButton>
        <MenuButton onClick={() => { engine.toggleFly(); }}>{snap.fly ? 'Fly: OFF' : 'Fly: ON'}</MenuButton>
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>Day length: {dayLen}s</label>
          <input type="range" min={120} max={1800} step={60} value={dayLen} onChange={(e) => { const n = +e.target.value; setDayLen(n); engine.setDayLength(n); }} style={{ width: '100%' }} />
        </div>
        <MenuButton onClick={() => engine.exportSave()}>Export Save</MenuButton>
        <MenuButton onClick={() => fileRef.current?.click()}>Import Save</MenuButton>
        <MenuButton onClick={() => { engine.autosave(); alert('Game saved.'); }}>Save Now</MenuButton>
        <MenuButton onClick={onQuit}>Quit to Menu</MenuButton>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImport} />
    </div>
  );
}

function InventoryOverlay({ snap, engine, clickSlot, mouse }: {
  snap: EngineSnapshot; engine: VoxelEngine; clickSlot: (id: number, button: number) => void; mouse: { x: number; y: number }; dayLen: number; setDayLen: (n: number) => void;
}) {
  const slot = (id: number, item: ItemStack | null, size = 44, selected = false) => (
    <Slot engine={engine} item={item} id={id} selected={selected} onClick={clickSlot} size={size} />
  );

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}
    >
      <div style={{ background: 'rgba(30,30,38,0.96)', border: '2px solid #000', padding: 16, color: '#fff', boxShadow: 'inset 2px 2px 0 #fff3, inset -2px -2px 0 #0006' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 10, letterSpacing: 2 }}>
          {snap.furnaceOpen ? 'FURNACE' : snap.craftSize === 3 ? 'CRAFTING TABLE' : 'INVENTORY'}
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {/* Left: crafting or furnace */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            {snap.furnaceOpen ? (
              <FurnacePanel snap={snap} slot={slot} />
            ) : (
              <CraftingPanel snap={snap} slot={slot} />
            )}
          </div>

          {/* Right: player inventory */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 44px)', gap: 2 }}>
              {snap.inventory.slice(9, 36).map((it, i) => (
                <div key={i}>{slot(9 + i, it)}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 44px)', gap: 2, marginTop: 4 }}>
              {snap.inventory.slice(0, 9).map((it, i) => (
                <div key={i}>{slot(i, it, 44, i === snap.selected)}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, opacity: 0.6 }}>
          Left-click: pick up / merge · Right-click: split / place one · Press E or Esc to close
        </div>
      </div>

      {/* held item follows cursor */}
      {snap.held && (
        <div style={{ position: 'fixed', left: mouse.x - 18, top: mouse.y - 18, pointerEvents: 'none', zIndex: 50 }}>
          <ItemIcon engine={engine} item={snap.held} size={36} />
        </div>
      )}
    </div>
  );
}

function CraftingPanel({ snap, slot }: { snap: EngineSnapshot; slot: (id: number, item: ItemStack | null, size?: number, selected?: boolean) => React.ReactNode }) {
  const n = snap.craftSize;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 44px)`, gap: 2 }}>
        {snap.craftGrid.map((it, i) => (
          <div key={i}>{slot(100 + i, it)}</div>
        ))}
      </div>
      <div style={{ fontSize: 20 }}>➜</div>
      {slot(200, snap.craftOutput, 52, false)}
    </div>
  );
}

function FurnacePanel({ snap, slot }: { snap: EngineSnapshot; slot: (id: number, item: ItemStack | null, size?: number, selected?: boolean) => React.ReactNode }) {
  const f = snap.furnace;
  const burnPct = f.burn > 0 ? Math.min(1, f.burn / 20) : 0;
  const progPct = f.maxProgress > 0 ? f.progress / f.maxProgress : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {slot(300, f.input, 48)}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: '#ffae42' }}>FUEL</div>
          <div style={{ width: 14, height: 28, border: '1px solid #000', background: '#222', overflow: 'hidden' }}>
            <div style={{ width: '100%', height: `${burnPct * 100}%`, background: 'linear-gradient(#ffd24a,#e0531a)', marginTop: 'auto', position: 'relative', top: `${(1 - burnPct) * 100}%` }} />
          </div>
        </div>
        {slot(301, f.fuel, 48)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 60, height: 8, border: '1px solid #000', background: '#222' }}>
          <div style={{ width: `${progPct * 100}%`, height: '100%', background: '#7fd0ff' }} />
        </div>
        <div style={{ fontSize: 18 }}>➜</div>
        {slot(302, f.output, 48)}
      </div>
    </div>
  );
}
