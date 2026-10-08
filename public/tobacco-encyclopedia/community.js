(() => {
  const main = document.querySelector('main');
  let active;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
  async function request(path, body, signal) {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '操作暂时无法完成，请稍后再试。');
    return result;
  }
  async function mount() {
    if (main.querySelector('.member-community')) return;
    active?.abort();
    const match = location.hash.match(/^#\/blend\/([^?]+)/);
    if (!match) return;
    let id;
    try { id = decodeURIComponent(match[1]); } catch { return; }
    const blend = window.ENCYCLOPEDIA.blends.find((entry) => entry.id === id && !entry.hidden);
    if (!blend) return;
    const controller = active = new AbortController(), signal = controller.signal;
    const section = node('section', '', 'member-community');
    section.setAttribute('aria-label', '斗友留言');
    section.append(node('h2', '斗友留言'), node('p', '交流体验，分享心得。邮箱验证后可提交，公开展示须经站方核验和审核。', 'community-note'));
    const notice = node('p', '', 'community-notice'); notice.setAttribute('role', 'status');
    const error = node('p', '', 'community-error'); error.setAttribute('role', 'alert');
    const list = node('div'), compose = node('div'); section.append(notice, error, compose, list); main.append(section);
    const params = new URLSearchParams({ blendId: blend.uid || blend.id });
    let page = 1;
    async function load() {
      const data = await request('/api/community/comments?' + params + '&page=' + page, undefined, signal);
      if (!section.isConnected) return;
      list.replaceChildren(node('p', `${data.total} 条公开留言`, 'community-note'));
      if (!data.comments.length) list.append(node('p', '还没有公开留言。', 'community-note'));
      for (const comment of data.comments) {
        const article = node('article', '', 'community-comment');
        article.append(node('strong', comment.author), node('span', new Date(comment.createdAt).toLocaleDateString('zh-CN'), 'community-date'), node('p', comment.content, 'community-content'));
        const report = node('button', '举报', 'community-secondary'); report.type = 'button';
        report.addEventListener('click', async () => {
          if (!session.user) { location.assign(loginHref()); return; }
          const reason = window.prompt('请填写举报原因（3～300 个字符）'); if (!reason) return;
          report.disabled = true;
          try { await request('/api/community/reports', { id: comment.id, reason }, signal); notice.textContent = '举报已提交，等待站方处理。'; }
          catch (cause) { if (!signal.aborted) error.textContent = cause.message; }
          finally { report.disabled = false; }
        });
        article.append(report); list.append(article);
      }
      if (data.total > 20) {
        const controls = node('div', '', 'community-actions');
        const previous = node('button', '上一页', 'community-secondary'), next = node('button', '下一页', 'community-secondary'); previous.disabled = page <= 1; next.disabled = page * 20 >= data.total;
        previous.onclick = () => { page--; load().catch((cause) => { error.textContent = cause.message; }); }; next.onclick = () => { page++; load().catch((cause) => { error.textContent = cause.message; }); };
        controls.append(previous, node('span', `第 ${page} 页`), next); list.append(controls);
      }
    }
    const loginHref = () => '/login?returnTo=' + encodeURIComponent(location.pathname + location.search + location.hash);
    let session;
    try {
      session = await request('/api/members/session', undefined, signal);
      if (!section.isConnected) return;
      if (session.user) {
        const form = node('form', '', 'community-compose');
        const label = node('label', '分享你的体验');
        const textarea = node('textarea'); textarea.required = true; textarea.minLength = 3; textarea.maxLength = 2000; textarea.name = 'content'; textarea.placeholder = '3～2000 个字符，仅支持文字留言'; label.append(textarea);
        const button = node('button', '提交留言', 'community-primary'); button.type = 'submit';
        const mine = node('a', '查看我的留言与审核结果'); mine.href = '/account/comments';
        form.append(label, button, mine);
        form.addEventListener('submit', async (event) => {
          event.preventDefault(); button.disabled = true; error.textContent = ''; notice.textContent = '';
          try { const result = await request('/api/community/comments', { blendId: blend.uid || blend.id, content: textarea.value }, signal); textarea.value = ''; notice.textContent = result.message; }
          catch (cause) { if (!signal.aborted) error.textContent = cause.message; }
          finally { button.disabled = false; }
        });
        compose.append(form);
      } else { const link = node('a', '登录 / 免费注册后留言', 'community-primary'); link.href = loginHref(); compose.append(link); }
      await load();
    } catch (cause) { if (!signal.aborted && section.isConnected) error.textContent = cause.message; }
  }
  new MutationObserver(mount).observe(main, { childList: true });
  mount();
})();
