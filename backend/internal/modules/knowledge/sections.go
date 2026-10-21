package knowledge

import "strings"

// sectionBody is the text of the i-th subpage of the section of object o (makeSection of the domain): the passport
// from the fields of the object, «Как попасть на объект» from its access lines, the others — constant texts.
func sectionBody(i int, o RepairObject) string {
	switch i {
	case 0:
		var b strings.Builder
		b.WriteString("Адрес: " + o.Address + ". " + o.Area + ", " + o.Kind + ". Заказчик: " + o.Client + ".")
		if o.Contract != "" {
			b.WriteString(" Договор: " + o.Contract + ".")
		}
		if o.Due != "" {
			b.WriteString(" Сдача: " + o.Due + ".")
		}
		return b.String()
	case 1:
		if len(o.Access) == 0 {
			return sectionEntry
		}
		return strings.Join(o.Access, "\n\n")
	case 2:
		return sectionActs
	case 3:
		return sectionPhotos
	}
	return sectionWarranty
}
