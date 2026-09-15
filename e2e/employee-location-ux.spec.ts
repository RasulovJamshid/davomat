import { expect, test, type Page } from "@playwright/test";

const employees = ["Aziza Karimova", "Dilshod Nazarov"].map((name, index) => ({
  id: `employee-${index}`,
  employeeNumber: `EMP-${index}`,
  name,
  phone: "+998901234567",
  email: `person${index}@example.test`,
  jobTitle: "Team member",
  accessRole: "EMPLOYEE",
  status: "ACTIVE",
  joinedOn: "2026-01-01",
  departmentId: "department-1",
  department: "Operations",
  locationId: "location-1",
  location: "Main office",
  secondaryLocations: [],
  baseSalary: 3000000,
  hourlyRate: 15000,
  accountEmail: `person${index}@example.test`,
  accountActive: true,
}));

async function prepare(page: Page, live: unknown[] = []) {
  const directory = structuredClone(employees);
  await page.addInitScript(() => {
    localStorage.setItem("atlas.accessToken", "ux-test-token");
    localStorage.setItem("atlas.locale", "en");
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    let data: unknown = [];
    if (path === "/auth/me")
      data = {
        id: "admin",
        email: "admin@example.test",
        displayName: "Manager",
        role: "ADMIN",
        companyId: "company-1",
        companyName: "Test company",
        timezone: "Asia/Tashkent",
      };
    else if (path === "/employees") data = directory;
    else if (
      path === "/employees/employee-0" &&
      route.request().method() === "PATCH"
    ) {
      Object.assign(directory[0], route.request().postDataJSON());
      data = directory[0];
    } else if (path.endsWith("/mobile-device"))
      data = {
        id: "device-1",
        platform: "ANDROID",
        deviceLabel: "Employee phone",
        lastSeenAt: new Date().toISOString(),
      };
    else if (path.endsWith("/punches"))
      data = [
        {
          id: "punch-1",
          eventType: "CLOCK_IN",
          occurredAt: new Date().toISOString(),
          source: "MOBILE",
          withinGeofence: true,
          note: null,
          hasFaceVerification: true,
        },
      ];
    else if (path === "/meta")
      data = {
        departments: [{ id: "department-1", name: "Operations" }],
        locations: [
          {
            id: "location-1",
            name: "Main office",
            latitude: 41.31,
            longitude: 69.27,
            geofenceRadiusM: 100,
          },
        ],
      };
    else if (path === "/dashboard")
      data = {
        activeEmployees: 2,
        workingToday: 1,
        lateToday: 0,
        absentToday: 1,
        approvedLeave: 0,
        openExceptions: 0,
        payrollReviews: 0,
        weeklyAttendance: [],
      };
    else if (path === "/live-locations") data = live;
    else if (path === "/attendance")
      data = employees.map((person, index) => ({
        ...person,
        role: person.jobTitle,
        employmentStatus: "ACTIVE",
        shiftStart: null,
        shiftEnd: null,
        clockIn: new Date().toISOString(),
        clockOut: index ? null : new Date().toISOString(),
        source: "MOBILE",
        withinGeofence: index ? null : true,
        clockOutWithinGeofence: index ? null : false,
        status: "ON_TIME",
      }));
    await route.fulfill({ json: { data } });
  });
}

test("employee opens as a full workspace with attendance and focused schedule", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/#/people");
  const row = page.locator(".people-table tbody tr.clickable-row").first();
  await expect(row).toContainText("Aziza Karimova");
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Aziza Karimova", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".people-drawer")).toHaveCount(0);
  await page.getByRole("button", { name: "Manage access & device" }).click();
  await expect(
    page
      .locator("section.account-provision")
      .getByText("Employee phone", { exact: false }),
  ).toBeVisible();
  await page
    .locator(".employee-section-nav")
    .getByRole("button", { name: "Attendance", exact: true })
    .click();
  await expect(
    page.locator(".employee-punch-list").getByText("Inside workplace zone"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Manage schedule", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/schedule$/);
  await expect(
    page.locator(".schedule-grid").getByText("Aziza Karimova", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".schedule-grid")
      .getByText("Dilshod Nazarov", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    page
      .locator(".schedule-grid")
      .getByText("Dilshod Nazarov", { exact: true }),
  ).toBeVisible();
});

test("live map explains setup when empty and locates a reporting employee", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/#/live-locations");
  await expect(
    page.getByRole("heading", { name: "Live locations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1. Enable tracking on a shift", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open schedule to set up" }).click();
  await expect(page).toHaveURL(/#\/schedule$/);
  await page.route("**/api/live-locations", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            shiftId: "shift-1",
            employeeId: "employee-0",
            employee: "Aziza Karimova",
            jobTitle: "Team member",
            scheduledLocation: "Main office",
            startsAt: new Date(Date.now() - 3600000).toISOString(),
            endsAt: new Date(Date.now() + 3600000).toISOString(),
            latitude: 41.31,
            longitude: 69.27,
            accuracyM: 20,
            capturedAt: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  );
  await page.goto("/#/live-locations");
  await page.getByRole("button", { name: "Locate on map" }).click();
  await expect(
    page.locator(".live-employee-list article.selected"),
  ).toContainText("Aziza Karimova");
  await page
    .getByRole("button", { name: "Open employee", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Aziza Karimova", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to people" }).click();
  await expect(
    page.getByRole("heading", { name: "Employees", exact: true }),
  ).toBeVisible();
});

test("attendance distinguishes arrival, departure and missing zone evidence", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/#/attendance");
  const rows = page.locator(".attendance-page tbody tr.clickable-row");
  await expect(rows.first()).toContainText("Inside workplace zone");
  await expect(rows.first()).toContainText("Outside workplace zone");
  await expect(
    rows.nth(1).getByText("Not verified", { exact: true }),
  ).toHaveCount(2);
  await rows.first().focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".attendance-drawer").getByText("Outside workplace zone"),
  ).toBeVisible();
});

test("employee edits stay open after saving and device load errors can be retried", async ({
  page,
}) => {
  await prepare(page);
  let deviceAttempts = 0;
  let deviceUnavailable = true;
  await page.route(
    "**/api/employees/employee-0/mobile-device",
    async (route) => {
      deviceAttempts += 1;
      if (deviceUnavailable)
        await route.fulfill({
          status: 503,
          json: { error: { message: "Device status temporarily unavailable" } },
        });
      else await route.fulfill({ json: { data: null } });
    },
  );
  await page.goto("/#/people");
  await page.locator(".people-table tbody tr.clickable-row").first().click();
  await page
    .locator(".employee-section-nav")
    .getByRole("button", { name: "Employment details", exact: true })
    .click();
  await page.getByLabel("Full name", { exact: true }).fill("Aziza Updated");
  await page.getByRole("button", { name: "Save employee changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Aziza Updated", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".profile-edit-form [role=status]")).toBeVisible();
  await page
    .locator(".employee-section-nav")
    .getByRole("button", { name: "Employee login", exact: true })
    .click();
  await expect(
    page.locator("section.account-provision [role=alert]"),
  ).toContainText("Device status temporarily unavailable");
  const previousAttempts = deviceAttempts;
  deviceUnavailable = false;
  await page
    .locator("section.account-provision")
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(
    page.locator("section.account-provision [role=alert]"),
  ).toHaveCount(0);
  await expect.poll(() => deviceAttempts).toBeGreaterThan(previousAttempts);
  await page.getByRole("button", { name: "Back to people" }).click();
  await expect(page.locator(".people-table")).toContainText("Aziza Updated");
});
