const PEER_WIRE_VERSION = 1;
const PACKET_MAGIC = Object.freeze([0x66, 0x62, 0x68, 0x31]);
const MAX_CONTROL_BYTES = 96 * 1024;
const MAX_PACKET_BYTES = 32 * 1024 * 1024;
const PACKET_CHUNK_BYTES = 16 * 1024;

const TYPED_ARRAYS = Object.freeze({
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function sendPeerControl(transport, type, payload = {}) {
  let encoded;
  try {
    encoded = JSON.stringify({ wireVersion: PEER_WIRE_VERSION, type, ...payload });
  } catch {
    return false;
  }
  if (encoder.encode(encoded).byteLength > MAX_CONTROL_BYTES) return false;
  return transport.send(encoded);
}

export function sendPeerPacket(transport, kind, value) {
  let packed;
  try {
    packed = packStructured(value);
  } catch {
    return false;
  }
  if (packed.byteLength > MAX_PACKET_BYTES) return false;
  const id = randomPacketId();
  const chunks = Math.max(1, Math.ceil(packed.byteLength / PACKET_CHUNK_BYTES));
  if (!sendPeerControl(transport, 'packet', { id, kind, bytes: packed.byteLength, chunks })) return false;
  for (let offset = 0; offset < packed.byteLength; offset += PACKET_CHUNK_BYTES) {
    const chunk = packed.slice(offset, Math.min(packed.byteLength, offset + PACKET_CHUNK_BYTES));
    if (!transport.send(chunk)) return false;
  }
  return true;
}

export class PeerPacketReceiver {
  constructor({ onControl, onPacket, onPacketProgress, onError } = {}) {
    this.onControl = onControl;
    this.onPacket = onPacket;
    this.onPacketProgress = onPacketProgress;
    this.onError = onError;
    this.pending = null;
  }

  receive(raw) {
    if (typeof raw === 'string') return this.receiveControl(raw);
    const bytes = toBytes(raw);
    if (!bytes) return this.fail('unsupported peer payload');
    if (!this.pending) return this.fail('unexpected binary peer payload');
    if (bytes.byteLength < 1 || bytes.byteLength > PACKET_CHUNK_BYTES
      || this.pending.received + bytes.byteLength > this.pending.bytes
      || this.pending.parts.length >= this.pending.chunks) return this.fail('peer packet chunk is invalid');
    this.pending.parts.push(bytes.slice());
    this.pending.received += bytes.byteLength;
    this.onPacketProgress?.({ kind: this.pending.kind, received: this.pending.received, bytes: this.pending.bytes });
    if (this.pending.parts.length < this.pending.chunks) return true;
    const pending = this.pending;
    this.pending = null;
    if (pending.received !== pending.bytes) return this.fail('peer packet length mismatch');
    const joined = new Uint8Array(pending.bytes);
    let offset = 0;
    for (const part of pending.parts) {
      joined.set(part, offset);
      offset += part.byteLength;
    }
    try {
      this.onPacket?.(pending.kind, unpackStructured(joined));
      return true;
    } catch {
      return this.fail('peer packet could not be decoded');
    }
  }

  receiveControl(raw) {
    if (encoder.encode(raw).byteLength > MAX_CONTROL_BYTES) return this.fail('peer control message is too large');
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return this.fail('peer control message is invalid');
    }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.wireVersion !== PEER_WIRE_VERSION) {
      return this.fail('peer wire version mismatch');
    }
    if (message.type === 'packet') {
      if (this.pending) return this.fail('peer packet overlap');
      const valid = typeof message.id === 'string'
        && typeof message.kind === 'string'
        && Number.isSafeInteger(message.bytes)
        && message.bytes >= 8
        && message.bytes <= MAX_PACKET_BYTES
        && Number.isSafeInteger(message.chunks)
        && message.chunks === Math.ceil(message.bytes / PACKET_CHUNK_BYTES);
      if (!valid) return this.fail('peer packet header is invalid');
      this.pending = {
        id: message.id,
        kind: message.kind,
        bytes: message.bytes,
        chunks: message.chunks,
        received: 0,
        parts: []
      };
      this.onPacketProgress?.({ kind: message.kind, received: 0, bytes: message.bytes });
      return true;
    }
    this.onControl?.(message);
    return true;
  }

  reset() {
    this.pending = null;
  }

  fail(message) {
    this.reset();
    this.onError?.(message);
    return false;
  }
}

export function packStructured(value) {
  const buffers = [];
  const visit = (item, depth = 0) => {
    if (depth > 24) throw new Error('structured packet is too deep');
    if (ArrayBuffer.isView(item) && !(item instanceof DataView)) {
      const type = item.constructor.name;
      if (!TYPED_ARRAYS[type]) throw new Error('unsupported typed array');
      const bytes = new Uint8Array(item.buffer, item.byteOffset, item.byteLength).slice();
      const index = buffers.length;
      buffers.push({ type, length: item.length, bytes });
      return { __fbTypedArray: index };
    }
    if (item instanceof ArrayBuffer) {
      const index = buffers.length;
      const bytes = new Uint8Array(item).slice();
      buffers.push({ type: 'ArrayBuffer', length: bytes.byteLength, bytes });
      return { __fbTypedArray: index };
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry, depth + 1));
    if (item && typeof item === 'object') {
      const copy = {};
      for (const [key, entry] of Object.entries(item)) copy[key] = visit(entry, depth + 1);
      return copy;
    }
    return item;
  };

  const root = visit(value);
  const header = encoder.encode(JSON.stringify({
    root,
    buffers: buffers.map(({ type, length, bytes }) => ({ type, length, byteLength: bytes.byteLength }))
  }));
  const bodyBytes = buffers.reduce((total, buffer) => total + buffer.bytes.byteLength, 0);
  const output = new Uint8Array(8 + header.byteLength + bodyBytes);
  output.set(PACKET_MAGIC, 0);
  new DataView(output.buffer).setUint32(4, header.byteLength, true);
  output.set(header, 8);
  let offset = 8 + header.byteLength;
  for (const buffer of buffers) {
    output.set(buffer.bytes, offset);
    offset += buffer.bytes.byteLength;
  }
  return output;
}

export function unpackStructured(input) {
  const bytes = toBytes(input);
  if (!bytes || bytes.byteLength < 8 || bytes.byteLength > MAX_PACKET_BYTES) throw new Error('structured packet length is invalid');
  if (!PACKET_MAGIC.every((value, index) => bytes[index] === value)) throw new Error('structured packet magic is invalid');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (headerLength < 2 || 8 + headerLength > bytes.byteLength) throw new Error('structured packet header is invalid');
  const header = JSON.parse(decoder.decode(bytes.subarray(8, 8 + headerLength)));
  if (!header || !Array.isArray(header.buffers)) throw new Error('structured packet table is invalid');
  let offset = 8 + headerLength;
  const restoredBuffers = header.buffers.map((descriptor) => {
    if (!descriptor || !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0 || offset + descriptor.byteLength > bytes.byteLength) {
      throw new Error('structured packet buffer is invalid');
    }
    const copy = bytes.slice(offset, offset + descriptor.byteLength);
    offset += descriptor.byteLength;
    if (descriptor.type === 'ArrayBuffer') return copy.buffer;
    const Constructor = TYPED_ARRAYS[descriptor.type];
    if (!Constructor || descriptor.byteLength !== descriptor.length * Constructor.BYTES_PER_ELEMENT) {
      throw new Error('structured packet typed array is invalid');
    }
    return new Constructor(copy.buffer);
  });
  if (offset !== bytes.byteLength) throw new Error('structured packet has trailing data');

  const restore = (item, depth = 0) => {
    if (depth > 24) throw new Error('structured packet is too deep');
    if (Array.isArray(item)) return item.map((entry) => restore(entry, depth + 1));
    if (item && typeof item === 'object') {
      if (Object.keys(item).length === 1 && Number.isSafeInteger(item.__fbTypedArray)) {
        const restored = restoredBuffers[item.__fbTypedArray];
        if (restored === undefined) throw new Error('structured packet reference is invalid');
        return restored;
      }
      const copy = {};
      for (const [key, entry] of Object.entries(item)) copy[key] = restore(entry, depth + 1);
      return copy;
    }
    return item;
  };
  return restore(header.root);
}

function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function randomPacketId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const values = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(values);
  return `${Date.now().toString(36)}_${values[0].toString(36)}${values[1].toString(36)}`;
}
