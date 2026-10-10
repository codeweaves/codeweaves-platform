import {
  measureAudioSeconds,
  oggDurationSeconds,
  wavDurationSeconds,
} from "../../../src/modules/voice/utils/audio-duration";

/** One Ogg page. CRC is left zero: the parser does not check it. */
function oggPage(granule: bigint, serial: number, payload: Buffer): Buffer {
  const segments: number[] = [];
  let left = payload.length;
  do {
    segments.push(Math.min(left, 255));
    left -= 255;
  } while (left >= 0);
  const header = Buffer.alloc(27);
  header.write("OggS", 0, "ascii");
  header[4] = 0; // version
  header[5] = 0; // header type
  header.writeBigUInt64LE(granule, 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(0, 18); // sequence
  header.writeUInt32LE(0, 22); // crc
  header[26] = segments.length;
  return Buffer.concat([header, Buffer.from(segments), payload]);
}

function opusHead(preSkip: number): Buffer {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "ascii");
  head[8] = 1; // version
  head[9] = 1; // channels
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(48_000, 12); // input rate (informational)
  return head;
}

/** A voice note shaped like WhatsApp's: OpusHead, tags, audio pages. */
function oggOpus(seconds: number, preSkip = 312, serial = 0x1234): Buffer {
  const total = BigInt(Math.round(seconds * 48_000) + preSkip);
  return Buffer.concat([
    oggPage(0n, serial, opusHead(preSkip)),
    oggPage(0n, serial, Buffer.from("OpusTags\0\0\0\0\0\0\0\0")),
    oggPage(total / 2n, serial, Buffer.alloc(300, 1)),
    oggPage(total, serial, Buffer.alloc(300, 2)),
  ]);
}

function wav(opts: {
  byteRate: number;
  dataBytes: number;
  declaredSize?: number;
  extraChunk?: Buffer;
}): Buffer {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // mono
  fmt.writeUInt32LE(opts.byteRate / 2, 12); // sample rate (16-bit mono)
  fmt.writeUInt32LE(opts.byteRate, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(opts.declaredSize ?? opts.dataBytes, 4);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "ascii");
  riff.write("WAVE", 8, "ascii");
  return Buffer.concat([
    riff,
    fmt,
    opts.extraChunk ?? Buffer.alloc(0),
    dataHeader,
    Buffer.alloc(opts.dataBytes),
  ]);
}

describe("oggDurationSeconds", () => {
  it("reads the last granule and removes the Opus pre-skip", () => {
    expect(oggDurationSeconds(oggOpus(3.5))).toBeCloseTo(3.5, 6);
  });

  it("skips trailing pages with no granule (-1)", () => {
    const buf = Buffer.concat([
      oggOpus(2),
      oggPage(0xffffffffffffffffn, 0x1234, Buffer.alloc(10)),
    ]);
    expect(oggDurationSeconds(buf)).toBeCloseTo(2, 6);
  });

  it("ignores pages of another logical stream", () => {
    const buf = Buffer.concat([
      oggOpus(4),
      oggPage(BigInt(48_000 * 90), 0x9999, Buffer.alloc(10)),
    ]);
    expect(oggDurationSeconds(buf)).toBeCloseTo(4, 6);
  });

  it("returns null for bytes that are not Ogg Opus", () => {
    expect(
      oggDurationSeconds(Buffer.from("not an ogg file at all, sorry")),
    ).toBeNull();
    expect(
      oggDurationSeconds(oggPage(0n, 1, Buffer.from("SomethingElse"))),
    ).toBeNull();
  });
});

describe("wavDurationSeconds", () => {
  it("divides the data size by the byte rate", () => {
    expect(
      wavDurationSeconds(wav({ byteRate: 32_000, dataBytes: 64_000 })),
    ).toBe(2);
  });

  it("walks past other chunks, honouring the odd-size pad byte", () => {
    const list = Buffer.alloc(8 + 3 + 1);
    list.write("LIST", 0, "ascii");
    list.writeUInt32LE(3, 4);
    expect(
      wavDurationSeconds(
        wav({ byteRate: 32_000, dataBytes: 16_000, extraChunk: list }),
      ),
    ).toBe(0.5);
  });

  it("caps a streamed placeholder data size at the bytes present", () => {
    expect(
      wavDurationSeconds(
        wav({ byteRate: 48_000, dataBytes: 48_000, declaredSize: 0xffffffff }),
      ),
    ).toBe(1);
  });

  it("returns null for non-WAV bytes", () => {
    expect(wavDurationSeconds(Buffer.from("RIFF....AVI LIST"))).toBeNull();
  });
});

describe("measureAudioSeconds", () => {
  it("measures an Ogg voice note from the container (WhatsApp)", () => {
    expect(
      measureAudioSeconds(oggOpus(7.25), "audio/ogg; codecs=opus"),
    ).toEqual({ seconds: 7.25, source: "MEASURED" });
  });

  it("measures WAV from its header", () => {
    expect(
      measureAudioSeconds(
        wav({ byteRate: 32_000, dataBytes: 96_000 }),
        "audio/wav",
      ),
    ).toEqual({ seconds: 3, source: "MEASURED" });
  });

  it("prefers the container over the client's number", () => {
    expect(measureAudioSeconds(oggOpus(2), "audio/ogg", 59_000).seconds).toBe(
      2,
    );
  });

  it("uses the client's recording length for WebM, which has no readable duration", () => {
    expect(measureAudioSeconds(Buffer.alloc(4000), "audio/webm", 4321)).toEqual(
      { seconds: 4.321, source: "MEASURED" },
    );
  });

  it("clamps the client's recording length to 60 s", () => {
    expect(
      measureAudioSeconds(Buffer.alloc(4000), "audio/webm", 3_600_000).seconds,
    ).toBe(60);
  });

  it("estimates from bytes when nothing can be measured", () => {
    // 64 kbps assumed: 80,000 bytes = 640,000 bits = 10 s.
    expect(measureAudioSeconds(Buffer.alloc(80_000), "audio/webm")).toEqual({
      seconds: 10,
      source: "ESTIMATED",
    });
    expect(
      measureAudioSeconds(Buffer.alloc(80_000), "audio/webm", 0).source,
    ).toBe("ESTIMATED");
  });

  it("finds an Ogg stream behind a wrong MIME type", () => {
    expect(
      measureAudioSeconds(oggOpus(1.5), "application/octet-stream"),
    ).toEqual({ seconds: 1.5, source: "MEASURED" });
  });
});
