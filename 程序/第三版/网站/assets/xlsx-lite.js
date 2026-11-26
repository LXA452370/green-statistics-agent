/* =========================================================================
 * xlsx-lite：零依赖的 .xlsx 读取器（ZIP + DecompressionStream + DOMParser）
 * 只做本作品需要的事：取第一个（或指定）工作表的二维数组。
 * 支持：共享字符串、内联字符串、数字、布尔；不支持：样式、合并单元格、公式计算
 * ========================================================================= */
(function (root) {
  'use strict';

  function u16(dv, o) { return dv.getUint16(o, true); }
  function u32(dv, o) { return dv.getUint32(o, true); }

  function findEOCD(dv) {
    var len = dv.byteLength;
    for (var i = len - 22; i >= Math.max(0, len - 66000); i--) {
      if (u32(dv, i) === 0x06054b50) return i;
    }
    return -1;
  }

  function readEntries(dv) {
    var eocd = findEOCD(dv);
    if (eocd < 0) throw new Error('不是有效的 xlsx（未找到 ZIP 目录）');
    var count = u16(dv, eocd + 10);
    var cdOffset = u32(dv, eocd + 16);
    var entries = {};
    var p = cdOffset;
    for (var i = 0; i < count; i++) {
      if (u32(dv, p) !== 0x02014b50) break;
      var method = u16(dv, p + 10);
      var compSize = u32(dv, p + 20);
      var nameLen = u16(dv, p + 28);
      var extraLen = u16(dv, p + 30);
      var commentLen = u16(dv, p + 32);
      var localOff = u32(dv, p + 42);
      var nameBytes = new Uint8Array(dv.buffer, dv.byteOffset + p + 46, nameLen);
      var name = new TextDecoder('utf-8').decode(nameBytes);
      entries[name] = { method: method, compSize: compSize, localOff: localOff };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function readData(dv, entry) {
    var off = entry.localOff;
    if (u32(dv, off) !== 0x04034b50) throw new Error('ZIP 局部头损坏');
    var nameLen = u16(dv, off + 26);
    var extraLen = u16(dv, off + 28);
    var start = off + 30 + nameLen + extraLen;
    var bytes = new Uint8Array(dv.buffer, dv.byteOffset + start, entry.compSize);
    if (entry.method === 0) return bytes;
    if (entry.method !== 8) throw new Error('不支持的压缩方式：' + entry.method);
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压 xlsx，请改用 CSV，或用新版 Chrome / Edge 打开');
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function textOf(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var out = [];
    var sis = doc.getElementsByTagName('si');
    for (var i = 0; i < sis.length; i++) {
      var ts = sis[i].getElementsByTagName('t');
      var s = '';
      for (var j = 0; j < ts.length; j++) s += ts[j].textContent;
      out.push(s);
    }
    return out;
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    var s = m[1], n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseSheet(xml, shared, maxRows) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var rows = doc.getElementsByTagName('row');
    var aoa = [];
    for (var i = 0; i < rows.length; i++) {
      if (maxRows && i >= maxRows) break;
      var cells = rows[i].getElementsByTagName('c');
      var arr = [];
      for (var j = 0; j < cells.length; j++) {
        var c = cells[j];
        var ref = c.getAttribute('r');
        var ci = colIndex(ref);
        if (ci < 0) ci = arr.length;
        var t = c.getAttribute('t');
        var vNode = c.getElementsByTagName('v')[0];
        var val = '';
        if (t === 's') {
          var idx = vNode ? parseInt(vNode.textContent, 10) : -1;
          val = shared[idx] != null ? shared[idx] : '';
        } else if (t === 'inlineStr') {
          var isNode = c.getElementsByTagName('is')[0];
          val = isNode ? isNode.textContent : '';
        } else if (t === 'str') {
          val = vNode ? vNode.textContent : '';
        } else if (t === 'b') {
          val = vNode && vNode.textContent === '1' ? 'TRUE' : 'FALSE';
        } else {
          if (vNode && vNode.textContent !== '') {
            var num = parseFloat(vNode.textContent);
            val = isFinite(num) ? num : vNode.textContent;
          }
        }
        arr[ci] = val;
      }
      for (var k = 0; k < arr.length; k++) if (arr[k] == null) arr[k] = '';
      aoa.push(arr);
    }
    return aoa;
  }

  async function read(arrayBuffer, opts) {
    opts = opts || {};
    var dv = new DataView(arrayBuffer);
    var entries = readEntries(dv);

    var shared = [];
    var ssEntry = entries['xl/sharedStrings.xml'];
    if (ssEntry) shared = parseSharedStrings(textOf(await readData(dv, ssEntry)));

    var sheetNames = [];
    var wbEntry = entries['xl/workbook.xml'];
    if (wbEntry) {
      var wbDoc = new DOMParser().parseFromString(textOf(await readData(dv, wbEntry)), 'application/xml');
      var sh = wbDoc.getElementsByTagName('sheet');
      for (var i = 0; i < sh.length; i++) sheetNames.push(sh[i].getAttribute('name') || ('Sheet' + (i + 1)));
    }

    var target = opts.sheetName;
    var order = [];
    Object.keys(entries).forEach(function (n) {
      var m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(n);
      if (m) order.push({ name: n, idx: parseInt(m[1], 10) });
    });
    order.sort(function (a, b) { return a.idx - b.idx; });
    if (!order.length) throw new Error('xlsx 中没有工作表');
    var pick = order[0];
    if (target && sheetNames.length) {
      var i2 = sheetNames.indexOf(target);
      if (i2 >= 0 && order[i2]) pick = order[i2];
    }
    var aoa = parseSheet(textOf(await readData(dv, entries[pick.name])), shared, 20000);
    return {
      sheets: sheetNames.length ? sheetNames : ['Sheet1'],
      name: sheetNames.length ? (sheetNames[order.indexOf(pick)] || sheetNames[0]) : 'Sheet1',
      aoa: aoa
    };
  }

  root.XLSXLite = { read: read };
})(window);
