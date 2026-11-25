package jira

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// Issue properties are small pieces of JSON kept on a ticket, invisible in
// Jira's own screens. argusDesk uses them on one agreed ticket as the team's
// shared notes (who is on holiday), since the app has no server of its own.

// IssueProperties reads every property of a ticket whose key starts with prefix.
func (c *Client) IssueProperties(ctx context.Context, key, prefix string) (map[string]json.RawMessage, error) {
	var list struct {
		Keys []struct {
			Key string `json:"key"`
		} `json:"keys"`
	}
	base := "/rest/api/3/issue/" + url.PathEscape(key) + "/properties"
	if err := c.do(ctx, http.MethodGet, base, nil, &list); err != nil {
		return nil, err
	}
	out := map[string]json.RawMessage{}
	for _, k := range list.Keys {
		if !strings.HasPrefix(k.Key, prefix) {
			continue
		}
		var one struct {
			Value json.RawMessage `json:"value"`
		}
		if err := c.do(ctx, http.MethodGet, base+"/"+url.PathEscape(k.Key), nil, &one); err != nil {
			return nil, err
		}
		out[k.Key] = one.Value
	}
	return out, nil
}

// SetIssueProperty writes one property of a ticket.
func (c *Client) SetIssueProperty(ctx context.Context, key, property string, value any) error {
	return c.do(ctx, http.MethodPut, "/rest/api/3/issue/"+url.PathEscape(key)+"/properties/"+url.PathEscape(property), value, nil)
}

// DeleteIssueProperty removes one property of a ticket. A property that is
// already gone is not an error.
func (c *Client) DeleteIssueProperty(ctx context.Context, key, property string) error {
	err := c.do(ctx, http.MethodDelete, "/rest/api/3/issue/"+url.PathEscape(key)+"/properties/"+url.PathEscape(property), nil, nil)
	if he, ok := err.(*HTTPError); ok && he.Code == http.StatusNotFound {
		return nil
	}
	return err
}
