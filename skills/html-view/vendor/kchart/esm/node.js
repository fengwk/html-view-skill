import { basic_exports } from "./chart/basic.js";
import { catalog, catalog_exports } from "./chart/catalog.js";
import { composition_exports } from "./chart/composition.js";
import { context_exports } from "./chart/context.js";
import { distribution_exports } from "./chart/distribution.js";
import { fields_exports } from "./chart/fields.js";
import { maps_exports } from "./chart/maps.js";
import { mindmap_exports } from "./chart/mindmap.js";
import { multivariate_exports } from "./chart/multivariate.js";
import { createRegistry, registry_exports } from "./chart/registry.js";
import { relations_exports } from "./chart/relations.js";
import { spec_exports, validate as validate$1 } from "./chart/spec.js";
import { stat_compare_exports } from "./chart/stat-compare.js";
import { stat_trend_exports } from "./chart/stat-trend.js";
import { statistics_exports } from "./chart/statistics.js";
import { unit_variants_exports } from "./chart/unit-variants.js";
import { variants_exports } from "./chart/variants.js";
import { color_exports } from "./core/color.js";
import { context_exports as context_exports$1, structureRoles } from "./core/context.js";
import { diagnostics_exports } from "./core/diagnostics.js";
import { format_exports } from "./core/format.js";
import { geometry_exports } from "./core/geometry.js";
import { icon_data_exports } from "./core/icon-data.js";
import { icons_exports, registerIcons } from "./core/icons.js";
import { scale_exports } from "./core/scale.js";
import { scene_exports } from "./core/scene.js";
import { svg_exports } from "./core/svg.js";
import { text_exports } from "./core/text.js";
import { DEFAULT_THEME, FONT_FAMILY, defaultStyle, resolveThemeConfig, theme, theme_exports, themes, validateThemeSnapshot } from "./core/theme.js";
import { agentflow_exports } from "./diagram/agentflow.js";
import { architecture_exports } from "./diagram/architecture.js";
import { block_exports } from "./diagram/block.js";
import { blocks_exports } from "./diagram/blocks.js";
import { c4_exports } from "./diagram/c4.js";
import { class_exports } from "./diagram/class.js";
import { cynefin_exports } from "./diagram/cynefin.js";
import { emphasis_exports } from "./diagram/emphasis.js";
import { er_exports } from "./diagram/er.js";
import { eventmodeling_exports } from "./diagram/eventmodeling.js";
import { gantt_date_exports } from "./diagram/gantt-date.js";
import { gantt_exports } from "./diagram/gantt.js";
import { gitgraph_exports } from "./diagram/gitgraph.js";
import { graph_layout_exports } from "./diagram/graph-layout.js";
import { graph_parse_exports } from "./diagram/graph-parse.js";
import { graph_route_exports } from "./diagram/graph-route.js";
import { graph_exports } from "./diagram/graph.js";
import { ishikawa_exports } from "./diagram/ishikawa.js";
import { journey_exports } from "./diagram/journey.js";
import { kanban_exports } from "./diagram/kanban.js";
import { label_exports } from "./diagram/label.js";
import { layers_exports } from "./diagram/layers.js";
import { map_label_exports } from "./diagram/map-label.js";
import { mindmap_exports as mindmap_exports$1 } from "./diagram/mindmap.js";
import { numeric_composition_exports } from "./diagram/numeric-composition.js";
import { numeric_model_exports } from "./diagram/numeric-model.js";
import { numeric_parse_exports } from "./diagram/numeric-parse.js";
import { numeric_radar_exports } from "./diagram/numeric-radar.js";
import { numeric_sankey_exports } from "./diagram/numeric-sankey.js";
import { numeric_xy_exports } from "./diagram/numeric-xy.js";
import { packet_exports } from "./diagram/packet.js";
import { presentation_exports } from "./diagram/presentation.js";
import { quadrant_exports } from "./diagram/quadrant.js";
import { railroad_parse_exports } from "./diagram/railroad-parse.js";
import { railroad_exports } from "./diagram/railroad.js";
import { registry_exports as registry_exports$1 } from "./diagram/registry.js";
import { relations_exports as relations_exports$1 } from "./diagram/relations.js";
import { requirement_exports } from "./diagram/requirement.js";
import { sequence_exports } from "./diagram/sequence.js";
import { shapes_exports } from "./diagram/shapes.js";
import { prepareSource, source_exports } from "./diagram/source.js";
import { support_exports } from "./diagram/support.js";
import { swimlane_mermaid_exports } from "./diagram/swimlane-mermaid.js";
import { swimlane_exports } from "./diagram/swimlane.js";
import { time_exports } from "./diagram/time.js";
import { timeline_exports } from "./diagram/timeline.js";
import { tree_family_icon_exports } from "./diagram/tree-family-icon.js";
import { treeview_exports } from "./diagram/treeview.js";
import { usecase_exports } from "./diagram/usecase.js";
import { venn_exports } from "./diagram/venn.js";
import { wardley_exports } from "./diagram/wardley.js";
import { interaction_exports } from "./interaction.js";
import { createPageApi } from "./page-api.js";
import families_default from "./src/families.js";
import { readFileSync } from "node:fs";
// node.js
var modulesByPath = /* #__PURE__ */ Object.assign({
	"./src/chart/basic.js": basic_exports,
	"./src/chart/catalog.js": catalog_exports,
	"./src/chart/composition.js": composition_exports,
	"./src/chart/context.js": context_exports,
	"./src/chart/distribution.js": distribution_exports,
	"./src/chart/fields.js": fields_exports,
	"./src/chart/maps.js": maps_exports,
	"./src/chart/mindmap.js": mindmap_exports,
	"./src/chart/multivariate.js": multivariate_exports,
	"./src/chart/registry.js": registry_exports,
	"./src/chart/relations.js": relations_exports,
	"./src/chart/spec.js": spec_exports,
	"./src/chart/stat-compare.js": stat_compare_exports,
	"./src/chart/stat-trend.js": stat_trend_exports,
	"./src/chart/statistics.js": statistics_exports,
	"./src/chart/unit-variants.js": unit_variants_exports,
	"./src/chart/variants.js": variants_exports,
	"./src/core/color.js": color_exports,
	"./src/core/context.js": context_exports$1,
	"./src/core/diagnostics.js": diagnostics_exports,
	"./src/core/format.js": format_exports,
	"./src/core/geometry.js": geometry_exports,
	"./src/core/icon-data.js": icon_data_exports,
	"./src/core/icons.js": icons_exports,
	"./src/core/scale.js": scale_exports,
	"./src/core/scene.js": scene_exports,
	"./src/core/svg.js": svg_exports,
	"./src/core/text.js": text_exports,
	"./src/core/theme.js": theme_exports,
	"./src/diagram/agentflow.js": agentflow_exports,
	"./src/diagram/architecture.js": architecture_exports,
	"./src/diagram/block.js": block_exports,
	"./src/diagram/blocks.js": blocks_exports,
	"./src/diagram/c4.js": c4_exports,
	"./src/diagram/class.js": class_exports,
	"./src/diagram/cynefin.js": cynefin_exports,
	"./src/diagram/emphasis.js": emphasis_exports,
	"./src/diagram/er.js": er_exports,
	"./src/diagram/eventmodeling.js": eventmodeling_exports,
	"./src/diagram/gantt-date.js": gantt_date_exports,
	"./src/diagram/gantt.js": gantt_exports,
	"./src/diagram/gitgraph.js": gitgraph_exports,
	"./src/diagram/graph-layout.js": graph_layout_exports,
	"./src/diagram/graph-parse.js": graph_parse_exports,
	"./src/diagram/graph-route.js": graph_route_exports,
	"./src/diagram/graph.js": graph_exports,
	"./src/diagram/ishikawa.js": ishikawa_exports,
	"./src/diagram/journey.js": journey_exports,
	"./src/diagram/kanban.js": kanban_exports,
	"./src/diagram/label.js": label_exports,
	"./src/diagram/layers.js": layers_exports,
	"./src/diagram/map-label.js": map_label_exports,
	"./src/diagram/mindmap.js": mindmap_exports$1,
	"./src/diagram/numeric-composition.js": numeric_composition_exports,
	"./src/diagram/numeric-model.js": numeric_model_exports,
	"./src/diagram/numeric-parse.js": numeric_parse_exports,
	"./src/diagram/numeric-radar.js": numeric_radar_exports,
	"./src/diagram/numeric-sankey.js": numeric_sankey_exports,
	"./src/diagram/numeric-xy.js": numeric_xy_exports,
	"./src/diagram/packet.js": packet_exports,
	"./src/diagram/presentation.js": presentation_exports,
	"./src/diagram/quadrant.js": quadrant_exports,
	"./src/diagram/railroad-parse.js": railroad_parse_exports,
	"./src/diagram/railroad.js": railroad_exports,
	"./src/diagram/registry.js": registry_exports$1,
	"./src/diagram/relations.js": relations_exports$1,
	"./src/diagram/requirement.js": requirement_exports,
	"./src/diagram/sequence.js": sequence_exports,
	"./src/diagram/shapes.js": shapes_exports,
	"./src/diagram/source.js": source_exports,
	"./src/diagram/support.js": support_exports,
	"./src/diagram/swimlane-mermaid.js": swimlane_mermaid_exports,
	"./src/diagram/swimlane.js": swimlane_exports,
	"./src/diagram/time.js": time_exports,
	"./src/diagram/timeline.js": timeline_exports,
	"./src/diagram/tree-family-icon.js": tree_family_icon_exports,
	"./src/diagram/treeview.js": treeview_exports,
	"./src/diagram/usecase.js": usecase_exports,
	"./src/diagram/venn.js": venn_exports,
	"./src/diagram/wardley.js": wardley_exports,
	"./src/interaction.js": interaction_exports
});
var dist = new URL(
	/* @vite-ignore */
	"../",
	import.meta.url
);
var read = (file) => readFileSync(new URL(file, dist), "utf8");
var manifest = JSON.parse(read("units.json"));
var chartModules = /* @__PURE__ */ new Map();
var chartDecorators = /* @__PURE__ */ new Map();
var diagramModules = /* @__PURE__ */ new Map();
var diagramMetadata = [];
for (const [name, entry] of Object.entries(families_default)) {
	for (const chart of entry.charts || []) {
		if (chartModules.has(chart)) throw new Error(`可视化图型重复登记：${chart}`);
		chartModules.set(chart, name);
	}
	for (const [chart, variants] of Object.entries(entry.variants || {})) {
		if (chartDecorators.has(chart)) throw new Error(`可视化变体模块重复登记：${chart}`);
		chartDecorators.set(chart, {
			name,
			variants
		});
	}
	for (const [kind, { syntax = "mermaid", topic, aliases = [] }] of Object.entries(entry.diagrams || {})) {
		for (const alias of [kind, ...aliases]) {
			const key = alias.toLowerCase();
			if (diagramModules.has(key)) throw new Error(`结构图别名重复登记：${alias}`);
			diagramModules.set(key, {
				name,
				syntax
			});
		}
		diagramMetadata.push(Object.freeze({
			kind,
			syntax,
			topic,
			aliases: Object.freeze(aliases)
		}));
	}
}
var diagramTypes = Object.freeze(diagramMetadata);
function dependencyOrder(roots) {
	const ordered = /* @__PURE__ */ new Set();
	const visiting = /* @__PURE__ */ new Set();
	function visit(name) {
		if (ordered.has(name)) return;
		if (!Object.hasOwn(manifest, name)) throw new Error(`可视化模块未登记：${name}`);
		if (visiting.has(name)) throw new Error(`可视化模块存在循环依赖：${name}`);
		visiting.add(name);
		for (const dep of manifest[name].deps) visit(dep);
		visiting.delete(name);
		ordered.add(name);
	}
	roots.forEach(visit);
	return [...ordered];
}
var entryRoots = [
	"chart/catalog",
	"chart/spec",
	"chart/registry",
	"chart/context",
	"core/theme"
];
var fullChartRoots = [
	...entryRoots,
	...new Set(chartModules.values()),
	...new Set([...chartDecorators.values()].map(({ name }) => name)),
	"interaction"
];
var diagramEntry = "diagram/registry";
function diagramRoots(sources) {
	if (sources === void 0) return [diagramEntry, ...new Set([...diagramModules.values()].map(({ name }) => name))];
	if (!Array.isArray(sources)) throw new TypeError("结构图源码集合必须是数组");
	const roots = /* @__PURE__ */ new Set([diagramEntry]);
	for (const item of sources) {
		const { source, syntax = "mermaid" } = typeof item === "string" ? { source: item } : item || {};
		if (typeof source !== "string") throw new TypeError("结构图源码必须是字符串");
		const { kind } = prepareSource(source, { syntax });
		const selected = diagramModules.get(kind.toLowerCase());
		if (selected?.syntax === syntax) roots.add(selected.name);
	}
	return [...roots];
}
function modulesFor(specs) {
	if (specs === void 0) return dependencyOrder(fullChartRoots);
	if (!Array.isArray(specs)) throw new TypeError("图表声明集合必须是数组");
	const roots = [...entryRoots];
	const decorators = /* @__PURE__ */ new Set(), diagrams = [];
	let interactive = false;
	for (const spec of specs) {
		if (spec && typeof spec === "object" && !Object.hasOwn(spec, "chart") && Object.hasOwn(spec, "source")) {
			diagrams.push(spec);
			continue;
		}
		const family = chartModules.get(spec?.chart);
		if (!family) throw new TypeError(`无法为未知图型选择模块：${spec?.chart}`);
		roots.push(family);
		const decorator = chartDecorators.get(spec.chart);
		if (decorator?.variants.includes(spec.variant)) decorators.add(decorator.name);
		if (Array.isArray(spec.interaction) && spec.interaction.length) interactive = true;
	}
	if (diagrams.length) roots.push(...diagramRoots(diagrams));
	roots.push(...decorators);
	if (interactive) roots.push("interaction");
	return dependencyOrder(roots);
}
function unloadedVariants(roots) {
	const loaded = new Set(roots);
	return [...chartDecorators].filter(([, { name }]) => !loaded.has(name)).map(([chart, { variants }]) => [chart, variants]);
}
var scripts = /* @__PURE__ */ new Map();
function script(file) {
	if (!scripts.has(file)) {
		const text = read(file);
		if (/<\/script(?:[\s/>]|$)/i.test(text)) throw new Error(`模块源码不能直接内嵌在 HTML 中：${file}`);
		scripts.set(file, text);
	}
	return scripts.get(file);
}
var literal = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
function browserScript(roots, diagramOnly = false) {
	const label = diagramOnly ? "离线结构图库" : "离线渲染库";
	const units = roots.map((id) => script(manifest[id].file)).join("\n");
	const types = roots.includes(diagramEntry) ? diagramTypes : [];
	return `/* KChart ${label} */\n;(() => {\nconst KChartUnits = Object.create(null);\n${units}\n${script("page-api.js")}\nglobalThis.KChart = KChartPageApi.createPageApi(KChartUnits, ${literal(unloadedVariants(roots))}, ${literal(types)}, ${diagramOnly});\n})();\n`;
}
function browserSource(specs) {
	return browserScript(modulesFor(specs));
}
function runtimeSource() {
	return script(manifest.runtime.file);
}
var mapFiles = /* @__PURE__ */ new Map([["world", "world.geojson"], ["us-states", "us-states.geojson"]]);
var readMapFile = (file) => read(`assets/maps/${file}`);
var plain = (value) => JSON.parse(JSON.stringify(value));
function createRenderer({ specs, sources, readMap = readMapFile } = {}) {
	const diagramOnly = sources !== void 0 && specs === void 0;
	return rendererFor(diagramOnly ? dependencyOrder(diagramRoots(sources)) : modulesFor(specs), diagramOnly, readMap);
}
function rendererFor(roots, diagramOnly, readMap) {
	const modules = Object.fromEntries(roots.map((id) => [id, modulesByPath[`./src/${id}.js`]]));
	const registry = createRegistry(validate$1);
	for (const unit of Object.values(modules)) unit.install?.(registry);
	const api = createPageApi(modules, unloadedVariants(roots), diagramTypes, diagramOnly, registry);
	let browser;
	const bundleSource = () => browser ??= browserScript(roots, diagramOnly);
	const diagramMethods = api.diagram ? {
		diagram: (source, options) => plain(api.diagram(source, options)),
		check: (source, options) => plain(api.check(source, options)),
		diagramTypes
	} : {};
	if (diagramOnly) return Object.freeze({
		...diagramMethods,
		theme: modules["core/theme"].theme,
		themes: modules["core/theme"].themes,
		bundleSource
	});
	const maps = /* @__PURE__ */ new Map();
	function assets(spec) {
		const name = spec?.data?.map?.asset;
		if (name == null) return void 0;
		const file = mapFiles.get(name);
		if (!file) throw new TypeError(`不支持的内置地图：${name}`);
		if (!maps.has(name)) maps.set(name, JSON.parse(readMap(file)));
		return { [name]: plain(maps.get(name)) };
	}
	return Object.freeze({
		parse: (text) => plain(api.parse(text)),
		validate: (spec) => plain(api.validate(spec)),
		schema: (chart) => plain(api.schema(chart)),
		render(spec, options = {}) {
			let map = options.assets;
			if (!map && mapFiles.has(spec?.data?.map?.asset)) map = assets(spec);
			return plain(api.render(spec, {
				...options,
				assets: map
			}));
		},
		dataTable: (spec, options) => plain(api.dataTable(spec, options)),
		theme: api.theme,
		themes: api.themes,
		palette: (theme) => plain(modules["core/theme"].paletteOf(api.theme(theme))),
		catalog: api.catalog,
		layouts: api.layouts,
		...diagramMethods,
		assets,
		bundleSource
	});
}
function detectSyntax(source) {
	const kind = prepareSource(source).kind.toLowerCase();
	return diagramModules.get(kind)?.syntax ?? "mermaid";
}
var renderer;
var defaultRenderer = () => renderer ??= createRenderer();
var render = (spec, options) => defaultRenderer().render(spec, options);
var parse = (text) => defaultRenderer().parse(text);
var validate = (spec) => defaultRenderer().validate(spec);
var schema = (chart) => defaultRenderer().schema(chart);
var dataTable = (spec, options) => defaultRenderer().dataTable(spec, options);
var diagramRenderer;
var defaultDiagrams = () => diagramRenderer ??= rendererFor(dependencyOrder(diagramRoots()), true, readMapFile);
var diagram = (source, options) => defaultDiagrams().diagram(source, options);
var check = (source, options) => defaultDiagrams().check(source, options);
export { DEFAULT_THEME, FONT_FAMILY, browserSource, catalog, check, createRenderer, dataTable, defaultStyle, detectSyntax, diagram, diagramTypes, modulesFor, parse, registerIcons, render, resolveThemeConfig, runtimeSource, schema, structureRoles, theme, themes, validate, validateThemeSnapshot };
