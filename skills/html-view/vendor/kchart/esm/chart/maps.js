import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { register } from "./registry.js";
// src/chart/maps.js
var maps_exports = /* @__PURE__ */ __exportAll({
	install: () => install,
	maps: () => maps
});
var RAD = Math.PI / 180;
var project = (longitude, latitude, projection = "equirectangular") => {
	const lon = Number(longitude), lat = Number(latitude);
	if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
	if (projection === "mercator") {
		const clipped = Math.max(-85.05112878, Math.min(85.05112878, lat));
		return [lon * RAD, Math.log(Math.tan(Math.PI / 4 + clipped * RAD / 2))];
	}
	if (projection !== "equirectangular") throw new TypeError(`Unknown map projection: ${projection}`);
	return [lon * RAD, lat * RAD];
};
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function featuresFor(spec, options) {
	const ctx = options;
	const map = spec.data.map;
	let collection, idProperty;
	if (map.geojson) {
		collection = map.geojson;
		idProperty = map.idProperty;
	} else {
		collection = options.assets?.[map.asset];
		if (!collection) ctx.fit(`缺少注入的地图资产 ${map.asset}`, "由宿主通过 ctx.assets 注入对应 FeatureCollection");
		idProperty = "id";
	}
	if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) ctx.fit("地图资产不是 FeatureCollection", "传入合法 GeoJSON FeatureCollection");
	for (const [i, f] of collection.features.entries()) {
		if (!isObject(f) || f.type !== "Feature" || !isObject(f.properties) || !isObject(f.geometry) || !["Polygon", "MultiPolygon"].includes(f.geometry.type)) ctx.fit(`地图要素 ${i} 缺少合法 Polygon/MultiPolygon geometry`, "修正 GeoJSON geometry.type 与 coordinates");
		const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
		if (!Array.isArray(polys) || !polys.length || polys.some((poly) => !Array.isArray(poly) || !poly.length || poly.some((ring) => !Array.isArray(ring) || ring.length < 4 || ring.some((p) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]))) ctx.fit(`地图要素 ${i} 含空或非法坐标环`, "每个 ring 须至少含4个合法经纬度位置且首尾闭合");
	}
	return {
		features: collection.features,
		idProperty
	};
}
function splitRing(ring) {
	const points = [];
	for (const [lon, lat] of ring) {
		let x = lon;
		if (points.length) {
			const prev = points.at(-1)[0];
			while (x - prev > 180) x -= 360;
			while (x - prev < -180) x += 360;
		}
		points.push([x, lat]);
	}
	const min = Math.floor((Math.min(...points.map((p) => p[0])) + 180) / 360);
	const max = Math.floor((Math.max(...points.map((p) => p[0])) + 180) / 360);
	const clip = (input, edge, keepGreater) => {
		const out = [];
		for (let i = 0; i < input.length; i += 1) {
			const a = input[i], b = input[(i + 1) % input.length];
			const insideA = keepGreater ? a[0] >= edge : a[0] <= edge;
			const insideB = keepGreater ? b[0] >= edge : b[0] <= edge;
			if (insideA) out.push(a);
			if (insideA !== insideB) {
				const t = (edge - a[0]) / (b[0] - a[0]);
				out.push([edge, a[1] + (b[1] - a[1]) * t]);
			}
		}
		return out;
	};
	const result = [];
	for (let strip = min; strip <= max; strip += 1) {
		const west = -180 + strip * 360, east = 180 + strip * 360;
		const clipped = clip(clip(points, west, true), east, false);
		if (clipped.length < 3) continue;
		const shifted = clipped.map(([x, y]) => [x - strip * 360, y]);
		shifted.push([...shifted[0]]);
		result.push(shifted);
	}
	return result;
}
function ringPath(ring, point) {
	return splitRing(ring).map((part) => {
		const pts = part.map(([lon, lat]) => point(lon, lat)).filter(Boolean);
		if (pts.length < 4) return "";
		return `${pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ")} Z`;
	}).filter(Boolean).join(" ");
}
function geometryRings(geometry) {
	return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}
function coordinateBounds(features, rows, enc, inset, projection) {
	if (inset) return {
		west: -126,
		east: -66,
		south: 23,
		north: 50
	};
	const coords = [];
	for (const f of features) for (const ring of geometryRings(f.geometry)) for (const p of ring) coords.push(p);
	if (!coords.length) {
		for (const row of rows || []) if (Number.isFinite(row[enc?.longitude]) && Number.isFinite(row[enc?.latitude])) coords.push([row[enc.longitude], row[enc.latitude]]);
	}
	if (!coords.length) return {
		west: -180,
		east: 180,
		south: -90,
		north: 90
	};
	let west = Math.min(...coords.map((p) => p[0])), east = Math.max(...coords.map((p) => p[0]));
	let south = Math.min(...coords.map((p) => p[1])), north = Math.max(...coords.map((p) => p[1]));
	if (west === east) {
		west -= 1;
		east += 1;
	}
	if (south === north) {
		south -= 1;
		north += 1;
	}
	if (projection === "mercator") {
		south = Math.max(south, -85.05112878);
		north = Math.min(north, 85.05112878);
	}
	return {
		west,
		east,
		south,
		north
	};
}
var INDEX_TOP = 98;
var INDEX_ROW = 16;
var INDEX_CAP = 24;
function makePlot(spec, ctx, features, rows = []) {
	const width = ctx.width;
	const inset = spec.data.map.asset === "us-states";
	const projection = ctx.assets?.projection || "equirectangular";
	const bounds = coordinateBounds(features, rows, spec.encode, inset, projection);
	const ll = project(bounds.west, bounds.south, projection), ur = project(bounds.east, bounds.north, projection);
	const margin = width <= 360 ? 12 : 32;
	const indexRows = Math.min(rows.length, INDEX_CAP);
	const bottom = indexRows ? 126 + Math.ceil(indexRows / (width < 420 ? 1 : 2)) * INDEX_ROW : 112;
	const availableW = width - margin * 2;
	const budgetH = Math.max(180, Math.round(width * .64) - (indexRows ? 120 : 80));
	const scale = Math.min(availableW / Math.max(1e-9, ur[0] - ll[0]), budgetH / Math.max(1e-9, ur[1] - ll[1]));
	const plot = {
		x: margin + (availableW - (ur[0] - ll[0]) * scale) / 2,
		y: 20,
		w: (ur[0] - ll[0]) * scale,
		h: (ur[1] - ll[1]) * scale
	};
	const height = Math.ceil(plot.y + plot.h + 4 + bottom);
	const projectPoint = (lon, lat) => {
		let p = project(lon, lat, projection);
		if (inset && lon > bounds.east) return null;
		return p && [plot.x + (p[0] - ll[0]) * scale, plot.y + (ur[1] - p[1]) * scale];
	}, children = [], grid = ctx.palette.grid;
	ctx.palette.muted;
	const lonStep = inset ? 10 : Math.max(10, Math.round((bounds.east - bounds.west) / 6 / 10) * 10);
	const latStep = inset ? 5 : Math.max(10, Math.round((bounds.north - bounds.south) / 5 / 10) * 10);
	for (let lon = Math.ceil(bounds.west / lonStep) * lonStep; lon <= bounds.east; lon += lonStep) {
		const a = projectPoint(lon, bounds.south), b = projectPoint(lon, bounds.north);
		if (a && b) children.push(ctx.line(a[0], a[1], b[0], b[1], {
			stroke: grid,
			"stroke-width": .6,
			"stroke-dasharray": "2 4"
		}));
	}
	for (let lat = Math.ceil(bounds.south / latStep) * latStep; lat <= bounds.north; lat += latStep) {
		const a = projectPoint(bounds.west, lat), b = projectPoint(bounds.east, lat);
		if (a && b) children.push(ctx.line(a[0], a[1], b[0], b[1], {
			stroke: grid,
			"stroke-width": .6,
			"stroke-dasharray": "2 4"
		}));
	}
	return {
		width,
		height,
		plot,
		children,
		projectPoint,
		inset,
		projection,
		bounds,
		bottom
	};
}
function insetPoint(layout, id, lon, lat) {
	const ak = id === "US-AK", west = ak ? -188 : -161, east = ak ? -129 : -154, south = ak ? 51 : 18, north = ak ? 72 : 23;
	const cell = ak ? {
		x: layout.plot.x,
		y: layout.plot.y + layout.plot.h - 62,
		w: 102,
		h: 48
	} : {
		x: layout.plot.x + 112,
		y: layout.plot.y + layout.plot.h - 28,
		w: 36,
		h: 22
	};
	const x = ak && lon > 0 ? lon - 360 : lon;
	if (!ak && x < west - 1) return null;
	return [cell.x + (x - west) / (east - west) * cell.w, cell.y + (north - lat) / (north - south) * cell.h];
}
function mapCredit(children, ctx, layout, spec) {
	const source = spec.data.map.geojson ? ctx.lang.startsWith("en") ? "Source: supplied GeoJSON" : "地图来源：注入的 GeoJSON" : ctx.lang.startsWith("en") ? "Source: Natural Earth" : "地图来源：Natural Earth";
	const text = ctx.lang.startsWith("en") ? `${source} · Boundaries are illustrative, not an endorsement.` : `${source} · 边界仅作示意，不代表立场或认可。`;
	const lines = ctx.wrap(text, Math.max(120, layout.width - 24), 12, 400);
	children.push(ctx.textLines(layout.width / 2, layout.height - 6, lines, {
		anchor: "middle",
		size: 12,
		fill: palette(ctx).muted,
		meta: { kind: "map-source" }
	}));
	layout.height += (lines.length - 1) * 16;
}
function palette(ctx) {
	const { accent, bg, muted } = ctx.palette;
	return {
		low: ctx.mix(bg, accent, .3),
		high: accent,
		missing: bg,
		border: ctx.mix(bg, muted, .5),
		ink: ctx.palette.fg,
		muted,
		grid: ctx.palette.grid
	};
}
function formattedValue(ctx, value, field) {
	const meta = ctx.field(field), text = ctx.format(value, field);
	return meta.unit && text !== "—" && !text.includes(meta.unit) ? `${text} ${meta.unit}` : text;
}
function bottomLegend(children, ctx, layout, min, max, field, withSize = false) {
	const c = palette(ctx), y = layout.height - layout.bottom + 16;
	let center = layout.width / 2;
	const reserveLegendWidth = (width) => {
		if (width + 24 > layout.width) {
			layout.width = Math.ceil(width + 24);
			center = layout.width / 2;
		}
	};
	const fieldMeta = field ? ctx.field(field) : {};
	const title = fieldMeta.label && fieldMeta.label !== field ? fieldMeta.label : fieldMeta.unit || "";
	if (withSize) {
		const low = formattedValue(ctx, min, field), high = formattedValue(ctx, max, field), note = ctx.lang.startsWith("en") ? "area ∝ value" : "面积 ∝ 数值";
		if (min === max) {
			const width = ctx.measure(low, 12, 400), noteWidth = ctx.measure(note, 12, 400);
			const total = 40 + width + noteWidth;
			reserveLegendWidth(total);
			const start = center - total / 2;
			children.push(ctx.circle(start + 5, y + 26, 5, {
				fill: c.high,
				stroke: c.ink,
				"stroke-width": .7,
				meta: { kind: "geo-scatter-size-legend" }
			}));
			children.push(ctx.text(start + 14, y + 30, low, {
				size: 12,
				fill: c.ink
			}));
			children.push(ctx.text(start + 22 + width + 18, y + 30, note, {
				size: 12,
				fill: c.muted
			}));
		} else {
			const widths = [
				low,
				high,
				note
			].map((value) => ctx.measure(value, 12, 400));
			const total = 74 + widths[0] + widths[1] + widths[2];
			reserveLegendWidth(total);
			let x = center - total / 2;
			children.push(ctx.circle(x + 5, y + 26, 5, {
				fill: c.high,
				stroke: c.ink,
				"stroke-width": .7,
				meta: { kind: "geo-scatter-size-legend" }
			}));
			x += 16;
			children.push(ctx.text(x, y + 30, low, {
				size: 12,
				fill: c.ink
			}));
			x += widths[0] + 18;
			children.push(ctx.circle(x + 9, y + 26, 9, {
				fill: c.high,
				stroke: c.ink,
				"stroke-width": .7,
				meta: { kind: "geo-scatter-size-legend" }
			}));
			x += 24;
			children.push(ctx.text(x, y + 30, high, {
				size: 12,
				fill: c.ink
			}));
			x += widths[1] + 16;
			children.push(ctx.text(x, y + 30, note, {
				size: 12,
				fill: c.muted
			}));
		}
		children.push(ctx.text(center, y, title, {
			anchor: "middle",
			size: 12,
			fill: c.ink
		}));
	} else {
		children.push(ctx.text(center, y, title, {
			anchor: "middle",
			size: 12,
			fill: c.ink
		}));
		children.push(ctx.rect(center - 100, y + 8, 200, 12, { fill: `url(#map-legend)` }));
		children.push(ctx.text(center - 100, y + 38, formattedValue(ctx, min, field), {
			size: 12,
			fill: c.ink
		}));
		children.push(ctx.text(center + 100, y + 38, formattedValue(ctx, max, field), {
			anchor: "end",
			size: 12,
			fill: c.ink
		}));
		children.push(ctx.rect(center - 100, y + 46, 12, 12, {
			fill: c.missing,
			stroke: c.border,
			"stroke-width": 1
		}));
		children.push(ctx.text(center - 82, y + 57, ctx.lang.startsWith("en") ? "No data" : "无数据", {
			size: 12,
			fill: c.ink
		}));
		children.push(ctx.el("defs", {}, [ctx.el("linearGradient", {
			id: "map-legend",
			x1: "0%",
			x2: "100%",
			y1: "0%",
			y2: "0%"
		}, [ctx.el("stop", {
			offset: "0%",
			"stop-color": c.low
		}), ctx.el("stop", {
			offset: "100%",
			"stop-color": c.high
		})])]));
	}
}
function validateUniqueRegionKeys(features, idProperty, ctx) {
	const ids = /* @__PURE__ */ new Set();
	for (const f of features) {
		const id = f.properties[idProperty];
		if (typeof id !== "string" || !id || ids.has(id)) ctx.fit(`地图地区键 ${String(id)} 缺失或重复`, "修正 idProperty 并确保每个地区键唯一");
		ids.add(id);
	}
	return ids;
}
function choropleth(spec, ctx) {
	const { features, idProperty } = featuresFor(spec, ctx), ids = validateUniqueRegionKeys(features, idProperty, ctx);
	const [regionField, valueField] = [spec.encode.region, spec.encode.value], data = /* @__PURE__ */ new Map();
	for (const [i, row] of spec.data.rows.entries()) {
		const id = row?.[regionField];
		if (typeof id !== "string" || !ids.has(id)) ctx.fit(`数据行 ${i} 的地区键 ${String(id)} 不存在于地图资产`, "使地区键与 GeoJSON id 完全一致；禁止按名称模糊匹配");
		if (data.has(id)) ctx.fit(`地区键 ${id} 在数据中重复`, "每个地区只能提供一行数据");
		const value = row[valueField];
		if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) ctx.fit(`地区 ${id} 的数值非法`, "value 必须是有限数值或 null");
		data.set(id, value);
	}
	const field = ctx.field(valueField), domain = Array.isArray(field.domain) && field.domain.length === 2 && field.domain.every(Number.isFinite) ? field.domain : null;
	const vals = [...data.values()].filter(Number.isFinite), min = domain?.[0] ?? (vals.length ? Math.min(...vals) : 0), max = domain?.[1] ?? (vals.length ? Math.max(...vals) : 0);
	const layout = makePlot(spec, ctx, features), c = palette(ctx), { children, projectPoint } = layout;
	for (const feature of features) {
		const id = feature.properties[idProperty], hasValue = data.has(id) && Number.isFinite(data.get(id)), value = hasValue ? data.get(id) : null;
		if (layout.inset && ["US-AK", "US-HI"].includes(id)) continue;
		const ratio = !hasValue ? 0 : max === min ? .5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
		const fill = hasValue ? ctx.mix(c.low, c.high, ratio) : c.missing;
		const d = geometryRings(feature.geometry).map((ring) => ringPath(ring, projectPoint)).filter(Boolean).join(" ");
		if (d) children.push(ctx.path(d, {
			fill,
			"fill-rule": "evenodd",
			stroke: c.border,
			"stroke-width": .7,
			"vector-effect": "non-scaling-stroke",
			meta: {
				kind: "choropleth",
				region: id,
				label: feature.properties.name || id,
				value: hasValue ? value : null
			}
		}));
	}
	if (layout.inset) for (const feature of features) {
		const id = feature.properties[idProperty];
		if (!["US-AK", "US-HI"].includes(id)) continue;
		const place = (lon, lat) => insetPoint(layout, id, lon, lat);
		const d = geometryRings(feature.geometry).map((ring) => ringPath(ring, place)).filter(Boolean).join(" "), val = data.get(id), hasValue = data.has(id) && Number.isFinite(val);
		if (d) children.push(ctx.path(d, {
			fill: hasValue ? ctx.mix(c.low, c.high, max === min ? .5 : Math.max(0, Math.min(1, (val - min) / (max - min)))) : c.missing,
			"fill-rule": "evenodd",
			stroke: c.border,
			"stroke-width": .7,
			meta: {
				kind: "choropleth",
				region: id,
				label: feature.properties.name || id,
				value: hasValue ? val : null,
				inset: true
			}
		}));
	}
	bottomLegend(children, ctx, layout, min, max, valueField);
	mapCredit(children, ctx, layout, spec);
	return {
		width: layout.width,
		height: layout.height,
		title: spec.title || "Choropleth map",
		children
	};
}
function scatter(spec, ctx) {
	const { features } = featuresFor(spec, ctx), rows = spec.data.rows, enc = spec.encode;
	const layout = makePlot(spec, ctx, features, rows), c = palette(ctx), { children, projectPoint } = layout;
	for (const feature of features) {
		const id = feature.properties.id || null;
		const point = layout.inset && ["US-AK", "US-HI"].includes(id) ? (lon, lat) => insetPoint(layout, id, lon, lat) : projectPoint;
		for (const ring of geometryRings(feature.geometry)) {
			const d = ringPath(ring, point);
			if (d) children.push(ctx.path(d, {
				fill: "none",
				stroke: c.border,
				"stroke-width": .7,
				meta: {
					kind: "geo-boundary",
					region: id,
					...layout.inset && ["US-AK", "US-HI"].includes(id) ? { inset: true } : {}
				}
			}));
		}
	}
	const valueField = enc.value, values = valueField ? rows.map((r) => r[valueField]).filter((v) => typeof v === "number" && Number.isFinite(v)) : [];
	if (values.some((v) => v < 0)) ctx.fit("geo-scatter value 不可为负数", "协议规定非负数值按面积映射；修正 value");
	const valueDomain = valueField ? ctx.field(valueField).domain : null;
	const min = valueDomain?.length === 2 && valueDomain.every(Number.isFinite) ? valueDomain[0] : values.length ? Math.min(...values) : 0;
	const max = valueDomain?.length === 2 && valueDomain.every(Number.isFinite) ? valueDomain[1] : values.length ? Math.max(...values) : 0;
	const visible = [], outside = [];
	rows.forEach((row, index) => {
		const lon = row[enc.longitude], lat = row[enc.latitude], id = enc.id ? row[enc.id] : null, label = enc.label ? row[enc.label] : null;
		const stateInset = layout.inset && (lat > 50 && lon <= -129 ? "US-AK" : lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154 ? "US-HI" : null);
		const p = stateInset ? insetPoint(layout, stateInset, lon, lat) : projectPoint(lon, lat), hasValue = !!valueField && typeof row[valueField] === "number" && Number.isFinite(row[valueField]);
		const beyondBounds = !stateInset && (lon < layout.bounds.west || lon > layout.bounds.east || lat < layout.bounds.south || lat > layout.bounds.north);
		if (!p || beyondBounds || p[0] < 0 || p[0] > layout.width || p[1] < 0 || p[1] > layout.height - layout.bottom) {
			outside.push(label || id || `#${index + 1}`);
			return;
		}
		if (hasValue && row[valueField] === 0) {
			visible.push({
				index,
				label,
				id,
				value: 0,
				zero: true
			});
			return;
		}
		const value = hasValue ? row[valueField] : null, radius = hasValue && max > 0 ? Math.sqrt(value / max) * 9 : 4.5;
		children.push(ctx.circle(p[0], p[1], radius, {
			fill: c.high,
			"fill-opacity": .85,
			stroke: c.ink,
			"stroke-width": 1,
			meta: {
				kind: "geo-scatter",
				...id != null ? { id } : {},
				...label != null ? { label } : {},
				value
			}
		}));
		visible.push({
			index,
			label,
			id,
			value,
			zero: false
		});
	});
	if (valueField) bottomLegend(children, ctx, layout, min, max, valueField, true);
	const indexY = layout.height - layout.bottom + INDEX_TOP, localized = ctx.lang.startsWith("en");
	children.push(ctx.text(24, indexY, localized ? "Locations" : "地点索引", {
		size: 12,
		weight: 600,
		fill: c.ink
	}));
	const columns = layout.width < 420 ? 1 : 2;
	const shown = visible.slice(0, INDEX_CAP);
	const omitted = visible.length - shown.length;
	const columnWidth = Math.max(96, (layout.width - 48) / columns - 12);
	let indexBottom = indexY + 8;
	const columnHeights = Array.from({ length: columns }, () => indexY + 20);
	shown.forEach((item, i) => {
		const column = i % columns;
		const x = 24 + column * ((layout.width - 48) / columns);
		const y = columnHeights[column];
		const name = item.label || item.id || `#${item.index + 1}`;
		const readout = item.zero ? localized ? `${formattedValue(ctx, 0, valueField)} (no marker)` : `${formattedValue(ctx, 0, valueField)}（无点）` : item.value == null ? localized ? "no value" : "无数值" : formattedValue(ctx, item.value, valueField);
		const lines = ctx.wrap(`${name} · ${readout}`, columnWidth, 12, 400);
		lines.forEach((line, lineIndex) => children.push(ctx.text(x, y + lineIndex * INDEX_ROW, line, {
			size: 12,
			fill: c.ink,
			meta: lineIndex === 0 ? {
				kind: "geo-scatter-index",
				id: item.id,
				label: name,
				value: item.value
			} : void 0
		})));
		columnHeights[column] = y + lines.length * INDEX_ROW;
		indexBottom = Math.max(indexBottom, columnHeights[column]);
	});
	if (omitted > 0) {
		const more = localized ? `and ${omitted} more` : `另有 ${omitted} 处`;
		children.push(ctx.text(24, indexBottom + 4, more, {
			size: 12,
			fill: c.muted,
			meta: {
				kind: "geo-scatter-more",
				omitted
			}
		}));
		indexBottom += 20;
	}
	const reservedIndex = layout.bottom - INDEX_TOP;
	const usedIndex = indexBottom - indexY + 16;
	if (usedIndex > reservedIndex) layout.height += usedIndex - reservedIndex;
	if (outside.length) {
		const outsideY = indexBottom + 8;
		const outsideLines = ctx.wrap(`${localized ? "Outside map bounds" : "不在地图范围"}: ${outside.join(", ")}`, Math.max(120, layout.width - 48), 12, 400);
		outsideLines.forEach((line, lineIndex) => children.push(ctx.text(24, outsideY + lineIndex * INDEX_ROW, line, {
			size: 12,
			fill: c.muted,
			meta: lineIndex === 0 ? {
				kind: "geo-scatter-outside",
				ids: outside
			} : void 0
		})));
		layout.height += outsideLines.length * INDEX_ROW + 8;
	}
	mapCredit(children, ctx, layout, spec);
	return {
		width: layout.width,
		height: layout.height,
		title: spec.title || "Geographic scatter",
		children
	};
}
function install({ register }) {
	register("choropleth", choropleth);
	register("geo-scatter", scatter);
}
install({ register });
var maps = Object.freeze({
	project,
	featuresFor
});
export { install, maps, maps_exports };
