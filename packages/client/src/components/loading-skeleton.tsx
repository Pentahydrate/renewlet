import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type PageSkeletonProps = {
  withPageShell?: boolean;
};

function range(length: number): number[] {
  return Array.from({ length }, (_: unknown, index: number) => index);
}

function SkeletonBox({ className }: { className: string }) {
  return <Skeleton className={className} />;
}

function HeaderSkeleton({ showAddAction = false }: { showAddAction?: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl" data-testid="app-header-skeleton">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-4 lg:gap-8">
          <div className="flex min-w-0 items-center gap-3">
            <SkeletonBox className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="grid min-w-0 gap-1">
              <SkeletonBox className="h-6 w-28" />
              <SkeletonBox className="hidden h-3 w-32 min-[380px]:block" />
            </div>
          </div>
          <nav className="hidden items-center gap-1 lg:flex">
            {range(5).map((index) => (
              <div key={index} className="flex items-center gap-2 rounded-lg px-4 py-2">
                <SkeletonBox className="h-4 w-4 rounded" />
                <SkeletonBox className="h-4 w-16" />
              </div>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <SkeletonBox className="h-9 w-9 rounded-md" />
          {showAddAction ? <SkeletonBox className="h-9 w-9 rounded-md sm:w-28" /> : null}
          <SkeletonBox className="h-9 w-9 rounded-md" />
        </div>
      </div>
      <nav className="flex border-t border-border lg:hidden">
        {range(5).map((index) => (
          <div key={index} className="flex flex-1 flex-col items-center gap-1 py-3">
            <SkeletonBox className="h-5 w-5 rounded" />
            <SkeletonBox className="h-3 w-10" />
          </div>
        ))}
      </nav>
    </header>
  );
}

function PageShellSkeleton({
  children,
  maxWidthClassName = "max-w-7xl",
  showAddAction = false,
  testId,
}: {
  children: React.ReactNode;
  maxWidthClassName?: string;
  showAddAction?: boolean;
  testId: string;
}) {
  return (
    <div className="app-page bg-background" aria-busy="true" data-testid={testId}>
      <HeaderSkeleton showAddAction={showAddAction} />
      <main className={cn("app-main mx-auto", maxWidthClassName)}>
        <div aria-hidden="true">{children}</div>
      </main>
    </div>
  );
}

function PageTitleSkeleton({ withActions = false, subtitleWidth = "w-48" }: { withActions?: boolean; subtitleWidth?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <SkeletonBox className="h-8 w-32 rounded" />
        <SkeletonBox className={cn("mt-2 h-4 rounded", subtitleWidth)} />
      </div>
      {withActions ? (
        <div className="flex items-center gap-2">
          <SkeletonBox className="h-9 w-9 rounded-md" />
          <SkeletonBox className="h-9 w-24 rounded-md" />
          <SkeletonBox className="h-9 w-9 rounded-md" />
        </div>
      ) : null}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <div className="grid gap-2">
          <SkeletonBox className="h-4 w-20" />
          <SkeletonBox className="h-8 w-24" />
          <SkeletonBox className="h-3 w-28" />
        </div>
        <SkeletonBox className="h-12 w-12 rounded-lg" />
      </div>
    </div>
  );
}

function SubscriptionCardSkeleton({ list = false }: { list?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", list && "min-h-[126px]")}>
      <div className="flex items-start gap-4">
        <SkeletonBox className="h-12 w-12 shrink-0 rounded-lg" />
        <div className="grid flex-1 gap-2">
          <SkeletonBox className="h-5 w-32" />
          <SkeletonBox className="h-4 w-24" />
          <SkeletonBox className="h-3 w-28" />
        </div>
        {list ? <SkeletonBox className="hidden h-9 w-24 rounded-md sm:block" /> : null}
      </div>
    </div>
  );
}

function DashboardContentSkeleton() {
  return (
    <div className="grid gap-8">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {range(4).map((index) => <StatCardSkeleton key={index} />)}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <SkeletonBox className="h-6 w-28" />
            <SkeletonBox className="h-9 w-20 rounded-md" />
          </div>
          <div className="grid items-stretch gap-4 sm:grid-cols-2">
            {range(6).map((index) => <SubscriptionCardSkeleton key={index} />)}
          </div>
        </div>

        <div className="grid gap-6">
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <SkeletonBox className="mb-3 h-6 w-32" />
            <SkeletonBox className="h-[220px] w-full rounded-lg" />
          </div>
          <div className="rounded-xl border border-border bg-card p-6 shadow-card">
            <SkeletonBox className="mb-4 h-6 w-28" />
            <div className="grid gap-3">
              {range(4).map((index) => (
                <div key={index} className="flex items-center gap-3">
                  <SkeletonBox className="h-10 w-10 rounded-lg" />
                  <div className="grid flex-1 gap-1">
                    <SkeletonBox className="h-4 w-28" />
                    <SkeletonBox className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubscriptionsContentSkeleton() {
  return (
    <>
      <PageTitleSkeleton withActions subtitleWidth="w-56" />

      <div className="mb-6 grid gap-3 rounded-xl border border-border bg-card p-5 md:gap-4">
        <div className="grid gap-3 md:hidden">
          <SkeletonBox className="h-11 w-full rounded-md" />
          <div className="grid grid-cols-2 gap-3">
            <SkeletonBox className="h-11 w-full rounded-md" />
            <SkeletonBox className="h-11 w-full rounded-md" />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <SkeletonBox className="h-11 flex-1 rounded-md" />
            <SkeletonBox className="h-11 w-11 rounded-md" />
          </div>
        </div>
        <div className="hidden flex-wrap items-center gap-4 md:flex">
          <SkeletonBox className="h-10 min-w-[200px] flex-1 rounded-md" />
          <SkeletonBox className="h-10 w-[140px] rounded-md" />
          <SkeletonBox className="h-10 w-[140px] rounded-md" />
          <SkeletonBox className="h-10 w-[190px] rounded-md" />
          <SkeletonBox className="h-10 w-24 rounded-md" />
        </div>
      </div>

      <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="subscriptions-skeleton-list">
        {range(9).map((index) => <SubscriptionCardSkeleton key={index} />)}
      </div>
    </>
  );
}

function StatisticsContentSkeleton() {
  return (
    <>
      <PageTitleSkeleton withActions subtitleWidth="w-64" />

      <section className="mb-8">
        <SkeletonBox className="mb-4 h-6 w-24" />
        <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {range(11).map((index) => (
            <div key={index} className="flex min-h-[116px] flex-col items-center justify-center rounded-xl border border-border bg-card p-5 text-center">
              <SkeletonBox className="mb-2 h-8 w-20" />
              <SkeletonBox className="h-4 w-24" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <SkeletonBox className="mb-4 h-6 w-24" />
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          {range(2).map((index) => (
            <div key={index} className="min-w-0 rounded-xl border border-border bg-card p-6">
              <SkeletonBox className="mx-auto mb-2 h-5 w-24" />
              <SkeletonBox className="mx-auto mb-3 h-3 w-32" />
              <SkeletonBox className="h-[220px] w-full rounded-lg" />
            </div>
          ))}
          <div className="min-w-0 rounded-xl border border-border bg-card p-6 md:col-span-2">
            <SkeletonBox className="mx-auto mb-2 h-5 w-32" />
            <SkeletonBox className="mx-auto mb-3 h-3 w-40" />
            <SkeletonBox className="h-[220px] w-full rounded-lg" />
            <div className="mt-4 flex flex-col justify-center gap-4 min-[380px]:flex-row min-[380px]:gap-8">
              <SkeletonBox className="mx-auto h-14 w-28" />
              <SkeletonBox className="mx-auto h-14 w-28" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function CalendarContentSkeleton() {
  return (
    <>
      <PageTitleSkeleton subtitleWidth="w-48" />

      <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-card sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <SkeletonBox className="h-5 w-5 rounded" />
            <SkeletonBox className="h-6 w-24" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
            <SkeletonBox className="h-8 w-14 rounded-md" />
            <div className="flex items-center gap-1">
              <SkeletonBox className="h-8 w-8 rounded-md" />
              <SkeletonBox className="h-8 w-16 rounded-md" />
              <SkeletonBox className="h-8 w-20 rounded-md" />
              <SkeletonBox className="h-8 w-8 rounded-md" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {range(7).map((index) => <SkeletonBox key={index} className="h-8 w-full rounded-md" />)}
          {range(42).map((index) => <SkeletonBox key={`day-${index}`} className="h-24 w-full rounded-lg sm:h-28" />)}
        </div>
        <div className="mt-6 grid gap-3 rounded-lg border border-border bg-secondary/30 p-4 sm:grid-cols-2">
          <SkeletonBox className="h-12 w-full rounded-md" />
          <SkeletonBox className="h-12 w-full rounded-md" />
        </div>
      </div>
    </>
  );
}

function SettingsContentSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]" data-testid="settings-page-skeleton-grid">
      <aside className="hidden lg:block">
        <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-border bg-card/70 p-3 backdrop-blur">
          <div className="grid gap-1">
            {range(10).map((index) => <SkeletonBox key={index} className="h-9 w-full rounded-lg" />)}
          </div>
        </div>
      </aside>

      <div className="grid min-w-0 gap-8">
        <div className="sticky top-[calc(8.25rem+env(safe-area-inset-top))] z-20 border-b border-border bg-background/90 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <SkeletonBox className="h-6 w-28" />
              <SkeletonBox className="h-4 w-40" />
            </div>
            <SkeletonBox className="h-9 w-9 rounded-lg" />
          </div>
        </div>

        <div className="hidden lg:block">
          <SkeletonBox className="h-8 w-32" />
          <SkeletonBox className="mt-2 h-4 w-56" />
        </div>

        {range(8).map((index) => (
          <section key={index} className="rounded-xl border border-border bg-card p-6">
            <SkeletonBox className="mb-6 h-6 w-32" />
            <div className="grid gap-4">
              <SkeletonBox className="h-10 w-full max-w-md rounded-md" />
              <SkeletonBox className="h-4 w-3/4" />
              {index % 3 === 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <SkeletonBox className="h-24 w-full rounded-lg" />
                  <SkeletonBox className="h-24 w-full rounded-lg" />
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AdminUsersTableSkeleton() {
  return (
    <div className="divide-y divide-border" data-testid="admin-users-skeleton-table">
      {range(5).map((index) => (
        <div key={index} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_140px_120px_260px] lg:items-center lg:gap-4">
          <div className="grid min-w-0 gap-1">
            <SkeletonBox className="h-5 w-36" />
            <SkeletonBox className="h-4 w-48 max-w-full" />
          </div>
          <SkeletonBox className="h-9 w-24 rounded-md" />
          <SkeletonBox className="h-6 w-20 rounded-full" />
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <SkeletonBox className="h-9 w-24 rounded-md" />
            <SkeletonBox className="h-9 w-20 rounded-md" />
            <SkeletonBox className="h-9 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminUsersContentSkeleton() {
  return (
    <>
      <PageTitleSkeleton withActions subtitleWidth="w-64" />
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="hidden grid-cols-[minmax(0,1fr)_140px_120px_260px] gap-4 border-b border-border px-5 py-3 lg:grid">
          <SkeletonBox className="h-4 w-20" />
          <SkeletonBox className="h-4 w-16" />
          <SkeletonBox className="h-4 w-16" />
          <SkeletonBox className="h-4 w-20" />
        </div>
        <AdminUsersTableSkeleton />
      </section>
    </>
  );
}

export function AdminUsersRowsSkeleton() {
  return (
    <div aria-hidden="true">
      <AdminUsersTableSkeleton />
    </div>
  );
}

function LightweightRouteContentSkeleton() {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <SkeletonBox className="h-12 w-12 rounded-xl" />
          <div className="grid gap-2">
            <SkeletonBox className="h-6 w-32" />
            <SkeletonBox className="h-3 w-40" />
          </div>
        </div>
        <div className="grid gap-4">
          <SkeletonBox className="h-10 w-full rounded-md" />
          <SkeletonBox className="h-10 w-full rounded-md" />
          <SkeletonBox className="h-10 w-full rounded-md" />
          <SkeletonBox className="h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

function DocumentRouteContentSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <SkeletonBox className="mb-4 h-9 w-48" />
      <SkeletonBox className="mb-8 h-4 w-64" />
      <div className="grid gap-4">
        {range(8).map((index) => <SkeletonBox key={index} className="h-4 w-full" />)}
      </div>
    </div>
  );
}

export function DashboardPageSkeleton({ withPageShell = true }: PageSkeletonProps) {
  const content = <DashboardContentSkeleton />;
  return withPageShell ? (
    <PageShellSkeleton showAddAction testId="dashboard-page-skeleton">{content}</PageShellSkeleton>
  ) : (
    <div aria-hidden="true" data-testid="dashboard-skeleton">{content}</div>
  );
}

export function SubscriptionsPageSkeleton({ withPageShell = true }: PageSkeletonProps) {
  const content = <SubscriptionsContentSkeleton />;
  return withPageShell ? (
    <PageShellSkeleton showAddAction testId="subscriptions-page-skeleton">{content}</PageShellSkeleton>
  ) : (
    <div aria-hidden="true" data-testid="subscriptions-skeleton">{content}</div>
  );
}

export function StatisticsPageSkeleton({ withPageShell = true }: PageSkeletonProps) {
  const content = <StatisticsContentSkeleton />;
  return withPageShell ? (
    <PageShellSkeleton showAddAction testId="statistics-page-skeleton">{content}</PageShellSkeleton>
  ) : (
    <div aria-hidden="true" data-testid="statistics-skeleton">{content}</div>
  );
}

export function CalendarPageSkeleton({ withPageShell = true }: PageSkeletonProps) {
  const content = <CalendarContentSkeleton />;
  return withPageShell ? (
    <PageShellSkeleton showAddAction testId="calendar-page-skeleton">{content}</PageShellSkeleton>
  ) : (
    <div aria-hidden="true" data-testid="calendar-skeleton">{content}</div>
  );
}

export function SettingsPageSkeleton({ withPageShell = true }: PageSkeletonProps) {
  const content = <SettingsContentSkeleton />;
  return withPageShell ? (
    <PageShellSkeleton testId="settings-page-skeleton">{content}</PageShellSkeleton>
  ) : (
    <div aria-hidden="true" data-testid="settings-skeleton">{content}</div>
  );
}

export function AdminUsersPageSkeleton({ withPageShell = true }: PageSkeletonProps) {
  const content = <AdminUsersContentSkeleton />;
  return withPageShell ? (
    <PageShellSkeleton testId="admin-users-page-skeleton">{content}</PageShellSkeleton>
  ) : (
    <div aria-hidden="true" data-testid="admin-users-skeleton">{content}</div>
  );
}

export function LightweightRouteSkeleton() {
  return (
    <div className="app-page bg-background" aria-busy="true" data-testid="lightweight-route-skeleton">
      <div aria-hidden="true">
        <LightweightRouteContentSkeleton />
      </div>
    </div>
  );
}

export function DocumentRouteSkeleton() {
  return (
    <div className="app-page bg-background" aria-busy="true" data-testid="document-route-skeleton">
      <div aria-hidden="true">
        <DocumentRouteContentSkeleton />
      </div>
    </div>
  );
}

export const DashboardSkeleton = DashboardPageSkeleton;
export const SubscriptionListSkeleton = SubscriptionsPageSkeleton;
export const StatisticsSkeleton = StatisticsPageSkeleton;
export const CalendarSkeleton = CalendarPageSkeleton;
