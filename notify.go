package main

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sizzlei/argusDesk/internal/board"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// notifier shows operating system notifications. It is optional: where the
// system refuses (for example a macOS build that is not a signed .app bundle,
// as under "wails3 dev"), it stays off and the app works without it.
type notifier struct {
	svc   *notifications.NotificationService
	ready atomic.Bool
	log   func(format string, args ...any) // the diagnostics diary
	seq   atomic.Int64

	mu    sync.Mutex
	why   string               // why it is off ("" = it works)
	quiet map[string]time.Time // tickets this user just changed: no need to tell them
}

// start prepares the notification service and asks for permission. Every
// failure is kept as the reason notifications are off.
func (n *notifier) start(ctx context.Context, options application.ServiceOptions) {
	defer func() {
		if r := recover(); r != nil {
			n.setProblem(fmt.Sprint(r))
		}
	}()
	n.mu.Lock()
	n.quiet = map[string]time.Time{}
	n.mu.Unlock()
	svc := notifications.New()
	if err := svc.ServiceStartup(ctx, options); err != nil {
		n.setProblem(err.Error())
		return
	}
	n.svc = svc
	go func() {
		defer func() { _ = recover() }()
		ok, err := svc.RequestNotificationAuthorization()
		switch {
		case err != nil:
			n.setProblem(err.Error())
		case !ok:
			n.setProblem("시스템 설정에서 ArgusDesk의 알림이 꺼져 있습니다")
		default:
			n.ready.Store(true)
			if n.log != nil {
				n.log("OS 알림 허용됨")
			}
		}
	}()
}

func (n *notifier) setProblem(why string) {
	if n.log != nil {
		n.log("OS 알림을 쓸 수 없음: %s", why)
	}
	n.mu.Lock()
	n.why = why
	n.mu.Unlock()
}

// problem says why notifications are off ("" = they work).
func (n *notifier) problem() string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.why
}

// touched marks a ticket this user changed from the app.
func (n *notifier) touched(key string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.quiet != nil {
		n.quiet[key] = time.Now()
	}
}

// skip returns the tickets changed from the app in the last few minutes.
func (n *notifier) skip() map[string]bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := map[string]bool{}
	for k, at := range n.quiet {
		if time.Since(at) > 3*time.Minute {
			delete(n.quiet, k)
			continue
		}
		out[k] = true
	}
	return out
}

func (n *notifier) send(notes []board.Note) {
	if len(notes) == 0 {
		return
	}
	logf := func(format string, args ...any) {
		if n.log != nil {
			n.log(format, args...)
		}
	}
	if !n.ready.Load() {
		logf("OS 알림 %d건을 보내지 않음: %s", len(notes), orDash(n.problem()))
		return
	}
	defer func() {
		if r := recover(); r != nil {
			logf("OS 알림 보내다 멈춤: %v", r)
		}
	}()
	sent := 0
	for _, note := range notes {
		err := n.svc.SendNotification(notifications.NotificationOptions{
			ID:    fmt.Sprintf("argusdesk-%d-%d", time.Now().Unix(), n.seq.Add(1)),
			Title: note.Title,
			Body:  note.Body,
		})
		if err != nil {
			logf("OS 알림 보내기 실패: %v", err)
			continue
		}
		sent++
	}
	if sent > 0 {
		logf("OS 알림 %d건 보냄", sent)
	}
}
