import { inflateSync, deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(__dirname, '../resources/logo.png')

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function readChunks(buf) {
  const out = []
  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    out.push({ type, data: buf.subarray(off + 8, off + 8 + len) })
    off += 12 + len
  }
  return out
}

function decodePNG(buf) {
  const chunks = readChunks(buf)
  const ihdr = chunks.find((c) => c.type === 'IHDR').data
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  if (bitDepth !== 8) throw new Error(`不支持的位深: ${bitDepth}`)
  let channels
  if (colorType === 6) channels = 4
  else if (colorType === 2) channels = 3
  else throw new Error(`不支持的色彩类型: ${colorType}`)

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
  const raw = inflateSync(idat)
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filter = raw[rowStart]
    raw.copy(cur, 0, rowStart + 1, rowStart + 1 + stride)
    if (filter === 1) {
      for (let i = channels; i < stride; i++) cur[i] = (cur[i] + cur[i - channels]) & 0xff
    } else if (filter === 2) {
      for (let i = 0; i < stride; i++) cur[i] = (cur[i] + prev[i]) & 0xff
    } else if (filter === 3) {
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels] : 0
        cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 0xff
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels] : 0
        const b = prev[i]
        const c = i >= channels ? prev[i - channels] : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        cur[i] = (cur[i] + pr) & 0xff
      }
    } else if (filter !== 0) {
      throw new Error(`未知滤波类型: ${filter}`)
    }
    for (let x = 0; x < width; x++) {
      const si = x * channels
      const di = (y * width + x) * 4
      out[di] = cur[si]
      out[di + 1] = cur[si + 1]
      out[di + 2] = cur[si + 2]
      out[di + 3] = channels === 4 ? cur[si + 3] : 255
    }
    cur.copy(prev)
  }
  return { width, height, pixels: out }
}

function areaScale(pixels, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = (dy * sh) / dh
    const sy1 = ((dy + 1) * sh) / dh
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = (dx * sw) / dw
      const sx1 = ((dx + 1) * sw) / dw
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let weight = 0
      const y0 = Math.floor(sy0)
      const y1 = Math.min(Math.ceil(sy1), sh)
      const x0 = Math.floor(sx0)
      const x1 = Math.min(Math.ceil(sx1), sw)
      for (let sy = y0; sy < y1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        if (wy <= 0) continue
        for (let sx = x0; sx < x1; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0)
          if (wx <= 0) continue
          const w = wx * wy
          const si = (sy * sw + sx) * 4
          r += pixels[si] * w
          g += pixels[si + 1] * w
          b += pixels[si + 2] * w
          a += pixels[si + 3] * w
          weight += w
        }
      }
      const di = (dy * dw + dx) * 4
      if (weight > 0) {
        out[di] = Math.round(r / weight)
        out[di + 1] = Math.round(g / weight)
        out[di + 2] = Math.round(b / weight)
        out[di + 3] = Math.round(a / weight)
      }
    }
  }
  return out
}

function bilinearScale(pixels, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  const sample = (sx, sy) => {
    const x = Math.min(Math.max(sx, 0), sw - 1)
    const y = Math.min(Math.max(sy, 0), sh - 1)
    const i = (y * sw + x) * 4
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
  }
  for (let dy = 0; dy < dh; dy++) {
    const sy = ((dy + 0.5) * sh) / dh - 0.5
    const y0 = Math.floor(sy)
    const ty = sy - y0
    for (let dx = 0; dx < dw; dx++) {
      const sx = ((dx + 0.5) * sw) / dw - 0.5
      const x0 = Math.floor(sx)
      const tx = sx - x0
      const c00 = sample(x0, y0)
      const c10 = sample(x0 + 1, y0)
      const c01 = sample(x0, y0 + 1)
      const c11 = sample(x0 + 1, y0 + 1)
      const di = (dy * dw + dx) * 4
      for (let k = 0; k < 4; k++) {
        const top = c00[k] + (c10[k] - c00[k]) * tx
        const bot = c01[k] + (c11[k] - c01[k]) * tx
        out[di + k] = Math.round(top + (bot - top) * ty)
      }
    }
  }
  return out
}

const src = decodePNG(readFileSync(SOURCE))
mkdirSync(join(__dirname, '../resources'), { recursive: true })
writeFileSync(join(__dirname, '../resources/icon.png'), encodePNG(512, 512, bilinearScale(src.pixels, src.width, src.height, 512, 512)))
writeFileSync(join(__dirname, '../resources/tray.png'), encodePNG(32, 32, areaScale(src.pixels, src.width, src.height, 32, 32)))
console.log(`icons generated from ${SOURCE}: resources/icon.png (512), resources/tray.png (32)`)
