package main

import "testing"

func TestCloudBackupExportSettingsStripsDiscordAndPushPlusSecrets(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	user, _ := createRouteTestUser(t, app, "cloud-backup-export")
	settings := defaultAppSettings()
	settings.DiscordWebhookURL = "https://discord.com/api/webhooks/123/secret"
	settings.DiscordBotUsername = "Renewlet"
	settings.DiscordBotAvatarURL = "https://cdn.example.com/avatar.png"
	settings.PushPlusToken = "push-token"
	if _, err := createSettingsRecord(app, user.Id, settings); err != nil {
		t.Fatal(err)
	}

	exported, ok, err := cloudBackupExportSettings(app, user)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected settings to be exported")
	}
	for _, key := range []string{"discordWebhookUrl", "discordBotUsername", "discordBotAvatarUrl", "pushplusToken"} {
		if _, exists := exported[key]; exists {
			t.Fatalf("expected %s to be stripped from cloud backup settings: %#v", key, exported)
		}
	}
}
