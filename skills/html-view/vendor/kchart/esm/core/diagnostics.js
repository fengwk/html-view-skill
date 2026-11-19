import { __exportAll } from "../_virtual/_rolldown/runtime.js";
// src/core/diagnostics.js
var diagnostics_exports = /* @__PURE__ */ __exportAll({
	ExpectedDiagnostic: () => ExpectedDiagnostic,
	fit: () => fit
});
var ExpectedDiagnostic = class extends Error {
	constructor(message, errors) {
		super(message);
		this.errors = errors;
		this.code = errors[0]?.code;
		if (errors.length === 1 && errors[0].fix) this.fix = errors[0].fix;
	}
};
function fit(reason, fix) {
	const message = `图型不适用：${reason}。${fix}`;
	throw new ExpectedDiagnostic(message, [{
		code: "CHART_FIT",
		message,
		fix
	}]);
}
export { ExpectedDiagnostic, diagnostics_exports, fit };
