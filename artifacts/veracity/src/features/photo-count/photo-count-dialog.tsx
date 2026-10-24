import { useRef, useState, type PointerEvent } from 'react'
import { Camera, Loader2, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { readJson } from '@/lib/read-json'
import { cn } from '@/lib/utils'

interface Box { x: number; y: number; width: number; height: number }
interface CountResult { count: number; boxes: (Box & { score: number })[]; imageWidth: number; imageHeight: number; provider: string; model?: string }
interface Photo { dataUrl: string; width: number; height: number }

const MAX_SIDE = 1600 // Keeps the upload small; plenty of detail for counting.
// Share of the photo an example box may cover. One of several items cannot fill
// half the photo; a box that large almost always frames the whole counting area.
const TOO_BIG = 0.5
const LOOKS_BIG = 0.2

// Downscale in the browser (also applies the camera's EXIF rotation) so the
// request stays well under the API's JSON size limit.
async function loadPhoto(file: File): Promise<Photo> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
}

const percent = (box: Box, photo: Photo) => ({
  left: `${(box.x / photo.width) * 100}%`, top: `${(box.y / photo.height) * 100}%`,
  width: `${(box.width / photo.width) * 100}%`, height: `${(box.height / photo.height) * 100}%`,
})

export function PhotoCountDialog({ open, onOpenChange, productName, onUse }: {
  open: boolean; onOpenChange: (open: boolean) => void; productName: string
  onUse: (count: number, note: string) => void
}) {
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [example, setExample] = useState<Box | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  // The example as of the last pointer-up. Hints follow this, not the box being
  // dragged: a hint changing length mid-drag moves the centred dialog under the
  // finger and shifts the box (seen on phones).
  const [settled, setSettled] = useState<Box | null>(null)
  const [result, setResult] = useState<CountResult | null>(null)
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [confirmed, setConfirmed] = useState('')
  const [covers, setCovers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const frame = useRef<HTMLDivElement>(null)

  const reset = () => {
    setPhoto(null); setExample(null); setSettled(null); setDrag(null); setResult(null); setExcluded(new Set())
    setConfirmed(''); setCovers(false); setError('')
    if (fileInput.current) fileInput.current.value = ''
  }
  const close = (next: boolean) => { if (!next) reset(); onOpenChange(next) }

  const choose = async (file: File | undefined) => {
    if (!file) return
    reset()
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Use a JPG or PNG photo.'); return }
    try { setPhoto(await loadPhoto(file)) } catch { setError('This photo could not be opened. Try another JPG or PNG.') }
  }

  // Pointer position in photo pixels.
  const point = (event: PointerEvent) => {
    const rect = frame.current!.getBoundingClientRect()
    return {
      x: Math.min(photo!.width, Math.max(0, ((event.clientX - rect.left) / rect.width) * photo!.width)),
      y: Math.min(photo!.height, Math.max(0, ((event.clientY - rect.top) / rect.height) * photo!.height)),
    }
  }
  const onDown = (event: PointerEvent) => {
    if (!photo || busy || result) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event)
    setDrag(p); setExample({ ...p, width: 0, height: 0 }); setError('')
  }
  const onMove = (event: PointerEvent) => {
    if (!drag) return
    const p = point(event)
    setExample({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) })
  }
  const onUp = () => {
    setDrag(null)
    const kept = example && example.width >= 10 && example.height >= 10 ? example : null
    if (!kept) setExample(null)
    setSettled(kept)
  }

  const analyse = async () => {
    if (!photo || !example || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/vision/count', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: photo.dataUrl, exemplar: example, label: productName }),
      })
      const data = await readJson<CountResult & { error?: string }>(response)
      if (!response.ok) throw new Error(data.error || 'Photo counting failed.')
      setResult(data); setExcluded(new Set()); setConfirmed(String(data.count))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const toggle = (index: number) => {
    const next = new Set(excluded)
    if (next.has(index)) next.delete(index); else next.add(index)
    setExcluded(next)
    if (result) setConfirmed(String(result.count - next.size))
  }

  const shareOf = (box: Box | null) => photo && box ? (box.width * box.height) / (photo.width * photo.height) : 0
  const exampleShare = shareOf(example)
  const settledShare = shareOf(settled)
  const detected = result ? result.count - excluded.size : 0
  const confirmedNum = confirmed === '' ? NaN : Number(confirmed)
  const confirmedValid = Number.isInteger(confirmedNum) && confirmedNum >= 0 && confirmedNum <= 1_000_000_000
  const use = () => {
    if (!result || !confirmedValid || !covers) return
    const corrected = confirmedNum === result.count ? '' : `; staff confirmed ${confirmedNum}`
    onUse(confirmedNum, `Counted from photo: AI detected ${result.count}${corrected}.`)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] gap-4 overflow-y-auto rounded-[20px] border border-line bg-surface p-5 ring-0 sm:max-w-2xl" data-testid="dialog-photo-count">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-h2 font-semibold">Count from photo</DialogTitle>
          <DialogDescription className="text-body-sm text-fg-secondary">
            {productName}. Take or upload one photo of the counting area, then drag a box around <strong className="text-fg">just one</strong> item (for example, one pack, not the whole box) so the AI knows what to count.
          </DialogDescription>
        </DialogHeader>

        <input ref={fileInput} type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" aria-label="Photo to count" data-testid="input-photo-count" onChange={(e) => void choose(e.target.files?.[0])} />
        {!photo && (
          <Button type="button" variant="secondary" className="min-h-11 self-start" onClick={() => fileInput.current?.click()}>
            <Camera aria-hidden="true" /> Take or choose photo
          </Button>
        )}

        {photo && (
          <div
            ref={frame}
            // overflow-clip, not overflow-hidden: in the dialog's grid a hidden-overflow
            // item may shrink to 0 height, squashing the photo on short (phone) screens.
            className={cn('relative w-full touch-none select-none overflow-clip rounded-[12px] border border-line', !result && 'cursor-crosshair')}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            data-testid="photo-count-frame"
          >
            <img src={photo.dataUrl} alt="Photo to count" className="block w-full" draggable={false} />
            {example && !result && <span className="pointer-events-none absolute border-2 border-dashed border-warning bg-warning/10" style={percent(example, photo)} />}
            {result?.boxes.map((box, index) => (
              <button
                key={index} type="button" onClick={() => toggle(index)}
                aria-label={`Item ${index + 1}${excluded.has(index) ? ', excluded' : ''}. Toggle`}
                className={cn('absolute rounded-[4px] border-2', excluded.has(index) ? 'border-danger bg-danger/25' : 'border-success bg-success/10')}
                style={percent(box, photo)}
              />
            ))}
          </div>
        )}

        {photo && !result && (
          settledShare > TOO_BIG
            ? <p role="alert" className="text-body-sm font-medium text-danger" data-testid="text-photo-count-box-too-big">This box covers most of the photo. Redraw it around just one item (for example, one pack), not the whole counting area.</p>
            : settledShare > LOOKS_BIG
              ? <p role="status" className="text-body-sm font-medium text-warning">This box is large. Make sure it contains exactly one item, not several.</p>
              : <p className="text-body-sm text-fg-secondary">{settled ? 'Example selected. Redraw to change it.' : 'Drag a box around one whole item in the photo, not the whole area.'}</p>
        )}

        {result && (
          <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-elevated p-4" role="status" aria-live="polite">
            <p className="text-body font-semibold" data-testid="text-photo-count-result">
              AI detected {result.count} {result.count === 1 ? 'item' : 'items'}. Review and confirm the count.
            </p>
            <p className="text-caption text-fg-tertiary" data-testid="text-photo-count-model">
              Counted by {result.provider === 'runpod' ? 'RunPod' : 'the built-in counter'}{result.model ? ` · ${result.model}` : ''}
            </p>
            {result.model?.includes('(example') && (
              <p className="text-body-sm font-medium text-warning" data-testid="text-photo-count-name-mismatch">
                The AI could not find “{productName}” by name in this photo, so it counted by the example’s look only. Check that the right product is selected.
              </p>
            )}
            {result.count <= 1 && (
              <p className="text-body-sm font-medium text-warning" data-testid="text-photo-count-one">
                Only the example was found. If the box held more than one item, choose <strong>Pick another example</strong> and box a single item.
              </p>
            )}
            <p className="text-body-sm text-fg-secondary">
              Tap a box to exclude a wrong detection{excluded.size ? ` (${excluded.size} excluded, ${detected} left)` : ''}. Add any missed items in the number below.
            </p>
            <label className="flex flex-col gap-2 text-body-sm font-medium">
              Confirmed quantity
              <Input type="number" min={0} step={1} inputMode="numeric" value={confirmed} onChange={(e) => setConfirmed(e.target.value)} aria-invalid={!confirmedValid} className="num h-12 max-w-40 text-h3 font-semibold" data-testid="input-photo-count-confirmed" />
            </label>
            <label className="flex items-start gap-3 text-body-sm">
              <input type="checkbox" checked={covers} onChange={(e) => setCovers(e.target.checked)} className="mt-1 size-4 accent-[var(--accent-fill)]" data-testid="checkbox-photo-covers" />
              <span>This photo covers the whole counting area for {productName}. One shelf section is not the whole shop.</span>
            </label>
          </div>
        )}

        {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}

        <DialogFooter className="flex-wrap gap-3">
          {photo && <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => fileInput.current?.click()}>Change photo</Button>}
          {result && <Button type="button" variant="secondary" className="min-h-11" onClick={() => { setResult(null); setExample(null); setSettled(null); setExcluded(new Set()) }}>Pick another example</Button>}
          {!result
            ? <Button type="button" className="min-h-11" disabled={!photo || !example || busy || exampleShare > TOO_BIG} onClick={() => void analyse()} data-testid="button-photo-count-analyse">
                {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}{busy ? 'Counting… (the first count can take a minute)' : 'Count items'}
              </Button>
            : <Button type="button" className="min-h-11" disabled={!confirmedValid || !covers} title={!covers ? 'Confirm the photo covers the whole counting area' : undefined} onClick={use} data-testid="button-photo-count-use">
                Use this count
              </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
