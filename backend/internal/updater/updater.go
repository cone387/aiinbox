// Package updater provides self-update checking via GitHub Releases API.
package updater

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Version is set at build time via ldflags:
//
//	-ldflags "-X github.com/cone387/aiinbox/backend/internal/updater.Version=v0.0.0-dev"
var Version = "dev"

const (
	githubRepo    = "cone387/aiinbox"
	releaseAPIURL = "https://api.github.com/repos/" + githubRepo + "/releases/latest"
	releaseURL    = "https://github.com/" + githubRepo + "/releases/latest"
)

// ReleaseInfo holds the latest release metadata from GitHub.
type ReleaseInfo struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Name       string `json:"name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Body       string `json:"body"` // release notes
}

// CheckResult is the outcome of an update check.
type CheckResult struct {
	Current     string
	Latest      string
	UpdateURL   string
	HasUpdate   bool
	ReleaseName string
	ReleaseBody string
}

// Check queries the GitHub Releases API and compares versions.
func Check() (*CheckResult, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", releaseAPIURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "AIInbox-Desktop/"+Version)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch release info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	var release ReleaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if release.Draft || release.Prerelease {
		return &CheckResult{
			Current:   Version,
			Latest:    Version,
			HasUpdate: false,
		}, nil
	}

	latestTag := strings.TrimPrefix(release.TagName, "v")
	currentTag := strings.TrimPrefix(Version, "v")

	result := &CheckResult{
		Current:     Version,
		Latest:      release.TagName,
		UpdateURL:   release.HTMLURL,
		ReleaseName: release.Name,
		ReleaseBody: release.Body,
		HasUpdate:   compareVersions(currentTag, latestTag) < 0,
	}

	if result.UpdateURL == "" {
		result.UpdateURL = releaseURL
	}

	return result, nil
}

// compareVersions does a simple semver comparison (major.minor.patch).
// Returns -1 if a < b, 0 if a == b, 1 if a > b.
func compareVersions(a, b string) int {
	partsA := strings.SplitN(a, ".", 3)
	partsB := strings.SplitN(b, ".", 3)

	for i := 0; i < 3; i++ {
		var va, vb int
		if i < len(partsA) {
			fmt.Sscanf(partsA[i], "%d", &va)
		}
		if i < len(partsB) {
			fmt.Sscanf(partsB[i], "%d", &vb)
		}
		if va < vb {
			return -1
		}
		if va > vb {
			return 1
		}
	}
	return 0
}
