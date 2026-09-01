import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCents, fromCents, notionalCents, floorQty, ceilQty, roundQty } from "./money.ts";

describe("money", () => {
  describe("toCents", () => {
    it("converts dollars to cents", () => {
      assert.equal(toCents(1), 100);
      assert.equal(toCents(10.5), 1050);
      assert.equal(toCents(0.01), 1);
    });

    it("rounds correctly on 19.999", () => {
      assert.equal(toCents(19.999), 2000);
    });

    it("rounds correctly on 0.005", () => {
      assert.equal(toCents(0.005), 1);
    });
  });

  describe("fromCents", () => {
    it("converts cents to dollars", () => {
      assert.equal(fromCents(100), 1);
      assert.equal(fromCents(1050), 10.5);
      assert.equal(fromCents(1), 0.01);
    });
  });

  describe("round-trip toCents/fromCents", () => {
    it("preserves values", () => {
      const dollars = 123.45;
      const cents = toCents(dollars);
      const result = fromCents(cents);
      assert.equal(result, dollars);
    });
  });

  describe("notionalCents", () => {
    it("calculates notional with integer qty and priceCents", () => {
      assert.equal(notionalCents(10, 150), 1500);
      assert.equal(notionalCents(1, 100), 100);
    });

    it("handles fractional qty", () => {
      assert.equal(notionalCents(0.5, 100), 50);
      assert.equal(notionalCents(2.5, 200), 500);
    });

    it("handles negative qty (sells)", () => {
      assert.equal(notionalCents(-10, 150), -1500);
      assert.equal(notionalCents(-0.5, 100), -50);
    });

    it("rounds correctly", () => {
      assert.equal(notionalCents(0.333, 100), 33);
      assert.equal(notionalCents(0.667, 100), 67);
    });
  });

  describe("floorQty", () => {
    it("passes through exact 3-decimal values", () => {
      assert.equal(floorQty(2.5), 2.5);
    });

    it("floors values below MIN_QTY to 0", () => {
      assert.equal(floorQty(0.0004), 0);
    });

    it("corrects float noise for clean decimals", () => {
      assert.equal(floorQty(0.1), 0.1);
    });
  });

  describe("ceilQty", () => {
    it("rounds up fractional values", () => {
      assert.equal(ceilQty(2.5001), 2.501);
    });
  });

  describe("roundQty", () => {
    it("rounds to nearest (tests nearest-even)", () => {
      assert.equal(roundQty(2.5005), 2.501);
    });
  });
});
