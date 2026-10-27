package files_test

import (
	"bytes"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
)

// W7.11, return 1: the parents of the chats are valid kinds; the attachments come only to «chat/chat» and the files of an
// export only to «chat/export»; the checks of an upload take the purpose chat_attachment with the media of a chat.
func TestChatParents(t *testing.T) {
	t.Parallel()
	p, err := files.NewParents(append(files.FleetParents(), files.ChatParents()...)...)
	if err != nil {
		t.Fatal(err)
	}
	for _, entity := range []string{files.ChatEntity, files.ChatExport} {
		k, ok := p.Kind(files.ChatModule, entity)
		if !ok || !k.Allows(files.PurposeChatAttachment) || k.Allows(files.PurposeTaskAttachment) {
			t.Errorf("chat/%s: %+v %v", entity, k, ok)
		}
	}
}

func TestValidateChatUpload(t *testing.T) {
	t.Parallel()
	for _, ct := range []string{"application/pdf", "image/jpeg", "video/mp4", "audio/ogg", "text/plain"} {
		u := files.Upload{FileName: "Файл", ContentType: ct, SizeBytes: 10, SHA256: sha, Purpose: files.PurposeChatAttachment,
			Owner: files.Ref{Module: "chat", Entity: "chat", ID: uuid.New()}}
		if err := files.ValidateUpload(u); err != nil {
			t.Errorf("%s: %v", ct, err)
		}
	}
	bad := files.Upload{FileName: "Файл", ContentType: "application/x-msdownload", SizeBytes: 10, SHA256: sha, Purpose: files.PurposeChatAttachment,
		Owner: files.Ref{Module: "chat", Entity: "chat", ID: uuid.New()}}
	if err := files.ValidateUpload(bad); err == nil {
		t.Error("an executable is accepted as an attachment of a chat")
	}
}

// The scanner takes the media of a chat by what they are: an MP4 by its ftyp box, an MP3 by its frame; a document that claims
// to be a video is a mime_mismatch.
func TestScanChatMedia(t *testing.T) {
	t.Parallel()
	mp4 := append([]byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0}, bytes.Repeat([]byte{0}, 64)...)
	v, err := files.BasicScanner{}.Scan(t.Context(), bytes.NewReader(mp4), "video/mp4")
	if err != nil || !v.Clean {
		t.Errorf("mp4: %+v %v", v, err)
	}
	v, err = files.BasicScanner{}.Scan(t.Context(), bytes.NewReader([]byte("%PDF-1.4\n")), "video/mp4")
	if err != nil || v.Clean || v.Code != files.CodeMIMEMismatch {
		t.Errorf("a PDF as a video: %+v %v", v, err)
	}
}
