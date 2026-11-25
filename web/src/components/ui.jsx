import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../lib/cn.js';

export function Button({
  as: Tag = 'button',
  variant = 'ghost',
  className,
  type = 'button',
  ...props
}) {
  const styles = {
    ghost:
      'border-line bg-panel-2/70 text-foam hover:bg-panel-2 hover:border-mist/30',
    primary:
      'border-leaf bg-leaf text-ink font-semibold shadow-[0_0_0_3px_rgba(0,237,100,0.12)] hover:brightness-110',
    danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
    quiet: 'border-transparent bg-transparent text-mist hover:text-foam hover:bg-white/5',
  };
  return (
    <Tag
      type={Tag === 'button' ? type : undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-mist">
          {label}
        </span>
      ) : null}
      {children}
      {hint ? <p className="mt-1.5 text-xs text-mist">{hint}</p> : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-line bg-ink-2 px-3 py-2.5 text-[13px] text-foam outline-none transition placeholder:text-mist/60 focus:border-leaf/50 focus:ring-2 focus:ring-leaf/15';

export function Input({ className, ...props }) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cn(inputClass, className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }) {
  return <textarea className={cn(inputClass, 'min-h-28 resize-y font-mono', className)} {...props} />;
}

export function Badge({ tone = 'muted', children, className }) {
  const tones = {
    ok: 'bg-leaf/15 text-leaf',
    fail: 'bg-danger/15 text-danger',
    warn: 'bg-warn/15 text-warn',
    muted: 'bg-white/6 text-mist',
    sky: 'bg-sky/15 text-sky',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cn('glass rounded-2xl p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function Sheet({ open, title, subtitle, onClose, wide, children, footer }) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close sheet"
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className={cn('sheet-panel', wide && 'wide')}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-semibold">{title}</h2>
                {subtitle ? <p className="mt-1 text-sm text-mist">{subtitle}</p> : null}
              </div>
              <Button variant="quiet" className="h-9 w-9 p-0" onClick={onClose}>
                <X size={16} />
              </Button>
            </header>
            <div className="flex-1 overflow-auto px-5 py-5">{children}</div>
            {footer ? <div className="border-t border-line px-5 py-4">{footer}</div> : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

export function Empty({ icon: Icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon ? (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-panel-2 text-leaf">
          <Icon size={22} />
        </div>
      ) : null}
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {body ? <p className="mt-2 max-w-md text-sm text-mist">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel = 'Continue', danger, onConfirm, onClose }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            className="confirm-card"
          >
            <h3 className="font-display text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-mist">{body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
