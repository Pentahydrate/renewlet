import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Drawer } from "vaul";
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/I18nProvider';

// H5 锚点定位需要同时避开全局顶部区和设置页局部 sticky 标题；scrollIntoView 会读取目标元素的 scroll-margin。
export const SETTINGS_SECTION_SCROLL_CLASS = "scroll-mt-[calc(13rem+env(safe-area-inset-top))] lg:scroll-mt-24";
const SETTINGS_SECTION_OBSERVER_ROOT_MARGIN = "-20% 0px -65% 0px";
const PROGRAMMATIC_SCROLL_IDLE_MS = 160;
const DESKTOP_ANCHOR_OFFSET_PX = 96;
const MOBILE_ANCHOR_OFFSET_PX = 208;
const BOTTOM_EDGE_TOLERANCE_PX = 4;

const SETTINGS_SECTIONS = [
  { id: "settings-account", labelKey: "settings.sectionNav.account" },
  { id: "settings-appearance", labelKey: "settings.sectionNav.appearance" },
  { id: "settings-display", labelKey: "settings.sectionNav.display" },
  { id: "settings-icon-sources", labelKey: "settings.sectionNav.iconSources" },
  { id: "settings-budget", labelKey: "settings.sectionNav.budget" },
  { id: "settings-data-config", labelKey: "settings.sectionNav.dataConfig" },
  { id: "settings-exchange", labelKey: "settings.sectionNav.exchange" },
  { id: "settings-calendar-feed", labelKey: "settings.sectionNav.calendarFeed" },
  { id: "settings-timezone", labelKey: "settings.sectionNav.timezone" },
  { id: "settings-notifications", labelKey: "settings.sectionNav.notifications" },
] as const;

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]["id"];
type ProgrammaticNavigation = {
  targetId: SettingsSectionId;
  idleTimer: number | null;
};
type SettingsSectionNavigationProps = {
  activeSectionId: SettingsSectionId;
  onSectionClick: (id: SettingsSectionId) => void;
};

function getSectionFromHash(hash: string): SettingsSectionId | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return SETTINGS_SECTIONS.some((section) => section.id === id) ? (id as SettingsSectionId) : null;
}

function scrollToSettingsSection(id: SettingsSectionId) {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ block: "start", behavior: "smooth" });
}

function getAppScrollRoot() {
  return typeof document === "undefined" ? null : document.getElementById("root");
}

function getAnchorOffsetPx() {
  if (typeof window === "undefined") return DESKTOP_ANCHOR_OFFSET_PX;
  return window.matchMedia("(min-width: 1024px)").matches ? DESKTOP_ANCHOR_OFFSET_PX : MOBILE_ANCHOR_OFFSET_PX;
}

function isRootScrolledToBottom(root: HTMLElement) {
  return root.scrollHeight - root.scrollTop - root.clientHeight <= BOTTOM_EDGE_TOLERANCE_PX;
}

function resolveActiveSectionFromAnchor(root: HTMLElement): SettingsSectionId {
  const lastSection = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1];
  if (isRootScrolledToBottom(root)) return lastSection?.id ?? SETTINGS_SECTIONS[0].id;

  const anchorLine = root.getBoundingClientRect().top + getAnchorOffsetPx();
  let activeSectionId: SettingsSectionId = SETTINGS_SECTIONS[0].id;

  for (const section of SETTINGS_SECTIONS) {
    const element = document.getElementById(section.id);
    if (!element) continue;
    if (element.getBoundingClientRect().top <= anchorLine) {
      activeSectionId = section.id;
      continue;
    }
    break;
  }

  return activeSectionId;
}

function getNextSectionId(id: SettingsSectionId) {
  const currentIndex = SETTINGS_SECTIONS.findIndex((section) => section.id === id);
  const nextSection = SETTINGS_SECTIONS[currentIndex + 1];
  return nextSection?.id ?? null;
}

function isAnchorStillWithinSection(root: HTMLElement, id: SettingsSectionId) {
  if (resolveActiveSectionFromAnchor(root) !== id) return false;
  const nextSectionId = getNextSectionId(id);
  if (!nextSectionId) return true;
  const nextSection = document.getElementById(nextSectionId);
  if (!nextSection) return true;
  return nextSection.getBoundingClientRect().top > root.getBoundingClientRect().top + getAnchorOffsetPx();
}

export function useSettingsSectionNavigation() {
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(SETTINGS_SECTIONS[0].id);
  const programmaticNavigationRef = useRef<ProgrammaticNavigation | null>(null);

  const applyAnchorActiveSection = useCallback(() => {
    const root = getAppScrollRoot();
    if (root) setActiveSectionId(resolveActiveSectionFromAnchor(root));
  }, []);

  const endProgrammaticNavigation = useCallback((options: { applyAnchorSection?: boolean } = {}) => {
    const navigation = programmaticNavigationRef.current;
    if (navigation && navigation.idleTimer !== null) {
      window.clearTimeout(navigation.idleTimer);
    }
    programmaticNavigationRef.current = null;
    if (options.applyAnchorSection) applyAnchorActiveSection();
  }, [applyAnchorActiveSection]);

  const beginProgrammaticNavigation = useCallback((id: SettingsSectionId) => {
    endProgrammaticNavigation();
    programmaticNavigationRef.current = { targetId: id, idleTimer: null };
    setActiveSectionId(id);
    scrollToSettingsSection(id);
  }, [endProgrammaticNavigation]);

  useEffect(() => {
    const syncActiveSectionFromHash = () => {
      const sectionId = getSectionFromHash(window.location.hash);
      if (!sectionId) return;
      window.requestAnimationFrame(() => beginProgrammaticNavigation(sectionId));
    };

    syncActiveSectionFromHash();
    window.addEventListener("hashchange", syncActiveSectionFromHash);
    return () => window.removeEventListener("hashchange", syncActiveSectionFromHash);
  }, [beginProgrammaticNavigation]);

  useEffect(() => {
    const root = getAppScrollRoot();
    if (!root || typeof IntersectionObserver === "undefined") return;

    // 设置页滚动面是 #root，scrollspy 必须绑定应用滚动容器，不能退回 window/document viewport。
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => getSectionFromHash(entry.target.id))) return;

      if (programmaticNavigationRef.current) {
        // 点击目录期间 active 表达用户导航意图，释放时也不能被相邻短分区的可见性覆盖。
        return;
      }
      setActiveSectionId(resolveActiveSectionFromAnchor(root));
    }, {
      root,
      rootMargin: SETTINGS_SECTION_OBSERVER_ROOT_MARGIN,
      threshold: 0,
    });

    for (const section of SETTINGS_SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [endProgrammaticNavigation]);

  useEffect(() => {
    const root = getAppScrollRoot();
    if (!root) return;

    const cancelForUserScroll = () => {
      if (!programmaticNavigationRef.current) return;
      endProgrammaticNavigation({ applyAnchorSection: true });
    };
    const handleScrollEnd = () => {
      const navigation = programmaticNavigationRef.current;
      if (!navigation) return;
      endProgrammaticNavigation({
        applyAnchorSection: !isAnchorStillWithinSection(root, navigation.targetId),
      });
    };
    const handleScroll = () => {
      const navigation = programmaticNavigationRef.current;
      if (!navigation) return;
      if (navigation.idleTimer !== null) window.clearTimeout(navigation.idleTimer);
      navigation.idleTimer = window.setTimeout(
        () => {
          const currentNavigation = programmaticNavigationRef.current;
          endProgrammaticNavigation({
            applyAnchorSection: currentNavigation ? !isAnchorStillWithinSection(root, currentNavigation.targetId) : false,
          });
        },
        PROGRAMMATIC_SCROLL_IDLE_MS,
      );
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowDown"
        || event.key === "ArrowUp"
        || event.key === "PageDown"
        || event.key === "PageUp"
        || event.key === "Home"
        || event.key === "End"
        || event.key === " "
      ) {
        cancelForUserScroll();
      }
    };

    root.addEventListener("wheel", cancelForUserScroll, { passive: true, capture: true });
    root.addEventListener("touchstart", cancelForUserScroll, { passive: true, capture: true });
    root.addEventListener("pointerdown", cancelForUserScroll, { passive: true, capture: true });
    root.addEventListener("scroll", handleScroll, { passive: true });
    root.addEventListener("scrollend", handleScrollEnd);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      root.removeEventListener("wheel", cancelForUserScroll, { capture: true });
      root.removeEventListener("touchstart", cancelForUserScroll, { capture: true });
      root.removeEventListener("pointerdown", cancelForUserScroll, { capture: true });
      root.removeEventListener("scroll", handleScroll);
      root.removeEventListener("scrollend", handleScrollEnd);
      window.removeEventListener("keydown", handleKeyDown, true);
      endProgrammaticNavigation();
    };
  }, [endProgrammaticNavigation]);

  const handleSectionClick = useCallback((id: SettingsSectionId) => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
    beginProgrammaticNavigation(id);
  }, [beginProgrammaticNavigation]);

  return { activeSectionId, handleSectionClick };
}

function SettingsSectionNavLink({
  section,
  active,
  onSectionClick,
  variant,
}: {
  section: typeof SETTINGS_SECTIONS[number];
  active: boolean;
  onSectionClick: (id: SettingsSectionId) => void;
  variant: "desktop" | "mobileDrawer";
}) {
  const { t } = useI18n();
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onSectionClick(section.id);
  };

  return (
    <a
      href={`#${section.id}`}
      aria-current={active ? "location" : undefined}
      onClick={handleClick}
      className={cn(
        "group relative transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        variant === "desktop"
          ? "block rounded-lg px-3 py-2 text-sm font-medium"
          : "block rounded-lg px-3 py-2 text-sm font-medium",
        active && variant === "desktop" && "bg-primary/10 text-primary",
        !active && variant === "desktop" && "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
        active && variant === "mobileDrawer" && "bg-primary/10 text-primary",
        !active && variant === "mobileDrawer" && "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
      )}
    >
      {variant === "desktop" && active ? (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      ) : null}
      {variant === "mobileDrawer" && active ? (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      ) : null}
      <span className="min-w-0 truncate">{t(section.labelKey)}</span>
    </a>
  );
}

export function DesktopSettingsSectionNav({
  activeSectionId,
  onSectionClick,
}: SettingsSectionNavigationProps) {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("settings.sectionNavLabel")}
      className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-border bg-card/70 p-3 shadow-card backdrop-blur"
      data-testid="settings-section-nav-desktop"
    >
      <div className="grid gap-3">
        <p className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("settings.sectionNavTitle")}
        </p>
        <div className="grid gap-1">
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsSectionNavLink
              key={section.id}
              section={section}
              active={activeSectionId === section.id}
              onSectionClick={onSectionClick}
              variant="desktop"
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

export function MobileSettingsSectionDrawer({
  activeSectionId,
  onSectionClick,
  open,
  onOpenChange,
}: SettingsSectionNavigationProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const handleSectionClick = (id: SettingsSectionId) => {
    onSectionClick(id);
    onOpenChange(false);
  };

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false} direction="left">
      {open ? (
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Drawer.Content
            className="fixed left-0 top-[var(--app-visual-viewport-offset-top)] z-[80] flex h-[var(--app-viewport-height)] max-h-[var(--app-viewport-height)] w-[min(18rem,calc(100vw-3.5rem))] flex-col overflow-hidden rounded-r-xl border-r border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-4"
            data-testid="settings-section-nav-drawer"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))]">
              <div className="min-w-0">
                <Drawer.Title className="text-base font-semibold text-foreground">
                  {t("settings.sectionNavTitle")}
                </Drawer.Title>
                <Drawer.Description className="sr-only">
                  {t("settings.sectionNavLabel")}
                </Drawer.Description>
              </div>
              <Drawer.Close asChild>
                <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-9 w-9 text-muted-foreground">
                  <X className="h-4 w-4" />
                  <span className="sr-only">{t("common.close")}</span>
                </Button>
              </Drawer.Close>
            </div>

            <nav aria-label={t("settings.sectionNavLabel")} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <ul className="grid gap-1">
                {SETTINGS_SECTIONS.map((section) => (
                  <li key={section.id}>
                    <SettingsSectionNavLink
                      section={section}
                      active={activeSectionId === section.id}
                      onSectionClick={handleSectionClick}
                      variant="mobileDrawer"
                    />
                  </li>
                ))}
              </ul>
            </nav>
          </Drawer.Content>
        </Drawer.Portal>
      ) : null}
    </Drawer.Root>
  );
}

export function MobileSettingsPageHeader({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();

  return (
    <>
      <div
        className="sticky top-[calc(8.25rem+env(safe-area-inset-top))] z-30 -mx-4 border-b border-border/70 bg-background/90 px-4 py-3 backdrop-blur-xl lg:hidden"
        data-testid="settings-mobile-page-header"
      >
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-2xl font-bold text-foreground">{t("settings.title")}</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg border border-border bg-card/80 text-muted-foreground hover:border-primary/40 hover:bg-secondary/80 hover:text-foreground"
            aria-label={t("settings.sectionNavOpen")}
            onClick={onOpen}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground lg:hidden" data-testid="settings-mobile-page-subtitle">
        {t("settings.subtitle")}
      </p>
    </>
  );
}

export function useUnsavedChangesGuard(enabled: boolean, message: string, onConfirmLeave: () => void) {
  useEffect(() => {
    if (!enabled) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;
      const currentUrl = new URL(window.location.href);
      if (
        nextUrl.pathname === currentUrl.pathname
        && nextUrl.search === currentUrl.search
        && nextUrl.hash === currentUrl.hash
      ) {
        return;
      }
      // 设置目录只改 hash，属于页内定位；不应触发“离开设置页”的未保存确认。
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) {
        return;
      }

      if (window.confirm(message)) {
        onConfirmLeave();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled, message, onConfirmLeave]);
}
