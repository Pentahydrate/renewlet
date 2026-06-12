package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	appstatic "github.com/zhiyingzzhou/renewlet/packages/server/internal/static"
)

const mediaIconIndexRecordKey = "active"
const builtInIconGitHubFetchTimeout = 15 * time.Second
const builtInIconProviderStatusMaxBytes = 64 * 1024

var builtInIconProviders = []string{"thesvg", "selfhst", "dashboardIcons"}
var builtInIconGitHubAPIBase = "https://api.github.com"

type builtInIconIndexCacheState struct {
	hash     string
	resolver builtInResolverIndex
}

type storedBuiltInIconProviderState struct {
	Current     *builtInIconProviderVersionResponse `json:"current,omitempty"`
	Latest      *builtInIconProviderVersionResponse `json:"latest,omitempty"`
	CheckedAt   string                              `json:"checkedAt,omitempty"`
	RefreshedAt string                              `json:"refreshedAt,omitempty"`
	LastError   string                              `json:"lastError,omitempty"`
	ETag        string                              `json:"etag,omitempty"`
}

type storedBuiltInIconProviderStates map[string]storedBuiltInIconProviderState

type builtInIconSeedMetadata struct {
	Hash           string                                         `json:"hash"`
	IconCount      int                                            `json:"iconCount"`
	ProviderCounts builtInIconProviderCountsResponse              `json:"providerCounts"`
	Providers      map[string]*builtInIconProviderVersionResponse `json:"providers"`
}

var builtInIconIndexRefreshMu sync.Mutex
var builtInIconIndexRefreshingProvider = struct {
	sync.RWMutex
	provider string
}{}
var builtInIconIndexCache = struct {
	sync.RWMutex
	state builtInIconIndexCacheState
}{
	state: builtInIconIndexCacheState{
		hash:     embeddedBuiltInIconIndexHash(),
		resolver: embeddedBuiltInResolver,
	},
}
var embeddedBuiltInIconSeedMetadata = loadEmbeddedBuiltInIconSeedMetadata()

func activeBuiltInResolver(app core.App) builtInResolverIndex {
	record, err := findMediaIconIndexRecord(app)
	if err != nil || record == nil || record.GetString("hash") == "" || record.GetString("indexGzipBase64") == "" {
		return cachedEmbeddedBuiltInResolver()
	}
	hash := record.GetString("hash")
	builtInIconIndexCache.RLock()
	if builtInIconIndexCache.state.hash == hash {
		resolver := builtInIconIndexCache.state.resolver
		builtInIconIndexCache.RUnlock()
		return resolver
	}
	builtInIconIndexCache.RUnlock()

	icons, err := loadRuntimeBuiltInIcons(record)
	if err != nil {
		return cachedEmbeddedBuiltInResolver()
	}
	states := providerStatesFromRecord(record)
	resolver := buildBuiltInResolverIndexWithProviderBases(icons, providerCDNBaseOverridesFromStates(states))
	// active 指针按 hash 切换；缓存只保存 resolver，不保存请求级数据，避免用户设置或认证状态串到全局。
	builtInIconIndexCache.Lock()
	builtInIconIndexCache.state = builtInIconIndexCacheState{hash: hash, resolver: resolver}
	builtInIconIndexCache.Unlock()
	return resolver
}

func cachedEmbeddedBuiltInResolver() builtInResolverIndex {
	builtInIconIndexCache.RLock()
	defer builtInIconIndexCache.RUnlock()
	if builtInIconIndexCache.state.hash == embeddedBuiltInIconIndexHash() {
		return builtInIconIndexCache.state.resolver
	}
	return embeddedBuiltInResolver
}

func handleBuiltInIconIndexStatus(app core.App, e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, builtInIconIndexStatus(app))
}

func handleBuiltInIconIndexProviderCheck(app core.App, e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	provider := e.Request.PathValue("provider")
	if !validBuiltInIconProvider(provider) {
		return e.BadRequestError(serverText(locale, "common.invalidRequestParameters"), nil)
	}
	if err := requireEmptyRequestBody(e.Request); err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
	}
	if !acquireBuiltInIconIndexOperation(provider) {
		status := builtInIconIndexStatus(app)
		markProviderRefreshing(&status, provider)
		return e.JSON(http.StatusConflict, builtInIconIndexProviderCheckResponse{Status: status, Provider: providerStatusFromResponse(status, provider)})
	}
	operationActive := true
	defer func() {
		if operationActive {
			releaseBuiltInIconIndexOperation()
		}
	}()

	ctx, cancel := context.WithTimeout(e.Request.Context(), 30*time.Second)
	defer cancel()
	checkedAt := time.Now().UTC().Format(time.RFC3339Nano)
	version, etag, err := checkLatestBuiltInIconProviderVersion(ctx, app, provider)
	if err != nil {
		saveMediaIconProviderFailure(app, provider, checkedAt, err)
		releaseBuiltInIconIndexOperation()
		operationActive = false
		status := builtInIconIndexStatus(app)
		// check 只更新 provider 可见状态；GitHub 限流/断网时仍返回同形状 body，让前端展示失败 badge 而不是把弹层流程打断。
		return e.JSON(http.StatusOK, builtInIconIndexProviderCheckResponse{Status: status, Provider: providerStatusFromResponse(status, provider), ErrorDetails: upstreamErrorDetailsFromError(err)})
	}
	if err := saveMediaIconProviderLatest(app, provider, checkedAt, version, etag); err != nil {
		return e.InternalServerError(serverText(locale, "common.internalError"), err)
	}
	releaseBuiltInIconIndexOperation()
	operationActive = false
	status := builtInIconIndexStatus(app)
	return e.JSON(http.StatusOK, builtInIconIndexProviderCheckResponse{Status: status, Provider: providerStatusFromResponse(status, provider)})
}

func handleBuiltInIconIndexProviderRefresh(app core.App, e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	provider := e.Request.PathValue("provider")
	if !validBuiltInIconProvider(provider) {
		return e.BadRequestError(serverText(locale, "common.invalidRequestParameters"), nil)
	}
	if err := requireEmptyRequestBody(e.Request); err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
	}
	if !acquireBuiltInIconIndexOperation(provider) {
		status := builtInIconIndexStatus(app)
		markProviderRefreshing(&status, provider)
		return e.JSON(http.StatusConflict, builtInIconIndexProviderRefreshResponse{Status: status, Provider: providerStatusFromResponse(status, provider)})
	}
	operationActive := true
	defer func() {
		if operationActive {
			releaseBuiltInIconIndexOperation()
		}
	}()

	ctx, cancel := context.WithTimeout(e.Request.Context(), 60*time.Second)
	defer cancel()
	checkedAt := time.Now().UTC().Format(time.RFC3339Nano)
	version, etag, err := checkLatestBuiltInIconProviderVersion(ctx, app, provider)
	if err != nil {
		saveMediaIconProviderFailure(app, provider, checkedAt, err)
		releaseBuiltInIconIndexOperation()
		operationActive = false
		status := builtInIconIndexStatus(app)
		return e.JSON(http.StatusBadGateway, builtInIconIndexProviderRefreshResponse{Status: status, Provider: providerStatusFromResponse(status, provider), ErrorDetails: upstreamErrorDetailsFromError(err)})
	}
	if version == nil || version.CommitSHA == nil || *version.CommitSHA == "" {
		err := errors.New("latest provider commit is unavailable")
		saveMediaIconProviderFailure(app, provider, checkedAt, err)
		releaseBuiltInIconIndexOperation()
		operationActive = false
		status := builtInIconIndexStatus(app)
		return e.JSON(http.StatusBadGateway, builtInIconIndexProviderRefreshResponse{Status: status, Provider: providerStatusFromResponse(status, provider), ErrorDetails: upstreamErrorDetailsFromError(err)})
	}
	sourceRef := builtInIconProviderSourceRef{
		Provider: provider,
		CDNBase:  mediaResolverBuiltInProviderPinnedBase(provider, *version.CommitSHA),
	}
	providerIcons, err := buildRemoteBuiltInIconProviderIndex(ctx, provider, &sourceRef)
	if err != nil {
		saveMediaIconProviderFailure(app, provider, checkedAt, err)
		releaseBuiltInIconIndexOperation()
		operationActive = false
		status := builtInIconIndexStatus(app)
		return e.JSON(http.StatusBadGateway, builtInIconIndexProviderRefreshResponse{Status: status, Provider: providerStatusFromResponse(status, provider), ErrorDetails: upstreamErrorDetailsFromError(err)})
	}
	activeIcons := activeBuiltInIconIndex(app)
	icons, err := replaceBuiltInIconProviderIndex(activeIcons, provider, providerIcons)
	if err != nil {
		saveMediaIconProviderFailure(app, provider, checkedAt, err)
		releaseBuiltInIconIndexOperation()
		operationActive = false
		status := builtInIconIndexStatus(app)
		return e.JSON(http.StatusBadGateway, builtInIconIndexProviderRefreshResponse{Status: status, Provider: providerStatusFromResponse(status, provider), ErrorDetails: upstreamErrorDetailsFromError(err)})
	}
	hash, gzipBase64, err := encodeBuiltInIconIndex(icons)
	if err != nil {
		saveMediaIconProviderFailure(app, provider, checkedAt, err)
		releaseBuiltInIconIndexOperation()
		operationActive = false
		status := builtInIconIndexStatus(app)
		return e.JSON(http.StatusBadGateway, builtInIconIndexProviderRefreshResponse{Status: status, Provider: providerStatusFromResponse(status, provider), ErrorDetails: upstreamErrorDetailsFromError(err)})
	}
	if err := saveMediaIconProviderRefreshSuccess(app, provider, checkedAt, hash, gzipBase64, icons, version, etag); err != nil {
		return e.InternalServerError(serverText(locale, "common.internalError"), err)
	}
	releaseBuiltInIconIndexOperation()
	operationActive = false
	status := builtInIconIndexStatus(app)
	return e.JSON(http.StatusOK, builtInIconIndexProviderRefreshResponse{Status: status, Provider: providerStatusFromResponse(status, provider)})
}

func builtInIconIndexStatus(app core.App) builtInIconIndexStatusResponse {
	record, err := findMediaIconIndexRecord(app)
	refreshingProvider := currentBuiltInIconIndexRefreshingProvider()
	if err != nil || record == nil || record.GetString("hash") == "" || record.GetString("indexGzipBase64") == "" {
		status := embeddedBuiltInIconIndexStatus(providerStatesFromRecord(record))
		if record != nil {
			status.CheckedAt = stringPtrOrNil(record.GetString("checkedAt"))
		}
		status.Refreshing = refreshingProvider != ""
		status.Providers = providerStatusesFromState(status.ProviderCounts, providerStatesFromRecord(record), refreshingProvider)
		return status
	}
	states := providerStatesFromRecord(record)
	status := builtInIconIndexStatusResponse{
		Source:         "runtime",
		Hash:           stringPtrOrNil(record.GetString("hash")),
		IconCount:      record.GetInt("iconCount"),
		ProviderCounts: providerCountsResponseFromValue(record.Get("providerCounts")),
		CheckedAt:      stringPtrOrNil(record.GetString("checkedAt")),
		UpdatedAt:      stringPtrOrNil(record.GetString("indexUpdatedAt")),
		Refreshing:     refreshingProvider != "",
	}
	status.Providers = providerStatusesFromState(status.ProviderCounts, states, refreshingProvider)
	return status
}

func embeddedBuiltInIconIndexStatus(states storedBuiltInIconProviderStates) builtInIconIndexStatusResponse {
	hash := embeddedBuiltInIconIndexHash()
	status := builtInIconIndexStatusResponse{
		Source:         "embedded",
		Hash:           &hash,
		IconCount:      len(embeddedBuiltInIcons),
		ProviderCounts: providerCountsResponse(embeddedBuiltInIcons),
		CheckedAt:      nil,
		UpdatedAt:      nil,
		Refreshing:     false,
	}
	status.Providers = providerStatusesFromState(status.ProviderCounts, states, "")
	return status
}

func activeBuiltInIconIndex(app core.App) []builtInIcon {
	record, err := findMediaIconIndexRecord(app)
	if err != nil || record == nil || record.GetString("hash") == "" || record.GetString("indexGzipBase64") == "" {
		return embeddedBuiltInIcons
	}
	icons, err := loadRuntimeBuiltInIcons(record)
	if err != nil {
		return embeddedBuiltInIcons
	}
	return icons
}

func findMediaIconIndexRecord(app core.App) (*core.Record, error) {
	record, err := app.FindFirstRecordByFilter("media_icon_indexes", "key = {:key}", dbx.Params{"key": mediaIconIndexRecordKey})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return record, err
}

func mediaIconIndexRecord(app core.App) (*core.Record, error) {
	record, err := findMediaIconIndexRecord(app)
	if err != nil {
		return nil, err
	}
	if record != nil {
		return record, nil
	}
	collection, err := app.FindCollectionByNameOrId("media_icon_indexes")
	if err != nil {
		return nil, err
	}
	record = core.NewRecord(collection)
	record.Set("key", mediaIconIndexRecordKey)
	return record, nil
}

func saveMediaIconProviderLatest(app core.App, provider string, checkedAt string, version *builtInIconProviderVersionResponse, etag string) error {
	record, err := mediaIconIndexRecord(app)
	if err != nil {
		return err
	}
	states := providerStatesFromRecord(record)
	state := states[provider]
	state.Latest = version
	state.CheckedAt = checkedAt
	state.LastError = ""
	if etag != "" {
		state.ETag = etag
	}
	states[provider] = state
	record.Set("checkedAt", checkedAt)
	record.Set("providerStatus", states)
	return app.Save(record)
}

func saveMediaIconProviderRefreshSuccess(app core.App, provider string, checkedAt string, hash string, gzipBase64 string, icons []builtInIcon, version *builtInIconProviderVersionResponse, etag string) error {
	record, err := mediaIconIndexRecord(app)
	if err != nil {
		return err
	}
	states := providerStatesFromRecord(record)
	state := states[provider]
	state.Current = version
	state.Latest = version
	state.CheckedAt = checkedAt
	state.RefreshedAt = checkedAt
	state.LastError = ""
	if etag != "" {
		state.ETag = etag
	}
	states[provider] = state
	record.Set("hash", hash)
	record.Set("iconCount", len(icons))
	record.Set("providerCounts", providerCountsMap(icons))
	record.Set("checkedAt", checkedAt)
	record.Set("indexUpdatedAt", checkedAt)
	record.Set("providerStatus", states)
	record.Set("indexGzipBase64", gzipBase64)
	if err := app.Save(record); err != nil {
		return err
	}
	resolver := buildBuiltInResolverIndexWithProviderBases(icons, providerCDNBaseOverridesFromStates(states))
	builtInIconIndexCache.Lock()
	builtInIconIndexCache.state = builtInIconIndexCacheState{hash: hash, resolver: resolver}
	builtInIconIndexCache.Unlock()
	return nil
}

func saveMediaIconProviderFailure(app core.App, provider string, checkedAt string, failure error) builtInIconIndexStatusResponse {
	record, err := mediaIconIndexRecord(app)
	if err == nil {
		states := providerStatesFromRecord(record)
		state := states[provider]
		state.CheckedAt = checkedAt
		state.LastError = truncateText(failure.Error(), 2000)
		states[provider] = state
		record.Set("checkedAt", checkedAt)
		record.Set("providerStatus", states)
		_ = app.Save(record)
	}
	status := builtInIconIndexStatus(app)
	return status
}

func encodeBuiltInIconIndex(icons []builtInIcon) (string, string, error) {
	raw, err := json.Marshal(icons)
	if err != nil {
		return "", "", err
	}
	raw = append(raw, '\n')
	hashBytes := sha256.Sum256(raw)
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	if _, err := gzipWriter.Write(raw); err != nil {
		return "", "", err
	}
	if err := gzipWriter.Close(); err != nil {
		return "", "", err
	}
	return hex.EncodeToString(hashBytes[:]), base64.StdEncoding.EncodeToString(buffer.Bytes()), nil
}

func loadRuntimeBuiltInIcons(record *core.Record) ([]builtInIcon, error) {
	compressed, err := base64.StdEncoding.DecodeString(record.GetString("indexGzipBase64"))
	if err != nil {
		return nil, err
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	raw, err := io.ReadAll(io.LimitReader(reader, 16*1024*1024))
	if err != nil {
		return nil, err
	}
	var icons []builtInIcon
	if err := json.Unmarshal(raw, &icons); err != nil {
		return nil, err
	}
	return icons, nil
}

func embeddedBuiltInIconIndexHash() string {
	hash := sha256.Sum256(appstatic.BuiltInIconsIndex)
	return hex.EncodeToString(hash[:])
}

func loadEmbeddedBuiltInIconSeedMetadata() builtInIconSeedMetadata {
	var metadata builtInIconSeedMetadata
	if err := json.Unmarshal(appstatic.BuiltInIconsIndexMetadata, &metadata); err != nil {
		return builtInIconSeedMetadata{Providers: map[string]*builtInIconProviderVersionResponse{}}
	}
	if metadata.Hash == "" || metadata.Hash != embeddedBuiltInIconIndexHash() {
		return builtInIconSeedMetadata{Providers: map[string]*builtInIconProviderVersionResponse{}}
	}
	if metadata.Providers == nil {
		metadata.Providers = map[string]*builtInIconProviderVersionResponse{}
	}
	return metadata
}

func embeddedProviderVersion(provider string) *builtInIconProviderVersionResponse {
	version := embeddedBuiltInIconSeedMetadata.Providers[provider]
	if version == nil || version.CommitSHA == nil || *version.CommitSHA == "" || version.CommitShortSHA == nil || *version.CommitShortSHA == "" {
		return nil
	}
	// seed metadata 是生成期记录的真实 GitHub HEAD；runtime 缺 provider current 时只能回退到它，不能编造 embedded/runtime 版本。
	return cloneBuiltInIconProviderVersion(version)
}

func cloneBuiltInIconProviderVersion(version *builtInIconProviderVersionResponse) *builtInIconProviderVersionResponse {
	if version == nil {
		return nil
	}
	clone := *version
	clone.CommitSHA = cloneStringPtr(version.CommitSHA)
	clone.CommitShortSHA = cloneStringPtr(version.CommitShortSHA)
	clone.CommitDate = cloneStringPtr(version.CommitDate)
	clone.ReleaseTag = cloneStringPtr(version.ReleaseTag)
	clone.ReleasePublishedAt = cloneStringPtr(version.ReleasePublishedAt)
	return &clone
}

func cloneStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
}

func providerStatusesFromState(counts builtInIconProviderCountsResponse, states storedBuiltInIconProviderStates, refreshingProvider string) []builtInIconIndexProviderStatusResponse {
	out := make([]builtInIconIndexProviderStatusResponse, 0, len(builtInIconProviders))
	for _, provider := range builtInIconProviders {
		state := states[provider]
		current := state.Current
		if current == nil {
			current = embeddedProviderVersion(provider)
		}
		status := builtInIconIndexProviderStatusResponse{
			Provider:        provider,
			Current:         current,
			Latest:          state.Latest,
			IconCount:       providerCount(counts, provider),
			CheckedAt:       stringPtrOrNil(state.CheckedAt),
			RefreshedAt:     stringPtrOrNil(state.RefreshedAt),
			LastError:       stringPtrOrNil(state.LastError),
			Refreshing:      refreshingProvider == provider,
			UpdateAvailable: providerUpdateAvailable(current, state.Latest),
		}
		out = append(out, status)
	}
	return out
}

func providerStatusFromResponse(status builtInIconIndexStatusResponse, provider string) builtInIconIndexProviderStatusResponse {
	for _, item := range status.Providers {
		if item.Provider == provider {
			return item
		}
	}
	return builtInIconIndexProviderStatusResponse{Provider: provider}
}

func markProviderRefreshing(status *builtInIconIndexStatusResponse, provider string) {
	status.Refreshing = true
	for index := range status.Providers {
		if status.Providers[index].Provider == provider {
			status.Providers[index].Refreshing = true
		}
	}
}

func providerStatesFromRecord(record *core.Record) storedBuiltInIconProviderStates {
	if record == nil {
		return emptyProviderStates()
	}
	states := parseProviderStates(record.Get("providerStatus"))
	for _, provider := range builtInIconProviders {
		if _, ok := states[provider]; !ok {
			states[provider] = storedBuiltInIconProviderState{}
		}
	}
	return states
}

func parseProviderStates(value any) storedBuiltInIconProviderStates {
	if value == nil {
		return emptyProviderStates()
	}
	raw, err := json.Marshal(value)
	if err != nil || len(raw) > builtInIconProviderStatusMaxBytes {
		return emptyProviderStates()
	}
	var states storedBuiltInIconProviderStates
	if err := json.Unmarshal(raw, &states); err != nil || states == nil {
		return emptyProviderStates()
	}
	return states
}

func emptyProviderStates() storedBuiltInIconProviderStates {
	states := storedBuiltInIconProviderStates{}
	for _, provider := range builtInIconProviders {
		states[provider] = storedBuiltInIconProviderState{}
	}
	return states
}

func providerCDNBaseOverridesFromStates(states storedBuiltInIconProviderStates) map[string]string {
	out := map[string]string{}
	for provider, state := range states {
		if state.Current != nil && state.Current.CommitSHA != nil && *state.Current.CommitSHA != "" {
			out[provider] = mediaResolverBuiltInProviderPinnedBase(provider, *state.Current.CommitSHA)
		}
	}
	return out
}

func acquireBuiltInIconIndexOperation(provider string) bool {
	if !builtInIconIndexRefreshMu.TryLock() {
		return false
	}
	builtInIconIndexRefreshingProvider.Lock()
	builtInIconIndexRefreshingProvider.provider = provider
	builtInIconIndexRefreshingProvider.Unlock()
	return true
}

func releaseBuiltInIconIndexOperation() {
	builtInIconIndexRefreshingProvider.Lock()
	builtInIconIndexRefreshingProvider.provider = ""
	builtInIconIndexRefreshingProvider.Unlock()
	builtInIconIndexRefreshMu.Unlock()
}

func currentBuiltInIconIndexRefreshingProvider() string {
	builtInIconIndexRefreshingProvider.RLock()
	defer builtInIconIndexRefreshingProvider.RUnlock()
	return builtInIconIndexRefreshingProvider.provider
}

func validBuiltInIconProvider(provider string) bool {
	for _, item := range builtInIconProviders {
		if item == provider {
			return true
		}
	}
	return false
}

func providerUpdateAvailable(current *builtInIconProviderVersionResponse, latest *builtInIconProviderVersionResponse) bool {
	if latest == nil {
		return false
	}
	if current == nil {
		return true
	}
	if current.CommitSHA != nil && latest.CommitSHA != nil {
		return *current.CommitSHA != *latest.CommitSHA
	}
	return current.SourceRef != latest.SourceRef
}

func providerCount(counts builtInIconProviderCountsResponse, provider string) int {
	switch provider {
	case "thesvg":
		return counts.TheSVG
	case "selfhst":
		return counts.Selfhst
	case "dashboardIcons":
		return counts.DashboardIcons
	default:
		return 0
	}
}

func providerCountsMap(icons []builtInIcon) map[string]int {
	counts := map[string]int{"thesvg": 0, "selfhst": 0, "dashboardIcons": 0}
	for _, icon := range icons {
		counts[icon.Provider] += 1
	}
	return counts
}

func providerCountsResponse(icons []builtInIcon) builtInIconProviderCountsResponse {
	return providerCountsResponseFromMap(providerCountsMap(icons))
}

func providerCountsResponseFromMap(counts map[string]int) builtInIconProviderCountsResponse {
	return builtInIconProviderCountsResponse{
		TheSVG:         counts["thesvg"],
		Selfhst:        counts["selfhst"],
		DashboardIcons: counts["dashboardIcons"],
	}
}

func providerCountsResponseFromValue(value any) builtInIconProviderCountsResponse {
	if counts, ok := value.(map[string]any); ok {
		return builtInIconProviderCountsResponse{
			TheSVG:         intFromAny(counts["thesvg"]),
			Selfhst:        intFromAny(counts["selfhst"]),
			DashboardIcons: intFromAny(counts["dashboardIcons"]),
		}
	}
	if counts, ok := value.(map[string]int); ok {
		return providerCountsResponseFromMap(counts)
	}
	raw, err := json.Marshal(value)
	if err == nil {
		counts := map[string]int{}
		if err := json.Unmarshal(raw, &counts); err == nil {
			return providerCountsResponseFromMap(counts)
		}
	}
	return builtInIconProviderCountsResponse{}
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	default:
		return 0
	}
}

func stringPtrOrNil(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func truncateText(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}
