package jira

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestEditFieldsAndSetField(t *testing.T) {
	seoul, _ := time.LoadLocation("Asia/Seoul")
	var put map[string]any
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/editmeta"):
			_, _ = io.WriteString(w, `{"fields":{
				"customfield_1":{"name":"배포 일시","schema":{"type":"datetime"}},
				"customfield_2":{"name":"배포 확정","schema":{"type":"array","items":"option"},"allowedValues":[{"id":"9","value":"확정"}]}}}`)
		case r.Method == http.MethodGet:
			_, _ = io.WriteString(w, `{"fields":{"customfield_1":"2026-11-27T14:30:00.000+0900","customfield_2":null,"duedate":"2026-11-28"},
				"names":{"customfield_1":"배포 일시","customfield_2":"배포 확정","duedate":"기한"}}`)
		case r.Method == http.MethodPut:
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &put)
			w.WriteHeader(http.StatusNoContent)
		}
	})
	ctx := context.Background()
	got, err := c.EditFields(ctx, "A-1", []string{"customfield_1", "customfield_2", "duedate"}, seoul)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Kind != "datetime" || got[0].Value != "2026-11-27T14:30" || !got[0].Editable {
		t.Errorf("date-time = %+v", got[0])
	}
	if got[1].Kind != "checkbox" || len(got[1].Options) != 1 || len(got[1].Chosen) != 0 {
		t.Errorf("checkbox = %+v", got[1])
	}
	if got[2].Editable || got[2].Value != "2026-11-28" || got[2].Name != "기한" {
		t.Errorf("not on the edit screen = %+v", got[2])
	}

	if err := c.SetField(ctx, "A-1", "customfield_1", "datetime", "2026-11-28T09:00", nil, seoul); err != nil {
		t.Fatal(err)
	}
	if v := put["fields"].(map[string]any)["customfield_1"]; v != "2026-11-28T09:00:00.000+0900" {
		t.Errorf("date-time sent = %v", v)
	}
	if err := c.SetField(ctx, "A-1", "customfield_2", "checkbox", "", []string{"9"}, seoul); err != nil {
		t.Fatal(err)
	}
	if v, _ := json.Marshal(put["fields"].(map[string]any)["customfield_2"]); string(v) != `[{"id":"9"}]` {
		t.Errorf("checkbox sent = %s", v)
	}
	if err := c.SetField(ctx, "A-1", "customfield_1", "datetime", "", nil, seoul); err != nil {
		t.Fatal(err)
	}
	if v, has := put["fields"].(map[string]any)["customfield_1"]; !has || v != nil {
		t.Errorf("clearing sent = %v", put)
	}
}
