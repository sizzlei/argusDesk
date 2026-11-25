package board

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/jira"
	"github.com/sizzlei/argusDesk/internal/model"
)

func example(t *testing.T) *config.Config {
	t.Helper()
	c, err := config.Load("../../config/example.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

var now = time.Date(2026, 11, 25, 12, 0, 0, 0, time.FixedZone("KST", 9*3600))

func tk(key, typ, status, assigneeID, assignee string, ageHours int) model.Ticket {
	at := now.Add(-time.Duration(ageHours) * time.Hour)
	return model.Ticket{Key: key, Summary: key + " 요약", Type: typ, StatusID: status, Status: "s" + status,
		AssigneeID: assigneeID, Assignee: assignee, Created: at, Updated: at}
}

func box(s *model.Snapshot, key string) model.Box {
	for _, b := range s.Boxes {
		if b.Key == key {
			return b
		}
	}
	return model.Box{}
}

func zoneView(s *model.Snapshot, id string) model.ZoneView {
	for _, z := range s.Spaces[0].Zones {
		if z.ID == id {
			return z
		}
	}
	return model.ZoneView{}
}

func TestAssemblePlacesByStatus(t *testing.T) {
	cfg := example(t)
	snap := Assemble(Input{
		Config: cfg, Now: now, Me: "u1",
		Tickets: map[string][]model.Ticket{"requests": {
			tk("REQ-1", "[REQ] 계정 요청", "10001", "", "", 1),
			tk("REQ-2", "[REQ] 계정 요청", "10003", "", "", 10),
			tk("REQ-3", "[REQ] 계정 요청", "10004", "u1", "김하늘", 24*6),
			tk("REQ-4", "[REQ] 기타", "10004", "u2", "이도윤", 2),
			tk("REQ-5", "[REQ] 계정 요청", "99999", "", "", 1),
			tk("REQ-6", "[???] 새 유형", "10002", "", "", 1),
		}},
		Entered:    map[string]time.Time{"REQ-2": now.Add(-4 * time.Hour)},
		StatusName: map[string]string{"10001": "요청 부서 승인 대기", "10002": "검토 중", "10003": "승인 대기", "10004": "작업 대기", "10005": "완료", "10006": "반려"},
		BrowseURL:  func(k string) string { return "https://example.atlassian.net/browse/" + k },
	})

	for key, zone := range map[string]string{"REQ-1": "lobby", "REQ-2": "approval", "REQ-3": "work", "REQ-5": config.UnsortedZone, "REQ-6": "review"} {
		if got := box(snap, key).Zone; got != zone {
			t.Errorf("%s in %q, want %q", key, got, zone)
		}
	}
	if b := box(snap, "REQ-2"); !b.Stale || b.StaleRatio < 1.3 {
		t.Errorf("4h in a 3h zone: %+v", b)
	}
	if b := box(snap, "REQ-3"); !b.Stale || !b.Mine || b.Tag != "orange" {
		t.Errorf("6 days old, created-based, mine: %+v", b)
	}
	if b := box(snap, "REQ-4"); b.Stale {
		t.Errorf("no date on the ticket, so not counted: %+v", b)
	}
	if z := zoneView(snap, "work"); z.Count != 2 || z.StaleCount != 1 || z.StaleAfter != "5d" {
		t.Errorf("work zone: %+v", z)
	}
	if z := zoneView(snap, config.UnsortedZone); z.Count != 1 || z.Kind != config.KindUnsorted {
		t.Errorf("unsorted zone: %+v", z)
	}
	joined := strings.Join(snap.Warnings, "\n")
	if !strings.Contains(joined, "99999") || !strings.Contains(joined, "[???] 새 유형") {
		t.Errorf("warnings: %v", snap.Warnings)
	}
	if got := box(snap, "REQ-1").URL; got != "https://example.atlassian.net/browse/REQ-1" {
		t.Errorf("url = %q", got)
	}
}

func TestRoute(t *testing.T) {
	cfg := example(t)
	names := map[string]string{"10001": "요청 부서 승인 대기", "10002": "검토 중", "10003": "승인 대기", "10004": "작업 대기", "10006": "반려"}
	wf := cfg.Space("requests").Workflows["standard"]
	got := ""
	for _, s := range route(&wf, "10003", names) {
		got += fmt.Sprintf("%s:%s ", s.Name, s.State)
	}
	want := "요청 부서 승인 대기:done 검토 중:done 승인 대기:current 작업 대기:next 반려:next "
	if got != want {
		t.Errorf("route\n got %s\nwant %s", got, want)
	}
	// A cancelled ticket is reached through from_any: only itself is shown.
	if steps := route(&wf, "10007", names); len(steps) != 1 || steps[0].State != "current" {
		t.Errorf("cancelled: %+v", steps)
	}
}

func TestMembersStandWhereTheyWork(t *testing.T) {
	cfg := example(t)
	snap := Assemble(Input{Config: cfg, Now: now, Me: "u1", Tickets: map[string][]model.Ticket{"requests": {
		tk("REQ-1", "[REQ] 기타", "10005", "u1", "김하늘", 0), // finished just now
		tk("REQ-2", "[REQ] 기타", "10002", "u1", "김하늘", 5), // older, but still open
		tk("REQ-3", "[REQ] 기타", "10005", "u2", "이도윤", 1), // only finished work
	}}})
	if len(snap.Members) != 2 {
		t.Fatalf("members: %+v", snap.Members)
	}
	me, other := snap.Members[0], snap.Members[1]
	if me.Zone != "review" || !me.Me || me.Count != 1 {
		t.Errorf("open work wins over a newer finished box: %+v", me)
	}
	if other.Zone != "dock" || other.Count != 0 {
		t.Errorf("with nothing open, stand at the last box: %+v", other)
	}
}

func TestDiff(t *testing.T) {
	cfg := example(t)
	mk := func(ts ...model.Ticket) *model.Snapshot {
		return Assemble(Input{Config: cfg, Now: now, Tickets: map[string][]model.Ticket{"requests": ts}})
	}
	a := mk(tk("REQ-1", "[REQ] 기타", "10002", "", "", 1), tk("REQ-2", "[REQ] 기타", "10004", "", "", 1), tk("REQ-3", "[REQ] 기타", "10004", "", "", 1))
	b := mk(tk("REQ-1", "[REQ] 기타", "10003", "", "", 1), tk("REQ-2", "[REQ] 기타", "10004", "u1", "김하늘", 1), tk("REQ-4", "[REQ] 기타", "10002", "", "", 1))
	got := ""
	for _, c := range Diff(a, b) {
		got += c.Kind + ":" + c.Key + " "
	}
	if want := "moved:REQ-1 moved:REQ-2 added:REQ-4 removed:REQ-3 "; got != want {
		t.Errorf("diff = %s, want %s", got, want)
	}
	if len(Diff(nil, b)) != 0 {
		t.Error("the first snapshot has no changes")
	}
}

// fake is a Jira that answers from memory and counts history lookups.
type fake struct {
	issues  []jira.Issue
	pending []jira.Issue // what waits for this user's approval
	history int
}

func (f *fake) Fields(context.Context) ([]jira.Field, error) {
	return []jira.Field{{ID: "customfield_1", Name: "작업 완료 요청일시"}}, nil
}
func (f *fake) ProjectStatuses(context.Context, string) (map[string]string, error) {
	return map[string]string{"10001": "요청 부서 승인 대기", "10002": "검토 중", "10003": "승인 대기", "10004": "작업 대기", "10005": "완료", "10006": "반려"}, nil
}
func (f *fake) Search(_ context.Context, jql string, _ []string) ([]jira.Issue, error) {
	if strings.Contains(jql, "myPending()") {
		return f.pending, nil
	}
	return f.issues, nil
}
func (f *fake) StatusEnteredAt(context.Context, string, string) (time.Time, bool, error) {
	f.history++
	return now.Add(-4 * time.Hour), true, nil
}
func (f *fake) BrowseURL(k string) string { return "https://x/browse/" + k }

func issue(key, status, statusName string) jira.Issue {
	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	return jira.Issue{Key: key, Fields: map[string]json.RawMessage{
		"summary":       raw("가짜 요청"),
		"status":        raw(map[string]string{"id": status, "name": statusName}),
		"issuetype":     raw(map[string]string{"name": "[REQ] 기타"}),
		"priority":      raw(map[string]string{"name": "Medium"}),
		"assignee":      raw(map[string]string{"accountId": "u1", "displayName": "김하늘"}),
		"reporter":      raw(map[string]string{"displayName": "박서준"}),
		"created":       raw("2026-11-25T09:00:00.000+0900"),
		"updated":       raw("2026-11-25T10:00:00.000+0900"),
		"customfield_1": raw("2026-11-30T18:00:00.000+0900"),
	}}
}

func TestEngineRefresh(t *testing.T) {
	f := &fake{issues: []jira.Issue{issue("REQ-1", "10002", "검토 중"), issue("REQ-2", "10004", "작업 대기")}}
	e := NewEngine(example(t), f, "u1")
	e.now = func() time.Time { return now }

	snap, changes, err := e.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	b := box(snap, "REQ-1")
	if b.Zone != "review" || !b.Stale || b.Assignee != "김하늘" || b.Reporter != "박서준" || !b.Mine || b.Created.IsZero() {
		t.Errorf("first box: %+v", b)
	}
	if len(changes) != 0 || f.history != 1 {
		t.Errorf("first refresh: %d changes, %d history lookups (only the review box needs one)", len(changes), f.history)
	}
	// "배포 일정 확정" is not a field of the fake Jira: reported once, as a warning.
	if w := strings.Join(snap.Warnings, "\n"); !strings.Contains(w, "배포 일정 확정") || !strings.Contains(w, "10007") {
		t.Errorf("warnings: %v", snap.Warnings)
	}

	// Nothing moved: no new history lookup.
	if _, _, err := e.Refresh(context.Background()); err != nil || f.history != 1 {
		t.Errorf("second refresh: err %v, %d history lookups", err, f.history)
	}
	// The box moves to approval: one more lookup, one change.
	f.issues[0] = issue("REQ-1", "10003", "승인 대기")
	_, changes, err = e.Refresh(context.Background())
	if err != nil || f.history != 2 || len(changes) != 1 || changes[0].Kind != "moved" || changes[0].ToZone != "approval" {
		t.Errorf("after the move: err %v, %d lookups, changes %+v", err, f.history, changes)
	}
}

func TestJQL(t *testing.T) {
	sp := example(t).Space("requests")
	q := JQL(sp)
	for _, want := range []string{`project = "REQ"`, `"[REQ] 기타"`, "statusCategory != Done", "startOfDay()"} {
		if !strings.Contains(q, want) {
			t.Errorf("jql lacks %q: %s", want, q)
		}
	}
	sp.JQL = "filter = 1"
	if JQL(sp) != "filter = 1" {
		t.Error("a jql in the file replaces the generated one")
	}
}

func TestDoneJQLAndDones(t *testing.T) {
	cfg := example(t)
	sp := &cfg.Spaces[0]
	since := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	q := DoneJQL(sp, since)
	if !strings.Contains(q, `statusCategoryChangedDate >= "2026-01-01"`) || !strings.Contains(q, "status in (") {
		t.Fatalf("jql = %s", q)
	}
	var typeName string
	for n := range sp.Types {
		typeName = n
		break
	}
	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	f := &fake{issues: []jira.Issue{{Key: "A-1", Fields: map[string]json.RawMessage{
		"assignee":                 raw(map[string]string{"accountId": "u1"}),
		"issuetype":                raw(map[string]string{"name": typeName}),
		"created":                  raw("2026-11-24T09:00:00.000+0900"),
		"statuscategorychangedate": raw("2026-11-25T10:00:00.000+0900"),
	}}, {Key: "A-2", Fields: map[string]json.RawMessage{}}}}
	got, err := Dones(context.Background(), cfg, f, since)
	if err != nil || len(got) != 1 || got[0].AssigneeID != "u1" || got[0].XP != 10 || got[0].At.IsZero() {
		t.Fatalf("got %+v, err %v", got, err)
	}
}

func TestRefreshMarksMyApprovals(t *testing.T) {
	cfg := example(t)
	f := &fake{issues: []jira.Issue{issue("A-1", "10003", "승인 대기"), issue("A-2", "10003", "승인 대기")}}
	e := NewEngine(cfg, f, "u1")
	if _, _, err := e.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.pending = []jira.Issue{{Key: "A-2"}}
	snap, changes, err := e.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if box(snap, "A-1").MyApproval || !box(snap, "A-2").MyApproval {
		t.Fatalf("marks: %v %v", box(snap, "A-1").MyApproval, box(snap, "A-2").MyApproval)
	}
	if len(changes) != 1 || changes[0].Kind != "approval" || changes[0].Key != "A-2" {
		t.Fatalf("changes = %+v", changes)
	}
	if q := ApprovalJQL(cfg); !strings.Contains(q, "approvals = myPending()") || !strings.Contains(q, "project in (") {
		t.Fatalf("jql = %s", q)
	}
}
