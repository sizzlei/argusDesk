// Package secret keeps the Jira API token in the operating system's
// credential store (macOS Keychain, Windows Credential Manager) and the
// non-secret preferences in a small file. Operating-system differences for
// credentials stay inside this package.
package secret

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/zalando/go-keyring"
)

const service = "argusDesk"

// ErrNoToken means nothing is stored for that site and e-mail.
var ErrNoToken = errors.New("저장된 토큰이 없습니다")

func account(site, email string) string { return "jira:" + site + ":" + email }

// SaveToken stores the token for a site and e-mail.
func SaveToken(site, email, token string) error {
	return keyring.Set(service, account(site, email), token)
}

// LoadToken returns the stored token, or ErrNoToken.
func LoadToken(site, email string) (string, error) {
	t, err := keyring.Get(service, account(site, email))
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNoToken
	}
	return t, err
}

// DeleteToken removes the stored token (no error if there is none).
func DeleteToken(site, email string) error {
	err := keyring.Delete(service, account(site, email))
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

// The team server's sign-in (a JSON blob: access and refresh tokens) is kept
// the same way, under the server's address.
func serverAccount(base string) string { return "argus:" + base }

// SaveServerToken stores the sign-in for the team server at base.
func SaveServerToken(base, blob string) error {
	return keyring.Set(service, serverAccount(base), blob)
}

// LoadServerToken returns the stored sign-in, or ErrNoToken.
func LoadServerToken(base string) (string, error) {
	t, err := keyring.Get(service, serverAccount(base))
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNoToken
	}
	return t, err
}

// DeleteServerToken removes the stored sign-in (no error if there is none).
func DeleteServerToken(base string) error {
	err := keyring.Delete(service, serverAccount(base))
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

// Prefs are this person's settings on this computer. Nothing here is secret
// and no ticket data is ever written.
type Prefs struct {
	ConfigPath      string `json:"configPath"`      // where the shared settings file lives
	Site            string `json:"site"`            // Jira site last signed in to
	Email           string `json:"email"`           // Jira e-mail last signed in with
	LastUpdateCheck int64  `json:"lastUpdateCheck"` // unix ms
	NotesShownFor   string `json:"notesShownFor"`   // version whose release notes were shown
	NotifyOff       bool   `json:"notifyOff"`       // the user turned notifications off
	VacationFrom    string `json:"vacationFrom"`    // own holiday, "2026-12-01"; used when the team has no shared ticket
	VacationTo      string `json:"vacationTo"`
	Avatar          int    `json:"avatar"` // chosen look + 1; 0 = not chosen
	Server          string `json:"server"` // team server address ("" = none: settings file and Jira token)
}

// Dir is the folder argusDesk keeps its own files in.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "argusDesk")
	return dir, os.MkdirAll(dir, 0o700)
}

func prefsPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "prefs.json"), nil
}

// LoadPrefs reads the preferences; a missing file gives empty preferences.
func LoadPrefs() (*Prefs, error) {
	p := &Prefs{}
	path, err := prefsPath()
	if err != nil {
		return p, err
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err := json.Unmarshal(b, p); err != nil {
		return &Prefs{}, nil // a damaged file is treated as a first run
	}
	return p, nil
}

// SavePrefs writes the preferences.
func SavePrefs(p *Prefs) error {
	path, err := prefsPath()
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// LastGoodConfigPath is where a copy of the last settings file that loaded
// correctly is kept, so a broken edit does not stop the app from opening.
func LastGoodConfigPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "last-good-config.yaml"), nil
}
