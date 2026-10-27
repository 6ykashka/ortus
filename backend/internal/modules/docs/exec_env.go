package docs

import (
	"os"
	osexec "os/exec"
	"strings"
)

// Environment of the programs of the jobs (deploy/compose/.env.example): the path of a program; empty — the name is
// looked up in PATH; «-» — the program is off.
const (
	envOCRmyPDF = "DOCS_OCRMYPDF"
	envQpdf     = "DOCS_QPDF"
	envSoffice  = "DOCS_SOFFICE"
	envPdftoppm = "DOCS_PDFTOPPM"
	envTess     = "DOCS_TESSERACT"
	envWorkDir  = "DOCS_WORK_DIR"
)

// program is the path of a program: the value of the variable, the name found in PATH, or "" when it is off or absent.
func program(getenv func(string) string, key, name string) string {
	v := strings.TrimSpace(getenv(key))
	switch v {
	case "-":
		return ""
	case "":
		v = name
	}
	if p, err := osexec.LookPath(v); err == nil {
		return p
	}
	return ""
}

// ExecProcessorFromEnv is the processor of the jobs with the programs the environment names or PATH holds; nil when
// none of them is installed (the jobs then fail with the hint «Программы обработки не установлены»).
func ExecProcessorFromEnv(getenv func(string) string) *ExecProcessor {
	p := &ExecProcessor{
		OCRmyPDF: program(getenv, envOCRmyPDF, "ocrmypdf"), Qpdf: program(getenv, envQpdf, "qpdf"),
		Soffice: program(getenv, envSoffice, "soffice"), Pdftoppm: program(getenv, envPdftoppm, "pdftoppm"),
		Tesseract: program(getenv, envTess, "tesseract"), WorkDir: strings.TrimSpace(getenv(envWorkDir)),
	}
	if p.OCRmyPDF == "" && p.Qpdf == "" && p.Soffice == "" {
		return nil
	}
	if p.WorkDir != "" {
		_ = os.MkdirAll(p.WorkDir, 0o700)
	}
	return p
}
