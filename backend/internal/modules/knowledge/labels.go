package knowledge

import "github.com/google/uuid"

// areaLabel is the area of a space: «фирма «…»», «регион «…»» or «вся организация» (areaLabel of the domain).
func (w *world) areaLabel(sp *space) string {
	u := w.units[sp.unit]
	if u == nil {
		return areaAll
	}
	if u.kind == "region" {
		return "регион «" + u.name + "»"
	}
	return "фирма «" + u.name + "»"
}

// entryLabel is the label of an entry of a list (entryLabel of the domain): the employee, «Группа «…»»,
// «Роль «…»» with « в пространстве» or the unit, «Прораб объекта «…»».
func (w *world) entryLabel(e entry) string {
	switch e.who {
	case whoMember:
		if name := w.nameOf(e.ref); name != "" {
			return name
		}
		return "Сотрудник"
	case whoGroup:
		return "Группа «" + w.groupName(e.ref) + "»"
	case whoRole:
		r := w.roles[e.ref]
		if r == nil {
			return "Роль «" + e.ref.String() + "»"
		}
		tail := ""
		switch {
		case r.spaceRole():
			tail = " в пространстве"
		case e.unit != uuid.Nil:
			tail = " · «" + w.unitName(e.unit) + "»"
		}
		return "Роль «" + r.name + "»" + tail
	case whoRelation:
		if o, ok := w.objects[e.obj]; ok && o.Name != "" {
			return "Прораб объекта «" + o.Name + "»"
		}
		return "Прораб объекта"
	}
	return "—"
}
