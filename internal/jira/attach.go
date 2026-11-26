package jira

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
)

// Attach adds a file to a ticket.
func (c *Client) Attach(ctx context.Context, key, name string, data []byte) error {
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	part, err := form.CreateFormFile("file", name)
	if err != nil {
		return err
	}
	if _, err := part.Write(data); err != nil {
		return err
	}
	if err := form.Close(); err != nil {
		return err
	}
	path := "/rest/api/3/issue/" + url.PathEscape(key) + "/attachments"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, &buf)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.email, c.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "argusDesk")
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("X-Atlassian-Token", "no-check") // Jira asks for it on uploads
	// Its own client: sending a file can take longer than the 30 seconds an
	// API call gets. The caller's context sets the limit.
	res, err := (&http.Client{}).Do(req)
	if err != nil {
		return fmt.Errorf("Jira에 연결할 수 없습니다: %w", err)
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return ErrUnauthorized
	case res.StatusCode == http.StatusRequestEntityTooLarge:
		return fmt.Errorf("%s: Jira가 받는 크기보다 큰 파일입니다", name)
	case res.StatusCode < 200 || res.StatusCode > 299:
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return &HTTPError{Code: res.StatusCode, text: fmt.Sprintf("Jira 요청 실패 (HTTP %d %s): %s", res.StatusCode, path, strings.TrimSpace(string(msg)))}
	}
	return nil
}

// FileInfo is what Jira knows about one attached file.
type FileInfo struct {
	Name string `json:"filename"`
	Size int64  `json:"size"`
}

// FileInfo reads the name and size of an attached file.
func (c *Client) FileInfo(ctx context.Context, id string) (*FileInfo, error) {
	var out FileInfo
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/attachment/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Download writes the content of an attached file to w, up to max bytes.
// Jira answers with a redirect to where the file is kept; the sign-in is not
// passed on to that other host.
func (c *Client) Download(ctx context.Context, id string, w io.Writer, max int64) error {
	path := "/rest/api/3/attachment/content/" + url.PathEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.email, c.token)
	req.Header.Set("User-Agent", "argusDesk")
	// Its own client: a file can take longer than the 30 seconds an API call
	// gets, and the sign-in is taken off before any redirect is followed.
	hc := &http.Client{CheckRedirect: func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("너무 많이 넘겨졌습니다")
		}
		next.Header.Del("Authorization")
		return nil
	}}
	res, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("Jira에 연결할 수 없습니다: %w", err)
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return ErrUnauthorized
	case res.StatusCode < 200 || res.StatusCode > 299:
		return &HTTPError{Code: res.StatusCode, text: fmt.Sprintf("Jira 요청 실패 (HTTP %d %s)", res.StatusCode, path)}
	}
	n, err := io.Copy(w, io.LimitReader(res.Body, max+1))
	if err != nil {
		return fmt.Errorf("파일을 받다가 끊겼습니다: %w", err)
	}
	if n > max {
		return fmt.Errorf("%dMB보다 큰 파일은 앱에서 받을 수 없습니다. Jira에서 받아 주세요", max>>20)
	}
	return nil
}
