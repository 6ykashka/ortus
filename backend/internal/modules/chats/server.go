//nolint:dupl // one method per operation of the strict server: the types of the operations differ
package chats

import (
	"context"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements api.StrictServerInterface over the service.
type Server struct{ S *Service }

var _ api.StrictServerInterface = Server{}

// meta is the headers of an answer: Cache-Control, X-Request-Id and Idempotency-Replayed (false: a replay is served by the
// idempotency guard).
type meta struct {
	cache, rid *string
	replayed   *bool
}

func metaOf(ctx context.Context) meta {
	c, id, no := noStore, requestid.FromContext(ctx), false
	return meta{&c, &id, &no}
}

// answer runs call for the tenant of ctx and makes the answer of its result with ok.
func answer[T, R any](ctx context.Context, call func(tenantctx.TenantContext) (T, error), ok func(T, meta) R) (R, error) {
	var zero R
	tc, found := tenantctx.FromContext(ctx)
	if !found {
		return zero, problem.New(problem.CodeNotFound, "")
	}
	out, err := call(tc)
	if err != nil {
		return zero, err
	}
	return ok(out, metaOf(ctx)), nil
}

// body returns the decoded body of a command (nil — 400 malformed_request).
func body[T any](b *T) (T, error) {
	if b == nil {
		var zero T
		return zero, problem.New(problem.CodeMalformedRequest, "")
	}
	return *b, nil
}

// Holds.
func (s Server) ListChatHolds(ctx context.Context, _ api.ListChatHoldsRequestObject) (api.ListChatHoldsResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatHoldList, error) { return s.S.Holds(ctx, tc) },
		func(o api.ChatHoldList, m meta) api.ListChatHoldsResponseObject {
			return api.ListChatHolds200JSONResponse{Body: o, Headers: api.ListChatHolds200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		})
}

func (s Server) CreateChatHold(ctx context.Context, req api.CreateChatHoldRequestObject) (api.CreateChatHoldResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatHold, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatHold{}, err
		}
		return s.S.CreateHold(ctx, tc, b)
	}, func(o api.ChatHold, m meta) api.CreateChatHoldResponseObject {
		return api.CreateChatHold201JSONResponse{Body: o, Headers: api.CreateChatHold201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) ReleaseChatHold(ctx context.Context, req api.ReleaseChatHoldRequestObject) (api.ReleaseChatHoldResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatHold, error) { return s.S.ReleaseHold(ctx, tc, req.HoldId) },
		func(o api.ChatHold, m meta) api.ReleaseChatHoldResponseObject {
			return api.ReleaseChatHold200JSONResponse{Body: o, Headers: api.ReleaseChatHold200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		})
}

// Policies.
func (s Server) ListChatPolicies(ctx context.Context, _ api.ListChatPoliciesRequestObject) (api.ListChatPoliciesResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatKindPolicyList, error) { return s.S.Policies(ctx, tc) },
		func(o api.ChatKindPolicyList, m meta) api.ListChatPoliciesResponseObject {
			return api.ListChatPolicies200JSONResponse{Body: o, Headers: api.ListChatPolicies200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		})
}

func (s Server) UpdateChatPolicy(ctx context.Context, req api.UpdateChatPolicyRequestObject) (api.UpdateChatPolicyResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatPolicyUpdateResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatPolicyUpdateResult{}, err
		}
		return s.S.UpdatePolicy(ctx, tc, string(req.Kind), b)
	}, func(o api.ChatPolicyUpdateResult, m meta) api.UpdateChatPolicyResponseObject {
		return api.UpdateChatPolicy200JSONResponse{Body: o, Headers: api.UpdateChatPolicy200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

// Chats.
func (s Server) ListChats(ctx context.Context, req api.ListChatsRequestObject) (api.ListChatsResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatList, error) {
		folder, q, limit := "", "", 0
		if req.Params.Folder != nil {
			folder = string(*req.Params.Folder)
		}
		if req.Params.Q != nil {
			q = *req.Params.Q
		}
		if req.Params.Limit != nil {
			limit = *req.Params.Limit
		}
		return s.S.ListChats(ctx, tc, folder, q, req.Params.Cursor, limit)
	}, func(o api.ChatList, m meta) api.ListChatsResponseObject {
		return api.ListChats200JSONResponse{Body: o, Headers: api.ListChats200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	})
}

type created[T any] struct {
	out     T
	created bool
}

func (s Server) CreateChat(ctx context.Context, req api.CreateChatRequestObject) (api.CreateChatResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (created[api.ChatCreateResult], error) {
		b, err := body(req.Body)
		if err != nil {
			return created[api.ChatCreateResult]{}, err
		}
		out, made, err := s.S.CreateChat(ctx, tc, b)
		return created[api.ChatCreateResult]{out, made}, err
	}, func(o created[api.ChatCreateResult], m meta) api.CreateChatResponseObject {
		if !o.created {
			return api.CreateChat200JSONResponse{Body: o.out, Headers: api.CreateChat200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		}
		return api.CreateChat201JSONResponse{Body: o.out, Headers: api.CreateChat201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) CreateDirectChat(ctx context.Context, req api.CreateDirectChatRequestObject) (api.CreateDirectChatResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (created[api.Chat], error) {
		b, err := body(req.Body)
		if err != nil {
			return created[api.Chat]{}, err
		}
		out, made, err := s.S.CreateDirectChat(ctx, tc, b)
		return created[api.Chat]{out, made}, err
	}, func(o created[api.Chat], m meta) api.CreateDirectChatResponseObject {
		if !o.created {
			return api.CreateDirectChat200JSONResponse{Body: o.out, Headers: api.CreateDirectChat200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		}
		return api.CreateDirectChat201JSONResponse{Body: o.out, Headers: api.CreateDirectChat201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) GetChat(ctx context.Context, req api.GetChatRequestObject) (api.GetChatResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.Chat, error) { return s.S.GetChat(ctx, tc, req.ChatId) },
		func(o api.Chat, m meta) api.GetChatResponseObject {
			tag := etag(o.Revision)
			return api.GetChat200JSONResponse{Body: o, Headers: api.GetChat200ResponseHeaders{CacheControl: m.cache, ETag: &tag, XRequestId: m.rid}}
		})
}

func (s Server) UpdateChat(ctx context.Context, req api.UpdateChatRequestObject) (api.UpdateChatResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.Chat, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.Chat{}, err
		}
		return s.S.UpdateChat(ctx, tc, req.ChatId, req.Params.IfMatch, b)
	}, func(o api.Chat, m meta) api.UpdateChatResponseObject {
		tag := etag(o.Revision)
		return api.UpdateChat200JSONResponse{Body: o, Headers: api.UpdateChat200ResponseHeaders{CacheControl: m.cache, ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) GetChatAccessExplanation(ctx context.Context, req api.GetChatAccessExplanationRequestObject) (api.GetChatAccessExplanationResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatAccessExplanation, error) {
		return s.S.AccessExplanation(ctx, tc, req.ChatId, req.Params.MemberId)
	}, func(o api.ChatAccessExplanation, m meta) api.GetChatAccessExplanationResponseObject {
		return api.GetChatAccessExplanation200JSONResponse{Body: o, Headers: api.GetChatAccessExplanation200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	})
}

func (s Server) ArchiveChat(ctx context.Context, req api.ArchiveChatRequestObject) (api.ArchiveChatResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.Chat, error) { return s.S.ArchiveChat(ctx, tc, req.ChatId) },
		func(o api.Chat, m meta) api.ArchiveChatResponseObject {
			return api.ArchiveChat200JSONResponse{Body: o, Headers: api.ArchiveChat200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		})
}

func (s Server) OpenViewOnceAttachment(ctx context.Context, req api.OpenViewOnceAttachmentRequestObject) (api.OpenViewOnceAttachmentResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatViewOnceLink, error) {
		return s.S.OpenViewOnce(ctx, tc, req.ChatId, req.AttachmentId)
	}, func(o api.ChatViewOnceLink, m meta) api.OpenViewOnceAttachmentResponseObject {
		return api.OpenViewOnceAttachment200JSONResponse{Body: o, Headers: api.OpenViewOnceAttachment200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) CreateChatCleanup(ctx context.Context, req api.CreateChatCleanupRequestObject) (api.CreateChatCleanupResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatCleanupResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatCleanupResult{}, err
		}
		return s.S.Cleanup(ctx, tc, req.ChatId, b)
	}, func(o api.ChatCleanupResult, m meta) api.CreateChatCleanupResponseObject {
		return api.CreateChatCleanup200JSONResponse{Body: o, Headers: api.CreateChatCleanup200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) CreateChatExport(ctx context.Context, req api.CreateChatExportRequestObject) (api.CreateChatExportResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatExport, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatExport{}, err
		}
		return s.S.CreateExport(ctx, tc, req.ChatId, b)
	}, func(o api.ChatExport, m meta) api.CreateChatExportResponseObject {
		return api.CreateChatExport202JSONResponse{Body: o, Headers: api.CreateChatExport202ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) GetChatExport(ctx context.Context, req api.GetChatExportRequestObject) (api.GetChatExportResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatExport, error) {
		return s.S.Export(ctx, tc, req.ChatId, req.ExportId)
	},
		func(o api.ChatExport, m meta) api.GetChatExportResponseObject {
			return api.GetChatExport200JSONResponse{Body: o, Headers: api.GetChatExport200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		})
}

func (s Server) ListChatJournal(ctx context.Context, req api.ListChatJournalRequestObject) (api.ListChatJournalResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatJournal, error) {
		limit := 0
		if req.Params.Limit != nil {
			limit = *req.Params.Limit
		}
		return s.S.Journal(ctx, tc, req.ChatId, req.Params.Cursor, limit)
	}, func(o api.ChatJournal, m meta) api.ListChatJournalResponseObject {
		return api.ListChatJournal200JSONResponse{Body: o, Headers: api.ListChatJournal200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	})
}

func (s Server) ListChatMembers(ctx context.Context, req api.ListChatMembersRequestObject) (api.ListChatMembersResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMemberList, error) { return s.S.Members(ctx, tc, req.ChatId) },
		func(o api.ChatMemberList, m meta) api.ListChatMembersResponseObject {
			return api.ListChatMembers200JSONResponse{Body: o, Headers: api.ListChatMembers200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		})
}

// Messages.
func (s Server) ListChatMessages(ctx context.Context, req api.ListChatMessagesRequestObject) (api.ListChatMessagesResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessageList, error) {
		limit := 0
		if req.Params.Limit != nil {
			limit = *req.Params.Limit
		}
		return s.S.Messages(ctx, tc, req.ChatId, req.Params.Topic, req.Params.BeforeSeq, req.Params.AfterSeq, limit)
	}, func(o api.ChatMessageList, m meta) api.ListChatMessagesResponseObject {
		return api.ListChatMessages200JSONResponse{Body: o, Headers: api.ListChatMessages200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	})
}

func (s Server) PostChatMessage(ctx context.Context, req api.PostChatMessageRequestObject) (api.PostChatMessageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessage, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatMessage{}, err
		}
		return s.S.PostMessage(ctx, tc, req.ChatId, b)
	}, func(o api.ChatMessage, m meta) api.PostChatMessageResponseObject {
		return api.PostChatMessage201JSONResponse{Body: o, Headers: api.PostChatMessage201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) DeleteChatMessage(ctx context.Context, req api.DeleteChatMessageRequestObject) (api.DeleteChatMessageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessage, error) {
		return s.S.DeleteMessage(ctx, tc, req.ChatId, req.MessageId, deref(req.Params.Reason))
	}, func(o api.ChatMessage, m meta) api.DeleteChatMessageResponseObject {
		return api.DeleteChatMessage200JSONResponse{Body: o, Headers: api.DeleteChatMessage200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) EditChatMessage(ctx context.Context, req api.EditChatMessageRequestObject) (api.EditChatMessageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessage, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatMessage{}, err
		}
		return s.S.EditMessage(ctx, tc, req.ChatId, req.MessageId, b.Text)
	}, func(o api.ChatMessage, m meta) api.EditChatMessageResponseObject {
		return api.EditChatMessage200JSONResponse{Body: o, Headers: api.EditChatMessage200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) AckChatMessage(ctx context.Context, req api.AckChatMessageRequestObject) (api.AckChatMessageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessage, error) {
		return s.S.Ack(ctx, tc, req.ChatId, req.MessageId)
	},
		func(o api.ChatMessage, m meta) api.AckChatMessageResponseObject {
			return api.AckChatMessage200JSONResponse{Body: o, Headers: api.AckChatMessage200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		})
}

func (s Server) RevealChatMessagePdn(ctx context.Context, req api.RevealChatMessagePdnRequestObject) (api.RevealChatMessagePdnResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatPdnReveal, error) {
		return s.S.RevealPdn(ctx, tc, req.ChatId, req.MessageId)
	},
		func(o api.ChatPdnReveal, m meta) api.RevealChatMessagePdnResponseObject {
			return api.RevealChatMessagePdn200JSONResponse{Body: o, Headers: api.RevealChatMessagePdn200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		})
}

func (s Server) GetChatMessageReceipts(ctx context.Context, req api.GetChatMessageReceiptsRequestObject) (api.GetChatMessageReceiptsResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatReceipts, error) {
		return s.S.Receipts(ctx, tc, req.ChatId, req.MessageId)
	},
		func(o api.ChatReceipts, m meta) api.GetChatMessageReceiptsResponseObject {
			return api.GetChatMessageReceipts200JSONResponse{Body: o, Headers: api.GetChatMessageReceipts200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		})
}

func (s Server) SaveChatAttachmentsToRecord(ctx context.Context, req api.SaveChatAttachmentsToRecordRequestObject) (api.SaveChatAttachmentsToRecordResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatSaveToRecordResult, error) {
		var target *api.ObjectRef
		if req.Body != nil {
			target = req.Body.Record
		}
		return s.S.SaveToRecord(ctx, tc, req.ChatId, req.MessageId, target)
	}, func(o api.ChatSaveToRecordResult, m meta) api.SaveChatAttachmentsToRecordResponseObject {
		return api.SaveChatAttachmentsToRecord200JSONResponse{Body: o, Headers: api.SaveChatAttachmentsToRecord200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) CreateTaskFromChatMessage(ctx context.Context, req api.CreateTaskFromChatMessageRequestObject) (api.CreateTaskFromChatMessageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatTaskRef, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatTaskRef{}, err
		}
		return s.S.TaskFromMessage(ctx, tc, req.ChatId, req.MessageId, b)
	}, func(o api.ChatTaskRef, m meta) api.CreateTaskFromChatMessageResponseObject {
		return api.CreateTaskFromChatMessage201JSONResponse{Body: o, Headers: api.CreateTaskFromChatMessage201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) ListChatMessageVersions(ctx context.Context, req api.ListChatMessageVersionsRequestObject) (api.ListChatMessageVersionsResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessageVersionList, error) {
		return s.S.Versions(ctx, tc, req.ChatId, req.MessageId)
	},
		func(o api.ChatMessageVersionList, m meta) api.ListChatMessageVersionsResponseObject {
			return api.ListChatMessageVersions200JSONResponse{Body: o, Headers: api.ListChatMessageVersions200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		})
}

func (s Server) UnpinChatMessage(ctx context.Context, req api.UnpinChatMessageRequestObject) (api.UnpinChatMessageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatPinState, error) { return s.S.Unpin(ctx, tc, req.ChatId) },
		func(o api.ChatPinState, m meta) api.UnpinChatMessageResponseObject {
			return api.UnpinChatMessage200JSONResponse{Body: o, Headers: api.UnpinChatMessage200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		})
}

func (s Server) PinChatMessage(ctx context.Context, req api.PinChatMessageRequestObject) (api.PinChatMessageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatPinState, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatPinState{}, err
		}
		return s.S.Pin(ctx, tc, req.ChatId, b.MessageId)
	}, func(o api.ChatPinState, m meta) api.PinChatMessageResponseObject {
		return api.PinChatMessage200JSONResponse{Body: o, Headers: api.PinChatMessage200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

// Polls.
func (s Server) CloseChatPoll(ctx context.Context, req api.CloseChatPollRequestObject) (api.CloseChatPollResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessage, error) {
		return s.S.ClosePoll(ctx, tc, req.ChatId, req.PollId)
	},
		func(o api.ChatMessage, m meta) api.CloseChatPollResponseObject {
			return api.CloseChatPoll200JSONResponse{Body: o, Headers: api.CloseChatPoll200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		})
}

func (s Server) RemindChatPoll(ctx context.Context, req api.RemindChatPollRequestObject) (api.RemindChatPollResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatPollReminder, error) {
		return s.S.RemindPoll(ctx, tc, req.ChatId, req.PollId)
	},
		func(o api.ChatPollReminder, m meta) api.RemindChatPollResponseObject {
			return api.RemindChatPoll200JSONResponse{Body: o, Headers: api.RemindChatPoll200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		})
}

func (s Server) VoteChatPoll(ctx context.Context, req api.VoteChatPollRequestObject) (api.VoteChatPollResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatMessage, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatMessage{}, err
		}
		return s.S.Vote(ctx, tc, req.ChatId, req.PollId, b.OptionIds)
	}, func(o api.ChatMessage, m meta) api.VoteChatPollResponseObject {
		return api.VoteChatPoll200JSONResponse{Body: o, Headers: api.VoteChatPoll200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

func (s Server) MarkChatRead(ctx context.Context, req api.MarkChatReadRequestObject) (api.MarkChatReadResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatReadState, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatReadState{}, err
		}
		return s.S.MarkRead(ctx, tc, req.ChatId, b.UptoSeq)
	}, func(o api.ChatReadState, m meta) api.MarkChatReadResponseObject {
		return api.MarkChatRead200JSONResponse{Body: o, Headers: api.MarkChatRead200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	})
}

// Roster.
func (s Server) GetChatSources(ctx context.Context, req api.GetChatSourcesRequestObject) (api.GetChatSourcesResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatSources, error) { return s.S.Sources(ctx, tc, req.ChatId) },
		func(o api.ChatSources, m meta) api.GetChatSourcesResponseObject {
			tag := etag(o.Revision)
			return api.GetChatSources200JSONResponse{Body: o, Headers: api.GetChatSources200ResponseHeaders{CacheControl: m.cache, ETag: &tag, XRequestId: m.rid}}
		})
}

func (s Server) ReplaceChatSources(ctx context.Context, req api.ReplaceChatSourcesRequestObject) (api.ReplaceChatSourcesResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatSourcesResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return api.ChatSourcesResult{}, err
		}
		return s.S.ReplaceSources(ctx, tc, req.ChatId, req.Params.IfMatch, b)
	}, func(o api.ChatSourcesResult, m meta) api.ReplaceChatSourcesResponseObject {
		h := api.ReplaceChatSources200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}
		if o.Sources != nil {
			tag := etag(o.Sources.Revision)
			h.ETag = &tag
		}
		return api.ReplaceChatSources200JSONResponse{Body: o, Headers: h}
	})
}

func (s Server) GetChatStorage(ctx context.Context, req api.GetChatStorageRequestObject) (api.GetChatStorageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (api.ChatStorage, error) { return s.S.Storage(ctx, tc, req.ChatId) },
		func(o api.ChatStorage, m meta) api.GetChatStorageResponseObject {
			return api.GetChatStorage200JSONResponse{Body: o, Headers: api.GetChatStorage200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		})
}

var _ = uuid.Nil
