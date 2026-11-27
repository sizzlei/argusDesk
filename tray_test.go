package main

import (
	"testing"
	"time"

	"github.com/sizzlei/argusDesk/internal/model"
)

func TestDeploysToday(t *testing.T) {
	seoul, _ := time.LoadLocation("Asia/Seoul")
	now := time.Date(2026, 11, 27, 9, 0, 0, 0, seoul)
	snap := &model.Snapshot{
		Spaces: []model.SpaceView{{ID: "dt", Zones: []model.ZoneView{{ID: "work", Kind: "work"}, {ID: "done", Kind: "done"}}}},
		Boxes: []model.Box{
			{Key: "A-1", Space: "dt", Zone: "work", Mine: true, Deploy: "2026-11-27T18:00:00.000+0900"},
			{Key: "A-2", Space: "dt", Zone: "work", Deploy: "2026-11-27"},
			{Key: "A-3", Space: "dt", Zone: "done", Mine: true, Deploy: "2026-11-27"},                   // done: nothing left to deploy
			{Key: "A-4", Space: "dt", Zone: "work", Mine: true, Deploy: "2026-11-26T23:30:00.000+0900"}, // yesterday
			{Key: "A-5", Space: "dt", Zone: "work", Mine: true, Deploy: "2026-11-26T16:00:00.000Z"},     // 01:00 today in Seoul
			{Key: "A-6", Space: "dt", Zone: "work", Mine: true},
		},
	}
	mine, all := deploysToday(snap, now)
	if mine != 2 || all != 3 {
		t.Fatalf("mine=%d all=%d, want 2 and 3", mine, all)
	}
}
