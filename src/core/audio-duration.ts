const MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Reads actual MPEG Layer III frame durations, including variable bit-rate recordings. */
export function mp3Duration(bytes: Buffer): number | undefined {
  let offset = 0;
  if (bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "ID3") {
    for (let index = 6; index < 10; index += 1) if ((bytes[index] ?? 128) >= 128) return undefined;
    const size =
      ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);
    offset = size + 10 + (((bytes[5] ?? 0) & 16) > 0 ? 10 : 0);
  }
  let duration = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes.length - offset === 128 && bytes.toString("ascii", offset, offset + 3) === "TAG")
      break;
    const header = bytes.readUInt32BE(offset);
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const rateIndex = (header >>> 10) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    if (
      (header & 0xffe00000) >>> 0 !== 0xffe00000 ||
      version === 1 ||
      layer !== 1 ||
      rateIndex === 3 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15
    )
      return undefined;
    const rate = [44100, 48000, 32000][rateIndex];
    const bitrate = (version === 3 ? MPEG1 : MPEG2)[bitrateIndex];
    if (!rate || !bitrate) return undefined;
    const sampleRate = rate / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const frameBytes =
      Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) + ((header >>> 9) & 1);
    if (offset + frameBytes > bytes.length) return undefined;
    duration += (version === 3 ? 1152 : 576) / sampleRate;
    offset += frameBytes;
  }
  return duration > 0 ? duration : undefined;
}

export function flacDuration(bytes: Buffer): number | undefined {
  if (
    bytes.length < 42 ||
    bytes.toString("ascii", 0, 4) !== "fLaC" ||
    ((bytes[4] ?? 1) & 127) !== 0 ||
    bytes.readUIntBE(5, 3) !== 34
  )
    return undefined;
  const packed = bytes.readBigUInt64BE(18);
  const rate = Number(packed >> 44n);
  const samples = Number(packed & 0xfffffffffn);
  return rate > 0 && samples > 0 ? samples / rate : undefined;
}
