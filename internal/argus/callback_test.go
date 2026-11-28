package argus

import (
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCallbackPage(t *testing.T) {
	for name, why := range map[string]string{"ok": "", "fail": refusal("access_denied"), "odd": `<script>alert(1)</script>`} {
		rec := httptest.NewRecorder()
		callbackPage(rec, why)
		body := rec.Body.String()
		// Only the signed-in page has a script: the one that closes the tab,
		// allowed by the nonce in the policy. A reason from the server never becomes one.
		csp := rec.Header().Get("Content-Security-Policy")
		if why != "" && strings.Contains(body, "<script") {
			t.Errorf("%s: the page holds a script", name)
		}
		if why == "" {
			i := strings.Index(csp, "'nonce-")
			if i < 0 || !strings.Contains(body, `<script nonce="`+csp[i+7:i+7+32]+`">`) || !strings.Contains(body, "window.close()") || strings.Count(body, "<script") != 1 {
				t.Errorf("%s: the closing script and its nonce: %q", name, csp)
			}
		}
		if !strings.Contains(csp, "default-src 'none'") {
			t.Errorf("%s: policy %q", name, csp)
		}
		if (why == "") != strings.Contains(body, "로그인했습니다") {
			t.Errorf("%s: wrong page", name)
		}
		if dir := os.Getenv("CALLBACK_PREVIEW"); dir != "" {
			_ = os.WriteFile(dir+"/"+name+".html", []byte(body), 0o600)
		}
	}
}
