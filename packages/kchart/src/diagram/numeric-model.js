/* 数值图共用的“模型 → KChart 声明”骨架：声明校验、渲染与外框题名只在这里落地一次。

   每个数值图模块只负责自己的语法解析和源码行归属（lineFor），因为 ruled-out 的
   numeric-common 映射表不认识各图型新增的声明键。 */

import { error as issueAt } from './support.js';
import { validate as validateSpec } from '../chart/spec.js';
import { layout } from '../chart/registry.js';
import { ExpectedDiagnostic } from '../core/diagnostics.js';

// KChart 声明错误按图型自己的行归属回填到 Mermaid 源码位置。
function diagnostics(errors, info, lineFor) {
  return errors.map(detail => issueAt(
    info.lang,
    lineFor(detail) || info.firstLine,
    detail.message || 'KChart 声明无效',
    detail.message || 'Invalid KChart declaration',
    detail.fix || '修正图表声明',
    detail.fix || 'Correct the chart declaration',
  ));
}

function validateWith(spec, info, lineFor) {
  return diagnostics(validateSpec(spec).errors, info, lineFor);
}

// frame:false 时图族 Scene 自己画题名，避免共享外框重复一行。
function addVisibleHeader(scene, options) {
  if (options.renderOptions?.frame) return scene;
  const { ctx } = options;
  const heading = scene.heading || '';
  const subtitle = scene.subtitle || '';
  if (!heading && !subtitle) return scene;
  const available = Math.max(24, scene.width - 32), children = [];
  let top = 16, requiredWidth = scene.width;
  const paragraph = (text, size, weight) => {
    if (!text) return;
    const lines = ctx.wrap(text, available, size, weight), step = size + 6;
    requiredWidth = Math.max(requiredWidth, 32 + Math.max(0, ...lines.map(line => ctx.measure(line, size, weight))));
    children.push(ctx.textLines(16, top + size, lines, {
      leading: step, size, weight, fill: ctx.color(weight > 400 ? 'fg' : 'muted'),
    }));
    top += lines.length * step + 6;
  };
  paragraph(heading, 16, 650);
  paragraph(subtitle, 12, 400);
  top += 8;
  return {
    ...scene,
    width: requiredWidth,
    height: scene.height + top,
    children: [...children, ctx.el('g', { transform: `translate(0 ${top})` }, scene.children)],
  };
}

function renderWith(spec, options, info, lineFor) {
  const errors = validateWith(spec, info, lineFor);
  if (errors.length) return { width: options.width, height: 0, errors };
  const layoutOptions = {
    ...options.renderOptions,
    width: options.width,
    lang: info.lang,
    ...(!options.renderOptions?.measure && options.measure ? {
      measure: (text, size = 12, weight = 400) => options.measure(text, { size, weight }),
    } : {}),
  };
  try {
    // 图表族不画题名，只交给 <title>；frame:false 时由这里补回可见题名（与共享数值图一致）。
    const scene = addVisibleHeader(layout(spec, layoutOptions), options);
    return { width: scene.width, height: scene.height, scene, errors: [] };
  } catch (error) {
    if (!(error instanceof ExpectedDiagnostic)) throw error;
    return { width: options.width, height: 0, errors: diagnostics(error.errors || [], info, lineFor) };
  }
}

export { diagnostics, validateWith, renderWith };
