// Package game turns finished tickets into experience, levels and badges.
// Nothing is stored: everything is worked out again from Jira's own history,
// so every teammate's app arrives at the same numbers.
package game

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// Done is one finished ticket.
type Done struct {
	Key        string
	Space      string
	Type       string
	AssigneeID string
	Created    time.Time
	At         time.Time // when it was finished
	XP         int       // what its type is worth
}

// Tally is what a person, or the whole team, has done in the season.
type Tally struct {
	Done    int `json:"done"`    // tickets finished in the season
	Today   int `json:"today"`   // of those, today
	Week    int `json:"week"`    // of those, since Monday
	XP      int `json:"xp"`      // experience in the season
	Level   int `json:"level"`   // 1 and up
	LevelXP int `json:"levelXp"` // experience this level starts at
	NextXP  int `json:"nextXp"`  // experience the next level starts at
}

// Badge is an achievement and how far along it is.
type Badge struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Desc   string `json:"desc"`
	Scope  string `json:"scope"` // "me" | "team"
	Have   int    `json:"have"`
	Need   int    `json:"need"`
	Earned bool   `json:"earned"`
}

// Stats is the whole game state shown to one user. Other people's numbers
// are never broken out: only the team's total and the user's own.
type Stats struct {
	Since  time.Time `json:"since"` // the season's start
	Team   Tally     `json:"team"`
	Me     Tally     `json:"me"`
	Badges []Badge   `json:"badges"`
	// Fatigue is how worn each teammate looks, by account id: 0 fresh,
	// 1 tired, 2 resting. Only the level is given, never the count behind it.
	Fatigue map[string]int `json:"fatigue"`
	Away    []Away         `json:"away"` // holidays, current and coming
	// MyFatigue is the user's own fatigue as a share of the point where one
	// has to rest, in percent (100 = resting). Only one's own is given as a number.
	MyFatigue int `json:"myFatigue"`
	// Avatars is the look each teammate chose, by account id.
	Avatars map[string]int `json:"avatars"`
}

// Away is one teammate's holiday.
type Away struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	From   string `json:"from"` // "2026-12-01"
	To     string `json:"to"`   // last day away
	Active bool   `json:"active"`
	Me     bool   `json:"me"`
}

// FatigueScores works out how worn each assignee is. Every ticket finished
// in the last week adds one point, and a point fades by half every two days,
// so a heavy run shows for a while and a quiet spell lets it wear off.
func FatigueScores(dones []Done, now time.Time) map[string]float64 {
	score := map[string]float64{}
	for _, d := range dones {
		age := now.Sub(d.At)
		if d.AssigneeID == "" || age < 0 || age > 7*24*time.Hour {
			continue
		}
		score[d.AssigneeID] += math.Pow(0.5, age.Hours()/48)
	}
	return score
}

// Fatigue turns the scores into levels: 0 fresh, 1 tired, 2 resting.
func Fatigue(dones []Done, now time.Time, tired, exhausted float64) map[string]int {
	out := map[string]int{}
	for id, s := range FatigueScores(dones, now) {
		switch {
		case s >= exhausted:
			out[id] = 2
		case s >= tired:
			out[id] = 1
		}
	}
	return out
}

// teamScale stretches the level steps for the team, which earns as several people.
const teamScale = 4

// LevelAt returns the level for an amount of experience and the bounds of
// that level. Each level takes 100 more than the one before:
// level 2 at 100, level 3 at 300, level 4 at 600, ...
func LevelAt(xp, scale int) (level, from, next int) {
	if scale < 1 {
		scale = 1
	}
	level = 1
	for {
		step := 100 * level * scale
		if xp < from+step {
			return level, from, from + step
		}
		from += step
		level++
	}
}

// Compute works the statistics out for the user `me` at time `now`.
// types lists every request type the settings know, for the collector badge.
func Compute(dones []Done, me string, types []string, since, now time.Time) *Stats {
	loc := now.Location()
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, loc)
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))

	s := &Stats{Since: since}
	var (
		perDay   = map[string]int{}  // my finished tickets per day
		teamDay  = map[string]int{}  // the team's
		myTypes  = map[string]bool{} // request types I have finished
		fast     int                 // mine, finished within an hour of being made
		myDays   = map[string]bool{}
		teamFast int
	)
	add := func(t *Tally, x Done) {
		t.Done++
		t.XP += x.XP
		at := x.At.In(loc)
		if !at.Before(today) {
			t.Today++
		}
		if !at.Before(monday) {
			t.Week++
		}
	}
	for _, x := range dones {
		if x.At.Before(since) {
			continue
		}
		day := x.At.In(loc).Format("2006-01-02")
		add(&s.Team, x)
		teamDay[day]++
		quick := !x.Created.IsZero() && x.At.Sub(x.Created) <= time.Hour
		if quick {
			teamFast++
		}
		if me != "" && x.AssigneeID == me {
			add(&s.Me, x)
			perDay[day]++
			myDays[day] = true
			myTypes[x.Type] = true
			if quick {
				fast++
			}
		}
	}
	s.Me.Level, s.Me.LevelXP, s.Me.NextXP = LevelAt(s.Me.XP, 1)
	s.Team.Level, s.Team.LevelXP, s.Team.NextXP = LevelAt(s.Team.XP, teamScale)

	best := func(m map[string]int) int {
		n := 0
		for _, v := range m {
			if v > n {
				n = v
			}
		}
		return n
	}
	known := 0
	for _, t := range types {
		if myTypes[t] {
			known++
		}
	}
	badge := func(id, name, desc, scope string, have, need int) {
		if have > need {
			have = need
		}
		s.Badges = append(s.Badges, Badge{ID: id, Name: name, Desc: desc, Scope: scope, Have: have, Need: need, Earned: need > 0 && have >= need})
	}
	badge("first", "첫 출고", "상자 하나를 끝까지 보냈다", "me", s.Me.Done, 1)
	for _, n := range []int{50, 100, 300} {
		badge(fmt.Sprintf("done-%d", n), fmt.Sprintf("출고 %d", n), fmt.Sprintf("시즌에 상자 %d개 출고", n), "me", s.Me.Done, n)
	}
	badge("day-5", "바쁜 하루", "하루에 5개 출고", "me", best(perDay), 5)
	badge("day-10", "불타는 하루", "하루에 10개 출고", "me", best(perDay), 10)
	badge("streak-5", "꾸준함", "5일(근무일) 연속 출고", "me", streak(myDays, today), 5)
	badge("fast-10", "번개 처리", "접수 1시간 안에 끝낸 상자 10개", "me", fast, 10)
	badge("types", "유형 수집가", "모든 요청 유형을 한 번씩 출고", "me", known, len(types))
	for _, n := range []int{500, 1000, 2000} {
		badge(fmt.Sprintf("team-%d", n), fmt.Sprintf("팀 출고 %d", n), fmt.Sprintf("시즌에 팀이 상자 %d개 출고", n), "team", s.Team.Done, n)
	}
	badge("team-day-20", "팀 대목", "팀이 하루에 20개 출고", "team", best(teamDay), 20)
	badge("team-fast-50", "팀 번개", "접수 1시간 안에 끝낸 상자 50개", "team", teamFast, 50)
	return s
}

// streak is the longest run of working days (Monday to Friday) in a row that
// has an entry. Weekends neither break a run nor count towards it.
func streak(days map[string]bool, today time.Time) int {
	if len(days) == 0 {
		return 0
	}
	keys := make([]string, 0, len(days))
	for k := range days {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	first, err := time.ParseInLocation("2006-01-02", keys[0], today.Location())
	if err != nil {
		return 0
	}
	best, run := 0, 0
	for d := first; !d.After(today); d = d.AddDate(0, 0, 1) {
		if wd := d.Weekday(); wd == time.Saturday || wd == time.Sunday {
			continue
		}
		if days[d.Format("2006-01-02")] {
			run++
			if run > best {
				best = run
			}
		} else {
			run = 0
		}
	}
	return best
}

// Holidays keeps the holidays that are on now or still to come, marks the
// ones on today, and sorts them by start.
func Holidays(all []Away, me string, now time.Time) []Away {
	today := now.Format("2006-01-02")
	out := []Away{}
	for _, a := range all {
		if a.From == "" || a.To == "" || a.To < today {
			continue
		}
		a.Active = a.From <= today
		a.Me = a.ID == me
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].From < out[j].From })
	return out
}
