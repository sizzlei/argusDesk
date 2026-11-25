package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sizzlei/argusDesk/internal/board"
	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/game"
	"github.com/sizzlei/argusDesk/internal/jira"
	"github.com/sizzlei/argusDesk/internal/model"
	"github.com/sizzlei/argusDesk/internal/secret"
	"github.com/sizzlei/argusDesk/internal/update"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Event names sent to the screen.
const (
	evSnapshot = "board:snapshot" // BoardEvent
	evError    = "board:error"    // BoardError
	evProgress = "update:progress"
	evGame     = "game:stats" // *game.Stats
)

// App is the service bound to the screen: every exported method can be
// called from the frontend as "main.App.<Method>".
type App struct {
	app *application.App

	mu          sync.Mutex
	prefs       *secret.Prefs
	cfg         *config.Config
	cfgError    string // why the chosen file could not be used ("" = fine)
	cfgFallback bool   // running on the last good copy instead of the chosen file
	client      *jira.Client
	me          *jira.User
	authError   string
	engine      *board.Engine
	stopPolling context.CancelFunc
	kick        chan struct{}

	notify notifier

	gameStats *game.Stats
	gameAt    time.Time // when the statistics were last read
	gameBusy  atomic.Bool

	updating atomic.Bool
	restart  func() error
}

// AppState is what the screen needs to decide which page to show.
type AppState struct {
	Version       string `json:"version"`
	ConfigPath    string `json:"configPath"`
	ConfigName    string `json:"configName"`
	ConfigVersion string `json:"configVersion"`
	ConfigError   string `json:"configError"`
	ConfigLoaded  bool   `json:"configLoaded"`
	UsingLastGood bool   `json:"usingLastGood"`
	Site          string `json:"site"`
	Email         string `json:"email"`
	SignedIn      bool   `json:"signedIn"`
	Me            string `json:"me"`
	AuthError     string `json:"authError"`
	PollSeconds   int    `json:"pollSeconds"`
	Notify        bool   `json:"notify"`        // the user wants notifications
	NotifyProblem string `json:"notifyProblem"` // why the system will not show them ("" = fine)
}

// BoardEvent carries a fresh snapshot and what changed since the last one.
type BoardEvent struct {
	Snapshot *model.Snapshot `json:"snapshot"`
	Changes  []model.Change  `json:"changes"`
}

// BoardError reports a failed refresh. Auth means the token must be entered again.
type BoardError struct {
	Message string `json:"message"`
	Auth    bool   `json:"auth"`
}

// ServiceStartup runs once when the application starts: it restores the
// settings file and the sign-in from the last run.
func (a *App) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	go update.Cleanup() // leftovers of the previous self-update
	a.notify.start(ctx, options)
	a.kick = make(chan struct{}, 1)
	a.prefs, _ = secret.LoadPrefs()
	if a.prefs.ConfigPath != "" {
		a.loadConfig(a.prefs.ConfigPath)
	}
	if a.prefs.Site != "" && a.prefs.Email != "" {
		if token, err := secret.LoadToken(a.prefs.Site, a.prefs.Email); err == nil {
			// Checked in the background so a slow network does not delay the window.
			go func() {
				if err := a.signIn(a.prefs.Site, a.prefs.Email, token); err != nil {
					a.emitError(err)
				}
			}()
		}
	}
	return nil
}

// ServiceShutdown stops the polling loop.
func (a *App) ServiceShutdown() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.stopPolling != nil {
		a.stopPolling()
	}
	return nil
}

// State reports where the app stands.
func (a *App) State() *AppState {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.stateLocked()
}

func (a *App) stateLocked() *AppState {
	s := &AppState{
		Version:       Version,
		ConfigPath:    a.prefs.ConfigPath,
		ConfigError:   a.cfgError,
		UsingLastGood: a.cfgFallback,
		Site:          a.prefs.Site,
		Email:         a.prefs.Email,
		AuthError:     a.authError,
		Notify:        !a.prefs.NotifyOff,
		NotifyProblem: a.notify.problem(),
	}
	if a.cfg != nil {
		s.ConfigLoaded, s.ConfigName, s.ConfigVersion, s.PollSeconds = true, a.cfg.Name, a.cfg.Version, a.cfg.PollSeconds
		if s.Site == "" {
			s.Site = a.cfg.Site
		}
	}
	if a.me != nil {
		s.SignedIn, s.Me = true, a.me.DisplayName
	}
	return s
}

// ---- settings file --------------------------------------------------------

// loadConfig reads the settings file. A file that loads becomes the "last
// good" copy; a file that does not leaves the app running on that copy and
// records why.
func (a *App) loadConfig(path string) {
	cfg, err := config.Load(path)
	a.mu.Lock()
	defer a.mu.Unlock()
	if err == nil {
		a.cfg, a.cfgError, a.cfgFallback = cfg, "", false
		if b, rerr := os.ReadFile(path); rerr == nil {
			if good, gerr := secret.LastGoodConfigPath(); gerr == nil {
				_ = os.WriteFile(good, b, 0o600)
			}
		}
		return
	}
	a.cfgError = err.Error()
	if good, gerr := secret.LastGoodConfigPath(); gerr == nil {
		if old, lerr := config.Load(good); lerr == nil {
			a.cfg, a.cfgFallback = old, true
			return
		}
	}
	a.cfg, a.cfgFallback = nil, false
}

// ChooseConfig asks for the settings file and remembers where it is. The
// file is read again from that place on every start.
func (a *App) ChooseConfig() (*AppState, error) {
	path, err := a.app.Dialog.OpenFile().
		SetTitle("argusDesk 설정 파일 선택").
		AddFilter("설정 파일 (*.yaml, *.yml)", "*.yaml;*.yml").
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if path == "" {
		return a.State(), nil // cancelled
	}
	a.mu.Lock()
	a.prefs.ConfigPath = path
	_ = secret.SavePrefs(a.prefs)
	a.mu.Unlock()
	return a.ReloadConfig()
}

// ReloadConfig reads the settings file again and restarts the refresh loop.
func (a *App) ReloadConfig() (*AppState, error) {
	a.mu.Lock()
	path := a.prefs.ConfigPath
	a.mu.Unlock()
	if path == "" {
		return nil, errors.New("설정 파일을 먼저 선택해 주세요")
	}
	a.loadConfig(path)
	a.startPolling()
	return a.State(), nil
}

// ---- sign-in --------------------------------------------------------------

// Login checks the token with Jira and, if it works, stores it in the
// operating system's credential store.
func (a *App) Login(site, email, token string) (*AppState, error) {
	site, email, token = strings.TrimSpace(site), strings.TrimSpace(email), strings.TrimSpace(token)
	if site == "" || email == "" || token == "" {
		return nil, errors.New("Jira 사이트 주소, 이메일, API 토큰을 모두 입력해 주세요")
	}
	if err := a.signIn(site, email, token); err != nil {
		return nil, err
	}
	if err := secret.SaveToken(site, email, token); err != nil {
		return nil, fmt.Errorf("토큰을 저장할 수 없습니다: %w", err)
	}
	a.mu.Lock()
	a.prefs.Site, a.prefs.Email = site, email
	_ = secret.SavePrefs(a.prefs)
	a.mu.Unlock()
	return a.State(), nil
}

func (a *App) signIn(site, email, token string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client := jira.New(site, email, token)
	me, err := client.Myself(ctx)
	if err != nil {
		if errors.Is(err, jira.ErrUnauthorized) {
			a.mu.Lock()
			a.authError = err.Error()
			a.mu.Unlock()
		}
		return err
	}
	a.mu.Lock()
	a.client, a.me, a.authError = client, me, ""
	a.mu.Unlock()
	a.startPolling()
	return nil
}

// Logout forgets the token.
func (a *App) Logout() (*AppState, error) {
	a.mu.Lock()
	if a.stopPolling != nil {
		a.stopPolling()
		a.stopPolling = nil
	}
	site, email := a.prefs.Site, a.prefs.Email
	a.client, a.me, a.engine = nil, nil, nil
	a.mu.Unlock()
	if err := secret.DeleteToken(site, email); err != nil {
		return nil, err
	}
	return a.State(), nil
}

// ---- the centre -----------------------------------------------------------

// Snapshot returns the last snapshot, or nil before the first refresh.
func (a *App) Snapshot() *model.Snapshot {
	a.mu.Lock()
	e := a.engine
	a.mu.Unlock()
	if e == nil {
		return nil
	}
	return e.Last()
}

// TicketDetail reads the description and comments of one ticket, when its
// box is opened. The content is passed to the screen and not kept.
func (a *App) TicketDetail(key string) (*jira.Detail, error) {
	a.mu.Lock()
	client := a.client
	a.mu.Unlock()
	if client == nil {
		return nil, errors.New("먼저 로그인해 주세요")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return client.Detail(ctx, key)
}

// ---- working on a ticket ----------------------------------------------------
//
// Every method below changes the ticket in Jira as the signed-in user, then
// asks for a refresh so the centre shows the result.

func (a *App) jira() (*jira.Client, *jira.User, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.client == nil || a.me == nil {
		return nil, nil, errors.New("먼저 로그인해 주세요")
	}
	return a.client, a.me, nil
}

// SetNotify turns operating system notifications on or off.
func (a *App) SetNotify(on bool) *AppState {
	a.mu.Lock()
	a.prefs.NotifyOff = !on
	_ = secret.SavePrefs(a.prefs)
	a.mu.Unlock()
	if on {
		a.notify.send([]board.Note{{Title: "ArgusDesk 알림이 켜졌습니다", Body: "새 상자와 내 상자의 이동을 알려 드립니다."}})
	}
	return a.State()
}

// write runs one change against Jira and refreshes the centre when it worked.
// The ticket is remembered so its change does not come back as a notification.
func (a *App) write(key string, fn func(ctx context.Context, c *jira.Client, me *jira.User) error) error {
	c, me, err := a.jira()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := fn(ctx, c, me); err != nil {
		return err
	}
	a.notify.touched(key)
	a.Refresh()
	return nil
}

// TicketActions lists what the signed-in user can do with a ticket now: its
// transitions and its pending approvals.
func (a *App) TicketActions(key string) (*jira.Actions, error) {
	c, _, err := a.jira()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	acts, err := c.Actions(ctx, key)
	if err != nil {
		return nil, err
	}
	// Say where each move leads in the centre, so the screen can tell an
	// approving move from a rejecting one.
	a.mu.Lock()
	cfg, engine := a.cfg, a.engine
	a.mu.Unlock()
	if cfg != nil && engine != nil {
		if snap := engine.Last(); snap != nil {
			for _, b := range snap.Boxes {
				if b.Key != key {
					continue
				}
				if sp := cfg.Space(b.Space); sp != nil {
					for i, t := range acts.Transitions {
						if z := sp.Zone(sp.StatusZones[t.ToID]); z != nil {
							acts.Transitions[i].ToKind = z.Kind
						}
					}
				}
				break
			}
		}
	}
	return acts, nil
}

// MoveTicket makes one of the ticket's transitions.
func (a *App) MoveTicket(key, transitionID string) error {
	return a.write(key, func(ctx context.Context, c *jira.Client, _ *jira.User) error {
		return c.DoTransition(ctx, key, transitionID)
	})
}

// AssignTicket gives the ticket to an account: "me" for the signed-in user,
// "" to leave it unassigned.
func (a *App) AssignTicket(key, accountID string) error {
	return a.write(key, func(ctx context.Context, c *jira.Client, me *jira.User) error {
		if accountID == "me" {
			accountID = me.AccountID
		}
		return c.Assign(ctx, key, accountID)
	})
}

// AnswerApproval approves or declines a pending approval.
func (a *App) AnswerApproval(key, approvalID string, approve bool) error {
	return a.write(key, func(ctx context.Context, c *jira.Client, _ *jira.User) error {
		return c.AnswerApproval(ctx, key, approvalID, approve)
	})
}

// AddComment writes a comment. mode is "internal" or "public" for a service
// desk request (public ones are shown to the requester) and "plain" elsewhere.
func (a *App) AddComment(key, text, mode string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("댓글 내용을 입력해 주세요")
	}
	return a.write(key, func(ctx context.Context, c *jira.Client, _ *jira.User) error {
		return c.AddComment(ctx, key, text, mode)
	})
}

// Refresh asks for a refresh now instead of waiting for the next tick.
func (a *App) Refresh() {
	select {
	case a.kick <- struct{}{}:
	default: // one is already queued
	}
}

// startPolling (re)starts the loop that reads Jira. It needs both a
// settings file and a sign-in; until then it does nothing.
func (a *App) startPolling() {
	a.mu.Lock()
	if a.stopPolling != nil {
		a.stopPolling()
		a.stopPolling = nil
	}
	if a.cfg == nil || a.client == nil || a.me == nil {
		a.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.stopPolling = cancel
	engine := board.NewEngine(a.cfg, a.client, a.me.AccountID)
	a.engine = engine
	a.gameAt = time.Time{} // read the statistics again for this sign-in and these settings
	every := a.cfg.Poll()
	a.mu.Unlock()

	go func() {
		for {
			wait := every
			rctx, done := context.WithTimeout(ctx, 2*time.Minute)
			snap, changes, err := engine.Refresh(rctx)
			done()
			var limited *jira.RateLimitError
			switch {
			case ctx.Err() != nil:
				return
			case err == nil:
				a.app.Event.Emit(evSnapshot, BoardEvent{Snapshot: snap, Changes: changes})
				a.mu.Lock()
				wanted := !a.prefs.NotifyOff
				a.mu.Unlock()
				if wanted {
					a.notify.send(board.Notes(snap, changes, a.notify.skip()))
				}
				a.refreshGame(ctx, snap, changes)
			case errors.Is(err, jira.ErrUnauthorized):
				a.mu.Lock()
				a.authError, a.me = err.Error(), nil
				a.mu.Unlock()
				a.emitError(err)
				return // wait for a new token
			case errors.As(err, &limited):
				a.emitError(err)
				if limited.RetryAfter > wait {
					wait = limited.RetryAfter
				}
			default:
				a.emitError(err)
			}
			select {
			case <-ctx.Done():
				return
			case <-a.kick:
			case <-time.After(wait):
			}
		}
	}()
}

// GameStats returns the season's statistics, or nil before they were read.
func (a *App) GameStats() *game.Stats {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.gameStats
}

// refreshGame reads the season's finished tickets again when something was
// finished just now, and otherwise every ten minutes. It runs beside the
// polling loop: the statistics are a heavier read and never hold it up.
func (a *App) refreshGame(ctx context.Context, snap *model.Snapshot, changes []model.Change) {
	a.mu.Lock()
	cfg, client, me, last := a.cfg, a.client, a.me, a.gameAt
	a.mu.Unlock()
	if cfg == nil || client == nil || me == nil {
		return
	}
	finished := false
	kinds := map[string]string{}
	for _, sp := range snap.Spaces {
		for _, z := range sp.Zones {
			kinds[z.ID] = z.Kind
		}
	}
	for _, c := range changes {
		if (c.Kind == "moved" && kinds[c.ToZone] == config.KindDone) || (c.Kind == "removed" && kinds[c.FromZone] == config.KindDone) {
			finished = true
		}
	}
	if !finished && time.Since(last) < 10*time.Minute {
		return
	}
	if !a.gameBusy.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer a.gameBusy.Store(false)
		rctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		defer cancel()
		now := time.Now().In(cfg.Location())
		since := cfg.Game.Season(now, cfg.Location())
		dones, err := board.Dones(rctx, cfg, client, since)
		if err != nil {
			return // the next round tries again; the centre itself is unaffected
		}
		stats := game.Compute(dones, me.AccountID, board.TypeNames(cfg), since, now)
		a.mu.Lock()
		a.gameStats, a.gameAt = stats, time.Now()
		a.mu.Unlock()
		a.app.Event.Emit(evGame, stats)
	}()
}

func (a *App) emitError(err error) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit(evError, BoardError{Message: err.Error(), Auth: errors.Is(err, jira.ErrUnauthorized)})
}

// ---- updates --------------------------------------------------------------

// UpdateInfo is the result of an update check.
type UpdateInfo struct {
	Current   string          `json:"current"`
	Available bool            `json:"available"`
	Supported bool            `json:"supported"` // this OS / build can update itself
	Release   *update.Release `json:"release"`
}

// CheckUpdate asks GitHub for the latest release and compares it with the
// running version.
func (a *App) CheckUpdate() (*UpdateInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	r, err := update.Latest(ctx)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.prefs.LastUpdateCheck = time.Now().UnixMilli()
	_ = secret.SavePrefs(a.prefs)
	a.mu.Unlock()
	return &UpdateInfo{
		Current:   Version,
		Available: update.Newer(r.Version, Version),
		Supported: update.Supported() && r.AssetURL != "",
		Release:   r,
	}, nil
}

// LastUpdateCheck is when CheckUpdate last succeeded (unix ms, 0 = never).
func (a *App) LastUpdateCheck() int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.prefs.LastUpdateCheck
}

// ReleaseNotes returns the release with the given tag ("v0.1.0").
func (a *App) ReleaseNotes(tag string) (*update.Release, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return update.ByTag(ctx, tag)
}

// NotesToShow returns the running version once after an update, so the
// screen can show its release notes; "" otherwise.
func (a *App) NotesToShow() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.prefs.NotesShownFor == Version {
		return ""
	}
	first := a.prefs.NotesShownFor == "" // a fresh install has nothing to announce
	a.prefs.NotesShownFor = Version
	_ = secret.SavePrefs(a.prefs)
	if first {
		return ""
	}
	return "v" + Version
}

// InstallUpdate downloads the release with the given tag and puts it in place
// of the running app. Progress is emitted as "update:progress" [done, total].
// The new version starts with RestartApp.
func (a *App) InstallUpdate(tag string) error {
	if !a.updating.CompareAndSwap(false, true) {
		return errors.New("이미 업데이트 중입니다")
	}
	defer a.updating.Store(false)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	r, err := update.ByTag(ctx, tag)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "argusdesk-update-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	var last time.Time
	zip, err := update.Download(ctx, r, dir, func(done, total int64) {
		if time.Since(last) > 100*time.Millisecond || done == total {
			last = time.Now()
			a.app.Event.Emit(evProgress, done, total)
		}
	})
	if err != nil {
		return err
	}
	restart, err := update.Install(zip)
	if err != nil {
		return err
	}
	a.restart = restart
	return nil
}

// RestartApp starts the installed update and quits this process. Nothing
// needs saving: ticket state lives only in memory and is read again from Jira.
func (a *App) RestartApp() error {
	if a.restart == nil {
		return errors.New("설치된 업데이트가 없습니다")
	}
	if err := a.restart(); err != nil {
		return fmt.Errorf("새 버전을 시작할 수 없습니다: %w", err)
	}
	a.app.Quit()
	return nil
}
