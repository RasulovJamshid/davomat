import { expect, test } from "@playwright/test";

test("manager creates a task and employee completes it; reports export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("admin@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(
    page.getByRole("heading", { name: /Good afternoon/ }),
  ).toBeVisible();
  await page.goto("/#/tasks");
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  const title = `Workforce test ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  const people = await page
    .locator(".workforce-task-form select")
    .first()
    .locator("option")
    .allTextContents();
  expect(people.length).toBeGreaterThan(1);
  // Seeded employee account belongs to Aziza Karimova.
  await page
    .getByRole("combobox", { name: "Employee", exact: true })
    .selectOption({ label: "Aziza Karimova" });
  await page.getByLabel("Deadline (local time)").fill("2026-12-31T18:00");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Prepare attendance report");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/tasks-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.goto("/#/reports");
  await expect(
    page.getByRole("heading", { name: "Employee report" }),
  ).toBeVisible();
  await expect(
    page.locator(".workforce-report tbody tr").first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel (CSV)" }).click();
  expect((await download).suggestedFilename()).toMatch(/workforce-.*\.csv$/);
  await page.screenshot({
    path: `test-results/reports-${test.info().project.name}.png`,
    fullPage: true,
  });
  if (test.info().project.name === "chromium") {
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("aside")).toBeHidden();
    await page.screenshot({
      path: "test-results/report-print.png",
      fullPage: true,
    });
    await page.emulateMedia({ media: "screen" });
  }
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/");
  await page.getByLabel("Email address").fill("employee@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const card = page
    .locator(".workforce-task")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card.getByRole("button", { name: "Start task", exact: true }).click();
  await card
    .getByRole("button", { name: "Complete task", exact: true })
    .click();
  await expect(card.getByText("Completed", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "My working hours", exact: true })
    .click();
  await expect(page.locator(".workforce-report tbody tr")).toHaveCount(1);
  expect(errors).toEqual([]);
});
