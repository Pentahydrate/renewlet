import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LocalizedLabels } from "@/i18n/locales";
import { DEFAULT_SETTINGS, type AppSettings, type NotificationChannel } from "@/types/subscription";
import { NotificationChannelConfigPanel } from "./notification-channel-config-panel";
import { NotificationChannelList } from "./notification-channel-list";

const messages: Record<string, string> = {
  "common.configure": "配置",
  "common.disable": "停用",
  "common.disabled": "未启用",
  "common.enable": "启用",
  "common.enabled": "已启用",
  "settings.channel.discordReady": "Webhook URL 已填写",
  "settings.channel.discordTodo": "填写 Discord Webhook URL",
  "settings.channel.pushplusReady": "Token 已填写",
  "settings.channel.pushplusTodo": "填写 PushPlus Token",
  "settings.channelConfig": "配置 {channel}",
  "settings.channelEnabledHelp": "该渠道已启用。",
  "settings.discordBotAvatarUrl": "机器人头像 URL（可选）",
  "settings.discordBotUsername": "机器人用户名（可选）",
  "settings.discordWebhookHelp": "只支持 Discord 官方 Webhook URL，发送时会禁止提及。",
  "settings.discordWebhookUrl": "Webhook URL",
  "settings.help.discord": "Discord 官方 Webhook 文档",
  "settings.help.pushplus": "PushPlus 消息接口文档",
  "settings.notificationChannels": "通知渠道",
  "settings.pushplusHelp": "从 PushPlus 获取的消息令牌或用户令牌。",
  "settings.pushplusToken": "PushPlus Token",
  "settings.testChannel.discord": "测试 {channel} 通知",
  "settings.testChannel.pushplus": "测试 {channel} 通知",
  "settings.testing": "测试中",
};

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const template = messages[key] ?? key;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
    },
    label: (labels: LocalizedLabels) => labels["zh-CN"] ?? labels["en-US"],
    formatDateTime: (value: string) => value,
  }),
}));

function StatefulPanel({
  channel,
  initialSettings,
  disabled = false,
  onTest = vi.fn(),
}: {
  channel: NotificationChannel;
  initialSettings?: Partial<AppSettings>;
  disabled?: boolean;
  onTest?: (channel: NotificationChannel) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>({
    ...DEFAULT_SETTINGS,
    enabledChannels: [channel],
    ...initialSettings,
  });

  return (
    <NotificationChannelConfigPanel
      channel={channel}
      settings={settings}
      enabled
      updateSetting={(key, value) => setSettings((previous) => ({ ...previous, [key]: value }))}
      testingChannel={null}
      onTest={onTest}
      disabled={disabled}
    />
  );
}

describe("Discord and PushPlus notification settings", () => {
  it("renders and updates Discord fields with the existing compact panel style", async () => {
    const user = userEvent.setup();
    const onTest = vi.fn();
    render(<StatefulPanel channel="discord" onTest={onTest} />);

    const panel = screen.getByRole("heading", { name: "配置 Discord" }).closest("div.rounded-lg");
    expect(panel).not.toBeNull();
    expect(panel as HTMLElement).toHaveClass("border");
    expect(panel as HTMLElement).toHaveClass("bg-secondary/30");
    expect(screen.getByRole("link", { name: "Discord 官方 Webhook 文档" })).toHaveAttribute(
      "href",
      "https://docs.discord.com/developers/resources/webhook",
    );

    await user.type(screen.getByLabelText("Webhook URL"), "https://discord.com/api/webhooks/123/token");
    await user.type(screen.getByLabelText("机器人用户名（可选）"), "Renewlet");
    await user.type(screen.getByLabelText("机器人头像 URL（可选）"), "https://cdn.example.com/avatar.png");

    expect(screen.getByLabelText("Webhook URL")).toHaveValue("https://discord.com/api/webhooks/123/token");
    expect(screen.getByLabelText("机器人用户名（可选）")).toHaveValue("Renewlet");
    expect(screen.getByLabelText("机器人头像 URL（可选）")).toHaveValue("https://cdn.example.com/avatar.png");

    await user.click(screen.getByRole("button", { name: "测试 Discord 通知" }));
    expect(onTest).toHaveBeenCalledWith("discord");
  });

  it("renders PushPlus token field and keeps demo mode disabled", () => {
    render(<StatefulPanel channel="pushplus" initialSettings={{ pushplusToken: "push-token" }} disabled />);

    expect(screen.getByRole("link", { name: "PushPlus 消息接口文档" })).toHaveAttribute(
      "href",
      "https://www.pushplus.plus/doc/guide/api.html",
    );
    expect(screen.getByLabelText("PushPlus Token")).toHaveValue("push-token");
    expect(screen.getByLabelText("PushPlus Token")).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试 PushPlus 通知" })).toBeDisabled();
  });

  it("shows Discord and PushPlus summaries and disables channel toggles in demo mode", () => {
    render(
      <NotificationChannelList
        settings={{
          ...DEFAULT_SETTINGS,
          enabledChannels: ["discord"],
          discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
          pushplusToken: "",
        }}
        activeChannel="discord"
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByText("Webhook URL 已填写")).toBeInTheDocument();
    expect(screen.getByText("填写 PushPlus Token")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "停用 Discord" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "启用 PushPlus" })).toBeDisabled();
  });
});
