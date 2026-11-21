const maxCompressed = 20 * 1024 * 1024
const maxExpanded = 100 * 1024 * 1024
const maxEntries = 5000
const endSignature = 0x06054b50
const directorySignature = 0x02014b50
const localSignature = 0x04034b50

type ArchiveError = 'ARCHIVE_TOO_LARGE' | 'INVALID_ARCHIVE'

export async function inspectZip(file: File): Promise<ArchiveError | undefined> {
  if (file.size > maxCompressed) return 'ARCHIVE_TOO_LARGE'
  if (!file.name.toLowerCase().endsWith('.zip')) return 'INVALID_ARCHIVE'
  const bytes = await file.arrayBuffer()
  const view = new DataView(bytes)

  // Read central-directory metadata only. The demo never extracts or executes files.
  const minEnd = Math.max(0, bytes.byteLength - 22 - 65535)
  let end = bytes.byteLength - 22
  for (; end >= minEnd; end--) {
    if (view.getUint32(end, true) === endSignature &&
      end + 22 + view.getUint16(end + 20, true) === bytes.byteLength) break
  }
  if (end < minEnd || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return 'INVALID_ARCHIVE'

  const entries = view.getUint16(end + 10, true)
  if (!entries || entries !== view.getUint16(end + 8, true)) return 'INVALID_ARCHIVE'
  if (entries > maxEntries) return 'ARCHIVE_TOO_LARGE'
  const start = view.getUint32(end + 16, true)
  const directoryEnd = start + view.getUint32(end + 12, true)
  if (directoryEnd !== end) return 'INVALID_ARCHIVE'

  let offset = start
  let expanded = 0
  let files = 0
  const decode = new TextDecoder()
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== directorySignature) return 'INVALID_ARCHIVE'
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const local = view.getUint32(offset + 42, true)
    const mode = (view.getUint32(offset + 38, true) >>> 16) & 0xf000
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    if (!nameLength || next > directoryEnd || flags & 1 || (method !== 0 && method !== 8) ||
      local + 30 > start || view.getUint32(local, true) !== localSignature ||
      (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)) return 'INVALID_ARCHIVE'

    const name = decode.decode(new Uint8Array(bytes, offset + 46, nameLength))
    const localNameLength = view.getUint16(local + 26, true)
    const dataOffset = local + 30 + localNameLength + view.getUint16(local + 28, true)
    if (dataOffset + compressed > start || localNameLength !== nameLength ||
      decode.decode(new Uint8Array(bytes, local + 30, localNameLength)) !== name ||
      name.startsWith('/') || name.includes('\\') || name.includes(':') || name.includes('\0') ||
      name.split('/').some(part => part === '.' || part === '..')) return 'INVALID_ARCHIVE'

    expanded += view.getUint32(offset + 24, true)
    if (expanded > maxExpanded) return 'ARCHIVE_TOO_LARGE'
    if (!name.endsWith('/') && mode !== 0x4000) files++
    offset = next
  }
  return files > 0 && offset === directoryEnd ? undefined : 'INVALID_ARCHIVE'
}
