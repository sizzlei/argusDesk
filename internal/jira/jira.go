// Package jira is the only place that talks to Jira Cloud. It uses the REST
// API with an e-mail address and a personal API token (Basic auth).
package jira

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ErrUnauthorized means the token is wrong, expired or revoked: ask for a
// new one.
var ErrUnauthorized = errors.New("Jira 인증에 실패했습니다. API 토큰을 다시 입력해 주세요")

// RateLimitError is returned on HTTP 429; wait RetryAfter before the next call.
type RateLimitError struct{ RetryAfter time.Duration }

func (e *RateLimitError) Error() string {
	return fmt.Sprintf("Jira 요청이 너무 많습니다. %s 뒤에 다시 시도합니다", e.RetryAfter.Round(time.Second))
}

// HTTPError is any other refusal from Jira, with its status code.
type HTTPError struct {
	Code int
	text string
}

func (e *HTTPError) Error() string { return e.text }

// Client calls one Jira site as one user.
type Client struct {
	base      string // "https://example.atlassian.net"
	formsBase string // "https://api.atlassian.com": Jira Forms live on another host
	email     string
	token     string
	http      *http.Client

	mu      sync.Mutex
	cloudID string // looked up once, on first use
}

// New makes a client for a site ("example.atlassian.net" or a full URL).
func New(site, email, token string) *Client {
	base := strings.TrimSuffix(site, "/")
	if !strings.Contains(base, "://") {
		base = "https://" + base
	}
	return &Client{base: base, formsBase: "https://api.atlassian.com", email: email, token: token, http: &http.Client{Timeout: 30 * time.Second}}
}

// BrowseURL is the web address of a ticket.
func (c *Client) BrowseURL(key string) string { return c.base + "/browse/" + key }

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	return c.request(ctx, method, c.base+path, body, out)
}

// request calls a full URL with this user's credentials.
func (c *Client) request(ctx context.Context, method, target string, body, out any) error {
	path := target
	if u, err := url.Parse(target); err == nil {
		path = u.Path // error messages name the path, not the host
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, rd)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.email, c.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "argusDesk")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("Jira에 연결할 수 없습니다: %w", err)
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return ErrUnauthorized
	case res.StatusCode == http.StatusTooManyRequests:
		wait := 30 * time.Second
		if s, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil && s > 0 {
			wait = time.Duration(s) * time.Second
		}
		return &RateLimitError{RetryAfter: wait}
	case res.StatusCode < 200 || res.StatusCode > 299:
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return &HTTPError{Code: res.StatusCode, text: fmt.Sprintf("Jira 요청 실패 (HTTP %d %s): %s", res.StatusCode, path, strings.TrimSpace(string(msg)))}
	}
	if out == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<20)).Decode(out); err != nil {
		return fmt.Errorf("Jira 응답을 읽을 수 없습니다 (%s): %w", path, err)
	}
	return nil
}

// User is a Jira account.
type User struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
}

// Myself returns the account the token belongs to. It doubles as the token check.
func (c *Client) Myself(ctx context.Context) (*User, error) {
	var u User
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/myself", nil, &u); err != nil {
		return nil, err
	}
	return &u, nil
}

// Field is a Jira field definition.
type Field struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Fields lists every field of the site (custom fields included).
func (c *Client) Fields(ctx context.Context) ([]Field, error) {
	var out []Field
	err := c.do(ctx, http.MethodGet, "/rest/api/3/field", nil, &out)
	return out, err
}

// ProjectStatuses returns status id -> name for every status the project's
// issue types can be in.
func (c *Client) ProjectStatuses(ctx context.Context, project string) (map[string]string, error) {
	var types []struct {
		Statuses []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"statuses"`
	}
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/project/"+url.PathEscape(project)+"/statuses", nil, &types); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, t := range types {
		for _, s := range t.Statuses {
			out[s.ID] = s.Name
		}
	}
	return out, nil
}

// Issue is a search hit with its raw fields.
type Issue struct {
	Key    string                     `json:"key"`
	Fields map[string]json.RawMessage `json:"fields"`
}

// Search runs a JQL query and returns every hit (all pages).
func (c *Client) Search(ctx context.Context, jql string, fields []string) ([]Issue, error) {
	var all []Issue
	token := ""
	for page := 0; page < 50; page++ { // 50 pages x 100 = far more than a service desk holds open
		body := map[string]any{"jql": jql, "fields": fields, "maxResults": 100}
		if token != "" {
			body["nextPageToken"] = token
		}
		var res struct {
			Issues        []Issue `json:"issues"`
			NextPageToken string  `json:"nextPageToken"`
		}
		if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", body, &res); err != nil {
			return nil, err
		}
		all = append(all, res.Issues...)
		if res.NextPageToken == "" || len(res.Issues) == 0 {
			break
		}
		token = res.NextPageToken
	}
	return all, nil
}

// StatusEnteredAt returns when the ticket last moved into the given status.
// ok is false when the history has no such move (the ticket was created in
// that status): use the creation time then.
func (c *Client) StatusEnteredAt(ctx context.Context, key, statusID string) (at time.Time, ok bool, err error) {
	startAt := 0
	for {
		var res struct {
			Total  int `json:"total"`
			Values []struct {
				Created string `json:"created"`
				Items   []struct {
					Field string `json:"field"`
					To    string `json:"to"`
				} `json:"items"`
			} `json:"values"`
		}
		path := fmt.Sprintf("/rest/api/3/issue/%s/changelog?startAt=%d&maxResults=100", url.PathEscape(key), startAt)
		if err := c.do(ctx, http.MethodGet, path, nil, &res); err != nil {
			return time.Time{}, false, err
		}
		for _, v := range res.Values {
			for _, it := range v.Items {
				if it.Field == "status" && it.To == statusID {
					if t, perr := ParseTime(v.Created); perr == nil && t.After(at) {
						at, ok = t, true
					}
				}
			}
		}
		startAt += len(res.Values)
		if len(res.Values) == 0 || startAt >= res.Total {
			return at, ok, nil
		}
	}
}

// Comment is one comment on a ticket.
type Comment struct {
	Author   string    `json:"author"`
	Created  time.Time `json:"created"`
	BodyHTML string    `json:"bodyHtml"`
	Internal bool      `json:"internal"` // a service-desk internal note, not shown to the requester
}

// Answer is one filled-in question of a form.
type Answer struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// Form is a Jira form attached to a ticket, with its answers in form order.
type Form struct {
	Name      string   `json:"name"`
	Submitted bool     `json:"submitted"`
	Answers   []Answer `json:"answers"`
}

// CloudID returns the site's cloud id, which the Forms API addresses sites by.
func (c *Client) CloudID(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cloudID != "" {
		return c.cloudID, nil
	}
	var info struct {
		CloudID string `json:"cloudId"`
	}
	if err := c.do(ctx, http.MethodGet, "/_edge/tenant_info", nil, &info); err != nil {
		return "", err
	}
	if info.CloudID == "" {
		return "", errors.New("Jira 사이트의 cloudId를 찾을 수 없습니다")
	}
	c.cloudID = info.CloudID
	return c.cloudID, nil
}

// Forms reads the Jira forms attached to a ticket and their answers. Requests
// made from a form keep most of their content here, not in the description.
func (c *Client) Forms(ctx context.Context, key string) ([]Form, error) {
	cloud, err := c.CloudID(ctx)
	if err != nil {
		return nil, err
	}
	root := c.formsBase + "/jira/forms/cloud/" + url.PathEscape(cloud) + "/issue/" + url.PathEscape(key) + "/form"
	var index []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Submitted bool   `json:"submitted"`
	}
	if err := c.request(ctx, http.MethodGet, root, nil, &index); err != nil {
		return nil, err
	}
	forms := []Form{}
	for _, f := range index {
		// Answers arrive flattened: one entry per question, multiple choices
		// already joined. The value is usually under "answer", sometimes "choice".
		var raw []map[string]json.RawMessage
		if err := c.request(ctx, http.MethodGet, root+"/"+url.PathEscape(f.ID)+"/format/answers", nil, &raw); err != nil {
			return nil, err
		}
		form := Form{Name: f.Name, Submitted: f.Submitted, Answers: []Answer{}}
		for _, a := range raw {
			label := plain(a["label"])
			value := plain(a["answer"])
			if value == "" {
				value = plain(a["choice"])
			}
			if label == "" && value == "" {
				continue
			}
			form.Answers = append(form.Answers, Answer{Label: label, Value: value})
		}
		forms = append(forms, form)
	}
	return forms, nil
}

// plain turns a JSON value into display text: strings as they are, null and
// missing as "", anything else as its JSON.
func plain(raw json.RawMessage) string {
	t := strings.TrimSpace(string(raw))
	if t == "" || t == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return strings.TrimSpace(s)
	}
	return t
}

// Detail is the readable content of one ticket. The HTML is rendered by Jira
// from what people typed, so it must be sanitised before it is shown.
type Detail struct {
	Key             string    `json:"key"`
	DescriptionHTML string    `json:"descriptionHtml"`
	Comments        []Comment `json:"comments"`
	Attachments     int       `json:"attachments"`
	Forms           []Form    `json:"forms"`
	FormsError      string    `json:"formsError"` // why the forms could not be read ("" = fine)
}

// Detail reads a ticket's forms, description and comments. It is asked for
// one ticket at a time, when its box is opened; nothing is stored. A failure
// to read the forms is reported in the result, not as an error, so the rest
// still shows.
func (c *Client) Detail(ctx context.Context, key string) (*Detail, error) {
	var res struct {
		Fields struct {
			Comment struct {
				Comments []struct {
					ID     string `json:"id"`
					Author struct {
						DisplayName string `json:"displayName"`
					} `json:"author"`
					Created   string `json:"created"`
					JSDPublic *bool  `json:"jsdPublic"`
				} `json:"comments"`
			} `json:"comment"`
			Attachment []json.RawMessage `json:"attachment"`
		} `json:"fields"`
		Rendered struct {
			Description string `json:"description"`
			Comment     struct {
				Comments []struct {
					ID   string `json:"id"`
					Body string `json:"body"`
				} `json:"comments"`
			} `json:"comment"`
		} `json:"renderedFields"`
	}
	path := "/rest/api/3/issue/" + url.PathEscape(key) + "?fields=description,comment,attachment&expand=renderedFields"
	if err := c.do(ctx, http.MethodGet, path, nil, &res); err != nil {
		return nil, err
	}
	body := map[string]string{}
	for _, rc := range res.Rendered.Comment.Comments {
		body[rc.ID] = rc.Body
	}
	d := &Detail{Key: key, DescriptionHTML: res.Rendered.Description, Comments: []Comment{}, Attachments: len(res.Fields.Attachment), Forms: []Form{}}
	if forms, ferr := c.Forms(ctx, key); ferr != nil {
		if errors.Is(ferr, ErrUnauthorized) {
			return nil, ferr
		}
		d.FormsError = ferr.Error()
	} else {
		d.Forms = forms
	}
	for _, fc := range res.Fields.Comment.Comments {
		at, _ := ParseTime(fc.Created)
		d.Comments = append(d.Comments, Comment{
			Author:   fc.Author.DisplayName,
			Created:  at,
			BodyHTML: body[fc.ID],
			Internal: fc.JSDPublic != nil && !*fc.JSDPublic,
		})
	}
	return d, nil
}

// ParseTime reads Jira's timestamp ("2026-11-25T14:03:11.123+0900").
func ParseTime(s string) (time.Time, error) {
	for _, layout := range []string{"2006-01-02T15:04:05.000-0700", "2006-01-02T15:04:05-0700", time.RFC3339Nano} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("알 수 없는 시각 형식: %q", s)
}
