package main

import (
	_ "embed"
	"fmt"
	"runtime"
	"strings"
	"sync"

	"github.com/sizzlei/argusDesk/internal/board"
	"github.com/sizzlei/argusDesk/internal/model"
	"github.com/sizzlei/argusDesk/internal/secret"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The tray icon: a black box that macOS tints for the menu bar, and the app's
// own box on Windows.
//
//go:embed build/tray-mac.png
var trayMac []byte

//go:embed build/tray.png
var trayIcon []byte

// evTray asks the screen to open something: "notices", "brief".
const evTray = "tray:open"

// tray keeps ArgusDesk in the menu bar (macOS) or the notification area
// (Windows). Closing the window only hides it: the centre goes on reading
// Jira and sending notifications until "종료" is chosen.
type tray struct {
	app *application.App
	win *application.WebviewWindow
	t   *application.SystemTray

	mu        sync.Mutex
	approvals *application.MenuItem
	replies   *application.MenuItem
	menu      *application.Menu
	quitting  bool
}

// startTray puts the icon up and turns the window's close button into "hide".
func startTray(app *application.App, win *application.WebviewWindow, svc *App) *tray {
	tr := &tray{app: app, win: win, t: app.SystemTray.New()}
	if runtime.GOOS == "darwin" {
		tr.t.SetTemplateIcon(trayMac)
	} else {
		tr.t.SetIcon(trayIcon)
	}
	tr.t.SetTooltip("ArgusDesk")

	m := app.NewMenu()
	m.Add("ArgusDesk 열기").OnClick(func(*application.Context) { tr.show("") })
	m.AddSeparator()
	tr.approvals = m.Add("내 승인 대기 0").OnClick(func(*application.Context) { tr.show("notices") })
	tr.replies = m.Add("요청자 답변 0").OnClick(func(*application.Context) { tr.show("brief") })
	m.Add("출근 브리핑").OnClick(func(*application.Context) { tr.show("brief") })
	m.Add("지금 새로 고침").OnClick(func(*application.Context) { go svc.Refresh() })
	m.AddSeparator()
	m.Add("ArgusDesk 종료").OnClick(func(*application.Context) { tr.quit() })
	tr.menu = m
	tr.t.SetMenu(m)

	// A click on Windows brings the window back; on macOS a status item opens its menu.
	if runtime.GOOS == "windows" {
		tr.t.OnClick(func() { tr.show("") })
		tr.t.OnRightClick(func() { tr.t.OpenMenu() })
	} else {
		tr.t.OnClick(func() { tr.t.OpenMenu() })
	}

	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		tr.mu.Lock()
		quitting := tr.quitting
		tr.mu.Unlock()
		if quitting {
			return
		}
		e.Cancel()
		win.Hide()
		svc.toldTray()
	})
	// The Dock icon of a hidden window brings it back.
	app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) { tr.show("") })
	return tr
}

// show brings the window to the front, and asks the screen to open `what`.
func (tr *tray) show(what string) {
	if tr.win.IsMinimised() {
		tr.win.UnMinimise()
	}
	tr.win.Show().Focus()
	if what != "" {
		tr.app.Event.Emit(evTray, what)
	}
}

func (tr *tray) quit() {
	tr.mu.Lock()
	tr.quitting = true
	tr.mu.Unlock()
	tr.app.Quit()
}

// status shows what waits for me: next to the icon on macOS, in the menu and
// the tooltip everywhere.
func (tr *tray) status(snap *model.Snapshot) {
	if tr == nil || snap == nil {
		return
	}
	approvals, replies := 0, 0
	for _, b := range snap.Boxes {
		if b.MyApproval {
			approvals++
		}
		if b.Reply != nil && (b.Mine || b.AssigneeID == "") {
			replies++
		}
	}
	tr.mu.Lock()
	defer tr.mu.Unlock()
	tr.approvals.SetLabel(fmt.Sprintf("내 승인 대기 %d", approvals))
	tr.replies.SetLabel(fmt.Sprintf("요청자 답변 %d", replies))
	tr.menu.Update()
	label := ""
	if n := approvals + replies; n > 0 {
		label = fmt.Sprint(n)
	}
	tr.t.SetLabel(label)
	tip := []string{"ArgusDesk"}
	if approvals > 0 {
		tip = append(tip, fmt.Sprintf("내 승인 대기 %d", approvals))
	}
	if replies > 0 {
		tip = append(tip, fmt.Sprintf("요청자 답변 %d", replies))
	}
	tr.t.SetTooltip(strings.Join(tip, " · "))
}

// boardNote is one notification of the app's own.
func boardNote(title, body string) []board.Note {
	return []board.Note{{Title: title, Body: body}}
}

// toldTray says once, the first time the window is closed, that the app is
// still running in the tray.
func (a *App) toldTray() {
	a.mu.Lock()
	told := a.prefs.TrayTold
	a.prefs.TrayTold = true
	if !told {
		_ = secret.SavePrefs(a.prefs)
	}
	a.mu.Unlock()
	if told {
		return
	}
	where := "메뉴 막대"
	if runtime.GOOS == "windows" {
		where = "작업 표시줄 알림 영역"
	}
	a.notify.send(boardNote("ArgusDesk는 계속 실행 중입니다", where+"의 상자 아이콘에서 다시 열거나 종료할 수 있습니다."))
}
