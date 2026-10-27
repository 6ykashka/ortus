package docs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// call is a run of a program the fake runner saw.
type call struct {
	name string
	args []string
}

// fakeRunner stands for the programs: it records the calls and runs script, which may write the outputs.
type fakeRunner struct {
	calls  []call
	script func(c call) (out string, code int, err error)
}

func (f *fakeRunner) run(_ context.Context, _ string, name string, args ...string) ([]byte, int, error) {
	c := call{name: name, args: args}
	f.calls = append(f.calls, c)
	if f.script == nil {
		return nil, 0, nil
	}
	out, code, err := f.script(c)
	return []byte(out), code, err
}

// arg returns the value after flag in args, "" if none.
func arg(args []string, flag string) string {
	if i := slices.Index(args, flag); i >= 0 && i+1 < len(args) {
		return args[i+1]
	}
	return ""
}

func newExec(f *fakeRunner) *ExecProcessor {
	return &ExecProcessor{OCRmyPDF: "ocrmypdf", Qpdf: "qpdf", Soffice: "soffice", Pdftoppm: "pdftoppm", Tesseract: "tesseract",
		WorkDir: os.TempDir(), Exec: f.run}
}

// writeOut writes data to the last argument of a call (the output file of the programs).
func writeOut(args []string, data string) {
	_ = os.WriteFile(args[len(args)-1], []byte(data), 0o600)
}

func TestExecWithoutPrograms(t *testing.T) {
	t.Parallel()
	p := &ExecProcessor{WorkDir: t.TempDir()}
	for _, op := range []string{opOCR, opCompress, opMerge, opSplit, opPDFA, opToPDF, opToDocx, opToXlsx, opConvert} {
		_, err := p.Run(t.Context(), JobInput{Op: op, Inputs: []JobFile{{Name: "a", ContentType: mimePDF, Data: []byte("x")}}})
		if !errors.Is(err, ErrNoProcessor) {
			t.Errorf("%s without programs: %v, want ErrNoProcessor", op, err)
		}
	}
}

func TestExecCompress(t *testing.T) {
	t.Parallel()
	f := &fakeRunner{script: func(c call) (string, int, error) {
		writeOut(c.args, "small")
		return "", 0, nil
	}}
	out, err := newExec(f).Run(t.Context(), JobInput{Op: opCompress, Inputs: []JobFile{{Name: "a", ContentType: mimePDF, Data: []byte("big pdf")}}})
	if err != nil || len(out.Files) != 1 || string(out.Files[0].Data) != "small" {
		t.Fatalf("compress: %v %+v", err, out)
	}
	if len(f.calls) != 1 || f.calls[0].name != "qpdf" || !slices.Contains(f.calls[0].args, "--recompress-flate") {
		t.Fatalf("calls %+v, want qpdf with recompression", f.calls)
	}
	for _, a := range f.calls[0].args {
		if strings.ContainsAny(a, ";|&$`") {
			t.Errorf("argument %q looks like a shell", a)
		}
	}
}

func TestExecPasswordProtected(t *testing.T) {
	t.Parallel()
	f := &fakeRunner{script: func(call) (string, int, error) { return "qpdf: a.pdf: invalid password", 2, nil }}
	_, err := newExec(f).Run(t.Context(), JobInput{Op: opCompress, Inputs: []JobFile{{Name: "a", ContentType: mimePDF, Data: []byte("x")}}})
	if !errors.Is(err, ErrPasswordProtected) {
		t.Fatalf("compress: %v, want ErrPasswordProtected", err)
	}
	// the password is given to the program, not kept: it appears in the arguments of this run only
	var seen []string
	var inFile string
	f = &fakeRunner{script: func(c call) (string, int, error) {
		seen = c.args
		for _, a := range c.args {
			if p, ok := strings.CutPrefix(a, "--password-file="); ok {
				b, _ := os.ReadFile(p) //nolint:gosec // G304: the path is the work file the processor made
				inFile = string(b)
			}
		}
		writeOut(c.args, "ok")
		return "", 0, nil
	}}
	if _, err := newExec(f).Run(t.Context(), JobInput{Op: opCompress, Password: "s3cret", Inputs: []JobFile{{Name: "a", ContentType: mimePDF, Data: []byte("x")}}}); err != nil {
		t.Fatal(err)
	}
	if inFile != "s3cret" {
		t.Fatalf("password file %q, want the password", inFile)
	}
	for _, a := range seen {
		if strings.Contains(a, "s3cret") {
			t.Fatalf("argument %q shows the password in the list of processes", a)
		}
	}
}

func TestExecMergeDropsLockedFiles(t *testing.T) {
	t.Parallel()
	f := &fakeRunner{script: func(c call) (string, int, error) {
		if slices.Contains(c.args, "--requires-password") {
			if strings.HasSuffix(c.args[len(c.args)-1], "in1.pdf") {
				return "", 0, nil // exit 0: this file wants a password
			}
			return "", 2, nil
		}
		writeOut(c.args, "merged")
		return "", 0, nil
	}}
	in := JobInput{Op: opMerge, Params: map[string]any{"dropLocked": true}, Inputs: []JobFile{
		{Name: "a", ContentType: mimePDF, Data: []byte("a")}, {Name: "b", ContentType: mimePDF, Data: []byte("b")}, {Name: "c", ContentType: mimePDF, Data: []byte("c")}}}
	out, err := newExec(f).Run(t.Context(), in)
	if err != nil || len(out.Files) != 1 || string(out.Files[0].Data) != "merged" {
		t.Fatalf("merge: %v %+v", err, out)
	}
	last := f.calls[len(f.calls)-1]
	pages := 0
	for _, a := range last.args {
		if base := filepath.Base(a); strings.HasPrefix(base, "in") && strings.HasSuffix(base, ".pdf") {
			pages++
		}
	}
	if pages != 2 {
		t.Fatalf("merged %d files (%v), want the two that are not locked", pages, last.args)
	}
	// without dropLocked a locked file is the password failure
	in.Params = nil
	if _, err := newExec(f).Run(t.Context(), in); !errors.Is(err, ErrPasswordProtected) {
		t.Fatalf("merge with a locked file: %v, want ErrPasswordProtected", err)
	}
}

func TestExecSplitCollectsPages(t *testing.T) {
	t.Parallel()
	f := &fakeRunner{script: func(c call) (string, int, error) {
		out := c.args[len(c.args)-1] // out-%d.pdf
		dir := filepath.Dir(out)
		_ = os.WriteFile(filepath.Join(dir, "out-1.pdf"), []byte("p1"), 0o600)
		_ = os.WriteFile(filepath.Join(dir, "out-2.pdf"), []byte("p2"), 0o600)
		_ = os.WriteFile(filepath.Join(dir, "out-10.pdf"), []byte("p10"), 0o600)
		return "", 0, nil
	}}
	out, err := newExec(f).Run(t.Context(), JobInput{Op: opSplit, Inputs: []JobFile{{Name: "a", ContentType: mimePDF, Data: []byte("x")}}})
	if err != nil || len(out.Files) != 3 || string(out.Files[0].Data) != "p1" || string(out.Files[1].Data) != "p2" || string(out.Files[2].Data) != "p10" {
		t.Fatalf("split: %v %+v, want the pages in the order of numbers", err, out.Files)
	}
}

func TestExecConvertByOffice(t *testing.T) {
	t.Parallel()
	f := &fakeRunner{script: func(c call) (string, int, error) {
		dir := arg(c.args, "--outdir")
		_ = os.WriteFile(filepath.Join(dir, "in0.pdf"), []byte("converted"), 0o600)
		return "", 0, nil
	}}
	out, err := newExec(f).Run(t.Context(), JobInput{Op: opToPDF, Inputs: []JobFile{{Name: "t", ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Data: []byte("docx")}}})
	if err != nil || len(out.Files) != 1 || string(out.Files[0].Data) != "converted" {
		t.Fatalf("to_pdf: %v %+v", err, out)
	}
	if got := arg(f.calls[0].args, "--convert-to"); got != "pdf" {
		t.Fatalf("convert-to %q, want pdf", got)
	}
}

// The words under the confidence of the recognition become the doubtful ones (Tesseract TSV).
func TestParseTSV(t *testing.T) {
	t.Parallel()
	tsv := "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
		"5\t1\t1\t1\t1\t1\t10\t10\t50\t12\t96.5\tНакладная\n" +
		"5\t1\t1\t1\t1\t2\t70\t10\t50\t12\t58.2\tСкпадская\n" +
		"5\t1\t1\t1\t2\t1\t10\t30\t20\t12\t40\ta\n" +
		"5\t1\t1\t1\t2\t2\t40\t30\t50\t12\t-1\t\n" +
		"4\t1\t1\t1\t2\t0\t0\t0\t0\t0\t-1\t\n" +
		"5\t1\t1\t1\t3\t1\t10\t50\t50\t12\t69.9\tИтого\n"
	words, mean := parseTSV(tsv, 70, 1)
	if len(words) != 2 || words[0].Text != "Скпадская" || words[1].Text != "Итого" {
		t.Fatalf("words %+v, want the two doubtful words of three letters and more", words)
	}
	if words[0].Row != 1 || words[0].Confidence < 0.58 || words[0].Confidence > 0.59 || !strings.Contains(words[0].Why, "58") {
		t.Fatalf("word %+v", words[0])
	}
	if mean < 0.5 || mean > 0.9 {
		t.Fatalf("mean %v", mean)
	}
	if w, _ := parseTSV("garbage", 70, 1); len(w) != 0 {
		t.Fatalf("garbage gave %+v", w)
	}
}

func TestExecOCRWords(t *testing.T) {
	t.Parallel()
	tsv := "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t1\t1\t1\t1\t55\tСкпадская\n"
	f := &fakeRunner{script: func(c call) (string, int, error) {
		switch c.name {
		case "ocrmypdf":
			writeOut(c.args, "searchable")
		case "pdftoppm":
			dir := filepath.Dir(c.args[len(c.args)-1])
			_ = os.WriteFile(filepath.Join(dir, "pg-1.png"), []byte("png"), 0o600)
		case "tesseract":
			return tsv, 0, nil
		}
		return "", 0, nil
	}}
	out, err := newExec(f).Run(t.Context(), JobInput{Op: opOCR, Inputs: []JobFile{{Name: "scan", ContentType: mimePDF, Data: []byte("x")}}})
	if err != nil || len(out.Files) != 1 || string(out.Files[0].Data) != "searchable" || len(out.Words) != 1 || out.Words[0].ID != "w1" || out.Lang == "" {
		t.Fatalf("ocr: %v %+v", err, out)
	}
	if !slices.Contains(f.calls[0].args, "--skip-text") {
		t.Fatalf("ocrmypdf args %v, want --skip-text (a page with text is kept)", f.calls[0].args)
	}
}
