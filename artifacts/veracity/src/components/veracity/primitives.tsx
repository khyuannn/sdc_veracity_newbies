import { AlertCircle, Inbox, Lock, RotateCw, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-[20px] border border-line bg-surface p-4 md:p-5', className)}
      {...props}
    />
  )
}

export function StatTile({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string
  value: string | number
  tone?: 'default' | 'accent'
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-[12px] border border-line bg-elevated p-4', className)}>
      <span className="text-body-sm text-fg-secondary">{label}</span>
      <span className={cn('num text-display font-semibold', tone === 'accent' ? 'text-accent-text' : 'text-fg')}>
        {value}
      </span>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1-sm font-semibold text-balance md:text-h1">{title}</h1>
        {subtitle && <p className="text-body text-fg-secondary">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string
  description: string
  icon?: LucideIcon
  action?: React.ReactNode
}) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-elevated text-accent-text">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-h2 font-semibold">{title}</h2>
      <p className="max-w-[46ch] text-body text-fg-secondary text-pretty">{description}</p>
      {action}
    </Card>
  )
}

export function ErrorNotice({
  title,
  description,
  onRetry,
  action,
  className,
}: {
  title: string
  description?: string
  onRetry?: () => void
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-[12px] border border-danger/40 bg-surface p-4 sm:flex-row sm:items-start',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-1">
        <p className="text-body font-medium text-fg">{title}</p>
        {description && <p className="text-body-sm text-fg-secondary">{description}</p>}
        {action}
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="self-start">
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  )
}

export function LockNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-line bg-elevated p-4 text-body-sm text-fg-secondary">
      <Lock className="mt-0.5 size-4 shrink-0 text-fg" aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
