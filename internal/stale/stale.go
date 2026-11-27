// Package stale decides whether a box has sat too long.
//
// A zone either counts from the moment the box entered it (review, approval)
// or from a date on the ticket chosen per request type (the work zone).
package stale

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/jira"
	"github.com/sizzlei/argusDesk/internal/model"
)

// Result is the age of one box.
type Result struct {
	From  *time.Time // what the age is counted from; nil = not counted
	Ratio float64    // elapsed / limit
	Stale bool       // Ratio >= 1
	Note  string     // e.g. "일정 미정" when the ticket has no date yet
}

// Evaluate ages a ticket standing in zone z.
//
// entered is when it entered the zone (nil if unknown). fieldID maps the
// field names of the settings file to Jira field ids.
func Evaluate(z *config.Zone, typ *config.Type, t *model.Ticket, entered *time.Time, fieldID map[string]string, now time.Time, loc *time.Location) Result {
	if z == nil || z.Stale == nil || z.Stale.Limit() <= 0 {
		return Result{}
	}
	var from *time.Time
	switch z.Stale.From {
	case config.FromZoneEntered:
		from = entered
	case config.FromTypeField:
		if typ == nil {
			return Result{}
		}
		if u := typ.Unscheduled; u != nil && u.UnlessChecked != "" && !checked(t.Custom[fieldID[u.UnlessChecked]]) {
			return Result{Note: u.Label}
		}
		from = fieldTime(typ.StaleField, t, fieldID, loc)
		if from == nil && typ.Unscheduled != nil {
			return Result{Note: typ.Unscheduled.Label}
		}
	}
	if from == nil {
		return Result{}
	}
	r := Result{From: from}
	if el := now.Sub(*from); el > 0 {
		r.Ratio = float64(el) / float64(z.Stale.Limit())
	}
	r.Stale = r.Ratio >= 1
	return r
}

// fieldTime reads the date a request type is aged from.
func fieldTime(name string, t *model.Ticket, fieldID map[string]string, loc *time.Location) *time.Time {
	switch name {
	case "":
		return nil
	case "created":
		if t.Created.IsZero() {
			return nil
		}
		c := t.Created
		return &c
	case "duedate":
		return parseValue(t.Due, loc)
	}
	var s string
	if err := json.Unmarshal(t.Custom[fieldID[name]], &s); err != nil {
		return nil
	}
	return parseValue(s, loc)
}

// parseValue reads a Jira date-time, or a date: a date counts from the end of
// that day (midnight in loc), so "due on the 25th" is not late during the 25th.
func parseValue(s string, loc *time.Location) *time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if d, err := time.ParseInLocation("2006-01-02", s, loc); err == nil {
		end := d.AddDate(0, 0, 1)
		return &end
	}
	if t, err := jira.ParseTime(s); err == nil {
		return &t
	}
	return nil
}

// checked reports whether a "settled" field says yes. A checkbox field is
// yes when any option is ticked; a radio or select field holds one option,
// which says yes unless its name says no ("배포 일정 미정", "N", "아니오").
func checked(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" || s == "[]" || s == "false" {
		return false
	}
	var one struct {
		Value string `json:"value"`
	}
	if json.Unmarshal(raw, &one) == nil && one.Value != "" {
		return !jira.SaysNo(one.Value)
	}
	var many []struct {
		Value string `json:"value"`
	}
	if json.Unmarshal(raw, &many) == nil {
		for _, o := range many {
			if !jira.SaysNo(o.Value) {
				return true
			}
		}
		return false
	}
	return true
}
