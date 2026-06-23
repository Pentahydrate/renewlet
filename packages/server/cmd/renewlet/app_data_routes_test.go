package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func TestSettingsReadCreatesEnglishDefaultsWithoutHeader(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "settings-default-locale")

	read := serveTestRequest(t, app, http.MethodGet, "/api/app/settings", "", token)
	if read.Code != http.StatusOK {
		t.Fatalf("expected settings read 200, got %d: %s", read.Code, read.Body.String())
	}
	var body settingsResponse
	if err := json.Unmarshal(read.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Settings.Locale != string(localeEnUS) {
		t.Fatalf("expected default locale en-US, got %q", body.Settings.Locale)
	}
	if got := countUserRecords(t, app, "settings", user.Id); got != 1 {
		t.Fatalf("expected settings read to create one settings row, got %d", got)
	}
	if got := settingsRecordLocale(t, app, user.Id); got != string(localeEnUS) {
		t.Fatalf("expected persisted locale en-US, got %q", got)
	}
}

func TestSettingsReadCreatesRequestLocaleOnce(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "settings-request-locale")

	first := serveTestRequestWithHeaders(t, app, http.MethodGet, "/api/app/settings", "", token, map[string]string{
		"X-Renewlet-Locale": "zh-CN",
	})
	if first.Code != http.StatusOK {
		t.Fatalf("expected first settings read 200, got %d: %s", first.Code, first.Body.String())
	}
	var firstBody settingsResponse
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	if firstBody.Settings.Locale != string(localeZhCN) {
		t.Fatalf("expected first settings locale zh-CN, got %q", firstBody.Settings.Locale)
	}

	second := serveTestRequestWithHeaders(t, app, http.MethodGet, "/api/app/settings", "", token, map[string]string{
		"X-Renewlet-Locale": "en-US",
	})
	if second.Code != http.StatusOK {
		t.Fatalf("expected second settings read 200, got %d: %s", second.Code, second.Body.String())
	}
	var secondBody settingsResponse
	if err := json.Unmarshal(second.Body.Bytes(), &secondBody); err != nil {
		t.Fatal(err)
	}
	if secondBody.Settings.Locale != string(localeZhCN) || settingsRecordLocale(t, app, user.Id) != string(localeZhCN) {
		t.Fatalf("expected existing settings to keep zh-CN, got response=%q persisted=%q", secondBody.Settings.Locale, settingsRecordLocale(t, app, user.Id))
	}
}

func TestSettingsUpdateCreatesDefaultsFromRequestLocale(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "settings-update-locale")

	update := serveTestRequestWithHeaders(t, app, http.MethodPut, "/api/app/settings", `{"monthlyBudget":2333}`, token, map[string]string{
		"X-Renewlet-Locale": "zh-CN",
	})
	if update.Code != http.StatusOK {
		t.Fatalf("expected settings update 200, got %d: %s", update.Code, update.Body.String())
	}
	var body settingsResponse
	if err := json.Unmarshal(update.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Settings.Locale != string(localeZhCN) || body.Settings.MonthlyBudget != 2333 {
		t.Fatalf("expected update to create zh-CN settings with monthly budget, got %#v", body.Settings)
	}
	if got := settingsRecordLocale(t, app, user.Id); got != string(localeZhCN) {
		t.Fatalf("expected persisted locale zh-CN, got %q", got)
	}
}

func TestSettingsUpdateRejectsUnsupportedLocaleWithoutCreatingRecord(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "settings-invalid-locale")

	update := serveTestRequestWithHeaders(t, app, http.MethodPut, "/api/app/settings", `{"locale":"fr-FR"}`, token, map[string]string{
		"X-Renewlet-Locale": "zh-CN",
	})
	if update.Code != http.StatusBadRequest {
		t.Fatalf("expected unsupported locale update 400, got %d: %s", update.Code, update.Body.String())
	}
	if got := countUserRecords(t, app, "settings", user.Id); got != 0 {
		t.Fatalf("expected invalid settings update not to create a settings row, got %d", got)
	}
}

func TestSettingsProductAPIRoundTripAndStrictJSON(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	_, token := createRouteTestUser(t, app, "settings-api")

	update := serveTestRequest(t, app, http.MethodPut, "/api/app/settings", `{"monthlyBudget":2333,"timezone":"Asia/Shanghai"}`, token)
	if update.Code != http.StatusOK {
		t.Fatalf("expected settings update 200, got %d: %s", update.Code, update.Body.String())
	}
	var updateBody settingsResponse
	if err := json.Unmarshal(update.Body.Bytes(), &updateBody); err != nil {
		t.Fatal(err)
	}
	if updateBody.Settings.MonthlyBudget != 2333 || updateBody.Settings.Timezone != "Asia/Shanghai" {
		t.Fatalf("unexpected settings response: %#v", updateBody.Settings)
	}

	read := serveTestRequest(t, app, http.MethodGet, "/api/app/settings", "", token)
	if read.Code != http.StatusOK {
		t.Fatalf("expected settings read 200, got %d: %s", read.Code, read.Body.String())
	}
	var readBody settingsResponse
	if err := json.Unmarshal(read.Body.Bytes(), &readBody); err != nil {
		t.Fatal(err)
	}
	if readBody.Settings.MonthlyBudget != 2333 || readBody.Settings.Timezone != "Asia/Shanghai" {
		t.Fatalf("expected persisted settings, got %#v", readBody.Settings)
	}

	invalid := serveTestRequest(t, app, http.MethodPut, "/api/app/settings", `{"unknown":true}`, token)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("expected strict settings update 400, got %d: %s", invalid.Code, invalid.Body.String())
	}
}

func settingsRecordLocale(t *testing.T, app core.App, userID string) string {
	t.Helper()
	record, err := app.FindFirstRecordByFilter("settings", "user = {:user}", dbx.Params{"user": userID})
	if err != nil {
		t.Fatal(err)
	}
	return settingsFromRecord(record).Locale
}

func TestCustomConfigProductAPIRoundTrip(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	_, token := createRouteTestUser(t, app, "custom-config-api")

	body := `{"config":{"categories":[{"id":"cat_ai","value":"ai","labels":{"zh-CN":"AI","en-US":"AI"},"color":"#10b981"}],"statuses":[],"paymentMethods":[],"currencies":[]}}`
	update := serveTestRequest(t, app, http.MethodPut, "/api/app/custom-config", body, token)
	if update.Code != http.StatusOK {
		t.Fatalf("expected custom config update 200, got %d: %s", update.Code, update.Body.String())
	}

	read := serveTestRequest(t, app, http.MethodGet, "/api/app/custom-config", "", token)
	if read.Code != http.StatusOK {
		t.Fatalf("expected custom config read 200, got %d: %s", read.Code, read.Body.String())
	}
	var response customConfigResponse
	if err := json.Unmarshal(read.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Config.Categories) != 1 || response.Config.Categories[0].ID != "cat_ai" {
		t.Fatalf("unexpected custom config: %#v", response.Config)
	}
}

func TestSubscriptionsProductAPIUsesOwnerScopedCRUD(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	_, token := createRouteTestUser(t, app, "subscriptions-api")
	_, otherToken := createRouteTestUser(t, app, "subscriptions-other-api")

	create := serveTestRequest(t, app, http.MethodPost, "/api/app/subscriptions", subscriptionCreateBody("Route API"), token)
	if create.Code != http.StatusCreated {
		t.Fatalf("expected subscription create 201, got %d: %s", create.Code, create.Body.String())
	}
	var created subscriptionResponse
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id, _ := created.Subscription["id"].(string)
	if id == "" {
		t.Fatalf("expected created subscription id, got %#v", created.Subscription)
	}

	list := serveTestRequest(t, app, http.MethodGet, "/api/app/subscriptions?limit=10", "", token)
	if list.Code != http.StatusOK {
		t.Fatalf("expected subscription list 200, got %d: %s", list.Code, list.Body.String())
	}
	var listBody subscriptionsListResponse
	if err := json.Unmarshal(list.Body.Bytes(), &listBody); err != nil {
		t.Fatal(err)
	}
	if len(listBody.Subscriptions) != 1 || listBody.Subscriptions[0]["name"] != "Route API" || listBody.Total != 1 {
		t.Fatalf("unexpected subscription list: %#v", listBody)
	}
	if _, ok := listBody.Subscriptions[0]["user"]; ok {
		t.Fatalf("subscription API must not expose owner field: %#v", listBody.Subscriptions[0])
	}

	foreignDelete := serveTestRequest(t, app, http.MethodDelete, "/api/app/subscriptions/"+id, "", otherToken)
	if foreignDelete.Code != http.StatusNotFound {
		t.Fatalf("expected foreign delete 404, got %d: %s", foreignDelete.Code, foreignDelete.Body.String())
	}

	patch := serveTestRequest(t, app, http.MethodPatch, "/api/app/subscriptions/"+id, `{"name":"Renamed API","price":20}`, token)
	if patch.Code != http.StatusOK {
		t.Fatalf("expected subscription patch 200, got %d: %s", patch.Code, patch.Body.String())
	}
	var patched subscriptionResponse
	if err := json.Unmarshal(patch.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Subscription["name"] != "Renamed API" || patched.Subscription["price"] != float64(20) {
		t.Fatalf("unexpected patched subscription: %#v", patched.Subscription)
	}

	del := serveTestRequest(t, app, http.MethodDelete, "/api/app/subscriptions/"+id, "", token)
	if del.Code != http.StatusOK {
		t.Fatalf("expected subscription delete 200, got %d: %s", del.Code, del.Body.String())
	}
}

func TestSubscriptionsProductAPIAcceptsRecurringSubscriptionWithoutStartDate(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	_, token := createRouteTestUser(t, app, "subscriptions-null-start-api")

	var body map[string]interface{}
	if err := json.Unmarshal([]byte(subscriptionCreateBody("Unknown Start")), &body); err != nil {
		t.Fatal(err)
	}
	body["startDate"] = nil
	body["autoCalculateNextBillingDate"] = false
	data, _ := json.Marshal(body)

	create := serveTestRequest(t, app, http.MethodPost, "/api/app/subscriptions", string(data), token)
	if create.Code != http.StatusCreated {
		t.Fatalf("expected subscription create 201, got %d: %s", create.Code, create.Body.String())
	}
	var created subscriptionResponse
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if value, ok := created.Subscription["startDate"]; !ok || value != nil {
		t.Fatalf("expected startDate JSON null, got %#v in %#v", value, created.Subscription)
	}
	if created.Subscription["autoCalculateNextBillingDate"] != false {
		t.Fatalf("expected manual date anchor, got %#v", created.Subscription["autoCalculateNextBillingDate"])
	}
}

func TestSubscriptionsProductAPICursorAdvancesWithoutRepeatingRows(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "subscriptions-cursor-api")
	for _, name := range []string{"Cursor One", "Cursor Two", "Cursor Three"} {
		createRouteTestSubscription(t, app, user.Id, map[string]interface{}{"name": name})
	}

	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 3; page++ {
		target := "/api/app/subscriptions?limit=1"
		if cursor != "" {
			target += "&cursor=" + url.QueryEscape(cursor)
		}
		res := serveTestRequest(t, app, http.MethodGet, target, "", token)
		if res.Code != http.StatusOK {
			t.Fatalf("expected subscription page %d to return 200, got %d: %s", page+1, res.Code, res.Body.String())
		}
		var body subscriptionsListResponse
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Subscriptions) != 1 {
			t.Fatalf("expected one subscription on page %d, got %#v", page+1, body.Subscriptions)
		}
		id, _ := body.Subscriptions[0]["id"].(string)
		if id == "" {
			t.Fatalf("expected page %d subscription id, got %#v", page+1, body.Subscriptions[0])
		}
		if seen[id] {
			t.Fatalf("cursor returned duplicate subscription id %q on page %d", id, page+1)
		}
		seen[id] = true
		if page < 2 {
			if body.NextCursor == nil || *body.NextCursor == "" {
				t.Fatalf("expected next cursor on page %d", page+1)
			}
			cursor = *body.NextCursor
		} else if body.NextCursor != nil {
			t.Fatalf("expected final page to end cursor, got %q", *body.NextCursor)
		}
	}
}

func TestAssetsProductAPIUploadListAndRead(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	_, token := createRouteTestUser(t, app, "assets-api")

	upload := serveMultipartTestRequest(
		t,
		app,
		"/api/app/assets",
		token,
		map[string]string{"kind": "logo"},
		"file",
		"logo.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if upload.Code != http.StatusCreated {
		t.Fatalf("expected asset upload 201, got %d: %s", upload.Code, upload.Body.String())
	}
	var uploaded uploadAssetResponse
	if err := json.Unmarshal(upload.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(uploaded.URL, "/api/app/assets/") {
		t.Fatalf("expected product asset URL, got %#v", uploaded)
	}
	id := strings.TrimPrefix(uploaded.URL, "/api/app/assets/")

	list := serveTestRequest(t, app, http.MethodGet, "/api/app/assets?kind=logo&page=1&perPage=48", "", token)
	if list.Code != http.StatusOK {
		t.Fatalf("expected asset list 200, got %d: %s", list.Code, list.Body.String())
	}
	var page uploadedAssetsPageResponse
	if err := json.Unmarshal(list.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].URL != uploaded.URL || page.Items[0].Kind != "logo" {
		t.Fatalf("unexpected asset page: %#v", page)
	}

	read := serveTestRequest(t, app, http.MethodGet, "/api/app/assets/"+id, "", token)
	if read.Code != http.StatusOK {
		t.Fatalf("expected asset read 200, got %d: %s", read.Code, read.Body.String())
	}
	if contentType := read.Header().Get("content-type"); !strings.Contains(contentType, "image/svg+xml") {
		t.Fatalf("expected svg content-type, got %q", contentType)
	}

	del := serveTestRequest(t, app, http.MethodDelete, "/api/app/assets/"+id, "", token)
	if del.Code != http.StatusOK {
		t.Fatalf("expected asset delete 200, got %d: %s", del.Code, del.Body.String())
	}
	afterDeleteList := serveTestRequest(t, app, http.MethodGet, "/api/app/assets?kind=logo&page=1&perPage=48", "", token)
	if afterDeleteList.Code != http.StatusOK {
		t.Fatalf("expected asset list after delete 200, got %d: %s", afterDeleteList.Code, afterDeleteList.Body.String())
	}
	var afterDeletePage uploadedAssetsPageResponse
	if err := json.Unmarshal(afterDeleteList.Body.Bytes(), &afterDeletePage); err != nil {
		t.Fatal(err)
	}
	if len(afterDeletePage.Items) != 0 {
		t.Fatalf("expected deleted asset to disappear from list: %#v", afterDeletePage)
	}
	readDeleted := serveTestRequest(t, app, http.MethodGet, "/api/app/assets/"+id, "", token)
	if readDeleted.Code != http.StatusNotFound {
		t.Fatalf("expected deleted asset read 404, got %d: %s", readDeleted.Code, readDeleted.Body.String())
	}

	invalid := serveMultipartTestRequest(t, app, "/api/app/assets", token, map[string]string{"kind": "logo"}, "file", "note.txt", "plain text")
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid upload 400, got %d: %s", invalid.Code, invalid.Body.String())
	}
}

func TestAssetProductAPIDeleteBlocksReferencedAndForeignAssets(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "assets-owner")
	_, foreignToken := createRouteTestUser(t, app, "assets-foreign")

	upload := serveMultipartTestRequest(
		t,
		app,
		"/api/app/assets",
		token,
		map[string]string{"kind": "logo"},
		"file",
		"used.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if upload.Code != http.StatusCreated {
		t.Fatalf("expected asset upload 201, got %d: %s", upload.Code, upload.Body.String())
	}
	var uploaded uploadAssetResponse
	if err := json.Unmarshal(upload.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	id := strings.TrimPrefix(uploaded.URL, "/api/app/assets/")
	createRouteTestSubscription(t, app, user.Id, map[string]interface{}{"logo": uploaded.URL})

	foreignDelete := serveTestRequest(t, app, http.MethodDelete, "/api/app/assets/"+id, "", foreignToken)
	if foreignDelete.Code != http.StatusNotFound {
		t.Fatalf("expected foreign asset delete 404, got %d: %s", foreignDelete.Code, foreignDelete.Body.String())
	}

	blockedDelete := serveTestRequest(t, app, http.MethodDelete, "/api/app/assets/"+id, "", token)
	if blockedDelete.Code != http.StatusConflict {
		t.Fatalf("expected referenced asset delete 409, got %d: %s", blockedDelete.Code, blockedDelete.Body.String())
	}
	var blockedBody struct {
		Code    string            `json:"code"`
		Details assetInUseDetails `json:"details"`
	}
	if err := json.Unmarshal(blockedDelete.Body.Bytes(), &blockedBody); err != nil {
		t.Fatal(err)
	}
	if blockedBody.Code != "ASSET_IN_USE" || blockedBody.Details.UsageCount != 1 || blockedBody.Details.SubscriptionLogoCount != 1 || blockedBody.Details.PaymentMethodIconCount != 0 {
		t.Fatalf("unexpected referenced delete body: %#v", blockedBody)
	}

	read := serveTestRequest(t, app, http.MethodGet, "/api/app/assets/"+id, "", token)
	if read.Code != http.StatusOK {
		t.Fatalf("expected referenced asset to remain readable, got %d: %s", read.Code, read.Body.String())
	}
}

func TestAssetProductAPIDeleteBlocksPaymentMethodIconReferences(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "assets-payment-owner")

	upload := serveMultipartTestRequest(
		t,
		app,
		"/api/app/assets",
		token,
		map[string]string{"kind": "icon"},
		"file",
		"payment.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if upload.Code != http.StatusCreated {
		t.Fatalf("expected icon upload 201, got %d: %s", upload.Code, upload.Body.String())
	}
	var uploaded uploadAssetResponse
	if err := json.Unmarshal(upload.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	id := strings.TrimPrefix(uploaded.URL, "/api/app/assets/")
	createCalendarFeedTestCustomConfig(t, app, user.Id, func(config *customConfigPayload) {
		config.PaymentMethods = []customConfigItem{{
			ID:     "card",
			Value:  "card",
			Labels: customConfigLabels{ZhCN: "银行卡", EnUS: "Card"},
			Icon:   uploaded.URL,
		}}
	})

	blockedDelete := serveTestRequest(t, app, http.MethodDelete, "/api/app/assets/"+id, "", token)
	if blockedDelete.Code != http.StatusConflict {
		t.Fatalf("expected payment-method icon delete 409, got %d: %s", blockedDelete.Code, blockedDelete.Body.String())
	}
	var blockedBody struct {
		Code    string            `json:"code"`
		Details assetInUseDetails `json:"details"`
	}
	if err := json.Unmarshal(blockedDelete.Body.Bytes(), &blockedBody); err != nil {
		t.Fatal(err)
	}
	if blockedBody.Code != "ASSET_IN_USE" || blockedBody.Details.UsageCount != 1 || blockedBody.Details.SubscriptionLogoCount != 0 || blockedBody.Details.PaymentMethodIconCount != 1 {
		t.Fatalf("unexpected payment-method referenced delete body: %#v", blockedBody)
	}

	read := serveTestRequest(t, app, http.MethodGet, "/api/app/assets/"+id, "", token)
	if read.Code != http.StatusOK {
		t.Fatalf("expected referenced payment icon to remain readable, got %d: %s", read.Code, read.Body.String())
	}
}

func TestAssetProductAPIDeleteReportsMixedReferencesAndIgnoresForeignConfig(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "assets-mixed-owner")
	foreignUser, _ := createRouteTestUser(t, app, "assets-mixed-foreign")

	upload := serveMultipartTestRequest(
		t,
		app,
		"/api/app/assets",
		token,
		map[string]string{"kind": "logo"},
		"file",
		"mixed.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if upload.Code != http.StatusCreated {
		t.Fatalf("expected mixed asset upload 201, got %d: %s", upload.Code, upload.Body.String())
	}
	var uploaded uploadAssetResponse
	if err := json.Unmarshal(upload.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	id := strings.TrimPrefix(uploaded.URL, "/api/app/assets/")
	createRouteTestSubscription(t, app, user.Id, map[string]interface{}{"logo": uploaded.URL})
	createCalendarFeedTestCustomConfig(t, app, user.Id, func(config *customConfigPayload) {
		config.PaymentMethods = []customConfigItem{{
			ID:     "paypal",
			Value:  "paypal",
			Labels: customConfigLabels{ZhCN: "PayPal", EnUS: "PayPal"},
			Icon:   uploaded.URL,
		}}
	})
	createCalendarFeedTestCustomConfig(t, app, foreignUser.Id, func(config *customConfigPayload) {
		config.PaymentMethods = []customConfigItem{{
			ID:     "foreign_card",
			Value:  "foreign_card",
			Labels: customConfigLabels{ZhCN: "外部", EnUS: "Foreign"},
			Icon:   uploaded.URL,
		}}
	})

	blockedDelete := serveTestRequest(t, app, http.MethodDelete, "/api/app/assets/"+id, "", token)
	if blockedDelete.Code != http.StatusConflict {
		t.Fatalf("expected mixed referenced asset delete 409, got %d: %s", blockedDelete.Code, blockedDelete.Body.String())
	}
	var blockedBody struct {
		Code    string            `json:"code"`
		Details assetInUseDetails `json:"details"`
	}
	if err := json.Unmarshal(blockedDelete.Body.Bytes(), &blockedBody); err != nil {
		t.Fatal(err)
	}
	if blockedBody.Code != "ASSET_IN_USE" || blockedBody.Details.UsageCount != 2 || blockedBody.Details.SubscriptionLogoCount != 1 || blockedBody.Details.PaymentMethodIconCount != 1 {
		t.Fatalf("unexpected mixed referenced delete body: %#v", blockedBody)
	}
}

func TestAssetProductAPIDeleteIgnoresForeignCustomConfigReferences(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	owner, token := createRouteTestUser(t, app, "assets-foreign-config-owner")
	foreignUser, _ := createRouteTestUser(t, app, "assets-foreign-config-other")

	upload := serveMultipartTestRequest(
		t,
		app,
		"/api/app/assets",
		token,
		map[string]string{"kind": "icon"},
		"file",
		"unused-by-owner.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if upload.Code != http.StatusCreated {
		t.Fatalf("expected owner icon upload 201, got %d: %s", upload.Code, upload.Body.String())
	}
	var uploaded uploadAssetResponse
	if err := json.Unmarshal(upload.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	createCalendarFeedTestCustomConfig(t, app, foreignUser.Id, func(config *customConfigPayload) {
		config.PaymentMethods = []customConfigItem{{
			ID:     "foreign_card",
			Value:  "foreign_card",
			Labels: customConfigLabels{ZhCN: "外部", EnUS: "Foreign"},
			Icon:   uploaded.URL,
		}}
	})

	id := strings.TrimPrefix(uploaded.URL, "/api/app/assets/")
	del := serveTestRequest(t, app, http.MethodDelete, "/api/app/assets/"+id, "", token)
	if del.Code != http.StatusOK {
		t.Fatalf("expected foreign custom config reference to be ignored for owner %s, got %d: %s", owner.Id, del.Code, del.Body.String())
	}
}

func TestAssetProductAPIDeleteRemovesMetadataWhenFileIsMissing(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	_, token := createRouteTestUser(t, app, "assets-missing-file")

	upload := serveMultipartTestRequest(
		t,
		app,
		"/api/app/assets",
		token,
		map[string]string{"kind": "logo"},
		"file",
		"missing.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if upload.Code != http.StatusCreated {
		t.Fatalf("expected asset upload 201, got %d: %s", upload.Code, upload.Body.String())
	}
	var uploaded uploadAssetResponse
	if err := json.Unmarshal(upload.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	id := strings.TrimPrefix(uploaded.URL, "/api/app/assets/")
	record, err := app.FindRecordById("assets", id)
	if err != nil {
		t.Fatal(err)
	}
	filePath := filepath.Join(app.DataDir(), "storage", record.Collection().Id, record.Id, record.GetString("file"))
	if err := os.Remove(filePath); err != nil {
		t.Fatal(err)
	}

	del := serveTestRequest(t, app, http.MethodDelete, "/api/app/assets/"+id, "", token)
	if del.Code != http.StatusOK {
		t.Fatalf("expected missing-file asset delete 200, got %d: %s", del.Code, del.Body.String())
	}
	if _, err := app.FindRecordById("assets", id); err == nil {
		t.Fatalf("expected missing-file asset metadata to be deleted")
	}
}

func subscriptionCreateBody(name string) string {
	body := map[string]interface{}{
		"name":                         name,
		"logo":                         nil,
		"price":                        12,
		"currency":                     "USD",
		"billingCycle":                 "monthly",
		"customDays":                   nil,
		"customCycleUnit":              nil,
		"oneTimeTermCount":             nil,
		"oneTimeTermUnit":              nil,
		"category":                     "productivity",
		"status":                       "active",
		"pinned":                       false,
		"publicHidden":                 false,
		"paymentMethod":                nil,
		"startDate":                    "2026-01-01",
		"nextBillingDate":              "2026-02-01",
		"autoRenew":                    false,
		"autoCalculateNextBillingDate": true,
		"trialEndDate":                 nil,
		"website":                      nil,
		"notes":                        nil,
		"tags":                         []string{"api"},
		"reminderDays":                 3,
		"repeatReminderEnabled":        false,
		"repeatReminderInterval":       defaultRepeatReminderInterval,
		"repeatReminderWindow":         defaultRepeatReminderWindow,
		"extra":                        map[string]interface{}{},
	}
	data, _ := json.Marshal(body)
	return string(data)
}
