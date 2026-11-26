package argus

import (
	"html"
	"net/http"
	"strings"
)

// The page the browser lands on after the sign-in. It is served from this
// computer and stands alone: no script, nothing loaded from anywhere.

const callbackCSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:24px;background:#edf0f4;color:#1f2a44;
 font:15px/1.6 -apple-system,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif}
main{width:min(420px,100%);padding:32px 32px 28px;border:1px solid #d8dee8;border-radius:16px;background:#fff;
 box-shadow:0 18px 48px rgba(31,42,68,.12);text-align:center}
svg{display:block;width:132px;height:auto;margin:0 auto 18px}
.brand{margin:0 0 14px;color:#667085;font-size:12px;font-weight:700;letter-spacing:.14em}
h1{margin:0 0 8px;font-size:21px;line-height:1.35}
p{margin:0;color:#475069}
.why{margin-top:14px;padding:10px 12px;border-radius:8px;background:#fbeceb;color:#a12a25;font-size:13px;overflow-wrap:anywhere}
.next{margin-top:18px;padding-top:16px;border-top:1px dashed #d8dee8;color:#667085;font-size:13px}
@media (prefers-color-scheme:dark){
 body{background:#141a29;color:#e7ebf3}
 main{border-color:#2c3650;background:#1c2437;box-shadow:none}
 p{color:#b4bdd0}.brand,.next{color:#8e99b0}.next{border-color:#2c3650}
 .why{background:#3a1f22;color:#ffb4ae}
}`

// A parcel drawn the way the centre draws its boxes: sealed and ticked off
// when the sign-in worked, open and flagged when it did not.
const callbackOK = `<svg viewBox="0 0 132 110" role="img" aria-label="봉인된 상자">
<ellipse cx="66" cy="96" rx="44" ry="8" fill="#1f2a44" opacity=".1"/>
<path d="M66 38 108 58 66 78 24 58Z" fill="#e7bd82"/>
<path d="M24 58 66 78V102L24 82Z" fill="#d9a866"/>
<path d="M108 58 66 78V102L108 82Z" fill="#c08f4f"/>
<path d="M59 41.3 101 61.3 87 68 45 48Z" fill="#f4dfbd"/>
<path d="M87 68 101 61.3V72L87 78.7Z" fill="#e3c594"/>
<path d="M32 66 50 74.6V88L32 79.4Z" fill="#fff"/>
<path d="M32 66 36 67.9V81.3L32 79.4Z" fill="#3b5bdb"/>
<circle cx="97" cy="27" r="19" fill="#2f9e63"/>
<path d="M88 27.5 94.5 34 106.5 21" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const callbackFail = `<svg viewBox="0 0 132 110" role="img" aria-label="열린 상자">
<ellipse cx="66" cy="96" rx="44" ry="8" fill="#1f2a44" opacity=".1"/>
<path d="M66 44 108 64 66 84 24 64Z" fill="#8a6a3c"/>
<path d="M24 64 66 84V102L24 82Z" fill="#d9a866"/>
<path d="M108 64 66 84V102L108 82Z" fill="#c08f4f"/>
<path d="M24 64 66 44 56 30 14 50Z" fill="#e7bd82"/>
<path d="M108 64 66 44 76 30 118 50Z" fill="#edcb98"/>
<circle cx="97" cy="24" r="19" fill="#c7352f"/>
<path d="M97 13.5V27" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>
<circle cx="97" cy="34" r="2.8" fill="#fff"/>
</svg>`

// callbackPage writes the page. why is empty when the sign-in worked;
// otherwise it says what went wrong, in plain words.
func callbackPage(w http.ResponseWriter, why string) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer") // the address holds the one-time code
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")

	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Argus Desk</title><style>`)
	b.WriteString(callbackCSS)
	b.WriteString(`</style></head><body><main>`)
	if why == "" {
		b.WriteString(callbackOK)
		b.WriteString(`<p class="brand">ARGUS DESK</p><h1>로그인했습니다</h1><p>송장을 확인했습니다. 센터 문이 열렸어요.</p><p class="next">이 창은 닫아도 됩니다. Argus Desk로 돌아가세요.</p>`)
	} else {
		b.WriteString(callbackFail)
		b.WriteString(`<p class="brand">ARGUS DESK</p><h1>로그인하지 못했습니다</h1><p class="why">`)
		b.WriteString(html.EscapeString(why))
		b.WriteString(`</p><p class="next">이 창을 닫고 Argus Desk에서 다시 시도해 주세요.</p>`)
	}
	b.WriteString(`</main></body></html>`)
	_, _ = w.Write([]byte(b.String()))
}

// refusal puts the server's reason for refusing a sign-in in plain words.
func refusal(code string) string {
	switch code {
	case "access_denied":
		return "이 계정으로는 ArgusDesk를 쓸 수 없습니다. ArgusDesk는 Argus 관리자만 쓸 수 있습니다."
	case "server_error", "temporarily_unavailable":
		return "Argus가 지금 로그인을 처리하지 못했습니다. 잠시 뒤에 다시 시도해 주세요."
	}
	return "로그인이 거부되었습니다: " + code
}
