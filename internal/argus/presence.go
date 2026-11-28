package argus

import (
	"context"
	"errors"
	"net/http"
)

// Spot is where a user stands in the centre: a floor ("lodge" for the
// basement), a room on it ("" = none in particular), and the ticket they look at.
type Spot struct {
	Space string `json:"space"`
	Zone  string `json:"zone"`
	Box   string `json:"box"`
}

// TeamSpot is where a teammate stands, as the server last heard it.
type TeamSpot struct {
	JiraAccountID string `json:"jiraAccountId"`
	Space         string `json:"space"`
	Zone          string `json:"zone"`
	Box           string `json:"box"`
	UpdatedAt     string `json:"updatedAt"`
}

// SetPresence tells the server where the user stands. ErrNotFound: the
// server does not know presence (an older server).
func (c *Client) SetPresence(ctx context.Context, s Spot) error {
	_, err := c.do(ctx, http.MethodPut, "/me/presence", s, nil, nil)
	return err
}

// ClearPresence says the user left (the app is closing).
func (c *Client) ClearPresence(ctx context.Context) error {
	_, err := c.do(ctx, http.MethodDelete, "/me/presence", nil, nil, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// TeamPresence reads where everyone stands. People gone quiet for two
// minutes are left out by the server. With the etag of the last answer, an
// unchanged list costs almost nothing (changed = false).
func (c *Client) TeamPresence(ctx context.Context, etag *string) (spots []TeamSpot, changed bool, err error) {
	var out struct {
		Members []TeamSpot `json:"members"`
	}
	changed, err = c.do(ctx, http.MethodGet, "/team/presence", nil, &out, etag)
	if err != nil || !changed {
		return nil, false, err
	}
	if out.Members == nil {
		out.Members = []TeamSpot{}
	}
	return out.Members, true, nil
}
