import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinancyOpenBankingProvider } from "@/lib/adapters/financy/financy-open-banking-provider";
import { parseJsonPreservingNumbers } from "@/lib/adapters/financy/financy-json";
import { OpenBankingProviderError } from "@/lib/open-banking/open-banking-provider";

function response(body: string, status = 200): Response {
  return new Response(body, { headers: { "Content-Type": "application/json" }, status });
}

describe("Financy exact server-only adapter", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OPEN_FINANCE_USER_ID", "provider-user-test");
    vi.stubEnv("OPEN_FINANCE_CLIENT_ID", "provider-client-test");
    vi.stubEnv("OPEN_FINANCE_CLIENT_SECRET", "provider-secret-test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("preserves every numeric lexeme before JSON parsing", () => {
    expect(parseJsonPreservingNumbers('{"amount":90071992547409.12,"count":3,"label":"12.30","escaped":"\\\"7"}')).toEqual({
      amount: "90071992547409.12",
      count: "3",
      escaped: '"7',
      label: "12.30",
    });
  });

  it("maps mixed real response money shapes exactly and strips unknown sensitive fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response('{"accessToken":"token-one","tokenType":"Bearer","expiresIn":86400}'))
      .mockResolvedValueOnce(response('{"items":[{"id":"account-one","connectionId":"connection-one","providerId":"provider-one","accountType":"CHECKING","accountName":"Everyday","currency":"ILS","accountNumber":"never-map","ownerInfo":{"nationalId":"never-map"},"balances":[{"balanceType":"interimAvailable","balanceAmount":{"amount":90071992547409.12,"currency":"ILS"},"creditLimitIncluded":false,"referenceDate":"2026-09-03"}]}],"nextPage":"cursor-two"}'))
      .mockResolvedValueOnce(response('{"items":[{"id":"transaction-one","SK":"stable-one","accountId":"account-one","connectionId":"connection-one","providerId":"provider-one","status":"booked","type":"CHECKING","chargedAmount":{"amount":-12.34,"currency":"ILS"},"originalAmount":{"amount":"-12.34","currency":"ILS"},"bookingDate":"2026-09-02","merchantName":"Store","category":{"main":"shopping","sub":"retail"}}],"nextPage":null}'));
    const provider = new FinancyOpenBankingProvider(fetchImpl, () => 0, async () => undefined);
    const accounts = await provider.listAccountsPage();
    const transactions = await provider.listTransactionsPage();

    expect(accounts.nextCursor).toBe("cursor-two");
    expect(accounts.items[0]?.balances[0]?.amount.amountMinor).toBe(9_007_199_254_740_912n);
    expect(transactions.items[0]?.amount?.amountMinor).toBe(-1_234n);
    expect(transactions.items[0]?.status).toBe("BOOKED");
    const serialized = JSON.stringify(accounts, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    expect(serialized).not.toContain("accountNumber");
    expect(serialized).not.toContain("nationalId");
  });

  it("renews once after 401 and categorizes provider failures without response leakage", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response('{"accessToken":"old-token","tokenType":"Bearer","expiresIn":86400}'))
      .mockResolvedValueOnce(response('{"message":"secret provider detail"}', 401))
      .mockResolvedValueOnce(response('{"accessToken":"new-token","tokenType":"Bearer","expiresIn":86400}'))
      .mockResolvedValueOnce(response('{"items":[],"nextPage":null}'));
    const provider = new FinancyOpenBankingProvider(fetchImpl, () => 0, async () => undefined);
    expect(await provider.listTransactionsPage()).toEqual({ items: [], nextCursor: null });
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const failing = new FinancyOpenBankingProvider(vi.fn()
      .mockResolvedValueOnce(response('{"accessToken":"token","tokenType":"Bearer","expiresIn":86400}'))
      .mockResolvedValueOnce(response('{"type":"NOT_AVAILABLE_ON_PLAN","message":"private detail"}', 403)), () => 0, async () => undefined);
    try {
      await failing.listConnections();
      expect.fail("Expected a provider error.");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenBankingProviderError);
      expect((error as OpenBankingProviderError).category).toBe("consent");
      expect((error as Error).message).not.toContain("private detail");
    }
  });

  it("uses only the documented refresh and delete lifecycle endpoints", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response('{"accessToken":"token","tokenType":"Bearer","expiresIn":86400}'))
      .mockResolvedValueOnce(response('{"status":"accepted"}'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new FinancyOpenBankingProvider(fetchImpl, () => 0, async () => undefined);
    expect(await provider.refreshConnections()).toEqual({ costCredits: 20, status: "accepted" });
    await provider.deleteConnection("connection/one");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://api.open-finance.ai/chat/chat/connections/refresh");
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe("https://api.open-finance.ai/v2/connections/connection%2Fone");
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes("payments"))).toBe(false);
  });

  it.each(["transport", "unauthorized", "unavailable"] as const)("never retries a paid refresh after %s failure", async (failure) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response('{"accessToken":"token","tokenType":"Bearer","expiresIn":86400}'));
    if (failure === "transport") fetchImpl.mockRejectedValueOnce(new Error("private transport detail"));
    else fetchImpl.mockResolvedValueOnce(response('{"message":"private provider detail"}', failure === "unauthorized" ? 401 : 503));
    const wait = vi.fn(async () => undefined);
    const provider = new FinancyOpenBankingProvider(fetchImpl, () => 0, wait);
    await expect(provider.refreshConnections()).rejects.toBeInstanceOf(OpenBankingProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith("/connections/refresh"))).toHaveLength(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("retains bounded retries for ordinary read requests", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response('{"accessToken":"token","tokenType":"Bearer","expiresIn":86400}'))
      .mockResolvedValueOnce(response('{"message":"unavailable"}', 503))
      .mockResolvedValueOnce(response('{"items":[],"nextPage":null}'));
    const provider = new FinancyOpenBankingProvider(fetchImpl, () => 0, async () => undefined);
    expect(await provider.listTransactionsPage()).toEqual({ items: [], nextCursor: null });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
