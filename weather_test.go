package main

import (
	"testing"
	"time"
)

func TestWeatherKind(t *testing.T) {
	for _, c := range []struct {
		code  int
		wind  float64
		month time.Month
		want  string
	}{
		{0, 5, time.June, "clear"},
		{3, 5, time.June, "cloudy"},
		{61, 40, time.June, "rain"}, // rain wins over wind
		{95, 0, time.August, "rain"},
		{73, 0, time.January, "snow"},
		{86, 0, time.February, "snow"},
		{1, 30, time.March, "wind"},
		{0, 5, time.April, "blossom"},
		{1, 5, time.November, "leaves"},
		{45, 5, time.November, "cloudy"},
	} {
		if got := weatherKind(c.code, c.wind, c.month); got != c.want {
			t.Errorf("code %d wind %.0f %s: %s, want %s", c.code, c.wind, c.month, got, c.want)
		}
	}
}
