package board

import (
	"strings"
	"testing"

	"github.com/sizzlei/argusDesk/internal/model"
)

func notesSnap() *model.Snapshot {
	return &model.Snapshot{
		Spaces: []model.SpaceView{{ID: "s", Zones: []model.ZoneView{
			{ID: "lobby", Name: "접수 로비", Kind: "wait"},
			{ID: "review", Name: "검토실", Kind: "work"},
			{ID: "work", Name: "작업장", Kind: "desk"},
		}}},
		Boxes: []model.Box{
			{Key: "A-1", Summary: "새 요청", Space: "s", Zone: "lobby"},
			{Key: "A-2", Summary: "검토할 것", Space: "s", Zone: "review"},
			{Key: "A-3", Summary: "내 것", Space: "s", Zone: "work", Mine: true},
			{Key: "A-4", Summary: "남의 것", Space: "s", Zone: "work"},
			{Key: "A-5", Summary: "방금 받은 것", Space: "s", Zone: "work", Mine: true},
		},
	}
}

func TestNotes(t *testing.T) {
	changes := []model.Change{
		{Kind: "added", Key: "A-1", ToZone: "lobby"},
		{Kind: "moved", Key: "A-2", FromZone: "lobby", ToZone: "review"},
		{Kind: "moved", Key: "A-3", FromZone: "review", ToZone: "work"},
		{Kind: "moved", Key: "A-4", FromZone: "review", ToZone: "work"}, // someone else's, into a desk room: quiet
		{Kind: "updated", Key: "A-4", ToZone: "work"},                   // quiet
		{Kind: "removed", Key: "A-9", FromZone: "work"},                 // quiet
	}
	got := Notes(notesSnap(), changes, nil)
	want := []string{"새 상자 · 접수 로비", "검토실 도착", "내 상자 이동 · 작업장"}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i, w := range want {
		if got[i].Title != w {
			t.Errorf("note %d = %q, want %q", i, got[i].Title, w)
		}
	}
	if got[0].Body != "A-1 새 요청" {
		t.Errorf("body = %q", got[0].Body)
	}
}

func TestNotesAssignedToMeAndSkipped(t *testing.T) {
	changes := []model.Change{
		{Kind: "moved", Key: "A-5", FromZone: "work", ToZone: "work"},
		{Kind: "moved", Key: "A-4", FromZone: "work", ToZone: "work"}, // reassigned between others: quiet
		{Kind: "added", Key: "A-1", ToZone: "lobby"},
	}
	got := Notes(notesSnap(), changes, map[string]bool{"A-1": true})
	if len(got) != 1 || got[0].Title != "나에게 배정됨 · 작업장" {
		t.Fatalf("got %+v", got)
	}
}

func TestNotesFoldsABurst(t *testing.T) {
	s := notesSnap()
	var changes []model.Change
	for _, b := range s.Boxes {
		changes = append(changes, model.Change{Kind: "added", Key: b.Key, ToZone: b.Zone})
	}
	got := Fold(Notes(s, changes, nil))
	if len(got) != 1 || !strings.Contains(got[0].Title, "5개") || !strings.Contains(got[0].Body, "외 2건") {
		t.Fatalf("got %+v", got)
	}
}

func TestNotesPutMyApprovalsFirstAndNeverFoldThem(t *testing.T) {
	s := notesSnap()
	s.Boxes[1].MyApproval = true // A-2, in the review room
	changes := []model.Change{
		{Kind: "added", Key: "A-1", ToZone: "lobby"},
		{Kind: "approval", Key: "A-2", ToZone: "review"},
	}
	got := Notes(s, changes, nil)
	if len(got) != 2 || got[0].Kind != "approval" || got[0].Key != "A-2" || got[0].Title != "내 승인 요청 · 검토실" {
		t.Fatalf("got %+v", got)
	}
	var burst []model.Change
	for _, b := range s.Boxes {
		burst = append(burst, model.Change{Kind: "added", Key: b.Key, ToZone: b.Zone})
	}
	folded := Fold(Notes(s, burst, nil))
	if len(folded) != 2 || folded[0].Kind != "approval" || folded[1].Kind != "summary" {
		t.Fatalf("folded %+v", folded)
	}
}
