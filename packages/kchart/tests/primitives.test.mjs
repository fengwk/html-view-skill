import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as format from '../src/core/format.js';
import * as scale from '../src/core/scale.js';
import * as text from '../src/core/text.js';
import * as geometry from '../src/core/geometry.js';

const plain = (value) => JSON.parse(JSON.stringify(value));

// 意图：锁定舍入进位后升级缩写单位，并保证百分比参数按百分数点而非比例值解释。
test('formatters round half-up across English M and Chinese 万 thresholds', () => {
  const en = format.makeFormatters('en'); en.decimals = 1;
  assert.equal(format.formatValue(999960, null, en), '1.0M');
  assert.equal(format.formatValue(999999999, null, format.makeFormatters('zh-CN')), '10.0亿');
  const zh = format.makeFormatters('zh-CN'); zh.decimals = 1;
  assert.equal(format.formatValue(99996, null, zh), '10.0万');
  assert.equal(format.formatPercent(12.5, en, 0), '13%');
});

// 意图：固定 intervals 必须精确生成区间数，且整轴标签共用缩写单位与最少小数位。
test('fixed scale interval count and formatted ticks stay consistent', () => {
  const result = scale.niceScale(0, 1000000, { intervals: 4 });
  assert.equal(result.ticks.length, 5);
  assert.deepEqual(plain(format.tickTexts(result.ticks, result.step, format.makeFormatters('en'))), ['0', '0.25M', '0.5M', '0.75M', '1M']);
  assert.equal(scale.decimalsFor(0.25), 2);
});

// 意图：短宽文本断行需缓存稳定 token 测量，连字符/斜杠分段且中文标点禁则不丢字符。
test('wrapText breaks long temporal tokens and preserves CJK kinsoku', () => {
  const measured = [];
  const measure = (value) => { measured.push(value); return [...value].length * 5; };
  const input = '2026-01/02 中文（测试），结束';
  const lines = text.wrapText(input, 30, { size: 12, weight: 400 }, measure);
  assert.equal(lines.join('').replace(/\s/g, ''), input.replace(/\s/g, ''));
  assert.ok(lines.some((line) => line.endsWith('-') || line.endsWith('/')));
  assert.ok(lines.every((line) => !/^[）)］】」，、]/.test(line) && !/[（(［【]$/.test(line)));
  assert.equal(measured.length, new Set(measured).size);
});

// 意图：最大余数分配的整数结果必须守恒，并在同余数时维持原顺序。
test('apportion conserves total with deterministic ties', () => {
  assert.deepEqual(plain(geometry.apportion([1, 1, 1], 5)), [2, 2, 1]);
  assert.equal(geometry.barPath(0, 0, 2, 1, 0, 'all'), 'M0,0H2V1H0Z');
});
