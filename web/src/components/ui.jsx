import { forwardRef, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoaderCircle, X } from 'lucide-react';
import { cn } from '../lib/cn.js';

export const Button = forwardRef(function Button(
  { as: Tag = 'button', variant = 'secondary', size = 'md', className, type = 'button', loading, children, ...props },
  ref,
) {
  const variants = {
    primary: 'bg-primary text-primary-fg border-transparent hover:bg-primary-strong shadow-[0_1px_0_rgb(255_255_255/0.15)_inset]',
    secondary: 'bg-surface-2 text-fg border-line hover:bg-surface-3 hover:border-line-strong',
    ghost: 'bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-fg',
    danger: 'bg-danger/10 text-danger border-danger/25 hover:bg-danger/18',
    // legacy aliases used by older call sites
    quiet: 'bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-fg',
  };
  const sizes = {
    xs: 'h-7 px-2 text-[12px] gap-1.5 rounded-sm',
    sm: 'h-8 px-2.5 text-[12.5px] gap-1.5 rounded-md',
    md: 'h-9 px-3.5 text-[13px] gap-2 rounded-md',
    icon: 'h-8 w-8 p-0 rounded-md',
  };
  return (
    <Tag
      ref={ref}
      type={Tag === 'button' ? type : undefined}
      className={cn(
        'focus-ring inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap border font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
        variants[variant] || variants.secondary,
        sizes[size] || sizes.md,
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle size={14} className="animate-spin" /> : null}
      {children}
    </Tag>
  );
});

export function Field({ label, hint, error, children, className, right }) {
  return (
    <label className={cn('block', className)}>
      {label ? (
        <span className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-muted">
          {label}
          {right}
        </span>
      ) : null}
      {children}
      {error ? <p className="mt-1.5 text-[12px] text-danger">{error}</p> : hint ? <p className="mt-1.5 text-[12px] text-subtle">{hint}</p> : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-line bg-bg-2 px-3 h-9 text-[13px] text-fg outline-none transition placeholder:text-subtle focus:border-primary/60 focus:ring-3 focus:ring-primary/15';

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(inputClass, className)} {...props} />;
});

export function Select({ className, children, ...props }) {
  return (
    <select className={cn(inputClass, 'appearance-auto pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClass, 'h-auto min-h-28 resize-y py-2.5 font-mono text-[12.5px] leading-6', className)} {...props} />;
});

export function Switch({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="focus-ring group flex w-full items-start gap-3 rounded-md text-left"
    >
      <span className={cn('mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line p-0.5 transition', checked ? 'bg-primary' : 'bg-surface-3')}>
        <span className={cn('h-3.5 w-3.5 rounded-full bg-white shadow transition', checked ? 'translate-x-4' : 'translate-x-0')} />
      </span>
      <span>
        <span className="block text-[13px] text-fg">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] text-subtle">{hint}</span> : null}
      </span>
    </button>
  );
}

export function Badge({ tone = 'muted', children, className, dot, pulse }) {
  const tones = {
    ok: 'bg-ok/12 text-ok',
    fail: 'bg-danger/12 text-danger',
    danger: 'bg-danger/12 text-danger',
    warn: 'bg-warn/14 text-warn',
    muted: 'bg-surface-3 text-muted',
    info: 'bg-info/12 text-info',
    sky: 'bg-info/12 text-info',
    primary: 'bg-primary/14 text-primary-strong',
  };
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-medium', tones[tone] || tones.muted, className)}>
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full bg-current', pulse && 'pulse')} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'muted', pulse, className }) {
  const tones = { ok: 'bg-ok', fail: 'bg-danger', warn: 'bg-warn', muted: 'bg-subtle', info: 'bg-info', primary: 'bg-primary' };
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      {pulse ? <span className={cn('absolute inset-0 animate-ping rounded-full opacity-50', tones[tone])} /> : null}
      <span className={cn('relative h-2 w-2 rounded-full', tones[tone])} />
    </span>
  );
}

export function Card({ className, children, padded = true, ...props }) {
  return (
    <div className={cn('card', padded && 'p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted">
            <Icon size={15} />
          </div>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions, className }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[12px] font-medium text-muted">{eyebrow}</p> : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className, size = 'md' }) {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5', className)} role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            disabled={t.disabled}
            className={cn(
              'focus-ring relative inline-flex items-center gap-1.5 rounded-[7px] font-medium transition disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]',
              active ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.25)]' : 'text-muted hover:text-fg',
            )}
          >
            {Icon ? <Icon size={14} /> : null}
            {t.label}
            {t.count != null ? <span className="num text-[11px] text-subtle">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Kbd({ children, className }) {
  return (
    <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-surface-2 px-1.5 font-mono text-[10.5px] text-muted', className)}>
      {children}
    </kbd>
  );
}

export function Spinner({ size = 16, className }) {
  return <LoaderCircle size={size} className={cn('animate-spin text-muted', className)} />;
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton h-4', className)} />;
}

export function Sheet({ open, title, subtitle, icon, onClose, wide, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 z-40 cursor-default border-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className={cn(
              'fixed inset-y-2 right-2 z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl',
              wide ? 'w-[min(calc(100vw-1rem),46rem)]' : 'w-[min(calc(100vw-1rem),32rem)]',
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                {icon}
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
                  {subtitle ? <p className="mt-0.5 truncate text-[12px] text-muted">{subtitle}</p> : null}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X size={16} />
              </Button>
            </header>
            <div className="flex-1 overflow-auto px-5 py-5">{children}</div>
            {footer ? <div className="border-t border-line bg-surface-2/40 px-5 py-3.5">{footer}</div> : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

export function Empty({ icon: Icon, title, body, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {Icon ? (
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
          <Icon size={20} />
        </div>
      ) : null}
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {body ? <p className="mt-1.5 max-w-md text-[13px] leading-5 text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Confirmation dialog. Pass `typeToConfirm` to require typing a value (used for writes). */
export function Confirm({ open, title, body, confirmLabel = 'Continue', danger, onConfirm, onClose, typeToConfirm, busy, children }) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const blocked = typeToConfirm ? typed.trim() !== typeToConfirm : false;
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 6 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold">{title}</h3>
            {body ? <p className="mt-2 text-[13px] leading-5 text-muted">{body}</p> : null}
            {children}
            {typeToConfirm ? (
              <Field className="mt-4" label={<span>Type <code className="rounded bg-surface-3 px-1 font-mono text-fg">{typeToConfirm}</code> to confirm</span>}>
                <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono" />
              </Field>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant={danger ? 'danger' : 'primary'} disabled={blocked} loading={busy} onClick={() => onConfirm(typed)}>
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function KeyValue({ items, className }) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {items.filter(Boolean).map(([k, v, opts = {}]) => (
        <div key={k} className="grid grid-cols-[140px_1fr] gap-3 py-2.5">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className={cn('min-w-0 text-[13px] text-fg', opts.mono && 'break-all font-mono text-[12px]')}>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Segmented({ options, value, onChange }) {
  return <Tabs tabs={options} value={value} onChange={onChange} size="sm" />;
}
