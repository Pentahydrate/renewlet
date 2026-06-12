package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

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
