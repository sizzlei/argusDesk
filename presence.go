package main

import (
	"context"
	"errors"
	"regexp"
	"sync"
	"time"

	"github.com/sizzlei/argusDesk/internal/argus"
)

// evPresence carries where the teammates stand: *Presence.
const evPresence = "server:presence"

// Presence is what the screen is told about the team's whereabouts.
type Presence struct {
	// On is false when the server has no presence (an older server, or none
	// at all): the screen places people as before and dims nobody.
	On      bool       `json:"on"`
	Members []TeamSpot `json:"members"`
}

// TeamSpot is one teammate's place, by Jira account id.
type TeamSpot struct {
	ID    string `json:"id"`
	Space string `json:"space"`
	Zone  string `json:"zone"`
	Box   string `json:"box"`
	At    string `json:"at"`
}

const (
	presenceGather = 3 * time.Second  // moves within this time go to the server as one
	presenceAlive  = 60 * time.Second // the same place again, to say the app still runs
	presenceRead   = 5 * time.Second  // how often the team's places are read
)

var (
	spotID  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	spotKey = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,10}$`)
)

// presence keeps where the user stands and what the server last heard.
type presence struct {
	mu      sync.Mutex
	want    argus.Spot
	sent    argus.Spot
	sentAt  time.Time
	off     bool // the server answered that it has no presence
	tag     string
	members []TeamSpot
	told    bool // the screen has been told at least once
}

// SetPresence is called by the screen when the user's avatar moves: the
// floor ("lodge" in the basement), the room, and the ticket in front. It
// reaches the server within a few seconds.
func (a *App) SetPresence(space, zone, box string) {
	if !spotID.MatchString(space) {
		return
	}
	if zone != "" && !spotID.MatchString(zone) {
		zone = ""
	}
	if !spotKey.MatchString(box) {
		box = ""
	}
	a.pres.mu.Lock()
	a.pres.want = argus.Spot{Space: space, Zone: zone, Box: box}
	a.pres.mu.Unlock()
}

// TeamPresence is the last list of the team's places (for a screen that just started).
func (a *App) TeamPresence() *Presence {
	a.pres.mu.Lock()
	defer a.pres.mu.Unlock()
	return &Presence{On: !a.pres.off && a.pres.told, Members: append([]TeamSpot{}, a.pres.members...)}
}

// presenceLoop sends the user's place and reads the team's, while the server is there.
func (a *App) presenceLoop(ctx context.Context) {
	// a new server (or a new sign-in) is asked afresh
	a.pres.mu.Lock()
	a.pres.off, a.pres.tag, a.pres.sentAt = false, "", time.Time{}
	a.pres.mu.Unlock()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	n := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		a.mu.Lock()
		c := a.srv.client
		a.mu.Unlock()
		if c == nil {
			continue
		}
		a.pres.mu.Lock()
		off := a.pres.off
		want, sent, at := a.pres.want, a.pres.sent, a.pres.sentAt
		a.pres.mu.Unlock()
		if off {
			return // an older server: nothing to send or read
		}
		now := time.Now()
		if want.Space != "" && ((want != sent && now.Sub(at) >= presenceGather) || now.Sub(at) >= presenceAlive) {
			rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.SetPresence(rctx, want)
			cancel()
			if a.presenceGone(err) {
				return
			}
			if err == nil {
				a.pres.mu.Lock()
				a.pres.sent, a.pres.sentAt = want, now
				a.pres.mu.Unlock()
			}
		}
		if n++; n%int(presenceRead/time.Second) == 1 {
			a.readPresence(ctx, c)
		}
	}
}

// presenceGone turns off presence for good when the server does not know it.
func (a *App) presenceGone(err error) bool {
	if !errors.Is(err, argus.ErrNotFound) {
		return false
	}
	a.pres.mu.Lock()
	a.pres.off, a.pres.members = true, nil
	a.pres.mu.Unlock()
	a.note("Argus에 위치 공유가 없어 끔")
	a.app.Event.Emit(evPresence, &Presence{On: false, Members: []TeamSpot{}})
	return true
}

func (a *App) readPresence(ctx context.Context, c *argus.Client) {
	a.pres.mu.Lock()
	tag := a.pres.tag
	a.pres.mu.Unlock()
	rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	got, changed, err := c.TeamPresence(rctx, &tag)
	if a.presenceGone(err) || err != nil || !changed {
		return
	}
	out := make([]TeamSpot, 0, len(got))
	for _, s := range got {
		out = append(out, TeamSpot{ID: s.JiraAccountID, Space: s.Space, Zone: s.Zone, Box: s.Box, At: s.UpdatedAt})
	}
	a.pres.mu.Lock()
	a.pres.tag, a.pres.members, a.pres.told = tag, out, true
	a.pres.mu.Unlock()
	a.app.Event.Emit(evPresence, &Presence{On: true, Members: out})
}

// leave tells the server the user is gone (the app is closing). Short: a slow server does not hold up quitting.
func (a *App) leave() {
	a.mu.Lock()
	c := a.srv.client
	a.mu.Unlock()
	a.pres.mu.Lock()
	skip := a.pres.off || a.pres.sentAt.IsZero()
	a.pres.mu.Unlock()
	if c == nil || skip {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = c.ClearPresence(ctx)
}
