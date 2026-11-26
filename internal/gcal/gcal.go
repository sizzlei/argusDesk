// Package gcal puts a teammate's holiday on a shared Google calendar.
//
// It acts as the team's shared Google account, with a key the team server
// hands out. The key is asked for when a holiday is saved and kept in memory
// only for that call: nothing of it is written to this computer.
//
// Only events this app made are ever touched. Each carries a hidden mark with
// the holder's account id; events people put on the calendar themselves have
// no such mark and are left alone.
package gcal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Key is what the team server hands out for the shared calendar.
type Key struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RefreshToken string `json:"refreshToken"`
	CalendarID   string `json:"calendarId"`
}

// Complete reports whether nothing is missing.
func (k *Key) Complete() bool {
	return k != nil && k.ClientID != "" && k.RefreshToken != "" && k.CalendarID != ""
}

// TokenURL and APIBase can be replaced in tests.
var (
	TokenURL = "https://oauth2.googleapis.com/token"
	APIBase  = "https://www.googleapis.com/calendar/v3"
)

// markKey names the hidden mark on events this app made.
const markKey = "argusdesk_vacation"

var client = &http.Client{
	Timeout:       20 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// access trades the key for a short-lived access token.
func access(ctx context.Context, k *Key) (string, error) {
	form := url.Values{"grant_type": {"refresh_token"}, "client_id": {k.ClientID}, "refresh_token": {k.RefreshToken}}
	if k.ClientSecret != "" {
		form.Set("client_secret", k.ClientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("Google에 연결하지 못했습니다: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		// The answer may repeat parts of the key: only the status is shown.
		return "", fmt.Errorf("캘린더 계정으로 로그인하지 못했습니다 (HTTP %d). 서버에 등록한 캘린더 연결을 확인해 주세요", res.StatusCode)
	}
	var out struct {
		Access string `json:"access_token"`
	}
	if json.Unmarshal(body, &out) != nil || out.Access == "" {
		return "", errors.New("Google의 응답을 읽을 수 없습니다")
	}
	return out.Access, nil
}

type date struct {
	Date string `json:"date"`
}

type event struct {
	ID           string `json:"id,omitempty"`
	Summary      string `json:"summary"`
	Start        date   `json:"start"`
	End          date   `json:"end"` // the day after the last day: Google's end is exclusive
	Transparency string `json:"transparency"`
	Extended     *struct {
		Private map[string]string `json:"private"`
	} `json:"extendedProperties,omitempty"`
}

func call(ctx context.Context, tok, method, target string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Google 캘린더에 연결하지 못했습니다: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	switch {
	case res.StatusCode == http.StatusGone || (method == http.MethodDelete && res.StatusCode == http.StatusNotFound):
		return nil // already gone
	case res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusNotFound:
		return fmt.Errorf("캘린더에 쓸 권한이 없거나 캘린더를 찾을 수 없습니다 (HTTP %d)", res.StatusCode)
	case res.StatusCode < 200 || res.StatusCode > 299:
		return fmt.Errorf("Google 캘린더가 요청을 받지 않았습니다 (HTTP %d)", res.StatusCode)
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// SetHoliday makes the calendar show one person's holiday from one day to
// another, both included ("2026-12-01"). With empty days the holiday is taken
// off the calendar. Calling it again with the same days changes nothing, so a
// failed attempt can simply be repeated.
func SetHoliday(ctx context.Context, k *Key, accountID, name, from, to string) error {
	if !k.Complete() {
		return errors.New("캘린더 연결 정보가 완전하지 않습니다")
	}
	if accountID == "" {
		return errors.New("누구의 휴가인지 알 수 없습니다")
	}
	var end string
	if from != "" {
		last, err := time.Parse("2006-01-02", to)
		if _, err2 := time.Parse("2006-01-02", from); err != nil || err2 != nil {
			return errors.New("날짜는 2026-12-01 형식이어야 합니다")
		}
		end = last.AddDate(0, 0, 1).Format("2006-01-02")
	}
	tok, err := access(ctx, k)
	if err != nil {
		return err
	}
	events := APIBase + "/calendars/" + url.PathEscape(k.CalendarID) + "/events"

	// the events this app made for this person, however many there are
	var found struct {
		Items []event `json:"items"`
	}
	q := url.Values{"privateExtendedProperty": {markKey + "=" + accountID}, "showDeleted": {"false"}, "maxResults": {"50"}}
	if err := call(ctx, tok, http.MethodGet, events+"?"+q.Encode(), nil, &found); err != nil {
		return err
	}
	keep := 0
	if from != "" && len(found.Items) > 0 {
		keep = 1
	}
	for _, old := range found.Items[keep:] { // a cancelled holiday, or duplicates of one
		if err := call(ctx, tok, http.MethodDelete, events+"/"+url.PathEscape(old.ID), nil, nil); err != nil {
			return err
		}
	}
	if from == "" {
		return nil
	}
	want := event{Summary: strings.TrimSpace(name + " 휴가"), Start: date{from}, End: date{end}, Transparency: "transparent"} // all day, shown as free
	if keep == 1 {
		have := found.Items[0]
		if have.Summary == want.Summary && have.Start.Date == from && have.End.Date == end {
			return nil
		}
		// PATCH leaves what people changed by hand (place, reminders, guests) as it is.
		return call(ctx, tok, http.MethodPatch, events+"/"+url.PathEscape(have.ID), map[string]any{"summary": want.Summary, "start": want.Start, "end": want.End}, nil)
	}
	want.Extended = &struct {
		Private map[string]string `json:"private"`
	}{Private: map[string]string{markKey: accountID}}
	return call(ctx, tok, http.MethodPost, events, want, nil)
}
