package board

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/game"
	"github.com/sizzlei/argusDesk/internal/jira"
)

// DoneJQL is the query for a space's tickets finished since a day: the
// configured request types, in a status that belongs to a "done" zone.
// It returns "" when the space has nothing that counts as finished.
func DoneJQL(sp *config.Space, since time.Time) string {
	if sp.Project == "" {
		return ""
	}
	var ids []string
	for status, zone := range sp.StatusZones {
		if z := sp.Zone(zone); z != nil && z.Kind == config.KindDone {
			ids = append(ids, status)
		}
	}
	if len(ids) == 0 {
		return ""
	}
	sort.Strings(ids)
	names := make([]string, 0, len(sp.Types))
	for n := range sp.Types {
		names = append(names, `"`+strings.ReplaceAll(n, `"`, `\"`)+`"`)
	}
	sort.Strings(names)
	q := fmt.Sprintf(`project = "%s"`, sp.Project)
	if len(names) > 0 {
		q += " AND issuetype in (" + strings.Join(names, ", ") + ")"
	}
	return q + fmt.Sprintf(` AND status in (%s) AND statusCategoryChangedDate >= "%s" ORDER BY created ASC`, strings.Join(ids, ", "), since.Format("2006-01-02"))
}

// Dones reads every ticket finished since the season started, with what each
// is worth. It is a heavier read than a refresh and is asked for rarely.
func Dones(ctx context.Context, cfg *config.Config, src Source, since time.Time) ([]game.Done, error) {
	var out []game.Done
	for i := range cfg.Spaces {
		sp := &cfg.Spaces[i]
		jql := DoneJQL(sp, since)
		if jql == "" {
			continue
		}
		issues, err := src.Search(ctx, jql, []string{"assignee", "issuetype", "created", "statuscategorychangedate"})
		if err != nil {
			return nil, err
		}
		for _, is := range issues {
			var who struct {
				AccountID string `json:"accountId"`
			}
			var typ struct {
				Name string `json:"name"`
			}
			var created, changed string
			_ = json.Unmarshal(is.Fields["assignee"], &who)
			_ = json.Unmarshal(is.Fields["issuetype"], &typ)
			_ = json.Unmarshal(is.Fields["created"], &created)
			_ = json.Unmarshal(is.Fields["statuscategorychangedate"], &changed)
			at, err := jira.ParseTime(changed)
			if err != nil {
				continue // no finish time: cannot be placed in the season
			}
			d := game.Done{Key: is.Key, Space: sp.ID, Type: typ.Name, AssigneeID: who.AccountID, At: at, XP: cfg.Game.XP}
			d.Created, _ = jira.ParseTime(created)
			if t, ok := sp.Types[typ.Name]; ok && t.XP > 0 {
				d.XP = t.XP
			}
			out = append(out, d)
		}
	}
	return out, nil
}

// TypeNames lists every request type the settings know.
func TypeNames(cfg *config.Config) []string {
	var out []string
	for _, sp := range cfg.Spaces {
		for n := range sp.Types {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out
}
