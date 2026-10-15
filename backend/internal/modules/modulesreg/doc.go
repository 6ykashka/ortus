// Package modulesreg is the module registry of a tenant (W1.08, step 1.7, S1-17…S1-19): trusted manifests of the
// installable modules built from the permission catalog, module availability of /me/context, installation states
// (active → draining → read_only | disabled, AC-12), the deactivation preview fed by explicit activity providers,
// the module gate of the API gateway and the strict server of the OpenAPI tag Modules.
//
// States of the contract (ModuleManifest.state) are stored in modules.installations.state (tenant 0001) under the
// same names, except two: uninstalled is the absence of a row and active is stored as enabled. In draining started
// processes may finish while new work is closed; read_only keeps history readable with the old grants; disabled
// closes ordinary APIs (the owner export is separate).
//
// module_key is the key of the contract (fleet, spa, repairs); the catalog keys logistics and repair are read as
// synonyms (isolation fixtures of W1.04).
package modulesreg
