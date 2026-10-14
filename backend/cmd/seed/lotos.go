package main

// SPA «Лотос» (t-lotos): mock-data.js seedLotos() — регион и два салона. Персонал «Лотоса» в прототипе
// генерируется из аккаунтов fillAccounts (acc-g*) и в скелет не входит.

var lotosData = tenantData{
	tenant: tenantByProto(protoLotos),
	units: []unit{
		{proto: regionMsk, kind: kindRegion, name: "Москва", timeZone: tzMoscow},
		{proto: "f-lotos-tver", kind: kindCompany, parent: regionMsk, name: "Лотос · Тверская", timeZone: tzMoscow},
		{proto: "f-lotos-arb", kind: kindCompany, parent: regionMsk, name: "Лотос · Арбат", timeZone: tzMoscow},
	},
	members: []member{
		{"m-owner", "Ирина Белова", "owner@lotos-spa.example", stActive, "Владелец", "", "f-lotos-tver"},
		{"m-morozova", "Анна Морозова", "a.morozova@alta.example", stActive, "Массажист · Тверская", "", "f-lotos-tver"},
	},
}
