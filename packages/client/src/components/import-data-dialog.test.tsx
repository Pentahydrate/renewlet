// 导入弹窗测试覆盖预览、apply、Logo 暂存和设置导入开关，防止批量导入状态机与 shared schema 漂移。
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import { DEFAULT_SETTINGS } from "@/types/subscription";
import { ApiError } from "@/lib/api-client";
import { ImportDataDialog } from "./import-data-dialog";

type ImportExportService = typeof import("@/services/import-export-service").importExportService;
type MediaCandidateResolve = typeof import("@/services/media-candidate-service").mediaCandidateService.resolve;
type AssetCreate = typeof import("@/services/asset-service").assetService.create;

const mocks = vi.hoisted(() => ({
  preview: vi.fn<ImportExportService["preview"]>(),
  applyChunked: vi.fn<ImportExportService["applyChunked"]>(),
  resolveMediaCandidates: vi.fn<MediaCandidateResolve>(),
  createAsset: vi.fn<AssetCreate>(),
}));

vi.mock("@/services/import-export-service", () => ({
  importExportService: {
    preview: mocks.preview,
    applyChunked: mocks.applyChunked,
  },
}));

vi.mock("@/services/media-candidate-service", () => ({
  mediaCandidateService: {
    resolve: mocks.resolveMediaCandidates,
  },
}));

vi.mock("@/services/asset-service", () => ({
  assetService: {
    create: mocks.createAsset,
  },
}));

vi.mock("@/components/import-logo-editor", () => ({
  ImportLogoEditor: ({ name, onChange }: { name: string; onChange: (value: string | null, asset?: { blob: Blob; filename: string; previewUrl: string }) => void }) => (
    <button type="button" onClick={() => onChange(null, { blob: new Blob(["logo"], { type: "image/png" }), filename: `${name}.png`, previewUrl: "blob:test-logo" })}>
      编辑 {name}
    </button>
  ),
}));

type VirtualItemFixture = {
  index: number;
  key: string | number | bigint;
  start: number;
  size: number;
  end: number;
  lane: number;
};

vi.mock("@/components/ui/virtualized-list", () => ({
  VirtualizedList: ({
    count,
    renderItem,
  }: {
    count: number;
    renderItem: (index: number, virtualItem: VirtualItemFixture) => ReactNode;
  }) => (
    <div>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          {renderItem(index, {
            index,
            key: index,
            start: index * 120,
            size: 120,
            end: (index + 1) * 120,
            lane: 0,
          })}
        </div>
      ))}
    </div>
  ),
}));

const githubCopilotCandidate = {
  id: "builtin:thesvg:github-copilot:default",
  kind: "logo" as const,
  source: "builtIn" as const,
  provider: "thesvg",
  label: "GitHub Copilot",
  variant: "default",
  url: "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/github-copilot/default.svg",
  confidence: "strong" as const,
  autoAssignable: true,
  matchedQuery: "github copilot",
  rank: 0,
};

const faviconCandidate = {
  ...githubCopilotCandidate,
  id: "favicon:site:github.com:0",
  source: "favicon" as const,
  provider: "site",
  variant: null,
  url: "https://github.com/favicon.ico",
  confidence: "weak" as const,
  autoAssignable: true,
};

function renderImportDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ImportDataDialog
        open
        onOpenChange={vi.fn()}
        settings={DEFAULT_SETTINGS}
        config={DEFAULT_CUSTOM_CONFIG}
      />
    </QueryClientProvider>,
  );
}

describe("ImportDataDialog", () => {
  beforeEach(() => {
    mocks.preview.mockReset();
    mocks.applyChunked.mockReset();
    mocks.resolveMediaCandidates.mockReset();
    mocks.createAsset.mockReset();
    mocks.resolveMediaCandidates.mockResolvedValue({
      items: [{
        id: "0",
        autoCandidate: githubCopilotCandidate,
        candidates: {
          best: githubCopilotCandidate,
          builtIn: [githubCopilotCandidate],
          favicon: [],
        },
      }],
    });
    mocks.preview.mockImplementation(async (payload) => ({
      summary: {
        total: payload.subscriptions.length,
        creates: payload.subscriptions.length,
        replaces: 0,
        skips: 0,
        errors: 0,
        warnings: 0,
      },
      items: payload.subscriptions.map((subscription, index) => ({
        index,
        name: subscription.name,
        source: payload.source,
        sourceId: String(subscription.extra.import.sourceId),
        action: "create" as const,
        warnings: [],
        errors: [],
      })),
      includesSettings: Boolean(payload.settings),
      includesCustomConfig: Boolean(payload.customConfig),
    }));
    mocks.createAsset.mockResolvedValue({ url: "/api/app/assets/import_logo" });
    mocks.applyChunked.mockImplementation(async (payload) => ({
      ok: true,
      summary: {
        total: payload.subscriptions.length,
        creates: payload.subscriptions.length,
        replaces: 0,
        skips: 0,
        errors: 0,
        warnings: 0,
      },
      items: payload.subscriptions.map((subscription, index) => ({
        index,
        name: subscription.name,
        source: payload.source,
        sourceId: subscription.extra.import.sourceId,
        action: "create" as const,
        warnings: [],
        errors: [],
      })),
      includesSettings: Boolean(payload.settings),
      includesCustomConfig: Boolean(payload.customConfig),
    }));
  });

  it("writes high-confidence built-in Logo matches before import preview", async () => {
    const user = userEvent.setup();
    renderImportDialog();

    await user.click(screen.getByRole("tab", { name: "粘贴 JSON" }));
    fireEvent.change(screen.getByPlaceholderText("粘贴 Renewlet 或 Wallos JSON..."), {
      target: {
        value: JSON.stringify([{
          Name: "GitHub Copilot Pro",
          "Payment Cycle": "Monthly",
          "Next Payment": "2026-06-01",
          Price: "$10",
          Category: "Software",
          "Payment Method": "Visa",
        }]),
      },
    });
    await user.click(screen.getByRole("button", { name: "生成预览" }));

    await waitFor(() => {
      expect(mocks.resolveMediaCandidates).toHaveBeenCalledWith({
        kind: "logo",
        mode: "auto",
        items: [{ id: "0", name: "GitHub Copilot Pro" }],
        limit: 1,
      });
    });
    await waitFor(() => {
      expect(mocks.preview).toHaveBeenCalledTimes(1);
    });

    const previewPayload = mocks.preview.mock.calls[0]?.[0];
    expect(previewPayload?.subscriptions[0]?.logo).toBe(githubCopilotCandidate.url);
    expect(await screen.findByTestId("import-logo-auto-match-0")).toHaveTextContent("自动匹配");
  });

  it("keeps favicon fallback candidates out of import auto assignment", async () => {
    mocks.resolveMediaCandidates.mockResolvedValueOnce({
      items: [{
        id: "0",
        autoCandidate: faviconCandidate,
        candidates: {
          best: faviconCandidate,
          builtIn: [],
          favicon: [faviconCandidate],
        },
      }],
    });
    const user = userEvent.setup();
    renderImportDialog();

    await user.click(screen.getByRole("tab", { name: "粘贴 JSON" }));
    fireEvent.change(screen.getByPlaceholderText("粘贴 Renewlet 或 Wallos JSON..."), {
      target: {
        value: JSON.stringify([{
          Name: "GitHub Copilot Pro",
          "Payment Cycle": "Monthly",
          "Next Payment": "2026-06-01",
          Price: "$10",
          Category: "Software",
          "Payment Method": "Visa",
        }]),
      },
    });
    await user.click(screen.getByRole("button", { name: "生成预览" }));

    await waitFor(() => {
      expect(mocks.preview).toHaveBeenCalledTimes(1);
    });
    const previewPayload = mocks.preview.mock.calls[0]?.[0];
    expect(previewPayload?.subscriptions[0]?.logo).toBeNull();
    expect(screen.queryByTestId("import-logo-auto-match-0")).not.toBeInTheDocument();
  });

  it("shows a dedicated error when staged logo upload fails before apply", async () => {
    mocks.createAsset.mockRejectedValueOnce(new Error("R2 upload failed"));
    const user = userEvent.setup();
    renderImportDialog();

    await user.click(screen.getByRole("tab", { name: "粘贴 JSON" }));
    fireEvent.change(screen.getByPlaceholderText("粘贴 Renewlet 或 Wallos JSON..."), {
      target: {
        value: JSON.stringify([{
          Name: "Manual Logo App",
          "Payment Cycle": "Monthly",
          "Next Payment": "2026-06-01",
          Price: "$10",
          Category: "Software",
          "Payment Method": "Visa",
        }]),
      },
    });
    await user.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByRole("button", { name: "编辑 Manual Logo App" });

    await user.click(screen.getByRole("button", { name: "编辑 Manual Logo App" }));
    await user.click(screen.getByRole("button", { name: "执行导入" }));

    expect(await screen.findByText("Logo 上传失败，请移除异常 Logo 后重试。")).toBeInTheDocument();
    expect(mocks.applyChunked).not.toHaveBeenCalled();
  });

  it("keeps backend apply messages visible in the dialog error state", async () => {
    mocks.applyChunked.mockRejectedValueOnce(new ApiError("NEXT_BILLING_DATE_BEFORE_START_DATE", 400, undefined, "NEXT_BILLING_DATE_BEFORE_START_DATE"));
    const user = userEvent.setup();
    renderImportDialog();

    await user.click(screen.getByRole("tab", { name: "粘贴 JSON" }));
    fireEvent.change(screen.getByPlaceholderText("粘贴 Renewlet 或 Wallos JSON..."), {
      target: {
        value: JSON.stringify([{
          Name: "Backend Error App",
          "Payment Cycle": "Monthly",
          "Next Payment": "2026-06-01",
          Price: "$10",
          Category: "Software",
          "Payment Method": "Visa",
        }]),
      },
    });
    await user.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("Backend Error App");

    await user.click(screen.getByRole("button", { name: "执行导入" }));

    expect(await screen.findByText("到期日期不能早于开始日期")).toBeInTheDocument();
  });
});
