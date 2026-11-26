// Package config reads the shared settings file: which Jira statuses belong
// to which zone, the route of each workflow, and how each request type is
// tagged and aged.
//
// The real file holds internal names and is never committed; the repository
// only has config/example.yaml.
package config

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Zone kinds.
const (
	KindWait     = "wait"     // waiting on someone outside the team
	KindWork     = "work"     // the team acts here
	KindDesk     = "desk"     // the team acts here; boxes sit on assignee desks
	KindDone     = "done"     // finished today
	KindReturned = "returned" // rejected or cancelled
	KindSiding   = "siding"   // waiting on another team: a spur off the conveyor, not a room
	KindUnsorted = "unsorted" // statuses the file does not mention
)

// UnsortedZone is where boxes with an unmapped status are put.
const UnsortedZone = "_unsorted"

// Stale-from values.
const (
	FromZoneEntered = "zone_entered"
	FromTypeField   = "type_field"
)

// Config is the whole settings file.
type Config struct {
	Version     string  `yaml:"version"`
	Name        string  `yaml:"name"`
	Site        string  `yaml:"site"`
	Timezone    string  `yaml:"timezone"`
	PollSeconds int     `yaml:"poll_seconds"`
	Spaces      []Space `yaml:"spaces"`
	Game        Game    `yaml:"game"`
	Team        Team    `yaml:"team"`

	loc *time.Location
}

// Team holds what the team shares through Jira, as the app has no server.
type Team struct {
	// StateIssue is a ticket every teammate can edit. Holidays are kept on it
	// as issue properties so that everyone sees them. Without it, a holiday is
	// only known to the app it was entered in.
	StateIssue string `yaml:"state_issue"`
}

// Game sets how finished tickets turn into experience. All of it is optional.
type Game struct {
	SeasonStart string `yaml:"season_start"` // "2026-01-01"; default: January 1st of this year
	XP          int    `yaml:"xp"`           // experience for a finished ticket; default 10
	// Fatigue: every finished ticket adds 1 and fades by half every two days.
	Tired     float64 `yaml:"tired"`     // tickets finished in a week from which the avatar looks tired; default 8
	Exhausted float64 `yaml:"exhausted"` // tickets finished in a week at which the strength is used up: the avatar rests and no more can be taken; default 14

	start time.Time
}

// Season returns when the current season started.
func (g *Game) Season(now time.Time, loc *time.Location) time.Time {
	if !g.start.IsZero() {
		return g.start
	}
	return time.Date(now.In(loc).Year(), 1, 1, 0, 0, 0, 0, loc)
}

// Space is one Jira project shown as one room.
type Space struct {
	ID          string              `yaml:"id"`
	Name        string              `yaml:"name"`
	Project     string              `yaml:"project"`
	JQL         string              `yaml:"jql"` // optional; replaces the generated query
	Zones       []Zone              `yaml:"zones"`
	StatusZones map[string]string   `yaml:"status_zones"` // status id -> zone id
	Workflows   map[string]Workflow `yaml:"workflows"`
	Types       map[string]Type     `yaml:"types"` // issue type name -> settings
}

// Zone is an area of the room. Zones are laid out in file order.
type Zone struct {
	ID    string `yaml:"id"`
	Name  string `yaml:"name"`
	Kind  string `yaml:"kind"`
	Stale *Stale `yaml:"stale"`
	// Approval marks a zone where boxes wait for someone to approve them by
	// moving them on (a workflow step, not a service desk approval).
	Approval bool `yaml:"approval"`
}

// Stale says when a box in a zone counts as old.
type Stale struct {
	After string `yaml:"after"` // "3h", "5d"
	From  string `yaml:"from"`  // zone_entered | type_field

	after time.Duration
}

// Limit is the parsed After.
func (s *Stale) Limit() time.Duration { return s.after }

// Workflow is the route of a Jira workflow: from each status, the statuses
// that can follow. It is used for drawing only; what a ticket may really do
// is asked of Jira.
type Workflow struct {
	Start   string              `yaml:"start"`
	Paths   map[string][]string `yaml:"paths"`
	FromAny []string            `yaml:"from_any"`
}

// Type is a request type.
type Type struct {
	Workflow    string       `yaml:"workflow"`
	Tag         string       `yaml:"tag"`
	StaleField  string       `yaml:"stale_field"` // "created", "duedate" or a field name
	XP          int          `yaml:"xp"`          // experience when finished; 0 = the game's default
	Unscheduled *Unscheduled `yaml:"unscheduled"`
}

// Unscheduled marks boxes that have no date yet: they are not aged.
type Unscheduled struct {
	UnlessChecked string `yaml:"unless_checked"` // checkbox field name
	Label         string `yaml:"label"`
}

// Location is the time zone date-only fields are read in.
func (c *Config) Location() *time.Location {
	if c.loc == nil {
		return time.Local
	}
	return c.loc
}

// Poll is the refresh interval.
func (c *Config) Poll() time.Duration { return time.Duration(c.PollSeconds) * time.Second }

// Space returns the space with the given id.
func (c *Config) Space(id string) *Space {
	for i := range c.Spaces {
		if c.Spaces[i].ID == id {
			return &c.Spaces[i]
		}
	}
	return nil
}

// Zone returns the zone with the given id.
func (s *Space) Zone(id string) *Zone {
	for i := range s.Zones {
		if s.Zones[i].ID == id {
			return &s.Zones[i]
		}
	}
	return nil
}

// FieldNames lists the custom field names the file refers to (not "created"
// or "duedate"), so the app can look up their ids once.
func (c *Config) FieldNames() []string {
	seen := map[string]bool{}
	var out []string
	add := func(n string) {
		if n == "" || n == "created" || n == "duedate" || seen[n] {
			return
		}
		seen[n] = true
		out = append(out, n)
	}
	for _, s := range c.Spaces {
		for _, t := range s.Types {
			add(t.StaleField)
			if t.Unscheduled != nil {
				add(t.Unscheduled.UnlessChecked)
			}
		}
	}
	return out
}

// Load reads and checks a settings file.
func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("설정 파일을 읽을 수 없습니다: %w", err)
	}
	return Parse(b)
}

// Parse reads and checks settings from YAML.
func Parse(b []byte) (*Config, error) {
	var c Config
	dec := yaml.NewDecoder(strings.NewReader(string(b)))
	dec.KnownFields(true) // a misspelled key is an error, not silently ignored
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("설정 파일 형식이 잘못되었습니다: %w", err)
	}
	if err := c.check(); err != nil {
		return nil, err
	}
	return &c, nil
}

var durRe = regexp.MustCompile(`^(\d+)([mhd])$`)

// ParseDuration reads "30m", "3h" or "5d".
func ParseDuration(s string) (time.Duration, error) {
	m := durRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0, fmt.Errorf("기간은 30m, 3h, 5d 형식이어야 합니다: %q", s)
	}
	n, _ := strconv.Atoi(m[1])
	unit := map[string]time.Duration{"m": time.Minute, "h": time.Hour, "d": 24 * time.Hour}[m[2]]
	return time.Duration(n) * unit, nil
}

var kinds = map[string]bool{KindWait: true, KindWork: true, KindDesk: true, KindDone: true, KindReturned: true, KindSiding: true}

// check validates the file and fills in defaults. Every problem is reported
// at once, so a file can be fixed in one pass.
func (c *Config) check() error {
	var errs []string
	bad := func(format string, a ...any) { errs = append(errs, fmt.Sprintf(format, a...)) }

	if c.Site == "" {
		bad("site: Jira 사이트 주소가 없습니다")
	}
	c.Site = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(c.Site, "https://"), "http://"), "/")
	if c.Name == "" {
		c.Name = "argusDesk"
	}
	if c.PollSeconds == 0 {
		c.PollSeconds = 60
	}
	if c.PollSeconds < 15 {
		bad("poll_seconds: 15초보다 짧을 수 없습니다 (현재 %d)", c.PollSeconds)
	}
	if c.Timezone == "" {
		c.Timezone = "Asia/Seoul"
	}
	loc, err := time.LoadLocation(c.Timezone)
	if err != nil {
		bad("timezone: 알 수 없는 시간대 %q", c.Timezone)
	}
	c.loc = loc
	if c.Game.XP == 0 {
		c.Game.XP = 10
	}
	if c.Game.Tired == 0 {
		c.Game.Tired = 8
	}
	if c.Game.Exhausted == 0 {
		c.Game.Exhausted = 14
	}
	if c.Game.Tired < 0 || c.Game.Exhausted < c.Game.Tired {
		bad("game: tired는 0보다 크고 exhausted는 tired 이상이어야 합니다")
	}
	if c.Game.XP < 0 {
		bad("game.xp: 0보다 커야 합니다")
	}
	if c.Game.SeasonStart != "" && loc != nil {
		at, perr := time.ParseInLocation("2006-01-02", c.Game.SeasonStart, loc)
		if perr != nil {
			bad("game.season_start: 날짜는 2026-01-01 형식이어야 합니다 (현재 %q)", c.Game.SeasonStart)
		}
		c.Game.start = at
	}
	if len(c.Spaces) == 0 {
		bad("spaces: 공간이 하나도 없습니다")
	}

	spaceIDs := map[string]bool{}
	for si := range c.Spaces {
		s := &c.Spaces[si]
		at := fmt.Sprintf("spaces[%s]", s.ID)
		if s.ID == "" {
			at = fmt.Sprintf("spaces[%d]", si)
			bad("%s: id가 없습니다", at)
		}
		if spaceIDs[s.ID] {
			bad("%s: id가 겹칩니다", at)
		}
		spaceIDs[s.ID] = true
		if s.Project == "" && s.JQL == "" {
			bad("%s: project 또는 jql이 필요합니다", at)
		}
		if s.Name == "" {
			s.Name = s.ID
		}

		zoneIDs := map[string]bool{}
		for zi := range s.Zones {
			z := &s.Zones[zi]
			zat := fmt.Sprintf("%s.zones[%s]", at, z.ID)
			if z.ID == "" || z.ID == UnsortedZone {
				bad("%s.zones[%d]: id가 없거나 예약된 이름입니다", at, zi)
			}
			if zoneIDs[z.ID] {
				bad("%s: id가 겹칩니다", zat)
			}
			zoneIDs[z.ID] = true
			if z.Name == "" {
				z.Name = z.ID
			}
			if !kinds[z.Kind] {
				bad("%s: kind는 wait, work, desk, done, returned, siding 중 하나여야 합니다 (현재 %q)", zat, z.Kind)
			}
			if z.Stale != nil {
				d, err := ParseDuration(z.Stale.After)
				if err != nil {
					bad("%s.stale.after: %v", zat, err)
				}
				z.Stale.after = d
				if z.Stale.From != FromZoneEntered && z.Stale.From != FromTypeField {
					bad("%s.stale.from: zone_entered 또는 type_field여야 합니다 (현재 %q)", zat, z.Stale.From)
				}
			}
		}
		if len(s.Zones) == 0 {
			bad("%s: zones가 비어 있습니다", at)
		}
		for status, zone := range s.StatusZones {
			if !zoneIDs[zone] {
				bad("%s.status_zones[%s]: 없는 구역 %q", at, status, zone)
			}
		}
		for name, w := range s.Workflows {
			wat := fmt.Sprintf("%s.workflows[%s]", at, name)
			known := func(where, status string) {
				if _, ok := s.StatusZones[status]; !ok {
					bad("%s.%s: 상태 %q가 status_zones에 없습니다", wat, where, status)
				}
			}
			if w.Start == "" {
				bad("%s: start가 없습니다", wat)
			} else {
				known("start", w.Start)
			}
			for from, tos := range w.Paths {
				known("paths", from)
				for _, to := range tos {
					known("paths["+from+"]", to)
				}
			}
			for _, st := range w.FromAny {
				known("from_any", st)
			}
		}
		for name, t := range s.Types {
			tat := fmt.Sprintf("%s.types[%s]", at, name)
			if t.Workflow != "" {
				if _, ok := s.Workflows[t.Workflow]; !ok {
					bad("%s.workflow: 없는 워크플로우 %q", tat, t.Workflow)
				}
			}
			if t.Unscheduled != nil && t.Unscheduled.Label == "" {
				t.Unscheduled.Label = "일정 미정"
				s.Types[name] = t
			}
		}
	}
	if len(errs) > 0 {
		return errors.New("설정 파일에 문제가 있습니다:\n- " + strings.Join(errs, "\n- "))
	}
	return nil
}
