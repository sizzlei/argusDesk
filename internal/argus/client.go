package argus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// httpClient never follows a redirect: a sign-in token must not travel to
// wherever a redirect points.
var httpClient = &http.Client{
	Timeout:       20 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// Client calls the desk API as the signed-in user.
type Client struct {
	base string
	ep   Endpoints

	mu    sync.Mutex
	token *Token
	saved func(*Token) // called when the token is renewed or lost (nil = lost)
}

// New makes a client for the server at base (already cleaned by CleanBase).
// saved is told about every new token so that it can be stored.
func New(base string, ep Endpoints, token *Token, saved func(*Token)) *Client {
	return &Client{base: base, ep: ep, token: token, saved: saved}
}

// Base is the server's address.
func (c *Client) Base() string { return c.base }

// access returns a usable access token, renewing it first when it is about to expire.
func (c *Client) access(ctx context.Context, force bool) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token == nil {
		return "", ErrUnauthorized
	}
	if !force && c.token.Fresh(time.Now()) {
		return c.token.Access, nil
	}
	next, err := Renew(ctx, c.base, c.ep, c.token)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			c.token = nil
			if c.saved != nil {
				c.saved(nil)
			}
		}
		return "", err
	}
	c.token = next
	if c.saved != nil {
		c.saved(next)
	}
	return next.Access, nil
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// do sends one request. in and out are JSON (nil = none). etag, when not
// empty, asks for the answer only if it changed; changed reports whether it did.
func (c *Client) do(ctx context.Context, method, path string, in, out any, etag *string) (changed bool, err error) {
	for attempt := 0; ; attempt++ {
		tok, err := c.access(ctx, attempt > 0)
		if err != nil {
			return false, err
		}
		var body io.Reader
		if in != nil {
			b, err := json.Marshal(in)
			if err != nil {
				return false, err
			}
			body = bytes.NewReader(b)
		}
		req, err := http.NewRequestWithContext(ctx, method, c.base+c.ep.API+path, body)
		if err != nil {
			return false, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Accept", "application/json")
		if in != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if etag != nil && *etag != "" {
			req.Header.Set("If-None-Match", *etag)
		}
		res, err := httpClient.Do(req)
		if err != nil {
			return false, fmt.Errorf("서버에 연결하지 못했습니다: %w", err)
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		res.Body.Close()
		switch {
		case res.StatusCode == http.StatusNotModified:
			return false, nil
		case res.StatusCode == http.StatusUnauthorized && attempt == 0:
			continue // the token may just have expired: renew once and try again
		case res.StatusCode >= 200 && res.StatusCode < 300:
			if etag != nil {
				*etag = res.Header.Get("ETag")
			}
			if out != nil && len(raw) > 0 {
				if err := json.Unmarshal(raw, out); err != nil {
					return false, errors.New("서버의 응답을 읽을 수 없습니다")
				}
			}
			return true, nil
		}
		var ae apiError
		_ = json.Unmarshal(raw, &ae)
		switch {
		case ae.Code == "desk_disabled" || res.StatusCode == http.StatusServiceUnavailable:
			return false, ErrDisabled
		case res.StatusCode == http.StatusUnauthorized:
			return false, ErrUnauthorized
		case res.StatusCode == http.StatusForbidden:
			return false, ErrForbidden
		case res.StatusCode == http.StatusNotFound:
			return false, ErrNotFound
		case res.StatusCode == http.StatusConflict:
			return false, ErrConflict
		}
		if ae.Message != "" {
			return false, fmt.Errorf("서버가 요청을 받지 않았습니다: %s", ae.Message)
		}
		return false, fmt.Errorf("서버가 요청을 받지 않았습니다 (HTTP %d)", res.StatusCode)
	}
}

// Me is the signed-in user's own state on the server.
type Me struct {
	JiraAccountID string `json:"jiraAccountId"`
	JiraReady     bool   `json:"jiraRegistered"` // a Jira key is registered on the server
	Avatar        *int   `json:"avatar"`
	Vacation      *Span  `json:"vacation"`
}

// Span is a holiday: both days included, "2026-12-01".
type Span struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Kind  string `json:"kind,omitempty"`  // "연차", "오전반차", ...
	Cover string `json:"cover,omitempty"` // Jira account id of whoever covers
}

// JiraKey is what the app signs in to Jira with. It is held in memory and
// in the credential store only.
type JiraKey struct {
	Site  string `json:"site"`
	Email string `json:"email"`
	Token string `json:"token"`
}

// Member is one teammate as the server knows them. No names: those come from Jira.
type Member struct {
	JiraAccountID string `json:"jiraAccountId"`
	Avatar        *int   `json:"avatar"`
	LastSeenAt    string `json:"lastSeenAt"`
}

// Away is one teammate's holiday.
type Away struct {
	JiraAccountID string `json:"jiraAccountId"`
	From          string `json:"from"`
	To            string `json:"to"`
	Kind          string `json:"kind"`
	Cover         string `json:"cover"` // Jira account id of whoever covers
}

// Team is the shared state of the team.
type Team struct {
	Members   []Member `json:"members"`
	Vacations []Away   `json:"vacations"`
}

// Config is the settings file as the server holds it.
type Config struct {
	Version   int    `json:"version"`
	YAML      string `json:"yaml"`
	Note      string `json:"note"`
	UpdatedAt string `json:"updatedAt"`
}

// Notice is one thing the server wants seen (a late backup, pending maintenance).
type Notice struct {
	Category string `json:"category"`
	Severity string `json:"severity"`
	Title    string `json:"title"`
	Target   string `json:"target"`
	At       string `json:"at"`
	Path     string `json:"path"` // a page on the server, relative to its address
}

// Feed is the server's state in brief.
type Feed struct {
	Notices []Notice `json:"notices"`
	Signal  string   `json:"signal"` // "" when this user may not see it
}

func (c *Client) Me(ctx context.Context) (*Me, error) {
	var out Me
	_, err := c.do(ctx, http.MethodGet, "/me", nil, &out, nil)
	return &out, err
}

// SetMe registers the Jira account the user signed in as, and the chosen look. Empty values are left as they are.
func (c *Client) SetMe(ctx context.Context, jiraAccountID string, avatar *int) error {
	in := map[string]any{}
	if jiraAccountID != "" {
		in["jiraAccountId"] = jiraAccountID
	}
	if avatar != nil {
		in["avatar"] = *avatar
	}
	_, err := c.do(ctx, http.MethodPut, "/me", in, nil, nil)
	return err
}

// JiraKey fetches the user's own Jira key. ErrNotFound: none is registered on the server yet.
func (c *Client) JiraKey(ctx context.Context) (*JiraKey, error) {
	var out JiraKey
	if _, err := c.do(ctx, http.MethodGet, "/me/jira", nil, &out, nil); err != nil {
		return nil, err
	}
	if out.Site == "" || out.Email == "" || out.Token == "" {
		return nil, ErrNotFound
	}
	return &out, nil
}

// CalendarKey is what the server hands out for the team's shared calendar.
type CalendarKey struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RefreshToken string `json:"refreshToken"`
	CalendarID   string `json:"calendarId"`
}

// Calendar fetches the key of the team's shared calendar. ErrNotFound: the
// server has none, and holidays are not put on a calendar.
func (c *Client) Calendar(ctx context.Context) (*CalendarKey, error) {
	var out CalendarKey
	if _, err := c.do(ctx, http.MethodGet, "/calendar", nil, &out, nil); err != nil {
		return nil, err
	}
	if out.ClientID == "" || out.RefreshToken == "" || out.CalendarID == "" {
		return nil, ErrNotFound
	}
	return &out, nil
}

func (c *Client) SetVacation(ctx context.Context, s Span) error {
	_, err := c.do(ctx, http.MethodPut, "/me/vacation", s, nil, nil)
	return err
}

func (c *Client) ClearVacation(ctx context.Context) error {
	_, err := c.do(ctx, http.MethodDelete, "/me/vacation", nil, nil, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// Team reads the team's state. With the etag of the last answer, an unchanged state costs almost nothing (changed = false).
func (c *Client) Team(ctx context.Context, etag *string) (team *Team, changed bool, err error) {
	var out Team
	changed, err = c.do(ctx, http.MethodGet, "/team", nil, &out, etag)
	if err != nil || !changed {
		return nil, false, err
	}
	return &out, true, nil
}

// Config reads the settings in force. ErrNotFound: none has been uploaded yet.
func (c *Client) Config(ctx context.Context, etag *string) (cfg *Config, changed bool, err error) {
	var out Config
	changed, err = c.do(ctx, http.MethodGet, "/config", nil, &out, etag)
	if err != nil || !changed {
		return nil, false, err
	}
	return &out, true, nil
}

func (c *Client) Feed(ctx context.Context, etag *string) (feed *Feed, changed bool, err error) {
	var out Feed
	changed, err = c.do(ctx, http.MethodGet, "/feed", nil, &out, etag)
	if err != nil || !changed {
		return nil, false, err
	}
	return &out, true, nil
}

// SignOut asks the server to drop the tokens and forgets them.
func (c *Client) SignOut(ctx context.Context) {
	c.mu.Lock()
	t := c.token
	c.token = nil
	c.mu.Unlock()
	Revoke(ctx, c.base, c.ep, t)
	if c.saved != nil {
		c.saved(nil)
	}
}
