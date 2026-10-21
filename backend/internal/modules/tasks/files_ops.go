package tasks

import (
	"context"
	"fmt"
	"mime"
	"strings"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the attachments (api.js:757–769 of the prototype, MSW tasks/index.ts).
const (
	textTooManyFiles = "К задаче можно прикрепить не больше 30 файлов"
	textUnknownFile  = "Файл не найден или загружен к другой задаче"
	textNotOwnFile   = "Удалить можно свой файл; чужие — руководитель проекта"
	fileNameMax      = 180
	// The upload of an attachment: purpose and owner of core.files (UploadCreate, W4.02).
	purposeAttachment = "task_attachment"
	ownerTask         = "tasks.task"
)

// decodeMIME splits the declared MIME type of files.objects into the content type and the display name (the «name»
// parameter, files.EncodeMIME).
func decodeMIME(stored string) (contentType, name string) {
	ct, params, err := mime.ParseMediaType(stored)
	if err != nil {
		return stored, ""
	}
	return ct, params["name"]
}

// upload is a completed upload of a file as attachTaskFiles checks it.
type upload struct {
	file       uuid.UUID
	state      string // files.objects.state
	purpose    string
	ownerType  string
	ownerID    uuid.UUID
	declared   string
	size       int64
	actor      uuid.UUID
	session    string
	attachedTo *uuid.UUID
}

func (r *request) uploadOf(ctx context.Context, id uuid.UUID) (*upload, error) {
	var u upload
	err := r.tx.QueryRow(ctx, `select f.id, f.state, f.purpose, f.owner_type, f.owner_id, f.declared_mime, coalesce(f.bytes, 0),
		s.actor_id, s.state, (select tf.task_id from tasks.task_files tf where tf.file_id = f.id)
		  from files.objects f join files.upload_sessions s on s.file_id = f.id where f.id = $1`, id).
		Scan(&u.file, &u.state, &u.purpose, &u.ownerType, &u.ownerID, &u.declared, &u.size, &u.actor, &u.session, &u.attachedTo)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("upload", err)
	}
	return &u, nil
}

// AttachFiles attaches uploaded files to a task (attachTaskFiles, addTaskFiles of the prototype): each an upload of
// this task completed by the requesting member (purpose task_attachment, owner tasks/task), not attached yet, within
// the limits of checkFiles — otherwise nothing is attached.
func (s *Service) AttachFiles(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b tasksapi.TaskFilesAttach) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
		t, p, err := r.visibleTask(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.needTask(ctx, p, t, actUpdate); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.Revision, staleTask); err != nil {
			return err
		}
		if len(b.FileIds) == 0 {
			return invalid("fileIds", "required", textRequired)
		}
		have, err := r.files(ctx, t.ID)
		if err != nil {
			return err
		}
		if len(have)+len(b.FileIds) > filesPerTask {
			return invalid("fileIds", "too_many", textTooManyFiles)
		}
		names, err := r.checkUploads(ctx, t, b.FileIds)
		if err != nil {
			return err
		}
		for _, f := range b.FileIds {
			if _, err := r.tx.Exec(ctx, `insert into tasks.task_files (task_id, file_id, attached_by, attached_at) values ($1, $2, $3, $4)`,
				t.ID, f, r.tc.PersonID, r.tick()); err != nil {
				return store("attach", err)
			}
		}
		if _, err := r.log(ctx, t.ID, "files", "прикрепил(а): "+strings.Join(names, ", "), r.meActor(), ""); err != nil {
			return err
		}
		return r.finish(ctx, p, t, &out, evFilesChanged)
	})
	return out, err
}

// checkUploads checks every file of attachTaskFiles and returns their names.
func (r *request) checkUploads(ctx context.Context, t *task, ids []uuid.UUID) ([]string, error) {
	names := make([]string, 0, len(ids))
	for i, id := range ids {
		at := fmt.Sprintf("fileIds[%d]", i)
		u, err := r.uploadOf(ctx, id)
		if err != nil {
			return nil, err
		}
		ok := u != nil && u.session == "completed" && u.state != "rejected" && u.purpose == purposeAttachment &&
			u.ownerType == ownerTask && u.ownerID == t.ID && u.actor == r.tc.PersonID && u.attachedTo == nil &&
			!containsID(ids[:i], id)
		if !ok {
			return nil, invalid(at, "unknown", textUnknownFile)
		}
		contentType, name := decodeMIME(u.declared)
		if why := fileRefusal(u.size, contentType); why != "" {
			return nil, invalid(at, "rejected", "Файл «"+name+"» не принят: "+why)
		}
		names = append(names, clip(name, fileNameMax))
	}
	return names, nil
}

// RemoveFile removes an attachment (removeTaskFile): the uploader with tasks.update removes his file, the project
// manager (tasks.projects.manage in the project) any file; a missing attachment — 404 «Файл уже удалён». The order of
// the checks is that of MSW: If-Match, then the attachment, then the right (Q-W4.11-7).
func (s *Service) RemoveFile(ctx context.Context, tc tenantctx.TenantContext, id, fileID uuid.UUID, ifMatch string) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
		t, p, err := r.visibleTask(ctx, id, true)
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.Revision, staleTask); err != nil {
			return err
		}
		f, err := r.attachment(ctx, t, fileID)
		if err != nil {
			return err
		}
		if err := r.mayRemove(ctx, p, t, f); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `delete from tasks.task_files where task_id = $1 and file_id = $2`, t.ID, fileID); err != nil {
			return store("remove file", err)
		}
		if _, err := r.log(ctx, t.ID, "files", "удалил(а) файл "+clip(f.Name, fileNameMax), r.meActor(), ""); err != nil {
			return err
		}
		return r.finish(ctx, p, t, &out, evFilesChanged)
	})
	return out, err
}

// attachment is the attachment fileID of t (404 «Файл уже удалён» when there is none).
func (r *request) attachment(ctx context.Context, t *task, fileID uuid.UUID) (*attachment, error) {
	files, err := r.files(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	for i := range files {
		if files[i].File == fileID {
			return &files[i], nil
		}
	}
	return nil, notFound(textFileGone)
}

// mayRemove requires the uploader with tasks.update on t or the manager of the project (tasks.projects.manage).
func (r *request) mayRemove(ctx context.Context, p *project, t *task, f *attachment) error {
	if f.By == r.tc.PersonID {
		own, err := r.canTask(ctx, p, t, actUpdate)
		if err != nil || own {
			return err
		}
	}
	a, err := r.access(ctx, p)
	if err != nil {
		return err
	}
	if !a.has(actProjectsManage) {
		return forbidden(textNotOwnFile)
	}
	return nil
}
