package main

// Route 测试保护自定义 API 的认证、严格 JSON、管理员防自锁、私有资产和跨运行面契约边界。
// 新增 route 时优先在这里证明 Go/PocketBase 行为与前端 Zod、Cloudflare Worker 契约一致。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func servePocketBaseTestRequest(t *testing.T, app core.App, method string, target string, body string, token string) *httptest.ResponseRecorder {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	registerRoutes(app, router)
	mux, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	req.Header.Set("content-type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func serveTestRequest(t *testing.T, app core.App, method string, target string, body string, token string) *httptest.ResponseRecorder {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	registerRoutes(app, router)
	mux, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	req.Header.Set("content-type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func serveMultipartTestRequest(t *testing.T, app core.App, target string, token string, fields map[string]string, fileField string, filename string, content string) *httptest.ResponseRecorder {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	registerRoutes(app, router)
	mux, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile(fileField, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("content-type", writer.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func createRouteTestUser(t *testing.T, app core.App, role string) (*core.Record, string) {
	t.Helper()
	user, err := createUser(app, "Admin", "admin-"+role+"@example.com", "password123", role)
	if err != nil {
		t.Fatal(err)
	}
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return user, token
}

func createRouteTestSubscription(t *testing.T, app core.App, userID string, overrides map[string]interface{}) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	record.Load(map[string]interface{}{
		"user":                         userID,
		"name":                         "Route Subscription",
		"price":                        12,
		"currency":                     "USD",
		"billingCycle":                 "monthly",
		"category":                     "productivity",
		"status":                       "active",
		"pinned":                       false,
		"publicHidden":                 false,
		"startDate":                    "2026-01-01",
		"nextBillingDate":              "2026-02-01",
		"autoRenew":                    true,
		"autoCalculateNextBillingDate": true,
		"tags":                         []string{},
		"extra":                        emptyJSONPayload{},
		"reminderDays":                 3,
		"repeatReminderEnabled":        false,
		"repeatReminderInterval":       defaultRepeatReminderInterval,
		"repeatReminderWindow":         defaultRepeatReminderWindow,
	})
	for key, value := range overrides {
		record.Set(key, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func createRouteTestSuperuser(t *testing.T, app core.App, email string, password string) *core.Record {
	t.Helper()
	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(superusers)
	superuser.SetEmail(email)
	superuser.SetPassword(password)
	if err := app.Save(superuser); err != nil {
		t.Fatal(err)
	}
	return superuser
}

func TestSubscriptionRenewRouteAdvancesManualSubscription(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "renew")
	record := createRouteTestSubscription(t, app, user.Id, map[string]interface{}{
		"name":            "Manual Renew",
		"status":          "expired",
		"nextBillingDate": "2026-01-01",
		"autoRenew":       false,
	})

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/subscriptions/"+record.Id+"/renew", "", token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected renew 200, got %d: %s", res.Code, res.Body.String())
	}
	var body map[string]map[string]interface{}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	subscription := body["subscription"]
	if subscription["status"] != "active" {
		t.Fatalf("expected expired manual subscription to become active, got %#v", subscription["status"])
	}
	if subscription["nextBillingDate"] == "2026-01-01" {
		t.Fatalf("expected nextBillingDate to advance, got %#v", subscription)
	}
	if subscription["autoRenew"] != false {
		t.Fatalf("expected manual renewal to keep autoRenew=false, got %#v", subscription["autoRenew"])
	}
	if _, ok := subscription["user"]; ok {
		t.Fatalf("renew response must not expose owner field: %#v", subscription)
	}
	reloaded, err := app.FindRecordById("subscriptions", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("status") != "active" || reloaded.GetString("nextBillingDate") == "2026-01-01" {
		t.Fatalf("expected record to be renewed, status=%s next=%s", reloaded.GetString("status"), reloaded.GetString("nextBillingDate"))
	}
}

func TestSubscriptionRenewRouteRejectsDisallowedSubscriptions(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "renew-reject")
	otherUser, _ := createRouteTestUser(t, app, "renew-other")

	paused := createRouteTestSubscription(t, app, user.Id, map[string]interface{}{
		"name":      "Paused Manual",
		"status":    "paused",
		"autoRenew": false,
	})
	automatic := createRouteTestSubscription(t, app, user.Id, map[string]interface{}{
		"name":      "Automatic",
		"autoRenew": true,
	})
	oneTime := createRouteTestSubscription(t, app, user.Id, map[string]interface{}{
		"name":         "One Time",
		"billingCycle": "one-time",
		"autoRenew":    false,
	})
	foreign := createRouteTestSubscription(t, app, otherUser.Id, map[string]interface{}{
		"name":      "Foreign",
		"autoRenew": false,
	})

	for _, record := range []*core.Record{paused, automatic, oneTime} {
		res := serveTestRequest(t, app, http.MethodPost, "/api/app/subscriptions/"+record.Id+"/renew", `{}`, token)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("expected disallowed subscription %s to return 400, got %d: %s", record.GetString("name"), res.Code, res.Body.String())
		}
	}
	foreignRes := serveTestRequest(t, app, http.MethodPost, "/api/app/subscriptions/"+foreign.Id+"/renew", `{}`, token)
	if foreignRes.Code != http.StatusNotFound {
		t.Fatalf("expected foreign subscription to return 404, got %d: %s", foreignRes.Code, foreignRes.Body.String())
	}
}

func TestPocketBaseInstallerIsDisabled(t *testing.T) {
	event := &core.ServeEvent{
		InstallerFunc: func(core.App, *core.Record, string) error {
			t.Fatal("PocketBase installer should not run for Renewlet")
			return nil
		},
	}

	disablePocketBaseInstaller(event)

	if event.InstallerFunc != nil {
		t.Fatal("expected PocketBase installer to be disabled")
	}
}

func TestSetupRouteHonorsSetupEnabledAndCreatedStatus(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	t.Setenv("SETUP_ENABLED", "false")
	res := serveTestRequest(t, app, http.MethodGet, "/api/app/setup", "", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"setupEnabled":false`) {
		t.Fatalf("unexpected setup status response %d: %s", res.Code, res.Body.String())
	}

	res = serveTestRequest(t, app, http.MethodPost, "/api/app/setup", `{"name":"Admin","email":"admin@example.com","password":"password123"}`, "")
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected disabled setup to be forbidden, got %d: %s", res.Code, res.Body.String())
	}

	t.Setenv("SETUP_ENABLED", "true")
	res = serveTestRequest(t, app, http.MethodPost, "/api/app/setup", `{"name":"Admin","email":"admin@example.com","password":"password123"}`, "")
	if res.Code != http.StatusCreated {
		t.Fatalf("expected setup create status 201, got %d: %s", res.Code, res.Body.String())
	}

	admin, err := app.FindAuthRecordByEmail("users", "admin@example.com")
	if err != nil {
		t.Fatalf("expected setup admin user: %v", err)
	}
	if admin.GetString("role") != "admin" {
		t.Fatalf("expected setup user role admin, got %q", admin.GetString("role"))
	}
	superuser, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, "admin@example.com")
	if err != nil {
		t.Fatalf("expected setup superuser: %v", err)
	}
	if !superuser.ValidatePassword("password123") {
		t.Fatal("expected setup superuser password to match setup password")
	}
}

func TestSetupRouteDoesNotOverwriteExistingSuperuser(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	createRouteTestSuperuser(t, app, "pb-admin@example.com", "oldpassword123")

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/setup", `{"name":"Admin","email":"admin@example.com","password":"password123"}`, "")
	if res.Code != http.StatusCreated {
		t.Fatalf("expected setup create status 201, got %d: %s", res.Code, res.Body.String())
	}

	existing, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, "pb-admin@example.com")
	if err != nil {
		t.Fatalf("expected existing superuser: %v", err)
	}
	if !existing.ValidatePassword("oldpassword123") {
		t.Fatal("expected existing superuser password to remain unchanged")
	}
	if _, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, "admin@example.com"); err == nil {
		t.Fatal("expected setup to skip creating a second superuser when one already exists")
	}
	if _, err := app.FindAuthRecordByEmail("users", "admin@example.com"); err != nil {
		t.Fatalf("expected setup admin user to still be created: %v", err)
	}
}

func TestAssetsCollectionCreateAcceptsSvgUpload(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "authenticated")

	res := serveMultipartTestRequest(
		t,
		app,
		"/api/collections/assets/records",
		token,
		map[string]string{
			"user": user.Id,
			"kind": "logo",
		},
		"file",
		"logo.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)

	if res.Code != http.StatusOK {
		t.Fatalf("expected SVG asset create 200, got %d: %s", res.Code, res.Body.String())
	}
	var body struct {
		MimeType string `json:"mimeType"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.MimeType != "image/svg+xml" {
		t.Fatalf("mimeType = %q, want image/svg+xml", body.MimeType)
	}
}

func TestAssetsCollectionCreateAcceptsIcoUpload(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "authenticated")

	res := serveMultipartTestRequest(
		t,
		app,
		"/api/collections/assets/records",
		token,
		map[string]string{
			"user": user.Id,
			"kind": "logo",
		},
		"file",
		"logo.ico",
		"\x00\x00\x01\x00\x01\x00\x10\x10\x00\x00",
	)

	if res.Code != http.StatusOK {
		t.Fatalf("expected ICO asset create 200, got %d: %s", res.Code, res.Body.String())
	}
	var body struct {
		MimeType string `json:"mimeType"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.MimeType != "image/x-icon" {
		t.Fatalf("mimeType = %q, want image/x-icon", body.MimeType)
	}
}

func TestSubscriptionsCollectionCreateAcceptsPrivateAssetLogoPath(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "authenticated")

	uploadRes := serveMultipartTestRequest(
		t,
		app,
		"/api/collections/assets/records",
		token,
		map[string]string{
			"user": user.Id,
			"kind": "logo",
		},
		"file",
		"logo.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if uploadRes.Code != http.StatusOK {
		t.Fatalf("expected SVG asset create 200, got %d: %s", uploadRes.Code, uploadRes.Body.String())
	}
	var uploadBody struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(uploadRes.Body.Bytes(), &uploadBody); err != nil {
		t.Fatal(err)
	}
	if uploadBody.ID == "" {
		t.Fatalf("expected uploaded asset id: %s", uploadRes.Body.String())
	}

	logoPath := "/api/app/assets/" + uploadBody.ID
	createRes := serveTestRequest(
		t,
		app,
		http.MethodPost,
		"/api/collections/subscriptions/records",
		fmt.Sprintf(`{
			"user":%q,
			"name":"test",
			"logo":%q,
			"price":0,
			"currency":"CNY",
			"billingCycle":"monthly",
			"customDays":null,
			"category":"productivity",
			"status":"active",
			"paymentMethod":null,
			"startDate":"2026-05-15",
			"nextBillingDate":"2026-06-15",
			"autoCalculateNextBillingDate":true,
			"trialEndDate":null,
			"website":null,
			"notes":null,
			"tags":[],
			"reminderDays":3
		}`, user.Id, logoPath),
		token,
	)
	if createRes.Code != http.StatusOK {
		t.Fatalf("expected subscription create 200, got %d: %s", createRes.Code, createRes.Body.String())
	}
	var createBody struct {
		Logo string `json:"logo"`
	}
	if err := json.Unmarshal(createRes.Body.Bytes(), &createBody); err != nil {
		t.Fatal(err)
	}
	if createBody.Logo != logoPath {
		t.Fatalf("subscription logo = %q, want %q", createBody.Logo, logoPath)
	}
}

func TestSubscriptionsCollectionCreateValidatesLogoURLContract(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	user, token := createRouteTestUser(t, app, "logo-url")

	createBody := func(logo string) string {
		return fmt.Sprintf(`{
			"user":%q,
			"name":"logo-url-test",
			"logo":%q,
			"price":0,
			"currency":"CNY",
			"billingCycle":"monthly",
			"customDays":null,
			"category":"productivity",
			"status":"active",
			"paymentMethod":null,
			"startDate":"2026-05-15",
			"nextBillingDate":"2026-06-15",
			"autoCalculateNextBillingDate":true,
			"trialEndDate":null,
			"website":null,
			"notes":null,
			"tags":[],
			"reminderDays":3
		}`, user.Id, logo)
	}

	for _, logo := range []string{"https://example.com/logo.png", "http://example.com/logo.png"} {
		res := serveTestRequest(t, app, http.MethodPost, "/api/collections/subscriptions/records", createBody(logo), token)
		if res.Code != http.StatusOK {
			t.Fatalf("expected logo %q to be accepted, got %d: %s", logo, res.Code, res.Body.String())
		}
	}
	for _, logo := range []string{"data:image/png;base64,aGVsbG8=", "https://user:pass@example.com/logo.png"} {
		res := serveTestRequest(t, app, http.MethodPost, "/api/collections/subscriptions/records", createBody(logo), token)
		if res.Code == http.StatusOK {
			t.Fatalf("expected logo %q to be rejected, got %d: %s", logo, res.Code, res.Body.String())
		}
	}
}

func TestSetupRouteRejectsStrictJSONViolations(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		body string
	}{
		{
			name: "unknown field",
			body: `{"name":"Admin","email":"admin@example.com","password":"password123","extra":true}`,
		},
		{
			name: "multiple json values",
			body: `{"name":"Admin","email":"admin@example.com","password":"password123"} {}`,
		},
		{
			name: "empty body",
			body: ``,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := serveTestRequest(t, app, http.MethodPost, "/api/app/setup", tc.body, "")
			if res.Code != http.StatusBadRequest {
				t.Fatalf("expected setup strict JSON violation to return 400, got %d: %s", res.Code, res.Body.String())
			}
		})
	}
}

func TestSetupRouteIgnoresPocketBaseInstallerSuperuser(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	createRouteTestSuperuser(t, app, core.DefaultInstallerEmail, "installerpassword123")

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/setup", `{"name":"Admin","email":"admin@example.com","password":"password123"}`, "")
	if res.Code != http.StatusCreated {
		t.Fatalf("expected setup create status 201, got %d: %s", res.Code, res.Body.String())
	}

	superuser, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, "admin@example.com")
	if err != nil {
		t.Fatalf("expected real setup superuser: %v", err)
	}
	if !superuser.ValidatePassword("password123") {
		t.Fatal("expected real setup superuser password to match setup password")
	}
}

func TestAdminUsersRouteReturnsManagementContract(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, token := createRouteTestUser(t, app, "admin")

	res := serveTestRequest(t, app, http.MethodGet, "/api/app/admin/users", "", token)
	body := res.Body.String()
	if res.Code != http.StatusOK {
		t.Fatalf("expected users 200, got %d: %s", res.Code, body)
	}
	for _, expected := range []string{`"users"`, `"role":"admin"`, `"createdAt"`, `"updatedAt"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("missing %s in response: %s", expected, body)
		}
	}
}

func TestSystemRestartRouteRequiresAdmin(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, userToken := createRouteTestUser(t, app, "user")

	cases := []struct {
		name     string
		token    string
		wantCode int
	}{
		{name: "anonymous", token: "", wantCode: http.StatusUnauthorized},
		{name: "non admin", token: userToken, wantCode: http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := serveTestRequest(t, app, http.MethodPost, "/api/app/admin/system/restart", `{}`, tc.token)
			if res.Code != tc.wantCode {
				t.Fatalf("expected restart auth status %d, got %d: %s", tc.wantCode, res.Code, res.Body.String())
			}
		})
	}
}

func TestAdminPatchUserRejectsStrictJSONViolations(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, token := createRouteTestUser(t, app, "admin")
	editable, _ := createRouteTestUser(t, app, "user")

	cases := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"banned":false,"extra":true}`},
		{name: "empty object", body: `{}`},
		{name: "invalid role", body: `{"role":"owner"}`},
		{name: "short password", body: `{"newPassword":"short"}`},
		{name: "multiple json values", body: `{"banned":false} {}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := serveTestRequest(t, app, http.MethodPatch, "/api/app/admin/users/"+editable.Id, tc.body, token)
			if res.Code != http.StatusBadRequest {
				t.Fatalf("expected admin patch strict JSON violation to return 400, got %d: %s", res.Code, res.Body.String())
			}
		})
	}
}

func TestAdminPatchUserPasswordResetBoundary(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	admin, token := createRouteTestUser(t, app, "admin")
	editable, _ := createRouteTestUser(t, app, "user")

	res := serveTestRequest(t, app, http.MethodPatch, "/api/app/admin/users/"+editable.Id, `{"newPassword":"newpassword123"}`, token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected admin to reset another user's password, got %d: %s", res.Code, res.Body.String())
	}
	reloadedEditable, err := app.FindRecordById("users", editable.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !reloadedEditable.ValidatePassword("newpassword123") {
		t.Fatal("expected admin patch to update another user's password")
	}

	res = serveTestRequest(t, app, http.MethodPatch, "/api/app/admin/users/"+admin.Id, `{"newPassword":"selfpassword123"}`, token)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected self password reset through admin patch to return 400, got %d: %s", res.Code, res.Body.String())
	}
	reloadedAdmin, err := app.FindRecordById("users", admin.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !reloadedAdmin.ValidatePassword("password123") {
		t.Fatal("expected rejected self reset to keep the old password")
	}
	if reloadedAdmin.ValidatePassword("selfpassword123") {
		t.Fatal("expected rejected self reset not to store the new password")
	}
}

func TestAccountPasswordRouteRequiresCurrentPassword(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	user, token := createRouteTestUser(t, app, "user")

	res := serveTestRequest(t, app, http.MethodPut, "/api/app/account/password", `{"currentPassword":"wrongpassword","newPassword":"newpassword123"}`, token)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected wrong current password to return 400, got %d: %s", res.Code, res.Body.String())
	}
	reloadedUser, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !reloadedUser.ValidatePassword("password123") {
		t.Fatal("expected wrong current password to keep the old password")
	}
}

func TestBannedUserCannotRefreshOrUseExistingPocketBaseToken(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	user, token := createRouteTestUser(t, app, "user")
	subscriptions, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	subscription := core.NewRecord(subscriptions)
	subscription.Set("user", user.Id)
	subscription.Set("name", "Banned token test")
	subscription.Set("price", 12)
	subscription.Set("currency", "USD")
	subscription.Set("billingCycle", "monthly")
	subscription.Set("category", "Software")
	subscription.Set("status", "active")
	subscription.Set("startDate", "2026-06-04")
	subscription.Set("nextBillingDate", "2026-07-04")
	if err := app.Save(subscription); err != nil {
		t.Fatal(err)
	}
	user.Set("banned", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}

	refreshRes := servePocketBaseTestRequest(t, app, http.MethodPost, "/api/collections/users/auth-refresh", `{}`, token)
	if refreshRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected banned auth refresh to return 401, got %d: %s", refreshRes.Code, refreshRes.Body.String())
	}

	listRes := servePocketBaseTestRequest(t, app, http.MethodGet, "/api/collections/subscriptions/records", "", token)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected banned collection list to preserve PocketBase list status, got %d: %s", listRes.Code, listRes.Body.String())
	}
	if strings.Contains(listRes.Body.String(), subscription.Id) {
		t.Fatalf("expected banned collection list not to return private record, got %s", listRes.Body.String())
	}
}

func TestDeletedUserTokenCannotUseCustomAuthenticatedRoutes(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	user, token := createRouteTestUser(t, app, "user")
	if err := app.Delete(user); err != nil {
		t.Fatal(err)
	}

	res := serveTestRequest(t, app, http.MethodGet, "/api/app/notifications/history?status=all&limit=5", "", token)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected deleted user token to return 401, got %d: %s", res.Code, res.Body.String())
	}
}

func TestNotificationHistoryRouteSortsByCreatedField(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, token := createRouteTestUser(t, app, "user")

	res := serveTestRequest(t, app, http.MethodGet, "/api/app/notifications/history?status=all&limit=5", "", token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected notification history 200, got %d: %s", res.Code, res.Body.String())
	}
}
