// 演示辅助工具。粘贴后只定义函数；手动调用才会发出请求。
// 仅在本机 PlugPlan SG 的演示账号中使用；不包含账号、密钥或密码。
(() => {
  window.pp?.restore?.();
  const originalFetch = window.fetch.bind(window);
  const restore = () => { window.fetch = originalFetch; };
  async function api(action, payload = {}) {
    const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
    const session = key ? JSON.parse(localStorage.getItem(key) || 'null') : null;
    if (!session?.access_token) throw new Error('请先在当前窗口登录 PlugPlan SG。');
    const response = await originalFetch('/api/app', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ...payload, action }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error || 'Request failed'}`);
    return body;
  }
  async function seedPair(category, label) {
    const stamp = Date.now();
    const rows = [];
    for (const suffix of ['A', 'B']) {
      const response = await api('report.create', {
        stationId: 'DEMO-FAST', stationName: 'Demo Fast Charge',
        connectorId: `DEMO-${label}-${stamp}-${suffix}`, category,
        note: `2026-10-29 ${label} ${suffix}: synthetic Demo Fixture connector, no real-world issue.`,
      });
      rows.push({ label: suffix, id: response.report.id, shortId: response.report.id.slice(0, 8), status: response.report.status, duplicate: !!response.duplicate });
    }
    console.table(rows);
    return rows;
  }
  window.pp = {
    api, restore,
    seedMerge: () => seedPair('ACCESS_PROBLEM', 'MERGE'),
    seedSupports: () => seedPair('SUSPECTED_FAULTY_CONNECTOR', 'SUPPORT'),
    // 仅模拟下一次指定业务请求的界面失败，不是服务端 provider/数据库故障。
    failNext(action) {
      restore();
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === 'string' ? input : input.url;
        let body;
        try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
        const url = new URL(rawUrl, location.href);
        if (url.origin === location.origin && url.pathname === '/api/app' && body?.action === action) {
          restore();
          return Response.json({ error: '受控演示：该请求未发送到服务器。请重试。' }, { status: 503 });
        }
        return originalFetch(input, init);
      };
      console.log(`下一次 ${action} 界面请求将返回受控 503；命中后自动恢复。`);
    },
    // 限流专用新 Driver 调用；恰好尝试六次，第一条新建、随后重复也计数。
    async rateDemo() {
      const connectorId = `DEMO-RATE-${Date.now()}`;
      const rows = [];
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          const response = await api('report.create', {
            stationId: 'DEMO-FAST', stationName: 'Demo Fast Charge', connectorId,
            category: 'BLOCKED_BAY', note: '2026-10-29 rate-limit demonstration only; no real-world issue.',
          });
          rows.push({ attempt, result: response.duplicate ? '200 duplicate' : '200 created' });
        } catch (error) { rows.push({ attempt, result: error.message }); }
      }
      console.table(rows);
      return rows;
    },
  };
  console.log('pp 已就绪：api / seedMerge / seedSupports / failNext / restore / rateDemo。尚未创建数据。');
})();
