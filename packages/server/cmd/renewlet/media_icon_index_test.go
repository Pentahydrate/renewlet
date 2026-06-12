package main

// 图标索引 route 测试保护管理员边界、空 body 契约、失败不切 active，以及媒体候选切换 runtime resolver。

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMediaIconIndexStatusRequiresAdmin(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, userToken := createRouteTestUser(t, app, "user")
	_, adminToken := createRouteTestUser(t, app, "admin")

	cases := []struct {
		name     string
		token    string
		wantCode int
	}{
		{name: "anonymous", token: "", wantCode: http.StatusUnauthorized},
		{name: "non admin", token: userToken, wantCode: http.StatusForbidden},
		{name: "admin", token: adminToken, wantCode: http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := serveTestRequest(t, app, http.MethodGet, "/api/app/admin/media/icon-index", "", tc.token)
			if res.Code != tc.wantCode {
				t.Fatalf("expected status %d, got %d: %s", tc.wantCode, res.Code, res.Body.String())
			}
		})
	}
}

func TestMediaIconIndexRefreshUsesStrictEmptyBody(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, adminToken := createRouteTestUser(t, app, "admin")

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/admin/media/icon-index/providers/thesvg/refresh", `{}`, adminToken)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected refresh with JSON body to return 400, got %d: %s", res.Code, res.Body.String())
	}
}

func TestMediaIconIndexStatusUsesSeedProviderVersions(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, adminToken := createRouteTestUser(t, app, "admin")

	res := serveTestRequest(t, app, http.MethodGet, "/api/app/admin/media/icon-index", "", adminToken)
	if res.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", res.Code, res.Body.String())
	}
	var status builtInIconIndexStatusResponse
	if err := json.NewDecoder(res.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	assertSeedProviderVersions(t, status, nil)
}

func TestMediaIconIndexCheckProviderDoesNotSwitchActive(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, adminToken := createRouteTestUser(t, app, "admin")

	server := newMediaIconRegistryServer(t, http.StatusOK)
	withBuiltInIconGitHubAPIBase(t, server.URL)
	res := serveTestRequest(t, app, http.MethodPost, "/api/app/admin/media/icon-index/providers/thesvg/check", "", adminToken)
	if res.Code != http.StatusOK {
		t.Fatalf("expected check success 200, got %d: %s", res.Code, res.Body.String())
	}
	var response builtInIconIndexProviderCheckResponse
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Status.Source != "embedded" || response.Status.Refreshing || response.Provider.Refreshing || response.Provider.Latest == nil || response.Provider.Latest.CommitSHA == nil {
		t.Fatalf("unexpected check status: %#v", response.Status)
	}
	record, err := findMediaIconIndexRecord(app)
	if err != nil {
		t.Fatal(err)
	}
	if record == nil || record.GetString("hash") != "" || record.GetString("indexGzipBase64") != "" {
		t.Fatalf("expected check to keep active index empty, got %#v", record)
	}
}

func TestMediaIconIndexCheckProviderRecordsGitHubRateLimitWithoutSwitchingActive(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, adminToken := createRouteTestUser(t, app, "admin")
	t.Setenv("RENEWLET_GITHUB_TOKEN", "github-token")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", "1781190000")
		http.Error(w, "rate limited github-token", http.StatusForbidden)
	}))
	defer server.Close()
	withBuiltInIconGitHubAPIBase(t, server.URL)

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/admin/media/icon-index/providers/selfhst/check", "", adminToken)
	if res.Code != http.StatusOK {
		t.Fatalf("expected rate limited check to keep a usable 200 response, got %d: %s", res.Code, res.Body.String())
	}
	var response builtInIconIndexProviderCheckResponse
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Provider.LastError == nil || !strings.Contains(*response.Provider.LastError, "RENEWLET_GITHUB_TOKEN") {
		t.Fatalf("expected rate limit guidance in lastError, got %#v", response.Provider.LastError)
	}
	if response.ErrorDetails == nil || response.ErrorDetails.RawResponseText == nil {
		t.Fatalf("expected one-shot upstream details, got %#v", response.ErrorDetails)
	}
	if !strings.Contains(*response.ErrorDetails.RawResponseText, "rate limited [redacted]") {
		t.Fatalf("expected redacted upstream body, got %#v", response.ErrorDetails.RawResponseText)
	}
	if payload, _ := json.Marshal(response.ErrorDetails); strings.Contains(string(payload), "github-token") {
		t.Fatalf("errorDetails leaked GitHub token: %s", payload)
	}
	record, err := findMediaIconIndexRecord(app)
	if err != nil {
		t.Fatal(err)
	}
	if record == nil || record.GetString("hash") != "" || record.GetString("indexGzipBase64") != "" {
		t.Fatalf("expected failed check to keep active index empty, got %#v", record)
	}
	providerStatusPayload, _ := json.Marshal(record.Get("providerStatus"))
	if strings.Contains(string(providerStatusPayload), "github-token") || strings.Contains(string(providerStatusPayload), "rate limited github-token") {
		t.Fatalf("provider status persisted raw upstream details: %s", providerStatusPayload)
	}
}

func TestMediaIconIndexGitHubRequestUsesTokenAndUserAgent(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, adminToken := createRouteTestUser(t, app, "admin")
	t.Setenv("RENEWLET_GITHUB_TOKEN", "github-token")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer github-token" {
			t.Fatalf("expected GitHub token authorization header, got %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("User-Agent") == "" {
			t.Fatal("expected GitHub request user agent")
		}
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/repos/selfhst/icons/commits/main":
			_, _ = w.Write([]byte(`{"sha":"abc1234567890abcdef","commit":{"committer":{"date":"2026-06-11T00:00:00Z"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	withBuiltInIconGitHubAPIBase(t, server.URL)

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/admin/media/icon-index/providers/selfhst/check", "", adminToken)
	if res.Code != http.StatusOK {
		t.Fatalf("expected check success 200, got %d: %s", res.Code, res.Body.String())
	}
}

func TestMediaIconIndexRefreshSuccessAndFailureKeepsPreviousRuntimeIndex(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, adminToken := createRouteTestUser(t, app, "admin")

	successServer := newMediaIconRegistryServer(t, http.StatusOK)
	withMediaResolverProviderBase(t, successServer.URL)
	withBuiltInIconGitHubAPIBase(t, successServer.URL)
	res := serveTestRequest(t, app, http.MethodPost, "/api/app/admin/media/icon-index/providers/thesvg/refresh", "", adminToken)
	if res.Code != http.StatusOK {
		t.Fatalf("expected refresh success 200, got %d: %s", res.Code, res.Body.String())
	}
	var success builtInIconIndexProviderRefreshResponse
	if err := json.NewDecoder(res.Body).Decode(&success); err != nil {
		t.Fatal(err)
	}
	if success.Status.Source != "runtime" || success.Status.Refreshing || success.Provider.Refreshing || success.Status.ProviderCounts.TheSVG != 1 || success.Status.Hash == nil || success.Provider.Current == nil || success.Provider.Current.CommitSHA == nil {
		t.Fatalf("unexpected success status: %#v", success.Status)
	}
	assertSeedProviderVersions(t, success.Status, map[string]bool{"thesvg": true})
	activeHash := *success.Status.Hash

	failingServer := newMediaIconRegistryServer(t, http.StatusInternalServerError)
	withMediaResolverProviderBase(t, failingServer.URL)
	withBuiltInIconGitHubAPIBase(t, failingServer.URL)
	res = serveTestRequest(t, app, http.MethodPost, "/api/app/admin/media/icon-index/providers/thesvg/refresh", "", adminToken)
	if res.Code != http.StatusBadGateway {
		t.Fatalf("expected refresh failure 502, got %d: %s", res.Code, res.Body.String())
	}
	var failure builtInIconIndexProviderRefreshResponse
	if err := json.NewDecoder(res.Body).Decode(&failure); err != nil {
		t.Fatal(err)
	}
	if failure.Status.Source != "runtime" || failure.Status.Refreshing || failure.Provider.Refreshing || failure.Status.Hash == nil || *failure.Status.Hash != activeHash {
		t.Fatalf("expected failure to keep old active hash %q, got %#v", activeHash, failure.Status)
	}
	if failure.Provider.LastError == nil || *failure.Provider.LastError == "" {
		t.Fatalf("expected failure status to expose last error, got %#v", failure.Status)
	}
	if failure.ErrorDetails == nil || failure.ErrorDetails.RawResponseText == nil {
		t.Fatalf("expected current response to include upstream details, got %#v", failure.ErrorDetails)
	}
	if !strings.Contains(*failure.ErrorDetails.RawResponseText, "registry failed") {
		t.Fatalf("expected upstream body in refresh failure details, got %#v", failure.ErrorDetails.RawResponseText)
	}
	if failure.Provider.Current == nil || failure.Provider.Current.CommitSHA == nil || *failure.Provider.Current.CommitSHA != *success.Provider.Current.CommitSHA {
		t.Fatalf("expected failed refresh to keep previous current version, got %#v", failure.Provider.Current)
	}
}

func TestMediaIconIndexRefreshReportsConcurrentLock(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, adminToken := createRouteTestUser(t, app, "admin")

	builtInIconIndexRefreshMu.Lock()
	defer builtInIconIndexRefreshMu.Unlock()

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/admin/media/icon-index/providers/thesvg/refresh", "", adminToken)
	if res.Code != http.StatusConflict {
		t.Fatalf("expected locked refresh 409, got %d: %s", res.Code, res.Body.String())
	}
	var response builtInIconIndexProviderRefreshResponse
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if !response.Status.Refreshing || !response.Provider.Refreshing {
		t.Fatalf("expected locked status to report refreshing: %#v", response.Status)
	}
}

func TestMediaCandidatesUseRuntimeIconIndex(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	_, token := createRouteTestUser(t, app, "user")

	icons := []builtInIcon{iconRecord(builtInIcon{
		Provider: "thesvg",
		Slug:     "runtime-only",
		Title:    "Runtime Only",
		Variants: []builtInIconVariant{{Name: "default", Path: "/public/icons/runtime-only/default.svg"}},
	})}
	hash, gzipBase64, err := encodeBuiltInIconIndex(icons)
	if err != nil {
		t.Fatal(err)
	}
	commit := "abc1234567890abcdef"
	short := "abc1234"
	version := &builtInIconProviderVersionResponse{
		SourceRef:          commit,
		DisplayVersion:     short,
		CommitSHA:          &commit,
		CommitShortSHA:     &short,
		CommitDate:         nil,
		ReleaseTag:         nil,
		ReleasePublishedAt: nil,
	}
	if err := saveMediaIconProviderRefreshSuccess(app, "thesvg", "2026-06-11T00:00:00Z", hash, gzipBase64, icons, version, ""); err != nil {
		t.Fatal(err)
	}

	res := serveTestRequest(t, app, http.MethodPost, "/api/app/media/candidates", `{"kind":"logo","mode":"search","items":[{"id":"runtime","name":"Runtime Only"}],"limit":4}`, token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected media candidates 200, got %d: %s", res.Code, res.Body.String())
	}
	var response mediaCandidateResolveResponse
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != 1 || len(response.Items[0].Candidates.BuiltIn) == 0 {
		t.Fatalf("expected runtime built-in candidate, got %#v", response)
	}
	candidate := response.Items[0].Candidates.BuiltIn[0]
	if candidate.Label != "Runtime Only" || candidate.Provider != "thesvg" || candidate.MatchedQuery != "runtime only" {
		t.Fatalf("unexpected runtime candidate: %#v", candidate)
	}
}

func assertSeedProviderVersions(t *testing.T, status builtInIconIndexStatusResponse, skip map[string]bool) {
	t.Helper()
	for _, provider := range status.Providers {
		if skip != nil && skip[provider.Provider] {
			continue
		}
		if provider.Current == nil || provider.Current.CommitSHA == nil || provider.Current.CommitShortSHA == nil || provider.Current.CommitDate == nil {
			t.Fatalf("expected %s to expose seed commit metadata, got %#v", provider.Provider, provider.Current)
		}
		if provider.Current.SourceRef == "embedded" || provider.Current.SourceRef == "runtime" {
			t.Fatalf("expected %s current version to use a real commit sourceRef, got %#v", provider.Provider, provider.Current)
		}
		if len(*provider.Current.CommitShortSHA) != 7 {
			t.Fatalf("expected %s short sha length 7, got %q", provider.Provider, *provider.Current.CommitShortSHA)
		}
	}
}

func newMediaIconRegistryServer(t *testing.T, statusCode int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if statusCode != http.StatusOK {
			http.Error(w, "registry failed", statusCode)
			return
		}
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/repos/glincker/thesvg/commits/main", "/repos/selfhst/icons/commits/main", "/repos/homarr-labs/dashboard-icons/commits/main":
			_, _ = w.Write([]byte(`{"sha":"abc1234567890abcdef","commit":{"committer":{"date":"2026-06-11T00:00:00Z"}}}`))
		case "/repos/glincker/thesvg/releases/latest":
			_, _ = w.Write([]byte(`{"tag_name":"thesvg@9.9.9","published_at":"2026-06-11T00:00:00Z"}`))
		case "/src/data/icons.json":
			_, _ = w.Write([]byte(`[{"slug":"go-registry","title":"Go Registry","variants":{"default":"/icons/go-registry/default.svg"}}]`))
		case "/index.json":
			_, _ = w.Write([]byte(`[{"Reference":"go-selfhst","Name":"Go selfh.st","SVG":"Yes","Light":"N","Dark":"N"}]`))
		case "/metadata.json":
			_, _ = w.Write([]byte(`{"go-dashboard":{"aliases":["Go Dashboard"],"categories":["Test"]}}`))
		case "/tree.json":
			_, _ = w.Write([]byte(`{"svg":["go-dashboard.svg"]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func withMediaResolverProviderBase(t *testing.T, base string) {
	t.Helper()
	previous := mediaResolverCfg.BuiltInProviders
	next := make([]struct {
		Provider string `json:"provider"`
		CDNBase  string `json:"cdnBase"`
		GitHub   struct {
			Owner         string `json:"owner"`
			Repo          string `json:"repo"`
			Branch        string `json:"branch"`
			LatestRelease bool   `json:"latestRelease"`
		} `json:"github"`
		PreferredVariants []string `json:"preferredVariants"`
	}, len(previous))
	copy(next, previous)
	for index := range next {
		next[index].CDNBase = base
	}
	mediaResolverCfg.BuiltInProviders = next
	t.Cleanup(func() {
		mediaResolverCfg.BuiltInProviders = previous
	})
}

func withBuiltInIconGitHubAPIBase(t *testing.T, base string) {
	t.Helper()
	previous := builtInIconGitHubAPIBase
	builtInIconGitHubAPIBase = base
	t.Cleanup(func() {
		builtInIconGitHubAPIBase = previous
	})
}
