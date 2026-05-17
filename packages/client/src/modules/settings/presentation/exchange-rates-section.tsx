/**
 * 汇率设置展示区。
 *
 * 架构位置：展示 provider、刷新状态和币种启用列表；远端拉取、缓存和 fallback 位于 useExchangeRates。
 *
 * 注意： 默认货币和启用货币会影响全站金额换算，展示层不能绕过 controller 直接修改配置。
 */
import { ExternalLink, RefreshCw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { SearchableSelectOption } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/i18n/I18nProvider';
import type { ExchangeRateProvider, ExchangeRates } from '@/lib/api/schemas/exchange-rates';
import { cn } from '@/lib/utils';
import type { CustomConfig } from '@/types/config';
import type { AppSettings } from '@/types/subscription';

export interface ExchangeRatesSectionProps {
  settings: Pick<AppSettings, 'defaultCurrency' | 'exchangeRateProvider'>;
  customConfig: Pick<CustomConfig, 'currencies'>;
  rates: ExchangeRates;
  activeRateProvider: ExchangeRateProvider | "builtin";
  ratesLoading: boolean;
  ratesError: string | null;
  lastUpdated: Date | null;
  defaultCurrencyOptions: SearchableSelectOption[];
  handleRefreshRates: () => void | Promise<void>;
  handleDefaultCurrencyChange: (value: string) => void;
  handleExchangeRateProviderChange: (value: ExchangeRateProvider) => void | Promise<void>;
  getCurrencySymbol: (currency: string) => string;
}

export function ExchangeRatesSection({
  settings,
  customConfig,
  rates,
  activeRateProvider,
  ratesLoading,
  ratesError,
  lastUpdated,
  defaultCurrencyOptions,
  handleRefreshRates,
  handleDefaultCurrencyChange,
  handleExchangeRateProviderChange,
  getCurrencySymbol,
}: ExchangeRatesSectionProps) {
  const { t, formatDateTime } = useI18n();
  const providerLabel = activeRateProvider === "builtin"
    ? t("settings.exchangeRateProvider.builtin")
    : activeRateProvider === "floatrates"
      ? t("settings.exchangeRateProvider.floatrates")
      : t("settings.exchangeRateProvider.exchangeApi");
  const providerUrl = activeRateProvider === "floatrates"
    ? "https://www.floatrates.com/json-feeds.html"
    : activeRateProvider === "exchange-api"
      ? "https://github.com/fawazahmed0/exchange-api#readme"
      : null;

  return (
            <section className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">{t("settings.exchange")}</h2>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshRates}
                    disabled={ratesLoading}
                    className="gap-2"
                  >
                    <RefreshCw className={cn("h-4 w-4", ratesLoading && "animate-spin")} />
                    {ratesLoading ? t("settings.ratesUpdating") : t("settings.refreshRates")}
                  </Button>
                </div>
    
                {ratesError && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 text-sm">
                    {t("settings.ratesError", { error: ratesError })}
                  </div>
                )}
    
                <div className="grid gap-6">
                  {/* 统计货币选择 */}
                  <div className="p-4 rounded-lg border border-border bg-secondary/50">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1">
                        <Label htmlFor="defaultCurrency" className="text-base font-medium">{t("settings.defaultCurrency")}</Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("settings.defaultCurrencyHelp")}
                        </p>
                      </div>
                      <SearchableSelect
                        value={settings.defaultCurrency}
                        onValueChange={handleDefaultCurrencyChange}
                        options={defaultCurrencyOptions}
                        placeholder={t("settings.currencyPlaceholder")}
                        searchPlaceholder={t("settings.currencySearch")}
                        emptyMessage={t("settings.currencyEmpty")}
                        className="w-full border-border bg-secondary sm:w-[200px]"
                        aria-label={t("settings.defaultCurrency")}
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border border-border bg-secondary/50">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1">
                        <Label htmlFor="exchangeRateProvider" className="text-base font-medium">{t("settings.exchangeRateProvider")}</Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("settings.exchangeRateProviderHelp")}
                        </p>
                      </div>
                      <Select
                        value={settings.exchangeRateProvider}
                        onValueChange={(value) => handleExchangeRateProviderChange(value as ExchangeRateProvider)}
                      >
                        <SelectTrigger
                          id="exchangeRateProvider"
                          className="w-full border-border bg-secondary sm:w-[200px]"
                          aria-label={t("settings.exchangeRateProvider")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exchange-api">{t("settings.exchangeRateProvider.exchangeApi")}</SelectItem>
                          <SelectItem value="floatrates">{t("settings.exchangeRateProvider.floatrates")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
    
                  {/* 汇率信息 */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-secondary/50">
                      <span className="text-muted-foreground">{t("settings.dataSource")}</span>
                      {providerUrl ? (
                        <a
                          href={providerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-primary hover:underline"
                        >
                          {providerLabel}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="font-medium text-foreground">{providerLabel}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-secondary/50">
                      <span className="text-muted-foreground">{t("settings.cachePolicy")}</span>
                      <span className="font-medium text-foreground">{t("settings.cachePolicyValue")}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-secondary/50 sm:col-span-2">
                      <span className="text-muted-foreground">{t("settings.lastUpdated")}</span>
                      <span className="font-medium text-foreground">
                        {lastUpdated
                          ? formatDateTime(lastUpdated, {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : t("settings.notFetched")}
                      </span>
                    </div>
                  </div>
    
                  {/* 汇率预览 - 相对于统计货币 */}
                  <div className="pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-foreground mb-3">
                      {t("settings.ratesPreview", { currency: settings.defaultCurrency })}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {customConfig.currencies
                        .filter(c => c.enabled !== false && c.value !== settings.defaultCurrency)
                        .slice(0, 8)
                        .map(currency => {
                          // 计算相对于统计货币的汇率
                          const baseRate = rates[settings.defaultCurrency] || 1;
                          const targetRate = rates[currency.value] || 1;
                          const relativeRate = targetRate / baseRate;
                          const isHighPrecision = ['JPY', 'KRW', 'IDR', 'HUF'].includes(currency.value);
                          
                          return (
                            <div 
                              key={currency.value}
                              className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50"
                            >
                              <span className="text-sm text-muted-foreground">
                                {getCurrencySymbol(currency.value)} {currency.value}
                              </span>
                              <span className="text-sm font-medium text-foreground">
                                {relativeRate.toFixed(isHighPrecision ? 2 : 4)}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
    
                  <p className="text-xs text-muted-foreground">
                    {t("settings.ratesInfo")}
                  </p>
                </div>
              </section>
    
  );
}
