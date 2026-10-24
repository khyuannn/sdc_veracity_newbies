import { formatKl } from './kl-time'

/** All event timestamps use Malaysia time, independently of the browser timezone. */
export function formatDateTime(iso: string) {
  return iso ? formatKl(iso) : ''
}

export function formatDate(iso: string) {
  return formatDateTime(iso)
}

export function formatSigned(n: number) {
  if (n > 0) return `+${n}`
  if (n < 0) return `\u2212${Math.abs(n)}`
  return '0'
}
