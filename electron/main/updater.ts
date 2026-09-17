import { app, net, shell } from 'electron'
import { createWriteStream, promises as fs } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'

const REPO = 'happy0717/Lemon-Light'
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASE_PAGE = `https://github.com/${REPO}/releases`
const ASSET_PREFIX = `https://github.com/${REPO}/releases/download/`
const USER_AGENT = 'LemonLight-Updater'

export interface UpdateAsset {
  name: string
  size: number
  url: string
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseName: string
  notes: string
  publishedAt: string
  pageUrl: string
  asset: UpdateAsset | null
  portable: boolean
}

export type UpdateCheckResult =
  | { ok: true; currentVersion: string; info: UpdateInfo }
  | { ok: false; currentVersion: string; message: string }

export interface UpdateProgress {
  received: number
  total: number
}

export interface UpdateActionResult {
  ok: boolean
  path?: string
  message: string
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  published_at?: string
  html_url?: string
  assets?: Array<{ name?: string; size?: number; browser_download_url?: string }>
}

function parseVersion(raw: string): number[] {
  return raw
    .replace(/^v/i, '')
    .split(/[.\-+_]/)
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0))
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
}

async function githubFetch(url: string, accept = 'application/vnd.github+json'): Promise<Response> {
  const init: RequestInit = {
    headers: { 'User-Agent': USER_AGENT, Accept: accept }
  }
  try {
    return await net.fetch(url, init)
  } catch {
    return await fetch(url, init)
  }
}

function pickAsset(assets: UpdateAsset[], portable: boolean): UpdateAsset | null {
  const exe = assets.filter((a) => /\.exe$/i.test(a.name))
  const setup = exe.find((a) => /setup|install/i.test(a.name)) ?? null
  const portableAsset = exe.find((a) => /portable/i.test(a.name)) ?? null
  return portable ? (portableAsset ?? setup) : (setup ?? portableAsset)
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  try {
    const res = await githubFetch(RELEASE_API)
    if (!res.ok) {
      const hint = res.status === 403 || res.status === 429 ? '（GitHub 限流了，过会儿再试）' : ''
      return { ok: false, currentVersion, message: `GitHub 接口返回 ${res.status}${hint}` }
    }
    const data = (await res.json()) as GitHubRelease
    const latestVersion = String(data.tag_name ?? '').replace(/^v/i, '')
    if (!latestVersion) {
      return { ok: false, currentVersion, message: '没能读到版本号，可能被限流了' }
    }

    const rawAssets = Array.isArray(data.assets) ? data.assets : []
    const assets: UpdateAsset[] = rawAssets
      .filter(
        (a): a is { name: string; size?: number; browser_download_url: string } =>
          typeof a.name === 'string' && typeof a.browser_download_url === 'string'
      )
      .map((a) => ({
        name: a.name,
        size: typeof a.size === 'number' ? a.size : 0,
        url: a.browser_download_url
      }))

    const portable = isPortableBuild()
    return {
      ok: true,
      currentVersion,
      info: {
        currentVersion,
        latestVersion,
        hasUpdate: isNewerVersion(latestVersion, currentVersion),
        releaseName: data.name ?? `v${latestVersion}`,
        notes: typeof data.body === 'string' ? data.body : '',
        publishedAt: data.published_at ?? '',
        pageUrl: data.html_url ?? RELEASE_PAGE,
        asset: pickAsset(assets, portable),
        portable
      }
    }
  } catch (err) {
    return { ok: false, currentVersion, message: (err as Error).message || '网络请求失败' }
  }
}

export async function downloadUpdate(
  url: string,
  fileName: string,
  onProgress: (progress: UpdateProgress) => void
): Promise<UpdateActionResult> {
  if (!url.startsWith(ASSET_PREFIX)) {
    return { ok: false, message: '下载地址不在预期范围内，已拒绝' }
  }
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_')
  if (!/\.exe$/i.test(safeName)) {
    return { ok: false, message: '安装包名称异常，已拒绝' }
  }

  const dir = join(app.getPath('userData'), 'updates')
  const dest = join(dir, safeName)

  try {
    await fs.mkdir(dir, { recursive: true })
    const res = await githubFetch(url, 'application/octet-stream')
    if (!res.ok) {
      const hint = res.status === 403 || res.status === 429 ? '（GitHub 限流了，过会儿再试）' : ''
      return { ok: false, message: `下载失败（HTTP ${res.status}）${hint}` }
    }

    const total = Number(res.headers.get('content-length') ?? 0)
    onProgress({ received: 0, total })

    if (!res.body) {
      const buffer = Buffer.from(await res.arrayBuffer())
      await fs.writeFile(dest, buffer)
      onProgress({ received: buffer.byteLength, total: total || buffer.byteLength })
    } else {
      const reader = res.body.getReader()
      const stream = createWriteStream(dest)
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        received += value.byteLength
        if (!stream.write(Buffer.from(value))) await once(stream, 'drain')
        onProgress({ received, total })
      }
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject)
        stream.end(() => resolve())
      })
    }

    const stat = await fs.stat(dest)
    if (stat.size === 0) return { ok: false, message: '下载结果为空，请重试' }
    const mb = (stat.size / 1048576).toFixed(1)
    return { ok: true, path: dest, message: `下载完成，共 ${mb} MB` }
  } catch (err) {
    await fs.rm(dest, { force: true }).catch(() => undefined)
    return { ok: false, message: (err as Error).message || '下载中断' }
  }
}

export async function installUpdate(filePath: string): Promise<UpdateActionResult> {
  if (!filePath || !/\.exe$/i.test(filePath)) {
    return { ok: false, message: '安装包路径异常' }
  }
  try {
    await fs.access(filePath)
  } catch {
    return { ok: false, message: '安装包不存在，请重新下载' }
  }

  if (isPortableBuild()) {
    shell.showItemInFolder(filePath)
    return {
      ok: true,
      path: filePath,
      message: '便携版无法自动覆盖：已打开所在文件夹，关闭本程序后手动替换即可'
    }
  }

  const err = await shell.openPath(filePath)
  if (err) return { ok: false, message: `无法启动安装包：${err}` }
  return { ok: true, path: filePath, message: '安装程序已启动' }
}

export async function openReleasePage(): Promise<void> {
  await shell.openExternal(RELEASE_PAGE)
}
