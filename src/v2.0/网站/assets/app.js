/* 统计分析助手 · 交互层 */
(function () {
  'use strict';

  var S = {
    fileName: '', headers: [], rows: [], prof: null, clean: null,
    plan: null, planSource: 'rule', results: null, insights: [], advice: '', warnings: []
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
    t._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2400);
  }
  function fmt(n, d) {
    if (n == null || n === '' || !isFinite(n)) return '—';
    var s = Number(n).toFixed(d == null ? 2 : d).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return s.join('.');
  }
  function pct(n) { return n == null ? '—' : (Math.round(n * 1000) / 10) + '%'; }

  /* ---------------- 大模型设置 ---------------- */
  var CFG = { base: '', model: '', key: '' };
  function loadCfg() {
    try {
      var raw = localStorage.getItem('sl_llm_cfg');
      if (raw) CFG = JSON.parse(raw);
    } catch (e) { }
    $('#apiBase').value = CFG.base || '';
    $('#apiModel').value = CFG.model || '';
    $('#apiKey').value = CFG.key || '';
    updateMode();
  }
  function saveCfg() {
    CFG = { base: $('#apiBase').value.trim(), model: $('#apiModel').value.trim(), key: $('#apiKey').value.trim() };
    try { localStorage.setItem('sl_llm_cfg', JSON.stringify(CFG)); } catch (e) { }
    updateMode();
    toast(CFG.key ? '已保存，可用“直接调用大模型”' : '已保存（未填 Key，仍可用复制粘贴方式）');
    $('#settingsModal').hidden = true;
  }
  function updateMode() {
    var on = !!(CFG.key && CFG.base);
    $('#modePill').textContent = on ? '当前：已接大模型（可直连）' : '当前：规则版（未接大模型）';
    $('#modePill').classList.toggle('ai', on);
    $('#runPlanAI').hidden = !on;
    $('#runAdviceAI').hidden = !on;
  }

  async function callLLM(prompt, temperature) {
    var base = (CFG.base || '').replace(/\/+$/, '');
    var url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CFG.key },
      body: JSON.stringify({
        model: CFG.model || 'deepseek-chat',
        temperature: temperature == null ? 0.2 : temperature,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error('接口返回 HTTP ' + res.status);
    var j = await res.json();
    var txt = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    if (!txt) throw new Error('接口没有返回内容');
    return txt;
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { toast('已复制'); }, function () { fallback(txt); });
    }
    fallback(txt);
  }
  function fallback(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选择'); }
    ta.remove();
  }

  /* ---------------- 文件读取 ---------------- */
  function decode(buf) {
    var u8 = new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { }
    try { return new TextDecoder('gbk').decode(u8); } catch (e) { }
    return new TextDecoder('utf-8').decode(u8);
  }

  function aoaToTable(aoa) {
    aoa = (aoa || []).filter(function (r) { return r && r.some(function (c) { return c != null && String(c).trim() !== ''; }); });
    if (!aoa.length) return { headers: [], rows: [] };
    var headers = aoa[0].map(function (h, i) { return String(h == null ? '' : h).trim() || ('列' + (i + 1)); });
    var seen = {};
    headers = headers.map(function (h) { if (seen[h]) { seen[h]++; return h + '_' + seen[h]; } seen[h] = 1; return h; });
    return { headers: headers, rows: aoa.slice(1) };
  }

  async function readFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'csv'].indexOf(ext) < 0) { toast('只支持 .xlsx / .csv（旧版 .xls 请另存为 .xlsx）'); return; }
    try {
      var buf = await file.arrayBuffer();
      var table;
      if (ext === 'csv') table = StatEngine.parseCSV(decode(buf));
      else table = aoaToTable((await XLSXLite.read(buf)).aoa);
      if (!table.rows.length) { toast('没有读到数据行'); return; }
      S.fileName = file.name;
      start(table.headers, table.rows);
    } catch (e) {
      console.error(e);
      toast('解析失败：' + e.message);
    }
  }

  /* ---------------- 第一步：画像 + 清洗 ---------------- */
  function start(headers, rows) {
    S.headers = headers; S.rows = rows;
    S.prof = StatEngine.profile(headers, rows);
    S.clean = StatEngine.clean(headers, rows, S.prof);
    S.plan = StatEngine.defaultPlan(S.prof);
    S.planSource = 'rule';
    S.advice = ''; S.results = null;
    renderProfile();
    renderPlanPrompt();
    renderPlan();
    goto(2);
  }

  function renderProfile() {
    var p = S.prof, log = S.clean.log;
    $('#fileMeta').textContent = S.fileName + '　·　' + p.n + ' 行 × ' + p.m + ' 列　·　数值列 ' + p.numeric.length + ' 个，类别列 ' + p.categorical.length + ' 个';
    var t = $('#profileTable');
    t.innerHTML = '<thead><tr><th>列名</th><th>类型</th><th>有效</th><th>缺失</th><th>唯一值</th><th>示例 / 范围</th></tr></thead><tbody>' +
      p.columns.map(function (c) {
        var info = c.type === 'numeric' ? (c.min + ' ~ ' + c.max) : c.categories.slice(0, 3).join(' / ');
        return '<tr><td>' + esc(c.name) + (c.idLike ? ' <span class="muted tiny">（标识列）</span>' : '') + '</td>' +
          '<td>' + (c.type === 'numeric' ? '数值' : '类别') + '</td>' +
          '<td class="num">' + c.n + '</td><td class="num">' + c.missing + '</td><td class="num">' + c.unique + '</td>' +
          '<td>' + esc(String(info).slice(0, 40)) + '</td></tr>';
      }).join('') + '</tbody>';
    $('#cleanNote').textContent = '清洗记录：删除重复行 ' + log.dupRemoved + ' 行；空白/全角规范化 ' + log.trimmed +
      ' 处；文本型数字转换为数值 ' + log.coerced + ' 处。缺失值不做填充（避免编造），统计时按列剔除并在表中标注有效样本量。';
  }

  function renderPlanPrompt() {
    var sample = S.clean.rows.slice(0, 4).map(function (r) {
      return S.headers.map(function (h) { return r[h]; });
    });
    var prompt = StatEngine.buildPlanPrompt(S.prof, sample, S.fileName);
    $('#planPromptPreview').textContent = prompt;
    $('#planPromptPreview')._prompt = prompt;
  }

  function renderPlan() {
    var plan = S.plan, box = $('#planChips');
    box.innerHTML = '';
    function chip(label, val) {
      var d = document.createElement('div');
      d.className = 'chip';
      d.innerHTML = '<b>' + esc(label) + '</b>　' + esc(val);
      box.appendChild(d);
    }
    chip('描述统计', (plan.descriptives || []).join('、') || '无');
    chip('分组比较', plan.groupCompare ? (plan.groupCompare.by + ' → ' + plan.groupCompare.metric) : '不做');
    chip('相关分析', (plan.correlations || []).map(function (p) { return p.join(' × '); }).join('；') || '不做');
    chip('直方图', plan.histogram ? plan.histogram.column + '（' + plan.histogram.bins + ' 箱）' : '不做');
    chip('频数', (plan.frequency || []).join('、') || '不做');
    chip('计划来源', S.planSource === 'ai' ? '大模型生成' : '规则默认');
    $('#planWarn').textContent = S.warnings.length ? ('已修正：' + S.warnings.join('；')) : '';
  }

  function applyPlanFromText(text) {
    var raw = StatEngine.parseJSON(text);
    if (!raw) { toast('没有解析出 JSON，请检查大模型回复'); $('#planWarn').textContent = '解析失败：回复里没有找到合法的 JSON 对象。'; return; }
    var v = StatEngine.validatePlan(raw, S.prof);
    S.plan = v.plan; S.warnings = v.warnings; S.planSource = 'ai';
    renderPlan();
    toast('计划已应用' + (v.warnings.length ? '（有 ' + v.warnings.length + ' 处被修正）' : ''));
  }

  /* ---------------- 第二步：计算 ---------------- */
  function compute() {
    S.results = StatEngine.compute(S.plan, S.clean);
    S.insights = StatEngine.insights(S.results, S.prof);
    renderResults();
    goto(3);
  }

  function renderResults() {
    var r = S.results;
    $('#resultMeta').textContent = S.fileName + '　·　计划来源：' + (S.planSource === 'ai' ? '大模型' : '规则默认') +
      '　·　有效行 ' + r.meta.n + '　·　' + new Date().toLocaleString('zh-CN');

    // 描述统计（转置：指标为行）
    var cols = r.descriptives.map(function (d) { return d.column; });
    var rows = [
      ['有效样本 n', function (d) { return d.n; }, 0],
      ['均值', function (d) { return fmt(d.mean, 2); }],
      ['中位数', function (d) { return fmt(d.median, 2); }],
      ['标准差', function (d) { return fmt(d.sd, 2); }],
      ['方差', function (d) { return fmt(d.variance, 2); }],
      ['最小值', function (d) { return fmt(d.min, 2); }],
      ['最大值', function (d) { return fmt(d.max, 2); }],
      ['极差', function (d) { return fmt(d.range, 2); }],
      ['Q1 / Q3', function (d) { return fmt(d.q1, 1) + ' / ' + fmt(d.q3, 1); }],
      ['变异系数 CV', function (d) { return fmt(d.cv, 3); }],
      ['95% 置信区间', function (d) { return d.ci95 ? (fmt(d.ci95[0], 1) + ' ~ ' + fmt(d.ci95[1], 1)) : '—'; }],
      ['偏度', function (d) { return fmt(d.skew, 2); }],
      ['峰度', function (d) { return fmt(d.kurtosis, 2); }],
      ['异常值个数', function (d) { return d.outliers; }]
    ];
    $('#descTable').innerHTML = '<thead><tr><th>指标</th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td>' + row[0] + '</td>' + r.descriptives.map(function (d) { return '<td class="num">' + row[1](d) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';

    // 分组比较
    if (r.groups) {
      $('#groupTitle').hidden = false; $('#groupWrap').hidden = false; $('#groupNote').hidden = false;
      $('#groupTitle').textContent = '分组比较：按「' + r.groups.by + '」看「' + r.groups.metric + '」';
      $('#groupTable').innerHTML = '<thead><tr><th>组别</th><th>样本量</th><th>均值</th><th>中位数</th><th>标准差</th><th>最小</th><th>最大</th></tr></thead><tbody>' +
        r.groups.rows.map(function (g) {
          return '<tr><td>' + esc(g.group) + '</td><td class="num">' + g.n + '</td><td class="num">' + fmt(g.mean, 2) +
            '</td><td class="num">' + fmt(g.median, 2) + '</td><td class="num">' + fmt(g.sd, 2) +
            '</td><td class="num">' + fmt(g.min, 1) + '</td><td class="num">' + fmt(g.max, 1) + '</td></tr>';
        }).join('') + '</tbody>';
      var note = '最高组均值 − 最低组均值 = ' + fmt(r.groups.spread, 2);
      if (r.groups.effect != null) {
        var lv = Math.abs(r.groups.effect) >= 0.8 ? '大' : Math.abs(r.groups.effect) >= 0.5 ? '中' : '小';
        note += '；效应量 d = ' + r.groups.effect + '（' + lv + '效应）。d ≥ 0.8 通常认为组间差异明显。';
      }
      $('#groupNote').textContent = note;
    } else {
      $('#groupTitle').hidden = true; $('#groupWrap').hidden = true; $('#groupNote').hidden = true;
    }

    // 相关
    if (r.correlations.length) {
      $('#corrTitle').hidden = false; $('#corrWrap').hidden = false;
      $('#corrTable').innerHTML = '<thead><tr><th>变量 A</th><th>变量 B</th><th>r</th><th>样本量</th><th>强度</th></tr></thead><tbody>' +
        r.correlations.map(function (c) {
          var a = Math.abs(c.r);
          var lv = a >= 0.6 ? '强' : a >= 0.3 ? '中' : '弱';
          return '<tr><td>' + esc(c.a) + '</td><td>' + esc(c.b) + '</td><td class="num">' + fmt(c.r, 3) +
            '</td><td class="num">' + c.n + '</td><td>' + lv + (c.significant ? '（显著）' : '（不显著）') + '</td></tr>';
        }).join('') + '</tbody>';
    } else {
      $('#corrTitle').hidden = true; $('#corrWrap').hidden = true;
    }

    // 直方图
    if (r.histogram) {
      $('#histTitle').hidden = false; $('#histWrap').hidden = false;
      $('#histTitle').textContent = '分布直方图：' + r.histogram.column;
      $('#histWrap').innerHTML = histogramSVG(r.histogram);
    } else {
      $('#histTitle').hidden = true; $('#histWrap').hidden = true;
    }

    // 频数
    if (r.frequency.length) {
      $('#freqTitle').hidden = false; $('#freqWrap').hidden = false;
      $('#freqTitle').textContent = '频数分布：' + r.frequency.map(function (f) { return f.column; }).join('、');
      $('#freqTable').innerHTML = '<thead><tr><th>取值</th><th>计数</th><th>占比</th></tr></thead><tbody>' +
        r.frequency.map(function (f) {
          return f.items.map(function (it) {
            return '<tr><td>' + esc(it.value) + '</td><td class="num">' + it.count + '</td><td class="num">' + pct(it.pct) + '</td></tr>';
          }).join('') + '<tr><td colspan="3" class="muted tiny">— ' + esc(f.column) + ' —</td></tr>';
        }).join('') + '</tbody>';
    } else {
      $('#freqTitle').hidden = true; $('#freqWrap').hidden = true;
    }

    // 规则提示
    $('#insightList').innerHTML = S.insights.map(function (i) {
      return '<div class="insight ' + i.level + '"><div class="it">' + esc(i.title) + '</div><div class="ix">' + esc(i.text) + '</div></div>';
    }).join('');

    $('#aiAdvice').textContent = S.advice || '';
  }

  function histogramSVG(h) {
    var W = 420, H = 150, P = { l: 34, r: 8, t: 10, b: 22 };
    var max = Math.max.apply(null, h.bins.map(function (b) { return b.count; })) || 1;
    var bw = (W - P.l - P.r) / h.bins.length;
    var bars = h.bins.map(function (b, i) {
      var bh = (H - P.t - P.b) * (b.count / max);
      var x = P.l + i * bw + 2;
      return '<rect x="' + x.toFixed(1) + '" y="' + (H - P.b - bh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) +
        '" height="' + bh.toFixed(1) + '" rx="2" fill="#2F8C74"><title>' + b.lo + '–' + b.hi + '：' + b.count + ' 个</title></rect>';
    }).join('');
    var labels = h.bins.map(function (b, i) {
      if (i % 2 && i !== h.bins.length - 1) return '';
      return '<text x="' + (P.l + i * bw + bw / 2) + '" y="' + (H - 6) + '" font-size="9" fill="#8A9A94" text-anchor="middle">' + Math.round(b.lo) + '</text>';
    }).join('');
    var yl = '<text x="' + (P.l - 4) + '" y="' + (P.t + 8) + '" font-size="9" fill="#8A9A94" text-anchor="end">' + max + '</text>' +
      '<text x="' + (P.l - 4) + '" y="' + (H - P.b) + '" font-size="9" fill="#8A9A94" text-anchor="end">0</text>';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<line x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '" stroke="#DCE6E1"/>' +
      bars + labels + yl + '</svg>';
  }

  /* ---------------- 导航 ---------------- */
  function goto(step) {
    $$('.panel[data-panel]').forEach(function (p) { p.hidden = Number(p.getAttribute('data-panel')) !== step; });
    $$('.steps li').forEach(function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.classList.toggle('active', n === step);
      li.classList.toggle('done', n < step);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 导出 ---------------- */
  function buildMarkdown() {
    var r = S.results, lines = [];
    lines.push('# 统计分析报告');
    lines.push('');
    lines.push('> 数据文件：' + S.fileName + '　｜　有效行：' + r.meta.n + '　｜　生成时间：' + new Date().toLocaleString('zh-CN'));
    lines.push('');
    lines.push('## 一、描述统计');
    lines.push('');
    lines.push('| 指标 | ' + r.descriptives.map(function (d) { return d.column; }).join(' | ') + ' |');
    lines.push('| --- |' + r.descriptives.map(function () { return ' --- |'; }).join(''));
    var rows = [
      ['有效样本 n', function (d) { return d.n; }],
      ['均值', function (d) { return fmt(d.mean, 2); }],
      ['中位数', function (d) { return fmt(d.median, 2); }],
      ['标准差', function (d) { return fmt(d.sd, 2); }],
      ['方差', function (d) { return fmt(d.variance, 2); }],
      ['最小值', function (d) { return fmt(d.min, 2); }],
      ['最大值', function (d) { return fmt(d.max, 2); }],
      ['变异系数 CV', function (d) { return fmt(d.cv, 3); }],
      ['偏度', function (d) { return fmt(d.skew, 2); }],
      ['异常值个数', function (d) { return d.outliers; }],
      ['95% 置信区间', function (d) { return d.ci95 ? (fmt(d.ci95[0], 1) + ' ~ ' + fmt(d.ci95[1], 1)) : '—'; }]
    ];
    rows.forEach(function (row) {
      lines.push('| ' + row[0] + ' | ' + r.descriptives.map(function (d) { return row[1](d); }).join(' | ') + ' |');
    });
    lines.push('');
    if (r.groups) {
      lines.push('## 二、分组比较（' + r.groups.by + ' → ' + r.groups.metric + '）');
      lines.push('');
      lines.push('| 组别 | 样本量 | 均值 | 中位数 | 标准差 |');
      lines.push('| --- | --- | --- | --- | --- |');
      r.groups.rows.forEach(function (g) {
        lines.push('| ' + g.group + ' | ' + g.n + ' | ' + fmt(g.mean, 2) + ' | ' + fmt(g.median, 2) + ' | ' + fmt(g.sd, 2) + ' |');
      });
      lines.push('');
      lines.push('组间极差 ' + fmt(r.groups.spread, 2) + (r.groups.effect != null ? '，效应量 d = ' + r.groups.effect : '') + '。');
      lines.push('');
    }
    if (r.correlations.length) {
      lines.push('## 三、相关分析');
      lines.push('');
      lines.push('| 变量 A | 变量 B | r | 样本量 |');
      lines.push('| --- | --- | --- | --- |');
      r.correlations.forEach(function (c) { lines.push('| ' + c.a + ' | ' + c.b + ' | ' + fmt(c.r, 3) + ' | ' + c.n + ' |'); });
      lines.push('');
      lines.push('注：相关不等于因果。');
      lines.push('');
    }
    lines.push('## 四、统计提示（规则生成，数字均来自上表）');
    lines.push('');
    S.insights.forEach(function (i, k) { lines.push((k + 1) + '. **' + i.title + '**：' + i.text); });
    lines.push('');
    if (S.advice) {
      lines.push('## 五、大模型业务建议');
      lines.push('');
      lines.push(S.advice);
      lines.push('');
    }
    lines.push('---');
    lines.push('说明：样本方差用 n−1；缺失值按列剔除；相关系数为 Pearson r；异常值按 1.5×IQR 判定。');
    return lines.join('\n');
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------- 示例数据 ---------------- */
  function renderSamples() {
    var box = $('#sampleList');
    box.innerHTML = '';
    (window.SL_SAMPLES || []).forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sample';
      b.innerHTML = '<span class="no">' + (i + 1) + '</span><span><span class="nm">' + esc(s.name) +
        '</span><br><span class="ds">' + esc(s.desc) + '</span></span>';
      b.addEventListener('click', function () {
        var t = StatEngine.parseCSV(s.text);
        S.fileName = s.name + '.csv';
        start(t.headers, t.rows);
      });
      box.appendChild(b);
    });
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    var dz = $('#dropzone'), fi = $('#fileInput');
    $('#pickBtn').addEventListener('click', function (e) { e.stopPropagation(); fi.click(); });
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { if (fi.files[0]) readFile(fi.files[0]); fi.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hover'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hover'); }); });
    dz.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });

    $$('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { goto(Number(b.getAttribute('data-goto'))); }); });

    $('#copyPlanPrompt').addEventListener('click', function () { copyText($('#planPromptPreview')._prompt || $('#planPromptPreview').textContent); });
    $('#applyPlan').addEventListener('click', function () {
      var t = $('#planInput').value.trim();
      if (!t) { toast('先把大模型的回复粘进来'); return; }
      applyPlanFromText(t);
    });
    $('#useDefault').addEventListener('click', function () {
      S.plan = StatEngine.defaultPlan(S.prof); S.planSource = 'rule'; S.warnings = [];
      renderPlan(); toast('已使用默认计划');
    });
    $('#runPlanAI').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; btn.textContent = '调用中…';
      try {
        var txt = await callLLM($('#planPromptPreview')._prompt, 0.1);
        $('#planInput').value = txt;
        applyPlanFromText(txt);
      } catch (e) {
        toast('调用失败：' + e.message + '（可改用复制提示词）');
      } finally { btn.disabled = false; btn.textContent = '直接调用大模型'; }
    });
    $('#computeBtn').addEventListener('click', compute);

    $('#copyAdvicePrompt').addEventListener('click', function () { copyText(StatEngine.buildAdvicePrompt(S.results, S.prof)); });
    $('#applyAdvice').addEventListener('click', function () {
      var t = $('#adviceInput').value.trim();
      if (!t) { toast('先把大模型写的建议粘进来'); return; }
      S.advice = t; $('#aiAdvice').textContent = t; toast('已显示建议');
    });
    $('#runAdviceAI').addEventListener('click', async function () {
      var btn = this; btn.disabled = true; btn.textContent = '调用中…';
      try {
        var txt = await callLLM(StatEngine.buildAdvicePrompt(S.results, S.prof), 0.4);
        S.advice = txt; $('#adviceInput').value = txt; $('#aiAdvice').textContent = txt;
        toast('大模型建议已生成');
      } catch (e) {
        toast('调用失败：' + e.message + '（可改用复制提示词）');
      } finally { btn.disabled = false; btn.textContent = '直接调用大模型'; }
    });

    $('#exportMd').addEventListener('click', function () { download('统计分析报告.md', buildMarkdown()); });
    $('#restart').addEventListener('click', function () {
      S = { fileName: '', headers: [], rows: [], prof: null, clean: null, plan: null, planSource: 'rule', results: null, insights: [], advice: '', warnings: [] };
      goto(1);
    });

    $('#settingsBtn').addEventListener('click', function () { $('#settingsModal').hidden = false; });
    $('#closeSettings').addEventListener('click', function () { $('#settingsModal').hidden = true; });
    $('#saveSettings').addEventListener('click', saveCfg);
    $('#settingsModal').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
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
          if (step >= 3) setTimeout(compute, 150);
        }, 120);
      }
    } catch (e) { }
  });
})();
