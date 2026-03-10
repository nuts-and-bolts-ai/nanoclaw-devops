import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/test-data',
  GROUPS_DIR: '/tmp/test-groups',
}));

import { resolveThreadGroupPath, resolveThreadIpcPath } from './group-folder.js';

describe('thread-scoped path resolution', () => {
  it('resolves thread group path', () => {
    const result = resolveThreadGroupPath('cheerful', '1234567890.123456');
    expect(result).toBe('/tmp/test-groups/cheerful/threads/1234567890.123456');
  });

  it('resolves thread IPC path', () => {
    const result = resolveThreadIpcPath('cheerful', '1234567890.123456');
    expect(result).toBe('/tmp/test-data/ipc/cheerful/threads/1234567890.123456');
  });

  it('rejects invalid group folder in thread path', () => {
    expect(() => resolveThreadGroupPath('../escape', '1234.5678'))
      .toThrow();
  });

  it('rejects thread_ts with path traversal', () => {
    expect(() => resolveThreadGroupPath('cheerful', '../../../etc/passwd'))
      .toThrow();
  });
});
