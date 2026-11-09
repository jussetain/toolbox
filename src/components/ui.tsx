import { useState } from "react";

/** Bouton « Copier » avec confirmation brève. */
export function CopyButton({ text, label = "Copier", className = "btn btn-sm" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      disabled={!text}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copié ✓" : label}
    </button>
  );
}

export function Seg<T extends string | number>({
  value, options, onChange, label,
}: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Zone de texte avec libellé ; `mono` pour le code. */
export function TextField({
  label, value, onChange, rows = 8, mono = true, placeholder, readOnly, actions, invalid,
}: {
  label: string; value: string; onChange?: (v: string) => void; rows?: number; mono?: boolean;
  placeholder?: string; readOnly?: boolean; actions?: React.ReactNode; invalid?: boolean;
}) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {actions && <div className="field-actions">{actions}</div>}
      </div>
      <textarea
        aria-label={label}
        className={`input ${mono ? "" : "input-prose"} ${invalid ? "input-invalid" : ""}`}
        rows={rows}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}

export function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="error" role="alert">{children}</p>;
}
