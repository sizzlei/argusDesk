package jira

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// IssueType is a kind of ticket a project can hold.
type IssueType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Option is one choice of a field.
type Option struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// The kinds of field the app can fill in when it makes a ticket.
const (
	KindText     = "text"     // one line
	KindLong     = "long"     // several lines
	KindOption   = "option"   // one of the options
	KindOptions  = "options"  // any of the options
	KindDate     = "date"     // "2026-12-01"
	KindDateTime = "datetime" // "2026-12-01T18:00"
	KindNumber   = "number"
	KindUser     = "user"  // one person, by account id
	KindUsers    = "users" // several people: only the default can be sent
	KindLinks    = "links" // other tickets this one is linked to
	KindOther    = "other" // the app cannot fill it in
)

// Person is someone a field names.
type Person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// CreateField is one field of the form a ticket is made with.
type CreateField struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Required   bool     `json:"required"`
	HasDefault bool     `json:"hasDefault"`
	Kind       string   `json:"kind"`
	Options    []Option `json:"options,omitempty"`
	// Default is what Jira starts the field with: a text, an option id
	// (several joined by commas), or the text of a template. For links it
	// is the kind of link offered first.
	Default string `json:"default,omitempty"`
	// People are the persons a user field starts with.
	People []Person `json:"people,omitempty"`
}

// handled are fields the app sets itself, never shown as form fields.
var handled = map[string]bool{"project": true, "issuetype": true, "reporter": true, "assignee": true, "attachment": true, "parent": true}

// LinkTypeField is the name the kind of link travels under in a filled-in
// form, next to the keys under "issuelinks".
const LinkTypeField = "issuelinks.type"

// IssueTypes lists the kinds of ticket that can be made in a project.
func (c *Client) IssueTypes(ctx context.Context, project string) ([]IssueType, error) {
	var all []IssueType
	for start := 0; ; {
		var page struct {
			IssueTypes []IssueType `json:"issueTypes"`
			Total      int         `json:"total"`
		}
		path := "/rest/api/3/issue/createmeta/" + url.PathEscape(project) + "/issuetypes?maxResults=100&startAt=" + strconv.Itoa(start)
		if err := c.do(ctx, http.MethodGet, path, nil, &page); err != nil {
			return nil, err
		}
		all = append(all, page.IssueTypes...)
		start += len(page.IssueTypes)
		if len(page.IssueTypes) == 0 || start >= page.Total {
			return all, nil
		}
	}
}

// ProjectID returns the number Jira knows a project by.
func (c *Client) ProjectID(ctx context.Context, project string) (string, error) {
	var p struct {
		ID string `json:"id"`
	}
	err := c.do(ctx, http.MethodGet, "/rest/api/3/project/"+url.PathEscape(project)+"?fields=id", nil, &p)
	return p.ID, err
}

// CreateURL is the page in Jira where a ticket of that kind is made by hand.
func (c *Client) CreateURL(projectID, typeID string) string {
	return c.base + "/secure/CreateIssueDetails!init.jspa?pid=" + url.QueryEscape(projectID) + "&issuetype=" + url.QueryEscape(typeID)
}

type metaField struct {
	FieldID    string `json:"fieldId"`
	Name       string `json:"name"`
	Required   bool   `json:"required"`
	HasDefault bool   `json:"hasDefaultValue"`
	Schema     struct {
		Type   string `json:"type"`
		Items  string `json:"items"`
		System string `json:"system"`
		Custom string `json:"custom"`
	} `json:"schema"`
	Allowed []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"allowedValues"`
	Default json.RawMessage `json:"defaultValue"`
}

func (m *metaField) kind() string {
	custom := m.Schema.Custom[strings.LastIndex(m.Schema.Custom, ":")+1:]
	switch {
	case m.FieldID == "issuelinks":
		return KindLinks
	case m.Schema.Type == "user":
		return KindUser
	case m.Schema.Type == "array" && m.Schema.Items == "user":
		return KindUsers
	case m.FieldID == "summary":
		return KindText
	case m.FieldID == "description" || custom == "textarea":
		return KindLong
	case m.Schema.Type == "string" && (custom == "textfield" || custom == "url"):
		return KindText
	case m.Schema.Type == "date":
		return KindDate
	case m.Schema.Type == "datetime":
		return KindDateTime
	case m.Schema.Type == "number":
		return KindNumber
	case (m.Schema.Type == "option" || m.Schema.Type == "priority") && len(m.Allowed) > 0:
		return KindOption
	case m.Schema.Type == "array" && (m.Schema.Items == "option" || m.Schema.Items == "component" || m.Schema.Items == "version") && len(m.Allowed) > 0:
		return KindOptions
	}
	return KindOther
}

// defaults reads what Jira starts a field with.
func (m *metaField) defaults(f *CreateField) {
	if len(m.Default) == 0 || string(m.Default) == "null" {
		return
	}
	type ref struct {
		ID        string `json:"id"`
		AccountID string `json:"accountId"`
		Name      string `json:"displayName"`
	}
	switch f.Kind {
	case KindOption:
		var r ref
		if json.Unmarshal(m.Default, &r) == nil {
			f.Default = r.ID
		}
	case KindOptions:
		var rs []ref
		if json.Unmarshal(m.Default, &rs) == nil {
			ids := make([]string, 0, len(rs))
			for _, r := range rs {
				ids = append(ids, r.ID)
			}
			f.Default = strings.Join(ids, ",")
		}
	case KindUser:
		var r ref
		if json.Unmarshal(m.Default, &r) == nil && r.AccountID != "" {
			f.People = []Person{{ID: r.AccountID, Name: r.Name}}
		}
	case KindUsers:
		var rs []ref
		if json.Unmarshal(m.Default, &rs) == nil {
			for _, r := range rs {
				if r.AccountID != "" {
					f.People = append(f.People, Person{ID: r.AccountID, Name: r.Name})
				}
			}
		}
	case KindLong:
		var text string
		if json.Unmarshal(m.Default, &text) == nil {
			f.Default = text
		} else {
			f.Default = adfText(m.Default)
		}
	case KindText, KindDate, KindDateTime:
		json.Unmarshal(m.Default, &f.Default)
	case KindNumber:
		var n float64
		if json.Unmarshal(m.Default, &n) == nil {
			f.Default = strconv.FormatFloat(n, 'f', -1, 64)
		}
	}
}

// LinkTypes lists the kinds of link between tickets, named the way the new
// ticket would read them ("relates to").
func (c *Client) LinkTypes(ctx context.Context) ([]Option, error) {
	var out struct {
		Types []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Outward string `json:"outward"`
		} `json:"issueLinkTypes"`
	}
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/issueLinkType", nil, &out); err != nil {
		return nil, err
	}
	var types []Option
	for _, t := range out.Types {
		name := t.Outward
		if name == "" {
			name = t.Name
		}
		if t.Name == "Relates" { // the everyday one first
			types = append([]Option{{ID: t.ID, Name: name}}, types...)
		} else {
			types = append(types, Option{ID: t.ID, Name: name})
		}
	}
	return types, nil
}

// CreateFields lists the fields of the form for one kind of ticket, leaving
// out the ones the app sets itself (project, kind, reporter, assignee).
// assignable tells whether the form takes an assignee at all: where it does
// not, the ticket is assigned after it is made.
func (c *Client) CreateFields(ctx context.Context, project, typeID string) (out []CreateField, assignable bool, err error) {
	for start := 0; ; {
		var page struct {
			Fields []metaField `json:"fields"`
			Total  int         `json:"total"`
		}
		path := "/rest/api/3/issue/createmeta/" + url.PathEscape(project) + "/issuetypes/" + url.PathEscape(typeID) + "?maxResults=100&startAt=" + strconv.Itoa(start)
		if err := c.do(ctx, http.MethodGet, path, nil, &page); err != nil {
			return nil, false, err
		}
		for i := range page.Fields {
			m := &page.Fields[i]
			if m.FieldID == "assignee" {
				assignable = true
			}
			if handled[m.FieldID] {
				continue
			}
			f := CreateField{ID: m.FieldID, Name: m.Name, Required: m.Required, HasDefault: m.HasDefault, Kind: m.kind()}
			for _, a := range m.Allowed {
				name := a.Value
				if name == "" {
					name = a.Name
				}
				f.Options = append(f.Options, Option{ID: a.ID, Name: name})
			}
			m.defaults(&f)
			if f.Kind == KindLinks {
				types, lerr := c.LinkTypes(ctx)
				if lerr != nil || len(types) == 0 {
					f.Kind = KindOther // the kinds of link could not be read
				} else {
					f.Options, f.Default = types, types[0].ID
				}
			}
			out = append(out, f)
		}
		start += len(page.Fields)
		if len(page.Fields) == 0 || start >= page.Total {
			return out, assignable, nil
		}
	}
}

var bullet = regexp.MustCompile(`^(\s*)[-*•◦]\s+(.*)$`)

// inline turns one line into text nodes: **bold** is the only mark.
func inline(line string) []any {
	parts := strings.Split(line, "**")
	if len(parts)%2 == 0 { // an unclosed ** is just text
		parts = []string{line}
	}
	out := []any{}
	for i, p := range parts {
		if p == "" {
			continue
		}
		n := map[string]any{"type": "text", "text": p}
		if i%2 == 1 {
			n["marks"] = []any{map[string]any{"type": "strong"}}
		}
		out = append(out, n)
	}
	return out
}

type listLine struct {
	level int
	text  string
}

// list builds a bullet list from lines[i:], all at least as deep as level.
func list(lines []listLine, i, level int) (map[string]any, int) {
	items := []any{}
	for i < len(lines) && lines[i].level >= level {
		if lines[i].level > level && len(items) > 0 {
			sub, next := list(lines, i, level+1)
			last := items[len(items)-1].(map[string]any)
			last["content"] = append(last["content"].([]any), sub)
			i = next
			continue
		}
		items = append(items, map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": inline(lines[i].text)}}})
		i++
	}
	return map[string]any{"type": "bulletList", "content": items}, i
}

// adf turns typed text into the document format Jira wants for long texts.
// A line is a paragraph; "- " starts a list item (two spaces deeper is a
// list inside it), "---" is a rule, ``` fences code and **bold** is bold.
func adf(text string) map[string]any {
	content := []any{}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for i := 0; i < len(lines); {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "```"):
			lang := strings.TrimSpace(strings.TrimPrefix(trimmed, "```"))
			var code []string
			for i++; i < len(lines) && strings.TrimSpace(lines[i]) != "```"; i++ {
				code = append(code, lines[i])
			}
			i++ // the closing fence
			block := map[string]any{"type": "codeBlock"}
			if lang != "" {
				block["attrs"] = map[string]any{"language": lang}
			}
			if len(code) > 0 {
				block["content"] = []any{map[string]any{"type": "text", "text": strings.Join(code, "\n")}}
			}
			content = append(content, block)
		case trimmed == "---":
			content = append(content, map[string]any{"type": "rule"})
			i++
		case bullet.MatchString(line):
			var items []listLine
			for ; i < len(lines) && bullet.MatchString(lines[i]); i++ {
				m := bullet.FindStringSubmatch(lines[i])
				level := len(strings.ReplaceAll(m[1], "\t", "  ")) / 2
				if n := len(items); n == 0 {
					level = 0
				} else if level > items[n-1].level+1 {
					level = items[n-1].level + 1
				}
				items = append(items, listLine{level, m[2]})
			}
			l, _ := list(items, 0, 0)
			content = append(content, l)
		default:
			p := map[string]any{"type": "paragraph"}
			if line != "" {
				p["content"] = inline(line)
			}
			content = append(content, p)
			i++
		}
	}
	return map[string]any{"type": "doc", "version": 1, "content": content}
}

type adfNode struct {
	Type    string    `json:"type"`
	Text    string    `json:"text"`
	Content []adfNode `json:"content"`
	Marks   []struct {
		Type string `json:"type"`
	} `json:"marks"`
	Attrs struct {
		Language string `json:"language"`
	} `json:"attrs"`
}

func (n *adfNode) inline() string {
	var b strings.Builder
	for _, c := range n.Content {
		switch c.Type {
		case "text":
			strong := false
			for _, m := range c.Marks {
				strong = strong || m.Type == "strong"
			}
			if strong {
				b.WriteString("**" + c.Text + "**")
			} else {
				b.WriteString(c.Text)
			}
		case "hardBreak":
			b.WriteString("\n")
		default:
			b.WriteString(c.inline())
		}
	}
	return b.String()
}

func (n *adfNode) lines(depth int, out *[]string) {
	switch n.Type {
	case "bulletList", "orderedList":
		for _, item := range n.Content {
			first := true
			for _, c := range item.Content {
				if c.Type == "bulletList" || c.Type == "orderedList" {
					c.lines(depth+1, out)
				} else if first {
					*out = append(*out, strings.Repeat("  ", depth)+"- "+c.inline())
					first = false
				} else {
					*out = append(*out, strings.Repeat("  ", depth)+"  "+c.inline())
				}
			}
		}
	case "rule":
		*out = append(*out, "---")
	case "codeBlock":
		*out = append(*out, "```"+n.Attrs.Language, n.inline(), "```")
	case "paragraph", "heading":
		*out = append(*out, n.inline())
	default:
		for _, c := range n.Content {
			c.lines(depth, out)
		}
	}
}

// adfText is the opposite of adf: a document as the text that makes it.
func adfText(raw json.RawMessage) string {
	var n adfNode
	if json.Unmarshal(raw, &n) != nil {
		return ""
	}
	var out []string
	n.lines(0, &out)
	return strings.TrimRight(strings.Join(out, "\n"), "\n")
}

// fieldValue turns what the form holds (a string, or a list of strings for
// several options) into what Jira expects for that kind of field. ok is
// false when there is nothing to send.
func fieldValue(f CreateField, v any, offset string) (out any, ok bool, err error) {
	if list, isList := v.([]any); isList && f.Kind == KindUsers {
		ids := []any{}
		for _, x := range list {
			if id, _ := x.(string); id != "" {
				ids = append(ids, map[string]string{"accountId": id})
			}
		}
		return ids, len(ids) > 0, nil
	}
	if list, isList := v.([]any); isList {
		if f.Kind != KindOptions {
			return nil, false, fmt.Errorf("%s: 값이 하나여야 합니다", f.Name)
		}
		ids := []any{}
		for _, x := range list {
			id, _ := x.(string)
			if !hasOption(f, id) {
				return nil, false, fmt.Errorf("%s: 고를 수 없는 값입니다", f.Name)
			}
			ids = append(ids, map[string]string{"id": id})
		}
		return ids, len(ids) > 0, nil
	}
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, false, nil
	}
	switch f.Kind {
	case KindText:
		return s, true, nil
	case KindLong:
		return adf(s), true, nil
	case KindDate:
		if len(s) != 10 {
			return nil, false, fmt.Errorf("%s: 날짜는 2026-12-01 형식이어야 합니다", f.Name)
		}
		return s, true, nil
	case KindDateTime:
		// "2026-12-01T18:00" from the form: Jira wants seconds and an offset.
		if len(s) == 16 {
			s += ":00.000" + offset
		}
		return s, true, nil
	case KindNumber:
		n, perr := strconv.ParseFloat(s, 64)
		if perr != nil {
			return nil, false, fmt.Errorf("%s: 숫자를 입력해 주세요", f.Name)
		}
		return n, true, nil
	case KindUser:
		return map[string]string{"accountId": s}, true, nil
	case KindUsers:
		return []any{map[string]string{"accountId": s}}, true, nil
	case KindOption:
		if !hasOption(f, s) {
			return nil, false, fmt.Errorf("%s: 고를 수 없는 값입니다", f.Name)
		}
		return map[string]string{"id": s}, true, nil
	case KindOptions:
		if !hasOption(f, s) {
			return nil, false, fmt.Errorf("%s: 고를 수 없는 값입니다", f.Name)
		}
		return []any{map[string]string{"id": s}}, true, nil
	}
	return nil, false, fmt.Errorf("%s: 앱에서 입력할 수 없는 항목입니다", f.Name)
}

func hasOption(f CreateField, id string) bool {
	for _, o := range f.Options {
		if o.ID == id {
			return true
		}
	}
	return false
}

// CreateIssue makes a ticket and returns its key. values holds the form by
// field id; assignee is an account id ("" = nobody); offset is the time
// zone of times typed into the form ("+0900").
func (c *Client) CreateIssue(ctx context.Context, project, typeID string, fields []CreateField, values map[string]any, assignee, offset string) (string, error) {
	body := map[string]any{"project": map[string]string{"key": project}, "issuetype": map[string]string{"id": typeID}}
	known := map[string]CreateField{}
	for _, f := range fields {
		known[f.ID] = f
	}
	var links []any
	for id, v := range values {
		if id == LinkTypeField {
			continue
		}
		f, ok := known[id]
		if ok && f.Kind == KindLinks {
			kind, _ := values[LinkTypeField].(string)
			if kind == "" {
				kind = f.Default
			}
			if !hasOption(f, kind) {
				return "", fmt.Errorf("%s: 고를 수 없는 연결 종류입니다", f.Name)
			}
			keys, err := linkKeys(v)
			if err != nil {
				return "", fmt.Errorf("%s: %w", f.Name, err)
			}
			for _, k := range keys {
				links = append(links, map[string]any{"add": map[string]any{"type": map[string]string{"id": kind}, "outwardIssue": map[string]string{"key": k}}})
			}
			continue
		}
		if !ok {
			return "", fmt.Errorf("알 수 없는 항목입니다: %s", id)
		}
		val, has, err := fieldValue(f, v, offset)
		if err != nil {
			return "", err
		}
		if has {
			body[id] = val
		}
	}
	for _, f := range fields {
		_, set := body[f.ID]
		if f.Kind == KindLinks {
			set = len(links) > 0
		}
		if f.Required && !f.HasDefault && !set {
			return "", fmt.Errorf("%s 항목을 입력해 주세요", f.Name)
		}
	}
	if assignee != "" {
		body["assignee"] = map[string]string{"accountId": assignee}
	}
	var out struct {
		Key string `json:"key"`
	}
	req := map[string]any{"fields": body}
	if len(links) > 0 {
		req["update"] = map[string]any{"issuelinks": links}
	}
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/issue", req, &out); err != nil {
		return "", err
	}
	if out.Key == "" {
		return "", errors.New("Jira가 만든 티켓의 번호를 알려 주지 않았습니다")
	}
	return out.Key, nil
}

var issueKey = regexp.MustCompile(`^[A-Z][A-Z0-9_]*-[0-9]+$`)

// linkKeys reads the tickets typed into a links field: a list, or one text
// with the keys apart by commas or spaces.
func linkKeys(v any) ([]string, error) {
	var raw []string
	switch x := v.(type) {
	case string:
		raw = strings.FieldsFunc(x, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' })
	case []any:
		for _, e := range x {
			if s, _ := e.(string); s != "" {
				raw = append(raw, s)
			}
		}
	}
	var keys []string
	seen := map[string]bool{}
	for _, k := range raw {
		k = strings.ToUpper(strings.TrimSpace(k))
		if !issueKey.MatchString(k) {
			return nil, fmt.Errorf("%q 은(는) 티켓 번호가 아닙니다 (예: ABC-123)", k)
		}
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	return keys, nil
}
