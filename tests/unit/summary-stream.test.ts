import { describe, expect, it } from "bun:test";
import { splitAnswerStream } from "../../ui/src/lib/markdown/summary-stream";
import { SummaryHtmlStream } from "../../ui/src/lib/markdown/summary-tokenizer";

describe("splitAnswerStream", () => {
  it("moves a streaming summary out of the visible text", () => {
    expect(splitAnswerStream("Done.\n<summary><h2>Hi")).toEqual({
      text: "Done.",
      summary: "<h2>Hi",
      started: true,
    });
  });

  it("does not hide a trailing comparison symbol", () => {
    expect(splitAnswerStream("a <")).toEqual({ text: "a <", summary: "", started: false });
  });

  it("hides a partially typed opening tag", () => {
    expect(splitAnswerStream("Done.\n<summ")).toEqual({
      text: "Done.",
      summary: "",
      started: true,
    });
  });

  it("supports the complete tag", () => {
    expect(splitAnswerStream("Done.\n<complete><p>ok</p></complete>")).toEqual({
      text: "Done.",
      summary: "<p>ok</p>",
      started: true,
    });
  });

  it("does not treat tags inside fenced code as a summary", () => {
    const source = "Example:\n```\n<summary>x</summary>\n```";
    expect(splitAnswerStream(source)).toEqual({ text: source, summary: "", started: false });
  });

  it("does not treat inline code as a summary", () => {
    const source = "Write `<summary>` to finish.";
    expect(splitAnswerStream(source)).toEqual({ text: source, summary: "", started: false });
  });

  it("holds a partially typed closing tag", () => {
    expect(splitAnswerStream("Done.\n<summary><p>abc</summ")).toEqual({
      text: "Done.",
      summary: "<p>abc",
      started: true,
    });
  });

  it("ignores an indented code sample before the real block", () => {
    const source = "    <summary>sample</summary>\n\n<summary><p>real</p></summary>";
    expect(splitAnswerStream(source)).toEqual({
      text: "    <summary>sample</summary>",
      summary: "<p>real</p>",
      started: true,
    });
  });

  it("ignores native summary elements inside details blocks", () => {
    const source = "<details>\n<summary>Native</summary>\n</details>";
    expect(splitAnswerStream(source)).toEqual({ text: source, summary: "", started: false });

    const withBlock =
      "<details><summary>Native</summary></details>\n<summary><p>Real</p></summary>";
    expect(splitAnswerStream(withBlock)).toEqual({
      text: "<details><summary>Native</summary></details>",
      summary: "<p>Real</p>",
      started: true,
    });
  });

  it("keeps native summary elements inside the summary body", () => {
    const source =
      "Done.\n<summary><details><summary>Details</summary><p>Body</p></details></summary>";
    expect(splitAnswerStream(source)).toEqual({
      text: "Done.",
      summary: "<details><summary>Details</summary><p>Body</p></details>",
      started: true,
    });
  });

  it("strips a code fence wrapped around the summary", () => {
    expect(splitAnswerStream("Done.\n<summary>\n```html\n<p>ok</p>\n```\n</summary>")).toEqual({
      text: "Done.",
      summary: "<p>ok</p>",
      started: true,
    });
  });
});

describe("SummaryHtmlStream", () => {
  it("parses attributes with > inside quotes", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push('<div class="a>b"><p>hi')).toEqual([
      {
        kind: "open",
        name: "div",
        attrs: [["class", "a>b"]],
        selfClosing: false,
      },
      { kind: "open", name: "p", attrs: [], selfClosing: false },
      { kind: "text", value: "hi" },
    ]);
  });

  it("holds an incomplete tag until it closes", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push("<di")).toEqual([]);
    expect(stream.push("v>tail")).toEqual([
      { kind: "open", name: "div", attrs: [], selfClosing: false },
      { kind: "text", value: "tail" },
    ]);
  });

  it("keeps style and script content as raw text", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push('<style>.a{content:"</b>"}</style><p>x')).toEqual([
      { kind: "open", name: "style", attrs: [], selfClosing: false },
      { kind: "text", value: '.a{content:"</b>"}', raw: true },
      { kind: "close", name: "style" },
      { kind: "open", name: "p", attrs: [], selfClosing: false },
      { kind: "text", value: "x" },
    ]);

    const script = new SummaryHtmlStream();
    expect(script.push("<script>if (a < b) c()</script>")).toEqual([
      { kind: "open", name: "script", attrs: [], selfClosing: false },
      { kind: "text", value: "if (a < b) c()", raw: true },
      { kind: "close", name: "script" },
    ]);
  });

  it("skips comments and declarations", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push("<!-- x --><!doctype html><p>y")).toEqual([
      { kind: "open", name: "p", attrs: [], selfClosing: false },
      { kind: "text", value: "y" },
    ]);
  });

  it("holds an incomplete entity until it can be decoded", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push("a &am")).toEqual([{ kind: "text", value: "a " }]);
    expect(stream.push("p; b")).toEqual([{ kind: "text", value: "&amp; b" }]);
  });

  it("flushes raw text and drops a half-written tag on finish", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push("<script>x")).toEqual([
      { kind: "open", name: "script", attrs: [], selfClosing: false },
    ]);
    expect(stream.finish()).toEqual([
      { kind: "text", value: "x", raw: true },
      { kind: "close", name: "script" },
    ]);

    const broken = new SummaryHtmlStream();
    expect(broken.push("<div")).toEqual([]);
    expect(broken.finish()).toEqual([]);
  });

  it("parses self-closing and void tags", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push("<br><img src=x />")).toEqual([
      { kind: "open", name: "br", attrs: [], selfClosing: false },
      { kind: "open", name: "img", attrs: [["src", "x"]], selfClosing: true },
    ]);
  });

  it("preserves SVG tag case while matching close tags case-insensitively", () => {
    const stream = new SummaryHtmlStream();
    expect(stream.push("<svg><linearGradient></lineargradient></svg>")).toEqual([
      { kind: "open", name: "svg", attrs: [], selfClosing: false },
      { kind: "open", name: "linearGradient", attrs: [], selfClosing: false },
      { kind: "close", name: "lineargradient" },
      { kind: "close", name: "svg" },
    ]);
  });
});
