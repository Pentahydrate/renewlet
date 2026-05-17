/**
 * 页面级骨架屏集合。
 *
 * 架构位置：
 * - Dashboard/Subscriptions/Statistics/Calendar 页面加载远端数据时复用这些占位结构。
 * - 骨架屏只表达布局密度，不承载业务状态。
 */
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 生成 0..(length-1) 的索引数组（避免 `Array(length)` 引入松散推断）。
 */
function range(length: number): number[] {
  return Array.from({ length }, (_: unknown, index: number) => index);
}

/**
 * 仪表盘首页骨架屏（/）。
 *
 * 与 `renewlet/` 参考项目保持一致：
 * - 顶部 4 个统计卡片
 * - 主区域订阅列表（6 个卡片占位）
 * - 右侧图表 + 即将续费列表占位
 */
export const DashboardSkeleton = () => {
  return (
    <div className="grid gap-8 animate-in fade-in duration-500">
      {/* 统计网格骨架屏 */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {range(4).map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between">
              <div className="grid gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-12 w-12 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* 主内容网格骨架屏 */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* 订阅列表骨架屏 */}
        <div className="lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {range(6).map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-12 w-12 rounded-lg shrink-0" />
                  <div className="flex-1 grid gap-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 侧边栏骨架屏 */}
        <div className="grid gap-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <Skeleton className="h-6 w-24 mb-4" />
            <Skeleton className="h-[200px] w-full rounded-lg" />
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <Skeleton className="h-6 w-24 mb-4" />
            <div className="grid gap-3">
              {range(4).map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 grid gap-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 订阅列表页骨架屏（/subscriptions）。
 *
 * - 筛选条（搜索 + 两个下拉）占位
 * - 网格卡片（9 个）占位
 */
export const SubscriptionListSkeleton = () => {
  return (
    <div className="grid gap-6 animate-in fade-in duration-500">
      {/* 筛选器骨架屏 */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Skeleton className="h-10 flex-1 min-w-[200px]" />
          <Skeleton className="h-10 w-[140px]" />
          <Skeleton className="h-10 w-[140px]" />
        </div>
      </div>

      {/* 网格骨架屏 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {range(9).map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-4">
              <Skeleton className="h-12 w-12 rounded-lg shrink-0" />
              <div className="flex-1 grid gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * 统计分析页骨架屏（/statistics）。
 *
 * - 顶部统计卡片（11 个）占位
 * - 2 个饼图 + 1 个预算图占位
 */
export const StatisticsSkeleton = () => {
  return (
    <div className="grid gap-8 animate-in fade-in duration-500">
      {/* 统计网格 */}
      <section>
        <Skeleton className="h-6 w-24 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {range(11).map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-5 flex flex-col items-center"
            >
              <Skeleton className="h-8 w-20 mb-2" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </section>

      {/* 图表 */}
      <section>
        <Skeleton className="h-6 w-24 mb-4" />
        <div className="grid md:grid-cols-2 gap-6">
          {range(2).map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-6">
              <Skeleton className="h-5 w-24 mx-auto mb-3" />
              <Skeleton className="h-[220px] w-full rounded-lg" />
            </div>
          ))}
          <div className="rounded-xl border border-border bg-card p-6 md:col-span-2">
            <Skeleton className="h-5 w-32 mx-auto mb-3" />
            <Skeleton className="h-[220px] w-full rounded-lg" />
          </div>
        </div>
      </section>
    </div>
  );
};

/**
 * 日历页骨架屏（/calendar）。
 *
 * - 日历头部（上月/标题/下月 + 右侧按钮）占位
 * - 7 列 * 5 行日期网格占位
 */
export const CalendarSkeleton = () => {
  return (
    <div className="grid gap-6 animate-in fade-in duration-500">
      {/* 日历顶部栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>

      {/* 日历网格 */}
      <div className="rounded-xl border border-border bg-card p-4">
        {/* 星期标题 */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {range(7).map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        {/* 日历日期 */}
        <div className="grid grid-cols-7 gap-2">
          {range(35).map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
};
