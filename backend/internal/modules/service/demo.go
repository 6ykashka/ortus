package service

import (
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The demo data of «Альта Групп» (serviceSeed of service.js 19.10:123–204): four directions, 21 types, four reply
// templates, eight requests and two low ratings. The time is the Moscow time of the prototype, the ids come from the
// ids function of the seed (PD-30), so the stand and the mock show the same rows.

// DemoBase is «сейчас» of the demo: 1 October 2026, 16:24 Moscow (SVC_BASE).
var DemoBase = time.Date(2026, time.October, 1, 16, 24, 0, 0, Moscow)

// DemoRequest is a request of the demo with its feed.
type DemoRequest struct {
	Request
	Messages []Message
	// RatingID is the answer of the survey the request came from (service.requests.from_rating_id).
	RatingID uuid.UUID
}

// DemoSet is the demo data.
type DemoSet struct {
	Directions []Direction
	Types      []Type
	Templates  []Template
	Requests   []DemoRequest
	Ratings    []Rating
	Clients    []Client
}

// DemoIDs gives the ids of the demo: a prototype id (r-57, d-mas, m-owner, svc-grz) → the id of the stand.
type DemoIDs func(proto string) uuid.UUID

func mt(day, mon, h, m int) time.Time {
	return time.Date(2026, time.Month(mon), day, h, m, 0, 0, Moscow)
}

type dirDef struct {
	proto, key, name, color, module, area, project, cal string
	next                                                int
}

const (
	dMas = "d-mas"
	dKos = "d-kos"
	dOtd = "d-otd"
	dGrz = "d-grz"
)

var demoDirections = []dirDef{
	{dMas, "МАС", "Массаж", "#7B3F6E", keySpa, "Альта SPA", "svc-mas", keySpa, 42},
	{dKos, "КОС", "Косметология", "#5B4E8C", keySpa, "Альта SPA", "svc-kos", keySpa, 7},
	{dOtd, "ОТД", "Отделка", "#7A5214", "repairs", "Москва", "svc-otd", "rep", 13},
	{dGrz, "ГРЗ", "Грузоперевозки", "#2B5479", "fleet", "Москва, Самара", "svc-grz", "log", 58},
}

type typeDef struct {
	dir, kind, name       string
	first, resolve, legal int
}

func spaTypes(d string) []typeDef {
	return []typeDef{
		{d, KindComplaint, "Жалоба", 120, 1320, 0}, {d, KindClaim, "Вернуть деньги за услугу", 660, 0, 10},
		{d, KindQuestion, "Вопрос", 240, 1980, 0}, {d, KindIdea, labelIdea, 1320, 0, 0}, {d, KindThanks, "Спасибо мастеру", 0, 0, 0},
	}
}

func demoTypeDefs() []typeDef {
	out := append(spaTypes(dMas), spaTypes(dKos)...)
	return append(out,
		typeDef{dOtd, KindWarranty, "Гарантийный случай", 240, 6000, 0},
		typeDef{dOtd, KindClaim, "Претензия по качеству или срокам", 600, 0, 10},
		typeDef{dOtd, KindComplaint, "Жалоба", 120, 1200, 0},
		typeDef{dOtd, KindQuestion, "Вопрос по ремонту", 480, 1800, 0},
		typeDef{dOtd, KindIdea, labelIdea, 1800, 0, 0},
		typeDef{dOtd, KindThanks, "Спасибо бригаде", 0, 0, 0},
		typeDef{dGrz, KindCargo, "Повреждение или недостача груза", 240, 0, 30},
		typeDef{dGrz, KindComplaint, "Опоздание или жалоба", 120, 1440, 0},
		typeDef{dGrz, KindQuestion, "Вопрос по доставке", 120, 2160, 0},
		typeDef{dGrz, KindIdea, labelIdea, 1440, 0, 0},
		typeDef{dGrz, KindThanks, "Спасибо водителю", 0, 0, 0},
	)
}

func goalOf(v int) *int {
	if v == 0 {
		return nil
	}
	return &v
}

// DemoTemplates are the reply templates of a new direction (templates of service.js).
func DemoTemplates() []Template {
	return []Template{
		{"t1", "Приняли в работу", "{имя}, приняли ваше обращение {номер}. Ответим {срок}."},
		{"t2", "Нужны подробности", "{имя}, чтобы разобраться, уточните, пожалуйста: "},
		{"t3", "Извинение и компенсация", "{имя}, извините за неудобство. Мы разобрались, что произошло: . В качестве извинения "},
		{"t4", "Решено", "{имя}, вопрос решён: . Если что-то осталось, просто ответьте на это сообщение."},
	}
}

// Demo builds the demo data with the ids of the stand.
func Demo(id DemoIDs) DemoSet {
	d := DemoSet{Templates: DemoTemplates()}
	cals := SeedCalendars()
	for _, x := range demoDirections {
		lead := id("m-owner")
		d.Directions = append(d.Directions, Direction{ID: id(x.proto), Key: x.key, Name: x.name, Color: x.color, ModuleKey: x.module,
			AreaLabel: x.area, ProjectID: id(x.project), CalendarID: id("cal-" + x.cal), Calendar: cals[x.cal], LeadID: &lead,
			Next: x.next, Status: "active", Version: 1, PublicSlug: strings.TrimPrefix(x.proto, "d-")})
	}
	for _, t := range demoTypeDefs() {
		d.Types = append(d.Types, Type{ID: t.kind, DirectionID: id(t.dir), Kind: t.kind, Name: t.name,
			Goals: TypeGoals{First: goalOf(t.first), Resolve: goalOf(t.resolve), Legal: goalOf(t.legal)}, Priority: demoPriority(t.kind)})
	}
	b := &demoBuilder{d: &d, id: id, files: map[uuid.UUID][]string{}}
	b.requests()
	b.ratings()
	return d
}

func demoPriority(kind string) string {
	if kind == KindComplaint || kind == KindClaim {
		return PriorityHigh
	}
	return PriorityNormal
}

type demoBuilder struct {
	d     *DemoSet
	id    DemoIDs
	msg   int
	files map[uuid.UUID][]string // message → the names of its files
}

// withFiles notes the names of the files of a message of the client.
func (b *demoBuilder) withFiles(m Message, names ...string) Message {
	b.files[m.ID] = names
	return m
}

func (b *demoBuilder) dir(proto string) Direction {
	for _, x := range b.d.Directions {
		if x.ID == b.id(proto) {
			return x
		}
	}
	panic("service: demo: no direction " + proto)
}

func (b *demoBuilder) typ(dirProto, kind string) Type {
	for _, x := range b.d.Types {
		if x.DirectionID == b.id(dirProto) && x.Kind == kind {
			return x
		}
	}
	panic("service: demo: no type " + dirProto + ":" + kind)
}

func (b *demoBuilder) client(name, company, phone string) Client {
	for _, c := range b.d.Clients {
		if c.Phone == phone {
			return c
		}
	}
	c := Client{ID: b.id("client:" + phone), Name: name, Company: company, Phone: phone, CreatedAt: mt(1, 9, 9, 0), Since: mt(1, 9, 9, 0)}
	b.d.Clients = append(b.d.Clients, c)
	return c
}

// m is a message of a request: author is the prototype id of the member ("" — the client or the system).
func (b *demoBuilder) m(req uuid.UUID, kind string, at time.Time, text string, x Message) Message {
	b.msg++
	x.ID, x.RequestID, x.Kind, x.At, x.Text = b.id("msg"+strconv.Itoa(b.msg)), req, kind, at, text
	if x.Reasons == nil {
		x.Reasons = []string{}
	}
	return x
}

type stopped struct{ first, resolve, legal *time.Time }

func (b *demoBuilder) sla(dirProto, kind string, at time.Time, s stopped) SLA {
	out := SLAFor(b.dir(dirProto).Calendar, b.typ(dirProto, kind).Goals, at)
	for _, p := range []struct {
		t  *Timer
		at *time.Time
	}{{out.First, s.first}, {out.Resolve, s.resolve}, {out.Legal, s.legal}} {
		if p.t != nil && p.at != nil {
			p.t.Stopped = p.at
		}
	}
	return out
}

type reqDef struct {
	proto, dir, kind, title, status, priority, channel string
	num                                                int
	assignee, about                                    string
	at                                                 time.Time
	fromRating                                         int
	ratingProto                                        string
	client                                             Client
	since                                              string
	link                                               *Link
	stop                                               stopped
	pausedAt, resolvedAt                               *time.Time
	outcome                                            string
	labels                                             []string
	tasks                                              []TaskRef
	messages                                           func(r uuid.UUID) []Message
}

func (b *demoBuilder) ratingID(proto string) uuid.UUID {
	if proto == "" {
		return uuid.Nil
	}
	return b.id(proto)
}

func (b *demoBuilder) add(x reqDef) {
	d := b.dir(x.dir)
	r := Request{ID: b.id(x.proto), DirectionID: d.ID, Number: x.num, Key: d.Key + "-" + strconv.Itoa(x.num), Kind: x.kind, TypeID: b.typ(x.dir, x.kind).ID, Title: x.title,
		Status: x.status, Priority: x.priority, Channel: x.channel, Client: x.client, Link: x.link, Labels: x.labels,
		Outcome: x.outcome, FromRating: x.fromRating, CreatedAt: x.at, ResolvedAt: x.resolvedAt, UpdatedAt: x.at, Revision: 1,
		SLA: b.sla(x.dir, x.kind, x.at, x.stop), PausedAt: x.pausedAt, Details: Details{ClientSince: x.since, Tasks: x.tasks}}
	if x.assignee != "" {
		r.Assignee = b.id(x.assignee)
	}
	if x.about != "" {
		r.About = b.id(x.about)
	}
	msgs := x.messages(r.ID)
	for _, m := range msgs {
		for i, name := range b.files[m.ID] {
			if r.Details.Files == nil {
				r.Details.Files = map[string][]FileRef{}
			}
			r.Details.Files[m.ID.String()] = append(r.Details.Files[m.ID.String()], FileRef{ID: b.id("file:" + m.ID.String() + ":" + strconv.Itoa(i)), FileName: name})
		}
	}
	b.d.Requests = append(b.d.Requests, DemoRequest{Request: r, Messages: msgs, RatingID: b.ratingID(x.ratingProto)})
}

func (b *demoBuilder) requests() {
	cl := b.client
	b.add(reqDef{proto: "r-57", num: 57, dir: dGrz, kind: KindCargo, title: "Две коробки помяты, внутри бой", status: StatusNew, priority: PriorityHigh,
		channel: ChannelBot, at: mt(1, 10, 11, 14), client: cl("Наталья Гусева", "ООО «Фермерская лавка»", "+79162044412"),
		since:  "Клиент с 2024 года · 23 доставки",
		link:   &Link{Label: "Рейс Р-196 · 27.09", Lines: []string{"Доставлено 27 сентября, 14:40", "Водитель: Илья Васильев", "Фото выгрузки: 4"}},
		labels: []string{"бой"}, messages: func(r uuid.UUID) []Message {
			return []Message{
				b.withFiles(b.m(r, "client", mt(1, 10, 11, 14), "Добрый день! В рейсе Р-196 две коробки из 14 пришли помятыми, внутри бой — 6 банок. Фото и акт о расхождении прикладываю.", Message{Channel: ChannelBot}), "Фото 1.jpg", "Фото 2.jpg", "Акт о расхождении.pdf"),
				b.m(r, "public", mt(1, 10, 11, 14), "Наталья, приняли обращение ГРЗ-57. Ответим в течение 4 часов.", Message{Auto: true, Channel: ChannelBot, Delivery: DeliverySent}),
			}
		}})
	b.add(reqDef{proto: "r-41", num: 41, dir: dMas, kind: KindComplaint, title: "Начали на 15 минут позже, в кабинете холодно", status: StatusNew,
		priority: PriorityHigh, channel: ChannelSMS, at: mt(1, 10, 15, 12), fromRating: 2, ratingProto: "S-41", about: "m-morozova",
		client: cl("Ольга Романова", "", "+79251170318"), since: "Клиент с марта 2025 · 7 визитов · прошлые оценки 5, 5, 4",
		link:   &Link{Label: "Визит 1.10, 11:30 · SPA-ритуал", Lines: []string{"SPA-ритуал · 1 октября, 11:30–13:00", "Кабинет № 2 · стол с подогревом", "Мастер: Анна Морозова"}},
		labels: []string{"опоздание", "оборудование"},
		tasks:  []TaskRef{{ID: b.id("T-71"), Key: "T-71", Title: "Починить подогрев стола в кабинете № 2", Status: "Новая"}},
		messages: func(r uuid.UUID) []Message {
			return []Message{
				b.m(r, "rating", mt(1, 10, 15, 12), "Начали на 15 минут позже, в кабинете холодно. Сам массаж хороший.", Message{Score: 2, Reasons: []string{"Опоздание начала", "Температура в кабинете"}, Contact: true}),
				b.m(r, "public", mt(1, 10, 15, 12), "Ольга, спасибо за честную оценку. Администратор ответит в течение 2 часов.", Message{Auto: true, Channel: ChannelSMS, Delivery: DeliverySent}),
				b.m(r, "note", mt(1, 10, 15, 40), "Проверила журнал кабинета № 2: в 11:30 не включился подогрев стола, Анна начала в 11:45. Завела задачу T-71 на ремонт стола. Предлагаю скидку 20% на следующий визит.", Message{Author: b.id("m-owner")}),
			}
		}})
	b.demoWork()
}

func (b *demoBuilder) demoWork() {
	cl := b.client
	b.add(reqDef{proto: "r-o11", num: 11, dir: dOtd, kind: KindClaim, title: "Прошу уменьшить цену: перепад ламината в коридоре", status: StatusWork,
		priority: PriorityNormal, channel: ChannelCabinet, assignee: "m-owner", at: mt(27, 9, 20, 5), stop: stopped{first: new(mt(28, 9, 10, 30))},
		client: cl("Игорь Чернов", "", "+79035552107"), since: "Заказчик · договор № 31", labels: []string{"ламинат"},
		link:  &Link{Label: "Профсоюзная, 64 · кв. 210", Lines: []string{"Чистовая отделка · сдача 9 октября", "Прораб: Алексей Соколов", "Договор № 31"}},
		tasks: []TaskRef{{ID: b.id("T-73"), Key: "T-73", Title: "Замер перепада ламината в коридоре", Status: "В работе"}},
		messages: func(r uuid.UUID) []Message {
			return []Message{
				b.withFiles(b.m(r, "client", mt(27, 9, 20, 5), "Прошу уменьшить цену за ламинат в коридоре: перепад между плашками до 3 мм, видно при боковом свете. Фото прилагаю.", Message{Channel: ChannelCabinet}), "Коридор 1.jpg", "Коридор 2.jpg", "Коридор 3.jpg"),
				b.m(r, "public", mt(28, 9, 10, 30), "Игорь, приняли претензию. 2 октября приедет прораб и замерит перепад, после этого пришлём письменный ответ.", Message{Author: b.id("m-owner"), Channel: ChannelCabinet, Delivery: DeliverySent}),
				b.m(r, "note", mt(28, 9, 10, 40), "Соколов, посмотри фото: если перепад больше 2 мм — переукладка за наш счёт, иначе предложим скидку.", Message{Author: b.id("m-owner")}),
			}
		}})
	b.add(reqDef{proto: "r-40", num: 40, dir: dMas, kind: KindQuestion, title: "Можно ли SPA-ритуал во время беременности?", status: StatusNew,
		priority: PriorityNormal, channel: ChannelWidget, at: mt(1, 10, 16, 4), client: cl("Екатерина Лаврова", "", "+79773009255"), since: textNewClient,
		messages: func(r uuid.UUID) []Message {
			return []Message{b.m(r, "client", mt(1, 10, 16, 4), "Можно ли SPA-ритуал во время беременности? Срок 20 недель.", Message{Channel: ChannelWidget})}
		}})
	b.add(reqDef{proto: "r-o12", num: 12, dir: dOtd, kind: KindWarranty, title: "Отошла плитка у душевого трапа", status: StatusWork, priority: PriorityNormal,
		channel: ChannelCabinet, assignee: "m-owner", at: mt(30, 9, 19, 40), stop: stopped{first: new(mt(1, 10, 9, 35))},
		client: cl("Андрей Кузнецов", "", "+79168806140"), since: "Заказчик · договор № 27", labels: []string{"гарантия"},
		link:  &Link{Label: "Дом на Лесной · Мытищи", Lines: []string{"Сдан 12 сентября · гарантия до 12.09.2027", "Прораб: Алексей Соколов", "Акт № 4 · плитка, санузел 2 этажа"}},
		tasks: []TaskRef{{ID: b.id("T-72"), Key: "T-72", Title: "Выезд по гарантии: плитка у трапа, 2.10 10:00–12:00", Status: "Новая"}},
		messages: func(r uuid.UUID) []Message {
			return []Message{
				b.withFiles(b.m(r, "client", mt(30, 9, 19, 40), "В ванной на втором этаже отошла плитка у душевого трапа, две плитки качаются.", Message{Channel: ChannelCabinet}), "Трап 1.jpg", "Трап 2.jpg"),
				b.m(r, "public", mt(1, 10, 9, 35), "Андрей, это гарантийный случай. Прораб приедет в пятницу, 2 октября, с 10 до 12. Подойдёт?", Message{Author: b.id("m-owner"), Channel: ChannelCabinet, Delivery: DeliverySent}),
				b.m(r, "client", mt(1, 10, 10, 2), "Да, буду дома.", Message{Channel: ChannelCabinet}),
				b.m(r, "note", mt(1, 10, 10, 10), "Назначила выезд в календаре: Соколов, 2.10 10:00–12:00.", Message{Author: b.id("m-owner")}),
			}
		}})
	b.demoLogistics()
}

func (b *demoBuilder) demoLogistics() {
	cl := b.client
	b.add(reqDef{proto: "r-55", num: 55, dir: dGrz, kind: KindCargo, title: "Привезли 5 паллет из 6", status: StatusWait, pausedAt: new(mt(28, 9, 11, 0)),
		priority: PriorityNormal, channel: ChannelPhone, assignee: "m-kotelnikova", at: mt(26, 9, 14, 20), stop: stopped{first: new(mt(26, 9, 14, 25))},
		client: cl("Олег Сафонов", "ИП Сафонов", "+78462127709"), since: "Клиент с 2025 года · 8 доставок", labels: []string{"недостача"},
		link: &Link{Label: "Рейс Р-192 · 26.09", Lines: []string{"Доставлено 26 сентября, 13:10", "Водитель: Тимур Ахмедов", "Накладная № 4410: 6 паллет"}},
		messages: func(r uuid.UUID) []Message {
			return []Message{
				b.m(r, "system", mt(26, 9, 14, 20), "Заведено по звонку · Вера Котельникова", Message{}),
				b.m(r, "client", mt(26, 9, 14, 20), "Привезли 5 паллет из 6, водитель сказал, что шестую не погрузили на складе.", Message{Channel: ChannelPhone}),
				b.m(r, "public", mt(26, 9, 14, 25), "Олег, приняли обращение о недостаче одной паллеты. Пришлите, пожалуйста, акт о расхождении с подписью водителя.", Message{Author: b.id("m-kotelnikova"), Channel: ChannelPhone, Delivery: DeliverySent}),
				b.m(r, "client", mt(27, 9, 12, 10), "Акт подписан, но он у кладовщика — пришлю в понедельник.", Message{Channel: ChannelPhone}),
				b.m(r, "public", mt(28, 9, 11, 0), "Ждём акт: без него не можем начать проверку.", Message{Author: b.id("m-kotelnikova"), Channel: ChannelPhone, Delivery: DeliverySent}),
				b.m(r, "system", mt(28, 9, 11, 0), "Ждёт клиента — срок на паузе, срок по закону идёт", Message{}),
			}
		}})
	b.add(reqDef{proto: "r-k6", num: 6, dir: dKos, kind: KindIdea, title: "Сделайте онлайн-запись на выходные", status: StatusNew, priority: PriorityLow,
		channel: ChannelQR, at: mt(1, 10, 12, 0), client: cl("Мария Киселёва", "", "+79264101573"), since: "Клиент с 2024 года · 15 визитов",
		messages: func(r uuid.UUID) []Message {
			return []Message{b.m(r, "client", mt(1, 10, 12, 0), "Сделайте онлайн-запись на выходные — по телефону в субботу не дозвониться.", Message{Channel: ChannelQR})}
		}})
	b.add(reqDef{proto: "r-39", num: 39, dir: dMas, kind: KindThanks, title: "Спасибо Анне, спина больше не болит", status: StatusResolved,
		outcome: OutcomeThanks, resolvedAt: new(mt(30, 9, 15, 40)), priority: PriorityLow, channel: ChannelSMS, at: mt(30, 9, 15, 40),
		client: cl("Мария Киселёва", "", "+79264101573"), since: "Клиент с 2024 года · 15 визитов",
		link: &Link{Label: "Визит 30.09 · классический массаж", Lines: []string{"Классический массаж · 30 сентября, 10:00–11:00", "Кабинет № 2", "Мастер: Анна Морозова"}},
		messages: func(r uuid.UUID) []Message {
			return []Message{
				b.m(r, "rating", mt(30, 9, 15, 40), "Спасибо Анне, спина больше не болит!", Message{Score: 5}),
				b.m(r, "system", mt(30, 9, 15, 40), "Благодарность передана мастеру: Анна Морозова", Message{}),
			}
		}})
}

func (b *demoBuilder) ratings() {
	for _, x := range []struct {
		proto, dir, client, phone, comment, work, status, request string
		score                                                     int
		reasons                                                   []string
		at                                                        time.Time
	}{
		{"S-311", dMas, "Светлана Михеева", "+79000000311", "Полотенце было влажным", "Визит 30.09 · массаж спины", ratingOpen, "", 3, []string{"Чистота"}, mt(30, 9, 18, 10)},
		{"S-305", dGrz, "ООО «Вектор»", "+79000000305", "Опоздали на 40 минут, разгрузку перенесли на вечер", "Рейс Р-190 · 29.09", ratingOpen, "", 2,
			[]string{"Опоздание к окну выгрузки"}, mt(29, 9, 12, 40)},
		// The answer of the survey МАС-41 came from: the request is open, the rating is spent.
		{"S-41", dMas, "Ольга Романова", "+79251170318", "Начали на 15 минут позже, в кабинете холодно. Сам массаж хороший.", "Визит 1.10, 11:30 · SPA-ритуал", ratingRequest, "r-41", 2,
			[]string{"Опоздание начала", "Температура в кабинете"}, mt(1, 10, 15, 12)},
	} {
		c := b.client(x.client, "", x.phone)
		rt := Rating{ID: b.id(x.proto), DirectionID: b.id(x.dir), ClientID: c.ID, ClientName: x.client, Score: x.score, Reasons: x.reasons,
			Comment: x.comment, Work: x.work, Status: x.status, At: x.at}
		if x.request != "" {
			rt.RequestID = b.id(x.request)
		}
		b.d.Ratings = append(b.d.Ratings, rt)
	}
}
