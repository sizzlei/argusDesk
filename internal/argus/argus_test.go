package argus

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCleanBase(t *testing.T) {
	ok := map[string]string{
		"argus.example":            "https://argus.example",
		" https://Argus.Example/ ": "https://argus.example",
		"http://localhost:3000":    "http://localhost:3000",
		"http://127.0.0.1:3000":    "http://127.0.0.1:3000",
	}
	for in, want := range ok {
		if got, err := CleanBase(in); err != nil || got != want {
			t.Errorf("CleanBase(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "http://argus.example", "ftp://argus.example", "https://user:pw@argus.example", "https://argus.example/login", "https://argus.example?x=1", "https://"} {
		if got, err := CleanBase(in); err == nil {
			t.Errorf("CleanBase(%q) = %q, want an error", in, got)
		}
	}
}

func TestSameHost(t *testing.T) {
	if !SameHost("https://argus.example", "https://argus.example/notifications?id=1") {
		t.Error("a page on the server was refused")
	}
	for _, target := range []string{"https://evil.example/", "http://argus.example/", "https://argus.example.evil.example/", "javascript:alert(1)"} {
		if SameHost("https://argus.example", target) {
			t.Errorf("%q passed as the server's own", target)
		}
	}
}

// fake is a made-up team server: the sign-in pages and a little of the desk API.
type fake struct {
	*httptest.Server
	mu        sync.Mutex
	challenge string // PKCE challenge of the code in flight
	redirect  string
	access    string // the access token that is valid now
	renewals  int
	disabled  bool
	lastAuth  string
}

func newFake(t *testing.T) *fake {
	f := &fake{access: "access-1"}
	mux := http.NewServeMux()
	mux.HandleFunc("/desk/authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("client_id") != "argus-desk" || q.Get("code_challenge_method") != "S256" || q.Get("response_type") != "code" {
			t.Errorf("authorize query: %v", q)
		}
		u, _ := url.Parse(q.Get("redirect_uri"))
		if u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
			t.Errorf("redirect not to this computer: %s", q.Get("redirect_uri"))
		}
		f.mu.Lock()
		f.challenge, f.redirect = q.Get("code_challenge"), q.Get("redirect_uri")
		f.mu.Unlock()
		http.Redirect(w, r, q.Get("redirect_uri")+"?code=code-1&state="+url.QueryEscape(q.Get("state")), http.StatusFound)
	})
	mux.HandleFunc("/api/desk/v1/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		f.mu.Lock()
		defer f.mu.Unlock()
		switch r.Form.Get("grant_type") {
		case "authorization_code":
			sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if r.Form.Get("code") != "code-1" || base64.RawURLEncoding.EncodeToString(sum[:]) != f.challenge || r.Form.Get("redirect_uri") != f.redirect {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
		case "refresh_token":
			if r.Form.Get("refresh_token") != "refresh-1" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			f.renewals++
			f.access = "access-2"
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"access_token": f.access, "token_type": "Bearer", "refresh_token": "refresh-1", "expires_in": 3600, "scope": "desk"})
	})
	api := func(path string, h http.HandlerFunc) {
		mux.HandleFunc("/api/desk/v1"+path, func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			off, want := f.disabled, "Bearer "+f.access
			f.lastAuth = r.Header.Get("Authorization")
			f.mu.Unlock()
			if off {
				fail(w, http.StatusNotFound, "desk_disabled")
				return
			}
			if r.Header.Get("Authorization") != want {
				// what the server holds as expired is renewed; anything else is unknown to it
				code := "token_invalid"
				if r.Header.Get("Authorization") == "Bearer access-1" || r.Header.Get("Authorization") == "Bearer old" {
					code = "token_expired"
				}
				fail(w, http.StatusUnauthorized, code)
				return
			}
			h(w, r)
		})
	}
	api("/team", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == `"t1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"t1"`)
		ok(w, Team{Members: []Member{{JiraAccountID: "u1"}}, Vacations: []Away{{JiraAccountID: "u2", From: "2026-12-01", To: "2026-12-05", Kind: "연차", Cover: "u1"}}})
	})
	api("/me/jira", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "jira_not_registered")
	})
	api("/calendar", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "calendar_not_registered")
	})
	api("/feed", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"status":"success","data":{"notifications":[{"id":812,"categoryName":"유지관리 예정","severity":"warn","title":"db-orders 유지관리 예정","target":{"type":"rds","identifier":"db-orders","accountName":"prod"},"link":"/databases/db-ABC","changedAt":"2026-11-26T09:30:00+09:00"}],"total":1,"system":{"status":"ok","link":"/system-status"}}}`)
	})
	mux.HandleFunc("/api/desk/v1/status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		off := f.disabled
		f.mu.Unlock()
		ok(w, Status{Enabled: !off, APIVersion: 1, ServerVersion: "test"})
	})
	api("/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			fail(w, http.StatusConflict, "jira_account_conflict")
			return
		}
		ok(w, Me{JiraAccountID: "u1"})
	})
	api("/me/presence", func(w http.ResponseWriter, r *http.Request) {
		var in Spot
		if r.Method == http.MethodPut && (json.NewDecoder(r.Body).Decode(&in) != nil || in.Space != "dt") {
			fail(w, http.StatusBadRequest, "invalid_request")
			return
		}
		ok(w, map[string]any{"presence": nil})
	})
	api("/team/presence", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == `"presence-1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"presence-1"`)
		io.WriteString(w, `{"status":"success","data":{"members":[{"jiraAccountId":"u1","space":"dt","zone":"review","box":"REQ-1","updatedAt":"2026-11-28T10:12:03+09:00"}]}}`)
	})
	api("/config", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://elsewhere.example/config", http.StatusFound)
	})
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

// ok and fail answer the way the server's desk API does.
func ok(w http.ResponseWriter, data any) {
	json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": data})
}

func fail(w http.ResponseWriter, status int, code string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"status": "error", "error": "사람이 읽는 문구", "code": code})
}

// browser plays the user's browser: it opens the sign-in page and follows it back to the app.
func browser(t *testing.T) func(string) error {
	return func(u string) error {
		go func() {
			res, err := http.Get(u)
			if err != nil {
				t.Errorf("browser: %v", err)
				return
			}
			res.Body.Close()
		}()
		return nil
	}
}

func TestLoginAndCalls(t *testing.T) {
	f := newFake(t)
	ep := DefaultEndpoints()
	tok, err := Login(context.Background(), f.URL, ep, browser(t))
	if err != nil {
		t.Fatal(err)
	}
	if tok.Access != "access-1" || tok.Refresh != "refresh-1" || !tok.Fresh(time.Now()) {
		t.Fatalf("token: %+v", tok)
	}

	var stored *Token
	c := New(f.URL, ep, tok, func(t *Token) { stored = t })
	etag := ""
	team, changed, err := c.Team(context.Background(), &etag)
	if err != nil || !changed || len(team.Members) != 1 || team.Vacations[0].To != "2026-12-05" || team.Vacations[0].Kind != "연차" || etag != `"t1"` {
		t.Fatalf("team: %+v %v %v %q", team, changed, err, etag)
	}
	if _, changed, err := c.Team(context.Background(), &etag); err != nil || changed {
		t.Fatalf("an unchanged team was read again: %v %v", changed, err)
	}

	if st, err := ServerStatus(context.Background(), f.URL, ep); err != nil || !st.Enabled || st.APIVersion != 1 {
		t.Fatalf("status: %+v %v", st, err)
	}
	feed, _, err := c.Feed(context.Background(), nil)
	if err != nil || len(feed.Notices) != 1 || feed.Notices[0].Target.Identifier != "db-orders" || feed.Notices[0].Link != "/databases/db-ABC" || feed.System == nil || feed.System.Status != "ok" {
		t.Fatalf("feed: %+v %v", feed, err)
	}
	if _, err := c.Calendar(context.Background()); !errors.Is(err, ErrNotFound) {
		t.Errorf("no calendar on the server: %v", err)
	}
	if err := c.SetPresence(context.Background(), Spot{Space: "dt", Zone: "review", Box: "REQ-1"}); err != nil {
		t.Fatalf("presence: %v", err)
	}
	ptag := ""
	spots, changed, err := c.TeamPresence(context.Background(), &ptag)
	if err != nil || !changed || len(spots) != 1 || spots[0].Zone != "review" || spots[0].Box != "REQ-1" || ptag != `"presence-1"` {
		t.Fatalf("team presence: %+v %v %v %q", spots, changed, err, ptag)
	}
	if _, changed, err := c.TeamPresence(context.Background(), &ptag); err != nil || changed {
		t.Fatalf("unchanged places were read again: %v %v", changed, err)
	}
	if err := c.ClearPresence(context.Background()); err != nil {
		t.Fatalf("leaving: %v", err)
	}

	// The access token runs out ("token_expired"): the client renews once and carries on.
	f.mu.Lock()
	f.access = "access-rotated"
	f.mu.Unlock()
	if _, err := c.Me(context.Background()); err != nil {
		t.Fatalf("after renewal: %v", err)
	}
	if f.renewals != 1 || stored == nil || stored.Access != "access-2" {
		t.Fatalf("renewals %d, stored %+v", f.renewals, stored)
	}

	if _, err := c.JiraKey(context.Background()); !errors.Is(err, ErrNotFound) {
		t.Errorf("no Jira key registered: %v", err)
	}
	if err := c.SetMe(context.Background(), "u9", nil); !errors.Is(err, ErrConflict) {
		t.Errorf("another person's account: %v", err)
	}
	// A redirect is not followed, so the token never reaches another host.
	if _, _, err := c.Config(context.Background(), nil); err == nil {
		t.Error("a redirect was followed")
	}

	f.mu.Lock()
	f.disabled = true
	f.mu.Unlock()
	if _, _, err := c.Team(context.Background(), nil); !errors.Is(err, ErrDisabled) {
		t.Errorf("feature off: %v", err)
	}
}

func TestLoginRefusesAForeignAnswer(t *testing.T) {
	f := newFake(t)
	// Someone else answers the app's listener with a state of their own.
	open := func(u string) error {
		q, _ := url.Parse(u)
		cb := q.Query().Get("redirect_uri")
		go func() {
			res, err := http.Get(cb + "?code=stolen&state=guess")
			if err == nil {
				res.Body.Close()
			}
		}()
		return nil
	}
	if _, err := Login(context.Background(), f.URL, DefaultEndpoints(), open); err == nil || !strings.Contains(err.Error(), "이 요청의 것이 아닙니다") {
		t.Fatalf("a foreign answer was accepted: %v", err)
	}
}

func TestLoginTimesOut(t *testing.T) {
	old := LoginTimeout
	LoginTimeout = 50 * time.Millisecond
	defer func() { LoginTimeout = old }()
	f := newFake(t)
	if _, err := Login(context.Background(), f.URL, DefaultEndpoints(), func(string) error { return nil }); err == nil {
		t.Fatal("no timeout")
	}
}

func TestExpiredSignInIsForgotten(t *testing.T) {
	f := newFake(t)
	lost := false
	c := New(f.URL, DefaultEndpoints(), &Token{Access: "old", Refresh: "gone"}, func(t *Token) { lost = t == nil })
	if _, err := c.Me(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want sign-in needed, got %v", err)
	}
	if !lost {
		t.Error("the dead token was not dropped")
	}
}

func TestRenewWithoutAnswerAsksForSignIn(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	lost := false
	stale := &Token{Access: "a", Refresh: "r", Expires: time.Now().Add(-time.Minute)}
	c := New(srv.URL, DefaultEndpoints(), stale, func(t *Token) { lost = t == nil })
	_, err := c.Me(context.Background())
	if !errors.Is(err, ErrRenew) || errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v", err)
	}
	if lost {
		t.Fatal("the kept sign-in was thrown away")
	}
}
