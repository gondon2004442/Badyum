import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentDisposition,
  formatBytes,
  isInlineImage,
  safeFileName,
  saneDimension,
  sniffImageType,
} from "./attachment.ts";

const bytes = (...values: number[]) => new Uint8Array(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

describe("что это за файл на самом деле", () => {
  it("узнаёт картинки по сигнатуре", () => {
    assert.equal(sniffImageType(PNG), "image/png");
    assert.equal(sniffImageType(JPEG), "image/jpeg");
    assert.equal(sniffImageType(GIF), "image/gif");
    assert.equal(sniffImageType(WEBP), "image/webp");
  });

  it("не считает картинкой html, как бы он ни назывался", () => {
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    assert.equal(
      sniffImageType(html),
      null,
      "иначе скрипт открылся бы с нашего домена и добрался до куки",
    );
  });

  it("не принимает за webp другой RIFF", () => {
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45);
    assert.equal(sniffImageType(wav), null);
  });

  it("не падает на пустом и обрезанном файле", () => {
    assert.equal(sniffImageType(bytes()), null);
    assert.equal(sniffImageType(bytes(0x89, 0x50)), null);
  });

  it("svg картинкой не считается", () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    assert.equal(sniffImageType(svg), null);
    assert.equal(isInlineImage("image/svg+xml"), false, "и inline его не отдаём");
  });

  it("разрешает inline только четыре типа", () => {
    for (const ok of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      assert.equal(isInlineImage(ok), true, ok);
    }
    for (const no of ["text/html", "image/svg+xml", "application/pdf", ""]) {
      assert.equal(isInlineImage(no), false, no);
    }
  });
});

describe("имя файла", () => {
  it("обычное оставляет как есть", () => {
    assert.equal(safeFileName("скриншот.png"), "скриншот.png");
  });

  it("убирает разделители путей", () => {
    assert.equal(safeFileName("../../etc/passwd"), ".._.._etc_passwd");
  });

  it("убирает управляющие символы", () => {
    assert.equal(
      safeFileName("файл\r\nX-Evil: да.png"),
      "файлX-Evil: да.png",
      "переводом строки режут заголовок и дописывают свой",
    );
  });

  it("не отдаёт пустое имя и голые точки", () => {
    assert.equal(safeFileName("   "), "файл");
    assert.equal(safeFileName(".."), "файл");
    assert.equal(safeFileName("."), "файл");
  });

  it("режет длинное", () => {
    assert.ok(safeFileName("и".repeat(500)).length <= 120);
  });
});

describe("как отдаём файл браузеру", () => {
  it("картинку показывает на месте, остальное кладёт в загрузки", () => {
    assert.match(contentDisposition("кот.png", "image"), /^inline;/);
    assert.match(contentDisposition("архив.zip", "file"), /^attachment;/);
  });

  it("кириллицу везёт в кодированной форме, а простую — в обычной", () => {
    const header = contentDisposition("кот.png", "image");
    assert.match(header, /filename="[^"]*"/, "ASCII-форма для старых клиентов");
    assert.ok(header.includes("filename*=UTF-8''"), "и кодированная для новых");
    assert.ok(header.includes(encodeURIComponent("кот.png")));
  });

  it("апостроф в имени кодирует: в RFC 5987 он разделитель полей", () => {
    const header = contentDisposition("о'кей.txt", "file");
    const ext = header.split("filename*=UTF-8''")[1] ?? "";
    assert.ok(
      !ext.includes("'"),
      `апостроф дожил до значения (${ext}) — парсер обрежет имя по нему`,
    );
    assert.ok(ext.includes("%27"), "должен быть закодирован");
  });

  it("кодирует и остальное, что encodeURIComponent пропускает", () => {
    const header = contentDisposition("a!b*c(d)e.txt", "file");
    const ext = header.split("filename*=UTF-8''")[1] ?? "";
    for (const raw of ["*", "(", ")"]) {
      assert.ok(!ext.includes(raw), `${raw} остался сырым в ${ext}`);
    }
  });

  it("не даёт закрыть кавычку и подделать заголовок", () => {
    const header = contentDisposition('a";X-Evil="да.png', "file");
    const ascii = header.match(/filename="([^"]*)"/)?.[1] ?? "";
    assert.ok(!ascii.includes('"'), `кавычка осталась: ${ascii}`);
    assert.ok(!ascii.includes(";"), `точка с запятой осталась: ${ascii}`);
  });

  it("переводом строки заголовок не разорвать", () => {
    const header = contentDisposition("файл\nX-Evil: да", "file");
    assert.ok(!header.includes("\n"), "перенос дожил до заголовка");
    assert.ok(!header.includes("\r"));
  });
});

describe("размеры и объём", () => {
  it("пропускает разумное и отбрасывает мусор", () => {
    assert.equal(saneDimension(1920), 1920);
    assert.equal(saneDimension(0), undefined);
    assert.equal(saneDimension(-5), undefined);
    assert.equal(saneDimension(1e9), undefined);
    assert.equal(saneDimension(Number.NaN), undefined);
    assert.equal(saneDimension("1920"), undefined);
    assert.equal(saneDimension(undefined), undefined);
  });

  it("объём пишет по-человечески", () => {
    assert.equal(formatBytes(512), "512 Б");
    assert.equal(formatBytes(2048), "2 КБ");
    assert.equal(formatBytes(2_516_582), "2,4 МБ");
  });
});
