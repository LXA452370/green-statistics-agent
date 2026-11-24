/* 经管数据统计分析 · v3 交互层 */
(function () {
  'use strict';

  var S = {
    fileName: '', headers: [], rows: [], prof: null, clean: null,
    plan: null, planSource: 'rule', results: null, insights: [], advice: '', warnings: []
  };

  var CFG = { base: '', model: '', key: '' };

  var C = { pine: '#2A564A', brass: '#A98545', clay: '#A34A3C', sage: '#6E817A', line: '#E3DCCE', muted: '#8B8878' };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, ms) {
    var t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }
  function fmt(n, d) {
    if (n == null || n === '' || !isFinite(n)) return '—';
    var s = Number(n).toFixed(d == null ? 2 : d).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return s.join('.');
  }
  function pct(n) { return n == null ? '—' : (Math.round(n * 1000) / 10) + '%'; }

  /* ================= 模型配置 ================= */
  function loadCfg() {
    try {
      var raw = localStorage.getItem('sl3_llm');
      if (raw) CFG = JSON.parse(raw);
    } catch (e) { }
    $('#apiBase').value = CFG.base || '';
    $('#apiModel').value = CFG.model || '';
    $('#apiKey').value = CFG.key || '';
    updateStatus();
  }
  function saveCfg() {
    CFG = { base: $('#apiBase').value.trim(), model: $('#apiModel').value.trim(), key: $('#apiKey').value.trim() };
    try { localStorage.setItem('sl3_llm', JSON.stringify(CFG)); } catch (e) { }
    updateStatus();
    toast('配置已保存至本机');
    $('#settingsModal').hidden = true;
  }
  function configured() { return !!(CFG.base && CFG.key); }
  function updateStatus() {
    var el = $('#modelStatus');
    if (configured()) { el.textContent = '已配置模型'; el.classList.add('on'); }
    else { el.textContent = '未连接模型'; el.classList.remove('on'); }
    $('#apiHintPlan').textContent = configured() ? '' : '尚未配置模型接口，可在右上角“模型设置”中填写，或改用“复制提示词”。';
    $('#runPlanAI').disabled = !configured();
    $('#runAdviceAI').disabled = !configured();
  }

  function endpoint() {
    var base = (CFG.base || '').replace(/\/+$/, '');
    return /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
  }

  async function callLLM(prompt, temperature) {
    var res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CFG.key },
      body: JSON.stringify({
        model: CFG.model || 'deepseek-chat',
        temperature: temperature == null ? 0.2 : temperature,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      var detail = '';
      try { detail = (await res.text()).slice(0, 160); } catch (e) { }
      throw new Error('HTTP ' + res.status + (detail ? '：' + detail : ''));
    }
    var j = await res.json();
    var txt = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    if (!txt) throw new Error('返回内容为空');
    return txt;
  }

  async function testConnection() {
    if (!configured()) { $('#apiHint').textContent = '请先填写接口地址与 API Key。'; return; }
    var hint = $('#apiHint');
    hint.textContent = '正在测试连接…';
    try {
      var txt = await callLLM('仅回复"OK"两个字母。', 0);
      hint.textContent = '连接正常，返回：' + txt.slice(0, 20);
      toast('连接正常');
    } catch (e) {
      hint.textContent = '连接失败：' + e.message + '。若提示跨域（CORS），请改用“复制提示词”方式，详见“浏览器直连说明”。';
      toast('连接失败，请查看提示');
    }
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { toast('已复制'); }, function () { fallbackCopy(txt); });
    }
    fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败'); }
    ta.remove();
  }

  /* ================= 读取文件 ================= */
  function decode(buf) {
    var u8 = new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { }
    try { return new TextDecoder('gbk').decode(u8); } catch (e) { }
    return new TextDecoder('utf-8').decode(u8);
  }
  function aoaToTable(aoa) {
    aoa = (aoa || []).filter(function (r) { return r && r.some(function (c) { return c != null && String(c).trim() !== ''; }); });
    if (!aoa.length) return { headers: [], rows: [] };
    var headers = aoa[0].map(function (h, i) { return String(h == null ? '' : h).trim() || ('变量' + (i + 1)); });
    var seen = {};
    headers = headers.map(function (h) { if (seen[h]) { seen[h]++; return h + '_' + seen[h]; } seen[h] = 1; return h; });
    return { headers: headers, rows: aoa.slice(1) };
  }
  async function readFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'csv'].indexOf(ext) < 0) { toast('仅支持 .xlsx 与 .csv（.xls 请另存为 .xlsx）'); return; }
    try {
      var buf = await file.arrayBuffer();
      var table = ext === 'csv'
        ? StatEngine.parseCSV(decode(buf))
        : aoaToTable((await XLSXLite.read(buf)).aoa);
      if (!table.rows.length) { toast('未读取到数据行'); return; }
      S.fileName = file.name;
      start(table.headers, table.rows);
    } catch (e) {
      console.error(e);
      toast('解析失败：' + e.message);
    }
  }

  /* ================= 第一步 ================= */
  function start(headers, rows) {
    S.headers = headers; S.rows = rows;
    S.prof = StatEngine.profile(headers, rows);
    S.clean = StatEngine.clean(headers, rows, S.prof);
    S.plan = StatEngine.defaultPlan(S.prof);
    S.planSource = 'rule';
    S.results = null; S.advice = ''; S.warnings = [];
    renderProfile();
    renderPlanPrompt();
    renderPlan();
    goto(2);
  }

  function renderProfile() {
    var p = S.prof, log = S.clean.log;
    $('#fileMeta').textContent = S.fileName + '　·　' + p.n + ' 行 × ' + p.m + ' 列　·　数值变量 ' + p.numeric.length + ' 个，分类变量 ' + p.categorical.length + ' 个';
    $('#profileTable').innerHTML = '<thead><tr><th>变量</th><th>类型</th><th>有效样本</th><th>缺失</th><th>取值数</th><th>范围 / 类别</th></tr></thead><tbody>' +
      p.columns.map(function (c) {
        var info = c.type === 'numeric' ? (c.min + ' — ' + c.max) : c.categories.slice(0, 3).join('、');
        return '<tr><td>' + esc(c.name) + (c.idLike ? '（标识变量）' : '') + '</td>' +
          '<td>' + (c.type === 'numeric' ? '数值' : '分类') + '</td>' +
          '<td class="num">' + c.n + '</td><td class="num">' + c.missing + '</td><td class="num">' + c.unique + '</td>' +
          '<td>' + esc(String(info).slice(0, 42)) + '</td></tr>';
      }).join('') + '</tbody>';
    $('#cleanNote').textContent = '数据整理：删除重复记录 ' + log.dupRemoved + ' 条；空白与全角字符规范化 ' + log.trimmed +
      ' 处；文本型数值转换 ' + log.coerced + ' 处。缺失值不作插补，统计时按变量剔除并标注有效样本量。';
  }

  function renderPlanPrompt() {
    var sample = S.clean.rows.slice(0, 4).map(function (r) {
      return S.headers.map(function (h) { return r[h]; });
    });
    var prompt = StatEngine.buildPlanPrompt(S.prof, sample, S.fileName);
    var pre = $('#planPromptPreview');
    pre.textContent = prompt;
    pre._prompt = prompt;
  }

  function renderPlan() {
    var plan = S.plan, box = $('#planChips');
    box.innerHTML = '';
    function chip(label, val) {
      var d = document.createElement('div');
      d.className = 'chip';
      d.innerHTML = '<b>' + esc(label) + '</b><span>' + esc(val) + '</span>';
      box.appendChild(d);
    }
    chip('描述统计', (plan.descriptives || []).join('、') || '无');
    chip('分组比较', plan.groupCompare ? plan.groupCompare.by + ' → ' + plan.groupCompare.metric : '不执行');
    chip('相关分析', (plan.correlations || []).map(function (p) { return p.join(' × '); }).join('；') || '不执行');
    chip('分布图', plan.histogram ? plan.histogram.column + '（' + plan.histogram.bins + ' 组）' : '不执行');
    chip('频数分布', (plan.frequency || []).join('、') || '不执行');
    $('#planSourceTag').textContent = S.planSource === 'ai' ? '模型生成' : '默认方案';
    $('#planWarn').textContent = S.warnings.length ? '已修正：' + S.warnings.join('；') : '';
  }

  function applyPlanText(text) {
    var raw = StatEngine.parseJSON(text);
    if (!raw) { toast('未解析出 JSON'); $('#planWarn').textContent = '解析失败：未在返回内容中找到合法 JSON 对象。'; return false; }
    var v = StatEngine.validatePlan(raw, S.prof);
    S.plan = v.plan; S.warnings = v.warnings; S.planSource = 'ai';
    renderPlan();
    toast(v.warnings.length ? '计划已应用，' + v.warnings.length + ' 处已修正' : '计划已应用');
    return true;
  }

  function setPlanMode(mode) {
    $$('#planMode .seg').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
    $$('.mode-panel').forEach(function (p) { p.hidden = p.getAttribute('data-mode') !== mode; });
  }

  /* ================= 第二步 ================= */
  function compute() {
    S.results = StatEngine.compute(S.plan, S.clean);
    S.insights = StatEngine.insights(S.results, S.prof);
    renderResults();
    goto(3);
  }

  function cvLabel(cv) {
    if (cv == null) return '—';
    if (cv >= 0.3) return '偏高';
    if (cv >= 0.2) return '中等';
    if (cv < 0.05) return '集中';
    return '适中';
  }

  function renderResults() {
    var r = S.results;
    $('#resultMeta').textContent = S.fileName + '　·　计划来源：' + (S.planSource === 'ai' ? '模型生成' : '默认方案') +
      '　·　有效样本 ' + r.meta.n + '　·　' + new Date().toLocaleString('zh-CN');

    // 结论
    $('#insightList').innerHTML = S.insights.map(function (i) {
      var lv = i.level === 'high' ? '需关注' : i.level === 'mid' ? '提示' : '一般';
      return '<div class="finding ' + i.level + '"><div class="f-head"><span class="f-title">' + esc(i.title) +
        '</span><span class="f-level">' + lv + '</span></div><div class="f-text">' + esc(i.text) + '</div></div>';
    }).join('');
    $('#aiAdvice').textContent = S.advice || '';

    // 关键指标（前 3 个变量）
    var top = r.descriptives.slice(0, 3);
    $('#keyTable').innerHTML = '<thead><tr><th>变量</th><th>均值</th><th>标准差</th><th>变异系数</th><th>离散程度</th></tr></thead><tbody>' +
      top.map(function (d) {
        return '<tr><td>' + esc(d.column) + '</td><td class="num">' + fmt(d.mean, 2) + '</td><td class="num">' + fmt(d.sd, 2) +
          '</td><td class="num">' + fmt(d.cv, 3) + '</td><td>' + cvLabel(d.cv) + '</td></tr>';
      }).join('') + '</tbody>';

    // 组间与相关概览
    if (r.groups && r.groups.effect != null) {
      $('#effectVal').textContent = 'd = ' + fmt(r.groups.effect, 2);
      $('#effectNote').textContent = r.groups.by + ' × ' + r.groups.metric + '，均值极差 ' + fmt(r.groups.spread, 2);
    } else {
      $('#effectVal').textContent = '—';
      $('#effectNote').textContent = '未执行分组比较';
    }
    if (r.correlations.length) {
      var best = r.correlations.slice().sort(function (a, b) { return Math.abs(b.r) - Math.abs(a.r); })[0];
      $('#corrVal').textContent = 'r = ' + fmt(best.r, 2);
      $('#corrNote').textContent = best.a + ' × ' + best.b + '（n = ' + best.n + '）';
    } else {
      $('#corrVal').textContent = '—';
      $('#corrNote').textContent = '未执行相关分析';
    }

    renderCharts(r);
    renderDetail(r);
  }

  function renderDetail(r) {
    var rows = [
      ['有效样本 n', function (d) { return d.n; }],
      ['均值', function (d) { return fmt(d.mean, 2); }],
      ['中位数', function (d) { return fmt(d.median, 2); }],
      ['标准差', function (d) { return fmt(d.sd, 2); }],
      ['方差', function (d) { return fmt(d.variance, 2); }],
      ['最小值', function (d) { return fmt(d.min, 2); }],
      ['最大值', function (d) { return fmt(d.max, 2); }],
      ['极差', function (d) { return fmt(d.range, 2); }],
      ['Q1 / Q3', function (d) { return fmt(d.q1, 1) + ' / ' + fmt(d.q3, 1); }],
      ['四分位距 IQR', function (d) { return fmt(d.iqr, 2); }],
      ['变异系数 CV', function (d) { return fmt(d.cv, 3); }],
      ['95% 置信区间', function (d) { return d.ci95 ? fmt(d.ci95[0], 1) + ' — ' + fmt(d.ci95[1], 1) : '—'; }],
      ['偏度', function (d) { return fmt(d.skew, 2); }],
      ['峰度', function (d) { return fmt(d.kurtosis, 2); }],
      ['离群值个数', function (d) { return d.outliers; }]
    ];
    $('#descTable').innerHTML = '<thead><tr><th>统计量</th>' + r.descriptives.map(function (d) { return '<th>' + esc(d.column) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td>' + row[0] + '</td>' + r.descriptives.map(function (d) { return '<td class="num">' + row[1](d) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';

    if (r.groups) {
      $('#groupBlock').hidden = false;
      $('#groupTitle').textContent = '分组比较：' + r.groups.by + ' × ' + r.groups.metric;
      $('#groupTable').innerHTML = '<thead><tr><th>组别</th><th>样本量</th><th>均值</th><th>中位数</th><th>标准差</th><th>最小</th><th>最大</th></tr></thead><tbody>' +
        r.groups.rows.map(function (g) {
          return '<tr><td>' + esc(g.group) + '</td><td class="num">' + g.n + '</td><td class="num">' + fmt(g.mean, 2) +
            '</td><td class="num">' + fmt(g.median, 2) + '</td><td class="num">' + fmt(g.sd, 2) +
            '</td><td class="num">' + fmt(g.min, 1) + '</td><td class="num">' + fmt(g.max, 1) + '</td></tr>';
        }).join('') + '</tbody>';
      var note = '最高组与最低组均值差 ' + fmt(r.groups.spread, 2);
      if (r.groups.effect != null) note += '；效应量 d = ' + r.groups.effect + '（≥0.8 为大效应）';
      $('#groupNote').textContent = note + '。';
    } else { $('#groupBlock').hidden = true; }

    if (r.correlations.length) {
      $('#corrBlock').hidden = false;
      $('#corrTable').innerHTML = '<thead><tr><th>变量 A</th><th>变量 B</th><th>Pearson r</th><th>样本量</th><th>显著性</th></tr></thead><tbody>' +
        r.correlations.map(function (c) {
          return '<tr><td>' + esc(c.a) + '</td><td>' + esc(c.b) + '</td><td class="num">' + fmt(c.r, 3) +
            '</td><td class="num">' + c.n + '</td><td>' + (c.significant ? '显著' : '不显著') + '</td></tr>';
        }).join('') + '</tbody>';
    } else { $('#corrBlock').hidden = true; }

    if (r.frequency.length) {
      $('#freqBlock').hidden = false;
      $('#freqTable').innerHTML = '<thead><tr><th>变量</th><th>取值</th><th>频数</th><th>占比</th></tr></thead><tbody>' +
        r.frequency.map(function (f) {
          return f.items.map(function (it) {
            return '<tr><td>' + esc(f.column) + '</td><td>' + esc(it.value) + '</td><td class="num">' + it.count + '</td><td class="num">' + pct(it.pct) + '</td></tr>';
          }).join('');
        }).join('') + '</tbody>';
    } else { $('#freqBlock').hidden = true; }
  }

  /* ================= 图表 ================= */
  function svgWrap(w, h, inner) {
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '">' + inner + '</svg>';
  }

  function histogramSVG(hist, meanVal) {
    var W = 440, H = 190, P = { l: 38, r: 12, t: 18, b: 30 };
    var max = Math.max.apply(null, hist.bins.map(function (b) { return b.count; })) || 1;
    var n = hist.bins.length, bw = (W - P.l - P.r) / n;
    var bars = hist.bins.map(function (b, i) {
      var bh = (H - P.t - P.b) * (b.count / max);
      var x = P.l + i * bw + 2;
      return '<rect x="' + x.toFixed(1) + '" y="' + (H - P.b - bh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) +
        '" height="' + bh.toFixed(1) + '" fill="' + C.pine + '" fill-opacity=".82" rx="1.5"><title>' + b.lo + ' — ' + b.hi + '：' + b.count + '</title></rect>';
    }).join('');
    var ticks = [];
    for (var i = 0; i < n; i += Math.ceil(n / 5)) {
      ticks.push('<text class="tick" x="' + (P.l + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + fmt(hist.bins[i].lo, 0) + '</text>');
    }
    var grid = '<line class="axis" x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '"/>' +
      '<text class="tick" x="' + (P.l - 6) + '" y="' + (P.t + 8) + '" text-anchor="end">' + max + '</text>' +
      '<text class="tick" x="' + (P.l - 6) + '" y="' + (H - P.b) + '" text-anchor="end">0</text>';
    var meanLine = '';
    if (meanVal != null) {
      var all = hist.bins;
      var lo = all[0].lo, hi = all[all.length - 1].hi;
      var xm = P.l + (W - P.l - P.r) * ((meanVal - lo) / (hi - lo || 1));
      if (xm > P.l && xm < W - P.r) {
        meanLine = '<line x1="' + xm.toFixed(1) + '" y1="' + P.t + '" x2="' + xm.toFixed(1) + '" y2="' + (H - P.b) + '" stroke="' + C.brass + '" stroke-width="1.2" stroke-dasharray="4 3"/>' +
          '<text class="tick" x="' + (W - P.r) + '" y="' + (P.t - 4) + '" text-anchor="end" fill="' + C.brass + '">均值 ' + fmt(meanVal, 1) + '</text>';
      }
    }
    return svgWrap(W, H, grid + bars + meanLine + ticks.join(''));
  }

  function groupBarSVG(g) {
    var W = 440, H = 200, P = { l: 40, r: 12, t: 20, b: 34 };
    var rows = g.rows;
    var vals = rows.map(function (r) { return r.mean; });
    var mx = Math.max.apply(null, vals);
    var hi = mx * 1.18;          // 纵轴自 0 起，避免夸大组间差异
    var lo = 0;
    var step = (W - P.l - P.r) / rows.length;
    var bw = Math.min(46, step * 0.5);
    function Y(v) { return P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo || 1)); }
    var bars = rows.map(function (r, i) {
      var x = P.l + step * i + (step - bw) / 2;
      var y = Y(r.mean), h = H - P.b - y;
      var sdTop = r.sd != null ? Y(Math.min(hi, r.mean + r.sd)) : y;
      var sdBot = r.sd != null ? Y(Math.max(lo, r.mean - r.sd)) : y;
      var whisk = r.sd != null
        ? '<line x1="' + (x + bw / 2) + '" y1="' + sdTop + '" x2="' + (x + bw / 2) + '" y2="' + sdBot + '" stroke="' + C.muted + '" stroke-width="1"/>' +
          '<line x1="' + (x + bw / 2 - 6) + '" y1="' + sdTop + '" x2="' + (x + bw / 2 + 6) + '" y2="' + sdTop + '" stroke="' + C.muted + '" stroke-width="1"/>' +
          '<line x1="' + (x + bw / 2 - 6) + '" y1="' + sdBot + '" x2="' + (x + bw / 2 + 6) + '" y2="' + sdBot + '" stroke="' + C.muted + '" stroke-width="1"/>'
        : '';
      var label = String(r.group).length > 7 ? String(r.group).slice(0, 6) + '…' : r.group;
      return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(1, h) + '" fill="' + C.pine + '" fill-opacity=".8" rx="2"><title>' + esc(r.group) + '：均值 ' + r.mean + '，SD ' + (r.sd == null ? '—' : r.sd) + '</title></rect>' +
        whisk +
        '<text class="tick" x="' + (x + bw / 2) + '" y="' + (H - 14) + '" text-anchor="middle">' + esc(label) + '</text>' +
        '<text class="lbl" x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" fill="' + C.pine + '">' + fmt(r.mean, 1) + '</text>';
    }).join('');
    var axis = '<line class="axis" x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '"/>' +
      '<text class="tick" x="' + (P.l - 6) + '" y="' + (P.t + 8) + '" text-anchor="end">' + fmt(hi, 0) + '</text>' +
      '<text class="tick" x="' + (P.l - 6) + '" y="' + (H - P.b) + '" text-anchor="end">' + fmt(lo, 0) + '</text>';
    return svgWrap(W, H, axis + bars);
  }

  function scatterSVG(sc) {
    var W = 440, H = 235, P = { l: 46, r: 14, t: 22, b: 30 };
    var pts = sc.points;
    if (!pts.length) return '<p class="muted">无有效配对观测</p>';
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var xp = (x1 - x0) * 0.05 || 1, yp = (y1 - y0) * 0.08 || 1;
    x0 -= xp; x1 += xp; y0 -= yp; y1 += yp;
    function X(v) { return P.l + (W - P.l - P.r) * ((v - x0) / (x1 - x0)); }
    function Y(v) { return P.t + (H - P.t - P.b) * (1 - (v - y0) / (y1 - y0)); }
    var dots = pts.map(function (p) {
      return '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.2" fill="' + C.pine + '" fill-opacity=".45"/>';
    }).join('');
    // 最小二乘拟合
    var n = pts.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxy += p[0] * p[1]; sxx += p[0] * p[0]; });
    var denom = n * sxx - sx * sx;
    var line = '';
    if (Math.abs(denom) > 1e-9) {
      var b = (n * sxy - sx * sy) / denom, a = (sy - b * sx) / n;
      var xA = x0, xB = x1;
      line = '<line x1="' + X(xA) + '" y1="' + Y(a + b * xA) + '" x2="' + X(xB) + '" y2="' + Y(a + b * xB) + '" stroke="' + C.brass + '" stroke-width="1.4"/>';
    }
    var ax = '<line class="axis" x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '"/>' +
      '<line class="axis" x1="' + P.l + '" y1="' + P.t + '" x2="' + P.l + '" y2="' + (H - P.b) + '"/>' +
      '<text class="tick" x="' + ((P.l + W - P.r) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">横轴：' + esc(sc.x) + '</text>' +
      '<text class="tick" x="' + P.l + '" y="' + (P.t - 5) + '">纵轴：' + esc(sc.y) + '</text>' +
      '<text class="lbl" x="' + (P.l + 6) + '" y="' + (P.t + 12) + '" fill="' + C.brass + '">r = ' + fmt(sc.r, 3) + '（n = ' + n + '）</text>';
    return svgWrap(W, H, ax + line + dots);
  }

  function corrMatrixSVG(cm) {
    var names = cm.names, m = cm.matrix;
    var cell = 44, labelW = 62, top = 30;
    var W = labelW + cell * names.length + 12, H = top + cell * names.length + 12;
    function color(v) {
      if (v == null) return '#F1ECE2';
      var a = Math.min(1, Math.abs(v));
      return v >= 0 ? 'rgba(42,86,74,' + (0.10 + 0.78 * a) + ')' : 'rgba(163,74,60,' + (0.10 + 0.78 * a) + ')';
    }
    var cells = '';
    names.forEach(function (rname, ri) {
      cells += '<text class="tick" x="' + (labelW - 8) + '" y="' + (top + ri * cell + cell / 2 + 3) + '" text-anchor="end">' + esc(rname) + '</text>';
      names.forEach(function (cname, ci) {
        var v = m[ri][ci];
        var x = labelW + ci * cell, y = top + ri * cell;
        cells += '<rect x="' + x + '" y="' + y + '" width="' + (cell - 2) + '" height="' + (cell - 2) + '" rx="2" fill="' + color(v) + '"/>';
        if (v != null) {
          cells += '<text x="' + (x + cell / 2 - 1) + '" y="' + (y + cell / 2 + 3) + '" text-anchor="middle" font-size="10.5" fill="' + (Math.abs(v) > 0.45 ? '#F7F4EE' : '#3C4A44') + '">' + v.toFixed(2) + '</text>';
        }
      });
    });
    names.forEach(function (cname, ci) {
      cells += '<text class="tick" x="' + (labelW + ci * cell + cell / 2) + '" y="' + (top - 10) + '" text-anchor="middle">' + esc(cname) + '</text>';
    });
    return svgWrap(W, H, cells);
  }

  function renderCharts(r) {
    var box = $('#charts');
    box.innerHTML = '';
    function card(title, sub, content) {
      var d = document.createElement('div');
      d.className = 'chart-card';
      d.innerHTML = '<div class="chart-title">' + esc(title) + '</div><div class="chart-sub">' + esc(sub) + '</div>' + content;
      box.appendChild(d);
    }
    var primary = r.descriptives[0];
    if (r.histogram && primary) {
      card('分布直方图 · ' + r.histogram.column, '虚线为均值位置；柱高为频数', histogramSVG(r.histogram, primary.mean));
    }
    if (r.groups) {
      card('组均值与标准差 · ' + r.groups.metric, '按「' + r.groups.by + '」分组，误差线为 ±1 个标准差', groupBarSVG(r.groups));
    }
    if (r.scatter) {
      card('散点与拟合线 · ' + r.scatter.x + ' × ' + r.scatter.y, '黄线为最小二乘拟合，仅用于呈现趋势', scatterSVG(r.scatter));
    }
    if (r.corrMatrix && r.corrMatrix.names.length >= 2) {
      card('相关系数矩阵', '墨绿为正相关，砖红为负相关；数值为 Pearson r', corrMatrixSVG(r.corrMatrix));
    }
  }

  /* ================= 导出 ================= */
  function buildMarkdown() {
    var r = S.results, L = [];
    L.push('# 统计分析报告');
    L.push('');
    L.push('> 数据文件：' + S.fileName + '　｜　有效样本：' + r.meta.n + '　｜　计划来源：' + (S.planSource === 'ai' ? '模型生成' : '默认方案'));
    L.push('');
    L.push('## 一、分析结论');
    L.push('');
    S.insights.forEach(function (i, k) { L.push((k + 1) + '. **' + i.title + '**：' + i.text); });
    L.push('');
    L.push('## 二、关键指标');
    L.push('');
    L.push('| 变量 | 均值 | 标准差 | 变异系数 | 离散程度 |');
    L.push('| --- | --- | --- | --- | --- |');
    r.descriptives.slice(0, 3).forEach(function (d) {
      L.push('| ' + d.column + ' | ' + fmt(d.mean, 2) + ' | ' + fmt(d.sd, 2) + ' | ' + fmt(d.cv, 3) + ' | ' + cvLabel(d.cv) + ' |');
    });
    L.push('');
    if (r.groups) {
      L.push('### 分组比较（' + r.groups.by + ' × ' + r.groups.metric + '）');
      L.push('');
      L.push('| 组别 | 样本量 | 均值 | 标准差 |');
      L.push('| --- | --- | --- | --- |');
      r.groups.rows.forEach(function (g) { L.push('| ' + g.group + ' | ' + g.n + ' | ' + fmt(g.mean, 2) + ' | ' + fmt(g.sd, 2) + ' |'); });
      L.push('');
      L.push('组间均值差 ' + fmt(r.groups.spread, 2) + '，效应量 d = ' + r.groups.effect + '。');
      L.push('');
    }
    if (r.correlations.length) {
      L.push('### 相关分析');
      L.push('');
      L.push('| 变量 A | 变量 B | Pearson r | 样本量 |');
      L.push('| --- | --- | --- | --- |');
      r.correlations.forEach(function (c) { L.push('| ' + c.a + ' | ' + c.b + ' | ' + fmt(c.r, 3) + ' | ' + c.n + ' |'); });
      L.push('');
      L.push('注：相关关系不等同于因果关系。');
      L.push('');
    }
    L.push('## 三、完整描述统计');
    L.push('');
    var names = r.descriptives.map(function (d) { return d.column; });
    L.push('| 统计量 | ' + names.join(' | ') + ' |');
    L.push('| --- |' + names.map(function () { return ' --- |'; }).join(''));
    [['有效样本 n', function (d) { return d.n; }],
     ['均值', function (d) { return fmt(d.mean, 2); }],
     ['中位数', function (d) { return fmt(d.median, 2); }],
     ['标准差', function (d) { return fmt(d.sd, 2); }],
     ['方差', function (d) { return fmt(d.variance, 2); }],
     ['最小值', function (d) { return fmt(d.min, 2); }],
     ['最大值', function (d) { return fmt(d.max, 2); }],
     ['变异系数', function (d) { return fmt(d.cv, 3); }],
     ['偏度', function (d) { return fmt(d.skew, 2); }],
     ['峰度', function (d) { return fmt(d.kurtosis, 2); }],
     ['离群值个数', function (d) { return d.outliers; }]
    ].forEach(function (row) {
      L.push('| ' + row[0] + ' | ' + r.descriptives.map(function (d) { return row[1](d); }).join(' | ') + ' |');
    });
    L.push('');
    if (S.advice) {
      L.push('## 四、模型解读');
      L.push('');
      L.push(S.advice);
      L.push('');
    }
    L.push('---');
    L.push('口径说明：样本方差取 n−1；缺失值按变量剔除；离群值按 1.5×IQR 判定并仅作标记；相关系数为 Pearson r；组间比较采用效应量 d。');
    return L.join('\n');
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ================= 示例 ================= */
  function renderSamples() {
    var box = $('#sampleList');
    box.innerHTML = '';
    (window.SL_SAMPLES || []).forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sample';
      b.innerHTML = '<span class="no">' + String(i + 1).padStart(2, '0') + '</span><span><span class="nm">' + esc(s.name) +
        '</span><br><span class="ds">' + esc(s.desc) + '</span></span>';
      b.addEventListener('click', function () {
        var t = StatEngine.parseCSV(s.text);
        S.fileName = s.name + '.csv';
        start(t.headers, t.rows);
      });
      box.appendChild(b);
    });
  }

  /* ================= 绑定 ================= */
  function bind() {
    var dz = $('#dropzone'), fi = $('#fileInput');
    $('#pickBtn').addEventListener('click', function (e) { e.stopPropagation(); fi.click(); });
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { if (fi.files[0]) readFile(fi.files[0]); fi.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hover'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hover'); }); });
    dz.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });

    $$('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { goto(Number(b.getAttribute('data-goto'))); }); });

    $$('#planMode .seg').forEach(function (b) {
      b.addEventListener('click', function () { setPlanMode(b.getAttribute('data-mode')); });
    });
    $('#copyPlanPrompt').addEventListener('click', function () { copyText($('#planPromptPreview')._prompt || ''); });
    $('#togglePlanPrompt').addEventListener('click', function () {
      var p = $('#planPromptPreview');
      p.hidden = !p.hidden;
      this.textContent = p.hidden ? '查看提示词' : '收起提示词';
    });
    $('#applyPlan').addEventListener('click', function () {
      var t = $('#planInput').value.trim();
      if (!t) { toast('请先粘贴模型返回内容'); return; }
      applyPlanText(t);
    });
    $('#useDefault').addEventListener('click', function () {
      S.plan = StatEngine.defaultPlan(S.prof); S.planSource = 'rule'; S.warnings = [];
      renderPlan(); toast('已采用默认方案');
    });
    $('#runPlanAI').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; btn.textContent = '请求中…';
      try {
        var txt = await callLLM($('#planPromptPreview')._prompt, 0.1);
        $('#planInput').value = txt;
        if (!applyPlanText(txt)) setPlanMode('copy');
      } catch (e) {
        toast('调用失败：' + e.message);
        setPlanMode('copy');
        $('#planWarn').textContent = '直连失败（' + e.message + '）。已切换至“复制提示词”，或检查模型设置。';
      } finally { btn.disabled = false; btn.textContent = '生成分析计划'; }
    });

    $('#computeBtn').addEventListener('click', compute);

    $$('#concMode .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#concMode .seg').forEach(function (x) { x.classList.toggle('active', x === b); });
        var ai = b.getAttribute('data-conc') === 'ai';
        $('#insightList').hidden = ai;
        $('#aiPanel').hidden = !ai;
      });
    });
    $('#copyAdvicePrompt').addEventListener('click', function () { copyText(StatEngine.buildAdvicePrompt(S.results, S.prof)); });
    $('#toggleAdviceInput').addEventListener('click', function () {
      var ta = $('#adviceInput'), row = $('#applyAdviceRow');
      ta.hidden = !ta.hidden; row.hidden = ta.hidden;
      this.textContent = ta.hidden ? '粘贴模型输出' : '收起';
    });
    $('#applyAdvice').addEventListener('click', function () {
      var t = $('#adviceInput').value.trim();
      if (!t) { toast('请先粘贴模型输出'); return; }
      S.advice = t; $('#aiAdvice').textContent = t; toast('已显示模型解读');
    });
    $('#runAdviceAI').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; btn.textContent = '请求中…';
      try {
        var txt = await callLLM(StatEngine.buildAdvicePrompt(S.results, S.prof), 0.4);
        S.advice = txt; $('#adviceInput').value = txt; $('#aiAdvice').textContent = txt;
        toast('模型解读已生成');
      } catch (e) {
        toast('调用失败：' + e.message);
        $('#aiAdvice').textContent = '直连失败（' + e.message + '）。可点击“复制提示词”，在其他平台生成后粘贴回来。';
      } finally { btn.disabled = false; btn.textContent = '生成模型解读'; }
    });

    $('#exportMd').addEventListener('click', function () { download('统计分析报告.md', buildMarkdown()); });
    $('#restart').addEventListener('click', function () {
      S = { fileName: '', headers: [], rows: [], prof: null, clean: null, plan: null, planSource: 'rule', results: null, insights: [], advice: '', warnings: [] };
      goto(1);
    });

    $('#settingsBtn').addEventListener('click', function () { $('#settingsModal').hidden = false; });
    $('#closeSettings').addEventListener('click', function () { $('#settingsModal').hidden = true; });
    $('#saveSettings').addEventListener('click', saveCfg);
    $('#testApi').addEventListener('click', testConnection);
    $('#settingsModal').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  }

  function goto(step) {
    $$('.panel[data-panel]').forEach(function (p) { p.hidden = Number(p.getAttribute('data-panel')) !== step; });
    $$('.steps li').forEach(function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.classList.toggle('active', n === step);
      li.classList.toggle('done', n < step);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadCfg();
    renderSamples();
    bind();
    setPlanMode('api');
    try {
      var qp = new URLSearchParams(location.search);
      var demo = qp.get('demo');
      var step = Number(qp.get('step') || 2);
      if (qp.get('planmode') === 'copy' || qp.get('planmode') === 'default') {
        setTimeout(function () { setPlanMode(qp.get('planmode')); }, 60);
      }
      if (demo && window.SL_SAMPLES && window.SL_SAMPLES[demo - 1]) {
        setTimeout(function () {
          var s = window.SL_SAMPLES[demo - 1];
          var t = StatEngine.parseCSV(s.text);
          S.fileName = s.name + '.csv';
          start(t.headers, t.rows);
          if (qp.get('planmode') === 'copy' || qp.get('planmode') === 'default') {
            setTimeout(function () { setPlanMode(qp.get('planmode')); }, 60);
          }
          if (step >= 3) {
            setTimeout(function () {
              compute();
              if (qp.get('open') === 'detail') {
                setTimeout(function () { var d = document.querySelector('.detail'); if (d) d.open = true; }, 120);
              }
            }, 160);
          }
        }, 120);
      }
    } catch (e) { }
  });
})();
