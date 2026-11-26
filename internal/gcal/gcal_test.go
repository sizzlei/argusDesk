package gcal

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// google is a made-up calendar: one calendar, events kept in memory.
type google struct {
	*httptest.Server
	mu     sync.Mutex
	events map[string]map[string]any
	next   int
	log    []string
}

func newGoogle(t *testing.T) *google {
	g := &google{events: map[string]map[string]any{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("refresh_token") != "refresh" || r.Form.Get("client_id") != "client" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"access_token": "access"})
	})
	mux.HandleFunc("/calendars/team/events", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer access" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		g.mu.Lock()
		defer g.mu.Unlock()
		if r.Method == http.MethodPost {
			var ev map[string]any
			json.NewDecoder(r.Body).Decode(&ev)
			g.next++
			ev["id"] = fmt.Sprintf("e%d", g.next)
			g.events[ev["id"].(string)] = ev
			g.log = append(g.log, "create")
			json.NewEncoder(w).Encode(ev)
			return
		}
		want := strings.TrimPrefix(r.URL.Query().Get("privateExtendedProperty"), markKey+"=")
		items := []map[string]any{}
		for i := 1; i <= g.next; i++ {
			ev, ok := g.events[fmt.Sprintf("e%d", i)]
			if !ok {
				continue
			}
			if ext, _ := ev["extendedProperties"].(map[string]any); ext != nil {
				if priv, _ := ext["private"].(map[string]any); priv != nil && priv[markKey] == want {
					items = append(items, ev)
				}
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"items": items})
	})
	mux.HandleFunc("/calendars/team/events/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/calendars/team/events/")
		g.mu.Lock()
		defer g.mu.Unlock()
		ev, ok := g.events[id]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch r.Method {
		case http.MethodDelete:
			delete(g.events, id)
			g.log = append(g.log, "delete")
			w.WriteHeader(http.StatusNoContent)
		case http.MethodPatch:
			var patch map[string]any
			json.NewDecoder(r.Body).Decode(&patch)
			for k, v := range patch {
				ev[k] = v
			}
			g.log = append(g.log, "patch")
			json.NewEncoder(w).Encode(ev)
		}
	})
	g.Server = httptest.NewServer(mux)
	t.Cleanup(g.Close)
	TokenURL, APIBase = g.URL+"/token", g.URL
	return g
}

func (g *google) only(t *testing.T) map[string]any {
	t.Helper()
	if len(g.events) != 1 {
		t.Fatalf("want one event, have %d", len(g.events))
	}
	for _, ev := range g.events {
		return ev
	}
	return nil
}

func TestSetHoliday(t *testing.T) {
	g := newGoogle(t)
	ctx := context.Background()
	k := &Key{ClientID: "client", RefreshToken: "refresh", CalendarID: "team"}
	// someone's own entry on the calendar: never touched
	g.events["hand"] = map[string]any{"id": "hand", "summary": "손으로 올린 휴가"}

	if err := SetHoliday(ctx, k, "u1", "김하늘", "2026-12-01", "2026-12-03"); err != nil {
		t.Fatal(err)
	}
	delete(g.events, "hand")
	ev := g.only(t)
	g.events["hand"] = map[string]any{"id": "hand"}
	if ev["summary"] != "김하늘 휴가" || ev["start"].(map[string]any)["date"] != "2026-12-01" || ev["end"].(map[string]any)["date"] != "2026-12-04" || ev["transparency"] != "transparent" {
		t.Fatalf("event: %v", ev)
	}

	// the same again: nothing is written
	n := len(g.log)
	if err := SetHoliday(ctx, k, "u1", "김하늘", "2026-12-01", "2026-12-03"); err != nil || len(g.log) != n {
		t.Fatalf("repeat wrote something: %v %v", err, g.log)
	}
	// other days: the same event is changed, not a second one made
	if err := SetHoliday(ctx, k, "u1", "김하늘", "2026-12-08", "2026-12-08"); err != nil {
		t.Fatal(err)
	}
	if got := g.log[len(g.log)-1]; got != "patch" || len(g.events) != 2 || ev["end"].(map[string]any)["date"] != "2026-12-09" {
		t.Fatalf("change: %v %v", g.log, ev)
	}
	// a teammate's holiday is a separate event
	if err := SetHoliday(ctx, k, "u2", "이도윤", "2026-12-24", "2026-12-26"); err != nil || len(g.events) != 3 {
		t.Fatalf("teammate: %v %d", err, len(g.events))
	}
	// cancelled: only this person's event goes; the hand-made one and the teammate's stay
	if err := SetHoliday(ctx, k, "u1", "김하늘", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, ok := g.events["hand"]; !ok || len(g.events) != 2 {
		t.Fatalf("after cancel: %v", g.events)
	}
	// cancelling again is fine
	if err := SetHoliday(ctx, k, "u1", "김하늘", "", ""); err != nil {
		t.Fatal(err)
	}
}

func TestSetHolidayRefusals(t *testing.T) {
	newGoogle(t)
	ctx := context.Background()
	if err := SetHoliday(ctx, &Key{ClientID: "client", RefreshToken: "refresh"}, "u1", "x", "2026-12-01", "2026-12-01"); err == nil {
		t.Error("a key without a calendar passed")
	}
	bad := &Key{ClientID: "client", RefreshToken: "wrong", CalendarID: "team"}
	err := SetHoliday(ctx, bad, "u1", "x", "2026-12-01", "2026-12-01")
	if err == nil || strings.Contains(err.Error(), "wrong") {
		t.Errorf("a refused key: %v", err)
	}
	if err := SetHoliday(ctx, &Key{ClientID: "client", RefreshToken: "refresh", CalendarID: "team"}, "u1", "x", "12/01", "12/02"); err == nil {
		t.Error("bad dates passed")
	}
}
