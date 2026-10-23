import { useEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { Redirect, Route, Switch, useLocation, useParams, useSearch, Router as WouterRouter } from 'wouter'
import { ErrorBoundary } from '@/components/error-boundary'
import { AppProvider, useApp } from '@/components/app/app-provider'
import { AppShell } from '@/components/app/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { CaseDetailView } from '@/components/screens/case-detail-view'
import { CratesView } from '@/components/screens/crates-view'
import { CountView } from '@/components/screens/count-view'
import { HistoryView } from '@/components/screens/history-view'
import { InboxFramesView } from '@/components/screens/inbox-frames-view'
import { InboxView } from '@/components/screens/inbox-view'
import { PassportView } from '@/components/screens/passport-view'
import { WeeklyReportView } from '@/components/screens/weekly-report-view'
import { OwnerDecisionsView } from '@/components/screens/owner-decisions-view'
import { StaffWorkView } from '@/components/screens/staff-work-view'
import { DemoLoginView } from '@/components/screens/demo-login-view'
import { ErrorNotice } from '@/components/veracity/primitives'
import { roleHome } from '@/lib/role-home'

function useTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}

function Titled({ title, children }: { title: string; children: ReactNode }) {
  useTitle(title)
  return <>{children}</>
}

function CasePage() {
  const { id = '' } = useParams<{ id: string }>()
  const v = new URLSearchParams(useSearch()).get('v')
  useTitle(`${id} · Veracity`)
  return <CaseDetailView id={id} version={v ? Number(v) : undefined} />
}

function PassportPage() {
  const { id = '' } = useParams<{ id: string }>()
  useTitle(`Decision Passport ${id} · Veracity`)
  return <PassportView id={id} />
}

function RoleLanding() {
  const { role, loading, error, refresh } = useApp()
  if (loading) return <p role="status" className="text-body-sm text-fg-secondary">Loading your workspace…</p>
  if (error) return <ErrorNotice title="Could not load your workspace" description={error} onRetry={() => { void refresh().catch(() => {}) }} />
  return <Redirect to={roleHome(role)} replace />
}

function Router() {
  const [location] = useLocation()
  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/"><Redirect to="/login" replace /></Route>
        <Route path="/work"><Titled title="My work · Veracity"><StaffWorkView /></Titled></Route>
        <Route path="/decisions"><Titled title="Decision overview · Veracity"><OwnerDecisionsView /></Titled></Route>
        <Route path="/inbox"><Titled title="Inbox · Veracity"><InboxView /></Titled></Route>
        <Route path="/inbox/frames"><Titled title="Inbox frames · Veracity"><InboxFramesView /></Titled></Route>
        <Route path="/crates"><Titled title="Crate tracking · Veracity"><CratesView /></Titled></Route>
        <Route path="/count"><Titled title="New count · Veracity"><CountView /></Titled></Route>
        <Route path="/account"><RoleLanding /></Route>
        <Route path="/cases/:id" component={CasePage} />
        <Route path="/history"><Titled title="History · Veracity"><HistoryView /></Titled></Route>
        <Route path="/reports"><Titled title="Weekly summary · Veracity"><WeeklyReportView /></Titled></Route>
        <Route path="/history/:id" component={PassportPage} />
        <Route>
          <Titled title="Page not found · Veracity">
            <div className="flex min-h-80 flex-col items-center justify-center gap-4">
              <h1 className="text-h1 font-semibold">404 · Page not found</h1>
              <a href={`${import.meta.env.BASE_URL}inbox`} className="text-accent-text underline">Back to Inbox</a>
            </div>
          </Titled>
        </Route>
      </Switch>
    </ErrorBoundary>
  )
}

function DemoAccess() {
  const { authenticated, loading, error, refresh } = useApp()
  const [location] = useLocation()
  const search = useSearch()
  if (location === '/') return <Redirect to="/login" replace />
  if (location === '/login') {
    return <Titled title="Login · Veracity"><DemoLoginView /></Titled>
  }
  if (loading) return <main className="flex min-h-dvh items-center justify-center bg-canvas"><p role="status">Loading your demo session…</p></main>
  if (!authenticated) {
    if (error) return <main className="mx-auto flex min-h-dvh max-w-lg items-center p-6"><ErrorNotice title="Could not check your demo session" description={error} onRetry={() => { void refresh().catch(() => {}) }} /></main>
    const next = location === '/' ? '' : `?next=${encodeURIComponent(location + (search ? `?${search}` : ''))}`
    return <Redirect to={`/login${next}`} replace />
  }
  return <AppShell><Router /></AppShell>
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <AppProvider>
          <DemoAccess />
          <Toaster position="top-center" />
        </AppProvider>
      </WouterRouter>
    </ThemeProvider>
  )
}

export default App
