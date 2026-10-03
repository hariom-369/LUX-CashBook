import { describe, expect, it } from 'vitest';
import { apiPath, apiUrl } from './api';

describe('apiPath / apiUrl (server-issued links)', () => {
  it('drops the /api/v1 prefix the server already put on attachment links', () => {
    expect(apiPath('/api/v1/attachments/abc/thumbnail')).toBe('/attachments/abc/thumbnail');
    expect(apiUrl('/api/v1/attachments/abc/download')).toBe('/api/v1/attachments/abc/download');
  });

  it('leaves an ordinary API path alone', () => {
    expect(apiPath('/pdf/cash-book')).toBe('/pdf/cash-book');
    expect(apiUrl('/pdf/cash-book')).toBe('/api/v1/pdf/cash-book');
  });

  it('only removes a whole leading segment', () => {
    expect(apiPath('/api/v10/x')).toBe('/api/v10/x');
    expect(apiPath('/x/api/v1/y')).toBe('/x/api/v1/y');
    expect(apiPath('/api/v1')).toBe('/api/v1');
  });
});
