package board

import (
	"fmt"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/model"
)

// Note is one thing worth telling the user about outside the window.
type Note struct {
	Key   string // the ticket it is about ("" for a summary)
	Title string
	Body  string
}

// maxNotes is how many separate notes one refresh may raise; more than that
// are folded into a single summary.
const maxNotes = 3

// Notes turns the changes of one refresh into notifications:
//
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
	var out []Note
	for _, c := range changes {
		b, ok := boxes[c.Key]
		if !ok || skip[c.Key] {
			continue
		}
		z := zones[b.Space+"/"+b.Zone]
		body := b.Key + " " + b.Summary
		switch {
		case c.Kind == "added":
			out = append(out, Note{Key: b.Key, Title: "새 상자 · " + z.Name, Body: body})
		case c.Kind == "moved" && c.FromZone == c.ToZone:
			if b.Mine { // only the assignee changed
				out = append(out, Note{Key: b.Key, Title: "나에게 배정됨 · " + z.Name, Body: body})
			}
		case c.Kind == "moved" && b.Mine:
			out = append(out, Note{Key: b.Key, Title: "내 상자 이동 · " + z.Name, Body: body})
		case c.Kind == "moved" && z.Kind == config.KindWork:
			out = append(out, Note{Key: b.Key, Title: z.Name + " 도착", Body: body})
		}
	}
	if len(out) > maxNotes {
		body := ""
		for i, n := range out[:maxNotes] {
			if i > 0 {
				body += ", "
			}
			body += n.Key
		}
		return []Note{{Title: fmt.Sprintf("상자 %d개에 변화가 있습니다", len(out)), Body: fmt.Sprintf("%s 외 %d건", body, len(out)-maxNotes)}}
	}
	return out
}
