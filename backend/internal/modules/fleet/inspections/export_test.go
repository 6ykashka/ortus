package inspections

// CheckForm reports why a stored definition is not a checklist form (nil — it is one): the integration tests check
// every definition of a tenant against FormDefinition and the rules of a checklist (Q-W2.52-21).
func CheckForm(raw []byte) error {
	_, _, _, err := parseDefinition(raw)
	return err
}
