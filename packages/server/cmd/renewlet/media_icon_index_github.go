package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func checkLatestBuiltInIconProviderVersion(ctx context.Context, app core.App, provider string) (*builtInIconProviderVersionResponse, string, error) {
	record, _ := findMediaIconIndexRecord(app)
	state := providerStatesFromRecord(record)[provider]
	version, etag, notModified, err := fetchLatestBuiltInIconProviderVersion(ctx, provider, state.ETag)
	if err != nil {
		return nil, "", err
	}
	if notModified && state.Latest != nil {
		return state.Latest, etag, nil
	}
	if version == nil {
		return nil, "", errors.New("latest provider version is unavailable")
	}
	return version, etag, nil
}

func fetchLatestBuiltInIconProviderVersion(ctx context.Context, provider string, etag string) (*builtInIconProviderVersionResponse, string, bool, error) {
	config, ok := mediaResolverBuiltInProviderConfig(provider)
	if !ok {
		return nil, "", false, fmt.Errorf("unknown built-in icon provider: %s", provider)
	}
	commitURL := strings.TrimRight(builtInIconGitHubAPIBase, "/") + "/repos/" + config.Owner + "/" + config.Repo + "/commits/" + config.Branch
	var commit struct {
		SHA    string `json:"sha"`
		Commit struct {
			Committer struct {
				Date string `json:"date"`
			} `json:"committer"`
		} `json:"commit"`
	}
	nextETag, notModified, err := fetchGitHubJSON(ctx, commitURL, etag, &commit)
	if err != nil {
		return nil, nextETag, false, err
	}
	if notModified {
		return nil, nextETag, true, nil
	}
	if commit.SHA == "" {
		return nil, nextETag, false, errors.New("GitHub commit response missing sha")
	}
	shortSHA := commit.SHA
	if len(shortSHA) > 7 {
		shortSHA = shortSHA[:7]
	}
	version := &builtInIconProviderVersionResponse{
		SourceRef:          commit.SHA,
		DisplayVersion:     shortSHA,
		CommitSHA:          stringPtrOrNil(commit.SHA),
		CommitShortSHA:     stringPtrOrNil(shortSHA),
		CommitDate:         stringPtrOrNil(commit.Commit.Committer.Date),
		ReleaseTag:         nil,
		ReleasePublishedAt: nil,
	}
	if config.LatestRelease {
		tag, publishedAt := fetchLatestBuiltInIconRelease(ctx, config.Owner, config.Repo)
		if tag != "" {
			version.ReleaseTag = &tag
		}
		if publishedAt != "" {
			version.ReleasePublishedAt = &publishedAt
		}
	}
	return version, nextETag, false, nil
}

func fetchGitHubJSON(ctx context.Context, url string, etag string, target any) (string, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Renewlet/"+Version)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if token := strings.TrimSpace(os.Getenv("RENEWLET_GITHUB_TOKEN")); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: builtInIconGitHubFetchTimeout}
	res, err := client.Do(req)
	if err != nil {
		secrets := []string{}
		if token := strings.TrimSpace(os.Getenv("RENEWLET_GITHUB_TOKEN")); token != "" {
			secrets = append(secrets, token)
		}
		return "", false, createUpstreamNetworkError("GitHub", err, secrets)
	}
	defer res.Body.Close()
	nextETag := res.Header.Get("ETag")
	if res.StatusCode == http.StatusNotModified {
		return nextETag, true, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nextETag, false, gitHubVersionCheckHTTPError(res)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, builtInIconRegistryJSONLimitBytes+1))
	if err != nil {
		return nextETag, false, err
	}
	if len(data) > builtInIconRegistryJSONLimitBytes {
		return nextETag, false, errors.New("GitHub version check response too large")
	}
	if err := json.Unmarshal(data, target); err != nil {
		return nextETag, false, err
	}
	return nextETag, false, nil
}

func gitHubVersionCheckHTTPError(res *http.Response) error {
	secrets := []string{}
	if token := strings.TrimSpace(os.Getenv("RENEWLET_GITHUB_TOKEN")); token != "" {
		secrets = append(secrets, token)
	}
	providerResponse, _, err := captureUpstreamProviderResponse(res, secrets)
	if err != nil {
		return err
	}
	providerMessage := upstreamProviderMessage(providerResponse)
	if res.StatusCode == http.StatusTooManyRequests || (res.StatusCode == http.StatusForbidden && res.Header.Get("X-RateLimit-Remaining") == "0") {
		message := fmt.Sprintf("GitHub API rate limited (HTTP %d). Configure RENEWLET_GITHUB_TOKEN for a higher limit", res.StatusCode)
		if retryHint := gitHubRateLimitRetryHint(res); retryHint != "" {
			message = fmt.Sprintf("GitHub API rate limited (HTTP %d). %s Configure RENEWLET_GITHUB_TOKEN for a higher limit", res.StatusCode, retryHint)
		}
		return newUpstreamOperationError(message, createUpstreamErrorDetails(providerResponse, fallbackText(providerMessage, message)))
	}
	if res.StatusCode == http.StatusForbidden {
		message := "GitHub API access denied (HTTP 403). Configure RENEWLET_GITHUB_TOKEN or retry later"
		return newUpstreamOperationError(message, createUpstreamErrorDetails(providerResponse, fallbackText(providerMessage, message)))
	}
	return createUpstreamHTTPError("GitHub", res, providerResponse, fallbackText(providerMessage, fmt.Sprintf("GitHub version check HTTP %d", res.StatusCode)))
}

func gitHubRateLimitRetryHint(res *http.Response) string {
	if retryAfter := strings.TrimSpace(res.Header.Get("Retry-After")); retryAfter != "" {
		return "Retry after " + retryAfter + "s."
	}
	resetRaw := strings.TrimSpace(res.Header.Get("X-RateLimit-Reset"))
	if resetRaw == "" {
		return ""
	}
	resetUnix, err := strconv.ParseInt(resetRaw, 10, 64)
	if err != nil || resetUnix <= 0 {
		return ""
	}
	return "Retry after " + time.Unix(resetUnix, 0).UTC().Format(time.RFC3339) + "."
}

func fetchLatestBuiltInIconRelease(ctx context.Context, owner string, repo string) (string, string) {
	url := strings.TrimRight(builtInIconGitHubAPIBase, "/") + "/repos/" + owner + "/" + repo + "/releases/latest"
	var release struct {
		TagName     string `json:"tag_name"`
		PublishedAt string `json:"published_at"`
	}
	_, _, err := fetchGitHubJSON(ctx, url, "", &release)
	if err != nil {
		return "", ""
	}
	return strings.TrimSpace(release.TagName), strings.TrimSpace(release.PublishedAt)
}

type builtInIconProviderGitHubConfig struct {
	Owner         string
	Repo          string
	Branch        string
	LatestRelease bool
}

func mediaResolverBuiltInProviderConfig(provider string) (builtInIconProviderGitHubConfig, bool) {
	for _, item := range mediaResolverCfg.BuiltInProviders {
		if item.Provider == provider {
			return builtInIconProviderGitHubConfig{
				Owner:         item.GitHub.Owner,
				Repo:          item.GitHub.Repo,
				Branch:        item.GitHub.Branch,
				LatestRelease: item.GitHub.LatestRelease,
			}, true
		}
	}
	return builtInIconProviderGitHubConfig{}, false
}
