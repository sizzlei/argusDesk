package update

import "strings"

// requirement picks the designated requirement out of what
// "codesign -d -r-" prints: the rule that says who signed an app. An app
// signed ad hoc is only tied to its own bytes (a "cdhash" rule), which says
// nothing about who made it: adhoc is true then, and for an unsigned app.
func requirement(codesignOutput string) (req string, adhoc bool) {
	for _, line := range strings.Split(codesignOutput, "\n") {
		line = strings.TrimPrefix(strings.TrimSpace(line), "# ")
		if rest, ok := strings.CutPrefix(line, "designated => "); ok {
			rest = strings.TrimSpace(rest)
			return rest, rest == "" || strings.Contains(rest, "cdhash")
		}
	}
	return "", true
}
