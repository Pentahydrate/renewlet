package main

// 更新执行测试只操作临时目录里的伪二进制，保护 Docker 自更新的 checksum、备份恢复和 pending restart 状态机。

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

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

	service := newSystemUpdateService(&fakeSystemReleaseClient{releases: []systemRelease{
		releaseFixture("v0.1.0-rc.1"),
		releaseFixture("v0.1.0"),
	}})

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
	release := &systemRelease{
		TagName: "v9.9.9",
		Assets: []systemReleaseAsset{
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
	release := &systemRelease{
		TagName: "v9.9.9",
		Assets: []systemReleaseAsset{
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
