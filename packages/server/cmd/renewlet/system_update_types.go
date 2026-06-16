package main

// system_update_types.go 定义 Docker 页面内自更新的状态与 Release feed 数据形状。
//
// 这里的锁、缓存和 pending restart 是进程内状态；真正持久化边界仍是 /opt/renewlet/current/renewlet
// 与备份目录，不能把 Cloudflare/source 部署也纳入可执行更新。
import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	systemUpdateRepository            = "zhiyingzzhou/renewlet"
	systemUpdateChannelStable         = "stable"
	systemUpdateChannelRC             = "rc"
	systemUpdateCacheTTL              = 20 * time.Minute
	systemUpdateCheckTimeout          = 15 * time.Second
	systemUpdateDownloadTimeout       = 2 * time.Minute
	systemUpdateReleaseFeedLimitBytes = 512 * 1024
	systemUpdateMaxArchiveBytes       = 200 * 1024 * 1024
	systemUpdateMaxChecksumBytes      = 2 * 1024 * 1024
	defaultSelfUpdateBinaryPath       = "/opt/renewlet/current/renewlet"
	defaultSelfUpdateBackupDir        = "/opt/renewlet/backups"
)

var (
	errSystemUpdateUnsupported = errors.New("system update unsupported")
	errSystemUpdateNoUpdate    = errors.New("system update no update")
	errSystemUpdateInProgress  = errors.New("system update in progress")
	errSystemRestartNotPending = errors.New("system restart not pending")

	defaultSystemUpdateService = newSystemUpdateService(defaultSystemReleaseClient())
)

// systemUpdateError 保留可本地化 message，同时让 route 能用 errors.Is 映射 HTTP 状态。
type systemUpdateError struct {
	kind    error
	message string
}

func (e systemUpdateError) Error() string {
	return e.message
}

func (e systemUpdateError) Is(target error) bool {
	return target == e.kind
}

type systemReleaseClient interface {
	// Release client 是系统更新测试的隔离点；生产实现只读 GitHub Web Release feed，不再依赖 REST/token。
	FetchReleases(ctx context.Context) ([]systemRelease, error)
	ProbeReleaseAssets(ctx context.Context, tagName string, version string) []systemReleaseAsset
	DownloadFile(ctx context.Context, sourceURL string, targetPath string, maxBytes int64) error
	FetchText(ctx context.Context, sourceURL string, maxBytes int64) ([]byte, error)
}

// systemUpdateService 持有页面内更新的进程内状态。
// cacheMu 只保护版本检查缓存；updateMu 保护“下载/替换中”和“等待管理员确认重启”两个互斥状态。
type systemUpdateService struct {
	client      systemReleaseClient
	now         func() time.Time
	exit        func(int)
	restartWait time.Duration

	cacheMu     sync.Mutex
	cacheValue  *systemVersionResponse
	cacheExpiry time.Time

	updateMu       sync.Mutex
	updateInFlight bool
	restartPending bool
}

type systemRelease struct {
	TagName     string
	Name        string
	Body        string
	PublishedAt string
	HTMLURL     string
	Assets      []systemReleaseAsset
}

type systemReleaseAsset struct {
	Name               string
	BrowserDownloadURL string
	Size               int64
}

type systemReleaseCheckError struct {
	statusCode int
	status     string
	message    string
	details    *upstreamErrorDetails
}

func (e *systemReleaseCheckError) Error() string {
	if strings.TrimSpace(e.message) == "" {
		return "GitHub Release check failed: " + e.status
	}
	return "GitHub Release check failed: " + e.status + ": " + e.message
}

type fetchedSystemRelease struct {
	dto    *systemReleaseInfoDTO
	assets []systemReleaseAsset
}

type systemUpdateCapability struct {
	deployment        string
	updateMode        string
	supported         bool
	unsupportedReason string
	binaryPath        string
	backupDir         string
}

type semanticVersion struct {
	major      int
	minor      int
	patch      int
	prerelease string
	rc         int
}

type httpSystemReleaseClient struct {
	metadataClient *http.Client
	downloadClient *http.Client
}
