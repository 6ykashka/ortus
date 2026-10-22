package forms

// Texts of the answers: the reference («Формы и опросы.dc.html», api.js, models.js) and the scenario server of W4.05
// (msw/forms/no-reference.ts — texts without the reference, Q-W4.05-9).
const (
	textFirstPage    = "Страница 1"
	textPagesRepeat  = "Страницы повторяются"
	textKeyTaken     = "Такой идентификатор уже есть"
	textPageNotFound = "Страница не найдена"
	textNoQuestions  = "В форме нет ни одного вопроса"
	textOther        = "Другое"
	textRequired     = "Обязательный вопрос"
	textWrongType    = "Неверный тип ответа"
	textDraftChanged = "Черновик изменил другой редактор — обновите страницу"
	textFormNotFound = "Форма не найдена"
	textRespNotFound = "Ответ не найден"
	textRuleNotFound = "Действие не найдено"
	textGroupMissing = "Группа не найдена"
	textUnitMissing  = "Область не найдена"
	textQuestionGone = "Вопрос не найден"
	textObjectGone   = "Объект не найден"
	textMemberGone   = "Сотрудник не найден"
	textClosed       = "Приём ответов закрыт"
	textAnswered     = "Вы уже отвечали на эту форму"
	textVersionMoved = "Форма обновилась — откройте её заново"
	textNoQuestion   = "Вопроса нет в форме"
	textHidden       = "Скрытый вопрос заполняют ссылка и значение по умолчанию"
	textNotHidden    = "Параметр ссылки — только для скрытого вопроса"
	textDraftFlow    = "Версии создаёт публикация черновика"
	textNoChanges    = "Изменений для публикации нет"
	textNotPublished = "Форма ещё не опубликована"
	textNoVersion    = "У формы ещё нет опубликованной версии"
	textNoResponses  = "Ответов пока нет"
	textGroupFull    = "В группе есть формы — сначала переместите их"
	textGroupShort   = "Название группы — от 2 символов"
	textGroupTaken   = "Такая группа уже есть"
	textNameShortNew = "Укажите название формы — не короче 3 символов"
	textNameShort    = "Название формы — не короче 3 символов"
	textLimit        = "Лимит ответов — положительное число"
	textRuleDisabled = "Действие выключено — включите его, чтобы перенести ответы"
	textRuleDeleted  = "Действие удалено из формы — повторить нельзя"
	textSource       = "Выберите шаблон или форму для копии"
	textTplNotFound  = "Шаблон не найден"
	textGuest        = "Гость"
	textThanks       = "Спасибо! Ответ отправлен."
	textAccepted     = "Принят"
	textRejected     = "Отклонён"
	textPending      = "На проверке"
)

// need are the refusals without a right in the area of the form (the labels of the catalogue, no-reference).
var need = map[string]string{ //nolint:gosec // G101: refusals of rights, not credentials
	actRead:          "Нет права «Видеть формы»",
	actCreate:        "Нет права «Создавать формы»",
	actManage:        "Нет права «Настраивать» формы",
	actPublish:       "Нет права «Публиковать версии»",
	actPublishPublic: "Нужно право «Публичные ссылки»",
	actRespRead:      "Нет права «Читать ответы»",
	actRespReview:    "Нет права «Проверять ответы»",
	actRespAssign:    "Нет права «Назначать ответственного за ответ»",
}

// The actions of core.forms (api/permissions.yaml).
const (
	actRead          = "forms.read"
	actCreate        = "forms.create"
	actManage        = "forms.manage"
	actPublish       = "forms.publish"
	actPublishPublic = "forms.publish_public"
	actRespRead      = "forms.responses.read"
	actRespReview    = "forms.responses.review"
	actRespAssign    = "forms.responses.assign"
)
