import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectZip } from '../src/mocks/zip.ts'

test('ZIP inspection accepts an ordinary archive and rejects malformed and oversized files', async () => {
  const bytes = Buffer.from('UEsDBBQAAAAIALWwdF1L9CGBHQAAABsAAAAKAAAAUkVBRE1FLnR4dHOuTEotUnBPLEpJzVMoSS0uUSjOSywozsgv4QIAUEsBAhQDFAAAAAgAtbB0XUv0IYEdAAAAGwAAAAoAAAAAAAAAAAAAAIABAAAAAFJFQURNRS50eHRQSwUGAAAAAAEAAQA4AAAARQAAAAAA', 'base64')
  assert.equal(await inspectZip(new File([bytes], 'learning.zip')), undefined)
  assert.equal(await inspectZip(new File([bytes.subarray(0, 20)], 'broken.zip')), 'INVALID_ARCHIVE')
  assert.equal(await inspectZip(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.zip')), 'ARCHIVE_TOO_LARGE')
})
