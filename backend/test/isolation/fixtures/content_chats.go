package fixtures

// chats writes the chat of every chat object of the tenant (W7.11, schema chat): a work chat without a unit and without a
// roster — the owner of the business sees it (and nobody else, PD-53) — with its service message and the first message of
// the owner. The id is the id of the reference chat:<tenant>.<key>, the one the role assignments with the scope «chat» use,
// so the rows of the matrix name it the same way (chat:a.trip).
func (l *tenantLoader) chats() error {
	at := l.now.Add(-contentAge)
	for _, o := range l.t.Objects {
		if o.Kind != ObjectChat {
			continue
		}
		id := l.kbObjectID(ObjectChat, o.Key)
		if err := l.exec("chat "+o.Key, `insert into chat.chats (id, kind, title, status, sensitivity, last_seq, created_by, created_at, updated_at)
			values ($1, 'group', $2, 'active', 'normal', 2, $3, $4, $4)`, id, o.Name, l.owner, at); err != nil {
			return err
		}
		if err := l.exec("chat service message "+o.Key, `insert into chat.messages (chat_id, seq, kind, text, system_card, created_at)
			values ($1, 1, 'system', '', $2::jsonb, $3)`, id, `{"module":"chat","icon":"add_comment","tone":"ok","title":"Чат создан","text":"Рабочая группа"}`, at); err != nil {
			return err
		}
		if err := l.exec("chat message "+o.Key, `insert into chat.messages (chat_id, seq, kind, author_id, text, created_at) values ($1, 2, 'text', $2, 'Рейс выехал по плану', $3)`,
			id, l.owner, at); err != nil {
			return err
		}
	}
	return nil
}
