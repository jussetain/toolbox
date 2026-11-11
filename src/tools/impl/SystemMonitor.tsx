// Moniteur de ressources : processeur, mémoire, réseau, disques et applis gourmandes, rafraîchis chaque seconde.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes } from "../../lib/api";
import { ErrorNote, Seg } from "../../components/ui";

interface Proc { name: string; cpu: number; memory: number; count: number; pids: number[] }
interface Snap {
  warmup: boolean;
  cpu: { total: number; cores: number[]; brand: string; frequency: number };
  memory: { total: number; used: number; available: number; swapTotal: number; swapUsed: number };
  network: { rx: number; tx: number };
  disks: { mount: string; name: string; total: number; available: number; removable: boolean }[];
  processCount: number;
  uptime: number;
  processes: Proc[];
}

const HISTORY = 60;
// Couleur de la catégorie Système : traits en teinte, textes en encre.
const SERIES = "#1D6B63";
const FILL = "rgba(79, 179, 169, 0.18)";
const pct = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} %`;
const rate = (b: number) => `${formatBytes(b)}/s`;
const uptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};

export function SystemMonitor() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [hist, setHist] = useState<{ cpu: number[]; mem: number[]; rx: number[]; tx: number[] }>({ cpu: [], mem: [], rx: [], tx: [] });
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<"cpu" | "memory">("cpu");
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await invoke<Snap>("system_snapshot");
        if (!live) return;
        setSnap(s);
        setErr(null);
        if (!s.warmup) {
          const push = (a: number[], v: number) => [...a, v].slice(-HISTORY);
          setHist((h) => ({ cpu: push(h.cpu, s.cpu.total), mem: push(h.mem, (s.memory.used / s.memory.total) * 100), rx: push(h.rx, s.network.rx), tx: push(h.tx, s.network.tx) }));
        }
      } catch (e) { if (live) setErr(String(e)); }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { live = false; clearInterval(t); };
  }, [paused]);

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!snap) return <p className="muted">Mesure en cours…</p>;
  const m = snap.memory;
  const procs = [...snap.processes].sort((a, b) => (sort === "cpu" ? b.cpu - a.cpu || b.memory - a.memory : b.memory - a.memory)).slice(0, 15);
  return (
    <div className="tool-body">
      <div className="mon-grid">
        <section className="card mon-card" aria-label="Processeur">
          <div className="mon-head"><span className="mon-title">Processeur</span><span className="mon-value">{snap.warmup ? "…" : pct(snap.cpu.total)}</span></div>
          <Spark values={hist.cpu} max={100} format={pct} label="Processeur, 60 dernières secondes" />
          <div className="cores" title="Un trait par cœur logique">
            {snap.cpu.cores.map((c, i) => <div key={i} aria-label={`Cœur ${i + 1} : ${pct(c)}`}><span style={{ height: `${Math.min(100, c)}%`, background: SERIES }} /></div>)}
          </div>
          <span className="mon-sub">{snap.cpu.brand || "Processeur"} · {snap.cpu.cores.length} cœurs logiques{snap.cpu.frequency ? ` · ${(snap.cpu.frequency / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} GHz` : ""}</span>
        </section>
        <section className="card mon-card" aria-label="Mémoire">
          <div className="mon-head"><span className="mon-title">Mémoire</span><span className="mon-value">{pct((m.used / m.total) * 100)}</span></div>
          <Spark values={hist.mem} max={100} format={pct} label="Mémoire utilisée, 60 dernières secondes" />
          <span className="mon-sub">{formatBytes(m.used)} utilisés sur {formatBytes(m.total)} · {formatBytes(m.available)} libres</span>
          {m.swapTotal > 0 && <span className="mon-sub">Fichier d'échange : {formatBytes(m.swapUsed)} sur {formatBytes(m.swapTotal)}</span>}
        </section>
        <section className="card mon-card" aria-label="Réseau">
          <div className="mon-head"><span className="mon-title">Réseau</span><span className="mon-sub">↓ {rate(snap.network.rx)} · ↑ {rate(snap.network.tx)}</span></div>
          <span className="mon-sub">Réception</span>
          <Spark values={hist.rx} format={rate} label="Réception, 60 dernières secondes" />
          <span className="mon-sub">Envoi</span>
          <Spark values={hist.tx} format={rate} label="Envoi, 60 dernières secondes" />
        </section>
        <section className="card mon-card" aria-label="Disques">
          <div className="mon-head"><span className="mon-title">Disques</span><span className="mon-sub">Allumé depuis {uptime(snap.uptime)}</span></div>
          {snap.disks.map((d) => {
            const used = d.total - d.available;
            return (
              <div key={d.mount} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="mon-head"><strong>{d.mount}{d.name && d.name !== d.mount ? ` ${d.name}` : ""}</strong><span className="mon-sub">{formatBytes(d.available)} libres sur {formatBytes(d.total)}</span></div>
                <div className="bar"><div style={{ width: `${(used / d.total) * 100}%`, background: used / d.total > 0.9 ? "#A3271F" : SERIES }} /></div>
              </div>
            );
          })}
        </section>
      </div>
      <div className="row">
        <h2 className="field-label" style={{ margin: 0 }}>Applis et processus ({snap.processCount})</h2>
        <Seg label="Trier par" value={sort} onChange={setSort} options={[{ id: "cpu", label: "Processeur" }, { id: "memory", label: "Mémoire" }]} />
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setPaused(!paused)}>{paused ? "Reprendre ▶" : "Figer ❚❚"}</button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Nom</th><th className="num">Processeur</th><th className="num">Mémoire</th><th /></tr></thead>
          <tbody>{procs.map((p) => <ProcRow key={p.name} p={p} onKilled={() => setPaused(false)} />)}</tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0 }}>Les processus du même nom sont regroupés, comme dans le Gestionnaire des tâches. Fermer une appli de force peut faire perdre un travail non enregistré.</p>
    </div>
  );
}

function ProcRow({ p, onKilled }: { p: Proc; onKilled: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!confirm) return; const t = setTimeout(() => setConfirm(false), 4000); return () => clearTimeout(t); }, [confirm]);
  const kill = async () => {
    try { await invoke<number>("process_kill", { pids: p.pids }); setMsg("Fermé"); onKilled(); } catch (e) { setMsg(String(e)); }
    setConfirm(false);
  };
  return (
    <tr>
      <td><strong>{p.name}</strong>{p.count > 1 && <span className="muted"> ×{p.count}</span>}{msg && <div className="mon-sub">{msg}</div>}</td>
      <td className="num">{p.cpu.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %</td>
      <td className="num">{formatBytes(p.memory)}</td>
      <td className="num">
        {confirm
          ? <button className="btn btn-sm btn-primary" onClick={kill}>Confirmer</button>
          : <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>Fermer</button>}
      </td>
    </tr>
  );
}

/** Courbe des 60 dernières secondes, avec valeur au survol. */
function Spark({ values, max, format, label }: { values: number[]; max?: number; format: (n: number) => string; label: string }) {
  const W = 300, H = 64;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const top = max ?? Math.max(1024, ...values) * 1.15;
  const x = (i: number) => W - (values.length - 1 - i) * (W / (HISTORY - 1));
  const y = (v: number) => H - 2 - (Math.min(v, top) / top) * (H - 4);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = values.length > 1 ? `${line}L${x(values.length - 1)},${H}L${x(0)},${H}Z` : "";
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(values.length - 1 - (W - px) / (W / (HISTORY - 1)));
    setHover(i >= 0 && i < values.length ? i : null);
  };
  return (
    <div className="spark-wrap">
      <svg ref={ref} className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke="rgba(31,27,22,0.25)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {area && <path d={area} fill={FILL} />}
        {line && <path d={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && <span className="spark-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>{format(values[hover])} · il y a {values.length - 1 - hover} s</span>}
    </div>
  );
}
