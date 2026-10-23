import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { Box, MapPin } from 'lucide-react'
import { getCrates, type TrackedCrate } from '@/lib/crates'
import { useApp } from '@/components/app/app-provider'

export function ProductCrateLocations({ productId }: { productId: string }) {
  const { role } = useApp()
  const [crates, setCrates] = useState<TrackedCrate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setCrates([]); setLoading(true); setError('')
    void getCrates(controller.signal).then(state => {
      if (!controller.signal.aborted) setCrates(state.crates.filter(c => c.product_id === productId))
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [productId, role])
  return <section className="rounded-xl border border-line bg-elevated/30 p-4" aria-label="Product crate locations">
    <h3 className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-accent-text" />Where else is this product?</h3>
    <p className="mt-2 text-body-sm text-fg-secondary">Check all relevant locations before submitting a product total. Crate declarations are not live quantities.</p>
    {loading ? <p role="status" className="mt-3 text-body-sm">Loading recorded locations…</p> : error ? <p className="mt-3 text-body-sm text-warning">Crate locations unavailable. <Link href="/crates" className="underline">Open crate tracking</Link></p> : crates.length ? <ul className="mt-3 flex flex-col gap-2">{crates.map(crate => <li key={crate.id}><Link href={`/crates?tag=${encodeURIComponent(crate.tag)}`} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-2 text-body-sm hover:bg-elevated"><Box className="size-4 shrink-0 text-accent-text" /><span className="min-w-0 flex-1 break-words">{crate.location}<span className="block break-all text-caption text-fg-secondary">{crate.tag}</span></span><span className="text-caption text-fg-secondary">View crate</span></Link></li>)}</ul> : <p className="mt-3 text-body-sm text-fg-secondary">No crates registered for this product. <Link href="/crates" className="underline">Open crate tracking</Link></p>}
  </section>
}
