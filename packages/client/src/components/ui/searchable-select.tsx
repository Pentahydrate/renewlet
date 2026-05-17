/**
 * 可搜索选择器。
 *
 * 架构位置：组合 Popover + cmdk + Tooltip，服务自定义配置、货币、分类等长选项列表。
 *
 * 注意： 选项 label 可能来自用户自定义配置；渲染层只展示文本，不在这里修复配置结构。
 */
import * as React from "react";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TruncatedTooltipText } from "@/components/ui/truncated-tooltip-text";
import { cn } from "@/lib/utils";
import { rankSearchText, type SearchableSelectOption } from "@/lib/searchable-options";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";

export type { SearchableSelectOption };

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  renderOption?: (option: SearchableSelectOption, state: { selected: boolean }) => React.ReactNode;
  renderValue?: (option: SearchableSelectOption | undefined) => React.ReactNode;
  /** Maximum options rendered before the user starts searching. */
  initialRenderLimit?: number;
  "aria-label"?: string;
}

const DEFAULT_INITIAL_RENDER_LIMIT = 100;

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  className,
  contentClassName,
  renderOption,
  renderValue,
  initialRenderLimit = DEFAULT_INITIAL_RENDER_LIMIT,
  "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const locale = getApiLocale();
  const resolvedPlaceholder = placeholder ?? translate(locale, "common.selectPlaceholder");
  const resolvedSearchPlaceholder = searchPlaceholder ?? translate(locale, "common.searchPlaceholder");
  const resolvedEmptyMessage = emptyMessage ?? translate(locale, "common.noMatches");
  const visibleOptions = React.useMemo(() => {
    const trimmedSearch = search.trim();
    if (trimmedSearch || initialRenderLimit <= 0 || options.length <= initialRenderLimit) {
      return options;
    }

    const limited = options.slice(0, initialRenderLimit);
    if (selectedOption && !limited.some((option) => option.value === selectedOption.value)) {
      // 初始只渲染前 N 项以降低大列表开销，但当前值必须保留，否则触发器和列表选中态会脱节。
      return [selectedOption, ...limited];
    }
    return limited;
  }, [initialRenderLimit, options, search, selectedOption]);

  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filter = React.useCallback((itemValue: string, searchValue: string, keywords?: string[]) => {
    const rank = rankSearchText([itemValue, ...(keywords ?? [])], searchValue);
    return rank;
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm font-normal ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            !selectedOption && "text-muted-foreground",
            className,
          )}
        >
          {renderValue ? (
            <span className="min-w-0 flex-1 truncate text-left">{renderValue(selectedOption)}</span>
          ) : (
            <TruncatedTooltipText
              text={selectedOption?.label ?? resolvedPlaceholder}
              className="min-w-0 flex-1 text-left"
            />
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-[14rem] overflow-hidden border-border bg-popover p-0 text-popover-foreground",
          contentClassName,
        )}
      >
        <Command
          loop
          filter={filter}
          className="flex max-h-[22rem] w-full flex-col bg-popover text-popover-foreground"
        >
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder={resolvedSearchPlaceholder}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              {resolvedEmptyMessage}
            </Command.Empty>
            {visibleOptions.map((option) => {
              const selected = option.value === value;
              return (
                <Command.Item
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  {...(option.disabled === undefined ? {} : { disabled: option.disabled })}
                  onSelect={() => {
                    if (option.disabled) return;
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none transition-colors",
                    "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                    "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
                  )}
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {selected && <Check className="h-4 w-4" />}
                  </span>
                  {renderOption ? (
                    <span className="min-w-0 flex-1 truncate">{renderOption(option, { selected })}</span>
                  ) : (
                    <TruncatedTooltipText text={option.label} className="min-w-0 flex-1" />
                  )}
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
