package main

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func newSystemUpdateService(client systemReleaseClient) *systemUpdateService {
	return &systemUpdateService{
		client:      client,
		now:         time.Now,
		exit:        os.Exit,
		restartWait: 800 * time.Millisecond,
	}
}

func (service *systemUpdateService) CheckVersion(ctx context.Context, locale appLocale, force bool) (*systemVersionResponse, error) {
	if !force {
		if cached := service.cachedVersion(); cached != nil {
			return cached, nil
		}
	}

	response := service.baseVersionResponse(locale)
	release, err := service.fetchTargetRelease(ctx)
	if err != nil {
		if cached := service.cachedVersion(); cached != nil {
			// 版本检查是管理页体验能力，不应因 GitHub 短暂失败阻断管理员查看上次可信结果。
			cached.Warning = service.versionCheckWarning(locale, err)
			return cached, nil
		}
		response.Warning = service.versionCheckWarning(locale, err)
		return response, nil
	}
	response.CheckSucceeded = true
	if release == nil {
		service.storeVersion(response)
		return cloneSystemVersionResponse(response, false), nil
	}

	response.ReleaseInfo = release.dto
	response.LatestVersion = release.dto.Version
	response.HasUpdate = service.isTargetVersionNewer(release.dto.Version)
	if response.HasUpdate && response.UpdateSupported {
		if reason := systemUpdateAssetsUnsupportedReason(locale, release.assets, release.dto.Version); reason != "" {
			response.UpdateSupported = false
			response.UnsupportedReason = reason
		}
	}
	service.storeVersion(response)
	return cloneSystemVersionResponse(response, false), nil
}

// PerformUpdate 下载目标 Release、校验 checksum、替换真实二进制，并把退出动作延后到显式 restart。
// 注意：这里不能在替换完成后立刻退出，否则前端拿不到 needsRestart 状态，也无法开始健康检查等待。
func (service *systemUpdateService) PerformUpdate(ctx context.Context, locale appLocale) (*systemUpdateResponse, error) {
	if !service.beginUpdate() {
		return nil, systemUpdateError{kind: errSystemUpdateInProgress, message: serverText(locale, "system.updateInProgress")}
	}
	defer service.endUpdate()

	capability := selfUpdateCapability(locale)
	if !capability.supported {
		return nil, systemUpdateError{kind: errSystemUpdateUnsupported, message: capability.unsupportedReason}
	}
	release, err := service.fetchTargetRelease(ctx)
	if err != nil {
		return nil, err
	}
	if release == nil {
		return nil, systemUpdateError{kind: errSystemUpdateNoUpdate, message: serverText(locale, "system.alreadyLatest")}
	}
	if !service.isTargetVersionNewer(release.dto.Version) {
		return nil, systemUpdateError{kind: errSystemUpdateNoUpdate, message: serverText(locale, "system.alreadyLatest")}
	}

	archiveAsset, checksumAsset, err := selectSystemUpdateAssets(release.assets, release.dto.Version)
	if err != nil {
		return nil, err
	}
	if err := validateTrustedDownloadURL(archiveAsset.BrowserDownloadURL); err != nil {
		return nil, fmt.Errorf("invalid archive URL: %w", err)
	}
	if err := validateTrustedDownloadURL(checksumAsset.BrowserDownloadURL); err != nil {
		return nil, fmt.Errorf("invalid checksum URL: %w", err)
	}

	// 临时目录必须和目标二进制同分区，后续 rename 才能保持替换语义接近原子操作。
	tempDir, err := os.MkdirTemp(filepath.Dir(capability.binaryPath), ".renewlet-update-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)

	archivePath := filepath.Join(tempDir, archiveAsset.Name)
	if err := service.client.DownloadFile(ctx, archiveAsset.BrowserDownloadURL, archivePath, systemUpdateMaxArchiveBytes); err != nil {
		return nil, err
	}
	checksumText, err := service.client.FetchText(ctx, checksumAsset.BrowserDownloadURL, systemUpdateMaxChecksumBytes)
	if err != nil {
		return nil, err
	}
	if int64(len(checksumText)) > systemUpdateMaxChecksumBytes {
		return nil, errors.New("checksums.txt is too large")
	}
	// 先验证 checksum 再解包，避免把不可信 tar 内容交给路径检查和文件写入流程。
	if err := verifySystemUpdateChecksum(archivePath, archiveAsset.Name, checksumText); err != nil {
		return nil, err
	}

	newBinaryPath := filepath.Join(tempDir, "renewlet.new")
	if err := extractRenewletBinary(archivePath, newBinaryPath); err != nil {
		return nil, err
	}
	if err := replaceRenewletBinary(capability.binaryPath, capability.backupDir, newBinaryPath, Version); err != nil {
		return nil, err
	}

	service.clearCache()
	service.markRestartPending()
	return &systemUpdateResponse{
		OK:             true,
		CurrentVersion: Version,
		TargetVersion:  release.dto.Version,
		NeedsRestart:   true,
		Message:        serverText(locale, "system.updateCompleted"),
	}, nil
}

// ConfirmRestart 单次消费 restart pending，避免管理员之外的重复请求把当前进程当成通用 kill switch。
func (service *systemUpdateService) ConfirmRestart(locale appLocale) error {
	service.updateMu.Lock()
	defer service.updateMu.Unlock()
	if !service.restartPending {
		return systemUpdateError{kind: errSystemRestartNotPending, message: serverText(locale, "system.restartNotPending")}
	}
	service.restartPending = false
	return nil
}

// ScheduleRestart 在响应写回后异步退出；Docker restart policy 负责用新二进制拉起进程。
func (service *systemUpdateService) ScheduleRestart() {
	if envBool("RENEWLET_SELF_UPDATE_DISABLE_EXIT", false) {
		return
	}
	go func() {
		// 重启请求响应已经写回浏览器后再退出；Docker restart 策略负责把新二进制作为唯一运行面拉起。
		time.Sleep(service.restartWait)
		service.exit(0)
	}()
}

func (service *systemUpdateService) baseVersionResponse(locale appLocale) *systemVersionResponse {
	capability := selfUpdateCapability(locale)
	return &systemVersionResponse{
		CurrentVersion:    Version,
		LatestVersion:     Version,
		HasUpdate:         false,
		Deployment:        capability.deployment,
		UpdateMode:        capability.updateMode,
		UpdateSupported:   capability.supported,
		UnsupportedReason: capability.unsupportedReason,
		ReleaseInfo:       nil,
		Cached:            false,
		CheckSucceeded:    false,
		Build: systemBuildInfo{
			Version:   Version,
			Commit:    Commit,
			BuildTime: BuildTime,
			BuildType: BuildType,
		},
	}
}

func (service *systemUpdateService) fetchTargetRelease(ctx context.Context) (*fetchedSystemRelease, error) {
	if currentUpdateChannel() == systemUpdateChannelRC {
		return service.fetchLatestRCRelease(ctx)
	}
	return service.fetchLatestStableRelease(ctx)
}

func (service *systemUpdateService) fetchLatestStableRelease(ctx context.Context) (*fetchedSystemRelease, error) {
	release, err := service.client.FetchLatestRelease(ctx)
	if err != nil {
		return nil, err
	}
	version, parsed, ok := parseSystemVersion(release.TagName)
	if !ok || parsed.prerelease != "" || release.Prerelease || release.Draft {
		return nil, nil
	}
	return systemReleaseFromGitHub(release, version), nil
}

func (service *systemUpdateService) fetchLatestRCRelease(ctx context.Context) (*fetchedSystemRelease, error) {
	var best *githubRelease
	var bestVersion string
	var bestParsed semanticVersion
	for page := 1; page <= systemUpdateReleaseListPages; page += 1 {
		releases, err := service.client.FetchReleases(ctx, page, systemUpdateReleaseListSize)
		if err != nil {
			return nil, err
		}
		if len(releases) == 0 {
			break
		}
		for index := range releases {
			release := &releases[index]
			version, parsed, ok := parseSystemVersion(release.TagName)
			if !ok || parsed.rc <= 0 || release.Draft || !release.Prerelease {
				continue
			}
			if !isNewerSystemRCVersion(Version, version) {
				continue
			}
			if best == nil || compareSemanticVersion(parsed, bestParsed) > 0 {
				copyRelease := *release
				copyRelease.Assets = append([]githubAsset(nil), release.Assets...)
				best = &copyRelease
				bestVersion = version
				bestParsed = parsed
			}
		}
	}
	if best == nil {
		return nil, nil
	}
	return systemReleaseFromGitHub(best, bestVersion), nil
}

func (service *systemUpdateService) isTargetVersionNewer(version string) bool {
	if currentUpdateChannel() == systemUpdateChannelRC {
		return isNewerSystemRCVersion(Version, version)
	}
	return isNewerSystemVersion(Version, version)
}

func currentUpdateChannel() string {
	// RC/stable 通道以当前运行版本为唯一真相；额外 build arg 会让候选版验收路径和实际二进制版本漂移。
	_, parsed, ok := parseSystemVersion(Version)
	if ok && parsed.rc > 0 {
		return systemUpdateChannelRC
	}
	return systemUpdateChannelStable
}

func systemReleaseFromGitHub(release *githubRelease, version string) *fetchedSystemRelease {
	assets := makeSystemReleaseAssetDTOs(release.Assets)
	return &fetchedSystemRelease{
		dto: &systemReleaseInfoDTO{
			TagName:     release.TagName,
			Version:     version,
			Name:        release.Name,
			Body:        release.Body,
			PublishedAt: release.PublishedAt,
			HTMLURL:     release.HTMLURL,
			Assets:      assets,
		},
		assets: append([]githubAsset(nil), release.Assets...),
	}
}

func makeSystemReleaseAssetDTOs(source []githubAsset) []systemReleaseAssetDTO {
	assets := make([]systemReleaseAssetDTO, 0, len(source))
	for _, asset := range source {
		assets = append(assets, systemReleaseAssetDTO{Name: asset.Name, Size: asset.Size})
	}
	return assets
}

func (service *systemUpdateService) cachedVersion() *systemVersionResponse {
	service.cacheMu.Lock()
	defer service.cacheMu.Unlock()
	if service.cacheValue == nil || !service.now().Before(service.cacheExpiry) {
		return nil
	}
	return cloneSystemVersionResponse(service.cacheValue, true)
}

func (service *systemUpdateService) storeVersion(response *systemVersionResponse) {
	service.cacheMu.Lock()
	defer service.cacheMu.Unlock()
	service.cacheValue = cloneSystemVersionResponse(response, false)
	service.cacheExpiry = service.now().Add(systemUpdateCacheTTL)
}

func (service *systemUpdateService) clearCache() {
	service.cacheMu.Lock()
	defer service.cacheMu.Unlock()
	service.cacheValue = nil
	service.cacheExpiry = time.Time{}
}

func (service *systemUpdateService) versionCheckWarning(locale appLocale, err error) string {
	var githubErr *githubAPIError
	if errors.As(err, &githubErr) {
		if githubErr.rateLimited {
			return service.versionCheckRateLimitWarning(locale, githubErr.retryAt)
		}
		switch githubErr.statusCode {
		case http.StatusNotFound:
			return serverText(locale, "system.versionCheckNotFoundWarning")
		case http.StatusForbidden, http.StatusUnauthorized:
			return serverText(locale, "system.versionCheckAccessWarning")
		case 0:
			return serverText(locale, "system.versionCheckNetworkWarning")
		default:
			return serverText(locale, "system.versionCheckUnavailableWarning")
		}
	}
	return serverText(locale, "system.versionCheckUnavailableWarning")
}

func (service *systemUpdateService) versionCheckRateLimitWarning(locale appLocale, retryAt time.Time) string {
	if !retryAt.IsZero() && retryAt.After(service.now()) {
		return serverFormat(locale, "system.versionCheckRateLimitRetryWarning", map[string]interface{}{"time": retryAt.UTC().Format(time.RFC3339)})
	}
	return serverText(locale, "system.versionCheckRateLimitWarning")
}

func (service *systemUpdateService) beginUpdate() bool {
	service.updateMu.Lock()
	defer service.updateMu.Unlock()
	if service.updateInFlight {
		return false
	}
	service.updateInFlight = true
	return true
}

func (service *systemUpdateService) endUpdate() {
	service.updateMu.Lock()
	defer service.updateMu.Unlock()
	service.updateInFlight = false
}

func (service *systemUpdateService) markRestartPending() {
	service.updateMu.Lock()
	defer service.updateMu.Unlock()
	// 更新请求已经替换真实二进制，但旧进程仍服务当前页面；显式 pending 防止普通 restart 请求变成任意退出开关。
	service.restartPending = true
}

func selfUpdateCapability(locale appLocale) systemUpdateCapability {
	binaryPath := strings.TrimSpace(os.Getenv("RENEWLET_SELF_UPDATE_BINARY"))
	if binaryPath == "" {
		binaryPath = defaultSelfUpdateBinaryPath
	}
	backupDir := strings.TrimSpace(os.Getenv("RENEWLET_SELF_UPDATE_BACKUP_DIR"))
	if backupDir == "" {
		backupDir = defaultSelfUpdateBackupDir
	}
	if !envBool("RENEWLET_SELF_UPDATE_ENABLED", false) {
		reasonKey := "system.updateUnsupportedRuntime"
		if BuildType == "release" {
			reasonKey = "system.updateUnsupportedSelfUpdateDisabled"
		}
		return systemUpdateCapability{
			deployment:        deploymentForBuildType(),
			updateMode:        updateModeForManualDeployment(),
			supported:         false,
			unsupportedReason: serverText(locale, reasonKey),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	if BuildType != "release" {
		return systemUpdateCapability{
			deployment:        deploymentForBuildType(),
			updateMode:        updateModeForManualDeployment(),
			supported:         false,
			unsupportedReason: serverText(locale, "system.updateUnsupportedNotRelease"),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	if runtime.GOOS != "linux" {
		return systemUpdateCapability{
			deployment:        "docker",
			updateMode:        "docker-compose",
			supported:         false,
			unsupportedReason: serverText(locale, "system.updateUnsupportedLinuxDocker"),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	if fileInfo, err := os.Lstat(binaryPath); err != nil || !fileInfo.Mode().IsRegular() {
		// 旧镜像的 /renewlet 可能仍是真实文件；自更新只支持新布局里的 current/renewlet 可替换目标。
		return systemUpdateCapability{
			deployment:        "docker",
			updateMode:        "docker-compose",
			supported:         false,
			unsupportedReason: serverText(locale, "system.updateUnsupportedDockerBridge"),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	return systemUpdateCapability{
		deployment: "docker",
		updateMode: "in-app-binary",
		supported:  true,
		binaryPath: binaryPath,
		backupDir:  backupDir,
	}
}

func deploymentForBuildType() string {
	if BuildType == "release" {
		return "docker"
	}
	return "source"
}

func updateModeForManualDeployment() string {
	if BuildType == "release" {
		return "docker-compose"
	}
	return "source-manual"
}

func findSystemUpdateAssets(assets []githubAsset, version string) (*githubAsset, *githubAsset) {
	archiveName := systemArchiveName(version)
	var archiveAsset *githubAsset
	var checksumAsset *githubAsset
	for index := range assets {
		asset := &assets[index]
		switch asset.Name {
		case archiveName:
			archiveAsset = asset
		case "checksums.txt":
			checksumAsset = asset
		}
	}
	return archiveAsset, checksumAsset
}

func systemUpdateAssetsUnsupportedReason(locale appLocale, assets []githubAsset, version string) string {
	archiveAsset, checksumAsset := findSystemUpdateAssets(assets, version)
	if archiveAsset == nil {
		return serverFormat(locale, "system.updateUnsupportedReleaseAsset", map[string]interface{}{"asset": systemArchiveName(version)})
	}
	if checksumAsset == nil {
		return serverFormat(locale, "system.updateUnsupportedReleaseAsset", map[string]interface{}{"asset": "checksums.txt"})
	}
	return ""
}

func selectSystemUpdateAssets(assets []githubAsset, version string) (githubAsset, githubAsset, error) {
	archiveAsset, checksumAsset := findSystemUpdateAssets(assets, version)
	if archiveAsset == nil {
		return githubAsset{}, githubAsset{}, fmt.Errorf("no compatible release asset found for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if checksumAsset == nil {
		return githubAsset{}, githubAsset{}, errors.New("checksums.txt is missing from the release")
	}
	return *archiveAsset, *checksumAsset, nil
}

// verifySystemUpdateChecksum 只信任同一 Release 附带的 checksums.txt，先验完整性再触碰 tar 内容。
func verifySystemUpdateChecksum(archivePath string, archiveName string, checksumText []byte) error {
	expected, err := checksumForArchive(archiveName, checksumText)
	if err != nil {
		return err
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("checksum mismatch for %s", archiveName)
	}
	return nil
}

func checksumForArchive(archiveName string, checksumText []byte) (string, error) {
	scanner := bufio.NewScanner(strings.NewReader(string(checksumText)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		hash := strings.ToLower(strings.TrimSpace(fields[0]))
		name := checksumEntryName(fields[len(fields)-1])
		if name != archiveName {
			continue
		}
		if len(hash) != sha256.Size*2 {
			return "", fmt.Errorf("invalid checksum for %s", archiveName)
		}
		if _, err := hex.DecodeString(hash); err != nil {
			return "", fmt.Errorf("invalid checksum for %s", archiveName)
		}
		return hash, nil
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("checksum for %s not found", archiveName)
}

func extractRenewletBinary(archivePath string, targetPath string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	found := false
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(header.Name)
		if filepath.IsAbs(name) || strings.HasPrefix(name, ".."+string(filepath.Separator)) || name == ".." {
			return fmt.Errorf("unsafe archive path %q", header.Name)
		}
		if header.Typeflag != tar.TypeReg || filepath.Base(name) != "renewlet" {
			continue
		}
		if found {
			return errors.New("release archive contains multiple renewlet binaries")
		}
		// 发布包里只接受一个 renewlet 可执行文件；其它路径一律忽略，避免 tarball 带额外 payload。
		target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
		if err != nil {
			return err
		}
		if _, err := copyLimited(target, tarReader, systemUpdateMaxArchiveBytes); err != nil {
			_ = target.Close()
			return err
		}
		if err := target.Sync(); err != nil {
			_ = target.Close()
			return err
		}
		if err := target.Close(); err != nil {
			return err
		}
		found = true
	}
	if !found {
		return errors.New("renewlet binary not found in release archive")
	}
	return os.Chmod(targetPath, 0o755)
}

func replaceRenewletBinary(binaryPath string, backupDir string, newBinaryPath string, currentVersion string) error {
	if !filepath.IsAbs(binaryPath) || !filepath.IsAbs(backupDir) {
		return errors.New("self-update paths must be absolute")
	}
	fileInfo, err := os.Lstat(binaryPath)
	if err != nil {
		return err
	}
	if !fileInfo.Mode().IsRegular() {
		return errors.New("self-update target must be the real binary, not a symlink or directory")
	}
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return err
	}
	backupPath := filepath.Join(backupDir, "renewlet."+safeBackupVersion(currentVersion))
	_ = os.Remove(backupPath)
	// 先把当前二进制改名成备份，再移动新二进制；替换失败时仍有可恢复路径。
	if err := os.Rename(binaryPath, backupPath); err != nil {
		return fmt.Errorf("backup current binary: %w", err)
	}
	if err := os.Rename(newBinaryPath, binaryPath); err != nil {
		if restoreErr := os.Rename(backupPath, binaryPath); restoreErr != nil {
			return fmt.Errorf("replace binary: %w; restore failed: %v", err, restoreErr)
		}
		return fmt.Errorf("replace binary: %w", err)
	}
	_ = os.Chmod(binaryPath, 0o755)
	return nil
}

func copyLimited(writer io.Writer, reader io.Reader, maxBytes int64) (int64, error) {
	limited := io.LimitReader(reader, maxBytes+1)
	written, err := io.Copy(writer, limited)
	if err != nil {
		return written, err
	}
	if written > maxBytes {
		return written, errors.New("payload is too large")
	}
	return written, nil
}
