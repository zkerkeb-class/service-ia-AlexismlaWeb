const { sanitize, sanitizeFilename, isSafeInput } = require('../src/utils/sanitize');

describe('Input sanitization utilities', () => {
  describe('sanitize', () => {
    test('removes dangerous chars', () => {
      expect(sanitize('hello/../world')).toBe('helloworld');
    });

    test('removes script tags', () => {
      expect(sanitize('<script>alert("xss")</script>')).toBe('scriptalert("xss")script');
    });

    test('removes shell injection chars', () => {
      expect(sanitize('hello; rm -rf /')).toBe('hello rm -rf');
    });

    test('handles empty string', () => {
      expect(sanitize('')).toBe('');
    });

    test('handles null value', () => {
      expect(sanitize(null)).toBe('');
    });

    test('preserves safe content', () => {
      expect(sanitize('hello world')).toBe('hello world');
    });
  });

  describe('sanitizeFilename', () => {
    test('sanitizes dangerous filename', () => {
      const result = sanitizeFilename('../../../etc/passwd');
      expect(result).toMatch(/^etcpasswd_\d+\.txt$/);
    });

    test('adds timestamp to filename', () => {
      const result = sanitizeFilename('test');
      expect(result).toMatch(/^test_\d+\.txt$/);
    });

    test('preserves file extension', () => {
      const result = sanitizeFilename('image.jpg');
      expect(result).toMatch(/^image\.jpg_\d+$/);
    });

    test('returns null for empty filename', () => {
      expect(sanitizeFilename('')).toBeNull();
    });

    test('returns null for null value', () => {
      expect(sanitizeFilename(null)).toBeNull();
    });
  });

  describe('isSafeInput', () => {
    test('safe input returns true', () => {
      expect(isSafeInput('hello world')).toBe(true);
    });

    test('script tag returns false', () => {
      expect(isSafeInput('<script>alert("xss")</script>')).toBe(false);
    });

    test('javascript protocol returns false', () => {
      expect(isSafeInput('javascript:alert("xss")')).toBe(false);
    });

    test('path traversal returns false', () => {
      expect(isSafeInput('../../../etc/passwd')).toBe(false);
    });

    test('shell injection returns false', () => {
      expect(isSafeInput('hello; rm -rf /')).toBe(false);
    });

    test('empty string returns false', () => {
      expect(isSafeInput('')).toBe(false);
    });

    test('null value returns false', () => {
      expect(isSafeInput(null)).toBe(false);
    });
  });
});
