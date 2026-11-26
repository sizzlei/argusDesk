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
	fields, err := c.CreateFields(ctx, "INT", "100")
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
