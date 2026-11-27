package board

import (
	"fmt"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/model"
)

// Note is one thing worth telling the user about.
type Note struct {
	Key   string `json:"key"`  // the ticket it is about ("" for a summary)
	Kind  string `json:"kind"` // "approval" | "reply" | "new" | "arrive" | "mine" | "assigned" | "summary"
	Title string `json:"title"`
	Body  string `json:"body"`
}

// maxNotes is how many separate notes one refresh may raise outside the
// window; more than that are folded into a single summary.
const maxNotes = 3

// Notes turns the changes of one refresh into notifications:
//
//   - a box now waits for my approval (always told, and told first)
//   - a new box arrived
//   - a box reached a room where someone has to look at it (kind "work")
//   - one of my boxes moved, or a box was given to me
//
// Boxes in skip (the ones this user just changed themselves) are left out.
func Notes(snap *model.Snapshot, changes []model.Change, skip map[string]bool) []Note {
	if snap == nil {
		return nil
	}
	boxes := map[string]model.Box{}
	for _, b := range snap.Boxes {
		boxes[b.Key] = b
	}
	zones := map[string]model.ZoneView{}
	for _, sp := range snap.Spaces {
		for _, z := range sp.Zones {
			zones[sp.ID+"/"+z.ID] = z
		}
	}
	var first, rest []Note
	for _, c := range changes {
		b, ok := boxes[c.Key]
		if !ok || skip[c.Key] {
			continue
		}
		z := zones[b.Space+"/"+b.Zone]
		body := b.Key + " " + b.Summary
		switch {
		case b.MyApproval && (c.Kind == "approval" || c.Kind == "added" || (c.Kind == "moved" && c.FromZone != c.ToZone)):
			first = append(first, Note{Key: b.Key, Kind: "approval", Title: "내 승인 요청 · " + z.Name, Body: body})
		case c.Kind == "added":
			rest = append(rest, Note{Key: b.Key, Kind: "new", Title: "새 상자 · " + z.Name, Body: body})
		case c.Kind == "moved" && c.FromZone == c.ToZone:
			if b.Mine { // only the assignee changed
				rest = append(rest, Note{Key: b.Key, Kind: "assigned", Title: "나에게 배정됨 · " + z.Name, Body: body})
			}
		case c.Kind == "reply" && (b.Mine || b.AssigneeID == ""):
			first = append(first, Note{Key: b.Key, Kind: "reply", Title: "요청자 답변 · " + b.Reporter, Body: body})
		case c.Kind == "moved" && b.Mine:
			rest = append(rest, Note{Key: b.Key, Kind: "mine", Title: "내 상자 이동 · " + z.Name, Body: body})
		case c.Kind == "moved" && z.Kind == config.KindWork:
			rest = append(rest, Note{Key: b.Key, Kind: "arrive", Title: z.Name + " 도착", Body: body})
		}
	}
	return append(first, rest...)
}

// Fold keeps a burst from flooding the screen: approval requests always go
// out one by one, and the rest become one summary when there are too many.
func Fold(notes []Note) []Note {
	var out, rest []Note
	for _, n := range notes {
		if n.Kind == "approval" || n.Kind == "reply" {
			out = append(out, n)
		} else {
			rest = append(rest, n)
		}
	}
	if len(rest) <= maxNotes {
		return append(out, rest...)
	}
	body := ""
	for i, n := range rest[:maxNotes] {
		if i > 0 {
			body += ", "
		}
		body += n.Key
	}
	return append(out, Note{Kind: "summary", Title: fmt.Sprintf("상자 %d개에 변화가 있습니다", len(rest)), Body: fmt.Sprintf("%s 외 %d건", body, len(rest)-maxNotes)})
}
