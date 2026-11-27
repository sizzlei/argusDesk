package jira

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// EditField is one field of a ticket the team may change from its window,
// with what it holds now.
type EditField struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`     // "date" | "datetime" | "checkbox" | "option" | "other"
	Options  []Option `json:"options"`  // for checkbox and option
	Value    string   `json:"value"`    // date "2026-11-27", date-time "2026-11-27T14:00" (local), "" = empty
	Chosen   []string `json:"chosen"`   // option ids ticked
	Editable bool     `json:"editable"` // false: Jira does not let this user change it here
	// Role is what the field means to the centre, filled in by the app:
	// "deploy" (when it goes to production), "date" (another date of the
	// schedule) or "confirm" (the box that says the deployment date is settled).
	Role string `json:"role"`
}

// EditFields reads the given fields of a ticket: whether this user may edit
// them (Jira's edit screen), how, and what they hold now. Date-times are
// shown in loc.
func (c *Client) EditFields(ctx context.Context, key string, ids []string, loc *time.Location) ([]EditField, error) {
	if len(ids) == 0 {
		return []EditField{}, nil
	}
	var meta struct {
		Fields map[string]struct {
			Name   string `json:"name"`
			Schema struct {
				Type  string `json:"type"`
				Items string `json:"items"`
			} `json:"schema"`
			AllowedValues []struct {
				ID    string `json:"id"`
				Value string `json:"value"`
				Name  string `json:"name"`
			} `json:"allowedValues"`
		} `json:"fields"`
	}
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/issue/"+url.PathEscape(key)+"/editmeta", nil, &meta); err != nil {
		return nil, err
	}
	var now struct {
		Fields map[string]json.RawMessage `json:"fields"`
		Names  map[string]string          `json:"names"`
	}
	path := "/rest/api/3/issue/" + url.PathEscape(key) + "?expand=names&fields=" + url.QueryEscape(strings.Join(ids, ","))
	if err := c.do(ctx, http.MethodGet, path, nil, &now); err != nil {
		return nil, err
	}
	out := make([]EditField, 0, len(ids))
	for _, id := range ids {
		f := EditField{ID: id, Name: now.Names[id], Kind: "other", Options: []Option{}, Chosen: []string{}}
		m, editable := meta.Fields[id]
		if editable {
			f.Editable = true
			if m.Name != "" {
				f.Name = m.Name
			}
			switch {
			case m.Schema.Type == "date":
				f.Kind = "date"
			case m.Schema.Type == "datetime":
				f.Kind = "datetime"
			case m.Schema.Type == "array" && m.Schema.Items == "option":
				f.Kind = "checkbox"
			case m.Schema.Type == "option":
				f.Kind = "option"
			}
			for _, v := range m.AllowedValues {
				name := v.Value
				if name == "" {
					name = v.Name
				}
				f.Options = append(f.Options, Option{ID: v.ID, Name: name})
			}
		}
		raw := now.Fields[id]
		var s string
		if json.Unmarshal(raw, &s) == nil && s != "" {
			if t, err := ParseTime(s); err == nil {
				if f.Kind == "other" {
					f.Kind = "datetime"
				}
				f.Value = t.In(loc).Format("2006-01-02T15:04")
			} else {
				if f.Kind == "other" && len(s) == 10 {
					f.Kind = "date"
				}
				f.Value = s
			}
		}
		var many []struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(raw, &many) == nil {
			for _, o := range many {
				f.Chosen = append(f.Chosen, o.ID)
			}
			if f.Kind == "other" && len(many) > 0 {
				f.Kind = "checkbox"
			}
		}
		var one struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(raw, &one) == nil && one.ID != "" {
			f.Chosen = []string{one.ID}
		}
		out = append(out, f)
	}
	return out, nil
}

// SetField writes one field of a ticket. value is a date ("2026-11-27"), a
// local date-time ("2026-11-27T14:00", read in loc) or "" to clear; chosen are
// option ids for a checkbox or select field.
func (c *Client) SetField(ctx context.Context, key, id, kind, value string, chosen []string, loc *time.Location) error {
	var v any
	switch kind {
	case "date":
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return fmt.Errorf("날짜는 2026-11-27 형식이어야 합니다 (%q)", value)
			}
			v = value
		}
	case "datetime":
		if value != "" {
			t, err := time.ParseInLocation("2006-01-02T15:04", value, loc)
			if err != nil {
				return fmt.Errorf("날짜와 시각을 읽을 수 없습니다 (%q)", value)
			}
			v = t.Format("2006-01-02T15:04:05.000-0700")
		}
	case "checkbox":
		list := []any{}
		for _, o := range chosen {
			list = append(list, map[string]string{"id": o})
		}
		v = list
	case "option":
		if len(chosen) > 0 {
			v = map[string]string{"id": chosen[0]}
		}
	default:
		return errors.New("이 필드는 앱에서 바꿀 수 없습니다. Jira에서 바꿔 주세요")
	}
	body := map[string]any{"fields": map[string]any{id: v}}
	return c.do(ctx, http.MethodPut, "/rest/api/3/issue/"+url.PathEscape(key), body, nil)
}
