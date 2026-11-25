package jira

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestActionsListsMovesAndPendingApprovals(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/transitions"):
			io.WriteString(w, `{"transitions":[
			 {"id":"11","name":"검토 시작","to":{"id":"5","name":"검토 중"},"fields":{}},
			 {"id":"21","name":"반려","to":{"id":"9","name":"반려"},"fields":{
			   "resolution":{"required":true,"name":"해결책","hasDefaultValue":false},
			   "comment":{"required":false,"name":"댓글"}}}]}`)
		case r.URL.Path == "/rest/api/3/field":
			io.WriteString(w, `[{"id":"summary","name":"요약"},{"id":"customfield_10102","name":"Approvals","schema":{"custom":"com.atlassian.servicedesk.approvals-plugin:sd-approvals"}}]`)
		case r.URL.Path == "/rest/api/3/issue/A-1":
			if got := r.URL.Query().Get("fields"); got != "project,customfield_10102" {
				t.Errorf("fields = %q", got)
			}
			io.WriteString(w, `{"fields":{"project":{"projectTypeKey":"software"},"customfield_10102":[
			 {"id":"1","name":"부서 승인","finalDecision":"approved","canAnswerApproval":false,"approvers":[]},
			 {"id":"2","name":"DBA 승인","finalDecision":"pending","canAnswerApproval":true,"approvers":[
			   {"approver":{"accountId":"u1","displayName":"김하늘"},"approverDecision":"pending"}]}]}}`)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	a, err := c.Actions(context.Background(), "A-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Transitions) != 2 || a.Transitions[0].ToID != "5" || len(a.Transitions[0].Needs) != 0 {
		t.Fatalf("transitions = %+v", a.Transitions)
	}
	if n := a.Transitions[1].Needs; len(n) != 1 || n[0] != "해결책" {
		t.Fatalf("needs = %v", n)
	}
	if a.ServiceDesk || len(a.Approvals) != 1 || a.Approvals[0].ID != "2" || !a.Approvals[0].CanAnswer || a.Approvals[0].Approvers[0].Name != "김하늘" {
		t.Fatalf("approvals = %+v", a.Approvals)
	}
}

func TestActionsWithoutApprovalsField(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/rest/api/3/field":
			io.WriteString(w, `[{"id":"summary","name":"요약"}]`)
		case r.URL.Path == "/rest/api/3/issue/A-1":
			io.WriteString(w, `{"fields":{"project":{"projectTypeKey":"service_desk"}}}`)
		default:
			io.WriteString(w, `{"transitions":[]}`)
		}
	})
	a, err := c.Actions(context.Background(), "A-1")
	if err != nil || a.ApprovalsError == "" || !a.ServiceDesk || len(a.Approvals) != 0 {
		t.Fatalf("a = %+v, err = %v", a, err)
	}
}

func TestWritesSendWhatJiraExpects(t *testing.T) {
	type call struct {
		method, path string
		body         map[string]any
	}
	var got []call
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		got = append(got, call{r.Method, r.URL.Path, body})
		w.WriteHeader(http.StatusNoContent)
	})
	ctx := context.Background()
	for _, err := range []error{
		c.DoTransition(ctx, "A-1", "11"),
		c.Assign(ctx, "A-1", "u1"),
		c.Assign(ctx, "A-1", ""),
		c.AnswerApproval(ctx, "A-1", "2", true),
		c.AnswerApproval(ctx, "A-1", "2", false),
		c.AddComment(ctx, "A-1", "확인했습니다", CommentInternal),
		c.AddComment(ctx, "A-1", "첫 줄\n둘째 줄", CommentPlain),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	want := []call{
		{"POST", "/rest/api/3/issue/A-1/transitions", nil},
		{"PUT", "/rest/api/3/issue/A-1/assignee", nil},
		{"PUT", "/rest/api/3/issue/A-1/assignee", nil},
		{"POST", "/rest/servicedeskapi/request/A-1/approval/2", nil},
		{"POST", "/rest/servicedeskapi/request/A-1/approval/2", nil},
		{"POST", "/rest/servicedeskapi/request/A-1/comment", nil},
		{"POST", "/rest/api/3/issue/A-1/comment", nil},
	}
	if len(got) != len(want) {
		t.Fatalf("%d calls", len(got))
	}
	for i := range want {
		if got[i].method != want[i].method || got[i].path != want[i].path {
			t.Errorf("call %d = %s %s", i, got[i].method, got[i].path)
		}
	}
	if got[0].body["transition"].(map[string]any)["id"] != "11" {
		t.Errorf("transition body = %v", got[0].body)
	}
	if got[1].body["accountId"] != "u1" {
		t.Errorf("assign body = %v", got[1].body)
	}
	if v, has := got[2].body["accountId"]; !has || v != nil {
		t.Errorf("unassign body = %v", got[2].body)
	}
	if got[3].body["decision"] != "approve" || got[4].body["decision"] != "decline" {
		t.Errorf("decisions = %v %v", got[3].body, got[4].body)
	}
	if got[5].body["body"] != "확인했습니다" || got[5].body["public"] != false {
		t.Errorf("comment body = %v", got[5].body)
	}
	doc, _ := got[6].body["body"].(map[string]any)
	if lines, _ := doc["content"].([]any); doc["type"] != "doc" || len(lines) != 2 {
		t.Errorf("plain comment body = %v", got[6].body)
	}
}

func TestAddCommentRefusesUnknownMode(t *testing.T) {
	c := server(t, func(http.ResponseWriter, *http.Request) { t.Error("nothing should be sent") })
	if err := c.AddComment(context.Background(), "A-1", "x", "everyone"); err == nil {
		t.Fatal("want an error")
	}
}

func TestIssueProperties(t *testing.T) {
	var puts, deletes int
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPut && r.URL.Path == "/rest/api/3/issue/A-1/properties/team.vacation.u1":
			puts++
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodDelete:
			deletes++
			http.Error(w, "gone", http.StatusNotFound)
		case r.URL.Path == "/rest/api/3/issue/A-1/properties":
			io.WriteString(w, `{"keys":[{"key":"team.vacation.u1"},{"key":"other"}]}`)
		case r.URL.Path == "/rest/api/3/issue/A-1/properties/team.vacation.u1":
			io.WriteString(w, `{"key":"team.vacation.u1","value":{"from":"2026-12-01"}}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	})
	ctx := context.Background()
	got, err := c.IssueProperties(ctx, "A-1", "team.vacation.")
	if err != nil || len(got) != 1 || !strings.Contains(string(got["team.vacation.u1"]), "2026-12-01") {
		t.Fatalf("got %v, err %v", got, err)
	}
	if err := c.SetIssueProperty(ctx, "A-1", "team.vacation.u1", map[string]string{"from": "2026-12-01"}); err != nil || puts != 1 {
		t.Fatalf("set: %v, %d", err, puts)
	}
	if err := c.DeleteIssueProperty(ctx, "A-1", "team.vacation.u1"); err != nil || deletes != 1 {
		t.Fatalf("delete of a missing property should pass: %v", err)
	}
}
