package idem

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// storedOutcome is the document in core.idempotency_keys.response_body. The body is kept as bytes (base64 in
// JSON): jsonb would reorder the keys of a JSON body, and a replay must return the original bytes.
type storedOutcome struct {
	Header http.Header `json:"header,omitempty"`
	Body   []byte      `json:"body,omitempty"`
}

func encodeOutcome(out Outcome) ([]byte, error) {
	h := http.Header{}
	for _, name := range storedHeaders {
		if v := out.Header.Values(name); len(v) > 0 {
			h[http.CanonicalHeaderKey(name)] = v
		}
	}
	doc, err := json.Marshal(storedOutcome{Header: h, Body: out.Body})
	if err != nil {
		return nil, fmt.Errorf("idem: encode outcome: %w", err)
	}
	return doc, nil
}

func decodeOutcome(status int, doc []byte) (Outcome, error) {
	var s storedOutcome
	if len(doc) > 0 {
		if err := json.Unmarshal(doc, &s); err != nil {
			return Outcome{}, fmt.Errorf("idem: decode outcome: %w", err)
		}
	}
	if s.Header == nil {
		s.Header = http.Header{}
	}
	return Outcome{Status: status, Header: s.Header, Body: s.Body}, nil
}
