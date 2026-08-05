import { describe, expect, it } from 'vitest';

import { publishInteractiveHtml } from '../../src/export/publishExport.js';

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('publishInteractiveHtml', () => {
  it('uploads the export to public/exports and returns the page URL', async () => {
    const calls = [];
    const fetchRef = async (url, options) => {
      calls.push({ url, options });
      return fakeResponse(201, { content: { path: 'public/exports/carton-1.html' } });
    };

    const result = await publishInteractiveHtml({
      contentBase64: 'PCFkb2N0eXBlIGh0bWw+',
      filename: 'carton-1.html',
      token: 'ghp_123',
      owner: 'shafranek-js',
      repo: 'CartonBuilder',
      fetchRef,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe('https://api.github.com/repos/shafranek-js/CartonBuilder/contents/public/exports/carton-1.html');
    expect(call.options.method).toBe('PUT');
    expect(call.options.headers.Authorization).toBe('token ghp_123');
    const body = JSON.parse(call.options.body);
    expect(body.branch).toBe('master');
    expect(body.content).toBe('PCFkb2N0eXBlIGh0bWw+');
    expect(result.pageUrl).toBe('https://shafranek-js.github.io/CartonBuilder/exports/carton-1.html');
  });

  it('throws when the GitHub API responds with an error', async () => {
    const fetchRef = async () => fakeResponse(401, { message: 'Bad credentials' });

    await expect(publishInteractiveHtml({
      contentBase64: 'YQ==',
      filename: 'carton-1.html',
      token: 'ghp_bad',
      owner: 'shafranek-js',
      repo: 'CartonBuilder',
      fetchRef,
    })).rejects.toThrow(/Bad credentials/);
  });

  it('requires a token and repository', async () => {
    await expect(publishInteractiveHtml({
      contentBase64: 'YQ==',
      filename: 'carton-1.html',
      fetchRef: async () => fakeResponse(200, {}),
    })).rejects.toThrow(/token/i);

    await expect(publishInteractiveHtml({
      contentBase64: 'YQ==',
      filename: 'carton-1.html',
      token: 'x',
      fetchRef: async () => fakeResponse(200, {}),
    })).rejects.toThrow(/repository/i);
  });
});
