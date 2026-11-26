package jira

import (
	"context"
	"io"
	"net/http"
	"testing"
)

func TestAttachAndListFiles(t *testing.T) {
	var name, body, token string
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/rest/api/3/issue/INT-7/attachments":
			token = r.Header.Get("X-Atlassian-Token")
			f, h, err := r.FormFile("file")
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(f)
			name, body = h.Filename, string(b)
			io.WriteString(w, `[{"id":"900"}]`)
		case r.Method == http.MethodGet && r.URL.Path == "/rest/api/3/issue/INT-7":
			io.WriteString(w, `{"fields":{"comment":{"comments":[]},"attachment":[{"id":"900","filename":"계획.png","size":2048,"mimeType":"image/png","created":"2026-11-26T10:00:00.000+0900","author":{"displayName":"김하늘"}}]},"renderedFields":{"description":"","comment":{"comments":[]}}}`)
		default:
			w.WriteHeader(http.StatusNotFound) // the forms of the ticket: none
		}
	})
	ctx := context.Background()
	if err := c.Attach(ctx, "INT-7", "계획.png", []byte("png-bytes")); err != nil {
		t.Fatal(err)
	}
	if name != "계획.png" || body != "png-bytes" || token != "no-check" {
		t.Errorf("sent %q %q, token header %q", name, body, token)
	}
	d, err := c.Detail(ctx, "INT-7")
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Files) != 1 || d.Attachments != 1 {
		t.Fatalf("files: %+v", d.Files)
	}
	f := d.Files[0]
	if f.Name != "계획.png" || f.Size != 2048 || f.Author != "김하늘" || f.Created.IsZero() || f.URL == "" || f.URL[len(f.URL)-len("/rest/api/3/attachment/content/900"):] != "/rest/api/3/attachment/content/900" {
		t.Errorf("file: %+v", f)
	}
}
