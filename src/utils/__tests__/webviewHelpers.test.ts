import { getNonce, formatDate, formatCurrency } from '../webviewHelpers';

describe('Webview Helpers', () => {
  describe('getNonce', () => {
    it('should generate a 32-character string', () => {
      const nonce = getNonce();
      expect(nonce).toHaveLength(32);
    });

    it('should only contain alphanumeric characters', () => {
      const nonce = getNonce();
      expect(/^[a-zA-Z0-9]+$/.test(nonce)).toBe(true);
    });

    it('should generate unique values', () => {
      const nonce1 = getNonce();
      const nonce2 = getNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    it('should generate multiple unique nonces', () => {
      const nonces = Array.from({ length: 100 }, () => getNonce());
      const uniqueNonces = new Set(nonces);
      expect(uniqueNonces.size).toBe(100);
    });
  });

  describe('formatDate', () => {
    it('should format timestamp to date string', () => {
      const timestamp = new Date('2026-03-05').getTime();
      const formatted = formatDate(timestamp);
      expect(formatted).toMatch(/3\/5\/2026|05\/03\/2026|2026-03-05/); // Different locales
    });

    it('should handle current date', () => {
      const now = Date.now();
      const formatted = formatDate(now);
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should be consistent for same timestamp', () => {
      const timestamp = 1709596800000; // 2026-03-05
      const formatted1 = formatDate(timestamp);
      const formatted2 = formatDate(timestamp);
      expect(formatted1).toBe(formatted2);
    });

    it('should handle epoch timestamp', () => {
      const formatted = formatDate(0);
      expect(formatted).toBeTruthy();
    });
  });

  describe('formatCurrency', () => {
    it('should format currency with dollar sign', () => {
      const formatted = formatCurrency(10.5);
      expect(formatted).toBe('$10.50');
    });

    it('should handle whole dollars', () => {
      const formatted = formatCurrency(42);
      expect(formatted).toBe('$42.00');
    });

    it('should handle zero dollars', () => {
      const formatted = formatCurrency(0);
      expect(formatted).toBe('$0.00');
    });

    it('should handle large amounts', () => {
      const formatted = formatCurrency(1000000.99);
      expect(formatted).toBe('$1000000.99');
    });

    it('should handle very small amounts', () => {
      const formatted = formatCurrency(0.01);
      expect(formatted).toBe('$0.01');
    });

    it('should round to 2 decimal places', () => {
      const formatted = formatCurrency(10.567);
      expect(formatted).toBe('$10.57');
    });

    it('should handle negative values', () => {
      const formatted = formatCurrency(-50.25);
      expect(formatted).toBe('$-50.25');
    });
  });
});
