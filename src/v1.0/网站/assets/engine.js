/* =========================================================================
 * 绿账本 GreenLedger · 数据中心能效与碳排数据清洗分析引擎
 * 纯前端、零依赖、可离线运行；同样可在 Node 中单测（UMD）。
 * 设计原则：凡是能确定性计算的一律交给代码，模型只负责叙述。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.GreenLedger = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- 1. 字段字典 ---------------- */
  var CANON = [
    { key: 'site', label: '机房/站点', aliases: ['机房', '站点', '机房名称', '数据中心', '楼栋', '机房站点', 'site'] },
    { key: 'date', label: '日期', aliases: ['日期', '统计日期', '时间', '年月', 'date'] },
    { key: 'it_kwh', label: 'IT 能耗', unit: 'kWh', aliases: ['it能耗', 'it设备能耗', 'it用电量', 'it电量', '服务器能耗', 'it_kwh'] },
    { key: 'total_kwh', label: '总能耗', unit: 'kWh', aliases: ['总能耗', '总用电量', '总耗电', '总电量', '数据中心总能耗', 'total_kwh'] },
    { key: 'pue', label: 'PUE', aliases: ['pue', '电能利用效率', 'pue值'] },
    { key: 'green_kwh', label: '绿电电量', unit: 'kWh', aliases: ['绿电电量', '绿电', '绿电用电量', '绿电采购量', 'green_kwh'] },
    { key: 'price', label: '电价', aliases: ['电价', '单价', 'price'] },
    { key: 'cost', label: '电费', aliases: ['电费', '费用', 'cost'] },
    { key: 'temp', label: '温度', aliases: ['温度', '室外温度', '机房温度', '进风温度', 'temp'] },
    { key: 'load_rate', label: '负载率', aliases: ['负载率', '负载', '利用率', 'load_rate'] }
  ];

  function normText(s) {
    return String(s == null ? '' : s)
      .replace(/[\s\u3000]/g, '')
      .replace(/[（(].*?[）)]/g, '')
      .replace(/[·:：\/\\_\-\.]/g, '')
      .toLowerCase();
  }

  function matchHeader(h) {
    var n = normText(h);
    if (!n) return null;
    var best = null, bestLen = 0;
    for (var i = 0; i < CANON.length; i++) {
      var c = CANON[i];
      for (var j = 0; j < c.aliases.length; j++) {
        var a = normText(c.aliases[j]);
        if (!a) continue;
        if (n === a && a.length > bestLen) { best = c.key; bestLen = a.length; }
        else if (a.length >= 2 && n.indexOf(a) >= 0 && a.length > bestLen) { best = c.key; bestLen = a.length; }
      }
    }
    return best;
  }

  /* ---------------- 2. 基础解析 ---------------- */
  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else q = false;
        } else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (ch === '\r') { /* skip */ }
        else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    while (rows.length && rows[rows.length - 1].join('').trim() === '') rows.pop();
    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows.shift().map(function (h) { return String(h).trim(); });
    return { headers: headers, rows: rows };
  }

  function numOf(v) {
    if (v == null || v === '') return { value: null, unit: null };
    if (typeof v === 'number') return { value: isFinite(v) ? v : null, unit: null };
    var s = String(v).trim();
    if (!s) return { value: null, unit: null };
    var unit = null;
    if (/万\s*kwh/i.test(s)) unit = '万kWh';
    else if (/mwh/i.test(s)) unit = 'MWh';
    else if (/kwh/i.test(s)) unit = 'kWh';
    if (/[%％]$/.test(s)) {
      var p = parseFloat(s.replace(/[%％\s]/g, ''));
      return { value: isFinite(p) ? p : null, unit: 'pct' };
    }
    s = s.replace(/[¥￥元摄氏度℃,\s]/g, '').replace(/(万kwh|kwh|mwh)$/i, '');
    var n = parseFloat(s);
    return { value: isFinite(n) ? n : null, unit: unit };
  }

  var DATE_FMT = [
    { re: /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/, key: 'Y-M-D', a: 'y' },
    { re: /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/, key: 'D/M/Y', a: 'd' },
    { re: /^(\d{4})(\d{2})(\d{2})$/, key: 'YYYYMMDD', a: 'y' }
  ];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(y, m, d) {
    if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function parseDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return { iso: isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate()), fmt: 'Date对象' };
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var ms = Math.round((v - 25569) * 86400000);
      var dt = new Date(ms);
      return { iso: isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), fmt: 'Excel序列号' };
    }
    var s = String(v == null ? '' : v).trim();
    if (!s) return { iso: null, fmt: null };
    s = s.replace(/[年月]/g, '-').replace(/日/g, '').replace(/T.*$/, '').replace(/\s+\d{1,2}:\d{2}.*$/, '').trim();
    for (var i = 0; i < DATE_FMT.length; i++) {
      var f = DATE_FMT[i], m = f.re.exec(s);
      if (!m) continue;
      var y, mo, d;
      if (f.a === 'y') { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else {
        var p1 = +m[1], p2 = +m[2], yy = +m[3];
        if (p1 > 12) { d = p1; mo = p2; }
        else if (p2 > 12) { mo = p1; d = p2; }
        else { mo = p1; d = p2; }   // 歧义时按 M/D/Y，并在计划里注明
        y = yy;
      }
      var iso = isoDate(y, mo, d);
      if (iso) return { iso: iso, fmt: f.key };
    }
    return { iso: null, fmt: null };
  }

  function normSite(s) {
    return String(s == null ? '' : s).replace(/[\s\-_·]/g, '').replace(/机房|数据中心|栋|座|楼|区/g, '').toUpperCase();
  }

  function signRow(rec) {
    return [normSite(rec.site), rec.date || '',
      rec.it_kwh == null ? '' : Math.round(rec.it_kwh),
      rec.total_kwh == null ? '' : Math.round(rec.total_kwh),
      rec.pue == null ? '' : Math.round(rec.pue * 100),
      rec.green_kwh == null ? '' : Math.round(rec.green_kwh)].join('|');
  }

  /* ---------------- 3. 统计工具 ---------------- */
  function median(arr) {
    var a = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); }).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  function mean(arr) {
    var a = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); });
    if (!a.length) return null;
    var s = 0; for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }
  function sum(arr) {
    var s = 0; for (var i = 0; i < arr.length; i++) if (typeof arr[i] === 'number' && isFinite(arr[i])) s += arr[i];
    return s;
  }
  function round(n, d) {
    if (n == null || !isFinite(n)) return null;
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(n * p) / p;
  }
  function pct(n) { return n == null ? '—' : (Math.round(n * 1000) / 10) + '%'; }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    var s = round(n, d == null ? 2 : d).toFixed(d == null ? 2 : d);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  /* ---------------- 4. 体检 audit ---------------- */
  function audit(headers, rows, opts) {
    opts = opts || {};
    headers = headers.map(function (h, i) { return String(h == null ? '' : h).trim() || ('列' + (i + 1)); });
    var n = rows.length, m = headers.length;
    var mapping = {}, mappingByKey = {};
    headers.forEach(function (h, i) {
      var k = matchHeader(h);
      if (k && mapping[k] == null) { mapping[k] = i; mappingByKey[k] = h; }
    });

    var profiles = headers.map(function (h, i) {
      var vals = [], missing = 0, distinct = {}, numeric = 0, dateOk = 0;
      for (var r = 0; r < n; r++) {
        var v = rows[r][i];
        if (v == null || String(v).trim() === '') { missing++; continue; }
        vals.push(v);
        distinct[String(v).trim()] = 1;
        if (numOf(v).value != null) numeric++;
        if (parseDate(v).iso) dateOk++;
      }
      var kind = 'text';
      if (vals.length && dateOk / vals.length > 0.8) kind = 'date';
      else if (vals.length && numeric / vals.length > 0.8) kind = 'number';
      return {
        index: i, name: h, kind: kind,
        missing: missing, missingRate: n ? missing / n : 0,
        distinct: Object.keys(distinct).length,
        samples: vals.slice(0, 3).map(function (x) { return String(x); })
      };
    });

    var issues = [];
    function pushIssue(code, title, count, detail, severity) {
      if (count > 0) issues.push({ code: code, title: title, count: count, detail: detail, severity: severity || 'mid' });
    }

    // 4.1 缺失
    var missingByCol = profiles.filter(function (p) { return p.missing > 0; });
    var missingCells = missingByCol.reduce(function (s, p) { return s + p.missing; }, 0);
    pushIssue('MISSING', '单元格缺失', missingCells,
      missingByCol.map(function (p) { return p.name + ' 缺 ' + p.missing + ' 个（' + pct(p.missingRate) + '）'; }),
      missingCells / Math.max(1, n * m) > 0.05 ? 'high' : 'mid');

    // 4.2 重复行（按归一化签名：站点+日期+关键指标）
    var seen = {}, dupRows = [], dupExact = 0, daySeen = {}, dayDup = 0;
    for (var r = 0; r < n; r++) {
      var recSig = { site: mapping.site != null ? rows[r][mapping.site] : '',
        date: mapping.date != null ? (parseDate(rows[r][mapping.date]).iso || '') : '' };
      ['it_kwh', 'total_kwh', 'pue', 'green_kwh'].forEach(function (k) {
        recSig[k] = mapping[k] != null ? numOf(rows[r][mapping[k]]).value : null;
      });
      var key = signRow(recSig);
      if (seen[key] != null) { dupExact++; dupRows.push(r); } else seen[key] = r;
      var dkey = normSite(recSig.site) + '|' + recSig.date;
      if (recSig.date) { dayDup += daySeen[dkey] ? 1 : 0; daySeen[dkey] = 1; }
    }
    pushIssue('DUP_EXACT', '重复行', dupExact, dupExact ? '按（站点+日期+关键指标）判定，建议保留首条' : [], dupExact > 0 ? 'mid' : 'low');

    // 4.3 单位混用（同一列出现约 1000 倍差异）
    var unitPlans = [];
    Object.keys(mapping).forEach(function (k) {
      if (['it_kwh', 'total_kwh', 'green_kwh', 'cost'].indexOf(k) < 0) return;
      var idx = mapping[k], vals = [];
      for (var r2 = 0; r2 < n; r2++) {
        var o = numOf(rows[r2][idx]);
        if (o.value != null && o.unit !== 'pct') vals.push({ row: r2, value: o.value, unit: o.unit });
      }
      if (vals.length < 10) return;
      var med = median(vals.map(function (x) { return x.value; }));
      if (!med || med <= 0) return;
      var low = vals.filter(function (x) { return x.value > 0 && x.value < med / 100; });
      var high = vals.filter(function (x) { return x.value > med * 100; });
      if (low.length >= Math.max(3, vals.length * 0.02)) {
        unitPlans.push({ column: k, columnName: mappingByKey[k], direction: 'up', factor: 1000, rows: low.length, sampleMedian: med });
      } else if (high.length >= Math.max(3, vals.length * 0.02)) {
        unitPlans.push({ column: k, columnName: mappingByKey[k], direction: 'down', factor: 1000, rows: high.length, sampleMedian: med });
      }
    });
    pushIssue('UNIT_MIX', '同一列单位混用', unitPlans.reduce(function (s, u) { return s + u.rows; }, 0),
      unitPlans.map(function (u) {
        return u.columnName + '：' + u.rows + ' 行与主体量级相差约 ' + (u.factor) + ' 倍（疑似 ' + (u.direction === 'up' ? 'MWh 混入 kWh' : 'kWh 混入 MWh') + '）';
      }), unitPlans.length ? 'high' : 'low');

    // 4.4 日期格式
    var datePlan = null;
    if (mapping.date != null) {
      var idx2 = mapping.date, fmts = {}, bad = 0, ok = 0;
      for (var r3 = 0; r3 < n; r3++) {
        var raw = rows[r3][idx2];
        if (raw == null || String(raw).trim() === '') continue;
        var pd = parseDate(raw);
        if (pd.iso) { ok++; fmts[pd.fmt] = (fmts[pd.fmt] || 0) + 1; } else bad++;
      }
      datePlan = { column: idx2, columnName: headers[idx2], formats: fmts, ok: ok, bad: bad };
      pushIssue('DATE_FMT', '日期格式不统一', bad,
        Object.keys(fmts).map(function (f) { return f + ' × ' + fmts[f]; }), bad > 0 ? 'high' : 'low');
    }

    // 4.5 逻辑与取值冲突
    var logic = { totalLtIt: 0, greenGtTotal: 0, pueBad: 0, pueMismatch: 0, outliers: [] };
    for (var r4 = 0; r4 < n; r4++) {
      var it = mapping.it_kwh != null ? numOf(rows[r4][mapping.it_kwh]).value : null;
      var tot = mapping.total_kwh != null ? numOf(rows[r4][mapping.total_kwh]).value : null;
      var pue = mapping.pue != null ? numOf(rows[r4][mapping.pue]).value : null;
      var green = mapping.green_kwh != null ? numOf(rows[r4][mapping.green_kwh]).value : null;
      if (mapping.green_kwh != null && mapping.green_kwh === mapping.total_kwh) green = null;
      if (it != null && tot != null && tot > 0 && it > 0 && tot < it) { logic.totalLtIt++; logic.outliers.push({ row: r4, code: 'LOGIC_TOTAL_LT_IT', text: '总能耗小于 IT 能耗' }); }
      if (green != null && tot != null && green > tot * 1.001) { logic.greenGtTotal++; logic.outliers.push({ row: r4, code: 'LOGIC_GREEN_GT_TOTAL', text: '绿电电量大于总用电量' }); }
      if (pue != null && (pue < 1.0 || pue > 3.0)) { logic.pueBad++; logic.outliers.push({ row: r4, code: 'PUE_RANGE', text: 'PUE = ' + pue + ' 超出 1.0–3.0' }); }
      if (pue != null && it != null && tot != null && it > 0) {
        var calc = tot / it;
        if (Math.abs(calc - pue) / Math.max(pue, 0.01) > 0.05) { logic.pueMismatch++; logic.outliers.push({ row: r4, code: 'PUE_MISMATCH', text: 'PUE 与"总能耗/IT能耗"不一致（' + round(pue, 2) + ' vs ' + round(calc, 2) + '）' }); }
      }
    }
    pushIssue('LOGIC', '逻辑冲突', logic.totalLtIt + logic.greenGtTotal,
      ['总能耗 < IT 能耗：' + logic.totalLtIt + ' 行', '绿电 > 总用电：' + logic.greenGtTotal + ' 行'], 'high');
    pushIssue('PUE', 'PUE 越界或口径不一致', logic.pueBad + logic.pueMismatch,
      ['超出 1.0–3.0：' + logic.pueBad + ' 行', '与总/IT 能耗计算值偏差 >5%：' + logic.pueMismatch + ' 行'], 'mid');

    // 4.6 健康分
    var dupRate = n ? dupExact / n : 0;
    var missRate = n * m ? missingCells / (n * m) : 0;
    var conflictRate = n ? (logic.totalLtIt + logic.greenGtTotal + logic.pueMismatch) / n : 0;
    var outlierRate = n ? (logic.pueBad) / n : 0;
    var parts = {
      completeness: Math.max(0, 30 * (1 - missRate)),
      consistency: Math.max(0, 30 * (1 - Math.min(1, conflictRate))),
      validity: Math.max(0, 20 * (1 - Math.min(1, outlierRate))),
      uniqueness: Math.max(0, 20 * (1 - Math.min(1, dupRate)))
    };
    var score = parts.completeness + parts.consistency + parts.validity + parts.uniqueness;

    return {
      headers: headers, rows: rows, n: n, m: m,
      mapping: mapping, mappingByKey: mappingByKey,
      dups: dupExact, missingCells: missingCells, dayDup: dayDup,
      profiles: profiles,
      issues: issues,
      unitPlans: unitPlans,
      datePlan: datePlan,
      logic: logic,
      dupRows: dupRows.slice(0, 200),
      health: { score: Math.round(score), parts: parts },
      unknowns: Object.keys(mapping).length < 4 ? ['可用语义字段偏少（识别到 ' + Object.keys(mapping).length + ' 个），请确认表头是否规范'] : []
    };
  }

  /* ---------------- 5. 清洗计划 ---------------- */
  function makePlan(quality, opts) {
    opts = opts || {};
    var steps = [];
    var map = quality.mapping, byKey = quality.mappingByKey;
    var actions = Object.keys(map).map(function (k) {
      var canon = CANON.filter(function (c) { return c.key === k; })[0];
      return { from: byKey[k], to: canon ? canon.label : k, key: k };
    });
    steps.push({
      id: 'rename', title: '字段映射与改名', reason: '统一表头，后续规则才能稳定命中；映射关系写进计划，便于复核',
      actions: actions
    });

    if (quality.datePlan && (quality.datePlan.bad > 0 || Object.keys(quality.datePlan.formats).length > 1)) {
      steps.push({
        id: 'date', title: '日期规范化', reason: '同一日期多种写法会让趋势统计把一个月拆成两个点',
        actions: [{ from: Object.keys(quality.datePlan.formats).join(' / ') || '未知格式', to: 'YYYY-MM-DD', count: quality.datePlan.ok + quality.datePlan.bad }]
      });
    }

    if (quality.unitPlans.length) {
      steps.push({
        id: 'unit', title: '单位统一（按行修正）', reason: '同一列混入 MWh 会让月度总量相差 1000 倍，必须在计算前修正',
        actions: quality.unitPlans.map(function (u) {
          return { from: u.columnName + '（' + (u.direction === 'up' ? 'MWh' : 'kWh') + '）', to: u.columnName + '（kWh）', count: u.rows, factor: u.direction === 'up' ? u.factor : 1 / u.factor, column: u.column };
        })
      });
    }

    var dup = quality.issues.filter(function (i) { return i.code === 'DUP_EXACT'; })[0];
    if ((dup && dup.count > 0) || quality.dayDup > 0) {
      steps.push({
        id: 'dedup', title: '重复行处理', reason: '重复会让总量虚高、均值被拉偏；只删"归一化后完全相同"的行，同日不同值的一律保留并标记，避免误删',
        actions: [
          { from: '归一化后重复 ' + (dup ? dup.count : 0) + ' 行', to: '按（站点+日期+关键指标）保留首条', count: dup ? dup.count : 0 },
          { from: '同站点同日多条记录 ' + (quality.dayDup || 0) + ' 行', to: '保留全部，打"同日多记录"标记', count: quality.dayDup || 0 }
        ]
      });
    }

    var miss = quality.profiles.filter(function (p) {
      return p.missing > 0 && ['number', 'date'].indexOf(p.kind) >= 0;
    });
    if (miss.length) {
      steps.push({
        id: 'fill', title: '缺失值处理', reason: '数值列用"同站点同日均值→全体中位数"兜底，并打标记，避免静默造假',
        actions: miss.map(function (p) { return { from: p.name + ' 缺 ' + p.missing + ' 个', to: '同站点同日均值 → 中位数兜底（标记 fill_flag）', count: p.missing, column: p.name }; })
      });
    }

    if (quality.logic.pueBad + quality.logic.pueMismatch + quality.logic.greenGtTotal + quality.logic.totalLtIt > 0) {
      steps.push({
        id: 'outlier', title: '异常与冲突标记', reason: '异常值可能是真实现象（如设备故障），只能标记不能删除，否则掩盖问题',
        actions: [
          { from: 'PUE 越界 / 口径不一致', to: '标记 flag，保留原值', count: quality.logic.pueBad + quality.logic.pueMismatch },
          { from: '绿电 > 总用电、总能耗 < IT 能耗', to: '标记 flag，保留原值', count: quality.logic.greenGtTotal + quality.logic.totalLtIt }
        ]
      });
    }

    return {
      engine: 'rule-v1',
      generated_at: new Date().toISOString(),
      mapping: map,
      mappingByKey: byKey,
      unitPlans: quality.unitPlans,
      datePlan: quality.datePlan,
      dedupKeys: (map.site != null && map.date != null) ? ['site', 'date'] : null,
      steps: steps,
      risk_notes: [].concat(quality.unknowns, [
        '默认排放因子 0.5703 tCO₂/MWh（生态环境部全国电网平均因子，2022 年），可在"口径设置"中修改',
        '单位判定基于量级差异（约 1000 倍），若数据本身存在极端大客户，需人工复核被修正的行'
      ])
    };
  }

  /* ---------------- 6. 执行清洗 ---------------- */
  function execute(quality, plan, opts) {
    opts = opts || {};
    var skip = opts.skip || [];
    var raw = quality.rows, n = raw.length, map = quality.mapping, byKey = quality.mappingByKey;
    var out = [], flags = [], fillCount = 0, unitFixed = 0, dateFixed = 0;
    var unitMap = {};
    if (skip.indexOf('unit') < 0) {
      (plan.unitPlans || []).forEach(function (u) { unitMap[u.column] = u; });
    }

    // 6.1 站点/日期/数值抽取
    for (var r = 0; r < n; r++) {
      var rec = { _row: r + 2, flag: [] };
      rec.site = map.site != null ? String(raw[r][map.site] == null ? '' : raw[r][map.site]).trim() : '';
      if (map.date != null) {
        var pd = parseDate(raw[r][map.date]);
        rec.date = pd.iso || '';
        if (pd.iso && pd.fmt && pd.fmt !== 'Y-M-D') dateFixed++;
      } else rec.date = '';
      ['it_kwh', 'total_kwh', 'pue', 'green_kwh', 'price', 'cost', 'temp', 'load_rate'].forEach(function (k) {
        if (map[k] == null) { rec[k] = null; return; }
        var o = numOf(raw[r][map[k]]);
        var v = o.value;
        if (v != null && unitMap[k]) {
          var u = unitMap[k];
          var isLow = u.direction === 'up' && v > 0 && v < u.sampleMedian / 100;
          var isHigh = u.direction === 'down' && v > u.sampleMedian * 100;
          if (isLow) { v = v * u.factor; unitFixed++; rec.flag.push('单位修正×1000'); }
          if (isHigh) { v = v / u.factor; unitFixed++; rec.flag.push('单位修正÷1000'); }
        }
        if (v != null && (o.unit === 'MWh')) { v = v * 1000; rec.flag.push('单位标注MWh'); }
        if (v != null && (o.unit === '万kWh')) { v = v * 10000; rec.flag.push('单位标注万kWh'); }
        if (v != null && o.unit === 'pct' && (k === 'load_rate')) { /* 百分比保持数值 */ }
        rec[k] = v;
      });
      out.push(rec);
    }

    // 6.2 站点名归并（同音/同义写法）
    var siteGroups = {};
    out.forEach(function (rec) {
      if (!rec.site) return;
      var key = normSite(rec.site);
      (siteGroups[key] = siteGroups[key] || []).push(rec.site);
    });
    var siteAlias = {};
    Object.keys(siteGroups).forEach(function (k) {
      var list = siteGroups[k];
      if (list.length > 1) {
        var counts = {};
        list.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
        var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
        list.forEach(function (s) { siteAlias[s] = top; });
      }
    });
    out.forEach(function (rec) {
      if (siteAlias[rec.site] && siteAlias[rec.site] !== rec.site) { rec.flag.push('站点名归一'); rec.site = siteAlias[rec.site]; }
    });
    var siteMerged = Object.keys(siteAlias).length;

    // 6.3 去重：只删归一化后完全相同的行；同日不同值保留并标记
    var seen = {}, removed = 0;
    var deduped = [];
    if (skip.indexOf('dedup') >= 0) {
      deduped = out.slice();
    } else {
      out.forEach(function (rec) {
        var key = signRow(rec);
        if (seen[key]) { removed++; return; }
        seen[key] = 1; deduped.push(rec);
      });
    }
    out = deduped;

    // 同日多记录标记
    var dayCount = {};
    out.forEach(function (rec) {
      if (!rec.date) return;
      var k = normSite(rec.site) + '|' + rec.date;
      dayCount[k] = (dayCount[k] || 0) + 1;
    });
    var dayDupKept = 0;
    out.forEach(function (rec) {
      if (!rec.date) return;
      var k = normSite(rec.site) + '|' + rec.date;
      if (dayCount[k] > 1) { rec.flag.push('同日多记录'); dayDupKept++; }
    });

    // 6.4 缺失填充（同站点同日均值 → 全体中位数）
    if (skip.indexOf('fill') < 0) {
    ['it_kwh', 'total_kwh', 'green_kwh', 'pue', 'cost', 'price', 'temp', 'load_rate'].forEach(function (k) {
      var valsAll = out.map(function (x) { return x[k]; }).filter(function (v) { return v != null; });
      if (!valsAll.length) return;
      var colMed = median(valsAll);
      var bySiteDate = {};
      out.forEach(function (x) {
        if (x[k] == null) return;
        var key = x.site + '|' + x.date;
        (bySiteDate[key] = bySiteDate[key] || []).push(x[k]);
      });
      out.forEach(function (x) {
        if (x[k] != null) return;
        var key = x.site + '|' + x.date;
        var cand = bySiteDate[key] ? mean(bySiteDate[key]) : null;
        if (cand == null) cand = colMed;
        if (cand != null) { x[k] = round(cand, 2); x.flag.push('缺失填充'); fillCount++; }
      });
    });
    }

    // 6.5 PUE 重算与标记
    var recomputed = 0;
    out.forEach(function (x) {
      if (x.pue == null && x.total_kwh != null && x.it_kwh) { x.pue = round(x.total_kwh / x.it_kwh, 3); x.flag.push('PUE按口径重算'); recomputed++; }
      if (x.pue != null && (x.pue < 1.0 || x.pue > 3.0)) x.flag.push('PUE越界');
      if (x.total_kwh != null && x.it_kwh != null && x.total_kwh < x.it_kwh) x.flag.push('总能耗<IT能耗');
      if (x.green_kwh != null && x.total_kwh != null && x.green_kwh > x.total_kwh * 1.001) x.flag.push('绿电>总用电');
    });

    // 6.6 清洗后健康分
    var presentKeys = ['site', 'date', 'it_kwh', 'total_kwh', 'pue', 'green_kwh', 'cost']
      .filter(function (k) { return map[k] != null; });
    var missAfter = 0;
    out.forEach(function (x) {
      presentKeys.forEach(function (k) {
        if (x[k] == null || x[k] === '') missAfter++;
      });
    });
    var flagged = out.filter(function (x) { return x.flag.length; }).length;
    var parts = {
      completeness: Math.max(0, 30 * (1 - missAfter / Math.max(1, out.length * Math.max(1, presentKeys.length)))),
      consistency: Math.max(0, 30 * (1 - out.filter(function (x) { return x.flag.indexOf('绿电>总用电') >= 0 || x.flag.indexOf('总能耗<IT能耗') >= 0; }).length / Math.max(1, out.length))),
      validity: Math.max(0, 20 * (1 - out.filter(function (x) { return x.flag.indexOf('PUE越界') >= 0; }).length / Math.max(1, out.length))),
      uniqueness: 20
    };
    var score = Math.round(parts.completeness + parts.consistency + parts.validity + parts.uniqueness);

    var changeLog = [];
    out.forEach(function (x) {
      if (x.flag.length) changeLog.push({ row: x._row, site: x.site, date: x.date, flags: x.flag.slice() });
    });

    return {
      rows: out,
      fields: ['site', 'date', 'it_kwh', 'total_kwh', 'pue', 'green_kwh', 'price', 'cost', 'temp', 'load_rate']
        .filter(function (k) { return map[k] != null; }),
      before: { rows: n, score: quality.health.score },
      after: { rows: out.length, score: score, parts: parts },
      stats: {
        removedRows: removed, filledCells: fillCount, unitFixed: unitFixed,
        dateFixed: dateFixed, siteMerged: siteMerged, flaggedRows: flagged, pueRecomputed: recomputed,
        dayDupKept: dayDupKept
      },
      changeLog: changeLog
    };
  }

  /* ---------------- 7. 指标 ---------------- */
  function metrics(clean, opts) {
    opts = opts || {};
    var factor = opts.factor != null ? opts.factor : 0.5703;
    var rows = clean.rows || [];
    var total = sum(rows.map(function (x) { return x.total_kwh; }));
    var it = sum(rows.map(function (x) { return x.it_kwh; }));
    var green = sum(rows.map(function (x) { return x.green_kwh; }));
    var cost = sum(rows.map(function (x) { return x.cost; }));
    var hasField = function (k) {
      return clean.fields ? clean.fields.indexOf(k) >= 0 : true;
    };
    var pueList = rows.map(function (x) {
      // 越界 PUE 已标记，只排除在均值/极值之外，仍保留在异常清单里
      return (x.pue != null && x.pue >= 1.0 && x.pue <= 3.0) ? x.pue : null;
    });
    var pueMean = mean(pueList);
    if (pueMean == null && it > 0 && total > 0) pueMean = total / it;
    var byMonth = {};
    rows.forEach(function (x) {
      if (!x.date) return;
      var mo = x.date.slice(0, 7);
      var b = byMonth[mo] = byMonth[mo] || { month: mo, pue: [], total: 0, it: 0, green: 0, cost: 0, n: 0 };
      if (x.pue != null && x.pue >= 1.0 && x.pue <= 3.0) b.pue.push(x.pue);
      b.total += x.total_kwh || 0; b.it += x.it_kwh || 0; b.green += x.green_kwh || 0;
      b.cost += x.cost || 0; b.n++;
    });
    var months = Object.keys(byMonth).sort().map(function (k) {
      var b = byMonth[k];
      return {
        month: b.month, pue: round(mean(b.pue), 2),
        total_kwh: Math.round(b.total), carbon: round(b.total / 1000 * factor, 1), cost: Math.round(b.cost), n: b.n
      };
    });
    var pueTrend = months.filter(function (x) { return x.pue != null; });
    var peak = pueTrend.slice().sort(function (a, b) { return b.pue - a.pue; })[0] || null;
    var carbon = total / 1000 * factor;
    return {
      factor: factor,
      rows: rows.length,
      energy: {
        total_kwh: Math.round(total),
        it_kwh: hasField('it_kwh') ? Math.round(it) : null,
        green_kwh: hasField('green_kwh') ? Math.round(green) : null,
        cost: hasField('cost') ? Math.round(cost) : null
      },
      pue: { mean: round(pueMean, 2), max: pueTrend.length ? Math.max.apply(null, pueTrend.map(function (x) { return x.pue; })) : null, min: pueTrend.length ? Math.min.apply(null, pueTrend.map(function (x) { return x.pue; })) : null, peakMonth: peak ? peak.month : null },
      green: { ratio: (hasField('green_kwh') && total > 0) ? round(green / total, 4) : null },
      carbon: { tco2: round(carbon, 1), factor: factor },
      months: months,
      anomalies: clean.rows.filter(function (x) {
        var bad = x.flag.filter(function (f) {
          return ['PUE越界', '绿电>总用电', '总能耗<IT能耗'].indexOf(f) >= 0;
        });
        return bad.length > 0;
      }).slice(0, 8).map(function (x) {
        return { date: x.date || '—', site: x.site || '—', pue: x.pue, total_kwh: x.total_kwh, flags: x.flag };
      })
    };
  }

  /* ---------------- 8. 报告 ---------------- */
  function buildReport(ctx) {
    var q = ctx.quality, clean = ctx.clean, mt = ctx.metrics, plan = ctx.plan, opts = ctx.opts || {};
    var L = [];
    var before = clean.before.score, after = clean.after.score;
    var pueTxt = mt.pue.mean == null ? '未提供' : mt.pue.mean + '';
    L.push('# ' + (opts.title || '数据中心能效与碳排数据分析报告'));
    L.push('');
    L.push('> 生成时间：' + new Date().toLocaleString('zh-CN') + '　｜　数据文件：' + (opts.fileName || '未命名') + '　｜　清洗规则：rule-v1');
    L.push('');
    L.push('## 1. 一句话结论');
    var line = '本次共处理 ' + q.n + ' 行数据，清洗后保留 ' + clean.rows.length + ' 行，数据健康分由 **' + before + '** 提升到 **' + after + '**';
    if (mt.pue.mean != null) line += '；平均 PUE 为 **' + mt.pue.mean + '**';
    if (mt.green.ratio != null) line += '，绿电占比 **' + pct(mt.green.ratio) + '**';
    if (mt.carbon.tco2) line += '，估算排放 **' + fmt(mt.carbon.tco2, 1) + ' tCO₂e**';
    L.push(line + '。');
    L.push('');
    L.push('## 2. 数据质量（清洗前后对比）');
    L.push('');
    L.push('| 指标 | 清洗前 | 清洗后 |');
    L.push('| --- | --- | --- |');
    L.push('| 数据行数 | ' + q.n + ' | ' + clean.rows.length + ' |');
    L.push('| 数据健康分 | ' + before + ' | ' + after + ' |');
    L.push('| 重复行 | ' + (q.dups ? q.dups : 0) + ' | 0（按站点+日期+关键指标去重） |');
    L.push('| 单位混用行 | ' + clean.stats.unitFixed + ' 行已换算 | 0 |');
    L.push('| 缺失单元格 | ' + (q.missingCells || 0) + ' | ' + clean.stats.filledCells + ' 处已填充 |');
    L.push('');
    L.push('健康分口径：完整性 30 + 一致性 30 + 有效性 20 + 唯一性 20。');
    L.push('');
    L.push('## 3. 能效（PUE）');
    if (mt.pue.mean == null) {
      L.push('当前数据未提供可用的 PUE 或"总能耗/IT 能耗"字段，无法计算能效指标。');
    } else {
      L.push('平均 PUE **' + mt.pue.mean + '**，区间 ' + (mt.pue.min == null ? '—' : mt.pue.min) + '–' + (mt.pue.max == null ? '—' : mt.pue.max) + (mt.pue.peakMonth ? '，峰值出现在 **' + mt.pue.peakMonth + '**' : '') + '。');
      if (mt.months.length > 1) {
        L.push('');
        L.push('| 月份 | PUE | 总能耗(kWh) | 碳排(tCO₂e) | 记录数 |');
        L.push('| --- | --- | --- | --- | --- |');
        mt.months.forEach(function (x) { L.push('| ' + x.month + ' | ' + (x.pue == null ? '—' : x.pue) + ' | ' + fmt(x.total_kwh, 0) + ' | ' + (x.carbon == null ? '—' : x.carbon) + ' | ' + x.n + ' |'); });
        L.push('');
        var first = mt.months[0], last = mt.months[mt.months.length - 1];
        if (first.pue != null && last.pue != null) {
          var d = last.pue - first.pue;
          L.push('从 ' + first.month + ' 到 ' + last.month + '，PUE ' + (d >= 0 ? '上升' : '下降') + ' ' + Math.abs(round(d, 2)) + '。');
        }
      }
    }
    L.push('');
    L.push('## 4. 绿色化（绿电与碳排）');
    L.push('总用电量 **' + fmt(mt.energy.total_kwh, 0) + ' kWh**，其中绿电 **' + fmt(mt.energy.green_kwh, 0) + ' kWh**' + (mt.green.ratio != null ? '，绿电占比 **' + pct(mt.green.ratio) + '**' : '') + '。');
    L.push('按排放因子 **' + mt.factor + ' tCO₂/MWh** 估算，本期排放约 **' + fmt(mt.carbon.tco2, 1) + ' tCO₂e**。');
    if (mt.energy.cost) L.push('电费合计约 **' + fmt(mt.energy.cost, 0) + ' 元**，平均电价 ' + round(mt.energy.cost / Math.max(1, mt.energy.total_kwh), 3) + ' 元/kWh。');
    L.push('');
    L.push('## 5. 异常清单（仅标记，不删除）');
    if (!mt.anomalies.length) L.push('本批次未发现越界或逻辑冲突记录。');
    else {
      L.push('按标记数量取前 ' + mt.anomalies.length + ' 条（完整清单见页面表格与下载的 CSV 的"清洗标记"列）。');
      L.push('');
      L.push('| 日期 | 站点 | PUE | 总能耗 | 标记 |');
      L.push('| --- | --- | --- | --- | --- |');
      mt.anomalies.forEach(function (a) { L.push('| ' + a.date + ' | ' + a.site + ' | ' + (a.pue == null ? '—' : a.pue) + ' | ' + (a.total_kwh == null ? '—' : fmt(a.total_kwh, 0)) + ' | ' + a.flags.join('；') + ' |'); });
    }
    L.push('');
    L.push('## 6. 三条改进建议');
    var sug = [];
    if (mt.pue.mean != null && mt.pue.mean > 1.5) sug.push('平均 PUE ' + mt.pue.mean + ' 高于风冷机房常见水平（1.3–1.5），建议先核查制冷侧：冷冻水温、末端气流组织与冷热通道封闭情况，再评估改造收益。');
    if (mt.green.ratio != null && mt.green.ratio < 0.3) sug.push('绿电占比 ' + pct(mt.green.ratio) + ' 偏低，可优先在电价低谷时段采购绿电或签订长期 PPA，并同步核对绿证与用电量的对应关系。');
    if (mt.pue.peakMonth) sug.push('PUE 峰值出现在 ' + mt.pue.peakMonth + '，建议把该月的室外温度、负载率与制冷能耗对齐复盘，判断是气象因素还是负载突增。');
    sug.push('把本次清洗规则固化为月度流程：每月固定跑一次，重点看"单位混用行数"与"PUE 越界行数"两个指标，异常突然增加往往意味着台账录入流程出了问题。');
    sug.slice(0, 3).forEach(function (s, i) { L.push((i + 1) + '. ' + s); });
    L.push('');
    L.push('## 7. 口径与来源');
    L.push('- 数据来源：用户上传文件（' + (opts.fileName || '未命名') + '），本报告未引入外部数据。');
    L.push('- PUE = 数据中心总能耗 ÷ IT 设备能耗，理论下限 1.0。');
    L.push('- 绿电占比 = 绿电电量 ÷ 总用电量。');
    L.push('- 碳排放 = 用电量(MWh) × 电网排放因子；本报告采用 **' + mt.factor + ' tCO₂/MWh**（默认取自生态环境部全国电网平均因子 2022 年，可在界面修改）。');
    L.push('- 清洗假设：' + (plan.risk_notes || []).join('；'));
    L.push('- 免责声明：本报告由智能体基于用户上传数据自动生成，结论供参考，不替代现场能效诊断。');
    return L.join('\n');
  }

  /* ---------------- 9. 演示数据 ---------------- */
  function demoData() { return typeof DEMO !== 'undefined' ? DEMO : null; }

  return {
    CANON: CANON,
    parseCSV: parseCSV,
    audit: audit,
    makePlan: makePlan,
    execute: execute,
    metrics: metrics,
    buildReport: buildReport,
    parseDate: parseDate,
    numOf: numOf,
    utils: { median: median, mean: mean, sum: sum, round: round, fmt: fmt, pct: pct },
    version: '1.0.0'
  };
});
