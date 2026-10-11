import { inflateSync } from "node:zlib";
import { expect, test } from "vitest";
import { greet, HELLO_PNG_BASE64 } from "../src/core/hello.ts";

test("greets the given name, trimmed", () => {
  expect(greet("  Ada ")).toBe("Hello, Ada!");
});

test("greets the world when no name is given", () => {
  expect(greet("   ")).toBe("Hello, world!");
});

test("the image is a 64×64 PNG whose every pixel is pure red", () => {
  const png = Buffer.from(HELLO_PNG_BASE64, "base64");
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([64, 64, 8, 2]); // width, height, 8-bit RGB
  const idatLength = png.readUInt32BE(33);
  const rows = inflateSync(png.subarray(41, 41 + idatLength));
  for (let y = 0; y < 64; y++) {
    const row = rows.subarray(y * 193 + 1, (y + 1) * 193);
    for (let x = 0; x < 64; x++) expect([...row.subarray(x * 3, x * 3 + 3)]).toEqual([255, 0, 0]);
  }
});
