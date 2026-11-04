import { test, expect } from "@playwright/test";

const storageKey = "outdoors-temporary-showcase-v1";
async function blockStorage(page, blocked) {
  await page.evaluate((blocked) => {
    if (blocked) {
      window.__draftRecoverySetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "outdoors-temporary-showcase-v1")
          throw new DOMException("quota", "QuotaExceededError");
        return window.__draftRecoverySetItem.call(this, key, value);
      };
    } else {
      Storage.prototype.setItem = window.__draftRecoverySetItem;
    }
  }, blocked);
}
test("Pages草稿保存失败暂停写入，首次未保存和已有版本均显式核对后继续且文字不回滚", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) requests.push(r.url());
  });
  await page.goto("?showcase=1");
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("企业名称", { exact: true })
    .fill("Pages核对恢复草稿");
  await dialog.getByLabel("上传桁架设计图").setInputFiles({
    name: "draft.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  await blockStorage(page, true);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog).toContainText("草稿操作未保存");
  const recovery = page.getByRole("region", {
    name: "草稿保存结果核对",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("联系人", { exact: true }).fill("失败后继续补正");
  await blockStorage(page, false);
  await recovery
    .getByRole("button", { name: "重新读取草稿状态", exact: true })
    .click();
  await expect(recovery).toContainText("服务器尚未找到首次创建的草稿");
  await recovery
    .getByRole("button", { name: "保留当前内容，另存新草稿", exact: true })
    .click();
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("草稿已保存");
  await dialog.getByLabel("联系人", { exact: true }).fill("第二轮继续修改");
  await blockStorage(page, true);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "重新读取草稿状态", exact: true })
    .click();
  await expect(recovery).toContainText("服务器版本：1");
  await expect(recovery).toContainText("失败后继续补正");
  await expect(dialog.getByLabel("联系人", { exact: true })).toHaveValue(
    "第二轮继续修改",
  );
  await recovery
    .getByRole("button", {
      name: "保留当前文字，采用已保存设计图",
      exact: true,
    })
    .click();
  await blockStorage(page, false);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("草稿已保存");
  const saved = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)),
    storageKey,
  );
  expect(saved.drafts).toHaveLength(1);
  expect(saved.drafts[0].version).toBe(2);
  expect(saved.drafts[0].payload.contact).toBe("第二轮继续修改");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "申请草稿", exact: true })
    .click();
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("联系人", { exact: true })).toHaveValue(
    "第二轮继续修改",
  );
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  expect(requests).toEqual([]);
});
