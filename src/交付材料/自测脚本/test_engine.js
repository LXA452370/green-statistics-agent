/* Node 单元测试：node test_engine.js */
const fs = require('fs');
const path = require('path');
const GL = require('../../绿账本_在线智能体/assets/engine.js');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const DATA = path.join(__dirname, '..', '..', '绿账本_在线智能体', 'data');
const baseText = fs.readFileSync(path.join(DATA, 'sample_base.csv'), 'utf8');
const dirtyText = fs.readFileSync(path.join(DATA, 'sample_dirty.csv'), 'utf8');

section('1. CSV 解析');
const base = GL.parseCSV(baseText);
ok(base.headers.length === 10, '规范数据 10 列', base.headers.length);
ok(base.rows.length === 730, '规范数据 730 行', base.rows.length);
ok(base.headers[0] === '机房', '首列表头正确', base.headers[0]);

const dirty = GL.parseCSV(dirtyText);
ok(dirty.rows.length === 152, '脏数据 152 行', dirty.rows.length);

section('2. 表头识别');
const qa = GL.audit(base.headers, base.rows);
ok(qa.mapping.site != null, '识别出站点列');
ok(qa.mapping.date != null, '识别出日期列');
ok(qa.mapping.it_kwh != null, '识别出 IT 能耗列（带单位括号）');
ok(qa.mapping.total_kwh != null, '识别出总能耗列');
ok(qa.mapping.pue != null, '识别出 PUE 列');
ok(qa.mapping.green_kwh != null, '识别出绿电列');

section('3. 规范数据体检');
ok(qa.health.score >= 95, '健康分 ≥ 95', qa.health.score);
ok(qa.dups === 0, '无重复行', qa.dups);
ok(qa.unitPlans.length === 0, '无单位混用', qa.unitPlans.length);

section('4. 脏数据体检');
const qb = GL.audit(dirty.headers, dirty.rows);
ok(qb.dups === 12, '检出 12 行完全重复', qb.dups);
ok(qb.unitPlans.length >= 1, '检出单位混用', qb.unitPlans.map(u => u.rows));
ok(qb.logic.pueBad >= 2, '检出至少 2 个 PUE 越界', qb.logic.pueBad);
ok(qb.logic.greenGtTotal >= 2, '检出绿电 > 总用电', qb.logic.greenGtTotal);
ok(qb.logic.totalLtIt >= 1, '检出总能耗 < IT 能耗', qb.logic.totalLtIt);
ok(qb.missingCells >= 14, '检出缺失单元格 ≥ 14', qb.missingCells);
ok(qb.datePlan && Object.keys(qb.datePlan.formats).length >= 2, '检出多种日期格式', qb.datePlan && qb.datePlan.formats);
ok(qb.health.score < 85, '脏数据健康分偏低', qb.health.score);

section('5. 清洗计划');
const plan = GL.makePlan(qb);
ok(plan.steps.some(s => s.id === 'unit'), '计划包含单位统一步骤');
ok(plan.steps.some(s => s.id === 'dedup'), '计划包含去重步骤');
ok(plan.steps.some(s => s.id === 'date'), '计划包含日期规范步骤');
ok(plan.steps.some(s => s.id === 'outlier'), '计划包含异常标记步骤');

section('6. 执行清洗');
const clean = GL.execute(qb, plan);
ok(clean.rows.length === 140, '去重后 140 行', clean.rows.length);
ok(clean.stats.removedRows === 12, '删除 12 行', clean.stats.removedRows);
ok(clean.stats.unitFixed >= 20, '单位修正 ≥ 20 行', clean.stats.unitFixed);
ok(clean.after.score > clean.before.score, '健康分提升', [clean.before.score, clean.after.score]);
ok(clean.rows.every(r => r.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(r.date)), '日期全部 ISO 化');
const bigTotal = clean.rows.filter(r => r.total_kwh != null && r.total_kwh > 100000);
ok(bigTotal.length === 0, '不存在未换算的 MWh 量级总能耗', bigTotal.length);
const pueOut = clean.rows.filter(r => r.pue != null && (r.pue < 1 || r.pue > 3));
ok(pueOut.length === 2, '越界 PUE 被保留并标记（2 行）', pueOut.length);
ok(pueOut.every(r => r.flag.indexOf('PUE越界') >= 0), '越界行带有标记');

section('7. 指标计算');
const mt = GL.metrics(clean, { factor: 0.5703 });
ok(mt.pue.mean >= 1.2 && mt.pue.mean <= 1.95, '平均 PUE 落在合理区间', mt.pue.mean);
ok(mt.green.ratio > 0.02 && mt.green.ratio <= 1, '绿电占比合理', mt.green.ratio);
ok(mt.carbon.tco2 > 0, '碳排 > 0', mt.carbon.tco2);
ok(mt.months.length >= 2, '月度序列 ≥ 2 个月', mt.months.length);
ok(Math.abs(mt.carbon.tco2 - mt.energy.total_kwh / 1000 * 0.5703) < 0.2, '碳排公式自洽', [mt.carbon.tco2, mt.energy.total_kwh / 1000 * 0.5703]);

section('8. 报告生成');
const md = GL.buildReport({ quality: qb, clean, metrics: mt, plan, opts: { fileName: 'sample_dirty.csv' } });
ok(md.indexOf('## 7. 口径与来源') >= 0, '报告含口径与来源章节');
ok(md.indexOf('0.5703') >= 0, '报告写明了排放因子');
ok(md.indexOf('## 5. 异常清单') >= 0, '报告含异常清单');
ok(/\d/.test(md), '报告含数字');

section('9. 边界情况');
const empty = GL.parseCSV('');
ok(empty.headers.length === 0, '空文件不崩溃');
const one = GL.parseCSV('日期,总能耗\n2025-01-01,1000');
const q1 = GL.audit(one.headers, one.rows);
ok(q1.n === 1, '单行数据可体检');
const p1 = GL.makePlan(q1);
const c1 = GL.execute(q1, p1);
ok(c1.rows.length === 1, '单行数据可清洗');
const badText = '这是一段说明文字，不是表格\n第二行';
const bad = GL.parseCSV(badText);
const qb2 = GL.audit(bad.headers, bad.rows);
ok(qb2.mapping.security === undefined, '非表格数据不误判字段');

section('10. 日期解析');
ok(GL.parseDate('2025/1/5').iso === '2025-01-05', '2025/1/5');
ok(GL.parseDate('2025-01-05 12:30:00').iso === '2025-01-05', '带时间');
ok(GL.parseDate('2025年3月8日').iso === '2025-03-08', '中文日期');
ok(GL.parseDate('13/05/2025').iso === '2025-05-13', '日>12 时按 D/M/Y');
ok(GL.parseDate('05/01/2025').iso === '2025-05-01', '歧义按 M/D/Y 并在计划中提示');

section('11. GBK 编码解析');
const gbkBuf = fs.readFileSync(path.join(DATA, 'sample_gbk.csv'));
let gbkText = null;
try { gbkText = new TextDecoder('gbk').decode(gbkBuf); } catch (e) { gbkText = null; }
if (gbkText) {
  const g = GL.parseCSV(gbkText);
  ok(g.headers[0] === '机房', 'GBK 解码后表头正确', g.headers[0]);
} else {
  console.log('  ! Node 运行时不支持 gbk 解码，跳过（浏览器端 TextDecoder 支持）');
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
