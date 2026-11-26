package argus

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Token is what a sign-in yields. It is kept in the operating system's
// credential store and never written to a file or a log.
type Token struct {
	Access  string    `json:"access"`
	Refresh string    `json:"refresh,omitempty"`
	Expires time.Time `json:"expires"` // zero = the server did not say
}

// Fresh reports whether the access token can still be used for a while.
func (t *Token) Fresh(now time.Time) bool {
	return t != nil && t.Access != "" && (t.Expires.IsZero() || now.Add(time.Minute).Before(t.Expires))
}

// LoginTimeout is how long the app waits for the browser to come back.
var LoginTimeout = 3 * time.Minute

func random(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // no randomness: nothing safe can be done
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Login signs in through the browser: the app listens on this computer only,
// opens the server's sign-in page, and trades the code that comes back for a
// token (authorization code with PKCE; the app holds no secret).
// open shows a URL in the user's browser.
func Login(ctx context.Context, base string, ep Endpoints, open func(url string) error) (*Token, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0") // this computer only, any free port
	if err != nil {
		return nil, fmt.Errorf("로그인 응답을 받을 준비를 하지 못했습니다: %w", err)
	}
	defer ln.Close()
	redirect := fmt.Sprintf("http://127.0.0.1:%d/callback", ln.Addr().(*net.TCPAddr).Port)
	state, verifier := random(24), random(48)
	sum := sha256.Sum256([]byte(verifier))

	type result struct {
		code string
		err  error
	}
	got := make(chan result, 1)
	srv := &http.Server{ReadHeaderTimeout: 10 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/callback" || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		q := r.URL.Query()
		var res result
		switch {
		case subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(state)) != 1:
			res.err = errors.New("로그인 응답이 이 요청의 것이 아닙니다")
		case q.Get("error") != "":
			res.err = fmt.Errorf("로그인이 거부되었습니다: %s", q.Get("error"))
		case q.Get("code") == "":
			res.err = errors.New("로그인 응답에 코드가 없습니다")
		default:
			res.code = q.Get("code")
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		msg := "로그인했습니다. 이 창을 닫고 ArgusDesk로 돌아가세요."
		if res.err != nil {
			msg = res.err.Error()
		}
		fmt.Fprintf(w, "<!doctype html><meta charset=utf-8><title>ArgusDesk</title><p style=\"font:16px sans-serif;margin:3em\">%s</p>", html.EscapeString(msg))
		select {
		case got <- res: // only the first answer counts
		default:
		}
	})}
	go srv.Serve(ln)
	defer srv.Close()

	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {ep.ClientID},
		"redirect_uri":          {redirect},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
	if ep.Scope != "" {
		q.Set("scope", ep.Scope)
	}
	if err := open(base + ep.Authorize + "?" + q.Encode()); err != nil {
		return nil, fmt.Errorf("브라우저를 열지 못했습니다: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, LoginTimeout)
	defer cancel()
	select {
	case <-ctx.Done():
		return nil, errors.New("로그인을 기다리다 시간이 지났습니다. 브라우저에서 로그인을 마쳤는데도 넘어오지 않았다면 한 번 더 시도해 주세요")
	case res := <-got:
		if res.err != nil {
			return nil, res.err
		}
		return exchange(ctx, base, ep, url.Values{
			"grant_type":    {"authorization_code"},
			"code":          {res.code},
			"redirect_uri":  {redirect},
			"client_id":     {ep.ClientID},
			"code_verifier": {verifier},
		})
	}
}

// Renew trades the refresh token for a new token. ErrUnauthorized means the
// user has to sign in again.
func Renew(ctx context.Context, base string, ep Endpoints, t *Token) (*Token, error) {
	if t == nil || t.Refresh == "" {
		return nil, ErrUnauthorized
	}
	next, err := exchange(ctx, base, ep, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {t.Refresh},
		"client_id":     {ep.ClientID},
	})
	if err != nil {
		return nil, err
	}
	if next.Refresh == "" {
		next.Refresh = t.Refresh // the server kept the old one
	}
	return next, nil
}

// Revoke tells the server the tokens are no longer wanted (sign-out). A
// server without a revoke path is fine: the tokens are forgotten locally.
func Revoke(ctx context.Context, base string, ep Endpoints, t *Token) {
	if t == nil || ep.Revoke == "" {
		return
	}
	for _, tok := range []string{t.Refresh, t.Access} {
		if tok == "" {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+ep.Revoke, strings.NewReader(url.Values{"token": {tok}, "client_id": {ep.ClientID}}.Encode()))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if res, err := httpClient.Do(req); err == nil {
			res.Body.Close()
		}
	}
}

func exchange(ctx context.Context, base string, ep Endpoints, form url.Values) (*Token, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+ep.Token, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("서버에 연결하지 못했습니다: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		// The server says why in "code"; without one, a refused code or an
		// expired refresh token means signing in again.
		var refused struct {
			Code string `json:"code"`
		}
		_ = json.Unmarshal(body, &refused)
		if err := byCode(refused.Code); err != nil {
			return nil, err
		}
		if res.StatusCode == http.StatusBadRequest || res.StatusCode == http.StatusUnauthorized {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("토큰을 받지 못했습니다 (HTTP %d)", res.StatusCode) // the body may hold secrets: not shown
	}
	var out struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
		In      int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Access == "" {
		return nil, errors.New("서버의 토큰 응답을 읽을 수 없습니다")
	}
	t := &Token{Access: out.Access, Refresh: out.Refresh}
	if out.In > 0 {
		t.Expires = time.Now().Add(time.Duration(out.In) * time.Second)
	}
	return t, nil
}
