// argusDesk shows a Jira service desk as a small fulfilment centre: tickets
// are boxes, statuses are zones.
package main

import (
	"embed"
	"log"
	"net/http"
	"strings"
	// Windows has no time zone list of its own: without this, "Asia/Seoul"
	// is unknown there and the settings are refused.
	_ "time/tzdata"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The built frontend (frontend/dist) is embedded into the binary.
//
//go:embed all:frontend/dist
var assets embed.FS

// The icon of the app. The bundle carries it too, but the operating system
// keeps icons it has seen: set from here, the Dock and the window show the
// current one whatever is cached.
//
//go:embed build/appicon.png
var appIcon []byte

// fresh keeps the page itself out of the webview's cache. The scripts and
// styles carry a hash of their content in their names and may be kept, but
// the page that names them must be asked for every time: otherwise a webview
// can show the screen of the version before an update, from its cache.
func fresh(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := r.URL.Path; p == "" || p == "/" || strings.HasSuffix(p, ".html") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	svc := &App{}
	app := application.New(application.Options{
		Name:        "ArgusDesk",
		Description: "Jira 서비스데스크를 상자와 구역으로 보여주는 데스크톱 앱",
		Icon:        appIcon,
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler: fresh(application.AssetFileServerFS(assets)),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	svc.app = app

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "ArgusDesk",
		Width:            1280,
		Height:           800,
		MinWidth:         960,
		MinHeight:        600,
		BackgroundColour: application.NewRGB(237, 240, 244),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
