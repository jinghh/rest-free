import { fileURLToPath, pathToFileURL } from 'node:url'

const MOCK_ELECTRON = pathToFileURL(fileURLToPath(new URL('./test-mocks/electron.mjs', import.meta.url))).href

/**
 * ESM 解析钩子：
 * 1. 无扩展名的相对导入补全为 .ts（TS 源码用 bundler 解析，Node ESM 需要显式扩展名）
 * 2. 'electron' 重定向到 mock（npm electron 包在 Node 下不可 named import）
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: MOCK_ELECTRON, shortCircuit: true }
  }
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context)
    } catch {
      // 回退到默认解析
    }
  }
  return nextResolve(specifier, context)
}
