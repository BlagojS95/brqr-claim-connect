// Automated WCAG 2.1 AA check (fix 58). Run with `npm run test:a11y`.
//
// Public pages are always checked. Signed-in pages are checked only when the
// credentials come from the shell, never from a file:
//   A11Y_EMAIL / A11Y_PASSWORD              a client login
//   A11Y_ADMIN_EMAIL / A11Y_ADMIN_PASSWORD  an agency_admin login (optional)
//
// The check only reads pages; it never submits a form other than sign-in.
// A page fails on any "serious" or "critical" violation; moderate and minor
// ones are printed in the summary but don't fail the run.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);
const UUID_PATH =
  /^\/(claims|policies)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageResult {
  label: string;
  blocking: number;
  other: number;
  lines: string[];
}

const results: PageResult[] = [];

/** Waits for the page to settle: no "Loading…" text and no pending requests. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page
    .waitForFunction(() => !/Loading…|Loading\.\.\./.test(document.body.innerText), undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  // Let enter animations (dialogs, tabs, toasts) finish before measuring colours.
  await page.waitForTimeout(400);
}

async function audit(page: Page, label: string) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const lines: string[] = [];
  let blocking = 0;
  for (const v of violations) {
    const isBlocking = BLOCKING.has(v.impact ?? "");
    if (isBlocking) blocking += 1;
    lines.push(`  [${v.impact ?? "?"}] ${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    for (const node of v.nodes.slice(0, 5)) {
      lines.push(`      ${node.target.join(" ")}`);
      if (node.failureSummary) {
        const first = node.failureSummary.split("\n").slice(1, 2).join(" ").trim();
        if (first) lines.push(`        ${first}`);
      }
    }
  }
  const result = { label, blocking, other: violations.length - blocking, lines };
  results.push(result);
  console.log(
    `${blocking ? "FAIL" : "ok  "} ${label}: ${blocking} serious/critical, ${result.other} other`,
  );
  for (const line of lines) console.log(line);
  expect.soft(blocking, `${label} has serious/critical accessibility violations`).toBe(0);
}

async function visit(page: Page, path: string, label = path) {
  await page.goto(path);
  await audit(page, label);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** First link on the current page that goes to a claim or policy detail page. */
async function firstDetailLink(page: Page, kind: "claims" | "policies") {
  await settle(page);
  const hrefs = await page.$$eval("a[href]", (links) =>
    links.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
  );
  return hrefs.find((h) => UUID_PATH.test(h) && h.startsWith(`/${kind}/`)) ?? null;
}

test.afterAll(() => {
  if (!results.length) return;
  const failing = results.filter((r) => r.blocking > 0);
  console.log("\n=== Accessibility summary ===");
  for (const r of results) {
    console.log(
      `${r.blocking ? "FAIL" : "ok  "} ${r.label} (${r.blocking} serious/critical, ${r.other} other)`,
    );
  }
  console.log(`${results.length - failing.length}/${results.length} pages pass.\n`);
});

test.describe("public pages", () => {
  test("login and an unknown shared link", async ({ page }, info) => {
    const p = info.project.name;
    await visit(page, "/login", `[${p}] /login`);
    await visit(page, "/shared/not-a-real-token", `[${p}] /shared/<bad token>`);
  });
});

const clientEmail = process.env.A11Y_EMAIL;
const clientPassword = process.env.A11Y_PASSWORD;

test.describe("client pages", () => {
  test.skip(!clientEmail || !clientPassword, "Set A11Y_EMAIL and A11Y_PASSWORD to check these");

  test("every client page", async ({ page }, info) => {
    const p = info.project.name;
    await signIn(page, clientEmail!, clientPassword!);

    for (const path of [
      "/home",
      "/claims/new",
      "/claims/notice",
      "/policies",
      "/insights",
      "/settings",
    ]) {
      await visit(page, path, `[${p}] ${path}`);
    }

    await visit(page, "/claims", `[${p}] /claims`);
    const claim = await firstDetailLink(page, "claims");
    if (claim) await visit(page, claim, `[${p}] claim detail`);
    else console.log(`skip [${p}] claim detail: no claim link on /claims`);

    await page.goto("/policies");
    const policy = await firstDetailLink(page, "policies");
    if (policy) await visit(page, policy, `[${p}] policy detail`);
    else console.log(`skip [${p}] policy detail: no policy link on /policies`);

    await page.goto("/reports");
    await settle(page);
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    for (let i = 0; i < count; i += 1) {
      const name = ((await tabs.nth(i).textContent()) ?? `tab ${i + 1}`).trim();
      await tabs.nth(i).click();
      await audit(page, `[${p}] /reports - ${name}`);
    }
    if (count === 0) await audit(page, `[${p}] /reports`);
  });
});

const adminEmail = process.env.A11Y_ADMIN_EMAIL;
const adminPassword = process.env.A11Y_ADMIN_PASSWORD;

test.describe("agency admin pages", () => {
  test.skip(
    !adminEmail || !adminPassword,
    "Set A11Y_ADMIN_EMAIL and A11Y_ADMIN_PASSWORD to check these",
  );

  test("every admin page", async ({ page }, info) => {
    const p = info.project.name;
    await signIn(page, adminEmail!, adminPassword!);
    for (const path of ["/admin", "/admin/queue", "/admin/import"]) {
      await visit(page, path, `[${p}] ${path}`);
    }
    await visit(page, "/claims", `[${p}] /claims (admin)`);
    const claim = await firstDetailLink(page, "claims");
    if (claim) await visit(page, claim, `[${p}] claim detail (admin)`);
  });
});
