package main

import (
	_ "embed"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

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
	deployMe  *application.MenuItem
	deployAll *application.MenuItem
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
	tr.deployMe = m.Add("오늘 내 배포 0").OnClick(func(*application.Context) { tr.show("deploys:mine") })
	tr.deployAll = m.Add("오늘 전체 배포 0").OnClick(func(*application.Context) { tr.show("deploys:all") })
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
	mine, all := deploysToday(snap, time.Now())
	tr.mu.Lock()
	defer tr.mu.Unlock()
	tr.approvals.SetLabel(fmt.Sprintf("내 승인 대기 %d", approvals))
	tr.replies.SetLabel(fmt.Sprintf("요청자 답변 %d", replies))
	tr.deployMe.SetLabel(fmt.Sprintf("오늘 내 배포 %d", mine))
	tr.deployAll.SetLabel(fmt.Sprintf("오늘 전체 배포 %d", all))
	tr.deployMe.SetEnabled(mine > 0)
	tr.deployAll.SetEnabled(all > 0)
	tr.menu.Update()
	// Next to the icon: what waits for me, then my deployments of the day.
	var label []string
	if n := approvals + replies; n > 0 {
		label = append(label, fmt.Sprint(n))
	}
	if mine > 0 {
		label = append(label, fmt.Sprintf("배포 %d", mine))
	}
	tr.t.SetLabel(strings.Join(label, " · "))
	tip := []string{"ArgusDesk"}
	if approvals > 0 {
		tip = append(tip, fmt.Sprintf("내 승인 대기 %d", approvals))
	}
	if replies > 0 {
		tip = append(tip, fmt.Sprintf("요청자 답변 %d", replies))
	}
	if all > 0 {
		tip = append(tip, fmt.Sprintf("오늘 배포 %d (내 것 %d)", all, mine))
	}
	tr.t.SetTooltip(strings.Join(tip, " · "))
}

// deploysToday counts the production deployments set for today that are not
// done yet: mine, and the whole team's. A date counts for the whole day; a
// date-time counts on its day in local time. The same rule as the screen's.
func deploysToday(snap *model.Snapshot, now time.Time) (mine, all int) {
	closed := map[string]bool{}
	for _, sp := range snap.Spaces {
		for _, z := range sp.Zones {
			if z.Kind == "done" || z.Kind == "returned" {
				closed[sp.ID+"/"+z.ID] = true
			}
		}
	}
	today := now.Format("2006-01-02")
	for _, b := range snap.Boxes {
		if closed[b.Space+"/"+b.Zone] || deployDay(b.Deploy, now.Location()) != today {
			continue
		}
		all++
		if b.Mine {
			mine++
		}
	}
	return mine, all
}

// deployDay is the local day of a deployment field's value ("" when there is none).
func deployDay(v string, loc *time.Location) string {
	v = strings.TrimSpace(v)
	if len(v) == len("2006-01-02") {
		return v
	}
	for _, layout := range []string{"2006-01-02T15:04:05.000-0700", "2006-01-02T15:04:05-0700", time.RFC3339Nano, "2006-01-02T15:04:05.000Z07:00"} {
		if t, err := time.Parse(layout, v); err == nil {
			return t.In(loc).Format("2006-01-02")
		}
	}
	return ""
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
