package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// The weather outside the centre is the real one: the current weather of the
// team's city from Open-Meteo (free, no key, nothing but the coordinates is
// sent). When it cannot be reached the screen falls back to a weather made up
// by the season.

const evWeather = "weather:now" // *WeatherNow

// The team's city. Seoul for now.
const (
	weatherPlace = "서울"
	weatherLat   = 37.5665
	weatherLon   = 126.9780
	weatherEvery = 30 * time.Minute
)

// WeatherNow is the weather outside, as the screen draws it.
type WeatherNow struct {
	Kind  string  `json:"kind"`  // clear · cloudy · rain · snow · wind · leaves · blossom
	Temp  float64 `json:"temp"`  // °C
	Place string  `json:"place"` // the city it is for
	At    string  `json:"at"`    // when it was read (RFC 3339)
}

type weatherState struct {
	mu   sync.Mutex
	last *WeatherNow
}

var weatherHTTP = &http.Client{Timeout: 15 * time.Second}

// Weather is the last weather read ("" kind = none yet, or it could not be read).
func (a *App) Weather() *WeatherNow {
	a.wx.mu.Lock()
	defer a.wx.mu.Unlock()
	if a.wx.last == nil {
		return &WeatherNow{}
	}
	w := *a.wx.last
	return &w
}

// watchWeather reads the weather now and every half hour.
func (a *App) watchWeather(ctx context.Context) {
	read := func() {
		w, err := fetchWeather(ctx, weatherLat, weatherLon, time.Now())
		if err != nil {
			a.note("날씨를 읽지 못함(계절 날씨로 대신): %v", err)
			return
		}
		a.wx.mu.Lock()
		changed := a.wx.last == nil || a.wx.last.Kind != w.Kind || a.wx.last.Temp != w.Temp
		a.wx.last = w
		a.wx.mu.Unlock()
		if changed {
			a.app.Event.Emit(evWeather, w)
		}
	}
	read()
	t := time.NewTicker(weatherEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			read()
		}
	}
}

func fetchWeather(ctx context.Context, lat, lon float64, now time.Time) (*WeatherNow, error) {
	url := fmt.Sprintf("https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh&timezone=Asia%%2FSeoul", lat, lon)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := weatherHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	var out struct {
		Current struct {
			Temp float64 `json:"temperature_2m"`
			Code int     `json:"weather_code"`
			Wind float64 `json:"wind_speed_10m"`
		} `json:"current"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out); err != nil {
		return nil, err
	}
	return &WeatherNow{Kind: weatherKind(out.Current.Code, out.Current.Wind, now.Month()), Temp: out.Current.Temp, Place: weatherPlace, At: now.Format(time.RFC3339)}, nil
}

// weatherKind turns a WMO weather code and the wind into what the screen
// draws. Rain and snow come first; a strong wind blows on a dry day; a fair
// day in spring has blossom and in autumn falling leaves.
func weatherKind(code int, windKmh float64, month time.Month) string {
	switch {
	case code >= 71 && code <= 77, code == 85, code == 86:
		return "snow"
	case code >= 51 && code <= 67, code >= 80 && code <= 82, code >= 95:
		return "rain"
	case windKmh >= 25:
		return "wind"
	case code == 2 || code == 3 || code == 45 || code == 48:
		return "cloudy"
	case month == time.April:
		return "blossom"
	case month == time.October || month == time.November:
		return "leaves"
	}
	return "clear"
}
