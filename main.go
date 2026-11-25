// argusDesk shows a Jira service desk as a small fulfilment centre: tickets
// are boxes, statuses are zones.
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The built frontend (frontend/dist) is embedded into the binary.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	svc := &App{}
	app := application.New(application.Options{
		Name:        "ArgusDesk",
		Description: "Jira 서비스데스크를 상자와 구역으로 보여주는 데스크톱 앱",
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
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
