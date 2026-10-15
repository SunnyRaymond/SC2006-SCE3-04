import { describe, expect, it } from 'vitest';
import { GET as health } from '../src/app/api/health/route';
import { POST as app } from '../src/app/api/app/route';

describe('application API boundary', () => {
  it('requires an authenticated bearer token before parsing an action', async () => {
    const response = await app(new Request('http://localhost/api/app', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Sign in to continue.' });
  });

  it('authenticates before evaluating the declared request size', async () => {
    const response = await app(new Request('http://localhost/api/app', {
      method: 'POST', headers: { 'content-length': '1048577' }, body: '{}',
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('exposes a minimal public health response without cacheable headers', async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });
});
