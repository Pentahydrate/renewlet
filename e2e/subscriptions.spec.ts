import { expect, type ElementHandle, type Locator, type Page, type Response, test } from "@playwright/test";

const adminEmail = "admin-e2e@example.com";
const adminPassword = "password123";

test("setup, login, create subscriptions with empty and tagged tags", async ({ page }) => {
  const failedSubscriptionResponses: string[] = [];
  const targetConsoleWarnings: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (isTargetConsoleWarning(text)) {
      targetConsoleWarnings.push(`${message.type()}: ${text}`);
    }
  });
  page.on("response", async (response) => {
    if (!isSubscriptionWriteResponse(response) || response.ok()) return;
    const body = await response.text().catch(() => "");
    failedSubscriptionResponses.push(`${response.status()} ${body}`);
  });

  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "初始化 Renewlet" })).toBeVisible();
  await expectLabelControlGap(page.getByLabel("名称", { exact: true }), "setup name");
  await expectLabelControlGap(page.getByLabel("邮箱", { exact: true }), "setup email");
  await expectLabelControlGap(page.getByLabel("密码", { exact: true }), "setup password");
  await page.getByLabel("名称", { exact: true }).fill("Admin");
  await page.getByLabel("邮箱", { exact: true }).fill(adminEmail);
  await page.getByLabel("密码", { exact: true }).fill("12");
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page.getByText("密码至少需要 8 位")).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await expectLabelControlGap(page.getByLabel("邮箱", { exact: true }), "login email");
  await expectLabelControlGap(page.getByLabel("密码", { exact: true }), "login password");
  await page.getByLabel("邮箱", { exact: true }).fill(adminEmail);
  await page.getByLabel("密码", { exact: true }).fill(adminPassword);
  const loginResponsePromise = page.waitForResponse((response) => isAuthWithPasswordResponse(response));
  await page.getByRole("button", { name: "登录" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok(), await loginResponse.text()).toBe(true);
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/subscriptions");
  await expect(page.getByRole("heading", { name: "订阅列表" })).toBeVisible();

  await page.getByRole("button", { name: /添加第一个订阅|添加订阅/ }).first().click();
  await fillSubscriptionDialog(page, {
    name: "Aws",
    price: "15",
    currencyLabel: "美元 ($)",
    tags: "",
  });
  await saveSubscription(page);
  await expect(page.getByText("Aws")).toBeVisible();

  await page.getByRole("button", { name: "添加订阅" }).click();
  await fillSubscriptionDialog(page, {
    name: "Tagged Cloud",
    price: "20",
    currencyLabel: "美元 ($)",
    tags: "工作、云服务",
  });
  await saveSubscription(page);
  await expect(page.getByText("Tagged Cloud")).toBeVisible();
  const desktopTagFilter = page.getByTestId("desktop-tag-filter");
  await expect(desktopTagFilter.getByRole("button", { name: "标签" })).toBeVisible();
  await expect(page.getByText("标签:")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "工作" })).toHaveCount(0);
  await desktopTagFilter.getByRole("button", { name: "标签" }).click();
  await page.getByPlaceholder("搜索标签...").fill("工");
  await page.getByRole("button", { name: "工作" }).click();
  await expect(desktopTagFilter.getByRole("button", { name: "标签(1)" })).toBeVisible();
  await expect(page.getByTestId("desktop-selected-tags")).toBeVisible();
  await expect(page.getByText("Tagged Cloud")).toBeVisible();
  await expect(page.getByText("Aws")).toBeHidden();
  await page.getByRole("button", { name: "清空标签" }).click();
  await expect(desktopTagFilter.getByRole("button", { name: "标签" })).toBeVisible();
  await expect(page.getByText("Aws")).toBeVisible();
  await page.keyboard.press("Escape");

  const desktopViewport = page.viewportSize();
  await openSubscriptionEditDialog(page, "Tagged Cloud");
  const desktopEditDialog = page.getByRole("dialog", { name: "编辑订阅" });
  await expect(desktopEditDialog).toBeVisible();
  const desktopTagInput = desktopEditDialog.getByLabel("标签", { exact: true });
  await desktopTagInput.fill("Writing、test、Docs、Research");
  await desktopTagInput.click();
  await expectEmptyTagCursorStaysInline(page, desktopEditDialog);
  await page.keyboard.press("Escape");
  await desktopEditDialog.getByRole("button", { name: "取消" }).click();
  await expect(desktopEditDialog).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await openSubscriptionEditDialog(page, "Tagged Cloud");
  const editDialog = page.getByRole("dialog", { name: "编辑订阅" });
  await expect(editDialog).toBeVisible();
  const editTagInput = editDialog.getByLabel("标签", { exact: true });
  await editTagInput.fill("测试、研发、财务、运营、设计、增长");
  await editTagInput.click();
  await page.keyboard.type("lfsdfsdfsdf");
  await expectTagInputPopoverLayout(page, editDialog);
  if (process.env.RENEWLET_E2E_SCREENSHOTS === "1") {
    await page.screenshot({ path: "test-results/tag-popover-layout.png" });
  }
  await page.keyboard.press("Escape");
  await editDialog.getByRole("button", { name: "取消" }).click();
  await expect(editDialog).toBeHidden();

  const mobileSortTagRow = page.getByTestId("mobile-sort-tag-row");
  await expect(mobileSortTagRow).toBeVisible();
  const mobileSortControl = mobileSortTagRow.getByRole("combobox", { name: "排序" });
  const mobileTagButton = mobileSortTagRow.getByRole("button", { name: "标签" });
  await expect(page.getByTestId("mobile-selected-tags")).toHaveCount(0);
  const [mobileSortBox, mobileTagBox] = await Promise.all([
    getRequiredLocatorBoundingBox(mobileSortControl, "mobile sort filter"),
    getRequiredLocatorBoundingBox(mobileTagButton, "mobile tag filter"),
  ]);
  expect(Math.abs(mobileSortBox.y - mobileTagBox.y), "mobile sort and tag controls should share a row").toBeLessThan(8);
  expect(mobileTagBox.x, "mobile tag button should sit to the right of sort").toBeGreaterThan(
    mobileSortBox.x + mobileSortBox.width - 1,
  );
  await mobileTagButton.click();
  const tagDrawer = page.getByRole("dialog", { name: "筛选标签" });
  await expect(tagDrawer).toBeVisible();
  await tagDrawer.getByPlaceholder("搜索标签...").fill("云");
  await tagDrawer.getByRole("button", { name: "云服务" }).click();
  await tagDrawer.getByRole("button", { name: "确定" }).click();
  await expect(tagDrawer).toBeHidden();
  await expect(page.getByTestId("mobile-selected-tags")).toBeVisible();
  await expect(page.getByText("Tagged Cloud")).toBeVisible();
  await expect(page.getByText("Aws")).toBeHidden();
  const mobileTaggedCard = page
    .getByRole("heading", { name: "Tagged Cloud" })
    .locator("xpath=ancestor::div[contains(@class, 'group')][1]");
  await expect(mobileTaggedCard).toBeInViewport();
  await mobileSortTagRow.getByRole("button", { name: "标签(1)" }).click();
  await expect(tagDrawer).toBeVisible();
  await tagDrawer.getByRole("button", { name: "清空标签" }).click();
  await expect(tagDrawer).toBeHidden();
  await expect(page.getByTestId("mobile-selected-tags")).toHaveCount(0);
  await expect(page.getByText("Aws")).toBeVisible();

  await page.getByRole("button", { name: "添加订阅" }).click();
  const emptyTagDialog = page.getByRole("dialog", { name: "添加新订阅" });
  await expect(emptyTagDialog).toBeVisible();
  await emptyTagDialog.getByLabel("标签", { exact: true }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await emptyTagDialog.getByRole("button", { name: "取消" }).click();
  await expect(emptyTagDialog).toBeHidden();
  if (desktopViewport) {
    await page.setViewportSize(desktopViewport);
  }

  const restoredDesktopTagFilter = page.getByTestId("desktop-tag-filter");
  await restoredDesktopTagFilter.getByRole("button", { name: "标签" }).click();
  await page.getByPlaceholder("搜索标签...").fill("工作");
  await page.getByRole("button", { name: "工作" }).click();
  await expect(page.getByText("Tagged Cloud")).toBeVisible();
  await expect(page.getByText("Aws")).toBeHidden();
  await page.getByRole("button", { name: "清除筛选" }).click();

  await page.reload();
  await expect(page.getByText("Aws")).toBeVisible();
  await expect(page.getByText("Tagged Cloud")).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "系统配置" })).toBeVisible();
  await expectLabelControlGap(page.getByLabel("月度预算金额", { exact: true }), "settings monthly budget");
  await expectLabelControlGap(page.getByLabel("第三方 API 测试号码", { exact: true }), "settings test phone");
  await page.getByLabel("在通知中一起发送已过期订阅", { exact: true }).click();
  const saveChangesButton = page.getByRole("button", { name: "保存更改" });
  await expect(saveChangesButton).toBeVisible();
  const saveChangesButtonElement = await saveChangesButton.elementHandle();
  if (!saveChangesButtonElement) {
    throw new Error("Missing save button element before opening floating layers");
  }
  const settingsContent = page.locator("main > div").first();
  const settingsBeforeSelect = await captureLayoutSnapshot(page, {
    content: settingsContent,
    saveButton: saveChangesButtonElement,
  });
  expectRootScrollContainer(settingsBeforeSelect);

  const languageSelect = page.getByRole("combobox", { name: "语言" });
  await languageSelect.click();
  await expect(page.getByRole("option", { name: "English" })).toBeVisible();
  const settingsWithSelectOpen = await captureLayoutSnapshot(page, {
    content: settingsContent,
    saveButton: saveChangesButtonElement,
  });
  expect(settingsWithSelectOpen.bodyScrollLocked).toBe(true);
  expectRootScrollContainer(settingsWithSelectOpen);
  expectStableLayout(settingsBeforeSelect, settingsWithSelectOpen, "settings language select");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: "English" })).toBeHidden();

  await page.getByRole("button", { name: "修改密码" }).click();
  const passwordDialog = page.getByRole("dialog", { name: "修改密码" });
  await expect(passwordDialog).toBeVisible();
  const settingsWithPasswordDialogOpen = await captureLayoutSnapshot(page, {
    content: settingsContent,
    saveButton: saveChangesButtonElement,
  });
  expect(settingsWithPasswordDialogOpen.bodyScrollLocked).toBe(true);
  expectRootScrollContainer(settingsWithPasswordDialogOpen);
  expectStableLayout(settingsBeforeSelect, settingsWithPasswordDialogOpen, "settings password dialog");
  await expectLabelControlGap(passwordDialog.getByLabel("当前密码", { exact: true }), "settings current password");
  await expectLabelControlGap(passwordDialog.getByLabel("新密码", { exact: true }), "settings new password");
  await expectLabelControlGap(passwordDialog.getByLabel("确认密码", { exact: true }), "settings confirm password");

  await page.keyboard.press("Escape");
  await expect(passwordDialog).toBeHidden();
  await page.getByRole("button", { name: "放弃更改" }).click();
  await expect(saveChangesButton).toBeHidden();

  await page.evaluate(() => {
    const target = window as Window & { __renewletNavigationMarker?: string };
    target.__renewletNavigationMarker = "settings-manage-users-client-navigation";
  });
  await page.getByRole("link", { name: "管理用户" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await expect.poll(async () => {
    return page.evaluate(() => {
      const target = window as Window & { __renewletNavigationMarker?: string };
      return target.__renewletNavigationMarker;
    });
  }).toBe("settings-manage-users-client-navigation");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "系统配置" })).toBeVisible();

  await languageSelect.click();
  await expect(page.getByRole("option", { name: "English" })).toBeVisible();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "System settings" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Language" })).toContainText("English");
  const saveEnglishChangesButton = page.getByRole("button", { name: "Save changes" });
  await saveEnglishChangesButton.click();
  await expect(saveEnglishChangesButton).toBeHidden();

  await page.goto("/subscriptions");
  await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
  const subscriptionsContent = page.locator("main").first();
  const subscriptionsBeforeDropdown = await captureLayoutSnapshot(page, {
    content: subscriptionsContent,
  });
  const exportMenuButton = subscriptionsContent.getByRole("button").first();
  await exportMenuButton.click();
  await expect(page.getByRole("menuitem", { name: "Export JSON" })).toBeVisible();
  const subscriptionsWithDropdownOpen = await captureLayoutSnapshot(page, {
    content: subscriptionsContent,
  });
  expect(subscriptionsWithDropdownOpen.bodyScrollLocked).toBe(false);
  expectRootScrollContainer(subscriptionsWithDropdownOpen);
  expectStableLayout(subscriptionsBeforeDropdown, subscriptionsWithDropdownOpen, "subscriptions export dropdown");

  expect(failedSubscriptionResponses).toEqual([]);
  expect(targetConsoleWarnings).toEqual([]);
});

function isSubscriptionWriteResponse(response: Response): boolean {
  return response.url().includes("/api/collections/subscriptions/records") &&
    ["POST", "PATCH"].includes(response.request().method());
}

function isAuthWithPasswordResponse(response: Response): boolean {
  return response.url().includes("/api/collections/users/auth-with-password") &&
    response.request().method() === "POST";
}

function isTargetConsoleWarning(text: string): boolean {
  // 这些 warning 来自第三方/浏览器策略差异，不代表本应用布局或数据流回归。
  return text.includes("Missing `Description`") ||
    (text.includes("frame-ancestors") && text.includes("ignored")) ||
    (text.includes("fonts.googleapis.com") && text.includes("Content Security Policy"));
}

async function openSubscriptionEditDialog(page: Page, subscriptionName: string) {
  const card = page
    .getByRole("heading", { name: subscriptionName })
    .locator("xpath=ancestor::div[contains(@class, 'group')][1]");
  await card.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑" }).click();
}

async function expectTagInputPopoverLayout(page: Page, dialog: Locator) {
  const tagInput = dialog.getByLabel("标签", { exact: true });
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();

  const popoverContent = listbox.locator("xpath=..");
  await expect(popoverContent).toHaveAttribute("data-side", "top");

  const [inputBox, popoverBox] = await Promise.all([
    getRequiredLocatorBoundingBox(tagInput, "subscription tag input"),
    getRequiredLocatorBoundingBox(popoverContent, "subscription tag popover"),
  ]);
  expect(
    popoverBox.y + popoverBox.height,
    "subscription tag popover should render above the input when there is room",
  ).toBeLessThanOrEqual(inputBox.y);

  const wrapState = await tagInput.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error("Tag control is not an input");
    }

    // 布局断言必须在浏览器上下文读真实 DOMRect；Playwright locator 层拿不到 chip/sizer 的相对位置。
    const container = element.closest<HTMLElement>('[data-slot="subscription-tag-field"]');
    const sizer = element.closest<HTMLElement>('[data-slot="subscription-tag-input-sizer"]');
    if (!container || !sizer) {
      throw new Error("Tag input is missing its chip field or autosize wrapper");
    }

    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除标签"]'))
      .map((button) => button.parentElement)
      .filter((chip): chip is HTMLElement => chip instanceof HTMLElement);
    const lastChip = chips.at(-1);
    if (!lastChip) {
      throw new Error("Expected tag chips before checking input wrapping");
    }

    const containerRect = container.getBoundingClientRect();
    const chipRect = lastChip.getBoundingClientRect();
    const sizerRect = sizer.getBoundingClientRect();
    const inputRect = element.getBoundingClientRect();
    return {
      freeSpaceAfterLastChip: Math.round(containerRect.right - chipRect.right),
      inputIsBelowLastChip: sizerRect.top - chipRect.top > 12,
      inputOverflowsField: inputRect.right > containerRect.right,
      sizerWidth: Math.round(sizerRect.width),
    };
  });

  expect(
    !wrapState.inputIsBelowLastChip && wrapState.freeSpaceAfterLastChip < wrapState.sizerWidth,
    `tag input stayed on a cramped row: ${wrapState.freeSpaceAfterLastChip}px free for ${wrapState.sizerWidth}px input`,
  ).toBe(false);
  expect(wrapState.inputOverflowsField, "tag input should stay inside the field edge").toBe(false);
}

async function expectEmptyTagCursorStaysInline(page: Page, dialog: Locator) {
  const tagInput = dialog.getByLabel("标签", { exact: true });
  await expect(page.getByRole("listbox")).toBeVisible();

  const cursorState = await tagInput.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error("Tag control is not an input");
    }

    const container = element.closest<HTMLElement>('[data-slot="subscription-tag-field"]');
    const sizer = element.closest<HTMLElement>('[data-slot="subscription-tag-input-sizer"]');
    if (!container || !sizer) {
      throw new Error("Tag input is missing its chip field or autosize wrapper");
    }

    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除标签"]'))
      .map((button) => button.parentElement)
      .filter((chip): chip is HTMLElement => chip instanceof HTMLElement);
    const lastChip = chips.at(-1);
    if (!lastChip) {
      throw new Error("Expected tag chips before checking empty cursor layout");
    }

    const containerRect = container.getBoundingClientRect();
    const chipRect = lastChip.getBoundingClientRect();
    const sizerRect = sizer.getBoundingClientRect();
    return {
      freeSpaceAfterLastChip: Math.round(containerRect.right - chipRect.right),
      cursorFitsCurrentRow: containerRect.right - chipRect.right >= sizerRect.width,
      inputIsBelowLastChip: sizerRect.top - chipRect.top > 12,
      sizerWidth: Math.round(sizerRect.width),
    };
  });

  expect(
    cursorState.inputIsBelowLastChip && cursorState.cursorFitsCurrentRow,
    `empty tag cursor wrapped with ${cursorState.freeSpaceAfterLastChip}px free for ${cursorState.sizerWidth}px cursor`,
  ).toBe(false);
}

async function getRequiredElementBoundingBox(element: ElementHandle<HTMLElement | SVGElement>, label: string) {
  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`Missing bounding box for ${label}`);
  }
  return box;
}

async function getRequiredLocatorBoundingBox(locator: Locator, label: string) {
  const element = await locator.elementHandle();
  if (!element) {
    throw new Error(`Missing element for ${label}`);
  }
  return getRequiredElementBoundingBox(element, label);
}

async function expectLabelControlGap(control: Locator, label: string) {
  await control.scrollIntoViewIfNeeded();
  const gap = await control.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Control is not an HTMLElement");
    }

    if (!element.id) {
      throw new Error("Control has no id for label lookup");
    }

    const labelElement = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`);
    if (!labelElement) {
      throw new Error(`Missing label for #${element.id}`);
    }

    const labelRect = labelElement.getBoundingClientRect();
    const visualControl =
      element instanceof HTMLInputElement
        ? element.closest<HTMLElement>('[data-slot="subscription-tag-field"]') ?? element
        : element;
    const controlRect = visualControl.getBoundingClientRect();
    return Math.round((controlRect.top - labelRect.bottom) * 100) / 100;
  });

  expect(gap, `${label}: label/control gap`).toBeGreaterThanOrEqual(7);
  expect(gap, `${label}: label/control gap`).toBeLessThanOrEqual(9);
}

interface LayoutSnapshot {
  header: { x: number };
  content: { x: number };
  saveButton?: { x: number };
  rootOverflowY: string;
  rootScrollbarGutter: string;
  bodyScrollLocked: boolean;
}

async function captureLayoutSnapshot(
  page: Page,
  targets: {
    content: Locator;
    saveButton?: ElementHandle<HTMLElement | SVGElement>;
  },
): Promise<LayoutSnapshot> {
  const [header, content, saveButton, scrollState] = await Promise.all([
    getRequiredLocatorBoundingBox(page.locator("header > div").first(), "header layout target"),
    getRequiredLocatorBoundingBox(targets.content, "content layout target"),
    targets.saveButton ? getRequiredElementBoundingBox(targets.saveButton, "save button layout target") : undefined,
    page.evaluate(() => {
      const root = document.getElementById("root");
      if (!root) {
        throw new Error("Missing #root scroll container");
      }

      // 应用把滚动放在 #root 而不是 body；这个快照用来防止弹窗/菜单打开时误锁 body 造成横向跳动。
      const rootStyle = window.getComputedStyle(root);
      return {
        rootOverflowY: rootStyle.overflowY,
        rootScrollbarGutter: rootStyle.scrollbarGutter,
        bodyScrollLocked: document.body.hasAttribute("data-scroll-locked"),
      };
    }),
  ]);

  return {
    header,
    content,
    saveButton,
    ...scrollState,
  };
}

function expectRootScrollContainer(snapshot: LayoutSnapshot) {
  expect(snapshot.rootOverflowY).toBe("auto");
  expect(snapshot.rootScrollbarGutter).toContain("stable");
}

function expectStableLayout(before: LayoutSnapshot, after: LayoutSnapshot, label: string) {
  // 小于 1px 的差异视为浏览器子像素舍入，不作为布局回归处理。
  expect(Math.abs(after.header.x - before.header.x), `${label}: header x offset`).toBeLessThan(1);
  expect(Math.abs(after.content.x - before.content.x), `${label}: main content x offset`).toBeLessThan(1);

  if (before.saveButton && after.saveButton) {
    expect(Math.abs(after.saveButton.x - before.saveButton.x), `${label}: fixed save button x offset`).toBeLessThan(1);
  }
}

async function fillSubscriptionDialog(
  page: Page,
  values: {
    name: string;
    price: string;
    currencyLabel: string;
    tags: string;
  },
) {
  const dialog = page.getByRole("dialog", { name: "添加新订阅" });
  await expect(dialog).toBeVisible();
  await expectLabelControlGap(dialog.getByLabel("服务名称", { exact: true }), "subscription name");
  await expectLabelControlGap(dialog.getByLabel("价格", { exact: true }), "subscription price");
  await expectLabelControlGap(dialog.getByLabel("开始日期", { exact: true }), "subscription start date");
  await expectLabelControlGap(dialog.getByLabel("到期日期", { exact: true }), "subscription next billing date");
  await expectLabelControlGap(dialog.getByLabel("标签", { exact: true }), "subscription tags");
  await dialog.getByLabel("服务名称").fill(values.name);
  await dialog.getByLabel("价格").fill(values.price);
  await selectCurrency(page, dialog, values.currencyLabel);
  await chooseStartDate(page, dialog);
  if (values.tags) {
    await dialog.getByLabel("标签").fill(values.tags);
  }
}

async function selectCurrency(page: Page, dialog: Locator, label: string) {
  const currencySelect = dialog.getByRole("combobox", { name: "选择货币" });
  if ((await currencySelect.textContent())?.includes(label)) return;
  await currencySelect.click();
  await page.getByPlaceholder("搜索货币、代码或符号...").fill(label);
  await page.getByText(label, { exact: true }).click();
}

async function chooseStartDate(page: Page, dialog: Locator) {
  const startDateButton = dialog.getByRole("button", { name: /选择日期/ }).first();
  if ((await startDateButton.count()) === 0) return;

  await startDateButton.click();

  const calendar = page.getByRole("grid").first();
  await expect(calendar).toBeVisible();

  const today = calendar.getByRole("button", { name: /Today/ }).first();
  const selectedDayButton =
    (await today.count()) > 0
      ? today
      : calendar.locator("button:not([disabled])").filter({ hasText: /^\d+$/ }).first();

  await selectedDayButton.click();
  await page.mouse.move(0, 0);
  await expectSelectedCalendarDayStyles(selectedDayButton, "subscription start date");

  await expect(dialog.getByRole("button", { name: /\d{4}年\d{1,2}月\d{1,2}日/ }).first()).toBeVisible();

  const expandedDateButton = dialog.locator('button[aria-expanded="true"]').first();
  if (await expandedDateButton.count()) {
    await expandedDateButton.click();
  }

  await expect(calendar).toBeHidden();
}

async function expectSelectedCalendarDayStyles(dayButton: Locator, label: string) {
  await expect(dayButton, `${label}: selected button class`).toHaveClass(/(^|\s)bg-primary(\s|$)/);
  await expect(dayButton, `${label}: selected button text class`).toHaveClass(/(^|\s)text-primary-foreground(\s|$)/);

  const styles = await dayButton.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Selected day is not an HTMLElement");
    }

    const dayCell = element.parentElement;
    if (!(dayCell instanceof HTMLElement)) {
      throw new Error("Missing selected day cell");
    }

    return {
      buttonBackground: getComputedStyle(element).backgroundColor,
      buttonClassName: element.className,
      cellBackground: getComputedStyle(dayCell).backgroundColor,
      cellClassName: dayCell.className,
    };
  });

  expect(styles.buttonBackground, `${label}: selected button has visible background`).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.buttonBackground, `${label}: button/cell backgrounds are separate`).not.toBe(styles.cellBackground);
  expect(styles.buttonClassName, `${label}: selected button hover class`).not.toContain("hover:bg-accent");
  expect(styles.cellBackground, `${label}: selected day cell background`).toBe("rgba(0, 0, 0, 0)");
  expect(styles.cellClassName, `${label}: selected day cell class`).not.toContain("bg-accent");
}

async function saveSubscription(page: Page) {
  const dialog = page.getByRole("dialog", { name: "添加新订阅" });
  const responsePromise = page.waitForResponse((response) => isSubscriptionWriteResponse(response));
  await dialog.getByRole("button", { name: "添加订阅" }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`subscription create failed: ${response.status()} ${await response.text()}`);
  }
  await expect(dialog).toBeHidden();
}
