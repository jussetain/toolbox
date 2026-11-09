// 85 JSON · 86 Base64 · 88 UUID · 89 JWT · 90 Timestamp
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  decodeBase64Text, decodeJwt, encodeBase64Text, formatJson, guessUnit, inspectUuid, relativeTime, timestampToDate,
  uuidV4, uuidV7, verifyJwtHmac, type DecodedJwt, type TsUnit,
} from "../logic/dev";
import { api } from "../../lib/api";
import { CopyButton, ErrorNote, Seg, TextField, Toggle } from "../../components/ui";

const fmtDate = (d: Date, tz?: string) =>
  d.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "long", timeZone: tz });

// ── 85 ──
export function JsonFormatter() {
  const [input, setInput] = useState("");
  const [indent, setIndent] = useState<number | "\t">(2);
  const [minify, setMinify] = useState(false);
  const [sort, setSort] = useState(false);
  const r = useMemo(() => formatJson(input, minify ? 0 : indent, sort), [input, indent, minify, sort]);
  const out = r.ok ? r.output : "";
  return (
    <div className="tool-body">
      <div className="row">
        <Seg label="Mode" value={minify ? "min" : "fmt"} onChange={(v) => setMinify(v === "min")} options={[{ id: "fmt", label: "Formater" }, { id: "min", label: "Minifier" }]} />
        {!minify && (
          <Seg label="Indentation" value={indent} onChange={setIndent} options={[{ id: 2, label: "2 espaces" }, { id: 4, label: "4 espaces" }, { id: "\t", label: "Tabulation" }]} />
        )}
        <Toggle checked={sort} onChange={setSort}>Trier les clés</Toggle>
      </div>
      <div className="grid-2">
        <TextField label="Entrée" value={input} onChange={setInput} rows={20} invalid={!r.ok && !!input.trim()} placeholder='{"exemple": true}' />
        <TextField
          label="Résultat"
          value={out}
          readOnly
          rows={20}
          actions={
            <>
              {r.ok ? <span className="status-ok">✓ JSON valide · {r.lines} lignes</span> : null}
              <CopyButton text={out} />
            </>
          }
        />
      </div>
      {!r.ok && input.trim() && (
        <ErrorNote>
          {r.line ? `Ligne ${r.line}, colonne ${r.column} : ` : ""}
          {r.message}
        </ErrorNote>
      )}
    </div>
  );
}

// ── 86 ──
export function Base64Tool() {
  const [source, setSource] = useState<"text" | "file">("text");
  const [dir, setDir] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("");
  const [urlSafe, setUrlSafe] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [fileOut, setFileOut] = useState("");
  const [fileName, setFileName] = useState("decode.bin");
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const textOut = useMemo(() => {
    if (source !== "text" || !input) return { out: "", err: null as string | null };
    try {
      return { out: dir === "encode" ? encodeBase64Text(input, urlSafe, wrap ? 76 : 0) : decodeBase64Text(input), err: null };
    } catch (e) {
      return { out: "", err: dir === "decode" ? "Ce n'est pas du Base64 valide, ou le contenu n'est pas du texte (passe en mode Fichier)." : String(e) };
    }
  }, [source, input, dir, urlSafe, wrap]);

  const pickAndEncode = async () => {
    const p = await open({ multiple: false });
    if (typeof p !== "string") return;
    setErr(null);
    try {
      let b64 = await invoke<string>("base64_encode_file", { path: p, urlSafe });
      if (wrap) b64 = b64.match(/.{1,76}/g)?.join("\n") ?? b64;
      setFileOut(b64);
    } catch (e) {
      setErr(String(e));
    }
  };

  const decodeToFile = async () => {
    setErr(null);
    try {
      setSaved(await invoke<string>("base64_decode_to_file", { data: input, fileName }));
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="tool-body">
      <div className="row">
        <Seg label="Source" value={source} onChange={(v) => (setSource(v), setSaved(null), setErr(null))} options={[{ id: "text", label: "Texte" }, { id: "file", label: "Fichier" }]} />
        <Seg label="Sens" value={dir} onChange={setDir} options={[{ id: "encode", label: "Encoder" }, { id: "decode", label: "Décoder" }]} />
        {dir === "encode" && (
          <>
            <Toggle checked={urlSafe} onChange={setUrlSafe}>Variante URL</Toggle>
            <Toggle checked={wrap} onChange={setWrap}>Couper à 76 caractères</Toggle>
          </>
        )}
      </div>
      {source === "text" ? (
        <div className="grid-2">
          <TextField label={dir === "encode" ? "Texte" : "Base64"} value={input} onChange={setInput} rows={14} />
          <TextField label={dir === "encode" ? "Base64" : "Texte"} value={textOut.out} readOnly rows={14} actions={<CopyButton text={textOut.out} />} />
        </div>
      ) : dir === "encode" ? (
        <>
          <div className="row"><button className="btn" onClick={pickAndEncode}>Choisir un fichier…</button></div>
          {fileOut && <TextField label="Base64" value={fileOut} readOnly rows={12} actions={<CopyButton text={fileOut} />} />}
        </>
      ) : (
        <>
          <TextField label="Base64" value={input} onChange={setInput} rows={12} placeholder="Colle le Base64 (un préfixe data:…;base64, est accepté)" />
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">Nom du fichier</span>
              <input className="input" type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </label>
            <button className="btn btn-primary" style={{ alignSelf: "flex-end" }} disabled={!input.trim()} onClick={decodeToFile}>Enregistrer →</button>
          </div>
          {saved && (
            <div className="row">
              <span className="status-ok">✓ Enregistré</span>
              <span className="muted selectable mono" style={{ fontSize: 13 }}>{saved}</span>
              <button className="btn btn-sm" onClick={() => api.reveal(saved)}>Afficher</button>
            </div>
          )}
        </>
      )}
      {(textOut.err || err) && <ErrorNote>{textOut.err ?? err}</ErrorNote>}
    </div>
  );
}

// ── 88 ──
export function UuidGenerator() {
  const [version, setVersion] = useState<4 | 7>(4);
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [braces, setBraces] = useState(false);
  const [list, setList] = useState<string[]>([]);
  const [probe, setProbe] = useState("");

  const generate = () => {
    const n = Math.min(Math.max(count, 1), 10000);
    setList(Array.from({ length: n }, () => {
      let u = version === 4 ? uuidV4() : uuidV7();
      if (!hyphens) u = u.replace(/-/g, "");
      if (upper) u = u.toUpperCase();
      return braces ? `{${u}}` : u;
    }));
  };
  useEffect(generate, [version, count, upper, hyphens, braces]);

  const info = probe.trim() ? inspectUuid(probe) : null;
  const text = list.join("\n");
  return (
    <div className="tool-body">
      <div className="row">
        <Seg label="Version" value={version} onChange={setVersion} options={[{ id: 4, label: "v4 aléatoire" }, { id: 7, label: "v7 horodaté" }]} />
        <label className="field" style={{ width: 110 }}>
          <span className="sr-only">Nombre</span>
          <input className="input" type="number" min={1} max={10000} value={count} onChange={(e) => setCount(+e.target.value)} aria-label="Nombre d'UUID" />
        </label>
        <Toggle checked={upper} onChange={setUpper}>Majuscules</Toggle>
        <Toggle checked={hyphens} onChange={setHyphens}>Tirets</Toggle>
        <Toggle checked={braces} onChange={setBraces}>Accolades</Toggle>
      </div>
      <TextField label={`${list.length} UUID`} value={text} readOnly rows={Math.min(12, Math.max(4, list.length))} actions={<><button className="btn btn-sm" onClick={generate}>Régénérer</button><CopyButton text={text} /></>} />
      <div className="field">
        <span className="field-label">Inspecter un UUID</span>
        <input className="input mono" type="text" aria-label="UUID à inspecter" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Colle un UUID" />
      </div>
      {info && (info.valid ? (
        <dl className="kv card" style={{ padding: 16 }}>
          <dt>Version</dt><dd>{info.nil ? (info.version === 0 ? "nil" : "max") : `v${info.version}`}</dd><span />
          <dt>Variante</dt><dd>{info.variant}</dd><span />
          {info.date && (<><dt>Créé le</dt><dd>{fmtDate(info.date)}</dd><span /></>)}
        </dl>
      ) : <ErrorNote>Ce n'est pas un UUID valide.</ErrorNote>)}
    </div>
  );
}

// ── 89 ──
const CLAIMS: Record<string, string> = {
  iss: "Émetteur", sub: "Sujet", aud: "Audience", exp: "Expire le", nbf: "Valide à partir du", iat: "Émis le", jti: "Identifiant",
};

export function JwtDecoder() {
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [verified, setVerified] = useState<boolean | null | undefined>(undefined);

  const decoded = useMemo((): { jwt?: DecodedJwt; err?: string } => {
    if (!token.trim()) return {};
    try {
      return { jwt: decodeJwt(token) };
    } catch (e) {
      return { err: (e as Error).message };
    }
  }, [token]);

  useEffect(() => {
    if (!decoded.jwt || !secret) return setVerified(undefined);
    verifyJwtHmac(decoded.jwt, secret).then(setVerified);
  }, [decoded.jwt, secret]);

  const p = decoded.jwt?.payload ?? {};
  const now = Date.now() / 1000;
  const exp = typeof p.exp === "number" ? p.exp : undefined;
  const nbf = typeof p.nbf === "number" ? p.nbf : undefined;
  const state = exp && exp < now ? "Expiré" : nbf && nbf > now ? "Pas encore valide" : exp ? "En cours de validité" : null;

  return (
    <div className="tool-body">
      <TextField label="Jeton" value={token} onChange={setToken} rows={5} placeholder="eyJhbGciOi…" invalid={!!decoded.err} />
      {decoded.err && <ErrorNote>{decoded.err}</ErrorNote>}
      {decoded.jwt && (
        <>
          {state && <span className={state === "En cours de validité" ? "status-ok" : "status-bad"}>{state === "En cours de validité" ? "✓ " : "✗ "}{state}</span>}
          <div className="grid-2">
            <TextField label="En-tête" value={JSON.stringify(decoded.jwt.header, null, 2)} readOnly rows={8} />
            <TextField label="Contenu" value={JSON.stringify(p, null, 2)} readOnly rows={8} actions={<CopyButton text={JSON.stringify(p, null, 2)} />} />
          </div>
          {Object.keys(CLAIMS).some((k) => k in p) && (
            <dl className="kv card" style={{ padding: 16 }}>
              {Object.entries(CLAIMS).filter(([k]) => k in p).map(([k, label]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{label} <span className="muted mono" style={{ fontWeight: 400 }}>({k})</span></dt>
                  <dd>{["exp", "nbf", "iat"].includes(k) && typeof p[k] === "number"
                    ? `${fmtDate(new Date((p[k] as number) * 1000))} — ${relativeTime(new Date((p[k] as number) * 1000))}`
                    : JSON.stringify(p[k])}</dd>
                  <span />
                </div>
              ))}
            </dl>
          )}
          <div className="field">
            <span className="field-label">Vérifier la signature ({String(decoded.jwt.header.alg)})</span>
            <input className="input mono" type="text" aria-label="Secret HMAC" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret partagé (HS256, HS384, HS512)" />
          </div>
          {verified === true && <span className="status-ok">✓ Signature valide</span>}
          {verified === false && <span className="status-bad">✗ Signature invalide pour ce secret</span>}
          {verified === null && <span className="muted">Seules les signatures HMAC (HS256/384/512) se vérifient avec un secret.</span>}
        </>
      )}
    </div>
  );
}

// ── 90 ──
const ZONES = ["UTC", "Europe/Paris", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"];
const UNITS: { id: TsUnit | "auto"; label: string }[] = [
  { id: "auto", label: "Auto" }, { id: "s", label: "Secondes" }, { id: "ms", label: "Millisecondes" }, { id: "us", label: "Microsecondes" }, { id: "ns", label: "Nanosecondes" },
];

export function TimestampConverter() {
  const [ts, setTs] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [unit, setUnit] = useState<TsUnit | "auto">("auto");
  const [local, setLocal] = useState("");

  const used: TsUnit = unit === "auto" ? guessUnit(ts.trim()) : unit;
  const date = /^-?\d+(\.\d+)?$/.test(ts.trim()) ? timestampToDate(ts.trim(), used) : null;
  const ok = date && !isNaN(date.getTime());
  const fromLocal = local ? new Date(local) : null;

  return (
    <div className="tool-body">
      <div className="row">
        <label className="field" style={{ flex: 1, minWidth: 260 }}>
          <span className="field-label">Timestamp Unix</span>
          <input className="input mono" type="text" value={ts} onChange={(e) => setTs(e.target.value)} />
        </label>
        <button className="btn" style={{ alignSelf: "flex-end" }} onClick={() => (setTs(String(Math.floor(Date.now() / 1000))), setUnit("auto"))}>Maintenant</button>
      </div>
      <Seg label="Unité" value={unit} onChange={setUnit} options={UNITS} />
      {ok ? (
        <dl className="kv card" style={{ padding: 16 }}>
          <dt>Unité</dt><dd>{UNITS.find((u) => u.id === used)!.label}{unit === "auto" ? " (devinée)" : ""}</dd><span />
          <dt>ISO 8601</dt><dd>{date.toISOString()}</dd><CopyButton text={date.toISOString()} />
          <dt>Relatif</dt><dd>{relativeTime(date)}</dd><span />
          {ZONES.map((z) => (
            <div key={z} style={{ display: "contents" }}>
              <dt>{z}</dt><dd>{fmtDate(date, z)}</dd><span />
            </div>
          ))}
        </dl>
      ) : ts.trim() ? <ErrorNote>Ce n'est pas un nombre valide.</ErrorNote> : null}
      <div className="field">
        <span className="field-label">Date vers timestamp (heure locale)</span>
        <input className="input" type="datetime-local" step="1" aria-label="Date et heure" value={local} onChange={(e) => setLocal(e.target.value)} />
      </div>
      {fromLocal && !isNaN(fromLocal.getTime()) && (
        <dl className="kv card" style={{ padding: 16 }}>
          <dt>Secondes</dt><dd>{Math.floor(fromLocal.getTime() / 1000)}</dd><CopyButton text={String(Math.floor(fromLocal.getTime() / 1000))} />
          <dt>Millisecondes</dt><dd>{fromLocal.getTime()}</dd><CopyButton text={String(fromLocal.getTime())} />
        </dl>
      )}
    </div>
  );
}
