"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { copyText } from "@/lib/client/api";

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Buttons / Badges                                                    */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface2",
        variant === "ghost" && "text-ink hover:bg-surface2",
        variant === "danger" && "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
        className,
      )}
    />
  );
}

export function LinkButton({ className, variant = "secondary", ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant }) {
  return (
    <a
      {...rest}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium whitespace-nowrap",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface2",
        variant === "ghost" && "text-ink hover:bg-surface2",
        className,
      )}
    />
  );
}

type Tone = "neutral" | "accent" | "danger" | "warn" | "info" | "ok" | "sample";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  info: "bg-info-soft text-info border-info/30",
  ok: "bg-ok-soft text-ok border-ok/30",
  sample: "bg-sample-soft text-sample border-sample/40",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[12px] leading-5 font-medium whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: "confirmed" | "proposed" | "deprecated" }) {
  const map = { confirmed: ["ok", "確定"], proposed: ["warn", "提案"], deprecated: ["neutral", "廃止"] } as const;
  const [tone, label] = map[status];
  return (
    <Badge tone={tone} className={status === "deprecated" ? "line-through" : ""}>
      {label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export function Field({ label, hint, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] leading-5 text-muted">{hint}</p>}
    </div>
  );
}

const inputCls = "w-full rounded-md border border-line bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, "h-10", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "min-h-[88px] leading-relaxed", props.className)} />;
}

export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cx(inputCls, "h-10 pr-8", props.className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-sm">
        {label}
        {hint && <span className="block text-[12px] text-muted">{hint}</span>}
      </label>
    </div>
  );
}

/** 複数の語（別名・ハッシュタグなど）を改行またはカンマ区切りで入力。 */
export function ListInput({ value, onChange, placeholder, id, rows = 2 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string; rows?: number }) {
  const [text, setText] = useState(value.join("\n"));
  const last = useRef(value);
  useEffect(() => {
    if (JSON.stringify(last.current) !== JSON.stringify(value)) {
      setText(value.join("\n"));
      last.current = value;
    }
  }, [value]);
  return (
    <Textarea
      id={id}
      rows={rows}
      className="min-h-0"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = e.target.value
          .split(/\n|,|、/)
          .map((s) => s.trim())
          .filter(Boolean);
        last.current = next;
        onChange(next);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */

export function Card({ children, className, title, actions, id }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cx("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "danger" | "sample" | "ok"; children: ReactNode; title?: ReactNode }) {
  const cls = {
    info: "border-info/30 bg-info-soft",
    warn: "border-warn/30 bg-warn-soft",
    danger: "border-danger/30 bg-danger-soft",
    sample: "border-sample/40 bg-sample-soft",
    ok: "border-ok/30 bg-ok-soft",
  }[tone];
  return (
    <div className={cx("rounded-md border px-3 py-2 text-sm", cls)} role="note">
      {title && <div className="font-semibold">{title}</div>}
      <div className="text-ink/90">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("scrollbar-none flex gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
            value === it.value ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cx("flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-surface shadow-xl sm:rounded-xl", wide ? "sm:max-w-4xl" : "sm:max-w-xl")}>
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" aria-label="閉じる" onClick={onClose} className="rounded px-2 py-1 text-muted hover:bg-surface2">
            ✕
          </button>
        </header>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

type ToastItem = { id: number; text: string; tone: "ok" | "danger" | "info" };
const ToastCtx = createContext<(text: string, tone?: ToastItem["tone"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastItem["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "danger" ? 7000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-2 px-3">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "danger" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto max-w-md rounded-md border px-3 py-2 text-sm shadow-lg",
              t.tone === "ok" && "border-ok/40 bg-ok-soft",
              t.tone === "danger" && "border-danger/40 bg-danger-soft",
              t.tone === "info" && "border-info/40 bg-info-soft",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export function CopyButton({ text, label = "コピー", size = "sm", variant = "secondary", onCopied }: { text: string; label?: string; size?: "sm" | "md"; variant?: ButtonVariant; onCopied?: () => void }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      onClick={async () => {
        const ok = await copyText(text);
        toast(ok ? "コピーしました" : "コピーできませんでした", ok ? "ok" : "danger");
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
          onCopied?.();
        }
      }}
    >
      {done ? "コピー済み" : label}
    </Button>
  );
}

/** 非同期ボタン：処理中は無効化し、失敗はトーストで出す。 */
export function useAsyncAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (okText) toast(okText, "ok");
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "danger");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
