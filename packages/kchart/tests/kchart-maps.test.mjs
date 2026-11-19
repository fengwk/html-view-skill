import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install, maps } from '../src/chart/maps.js';
import { loadChart } from './kchart-fixture.mjs';

const { api } = loadChart([install]);
const K = { ...api, maps };
const square = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2], [x, y]]] });
const fc = (features) => ({ type: 'FeatureCollection', features });
const feature = (id, name, x, y) => ({ type: 'Feature', properties: { id, name }, geometry: square(x, y) });

// 意图：窄图尺寸图例按数值、单位与面积说明的实测整体宽度扩展地图画布。
test('geo-scatter reserves measured size-legend width on a narrow scene', () => {
  const world = fc([feature('region', 'Region', 0, 0)]);
  const scene = K.layout({
    chart: 'geo-scatter', data: { map: { asset: 'world' }, rows: [
      { longitude: 0.2, latitude: 0.2, value: 0.01003 }, { longitude: 1.2, latitude: 0.8, value: 0.9983 },
    ] }, encode: { longitude: 'longitude', latitude: 'latitude', value: 'value' },
    fields: { value: { unit: 'items', decimals: 5, domain: [0.01003, 0.9983] } },
  }, { width: 255, lang: 'en', assets: { world } });
  assert.equal(scene.overflow, undefined);
});

// 意图：确保内置离线数据由调用方显式注入，键采用数据的准确properties.id且不通过名称猜测匹配。
test('offline map assets render only when injected and choropleth joins exact ids', () => {
  const world = JSON.parse(readFileSync(new URL('../assets/maps/world.geojson', import.meta.url), 'utf8'));
  const ids = new Set(world.features.map((item) => item.properties.id));
  assert.equal(world.features.length, 242);
  assert.ok(ids.has('KOS')); // 此数据集含扩展ADM0_A3代码，不能声称全为ISO。
  const spec = { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'KOS', value: 0 }] }, encode: { region: 'region', value: 'value' } };
  assert.throws(() => K.layout(spec), (error) => error.code === 'CHART_FIT' && /缺少注入/.test(error.message));
  const scene = K.layout(spec, { assets: { world } });
  assert.ok(scene.children.some((node) => node.tag === 'path' && node.meta?.region === 'KOS' && node.meta?.value === 0));

  const explicit = fc([feature('exact-id', 'Display Name', 0, 0), feature('other-id', 'Another Name', 5, 0)]);
  const exactSpec = { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'Display Name', value: 0 }] }, encode: { region: 'region', value: 'value' } };
  assert.throws(() => K.layout(exactSpec, { assets: { world: explicit } }), (error) => error.code === 'CHART_FIT' && /地区键/.test(error.message));
  const keyedSpec = { ...exactSpec, data: { ...exactSpec.data, rows: [{ region: 'exact-id', value: 0 }] } };
  const keyed = K.layout(keyedSpec, { assets: { world: explicit } }).children.filter((node) => node.tag === 'path' && node.meta?.region);
  assert.equal(keyed.find((node) => node.meta.region === 'exact-id').meta.value, 0);
  assert.equal(keyed.find((node) => node.meta.region === 'exact-id').meta.kind, 'choropleth');
  assert.equal(keyed.find((node) => node.meta.region === 'exact-id').meta.label, 'Display Name');
  assert.equal(keyed.find((node) => node.meta.region === 'other-id').meta.value, null);
  // 无数据地区留页面底色，边界与有数据地区是同一条发丝线，不再用大量虚线制造噪点。
  assert.equal(keyed.find((node) => node.meta.region === 'other-id').attrs.fill, K.util.context().palette.bg);
  assert.equal(new Set(keyed.map((node) => node.attrs.stroke)).size, 1);
  assert.ok(keyed.every((node) => node.attrs.stroke !== '#fff' && node.attrs['stroke-dasharray'] == null));
  assert.notEqual(keyed.find((node) => node.meta.region === 'exact-id').attrs.fill, keyed.find((node) => node.meta.region === 'other-id').attrs.fill);
  const xs = keyed.flatMap((node) => [...node.attrs.d.matchAll(/[ML](-?[0-9.]+),/g)].map((match) => Number(match[1])));
  assert.ok(Math.max(...xs) - Math.min(...xs) > 500); // small external GeoJSON bounds are fitted, not squeezed into world extents.
  assert.throws(() => K.layout({ ...keyedSpec, data: { ...keyedSpec.data, rows: [{ region: 'exact-id', value: 1 }, { region: 'exact-id', value: 2 }] } }, { assets: { world: explicit } }), (error) => error.code === 'CHART_FIT' && /重复/.test(error.message));
  assert.throws(() => K.layout(keyedSpec, { assets: { world: fc([{ type: 'Feature', properties: { id: 'broken' }, geometry: { type: 'Polygon', coordinates: [] } }]) } }), (error) => error.code === 'CHART_FIT' && /非法坐标环/.test(error.message));

  const crossing = fc([{
    type: 'Feature', properties: { id: 'dateline' },
    geometry: { type: 'Polygon', coordinates: [[[170, 10], [-170, 10], [-170, 20], [170, 20], [170, 10]], [[175, 12], [-175, 12], [-175, 18], [175, 18], [175, 12]]] },
  }]);
  const crossingSpec = { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [] }, encode: { region: 'region', value: 'value' } };
  const path = K.layout(crossingSpec, { assets: { world: crossing } }).children.find((node) => node.meta?.region === 'dateline');
  const commands = [...path.attrs.d.matchAll(/([ML])(-?[0-9.]+),(-?[0-9.]+)/g)];
  assert.ok((path.attrs.d.match(/M/g) || []).length >= 4); // clipped exterior plus clipped hole
  let previous = null;
  for (const match of commands) {
    const point = [Number(match[2]), Number(match[3])];
    if (match[1] === 'L') assert.ok(previous && Math.abs(point[0] - previous[0]) < 180);
    previous = point;
  }
});

// 意图：阿留申群岛西段在东经一侧，必须接在阿拉斯加小图内，不能落到美国本土上方或画框外。
test('Alaska inset keeps the Aleutians west of the 180th meridian inside its own cell', () => {
  const states = JSON.parse(readFileSync(new URL('../assets/maps/us-states.geojson', import.meta.url), 'utf8'));
  const spec = { chart: 'choropleth', data: { map: { asset: 'us-states' }, rows: [{ region: 'US-AK', value: 3 }, { region: 'US-HI', value: 5 }] }, encode: { region: 'region', value: 'value' } };
  for (const width of [268, 984]) {
    const scene = K.layout(spec, { width, assets: { 'us-states': states } });
    const xsOf = (region) => [...scene.children.find((node) => node.meta?.region === region).attrs.d.matchAll(/[ML](-?[0-9.]+),/g)].map((match) => Number(match[1]));
    const alaska = xsOf('US-AK'), hawaii = xsOf('US-HI');
    assert.ok(Math.min(...alaska) >= 0 && Math.max(...alaska) < Math.min(...hawaii), `${width}px: Alaska ${Math.min(...alaska)}..${Math.max(...alaska)} must stay left of Hawaii ${Math.min(...hawaii)}`);
  }
});

// 意图：画布高度跟随地图实际高度，扁宽地图上下不留空带；地点索引行数多时画布随之加高，索引、范围外说明与来源互不重叠。
test('map canvases follow the drawn map height and reserve room for every index row', () => {
  const wide = fc(Array.from({ length: 10 }, (_, i) => feature(`r${i}`, `R${i}`, i * 2, 0)));
  const choropleth = K.layout({ chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'r0', value: 1 }] }, encode: { region: 'region', value: 'value' } }, { width: 600, assets: { world: wide } });
  const mapBottom = Math.max(...choropleth.children.filter((node) => node.meta?.kind === 'choropleth').flatMap((node) => [...node.attrs.d.matchAll(/[ML]-?[0-9.]+,(-?[0-9.]+)/g)].map((match) => Number(match[1]))));
  assert.ok(choropleth.height - mapBottom <= 112 + 4 + 1, `legend follows the map directly: map bottom ${mapBottom}, height ${choropleth.height}`);
  const rows = Array.from({ length: 12 }, (_, i) => ({ lon: i % 2 ? 1 : 30, lat: 1, value: i + 1, name: `点${i + 1}` }));
  const scene = K.layout({ chart: 'geo-scatter', data: { map: { asset: 'world' }, rows }, encode: { longitude: 'lon', latitude: 'lat', value: 'value', label: 'name' } }, { width: 600, assets: { world: wide } });
  const all = (nodes) => nodes.flatMap((node) => [node, ...all(node.children || [])]);
  const texts = all(scene.children).filter((node) => node.tag === 'text' && ['geo-scatter-index', 'geo-scatter-outside', 'map-source'].includes(node.meta?.kind));
  assert.ok(texts.some((node) => node.meta.kind === 'geo-scatter-outside'), 'points beyond the map bounds are listed');
  assert.ok(texts.every((node) => node.attrs.y <= scene.height - 4), 'every index line stays inside the canvas');
  const rowsY = [...new Set(texts.map((node) => node.attrs.y))].sort((a, b) => a - b);
  assert.ok(rowsY.every((y, i) => i === 0 || y - rowsY[i - 1] >= 16), `index, outside and source lines keep a full line apart: ${rowsY.join('/')}`);
});

// 意图：覆盖投影有效范围、散点场景、经纬网和缺失值样式；Mercator极区裁剪不可生成无限坐标。
test('projection helpers and geo-scatter produce finite offline scenes with graticule and legend', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(K.maps.project(10, 20))), [10 * Math.PI / 180, 20 * Math.PI / 180]);
  assert.equal(K.maps.project(181, 0), null);
  const mercator = K.maps.project(0, 90, 'mercator');
  assert.ok(mercator.every(Number.isFinite));
  const map = fc([feature('land', 'Land', -1, -1)]);
  const spec = { chart: 'geo-scatter', data: { map: { asset: 'world' }, rows: [{ lon: 0, lat: 0, value: 0, name: 'zero' }, { lon: 0.5, lat: 0.5, value: null, name: 'missing' }] }, encode: { longitude: 'lon', latitude: 'lat', value: 'value', label: 'name' } };
  const scene = K.layout(spec, { width: 600, assets: { world: map } });
  assert.equal(scene.width, 600);
  assert.ok(scene.children.some((node) => node.tag === 'line')); // graticule
  assert.equal(scene.children.filter((node) => node.tag === 'circle' && node.meta?.kind === 'geo-scatter').length, 1); // zero is intentionally not rendered as a point
  assert.equal(scene.children.filter((node) => node.meta?.kind === 'geo-scatter-index').length, 2);
  assert.ok(scene.children.some((node) => node.tag === 'text' && node.text === '地点索引')); // legend/index
  // 来源说明可按宽度换行为文本组，需递归确认其仍带语义标记。
  const all = (nodes) => nodes.flatMap((node) => [node, ...all(node.children || [])]);
  assert.ok(all(scene.children).some((node) => node.meta?.kind === 'map-source'));
  const mercatorScene = K.layout(spec, { width: 600, assets: { world: map, projection: 'mercator' } });
  assert.ok(mercatorScene.children.filter((node) => node.tag === 'circle').every((node) => Number.isFinite(node.attrs.cx) && Number.isFinite(node.attrs.cy)));
  const svg = K.renderScene(scene);
  assert.match(svg, /data-kc-label="zero"/);
  assert.match(svg, /地图来源：Natural Earth/);
});

// 意图：用显式domain/单位和暗色主题验证choropleth不按观测值重缩放，且缺失与真实0有独立样式。
test('domain, unit and palette drive a theme-aware choropleth legend and distinguish no-data', () => {
  const data = fc([feature('a', 'Alpha', 0, 0), feature('b', 'Beta', 3, 0)]);
  const spec = { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'a', value: 0 }] }, encode: { region: 'region', value: 'value' }, fields: { value: { domain: [0, 100], unit: 'km' } } };
  const scene = K.layout(spec, { assets: { world: data }, theme: 'obsidian', lang: 'en' });
  const a = scene.children.find((node) => node.meta?.kind === 'choropleth' && node.meta.region === 'a');
  const b = scene.children.find((node) => node.meta?.kind === 'choropleth' && node.meta.region === 'b');
  assert.equal(a.meta.value, 0);
  // 色阶从淡强调色起步：真实 0 仍有可见底色，且比色阶高端更接近页面底色。
  const palette = K.util.context({ theme: 'obsidian' }).palette;
  assert.notEqual(a.attrs.fill, palette.bg);
  assert.ok(K.util.contrast(a.attrs.fill, palette.bg) < K.util.contrast(palette.accent, palette.bg));
  assert.equal(b.meta.value, null);
  assert.equal(b.attrs.fill, palette.bg);
  assert.notEqual(a.attrs.fill, b.attrs.fill);
  assert.ok(scene.children.some((node) => node.tag === 'text' && node.text === '0 km'));
  assert.ok(scene.children.some((node) => node.tag === 'text' && node.text === '100 km'));
  assert.ok(scene.children.some((node) => node.text?.includes('No data')));
});

// 意图：无字段label时不把裸encode字段名作为图例标题，并让窄choropleth尽量使用可用绘图区宽度。
test('narrow choropleth expands to its available width and never titles a legend with the raw field name', () => {
  const wide = fc([{ type: 'Feature', properties: { id: 'wide', name: 'Wide' }, geometry: { type: 'Polygon', coordinates: [[[-3, -1], [3, -1], [3, 1], [-3, 1], [-3, -1]]] } }]);
  const spec = { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'wide', value: 5 }] }, encode: { region: 'region', value: 'value' }, fields: { value: { unit: 'km' } } };
  const scene = K.layout(spec, { width: 324, assets: { world: wide } });
  const region = scene.children.find((node) => node.meta?.kind === 'choropleth');
  const xs = [...region.attrs.d.matchAll(/[ML](-?[0-9.]+),/g)].map((match) => Number(match[1]));
  const texts = scene.children.filter((node) => node.tag === 'text').map((node) => node.text);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 290, 'map shape uses nearly all available horizontal plot width');
  assert.ok(!texts.includes('value'), 'the raw encode field name is not presented as a legend title');
  assert.ok(texts.includes('km'), 'field unit remains a useful fallback title');
});

// 意图：单值地理散点只画一个尺寸样例，并且地图图例标题取字段label而非原始encode字段名。
test('single-valued geo-scatter legend uses one marker and its field label', () => {
  const spec = {
    chart: 'geo-scatter',
    data: { map: { asset: 'world' }, rows: [{ lon: 0, lat: 0, magnitude: 2, name: '唯一点' }] },
    encode: { longitude: 'lon', latitude: 'lat', value: 'magnitude', label: 'name' },
    fields: { magnitude: { label: '事件规模', unit: '次' } },
  };
  const scene = K.layout(spec, { width: 324, assets: { world: fc([feature('local', 'Local', -1, -1)]) } });
  const legendMarkers = scene.children.filter((node) => node.meta?.kind === 'geo-scatter-size-legend');
  assert.equal(legendMarkers.length, 1, 'min=max must not duplicate the same-size marker');
  assert.ok(scene.children.some((node) => node.tag === 'text' && node.text === '事件规模'));
  // 汉字单位紧接数字，与报表和其他图表同一格式正本。
  assert.ok(scene.children.some((node) => node.tag === 'text' && node.text === '2次'));
});

// 意图：检验scatter面积正比value、0不造点、缺失默认圆、外域点告知且索引保留名称/单位。
test('geo-scatter maps nonnegative values to marker area, shows missing readouts and flags out-of-map rows', () => {
  const map = fc([feature('local', 'Local', 0, 0)]);
  const spec = { chart: 'geo-scatter', data: { map: { asset: 'world' }, rows: [
    { lon: 0, lat: 0, value: 0, name: 'Zero', id: 'z' },
    { lon: 1, lat: 1, value: 25, name: 'Quarter', id: 'q' },
    { lon: 2, lat: 2, value: 100, name: 'Full', id: 'f' },
    { lon: 1.5, lat: 1.5, value: null, name: 'Unknown', id: 'u' },
    { lon: 100, lat: 0, value: 50, name: 'Outside', id: 'o' },
  ] }, encode: { longitude: 'lon', latitude: 'lat', value: 'value', label: 'name', id: 'id' }, fields: { value: { domain: [0, 100], unit: 'km' } } };
  const scene = K.layout(spec, { width: 600, assets: { world: map }, theme: 'terminal' });
  const points = scene.children.filter((node) => node.meta?.kind === 'geo-scatter');
  assert.deepEqual(JSON.parse(JSON.stringify(points.map((node) => node.meta.id))), ['q', 'f', 'u']);
  assert.equal(points[0].attrs.r ** 2 / points[1].attrs.r ** 2, 0.25);
  assert.ok(Math.abs(Math.abs(points[0].attrs.cx - points[1].attrs.cx) - Math.abs(points[0].attrs.cy - points[1].attrs.cy)) < 0.01); // equal angular deltas preserve aspect ratio
  assert.equal(points[2].attrs.r, 4.5); // missing values use a consistent default marker
  assert.ok(scene.children.some((node) => node.meta?.kind === 'geo-scatter-index' && node.meta.label === 'Zero'));
  assert.ok(scene.children.some((node) => node.meta?.kind === 'geo-scatter-outside' && node.meta.ids.includes('Outside')));
  assert.ok(scene.children.some((node) => node.text?.includes('25 km')));
  assert.throws(() => K.layout({ ...spec, data: { ...spec.data, rows: [{ lon: 0, lat: 0, value: -1, name: 'Negative', id: 'n' }] } }, { assets: { world: map } }), (error) => error.code === 'CHART_FIT' && /不可为负数/.test(error.message));
});

// 意图：保障美国州界采用exact-key匹配且AK/HI州界和散点使用同一渲染层inset，不修改原始坐标。
test('US-state scene renders Alaska and Hawaii as separate insets', () => {
  const states = JSON.parse(readFileSync(new URL('../assets/maps/us-states.geojson', import.meta.url), 'utf8'));
  assert.equal(states.features.length, 50);
  const spec = { chart: 'choropleth', data: { map: { asset: 'us-states' }, rows: [{ region: 'US-AK', value: 2 }, { region: 'US-HI', value: 0 }] }, encode: { region: 'region', value: 'value' } };
  const ak = states.features.find((item) => item.properties.id === 'US-AK');
  const coordinatesBefore = JSON.stringify(ak.geometry.coordinates);
  const scene = K.layout(spec, { assets: { 'us-states': states } });
  for (const id of ['US-AK', 'US-HI']) {
    const inset = scene.children.filter((node) => node.meta?.region === id && node.meta.inset === true);
    assert.equal(inset.length, 1);
    const x = [...inset[0].attrs.d.matchAll(/[ML](-?[0-9.]+),/g)].map((match) => Number(match[1]));
    assert.ok(x.every((value) => value >= 0 && value <= scene.width));
  }
  assert.equal(JSON.stringify(ak.geometry.coordinates), coordinatesBefore);
  const scatterSpec = { chart: 'geo-scatter', data: { map: { asset: 'us-states' }, rows: [{ lon: -149, lat: 61, name: 'Anchorage' }, { lon: -157, lat: 21, name: 'Honolulu' }, { lon: 0, lat: 0, name: 'Outside' }] }, encode: { longitude: 'lon', latitude: 'lat', label: 'name' } };
  const scatter = K.layout(scatterSpec, { assets: { 'us-states': states } });
  const markers = scatter.children.filter((node) => node.meta?.kind === 'geo-scatter');
  assert.equal(markers.length, 2);
  assert.ok(scatter.children.some((node) => node.meta?.kind === 'geo-scatter-outside' && node.meta.ids.includes('Outside')));
  assert.ok(markers.every((node) => node.attrs.cx < scene.width));
});

// 意图：60 个长英文地点经过与画廊相同的缓存测宽轮次后快速收敛；索引换行而不省略，每条末尾的数值仍可见。
test('geo-scatter long English labels converge with a stateful measurement cache', () => {
  const map = fc([{ type: 'Feature', properties: { id: 'land', name: 'Land' }, geometry: square(-20, -20) }]);
  map.features[0].geometry.coordinates[0] = [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]];
  const rows = Array.from({ length: 60 }, (_, i) => ({
    longitude: -10 + (i % 40) * 0.45, latitude: -10 + Math.floor(i / 40) * 0.5,
    value: i + 1, name: `Long regional procurement location ${String(i + 1).padStart(2, '0')} with international partnerships`,
  }));
  const spec = { chart: 'geo-scatter', data: { map: { asset: 'world' }, rows }, encode: { longitude: 'longitude', latitude: 'latitude', value: 'value', label: 'name' } };
  const measured = new Map();
  let passes = 0, finalScene;
  for (; passes < 6; passes += 1) {
    const pending = new Map();
    const measure = (text, size = 12, weight = 400) => {
      const key = `${size}/${weight}/${text}`;
      if (!measured.has(key)) pending.set(key, { text, size, weight });
      return measured.get(key) ?? Math.max(1, [...text].length * size * 0.55);
    };
    finalScene = K.layout(spec, { width: 794, lang: 'en', assets: { world: map }, measure });
    if (!pending.size) break;
    for (const [key, entry] of pending) measured.set(key, [...entry.text].length * entry.size * 0.48);
  }
  assert.ok(passes < 4, `measurement should stabilize in at most four passes, took ${passes + 1}`);
  assert.ok(finalScene.children.some(node => node.meta?.kind === 'geo-scatter-index' && node.meta.label === rows[0].name));
  const texts = finalScene.children.filter(node => node.tag === 'text').map(node => node.text);
  assert.ok(!texts.some(text => text.endsWith('…')), 'index entries wrap instead of being truncated');
  assert.ok(texts.some(text => /(^|\s)1$/.test(text)), 'the value at the end of the first entry stays visible');
  assert.ok(finalScene.children.some(node => node.meta?.kind === 'geo-scatter-more' && node.meta.omitted === 36));
});

// 意图：地点索引超过 24 条时截断并写明剩余数量，列内按实测宽度换行，索引文字留在场景内。
test('geo-scatter index caps a long place list and wraps each measured column', () => {
  const map = fc([{ type: 'Feature', properties: { id: 'land', name: 'Land' }, geometry: square(-20, -20) }]);
  map.features[0].geometry.coordinates[0] = [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]];
  const rows = Array.from({ length: 40 }, (_, i) => ({ lon: 0.2 + (i % 5) * 0.2, lat: 0.2 + Math.floor(i / 5) * 0.2, name: `地点名称很长需要换行${i}`, value: i + 1 }));
  const scene = K.layout({
    chart: 'geo-scatter', data: { map: { asset: 'world' }, rows },
    encode: { longitude: 'lon', latitude: 'lat', label: 'name', value: 'value' },
  }, { width: 280, assets: { world: map } });
  const all = (nodes) => nodes.flatMap((node) => [node, ...all(node.children || [])]);
  const index = all(scene.children).filter((node) => node.meta?.kind === 'geo-scatter-index');
  const more = all(scene.children).find((node) => node.meta?.kind === 'geo-scatter-more');
  const listed = new Set(index.map((node) => node.meta.label));
  assert.ok(listed.size > 0 && listed.size <= 24, `the index keeps at most the documented cap, got ${listed.size}`);
  assert.equal(more.meta.omitted, 40 - listed.size);
  assert.match(more.text, /另有/);
  assert.ok(all(scene.children).filter((node) => node.tag === 'text').every((node) => node.attrs.y <= scene.height));
});
