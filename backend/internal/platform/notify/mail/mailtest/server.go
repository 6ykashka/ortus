// Package mailtest is a fake SMTP server for the tests of the mail package and of its users (W1.41). It accepts
// messages on a loopback port, offers STARTTLS with a self-signed certificate when asked to, refuses a command on
// request, holds the answer to a command until released (a slow server), or stays silent after the connection is
// accepted (timeouts).
package mailtest

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"io"
	"math/big"
	"net"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

// Message is one message the server accepted.
type Message struct {
	From string   // envelope sender (MAIL FROM)
	To   []string // envelope recipients (RCPT TO)
	Data []byte   // the message as sent after DATA, dot-unstuffed
	TLS  bool     // the message came over STARTTLS
	Auth string   // the AUTH command line, if any
}

// Options configure the server.
type Options struct {
	StartTLS bool // offer STARTTLS with a self-signed certificate; Server.TLS trusts it
	Silent   bool // accept connections but never greet
}

// Server is a running fake SMTP server.
type Server struct {
	Host string      // 127.0.0.1
	Port int         // the listening port
	TLS  *tls.Config // a client configuration that trusts the certificate of the server

	opts    Options
	l       net.Listener
	srvTLS  *tls.Config
	mu      sync.Mutex
	msgs    []Message
	refuse  map[string]string
	holds   map[string]*hold
	arrived chan struct{}
	wg      sync.WaitGroup
	conns   map[net.Conn]struct{}
}

// Start runs a server on a free loopback port until the test ends.
func Start(tb testing.TB, opts Options) *Server {
	tb.Helper()
	var lc net.ListenConfig
	l, err := lc.Listen(tb.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		tb.Fatalf("mailtest: listen: %v", err)
	}
	addr, ok := l.Addr().(*net.TCPAddr)
	if !ok {
		tb.Fatalf("mailtest: address %v", l.Addr())
	}
	s := &Server{Host: "127.0.0.1", Port: addr.Port, opts: opts, l: l, refuse: map[string]string{}, holds: map[string]*hold{},
		arrived: make(chan struct{}, 64), conns: map[net.Conn]struct{}{}}
	if opts.StartTLS {
		s.srvTLS, s.TLS = certificate(tb)
	}
	s.wg.Go(s.serve)
	tb.Cleanup(s.close)
	return s
}

// Refuse makes the server answer every next command verb (MAIL, RCPT, DATA, AUTH, STARTTLS) with reply, such as
// "451 4.3.0 try again later"; an empty reply accepts the verb again.
func (s *Server) Refuse(verb, reply string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if reply == "" {
		delete(s.refuse, strings.ToUpper(verb))
		return
	}
	s.refuse[strings.ToUpper(verb)] = reply
}

// hold keeps the sessions that reach a verb waiting until it is released.
type hold struct {
	reached, released chan struct{}
	reach, release    sync.Once
}

// Hold makes every session that sends verb (MAIL, RCPT, DATA…) wait before the server answers it, until release is
// called (or the server stops): a slow SMTP server in the middle of a conversation. reached is closed when the
// first session waits there.
func (s *Server) Hold(verb string) (reached <-chan struct{}, release func()) {
	h := &hold{reached: make(chan struct{}), released: make(chan struct{})}
	s.mu.Lock()
	s.holds[strings.ToUpper(verb)] = h
	s.mu.Unlock()
	return h.reached, func() { h.release.Do(func() { close(h.released) }) }
}

// wait blocks the session at a held verb.
func (s *Server) wait(verb string) {
	s.mu.Lock()
	h := s.holds[verb]
	s.mu.Unlock()
	if h == nil {
		return
	}
	h.reach.Do(func() { close(h.reached) })
	<-h.released
}

// Messages returns the messages accepted so far.
func (s *Server) Messages() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Message(nil), s.msgs...)
}

// Wait returns the messages once at least n have arrived, or fails the test after 10 s.
func (s *Server) Wait(tb testing.TB, n int) []Message {
	tb.Helper()
	deadline := time.After(10 * time.Second)
	for {
		if msgs := s.Messages(); len(msgs) >= n {
			return msgs
		}
		select {
		case <-s.arrived:
		case <-deadline:
			tb.Fatalf("mailtest: %d messages, want %d", len(s.Messages()), n)
			return nil
		}
	}
}

func (s *Server) close() {
	_ = s.l.Close()
	s.mu.Lock()
	for _, h := range s.holds {
		h.release.Do(func() { close(h.released) })
	}
	for c := range s.conns {
		_ = c.Close()
	}
	s.mu.Unlock()
	s.wg.Wait()
}

func (s *Server) serve() {
	for {
		c, err := s.l.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		s.conns[c] = struct{}{}
		s.mu.Unlock()
		s.wg.Go(func() {
			defer func() {
				s.mu.Lock()
				delete(s.conns, c)
				s.mu.Unlock()
				_ = c.Close()
			}()
			if s.opts.Silent {
				_, _ = io.Copy(io.Discard, c)
				return
			}
			s.session(c)
		})
	}
}

// session is one SMTP conversation (RFC 5321, the subset net/smtp uses).
type session struct {
	s    *Server
	conn net.Conn
	tp   *textproto.Conn
	msg  Message
	tls  bool
	auth string
}

func (s *Server) session(c net.Conn) {
	ss := &session{s: s, conn: c, tp: textproto.NewConn(c)}
	if ss.reply("220 mailtest ESMTP") != nil {
		return
	}
	for {
		line, err := ss.tp.ReadLine()
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(line, " ")
		verb = strings.ToUpper(verb)
		s.wait(verb)
		if r, refused := s.refused(verb); refused {
			if ss.reply(r) != nil {
				return
			}
			continue
		}
		if done := ss.handle(verb, arg); done {
			return
		}
	}
}

func (s *Server) refused(verb string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.refuse[verb]
	return r, ok
}

func (ss *session) reply(line string) error { return ss.tp.PrintfLine("%s", line) }

// handle answers one command; done ends the session.
func (ss *session) handle(verb, arg string) (done bool) {
	var err error
	switch verb {
	case "EHLO":
		err = ss.ehlo()
	case "HELO", "NOOP":
		err = ss.reply("250 ok")
	case "STARTTLS":
		return ss.startTLS()
	case "AUTH":
		ss.auth = verb + " " + arg
		err = ss.reply("235 2.7.0 authenticated")
	case "MAIL":
		ss.msg = Message{From: path(arg, "FROM:"), TLS: ss.tls, Auth: ss.auth}
		err = ss.reply("250 ok")
	case "RCPT":
		ss.msg.To = append(ss.msg.To, path(arg, "TO:"))
		err = ss.reply("250 ok")
	case "DATA":
		err = ss.data()
	case "RSET":
		ss.msg = Message{}
		err = ss.reply("250 ok")
	case "QUIT":
		_ = ss.reply("221 bye")
		return true
	default:
		err = ss.reply("502 5.5.2 command not implemented")
	}
	return err != nil
}

// ehlo lists the extensions: STARTTLS only when offered and not on yet.
func (ss *session) ehlo() error {
	lines := []string{"250-mailtest", "250-8BITMIME", "250-AUTH PLAIN"}
	if ss.s.opts.StartTLS && !ss.tls {
		lines = append(lines, "250-STARTTLS")
	}
	for _, l := range append(lines, "250 SMTPUTF8") {
		if err := ss.reply(l); err != nil {
			return err
		}
	}
	return nil
}

func (ss *session) data() error {
	if ss.msg.From == "" || len(ss.msg.To) == 0 {
		return ss.reply("503 5.5.1 need MAIL and RCPT first")
	}
	if err := ss.reply("354 end with <CRLF>.<CRLF>"); err != nil {
		return err
	}
	b, err := ss.tp.ReadDotBytes()
	if err != nil {
		return err
	}
	ss.msg.Data = b
	ss.s.mu.Lock()
	ss.s.msgs = append(ss.s.msgs, ss.msg)
	ss.s.mu.Unlock()
	ss.msg = Message{}
	select {
	case ss.s.arrived <- struct{}{}:
	default:
	}
	return ss.reply("250 ok: queued")
}

func (ss *session) startTLS() (done bool) {
	if ss.s.srvTLS == nil || ss.tls {
		return ss.reply("502 5.5.1 STARTTLS not offered") != nil
	}
	if ss.reply("220 2.0.0 ready to start TLS") != nil {
		return true
	}
	tc := tls.Server(ss.conn, ss.s.srvTLS)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tc.HandshakeContext(ctx); err != nil {
		return true
	}
	ss.conn, ss.tls = tc, true
	ss.tp = textproto.NewConn(tc)
	ss.msg, ss.auth = Message{}, ""
	return false
}

// path reads the address of "FROM:<a@b> BODY=8BITMIME".
func path(arg, prefix string) string {
	arg = strings.TrimSpace(arg)
	if len(arg) >= len(prefix) && strings.EqualFold(arg[:len(prefix)], prefix) {
		arg = arg[len(prefix):]
	}
	addr, _, _ := strings.Cut(strings.TrimSpace(arg), " ")
	return strings.Trim(addr, "<>")
}

// certificate is a self-signed certificate of 127.0.0.1 and the client configuration that trusts it.
func certificate(tb testing.TB) (server, client *tls.Config) {
	tb.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		tb.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "mailtest"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)}, DNSNames: []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		tb.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		tb.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	server = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
	client = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool}
	return server, client
}
