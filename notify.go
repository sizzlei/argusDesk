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
		}
	}()
}

func (n *notifier) setProblem(why string) {
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
	if !n.ready.Load() {
		return
	}
	defer func() { _ = recover() }()
	for _, note := range notes {
		_ = n.svc.SendNotification(notifications.NotificationOptions{
			ID:    fmt.Sprintf("argusdesk-%d-%d", time.Now().Unix(), n.seq.Add(1)),
			Title: note.Title,
			Body:  note.Body,
		})
	}
}
