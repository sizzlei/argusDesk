package stale

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/model"
)

var seoul, _ = time.LoadLocation("Asia/Seoul")

func zone(t *testing.T, after, from string) *config.Zone {
	t.Helper()
	c, err := config.Parse([]byte(`
site: x
spaces:
  - id: s
    project: S
    zones:
      - { id: z, name: z, kind: work, stale: { after: ` + after + `, from: ` + from + ` } }
`))
	if err != nil {
		t.Fatal(err)
	}
	return c.Space("s").Zone("z")
}

func at(s string) time.Time {
	v, err := time.ParseInLocation("2006-01-02 15:04", s, seoul)
	if err != nil {
		panic(err)
	}
	return v
}

func TestZoneEntered(t *testing.T) {
	z := zone(t, "3h", "zone_entered")
	in := at("2026-11-25 09:00")
	r := Evaluate(z, nil, &model.Ticket{}, &in, nil, at("2026-11-25 10:30"), seoul)
	if r.Stale || r.Ratio != 0.5 {
		t.Errorf("after 1.5h: %+v", r)
	}
	r = Evaluate(z, nil, &model.Ticket{}, &in, nil, at("2026-11-25 12:00"), seoul)
	if !r.Stale {
		t.Errorf("after exactly 3h it is stale: %+v", r)
	}
	if r := Evaluate(z, nil, &model.Ticket{}, nil, nil, at("2026-11-25 12:00"), seoul); r.Stale || r.From != nil {
		t.Errorf("unknown entry time is not counted: %+v", r)
	}
}

func TestTypeFieldDateTimeAndCreated(t *testing.T) {
	z := zone(t, "5d", "type_field")
	ids := map[string]string{"요청일시": "customfield_1"}
	tk := &model.Ticket{Created: at("2026-11-01 10:00"), Custom: map[string]json.RawMessage{
		"customfield_1": json.RawMessage(`"2026-11-20T18:00:00.000+0900"`),
	}}
	typ := &config.Type{StaleField: "요청일시"}
	if r := Evaluate(z, typ, tk, nil, ids, at("2026-11-25 17:59"), seoul); r.Stale {
		t.Errorf("one minute before 5 days: %+v", r)
	}
	if r := Evaluate(z, typ, tk, nil, ids, at("2026-11-25 18:00"), seoul); !r.Stale {
		t.Errorf("5 days after the requested time: %+v", r)
	}
	if r := Evaluate(z, &config.Type{StaleField: "created"}, tk, nil, ids, at("2026-11-06 10:00"), seoul); !r.Stale {
		t.Errorf("5 days after creation: %+v", r)
	}
	// A date in the future is not late and has no negative ratio.
	if r := Evaluate(z, typ, tk, nil, ids, at("2026-11-10 10:00"), seoul); r.Stale || r.Ratio != 0 || r.From == nil {
		t.Errorf("before the date: %+v", r)
	}
}

func TestDueDateCountsFromEndOfDay(t *testing.T) {
	z := zone(t, "5d", "type_field")
	typ := &config.Type{StaleField: "duedate"}
	tk := &model.Ticket{Due: "2026-11-20"}
	// End of the 20th is 00:00 on the 21st; five days later is 00:00 on the 26th.
	if r := Evaluate(z, typ, tk, nil, nil, at("2026-11-25 23:59"), seoul); r.Stale {
		t.Errorf("still inside five days: %+v", r)
	}
	if r := Evaluate(z, typ, tk, nil, nil, at("2026-11-26 00:00"), seoul); !r.Stale {
		t.Errorf("five days after the end of the due day: %+v", r)
	}
}

func TestUnscheduled(t *testing.T) {
	z := zone(t, "5d", "type_field")
	ids := map[string]string{"요청일시": "customfield_1", "확정": "customfield_2"}
	typ := &config.Type{StaleField: "요청일시", Unscheduled: &config.Unscheduled{UnlessChecked: "확정", Label: "일정 미정"}}
	old := json.RawMessage(`"2026-01-01T09:00:00.000+0900"`)
	now := at("2026-11-25 12:00")

	unchecked := &model.Ticket{Custom: map[string]json.RawMessage{"customfield_1": old, "customfield_2": json.RawMessage(`null`)}}
	if r := Evaluate(z, typ, unchecked, nil, ids, now, seoul); r.Stale || r.Note != "일정 미정" {
		t.Errorf("unchecked box is unscheduled even with an old date: %+v", r)
	}
	noDate := &model.Ticket{Custom: map[string]json.RawMessage{"customfield_2": json.RawMessage(`[{"value":"확정"}]`)}}
	if r := Evaluate(z, typ, noDate, nil, ids, now, seoul); r.Stale || r.Note != "일정 미정" {
		t.Errorf("checked but no date is unscheduled: %+v", r)
	}
	both := &model.Ticket{Custom: map[string]json.RawMessage{"customfield_1": old, "customfield_2": json.RawMessage(`[{"value":"확정"}]`)}}
	if r := Evaluate(z, typ, both, nil, ids, now, seoul); !r.Stale || r.Note != "" {
		t.Errorf("checked with an old date is stale: %+v", r)
	}
}

func TestZoneWithoutRule(t *testing.T) {
	in := at("2026-01-01 00:00")
	if r := Evaluate(&config.Zone{ID: "lobby"}, nil, &model.Ticket{}, &in, nil, at("2026-11-25 12:00"), seoul); r.Stale || r.From != nil {
		t.Errorf("a zone without a rule never ages: %+v", r)
	}
}
