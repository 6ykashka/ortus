package main

// «Альта Групп» (t-alta): mock-data.js baseSeed() — 3 региона × 4 фирмы, 10 участников.

const (
	tzMoscow    = "Europe/Moscow"
	tzSamara    = "Europe/Samara"
	kindRegion  = "region"
	kindCompany = "company"
	homeAlta    = "f-msk-sever" // «Север Логистик» — основная фирма сценариев прототипа
)

func altaFirm(proto, region, name string) unit {
	tz := tzMoscow
	if region == "r-smr" {
		tz = tzSamara
	}
	return unit{proto: proto, kind: kindCompany, parent: region, name: name, timeZone: tz}
}

var alta = tenantData{
	tenant: tenantByProto(protoAlta),
	units: []unit{
		{proto: regionMsk, kind: kindRegion, name: "Москва", timeZone: tzMoscow},
		{proto: "r-smr", kind: kindRegion, name: "Самара", timeZone: tzSamara},
		{proto: "r-spb", kind: kindRegion, name: "Санкт-Петербург", timeZone: tzMoscow},
		altaFirm(homeAlta, regionMsk, "Север Логистик"),
		altaFirm("f-msk-yug", regionMsk, "Юг Транс"),
		altaFirm("f-msk-vostok", regionMsk, "Восток Карго"),
		altaFirm("f-msk-centr", regionMsk, "Центр Экспресс"),
		altaFirm("f-smr-volga", "r-smr", "Волга Логистик"),
		altaFirm("f-smr-truck", "r-smr", "Самара Трак"),
		altaFirm("f-smr-zhig", "r-smr", "Жигули Карго"),
		altaFirm("f-smr-priv", "r-smr", "Приволжье Сервис"),
		altaFirm("f-spb-neva", "r-spb", "Нева Логистик"),
		altaFirm("f-spb-baltic", "r-spb", "Балтик Транс"),
		altaFirm("f-spb-ohta", "r-spb", "Охта Карго"),
		altaFirm("f-spb-pulk", "r-spb", "Пулково Экспресс"),
	},
	// Домашнее подразделение в прототипе не задано: «Север Логистик» (основная фирма сценариев),
	// «Диспетчер · Самара» — регион Самара.
	members: []member{
		{"m-owner", "Дарья Зимина", "d.zimina@alta.example", stActive, "Владелец", "", homeAlta},
		{"m-kotova", "Марина Котова", "m.kotova@alta.example", stActive, "Логист", "", homeAlta},
		{"m-vasiliev", "Илья Васильев", "i.vasiliev@alta.example", stActive, "Водитель", "driver", homeAlta},
		{"m-morozova", "Анна Морозова", "a.morozova@alta.example", stActive, "Массажист", "", homeAlta},
		{"m-sokolov", "Алексей Соколов", "a.sokolov@alta.example", stActive, "Прораб", "", homeAlta},
		{"m-petrova", "Олеся Петрова", "o.petrova@alta.example", stInvited, "Диспетчер", "", homeAlta},
		{"m-gromov", "Кирилл Громов", "k.gromov@alta.example", "blocked", "Водитель", "driver", homeAlta},
		{"m-kotelnikova", "Вера Котельникова", "v.kotelnikova@alta.example", stActive, "Диспетчер · Самара", "", "r-smr"},
		{"m-akhmedov", "Тимур Ахмедов", "t.akhmedov@alta.example", stActive, "Водитель", "driver", homeAlta},
		{"m-ilyin", "Сергей Ильин", "s.ilyin@alta.example", stInvited, "Бухгалтер", "", homeAlta},
	},
}
