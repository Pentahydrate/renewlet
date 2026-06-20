package main

import (
	"encoding/json"
	"testing"
)

func TestSettingsFromValueRecoversUnsupportedPersistedLocale(t *testing.T) {
	settings, err := settingsFromValue(json.RawMessage(`{"locale":"fr-FR","monthlyBudget":2333}`))
	if err != nil {
		t.Fatal(err)
	}
	if settings.Locale != string(localeEnUS) || settings.MonthlyBudget != 2333 {
		t.Fatalf("expected persisted settings to recover locale only, got %#v", settings)
	}
}

func TestTelegramMessageFormatDefaultsAndRecoversPersistedValue(t *testing.T) {
	if got := defaultAppSettings().TelegramMessageFormat; got != telegramMessageFormatPlain {
		t.Fatalf("expected plain Telegram message format default, got %q", got)
	}

	settings, err := settingsFromValue(json.RawMessage(`{"telegramMessageFormat":"markdown","monthlyBudget":2333}`))
	if err != nil {
		t.Fatal(err)
	}
	if settings.TelegramMessageFormat != telegramMessageFormatPlain || settings.MonthlyBudget != 2333 {
		t.Fatalf("expected invalid stored Telegram format to recover only that field, got %#v", settings)
	}
}

func TestMergeSettingsForWriteRejectsUnsupportedLocale(t *testing.T) {
	if _, err := mergeSettingsForWrite(defaultAppSettings(), json.RawMessage(`{"locale":"fr-FR"}`)); err == nil {
		t.Fatal("expected unsupported locale write to fail")
	}
}

func TestMergeSettingsForWriteValidatesTelegramMessageFormat(t *testing.T) {
	settings, err := mergeSettingsForWrite(defaultAppSettings(), json.RawMessage(`{"telegramMessageFormat":"html"}`))
	if err != nil {
		t.Fatal(err)
	}
	if settings.TelegramMessageFormat != telegramMessageFormatHTML {
		t.Fatalf("expected html Telegram format, got %q", settings.TelegramMessageFormat)
	}
	if _, err := mergeSettingsForWrite(defaultAppSettings(), json.RawMessage(`{"telegramMessageFormat":"markdown"}`)); err == nil {
		t.Fatal("expected unsupported Telegram message format write to fail")
	}
}
