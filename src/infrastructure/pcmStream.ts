export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bits: number;
  floating: boolean;
}

const wavHeaderLimit = 64 * 1024;

function decodeError(message: string): never {
  throw new Error(`音频解码失败 · ${message}`);
}

function concat(first: Uint8Array, second: Uint8Array) {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function tag(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function validateFormat(format: PcmFormat) {
  if (
    !Number.isInteger(format.channels) ||
    format.channels < 1 ||
    format.channels > 8 ||
    !Number.isInteger(format.sampleRate) ||
    format.sampleRate < 8000 ||
    format.sampleRate > 192000 ||
    (format.floating
      ? format.bits !== 32
      : ![8, 16, 24, 32].includes(format.bits))
  )
    decodeError("采样率、声道或采样格式无效");
}

/** A single PCM stream, optionally preceded by one RIFF/WAVE header. */
export class PcmStream {
  private pending = new Uint8Array(0);
  private format: PcmFormat | undefined;
  private remaining = Infinity;
  private headerOffset = 12;
  private wavFormat: PcmFormat | undefined;

  constructor(raw?: { sampleRate: number; channels: number }) {
    if (raw) {
      this.format = { ...raw, bits: 16, floating: false };
      validateFormat(this.format);
    }
  }

  private readHeader(bytes: Uint8Array): number | undefined {
    if (bytes.length < 12) return;
    if (tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") {
      decodeError(
        "缺少 WAV 文件头；若服务发送裸 PCM，请在连接中选择 PCM16 并配置采样率",
      );
    }
    const data = view(bytes);
    while (this.headerOffset + 8 <= bytes.length) {
      const offset = this.headerOffset;
      const kind = tag(bytes, offset);
      const size = data.getUint32(offset + 4, true);
      if (kind === "data") {
        if (!this.wavFormat) decodeError("WAV 缺少 fmt 分块");
        this.format = this.wavFormat;
        this.remaining = size === 0 || size === 0xffffffff ? Infinity : size;
        return offset + 8;
      }
      const next = offset + 8 + size + (size % 2);
      if (next > wavHeaderLimit) decodeError("WAV 文件头过大");
      if (bytes.length < next) return;
      if (kind === "fmt ") {
        if (size < 16) decodeError("WAV fmt 分块不完整");
        const code = data.getUint16(offset + 8, true);
        const encoding =
          code === 0xfffe && size >= 40
            ? data.getUint16(offset + 32, true)
            : code;
        if (encoding !== 1 && encoding !== 3)
          decodeError("WAV 使用了不支持的编码");
        this.wavFormat = {
          channels: data.getUint16(offset + 10, true),
          sampleRate: data.getUint32(offset + 12, true),
          bits: data.getUint16(offset + 22, true),
          floating: encoding === 3,
        };
        validateFormat(this.wavFormat);
        if (
          data.getUint16(offset + 20, true) !==
          (this.wavFormat.channels * this.wavFormat.bits) / 8
        ) {
          decodeError("WAV 帧对齐无效");
        }
      }
      this.headerOffset = next;
    }
  }

  push(
    chunk: Uint8Array,
  ): { sampleRate: number; channels: Float32Array[] } | undefined {
    let bytes = concat(this.pending, chunk);
    this.pending = new Uint8Array(0);
    if (!this.format) {
      const offset = this.readHeader(bytes);
      if (offset === undefined) {
        if (bytes.length > wavHeaderLimit) decodeError("WAV 文件头过大");
        this.pending = bytes;
        return;
      }
      bytes = bytes.subarray(offset);
    }
    const format = this.format!;
    const sampleSize = format.bits / 8;
    const frameSize = sampleSize * format.channels;
    const available = Math.min(this.remaining, bytes.length);
    const frames = Math.floor(available / frameSize);
    const consumed = frames * frameSize;
    this.remaining -= consumed;
    this.pending = bytes.slice(consumed, available);
    if (!frames) return;
    const data = view(bytes);
    const channels = Array.from(
      { length: format.channels },
      () => new Float32Array(frames),
    );
    for (let frame = 0; frame < frames; frame++) {
      for (let channel = 0; channel < channels.length; channel++) {
        const i = (frame * channels.length + channel) * sampleSize;
        let sample: number;
        if (format.floating) sample = data.getFloat32(i, true);
        else if (sampleSize === 1) sample = (data.getUint8(i) - 128) / 128;
        else if (sampleSize === 2) sample = data.getInt16(i, true) / 32768;
        else if (sampleSize === 3) {
          const value =
            data.getUint8(i) |
            (data.getUint8(i + 1) << 8) |
            (data.getUint8(i + 2) << 16);
          sample = ((value << 8) >> 8) / 8388608;
        } else sample = data.getInt32(i, true) / 2147483648;
        channels[channel][frame] = Number.isFinite(sample)
          ? Math.max(-1, Math.min(1, sample))
          : 0;
      }
    }
    return { channels, sampleRate: format.sampleRate };
  }

  finish() {
    if (
      !this.format ||
      this.pending.length ||
      (this.remaining !== Infinity && this.remaining !== 0)
    ) {
      decodeError("音频流在头部或采样帧中途结束");
    }
  }
}
