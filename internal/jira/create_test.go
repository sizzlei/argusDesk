package jira

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

const metaJSON = `{"total":7,"fields":[
 {"fieldId":"summary","name":"요약","required":true,"schema":{"type":"string","system":"summary"}},
 {"fieldId":"description","name":"설명","required":false,"schema":{"type":"string","system":"description"}},
 {"fieldId":"project","name":"프로젝트","required":true,"schema":{"type":"project"}},
 {"fieldId":"customfield_1","name":"대상 환경","required":true,"schema":{"type":"option","custom":"com.atlassian.jira.plugin.system.customfieldtypes:select"},"allowedValues":[{"id":"10","value":"운영"},{"id":"11","value":"개발"}]},
 {"fieldId":"customfield_2","name":"작업 예정일시","required":false,"schema":{"type":"datetime","custom":"x:datetime"}},
 {"fieldId":"customfield_3","name":"연관 자산","required":true,"hasDefaultValue":false,"schema":{"type":"array","items":"cmdb","custom":"x:cmdb-object"}},
 {"fieldId":"priority","name":"우선순위","required":true,"hasDefaultValue":true,"schema":{"type":"priority"},"allowedValues":[{"id":"3","name":"Medium"}]}]}`

func TestCreateFieldsAndIssue(t *testing.T) {
	var sent map[string]any
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/createmeta/INT/issuetypes"):
			io.WriteString(w, `{"total":2,"issueTypes":[{"id":"100","name":"[TEAM] 점검"},{"id":"101","name":"[TEAM] 배포"}]}`)
		case strings.HasSuffix(r.URL.Path, "/createmeta/INT/issuetypes/100"):
			io.WriteString(w, metaJSON)
		case r.Method == http.MethodPost && r.URL.Path == "/rest/api/3/issue":
			json.NewDecoder(r.Body).Decode(&sent)
			io.WriteString(w, `{"key":"INT-42"}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	})
	ctx := context.Background()
	types, err := c.IssueTypes(ctx, "INT")
	if err != nil || len(types) != 2 || types[1].ID != "101" {
		t.Fatalf("types: %v %v", types, err)
	}
	fields, _, err := c.CreateFields(ctx, "INT", "100")
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]string{}
	for _, f := range fields {
		kinds[f.ID] = f.Kind
	}
	want := map[string]string{"summary": KindText, "description": KindLong, "customfield_1": KindOption, "customfield_2": KindDateTime, "customfield_3": KindOther, "priority": KindOption}
	for id, k := range want {
		if kinds[id] != k {
			t.Errorf("%s is %q, want %q", id, kinds[id], k)
		}
	}
	if _, ok := kinds["project"]; ok {
		t.Error("the project was offered as a form field")
	}

	// customfield_3 cannot be filled in here and is required: the form says so before anything is sent
	if _, err := c.CreateIssue(ctx, "INT", "100", fields, map[string]any{"summary": "점검"}, "", "+0900"); err == nil || sent != nil {
		t.Fatalf("a ticket without its required fields was sent: %v", err)
	}
	var ok []CreateField // the form without the field the app cannot fill
	for _, f := range fields {
		if f.Kind != KindOther {
			ok = append(ok, f)
		}
	}
	if _, err := c.CreateIssue(ctx, "INT", "100", ok, map[string]any{"summary": "점검", "customfield_1": "99"}, "", "+0900"); err == nil {
		t.Fatal("an option that is not offered was accepted")
	}
	key, err := c.CreateIssue(ctx, "INT", "100", ok, map[string]any{"summary": " 주간 점검 ", "description": "첫 줄\n둘째 줄", "customfield_1": "10", "customfield_2": "2026-12-01T18:00"}, "u1", "+0900")
	if err != nil || key != "INT-42" {
		t.Fatalf("create: %q %v", key, err)
	}
	f := sent["fields"].(map[string]any)
	if f["summary"] != "주간 점검" || f["project"].(map[string]any)["key"] != "INT" || f["issuetype"].(map[string]any)["id"] != "100" ||
		f["customfield_1"].(map[string]any)["id"] != "10" || f["customfield_2"] != "2026-12-01T18:00:00.000+0900" || f["assignee"].(map[string]any)["accountId"] != "u1" {
		t.Errorf("sent: %v", f)
	}
	doc := f["description"].(map[string]any)
	if doc["type"] != "doc" || len(doc["content"].([]any)) != 2 {
		t.Errorf("description: %v", doc)
	}
}

// A form as a team's own project has it: people with defaults, a template,
// components, and a link to another ticket that must be given.
const reportMetaJSON = `{"total":7,"fields":[
 {"fieldId":"summary","name":"요약","required":true,"schema":{"type":"string","system":"summary"}},
 {"fieldId":"components","name":"컴포넌트","required":false,"schema":{"type":"array","items":"component","system":"components"},"allowedValues":[{"id":"7","name":"운영"},{"id":"8","name":"보고서"}]},
 {"fieldId":"customfield_10","name":"승인자","required":true,"hasDefaultValue":true,"schema":{"type":"user","custom":"x:userpicker"},"defaultValue":{"accountId":"lead","displayName":"한지우","emailAddress":"lead@example.com"}},
 {"fieldId":"customfield_11","name":"참조자","required":true,"hasDefaultValue":true,"schema":{"type":"array","items":"user","custom":"x:multiuserpicker"},"defaultValue":[{"accountId":"audit","displayName":"오세린"}]},
 {"fieldId":"customfield_12","name":"작업 내용","required":true,"hasDefaultValue":true,"schema":{"type":"string","custom":"x:textarea"},
  "defaultValue":{"type":"doc","version":1,"content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"아래 항목을 적습니다.","marks":[{"type":"strong"}]}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"계획 : "},{"type":"text","text":"이전 버전","marks":[{"type":"strong"}]}]}]}]}]}]},{"type":"rule"}]}},
 {"fieldId":"issuelinks","name":"연결된 이슈","required":true,"schema":{"type":"array","items":"issuelinks","system":"issuelinks"}},
 {"fieldId":"parent","name":"상위 항목","required":false,"schema":{"type":"issuelink","system":"parent"}}]}`

func TestCreateWithPeopleTemplateAndLinks(t *testing.T) {
	var sent map[string]any
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/createmeta/INT/issuetypes/200"):
			io.WriteString(w, reportMetaJSON)
		case r.URL.Path == "/rest/api/3/issueLinkType":
			io.WriteString(w, `{"issueLinkTypes":[{"id":"1","name":"Blocks","outward":"blocks"},{"id":"2","name":"Relates","outward":"relates to"}]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/rest/api/3/issue":
			sent = nil
			json.NewDecoder(r.Body).Decode(&sent)
			io.WriteString(w, `{"key":"INT-50"}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	})
	ctx := context.Background()
	fields, assignable, err := c.CreateFields(ctx, "INT", "200")
	if err != nil {
		t.Fatal(err)
	}
	if assignable {
		t.Error("the form has no assignee, yet it was reported as taking one")
	}
	by := map[string]CreateField{}
	for _, f := range fields {
		by[f.ID] = f
	}
	if _, ok := by["parent"]; ok {
		t.Error("the parent was offered as a form field")
	}
	if f := by["components"]; f.Kind != KindOptions || len(f.Options) != 2 {
		t.Errorf("components: %+v", f)
	}
	if f := by["customfield_10"]; f.Kind != KindUser || len(f.People) != 1 || f.People[0] != (Person{ID: "lead", Name: "한지우"}) {
		t.Errorf("approver: %+v", f)
	}
	if f := by["customfield_11"]; f.Kind != KindUsers || len(f.People) != 1 || f.People[0].ID != "audit" {
		t.Errorf("watchers: %+v", f)
	}
	const template = "- **아래 항목을 적습니다.**\n  - 계획 : **이전 버전**\n---"
	if f := by["customfield_12"]; f.Kind != KindLong || f.Default != template {
		t.Errorf("template: %q", f.Default)
	}
	if f := by["issuelinks"]; f.Kind != KindLinks || f.Default != "2" || f.Options[0].Name != "relates to" {
		t.Errorf("links: %+v", f)
	}

	// the link is required
	if _, err := c.CreateIssue(ctx, "INT", "200", fields, map[string]any{"summary": "결과"}, "", "+0900"); err == nil || sent != nil {
		t.Fatalf("a ticket without its link was sent: %v", err)
	}
	if _, err := c.CreateIssue(ctx, "INT", "200", fields, map[string]any{"summary": "결과", "issuelinks": "곧 적음"}, "", "+0900"); err == nil || sent != nil {
		t.Fatalf("something that is not a ticket key was sent: %v", err)
	}
	values := map[string]any{
		"summary": "결과", "components": []any{"8"}, "customfield_10": "lead", "customfield_11": []any{"audit"},
		"customfield_12": template + "\n```sql\nSELECT 1;\n```", "issuelinks": "int-7, INT-9", LinkTypeField: "1",
	}
	if key, err := c.CreateIssue(ctx, "INT", "200", fields, values, "", "+0900"); err != nil || key != "INT-50" {
		t.Fatalf("create: %q %v", key, err)
	}
	f := sent["fields"].(map[string]any)
	if f["customfield_10"].(map[string]any)["accountId"] != "lead" || f["customfield_11"].([]any)[0].(map[string]any)["accountId"] != "audit" ||
		f["components"].([]any)[0].(map[string]any)["id"] != "8" {
		t.Errorf("sent: %v", f)
	}
	if _, has := f["assignee"]; has {
		t.Error("an assignee was sent")
	}
	links := sent["update"].(map[string]any)["issuelinks"].([]any)
	first := links[0].(map[string]any)["add"].(map[string]any)
	if len(links) != 2 || first["type"].(map[string]any)["id"] != "1" || first["outwardIssue"].(map[string]any)["key"] != "INT-7" {
		t.Errorf("links: %v", links)
	}
	// what was typed comes out as the same document it was read from, plus the code
	doc, _ := json.Marshal(f["customfield_12"])
	if got := adfText(doc); got != template+"\n```sql\nSELECT 1;\n```" {
		t.Errorf("document:\n%s", got)
	}
	blocks := f["customfield_12"].(map[string]any)["content"].([]any)
	if len(blocks) != 3 || blocks[0].(map[string]any)["type"] != "bulletList" || blocks[1].(map[string]any)["type"] != "rule" || blocks[2].(map[string]any)["type"] != "codeBlock" {
		t.Errorf("blocks: %v", blocks)
	}
}

func TestFindPeopleKeepsPeopleInUse(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/api/3/user/search" || r.URL.Query().Get("query") != "한" {
			t.Errorf("unexpected %s", r.URL)
		}
		io.WriteString(w, `[{"accountId":"a","accountType":"atlassian","displayName":"한지우","active":true,"emailAddress":"x@example.com"},
		 {"accountId":"b","accountType":"app","displayName":"한글 봇","active":true},
		 {"accountId":"c","accountType":"atlassian","displayName":"한서연","active":false},
		 {"accountId":"d","accountType":"customer","displayName":"한고객","active":true}]`)
	})
	got, err := c.FindPeople(context.Background(), "한")
	if err != nil || len(got) != 1 || got[0] != (Person{ID: "a", Name: "한지우"}) {
		t.Fatalf("got %+v, %v", got, err)
	}
}
