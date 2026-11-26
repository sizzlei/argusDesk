// Package model holds the data the backend hands to the screen: tickets as
// boxes, placed in zones.
package model

import (
	"encoding/json"
	"time"
)

// Ticket is one Jira issue, reduced to what the centre needs.
type Ticket struct {
	Key        string
	Summary    string
	Type       string // issue type name, e.g. "[REQ] 스키마 변경"
	StatusID   string
	Status     string
	Priority   string
	AssigneeID string
	Assignee   string
	Reporter   string
	Created    time.Time
	Updated    time.Time
	Due        string                     // "2026-11-25" or ""
	Custom     map[string]json.RawMessage // custom fields by field id
}

// PathStep is one cell of the route printed on a box's waybill.
type PathStep struct {
	StatusID string `json:"statusId"`
	Name     string `json:"name"`
	State    string `json:"state"` // "done" | "current" | "next"
}

// Box is a ticket placed in the centre.
type Box struct {
	Key        string     `json:"key"`
	Summary    string     `json:"summary"`
	Type       string     `json:"type"`
	StatusID   string     `json:"statusId"`
	Status     string     `json:"status"`
	Priority   string     `json:"priority"`
	AssigneeID string     `json:"assigneeId"`
	Assignee   string     `json:"assignee"`
	Reporter   string     `json:"reporter"`
	Created    time.Time  `json:"created"`
	Updated    time.Time  `json:"updated"`
	URL        string     `json:"url"`
	Space      string     `json:"space"`
	Zone       string     `json:"zone"`
	Tag        string     `json:"tag"`      // waybill tag colour name
	Workflow   string     `json:"workflow"` // "" when the type is not configured
	Mine       bool       `json:"mine"`
	MyApproval bool       `json:"myApproval"`          // waiting for the signed-in user to approve
	EnteredAt  *time.Time `json:"enteredAt,omitempty"` // when it entered its zone
	StaleFrom  *time.Time `json:"staleFrom,omitempty"` // what the age is counted from
	StaleRatio float64    `json:"staleRatio"`          // elapsed / limit; 0 = not counted
	Stale      bool       `json:"stale"`
	Note       string     `json:"note,omitempty"` // e.g. "일정 미정"
	Path       []PathStep `json:"path,omitempty"`
}

// ZoneView is a zone with its load.
type ZoneView struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Kind       string `json:"kind"` // "wait" | "work" | "desk" | "done" | "returned" | "unsorted"
	Count      int    `json:"count"`
	StaleCount int    `json:"staleCount"`
	StaleAfter string `json:"staleAfter,omitempty"` // "3h", "5d"
	Approval   bool   `json:"approval,omitempty"`   // boxes here wait for an approving move
}

// SpaceView is one space (a Jira project) and its zones, in layout order.
type SpaceView struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Project string     `json:"project"` // Jira project key, e.g. "REQ"
	Zones   []ZoneView `json:"zones"`
	// Create is set for a space whose tickets the team writes itself; Types
	// are then the kinds of ticket the app can make there.
	Create bool       `json:"create"`
	Attach bool       `json:"attach"` // files can be added to its tickets
	Types  []TypeView `json:"types,omitempty"`
}

// TypeView is a kind of ticket and the colour of its waybill.
type TypeView struct {
	Name string `json:"name"`
	Tag  string `json:"tag"`
}

// Member is a teammate drawn as an avatar.
type Member struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Space string `json:"space"`
	Zone  string `json:"zone"`
	Count int    `json:"count"` // open boxes assigned to them
	Me    bool   `json:"me"`
}

// Snapshot is the whole centre at one moment.
type Snapshot struct {
	Name          string      `json:"name"`
	ConfigVersion string      `json:"configVersion"`
	FetchedAt     time.Time   `json:"fetchedAt"`
	Spaces        []SpaceView `json:"spaces"`
	Boxes         []Box       `json:"boxes"`
	Members       []Member    `json:"members"`
	Warnings      []string    `json:"warnings"`
}

// Change says what happened to a box between two snapshots.
type Change struct {
	Kind     string `json:"kind"` // "added" | "moved" | "updated" | "removed"
	Key      string `json:"key"`
	FromZone string `json:"fromZone,omitempty"`
	ToZone   string `json:"toZone,omitempty"`
}
