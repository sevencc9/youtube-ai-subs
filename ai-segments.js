/* Strict cue coverage: the model never supplies source text or timestamps. */
(function(root) {
  function validate(rows, count) {
    if (!Array.isArray(rows) || !rows.length) throw Error('Empty segmentation');
    let next = 0;
    for (const r of rows) {
      if (!Number.isInteger(r.start) || !Number.isInteger(r.end) ||
          r.start !== next || r.end < r.start || r.end >= count ||
          typeof r.translation !== 'string' || !r.translation.trim() || r.translation.length > 8000)
        throw Error('Invalid or incomplete segmentation');
      next = r.end + 1;
    }
    if (next !== count) throw Error('Missing cues');
    return rows;
  }
  function units(cues) {
    return cues.flatMap(c => {
      const words = c.text.match(/\S+/gu) || [];
      const duration = Math.max(0, c.end - c.start);
      return words.map((text, i) => ({text, start:c.start + duration*i/words.length,
        end:c.start + duration*(i+1)/words.length}));
    });
  }
  function materialize(chunk, rows) {
    // A committed prefix deliberately excludes the unfinished last sentence.
    const covered = rows.at(-1)?.end + 1;
    if (!covered || covered > chunk.length) throw Error('Invalid committed prefix');
    validate(rows, covered);
    return rows.map(r => ({start:chunk[r.start].start,
      dur:Math.max(1,chunk[r.end].end-chunk[r.start].start),
      end:chunk[r.end].end, text:chunk.slice(r.start,r.end+1).map(c=>c.text).join(' '),
      trans:r.translation}));
  }
  // Carry the last sentence into the next window instead of cutting at a batch edge.
  function commit(rows, isLast) { return isLast ? rows : rows.slice(0,-1); }
  function boundaryIssues(rows, texts) {
    validate(rows, texts.length);
    const issues = [];
    for (let i=0; i<rows.length-1; i++) {
      const r=rows[i], last=texts[r.end];
      // Heuristic only: a stranded preposition can be grammatical. Never reject solely on this.
      if (/^(?:of|with|the|a|an|and|or|to|from|into|because|which|whose)$/i.test(last))
        issues.push('Row ' + i + ' may end with an incomplete phrase: ' + last);
    }
    return issues;
  }
  function parse(raw, count) {
    let rows;
    try { rows = JSON.parse(String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g,'')); }
    catch (_) { throw Object.assign(Error('Return a valid JSON array without commentary.'), {code:'aiJson'}); }
    try { return validate(rows,count); }
    catch (_) { throw Object.assign(Error('Cover indices 0 through ' + (count-1) + ' exactly once, in order, with nonempty translations.'), {code:'aiCoverage'}); }
  }
  async function generate(texts, request) {
    let correction = null;
    for (let attempt=0; attempt<2; attempt++) {
      // Transport/auth failures are not formatting failures: propagate without retry.
      const raw = await request(correction);
      try {
        const rows = parse(raw,texts.length);
        const issues = boundaryIssues(rows,texts);
        if (issues.length && attempt === 0) throw Object.assign(Error(issues.join('; ') + '; these are heuristic suggestions, retain a boundary if the sentence is grammatical.'), {code:'aiBoundary'});
        return rows;
      } catch (err) {
        if (attempt === 1) throw err;
        correction = {raw:String(raw || ''), reason:err.message};
      }
    }
  }
  function errorInfo(err) {
    const messages = {
      auth:'API 身份验证失败（401），请检查密钥', forbidden:'API 拒绝访问（403），请检查账号权限',
      quota:'API 余额或配额不足', limited:'API 请求受限，请稍后刷新重试',
      server:'API 服务暂时异常，请稍后重试', netfail:'API 网络连接失败或超时',
      noKey:'尚未配置 API 密钥', noModel:'尚未选择模型', noProvider:'请先选择 API 服务商',
      noPerm:'尚未授权 API 地址，请在设置页授权', badBaseUrl:'自定义 API 地址无效',
      badRequest:'API 拒绝请求，请检查模型名称和接口地址', notApi:'接口返回了网页，请检查 API 地址',
      reasoning:'模型只返回了思考内容，请使用可输出正文的模型',
      badShape:'API 响应格式不兼容', needLlm:'断句需要 LLM 模型，不能使用 DeepL',
      aiJson:'模型未返回有效 JSON（已自动纠正一次）',
      aiCoverage:'模型遗漏或重复了字幕编号（已自动纠正一次）',
      stale:'视频或配置已变化，请刷新重试', invalidInput:'字幕请求超出处理限制'
    };
    const code = err?.code || (err?.shed ? 'limited' : 'unknown');
    // Never forward raw provider text, URLs, credentials or subtitle content.
    return {code, message:messages[code] || '处理异常，请刷新后重试（' + (messages[code] ? code : 'unknown') + '）'};
  }
  root.AISegments = { validate, units, materialize, commit, boundaryIssues, parse, generate, errorInfo };
  if (typeof module !== 'undefined') module.exports = root.AISegments;
})(globalThis);
