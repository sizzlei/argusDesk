package main

import (
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"
)

// The diary is what the app did lately, in plain lines: which step of the
// start it reached, what Jira and the team server answered. It is kept in
// memory only and shown on request, so that "nothing happens" can be told
// apart from "this step failed". Tokens and e-mail addresses never go in.
type diary struct {
	mu    sync.Mutex
	lines []string
	last  string
	again int
}

const diaryMax = 300

// note adds a line. A line repeated in a row is counted instead of listed.
func (a *App) note(format string, args ...any) {
	text := fmt.Sprintf(format, args...)
	d := &a.diary
	d.mu.Lock()
	defer d.mu.Unlock()
	if text == d.last && len(d.lines) > 0 {
		d.again++
		d.lines[len(d.lines)-1] = fmt.Sprintf("%s  %s (x%d)", time.Now().Format("15:04:05"), text, d.again+1)
		return
	}
	d.last, d.again = text, 0
	d.lines = append(d.lines, time.Now().Format("15:04:05")+"  "+text)
	if len(d.lines) > diaryMax {
		d.lines = d.lines[len(d.lines)-diaryMax:]
	}
}

// Diagnostics returns where the app stands and what it did lately, as text
// to read or to send to whoever looks after the app.
func (a *App) Diagnostics() string {
	s := a.State()
	yes := func(b bool) string {
		if b {
			return "예"
		}
		return "아니오"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "ArgusDesk %s · %s/%s · %s\n", Version, runtime.GOOS, runtime.GOARCH, time.Now().Format("2006-01-02 15:04:05 -0700"))
	fmt.Fprintf(&b, "Argus: %s\n", orDash(s.Server))
	fmt.Fprintf(&b, "설정 받음: %s (버전 %s) · Jira 로그인: %s · Jira: %s\n", yes(s.ConfigLoaded), orDash(s.ConfigVersion), yes(s.SignedIn), orDash(s.Site))
	fmt.Fprintf(&b, "Argus가 더 필요로 하는 것: %s · Argus 문제: %s\n", orDash(s.ServerNeeds), orDash(s.ServerProblem))
	fmt.Fprintf(&b, "설정 문제: %s · Jira 문제: %s · 알림 문제: %s\n", orDash(s.ConfigError), orDash(s.AuthError), orDash(s.NotifyProblem))
	b.WriteString("\n최근 기록\n")
	a.diary.mu.Lock()
	defer a.diary.mu.Unlock()
	if len(a.diary.lines) == 0 {
		b.WriteString("(없음)\n")
	}
	for _, l := range a.diary.lines {
		b.WriteString(l + "\n")
	}
	return b.String()
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}
