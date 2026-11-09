// 62 Compteur de mots · 63 Convertisseur de casse · 96 Lorem Ipsum
import { useMemo, useState } from "react";
import { CASES, convertCase, formatMinutes, lorem, textStats, type CaseId, type LoremFormat, type LoremUnit } from "../logic/text";
import { CopyButton, Seg, Stat, TextField, Toggle } from "../../components/ui";

const nf = (n: number) => n.toLocaleString("fr-FR");

export function WordCounter() {
  const [text, setText] = useState("");
  const s = useMemo(() => textStats(text), [text]);
  return (
    <div className="tool-body">
      <TextField label="Texte" value={text} onChange={setText} rows={12} mono={false} placeholder="Colle ou tape ton texte…" />
      <div className="stats">
        <Stat value={nf(s.words)} label="mots" />
        <Stat value={nf(s.chars)} label="caractères" />
        <Stat value={nf(s.charsNoSpaces)} label="sans les espaces" />
        <Stat value={nf(s.sentences)} label="phrases" />
        <Stat value={nf(s.paragraphs)} label="paragraphes" />
        <Stat value={formatMinutes(s.readingMinutes)} label="de lecture" />
        <Stat value={formatMinutes(s.speakingMinutes)} label="à voix haute" />
      </div>
    </div>
  );
}

export function CaseConverter() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<CaseId>("upper");
  const out = useMemo(() => convertCase(text, mode), [text, mode]);
  return (
    <div className="tool-body">
      <TextField label="Texte" value={text} onChange={setText} rows={6} mono={false} />
      <div className="case-grid" role="group" aria-label="Casse">
        {CASES.map((c) => (
          <button key={c.id} className="btn" aria-pressed={mode === c.id} onClick={() => setMode(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <TextField label="Résultat" value={out} readOnly rows={6} mono={false} actions={<CopyButton text={out} />} />
    </div>
  );
}

export function LoremIpsum() {
  const [count, setCount] = useState(3);
  const [unit, setUnit] = useState<LoremUnit>("paragraphs");
  const [format, setFormat] = useState<LoremFormat>("text");
  const [classic, setClassic] = useState(true);
  const [seed, setSeed] = useState(0);
  // `seed` force une nouvelle génération quand on clique « Régénérer ».
  const out = useMemo(() => lorem(Math.min(Math.max(count, 1), 500), unit, format, classic), [count, unit, format, classic, seed]);
  return (
    <div className="tool-body">
      <div className="row">
        <label className="field" style={{ width: 120 }}>
          <span className="field-label">Nombre</span>
          <input className="input" type="number" min={1} max={500} value={count} onChange={(e) => setCount(+e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">De</span>
          <Seg label="Unité" value={unit} onChange={setUnit} options={[{ id: "paragraphs", label: "Paragraphes" }, { id: "sentences", label: "Phrases" }, { id: "words", label: "Mots" }]} />
        </div>
        <div className="field">
          <span className="field-label">Format</span>
          <Seg label="Format" value={format} onChange={setFormat} options={[{ id: "text", label: "Texte" }, { id: "html", label: "HTML" }, { id: "markdown", label: "Markdown" }]} />
        </div>
      </div>
      <Toggle checked={classic} onChange={setClassic}>Commencer par « Lorem ipsum dolor sit amet »</Toggle>
      <TextField
        label="Texte généré"
        value={out}
        readOnly
        rows={12}
        mono={format === "html"}
        actions={<><button className="btn btn-sm" onClick={() => setSeed(seed + 1)}>Régénérer</button><CopyButton text={out} /></>}
      />
    </div>
  );
}
