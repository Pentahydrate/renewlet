// 系统更新弹窗测试保护 Docker 页面内更新的 pending restart 状态流和 Cloudflare/source 禁用分支。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { systemRestartBrowser, SystemUpdateDialog, SystemVersionBadge } from "./system-update-dialog";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiFetch: mocks.apiFetch,
  };
});

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        "common.close": "关闭",
        "system.badgeUpdate": "可更新到 v{version}",
        "system.badgeVersion": "v{version}",
        "system.buildType": "构建类型",
        "system.checking": "正在检查版本...",
        "system.checkDeferredDescription": "当前显示的是本机版本；请稍后重新检查。",
        "system.checkDeferredTitle": "暂时无法检查更新",
        "system.checkFailedDescription": "请稍后重试，或打开 GitHub Release 手动查看。",
        "system.checkFailedTitle": "版本检查失败",
        "system.currentVersion": "当前版本",
        "system.latestVersion": "最新版本",
        "system.noUpdateDescription": "无需操作。",
        "system.noUpdateTitle": "已是最新版本",
        "system.openUpdateDialog": "打开系统更新",
        "system.cloudflareDeployGuide": "Cloudflare 部署说明",
        "system.recheck": "重新检查",
        "system.releaseLink": "发布页",
        "system.restartNow": "立即重启",
        "system.restartRequired": "请重启服务以应用更新",
        "system.restarting": "正在重启...",
        "system.retry": "重试",
        "system.runtime": "运行面",
        "system.runtime.docker": "Docker",
        "system.runtime.cloudflare": "Cloudflare",
        "system.runtime.source": "源码/手动部署",
        "system.unsupportedDescription": "请使用原部署方式升级。",
        "system.unsupportedTitle": "当前部署不支持一键更新",
        "system.updateAvailableDescription": "可以更新到 v{version}。",
        "system.updateAvailableTitle": "发现新版本",
        "system.updateComplete": "更新完成",
        "system.updateFailedDescription": "更新失败，请稍后重试。",
        "system.updateFailedTitle": "更新失败",
        "system.updateNow": "立即更新",
        "system.updateTitle": "系统更新",
        "system.updateUnavailableTitle": "页面内更新不可用",
        "system.updating": "更新中...",
        "system.viewChangelog": "查看更新日志",
        "system.warningTitle": "检查提示",
      };
      let value = messages[key] ?? key;
      for (const [name, param] of Object.entries(params ?? {})) {
        value = value.split(`{${name}}`).join(String(param));
      }
      return value;
    },
  }),
}));

function versionFixture(overrides: Record<string, unknown> = {}) {
  return {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    hasUpdate: true,
    checkSucceeded: true,
    deployment: "docker",
    updateMode: "in-app-binary",
    updateSupported: true,
    releaseInfo: {
      tagName: "v1.1.0",
      version: "1.1.0",
      name: "Renewlet 1.1.0",
      body: "更新日志",
      publishedAt: "2026-05-26T00:00:00Z",
      htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0",
      assets: [],
    },
    cached: false,
    build: {
      version: "1.0.0",
      commit: "abc",
      buildTime: "2026-05-26T00:00:00Z",
      buildType: "release",
    },
    ...overrides,
  };
}

function mockVersionEndpoint(overrides: Record<string, unknown> = {}) {
  mocks.apiFetch.mockImplementation((input: string) => {
    if (input.startsWith("/api/app/admin/system/version")) return Promise.resolve(versionFixture(overrides));
    return Promise.reject(new Error(`Unexpected request ${input}`));
  });
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

function SystemUpdateHarness() {
  const [open, setOpen] = useState(false);
  return <SystemUpdateDialog open={open} onOpenChange={setOpen} />;
}

describe("SystemUpdateDialog", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the version popover and refreshes with force=true", async () => {
    mockVersionEndpoint();

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    expect(await screen.findByText("可更新到 v1.1.0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开系统更新" }));
    expect(await screen.findByText("当前版本")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新检查" }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith(expect.stringContaining("force=true"), expect.anything(), expect.anything()));
  });

  it("shows up-to-date state with a check mark and disables update action", async () => {
    mockVersionEndpoint({
      latestVersion: "1.0.0",
      hasUpdate: false,
      warning: undefined,
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
    expect(screen.getAllByText("已是最新版本")).toHaveLength(1);
    expect(screen.getByText("无需操作。")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已是最新版本");
    expect(screen.queryByText("暂时无法检查更新")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即更新" })).not.toBeInTheDocument();
  });

  it("shows checking state while the popover version query is pending", async () => {
    let resolveVersion: (value: ReturnType<typeof versionFixture>) => void = () => {};
    mocks.apiFetch.mockImplementation((input: string) => {
      if (input.startsWith("/api/app/admin/system/version")) {
        return new Promise((resolve) => {
          resolveVersion = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected request ${input}`));
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(screen.getByRole("button", { name: "打开系统更新" }));

    expect(await screen.findByText("正在检查版本...")).toBeInTheDocument();

    resolveVersion(versionFixture());
  });

  it("updates release builds and then shows restart flow", async () => {
    mocks.apiFetch.mockImplementation((input: string, _schema: unknown, init?: RequestInit) => {
      if (input.startsWith("/api/app/admin/system/version")) return Promise.resolve(versionFixture());
      if (input === "/api/app/admin/system/update" && init?.method === "POST") {
        return Promise.resolve({ ok: true, currentVersion: "1.0.0", targetVersion: "1.1.0", needsRestart: true, message: "更新完成" });
      }
      return Promise.reject(new Error(`Unexpected request ${input}`));
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));
    await user.click(await screen.findByRole("button", { name: "立即更新" }));

    expect(await screen.findByText("更新完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即重启" })).toBeInTheDocument();
  });

  it("shows release asset unavailable state without update actions", async () => {
    mockVersionEndpoint({
      hasUpdate: true,
      updateSupported: false,
      unsupportedReason: "目标 Release 暂缺页面内更新所需附件：renewlet_1.1.0_linux_amd64.tar.gz。",
      releaseInfo: {
        tagName: "v1.1.0",
        version: "1.1.0",
        name: "Renewlet 1.1.0",
        body: "",
        publishedAt: "2026-05-26T00:00:00Z",
        htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0",
        assets: [],
      },
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));

    expect(await screen.findByText("页面内更新不可用")).toBeInTheDocument();
    expect(screen.getByText("目标 Release 暂缺页面内更新所需附件：renewlet_1.1.0_linux_amd64.tar.gz。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "发布页" })).toHaveAttribute("href", "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0");
    expect(screen.queryByRole("button", { name: "立即更新" })).not.toBeInTheDocument();
  });

  it("shows unsupported source builds without update actions", async () => {
    mockVersionEndpoint({
      hasUpdate: false,
      deployment: "source",
      updateMode: "source-manual",
      updateSupported: false,
      unsupportedReason: "源码构建不支持",
      releaseInfo: null,
      build: {
        version: "1.0.0",
        commit: "abc",
        buildTime: "2026-05-26T00:00:00Z",
        buildType: "source",
      },
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));

    expect(await screen.findByText("页面内更新不可用")).toBeInTheDocument();
    expect(screen.getByText("源码构建不支持")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即更新" })).not.toBeInTheDocument();
    expect(screen.queryByText("源码构建")).not.toBeInTheDocument();
  });

  it("shows Cloudflare deploy guidance without source wording or update actions", async () => {
    mockVersionEndpoint({
      hasUpdate: false,
      deployment: "cloudflare",
      updateMode: "cloudflare-deploy",
      updateSupported: false,
      unsupportedReason: "Cloudflare 需要通过部署流程升级",
      releaseInfo: {
        tagName: "v1.1.0",
        version: "1.1.0",
        name: "Renewlet 1.1.0",
        body: "",
        publishedAt: "2026-05-26T00:00:00Z",
        htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0",
        assets: [],
      },
      build: {
        version: "1.0.0",
        commit: "abc",
        buildTime: "2026-05-26T00:00:00Z",
        buildType: "cloudflare",
      },
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));

    expect(await screen.findByText("页面内更新不可用")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare 需要通过部署流程升级")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cloudflare 部署说明" })).toHaveAttribute("href", expect.stringContaining("docs/cloudflare-workers-deploy.md"));
    expect(screen.getByRole("link", { name: "发布页" })).toHaveAttribute("href", "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0");
    expect(screen.queryByText("源码构建")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即更新" })).not.toBeInTheDocument();
  });

  it("shows update error and retry button", async () => {
    mocks.apiFetch.mockImplementation((input: string, _schema: unknown, init?: RequestInit) => {
      if (input.startsWith("/api/app/admin/system/version")) return Promise.resolve(versionFixture());
      if (input === "/api/app/admin/system/update" && init?.method === "POST") {
        return Promise.reject(new Error("下载失败"));
      }
      return Promise.reject(new Error(`Unexpected request ${input}`));
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));
    await user.click(await screen.findByRole("button", { name: "立即更新" }));

    expect(await screen.findByText("更新失败")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("更新失败");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("restarts and reloads after health check recovers", async () => {
    const reload = vi.fn();
    vi.spyOn(systemRestartBrowser, "reload").mockImplementation(reload);
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue({ ok: true } as Response);
    mocks.apiFetch.mockImplementation((input: string, _schema: unknown, init?: RequestInit) => {
      if (input.startsWith("/api/app/admin/system/version")) return Promise.resolve(versionFixture());
      if (input === "/api/app/admin/system/update" && init?.method === "POST") {
        return Promise.resolve({ ok: true, currentVersion: "1.0.0", targetVersion: "1.1.0", needsRestart: true, message: "更新完成" });
      }
      if (input === "/api/app/admin/system/restart" && init?.method === "POST") return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`Unexpected request ${input}`));
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));
    await user.click(await screen.findByRole("button", { name: "立即更新" }));
    const restartButton = await screen.findByRole("button", { name: "立即重启" });

    vi.useFakeTimers();
    fireEvent.click(restartButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /正在重启/ })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/app/health", { cache: "no-cache" });
    expect(reload).toHaveBeenCalled();
  });

  it("shows a deferred check state without claiming the deployment is current", async () => {
    mockVersionEndpoint({
      latestVersion: "1.0.0",
      hasUpdate: false,
      checkSucceeded: false,
      releaseInfo: null,
      warning: "GitHub API 临时限流，请稍后重新检查。",
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));

    await screen.findByText("GitHub API 临时限流，请稍后重新检查。");
    expect(screen.getAllByText("暂时无法检查更新")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("暂时无法检查更新");
    expect(screen.getByText("GitHub API 临时限流，请稍后重新检查。")).toBeInTheDocument();
    expect(screen.queryByText("已是最新版本")).not.toBeInTheDocument();
  });

  it("shows check failed state when the version response is invalid", async () => {
    mocks.apiFetch.mockImplementation((input: string) => {
      if (input.startsWith("/api/app/admin/system/version")) return Promise.reject(new Error("invalid_response"));
      return Promise.reject(new Error(`Unexpected request ${input}`));
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateHarness />);

    await user.click(await screen.findByRole("button", { name: "打开系统更新" }));

    expect(await screen.findByText("版本检查失败")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("版本检查失败");
  });
});

describe("SystemVersionBadge", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it("shows available update version", async () => {
    mocks.apiFetch.mockResolvedValueOnce(versionFixture());

    renderWithQuery(<SystemVersionBadge />);

    expect(await screen.findByText("可更新到 v1.1.0")).toBeInTheDocument();
  });
});
