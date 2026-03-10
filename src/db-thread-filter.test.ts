import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, storeChatMetadata, storeMessage, getMessagesSince, getNewMessages } from './db.js';

describe('thread-scoped message queries', () => {
  beforeEach(() => {
    _initTestDatabase();
    storeChatMetadata('slack:C123', '2026-03-09T00:00:00Z');
  });

  it('getMessagesSince filters by threadTs when provided', () => {
    storeMessage({
      id: 'msg1', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: 'thread A msg',
      timestamp: '2026-03-09T00:00:01Z', thread_ts: '1111.0000',
    });
    storeMessage({
      id: 'msg2', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: 'thread B msg',
      timestamp: '2026-03-09T00:00:02Z', thread_ts: '2222.0000',
    });
    storeMessage({
      id: 'msg3', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: 'top-level msg',
      timestamp: '2026-03-09T00:00:03Z',
    });

    const threadA = getMessagesSince('slack:C123', '', 'Bot', '1111.0000');
    expect(threadA).toHaveLength(1);
    expect(threadA[0].content).toBe('thread A msg');

    const threadB = getMessagesSince('slack:C123', '', 'Bot', '2222.0000');
    expect(threadB).toHaveLength(1);
    expect(threadB[0].content).toBe('thread B msg');

    // Without threadTs filter, returns all messages (backward compat)
    const all = getMessagesSince('slack:C123', '', 'Bot');
    expect(all).toHaveLength(3);
  });

  it('getNewMessages includes thread_ts in returned messages', () => {
    storeMessage({
      id: 'msg1', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: '@Bot hello',
      timestamp: '2026-03-09T00:00:01Z', thread_ts: '1111.0000',
    });

    const { messages } = getNewMessages(['slack:C123'], '', 'Bot');
    expect(messages).toHaveLength(1);
    expect(messages[0].thread_ts).toBe('1111.0000');
  });
});
