package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sizzlei/argusDesk/internal/jira"
)

// Some spaces only receive tickets; in others the team writes its own (the
// settings mark those with "create: true"). For those the app offers a form,
// laid out like a waybill, and makes the ticket in Jira.

// CreateForm is the waybill for one kind of ticket.
type CreateForm struct {
	Space  string             `json:"space"`
	Type   string             `json:"type"`
	Fields []jira.CreateField `json:"fields"` // what is filled in here: everything on Jira's own form the app can fill
	// Auto names fields the app cannot show that Jira fills in by itself.
	Auto []string `json:"auto"`
	// Blocked names required fields the app cannot fill in. With any, the
	// ticket has to be made in Jira: JiraURL is the page for it.
	Blocked []string `json:"blocked"`
	JiraURL string   `json:"jiraUrl"`
}

type createMeta struct {
	typeID string
	assign bool // the form takes an assignee; otherwise the ticket is assigned once made
	fields []jira.CreateField
	form   *CreateForm
	at     time.Time
}

var (
	metaMu    sync.Mutex
	metaCache = map[string]*createMeta{} // by project + "/" + type name
)

// createMetaFor reads what Jira wants for one kind of ticket. It is kept for
// ten minutes: the form is opened far more often than it changes.
func (a *App) createMetaFor(ctx context.Context, spaceID, typeName string) (*createMeta, string, error) {
	a.mu.Lock()
	cfg, client := a.cfg, a.client
	a.mu.Unlock()
	if cfg == nil || client == nil {
		return nil, "", errors.New("먼저 로그인해 주세요")
	}
	sp := cfg.Space(spaceID)
	if sp == nil || !sp.Create {
		return nil, "", errors.New("이 층에서는 티켓을 만들 수 없습니다")
	}
	if _, ok := sp.Types[typeName]; !ok {
		return nil, "", errors.New("설정에 없는 유형입니다")
	}
	id := sp.Project + "/" + typeName
	metaMu.Lock()
	m := metaCache[id]
	metaMu.Unlock()
	if m != nil && time.Since(m.at) < 10*time.Minute {
		return m, sp.Project, nil
	}
	types, err := client.IssueTypes(ctx, sp.Project)
	if err != nil {
		return nil, "", err
	}
	typeID := ""
	for _, t := range types {
		if t.Name == typeName {
			typeID = t.ID
		}
	}
	if typeID == "" {
		return nil, "", fmt.Errorf("%s 프로젝트에서 %q 유형으로 티켓을 만들 수 없습니다. 권한이나 설정의 유형 이름을 확인해 주세요", sp.Project, typeName)
	}
	fields, assign, err := client.CreateFields(ctx, sp.Project, typeID)
	if err != nil {
		return nil, "", err
	}
	m = &createMeta{typeID: typeID, assign: assign, at: time.Now(), form: &CreateForm{Space: spaceID, Type: typeName, Fields: []jira.CreateField{}, Blocked: []string{}, Auto: []string{}}}
	// Jira's own form for the kind is what the waybill shows: the title, the
	// description, the dates (asked for or not, side by side), what must be
	// filled in, then what may be.
	rank := func(f jira.CreateField) int {
		switch {
		case f.ID == "summary":
			return 0
		case f.ID == "description":
			return 1
		case f.Kind == jira.KindDate || f.Kind == jira.KindDateTime:
			return 2
		case f.Required:
			return 3
		}
		return 4
	}
	sort.SliceStable(fields, func(i, j int) bool { return rank(fields[i]) < rank(fields[j]) })
	for _, f := range fields {
		// Several people can only be sent as Jira set them up.
		fillable := f.Kind != jira.KindOther && (f.Kind != jira.KindUsers || len(f.People) > 0)
		switch {
		case fillable:
			m.fields = append(m.fields, f)
			m.form.Fields = append(m.form.Fields, f)
		case f.Required && !f.HasDefault:
			m.form.Blocked = append(m.form.Blocked, f.Name)
		case f.Required:
			m.form.Auto = append(m.form.Auto, f.Name)
		}
	}
	if pid, err := client.ProjectID(ctx, sp.Project); err == nil {
		m.form.JiraURL = client.CreateURL(pid, typeID)
	}
	metaMu.Lock()
	metaCache[id] = m
	metaMu.Unlock()
	return m, sp.Project, nil
}

// CreateForm returns the waybill for one kind of ticket in a space.
func (a *App) CreateForm(spaceID, typeName string) (*CreateForm, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	m, _, err := a.createMetaFor(ctx, spaceID, typeName)
	if err != nil {
		return nil, err
	}
	return m.form, nil
}

// CreateTicket makes a ticket from a filled-in waybill and returns its key.
// values holds the form by field id (a string, or a list of option ids);
// assignee is "me", an account id, or "" for nobody.
func (a *App) CreateTicket(spaceID, typeName string, values map[string]any, assignee string) (string, error) {
	c, me, err := a.jira()
	if err != nil {
		return "", err
	}
	if assignee == "me" {
		if err := a.spent(); err != nil {
			return "", fmt.Errorf("%s 담당자를 비우거나 다른 사람으로 정해 주세요", strings.TrimSuffix(err.Error(), "."))
		}
		assignee = me.AccountID
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	m, project, err := a.createMetaFor(ctx, spaceID, typeName)
	if err != nil {
		return "", err
	}
	if len(m.form.Blocked) > 0 {
		return "", fmt.Errorf("이 유형은 앱에서 입력할 수 없는 필수 항목(%s)이 있어 Jira에서 만들어야 합니다", strings.Join(m.form.Blocked, ", "))
	}
	a.mu.Lock()
	offset := time.Now().In(a.cfg.Location()).Format("-0700")
	a.mu.Unlock()
	for _, f := range m.fields { // "me" in a person field is me
		if v, _ := values[f.ID].(string); f.Kind == jira.KindUser && v == "me" {
			values[f.ID] = me.AccountID
		}
	}
	with := assignee
	if !m.assign {
		with = "" // Jira refuses an assignee its form does not hold
	}
	key, err := c.CreateIssue(ctx, project, m.typeID, m.fields, values, with, offset)
	if err != nil {
		return "", err
	}
	if assignee != "" && !m.assign {
		if err := c.Assign(ctx, key, assignee); err != nil {
			a.notify.touched(key)
			a.Refresh()
			return key, fmt.Errorf("%s 티켓은 만들었지만 담당자를 정하지 못했습니다: %w", key, err)
		}
	}
	a.notify.touched(key) // my own new box is not news to me
	a.Refresh()
	return key, nil
}
