import { expect, test } from "@playwright/test";

test("password recovery is reachable and preserves account privacy", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send reset link" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByRole("button", { name: /Sign in/ })).toBeVisible();
});

test("manager can navigate every operational workspace and switch language", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("admin@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(
    page.getByRole("heading", { name: /Good afternoon/ }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/overview$/);
  const initialMenu = page.getByRole("button", { name: "Open menu" });
  if (await initialMenu.isVisible()) await initialMenu.click();
  await page
    .locator("aside")
    .getByRole("button", { name: "Payroll", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/payroll$/);
  await expect(
    page.getByRole("heading", { name: "Payroll", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(workspaceSwitcher).toHaveValue("Overview");
  for (const [menuName, headingName] of [
    ["Attendance", "Attendance"],
    ["Work schedule", "Work schedule"],
    ["Live locations", "Live locations"],
    ["Leave requests", "Leave requests"],
    ["Employees", "Employees"],
    ["Payroll", "Payroll"],
    ["Settings", "Settings"],
  ]) {
    const menu = page.getByRole("button", { name: "Open menu" });
    if (await menu.isVisible()) await menu.click();
    await page
      .locator("aside")
      .getByRole("button", { name: new RegExp(`^${menuName}`) })
      .first()
      .click();
    await expect(pageErrors).toEqual([]);
    await expect(
      page.getByRole("heading", { name: headingName, exact: true }),
    ).toBeVisible();
  }
  await expect(page.locator(".location-map.leaflet-container")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use my location" }),
  ).toBeVisible();
  await page.getByRole("main").getByLabel("Language").selectOption("uz");
  await expect(
    page.getByRole("heading", { name: "Sozlamalar", exact: true }),
  ).toBeVisible();
});

test("employee can open all self-service workspaces", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("employee@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  const tabs = page.locator(".portal-tabs button");
  await expect(tabs).toHaveCount(4);
  for (const index of [1, 2, 3]) {
    await tabs.nth(index).click();
    await expect(pageErrors).toEqual([]);
  }
  await expect(
    page.getByRole("heading", { name: "Request history" }),
  ).toBeVisible();
});

test("admin workspaces do not collide or overflow on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByLabel("Email address").fill("admin@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.locator(".content-shell").waitFor();

  for (const slug of [
    "overview",
    "attendance",
    "schedule",
    "live-locations",
    "leave",
    "people",
    "payroll",
    "advanced",
    "settings",
  ]) {
    await page.goto(`/#/${slug}`);
    await page.locator(".content-shell").waitFor();
    const layout = await page.evaluate(() => {
      const content = document
        .querySelector(".content-shell")!
        .getBoundingClientRect();
      const navigation = document
        .querySelector(".mobile-navigation")!
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        collision:
          Math.min(content.bottom, navigation.bottom) -
          Math.max(content.top, navigation.top),
      };
    });
    expect(layout.overflow, `${slug} horizontal overflow`).toBeLessThanOrEqual(
      0,
    );
    expect(
      layout.collision,
      `${slug} navigation collision`,
    ).toBeLessThanOrEqual(0);
  }
});

test("advanced workforce controls are reachable", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("admin@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(
    page.getByRole("heading", { name: /Good afternoon/ }),
  ).toBeVisible();
  // Former "Tools & reports" workspace now lives inside the pages it belongs to.
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("aside")
    .getByRole("button", { name: "Reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scheduled reports" }),
  ).toBeVisible();
  await expect(page.getByLabel("Send automatically")).toBeVisible();

  if (await menu.isVisible()) await menu.click();
  await page
    .locator("aside")
    .getByRole("button", { name: "Payroll", exact: true })
    .click();
  await page.getByRole("tab", { name: "Pay rules & holidays" }).click();
  await expect(
    page.getByRole("heading", { name: "Payroll rules", exact: true }),
  ).toBeVisible();

  if (await menu.isVisible()) await menu.click();
  await page
    .locator("aside")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Register device", exact: true }),
  ).toBeVisible();
});

test("dashboard action controls open their complete workflows", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("admin@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();

  const globalSearch = page.getByPlaceholder(
    "Search people, roles, or locations",
  );
  if (await globalSearch.isVisible()) {
    await page.keyboard.press("Control+K");
    await expect(globalSearch).toBeFocused();
    await globalSearch.fill("Aziza");
    await globalSearch.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Employees", exact: true }),
    ).toBeVisible();
    await globalSearch.fill("");
    await page
      .locator("aside.sidebar")
      .getByRole("button", { name: /Today/ })
      .first()
      .click();
  }

  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(
    page.getByRole("heading", { name: "Add a team member" }),
  ).toBeVisible();
  await page.locator(".people-modal .icon-button").click();

  const menu = page.locator(".mobile-menu");
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("aside.sidebar")
    .getByRole("button", { name: /Today/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Currently working/ }).click();
  await expect(
    page.getByRole("heading", { name: "Attendance", exact: true }),
  ).toBeVisible();
});

test("Uzbek locale covers manager dashboard and attendance details", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("admin@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.getByLabel("Language").selectOption("uz");

  await expect(
    page.getByText("Hozir ishlamoqda", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Ochiq muammolar", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Jonli davomat", { exact: true })).toBeVisible();

  const menu = page.locator(".mobile-menu");
  if (await menu.isVisible()) await menu.click();
  await page
    .locator("aside.sidebar")
    .getByRole("button", { name: /Davomat/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Davomat", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Barcha yozuvlar" }),
  ).toBeVisible();
  const firstRecord = page
    .locator(".attendance-workspace-table tbody tr.clickable-row")
    .first();
  if (await firstRecord.isVisible()) {
    await firstRecord.click();
    await expect(
      page.getByText("Davomat yozuvi", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Vaqt hisob-kitobi", { exact: true }),
    ).toBeVisible();
  }
});

test("Uzbek locale covers employee self-service navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("employee@atlas.local");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.getByLabel("Language").selectOption("uz");

  await expect(page.getByRole("button", { name: "Bugun" })).toBeVisible();
  await page.getByRole("button", { name: "So‘rovlar" }).click();
  await expect(
    page.getByRole("heading", { name: "So‘rovlar tarixi" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hisob xavfsizligi" }),
  ).toBeVisible();
});
