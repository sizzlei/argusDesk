package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/sizzlei/argusDesk/internal/argus"
	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/game"
	"github.com/sizzlei/argusDesk/internal/jira"
	"github.com/sizzlei/argusDesk/internal/secret"
)

// The team server is optional. With one, the user signs in to the server
// only: the settings and the user's Jira key come from it, and holidays and
// avatars are kept on it. Without one, the app works from a settings file
// and a Jira token typed into the app.

// What the server sign-in still needs before the centre can open.
const (
	needLogin     = "login"     // sign in to the server
	needJira      = "jira"      // register a Jira key on the server
	needConfig    = "config"    // nobody has uploaded settings yet
	needForbidden = "forbidden" // this account may not use the app
	needDisabled  = "disabled"  // the feature is switched off on the server
	needLocked    = "locked"    // the server account is locked
	needSite      = "site"      // the server's administrator has not set the Jira site
)

// serverState is the part of App that belongs to the team server. Guarded by App.mu.
type serverState struct {
	client  *argus.Client
	needs   string
	problem string // the last thing that went wrong ("" = fine)
	busy    bool   // waiting for the browser sign-in
	cancel  context.CancelFunc
	stop    context.CancelFunc // the loop that watches for new settings

	cfgTag   string
	cfgVer   int // the version the server gives the settings in force; 0 = not from the server
	teamTag  string
	team     *argus.Team
	feedTag  string
	feed     *ServerFeed
	rejected time.Time // when Jira last refused the key from the server
}

// reveal shows a file in the file manager, selected.
func reveal(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	case "windows":
		return exec.Command("explorer", "/select,"+path).Start()
	}
	return exec.Command("xdg-open", filepath.Dir(path)).Start()
}

// openBrowser shows a page in the user's browser.
func openBrowser(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

// keepServerToken stores a renewed sign-in, or forgets one the server no longer accepts.
func (a *App) keepServerToken(base string) func(*argus.Token) {
	return func(t *argus.Token) {
		if t == nil {
			_ = secret.DeleteServerToken(base)
			a.mu.Lock()
			a.srv.client, a.srv.needs = nil, needLogin
			a.mu.Unlock()
			return
		}
		if b, err := json.Marshal(t); err == nil {
			if serr := secret.SaveServerToken(base, string(b)); serr != nil {
				a.note("Argus 로그인을 자격 증명 저장소에 보관하지 못함 (%d바이트): %v", len(b), serr)
			}
		}
	}
}

// restoreServer picks the server sign-in up again at start. The centre opens
// at once on the settings and the Jira key kept from last time; the server
// is asked in the background.
func (a *App) restoreServer() {
	base := a.prefs.Server
	if good, err := secret.LastGoodConfigPath(); err == nil {
		if cfg, err := config.Load(good); err == nil {
			a.cfg, a.cfgFallback = cfg, true // until the server confirms it
			a.srv.cfgVer = a.prefs.ServerConfig
		}
	}
	blob, err := secret.LoadServerToken(base)
	var tok argus.Token
	if err != nil || json.Unmarshal([]byte(blob), &tok) != nil {
		a.note("보관해 둔 Argus 로그인을 읽지 못함: %v", err)
		a.srv.needs = needLogin
		return
	}
	a.note("보관해 둔 Argus 로그인으로 시작 (%s)", base)
	a.srv.client = argus.New(base, argus.DefaultEndpoints(), &tok, a.keepServerToken(base))
	go a.syncAndTell()
	a.watchServer()
}

// watchServer asks the server now and then whether the settings changed.
func (a *App) watchServer() {
	a.mu.Lock()
	if a.srv.stop != nil {
		a.srv.stop()
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.srv.stop = cancel
	a.mu.Unlock()
	go func() {
		t := time.NewTicker(5 * time.Minute)
		f := time.NewTicker(30 * time.Second)
		defer t.Stop()
		defer f.Stop()
		a.readFeed(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				a.syncAndTell()
			case <-f.C:
				a.readFeed(ctx)
			}
		}
	}()
}

// ConnectServer signs in to the team server at addr through the browser. It
// returns when the sign-in is done, refused, cancelled or timed out.
func (a *App) ConnectServer(addr string) (*AppState, error) {
	base, err := argus.CleanBase(addr)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	if a.srv.busy {
		a.mu.Unlock()
		return nil, errors.New("이미 로그인을 기다리는 중입니다")
	}
	if old := a.prefs.Server; old != "" && old != base {
		_ = secret.DeleteServerToken(old) // another server: nothing of the old one is kept
	}
	a.prefs.Server = base
	_ = secret.SavePrefs(a.prefs)
	ctx, cancel := context.WithCancel(context.Background())
	a.srv.busy, a.srv.cancel, a.srv.problem = true, cancel, ""
	a.mu.Unlock()

	ep := argus.DefaultEndpoints()
	// Asked first, without a sign-in: a wrong address or a switched-off server is told apart before the browser opens.
	a.note("Argus 로그인 시작 (%s)", base)
	st, err := argus.ServerStatus(ctx, base, ep)
	if err == nil && !st.Enabled {
		err = argus.ErrDisabled
	}
	if err != nil {
		a.note("Argus 상태 확인 실패: %v", err)
		cancel()
		a.mu.Lock()
		a.srv.busy, a.srv.cancel, a.srv.needs, a.srv.problem = false, nil, needLogin, err.Error()
		a.mu.Unlock()
		return nil, err
	}
	tok, err := argus.Login(ctx, base, ep, openBrowser)
	cancelled := ctx.Err() != nil
	cancel()
	if err != nil {
		a.note("Argus 로그인 실패 (취소 %v): %v", cancelled, err)
	} else {
		a.note("Argus 로그인 성공")
	}
	a.mu.Lock()
	a.srv.busy, a.srv.cancel = false, nil
	if err != nil {
		a.srv.needs = needLogin
		if cancelled {
			err = errors.New("로그인을 취소했습니다")
		}
		a.srv.problem = err.Error()
		a.mu.Unlock()
		return nil, err
	}
	keep := a.keepServerToken(base)
	a.srv.client = argus.New(base, ep, tok, keep)
	a.srv.needs, a.srv.cfgTag, a.srv.cfgVer, a.srv.teamTag, a.srv.team = "", "", 0, "", nil
	a.mu.Unlock()
	keep(tok)
	a.syncServer(true)
	a.watchServer()
	return a.State(), nil
}

// CancelServerLogin stops waiting for the browser.
func (a *App) CancelServerLogin() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.srv.cancel != nil {
		a.srv.cancel()
	}
}

// SyncServer asks the server again (after registering a Jira key there, say).
func (a *App) SyncServer() *AppState {
	a.syncServer(true)
	return a.State()
}

// ForgetServer signs out of the team server and goes back to working from a
// settings file. Everything received from the server is forgotten.
func (a *App) ForgetServer() (*AppState, error) {
	a.dropServer(true)
	return a.State(), nil
}

// dropServer signs out of the server. With forget, the address goes too.
func (a *App) dropServer(forget bool) {
	a.mu.Lock()
	c, base := a.srv.client, a.prefs.Server
	if a.srv.stop != nil {
		a.srv.stop()
	}
	if a.srv.cancel != nil {
		a.srv.cancel()
	}
	if a.stopPolling != nil {
		a.stopPolling()
		a.stopPolling = nil
	}
	site, email := a.prefs.Site, a.prefs.Email
	a.srv = serverState{needs: needLogin}
	a.client, a.me, a.engine, a.authError = nil, nil, nil, ""
	a.cfg, a.cfgError, a.cfgFallback = nil, "", false
	a.prefs.Site, a.prefs.Email, a.prefs.ServerConfig = "", "", 0
	if forget {
		a.prefs.Server, a.srv.needs = "", ""
	}
	_ = secret.SavePrefs(a.prefs)
	a.mu.Unlock()

	if c != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		c.SignOut(ctx)
		cancel()
	}
	a.mu.Lock()
	a.srv.client = nil
	if forget {
		a.srv.needs = "" // signing out marked it as "sign in again": not with the server forgotten
	}
	a.mu.Unlock()
	_ = secret.DeleteServerToken(base)
	_ = secret.DeleteToken(site, email) // the Jira key came from the server
	if good, err := secret.LastGoodConfigPath(); err == nil {
		_ = os.Remove(good)
	}
}

// syncAndTell asks the server on the app's own account (at the start, on the
// timer) and tells the screen where things stand afterwards: the settings'
// version, or what the server still needs, may have changed.
func (a *App) syncAndTell() {
	a.syncServer(false)
	if a.app != nil {
		a.app.Event.Emit(evServer, a.State())
	}
}

// syncServer brings the app in line with the server: the settings in force
// and, when Jira is not signed in yet (or force), the user's Jira key.
func (a *App) syncServer(force bool) {
	// One at a time: the timer, the start and a button can all ask at once,
	// and two answers would sign in to Jira twice.
	a.syncMu.Lock()
	defer a.syncMu.Unlock()
	a.mu.Lock()
	c := a.srv.client
	tag := a.srv.cfgTag
	a.mu.Unlock()
	if c == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	stop := func(err error) bool { // true: nothing more can be done until the user acts
		need := ""
		switch {
		case errors.Is(err, argus.ErrUnauthorized):
			need = needLogin
		case errors.Is(err, argus.ErrForbidden):
			need = needForbidden
		case errors.Is(err, argus.ErrDisabled):
			need = needDisabled
		case errors.Is(err, argus.ErrLocked):
			need = needLocked
		case errors.Is(err, argus.ErrNoSite):
			need = needSite
		default:
			return false
		}
		a.mu.Lock()
		a.srv.needs, a.srv.problem = need, err.Error()
		a.mu.Unlock()
		return true
	}

	restart := false
	got, changed, err := c.Config(ctx, &tag)
	switch {
	case err != nil:
		a.note("Argus 설정 받기 실패: %v", err)
	case changed:
		a.note("Argus 설정 받음: 버전 %d, %d바이트", got.Version, len(got.YAML))
	}
	switch {
	case err == nil && changed:
		cfg, perr := config.Parse([]byte(got.YAML))
		if perr != nil {
			a.note("Argus에서 받은 설정을 쓸 수 없음: %v", perr)
		}
		a.mu.Lock()
		if perr != nil {
			// A broken upload does not stop the centre: it keeps the settings it had.
			a.cfgError, a.cfgFallback = fmt.Sprintf("서버의 설정(버전 %d)을 쓸 수 없습니다: %v", got.Version, perr), a.cfg != nil
		} else {
			a.cfg, a.cfgError, a.cfgFallback, a.srv.cfgTag, a.srv.cfgVer = cfg, "", false, tag, got.Version
			restart = true
			if good, gerr := secret.LastGoodConfigPath(); gerr == nil {
				_ = os.WriteFile(good, []byte(got.YAML), 0o600)
			}
			a.prefs.ServerConfig = got.Version // known at the next start, before the server has answered
			_ = secret.SavePrefs(a.prefs)
		}
		if a.srv.needs == needConfig {
			a.srv.needs = ""
		}
		a.srv.problem = ""
		a.mu.Unlock()
	case err == nil: // unchanged
		a.mu.Lock()
		a.cfgFallback, a.srv.problem = false, ""
		a.mu.Unlock()
	case errors.Is(err, argus.ErrNotFound):
		a.mu.Lock()
		if a.cfg == nil {
			a.srv.needs = needConfig
		}
		a.mu.Unlock()
	case stop(err):
		return
	default: // the server cannot be reached: carry on with what was kept
		a.mu.Lock()
		a.srv.problem = err.Error()
		a.mu.Unlock()
	}

	a.mu.Lock()
	signedIn := a.me != nil
	a.mu.Unlock()
	if signedIn && !force {
		if restart {
			a.startPolling()
		}
		return
	}
	key, err := c.JiraKey(ctx)
	if err != nil {
		a.note("Argus에서 Jira 토큰 받기 실패: %v", err)
	} else {
		raw := len(key.Site) + len(key.Email) + len(key.Token)
		key.Site, key.Email, key.Token = strings.TrimSpace(key.Site), strings.TrimSpace(key.Email), strings.TrimSpace(key.Token)
		form := "알 수 없는 형식"
		if strings.HasPrefix(key.Token, "ATATT") {
			form = "Atlassian API 토큰 형식"
		}
		a.note("Argus에서 Jira 토큰 받음: 사이트 %q, 메일 %d자, 토큰 %d자(%s), 앞뒤 공백 %d자 제거", key.Site, len(key.Email), len(key.Token), form, raw-len(key.Site)-len(key.Email)-len(key.Token))
	}
	switch {
	case err == nil:
		if jerr := a.signIn(key.Site, key.Email, key.Token); jerr != nil {
			if errors.Is(jerr, jira.ErrUnauthorized) {
				var denied *jira.DeniedError
				if errors.As(jerr, &denied) {
					a.note("Jira가 거절하며 한 말: %s", denied.Reason)
				}
				a.mu.Lock()
				a.srv.needs = needJira
				a.authError = "서버에 등록한 Jira 토큰으로 로그인하지 못했습니다. 토큰이 만료되었는지 확인하고 서버에서 다시 등록해 주세요."
				a.mu.Unlock()
			} else {
				// Said on the start page, which is all there is to see before the
				// centre opens: Jira could not be reached from this computer.
				a.mu.Lock()
				a.srv.problem = fmt.Sprintf("Argus에서 Jira 토큰은 받았지만 Jira(%s)에 연결하지 못했습니다: %v", key.Site, jerr)
				a.mu.Unlock()
				a.emitError(jerr)
			}
			return
		}
		kept := secret.SaveToken(key.Site, key.Email, key.Token) // so the centre opens without the server next time
		if kept != nil {
			a.note("Jira 토큰을 자격 증명 저장소에 보관하지 못함: %v", kept)
		}
		a.mu.Lock()
		if kept != nil {
			a.srv.problem = fmt.Sprintf("Jira 토큰을 이 컴퓨터의 자격 증명 저장소에 보관하지 못했습니다(%v). 앱을 켤 때마다 Argus에서 다시 받아 옵니다.", kept)
		}
		a.prefs.Site, a.prefs.Email = key.Site, key.Email
		_ = secret.SavePrefs(a.prefs)
		if a.srv.needs == needJira {
			a.srv.needs = ""
		}
		me, avatar := a.me, a.prefs.Avatar
		a.mu.Unlock()
		if me != nil {
			var look *int
			if avatar > 0 {
				n := avatar - 1
				look = &n
			}
			err := c.SetMe(ctx, me.AccountID, look)
			if err != nil {
				a.note("Argus에 내 Jira 계정 알리기 실패: %v", err)
			}
			if errors.Is(err, argus.ErrConflict) {
				a.mu.Lock()
				a.srv.problem = "이 Jira 계정은 서버에 다른 사람의 것으로 등록되어 있습니다. 서버 관리자에게 알려 주세요."
				a.mu.Unlock()
			}
		}
	case errors.Is(err, argus.ErrNotFound):
		a.mu.Lock()
		if a.me == nil {
			a.srv.needs = needJira
		}
		a.mu.Unlock()
	case stop(err):
	default:
		a.mu.Lock()
		a.srv.problem = err.Error()
		a.mu.Unlock()
	}
}

// jiraRejected is called when Jira refuses the key in use. With a server the
// key may have been replaced there: it is fetched again, at most once a minute.
func (a *App) jiraRejected() {
	a.mu.Lock()
	ok := a.srv.client != nil && time.Since(a.srv.rejected) > time.Minute
	if ok {
		a.srv.rejected = time.Now()
	}
	a.mu.Unlock()
	if ok {
		go func() {
			a.syncServer(true)
			if a.app != nil {
				a.app.Event.Emit(evServer, a.State())
			}
		}()
	}
}

// serverTeam reads holidays and avatars from the server. ok is false when
// there is no server, so the caller uses what this computer knows.
func (a *App) serverTeam(ctx context.Context, me *jira.User) (away []game.Away, avatars map[string]int, ok bool) {
	a.mu.Lock()
	c, tag, team, cfg := a.srv.client, a.srv.teamTag, a.srv.team, a.cfg
	names := map[string]string{me.AccountID: me.DisplayName}
	if a.engine != nil {
		if snap := a.engine.Last(); snap != nil {
			for _, m := range snap.Members {
				names[m.ID] = m.Name
			}
		}
	}
	a.mu.Unlock()
	if c == nil {
		return nil, nil, false
	}
	if got, changed, err := c.Team(ctx, &tag); err == nil && changed {
		team = got
		a.mu.Lock()
		a.srv.team, a.srv.teamTag = got, tag
		a.mu.Unlock()
	}
	avatars = map[string]int{}
	if team == nil {
		return nil, avatars, true // not reachable yet: nobody is known to be away
	}
	for _, m := range team.Members {
		if m.Avatar != nil {
			avatars[m.JiraAccountID] = *m.Avatar
		}
	}
	for _, v := range team.Vacations {
		half := false
		if cfg != nil {
			if k, ok := cfg.VacationKind(v.Kind); ok {
				half = k.Half
			}
		}
		away = append(away, game.Away{ID: v.JiraAccountID, Name: names[v.JiraAccountID], From: v.From, To: v.To, Kind: v.Kind, Half: half, CoverID: v.Cover, Cover: shortName(names[v.Cover])})
	}
	return away, avatars, true
}

// ServerNotice is one thing the team server wants seen, as the screen shows it.
type ServerNotice struct {
	ID       int64  `json:"id"`
	Category string `json:"category"`
	Severity string `json:"severity"` // crit · warn · info · good
	Title    string `json:"title"`
	Target   string `json:"target"`
	URL      string `json:"url"` // the page on the server ("" = none)
	Changed  string `json:"changed"`
	Due      string `json:"due"`
}

// ServerFeed is the team server's state in brief.
type ServerFeed struct {
	Notices   []ServerNotice `json:"notices"`
	Total     int            `json:"total"`     // more than are listed when the server holds over a hundred
	System    string         `json:"system"`    // ok · warn · fail; "" = this user may not see it
	SystemURL string         `json:"systemUrl"` // the server's own status page
	AllURL    string         `json:"allUrl"`    // every notice, on the server
}

// ServerFeed returns what the team server last said about itself (nil without a server).
func (a *App) ServerFeed() *ServerFeed {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.srv.feed
}

// readFeed asks the server for its notices and tells the screen when they changed.
func (a *App) readFeed(ctx context.Context) {
	a.mu.Lock()
	c, tag := a.srv.client, a.srv.feedTag
	a.mu.Unlock()
	if c == nil {
		return
	}
	rctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	got, changed, err := c.Feed(rctx, &tag)
	if err != nil || !changed {
		return // the last one stays: a server that cannot be reached is shown elsewhere
	}
	base := c.Base()
	// A link is opened only when it is a page of the server itself.
	page := func(path string) string {
		if path == "" || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
			return ""
		}
		if u := base + path; argus.SameHost(base, u) {
			return u
		}
		return ""
	}
	out := &ServerFeed{Notices: []ServerNotice{}, Total: got.Total, AllURL: page("/notifications")}
	for _, n := range got.Notices {
		v := ServerNotice{ID: n.ID, Category: n.CategoryName, Severity: n.Severity, Title: n.Title, URL: page(n.Link), Changed: n.ChangedAt, Due: n.DueAt}
		if n.Target != nil {
			v.Target = strings.TrimSpace(n.Target.Account + " " + n.Target.Identifier)
		}
		out.Notices = append(out.Notices, v)
	}
	if got.System != nil {
		out.System, out.SystemURL = got.System.Status, page(got.System.Link)
	}
	a.mu.Lock()
	a.srv.feed, a.srv.feedTag = out, tag
	a.mu.Unlock()
	if a.app != nil {
		a.app.Event.Emit(evFeed, out)
	}
}
