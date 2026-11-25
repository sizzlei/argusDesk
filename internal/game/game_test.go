package game

import (
	"testing"
	"time"
)

var kst = time.FixedZone("KST", 9*3600)

func at(day, hour int) time.Time { return time.Date(2026, 11, day, hour, 0, 0, 0, kst) }

func TestLevelAt(t *testing.T) {
	for _, c := range []struct{ xp, level, from, next int }{
		{0, 1, 0, 100}, {99, 1, 0, 100}, {100, 2, 100, 300}, {299, 2, 100, 300}, {300, 3, 300, 600}, {650, 4, 600, 1000},
	} {
		l, f, n := LevelAt(c.xp, 1)
		if l != c.level || f != c.from || n != c.next {
			t.Errorf("LevelAt(%d) = %d %d %d", c.xp, l, f, n)
		}
	}
	if l, _, n := LevelAt(399, 4); l != 1 || n != 400 {
		t.Errorf("team scale: %d %d", l, n)
	}
}

func TestComputeCountsMineAndTheTeam(t *testing.T) {
	now := at(25, 15) // a Wednesday
	dones := []Done{
		{Key: "A-1", Type: "x", AssigneeID: "me", Created: at(25, 9), At: at(25, 10), XP: 10},                               // today, fast
		{Key: "A-2", Type: "y", AssigneeID: "me", Created: at(20, 9), At: at(24, 10), XP: 30},                               // this week
		{Key: "A-3", Type: "x", AssigneeID: "you", Created: at(1, 9), At: at(23, 10), XP: 10},                               // Monday, someone else
		{Key: "A-4", Type: "x", AssigneeID: "me", Created: at(1, 9), At: at(18, 10), XP: 10},                                // last week
		{Key: "A-0", Type: "x", AssigneeID: "me", Created: at(1, 9), At: time.Date(2025, 12, 31, 10, 0, 0, 0, kst), XP: 10}, // before the season
	}
	s := Compute(dones, "me", []string{"x", "y"}, time.Date(2026, 1, 1, 0, 0, 0, 0, kst), now)
	if s.Me.Done != 3 || s.Me.Today != 1 || s.Me.Week != 2 || s.Me.XP != 50 {
		t.Errorf("me = %+v", s.Me)
	}
	if s.Team.Done != 4 || s.Team.Week != 3 || s.Team.XP != 60 {
		t.Errorf("team = %+v", s.Team)
	}
	got := map[string]Badge{}
	for _, b := range s.Badges {
		got[b.ID] = b
	}
	if !got["first"].Earned || !got["types"].Earned || got["done-50"].Earned || got["done-50"].Have != 3 {
		t.Errorf("badges = %+v", s.Badges)
	}
	if got["fast-10"].Have != 1 || got["team-500"].Have != 4 || got["team-500"].Scope != "team" {
		t.Errorf("progress: %+v %+v", got["fast-10"], got["team-500"])
	}
}

func TestStreakSkipsWeekends(t *testing.T) {
	// Thu 19, Fri 20, (weekend), Mon 23, Tue 24: four working days in a row.
	days := map[string]bool{"2026-11-19": true, "2026-11-20": true, "2026-11-23": true, "2026-11-24": true, "2026-11-10": true}
	if n := streak(days, at(25, 12)); n != 4 {
		t.Fatalf("streak = %d", n)
	}
	if n := streak(nil, at(25, 12)); n != 0 {
		t.Fatalf("empty streak = %d", n)
	}
}
