import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  auth: vi.fn(async () => null), signOut: vi.fn(async () => undefined),
  loadProfile: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: fixture.auth, signOut: fixture.signOut }));
vi.mock("@/lib/config/server-env", () => ({ getConfigurationStatus: () => ({ authentication: { ready: true } }) }));
vi.mock("@/lib/profiles/profile-service", () => ({ loadProfile: fixture.loadProfile }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));

import { signOutAction } from "@/lib/auth/actions";
import { AppNavigation } from "@/components/navigation/app-navigation";
import { requireActor } from "@/lib/auth/actor";

describe("shared Auth.js sign-out entry", () => {
  it("delegates to existing Auth.js signOut with the public destination", async () => {
    await signOutAction();
    expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith({ redirectTo: "/" });
  });
  it("exposes a Hebrew submit button outside the collapsed tools menu", () => {
    const tree = AppNavigation({ currentPath: "/dashboard" });
    const top = tree.props.children[0];
    const form = top.props.children[2];
    expect(form.type).toBe("form");
    expect(form.props.action).toBe(signOutAction);
    const html = renderToStaticMarkup(<AppNavigation currentPath="/dashboard" />);
    expect(html).toContain('type="submit"');
    expect(html.indexOf("התנתקות")).toBeLessThan(html.indexOf("<details"));
  });
  it("rejects protected page requests and server actors when Auth.js reports no session", async () => {
    // Unit boundary after session invalidation, not a real deployed logout claim.
    const pages = await Promise.all([
      import("@/app/dashboard/page"), import("@/app/forecasts/page"),
      import("@/app/financial-data/page"), import("@/app/goals/page"),
    ]);
    for (const page of pages) await expect(page.default()).rejects.toThrow("REDIRECT:/sign-in");
    expect(fixture.loadProfile).not.toHaveBeenCalled();
    await expect(requireActor()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
