// Package board turns Jira tickets into the centre: which box stands in
// which zone, how old it is, and what changed since the last look.
package board

import (
	"fmt"
	"sort"
	"time"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/model"
	"github.com/sizzlei/argusDesk/internal/stale"
)

// Input is everything Assemble needs. It has no I/O, so the placement rules
// can be tested with plain data.
type Input struct {
	Config     *config.Config
	Tickets    map[string][]model.Ticket // space id -> tickets
	Entered    map[string]time.Time      // ticket key -> when it entered its current status
	FieldID    map[string]string         // field name -> Jira field id
	StatusName map[string]string         // status id -> name (for route cells)
	Me         string                    // account id of the signed-in user
	BrowseURL  func(key string) string
	Now        time.Time
}

// Assemble places every ticket and returns the centre.
func Assemble(in Input) *model.Snapshot {
	cfg := in.Config
	snap := &model.Snapshot{
		Name:          cfg.Name,
		ConfigVersion: cfg.Version,
		FetchedAt:     in.Now,
		Boxes:         []model.Box{},
		Members:       []model.Member{},
		Warnings:      []string{},
	}
	warned := map[string]bool{}
	warn := func(format string, a ...any) {
		if msg := fmt.Sprintf(format, a...); !warned[msg] {
			warned[msg] = true
			snap.Warnings = append(snap.Warnings, msg)
		}
	}

	for si := range cfg.Spaces {
		sp := &cfg.Spaces[si]
		view := model.SpaceView{ID: sp.ID, Name: sp.Name, Project: sp.Project}
		index := map[string]int{}
		for _, z := range sp.Zones {
			zv := model.ZoneView{ID: z.ID, Name: z.Name, Kind: z.Kind, Approval: z.Approval}
			if z.Stale != nil {
				zv.StaleAfter = z.Stale.After
			}
			index[z.ID] = len(view.Zones)
			view.Zones = append(view.Zones, zv)
		}

		tickets := in.Tickets[sp.ID]
		sort.Slice(tickets, func(i, j int) bool { return tickets[i].Created.Before(tickets[j].Created) })
		for ti := range tickets {
			t := &tickets[ti]
			zoneID, ok := sp.StatusZones[t.StatusID]
			if !ok {
				zoneID = config.UnsortedZone
				warn("설정에 없는 상태입니다: %s (%s). 해당 상자는 미분류 선반에 둡니다.", t.Status, t.StatusID)
				if _, has := index[zoneID]; !has {
					index[zoneID] = len(view.Zones)
					view.Zones = append(view.Zones, model.ZoneView{ID: zoneID, Name: "미분류 선반", Kind: config.KindUnsorted})
				}
			}
			var typ *config.Type
			if tc, ok := sp.Types[t.Type]; ok {
				typ = &tc
			} else {
				warn("설정에 없는 유형입니다: %s", t.Type)
			}

			b := model.Box{
				Key: t.Key, Summary: t.Summary, Type: t.Type, StatusID: t.StatusID, Status: t.Status,
				Priority: t.Priority, AssigneeID: t.AssigneeID, Assignee: t.Assignee, Reporter: t.Reporter,
				Created: t.Created, Updated: t.Updated, Space: sp.ID, Zone: zoneID,
				Mine: in.Me != "" && t.AssigneeID == in.Me,
			}
			if in.BrowseURL != nil {
				b.URL = in.BrowseURL(t.Key)
			}
			if typ != nil {
				b.Tag, b.Workflow = typ.Tag, typ.Workflow
				if wf, ok := sp.Workflows[typ.Workflow]; ok {
					b.Path = route(&wf, t.StatusID, in.StatusName)
				}
			}
			var entered *time.Time
			if at, ok := in.Entered[t.Key]; ok {
				entered = &at
				b.EnteredAt = entered
			}
			r := stale.Evaluate(sp.Zone(zoneID), typ, t, entered, in.FieldID, in.Now, cfg.Location())
			b.StaleFrom, b.StaleRatio, b.Stale, b.Note = r.From, r.Ratio, r.Stale, r.Note

			zv := &view.Zones[index[zoneID]]
			zv.Count++
			if b.Stale {
				zv.StaleCount++
			}
			snap.Boxes = append(snap.Boxes, b)
		}
		snap.Spaces = append(snap.Spaces, view)
	}
	snap.Members = members(cfg, snap.Boxes, in.Me)
	return snap
}

// route builds the waybill cells: the shortest way from the workflow's start
// to the current status (stamped), then the statuses that can follow.
func route(wf *config.Workflow, current string, names map[string]string) []model.PathStep {
	name := func(id string) string {
		if n := names[id]; n != "" {
			return n
		}
		return id
	}
	// Breadth-first search from the start; prev remembers how each status was reached.
	prev := map[string]string{wf.Start: ""}
	queue := []string{wf.Start}
	for len(queue) > 0 && current != wf.Start {
		at := queue[0]
		queue = queue[1:]
		for _, to := range wf.Paths[at] {
			if _, seen := prev[to]; !seen {
				prev[to] = at
				queue = append(queue, to)
			}
		}
	}
	var steps []model.PathStep
	if _, reachable := prev[current]; reachable {
		var chain []string
		for at := current; at != ""; at = prev[at] {
			chain = append([]string{at}, chain...)
		}
		for _, id := range chain[:len(chain)-1] {
			steps = append(steps, model.PathStep{StatusID: id, Name: name(id), State: "done"})
		}
	}
	// A status reached only through from_any (a cancellation) has no chain.
	steps = append(steps, model.PathStep{StatusID: current, Name: name(current), State: "current"})
	for _, to := range wf.Paths[current] {
		steps = append(steps, model.PathStep{StatusID: to, Name: name(to), State: "next"})
	}
	return steps
}

// members places one avatar per assignee: in the zone of the box they
// touched most recently, preferring boxes that still need work.
func members(cfg *config.Config, boxes []model.Box, me string) []model.Member {
	type pick struct {
		m    model.Member
		at   time.Time
		open bool
	}
	picks := map[string]*pick{}
	var order []string
	for _, b := range boxes {
		if b.AssigneeID == "" {
			continue
		}
		open := false
		if sp := cfg.Space(b.Space); sp != nil {
			if z := sp.Zone(b.Zone); z != nil {
				open = z.Kind == config.KindWork || z.Kind == config.KindDesk
			}
		}
		p := picks[b.AssigneeID]
		if p == nil {
			p = &pick{m: model.Member{ID: b.AssigneeID, Name: b.Assignee, Me: b.AssigneeID == me}}
			picks[b.AssigneeID] = p
			order = append(order, b.AssigneeID)
		}
		if open {
			p.m.Count++
		}
		if p.m.Zone == "" || (open && !p.open) || (open == p.open && b.Updated.After(p.at)) {
			p.m.Space, p.m.Zone, p.at, p.open = b.Space, b.Zone, b.Updated, open
		}
	}
	sort.Slice(order, func(i, j int) bool { return picks[order[i]].m.Name < picks[order[j]].m.Name })
	out := make([]model.Member, 0, len(order))
	for _, id := range order {
		out = append(out, picks[id].m)
	}
	return out
}

// Diff lists what changed between two snapshots, in the order of the new one.
func Diff(prev, next *model.Snapshot) []model.Change {
	changes := []model.Change{}
	if prev == nil {
		return changes
	}
	old := map[string]model.Box{}
	for _, b := range prev.Boxes {
		old[b.Key] = b
	}
	seen := map[string]bool{}
	for _, b := range next.Boxes {
		seen[b.Key] = true
		o, had := old[b.Key]
		switch {
		case !had:
			changes = append(changes, model.Change{Kind: "added", Key: b.Key, ToZone: b.Zone})
		case !o.MyApproval && b.MyApproval && o.Zone == b.Zone:
			// stayed where it was, and now waits for this user's approval
			changes = append(changes, model.Change{Kind: "approval", Key: b.Key, ToZone: b.Zone})
		case o.Zone != b.Zone || o.Space != b.Space || o.AssigneeID != b.AssigneeID:
			changes = append(changes, model.Change{Kind: "moved", Key: b.Key, FromZone: o.Zone, ToZone: b.Zone})
		case o.Stale != b.Stale || o.Priority != b.Priority || o.Summary != b.Summary || o.StatusID != b.StatusID || o.Note != b.Note:
			changes = append(changes, model.Change{Kind: "updated", Key: b.Key, ToZone: b.Zone})
		}
	}
	for _, b := range prev.Boxes {
		if !seen[b.Key] {
			changes = append(changes, model.Change{Kind: "removed", Key: b.Key, FromZone: b.Zone})
		}
	}
	return changes
}
