// Package argus talks to a team server (argus-server): signing in with the
// server's own login, then reading and writing the team's shared data.
//
// The server is optional. Without one the app works from a settings file and
// a Jira token, as before. Nothing in this package names a real server: the
// address comes from the user at first run.
//
// The paths and the shapes of the answers follow the server's desk API
// (version 1). The app tells answers apart by their "code", never by their
// wording.
package argus

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Endpoints are the server's paths. They are settings, not constants, so a
// change on the server needs no new build.
type Endpoints struct {
	Authorize string // browser sign-in page
	Token     string // code and refresh-token exchange
	Revoke    string // "" = the server has none
	API       string // prefix of the desk API
	ClientID  string // public: the app holds no secret
	Scope     string
}

// DefaultEndpoints are the server's desk API, version 1.
func DefaultEndpoints() Endpoints {
	return Endpoints{
		Authorize: "/desk/authorize",
		Token:     "/api/desk/v1/oauth/token",
		Revoke:    "/api/desk/v1/oauth/revoke",
		API:       "/api/desk/v1",
		ClientID:  "argus-desk", // fixed on the server, and no secret: anyone may know it
	}
}

// JiraKeyPage is where a user registers their own Jira key, in the browser.
const JiraKeyPage = "/desk/my"

// Errors the app tells apart.
var (
	ErrDisabled     = errors.New("서버에서 ArgusDesk 연동이 꺼져 있습니다")
	ErrUnauthorized = errors.New("Argus 로그인이 필요합니다")
	ErrForbidden    = errors.New("ArgusDesk는 서버 관리자만 쓸 수 있습니다. 이 계정에는 권한이 없습니다")
	ErrLocked       = errors.New("서버 계정이 잠겨 있습니다. 서버에 로그인해 잠금을 풀어 주세요")
	ErrNoSite       = errors.New("서버에 Jira 사이트 주소가 정해져 있지 않습니다. 서버 관리자에게 알려 주세요")
	ErrBusy         = errors.New("요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요")
	ErrNotFound     = errors.New("서버에 아직 등록된 것이 없습니다")
	ErrConflict     = errors.New("이미 다른 사람이 등록한 값입니다")
)

// CleanBase checks and tidies the server address the user typed. Only https
// is accepted, except for a server on this computer (development).
func CleanBase(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("서버 주소를 입력하세요")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", errors.New("서버 주소를 읽을 수 없습니다")
	}
	if u.User != nil {
		return "", errors.New("주소에 계정 정보를 넣을 수 없습니다")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && isLoopback(u.Hostname())) {
		return "", errors.New("https 주소만 쓸 수 있습니다")
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("주소는 %s://%s 까지만 입력하세요", u.Scheme, u.Host)
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// SameHost reports whether target lies on the server at base: a link from
// the server is only opened when it does.
func SameHost(base, target string) bool {
	b, err1 := url.Parse(base)
	t, err2 := url.Parse(target)
	return err1 == nil && err2 == nil && t.Scheme == b.Scheme && strings.EqualFold(t.Host, b.Host)
}
