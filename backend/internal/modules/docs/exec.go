package docs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	osexec "os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Runner runs a program in dir without a shell and returns its output and exit code; err — the program did not start
// or did not end in time.
type Runner func(ctx context.Context, dir, name string, args ...string) (output []byte, exitCode int, err error)

// ExecProcessor runs the programs of the jobs (D-32 комплекта, the worker of documents): OCRmyPDF with Tesseract for
// the recognition and PDF/A, qpdf for the compression, the merge and the split, a headless office (LibreOffice) for the
// conversions. A program not installed (its path is empty) is ErrNoProcessor for its jobs. Arguments are fixed lists
// with the work files in a directory of their own; nothing is passed through a shell.
type ExecProcessor struct {
	OCRmyPDF, Qpdf, Soffice, Pdftoppm, Tesseract string
	WorkDir                                      string        // "" — the temporary directory
	Timeout                                      time.Duration // of one program; 0 — five minutes
	Exec                                         Runner        // nil — the real one
}

var _ Processor = (*ExecProcessor)(nil)

const (
	defaultJobTimeout = 5 * time.Minute
	maxOutput         = 1 << 20
	maxDoubtful       = 50
	doubtfulBelow     = 70.0 // Tesseract confidence (per cent) under which a word is doubtful
	qpdfEncrypted     = 2    // qpdf: an error (an encrypted file with a wrong password is one of them)
	ocrmypdfEncrypted = 8    // OCRmyPDF: the input file is encrypted
	ocrLang           = "rus+eng"
)

// realRunner runs a program with os/exec.
func realRunner(ctx context.Context, dir, name string, args ...string) ([]byte, int, error) {
	cmd := osexec.CommandContext(ctx, name, args...) //nolint:gosec // G204: the program is configured, the arguments are fixed lists
	cmd.Dir = dir
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &limitWriter{w: &buf, n: maxOutput}, &limitWriter{w: &buf, n: maxOutput}
	err := cmd.Run()
	if ee, ok := errors.AsType[*osexec.ExitError](err); ok {
		return buf.Bytes(), ee.ExitCode(), nil
	}
	return buf.Bytes(), 0, err
}

// limitWriter drops what is written past n bytes.
type limitWriter struct {
	w *bytes.Buffer
	n int
}

func (l *limitWriter) Write(p []byte) (int, error) {
	if room := l.n - l.w.Len(); room > 0 {
		l.w.Write(p[:min(room, len(p))])
	}
	return len(p), nil
}

func (p *ExecProcessor) run(ctx context.Context, dir, name string, args ...string) ([]byte, int, error) {
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = defaultJobTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if p.Exec != nil {
		return p.Exec(ctx, dir, name, args...)
	}
	return realRunner(ctx, dir, name, args...)
}

// Run implements Processor.
func (p *ExecProcessor) Run(ctx context.Context, in JobInput) (JobOutput, error) {
	if len(in.Inputs) == 0 {
		return JobOutput{}, errNoFile
	}
	var tool string
	switch in.Op {
	case opOCR, opPDFA:
		tool = p.OCRmyPDF
	case opCompress, opMerge, opSplit:
		tool = p.Qpdf
	case opToPDF, opToDocx, opToXlsx, opConvert:
		tool = p.Soffice
	default:
		return JobOutput{}, fmt.Errorf("docs: unknown job %q", in.Op)
	}
	if tool == "" {
		return JobOutput{}, ErrNoProcessor
	}
	dir, err := os.MkdirTemp(p.WorkDir, "docs-job-")
	if err != nil {
		return JobOutput{}, fmt.Errorf("docs: work directory: %w", err)
	}
	defer os.RemoveAll(dir)
	w := &work{p: p, dir: dir, in: in}
	if err := w.write(); err != nil {
		return JobOutput{}, err
	}
	switch in.Op {
	case opOCR:
		return w.ocr(ctx)
	case opPDFA:
		return w.pdfa(ctx)
	case opCompress:
		return w.compress(ctx)
	case opMerge:
		return w.merge(ctx)
	case opSplit:
		return w.split(ctx)
	}
	return w.office(ctx)
}

// work is the directory of one job with its inputs.
type work struct {
	p     *ExecProcessor
	dir   string
	in    JobInput
	names []string // the files of the inputs in dir
}

func (w *work) path(name string) string { return filepath.Join(w.dir, name) }

// write puts the inputs into the directory (in0.pdf, in1.pdf …) and the password into a file of its own.
func (w *work) write() error {
	for i, f := range w.in.Inputs {
		name := fmt.Sprintf("in%d.%s", i, extOf(f.ContentType))
		if err := os.WriteFile(w.path(name), f.Data, 0o600); err != nil {
			return fmt.Errorf("docs: work file: %w", err)
		}
		w.names = append(w.names, name)
	}
	if w.in.Password != "" {
		if err := os.WriteFile(w.path("password"), []byte(w.in.Password), 0o600); err != nil {
			return fmt.Errorf("docs: work file: %w", err)
		}
	}
	return nil
}

// passwordArg is the argument of qpdf with the password file; none without a password.
func (w *work) passwordArg() []string {
	if w.in.Password == "" {
		return nil
	}
	return []string{"--password-file=" + w.path("password")}
}

// extOf is the extension of the file of an input by its content type.
func extOf(contentType string) string {
	if ext := extensions[contentType]; ext != "" {
		return ext
	}
	return "bin"
}

// read reads the output file of a program.
func (w *work) read(name string) ([]byte, error) {
	b, err := os.ReadFile(w.path(name))
	if err != nil || len(b) == 0 {
		return nil, failed("Программа не вернула файл")
	}
	return b, nil
}

// qpdf runs qpdf; code 2 with «password» in its words is the password failure.
func (w *work) qpdf(ctx context.Context, args ...string) error {
	out, code, err := w.p.run(ctx, w.dir, w.p.Qpdf, args...)
	switch {
	case err != nil:
		return fmt.Errorf("docs: qpdf: %w", err)
	case code == qpdfEncrypted && strings.Contains(strings.ToLower(string(out)), "password"):
		return ErrPasswordProtected
	case code != 0 && code != 3: // 3 — warnings, the file is written
		return fmt.Errorf("docs: qpdf: exit %d", code)
	}
	return nil
}

func (w *work) compress(ctx context.Context) (JobOutput, error) {
	args := append(w.passwordArg(), "--recompress-flate", "--compression-level=9", "--object-streams=generate", w.path(w.names[0]), w.path("out.pdf"))
	if err := w.qpdf(ctx, args...); err != nil {
		return JobOutput{}, err
	}
	return w.single("out.pdf", w.in.Inputs[0].Name+".pdf", mimePDF)
}

// single is the output of a job with one file.
func (w *work) single(file, name, contentType string) (JobOutput, error) {
	b, err := w.read(file)
	if err != nil {
		return JobOutput{}, err
	}
	return JobOutput{Files: []JobFile{{Name: name, ContentType: contentType, Data: b}}}, nil
}

// locked reports whether a file wants a password (qpdf --requires-password: exit 0).
func (w *work) locked(ctx context.Context, name string) (bool, error) {
	_, code, err := w.p.run(ctx, w.dir, w.p.Qpdf, "--requires-password", w.path(name))
	if err != nil {
		return false, fmt.Errorf("docs: qpdf: %w", err)
	}
	return code == 0 && w.in.Password == "", nil
}

func (w *work) merge(ctx context.Context) (JobOutput, error) {
	drop, _ := w.in.Params["dropLocked"].(bool)
	var keep []string
	for _, n := range w.names {
		lock, err := w.locked(ctx, n)
		if err != nil {
			return JobOutput{}, err
		}
		switch {
		case lock && !drop:
			return JobOutput{}, ErrPasswordProtected
		case !lock:
			keep = append(keep, n)
		}
	}
	if len(keep) < 2 {
		return JobOutput{}, failed("Для объединения нужно хотя бы два файла без пароля")
	}
	args := append(w.passwordArg(), "--empty", "--pages")
	for _, n := range keep {
		args = append(args, w.path(n))
	}
	args = append(args, "--", w.path("out.pdf"))
	if err := w.qpdf(ctx, args...); err != nil {
		return JobOutput{}, err
	}
	return w.single("out.pdf", "merged.pdf", mimePDF)
}

var splitName = regexp.MustCompile(`^out-(\d+)\.pdf$`)

func (w *work) split(ctx context.Context) (JobOutput, error) {
	args := append(w.passwordArg(), w.path(w.names[0]), "--split-pages=1", w.path("out-%d.pdf"))
	if err := w.qpdf(ctx, args...); err != nil {
		return JobOutput{}, err
	}
	entries, err := os.ReadDir(w.dir)
	if err != nil {
		return JobOutput{}, fmt.Errorf("docs: work directory: %w", err)
	}
	type page struct {
		n    int
		name string
	}
	var pages []page
	for _, e := range entries {
		if m := splitName.FindStringSubmatch(e.Name()); m != nil {
			n, _ := strconv.Atoi(m[1])
			pages = append(pages, page{n, e.Name()})
		}
	}
	slices.SortFunc(pages, func(a, b page) int { return a.n - b.n })
	var out JobOutput
	for _, pg := range pages {
		b, err := w.read(pg.name)
		if err != nil {
			return JobOutput{}, err
		}
		out.Files = append(out.Files, JobFile{Name: fmt.Sprintf("%s-%d.pdf", w.in.Inputs[0].Name, pg.n), ContentType: mimePDF, Data: b})
	}
	if len(out.Files) == 0 {
		return JobOutput{}, failed("Программа не вернула файл")
	}
	return out, nil
}

// ocrmypdf runs OCRmyPDF; code 8 is an encrypted input.
func (w *work) ocrmypdf(ctx context.Context, extra ...string) error {
	args := slices.Concat(extra, []string{"--skip-text", w.path(w.names[0]), w.path("out.pdf")})
	_, code, err := w.p.run(ctx, w.dir, w.p.OCRmyPDF, args...)
	switch {
	case err != nil:
		return fmt.Errorf("docs: ocrmypdf: %w", err)
	case code == ocrmypdfEncrypted:
		return ErrPasswordProtected
	case code != 0:
		return fmt.Errorf("docs: ocrmypdf: exit %d", code)
	}
	return nil
}

func (w *work) pdfa(ctx context.Context) (JobOutput, error) {
	if err := w.ocrmypdf(ctx, "--output-type", "pdfa"); err != nil {
		return JobOutput{}, err
	}
	return w.single("out.pdf", w.in.Inputs[0].Name+" (PDF/A).pdf", mimePDF)
}

func (w *work) ocr(ctx context.Context) (JobOutput, error) {
	if err := w.ocrmypdf(ctx, "--language", ocrLang, "--output-type", "pdf"); err != nil {
		return JobOutput{}, err
	}
	out, err := w.single("out.pdf", w.in.Inputs[0].Name+".pdf", mimePDF)
	if err != nil {
		return out, err
	}
	out.Lang = ocrLang
	if w.p.Pdftoppm != "" && w.p.Tesseract != "" {
		out.Words, out.Confidence = w.doubtful(ctx)
	}
	return out, nil
}

// doubtful reads the words of the pages whose confidence is low: the pages are drawn (pdftoppm) and read again by
// Tesseract in the TSV form. A failure here only means no doubtful words are shown.
func (w *work) doubtful(ctx context.Context) ([]OCRWord, float64) {
	if _, code, err := w.p.run(ctx, w.dir, w.p.Pdftoppm, "-r", "150", "-png", w.path("out.pdf"), w.path("pg")); err != nil || code != 0 {
		return nil, 0
	}
	pages, _ := filepath.Glob(w.path("pg-*.png"))
	slices.Sort(pages)
	var words []OCRWord
	var sum float64
	var n int
	for i, pg := range pages {
		tsv, code, err := w.p.run(ctx, w.dir, w.p.Tesseract, pg, "stdout", "-l", ocrLang, "tsv")
		if err != nil || code != 0 {
			continue
		}
		ws, mean := parseTSV(string(tsv), doubtfulBelow, i+1)
		for _, x := range ws {
			if len(words) < maxDoubtful {
				x.ID = "w" + strconv.Itoa(len(words)+1)
				words = append(words, x)
			}
		}
		sum += mean
		n++
	}
	if n == 0 {
		return words, 0
	}
	return words, sum / float64(n)
}

// parseTSV reads the words of the TSV of Tesseract: the ones under the confidence below (per cent) with three letters
// or more are the doubtful ones; mean is the mean confidence of all words as a fraction. The row is the line of the page.
func parseTSV(tsv string, below float64, page int) ([]OCRWord, float64) {
	var words []OCRWord
	var sum float64
	var n int
	for i, line := range strings.Split(tsv, "\n") {
		cols := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if i == 0 || len(cols) < 12 || cols[0] != "5" || strings.TrimSpace(cols[11]) == "" {
			continue
		}
		conf, err := strconv.ParseFloat(cols[10], 64)
		if err != nil || conf < 0 {
			continue
		}
		sum += conf
		n++
		text := strings.TrimSpace(cols[11])
		if conf >= below || len([]rune(text)) < 3 {
			continue
		}
		row, _ := strconv.Atoi(cols[4])
		words = append(words, OCRWord{Row: row, Text: text, Confidence: conf / 100,
			Why: fmt.Sprintf("уверенность %d %%, страница %d", int(conf), page)})
	}
	if n == 0 {
		return words, 0
	}
	return words, sum / float64(n) / 100
}

// formats are the targets of the office by the operation.
var formats = map[string]string{opToPDF: "pdf", opToDocx: extDocx, opToXlsx: extXlsx}

// office converts the first input with the headless office to the format of the operation (or params.to).
func (w *work) office(ctx context.Context) (JobOutput, error) {
	to := formats[w.in.Op]
	if t, ok := w.in.Params["to"].(string); ok && w.in.Op == opConvert {
		to = t
	}
	if _, known := map[string]bool{"pdf": true, extDocx: true, extXlsx: true}[to]; !known {
		return JobOutput{}, failed("Неизвестный формат преобразования")
	}
	outDir := w.path("converted")
	if err := os.Mkdir(outDir, 0o700); err != nil {
		return JobOutput{}, fmt.Errorf("docs: work directory: %w", err)
	}
	_, code, err := w.p.run(ctx, w.dir, w.p.Soffice, "--headless", "--convert-to", to, "--outdir", outDir, w.path(w.names[0]))
	switch {
	case err != nil:
		return JobOutput{}, fmt.Errorf("docs: office: %w", err)
	case code != 0:
		return JobOutput{}, fmt.Errorf("docs: office: exit %d", code)
	}
	base := strings.TrimSuffix(w.names[0], filepath.Ext(w.names[0]))
	b, err := os.ReadFile(filepath.Join(outDir, base+"."+to)) //nolint:gosec // G304: the directory is ours, the name is built from a fixed list
	if err != nil || len(b) == 0 {
		return JobOutput{}, failed("Программа не вернула файл")
	}
	ct := map[string]string{"pdf": mimePDF, extDocx: jobTypes[opToDocx].mime, extXlsx: jobTypes[opToXlsx].mime}[to]
	return JobOutput{Files: []JobFile{{Name: w.in.Inputs[0].Name + "." + to, ContentType: ct, Data: b}}}, nil
}
