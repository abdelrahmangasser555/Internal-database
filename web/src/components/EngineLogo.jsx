import { engineOf } from '../lib/engines.js';
import { useTheme } from '../state/Theme.jsx';
import { cn } from '../lib/cn.js';

export function EngineLogo({ engine, size = 18, tile = false, className }) {
  const { theme } = useTheme();
  const info = engineOf(engine);
  const src = typeof info.logo === 'string' ? info.logo : info.logo[theme] || info.logo.dark;
  const img = <img src={src} alt={info.label} width={size} height={size} className="block object-contain" style={{ width: size, height: size }} draggable={false} />;
  if (!tile) return <span className={cn('inline-flex shrink-0', className)}>{img}</span>;
  const box = Math.round(size * 1.85);
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-md border border-line bg-surface-2', className)}
      style={{ width: box, height: box }}
      title={info.label}
    >
      {img}
    </span>
  );
}

export function BrandMark({ size = 28 }) {
  return <img src="/brand/mark.svg" alt="Backup Service" width={size} height={size} style={{ width: size, height: size }} />;
}
