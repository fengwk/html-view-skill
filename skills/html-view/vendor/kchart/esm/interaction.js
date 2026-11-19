import { __exportAll } from "./_virtual/_rolldown/runtime.js";
import { fieldReader } from "./chart/fields.js";
// src/interaction.js
var interaction_exports = /* @__PURE__ */ __exportAll({ attach: () => attach });
var noop = () => {};
var getMeta = (el, key) => el?.getAttribute?.(`data-kc-${key}`) || "";
var all = (svg) => [svg, ...svg.querySelectorAll("*")];
var tokenList = (el) => {
	try {
		const value = JSON.parse(getMeta(el, "related") || "[]");
		return Array.isArray(value) ? value.map(String) : [];
	} catch {
		return [];
	}
};
var attach = (svg, spec = {}) => {
	const actions = Array.isArray(spec.interaction) ? spec.interaction : [];
	if (!actions.length) return noop;
	if (!svg || typeof svg.addEventListener !== "function" || !svg.ownerDocument) throw new TypeError("KChart.attach requires an SVG element");
	const doc = svg.ownerDocument, win = doc.defaultView;
	const language = (doc.documentElement.lang || "").toLowerCase();
	const chinese = language.startsWith("zh");
	const { format } = fieldReader(spec, language || "zh");
	const originalAttrs = new Map([
		"viewBox",
		"tabindex",
		"role",
		"aria-label"
	].map((name) => [name, svg.hasAttribute(name) ? svg.getAttribute(name) : null]));
	const changed = /* @__PURE__ */ new Map(), listeners = [], controls = [], resetters = [];
	const remember = (el, name) => {
		if (!changed.has(el)) changed.set(el, /* @__PURE__ */ new Map());
		const values = changed.get(el);
		if (!values.has(name)) values.set(name, el.hasAttribute(name) ? el.getAttribute(name) : null);
	};
	const set = (el, name, value) => {
		remember(el, name);
		if (value == null) el.removeAttribute(name);
		else el.setAttribute(name, value);
	};
	const restore = (el, name) => {
		const values = changed.get(el);
		if (!values?.has(name)) return;
		const value = values.get(name);
		if (value == null) el.removeAttribute(name);
		else el.setAttribute(name, value);
		values.delete(name);
		if (!values.size) changed.delete(el);
	};
	const restoreAll = () => {
		for (const [el, values] of changed) for (const [name, value] of values) if (value == null) el.removeAttribute(name);
		else el.setAttribute(name, value);
		changed.clear();
	};
	const listen = (el, name, fn, options) => {
		el.addEventListener(name, fn, options);
		listeners.push(() => el.removeEventListener(name, fn, options));
	};
	const stop = (event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const hit = (event) => event.target?.closest?.("[data-kc-kind], [data-kc-node], [data-kc-edge], [data-kc-path], [data-kc-record], [data-kc-series]");
	const items = () => all(svg).filter((el) => el !== svg);
	const identity = (el) => getMeta(el, "node") || getMeta(el, "path") || getMeta(el, "edge") || getMeta(el, "record") || getMeta(el, "series");
	const hasAncestorIdentity = (el) => {
		for (let parent = el.parentElement; parent && parent !== svg; parent = parent.parentElement) if (identity(parent)) return true;
		return false;
	};
	const labelFor = (el) => getMeta(el, "label") || el.textContent?.trim() || getMeta(el, "record") || getMeta(el, "node") || getMeta(el, "path") || "";
	let tooltip = null, readout = null, pinned = null, toolbar = null;
	const showReadout = (text) => {
		if (!readout) {
			readout = doc.createElement("div");
			readout.setAttribute("role", "status");
			readout.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483646;padding:8px 12px;border-radius:6px;background:var(--viz-bg,var(--surface,Canvas));color:var(--viz-fg,currentColor);border:1px solid currentColor;font:12px/1.4 sans-serif";
			doc.body.append(readout);
		}
		readout.textContent = text;
	};
	const describe = (el) => {
		const label = labelFor(el), raw = getMeta(el, "value"), series = getMeta(el, "series");
		let value = raw;
		if (raw !== "" && Number.isFinite(Number(raw))) {
			const chart = spec.chart;
			let field = chart === "threads" ? "path.value" : chart === "tree" || chart === "mindmap" ? "value" : null;
			if (chart === "network") field = getMeta(el, "edge") ? "edge.value" : "node.value";
			if (chart === "sankey") field = "edge.value";
			if (!field) {
				const encoded = spec.encode?.value;
				field = Array.isArray(encoded) ? encoded.find((name) => name === series) || encoded[0] : encoded;
				const idField = spec.encode?.id;
				if (idField && getMeta(el, "record")) {
					const row = spec.data?.find?.((item) => String(item[idField]) === getMeta(el, "record"));
					if (row && field) value = row[field];
				}
			}
			if (field) value = format(value == null ? null : Number(value), field);
		}
		return [
			label,
			series && series !== label ? series : "",
			raw !== "" ? `${chinese ? "值：" : "Value: "}${value}` : ""
		].filter(Boolean).join(" · ");
	};
	const showTip = (el, event) => {
		const text = describe(el);
		if (!text) return;
		if (!tooltip) {
			tooltip = doc.createElement("div");
			tooltip.id = `kc-tip-${Math.random().toString(36).slice(2)}`;
			tooltip.setAttribute("role", "tooltip");
			tooltip.style.cssText = "position:fixed;z-index:2147483647;max-width:360px;padding:8px 10px;border-radius:6px;background:var(--viz-bg,var(--surface,Canvas));color:var(--viz-fg,currentColor);border:1px solid currentColor;font:12px/1.4 sans-serif;pointer-events:none";
			doc.body.append(tooltip);
		}
		tooltip.textContent = text;
		const x = event?.clientX ?? 8, y = event?.clientY ?? 8;
		tooltip.style.left = `${Math.max(8, Math.min(x + 12, win.innerWidth - 380))}px`;
		tooltip.style.top = `${Math.max(8, Math.min(y + 12, win.innerHeight - 80))}px`;
		set(el, "aria-describedby", tooltip.id);
	};
	const hideTip = (el) => {
		if (el) restore(el, "aria-describedby");
		tooltip?.remove();
		tooltip = null;
	};
	const targetsFor = (target) => {
		const node = getMeta(target, "node"), path = getMeta(target, "path"), edge = getMeta(target, "edge");
		const related = new Set(tokenList(target));
		const threads = spec.chart === "threads" || getMeta(svg, "chart") === "threads";
		const edges = spec.data?.edges || [];
		const edgeForNodes = (el) => {
			const source = getMeta(el, "source"), dest = getMeta(el, "target");
			if (node && (source || dest)) return source === node || dest === node;
			const edgeData = edges.find((item) => String(item.id ?? `${item.source}->${item.target}`) === getMeta(el, "edge"));
			return !!(node && edgeData && (String(edgeData.source) === node || String(edgeData.target) === node));
		};
		return items().filter((el) => {
			if (hasAncestorIdentity(el)) return false;
			if (path) return getMeta(el, "path") === path;
			if (node) return getMeta(el, "node") === node || edgeForNodes(el) || threads && getMeta(el, "path") && related.has(getMeta(el, "path"));
			if (edge) return getMeta(el, "edge") === edge;
			const record = getMeta(target, "record"), series = getMeta(target, "series");
			if (record) return getMeta(el, "record") === record;
			if (series) return getMeta(el, "series") === series;
			return el === target;
		});
	};
	const clearFocus = () => {
		for (const el of items()) restore(el, "opacity");
		readout?.remove();
		readout = null;
	};
	const setFocus = (target) => {
		const active = new Set(targetsFor(target));
		for (const el of items()) {
			if (!identity(el) || hasAncestorIdentity(el)) continue;
			set(el, "opacity", active.has(el) ? "1" : ".18");
		}
		if (getMeta(svg, "chart") === "threads" || spec.chart === "threads") {
			const paths = items().filter((el) => getMeta(el, "kind") === "path" || getMeta(el, "path"));
			const selected = getMeta(target, "path") ? paths.filter((el) => getMeta(el, "path") === getMeta(target, "path")) : paths.filter((el) => tokenList(target).includes(getMeta(el, "path")) || tokenList(el).includes(getMeta(target, "node")));
			const weight = selected.reduce((sum, el) => sum + (Number(getMeta(el, "value")) || 0), 0);
			showReadout(chinese ? `路径 ${getMeta(target, "path") ? 1 : selected.length} 条${weight ? ` · 权重合计 ${weight}` : ""}` : `${getMeta(target, "path") ? 1 : selected.length} path(s)${weight ? ` · total weight ${weight}` : ""}`);
		}
	};
	const clear = () => {
		pinned = null;
		clearFocus();
		hideTip();
	};
	const togglePin = (el, event) => {
		if (pinned === el) {
			clear();
			return;
		}
		pinned = el;
		if (actions.includes("inspect")) showTip(el, event);
		if (actions.includes("focus") && identity(el)) setFocus(el);
	};
	if (actions.some((name) => [
		"inspect",
		"focus",
		"collapse",
		"drag"
	].includes(name))) {
		if (!svg.hasAttribute("tabindex")) set(svg, "tabindex", "0");
		for (const el of items()) {
			if (!hit({ target: el }) || hasAncestorIdentity(el)) continue;
			if (!el.hasAttribute("tabindex")) set(el, "tabindex", "0");
			if (!el.hasAttribute("role")) set(el, "role", "button");
			const label = describe(el);
			if (label && !el.hasAttribute("aria-label")) set(el, "aria-label", label);
		}
	}
	if (actions.includes("inspect")) {
		listen(svg, "pointerover", (event) => {
			const el = hit(event);
			if (el) showTip(el, event);
		});
		listen(svg, "pointerout", (event) => {
			const el = hit(event);
			if (el && pinned !== el && !el.contains(event.relatedTarget)) hideTip(el);
		});
		listen(svg, "focusin", (event) => {
			const el = hit(event);
			if (el) showTip(el, el.getBoundingClientRect());
		});
		listen(svg, "focusout", (event) => {
			const el = hit(event);
			if (el && pinned !== el) hideTip(el);
		});
	}
	if (actions.includes("focus")) {
		listen(svg, "pointerover", (event) => {
			const el = hit(event);
			if (!pinned && el && identity(el)) setFocus(el);
		});
		listen(svg, "pointerout", (event) => {
			const el = hit(event);
			if (!pinned && el && !el.contains(event.relatedTarget)) clearFocus();
		});
		listen(svg, "focusin", (event) => {
			const el = hit(event);
			if (!pinned && el && identity(el)) setFocus(el);
		});
	}
	if (actions.includes("inspect") || actions.includes("focus")) {
		listen(svg, "click", (event) => {
			const el = hit(event);
			if (el) togglePin(el, event);
			else clear();
		});
		listen(svg, "keydown", (event) => {
			const el = hit(event);
			if ((event.key === "Enter" || event.key === " ") && el) {
				stop(event);
				togglePin(el, el.getBoundingClientRect());
			}
		});
	}
	const insideLegend = (el) => {
		for (let parent = el.parentElement; parent && parent !== svg; parent = parent.parentElement) if (getMeta(parent, "kind") === "legend") return true;
		return false;
	};
	if (actions.includes("legend") && !spec.stack) for (const item of items().filter((el) => getMeta(el, "kind") === "legend" && getMeta(el, "series"))) {
		const series = getMeta(item, "series");
		if (!item.hasAttribute("tabindex")) set(item, "tabindex", "0");
		if (!item.hasAttribute("role")) set(item, "role", "button");
		set(item, "aria-pressed", item.getAttribute("aria-pressed") || "false");
		const toggle = () => {
			const hidden = item.getAttribute("aria-pressed") === "true";
			set(item, "aria-pressed", String(!hidden));
			for (const el of items()) {
				if (getMeta(el, "series") !== series || el === item || getMeta(el, "kind") === "legend" || insideLegend(el)) continue;
				if (hidden) restore(el, "display");
				else set(el, "display", "none");
			}
		};
		listen(item, "click", toggle);
		listen(item, "keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				stop(event);
				toggle();
			}
		});
	}
	const initialViewBox = svg.getAttribute("viewBox") || `0 0 ${svg.viewBox.baseVal.width || Number(svg.getAttribute("width")) || 1} ${svg.viewBox.baseVal.height || Number(svg.getAttribute("height")) || 1}`;
	let view = initialViewBox.trim().split(/[ ,]+/).map(Number), pan = null;
	if (actions.includes("pan-zoom")) {
		if (view.length !== 4 || view.some((n) => !Number.isFinite(n)) || view[2] <= 0 || view[3] <= 0) view = [
			0,
			0,
			1,
			1
		];
		const writeView = () => svg.setAttribute("viewBox", view.join(" "));
		const button = (label, delta) => {
			const b = doc.createElement("button");
			b.type = "button";
			b.textContent = label;
			b.setAttribute("aria-label", delta === 0 ? chinese ? "重置缩放" : "Reset zoom" : delta < 0 ? chinese ? "放大" : "Zoom in" : chinese ? "缩小" : "Zoom out");
			b.style.cssText = "font:12px sans-serif;padding:3px 7px;margin:2px";
			b.addEventListener("click", () => {
				if (!delta) view = initialViewBox.trim().split(/[ ,]+/).map(Number);
				else {
					const factor = delta < 0 ? .8 : 1.25;
					const cx = view[0] + view[2] / 2;
					const cy = view[1] + view[3] / 2;
					view[2] *= factor;
					view[3] *= factor;
					view[0] = cx - view[2] / 2;
					view[1] = cy - view[3] / 2;
				}
				writeView();
			});
			controls.push(b);
			return b;
		};
		toolbar = doc.createElement("div");
		toolbar.setAttribute("aria-label", chinese ? "图表视图控制" : "Chart view controls");
		toolbar.style.cssText = "position:fixed;right:4px;top:4px;z-index:2;display:flex";
		toolbar.append(button("+", -1), button("−", 1), button("↺", 0));
		doc.body.append(toolbar);
		controls.push(toolbar);
		listen(svg, "wheel", (e) => {
			stop(e);
			const factor = e.deltaY < 0 ? .9 : 1.1, r = svg.getBoundingClientRect();
			if (!r.width || !r.height) return;
			const x = view[0] + (e.clientX - r.left) / r.width * view[2], y = view[1] + (e.clientY - r.top) / r.height * view[3];
			view[0] = x - (x - view[0]) * factor;
			view[1] = y - (y - view[1]) * factor;
			view[2] *= factor;
			view[3] *= factor;
			writeView();
		}, { passive: false });
		listen(svg, "pointerdown", (e) => {
			if (e.target !== svg || e.button !== 0) return;
			pan = {
				x: e.clientX,
				y: e.clientY,
				view: [...view]
			};
			svg.setPointerCapture?.(e.pointerId);
		});
		listen(svg, "pointermove", (e) => {
			if (!pan) return;
			const r = svg.getBoundingClientRect();
			if (!r.width || !r.height) return;
			view[0] = pan.view[0] - (e.clientX - pan.x) / r.width * pan.view[2];
			view[1] = pan.view[1] - (e.clientY - pan.y) / r.height * pan.view[3];
			writeView();
		});
		listen(svg, "pointerup", () => {
			pan = null;
		});
		listen(svg, "pointercancel", () => {
			pan = null;
		});
		listen(svg, "keydown", (e) => {
			if (e.key === "+" || e.key === "=") {
				view[2] *= .8;
				view[3] *= .8;
				writeView();
			} else if (e.key === "-") {
				view[2] *= 1.25;
				view[3] *= 1.25;
				writeView();
			}
		});
	}
	if (actions.includes("collapse")) {
		const collapsed = /* @__PURE__ */ new Set();
		resetters.push(() => collapsed.clear());
		const toggles = items().filter((el) => getMeta(el, "kind") === "node" && tokenList(el).length);
		const descendants = (toggle) => {
			const found = /* @__PURE__ */ new Set(), pending = [...tokenList(toggle)];
			while (pending.length) {
				const id = pending.pop();
				if (found.has(id)) continue;
				found.add(id);
				const child = toggles.find((candidate) => getMeta(candidate, "node") === id);
				if (child) for (const descendant of tokenList(child)) pending.push(descendant);
			}
			return found;
		};
		const labels = /* @__PURE__ */ new Map();
		for (const label of items().filter((el) => getMeta(el, "kind") === "label" && getMeta(el, "node"))) {
			const id = getMeta(label, "node");
			if (!toggles.some((node) => getMeta(node, "node") === id)) continue;
			if (!labels.has(id)) labels.set(id, []);
			labels.get(id).push(label);
		}
		const applyCollapseVisibility = () => {
			for (const el of items()) {
				const nodeId = getMeta(el, "node"), pathId = getMeta(el, "path");
				if ([...collapsed].some((id) => {
					const toggle = toggles.find((candidate) => getMeta(candidate, "node") === id);
					if (!toggle || nodeId === id) return false;
					const subtree = descendants(toggle);
					return subtree.has(nodeId) || subtree.has(pathId);
				})) {
					set(el, "display", "none");
					set(el, "aria-hidden", "true");
					if (doc.activeElement === el) svg.focus();
				} else {
					restore(el, "display");
					restore(el, "aria-hidden");
				}
			}
		};
		const toggle = (node) => {
			const id = getMeta(node, "node");
			if (collapsed.has(id)) collapsed.delete(id);
			else collapsed.add(id);
			const expanded = String(!collapsed.has(id));
			set(node, "aria-expanded", expanded);
			for (const label of labels.get(id) || []) set(label, "aria-expanded", expanded);
			applyCollapseVisibility();
		};
		listen(svg, "click", (e) => {
			const target = e.target?.closest?.("[data-kc-node]");
			const node = target && toggles.find((candidate) => getMeta(candidate, "node") === getMeta(target, "node"));
			if (node) {
				e.stopPropagation();
				toggle(node);
			}
		});
		for (const node of toggles) {
			const id = getMeta(node, "node");
			if (!node.hasAttribute("tabindex")) set(node, "tabindex", "0");
			listen(node, "keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					stop(e);
					toggle(node);
				}
			});
			for (const label of labels.get(id) || []) listen(label, "keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					stop(e);
					toggle(node);
				}
			});
		}
	}
	const forceGeometry = actions.includes("drag") && spec.chart === "network" && spec.layout === "force" ? (() => {
		const nodes = /* @__PURE__ */ new Map();
		for (const el of items()) if (getMeta(el, "node")) {
			const circle = el.matches("circle") ? el : el.querySelector("circle[cx][cy]");
			if (!circle) continue;
			const cx = Number(circle.getAttribute("cx")), cy = Number(circle.getAttribute("cy")), r = Number(circle.getAttribute("r")) || 0;
			const center = svg.createSVGPoint();
			center.x = cx;
			center.y = cy;
			const edge = svg.createSVGPoint();
			edge.x = cx + r;
			edge.y = cy;
			const matrix = circle.getCTM();
			const centerSvg = matrix ? center.matrixTransform(matrix) : center, edgeSvg = matrix ? edge.matrixTransform(matrix) : edge;
			nodes.set(getMeta(el, "node"), {
				el,
				cx: centerSvg.x,
				cy: centerSvg.y,
				r: Math.hypot(edgeSvg.x - centerSvg.x, edgeSvg.y - centerSvg.y)
			});
		}
		return {
			nodes,
			paths: items().filter((el) => getMeta(el, "source") && getMeta(el, "target") && el.hasAttribute("d")).map((el) => ({
				el,
				d: el.getAttribute("d"),
				source: getMeta(el, "source"),
				target: getMeta(el, "target")
			}))
		};
	})() : null;
	const pointInSvg = (event) => {
		const point = svg.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		return point.matrixTransform(svg.getScreenCTM().inverse());
	};
	if (actions.includes("drag")) {
		let drag = null;
		listen(svg, "pointerdown", (e) => {
			let el = e.target?.closest?.("[data-kc-node]");
			if (!el || !getMeta(el, "node") || spec.chart !== "network" || spec.layout !== "force") return;
			const nodeId = getMeta(el, "node");
			for (let parent = el.parentElement; parent && parent !== svg; parent = parent.parentElement) if (getMeta(parent, "node") === nodeId) el = parent;
			const point = pointInSvg(e);
			drag = {
				el,
				x: point.x,
				y: point.y,
				transform: el.getAttribute("transform") || ""
			};
			try {
				el.setPointerCapture?.(e.pointerId);
			} catch {}
			stop(e);
		});
		listen(svg, "pointermove", (e) => {
			if (!drag) return;
			const point = pointInSvg(e), dx = point.x - drag.x, dy = point.y - drag.y;
			set(drag.el, "transform", `${drag.transform} translate(${dx} ${dy})`.trim());
			if (!forceGeometry) return;
			const id = getMeta(drag.el, "node");
			for (const path of forceGeometry.paths) {
				const source = forceGeometry.nodes.get(path.source), target = forceGeometry.nodes.get(path.target);
				if (!source || !target || path.source !== id && path.target !== id) continue;
				const sx = path.source === id ? dx : 0, sy = path.source === id ? dy : 0, tx = path.target === id ? dx : 0, ty = path.target === id ? dy : 0;
				const d = path.d;
				const n = "[-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?";
				const q = d.match(new RegExp(`^\\s*M\\s*(${n})[ ,]+(${n})\\s*Q\\s*(${n})[ ,]+(${n})[ ,]+(${n})[ ,]+(${n})\\s*$`, "i"));
				const line = d.match(new RegExp(`^\\s*M\\s*(${n})[ ,]+(${n})\\s*L\\s*(${n})[ ,]+(${n})\\s*$`, "i"));
				const atCircle = (x, y, node) => node.r > 0 && Math.abs(Math.hypot(x - node.cx, y - node.cy) - node.r) < Math.max(1, node.r * .2);
				const sxCenter = source.cx + sx, syCenter = source.cy + sy, txCenter = target.cx + tx, tyCenter = target.cy + ty;
				const angle = Math.atan2(tyCenter - syCenter, txCenter - sxCenter);
				const endpoint = (x, y, node, offsetX, offsetY, centerX, centerY, direction) => atCircle(x, y, node) ? [centerX + direction * Math.cos(angle) * node.r, centerY + direction * Math.sin(angle) * node.r] : [x + offsetX, y + offsetY];
				if (q) {
					const start = endpoint(Number(q[1]), Number(q[2]), source, sx, sy, sxCenter, syCenter, 1);
					const end = endpoint(Number(q[5]), Number(q[6]), target, tx, ty, txCenter, tyCenter, -1);
					set(path.el, "d", `M ${start[0]} ${start[1]} Q ${Number(q[3]) + (sx + tx) / 2} ${Number(q[4]) + (sy + ty) / 2} ${end[0]} ${end[1]}`);
				} else if (line) {
					const start = endpoint(Number(line[1]), Number(line[2]), source, sx, sy, sxCenter, syCenter, 1);
					const end = endpoint(Number(line[3]), Number(line[4]), target, tx, ty, txCenter, tyCenter, -1);
					set(path.el, "d", `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`);
				}
			}
		});
		resetters.push(() => {
			drag = null;
		});
		listen(svg, "pointerup", () => {
			drag = null;
		});
		listen(svg, "pointercancel", () => {
			drag = null;
		});
	}
	const reset = () => {
		clear();
		for (const resetter of resetters) resetter();
		pan = null;
		restoreAll();
		if (actions.includes("pan-zoom")) {
			view = initialViewBox.trim().split(/[ ,]+/).map(Number);
			const originalViewBox = originalAttrs.get("viewBox");
			if (originalViewBox == null) svg.removeAttribute("viewBox");
			else svg.setAttribute("viewBox", originalViewBox);
		}
	};
	if (actions.length) {
		listen(win, "beforeprint", () => {
			reset();
			if (toolbar) toolbar.hidden = true;
		});
		listen(win, "afterprint", () => {
			if (toolbar) toolbar.hidden = false;
		});
	}
	listen(svg, "keydown", (e) => {
		if (e.key === "Escape") clear();
	});
	listen(svg, "click", (e) => {
		if (e.target === svg) clear();
	});
	let cleaned = false;
	return () => {
		if (cleaned) return;
		cleaned = true;
		for (const remove of listeners.splice(0)) remove();
		clear();
		hideTip();
		controls.forEach((el) => el.remove());
		restoreAll();
		for (const [name, value] of originalAttrs) if (value == null) svg.removeAttribute(name);
		else svg.setAttribute(name, value);
	};
};
export { attach, interaction_exports };
