import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Camera, CheckCircle2, ChevronDown, CircleMinus, CirclePlus, FileText, Loader2, Minus, Paperclip, Plus, Send, X } from 'lucide-react'
import { Link, useLocation, useSearch } from 'wouter'
import { toast } from 'sonner'
import { useApp, useUnsavedWork } from '@/components/app/app-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProductCrateLocations } from '@/components/veracity/product-crate-locations'
import { CaseAttachments } from '@/components/veracity/case-attachments'
import { NoDifferenceBadge } from '@/components/veracity/badges'
import { PhotoCountDialog } from '@/components/veracity/photo-count-dialog'
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/veracity/primitives'
import { formatSigned } from '@/lib/format'
import type { StockSummaryItem } from '@/lib/stock'
import type { Product, StockCase } from '@/lib/types'
import { cn } from '@/lib/utils'

type Mode = 'count' | 'product' | 'evidence' | 'complete'
type Flow = 'count' | 'product' | null
type CountEntryMode = 'total' | 'adjustment'

export function CountView() {
  const [, navigate] = useLocation()
  const search = useSearch()
  const appliedProduct = useRef('')
  const { submitCount, createProduct, findOpenCase, role, products, summary, loading, error, refresh } = useApp()
  const [mode, setMode] = useState<Mode>('count')
  const [flow, setFlow] = useState<Flow>(null)
  const [productId, setProductId] = useState('')
  const [counted, setCounted] = useState('')
  const [countEntryMode, setCountEntryMode] = useState<CountEntryMode>('total')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRecorded, setNewRecorded] = useState('')
  const [newCost, setNewCost] = useState('')
  const [newNote, setNewNote] = useState('')
  const [productError, setProductError] = useState('')
  const [productSubmitted, setProductSubmitted] = useState(false)
  const [newProduct, setNewProduct] = useState<Product | null>(null)
  const [newCase, setNewCase] = useState<StockCase | null>(null)
  const [updatedProductId, setUpdatedProductId] = useState('')
  const [productFile, setProductFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [photoOpen, setPhotoOpen] = useState(false)
  const actionRef = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const ids = { product: useId(), counted: useId(), note: useId(), name: useId(), recorded: useId(), cost: useId(), newNote: useId() }
  const product = products.find((item) => item.id === productId)
  useEffect(() => {
    const requested = new URLSearchParams(search).get('product')
    if (!requested) { appliedProduct.current = ''; return }
    if (requested !== appliedProduct.current && products.some(item => item.id === requested)) {
      appliedProduct.current = requested
      setProductId(requested); setCounted(''); setCountEntryMode('total'); setSubmitted(false)
    }
  }, [search, products])
  useUnsavedWork(
    (mode === 'count' && Boolean(productId || counted || note)) ||
    (mode === 'product' && Boolean(newName || newRecorded || newCost || newNote)) ||
    (mode === 'evidence' && flow === 'product' && Boolean(productFile)) ||
    busy,
  )
  const enteredCount = counted === '' || counted === '+' || counted === '-' ? null : Number(counted)
  const countedNum = enteredCount === null ? null
    : countEntryMode === 'adjustment' && product ? product.recorded + enteredCount : enteredCount
  const countedValid = enteredCount !== null && Number.isInteger(enteredCount) &&
    countedNum !== null && Number.isInteger(countedNum) && countedNum >= 0 && countedNum <= 1_000_000_000
  const difference = product && countedValid ? countedNum - product.recorded : null
  const duplicateCase = product && countedValid ? findOpenCase(product.name, countedNum) : undefined
  const nameDuplicate = products.some((item) => item.name.trim().toLowerCase() === newName.trim().toLowerCase())
  const countedError = (submitted && !countedValid) || (enteredCount !== null && (!Number.isInteger(enteredCount) || (countedNum !== null && (countedNum < 0 || countedNum > 1_000_000_000))))
  const countedErrorMessage = countEntryMode === 'adjustment'
    ? countedNum !== null && countedNum < 0
      ? 'This adjustment would make the counted quantity less than 0.'
      : countedNum !== null && countedNum > 1_000_000_000
        ? 'The counted quantity cannot exceed 1,000,000,000.'
        : 'Enter a whole-number adjustment, such as +5 or -5.'
    : countedNum !== null && countedNum < 0
      ? 'Counted quantity cannot be less than 0.'
      : countedNum !== null && countedNum > 1_000_000_000
        ? 'Counted quantity cannot exceed 1,000,000,000.'
        : 'Enter a whole number of 0 or more.'
  const productMissing = submitted && !product
  const canWrite = role === 'staff' || role === 'manager'
  const nameError = nameDuplicate || productError.toLowerCase().includes('already exists')
    ? 'A product with this name already exists. Count it instead.'
    : productSubmitted && !newName.trim() ? 'Enter a product name.' : ''
  const newRecordedNumber = newRecorded === '' ? NaN : Number(newRecorded)
  const recordedError = productSubmitted && (!Number.isInteger(newRecordedNumber) || newRecordedNumber < 0 || newRecordedNumber > 1_000_000_000)
    ? 'Enter a whole number of 0 or more.' : ''
  const newCostNumber = newCost === '' ? undefined : Number(newCost)
  const costError = productSubmitted && newCostNumber !== undefined && (!Number.isFinite(newCostNumber) || newCostNumber < 0 || newCostNumber > 1_000_000_000)
    ? 'Enter a unit cost of 0 or more.' : ''

  const focusAction = () => requestAnimationFrame(() => actionRef.current?.focus())
  const selectMode = (next: Mode) => { setMode(next); focusAction() }

  const reset = () => {
    setMode('count'); setFlow(null); setProductId(''); setCounted(''); setCountEntryMode('total'); setNote(''); setSubmitted(false)
    setNewName(''); setNewRecorded(''); setNewCost(''); setNewNote(''); setProductError(''); setProductSubmitted(false)
    setNewProduct(null); setNewCase(null); setProductFile(null); setFileError('')
    if (fileInput.current) fileInput.current.value = ''
    focusAction()
  }

  const goBack = () => {
    const unsaved = mode === 'product' ? Boolean(newName || newRecorded || newCost || newNote)
      : mode === 'evidence' && flow === 'product' ? Boolean(productFile)
        : false
    if (unsaved && !window.confirm('Discard changes?')) return
    if (mode === 'product') { selectMode('count'); return }
    if (mode === 'evidence') { setProductFile(null); selectMode('count'); return }
    selectMode('count')
  }

  async function handleSubmitCount(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (!canWrite || !product || !countedValid || duplicateCase) return
    setBusy(true)
    try {
      const created = await submitCount({ product: product.name, recorded: product.recorded, counted: countedNum, note: note.trim() })
      setUpdatedProductId(product.id)
      window.setTimeout(() => setUpdatedProductId(''), 150)
      setFlow('count')
      if (!created) {
        toast.success('Count saved. No difference found.')
        setNewCase(null)
        setMode('complete')
      } else {
        toast.success('Count saved. Sent for manager review.', { description: 'Add evidence to support the difference.' })
        setNewCase(created)
        setMode('evidence')
      }
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function submitProduct(event: FormEvent) {
    event.preventDefault()
    setProductSubmitted(true)
    setProductError('')
    if (!canWrite) return
    const name = newName.trim()
    const recorded = newRecorded === '' ? NaN : Number(newRecorded)
    const cost = newCost === '' ? undefined : Number(newCost)
    if (!name || !Number.isInteger(recorded) || recorded < 0 || recorded > 1_000_000_000 || (cost !== undefined && (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000_000))) return
    if (nameDuplicate) { setProductError('A product with this name already exists. Count it instead.'); return }
    setBusy(true)
    try {
      const created = await createProduct({ name, recorded, ...(cost === undefined ? {} : { unit_cost: cost }), ...(newNote.trim() ? { note: newNote.trim() } : {}) })
      setNewProduct(created)
      setFlow('product')
      setProductFile(null)
      setMode('evidence')
    } catch (e) {
      const message = (e as Error).message
      setProductError(message.toLowerCase().includes('already exists') ? 'A product with this name already exists. Count it instead.' : message)
    } finally { setBusy(false) }
  }

  const validateProductFile = (file: File | null) => {
    setProductFile(file)
    setFileError('')
    if (!file) return
    const validMime = ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)
    const validName = /\.(jpe?g|png|pdf)$/i.test(file.name)
    if (!validMime || !validName) setFileError('Use a JPG, PNG or PDF')
    else if (file.size > 10 * 1024 * 1024) setFileError('File is over 10 MB')
    else if (!file.size) setFileError('Choose a nonempty file.')
  }

  const headerAction = mode === 'count' || mode === 'complete' ? (
    <Button ref={actionRef} type="button" variant="outline" disabled={!canWrite} title={!canWrite ? 'Permission required: Staff or Manager' : undefined} onClick={() => selectMode('product')}>
      <Plus aria-hidden="true" /> Add New Product
    </Button>
  ) : (
    <Button ref={actionRef} type="button" variant="secondary" onClick={goBack}>Back to count</Button>
  )

  const heading = mode === 'product' ? 'Add new product' : mode === 'evidence' ? 'Upload evidence' : mode === 'complete' ? 'Count complete' : 'New count'
  const subtitle = mode === 'count' ? 'Enter what you counted on the shelf. Veracity compares it with the record.' : undefined

  return (
    <div className="flex flex-col gap-6" data-testid="page-count">
      <PageHeader title={heading} subtitle={subtitle}>{headerAction}</PageHeader>
      {role === 'owner' && <ErrorNotice title="Permission required" description="Owners have read-only access. Switch to Staff or Manager to count stock or add a product." />}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="min-w-0">
          {mode === 'count' && renderCountForm()}
          {mode === 'product' && (
            <Card className="p-5 md:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div><h2 className="text-h2 font-semibold">Add new product</h2><p className="text-body-sm text-fg-secondary">Step 1 of 2</p></div>
              </div>
              <form onSubmit={submitProduct} noValidate className="flex flex-col gap-4">
                <Field label="Product name" id={ids.name} error={nameError} errorId={`${ids.name}-error`}>
                  <Input id={ids.name} value={newName} onChange={(e) => { setNewName(e.target.value); setProductError('') }} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${ids.name}-error` : undefined} maxLength={4000} className="h-12 text-body" />
                </Field>
                <Field label="Recorded (opening) quantity" id={ids.recorded} error={recordedError} errorId={`${ids.recorded}-error`}>
                  <Input id={ids.recorded} type="number" inputMode="numeric" min={0} max={1_000_000_000} step={1} value={newRecorded} onChange={(e) => setNewRecorded(e.target.value)} aria-invalid={Boolean(recordedError)} aria-describedby={recordedError ? `${ids.recorded}-error` : undefined} className="h-12 text-body" />
                </Field>
                <Field label={<>Unit cost <span className="text-fg-tertiary">(RM, optional)</span></>} id={ids.cost}>
                  <Input id={ids.cost} type="number" min={0} step="0.01" value={newCost} onChange={(e) => setNewCost(e.target.value)} aria-invalid={Boolean(costError)} aria-describedby={costError ? `${ids.cost}-error` : undefined} className="h-12 text-body" />
                </Field>
                {costError && <p id={`${ids.cost}-error`} className="text-body-sm text-danger">{costError}</p>}
                <Field label={<>Note <span className="text-fg-tertiary">(optional)</span></>} id={ids.newNote}>
                  <Textarea id={ids.newNote} value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={3} maxLength={4000} className="min-h-24 text-body" />
                </Field>
                {productError && !productError.toLowerCase().includes('already exists') && <p role="alert" className="text-body-sm text-danger">{productError}</p>}
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="secondary" onClick={goBack} className="min-h-11">Back to count</Button>
                  <Button type="submit" disabled={busy || !canWrite} className="min-h-11">{busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}Next: add evidence</Button>
                </div>
              </form>
            </Card>
          )}
          {mode === 'evidence' && flow === 'count' && newCase && newCase.versions.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between"><div><h2 className="text-h2 font-semibold">Upload evidence</h2><p className="text-body-sm text-fg-secondary">Step 2 of 2 · Case {newCase.id}</p></div></div>
              <CaseAttachments
                stockCase={newCase}
                viewed={newCase.versions[newCase.versions.length - 1]}
                helperText="Add a photo or report that explains the difference."
                completionMode
                descriptionClassName="text-white"
                onDone={() => setMode('complete')}
              />
              <p className="text-body-sm text-fg-secondary">You can add documents later from the case page.</p>
              <Button type="button" variant="secondary" onClick={() => setMode('complete')} className="self-start">Skip for now</Button>
            </div>
          )}
          {mode === 'evidence' && flow === 'product' && newProduct && (
            <ProductEvidenceStep product={newProduct} file={productFile} fileError={fileError} fileInput={fileInput} onFile={validateProductFile} onDone={() => setMode('complete')} />
          )}
          {mode === 'complete' && (
            <Card className="flex flex-col gap-4 p-5 md:p-6" data-testid="card-count-complete">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-6 text-success" aria-hidden="true" />
                <div>
                  <h2 className="text-h2 font-semibold">{flow === 'product' ? 'Product added' : newCase ? `Count submitted · Case ${newCase.id} opened` : 'No difference. Nothing to upload.'}</h2>
                  {flow === 'product' && <p className="mt-1 text-body-sm text-warning">Evidence missing. Product-level uploads need a backend endpoint before this file can be saved.</p>}
                  {newCase && <p className="mt-1 text-body-sm text-fg-secondary">You can add documents later from the case page.</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={reset} className="min-h-11">Add another</Button>
                {newCase ? <Button type="button" variant="secondary" onClick={() => navigate(`/cases/${newCase.id}`)} className="min-h-11">View case</Button>
                  : <Button type="button" variant="secondary" onClick={() => navigate('/inbox')} className="min-h-11">Go to Inbox</Button>}
              </div>
            </Card>
          )}
        </div>
        <StockSummaryPanel
          items={summary.items}
          matches={summary.matches}
          total={summary.total}
          updatedAt={summary.updatedAt}
          loading={loading}
          error={error}
          selectedId={productId || newProduct?.id || ''}
          updatedProductId={updatedProductId}
          role={role}
          onRetry={() => { void refresh().catch(() => {}) }}
        />
      </div>
    </div>
  )

  function renderCountForm() {
    return (
      <Card className="p-5 md:p-6">
        <form onSubmit={handleSubmitCount} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.product} className="text-body-sm font-medium">Product</Label>
            <div className="relative">
              <select id={ids.product} value={productId} onChange={(e) => { setProductId(e.target.value); setCounted(''); setSubmitted(false) }} aria-invalid={productMissing} aria-describedby={productMissing ? `${ids.product}-error` : undefined} className="h-12 w-full appearance-none rounded-[12px] border border-line bg-elevated px-4 pr-10 text-body text-white outline-none focus-visible:ring-2 focus-visible:ring-accent-text aria-invalid:border-danger">
                <option value="">Choose a product</option>
                {products.map((item) => <option key={item.id} value={item.id}>{item.name}{item.evidence_missing ? ' · Evidence missing' : ''}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-fg-secondary" aria-hidden="true" />
            </div>
            {productMissing && <p id={`${ids.product}-error`} className="text-body-sm font-medium text-danger">Choose a product.</p>}
          </div>
          {product && <ProductCrateLocations key={product.id} productId={product.id} />}
          <div role="group" aria-label="Quantity entry method" className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={countEntryMode === 'total' ? 'primary' : 'secondary'} aria-pressed={countEntryMode === 'total'} data-testid="count-mode-total" onClick={() => { setCountEntryMode('total'); setCounted(''); setSubmitted(false) }}>Total quantity</Button>
            <Button type="button" size="sm" variant={countEntryMode === 'adjustment' ? 'primary' : 'secondary'} aria-pressed={countEntryMode === 'adjustment'} data-testid="count-mode-adjustment" onClick={() => { setCountEntryMode('adjustment'); setCounted(''); setSubmitted(false) }}>Adjustment (+/−)</Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Recorded stock" value={product ? product.recorded : '—'} />
            <StatTile label="Difference" value={difference === null ? '—' : formatSigned(difference)} tone={difference ? 'accent' : 'default'} />
          </div>
          <Field label={countEntryMode === 'total' ? 'Counted quantity' : 'Adjustment (use +5 or -5)'} id={ids.counted} error={countedError ? countedErrorMessage : ''} errorId={`${ids.counted}-error`}>
            <Input id={ids.counted} type={countEntryMode === 'adjustment' ? 'text' : 'number'} inputMode={countEntryMode === 'adjustment' ? 'decimal' : 'numeric'} min={countEntryMode === 'adjustment' && product ? -product.recorded : 0} max={countEntryMode === 'adjustment' && product ? 1_000_000_000 - product.recorded : 1_000_000_000} step={1} value={counted} onChange={(e) => setCounted(e.target.value)} aria-invalid={countedError} aria-describedby={countedError ? `${ids.counted}-error` : undefined} className="num h-14 rounded-[12px] border-line bg-elevated px-4 text-h2 font-semibold text-white" placeholder={countEntryMode === 'adjustment' ? '+5 or -5' : '0'} />
          </Field>
          <Button type="button" variant="secondary" className="min-h-11 self-start" disabled={!product || !canWrite} title={!product ? 'Choose a product first' : !canWrite ? 'Permission required: Staff or Manager' : undefined} onClick={() => setPhotoOpen(true)} data-testid="button-count-from-photo">
            <Camera aria-hidden="true" /> Count from photo
          </Button>
          {product && (
            <PhotoCountDialog
              open={photoOpen}
              onOpenChange={setPhotoOpen}
              productName={product.name}
              onUse={(count, photoNote) => {
                // The photo gives a total, so switch out of adjustment mode.
                setCountEntryMode('total'); setCounted(String(count)); setSubmitted(false)
                setNote((current) => current.trim() ? `${current.trim()}\n${photoNote}` : photoNote)
              }}
            />
          )}
          {countEntryMode === 'adjustment' && product && enteredCount !== null && Number.isInteger(enteredCount) && countedNum !== null && (
            <p role="status" aria-live="polite" data-testid="adjustment-result" className="rounded-[12px] border border-line bg-elevated px-4 py-3 text-body-sm text-fg-secondary">
              New counted quantity: <span className="num font-semibold text-fg">{countedNum}</span>
            </p>
          )}
          {difference === 0 && <NoDifferenceBadge />}
          {duplicateCase && <ErrorNotice title="A case for this count is already open." description={`${duplicateCase.id} has the same product and count. Open it instead of creating a duplicate.`} action={<Link href={`/cases/${duplicateCase.id}`} className="text-body-sm font-medium text-accent-text underline-offset-4 hover:underline">Open {duplicateCase.id}</Link>} />}
          <Field label={<>Note <span className="font-normal text-fg-tertiary">(optional)</span></>} id={ids.note}>
            <Textarea id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Where you counted, anything unusual" className="min-h-24 rounded-[12px] border-line bg-elevated text-body" />
          </Field>
          <Button type="submit" size="lg" disabled={busy || !canWrite || Boolean(duplicateCase)} title={!canWrite ? 'Permission required: Staff or Manager' : undefined}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{busy ? 'Submitting…' : 'Submit count'}
          </Button>
        </form>
      </Card>
    )
  }
}

function Field({ label, id, children, error, errorId }: { label: React.ReactNode; id: string; children: React.ReactNode; error?: string; errorId?: string }) {
  return <div className="flex flex-col gap-2"><Label htmlFor={id} className="text-body-sm font-medium">{label}</Label>{children}{error && <p id={errorId} className="text-body-sm font-medium text-danger">{error}</p>}</div>
}

function ProductEvidenceStep({ product, file, fileError, fileInput, onFile, onDone }: {
  product: Product; file: File | null; fileError: string; fileInput: React.RefObject<HTMLInputElement | null>
  onFile: (file: File | null) => void; onDone: () => void
}) {
  return (
    <Card className="flex flex-col gap-4 p-5 md:p-6">
      <div><h2 className="text-h2 font-semibold">Upload evidence</h2><p className="text-body-sm text-fg-secondary">Step 2 of 2 · {product.name}</p></div>
      <p className="text-body-sm text-fg-secondary">Add a delivery note, invoice or photo of the item.</p>
      <p className="text-body-sm text-fg-secondary">Photos and PDFs support human review only. They do not reconcile quantities, mark a discrepancy supported, or approve a case.</p>
      <div className="rounded-[12px] border border-line bg-elevated p-4">
        <label htmlFor="new-product-evidence-file" className="mb-2 block text-body-sm font-medium">Evidence file</label>
        <p className="text-body-sm font-medium">JPG, PNG or PDF · Up to 10 MB</p>
        <input ref={fileInput} id="new-product-evidence-file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="sr-only" aria-describedby="new-product-evidence-help" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <span id="new-product-evidence-help" className="sr-only">Choose a JPG, PNG or PDF up to 10 MB.</span>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} className="min-h-11"><Paperclip aria-hidden="true" />{file ? 'Change file' : 'Select photo or PDF'}</Button>
          {file && <Button type="button" variant="ghost" size="icon" aria-label="Remove selected file" onClick={() => { onFile(null); if (fileInput.current) fileInput.current.value = '' }}><X aria-hidden="true" /></Button>}
        </div>
        {file && <div role="status" className="mt-3 flex items-center gap-3 rounded-lg border border-line p-3"><FileText className="size-5 text-accent-text" aria-hidden="true" /><div className="min-w-0"><p className="break-all text-body-sm font-medium">{file.name}</p><p className="text-caption text-fg-secondary">{(file.size / 1024).toFixed(0)} KB · Kept in this form only</p></div></div>}
        {fileError && <p role="alert" className="mt-3 text-body-sm text-danger">{fileError}</p>}
      </div>
      {file && <p className="text-body-sm text-fg-secondary">Selected file: {file.name} · {file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</p>}
      <ErrorNotice title="Product evidence is not available yet" description="This app has no product-level evidence API. The selected file has not been uploaded. The backend must add reserve upload, upload, finalize, and link-to-product endpoints with the same 10 MB, file-type, and role checks as case evidence." />
      <p className="text-caption text-fg-tertiary">TODO: connect product-level evidence API before enabling uploads. The new product remains marked Evidence missing.</p>
      <Button type="button" disabled title={!file ? 'Choose a file first' : fileError || 'Product evidence API is not available yet'} className="self-start min-h-11"><Paperclip aria-hidden="true" />Upload evidence</Button>
      <Button type="button" onClick={onDone} className="self-start min-h-11">Done</Button>
    </Card>
  )
}

function StockSummaryPanel({ items, matches, total, updatedAt, loading, error, selectedId, updatedProductId, role, onRetry }: {
  items: StockSummaryItem[]; matches: number; total: number; updatedAt: string; loading: boolean; error: string | null
  selectedId: string; updatedProductId: string; role: string; onRetry: () => void
}) {
  const [compactOpen, setCompactOpen] = useState(false)
  const visible = useMemo(() => {
    const rank = (item: StockSummaryItem) => item.difference === null ? 1 : item.difference === 0 ? 2 : 0
    const compare = (a: StockSummaryItem, b: StockSummaryItem) => {
      const rankDiff = rank(a) - rank(b)
      if (rankDiff) return rankDiff
      if (rank(a) === 0) return Math.abs(b.difference!) - Math.abs(a.difference!)
      return 0
    }
    const sorted = [...items].sort(compare)
    const selected = items.find(item => item.productId === selectedId)
    const subset = sorted.slice(0, 6)
    if (selected && !subset.some(item => item.productId === selectedId)) subset[5] = selected
    return subset.sort(compare)
  }, [items, selectedId])
  const updated = updatedAt ? new Date(updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
  const differCount = items.filter(item => item.difference !== null && item.difference !== 0).length
  return (
    <Card className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-5" aria-labelledby="count-stock-summary">
      <style>{`@keyframes count-summary-row-pulse { 0% { box-shadow: inset 2px 0 var(--accent-fill), 0 0 0 2px color-mix(in srgb, var(--accent-fill) 28%, transparent); } 100% { box-shadow: inset 2px 0 transparent, 0 0 0 0 transparent; } } @media (prefers-reduced-motion: reduce) { .count-summary-row-pulse { animation: none !important; } }`}</style>
      <div className="flex items-start justify-between gap-3">
        <div className="hidden lg:block">
          <h2 id="count-stock-summary" className="text-h3 font-semibold">Count progress</h2>
          <p className="text-body-sm text-fg-secondary">Counted vs recorded</p>
        </div>
        <button type="button" className="min-h-11 min-w-0 flex-1 text-left text-[13px] font-medium text-fg lg:hidden" onClick={() => setCompactOpen(open => !open)} aria-expanded={compactOpen} aria-label={`${matches} of ${total} match · ${differCount} differ · ${compactOpen ? 'Hide progress' : 'View progress'}`}>
          <span id="count-stock-summary">{matches} of {total} match · {differCount} differ · <span className="text-accent-text">{compactOpen ? 'Hide progress' : 'View progress'}</span></span>
        </button>
        <p className="hidden shrink-0 text-right text-caption text-fg-tertiary lg:block"><span className="block">Last updated</span><time>{updated}</time></p>
      </div>
      {loading ? <div aria-busy="true" aria-label="Loading stock summary" className="flex flex-col gap-4">
        {[1, 2, 3].map(i => <div key={i} className="grid min-h-[60px] grid-cols-[36px_1fr_76px] grid-rows-[22px_20px] items-center gap-x-3 gap-y-1 rounded-[10px] px-2 py-1.5">
          <span className="row-span-2 size-9 animate-pulse rounded-full bg-elevated" />
          <span className="h-4 animate-pulse rounded bg-elevated" />
          <span className="col-start-3 row-start-1 h-4 animate-pulse rounded bg-elevated" />
          <span className="col-start-2 col-span-2 row-start-2 h-3 animate-pulse rounded bg-elevated" />
        </div>)}
      </div>
        : error ? <ErrorNotice title="Could not load stock summary" description={error} onRetry={onRetry} />
          : <>
            <div className="hidden items-baseline justify-between gap-3 lg:flex">
              <p className="num text-h2 font-semibold" data-testid="text-stock-matches">{matches} of {total} match</p>
              <p className="text-caption text-fg-secondary">{differCount} differ</p>
            </div>
            {items.length === 0 ? <p className={cn('text-body-sm text-fg-secondary', compactOpen ? 'block' : 'hidden lg:block')}>No products yet. Add your first product.</p>
              : <ul className={cn('max-h-[min(60vh,480px)] flex-col gap-4 overflow-y-auto pr-1', compactOpen ? 'flex' : 'hidden lg:flex')} aria-label="Products counted vs recorded">
                {visible.map(item => <SummaryRow key={item.productId} item={item} selected={item.productId === selectedId} pulse={item.productId === updatedProductId} />)}
              </ul>}
            {role !== 'staff' && <Link href="/reports" className="mt-1 min-h-11 self-start text-body-sm font-medium text-accent-text underline-offset-4 hover:underline">View all {total} products</Link>}
          </>}
    </Card>
  )
}

function SummaryRow({ item, selected, pulse }: { item: StockSummaryItem; selected: boolean; pulse: boolean }) {
  const counted = item.counted ?? 0
  const progress = item.counted === null ? 0 : item.recorded === 0 ? (counted > 0 ? 100 : 0) : Math.min(100, Math.round(counted / item.recorded * 100))
  const difference = item.difference
  const percent = difference === null || item.recorded === 0 ? (difference && difference > 0 ? '∞' : '0') : String(Math.round(Math.abs(difference / item.recorded * 100)))
  const status = difference === null
    ? <span className="inline-flex items-center gap-1.5 text-[13px] font-medium leading-5 text-fg-tertiary"><Minus className="size-4" aria-hidden="true" />Not counted</span>
    : difference === 0
      ? <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold leading-5 text-success"><CheckCircle2 className="size-4" aria-hidden="true" />Match</span>
      : <span className={cn('flex flex-col items-end text-right text-[14px] font-semibold leading-5', difference < 0 ? 'text-danger' : 'text-success')}>
          <span className="inline-flex items-center gap-1.5">{difference < 0 ? <CircleMinus className="size-4" aria-hidden="true" /> : <CirclePlus className="size-4" aria-hidden="true" />}{difference < 0 ? '−' : '+'}{percent}%</span>
          <span className={cn('text-[11px] font-normal leading-4', difference < 0 ? 'text-fg-secondary' : 'text-success')}>{difference < 0 ? '−' : '+'}{Math.abs(difference)} units</span>
        </span>
  return (
    <li>
      <Link href={`/reports?product=${encodeURIComponent(item.productId)}`} title={item.name} aria-label={`${item.name}; ${item.counted === null ? 'not counted' : `${item.counted} counted of ${item.recorded} recorded`}; open in Summary`} className={cn('group grid min-h-[60px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-[22px_20px] items-center gap-x-3 gap-y-1 rounded-[12px] border-l-2 px-2.5 py-1.5 transition-all duration-200 hover:bg-elevated/80 focus-visible:outline-2 focus-visible:outline-accent-text', selected ? 'border-l-accent-fill bg-elevated/70 shadow-sm' : 'border-l-transparent bg-surface/30', pulse && 'count-summary-row-pulse')} data-testid={`link-summary-product-${item.productId}`} data-count-pulse={pulse || undefined}>
        <span aria-hidden="true" className="row-span-2 flex size-9 items-center justify-center rounded-full bg-elevated text-body-sm font-semibold text-fg-secondary">{item.name.trim().charAt(0).toUpperCase()}</span>
        <span className="min-w-0 truncate text-[15px] font-medium leading-5" title={item.name}>{item.name}</span>
        <span className="col-start-3 row-start-1 flex items-center">{status}</span>
        <span className="col-start-2 col-span-2 row-start-2 flex min-w-0 items-center gap-2">
          <span className="num shrink-0 text-[13px] leading-5 text-fg-secondary">{item.counted === null ? `— / ${item.recorded}` : `${item.counted} / ${item.recorded}`}</span>
          <span className="relative h-1.5 w-full min-w-8 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-label={`${item.name} counted stock`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span className="block h-full rounded-full bg-accent-fill" style={{ width: `${progress}%` }} />
            {item.counted !== null && item.counted > item.recorded && <span aria-hidden="true" className="absolute right-0 top-1/2 h-2 w-px -translate-y-1/2 bg-accent-text" />}
          </span>
        </span>
      </Link>
    </li>
  )
}
