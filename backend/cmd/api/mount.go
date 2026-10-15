package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// mountOptions is what the generated mountTags (router.go) needs from the hand-written part of cmd/api.
type mountOptions struct {
	requestError   func(w http.ResponseWriter, r *http.Request, err error) // parameters and bodies the strict server rejects
	responseError  func(w http.ResponseWriter, r *http.Request, err error) // errors returned by a strict handler
	notImplemented func(r chi.Router, tag string)                          // mounts a tag without implementation (501)
}
