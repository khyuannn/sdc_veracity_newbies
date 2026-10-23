export type CrateEvent = { id: number; action: string; from_location: string | null; to_location: string; actor: string; at: string; note: string }
export type CrateScan = { id: number; tag?: string; crate_id?: string | null; source: 'simulated' | 'entered_id'; station: string; recorded_location: string | null; crate_revision: number | null; actor: string; at: string }
export type TrackedCrate = { id: string; tag: string; product_id: string; product_name: string; declared_quantity: number; location: string; revision: number; events: CrateEvent[]; last_scan: CrateScan | null; location_review: boolean }
export type CrateState = { crates: TrackedCrate[]; scans: CrateScan[] }
export function requestId() {
  return globalThis.crypto?.randomUUID?.() || `request-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
export async function getCrates(signal?: AbortSignal): Promise<CrateState> {
  const response = await fetch('/api/backend/crates', { signal, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not load crate tracking. Restart the updated backend and retry.')
  return data
}
