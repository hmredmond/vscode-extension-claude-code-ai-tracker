import { CLAUDE_PRICING, getPricingForModel, calculateCost } from '../pricing';

describe('Pricing Utilities', () => {
  describe('CLAUDE_PRICING', () => {
    it('should contain pricing for all Claude models', () => {
      expect(CLAUDE_PRICING['claude-haiku']).toBeDefined();
      expect(CLAUDE_PRICING['claude-sonnet']).toBeDefined();
      expect(CLAUDE_PRICING['claude-opus']).toBeDefined();
    });

    it('should have correct structure for each model', () => {
      const model = CLAUDE_PRICING['claude-haiku'];
      expect(model).toHaveProperty('inputPerMillion');
      expect(model).toHaveProperty('outputPerMillion');
      expect(model).toHaveProperty('cacheReadPerMillion');
      expect(model).toHaveProperty('cacheWritePerMillion');
    });

    it('should have positive values for all pricing', () => {
      Object.values(CLAUDE_PRICING).forEach((pricing) => {
        expect(pricing.inputPerMillion).toBeGreaterThan(0);
        expect(pricing.outputPerMillion).toBeGreaterThan(0);
        expect(pricing.cacheReadPerMillion).toBeGreaterThan(0);
        expect(pricing.cacheWritePerMillion).toBeGreaterThan(0);
      });
    });
  });

  describe('getPricingForModel', () => {
    it('should return exact match for known model', () => {
      const pricing = getPricingForModel('claude-haiku');
      expect(pricing).toEqual(CLAUDE_PRICING['claude-haiku']);
    });

    it('should return Haiku pricing for haiku variant', () => {
      const pricing = getPricingForModel('claude-3-5-haiku');
      expect(pricing.inputPerMillion).toBe(1);
      expect(pricing.outputPerMillion).toBe(5);
    });

    it('should return Sonnet pricing for sonnet variant', () => {
      const pricing = getPricingForModel('claude-3-5-sonnet');
      expect(pricing.inputPerMillion).toBe(3);
      expect(pricing.outputPerMillion).toBe(15);
    });

    it('should return Opus pricing for opus variant', () => {
      const pricing = getPricingForModel('claude-opus-4-6');
      expect(pricing.inputPerMillion).toBe(5);
      expect(pricing.outputPerMillion).toBe(25);
    });

    it('should default to Sonnet for unknown model', () => {
      const pricing = getPricingForModel('unknown-model');
      expect(pricing).toEqual(CLAUDE_PRICING['claude-sonnet-4-5-20250929']);
    });

    it('should be case-insensitive for model matching', () => {
      const pricing = getPricingForModel('CLAUDE-HAIKU');
      expect(pricing.inputPerMillion).toBe(1);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for input and output tokens', () => {
      const cost = calculateCost('claude-haiku', 1_000_000, 1_000_000);
      expect(cost).toBe(1 + 5); // $1 input + $5 output
    });

    it('should calculate zero cost for zero tokens', () => {
      const cost = calculateCost('claude-haiku', 0, 0, 0, 0);
      expect(cost).toBe(0);
    });

    it('should include cache read token cost', () => {
      const cost = calculateCost('claude-haiku', 0, 0, 1_000_000, 0);
      expect(cost).toBe(0.1); // 10% of input cost
    });

    it('should include cache write token cost', () => {
      const cost = calculateCost('claude-haiku', 0, 0, 0, 1_000_000);
      expect(cost).toBe(1.25); // 125% of input cost
    });

    it('should calculate combined cost correctly', () => {
      const cost = calculateCost(
        'claude-sonnet',
        1_000_000, // $3
        1_000_000, // $15
        1_000_000, // $0.30
        1_000_000  // $3.75
      );
      expect(cost).toBeCloseTo(22.05, 2);
    });

    it('should handle partial tokens correctly', () => {
      const cost = calculateCost('claude-haiku', 500_000, 500_000);
      expect(cost).toBeCloseTo(3, 2); // $0.5 + $2.5
    });

    it('should use Sonnet pricing for unknown model', () => {
      const knownCost = calculateCost('claude-sonnet', 1_000_000, 1_000_000);
      const unknownCost = calculateCost('unknown-model', 1_000_000, 1_000_000);
      expect(unknownCost).toBe(knownCost);
    });

    it('should be accurate for real-world token counts', () => {
      // Typical request: 5K input, 2K output
      const cost = calculateCost('claude-haiku', 5_000, 2_000);
      expect(cost).toBeCloseTo(0.015, 5); // ~$0.015
    });
  });
});
