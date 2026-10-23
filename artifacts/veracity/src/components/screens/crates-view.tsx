import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearch } from 'wouter'
import { AlertTriangle, ArrowRight, Box, CheckCircle2, MapPin, Radio, RefreshCw, ScanLine } from 'lucide-react'
import { useApp, useUnsavedWork } from '@/components/app/app-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, PageHeader } from '@/components/veracity/primitives'
import { getCrates, requestId, type CrateState, type TrackedCrate } from '@/lib/crates'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const field = 'min-w-0 w-full h-12 rounded-xl border border-line bg-elevated px-3 text-white'
export function CratesView() {
  const { products, role } = useApp()
  const search = useSearch()
  const [data, setData] = useState<CrateState>({ crates: [], scans: [] })
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [readerTag, setReaderTag] = useState('')
  const [scan, setScan] = useState('')
  const [station, setStation] = useState('Stockroom')
  const [tag, setTag] = useState('')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [initialLocation, setInitialLocation] = useState('Stockroom')
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState('')
  const [activeView, setActiveView] = useState<'locations' | 'crates' | 'activity'>('locations')
  const [registerOpen, setRegisterOpen] = useState(false)
  const [unknown, setUnknown] = useState('')
  const [lastInput, setLastInput] = useState<'simulated' | 'entered_id' | null>(null)
  const pending = useRef<{ payload: string; requestId: string } | null>(null)
  const gate = useRef(false)
  const mounted = useRef(true)
  const detail = useRef<HTMLDivElement>(null)
  const registerPanel = useRef<HTMLDivElement>(null)
  const selected = data.crates.find(c => c.tag === selectedTag)
  const write = role === 'staff' || role === 'manager'
  useUnsavedWork(busy || Boolean(destination || note) || (registerOpen && Boolean(tag || productId || quantity)))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function refresh(signal?: AbortSignal) {
    const state = await getCrates(signal)
    if (!signal?.aborted && mounted.current) { setData(state); setReady(true) }
  }
  useEffect(() => {
    const controller = new AbortController()
    setReady(false); setError(''); setData({ crates: [], scans: [] }); pending.current = null
    void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [role])
  useEffect(() => {
    const value = new URLSearchParams(search).get('tag')?.trim().toUpperCase()
    if (value) { setScan(value); setSelectedTag(value); setTag(value) }
  }, [search])
  function openCrate(crate: TrackedCrate, scroll = true) {
    setSelectedTag(crate.tag); setScan(crate.tag); setDestination(''); setNote(''); setUnknown(''); setError('')
    if (scroll) requestAnimationFrame(() => { detail.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); detail.current?.focus({ preventScroll: true }) })
  }
  async function mutate(body: Record<string, unknown>): Promise<boolean> {
    if (gate.current || !write) return false
    gate.current = true; setBusy(true); setError(''); setMessage('')
    const payload = JSON.stringify(body)
    if (!pending.current || pending.current.payload !== payload) pending.current = { payload, requestId: requestId() }
    try {
      const response = await fetch('/api/backend/crates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, requestId: pending.current.requestId }) })
      const state = await response.json()
      if (!response.ok) throw new Error(state.error || 'Could not save. Retry the same action if the connection was interrupted.')
      pending.current = null
      if (!mounted.current) return true
      setData(state); setReady(true)
      const value = String(body.tag).trim().toUpperCase()
      if (body.action === 'scan') {
        setLastInput(body.source as 'simulated' | 'entered_id')
        const found = state.crates.find((c: TrackedCrate) => c.tag === value)
        if (found) { openCrate(found); setMessage('Tag identified. Crate details retrieved; no transfer or stock correction was made.') }
        else { setSelectedTag(''); setUnknown(value); setTag(value); setMessage('Unknown tag detected. No stock was created or changed.') }
      } else {
        setSelectedTag(value); setUnknown(''); setDestination(''); setNote('')
        setMessage(body.action === 'register' ? 'Crate registered. Scan its demo tag to retrieve the record.' : 'Transfer recorded. The location history is updated; shop stock totals are unchanged.')
        if (body.action === 'register') { setRegisterOpen(false); setTag(''); setProductId(''); setQuantity(''); setReaderTag(value); setScan(value) }
      }
      return true
    } catch (e) { if (mounted.current) setError((e as Error).message); return false }
    finally { gate.current = false; if (mounted.current) setBusy(false) }
  }
  function readTag(value: string, source: 'simulated' | 'entered_id') {
    if (!value.trim() || !station.trim()) { setError('Select a tag and enter a reader location first.'); return }
    void mutate({ action: 'scan', tag: value, source, station })
  }
  const visible = data.crates.filter(c => `${c.product_name} ${c.tag} ${c.location}`.toLowerCase().includes(filter.trim().toLowerCase()))
  const locations = Array.from(new Set(data.crates.map(c => c.location.trim()))).sort()
  const reviews = data.crates.filter(c => c.location_review).length
  const candidate = readerTag || data.crates[0]?.tag || ''
  return <div className="flex flex-col gap-6" data-testid="page-crates">
    <PageHeader title="Crate tracking" subtitle="Find the crate. Follow its journey. Check the stock.">
      <Button type="button" disabled={!write || busy} onClick={() => { setRegisterOpen(v => !v); requestAnimationFrame(() => registerPanel.current?.scrollIntoView({ block: 'start' })) }}><Box className="size-4" />Register crate</Button>
    </PageHeader>
    <section className="relative overflow-hidden rounded-2xl border border-accent-fill/30 bg-gradient-to-br from-accent-fill/15 via-surface to-surface p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-2 text-caption font-semibold uppercase tracking-wider"><span className="flex items-center gap-2 rounded-full border border-accent-fill/40 bg-accent-fill/15 px-3 py-1"><Radio className="size-3.5" />RFID workflow demo</span><span className="rounded-full border border-line px-3 py-1 text-fg-secondary">Simulated input · no hardware connected</span></div>
      <h2 className="mt-4 max-w-2xl text-h1 font-semibold tracking-tight">Know which crate.<br />Know its last recorded place.</h2>
      <p className="mt-3 max-w-2xl text-body-sm text-fg-secondary">One identifier per crate connects its product, recorded location and transfer history. Use the demo reader below to see the workflow on your phone or tablet.</p>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{[
        ['Registered crates', data.crates.length], ['Recorded locations', locations.length], ['Crates with a scan', data.crates.filter(c => c.last_scan).length], ['Location checks', reviews],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-canvas/50 p-3"><p className="text-caption text-fg-secondary">{label}</p><p className="num mt-1 text-h1 font-semibold">{ready ? value : '—'}</p></div>)}</div>
    </section>
    {error && <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-body-sm text-danger">{error}<Button type="button" variant="ghost" disabled={busy} onClick={() => { void refresh().then(() => setError('')).catch(e => setError(e.message)) }}><RefreshCw className="size-4" />Refresh records</Button></div>}
    {message && <p role="status" className="rounded-xl border border-line bg-elevated p-4 text-body-sm">{message}</p>}
    {!write && <p className="text-body-sm text-fg-secondary">Owner view: review crate records and history. Staff and Managers register crates, record scans and confirm transfers.</p>}
    <Card className="p-5 md:p-6">
      <div className="mb-4 flex items-start gap-3"><span className="rounded-xl bg-accent-fill/15 p-3 text-accent-text"><ScanLine /></span><div><h2 className="text-h2 font-semibold">Demo RFID reader</h2><p className="text-body-sm text-fg-secondary">Choose a registered tag and simulate one read. The application retrieves its crate record.</p></div></div>
      <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="flex min-w-0 flex-col gap-2 text-body-sm">Demo tag<select aria-label="Demo tag" value={candidate} onChange={e => setReaderTag(e.target.value)} className={field} disabled={!write || busy || !ready}><option value="">Register a crate first</option>{data.crates.map(c => <option key={c.id} value={c.tag}>{c.tag} · {c.product_name}</option>)}<option value="DEMO-UNKNOWN-TAG">Unknown tag (demo)</option></select></label>
        <label className="flex flex-col gap-2 text-body-sm">Reader location (simulated)<Input aria-label="Reader location" value={station} onChange={e => setStation(e.target.value)} maxLength={80} className={field} disabled={!write || busy} /></label>
        <Button type="button" className="h-12" disabled={!write || busy || !ready || !candidate || !station.trim()} onClick={() => readTag(candidate, 'simulated')}><Radio className={cn('size-4', busy && 'animate-pulse')} />{busy ? 'Processing…' : 'Simulate RFID scan'}</Button>
      </div>
      <details className="mt-4 rounded-xl border border-line p-3"><summary className="cursor-pointer text-body-sm font-medium">Enter an ID / compatible keyboard reader</summary><p className="mt-3 text-caption text-fg-secondary">Focus this field and scan with a configured keyboard-output reader, or type an ID. This records “Entered ID”; it does not verify that physical RFID hardware supplied it.</p><form className="mt-3 flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); readTag(scan, 'entered_id') }}><Input aria-label="Scan tag ID" placeholder="DEMO-CRATE-001" value={scan} onChange={e => setScan(e.target.value)} maxLength={80} disabled={!write || busy} className={cn(field, 'min-w-0 flex-1')} /><Button type="submit" disabled={!ready || !write || busy || !scan.trim()}>Read tag ID</Button></form></details>
      {unknown && <div role="status" className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4"><p className="font-semibold">Unregistered tag: {unknown}</p><p className="mt-1 text-body-sm">Register this identifier before tracking a crate. This scan did not create inventory.</p><Button type="button" variant="secondary" className="mt-3" disabled={!write || busy} onClick={() => { setRegisterOpen(true); requestAnimationFrame(() => registerPanel.current?.scrollIntoView({ block: 'start' })) }}>Register this tag</Button></div>}
    </Card>
    {registerOpen && <div ref={registerPanel} className="scroll-mt-24"><Card className="p-5 md:p-6"><h2 className="text-h2 font-semibold">Register a crate</h2><p className="mt-1 text-body-sm text-fg-secondary">One crate, one product, one tag. Declaring contents does not add stock.</p><form onSubmit={(e: FormEvent) => { e.preventDefault(); void mutate({ action: 'register', tag, productId, quantity: Number(quantity), location: initialLocation }) }} className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-2 text-body-sm">Tag ID<div className="flex gap-2"><Input required aria-label="Register tag ID" value={tag} onChange={e => setTag(e.target.value)} maxLength={80} className={field} disabled={busy || !write} /><Button type="button" variant="secondary" className="h-12" disabled={busy || !write} onClick={() => setTag(`DEMO-${requestId().replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase()}`)}>Generate demo ID</Button></div></label>
      <label className="flex flex-col gap-2 text-body-sm">Product<select required aria-label="Crate product" value={productId} onChange={e => setProductId(e.target.value)} className={field} disabled={busy || !write}><option value="">Choose product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="flex flex-col gap-2 text-body-sm">Quantity at registration<Input required aria-label="Declared quantity" type="number" min={0} max={1000000000} step={1} value={quantity} onChange={e => setQuantity(e.target.value)} className={field} disabled={busy || !write} /></label>
      <label className="flex flex-col gap-2 text-body-sm">Initial location<Input required aria-label="Initial location" maxLength={80} value={initialLocation} onChange={e => setInitialLocation(e.target.value)} className={field} disabled={busy || !write} /></label>
      <div className="flex flex-wrap gap-3 sm:col-span-2"><Button type="submit" className="h-12" disabled={!write || busy || !ready}>Save crate registration</Button><Button type="button" variant="secondary" className="h-12" disabled={busy} onClick={() => setRegisterOpen(false)}>Close form</Button></div>
    </form>{!products.length && <p className="mt-3 text-body-sm text-warning">Add or import a product before registering a crate.</p>}</Card></div>}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Crate views">{(['locations', 'crates', 'activity'] as const).map(view => <Button type="button" key={view} variant={activeView === view ? 'primary' : 'secondary'} aria-pressed={activeView === view} onClick={() => setActiveView(view)}>{view === 'locations' ? 'By location' : view === 'crates' ? 'All crates' : 'Scan activity'}</Button>)}<Button type="button" variant="ghost" aria-label="Refresh crate records" disabled={busy} onClick={() => { void refresh().catch(e => setError(e.message)) }}><RefreshCw className="size-4" /></Button></div>
        {activeView !== 'activity' && <Input aria-label="Search crates" placeholder="Search product, tag or location…" value={filter} onChange={e => setFilter(e.target.value)} className={field} />}
        {!ready && <p role="status">Loading crate records…</p>}
        {ready && !data.crates.length && activeView !== 'activity' && <Card className="p-6 text-center"><Box className="mx-auto mb-3 size-8 text-fg-secondary" /><h3 className="font-semibold">Your first crate starts here</h3><p className="mt-2 text-body-sm text-fg-secondary">Register an existing product and a demo tag, then try the reader. No sample stock is added automatically.</p></Card>}
        {ready && data.crates.length > 0 && !visible.length && activeView !== 'activity' && <p className="text-body-sm text-fg-secondary">No matching crates.</p>}
        {activeView === 'locations' && locations.filter(location => visible.some(c => c.location === location)).map(location => <Card key={location} className="overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-line bg-elevated/40 p-4"><h3 className="flex min-w-0 items-center gap-2 font-semibold"><MapPin className="size-4 shrink-0 text-accent-text" /><span className="break-words">{location}</span></h3><span className="shrink-0 text-caption text-fg-secondary">{data.crates.filter(c => c.location === location).length} recorded crates</span></div><div className="flex flex-col gap-2 p-3">{visible.filter(c => c.location === location).map(c => renderCrate(c))}</div></Card>)}
        {activeView === 'crates' && visible.map(c => renderCrate(c))}
        {activeView === 'activity' && <Card className="p-4"><h3 className="mb-3 font-semibold">Recent reader observations</h3><p className="mb-4 text-caption text-fg-secondary">Latest 100 observations. A read does not prove a transfer or a live quantity.</p>{!data.scans.length && <p className="text-body-sm">No observations yet. Try the demo reader.</p>}<ol className="flex flex-col gap-3">{data.scans.map(s => <li key={s.id} className="rounded-xl border border-line p-3 text-body-sm"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-elevated px-2 py-1 text-caption">{s.source === 'simulated' ? 'Simulated' : 'Entered ID'}</span><strong className="break-all">{s.tag}</strong>{!s.crate_id && <span className="text-warning">Unregistered</span>}</div><p className="mt-2">Reader location: {s.station}</p><p className="text-caption text-fg-secondary">{s.actor} · {formatDateTime(s.at)}</p></li>)}</ol></Card>}
        <p className="text-caption text-fg-secondary">Locations show recorded crate placements, not sensor-verified occupancy or available rack capacity.</p>
      </div>
      <div ref={detail} tabIndex={-1} className="min-w-0 scroll-mt-24 outline-none" data-testid="crate-detail"><Card className="p-5 md:p-6">
        {selected ? <>
          <div className="flex items-center gap-2 text-caption uppercase tracking-wider text-accent-text"><Box className="size-4" />Crate record</div><h2 className="mt-3 text-h2 font-semibold">{selected.product_name}</h2><p className="mt-1 break-all text-caption text-fg-secondary">{selected.id} · {selected.tag}</p>
          {lastInput && <p className="mt-3 text-caption text-fg-secondary">Latest input: {lastInput === 'simulated' ? 'Simulated RFID read' : 'Entered tag ID'} · hardware not verified</p>}
          <div className="mt-5 rounded-xl border border-line bg-elevated/40 p-4"><p className="text-caption text-fg-secondary">Last recorded location</p><p className="mt-1 flex items-center gap-2 text-h2 font-semibold"><MapPin className="size-5 text-accent-text" />{selected.location}</p></div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-body-sm"><dt className="text-fg-secondary">Quantity at registration</dt><dd className="text-right font-semibold">{selected.declared_quantity}</dd></dl><p className="mt-1 text-caption text-fg-secondary">Historical declaration, not the current remaining quantity.</p>
          {selected.last_scan && <p className="mt-4 text-caption text-fg-secondary">Last observation: {selected.last_scan.station} · {selected.last_scan.source === 'simulated' ? 'simulated' : 'entered ID'} · {formatDateTime(selected.last_scan.at)}</p>}
          {selected.location_review && <div role="status" className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-body-sm"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />Location review needed</p><p className="mt-1">The latest observation says {selected.last_scan?.station}, while the record says {selected.location}. Verify the location before confirming a transfer. Simulated observations are demonstration data.</p></div>}
          {write && <div className="mt-5"><Link href={`/count?product=${encodeURIComponent(selected.product_id)}`} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent-fill px-4 py-3 text-body-sm font-semibold text-white">Check this product’s stock<ArrowRight className="size-4" /></Link><p className="mt-2 text-caption text-fg-secondary">Count across all relevant crates and locations. This opens the existing product-level count.</p></div>}
          <div className="mt-6 border-t border-line pt-5"><h3 className="font-semibold">Record a whole-crate transfer</h3><p className="mt-1 text-body-sm text-fg-secondary">From {selected.location}. Confirm the destination after moving the crate.</p><form className="mt-4 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void mutate({ action: 'transfer', tag: selected.tag, revision: selected.revision, location: destination, note }) }}><label className="flex flex-col gap-2 text-body-sm">Destination<Input required aria-label="Transfer destination" value={destination} onChange={e => setDestination(e.target.value)} maxLength={80} className={field} disabled={!write || busy} /></label><label className="flex flex-col gap-2 text-body-sm">Note (optional)<Input aria-label="Transfer note" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className={field} disabled={!write || busy} /></label><Button type="submit" className="h-12" disabled={!write || busy}><CheckCircle2 className="size-4" />Confirm transfer</Button></form><p className="mt-2 text-caption text-fg-secondary">Transfers change recorded location, not shop stock totals.</p></div>
          <h3 className="mt-6 font-semibold">Crate journey</h3><ol className="mt-4 flex flex-col gap-4 border-l border-line pl-4">{selected.events.map(event => <li key={event.id} className="relative text-body-sm"><span className="absolute -left-[21px] top-1 size-2 rounded-full bg-accent-fill" /><p className="font-medium">{event.action === 'register' ? `Registered at ${event.to_location}` : `${event.from_location} → ${event.to_location}`}</p><p className="mt-1 text-caption text-fg-secondary">{event.actor} · {formatDateTime(event.at)}</p>{event.note && <p className="mt-1 break-words">{event.note}</p>}</li>)}</ol>
        </> : <div className="py-10 text-center"><Radio className="mx-auto size-10 text-accent-text" /><h2 className="mt-4 text-h2 font-semibold">Ready for a tag</h2><p className="mt-2 text-body-sm text-fg-secondary">Simulate a reader observation or select a crate to reveal its product, location and journey.</p></div>}
      </Card></div>
    </div>
  </div>
  function renderCrate(crate: TrackedCrate) {
    return <button type="button" key={crate.id} disabled={busy} aria-label={`Open crate ${crate.tag}`} onClick={() => { setLastInput(null); openCrate(crate) }} className={cn('flex min-h-20 w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-50', selectedTag === crate.tag ? 'border-accent-fill bg-accent-fill/10' : 'border-line bg-surface hover:bg-elevated')}><Box className="size-5 shrink-0 text-accent-text" /><span className="min-w-0 flex-1"><span className="block font-semibold">{crate.product_name}</span><span className="mt-1 block break-all text-caption text-fg-secondary">{crate.tag}</span><span className="mt-1 block text-caption text-fg-secondary">{crate.location}</span></span>{crate.location_review ? <AlertTriangle aria-label="Location review needed" className="size-4 shrink-0 text-warning" /> : <ArrowRight className="size-4 shrink-0 text-fg-secondary" />}</button>
  }
}
