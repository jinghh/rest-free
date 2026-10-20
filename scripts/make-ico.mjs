// 将 resources/icon.png 打包为 resources/icon.ico（ICO 容器内嵌 PNG，Vista+ 支持）
// 用法: node scripts/make-ico.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const png = readFileSync(join(here, '../resources/icon.png'))

// ICONDIR: reserved(2) + type(2)=1 + count(2)
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)

// ICONDIRENTRY: width(1)=0 -> 256, height(1)=0 -> 256, colorCount(1), reserved(1), planes(2), bitCount(2), bytesInRes(4), imageOffset(4)
const dir = Buffer.alloc(16)
dir.writeUInt8(0, 0)
dir.writeUInt8(0, 1)
dir.writeUInt8(0, 2)
dir.writeUInt8(0, 3)
dir.writeUInt16LE(1, 4)
dir.writeUInt16LE(32, 6)
dir.writeUInt32LE(png.length, 8)
dir.writeUInt32LE(6 + 16, 12)

const out = join(here, '../resources/icon.ico')
writeFileSync(out, Buffer.concat([header, dir, png]))
console.log(`icon.ico generated (${png.length} bytes png embedded)`)
