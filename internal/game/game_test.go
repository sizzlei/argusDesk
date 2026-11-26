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

func TestFatigueCountsTheWeekAndStartsAfresh(t *testing.T) {
	now := at(25, 18) // Wednesday; the week began on Monday the 23rd
	if ws := WeekStart(now); ws.Day() != 23 || ws.Hour() != 0 || ws.Weekday() != time.Monday {
		t.Fatalf("week start = %v", ws)
	}
	if ws := WeekStart(at(29, 23)); ws.Day() != 23 { // Sunday night still belongs to that week
		t.Fatalf("sunday's week start = %v", ws)
	}
	var dones []Done
	for i := 0; i < 16; i++ {
		dones = append(dones, Done{AssigneeID: "busy", At: now.Add(-time.Duration(i) * time.Hour)}) // all today
	}
	for i := 0; i < 9; i++ {
		dones = append(dones, Done{AssigneeID: "steady", At: at(23, 9).Add(time.Duration(i) * time.Hour)}) // Monday: nothing fades in the week
	}
	for i := 0; i < 16; i++ {
		dones = append(dones, Done{AssigneeID: "rested", At: at(20, 10)}) // a heavy Friday, last week
	}
	got := Fatigue(dones, now, 8, 14)
	if got["busy"] != 2 || got["steady"] != 1 || got["rested"] != 0 {
		t.Fatalf("fatigue = %v", got)
	}
	scores := FatigueScores(dones, now)
	if l := []int{Left(scores["busy"], 14), Left(scores["steady"], 14), Left(scores["rested"], 14), Left(7, 14)}; l[0] != 0 || l[1] != 36 || l[2] != 100 || l[3] != 50 {
		t.Fatalf("left = %v", l)
	}
	// The next Monday everything is back.
	if next := FatigueScores(dones, at(30, 9)); len(next) != 0 {
		t.Fatalf("after the weekend = %v", next)
	}
}

func TestHolidays(t *testing.T) {
	now := at(25, 9)
	got := Holidays([]Away{
		{ID: "a", From: "2026-11-20", To: "2026-11-24"},  // over
		{ID: "b", From: "2026-12-01", To: "2026-12-03"},  // coming
		{ID: "me", From: "2026-11-25", To: "2026-11-26"}, // on now
		{ID: "c", From: "", To: ""},
	}, "me", now)
	if len(got) != 2 || got[0].ID != "me" || !got[0].Active || !got[0].Me || got[1].Active {
		t.Fatalf("holidays = %+v", got)
	}
}

func TestHolidayTitleAndHalfDays(t *testing.T) {
	if got := HolidayTitle("김하늘", "오전반차", "이도윤"); got != "김하늘 / 오전반차 / 대무자 : 이도윤" {
		t.Errorf("title = %q", got)
	}
	if got := HolidayTitle("김하늘", "연차", ""); got != "김하늘 / 연차" {
		t.Errorf("title without cover = %q", got)
	}
	now := at(25, 9)
	got := Holidays([]Away{
		{ID: "full", From: "2026-11-25", To: "2026-11-25", Kind: "연차"},
		{ID: "half", From: "2026-11-25", To: "2026-11-25", Kind: "오전반차", Half: true},
	}, "", now)
	if len(got) != 2 || !got[0].Active || got[1].Active {
		t.Fatalf("a half day sends nobody to the lodge: %+v", got)
	}
}
