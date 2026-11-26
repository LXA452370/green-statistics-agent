/* 绿账本 · 前端交互层 */
(function () {
  'use strict';

  var S = { fileName: '', headers: [], rows: [], quality: null, plan: null, clean: null, metrics: null, report: '', skip: [], source: '' };

  /* ---------------- 基础工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, ms) {
    var t = $('#toast');
    if (!t) { t = el('div', 'toast'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(d == null ? 2 : d).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return s.join('.');
  }
  function pct(n) { return n == null ? '—' : (Math.round(n * 1000) / 10) + '%'; }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------- 文件读取 ---------------- */
  function decodeBuffer(buf) {
    var u8 = new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { }
    try { return new TextDecoder('gbk').decode(u8); } catch (e) { }
    return new TextDecoder('utf-8').decode(u8);
  }

  function tableFromAOA(aoa) {
    aoa = (aoa || []).filter(function (r) {
      return r && r.some(function (c) { return c != null && String(c).trim() !== ''; });
    });
    if (!aoa.length) return { headers: [], rows: [] };
    var headers = aoa[0].map(function (h, i) { return String(h == null ? '' : h).trim() || ('列' + (i + 1)); });
    // 表头去重
    var seen = {};
    headers = headers.map(function (h) {
      if (seen[h]) { seen[h]++; return h + '_' + seen[h]; }
      seen[h] = 1; return h;
    });
    return { headers: headers, rows: aoa.slice(1) };
  }

  async function readFile(file) {
    var name = file.name || '';
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (file.size > 12 * 1024 * 1024) { toast('文件超过 12 MB，建议先拆分或另存为 CSV'); return; }
    try {
      var buf = await file.arrayBuffer();
      var table;
      if (ext === 'csv' || ext === 'txt') {
        table = window.GreenLedger.parseCSV(decodeBuffer(buf));
      } else if (ext === 'xlsx') {
        if (!window.XLSXLite) throw new Error('xlsx 解析器未加载');
        var res = await window.XLSXLite.read(buf);
        table = tableFromAOA(res.aoa);
        if (res.sheets && res.sheets.length > 1) toast('已读取第一个工作表：' + res.name);
      } else if (ext === 'xls') {
        toast('不支持旧版 .xls，请在 Excel 里"另存为" .xlsx 或 .csv 后上传');
        return;
      } else {
        toast('暂不支持该格式，请上传 .csv / .xlsx');
        return;
      }
      if (!table.rows.length) { toast('没有读到数据行，请检查表头与内容'); return; }
      S.fileName = name; S.source = 'upload';
      startAnalyze(table.headers, table.rows);
    } catch (err) {
      console.error(err);
      toast('解析失败：' + err.message);
    }
  }

  /* ---------------- 步骤切换 ---------------- */
  function goto(step) {
    $$('.panel[data-panel]').forEach(function (p) {
      p.hidden = Number(p.getAttribute('data-panel')) !== step;
    });
    $$('#steps li').forEach(function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.classList.toggle('active', n === step);
      li.classList.toggle('done', n < step);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 体检 ---------------- */
  function startAnalyze(headers, rows) {
    var GL = window.GreenLedger;
    S.headers = headers; S.rows = rows; S.skip = [];
    S.quality = GL.audit(headers, rows);
    S.plan = GL.makePlan(S.quality, {
      factor: parseFloat($('#factor').value) || 0.5703
    });
    renderQuality();
    goto(2);
  }

  function renderQuality() {
    var q = S.quality, GL = window.GreenLedger;
    $('#fileMeta').textContent = (S.fileName || '示例数据') + '　·　' + q.n + ' 行 × ' + q.m + ' 列　·　识别到 ' + Object.keys(q.mapping).length + ' 个语义字段';

    // 分数环
    var score = q.health.score;
    $('#scoreNum').textContent = score;
    var C = 2 * Math.PI * 52;
    var ring = $('#ringFg');
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C * (1 - score / 100);
    ring.style.stroke = score >= 85 ? '#1F6F5C' : score >= 65 ? '#B7791F' : '#B23B3B';

    var parts = [
      ['完整性', q.health.parts.completeness, 30],
      ['一致性', q.health.parts.consistency, 30],
      ['有效性', q.health.parts.validity, 20],
      ['唯一性', q.health.parts.uniqueness, 20]
    ];
    var box = $('#scoreParts'); box.innerHTML = '';
    parts.forEach(function (p) {
      var row = el('div', 'bar-row');
      row.innerHTML = '<span>' + p[0] + '</span><div class="bar"><i style="width:' + (p[1] / p[2] * 100) + '%"></i></div><b>' + Math.round(p[1]) + '/' + p[2] + '</b>';
      box.appendChild(row);
    });

    // 问题清单
    var list = $('#issueList'); list.innerHTML = '';
    if (!q.issues.length) list.appendChild(el('li', '', '<span class="dot"></span><div><div class="i-title">没有发现明显问题</div><div class="i-detail">这份数据可以直接进入分析。</div></div>'));
    q.issues.forEach(function (it) {
      var li = el('li', it.severity);
      var detail = Array.isArray(it.detail) ? it.detail.join('；') : it.detail;
      li.innerHTML = '<span class="dot"></span><div><div class="i-title">' + esc(it.title) + '</div><div class="i-detail">' + esc(detail) + '</div></div><span class="i-count">' + it.count + '</span>';
      list.appendChild(li);
    });

    // 字段映射
    var chips = $('#mappingChips'); chips.innerHTML = '';
    var GLc = window.GreenLedger;
    GLc.CANON.forEach(function (c) {
      var has = q.mapping[c.key] != null;
      var chip = el('div', 'chip');
      chip.style.opacity = has ? 1 : .45;
      chip.innerHTML = '<b>' + esc(c.label) + '</b>　' + (has ? '← ' + esc(q.mappingByKey[c.key]) : '<span>未识别</span>');
      chips.appendChild(chip);
    });

    // 清洗计划
    var pl = $('#planList'); pl.innerHTML = '';
    S.skip = [];
    S.plan.steps.forEach(function (st) {
      var toggleable = ['unit', 'dedup', 'fill'].indexOf(st.id) >= 0;
      var item = el('div', 'plan-item on');
      var acts = st.actions.map(function (a) {
        var count = a.count != null ? '（' + a.count + '）' : '';
        return '<div><span class="from">' + esc(a.from) + '</span> → ' + esc(a.to) + count + '</div>';
      }).join('');
      item.innerHTML =
        '<label class="plan-head">' +
        '<input type="checkbox" checked ' + (toggleable ? '' : 'disabled') + ' data-step="' + st.id + '" />' +
        '<div><div class="p-title">' + esc(st.title) + (toggleable ? '' : '　<span class="tiny muted">（始终执行）</span>') + '</div>' +
        '<div class="p-reason">' + esc(st.reason) + '</div></div></label>' +
        '<div class="plan-actions">' + acts + '</div>';
      pl.appendChild(item);
      var cb = $('input', item);
      if (toggleable) {
        cb.addEventListener('change', function () {
          item.classList.toggle('on', cb.checked);
          if (!cb.checked) { if (S.skip.indexOf(st.id) < 0) S.skip.push(st.id); }
          else { S.skip = S.skip.filter(function (x) { return x !== st.id; }); }
        });
      }
    });

    var risk = $('#riskNotes'); risk.innerHTML = '';
    if (S.plan.risk_notes.length) {
      risk.innerHTML = '<b>需要知道的前提</b><ul>' + S.plan.risk_notes.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    } else risk.hidden = true;
  }

  /* ---------------- 执行 ---------------- */
  function runClean() {
    var GL = window.GreenLedger;
    S.clean = GL.execute(S.quality, S.plan, { skip: S.skip });
    renderClean();
    goto(3);
  }

  function renderClean() {
    var c = S.clean, st = c.stats;
    $('#cleanMeta').textContent = '原始 ' + c.before.rows + ' 行 → 清洗后 ' + c.after.rows + ' 行　·　健康分 ' + c.before.score + ' → ' + c.after.score;

    var k = $('#cleanKpis'); k.innerHTML = '';
    [
      ['保留行数', fmt(c.after.rows, 0), '行', '去重后'],
      ['数据健康分', c.after.score, '分', '清洗前 ' + c.before.score + ' 分'],
      ['被修正的行', fmt(st.unitFixed + st.filledCells + st.dateFixed, 0), '处', '单位/缺失/日期'],
      ['被标记的行', fmt(st.flaggedRows, 0), '行', '仅标记，不删除']
    ].forEach(function (x) {
      var d = el('div', 'kpi');
      d.innerHTML = '<div class="k-label">' + x[0] + '</div><div class="k-value">' + x[1] + '<small>' + x[2] + '</small></div><div class="k-foot">' + x[3] + '</div>';
      k.appendChild(d);
    });

    var stats = [
      ['删除重复行', st.removedRows],
      ['单位修正', st.unitFixed],
      ['缺失填充', st.filledCells],
      ['日期规范化', st.dateFixed],
      ['站点名归并', st.siteMerged],
      ['同日多记录(保留)', st.dayDupKept],
      ['PUE 重算', st.pueRecomputed],
      ['标记行数', st.flaggedRows]
    ];
    $('#cleanStats').innerHTML = stats.map(function (s) {
      return '<div class="stat"><b>' + fmt(s[1], 0) + '</b><span>' + s[0] + '</span></div>';
    }).join('');

    // 改动明细
    var t = $('#changeTable');
    var head = '<thead><tr><th>原表行号</th><th>站点</th><th>日期</th><th>改动标记</th></tr></thead>';
    var body = c.changeLog.slice(0, 12).map(function (r) {
      return '<tr><td>' + r.row + '</td><td>' + esc(r.site) + '</td><td>' + r.date + '</td><td>' +
        r.flags.map(function (f) { return '<span class="flag">' + esc(f) + '</span>'; }).join('') + '</td></tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + (body || '<tr><td colspan="4" class="muted">本批次没有发生改动</td></tr>') + '</tbody>';

    // 预览
    var pv = $('#previewTable');
    var cols = [['site', '站点'], ['date', '日期'], ['it_kwh', 'IT 能耗(kWh)'], ['total_kwh', '总能耗(kWh)'], ['pue', 'PUE'], ['green_kwh', '绿电(kWh)'], ['cost', '电费(元)'], ['temp', '温度(℃)'], ['flag', '标记']];
    pv.innerHTML = '<thead><tr>' + cols.map(function (c2) { return '<th>' + c2[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      c.rows.slice(0, 12).map(function (r) {
        return '<tr>' + cols.map(function (c2) {
          var v = r[c2[0]];
          if (c2[0] === 'flag') return '<td>' + (v || []).map(function (f) { return '<span class="flag">' + esc(f) + '</span>'; }).join('') + '</td>';
          if (c2[0] === 'site' || c2[0] === 'date') return '<td>' + esc(v) + '</td>';
          return '<td class="num">' + (v == null ? '—' : (typeof v === 'number' ? fmt(v, 2) : esc(v))) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
  }

  function cleanedCsv() {
    var cols = [['site', '站点'], ['date', '日期'], ['it_kwh', 'IT能耗(kWh)'], ['total_kwh', '总能耗(kWh)'], ['pue', 'PUE'], ['green_kwh', '绿电电量(kWh)'], ['price', '电价(元/kWh)'], ['cost', '电费(元)'], ['temp', '温度(℃)'], ['load_rate', '负载率(%)'], ['flag', '清洗标记']];
    var lines = [cols.map(function (c) { return c[1]; }).join(',')];
    S.clean.rows.forEach(function (r) {
      lines.push(cols.map(function (c) {
        var v = r[c[0]];
        if (c[0] === 'flag') v = (v || []).join('|');
        if (v == null) v = '';
        v = String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  /* ---------------- 报告 ---------------- */
  function buildReport() {
    var GL = window.GreenLedger;
    S.metrics = GL.metrics(S.clean, { factor: parseFloat($('#factor').value) || 0.5703 });
    S.report = GL.buildReport({
      quality: S.quality, clean: S.clean, metrics: S.metrics, plan: S.plan,
      opts: { fileName: S.fileName || '示例数据', title: $('#reportTitle').value || '数据中心能效与碳排数据分析报告' }
    });
    renderReport();
    goto(4);
  }

  function renderReport() {
    var m = S.metrics;
    $('#reportMeta').textContent = '基于 ' + m.rows + ' 行数据　·　排放因子 ' + m.factor + ' tCO₂/MWh　·　生成于 ' + new Date().toLocaleString('zh-CN');
    var k = $('#reportKpis'); k.innerHTML = '';
    [
      ['平均 PUE', m.pue.mean == null ? '—' : m.pue.mean, '', '区间 ' + (m.pue.min == null ? '—' : m.pue.min) + '–' + (m.pue.max == null ? '—' : m.pue.max)],
      ['绿电占比', m.green.ratio == null ? '—' : pct(m.green.ratio), '', m.green.ratio == null ? '未提供绿电字段' : '绿电 ' + fmt(m.energy.green_kwh, 0) + ' kWh'],
      ['碳排估算', fmt(m.carbon.tco2, 1), 'tCO₂e', '按 ' + m.factor + ' 估算'],
      ['电费合计', fmt(m.energy.cost, 0), '元', '总用电 ' + fmt(m.energy.total_kwh, 0) + ' kWh']
    ].forEach(function (x) {
      var d = el('div', 'kpi');
      var unit = (x[1] === '—' || x[1] === '') ? '' : '<small>' + x[2] + '</small>';
      d.innerHTML = '<div class="k-label">' + x[0] + '</div><div class="k-value">' + x[1] + unit + '</div><div class="k-foot">' + x[3] + '</div>';
      k.appendChild(d);
    });

    renderCharts(m);

    var at = $('#anomalyTable');
    at.innerHTML = '<thead><tr><th>日期</th><th>站点</th><th>PUE</th><th>总能耗(kWh)</th><th>标记</th></tr></thead><tbody>' +
      (m.anomalies.length ? m.anomalies.map(function (a) {
        return '<tr><td>' + esc(a.date) + '</td><td>' + esc(a.site) + '</td><td class="num">' + (a.pue == null ? '—' : a.pue) + '</td><td class="num">' + (a.total_kwh == null ? '—' : fmt(a.total_kwh, 0)) + '</td><td>' + a.flags.map(function (f) { return '<span class="flag">' + esc(f) + '</span>'; }).join('') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">本批次未发现越界或逻辑冲突记录</td></tr>') + '</tbody>';

    $('#reportRender').innerHTML = mdToHtml(S.report);
    $('#reportSource').textContent = S.report;
  }

  /* ---------------- 图表 ---------------- */
  function lineChart(months, key, unit, color) {
    var W = 340, H = 170, P = { l: 34, r: 10, t: 12, b: 22 };
    var pts = months.filter(function (m) { return m[key] != null; });
    if (pts.length < 2) return '<p class="muted tiny">月度数据不足，无法绘制趋势</p>';
    var vals = pts.map(function (m) { return m[key]; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pad = (mx - mn) * 0.15 || 0.1;
    mn = Math.max(0, mn - pad); mx = mx + pad;
    function X(i) { return P.l + (W - P.l - P.r) * (i / (pts.length - 1)); }
    function Y(v) { return P.t + (H - P.t - P.b) * (1 - (v - mn) / (mx - mn)); }
    var path = pts.map(function (m, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(m[key]).toFixed(1); }).join(' ');
    var area = path + ' L' + X(pts.length - 1).toFixed(1) + ' ' + (H - P.b) + ' L' + P.l + ' ' + (H - P.b) + ' Z';
    var grid = [0, .25, .5, .75, 1].map(function (t) {
      var y = P.t + (H - P.t - P.b) * t, v = mx - (mx - mn) * t;
      return '<line class="axis" x1="' + P.l + '" y1="' + y + '" x2="' + (W - P.r) + '" y2="' + y + '" stroke-dasharray="2 3"/>' +
        '<text class="axis-label" x="' + (P.l - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + (unit === 'PUE' ? v.toFixed(2) : fmt(v, 0)) + '</text>';
    }).join('');
    var labels = pts.map(function (m, i) {
      if (i % Math.ceil(pts.length / 6) !== 0 && i !== pts.length - 1) return '';
      return '<text class="axis-label" x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + m.month.slice(2) + '</text>';
    }).join('');
    var dots = pts.map(function (m, i) { return '<circle cx="' + X(i) + '" cy="' + Y(m[key]) + '" r="2.4" fill="' + (color || '#1F6F5C') + '"/>'; }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + (color || '#1F6F5C') + '" stop-opacity=".22"/><stop offset="1" stop-color="' + (color || '#1F6F5C') + '" stop-opacity="0"/></linearGradient></defs>' +
      grid + '<path class="area" d="' + area + '"/><path class="line" d="' + path + '" stroke="' + (color || '#1F6F5C') + '"/>' + dots + labels + '</svg>';
  }

  function barChart(months, key) {
    var W = 340, H = 170, P = { l: 40, r: 8, t: 12, b: 22 };
    var pts = months.slice(-12);
    if (!pts.length) return '<p class="muted tiny">暂无数据</p>';
    var vals = pts.map(function (m) { return m[key] || 0; });
    var mx = Math.max.apply(null, vals) || 1;
    var bw = (W - P.l - P.r) / pts.length * 0.62;
    var step = (W - P.l - P.r) / pts.length;
    var grid = [0, .5, 1].map(function (t) {
      var y = P.t + (H - P.t - P.b) * t, v = mx * (1 - t);
      return '<line class="axis" x1="' + P.l + '" y1="' + y + '" x2="' + (W - P.r) + '" y2="' + y + '" stroke-dasharray="2 3"/>' +
        '<text class="axis-label" x="' + (P.l - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)) + '</text>';
    }).join('');
    var bars = pts.map(function (m, i) {
      var h = (H - P.t - P.b) * (vals[i] / mx);
      var x = P.l + step * i + (step - bw) / 2;
      return '<rect class="bar-r" x="' + x.toFixed(1) + '" y="' + (H - P.b - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"><title>' + m.month + '：' + fmt(vals[i], 0) + '</title></rect>';
    }).join('');
    var labels = pts.map(function (m, i) {
      if (i % 2 !== 0 && i !== pts.length - 1) return '';
      return '<text class="axis-label" x="' + (P.l + step * i + step / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + m.month.slice(2) + '</text>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + bars + labels + '</svg>';
  }

  function donut(ratio) {
    var known = ratio != null;
    var r = known ? Math.max(0, Math.min(1, ratio)) : 0;
    var C = 2 * Math.PI * 44;
    return '<svg class="chart" viewBox="0 0 170 170" style="max-width:170px;margin:0 auto">' +
      '<circle class="donut-bg" cx="85" cy="85" r="44"/>' +
      (known ? '<circle class="donut-fg" cx="85" cy="85" r="44" transform="rotate(-90 85 85)" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C * (1 - r)) + '"/>' : '') +
      '<text x="85" y="82" text-anchor="middle" font-size="24" font-weight="700" fill="#153F36">' + (known ? pct(r) : '—') + '</text>' +
      '<text x="85" y="102" text-anchor="middle" font-size="10" fill="#71827C">' + (known ? '绿电占比' : '无绿电字段') + '</text></svg>';
  }

  function renderCharts(m) {
    var box = $('#charts'); box.innerHTML = '';
    var c1 = el('div', 'card');
    c1.innerHTML = '<div class="chart-title">PUE 月度走势</div><div class="chart-sub">理论下限 1.0；风冷机房常见 1.3–1.8</div>' + lineChart(m.months, 'pue', 'PUE');
    var c2 = el('div', 'card');
    c2.innerHTML = '<div class="chart-title">月度总能耗</div><div class="chart-sub">单位 kWh，最多显示 12 个月</div>' + barChart(m.months, 'total_kwh');
    var c3 = el('div', 'card');
    c3.innerHTML = '<div class="chart-title">绿电占比</div><div class="chart-sub">绿电电量 ÷ 总用电量</div>' + donut(m.green.ratio);
    box.appendChild(c1); box.appendChild(c2); box.appendChild(c3);
  }

  /* ---------------- Markdown 渲染（够用即可） ---------------- */
  function inline(s) {
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  }
  function mdToHtml(md) {
    var lines = md.split('\n'), out = [], i = 0;
    while (i < lines.length) {
      var ln = lines[i];
      if (/^\s*$/.test(ln)) { i++; continue; }
      if (/^###\s+/.test(ln)) { out.push('<h3>' + inline(ln.replace(/^###\s+/, '')) + '</h3>'); i++; continue; }
      if (/^##\s+/.test(ln)) { out.push('<h2>' + inline(ln.replace(/^##\s+/, '')) + '</h2>'); i++; continue; }
      if (/^#\s+/.test(ln)) { out.push('<h1>' + inline(ln.replace(/^#\s+/, '')) + '</h1>'); i++; continue; }
      if (/^>\s?/.test(ln)) { out.push('<blockquote>' + inline(ln.replace(/^>\s?/, '')) + '</blockquote>'); i++; continue; }
      if (/^\|/.test(ln)) {
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        var cells = rows.map(function (r) { return r.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); });
        var html = '<table><thead><tr>' + cells[0].map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        cells.slice(2).forEach(function (r) {
          html += '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        });
        out.push(html + '</tbody></table>');
        continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        var items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>'); i++; }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {
        var oitems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { oitems.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++; }
        out.push('<ol>' + oitems.join('') + '</ol>');
        continue;
      }
      out.push('<p>' + inline(ln) + '</p>');
      i++;
    }
    return out.join('\n');
  }

  /* ---------------- 示例与文件 ---------------- */
  function loadSample(id) {
    var list = window.GL_SAMPLES || [];
    var s = list.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var table = window.GreenLedger.parseCSV(s.text);
    if (!table.rows.length) { toast('示例数据解析失败'); return; }
    S.fileName = s.name; S.source = 'sample';
    startAnalyze(table.headers, table.rows);
  }

  function renderSamples() {
    var box = $('#sampleList'); box.innerHTML = '';
    (window.GL_SAMPLES || []).forEach(function (s) {
      var b = el('button', 'sample');
      b.type = 'button';
      b.innerHTML = '<span class="s-ico">' + s.badge + '</span><span><span class="s-name">' + esc(s.name) + '</span><br><span class="s-desc">' + esc(s.desc) + '</span></span>';
      b.addEventListener('click', function () { loadSample(s.id); });
      box.appendChild(b);
    });
    if (!(window.GL_SAMPLES || []).length) box.innerHTML = '<p class="muted tiny">示例数据未加载</p>';
  }

  /* ---------------- AI 增强（可选） ---------------- */
  function aiPrompt() {
    var m = S.metrics;
    return '下面是一份数据中心能效与碳排数据的指标 JSON 和规则引擎生成的分析草稿。\n' +
      '请在不改变任何数字的前提下，改写成更连贯的分析文字：先给结论，再给三个要点，最后给两条建议。\n' +
      '硬性要求：只能引用 JSON 中出现的数字；不得出现"显著提升"等无依据定性词；结尾必须保留免责声明。\n\n' +
      '【指标 JSON】\n' + JSON.stringify({
        pue: m.pue, green: m.green, carbon: m.carbon, energy: m.energy,
        months: m.months, factor: m.factor, rows: m.rows
      }, null, 2) + '\n\n【规则引擎草稿】\n' + S.report;
  }

  function callAI() {
    var base = ($('#aiBase').value || '').trim();
    var key = ($('#aiKey').value || '').trim();
    var model = ($('#aiModel').value || 'deepseek-chat').trim();
    if (!base || !key) { toast('请先填写接口地址与 API Key（或使用"复制提示词"）'); return; }
    var url = /\/chat\/completions$/.test(base) ? base : base.replace(/\/+$/, '') + '/chat/completions';
    var out = $('#aiOut');
    out.textContent = '正在请求模型…';
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: model, temperature: 0.4,
        messages: [{ role: 'user', content: aiPrompt() }]
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var txt = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : JSON.stringify(j);
      out.textContent = txt;
      toast('AI 版分析已生成');
    }).catch(function (e) {
      out.textContent = '调用失败：' + e.message + '\n可能原因：浏览器跨域限制、Key 无效或额度不足。\n可以点"复制提示词"，粘贴到任意大模型/Coze 里使用，效果一致。';
    });
  }

  /* ---------------- 工作流表格与提示词 ---------------- */
  var FLOW = [
    ['①', '接入 / 文件接收', '读取 CSV 或 Excel，识别编码（UTF-8 → GBK），保留原始表头', '换行符、合并表头、GBK 编码是实际台账里最常见的三个坑；先解决"读得进"，后面才有意义'],
    ['②', '解析为二维表', '统一成"表头 + 行"，表头去重、空行剔除', '把文件变成程序可计算的结构，后续所有规则都基于这张表'],
    ['③', '数据体检（代码）', '缺失率、重复行、单位混用、日期格式、PUE 越界、逻辑冲突，输出 0–100 健康分', '先诊断再动手：没有体检的"清洗"往往是拍脑袋，也说不清改了什么'],
    ['④', '清洗计划（规则）', '生成可读的计划：字段映射、单位换算、日期规范、去重键、填充规则、异常策略', '把"要做什么"和"为什么"写下来，用户可勾选确认；这一步替代了"模型随意决定"'],
    ['⑤', '执行清洗（代码）', '按计划逐条执行，每一处改动记进改动明细（行号 + 标记）', '确定性执行才能复现：同一份数据跑两次结果一致，答辩时说得清'],
    ['⑥', '指标计算（代码）', 'PUE、绿电占比、碳排、电费、月度序列', '公式写死在代码里，避免模型口算出错；排放因子显式可改'],
    ['⑦', '可视化（SVG）', 'PUE 趋势、月度能耗、绿电占比环图', '一张趋势图比十行数字更容易看出问题，也方便直接贴进月报'],
    ['⑧', '报告拼装', '结论 → 质量对比 → 能效 → 绿色化 → 异常清单 → 建议 → 口径与来源', '固定结构保证每次输出一致，且第 7 段强制交代来源与假设'],
    ['⑨', '输出与留痕', '下载清洗后 CSV、下载 Markdown、打印 PDF；改动明细可追溯', '交付物要能被复核：数据从哪来、改了哪几行、结论基于什么']
  ];

  var REQ = [
    ['R1 选题与课程相关', 'PUE、绿电占比、碳排因子、算力能效均在计算与报告中出现', '报告第 2、3、4 节；「关于与口径」页'],
    ['R3 场景/用户/流程', '面向机房能源岗与 ESG 岗的月度台账清洗', '首页说明 + 四步流程 + 工作流图'],
    ['R6 工具调用或数据处理', '代码完成体检、清洗、指标计算（不是让模型读表）', '第 ③⑤⑥ 节点'],
    ['R6 多步骤任务处理', '九个节点串成流水线，含人工确认点', '工作流图 + 步骤导航'],
    ['R7 不能只是聊天界面', '有确定性的计算引擎、计划确认、改动留痕', '整个交互流程'],
    ['R12 测试案例与记录', '内置三套示例数据 + 可量化的预期结果', 'data/ 目录与测试记录表'],
    ['R17 来源与假设', '排放因子来源、清洗假设、免责声明写入报告', '报告第 7 节']
  ];

  var PROMPTS = {
    p1: '你是"绿账本"，一个面向数据中心与园区能源数据的清洗与分析助手。\n你的用户是能源/运维岗、ESG 分析岗和做绿色转型课题的学生，他们通常不懂编程，但需要一份能直接放进月报的数据结论。\n\n你的工作分三步，必须按顺序：\n1) 体检：判断这份数据能不能用（缺什么列、单位是否一致、有无重复与异常）。\n2) 清洗：按用户确认的口径处理，并把每一处改动记录下来。\n3) 分析：基于清洗后的数据给出结论，每个数字都要注明来自哪一列、怎么算的。\n\n硬性约束：\n- 不得编造列名、数值、单位或来源。数据里没有的字段，直接说"当前数据不具备"。\n- 涉及碳排放时，必须同时给出排放因子数值、来源与年份。\n- 涉及 PUE 时，说明其物理含义（总能耗/IT 能耗），并指出 1.0 为理论下限。\n- 越界判断只做"标记 + 说明"，不擅自删除原始数据。\n- 不确定就问，一次最多问 3 个问题。',
    p2: '【任务】根据数据体检结果，生成清洗计划。只输出 JSON。\n【输入】quality（体检 JSON）、sample（前 5 行）\n【输出】{"rename":{},"unit_convert":[{"column":"","from":"MWh","to":"kWh","factor":1000}],"date_parse":{},"dedup":{"keys":[],"keep":"first"},"fill":[],"outliers":[],"drop_columns":[],"risk_notes":[]}\n【约束】\n1. 列名必须来自输入，禁止自造。\n2. 单位换算只允许 1000 的整数次幂或 1/1000。\n3. 异常值默认 mark_only，只有用户明确要求才允许 drop。\n4. 信息不足时写"需用户确认"，不要猜。\n5. 输出必须能被 json.loads 解析。',
    p3: '【角色】你是绿色算力领域的数据分析员。\n【输入】metrics（已算好的指标）、quality（体检）、before_after（清洗前后）\n【必须包含 7 段】1 一句话结论；2 数据质量；3 能效（PUE）；4 绿色化（绿电/碳排）；5 异常清单；6 三条改进建议；7 口径与来源。\n【硬性约束】所有数字必须能在 metrics 中找到；不得使用"显著提升"等无依据定性词；结尾固定一句免责声明（本报告由智能体基于用户上传数据自动生成，结论供参考，不替代现场能效诊断）。',
    p4: '遇到以下情况，直接说明原因并给出可行替代：\n1. 文件不是表格（PDF/图片/扫描件）→ 说明只处理 xlsx/csv，建议先导出。\n2. 表头缺失或为空 → 说明可能是合并单元格，请改单行表头后重试。\n3. 要求"预测明年电费""算投资回报"→ 说明需要负荷预测与投资模型，当前仅能做趋势描述。\n4. 数据疑似含真实企业敏感信息 → 提醒脱敏后再上传，不主动复述敏感字段。\n5. 要求"删掉所有异常值"→ 先说明偏差，建议"标记 + 单独成表"，用户坚持才执行并记录。'
  };

  function renderFlowTables() {
    var ft = $('#flowTable');
    ft.innerHTML = '<thead><tr><th>节点</th><th>做了什么</th><th>为什么这样做</th></tr></thead><tbody>' +
      FLOW.map(function (r) { return '<tr><td><b>' + r[0] + '</b> ' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td></tr>'; }).join('') +
      '</tbody>';
    var rt = $('#reqTable');
    rt.innerHTML = '<thead><tr><th>作业要求</th><th>本作品如何对应</th><th>在哪能看到</th></tr></thead><tbody>' +
      REQ.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>'; }).join('') +
      '</tbody>';
    Object.keys(PROMPTS).forEach(function (k) { var node = $('#' + k); if (node) node.textContent = PROMPTS[k]; });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 顶部导航
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var v = tab.getAttribute('data-view');
        $('#view-app').hidden = v !== 'app';
        $('#view-flow').hidden = v !== 'flow';
        $('#view-about').hidden = v !== 'about';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // 上传
    var dz = $('#dropzone'), fi = $('#fileInput');
    $('#pickBtn').addEventListener('click', function (e) { e.stopPropagation(); fi.click(); });
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { if (fi.files[0]) readFile(fi.files[0]); fi.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hover'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    // 步骤按钮
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goto(Number(b.getAttribute('data-goto'))); });
    });
    $('#runBtn').addEventListener('click', runClean);
    $('#reportBtn').addEventListener('click', buildReport);
    $('#downloadCsv').addEventListener('click', function () {
      download((S.fileName.replace(/\.[^.]+$/, '') || 'cleaned') + '_cleaned.csv', cleanedCsv(), 'text/csv;charset=utf-8');
    });
    $('#downloadMd').addEventListener('click', function () {
      download('能效与碳排分析报告.md', S.report, 'text/markdown;charset=utf-8');
    });
    $('#printBtn').addEventListener('click', function () { window.print(); });
    $('#restartBtn').addEventListener('click', function () {
      S = { fileName: '', headers: [], rows: [], quality: null, plan: null, clean: null, metrics: null, report: '', skip: [], source: '' };
      goto(1);
    });

    // 报告切换
    $$('.rtab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.rtab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var k = t.getAttribute('data-rtab');
        $('#reportRender').hidden = k !== 'render';
        $('#reportSource').hidden = k !== 'source';
        $('#aiPanel').hidden = k !== 'ai';
      });
    });

    $('#aiRun').addEventListener('click', callAI);
    $('#copyPrompt').addEventListener('click', function () {
      var txt = aiPrompt();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('提示词已复制，可粘贴到 Coze 或任意大模型'); },
          function () { fallbackCopy(txt); });
      } else fallbackCopy(txt);
    });
    function fallbackCopy(txt) {
      var ta = el('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('提示词已复制'); } catch (e) { toast('复制失败，请手动选择文本'); }
      ta.remove();
    }
  }

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    renderSamples();
    renderFlowTables();
    bind();

    // 深链接演示：?demo=dirty&step=4（方便课堂直接跳到某个步骤，也方便截图检查）
    try {
      var qp = new URLSearchParams(location.search);
      var view = qp.get('view');
      if (view && ['flow', 'about'].indexOf(view) >= 0) {
        var tb = $('.tab[data-view="' + view + '"]');
        if (tb) tb.click();
      }
      var demo = qp.get('demo');
      var step = parseInt(qp.get('step') || '2', 10);
      if (demo) {
        setTimeout(function () {
          loadSample(demo);
          if (step >= 3) {
            setTimeout(function () {
              runClean();
              if (step >= 4) setTimeout(buildReport, 120);
            }, 150);
          }
        }, 120);
      }
    } catch (e) { /* 忽略 */ }
  });
})();
