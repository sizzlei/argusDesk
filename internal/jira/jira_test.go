package jira

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func server(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	return New(s.URL, "me@example.com", "tok")
}

func TestSearchFollowsPages(t *testing.T) {
	calls := 0
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		if u, p, _ := r.BasicAuth(); u != "me@example.com" || p != "tok" {
			t.Errorf("auth = %s / %s", u, p)
		}
		if r.Method != http.MethodPost || r.URL.Path != "/rest/api/3/search/jql" {
			t.Errorf("%s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		calls++
		if calls == 1 {
			if _, has := body["nextPageToken"]; has {
				t.Error("the first page must not send a token")
			}
			io.WriteString(w, `{"issues":[{"key":"A-1","fields":{"summary":"one"}}],"nextPageToken":"p2"}`)
			return
		}
		if body["nextPageToken"] != "p2" {
			t.Errorf("token = %v", body["nextPageToken"])
		}
		io.WriteString(w, `{"issues":[{"key":"A-2","fields":{}}]}`)
	})
	got, err := c.Search(context.Background(), "project = A", []string{"summary"})
	if err != nil || len(got) != 2 || got[1].Key != "A-2" || calls != 2 {
		t.Fatalf("got %+v, err %v, %d calls", got, err, calls)
	}
}

func TestStatusEnteredAtTakesTheLastMove(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"total":3,"values":[
		 {"created":"2026-11-24T09:00:00.000+0900","items":[{"field":"status","to":"5"}]},
		 {"created":"2026-11-24T11:00:00.000+0900","items":[{"field":"assignee","to":"5"},{"field":"status","to":"7"}]},
		 {"created":"2026-11-25T08:30:00.000+0900","items":[{"field":"status","to":"5"}]}]}`)
	})
	at, ok, err := c.StatusEnteredAt(context.Background(), "A-1", "5")
	if err != nil || !ok || at.Format("01-02 15:04") != "11-25 08:30" {
		t.Fatalf("at %v ok %v err %v", at, ok, err)
	}
	if _, ok, _ := c.StatusEnteredAt(context.Background(), "A-1", "9"); ok {
		t.Error("a status never entered reports ok = false")
	}
}

func TestErrors(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) })
	if _, err := c.Myself(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("401 = %v", err)
	}
	c = server(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	var rl *RateLimitError
	if _, err := c.Myself(context.Background()); !errors.As(err, &rl) || rl.RetryAfter != 7*time.Second {
		t.Errorf("429 = %v", err)
	}
	c = server(t, func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no such project", http.StatusNotFound) })
	if _, err := c.ProjectStatuses(context.Background(), "X"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("404 = %v", err)
	}
}

func TestProjectStatusesMergesTypes(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `[{"statuses":[{"id":"1","name":"열림"}]},{"statuses":[{"id":"1","name":"열림"},{"id":"2","name":"완료"}]}]`)
	})
	got, err := c.ProjectStatuses(context.Background(), "A")
	if err != nil || len(got) != 2 || got["2"] != "완료" {
		t.Fatalf("%v %v", got, err)
	}
}

func TestDetail(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/_edge/tenant_info":
			io.WriteString(w, `{"cloudId":"cloud-1"}`)
			return
		case strings.HasPrefix(r.URL.Path, "/jira/forms/"):
			http.Error(w, "forms are off", http.StatusForbidden)
			return
		case r.URL.Path != "/rest/api/3/issue/A-1" || r.URL.Query().Get("expand") != "renderedFields":
			t.Errorf("%s ? %s", r.URL.Path, r.URL.RawQuery)
		}
		io.WriteString(w, `{"fields":{
		  "attachment":[{},{}],
		  "comment":{"comments":[
		    {"id":"1","author":{"displayName":"김하늘"},"created":"2026-11-25T09:00:00.000+0900","jsdPublic":true},
		    {"id":"2","author":{"displayName":"이도윤"},"created":"2026-11-25T10:00:00.000+0900","jsdPublic":false}]}},
		 "renderedFields":{"description":"<p>본문</p>",
		  "comment":{"comments":[{"id":"1","body":"<p>첫 댓글</p>","created":"오늘"},{"id":"2","body":"<p>내부 메모</p>"}]}}}`)
	})
	c.formsBase = c.base
	d, err := c.Detail(context.Background(), "A-1")
	if err != nil {
		t.Fatal(err)
	}
	// Forms that cannot be read do not hide the description and comments.
	if !strings.Contains(d.FormsError, "403") || len(d.Forms) != 0 {
		t.Errorf("forms error = %q, forms = %+v", d.FormsError, d.Forms)
	}
	if d.DescriptionHTML != "<p>본문</p>" || d.Attachments != 2 || len(d.Comments) != 2 {
		t.Fatalf("%+v", d)
	}
	if c0, c1 := d.Comments[0], d.Comments[1]; c0.Author != "김하늘" || c0.BodyHTML != "<p>첫 댓글</p>" || c0.Internal ||
		!c1.Internal || c1.Created.Format("15:04") != "10:00" {
		t.Errorf("comments: %+v", d.Comments)
	}
}

func TestForms(t *testing.T) {
	tenant := 0
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		if u, p, _ := r.BasicAuth(); u != "me@example.com" || p != "tok" {
			t.Errorf("auth on %s = %s / %s", r.URL.Path, u, p)
		}
		switch r.URL.Path {
		case "/_edge/tenant_info":
			tenant++
			io.WriteString(w, `{"cloudId":"cloud-1"}`)
		case "/jira/forms/cloud/cloud-1/issue/A-1/form":
			io.WriteString(w, `[{"id":"f1","name":"요청서","submitted":true,"lock":false},{"id":"f2","name":"빈 양식","submitted":false}]`)
		case "/jira/forms/cloud/cloud-1/issue/A-1/form/f1/format/answers":
			io.WriteString(w, `[{"label":"대상 DB","answer":"sample_db, sample_db2"},
			  {"label":"실행할 SQL","answer":"ALTER TABLE t ADD c INT;\nSELECT 1;"},
			  {"label":"구분","answer":"","choice":"운영"},
			  {"label":"건수","answer":12},
			  {"label":"","answer":null}]`)
		case "/jira/forms/cloud/cloud-1/issue/A-1/form/f2/format/answers":
			io.WriteString(w, `[]`)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			http.NotFound(w, r)
		}
	})
	c.formsBase = c.base
	forms, err := c.Forms(context.Background(), "A-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(forms) != 2 || forms[0].Name != "요청서" || !forms[0].Submitted || len(forms[1].Answers) != 0 {
		t.Fatalf("%+v", forms)
	}
	got := ""
	for _, a := range forms[0].Answers {
		got += a.Label + "=" + a.Value + "|"
	}
	want := "대상 DB=sample_db, sample_db2|실행할 SQL=ALTER TABLE t ADD c INT;\nSELECT 1;|구분=운영|건수=12|"
	if got != want {
		t.Errorf("answers\n got %q\nwant %q", got, want)
	}
	if _, err := c.Forms(context.Background(), "A-1"); err != nil || tenant != 1 {
		t.Errorf("the cloud id is looked up once: %d lookups, err %v", tenant, err)
	}
}
