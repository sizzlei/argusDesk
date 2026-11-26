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
		if strings.Contains(body, "<script") {
			t.Errorf("%s: the page holds a script", name)
		}
		if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") {
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
