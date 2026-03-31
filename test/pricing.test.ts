import { describe, it, expect } from "vitest";
import {
  getTierForItemCount,
  getTierForAmount,
  DEFAULT_RATE_TIERS,
  DEFAULT_TIERS,
} from "../lib/pricing";

describe("getTierForItemCount", () => {
  it("returns Small tier for 1 item", () => {
    const tier = getTierForItemCount(1);
    expect(tier.label).toBe("Small");
    expect(tier.usdCents).toBe(3000);
  });

  it("returns Small tier at boundary (50 items)", () => {
    const tier = getTierForItemCount(50);
    expect(tier.label).toBe("Small");
  });

  it("returns Medium tier for 51 items", () => {
    const tier = getTierForItemCount(51);
    expect(tier.label).toBe("Medium");
    expect(tier.usdCents).toBe(6000);
  });

  it("returns Medium tier at boundary (150 items)", () => {
    const tier = getTierForItemCount(150);
    expect(tier.label).toBe("Medium");
  });

  it("returns Large tier for 151 items", () => {
    const tier = getTierForItemCount(151);
    expect(tier.label).toBe("Large");
    expect(tier.usdCents).toBe(8000);
  });

  it("returns Large tier at boundary (500 items)", () => {
    const tier = getTierForItemCount(500);
    expect(tier.label).toBe("Large");
  });

  it("returns Major tier for 501 items (Innocent's 1500-row BOQ)", () => {
    const tier = getTierForItemCount(501);
    expect(tier.label).toBe("Major");
    expect(tier.usdCents).toBe(20000);
    expect(tier.displayUsd).toBe("$200");
  });

  it("returns Major tier for 1500 items", () => {
    const tier = getTierForItemCount(1500);
    expect(tier.label).toBe("Major");
  });

  it("has exactly 4 tiers", () => {
    expect(DEFAULT_RATE_TIERS).toHaveLength(4);
  });

  it("last tier has null maxItems (unbounded)", () => {
    const last = DEFAULT_RATE_TIERS[DEFAULT_RATE_TIERS.length - 1];
    expect(last.maxItems).toBeNull();
  });
});

describe("getTierForAmount (generate BOQ tiers)", () => {
  it("returns Starter for 0 ZMW", () => {
    expect(getTierForAmount(0).label).toBe("Starter");
  });

  it("returns Major for large ZMW amount", () => {
    expect(getTierForAmount(100_000_000).label).toBe("Major");
  });
});
