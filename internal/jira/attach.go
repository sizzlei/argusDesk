package jira

import (
	"bytes"
	"context"
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
	res, err := c.http.Do(req)
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
