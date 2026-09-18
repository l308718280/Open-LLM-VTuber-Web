const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SseDecoder } = require('../../node_modules/.tmp/harness-tests/sse.js');
const bytes = (text) => new TextEncoder().encode(text);

// Synthetic protocol text only: no network, user content, devices or credentials.
test('UTF-8 survives every byte boundary, CRLF, comments and multiline data', () => {
  const input = bytes('\uFEFF: comment\r\nevent: text-delta\r\ndata: {"delta":\r\ndata: "测试"}\r\n\r\nevent: done\ndata: {}\n\n');
  for (let split = 0; split <= input.length; split += 1) {
    const parser = new SseDecoder();
    const frames = [];
    parser.push(input.slice(0, split), (frame) => { frames.push(frame); });
    parser.push(input.slice(split), (frame) => { frames.push(frame); });
    parser.finish();
    assert.deepEqual(frames, [
      { event: 'text-delta', data: '{"delta":\n"测试"}' },
      { event: 'done', data: '{}' },
    ]);
  }
});

test('single-byte chunks, bare CR, default event and empty data', () => {
  const parser = new SseDecoder();
  const frames = [];
  for (const byte of bytes('data: 测试\r\rdata:\r\r')) {
    parser.push(Uint8Array.of(byte), (frame) => { frames.push(frame); });
  }
  assert.deepEqual(frames, [{ event: 'message', data: '测试' }, { event: 'message', data: '' }]);
});

test('bounded complete frames, incomplete lines, invalid UTF-8 and EOF fragments', () => {
  const parser = new SseDecoder(16);
  assert.throws(() => parser.push(bytes('data: ' + 'x'.repeat(11)), () => {}), { code: 'limit' });
  assert.throws(() => new SseDecoder(16).push(bytes(':1234567\n:1234567\n\n'), () => {}), { code: 'limit' });
  assert.throws(() => new SseDecoder().push(Uint8Array.of(255, 10), () => {}), { code: 'protocol' });
  const partial = new SseDecoder();
  partial.push(bytes('data: {}\n'), () => {});
  assert.throws(() => partial.finish(), { code: 'protocol' });
  partial.clear();
  partial.finish();
});

test('callback can stop parsing immediately after terminal event', () => {
  const parser = new SseDecoder(32);
  let count = 0;
  parser.push(bytes('event: done\ndata: {}\n\n' + 'x'.repeat(100)), () => { count += 1; return false; });
  assert.equal(count, 1);
});

test('frame budget resets across complete frames in one large chunk', () => {
  const parser = new SseDecoder(10);
  let count = 0;
  parser.push(bytes('data: x\n\n'.repeat(100)), () => { count += 1; });
  assert.equal(count, 100);
});