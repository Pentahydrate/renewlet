/**
 * 通知渠道配置面板。
 *
 * 架构位置：按渠道展示凭据、模板和测试按钮；敏感配置的校验与发送仍由后端通知模块负责。
 *
 * 注意： Webhook/WeCom/Bark/Discord URL 最终会触发后端外连，展示层不能把“看起来像 URL”当作安全保证。
 */
import { useState } from 'react';
import { Bot, ExternalLink, Check, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumericInput } from '@/components/ui/numeric-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages';
import {
  CHANNEL_LABELS,
  WEBHOOK_HEADERS_PLACEHOLDER,
  WEBHOOK_PAYLOAD_PLACEHOLDER,
  type AppSettings,
  type NotificationChannel,
} from '@/types/subscription';
import { ChoiceRadioGroup, CheckboxSettingRow, LoadingButtonContent, type UpdateSetting } from './settings-shared-controls';
import type { SettingsTelegramBotCommandsController } from '../application/use-telegram-bot-commands-controller';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const NOTIFICATION_TEST_LABEL_KEYS: Record<NotificationChannel, MessageKey> = {
  telegram: "settings.testChannel.telegram",
  notifyx: "settings.testChannel.notifyx",
  webhook: "settings.testChannel.webhook",
  wechat: "settings.testChannel.wechat",
  email: "settings.testChannel.email",
  bark: "settings.testChannel.bark",
  serverchan: "settings.testChannel.serverchan",
  discord: "settings.testChannel.discord",
  pushplus: "settings.testChannel.pushplus",
};

const TELEGRAM_BOT_COMMAND_STATUS_LABEL_KEYS = {
  not_configured: "settings.telegramBotCommandsStatus.notConfigured",
  not_installed: "settings.telegramBotCommandsStatus.notInstalled",
  installing: "settings.telegramBotCommandsStatus.installing",
  installed: "settings.telegramBotCommandsStatus.installed",
} as const satisfies Record<string, MessageKey>;

const SMTP_PORT_MAX = 65_535;

type NumericAllowedValues = {
  floatValue: number | undefined;
  value: string;
};

function isAllowedSmtpPortValue(values: NumericAllowedValues) {
  return values.value === "" || (
    /^[1-9]\d{0,4}$/.test(values.value)
    && values.floatValue !== undefined
    && values.floatValue <= SMTP_PORT_MAX
  );
}

function NotificationTestButton({
  channel,
  label,
  testingChannel,
  onTest,
  disabled,
}: {
  channel: NotificationChannel;
  label: string;
  testingChannel: NotificationChannel | null;
  onTest: (channel: NotificationChannel) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const isTesting = testingChannel === channel;

  return (
    <Button
      type="button"
      variant="outline"
      className="relative border-primary text-primary hover:bg-primary/10"
      onClick={() => onTest(channel)}
      disabled={disabled || testingChannel !== null}
      aria-busy={isTesting ? true : undefined}
    >
      <LoadingButtonContent loading={isTesting} loadingLabel={t("settings.testing")}>
        <Check aria-hidden="true" className="h-4 w-4" />
        {label}
      </LoadingButtonContent>
    </Button>
  );
}


function getNotificationChannelHelp(channel: NotificationChannel, t: Translate): { href: string; label: string } | null {
  switch (channel) {
    case 'telegram':
      return { href: 'https://t.me/botfather', label: t("settings.help.telegram") };
    case 'webhook':
      return { href: 'https://en.wikipedia.org/wiki/Webhook', label: t("settings.help.webhook") };
    case 'wechat':
      return { href: 'https://developer.work.weixin.qq.com/document/path/91770', label: t("settings.help.wechat") };
    case 'bark':
      return { href: 'https://github.com/Finb/Bark', label: t("settings.help.bark") };
    case 'notifyx':
      return { href: 'https://www.notifyx.cn/help', label: t("settings.help.notifyx") };
    case 'serverchan':
      return { href: 'https://sct.ftqq.com/', label: t("settings.help.serverchan") };
    case 'discord':
      return { href: 'https://docs.discord.com/developers/resources/webhook', label: t("settings.help.discord") };
    case 'pushplus':
      return { href: 'https://www.pushplus.plus/doc/guide/api.html', label: t("settings.help.pushplus") };
    case 'email':
      return null;
  }
}


export function NotificationChannelConfigPanel({
  channel,
  settings,
  enabled,
  updateSetting,
  testingChannel,
  onTest,
  disabled = false,
  telegramBotCommands,
}: {
  channel: NotificationChannel;
  settings: AppSettings;
  enabled: boolean;
  updateSetting: UpdateSetting;
  testingChannel: NotificationChannel | null;
  onTest: (channel: NotificationChannel) => void;
  disabled?: boolean;
  telegramBotCommands?: SettingsTelegramBotCommandsController;
}) {
  const { t, label, formatDateTime } = useI18n();
  const [deleteCommandsOpen, setDeleteCommandsOpen] = useState(false);
  const help = getNotificationChannelHelp(channel, t);
  const channelLabel = label(CHANNEL_LABELS[channel]);
  const testChannelLabel = t(NOTIFICATION_TEST_LABEL_KEYS[channel], { channel: channelLabel });
  const commandStatus = telegramBotCommands?.data?.status ?? "not_configured";
  const commandStatusLabel = t(TELEGRAM_BOT_COMMAND_STATUS_LABEL_KEYS[commandStatus]);
  const commandBindingPresent = commandStatus === "installed" || commandStatus === "installing";
  const commandInstalling = Boolean(telegramBotCommands?.isInstalling) || commandStatus === "installing";
  const commandInstallDisabled = Boolean(telegramBotCommands?.installDisabledReason) || !telegramBotCommands || telegramBotCommands.isLoading || telegramBotCommands.isDeleting || commandInstalling;
  const commandDeleteDisabled = Boolean(telegramBotCommands?.deleteDisabledReason) || !telegramBotCommands || telegramBotCommands.isLoading || commandInstalling || !commandBindingPresent;
  const commandInstallDisabledReason = telegramBotCommands?.installDisabledReason;
  const commandInstallDisabledReasonVisible = commandInstallDisabledReason && !commandInstalling;
  const commandTime = (value: string | null | undefined) => value
    ? formatDateTime(value, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : t("settings.telegramBotCommandsNever");

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t("settings.channelConfig", { channel: channelLabel })}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {enabled ? t("settings.channelEnabledHelp") : t("settings.channelDisabledHelp")}
          </p>
        </div>
        {help ? (
          <a
            href={help.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {help.label}
          </a>
        ) : null}
      </div>

      {channel === 'telegram' ? (
        <>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="telegramBot">Bot Token</Label>
              <Input
                id="telegramBot"
                placeholder="xx:xxxxxxxxx-token"
                value={settings.telegramBotToken}
                disabled={disabled}
                onChange={(e) => updateSetting('telegramBotToken', e.target.value)}
                className="border-border bg-secondary"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="telegramChat">Chat ID</Label>
              <Input
                id="telegramChat"
                placeholder={t("settings.telegramChatPlaceholder")}
                value={settings.telegramChatId}
                disabled={disabled}
                onChange={(e) => updateSetting('telegramChatId', e.target.value)}
                className="border-border bg-secondary"
              />
            </div>
            <ChoiceRadioGroup
              id="telegramMessageFormat"
              label={t("settings.telegramMessageFormat")}
              value={settings.telegramMessageFormat}
              disabled={disabled}
              onValueChange={(format) => updateSetting("telegramMessageFormat", format)}
              options={[
                {
                  value: "plain",
                  label: t("settings.telegramMessageFormatPlain"),
                  description: t("settings.telegramMessageFormatPlainDescription"),
                },
                {
                  value: "html",
                  label: t("settings.telegramMessageFormatHtml"),
                  description: t("settings.telegramMessageFormatHtmlDescription"),
                },
              ]}
            />
          </div>
          <div className="mt-4 flex flex-col items-start gap-2 sm:items-end">
            <NotificationTestButton
              channel="telegram"
              label={testChannelLabel}
              testingChannel={testingChannel}
              onTest={onTest}
              disabled={disabled}
            />
          </div>
          {telegramBotCommands ? (
            <div className="mt-4 rounded-md border border-border bg-background/70 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-medium text-foreground">{t("settings.telegramBotCommands")}</h4>
                    <Badge variant={telegramBotCommands.data?.installed ? "default" : "secondary"}>{commandStatusLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.telegramBotCommandsHelp")}</p>
                  <div className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                    <span>{t("settings.telegramBotCommandsChat", { chatId: telegramBotCommands.data?.chatId ?? t("settings.telegramBotCommandsMissing") })}</span>
                    <span>{t("settings.telegramBotCommandsInstalledAt", { time: commandTime(telegramBotCommands.data?.installedAt) })}</span>
                    <span>{t("settings.telegramBotCommandsLastUsedAt", { time: commandTime(telegramBotCommands.data?.lastUsedAt) })}</span>
                  </div>
                  {commandInstallDisabledReasonVisible ? (
                    <p className="mt-2 text-xs font-medium text-muted-foreground">{commandInstallDisabledReason}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      void telegramBotCommands.install();
                    }}
                    disabled={commandInstallDisabled}
                    aria-busy={commandInstalling ? true : undefined}
                    className="justify-center"
                  >
                    <LoadingButtonContent loading={commandInstalling} loadingLabel={t("settings.telegramBotCommandsInstalling")}>
                      {telegramBotCommands.data?.installed ? t("settings.telegramBotCommandsReinstall") : t("settings.telegramBotCommandsInstall")}
                    </LoadingButtonContent>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteCommandsOpen(true)}
                    disabled={commandDeleteDisabled}
                    aria-busy={telegramBotCommands.isDeleting ? true : undefined}
                    className="justify-center gap-2 text-destructive hover:text-destructive"
                  >
                    <LoadingButtonContent loading={telegramBotCommands.isDeleting} loadingLabel={t("settings.telegramBotCommandsDeleting")}>
                      <Trash2 className="h-4 w-4" />
                      {t("settings.telegramBotCommandsDelete")}
                    </LoadingButtonContent>
                  </Button>
                </div>
              </div>
              <AlertDialog open={deleteCommandsOpen} onOpenChange={setDeleteCommandsOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("settings.telegramBotCommandsDeleteTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("settings.telegramBotCommandsDeleteDescription")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        void telegramBotCommands.deleteCommands();
                      }}
                    >
                      {t("settings.telegramBotCommandsDelete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </>
      ) : null}

      {channel === 'notifyx' ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor="notifyxKey">API Key</Label>
            <Input
              id="notifyxKey"
              placeholder="napi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={settings.notifyxApiKey}
              disabled={disabled}
              onChange={(e) => updateSetting('notifyxApiKey', e.target.value)}
              className="border-border bg-secondary"
            />
            <p className="text-xs text-muted-foreground">{t("settings.notifyxHelp")}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton
              channel="notifyx"
              label={testChannelLabel}
              testingChannel={testingChannel}
              onTest={onTest}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}

      {channel === 'webhook' ? (
        <>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                id="webhookUrl"
                name="webhookUrl"
                type="url"
                inputMode="url"
                enterKeyHint="next"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://your-webhook-endpoint.com/path"
                value={settings.webhookUrl}
                disabled={disabled}
                onChange={(e) => updateSetting('webhookUrl', e.target.value)}
                className="border-border bg-secondary"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.webhookGetPostHelp")}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="webhookMethod">{t("settings.webhookMethod")}</Label>
                <Select
                  value={settings.webhookMethod}
                  disabled={disabled}
                  onValueChange={(value) => updateSetting('webhookMethod', value as 'GET' | 'POST')}
                >
                  <SelectTrigger className="border-border bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="GET">GET</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="webhookHeaders">{t("settings.webhookHeaders")}</Label>
              <Textarea
                id="webhookHeaders"
                placeholder={WEBHOOK_HEADERS_PLACEHOLDER}
                value={settings.webhookHeaders}
                disabled={disabled}
                onChange={(e) => updateSetting('webhookHeaders', e.target.value)}
                className="min-h-[80px] border-border bg-secondary font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">{t("settings.webhookHeadersHelp")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="webhookPayload">{t("settings.webhookPayload")}</Label>
              <Textarea
                id="webhookPayload"
                placeholder={WEBHOOK_PAYLOAD_PLACEHOLDER}
                value={settings.webhookPayload}
                disabled={disabled}
                onChange={(e) => updateSetting('webhookPayload', e.target.value)}
                className="min-h-[80px] border-border bg-secondary font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.webhookPayloadHelp")}
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton
              channel="webhook"
              label={testChannelLabel}
              testingChannel={testingChannel}
              onTest={onTest}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}

      {channel === 'wechat' ? (
        <>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wechatUrl">{t("settings.wechatUrl")}</Label>
              <Input
                id="wechatUrl"
                name="wechatUrl"
                type="url"
                inputMode="url"
                enterKeyHint="next"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx-xxxx"
                value={settings.wechatWebhookUrl}
                disabled={disabled}
                onChange={(e) => updateSetting('wechatWebhookUrl', e.target.value)}
                className="border-border bg-secondary"
              />
              <p className="text-xs text-muted-foreground">{t("settings.wechatHelp")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="wechatMsgType">{t("settings.messageType")}</Label>
                <Select
                  value={settings.wechatMessageType}
                  disabled={disabled}
                  onValueChange={(value) => updateSetting('wechatMessageType', value as 'text' | 'markdown')}
                >
                  <SelectTrigger className="border-border bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">{t("settings.textMessage")}</SelectItem>
                    <SelectItem value="markdown">Markdown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <CheckboxSettingRow
              id="wechatModeTag"
              checked={settings.wechatAddModeTag}
              onCheckedChange={(checked) => updateSetting('wechatAddModeTag', checked)}
              label={t("settings.wechatModeTag")}
              disabled={disabled}
            />
            <div className="grid gap-2">
              <Label htmlFor="wechatPhones">{t("settings.wechatPhones")}</Label>
              <Input
                id="wechatPhones"
                name="wechatPhones"
                type="tel"
                inputMode="tel"
                enterKeyHint="next"
                autoComplete="tel"
                placeholder="135xxxxxxxx,136xxxxxxxx"
                value={settings.wechatAtPhones}
                disabled={disabled}
                onChange={(e) => updateSetting('wechatAtPhones', e.target.value)}
                className="border-border bg-secondary"
              />
              <p className="text-xs text-muted-foreground">{t("settings.wechatPhonesHelp")}</p>
            </div>
            <CheckboxSettingRow
              id="wechatAtAll"
              checked={settings.wechatAtAll}
              onCheckedChange={(checked) => updateSetting('wechatAtAll', checked)}
              label={t("settings.wechatAtAll")}
              disabled={disabled}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton
              channel="wechat"
              label={testChannelLabel}
              testingChannel={testingChannel}
              onTest={onTest}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}

      {channel === 'email' ? (
        <>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="smtpHost">{t("settings.smtpHost")}</Label>
                <Input
                  id="smtpHost"
                  placeholder="smtp.example.com"
                  value={settings.smtpHost}
                  disabled={disabled}
                  onChange={(e) => updateSetting('smtpHost', e.target.value)}
                  className="border-border bg-secondary"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtpPort">{t("settings.smtpPort")}</Label>
                <NumericInput
                  id="smtpPort"
                  name="smtpPort"
                  inputMode="numeric"
                  enterKeyHint="next"
                  placeholder="587"
                  value={settings.smtpPort}
                  allowNegative={false}
                  decimalScale={0}
                  isAllowed={isAllowedSmtpPortValue}
                  disabled={disabled}
                  onRawValueChange={(value) => updateSetting('smtpPort', value)}
                  className="border-border bg-secondary"
                />
              </div>
            </div>
            <CheckboxSettingRow
              id="smtpSecure"
              checked={settings.smtpSecure}
              onCheckedChange={(checked) => updateSetting('smtpSecure', checked)}
              label={t("settings.smtpSecure")}
              description={t("settings.smtpSecureHelp")}
              disabled={disabled}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="smtpUser">{t("settings.smtpUser")}</Label>
                <Input
                  id="smtpUser"
                  name="smtpUser"
                  value={settings.smtpUser}
                  disabled={disabled}
                  onChange={(e) => updateSetting('smtpUser', e.target.value)}
                  className="border-border bg-secondary"
                  autoComplete="username"
                  enterKeyHint="next"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtpPassword">{t("settings.smtpPassword")}</Label>
                <Input
                  id="smtpPassword"
                  name="smtpPassword"
                  type="password"
                  value={settings.smtpPassword}
                  disabled={disabled}
                  onChange={(e) => updateSetting('smtpPassword', e.target.value)}
                  className="border-border bg-secondary"
                  autoComplete="new-password"
                  enterKeyHint="next"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="smtpFrom">{t("settings.smtpFrom")}</Label>
                <Input
                  id="smtpFrom"
                  placeholder="Renewlet <noreply@example.com>"
                  value={settings.smtpFrom}
                  disabled={disabled}
                  onChange={(e) => updateSetting('smtpFrom', e.target.value)}
                  className="border-border bg-secondary"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtpReplyTo">{t("settings.smtpReplyTo")}</Label>
                <Input
                  id="smtpReplyTo"
                  placeholder="support@example.com"
                  value={settings.smtpReplyTo}
                  disabled={disabled}
                  onChange={(e) => updateSetting('smtpReplyTo', e.target.value)}
                  className="border-border bg-secondary"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.smtpHelp")}
            </p>
            <CheckboxSettingRow
              id="notifyMultipleAddresses"
              checked={settings.notifyMultipleAddresses}
              onCheckedChange={(checked) => updateSetting('notifyMultipleAddresses', checked)}
              label={t("settings.multipleRecipients")}
              description={t("settings.multipleRecipientsHelp")}
              disabled={disabled}
            />
            <div className="grid gap-2">
              <Label htmlFor="recipientEmail">{t("settings.recipientEmail")}</Label>
              <Input
                id="recipientEmail"
                type={settings.notifyMultipleAddresses ? 'text' : 'email'}
                placeholder={settings.notifyMultipleAddresses ? 'a@example.com, b@example.com' : 'user@example.com'}
                value={settings.recipientEmail}
                disabled={disabled}
                onChange={(e) => updateSetting('recipientEmail', e.target.value)}
                className="border-border bg-secondary"
              />
              <p className="text-xs text-muted-foreground">{t("settings.recipientEmailHelp")}</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton
              channel="email"
              label={testChannelLabel}
              testingChannel={testingChannel}
              onTest={onTest}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}

      {channel === 'bark' ? (
        <>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="barkUrl">{t("settings.barkServer")}</Label>
              <Input
                id="barkUrl"
                placeholder="https://api.day.app"
                value={settings.barkServerUrl}
                disabled={disabled}
                onChange={(e) => updateSetting('barkServerUrl', e.target.value)}
                className="border-border bg-secondary"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.barkServerHelp")}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="barkKey">{t("settings.barkKey")}</Label>
              <Input
                id="barkKey"
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                value={settings.barkDeviceKey}
                disabled={disabled}
                onChange={(e) => updateSetting('barkDeviceKey', e.target.value)}
                className="border-border bg-secondary"
              />
              <p className="text-xs text-muted-foreground">{t("settings.barkKeyHelp")}</p>
            </div>
            <CheckboxSettingRow
              id="barkSilent"
              checked={settings.barkSilentPush}
              onCheckedChange={(checked) => updateSetting('barkSilentPush', checked)}
              label={t("settings.barkSilent")}
              description={t("settings.barkSilentHelp")}
              disabled={disabled}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton
              channel="bark"
              label={testChannelLabel}
              testingChannel={testingChannel}
              onTest={onTest}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}

      {channel === 'serverchan' ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor="serverchanSendKey">{t("settings.serverchanSendKey")}</Label>
            <Input
              id="serverchanSendKey"
              name="serverchanSendKey"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t("settings.serverchanSendKeyPlaceholder")}
              value={settings.serverchanSendKey}
              disabled={disabled}
              onChange={(e) => updateSetting('serverchanSendKey', e.target.value)}
              className="border-border bg-secondary"
            />
            <p className="text-xs text-muted-foreground">{t("settings.serverchanHelp")}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton
              channel="serverchan"
              label={testChannelLabel}
              testingChannel={testingChannel}
              onTest={onTest}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}

      {channel === 'discord' ? (
        <>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="discordWebhookUrl">{t("settings.discordWebhookUrl")}</Label>
              <Input
                id="discordWebhookUrl"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://discord.com/api/webhooks/..."
                value={settings.discordWebhookUrl}
                disabled={disabled}
                onChange={(e) => updateSetting('discordWebhookUrl', e.target.value)}
                className="border-border bg-secondary"
              />
              <p className="text-xs text-muted-foreground">{t("settings.discordWebhookHelp")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="discordBotUsername">{t("settings.discordBotUsername")}</Label>
                <Input
                  id="discordBotUsername"
                  value={settings.discordBotUsername}
                  disabled={disabled}
                  onChange={(e) => updateSetting('discordBotUsername', e.target.value)}
                  className="border-border bg-secondary"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="discordBotAvatarUrl">{t("settings.discordBotAvatarUrl")}</Label>
                <Input
                  id="discordBotAvatarUrl"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="https://cdn.example.com/avatar.png"
                  value={settings.discordBotAvatarUrl}
                  disabled={disabled}
                  onChange={(e) => updateSetting('discordBotAvatarUrl', e.target.value)}
                  className="border-border bg-secondary"
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton channel="discord" label={testChannelLabel} testingChannel={testingChannel} onTest={onTest} disabled={disabled} />
          </div>
        </>
      ) : null}

      {channel === 'pushplus' ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor="pushplusToken">{t("settings.pushplusToken")}</Label>
            <Input
              id="pushplusToken"
              autoCapitalize="none"
              spellCheck={false}
              value={settings.pushplusToken}
              disabled={disabled}
              onChange={(e) => updateSetting('pushplusToken', e.target.value)}
              className="border-border bg-secondary"
            />
            <p className="text-xs text-muted-foreground">{t("settings.pushplusHelp")}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <NotificationTestButton channel="pushplus" label={testChannelLabel} testingChannel={testingChannel} onTest={onTest} disabled={disabled} />
          </div>
        </>
      ) : null}
    </div>
  );
}
