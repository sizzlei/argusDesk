package jira

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Transition is one move a ticket can make from its current status.
type Transition struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	ToID   string `json:"toId"`
	ToName string `json:"toName"`
	ToKind string `json:"toKind"` // kind of the zone it leads to, filled in by the app ("" = unknown)
	// Needs lists fields Jira insists on for this move. A move with such
	// fields has to be made in Jira, where its screen asks for them.
	Needs []string `json:"needs"`
}

// Approver is one person asked to approve, and what they answered.
type Approver struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Decision string `json:"decision"` // "pending" | "approved" | "declined"
}

// Approval is a Jira Service Management approval waiting on a ticket.
type Approval struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	CanAnswer bool       `json:"canAnswer"` // the signed-in user is asked and has not answered
	Approvers []Approver `json:"approvers"`
}

// Actions is what the signed-in user can do with a ticket right now.
type Actions struct {
	Key            string       `json:"key"`
	Transitions    []Transition `json:"transitions"`
	Approvals      []Approval   `json:"approvals"`      // pending ones only
	ServiceDesk    bool         `json:"serviceDesk"`    // a service desk request: comments are internal or public
	ApprovalsError string       `json:"approvalsError"` // why approvals could not be read ("" = fine)
}

// Actions reads the moves and pending approvals of one ticket. Jira returns
// only what this user may do, so nothing is decided here.
func (c *Client) Actions(ctx context.Context, key string) (*Actions, error) {
	var tr struct {
		Transitions []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			To   struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"to"`
			Fields map[string]struct {
				Required        bool            `json:"required"`
				Name            string          `json:"name"`
				HasDefaultValue bool            `json:"hasDefaultValue"`
				DefaultValue    json.RawMessage `json:"defaultValue"`
			} `json:"fields"`
		} `json:"transitions"`
	}
	path := "/rest/api/3/issue/" + url.PathEscape(key) + "/transitions?expand=transitions.fields"
	if err := c.do(ctx, http.MethodGet, path, nil, &tr); err != nil {
		return nil, err
	}
	out := &Actions{Key: key, Transitions: []Transition{}, Approvals: []Approval{}}
	for _, t := range tr.Transitions {
		needs := []string{}
		for _, f := range t.Fields {
			if f.Required && !f.HasDefaultValue && len(f.DefaultValue) == 0 {
				needs = append(needs, f.Name)
			}
		}
		out.Transitions = append(out.Transitions, Transition{ID: t.ID, Name: t.Name, ToID: t.To.ID, ToName: t.To.Name, Needs: needs})
	}

	// Approvals live in the site's "Approvals" field. Reading them from the
	// ticket works for service desk requests and for ordinary projects that
	// use Jira's approval step alike.
	field, err := c.approvalsFieldID(ctx)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			return nil, err
		}
		out.ApprovalsError = err.Error()
		return out, nil
	}
	names := "project"
	if field != "" {
		names += "," + field
	}
	var issue struct {
		Fields map[string]json.RawMessage `json:"fields"`
	}
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/issue/"+url.PathEscape(key)+"?fields="+names, nil, &issue); err != nil {
		if errors.Is(err, ErrUnauthorized) {
			return nil, err
		}
		out.ApprovalsError = err.Error()
		return out, nil
	}
	var project struct {
		Type string `json:"projectTypeKey"`
	}
	_ = json.Unmarshal(issue.Fields["project"], &project)
	out.ServiceDesk = project.Type == "service_desk"
	if field == "" {
		out.ApprovalsError = "이 Jira 사이트에서 승인(Approvals) 필드를 찾지 못했습니다"
		return out, nil
	}

	var approvals []struct {
		ID                string `json:"id"`
		Name              string `json:"name"`
		FinalDecision     string `json:"finalDecision"`
		CanAnswerApproval bool   `json:"canAnswerApproval"`
		Approvers         []struct {
			Approver struct {
				AccountID   string `json:"accountId"`
				DisplayName string `json:"displayName"`
			} `json:"approver"`
			ApproverDecision string `json:"approverDecision"`
		} `json:"approvers"`
	}
	if raw := issue.Fields[field]; field != "" && len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &approvals); err != nil {
			out.ApprovalsError = "승인 정보를 읽을 수 없습니다: " + err.Error()
			return out, nil
		}
	}
	for _, v := range approvals {
		if !strings.EqualFold(v.FinalDecision, "pending") {
			continue
		}
		a := Approval{ID: v.ID, Name: v.Name, CanAnswer: v.CanAnswerApproval, Approvers: []Approver{}}
		for _, p := range v.Approvers {
			a.Approvers = append(a.Approvers, Approver{ID: p.Approver.AccountID, Name: p.Approver.DisplayName, Decision: strings.ToLower(p.ApproverDecision)})
		}
		out.Approvals = append(out.Approvals, a)
	}
	return out, nil
}

// approvalsFieldID finds the site's "Approvals" field once; "" when the site
// has none.
func (c *Client) approvalsFieldID(ctx context.Context) (string, error) {
	c.mu.Lock()
	id, read := c.approvalsField, c.approvalsFieldRead
	c.mu.Unlock()
	if read {
		return id, nil
	}
	fields, err := c.Fields(ctx)
	if err != nil {
		return "", err
	}
	for _, f := range fields {
		// "com.atlassian.servicedesk.approvals-plugin:sd-approvals"; matched by
		// its last part so a renamed plugin key does not hide it.
		if strings.HasSuffix(f.Schema.Custom, ":sd-approvals") {
			id = f.ID
			break
		}
	}
	c.mu.Lock()
	c.approvalsField, c.approvalsFieldRead = id, true
	c.mu.Unlock()
	return id, nil
}

// ApprovalAPI checks whether the approval can be answered through the API for
// this ticket: it reads the same address an answer is sent to. nil means yes.
func (c *Client) ApprovalAPI(ctx context.Context, key string) error {
	return c.do(ctx, http.MethodGet, "/rest/servicedeskapi/request/"+url.PathEscape(key)+"/approval?limit=1", nil, nil)
}

// DoTransition moves a ticket along one of its transitions.
func (c *Client) DoTransition(ctx context.Context, key, transitionID string) error {
	body := map[string]any{"transition": map[string]string{"id": transitionID}}
	return c.do(ctx, http.MethodPost, "/rest/api/3/issue/"+url.PathEscape(key)+"/transitions", body, nil)
}

// Assign gives a ticket to an account; an empty account id leaves it unassigned.
func (c *Client) Assign(ctx context.Context, key, accountID string) error {
	body := map[string]any{"accountId": nil}
	if accountID != "" {
		body["accountId"] = accountID
	}
	return c.do(ctx, http.MethodPut, "/rest/api/3/issue/"+url.PathEscape(key)+"/assignee", body, nil)
}

// AnswerApproval approves or declines a pending approval as the signed-in user.
func (c *Client) AnswerApproval(ctx context.Context, key, approvalID string, approve bool) error {
	decision := "decline"
	if approve {
		decision = "approve"
	}
	path := "/rest/servicedeskapi/request/" + url.PathEscape(key) + "/approval/" + url.PathEscape(approvalID)
	err := c.do(ctx, http.MethodPost, path, map[string]string{"decision": decision}, nil)
	var he *HTTPError
	if errors.As(err, &he) && he.Code == http.StatusNotFound {
		return fmt.Errorf("이 티켓의 승인은 앱에서 처리할 수 없습니다. Jira에서 승인해 주세요 (%w)", err)
	}
	return err
}

// Where a comment goes.
const (
	CommentInternal = "internal" // service desk: a note only the team sees
	CommentPublic   = "public"   // service desk: shown to the requester
	CommentPlain    = "plain"    // an ordinary project: a normal comment
)

// AddComment writes a comment in one of the three ways above.
func (c *Client) AddComment(ctx context.Context, key, text, mode string) error {
	switch mode {
	case CommentInternal, CommentPublic:
		body := map[string]any{"body": text, "public": mode == CommentPublic}
		return c.do(ctx, http.MethodPost, "/rest/servicedeskapi/request/"+url.PathEscape(key)+"/comment", body, nil)
	case CommentPlain:
		// The platform API takes a document: one paragraph per line of text.
		paragraphs := []any{}
		for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
			p := map[string]any{"type": "paragraph"}
			if line != "" {
				p["content"] = []any{map[string]any{"type": "text", "text": line}}
			}
			paragraphs = append(paragraphs, p)
		}
		body := map[string]any{"body": map[string]any{"type": "doc", "version": 1, "content": paragraphs}}
		return c.do(ctx, http.MethodPost, "/rest/api/3/issue/"+url.PathEscape(key)+"/comment", body, nil)
	}
	return errors.New("알 수 없는 댓글 종류: " + mode)
}
