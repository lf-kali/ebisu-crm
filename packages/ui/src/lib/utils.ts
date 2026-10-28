import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes condicionais e resolve conflitos do Tailwind. */
export function cn(...entradas: ClassValue[]) {
  return twMerge(clsx(entradas));
}
