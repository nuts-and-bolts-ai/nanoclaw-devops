import { describe, it, expect } from 'vitest';
import { buildSessionKey, parseSessionKey } from './session-key.js';

describe('session key helpers', () => {
  describe('buildSessionKey', () => {
    it('returns chatJid::threadTs for threaded sessions', () => {
      expect(buildSessionKey('slack:C123', '1234567890.123456'))
        .toBe('slack:C123::1234567890.123456');
    });

    it('returns chatJid alone when threadTs is undefined', () => {
      expect(buildSessionKey('slack:C123', undefined)).toBe('slack:C123');
    });

    it('returns chatJid alone for non-Slack channels', () => {
      expect(buildSessionKey('12345@g.us', undefined)).toBe('12345@g.us');
    });
  });

  describe('parseSessionKey', () => {
    it('parses threaded session key', () => {
      const result = parseSessionKey('slack:C123::1234567890.123456');
      expect(result).toEqual({
        chatJid: 'slack:C123',
        threadTs: '1234567890.123456',
      });
    });

    it('parses non-threaded session key', () => {
      const result = parseSessionKey('slack:C123');
      expect(result).toEqual({
        chatJid: 'slack:C123',
        threadTs: undefined,
      });
    });

    it('parses non-Slack JIDs', () => {
      const result = parseSessionKey('12345@g.us');
      expect(result).toEqual({
        chatJid: '12345@g.us',
        threadTs: undefined,
      });
    });

    it('roundtrips with buildSessionKey', () => {
      const key = buildSessionKey('slack:C123', '1234.5678');
      const parsed = parseSessionKey(key);
      expect(parsed.chatJid).toBe('slack:C123');
      expect(parsed.threadTs).toBe('1234.5678');
    });
  });
});
