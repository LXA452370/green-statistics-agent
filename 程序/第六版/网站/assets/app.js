/* 经管数据统计分析 · v4 交互层（用户自选变量 · 只呈现统计结果 · 模型可选） */
(function () {
  'use strict';

  var S = {
    fileName: '', headers: [], rows: [], prof: null, clean: null,
    sel: { metrics: [], group: '', metric: '', corr: true, hist: '' },
    plan: null, planSource: 'user', results: null, advice: ''
  };
  var CFG = { base: '', model: '', key: '' };

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  // 图表配色同样取自 CSS 变量，便于主题切换
  var C = {
    pine: cssVar('--chart-1', '#2A564A'),
    brass: cssVar('--chart-2', '#A98545'),
    clay: cssVar('--chart-3', '#A34A3C'),
    sage: cssVar('--chart-4', '#6E817A'),
    line: cssVar('--line', '#E3DCCE'),
    muted: cssVar('--chart-4', '#8B8878')
  };

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
  function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

  function rgba(hex, a) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 'rgba(42,86,74,' + a + ')';
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ================= 模型设置 ================= */
  function loadCfg() {
    try { var raw = localStorage.getItem('sl4_llm'); if (raw) CFG = JSON.parse(raw); } catch (e) { }
    $('#apiBase').value = CFG.base || '';
    $('#apiModel').value = CFG.model || '';
    $('#apiKey').value = CFG.key || '';
    updateStatus();
  }
  function saveCfg() {
    CFG = { base: $('#apiBase').value.trim(), model: $('#apiModel').value.trim(), key: $('#apiKey').value.trim() };
    try { localStorage.setItem('sl4_llm', JSON.stringify(CFG)); } catch (e) { }
    updateStatus(); toast('配置已保存至本机'); $('#settingsModal').hidden = true;
  }
  function configured() { return !!(CFG.base && CFG.key); }
  function updateStatus() {
    var el = $('#modelStatus');
    var on = configured();
    el.textContent = on ? '已接入模型' : '未接入模型';
    el.classList.toggle('on', on);
    var badge = $('#aiBadge');
    if (badge) {
      badge.textContent = on ? '已接入模型' : '未接入模型';
      badge.classList.toggle('on', on);
    }
    var notice = $('#aiNotice');
    if (notice) {
      notice.textContent = on
        ? '已接入模型：可生成分析建议；模型仅读取已计算的统计量，不参与数值计算。未接入时本页只提供统计结果与图形。'
        : '未接入模型：不生成任何分析结论或建议，仅提供统计结果与图形。';
    }
    if ($('#runPlanAI')) $('#runPlanAI').disabled = !on;
    if ($('#runAdviceAI')) $('#runAdviceAI').disabled = !on;
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
      hint.textContent = '连接失败：' + e.message + '。若提示跨域，请改用“复制提示词”。';
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

  /* ================= 读取 ================= */
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
      var table = ext === 'csv' ? StatEngine.parseCSV(decode(buf)) : aoaToTable((await XLSXLite.read(buf)).aoa);
      if (!table.rows.length) { toast('未读取到数据行'); return; }
      S.fileName = file.name;
      start(table.headers, table.rows);
    } catch (e) { console.error(e); toast('解析失败：' + e.message); }
  }

  /* ================= 第一步 ================= */
  function start(headers, rows) {
    S.headers = headers; S.rows = rows;
    S.prof = StatEngine.profile(headers, rows);
    S.clean = StatEngine.clean(headers, rows, S.prof);
    S.results = null; S.advice = '';

    var nums = S.prof.numeric.slice(0, 6);
    var cand = groupCandidates();
    var prefer = cand.filter(function (c) { return /(班级|部门|地区|区域|城市|门店|渠道|类别|分组)/.test(c); })[0] || cand[0] || '';
    S.sel = {
      mode: 'pro', focus: nums[0] || '', assoc: true,
      metrics: nums, group: prefer, metric: nums[0] || '', corr: nums.length >= 2, hist: nums[0] || ''
    };
    renderProfile();
    renderSelections();
    renderPlan();
    goto(2);
  }

  function groupCandidates() {
    return S.prof.columns.filter(function (c) {
      return c.type === 'categorical' && !c.idLike && c.unique >= 2 && c.unique <= 10;
    }).map(function (c) { return c.name; });
  }

  function renderProfile() {
    var p = S.prof, log = S.clean.log;
    $('#fileMeta').textContent = S.fileName + '　·　' + p.n + ' 行 × ' + p.m + ' 列　·　数值变量 ' + p.numeric.length +
      ' 个，分类变量 ' + p.categorical.length + ' 个　·　可分组变量 ' + groupCandidates().length + ' 个';
    $('#profileTable').innerHTML = '<thead><tr><th>变量</th><th>类型</th><th class="num">有效样本</th><th class="num">缺失</th><th class="num">取值数</th><th>范围 / 类别</th></tr></thead><tbody>' +
      p.columns.map(function (c) {
        var info = c.type === 'numeric' ? (c.min + ' — ' + c.max) : c.categories.slice(0, 3).join('、');
        var tag = c.idLike ? '（标识变量）' : (c.type === 'categorical' && c.unique > 10 ? '（取值过多，不可分组）' : '');
        return '<tr><td>' + esc(c.name) + tag + '</td><td>' + (c.type === 'numeric' ? '数值' : '分类') + '</td>' +
          '<td class="num">' + c.n + '</td><td class="num">' + c.missing + '</td><td class="num">' + c.unique + '</td>' +
          '<td>' + esc(String(info).slice(0, 40)) + '</td></tr>';
      }).join('') + '</tbody>';
    $('#cleanNote').textContent = '数据整理：删除重复记录 ' + log.dupRemoved + ' 条；空白与全角字符规范化 ' + log.trimmed +
      ' 处；文本型数值转换 ' + log.coerced + ' 处。缺失值不作插补，按变量剔除并标注有效样本量。';
  }

  /* ================= 第二步：变量选择 ================= */
  function applyModeUI() {
    var simple = S.sel.mode === 'simple';
    $('#proVars').hidden = simple;
    $('#simpleVars').hidden = !simple;
    $('#metricField').hidden = simple;
    $('#histField').hidden = simple;
    $('#corrRow').hidden = simple;
    $$('#modeSwitch button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-mode') === S.sel.mode);
    });
    $('#modeHint').textContent = simple
      ? '只重点分析一个变量：描述统计只算它，分组比较用它，图表也聚焦它。'
      : '按需选择变量，输出描述统计、组间比较、相关分析与四幅图。';
  }

  function renderSelections() {
    var box = $('#numVars');
    box.innerHTML = '';
    S.prof.numeric.forEach(function (name) {
      var label = document.createElement('label');
      label.className = 'var-chip' + (S.sel.metrics.indexOf(name) >= 0 ? ' on' : '');
      label.innerHTML = '<input type="checkbox" ' + (S.sel.metrics.indexOf(name) >= 0 ? 'checked' : '') + ' /><span>' + esc(name) + '</span>';
      var cb = label.querySelector('input');
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (S.sel.metrics.indexOf(name) < 0) S.sel.metrics.push(name);
        } else {
          S.sel.metrics = S.sel.metrics.filter(function (x) { return x !== name; });
        }
        label.classList.toggle('on', cb.checked);
        syncSelectors();
        renderPlan();
      });
      box.appendChild(label);
    });

    // 简单模式：主分析变量
    if (S.prof.numeric.indexOf(S.sel.focus) < 0) S.sel.focus = S.prof.numeric[0] || '';
    var fv = $('#focusVar');
    fv.innerHTML = S.prof.numeric.map(function (c) {
      return '<option value="' + esc(c) + '"' + (S.sel.focus === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    fv.onchange = function () {
      S.sel.focus = this.value;
      S.sel.metric = this.value;
      S.sel.hist = this.value;
      renderPlan();
    };
    var as = $('#assocVar');
    as.checked = !!S.sel.assoc;
    as.onchange = function () { S.sel.assoc = this.checked; renderPlan(); };

    $$('#modeSwitch button').forEach(function (b) {
      b.onclick = function () {
        S.sel.mode = b.getAttribute('data-mode');
        applyModeUI();
        renderPlan();
      };
    });

    var g = $('#groupVar');
    g.innerHTML = '<option value="">不分组</option>' + groupCandidates().map(function (c) {
      return '<option value="' + esc(c) + '"' + (S.sel.group === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    g.onchange = function () {
      S.sel.group = this.value;
      if (!S.sel.group && S.sel.mode === 'pro') S.sel.metric = S.sel.metrics[0] || '';
      syncSelectors();
      renderPlan();
    };

    applyModeUI();
    syncSelectors();
  }

  function syncSelectors() {
    var metrics = S.sel.metrics;
    if (S.sel.mode === 'simple') {
      if (S.prof.numeric.indexOf(S.sel.focus) < 0) S.sel.focus = S.prof.numeric[0] || '';
      S.sel.metric = S.sel.focus;
      S.sel.hist = S.sel.focus;
    } else {
      if (S.sel.metric && metrics.indexOf(S.sel.metric) < 0) S.sel.metric = metrics[0] || '';
      if (!S.sel.metric) S.sel.metric = metrics[0] || '';
      if (S.sel.hist && metrics.indexOf(S.sel.hist) < 0) S.sel.hist = metrics[0] || '';
      if (!S.sel.hist) S.sel.hist = metrics[0] || '';
      if (metrics.length < 2) S.sel.corr = false;
      else if ($('#doCorr').checked) S.sel.corr = true;
    }

    var gm = $('#groupMetric');
    gm.innerHTML = metrics.map(function (c) { return '<option value="' + esc(c) + '"' + (S.sel.metric === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    gm.disabled = !S.sel.group;
    gm.onchange = function () { S.sel.metric = this.value; renderPlan(); };

    var hv = $('#histVar');
    hv.innerHTML = metrics.map(function (c) { return '<option value="' + esc(c) + '"' + (S.sel.hist === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    hv.onchange = function () { S.sel.hist = this.value; renderPlan(); };

    var dc = $('#doCorr');
    dc.checked = S.sel.corr;
    dc.disabled = metrics.length < 2;
    dc.onchange = function () {
      S.sel.corr = this.checked && metrics.length >= 2;
      renderPlan();
    };
  }

  function buildPlan() {
    var sel = S.sel;
    if (sel.mode === 'simple') {
      var f = sel.focus || S.prof.numeric[0] || '';
      var pairs = [];
      if (sel.assoc) {
        S.prof.numeric.filter(function (x) { return x !== f; }).slice(0, 4).forEach(function (o) {
          pairs.push([f, o]);
        });
      }
      return {
        source: S.planSource, mode: 'simple', focus: f, title: '单变量分析',
        descriptives: [f], metrics: [f],
        groupBy: sel.group || null,
        groupCompare: sel.group ? { by: sel.group, metric: f } : null,
        correlations: pairs,
        histogram: { column: f, bins: 8 },
        frequency: [], matrix: false
      };
    }
    var m = sel.metrics.slice();
    var pairs2 = [];
    if (sel.corr && m.length >= 2) {
      for (var i = 0; i < m.length && pairs2.length < 6; i++) {
        for (var j = i + 1; j < m.length && pairs2.length < 6; j++) pairs2.push([m[i], m[j]]);
      }
    }
    return {
      source: S.planSource, mode: 'pro', focus: null,
      title: '统计分析',
      descriptives: m.slice(),
      metrics: m.slice(),
      groupBy: sel.group || null,
      groupCompare: sel.group ? { by: sel.group, metric: sel.metric } : null,
      correlations: pairs2,
      histogram: sel.hist ? { column: sel.hist, bins: 8 } : null,
      frequency: []
    };
  }

  function renderPlan() {
    S.plan = buildPlan();
    var plan = S.plan, box = $('#planChips');
    var simple = plan.mode === 'simple';
    box.innerHTML = '';
    function chip(label, val) {
      var d = document.createElement('div');
      d.className = 'chip';
      d.innerHTML = '<b>' + esc(label) + '</b><span>' + esc(val) + '</span>';
      box.appendChild(d);
    }
    chip(simple ? '主分析变量' : '描述统计', (plan.descriptives || []).join('、') || '未选择');
    chip('分组比较', plan.groupCompare ? plan.groupCompare.by + ' → ' + plan.groupCompare.metric : '不分组');
    chip(simple ? '对照相关' : '相关分析',
      plan.correlations.length ? (simple ? plan.correlations.length + ' 对（与其他变量）' : plan.correlations.length + ' 对（' + plan.descriptives.join(' × ') + '）') : '不执行');
    chip('分布图', plan.histogram ? plan.histogram.column + '（' + plan.histogram.bins + ' 组）' : '不执行');
    $('#planSourceTag').textContent = S.planSource === 'ai' ? '模型推荐（已按界面设置）' : '按当前设置';
    $('#planPromptPreview').textContent = buildPrompt();
    $('#planPromptPreview')._prompt = $('#planPromptPreview').textContent;
    $('#planWarn').textContent = '';
  }

  function buildPrompt() {
    var sample = S.clean.rows.slice(0, 4).map(function (r) {
      return S.headers.map(function (h) { return r[h]; });
    });
    var simple = S.sel.mode === 'simple';
    var focus = simple ? (S.sel.focus || S.prof.numeric[0] || '') : null;
    var pool;
    if (simple) {
      pool = [focus].concat(S.sel.assoc ? S.prof.numeric.filter(function (x) { return x !== focus; }) : []);
    } else {
      pool = S.sel.metrics.slice();
    }
    var base = StatEngine.buildPlanPrompt(S.prof, sample, S.fileName, pool, focus);
    var cur;
    if (simple) {
      cur = ['主分析变量：' + focus,
        '其他变量：' + (S.sel.assoc ? '只作相关对照，不单独分析' : '不参与'),
        '分组比较：' + (S.sel.group ? (S.sel.group + ' → ' + focus) : '不分组'),
        '分布图：' + focus].join('；');
    } else {
      cur = ['描述统计：' + (S.sel.metrics.join('、') || '无'),
        '分组比较：' + (S.sel.group ? (S.sel.group + ' → ' + S.sel.metric) : '不分组'),
        '相关分析：' + (S.sel.corr ? '所选变量两两相关' : '不执行'),
        '分布图：' + (S.sel.hist || '无')].join('；');
    }
    return base + '\n\n【当前界面设置（可在此基础上调整）】\n' + cur;
  }

  function applyPlanText(text) {
    var raw = StatEngine.parseJSON(text);
    if (!raw) { toast('未解析出 JSON'); $('#planWarn').textContent = '解析失败：未找到合法 JSON 对象。'; return false; }
    var v = StatEngine.validatePlan(raw, S.prof);
    var plan = v.plan;

    // 简单模式：只接受一个主分析变量，其余变量仅作相关对照
    if (S.sel.mode === 'simple') {
      var cand = plan.descriptives.filter(function (c) { return S.prof.numeric.indexOf(c) >= 0; });
      if (cand.length) S.sel.focus = cand[0];
      S.sel.assoc = plan.correlations.length > 0;
      S.sel.group = (plan.groupCompare && groupCandidates().indexOf(plan.groupCompare.by) >= 0) ? plan.groupCompare.by : '';
      S.planSource = 'ai';
      renderSelections();
      renderPlan();
      if (v.warnings.length) $('#planWarn').textContent = '已修正：' + v.warnings.join('；');
      toast('已应用模型方案');
      return true;
    }

    // 把模型方案映射回界面设置，保证所见即所算
    var nums = S.prof.numeric;
    var keep = plan.descriptives.filter(function (c) { return nums.indexOf(c) >= 0; });
    if (keep.length) S.sel.metrics = keep;
    S.sel.group = plan.groupCompare && groupCandidates().indexOf(plan.groupCompare.by) >= 0 ? plan.groupCompare.by : '';
    S.sel.metric = plan.groupCompare && S.sel.group ? plan.groupCompare.metric : (S.sel.metrics[0] || '');
    if (plan.correlations.length) {
      plan.correlations.forEach(function (p) {
        p.forEach(function (c) { if (S.sel.metrics.indexOf(c) < 0) S.sel.metrics.push(c); });
      });
      S.sel.corr = true;
    } else S.sel.corr = false;
    S.sel.hist = plan.histogram ? plan.histogram.column : (S.sel.metrics[0] || '');

    S.planSource = 'ai';
    renderSelections();   // 重建勾选与下拉
    renderPlan();
    if (v.warnings.length) $('#planWarn').textContent = '已修正：' + v.warnings.join('；');
    toast('已应用模型方案');
    return true;
  }

  /* ================= 执行 ================= */
  function compute() {
    if (S.sel.mode === 'pro' && !S.sel.metrics.length) { toast('请至少选择一个数值变量'); return; }
    if (S.sel.mode === 'simple' && !S.sel.focus) { toast('请选择主分析变量'); return; }
    S.plan = buildPlan();
    S.results = StatEngine.compute(S.plan, S.clean);
    renderResults();
    goto(3);
  }

  function renderResults() {
    var r = S.results;
    var focusTxt = r.meta.focus ? ('主分析：' + r.meta.focus + '　·　') : '';
    $('#resultMeta').textContent = S.fileName + '　·　' + focusTxt + '有效样本 ' + r.meta.n + '　·　统计变量 ' + r.descriptives.length +
      ' 个　·　' + (r.groups ? '分组：' + r.groups.by : '未分组') + '　·　' + (r.correlations.length ? '相关 ' + r.correlations.length + ' 对' : '未做相关');
    $('#descHint').textContent = r.meta.focus ? ('只统计 ' + r.meta.focus) : ('变量 ' + r.descriptives.length + ' 个');

    $('#descTable').innerHTML = '<thead><tr><th>变量</th><th class="num">n</th><th class="num">均值</th><th class="num">标准差</th><th class="num">中位数</th><th class="num">最小</th><th class="num">最大</th><th class="num">变异系数</th><th class="num">偏度</th><th class="num">离群值</th></tr></thead><tbody>' +
      r.descriptives.map(function (d) {
        return '<tr><td>' + esc(d.column) + '</td><td class="num">' + d.n + '</td><td class="num">' + fmt(d.mean, 2) +
          '</td><td class="num">' + fmt(d.sd, 2) + '</td><td class="num">' + fmt(d.median, 2) +
          '</td><td class="num">' + fmt(d.min, 1) + '</td><td class="num">' + fmt(d.max, 1) +
          '</td><td class="num">' + fmt(d.cv, 3) + '</td><td class="num">' + fmt(d.skew, 2) +
          '</td><td class="num">' + d.outliers + '</td></tr>';
      }).join('') + '</tbody>';

    if (r.correlations.length) {
      $('#corrTable').innerHTML = '<thead><tr><th>变量 A</th><th>变量 B</th><th class="num">r</th><th class="num">n</th><th>显著性</th></tr></thead><tbody>' +
        r.correlations.map(function (c) {
          return '<tr><td>' + esc(c.a) + '</td><td>' + esc(c.b) + '</td><td class="num">' + fmt(c.r, 3) +
            '</td><td class="num">' + c.n + '</td><td>' + (c.significant ? '显著' : '不显著') + '</td></tr>';
        }).join('') + '</tbody>';
      $('#corrNote').textContent = '显著性以 |r| > 1.96/√(n−2) 近似判断；相关关系不等同于因果关系。';
    } else {
      $('#corrTable').innerHTML = '<tbody><tr><td class="muted">未选择相关分析（或所选变量少于 2 个）。</td></tr></tbody>';
      $('#corrNote').textContent = '';
    }

    if (r.groups) {
      $('#groupCard').hidden = false;
      $('#groupHint').textContent = r.groups.by + ' × ' + r.groups.metric + '　·　' + r.groups.rows.length + ' 组';
      $('#groupTable').innerHTML = '<thead><tr><th>组别</th><th class="num">n</th><th class="num">均值</th><th class="num">标准差</th><th class="num">最小</th><th class="num">最大</th></tr></thead><tbody>' +
        r.groups.rows.map(function (g) {
          return '<tr><td>' + esc(g.group) + '</td><td class="num">' + g.n + '</td><td class="num">' + fmt(g.mean, 2) +
            '</td><td class="num">' + fmt(g.sd, 2) + '</td><td class="num">' + fmt(g.min, 1) + '</td><td class="num">' + fmt(g.max, 1) + '</td></tr>';
        }).join('') + '</tbody>';
      var note = '最高组与最低组均值差 ' + fmt(r.groups.spread, 2);
      if (r.groups.effect != null) note += '；效应量 d = ' + fmt(r.groups.effect, 2) + '（≥0.80 为大效应）';
      $('#groupNote').textContent = note + '。';
    } else { $('#groupCard').hidden = true; }

    $('#aiAdvice').textContent = S.advice || '';
    updateStatus();
    renderCharts(r);
  }

  /* ================= 图表 ================= */
  function svgWrap(w, h, inner) { return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '">' + inner + '</svg>'; }

  function histogramSVG(hist, meanVal) {
    var W = 560, H = 260, P = { l: 46, r: 16, t: 26, b: 40 };
    var max = Math.max.apply(null, hist.bins.map(function (b) { return b.count; })) || 1;
    var n = hist.bins.length, bw = (W - P.l - P.r) / n;
    var bars = hist.bins.map(function (b, i) {
      var bh = (H - P.t - P.b) * (b.count / max);
      var x = P.l + i * bw + 2;
      return '<rect x="' + x.toFixed(1) + '" y="' + (H - P.b - bh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) +
        '" height="' + bh.toFixed(1) + '" fill="' + C.pine + '" fill-opacity=".82" rx="1.5"><title>' + b.lo + ' — ' + b.hi + '：' + b.count + ' 个</title></rect>';
    }).join('');
    var ticks = '';
    for (var i = 0; i < n; i += Math.ceil(n / 6)) {
      ticks += '<text class="tick" x="' + (P.l + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 16) + '" text-anchor="middle">' + fmt(hist.bins[i].lo, 0) + '</text>';
    }
    var grid = '<line class="axis" x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '"/>' +
      '<text class="tick" x="' + (P.l - 8) + '" y="' + (P.t + 8) + '" text-anchor="end">' + max + '</text>' +
      '<text class="tick" x="' + (P.l - 8) + '" y="' + (H - P.b) + '" text-anchor="end">0</text>';
    var meanLine = '';
    if (meanVal != null) {
      var lo = hist.bins[0].lo, hi = hist.bins[hist.bins.length - 1].hi;
      var xm = P.l + (W - P.l - P.r) * ((meanVal - lo) / (hi - lo || 1));
      if (xm > P.l && xm < W - P.r) {
        meanLine = '<line x1="' + xm.toFixed(1) + '" y1="' + P.t + '" x2="' + xm.toFixed(1) + '" y2="' + (H - P.b) + '" stroke="' + C.brass + '" stroke-width="1.4" stroke-dasharray="5 4"/>' +
          '<text class="tick" x="' + (W - P.r) + '" y="' + (P.t - 8) + '" text-anchor="end" fill="' + C.brass + '">均值 ' + fmt(meanVal, 1) + '</text>';
      }
    }
    return svgWrap(W, H, grid + bars + meanLine + ticks);
  }

  function groupBarSVG(g) {
    var W = 560, H = 280, P = { l: 50, r: 16, t: 30, b: 58 };
    var rows = g.rows;
    var vals = rows.map(function (r) { return r.mean; });
    var hi = Math.max.apply(null, vals) * 1.18 || 1, lo = 0;
    var step = (W - P.l - P.r) / rows.length;
    var bw = Math.min(52, step * 0.52);
    var dense = rows.length > 6;
    var maxLabels = rows.length <= 8;
    function Y(v) { return P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo || 1)); }
    var bars = rows.map(function (r, i) {
      var x = P.l + step * i + (step - bw) / 2;
      var y = Y(r.mean), h = H - P.b - y;
      var whisk = '';
      if (!dense && r.sd != null) {
        var top = Y(Math.min(hi, r.mean + r.sd)), bot = Y(Math.max(lo, r.mean - r.sd));
        whisk = '<line x1="' + (x + bw / 2) + '" y1="' + top + '" x2="' + (x + bw / 2) + '" y2="' + bot + '" stroke="' + C.muted + '" stroke-width="1"/>' +
          '<line x1="' + (x + bw / 2 - 7) + '" y1="' + top + '" x2="' + (x + bw / 2 + 7) + '" y2="' + top + '" stroke="' + C.muted + '" stroke-width="1"/>' +
          '<line x1="' + (x + bw / 2 - 7) + '" y1="' + bot + '" x2="' + (x + bw / 2 + 7) + '" y2="' + bot + '" stroke="' + C.muted + '" stroke-width="1"/>';
      }
      var label = short(r.group, dense ? 4 : 6);
      var tx = x + bw / 2;
      var ly = H - 18;
      var topY = (!dense && r.sd != null) ? Y(Math.min(hi, r.mean + r.sd)) : y;
      var rot = dense ? ' transform="rotate(-28 ' + tx + ' ' + ly + ')" text-anchor="end"' : ' text-anchor="middle"';
      return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(1, h) + '" fill="' + C.pine + '" fill-opacity=".82" rx="2"><title>' +
        esc(r.group) + '：均值 ' + r.mean + '，SD ' + (r.sd == null ? '—' : r.sd) + '，n=' + r.n + '</title></rect>' + whisk +
        '<text class="tick"' + rot + ' x="' + tx + '" y="' + ly + '">' + esc(label) + '</text>' +
        (maxLabels ? '<text class="lbl" x="' + tx + '" y="' + (topY - 8) + '" text-anchor="middle" fill="' + C.pine + '">' + fmt(r.mean, 1) + '</text>' : '');
    }).join('');
    var axis = '<line class="axis" x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '"/>' +
      '<text class="tick" x="' + (P.l - 8) + '" y="' + (P.t + 8) + '" text-anchor="end">' + fmt(hi, 0) + '</text>' +
      '<text class="tick" x="' + (P.l - 8) + '" y="' + (H - P.b) + '" text-anchor="end">0</text>';
    return svgWrap(W, H, axis + bars);
  }

  function scatterSVG(sc) {
    var W = 560, H = 280, P = { l: 58, r: 18, t: 30, b: 42 };
    var pts = sc.points;
    if (!pts.length) return '<p class="muted">无有效配对观测</p>';
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var xp = (x1 - x0) * 0.06 || 1, yp = (y1 - y0) * 0.08 || 1;
    x0 -= xp; x1 += xp; y0 -= yp; y1 += yp;
    function X(v) { return P.l + (W - P.l - P.r) * ((v - x0) / (x1 - x0)); }
    function Y(v) { return P.t + (H - P.t - P.b) * (1 - (v - y0) / (y1 - y0)); }
    var dots = pts.map(function (p) {
      return '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="' + C.pine + '" fill-opacity=".42"/>';
    }).join('');
    var n = pts.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxy += p[0] * p[1]; sxx += p[0] * p[0]; });
    var denom = n * sxx - sx * sx, line = '';
    if (Math.abs(denom) > 1e-9) {
      var b = (n * sxy - sx * sy) / denom, a = (sy - b * sx) / n;
      line = '<line x1="' + X(x0) + '" y1="' + Y(a + b * x0) + '" x2="' + X(x1) + '" y2="' + Y(a + b * x1) + '" stroke="' + C.brass + '" stroke-width="1.6"/>';
    }
    var ax = '<line class="axis" x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '"/>' +
      '<line class="axis" x1="' + P.l + '" y1="' + P.t + '" x2="' + P.l + '" y2="' + (H - P.b) + '"/>' +
      '<text class="tick" x="' + ((P.l + W - P.r) / 2) + '" y="' + (H - 12) + '" text-anchor="middle">横轴：' + esc(short(sc.x, 10)) + '</text>' +
      '<text class="tick" x="' + P.l + '" y="' + (P.t - 8) + '">纵轴：' + esc(short(sc.y, 10)) + '</text>' +
      '<text class="tick" x="' + (W - P.r) + '" y="' + (P.t - 8) + '" text-anchor="end" fill="' + C.brass + '">r = ' + fmt(sc.r, 3) + '（n = ' + n + '）</text>';
    return svgWrap(W, H, ax + line + dots);
  }

  function corrMatrixSVG(cm) {
    var raw = cm.names;
    var long = raw.some(function (n) { return String(n).length > 5; });
    var names = raw.map(function (n, i) { return long ? ('V' + (i + 1)) : short(n, 6); });
    var cell = 74, labelW = 54, top = 34;
    var legendLines = [];
    if (long) {
      var per = 2;
      for (var i = 0; i < raw.length; i += per) {
        legendLines.push(raw.slice(i, i + per).map(function (n, k) { return 'V' + (i + k + 1) + ' ' + n; }).join('　　'));
      }
    }
    var legendH = legendLines.length ? (18 + legendLines.length * 18) : 6;
    var W = labelW + cell * names.length + 18;
    var H = top + cell * names.length + legendH;
    function color(v) {
      if (v == null) return '#F1ECE2';
      var a = Math.min(1, Math.abs(v));
      return v >= 0 ? rgba(C.pine, 0.12 + 0.76 * a) : rgba(C.clay, 0.12 + 0.76 * a);
    }
    var cells = '';
    names.forEach(function (rname, ri) {
      cells += '<text class="tick" x="' + (labelW - 10) + '" y="' + (top + ri * cell + cell / 2 + 4) + '" text-anchor="end" font-size="12">' + esc(rname) + '</text>';
      names.forEach(function (cname, ci) {
        var v = cm.matrix[ri][ci];
        var x = labelW + ci * cell, y = top + ri * cell;
        cells += '<rect x="' + x + '" y="' + y + '" width="' + (cell - 3) + '" height="' + (cell - 3) + '" rx="2" fill="' + color(v) + '"/>';
        if (v != null) {
          cells += '<text x="' + (x + (cell - 3) / 2) + '" y="' + (y + (cell - 3) / 2 + 4) + '" text-anchor="middle" font-size="13.5" fill="' +
            (Math.abs(v) > 0.45 ? '#F7F4EE' : '#3C4A44') + '">' + v.toFixed(2) + '</text>';
        }
      });
    });
    names.forEach(function (cname, ci) {
      cells += '<text class="tick" x="' + (labelW + ci * cell + (cell - 3) / 2) + '" y="' + (top - 12) + '" text-anchor="middle" font-size="12">' + esc(cname) + '</text>';
    });
    legendLines.forEach(function (line, i) {
      cells += '<text class="tick" x="' + labelW + '" y="' + (top + cell * names.length + 20 + i * 18) + '" font-size="11.5" fill="#8B8878">' + esc(line) + '</text>';
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
    if (r.histogram) {
      var d0 = r.descriptives.filter(function (d) { return d.column === r.histogram.column; })[0];
      card('分布直方图 · ' + r.histogram.column, '柱高为频数；虚线为均值位置', histogramSVG(r.histogram, d0 ? d0.mean : null));
    }
    if (r.groups) {
      var sub = '按「' + r.groups.by + '」分组，纵轴自 0 起' + (r.groups.rows.length <= 6 ? '，误差线为 ±1 个标准差' : '；分组较多，已省略误差线与数值标签');
      card('组均值 · ' + r.groups.metric, sub, groupBarSVG(r.groups));
    }
    if (r.scatter) {
      card('散点与拟合线 · ' + r.scatter.x + ' × ' + r.scatter.y, '黄线为最小二乘拟合，仅呈现线性趋势', scatterSVG(r.scatter));
    }
    if (r.corrMatrix && r.corrMatrix.names.length >= 2) {
      card('相关系数矩阵', '颜色越深相关性越强；正值与负值分色，数值为 Pearson r，行列名过长时省略', corrMatrixSVG(r.corrMatrix));
    }
    if (!box.children.length) {
      box.innerHTML = '<div class="card"><p class="muted">当前设置未产生图形：请返回上一步选择分布图变量或分组变量。</p></div>';
    }
  }

  /* ================= 导出 ================= */
  function buildMarkdown() {
    var r = S.results, L = [];
    var sep = '────────────────────────────';
    L.push('统计分析结果');
    L.push(sep);
    L.push('数据文件：' + S.fileName);
    L.push('有效样本：' + r.meta.n + '　统计变量：' + r.descriptives.length + ' 个' +
      (r.meta.focus ? '　主分析：' + r.meta.focus : '') +
      (r.groups ? '　分组：' + r.groups.by : '') +
      (r.correlations.length ? '　相关：' + r.correlations.length + ' 对' : ''));
    L.push('');

    L.push('【基本信息】');
    L.push('变量范围：' + r.descriptives.map(function (d) { return d.column; }).join('、'));
    L.push('缺失处理：按变量剔除，不作插补');
    if (r.groups) L.push('分组变量：' + r.groups.by + '（' + r.groups.rows.length + ' 组）');
    L.push('');

    L.push('【方差与离散程度】');
    r.descriptives.forEach(function (d) {
      var v = (d.variance != null) ? d.variance : d.sd * d.sd;
      L.push(d.column + '：方差 ' + fmt(v, 2) + '，标准差 ' + fmt(d.sd, 2) + '，变异系数 ' + fmt(d.cv, 3));
    });
    L.push('');

    L.push('【均值与位置】');
    r.descriptives.forEach(function (d) {
      L.push(d.column + '：均值 ' + fmt(d.mean, 2) + '，中位数 ' + fmt(d.median, 2) +
        '，最小值 ' + fmt(d.min, 1) + '，最大值 ' + fmt(d.max, 1) +
        '，偏度 ' + fmt(d.skew, 2) + '，离群值 ' + d.outliers + ' 个');
    });
    L.push('');

    if (r.correlations.length) {
      L.push('【相关系数】');
      r.correlations.forEach(function (c) {
        L.push(c.a + ' × ' + c.b + '：r = ' + fmt(c.r, 3) + '（n = ' + c.n + '，' + (c.significant ? '显著' : '不显著') + '）');
      });
      L.push('注：相关关系不等同于因果关系。');
      L.push('');
    }

    if (r.groups) {
      L.push('【分组均值】');
      r.groups.rows.forEach(function (g) {
        L.push(g.group + '：' + fmt(g.mean, 2) + '（n = ' + g.n + '，标准差 ' + fmt(g.sd, 2) + '）');
      });
      L.push('组间均值差 ' + fmt(r.groups.spread, 2) + (r.groups.effect != null ? '，效应量 d = ' + fmt(r.groups.effect, 2) : '') + '。');
      L.push('');
    }

    if (S.advice) {
      L.push('【模型建议】');
      L.push(S.advice);
      L.push('');
    }

    L.push(sep);
    L.push('口径说明：样本方差取 n−1；缺失值按变量剔除；离群值按 1.5×IQR 判定并仅作标记；相关系数为 Pearson r；组间比较采用效应量 d。');
    return L.join('\n');
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
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

    $('#togglePrompt').addEventListener('click', function () {
      var p = $('#planPromptPreview');
      p.hidden = !p.hidden;
      this.textContent = p.hidden ? '查看提示词' : '收起提示词';
    });
    $('#copyPlanPrompt').addEventListener('click', function () { copyText($('#planPromptPreview')._prompt || ''); });
    $('#applyPlan').addEventListener('click', function () {
      var t = $('#planInput').value.trim();
      if (!t) { toast('请先粘贴模型返回内容'); return; }
      applyPlanText(t);
    });
    $('#runPlanAI').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; btn.textContent = '请求中…';
      try {
        var txt = await callLLM($('#planPromptPreview')._prompt, 0.1);
        $('#planInput').value = txt;
        applyPlanText(txt);
      } catch (e) {
        toast('调用失败：' + e.message);
      } finally { btn.disabled = false; btn.textContent = '模型推荐方案'; }
    });

    $('#computeBtn').addEventListener('click', compute);

    $('#toggleAdvice').addEventListener('click', function () {
      var ta = $('#adviceInput'), row = $('#applyAdviceRow');
      ta.hidden = !ta.hidden; row.hidden = ta.hidden;
      this.textContent = ta.hidden ? '粘贴模型输出' : '收起';
    });
    $('#copyAdvicePrompt').addEventListener('click', function () { copyText(StatEngine.buildAdvicePrompt(S.results, S.prof)); });
    $('#applyAdvice').addEventListener('click', function () {
      var t = $('#adviceInput').value.trim();
      if (!t) { toast('请先粘贴模型输出'); return; }
      S.advice = t; $('#aiAdvice').textContent = t; toast('已显示模型建议');
    });
    $('#runAdviceAI').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; btn.textContent = '请求中…';
      try {
        var txt = await callLLM(StatEngine.buildAdvicePrompt(S.results, S.prof), 0.4);
        S.advice = txt; $('#adviceInput').value = txt; $('#aiAdvice').textContent = txt;
        toast('模型建议已生成');
      } catch (e) {
        toast('调用失败：' + e.message);
        $('#aiAdvice').textContent = '调用失败（' + e.message + '）。可点击“复制提示词”，在其他平台生成后粘贴回来。';
      } finally { btn.disabled = false; btn.textContent = '生成建议'; }
    });

    $('#exportMd').addEventListener('click', function () {
      download('统计分析结果.txt', buildMarkdown(), 'text/plain;charset=utf-8');
    });
    $('#restart').addEventListener('click', function () {
      S = { fileName: '', headers: [], rows: [], prof: null, clean: null, sel: { metrics: [], group: '', metric: '', corr: true, hist: '' }, plan: null, planSource: 'user', results: null, advice: '' };
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
    try {
      var qp = new URLSearchParams(location.search);
      var demo = qp.get('demo');
      var step = Number(qp.get('step') || 2);
      if (demo && window.SL_SAMPLES && window.SL_SAMPLES[demo - 1]) {
        setTimeout(function () {
          var s = window.SL_SAMPLES[demo - 1];
          var t = StatEngine.parseCSV(s.text);
          S.fileName = s.name + '.csv';
          start(t.headers, t.rows);
          var m = qp.get('mode');
          if (m === 'simple' || m === 'pro') {
            S.sel.mode = m;
            var f = qp.get('focus');
            if (f && S.prof.numeric.indexOf(f) >= 0) S.sel.focus = f;
            renderSelections();
            renderPlan();
          }
          if (step >= 3) setTimeout(compute, 160);
        }, 120);
      }
      if (qp.get('settings') === '1') setTimeout(function () { $('#settingsModal').hidden = false; }, 260);
    } catch (e) { }
  });
})();
