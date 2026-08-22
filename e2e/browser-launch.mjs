/**
 * 无打扰浏览器启动器：Playwright 自带 Chromium + `--headless=new`（新 headless 是完整浏览器，
 * 支持 --load-extension；配合 headless:false 让 Playwright 不注入 --disable-extensions）。
 * 全程无界面、不抢焦点。HEADED=1 时改为有头模式（调试用，会弹窗）。
 * 注意：正式版 Google Chrome（137+）已移除 --load-extension，不能用于自动化。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const DIST = path.join(ROOT, 'dist')

export async function launchExtensionBrowser(profileDir) {
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: !!process.env.HEADED ? false : false, // 恒 false，无界面由 --headless=new 实现
    viewport: { width: 1280, height: 900 },
    args: [
      ...(process.env.HEADED ? [] : ['--headless=new']),
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
  return { ctx, cleanup: async () => { await ctx.close().catch(() => {}) } }
}
