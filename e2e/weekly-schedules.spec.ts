import { test, expect } from "@playwright/test";

// UI contract test: the database-backed companion script verifies generation and permissions.
test("weekly setup is discoverable, automatic and editable", async ({
  page,
}, info) => {
  let rules: Record<string, unknown>[] = [];
  const submitted: Record<string, unknown>[] = [];
  const user = {
    id: "admin",
    email: "test@example.invalid",
    displayName: "Aziza",
    role: "ADMIN",
    companyId: "company",
    companyName: "Atlas",
    timezone: "Asia/Tashkent",
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    const method = route.request().method();
    let data: unknown = [];
    if (path === "/auth/login")
      data = {
        token: "ui-test",
        user: { ...user, company: { id: "company", name: "Atlas" } },
      };
    else if (path === "/auth/me") data = user;
    else if (path === "/meta")
      data = { departments: [], locations: [{ id: "office", name: "Office" }] };
    else if (path === "/employees")
      data = [
        {
          id: "employee",
          name: "Madina",
          status: "ACTIVE",
          jobTitle: "Designer",
        },
      ];
    else if (path.startsWith("/work-schedules")) {
      if (method === "GET") data = rules;
      else if (method === "DELETE") {
        rules = rules.map((r) => ({ ...r, active: false }));
        data = { active: false };
      } else {
        const body = route.request().postDataJSON();
        submitted.push(body);
        rules = [
          {
            ...body,
            id: "rule",
            scopeName: "Everyone",
            autoPublish: true,
            generatedUntil: "2026-11-30",
          },
        ];
        data = { id: "rule", created: 60, preserved: 0 };
      }
    } else if (path === "/dashboard")
      data = { activeEmployees: 1, weeklyAttendance: [] };
    else if (path === "/workforce-summary") data = {};
    await route.fulfill({ json: { data } });
  });
  await page.goto("/#schedule");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Weekly schedules are the default view of the Schedule workspace.
  await expect(
    page.getByRole("tab", { name: "Weekly schedules" }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Set weekly schedule", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Who works this schedule?")).toHaveValue(
    "ALL",
  );
  await expect(dialog.getByLabel("Start time", { exact: true })).toHaveValue(
    "09:00",
  );
  await expect(dialog.getByLabel("End time", { exact: true })).toHaveValue(
    "18:00",
  );
  await expect(dialog.locator("button[aria-pressed=true]")).toHaveCount(5);
  await page.screenshot({
    path: info.outputPath("weekly-form.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save & activate" }).click();
  await expect(
    page.getByText("Repeats automatically", { exact: true }),
  ).toBeVisible();
  expect(submitted[0]).toMatchObject({
    scope: "ALL",
    scopeId: null,
    weekdays: [1, 2, 3, 4, 5],
    startsAt: "09:00",
    endsAt: "18:00",
    effectiveUntil: null,
  });
  await page.screenshot({
    path: info.outputPath("weekly-saved.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Edit schedule: Weekly schedules" })
    .click();
  await dialog.getByLabel("End time", { exact: true }).fill("17:00");
  await dialog.getByRole("button", { name: "Save & activate" }).click();
  await expect(page.getByText("09:00–17:00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause: Weekly schedules" }).click();
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
