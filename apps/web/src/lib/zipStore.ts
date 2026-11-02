const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[n] = c >>> 0
}

const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = (crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0
  }
  return (c ^ 0xffffffff) >>> 0
}

const concat = (parts: Array<Uint8Array>): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const u16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true)
}

const u32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value, true)
}

/** Zip archive using the store method (no compression). */
export function zipStore(
  files: ReadonlyArray<{ name: string; data: Uint8Array }>,
  now = new Date()
): Uint8Array {
  const encoder = new TextEncoder()
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

  const locals: Array<Uint8Array> = []
  const centrals: Array<Uint8Array> = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = new DataView(new ArrayBuffer(30))
    u32(local, 0, 0x04034b50)
    u16(local, 4, 20)
    u16(local, 6, 0)
    u16(local, 8, 0)
    u16(local, 10, time)
    u16(local, 12, date)
    u32(local, 14, crc)
    u32(local, 18, file.data.length)
    u32(local, 22, file.data.length)
    u16(local, 26, name.length)
    u16(local, 28, 0)
    locals.push(new Uint8Array(local.buffer), name, file.data)

    const central = new DataView(new ArrayBuffer(46))
    u32(central, 0, 0x02014b50)
    u16(central, 4, 20)
    u16(central, 6, 20)
    u16(central, 8, 0)
    u16(central, 10, 0)
    u16(central, 12, time)
    u16(central, 14, date)
    u32(central, 16, crc)
    u32(central, 20, file.data.length)
    u32(central, 24, file.data.length)
    u16(central, 28, name.length)
    u32(central, 42, offset)
    centrals.push(new Uint8Array(central.buffer), name)
    offset += 30 + name.length + file.data.length
  }

  const centralBytes = concat(centrals)
  const end = new DataView(new ArrayBuffer(22))
  u32(end, 0, 0x06054b50)
  u16(end, 8, files.length)
  u16(end, 10, files.length)
  u32(end, 12, centralBytes.length)
  u32(end, 16, offset)

  return concat([...locals, centralBytes, new Uint8Array(end.buffer)])
}
