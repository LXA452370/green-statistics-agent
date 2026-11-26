/* =========================================================================
 * 经管数据统计分析引擎（stat-engine）
 * 分工原则：
 *   1) 代码负责一切计算：描述统计、分组比较、相关系数、直方图、频数
 *   2) 大模型只负责两件事：① 决定"该算哪些指标"（输出 JSON 计划）
 *                          ② 依据算好的结果写"建议"（不得自己算数）
 * 纯浏览器运行，可在 Node 中单测。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StatEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- 1. 基础工具 ---------------- */
  function toHalfWidth(s) {
    return String(s).replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
  }

  function toNumber(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? { v: v, pct: false } : null;
    var raw = String(v);
    var s = toHalfWidth(raw).trim();
    if (!s) return null;
    var pct = /%$/.test(s);
    var wan = /万/.test(s);
    s = s.replace(/[¥$€,，\s元%]/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;   // 整串必须是数字，"2025Q1" 不算
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    if (wan) n = n * 10000;
    return { v: n, pct: pct };
  }

  function round(n, d) {
    if (n == null || !isFinite(n)) return null;
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(n * p) / p;
  }

  function mean(a) {
    var s = 0, n = 0;
    for (var i = 0; i < a.length; i++) if (a[i] != null) { s += a[i]; n++; }
    return n ? s / n : null;
  }

  function variance(a) {
    var m = mean(a), n = 0, s = 0;
    for (var i = 0; i < a.length; i++) if (a[i] != null) { s += (a[i] - m) * (a[i] - m); n++; }
    return n > 1 ? s / (n - 1) : null;   // 样本方差（n-1）
  }

  function sd(a) {
    var v = variance(a);
    return v == null ? null : Math.sqrt(v);
  }

  function quantile(a, q) {
    var arr = a.filter(function (x) { return x != null; }).slice().sort(function (x, y) { return x - y; });
    if (!arr.length) return null;
    if (arr.length === 1) return arr[0];
    var pos = (arr.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return arr[lo];
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  }

  function skewness(a) {
    var n = 0, m = mean(a), s = 0, s3 = 0;
    for (var i = 0; i < a.length; i++) if (a[i] != null) { n++; s += (a[i] - m) * (a[i] - m); }
    if (n < 3 || s === 0) return 0;
    var sdv = Math.sqrt(s / (n - 1));
    for (var j = 0; j < a.length; j++) if (a[j] != null) s3 += Math.pow((a[j] - m) / sdv, 3);
    return n / ((n - 1) * (n - 2)) * s3;
  }

  function kurtosis(a) {
    var n = 0, m = mean(a), s = 0, s4 = 0;
    for (var i = 0; i < a.length; i++) if (a[i] != null) { n++; s += (a[i] - m) * (a[i] - m); }
    if (n < 4 || s === 0) return 0;
    var v = s / (n - 1), sdv = Math.sqrt(v);
    for (var j = 0; j < a.length; j++) if (a[j] != null) s4 += Math.pow((a[j] - m) / sdv, 4);
    var g2 = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * s4 - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
    return g2;
  }

  function pearson(xs, ys) {
    var n = 0, mx = 0, my = 0;
    for (var i = 0; i < xs.length; i++) {
      if (xs[i] == null || ys[i] == null) continue;
      mx += xs[i]; my += ys[i]; n++;
    }
    if (n < 3) return { r: null, n: n };
    mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0;
    for (var j = 0; j < xs.length; j++) {
      if (xs[j] == null || ys[j] == null) continue;
      var dx = xs[j] - mx, dy = ys[j] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return { r: null, n: n };
    return { r: sxy / Math.sqrt(sxx * syy), n: n };
  }

  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    while (rows.length && rows[rows.length - 1].join('').trim() === '') rows.pop();
    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows.shift().map(function (h) { return String(h).trim(); });
    return { headers: headers, rows: rows };
  }

  /* ---------------- 2. 数据画像 profile ---------------- */
  function profile(headers, rows) {
    var n = rows.length;
    var cols = headers.map(function (h, ci) {
      var vals = [], missing = 0, nobj = 0, nums = [];
      for (var r = 0; r < n; r++) {
        var raw = rows[r][ci];
        var empty = raw == null || String(raw).trim() === '';
        if (empty) { missing++; continue; }
        vals.push(String(raw).trim());
        var o = toNumber(raw);
        if (o != null && typeof o === 'object') { nobj++; nums.push(o.v); }
      }
      var numericRate = vals.length ? nobj / vals.length : 0;
      var isNum = numericRate >= 0.8;
      var uniq = {};
      vals.forEach(function (v) { uniq[v] = 1; });
      var cat = Object.keys(uniq).slice(0, 12);
      var idLike = !isNum && Object.keys(uniq).length >= Math.max(8, n * 0.8) &&
        /(编号|学号|工号|序号|代码|id)/i.test(String(h));
      return {
        index: ci, name: String(h).trim(), type: isNum ? 'numeric' : 'categorical', idLike: !!idLike,
        n: vals.length, missing: missing, missingRate: n ? missing / n : 0,
        unique: Object.keys(uniq).length,
        numericRate: round(numericRate, 2),
        samples: vals.slice(0, 3),
        min: isNum ? Math.min.apply(null, nums) : null,
        max: isNum ? Math.max.apply(null, nums) : null,
        categories: isNum ? [] : cat
      };
    });
    return {
      headers: headers, rows: rows, n: n, m: headers.length, columns: cols,
      numeric: cols.filter(function (c) { return c.type === 'numeric'; }).map(function (c) { return c.name; }),
      categorical: cols.filter(function (c) { return c.type === 'categorical'; }).map(function (c) { return c.name; })
    };
  }

  /* ---------------- 3. 清洗 clean ---------------- */
  function clean(headers, rows, prof) {
    prof = prof || profile(headers, rows);
    var colType = {};
    prof.columns.forEach(function (c) { colType[c.name] = c.type; });

    var log = { trimmed: 0, coerced: 0, emptyToNull: 0, dupRemoved: 0 };
    var out = [];
    var seen = {};

    rows.forEach(function (row, ri) {
      var rec = { _row: ri + 2 };
      var keyParts = [];
      headers.forEach(function (h, ci) {
        var v = row[ci];
        if (typeof v === 'string') {
          var t = toHalfWidth(v).replace(/\s+/g, ' ').trim();
          if (t !== v) log.trimmed++;
          v = t;
        }
        if (v === '' || v == null) {
          rec[h] = null;
          keyParts.push('');
          return;
        }
        if (colType[h] === 'numeric') {
          var o = toNumber(v);
          if (o == null) { rec[h] = null; keyParts.push(String(v)); return; }  // 文本型缺考 → 缺失
          rec[h] = o.v;
          if (typeof v === 'string' && /[^\d.\-+eE]/.test(v)) log.coerced++;   // 只统计"带单位/文字的"转换
          keyParts.push(String(o.v));
        } else {
          rec[h] = String(v);
          keyParts.push(String(v));
        }
      });
      var key = keyParts.join('\u0001');
      if (seen[key]) { log.dupRemoved++; return; }
      seen[key] = 1;
      out.push(rec);
    });

    return { headers: headers, rows: out, log: log, profile: prof };
  }

  /* ---------------- 4. 默认计划 defaultPlan ---------------- */
  function defaultPlan(prof) {
    var nums = prof.numeric.slice(0, 4);
    var PREFER = /(部门|班级|地区|区域|城市|门店|渠道|类别|分组|团队|科室|行业|产品线)/;
    var cats = prof.columns.filter(function (c) {
      return c.type === 'categorical' && !c.idLike && c.unique >= 2 && c.unique <= 10;
    })
      .map(function (c) { return c.name; })
      .sort(function (a, b) {
        var pa = PREFER.test(a) ? 0 : 1, pb = PREFER.test(b) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return 0;
      }).slice(0, 2);
    var pairs = [];
    for (var i = 0; i < prof.numeric.length && pairs.length < 3; i++) {
      for (var j = i + 1; j < prof.numeric.length && pairs.length < 3; j++) {
        pairs.push([prof.numeric[i], prof.numeric[j]]);
      }
    }
    return {
      title: '数据统计分析',
      source: 'rule',
      groupBy: cats[0] || null,
      metrics: nums,
      descriptives: nums,
      groupCompare: (cats[0] && nums[0]) ? { by: cats[0], metric: nums[0] } : null,
      correlations: pairs,
      histogram: nums[0] ? { column: nums[0], bins: 8 } : null,
      frequency: cats.slice(0, 1)
    };
  }

  /* ---------------- 5. 校验大模型给的计划 ---------------- */
  function validatePlan(raw, prof) {
    var warnings = [];
    var def = defaultPlan(prof);
    if (!raw || typeof raw !== 'object') return { plan: def, warnings: ['计划不是对象，已使用默认计划'] };

    var numSet = {}, catSet = {}, all = {};
    prof.numeric.forEach(function (c) { numSet[c] = 1; all[c] = 1; });
    prof.categorical.forEach(function (c) { catSet[c] = 1; all[c] = 1; });

    function pickNum(list, limit) {
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (c) {
        if (typeof c !== 'string') return;
        if (numSet[c]) { if (out.indexOf(c) < 0 && out.length < limit) out.push(c); }
        else warnings.push('忽略不存在的数值列："' + c + '"');
      });
      return out;
    }

    var idSet = {}, highCard = {};
    prof.columns.forEach(function (c) {
      if (c.idLike) idSet[c.name] = 1;
      if (c.type === 'categorical' && c.unique > 12) highCard[c.name] = 1;
    });

    var plan = { source: 'ai', title: typeof raw.title === 'string' ? raw.title.slice(0, 40) : def.title };

    plan.descriptives = pickNum(raw.descriptives, 6);
    if (!plan.descriptives.length) plan.descriptives = def.descriptives;

    plan.metrics = plan.descriptives.slice();

    var gb = raw.groupBy;
    if (typeof gb === 'string' && catSet[gb] && !idSet[gb] && !highCard[gb]) plan.groupBy = gb;
    else { if (gb) warnings.push('分组列不合法，已忽略："' + gb + '"'); plan.groupBy = def.groupBy; }

    if (raw.groupCompare && typeof raw.groupCompare === 'object') {
      var by = raw.groupCompare.by, metric = raw.groupCompare.metric;
      if (catSet[by] && numSet[metric] && !idSet[by] && !highCard[by]) plan.groupCompare = { by: by, metric: metric };
      else { warnings.push('分组比较配置不合法，已改为默认'); plan.groupCompare = def.groupCompare; }
    } else plan.groupCompare = def.groupCompare;

    plan.correlations = [];
    (Array.isArray(raw.correlations) ? raw.correlations : []).forEach(function (p) {
      if (!Array.isArray(p) || p.length !== 2) return;
      if (numSet[p[0]] && numSet[p[1]] && p[0] !== p[1] && plan.correlations.length < 4) {
        plan.correlations.push([p[0], p[1]]);
      } else {
        warnings.push('忽略不合法的相关组合：' + JSON.stringify(p));
      }
    });
    if (!plan.correlations.length) plan.correlations = def.correlations;

    var h = raw.histogram;
    if (h && typeof h === 'object' && numSet[h.column]) {
      plan.histogram = { column: h.column, bins: Math.max(5, Math.min(12, Number(h.bins) || 8)) };
    } else plan.histogram = def.histogram;

    plan.frequency = [];
    (Array.isArray(raw.frequency) ? raw.frequency : []).forEach(function (c) {
      if (catSet[c] && !idSet[c] && !highCard[c] && plan.frequency.indexOf(c) < 0 && plan.frequency.length < 2) plan.frequency.push(c);
      else if (c) warnings.push('忽略不合法频数列："' + c + '"');
    });
    if (!plan.frequency.length) plan.frequency = def.frequency;
    return { plan: plan, warnings: warnings };
  }

  /* ---------------- 6. 计算 compute ---------------- */
  function describeColumn(recs, col) {
    var vals = recs.map(function (r) { return r[col]; }).filter(function (v) { return v != null; });
    var n = vals.length;
    if (!n) return { column: col, n: 0 };
    var v = variance(vals), s = v == null ? null : Math.sqrt(v);
    var m = mean(vals);
    var q1 = quantile(vals, 0.25), q3 = quantile(vals, 0.75);
    var iqr = (q1 != null && q3 != null) ? q3 - q1 : null;
    var lo = iqr != null ? q1 - 1.5 * iqr : null;
    var hi = iqr != null ? q3 + 1.5 * iqr : null;
    var outliers = 0;
    if (lo != null) vals.forEach(function (x) { if (x < lo || x > hi) outliers++; });
    return {
      column: col, n: n, missing: recs.length - n,
      mean: round(m, 3), median: round(quantile(vals, 0.5), 3),
      sd: round(s, 3), variance: round(v, 3),
      min: round(Math.min.apply(null, vals), 3),
      max: round(Math.max.apply(null, vals), 3),
      range: round(Math.max.apply(null, vals) - Math.min.apply(null, vals), 3),
      q1: round(q1, 3), q3: round(q3, 3), iqr: round(iqr, 3),
      cv: (m && s != null && m !== 0) ? round(s / Math.abs(m), 3) : null,
      skew: round(skewness(vals), 3), kurtosis: round(kurtosis(vals), 3),
      ci95: (s != null && n > 1) ? [round(m - 1.96 * s / Math.sqrt(n), 3), round(m + 1.96 * s / Math.sqrt(n), 3)] : null,
      outliers: outliers,
      outlierRate: round(outliers / n, 3)
    };
  }

  function compute(plan, cleanTable) {
    var recs = cleanTable.rows;
    var results = { descriptives: [], groups: null, correlations: [], histogram: null, frequency: [], meta: { n: recs.length, focus: plan.focus || null } };

    (plan.descriptives || []).forEach(function (c) {
      var d = describeColumn(recs, c);
      if (d.n) results.descriptives.push(d);
    });

    if (plan.groupCompare && plan.groupCompare.by && plan.groupCompare.metric) {
      var by = plan.groupCompare.by, metric = plan.groupCompare.metric;
      var buckets = {}, order = [];
      recs.forEach(function (r) {
        var g = r[by] == null ? '（空）' : String(r[by]);
        if (!buckets[g]) { buckets[g] = []; order.push(g); }
        if (r[metric] != null) buckets[g].push(r[metric]);
      });
      var groups = order.map(function (g) {
        var vals = (buckets[g] || []).filter(function (x) { return x != null; });
        if (!vals.length) return { group: g, n: 0 };
        var m = mean(vals), s = sd(vals);
        return { group: g, n: vals.length, mean: round(m, 3), median: round(quantile(vals, 0.5), 3), sd: round(s, 3), min: round(Math.min.apply(null, vals), 3), max: round(Math.max.apply(null, vals), 3) };
      }).filter(function (g) { return g.n > 0; });

      // 组间差异：最大均值组 vs 最小均值组，用合并标准差算效应量 d
      var effect = null, spread = null;
      if (groups.length >= 2) {
        var sorted = groups.slice().sort(function (a, b) { return b.mean - a.mean; });
        var hi = sorted[0], lo = sorted[sorted.length - 1];
        spread = round(hi.mean - lo.mean, 3);
        var pooled = Math.sqrt(((hi.n - 1) * Math.pow(hi.sd || 0, 2) + (lo.n - 1) * Math.pow(lo.sd || 0, 2)) / Math.max(1, hi.n + lo.n - 2));
        effect = pooled ? round((hi.mean - lo.mean) / pooled, 2) : null;
      }
      results.groups = { by: by, metric: metric, rows: groups, spread: spread, effect: effect };
    }

    (plan.correlations || []).forEach(function (pair) {
      var xs = recs.map(function (r) { return r[pair[0]]; });
      var ys = recs.map(function (r) { return r[pair[1]]; });
      var res = pearson(xs, ys);
      if (res.r != null) {
        var thr = res.n > 2 ? 1.96 / Math.sqrt(res.n - 2) : 1;
        results.correlations.push({
          a: pair[0], b: pair[1], r: round(res.r, 3), n: res.n,
          significant: Math.abs(res.r) > thr
        });
      }
    });

    if (plan.histogram && plan.histogram.column) {
      var col = plan.histogram.column;
      var vals = recs.map(function (r) { return r[col]; }).filter(function (v) { return v != null; });
      if (vals.length >= 3) {
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        var bins = Math.max(5, Math.min(12, plan.histogram.bins || 8));
        var w = (hi - lo) / bins || 1;
        var counts = [];
        for (var i = 0; i < bins; i++) counts.push({ lo: round(lo + i * w, 2), hi: round(lo + (i + 1) * w, 2), count: 0 });
        vals.forEach(function (v) {
          var idx = Math.min(bins - 1, Math.floor((v - lo) / w));
          counts[idx].count++;
        });
        results.histogram = { column: col, bins: counts };
      }
    }

    (plan.frequency || []).forEach(function (c) {
      var counts = {}, order = [];
      recs.forEach(function (r) {
        var k = r[c] == null ? '（空）' : String(r[c]);
        if (!counts[k]) { counts[k] = 0; order.push(k); }
        counts[k]++;
      });
      var items = order.map(function (k) { return { value: k, count: counts[k], pct: round(counts[k] / recs.length, 3) }; })
        .sort(function (a, b) { return b.count - a.count; }).slice(0, 10);
      results.frequency.push({ column: c, items: items });
    });

    // 散点数据（取第一对相关变量，最多 300 点，用于散点图）
    if (results.correlations.length) {
      var pa = results.correlations[0].a, pb = results.correlations[0].b;
      var pts = [];
      recs.forEach(function (r) {
        var x = r[pa], y = r[pb];
        if (x != null && y != null) pts.push([round(x, 3), round(y, 3)]);
      });
      if (pts.length > 300) {
        var step = pts.length / 300, sampled = [];
        for (var i2 = 0; i2 < pts.length; i2 += step) sampled.push(pts[Math.floor(i2)]);
        pts = sampled;
      }
      results.scatter = { x: pa, y: pb, points: pts, r: results.correlations[0].r };
    }

    // 相关系数矩阵（针对描述统计涉及的数值变量）
    var names = results.descriptives.map(function (d) { return d.column; });
    if (names.length >= 2 && plan.matrix !== false) {
      var matrix = names.map(function (a) {
        return names.map(function (b) {
          if (a === b) return 1;
          var xs = recs.map(function (r) { return r[a]; });
          var ys = recs.map(function (r) { return r[b]; });
          var res2 = pearson(xs, ys);
          return res2.r == null ? null : round(res2.r, 2);
        });
      });
      results.corrMatrix = { names: names, matrix: matrix };
    }

    return results;
  }

  /* ---------------- 7. 规则版提示（确定性，防幻觉的"锚"） ---------------- */
  function insights(results, prof) {
    var out = [];
    var smallCols = [];
    var midCv = [], lowCv = [];
    function add(level, title, text, metric) { out.push({ level: level, title: title, text: text, metric: metric || null }); }

    results.descriptives.forEach(function (d) {
      if (d.missing && d.n) {
        var rate = d.missing / (d.n + d.missing);
        if (rate > 0.05) {
          add('high', d.column + '：缺失比例偏高', '该变量缺失 ' + d.missing + ' 个观测（占 ' + (Math.round(rate * 1000) / 10) + '%），均值与方差估计可能产生偏移；建议补充数据或说明缺失机制后再作推断。', d.column);
        }
      }
      if (d.cv != null && d.cv >= 0.3) {
        add('high', d.column + '：离散程度较高', '变异系数 CV = ' + d.cv + '，超过 0.30 的经验阈值；观测值离散程度较高，提示样本中可能存在异质性群体或双峰分布。建议引入分层变量作进一步比较，不宜仅以总体均值概括。', d.column);
      } else if (d.cv != null && d.cv >= 0.2) {
        midCv.push(d.column + '（CV ' + d.cv + '）');
      } else if (d.cv != null && d.cv < 0.05) {
        lowCv.push(d.column + '（CV ' + d.cv + '）');
      }
      if (d.mean != null && d.median != null && Math.abs(d.median) > 1e-9) {
        var gap = Math.abs(d.mean - d.median) / Math.abs(d.median);
        if (gap > 0.2) {
          add('high', d.column + '：均值受极端值影响', '均值 ' + d.mean + ' 与中位数 ' + d.median + ' 相差 ' + (Math.round(gap * 1000) / 10) + '%，超过 20%；分布受少数极端观测牵引，宜以中位数度量典型水平，并核对原始记录。', d.column);
        }
      }
      if (d.skew != null && Math.abs(d.skew) > 1) {
        add('mid', d.column + '：分布显著偏斜', '偏度 = ' + d.skew + '，分布呈' + (d.skew > 0 ? '右偏（少数高值拉高均值）' : '左偏（少数低值拉低均值）') + '；中位数（' + d.median + '）较均值（' + d.mean + '）更能代表典型水平。', d.column);
      }
      if (d.outlierRate != null && d.outlierRate > 0.05) {
        add('mid', d.column + '：存在离群值', '按 1.5×IQR 准则检出 ' + d.outliers + ' 个离群观测（占 ' + (Math.round(d.outlierRate * 1000) / 10) + '%）；建议先核对原始记录，再确定保留或剔除，并在报告中说明处理方式。', d.column);
      }
      if (d.n < 30) smallCols.push(d.column + '（n=' + d.n + '）');
    });

    if (midCv.length) {
      add('mid', '部分变量差异中等：' + midCv.length + ' 个', midCv.join('、') + ' 的变异系数处于 0.20–0.30 区间；个体间差异较为明显，报告均值时应同时给出标准差或置信区间。', null);
    }
    if (lowCv.length) {
      add('mid', '部分变量离散偏低：' + lowCv.length + ' 个', lowCv.join('、') + ' 的变异系数低于 0.05，观测值高度集中于均值附近，区分度有限；若用于评价，辨别力不足。', null);
    }
    if (smallCols.length) {
      add('mid', '样本量不足：' + smallCols.length + ' 个变量', smallCols.join('、') + ' 的有效样本量均小于 30，均值与方差的抽样误差较大；结论属探索性，如需推断总体应扩大样本。', null);
    }

    if (results.groups && results.groups.effect != null) {
      var g = results.groups;
      if (Math.abs(g.effect) >= 0.8) {
        add('high', g.by + '：组间差异显著', '按「' + g.by + '」分组，「' + g.metric + '」最高组与最低组均值相差 ' + g.spread + '，效应量 d = ' + g.effect.toFixed(2) + '（≥0.80 属大效应）；组间差异具有实质意义，建议分群描述与决策，不以总体均值替代各组水平。', g.metric);
      } else if (Math.abs(g.effect) >= 0.5) {
        add('mid', g.by + '：组间存在中等差异', '组间均值差 ' + g.spread + '，效应量 d = ' + g.effect.toFixed(2) + '（0.50–0.80）；建议进一步考察各组内部结构。', g.metric);
      } else {
        add('low', g.by + '：组间差异有限', '效应量 d = ' + g.effect.toFixed(2) + '（<0.50）；各组均值接近，按该变量分层的必要性有限。', g.metric);
      }
    }

    results.correlations.forEach(function (c) {
      var ar = Math.abs(c.r);
      if (ar >= 0.6) {
        add('high', c.a + ' 与 ' + c.b + '：强相关', 'Pearson r = ' + c.r + '（n = ' + c.n + '），' + (c.significant ? '在 α = 0.05 水平上具有统计显著性。' : '受样本量限制，显著性不足。') + '相关关系不等同于因果关系，解释时应排除共同驱动因素。', c.a);
      } else if (ar >= 0.3) {
        add('mid', c.a + ' 与 ' + c.b + '：中等相关', 'Pearson r = ' + c.r + '（n = ' + c.n + '），存在同向变化趋势，可作为进一步建模的候选变量。', c.a);
      }
    });

    results.frequency.forEach(function (f) {
      if (!f.items.length) return;
      var top = f.items[0];
      if (top.pct > 0.8 && f.items.length > 1) {
        add('mid', f.column + '：分布高度集中', '「' + top.value + '」占 ' + (Math.round(top.pct * 1000) / 10) + '%，其余类别样本稀少；分组比较时小样本组的估计不稳定，宜谨慎解读。', f.column);
      }
    });

    if (!out.length) {
      add('low', '未发现显著异常', '各项指标均处于常见范围内，可直接进入业务解读。');
    }
    return out;
  }

  /* ---------------- 8. 给大模型的两段提示词 ---------------- */
  function buildPlanPrompt(prof, sampleRows, fileName, pool, focus) {
    var colLines = prof.columns.map(function (c) {
      return '- ' + c.name + '：' + (c.type === 'numeric' ? '数值型' : '类别型') +
        (c.idLike ? '（标识列，不要用于分组）' : '') +
        '｜有效 ' + c.n + '｜缺失 ' + c.missing +
        (c.type === 'numeric' ? '｜范围 ' + c.min + '~' + c.max : '｜取值示例 ' + c.categories.slice(0, 5).join('/'));
    }).join('\n');
    var sample = (sampleRows || []).slice(0, 4).map(function (r) { return JSON.stringify(r); }).join('\n');
    return [
      '你是统计分析顾问。请先判读数据的变量结构，再确定本次分析应输出哪些统计量。',
      '只输出 JSON，不要解释文字，不要用 markdown 代码块。',
      '',
      '【文件】' + (fileName || '未命名') + '，共 ' + prof.n + ' 行 × ' + prof.m + ' 列',
      '【列信息】',
      colLines,
      '【前几行样例】',
      sample,
      '',
      (pool && pool.length ? '【用户已选定的分析变量】' + pool.join('、') + '（仅可从中选择，不得引入其他变量）' : ''),
      (focus ? '【本次主分析变量】' + focus + '：方案与解释都要围绕它展开；其余变量只在相关分析中作为对照，不要单独分析或给建议。' : ''),
      '',
      '【可用的统计动作】（只能从这里选，不能自创）',
      '1) descriptives：对数值列做描述统计（均值、中位数、标准差、方差、最值、四分位、偏度、峰度、异常值）',
      '2) groupCompare：按某个类别列分组，比较某数值列的组间差异',
      '3) correlations：两两数值列的相关系数（最多 4 对）',
      '4) histogram：某个数值列的分布直方图（bins 取 5–12）',
      '5) frequency：某个类别列的频数分布',
      '',
      '【输出格式】',
      '{"title":"一句话标题","groupBy":"类别列名或null",',
      ' "descriptives":["数值列1","数值列2"],',
      ' "groupCompare":{"by":"类别列","metric":"数值列"} 或 null,',
      ' "correlations":[["数值列A","数值列B"]],',
      ' "histogram":{"column":"数值列","bins":8} 或 null,',
      ' "frequency":["类别列"]}',
      '',
      '【硬性约束】',
      '- 列名必须与上面完全一致，不得翻译、不得新增。',
      '- 依据统计惯例选择：通常 2–4 个核心指标作描述统计，1 个分组比较，1–3 对相关分析。',
      '- 每一项都应回答一个明确的分析问题（如组间差异来源、变量间关联强度）。',
      '- 只输出一个可被 JSON.parse 解析的对象。'
    ].join('\n');
  }

  function buildAdvicePrompt(results, prof, focus) {
    var live = results.descriptives.map(function (d) {
      return { 指标: d.column, 有效样本: d.n, 均值: d.mean, 中位数: d.median, 标准差: d.sd, 方差: d.variance, 最小值: d.min, 最大值: d.max, 变异系数: d.cv, 偏度: d.skew, 异常值个数: d.outliers };
    });
    var groups = results.groups ? { 分组列: results.groups.by, 指标: results.groups.metric, 组别: results.groups.rows, 组间极差: results.groups.spread, 效应量: results.groups.effect } : null;
    var cors = results.correlations.map(function (c) { return { 变量A: c.a, 变量B: c.b, 相关系数: c.r, 样本量: c.n }; });
    return [
      '你是一名经管数据分析顾问。下面是一份已经用代码算好的统计结果（数字可信，不得改动）。',
      '请据此写出面向业务方的分析建议。',
      '',
      '【统计结果 JSON】',
      JSON.stringify({ 描述统计: live, 分组比较: groups, 相关分析: cors }, null, 1),
      '',
      '【输出要求】',
      (focus ? '0. 只围绕主分析变量「' + focus + '」给结论；其他变量只在相关关系中被提及，不要逐个点评。' : ''),
      '1. 先给一句总体结论（不超过 40 字）。',
      '2. 再给 3–5 条结论，每条按"【发现】—【依据】—【建议】"三段撰写，每条不超过 120 字。',
      '3. 每条"依据"必须引用上面的具体数字（如均值 71.2、CV 0.33、r = 0.62）。',
      '4. 表述应严谨：不使用"显著提升"等缺乏检验依据的措辞；涉及差异时注明统计量。',
      '5. 结尾固定一句：以上结论基于所提供数据的统计结果，供决策参考，不替代业务判断。',
      '',
      '【硬性约束】',
      '- 只能使用上面出现过的数字；需要但没提供的数字，写"数据未提供"，不得估算。',
      '- 相关关系不得写成因果关系。',
      '- 不要输出表格，用短段落。'
    ].join('\n');
  }

  /* ---------------- 9. JSON 解析（容错） ---------------- */
  function parseJSON(text) {
    if (!text) return null;
    var s = String(text).trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
  }

  return {
    version: '2.0.0',
    parseCSV: parseCSV,
    profile: profile,
    clean: clean,
    defaultPlan: defaultPlan,
    validatePlan: validatePlan,
    compute: compute,
    insights: insights,
    buildPlanPrompt: buildPlanPrompt,
    buildAdvicePrompt: buildAdvicePrompt,
    parseJSON: parseJSON,
    utils: { mean: mean, sd: sd, variance: variance, quantile: quantile, pearson: pearson, round: round, toNumber: toNumber }
  };
});
