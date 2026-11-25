import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Join class names and let later Tailwind utilities win (e.g. w-40 over w-full).
export function cn(...parts) {
  return twMerge(clsx(parts));
}
