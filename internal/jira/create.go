package jira

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// IssueType is a kind of ticket a project can hold.
type IssueType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Option is one choice of a field.
type Option struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// The kinds of field the app can fill in when it makes a ticket.
const (
	KindText     = "text"     // one line
	KindLong     = "long"     // several lines
	KindOption   = "option"   // one of the options
	KindOptions  = "options"  // any of the options
	KindDate     = "date"     // "2026-12-01"
	KindDateTime = "datetime" // "2026-12-01T18:00"
	KindNumber   = "number"
	KindOther    = "other" // the app cannot fill it in
)

// CreateField is one field of the form a ticket is made with.
type CreateField struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Required   bool     `json:"required"`
	HasDefault bool     `json:"hasDefault"`
	Kind       string   `json:"kind"`
	Options    []Option `json:"options,omitempty"`
}

// handled are fields the app sets itself, never shown as form fields.
var handled = map[string]bool{"project": true, "issuetype": true, "reporter": true, "assignee": true, "attachment": true, "issuelinks": true}

// IssueTypes lists the kinds of ticket that can be made in a project.
func (c *Client) IssueTypes(ctx context.Context, project string) ([]IssueType, error) {
	var all []IssueType
	for start := 0; ; {
		var page struct {
			IssueTypes []IssueType `json:"issueTypes"`
			Total      int         `json:"total"`
		}
		path := "/rest/api/3/issue/createmeta/" + url.PathEscape(project) + "/issuetypes?maxResults=100&startAt=" + strconv.Itoa(start)
		if err := c.do(ctx, http.MethodGet, path, nil, &page); err != nil {
			return nil, err
		}
		all = append(all, page.IssueTypes...)
		start += len(page.IssueTypes)
		if len(page.IssueTypes) == 0 || start >= page.Total {
			return all, nil
		}
	}
}

// ProjectID returns the number Jira knows a project by.
func (c *Client) ProjectID(ctx context.Context, project string) (string, error) {
	var p struct {
		ID string `json:"id"`
	}
	err := c.do(ctx, http.MethodGet, "/rest/api/3/project/"+url.PathEscape(project)+"?fields=id", nil, &p)
	return p.ID, err
}

// CreateURL is the page in Jira where a ticket of that kind is made by hand.
func (c *Client) CreateURL(projectID, typeID string) string {
	return c.base + "/secure/CreateIssueDetails!init.jspa?pid=" + url.QueryEscape(projectID) + "&issuetype=" + url.QueryEscape(typeID)
}

type metaField struct {
	FieldID    string `json:"fieldId"`
	Name       string `json:"name"`
	Required   bool   `json:"required"`
	HasDefault bool   `json:"hasDefaultValue"`
	Schema     struct {
		Type   string `json:"type"`
		Items  string `json:"items"`
		System string `json:"system"`
		Custom string `json:"custom"`
	} `json:"schema"`
	Allowed []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"allowedValues"`
}

func (m *metaField) kind() string {
	custom := m.Schema.Custom[strings.LastIndex(m.Schema.Custom, ":")+1:]
	switch {
	case m.FieldID == "summary":
		return KindText
	case m.FieldID == "description" || custom == "textarea":
		return KindLong
	case m.Schema.Type == "string" && (custom == "textfield" || custom == "url"):
		return KindText
	case m.Schema.Type == "date":
		return KindDate
	case m.Schema.Type == "datetime":
		return KindDateTime
	case m.Schema.Type == "number":
		return KindNumber
	case (m.Schema.Type == "option" || m.Schema.Type == "priority") && len(m.Allowed) > 0:
		return KindOption
	case m.Schema.Type == "array" && m.Schema.Items == "option" && len(m.Allowed) > 0:
		return KindOptions
	}
	return KindOther
}

// CreateFields lists the fields of the form for one kind of ticket, leaving
// out the ones the app sets itself (project, kind, reporter, assignee).
func (c *Client) CreateFields(ctx context.Context, project, typeID string) ([]CreateField, error) {
	var out []CreateField
	for start := 0; ; {
		var page struct {
			Fields []metaField `json:"fields"`
			Total  int         `json:"total"`
		}
		path := "/rest/api/3/issue/createmeta/" + url.PathEscape(project) + "/issuetypes/" + url.PathEscape(typeID) + "?maxResults=100&startAt=" + strconv.Itoa(start)
		if err := c.do(ctx, http.MethodGet, path, nil, &page); err != nil {
			return nil, err
		}
		for i := range page.Fields {
			m := &page.Fields[i]
			if handled[m.FieldID] {
				continue
			}
			f := CreateField{ID: m.FieldID, Name: m.Name, Required: m.Required, HasDefault: m.HasDefault, Kind: m.kind()}
			for _, a := range m.Allowed {
				name := a.Value
				if name == "" {
					name = a.Name
				}
				f.Options = append(f.Options, Option{ID: a.ID, Name: name})
			}
			out = append(out, f)
		}
		start += len(page.Fields)
		if len(page.Fields) == 0 || start >= page.Total {
			return out, nil
		}
	}
}

// adf wraps plain text as the document format Jira wants for long texts:
// one paragraph a line.
func adf(text string) map[string]any {
	content := []any{}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		p := map[string]any{"type": "paragraph"}
		if line != "" {
			p["content"] = []any{map[string]any{"type": "text", "text": line}}
		}
		content = append(content, p)
	}
	return map[string]any{"type": "doc", "version": 1, "content": content}
}

// fieldValue turns what the form holds (a string, or a list of strings for
// several options) into what Jira expects for that kind of field. ok is
// false when there is nothing to send.
func fieldValue(f CreateField, v any, offset string) (out any, ok bool, err error) {
	if list, isList := v.([]any); isList {
		if f.Kind != KindOptions {
			return nil, false, fmt.Errorf("%s: 값이 하나여야 합니다", f.Name)
		}
		ids := []any{}
		for _, x := range list {
			id, _ := x.(string)
			if !hasOption(f, id) {
				return nil, false, fmt.Errorf("%s: 고를 수 없는 값입니다", f.Name)
			}
			ids = append(ids, map[string]string{"id": id})
		}
		return ids, len(ids) > 0, nil
	}
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, false, nil
	}
	switch f.Kind {
	case KindText:
		return s, true, nil
	case KindLong:
		return adf(s), true, nil
	case KindDate:
		if len(s) != 10 {
			return nil, false, fmt.Errorf("%s: 날짜는 2026-12-01 형식이어야 합니다", f.Name)
		}
		return s, true, nil
	case KindDateTime:
		// "2026-12-01T18:00" from the form: Jira wants seconds and an offset.
		if len(s) == 16 {
			s += ":00.000" + offset
		}
		return s, true, nil
	case KindNumber:
		n, perr := strconv.ParseFloat(s, 64)
		if perr != nil {
			return nil, false, fmt.Errorf("%s: 숫자를 입력해 주세요", f.Name)
		}
		return n, true, nil
	case KindOption:
		if !hasOption(f, s) {
			return nil, false, fmt.Errorf("%s: 고를 수 없는 값입니다", f.Name)
		}
		return map[string]string{"id": s}, true, nil
	case KindOptions:
		if !hasOption(f, s) {
			return nil, false, fmt.Errorf("%s: 고를 수 없는 값입니다", f.Name)
		}
		return []any{map[string]string{"id": s}}, true, nil
	}
	return nil, false, fmt.Errorf("%s: 앱에서 입력할 수 없는 항목입니다", f.Name)
}

func hasOption(f CreateField, id string) bool {
	for _, o := range f.Options {
		if o.ID == id {
			return true
		}
	}
	return false
}

// CreateIssue makes a ticket and returns its key. values holds the form by
// field id; assignee is an account id ("" = nobody); offset is the time
// zone of times typed into the form ("+0900").
func (c *Client) CreateIssue(ctx context.Context, project, typeID string, fields []CreateField, values map[string]any, assignee, offset string) (string, error) {
	body := map[string]any{"project": map[string]string{"key": project}, "issuetype": map[string]string{"id": typeID}}
	known := map[string]CreateField{}
	for _, f := range fields {
		known[f.ID] = f
	}
	for id, v := range values {
		f, ok := known[id]
		if !ok {
			return "", fmt.Errorf("알 수 없는 항목입니다: %s", id)
		}
		val, has, err := fieldValue(f, v, offset)
		if err != nil {
			return "", err
		}
		if has {
			body[id] = val
		}
	}
	for _, f := range fields {
		if _, set := body[f.ID]; f.Required && !f.HasDefault && !set {
			return "", fmt.Errorf("%s 항목을 입력해 주세요", f.Name)
		}
	}
	if assignee != "" {
		body["assignee"] = map[string]string{"accountId": assignee}
	}
	var out struct {
		Key string `json:"key"`
	}
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/issue", map[string]any{"fields": body}, &out); err != nil {
		return "", err
	}
	if out.Key == "" {
		return "", errors.New("Jira가 만든 티켓의 번호를 알려 주지 않았습니다")
	}
	return out.Key, nil
}
