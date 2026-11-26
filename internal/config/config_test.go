package config

import (
	"strings"
	"testing"
	"time"
)

func TestExampleLoads(t *testing.T) {
	c, err := Load("../../config/example.yaml")
	if err != nil {
		t.Fatal(err)
	}
	sp := c.Space("requests")
	if sp == nil || len(sp.Zones) != 6 {
		t.Fatalf("zones: %+v", sp)
	}
	if got := sp.Zone("work").Stale.Limit(); got != 5*24*time.Hour {
		t.Errorf("work limit = %v", got)
	}
	if c.Poll() != time.Minute || c.Location().String() != "Asia/Seoul" {
		t.Errorf("poll %v, zone %v", c.Poll(), c.Location())
	}
	names := strings.Join(c.FieldNames(), ",")
	if !strings.Contains(names, "작업 완료 요청일시") || !strings.Contains(names, "배포 일정 확정") || strings.Contains(names, "created") {
		t.Errorf("field names = %s", names)
	}
}

func TestProblemsAreAllReported(t *testing.T) {
	_, err := Parse([]byte(`
site: x.atlassian.net
spaces:
  - id: a
    project: A
    zones:
      - { id: z1, name: one, kind: nope }
      - { id: z2, name: two, kind: work, stale: { after: soon, from: zone_entered } }
    status_zones: { "1": z1, "2": gone }
    workflows:
      w: { start: "9", paths: { "1": ["2"] } }
    types:
      T: { workflow: missing }
`))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"kind는", "기간은", "없는 구역", `상태 "9"`, "없는 워크플로우"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %q:\n%v", want, err)
		}
	}
}

func TestUnknownKeyIsAnError(t *testing.T) {
	_, err := Parse([]byte("site: x\nspacez: []\n"))
	if err == nil || !strings.Contains(err.Error(), "spacez") {
		t.Fatalf("want an error naming the key, got %v", err)
	}
}

func TestParseDuration(t *testing.T) {
	for in, want := range map[string]time.Duration{"30m": 30 * time.Minute, "3h": 3 * time.Hour, "5d": 120 * time.Hour} {
		if got, err := ParseDuration(in); err != nil || got != want {
			t.Errorf("%s = %v, %v", in, got, err)
		}
	}
	if _, err := ParseDuration("3 hours"); err == nil {
		t.Error("want an error")
	}
}

func TestVacationKinds(t *testing.T) {
	c, err := Load("../../config/example.yaml")
	if err != nil {
		t.Fatal(err)
	}
	kinds := c.VacationKinds()
	if len(kinds) != 3 || kinds[0].Name != "연차" || kinds[0].Half || !kinds[1].Half || kinds[2].Name != "오후반차" {
		t.Fatalf("built-in kinds: %+v", kinds)
	}
	// the team's own come after; one with a built-in name replaces it
	c.Vacation.Kinds = []VacationKind{{Name: "리프레시"}, {Name: "오전반반차", Half: true}, {Name: "연차", Half: true}}
	kinds = c.VacationKinds()
	if len(kinds) != 5 || kinds[3].Name != "리프레시" || !kinds[4].Half || !kinds[0].Half {
		t.Fatalf("with the team's kinds: %+v", kinds)
	}
	if k, ok := c.VacationKind("오전반반차"); !ok || !k.Half {
		t.Errorf("lookup: %+v %v", k, ok)
	}
	if _, ok := c.VacationKind("없는구분"); ok {
		t.Error("an unknown kind was found")
	}
}
