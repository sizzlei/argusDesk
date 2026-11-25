// argusdesk-dump prints where every ticket would stand, as plain text, so
// the placement can be compared with Jira before any screen exists.
//
//	ARGUSDESK_TOKEN=... go run ./cmd/argusdesk-dump -config ~/dba-center.yaml -email me@example.com
//
// With -ticket it prints one ticket's forms, description and comments instead:
//
//	ARGUSDESK_TOKEN=... go run ./cmd/argusdesk-dump -config ... -email ... -ticket REQ-123
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/sizzlei/argusDesk/internal/board"
	"github.com/sizzlei/argusDesk/internal/config"
	"github.com/sizzlei/argusDesk/internal/jira"
)

func main() {
	path := flag.String("config", "", "설정 파일 경로")
	email := flag.String("email", "", "Jira 이메일")
	ticket := flag.String("ticket", "", "이 티켓의 양식, 설명, 댓글, 가능한 처리를 출력")
	flag.Parse()
	token := os.Getenv("ARGUSDESK_TOKEN")
	if *path == "" || *email == "" || token == "" {
		fmt.Fprintln(os.Stderr, "사용법: ARGUSDESK_TOKEN=<API 토큰> argusdesk-dump -config <설정 파일> -email <Jira 이메일>")
		os.Exit(2)
	}
	cfg, err := config.Load(*path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	client := jira.New(cfg.Site, *email, token)
	me, err := client.Myself(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *ticket != "" {
		printTicket(ctx, client, *ticket)
		return
	}
	snap, _, err := board.NewEngine(cfg, client, me.AccountID).Refresh(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	fmt.Printf("%s · 설정 %s · %s 님 · %s\n", snap.Name, snap.ConfigVersion, me.DisplayName, snap.FetchedAt.Format("2006-01-02 15:04"))
	for _, sp := range snap.Spaces {
		fmt.Printf("\n== %s ==\n", sp.Name)
		for _, z := range sp.Zones {
			fmt.Printf("\n[%s] %d건", z.Name, z.Count)
			if z.StaleCount > 0 {
				fmt.Printf(" (묵은 상자 %d건)", z.StaleCount)
			}
			fmt.Println()
			for _, b := range snap.Boxes {
				if b.Space != sp.ID || b.Zone != z.ID {
					continue
				}
				who := b.Assignee
				if who == "" {
					who = "미배정"
				}
				mark := ""
				switch {
				case b.Note != "":
					mark = "  · " + b.Note
				case b.Stale:
					mark = fmt.Sprintf("  · 묵음 %.1f배", b.StaleRatio)
				}
				fmt.Printf("  %-9s %-28s %-14s %-8s %s%s\n", b.Key, b.Type, b.Status, who, b.Summary, mark)
			}
		}
	}
	if len(snap.Warnings) > 0 {
		fmt.Println("\n경고:")
		for _, w := range snap.Warnings {
			fmt.Println("  -", w)
		}
	}
}

// printTicket shows what the panel would show for one ticket.
func printTicket(ctx context.Context, client *jira.Client, key string) {
	d, err := client.Detail(ctx, key)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(key)
	if d.FormsError != "" {
		fmt.Println("\n양식을 읽지 못했습니다:", d.FormsError)
	}
	for _, f := range d.Forms {
		state := "제출됨"
		if !f.Submitted {
			state = "작성 중"
		}
		fmt.Printf("\n[양식] %s (%s)\n", f.Name, state)
		for _, a := range f.Answers {
			fmt.Printf("  %s: %s\n", a.Label, a.Value)
		}
	}
	fmt.Printf("\n[설명] %d자 (HTML)\n[댓글] %d개\n[첨부] %d개\n", len(d.DescriptionHTML), len(d.Comments), d.Attachments)

	// What the panel would offer. Reading this changes nothing in Jira.
	a, err := client.Actions(ctx, key)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("\n[가능한 이동]")
	for _, t := range a.Transitions {
		note := ""
		if len(t.Needs) > 0 {
			note = fmt.Sprintf("  (Jira에서만 가능: 필수 입력 %v)", t.Needs)
		}
		fmt.Printf("  %s → %s%s\n", t.Name, t.ToName, note)
	}
	if a.ApprovalsError != "" {
		fmt.Println("\n승인 정보를 읽지 못했습니다:", a.ApprovalsError)
	}
	for _, ap := range a.Approvals {
		can := "내가 답할 수 없음"
		if ap.CanAnswer {
			can = "내가 승인/반려 가능"
		}
		fmt.Printf("\n[대기 중인 승인] %s (%s)\n", ap.Name, can)
		for _, p := range ap.Approvers {
			fmt.Printf("  %s: %s\n", p.Name, p.Decision)
		}
	}
}
