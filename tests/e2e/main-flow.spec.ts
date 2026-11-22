import { expect, test } from "@playwright/test";

const email = `e2e-${Date.now()}@example.test`;
const password = "e2e-password-123";

test.describe.serial("main flow", () => {
  test("register, connect a provider, build agents, chat, delegate, hand off, stop, restore, sign out", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("نام").fill("کاربر آزمایشی");
    await page.getByLabel("ایمیل").fill(email);
    await page.getByLabel("رمز عبور").fill(password);
    await page.getByRole("button", { name: "ساخت حساب" }).click();
    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByText("هنوز به هیچ مدلی وصل نیستید")).toBeVisible();

    // Provider connection against the deterministic mock provider.
    await page.goto("/providers");
    await page.getByRole("button", { name: "افزودن اتصال" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("سرویس‌دهنده").selectOption("openai_compatible");
    await dialog.getByLabel("نام اتصال").fill("Mock");
    await dialog.getByLabel("آدرس پایه (Base URL)").fill("http://127.0.0.1:4011/v1");
    await dialog.getByLabel("کلید API").fill("mock-test-key");
    await dialog.getByRole("button", { name: "آزمایش اتصال" }).click();
    await expect(dialog.getByText(/اتصال برقرار است/)).toBeVisible();
    await dialog.getByRole("button", { name: "ذخیره" }).click();
    await expect(page.getByText("برقرار", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("mock-test-key")).toHaveCount(0);

    // Agents: a subagent, a specialist, and a lead allowed to use both.
    const createAgent = async (name: string, mode: "subagent" | "all" | "primary", extra?: () => Promise<void>) => {
      await page.goto("/agents/new");
      await page.getByLabel("نام", { exact: true }).fill(name);
      const modeLabel = { primary: "اصلی", subagent: "زیرعامل", all: "هر دو" }[mode];
      await page.getByRole("radio", { name: new RegExp(`^${modeLabel}`) }).click();
      await page.getByLabel("اتصال").selectOption({ label: "Mock" });
      if (extra) await extra();
      await page.getByRole("button", { name: "ساخت عامل" }).click();
      await expect(page).toHaveURL(/\/agents\/[\w-]+$/);
    };
    await createAgent("Researcher", "subagent");
    await createAgent("Specialist", "all");
    await createAgent("Lead", "primary", async () => {
      await page.getByLabel("ماشین‌حساب").check();
      await page.getByRole("region", { name: "واگذاری کار" }).getByRole("checkbox", { name: /Researcher/ }).check();
      await page.getByRole("region", { name: "سپردن گفتگو" }).getByRole("checkbox", { name: /Specialist/ }).check();
    });

    // Streaming chat with a tool call.
    await page.goto("/chat");
    await expect(page.getByRole("button", { name: /تغییر عامل: Lead/ })).toBeVisible();
    const composer = page.getByLabel("پیام خود را بنویسید…");
    await composer.fill("[calc:6*7]");
    await composer.press("Enter");
    await expect(page.getByText('Tool result: {"result":42}')).toBeVisible();
    await expect(page).toHaveURL(/\/chat\/[\w-]+$/);

    // Delegation.
    await composer.fill("[delegate] summarise the report");
    await composer.press("Enter");
    await expect(page.getByText(/Subagent answer for: summarise the report/)).toBeVisible();

    // Stop generation keeps the partial reply.
    await composer.fill("[slow] long answer");
    await composer.press("Enter");
    await expect(page.getByText("word3")).toBeVisible();
    await page.getByRole("button", { name: "توقف پاسخ" }).click();
    await expect(page.getByText("پاسخ متوقف شد")).toBeVisible();
    await expect(page.getByText("word59")).toHaveCount(0);

    // Handoff switches the active agent.
    await composer.fill("[handoff] need a specialist");
    await composer.press("Enter");
    await expect(page.getByText("I have taken over this conversation.")).toBeVisible();
    await expect(page.getByRole("button", { name: /تغییر عامل: Specialist/ })).toBeVisible();

    // Refresh restores the conversation from the database.
    await page.reload();
    await expect(page.getByText('Tool result: {"result":42}')).toBeVisible();
    await expect(page.getByText("I have taken over this conversation.")).toBeVisible();
    await expect(page.getByRole("separator", { name: /Specialist/ })).toBeVisible();

    // Sign out, then protected pages and APIs refuse access.
    await page.getByRole("button", { name: /حساب من/ }).click();
    await page.getByRole("menuitem", { name: "خروج" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/agents");
    await expect(page).toHaveURL(/\/sign-in/);
    const res = await page.request.get("/api/agents");
    expect(res.status()).toBe(401);
  });
});
