package main

// 本文件测试 Docker 页面内自更新：Release 选择、checksum、路径穿越防护、并发锁和 restart pending 状态流。

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeSystemReleaseClient struct {
	release     *githubRelease
	releases    [][]githubRelease
	fetchDelay  time.Duration
	fetchCount  int32
	latestCount int32
	listCount   int32
	downloadFn  func(targetPath string) error
	checksumTxt []byte
}

func (client *fakeSystemReleaseClient) FetchLatestRelease(ctx context.Context) (*githubRelease, error) {
	atomic.AddInt32(&client.fetchCount, 1)
	atomic.AddInt32(&client.latestCount, 1)
	if client.fetchDelay > 0 {
		select {
		case <-time.After(client.fetchDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if client.release == nil {
		return nil, errors.New("missing release")
	}
	return client.release, nil
}

func (client *fakeSystemReleaseClient) FetchReleases(ctx context.Context, page int, _ int) ([]githubRelease, error) {
	atomic.AddInt32(&client.fetchCount, 1)
	atomic.AddInt32(&client.listCount, 1)
	if client.fetchDelay > 0 {
		select {
		case <-time.After(client.fetchDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if page <= 0 || page > len(client.releases) {
		return []githubRelease{}, nil
	}
	return client.releases[page-1], nil
}

func (client *fakeSystemReleaseClient) DownloadFile(_ context.Context, _ string, targetPath string, _ int64) error {
	if client.downloadFn != nil {
		return client.downloadFn(targetPath)
	}
	return errors.New("download not configured")
}

func (client *fakeSystemReleaseClient) FetchText(_ context.Context, _ string, _ int64) ([]byte, error) {
	return client.checksumTxt, nil
}

func TestSystemVersionComparison(t *testing.T) {
	cases := []struct {
		name    string
		current string
		latest  string
		want    bool
	}{
		{name: "patch update", current: "0.1.0", latest: "0.1.1", want: true},
		{name: "minor update", current: "0.1.9", latest: "0.2.0", want: true},
		{name: "equal stable", current: "0.1.0", latest: "0.1.0", want: false},
		{name: "ignore latest prerelease", current: "0.1.0", latest: "0.2.0-rc.1", want: false},
		{name: "stable channel ignores current prerelease", current: "0.2.0-rc.1", latest: "0.2.0", want: false},
		{name: "invalid current is not updateable", current: "dev", latest: "0.2.0", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNewerSystemVersion(tc.current, tc.latest); got != tc.want {
				t.Fatalf("isNewerSystemVersion(%q, %q) = %v, want %v", tc.current, tc.latest, got, tc.want)
			}
		})
	}
}

func TestSystemRCVersionComparison(t *testing.T) {
	cases := []struct {
		name    string
		current string
		latest  string
		want    bool
	}{
		{name: "same base rc increment", current: "0.1.0-rc.1", latest: "0.1.0-rc.2", want: true},
		{name: "cross base rc increment", current: "0.1.0-rc.1", latest: "0.2.0-rc.1", want: true},
		{name: "older rc rejected", current: "0.1.0-rc.2", latest: "0.1.0-rc.1", want: false},
		{name: "stable target rejected", current: "0.1.0-rc.1", latest: "0.1.0", want: false},
		{name: "stable current rejected", current: "0.1.0", latest: "0.2.0-rc.1", want: false},
		{name: "invalid rc suffix rejected", current: "0.1.0-rc.1", latest: "0.2.0-beta.1", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNewerSystemRCVersion(tc.current, tc.latest); got != tc.want {
				t.Fatalf("isNewerSystemRCVersion(%q, %q) = %v, want %v", tc.current, tc.latest, got, tc.want)
			}
		})
	}
}

func TestSelectSystemUpdateAssets(t *testing.T) {
	archiveName := systemArchiveName("1.2.3")
	archive, checksum, err := selectSystemUpdateAssets([]githubAsset{
		{Name: archiveName, BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v1.2.3/" + archiveName},
		{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v1.2.3/checksums.txt"},
	}, "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Name != archiveName || checksum.Name != "checksums.txt" {
		t.Fatalf("unexpected assets: %#v %#v", archive, checksum)
	}
}

func TestGitHubReleaseRequestUsesVersionedAPIHeadersAndOptionalToken(t *testing.T) {
	t.Setenv(systemUpdateGitHubTokenEnv, "ghp_test")
	var captured *http.Request
	client := &httpSystemReleaseClient{
		apiClient: &http.Client{
			Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				captured = request
				return &http.Response{
					StatusCode: http.StatusOK,
					Status:     "200 OK",
					Header:     make(http.Header),
					Body: io.NopCloser(strings.NewReader(`{
						"tag_name":"v1.2.3",
						"name":"Renewlet 1.2.3",
						"body":"",
						"published_at":"2026-05-27T00:00:00Z",
						"html_url":"https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.2.3",
						"prerelease":false,
						"draft":false,
						"assets":[]
					}`)),
				}, nil
			}),
		},
	}
	if _, err := client.FetchLatestRelease(context.Background()); err != nil {
		t.Fatal(err)
	}
	if captured == nil {
		t.Fatal("expected request to be captured")
	}
	if got := captured.Header.Get("Accept"); got != "application/vnd.github+json" {
		t.Fatalf("Accept = %q", got)
	}
	if got := captured.Header.Get("X-GitHub-Api-Version"); got != systemUpdateGitHubAPIVersion {
		t.Fatalf("X-GitHub-Api-Version = %q", got)
	}
	if got := captured.Header.Get("User-Agent"); got == "" || !strings.HasPrefix(got, "Renewlet/") {
		t.Fatalf("User-Agent = %q", got)
	}
	if got := captured.Header.Get("Authorization"); got != "Bearer ghp_test" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestSystemVersionWarningDoesNotExposeGitHubStatus(t *testing.T) {
	service := newSystemUpdateService(&fakeSystemReleaseClient{})
	service.now = func() time.Time { return time.Unix(1_779_820_800, 0) }
	warning := service.versionCheckWarning(localeZhCN, &githubAPIError{
		statusCode:  http.StatusForbidden,
		status:      "403 Forbidden",
		rateLimited: true,
		retryAt:     service.now().Add(time.Hour),
	})

	if strings.Contains(warning, "403") || strings.Contains(warning, "Forbidden") {
		t.Fatalf("warning leaked HTTP status: %q", warning)
	}
	if !strings.Contains(warning, systemUpdateGitHubTokenEnv) {
		t.Fatalf("warning should mention token fallback, got %q", warning)
	}
}

func TestSelfUpdateCapabilityMatrix(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update capability matrix depends on linux Docker binary semantics")
	}

	oldVersion, oldBuildType := Version, BuildType
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	cases := []struct {
		name           string
		buildType      string
		enabled        string
		writeBinary    bool
		wantDeployment string
		wantMode       string
		wantSupported  bool
		wantReasonPart string
	}{
		{
			name:           "docker release supports in-app binary update",
			buildType:      "release",
			enabled:        "true",
			writeBinary:    true,
			wantDeployment: "docker",
			wantMode:       "in-app-binary",
			wantSupported:  true,
		},
		{
			name:           "docker release with self update disabled falls back to compose",
			buildType:      "release",
			enabled:        "false",
			writeBinary:    true,
			wantDeployment: "docker",
			wantMode:       "docker-compose",
			wantSupported:  false,
			wantReasonPart: "RENEWLET_SELF_UPDATE_ENABLED=false",
		},
		{
			name:           "old docker bridge cannot replace container binary",
			buildType:      "release",
			enabled:        "true",
			writeBinary:    false,
			wantDeployment: "docker",
			wantMode:       "docker-compose",
			wantSupported:  false,
			wantReasonPart: "docker compose pull",
		},
		{
			name:           "non release source build stays manual",
			buildType:      "source",
			enabled:        "true",
			writeBinary:    true,
			wantDeployment: "source",
			wantMode:       "source-manual",
			wantSupported:  false,
			wantReasonPart: "Release",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tempDir := t.TempDir()
			binaryPath := filepath.Join(tempDir, "renewlet")
			if tc.writeBinary {
				if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", tc.enabled)
			t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
			t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
			Version, BuildType = "1.0.0", tc.buildType

			got := selfUpdateCapability(localeZhCN)
			if got.deployment != tc.wantDeployment {
				t.Fatalf("deployment = %q, want %q", got.deployment, tc.wantDeployment)
			}
			if got.updateMode != tc.wantMode {
				t.Fatalf("updateMode = %q, want %q", got.updateMode, tc.wantMode)
			}
			if got.supported != tc.wantSupported {
				t.Fatalf("supported = %v, want %v", got.supported, tc.wantSupported)
			}
			if tc.wantReasonPart != "" && !strings.Contains(got.unsupportedReason, tc.wantReasonPart) {
				t.Fatalf("unsupportedReason = %q, want to contain %q", got.unsupportedReason, tc.wantReasonPart)
			}
		})
	}
}

func TestStableVersionUsesLatestReleaseEndpointAndIgnoresPrereleaseTargets(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{release: &githubRelease{
		TagName:    "v0.2.0-rc.1",
		Prerelease: true,
	}}
	service := newSystemUpdateService(client)

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadInt32(&client.latestCount); got != 1 {
		t.Fatalf("FetchLatestRelease calls = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&client.listCount); got != 0 {
		t.Fatalf("FetchReleases calls = %d, want 0", got)
	}
	if !response.CheckSucceeded || response.HasUpdate {
		t.Fatalf("stable version should not accept prerelease target: %#v", response)
	}
}

func TestRCVersionSelectsHighestNewerPrerelease(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update capability depends on linux Docker binary semantics")
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{releases: [][]githubRelease{{
		releaseFixture("v0.1.0", false, false),
		releaseFixture("v0.1.0-rc.2", true, false),
		releaseFixture("v0.2.0-rc.1", true, false),
		releaseFixture("v0.2.0-beta.1", true, false),
		releaseFixture("v9.9.9-rc.1", true, true),
		releaseFixture("v0.1.0-rc.1", true, false),
	}}}
	service := newSystemUpdateService(client)

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadInt32(&client.latestCount); got != 0 {
		t.Fatalf("FetchLatestRelease calls = %d, want 0", got)
	}
	if got := atomic.LoadInt32(&client.listCount); got == 0 {
		t.Fatalf("FetchReleases should be used for rc versions")
	}
	if !response.CheckSucceeded || !response.HasUpdate {
		t.Fatalf("expected rc version update, got %#v", response)
	}
	if !response.UpdateSupported {
		t.Fatalf("expected rc version update to be installable, got %#v", response)
	}
	if response.LatestVersion != "0.2.0-rc.1" {
		t.Fatalf("latestVersion = %q, want 0.2.0-rc.1", response.LatestVersion)
	}
}

func TestSystemVersionReleaseAssetsStayArrayWhenEmpty(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "false")

	service := newSystemUpdateService(&fakeSystemReleaseClient{releases: [][]githubRelease{{
		{
			TagName:     "v0.1.0-rc.2",
			Name:        "Renewlet 0.1.0-rc.2",
			PublishedAt: "2026-06-04T00:00:00Z",
			HTMLURL:     "https://github.com/zhiyingzzhou/renewlet/releases/tag/v0.1.0-rc.2",
			Prerelease:  true,
			Assets:      nil,
		},
	}}})

	first, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CheckVersion(context.Background(), localeZhCN, false)
	if err != nil {
		t.Fatal(err)
	}
	for name, response := range map[string]*systemVersionResponse{"force": first, "cached": second} {
		payload, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(payload), `"assets":[]`) {
			t.Fatalf("%s response JSON = %s, want releaseInfo.assets as []", name, payload)
		}
		if strings.Contains(string(payload), `"assets":null`) {
			t.Fatalf("%s response JSON = %s, must not encode assets as null", name, payload)
		}
	}
	if !second.Cached {
		t.Fatal("second check should come from cache")
	}
}

func TestSystemVersionDisablesInAppUpdateWhenReleaseAssetsMissing(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update capability depends on linux Docker binary semantics")
	}
	oldVersion, oldBuildType := Version, BuildType
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	cases := []struct {
		name           string
		assets         []githubAsset
		wantReasonPart string
	}{
		{
			name:           "missing platform archive",
			assets:         []githubAsset{{Name: "renewlet-docker-v0.1.0-rc.2.zip"}},
			wantReasonPart: systemArchiveName("0.1.0-rc.2"),
		},
		{
			name:           "missing checksums",
			assets:         []githubAsset{{Name: systemArchiveName("0.1.0-rc.2")}},
			wantReasonPart: "checksums.txt",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tempDir := t.TempDir()
			binaryPath := filepath.Join(tempDir, "renewlet")
			if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
			t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
			t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
			Version, BuildType = "0.1.0-rc.1", "release"

			service := newSystemUpdateService(&fakeSystemReleaseClient{releases: [][]githubRelease{{
				{
					TagName:    "v0.1.0-rc.2",
					Name:       "Renewlet 0.1.0-rc.2",
					HTMLURL:    "https://github.com/zhiyingzzhou/renewlet/releases/tag/v0.1.0-rc.2",
					Prerelease: true,
					Assets:     tc.assets,
				},
			}}})

			response, err := service.CheckVersion(context.Background(), localeZhCN, true)
			if err != nil {
				t.Fatal(err)
			}
			if !response.CheckSucceeded || !response.HasUpdate {
				t.Fatalf("expected newer release to be reported, got %#v", response)
			}
			if response.UpdateSupported {
				t.Fatalf("UpdateSupported = true, want false when install asset is missing: %#v", response)
			}
			if !strings.Contains(response.UnsupportedReason, tc.wantReasonPart) {
				t.Fatalf("UnsupportedReason = %q, want to contain %q", response.UnsupportedReason, tc.wantReasonPart)
			}
			if response.ReleaseInfo == nil || response.ReleaseInfo.HTMLURL == "" {
				t.Fatalf("release info should stay available: %#v", response.ReleaseInfo)
			}
		})
	}
}

func TestStableCurrentVersionDoesNotUpdateToRC(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	release := releaseFixture("v0.2.0-rc.1", true, false)
	service := newSystemUpdateService(&fakeSystemReleaseClient{release: &release})

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if !response.CheckSucceeded || response.HasUpdate {
		t.Fatalf("stable current version must not update to rc: %#v", response)
	}
}

func TestRCVersionReportsLatestWhenNoNewerCandidateExists(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	service := newSystemUpdateService(&fakeSystemReleaseClient{releases: [][]githubRelease{{
		releaseFixture("v0.1.0", false, false),
		releaseFixture("v0.1.0-rc.1", true, false),
		releaseFixture("v0.2.0-beta.1", true, false),
	}}})

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if !response.CheckSucceeded || response.HasUpdate {
		t.Fatalf("expected successful rc check without update, got %#v", response)
	}
	if response.Warning != "" {
		t.Fatalf("warning = %q, want empty", response.Warning)
	}
	if response.LatestVersion != "0.1.0-rc.1" {
		t.Fatalf("latestVersion = %q, want current version", response.LatestVersion)
	}
}

func TestRCUpdateWithoutNewerCandidateReturnsAlreadyLatest(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update execution is only supported for linux Docker images")
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	service := newSystemUpdateService(&fakeSystemReleaseClient{releases: [][]githubRelease{{
		releaseFixture("v0.1.0-rc.1", true, false),
		releaseFixture("v0.1.0", false, false),
	}}})

	_, err := service.PerformUpdate(context.Background(), localeZhCN)
	if !errors.Is(err, errSystemUpdateNoUpdate) {
		t.Fatalf("PerformUpdate error = %v, want errSystemUpdateNoUpdate", err)
	}
	if err == nil || !strings.Contains(err.Error(), serverText(localeZhCN, "system.alreadyLatest")) {
		t.Fatalf("PerformUpdate error = %v, want already latest message", err)
	}
}

func TestChecksumForArchive(t *testing.T) {
	hash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	got, err := checksumForArchive("renewlet_1.0.0_linux_amd64.tar.gz", []byte(hash+"  renewlet_1.0.0_linux_amd64.tar.gz\n"))
	if err != nil {
		t.Fatal(err)
	}
	if got != hash {
		t.Fatalf("checksum = %q, want %q", got, hash)
	}
}

func TestExtractRenewletBinaryRejectsPathTraversal(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "bad.tar.gz")
	if err := writeTarGz(archivePath, map[string]string{"../../renewlet": "evil"}); err != nil {
		t.Fatal(err)
	}
	targetPath := filepath.Join(t.TempDir(), "renewlet")
	if err := extractRenewletBinary(archivePath, targetPath); err == nil {
		t.Fatal("expected path traversal archive to be rejected")
	}
}

func TestReplaceRenewletBinaryRestoresOnFailure(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	backupDir := filepath.Join(tempDir, "backups")
	newBinaryPath := filepath.Join(t.TempDir(), "missing-renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceRenewletBinary(binaryPath, backupDir, newBinaryPath, "1.0.0"); err == nil {
		t.Fatal("expected replace to fail")
	}
	content, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "old" {
		t.Fatalf("binary content = %q, want old", string(content))
	}
}

func TestSystemUpdateRejectsConcurrentRun(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update execution is only supported for linux Docker images")
	}
	release := &githubRelease{
		TagName: "v9.9.9",
		Assets: []githubAsset{
			{Name: systemArchiveName("9.9.9"), BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/" + systemArchiveName("9.9.9")},
			{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/checksums.txt"},
		},
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "1.0.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{release: release, fetchDelay: 200 * time.Millisecond}
	service := newSystemUpdateService(client)
	service.downloadFnForTest("renewlet-new")

	errCh := make(chan error, 2)
	go func() {
		_, err := service.PerformUpdate(context.Background(), localeZhCN)
		errCh <- err
	}()
	time.Sleep(20 * time.Millisecond)
	go func() {
		_, err := service.PerformUpdate(context.Background(), localeZhCN)
		errCh <- err
	}()

	first := <-errCh
	second := <-errCh
	if !(errors.Is(first, errSystemUpdateInProgress) || errors.Is(second, errSystemUpdateInProgress)) {
		t.Fatalf("expected one concurrent update error, got %v and %v", first, second)
	}
}

func TestSystemUpdateWaitsForExplicitRestart(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update execution is only supported for linux Docker images")
	}
	release := &githubRelease{
		TagName: "v9.9.9",
		Assets: []githubAsset{
			{Name: systemArchiveName("9.9.9"), BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/" + systemArchiveName("9.9.9")},
			{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/checksums.txt"},
		},
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "1.0.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	var exitCalled atomic.Bool
	client := &fakeSystemReleaseClient{release: release}
	service := newSystemUpdateService(client)
	service.exit = func(int) { exitCalled.Store(true) }
	service.downloadFnForTest("renewlet-new")

	result, err := service.PerformUpdate(context.Background(), localeZhCN)
	if err != nil {
		t.Fatal(err)
	}
	if !result.NeedsRestart {
		t.Fatal("expected update to require restart")
	}
	if exitCalled.Load() {
		t.Fatal("update should not exit before explicit restart")
	}
	if err := service.ConfirmRestart(localeZhCN); err != nil {
		t.Fatal(err)
	}
	if err := service.ConfirmRestart(localeZhCN); !errors.Is(err, errSystemRestartNotPending) {
		t.Fatalf("expected restart to be single-use, got %v", err)
	}
}

func TestSystemRestartRejectedBeforeSuccessfulUpdate(t *testing.T) {
	service := newSystemUpdateService(&fakeSystemReleaseClient{})
	err := service.ConfirmRestart(localeZhCN)
	if !errors.Is(err, errSystemRestartNotPending) {
		t.Fatalf("ConfirmRestart error = %v, want restart not pending", err)
	}
}

func (service *systemUpdateService) downloadFnForTest(binaryContent string) {
	if fake, ok := service.client.(*fakeSystemReleaseClient); ok {
		fake.downloadFn = func(targetPath string) error {
			if err := writeTarGz(targetPath, map[string]string{"renewlet": binaryContent}); err != nil {
				return err
			}
			content, err := os.ReadFile(targetPath)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(content)
			fake.checksumTxt = []byte(hex.EncodeToString(sum[:]) + "  " + filepath.Base(targetPath) + "\n")
			return nil
		}
	}
}

func writeTarGz(path string, files map[string]string) error {
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		if err := tarWriter.WriteHeader(&tar.Header{
			Name: name,
			Mode: 0o755,
			Size: int64(len(content)),
		}); err != nil {
			return err
		}
		if _, err := tarWriter.Write([]byte(content)); err != nil {
			return err
		}
	}
	if err := tarWriter.Close(); err != nil {
		return err
	}
	if err := gzipWriter.Close(); err != nil {
		return err
	}
	return os.WriteFile(path, buffer.Bytes(), 0o644)
}

func releaseFixture(tag string, prerelease bool, draft bool) githubRelease {
	version := strings.TrimPrefix(tag, "v")
	return githubRelease{
		TagName:     tag,
		Name:        "Renewlet " + version,
		PublishedAt: "2026-06-04T00:00:00Z",
		HTMLURL:     "https://github.com/zhiyingzzhou/renewlet/releases/tag/" + tag,
		Prerelease:  prerelease,
		Draft:       draft,
		Assets: []githubAsset{
			{Name: systemArchiveName(version), BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/" + tag + "/" + systemArchiveName(version)},
			{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/" + tag + "/checksums.txt"},
		},
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
