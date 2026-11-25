package board

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/jira"
	"github.com/sizzlei/argusDesk/internal/model"
)

// Source is the part of Jira the engine reads. *jira.Client implements it.
type Source interface {
	Fields(ctx context.Context) ([]jira.Field, error)
	ProjectStatuses(ctx context.Context, project string) (map[string]string, error)
	Search(ctx context.Context, jql string, fields []string) ([]jira.Issue, error)
	StatusEnteredAt(ctx context.Context, key, statusID string) (time.Time, bool, error)
	BrowseURL(key string) string
}

// Engine reads Jira and keeps the last snapshot.
type Engine struct {
	cfg *config.Config
	src Source
	me  string
	now func() time.Time

	mu         sync.Mutex
	prepared   bool
	fieldID    map[string]string
	statusName map[string]string
	notes      []string           // problems found while preparing, repeated as warnings
	entered    map[string]entered // ticket key -> status entry time
	last       *model.Snapshot
}

type entered struct {
	status string
	at     time.Time
}

// NewEngine makes an engine for one settings file and one signed-in user.
func NewEngine(cfg *config.Config, src Source, me string) *Engine {
	return &Engine{cfg: cfg, src: src, me: me, now: time.Now, entered: map[string]entered{}}
}

// Last returns the most recent snapshot (nil before the first refresh).
func (e *Engine) Last() *model.Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.last
}

// prepare looks up field ids and status names once, and compares the
// settings file with what Jira has.
func (e *Engine) prepare(ctx context.Context) error {
	if e.prepared {
		return nil
	}
	e.fieldID, e.statusName, e.notes = map[string]string{}, map[string]string{}, nil
	if names := e.cfg.FieldNames(); len(names) > 0 {
		fields, err := e.src.Fields(ctx)
		if err != nil {
			return err
		}
		byName := map[string]string{}
		for _, f := range fields {
			if _, dup := byName[f.Name]; !dup {
				byName[f.Name] = f.ID
			}
		}
		for _, n := range names {
			if id, ok := byName[n]; ok {
				e.fieldID[n] = id
			} else {
				e.notes = append(e.notes, fmt.Sprintf("Jira에 없는 필드입니다: %s. 이 필드를 쓰는 상자는 묵은 상자로 세지 않습니다.", n))
			}
		}
	}
	for _, sp := range e.cfg.Spaces {
		if sp.Project == "" {
			continue
		}
		st, err := e.src.ProjectStatuses(ctx, sp.Project)
		if err != nil {
			return err
		}
		for id, name := range st {
			e.statusName[id] = name
		}
		var missing []string
		for id := range sp.StatusZones {
			if _, ok := st[id]; !ok {
				missing = append(missing, id)
			}
		}
		if len(missing) > 0 {
			sort.Strings(missing)
			e.notes = append(e.notes, fmt.Sprintf("설정의 상태 ID가 %s 프로젝트에 없습니다: %s", sp.Project, strings.Join(missing, ", ")))
		}
	}
	e.prepared = true
	return nil
}

// JQL is the query for a space: its configured request types that are open,
// plus the ones finished today.
func JQL(sp *config.Space) string {
	if sp.JQL != "" {
		return sp.JQL
	}
	names := make([]string, 0, len(sp.Types))
	for n := range sp.Types {
		names = append(names, `"`+strings.ReplaceAll(n, `"`, `\"`)+`"`)
	}
	sort.Strings(names)
	q := fmt.Sprintf(`project = "%s"`, sp.Project)
	if len(names) > 0 {
		q += " AND issuetype in (" + strings.Join(names, ", ") + ")"
	}
	return q + " AND (statusCategory != Done OR statusCategoryChangedDate >= startOfDay()) ORDER BY created ASC"
}

// Refresh reads Jira once and returns the new snapshot with what changed.
func (e *Engine) Refresh(ctx context.Context) (*model.Snapshot, []model.Change, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.prepare(ctx); err != nil {
		return nil, nil, err
	}
	fields := []string{"summary", "status", "issuetype", "priority", "assignee", "reporter", "created", "updated", "duedate"}
	for _, id := range e.fieldID {
		fields = append(fields, id)
	}

	tickets := map[string][]model.Ticket{}
	alive := map[string]bool{}
	for si := range e.cfg.Spaces {
		sp := &e.cfg.Spaces[si]
		issues, err := e.src.Search(ctx, JQL(sp), fields)
		if err != nil {
			return nil, nil, err
		}
		for _, is := range issues {
			t := toTicket(is)
			alive[t.Key] = true
			tickets[sp.ID] = append(tickets[sp.ID], t)
			// The entry time is only needed where a zone counts from it, and
			// only asked again when the status changed.
			z := sp.Zone(sp.StatusZones[t.StatusID])
			if z == nil || z.Stale == nil || z.Stale.From != config.FromZoneEntered {
				continue
			}
			if c, ok := e.entered[t.Key]; ok && c.status == t.StatusID {
				continue
			}
			at, ok, err := e.src.StatusEnteredAt(ctx, t.Key, t.StatusID)
			if err != nil {
				return nil, nil, err
			}
			if !ok {
				at = t.Created
			}
			e.entered[t.Key] = entered{status: t.StatusID, at: at}
		}
	}
	enteredAt := map[string]time.Time{}
	for key, c := range e.entered {
		if !alive[key] {
			delete(e.entered, key)
			continue
		}
		enteredAt[key] = c.at
	}

	snap := Assemble(Input{
		Config: e.cfg, Tickets: tickets, Entered: enteredAt, FieldID: e.fieldID,
		StatusName: e.statusName, Me: e.me, BrowseURL: e.src.BrowseURL, Now: e.now(),
	})
	snap.Warnings = append(append([]string{}, e.notes...), snap.Warnings...)
	changes := Diff(e.last, snap)
	e.last = snap
	return snap, changes, nil
}

// toTicket reads the fields the centre uses out of a search hit.
func toTicket(is jira.Issue) model.Ticket {
	t := model.Ticket{Key: is.Key, Custom: map[string]json.RawMessage{}}
	str := func(name string) string {
		var s string
		_ = json.Unmarshal(is.Fields[name], &s)
		return s
	}
	t.Summary = str("summary")
	t.Due = str("duedate")
	t.Created, _ = jira.ParseTime(str("created"))
	t.Updated, _ = jira.ParseTime(str("updated"))

	var named struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		AccountID   string `json:"accountId"`
		DisplayName string `json:"displayName"`
	}
	obj := func(name string) {
		named.ID, named.Name, named.AccountID, named.DisplayName = "", "", "", ""
		_ = json.Unmarshal(is.Fields[name], &named)
	}
	obj("status")
	t.StatusID, t.Status = named.ID, named.Name
	obj("issuetype")
	t.Type = named.Name
	obj("priority")
	t.Priority = named.Name
	obj("assignee")
	t.AssigneeID, t.Assignee = named.AccountID, named.DisplayName
	obj("reporter")
	t.Reporter = named.DisplayName

	for id, raw := range is.Fields {
		if strings.HasPrefix(id, "customfield_") {
			t.Custom[id] = raw
		}
	}
	return t
}
