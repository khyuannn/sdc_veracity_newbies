
import { BarChart3, ClipboardList, History, Inbox, ShieldCheck, ListChecks, BookOpenCheck } from 'lucide-react'
import { Link } from 'wouter'
import { useLocation } from 'wouter'
import { cn } from '@/lib/utils'
import { useApp } from './app-provider'
import { RoleSwitcher } from './role-switcher'
import { roleHome } from '@/lib/role-home'
import type { Role } from '@/lib/types'

const NAV: { href: string; label: string; icon: typeof Inbox; roles?: Role[] }[] = [
  { href: '/work', label: 'My work', icon: ListChecks, roles: ['staff'] },
  { href: '/count', label: 'Count', icon: ClipboardList, roles: ['staff', 'manager'] },
  { href: '/crates', label: 'Crates', icon: ClipboardList },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/history', label: 'History', icon: History },
  { href: '/decisions', label: 'Decisions', icon: BookOpenCheck, roles: ['owner'] },
  { href: '/reports', label: 'Summary', icon: BarChart3, roles: ['manager', 'owner'] },
]

function Brand() {
  const { role } = useApp()
  return (
    <Link href={roleHome(role)} aria-label="Veracity home" className="flex items-center gap-3 rounded-[12px]">
      <img
        src={`${import.meta.env.BASE_URL}veracity-icon.png`}
        alt=""
        className="size-10 shrink-0 rounded-[12px] object-contain"
      />
      <span className="flex flex-col">
        <span className="text-h3 font-semibold">Veracity</span>
        <span className="text-caption text-fg-tertiary">Inventory · Orbyte</span>
      </span>
    </Link>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [pathname] = useLocation()
  const { inboxCases, role } = useApp()
  const nav = NAV.filter((item) => !item.roles || item.roles.includes(role))
  const inboxCount = inboxCases.length
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === '/inbox' && pathname.startsWith('/cases'))

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded-[12px] bg-accent-fill px-4 py-3 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-8 border-r border-line bg-surface p-5 md:flex">
        <Brand />
        <nav aria-label="Main" className="flex flex-col gap-1">
          {nav.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-[12px] px-3 text-body-sm font-medium transition-colors',
                  active ? 'bg-elevated text-fg' : 'text-fg-secondary hover:bg-elevated hover:text-fg',
                )}
              >
                <item.icon className={cn('size-5', active && 'text-accent-text')} aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {item.href === '/inbox' && inboxCount > 0 && (
                  <span className="num rounded-full bg-accent-fill px-2 py-0.5 text-caption font-semibold text-white">
                    {inboxCount}
                    <span className="sr-only"> open cases</span>
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur md:justify-end md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <RoleSwitcher />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-[calc(160px+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-16">
          {children}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {nav.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex h-16 min-w-16 flex-1 flex-col items-center justify-center gap-1 text-caption font-medium',
                active ? 'text-accent-text' : 'text-fg-secondary',
              )}
            >
              <span className="relative">
                <item.icon className="size-6" aria-hidden="true" />
                {item.href === '/inbox' && inboxCount > 0 && (
                  <span className="num absolute -top-1.5 -right-3 rounded-full bg-accent-fill px-1.5 text-[11px] leading-4 font-semibold text-white">
                    {inboxCount}
                    <span className="sr-only"> open cases</span>
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
