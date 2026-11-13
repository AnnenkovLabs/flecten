// bun scripts/twin/render-assets.mjs /path/to/liquid-harness-trailer-v12
// Generates fallback images from the original rig and the UI's canonical live shader.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const trailer = resolve(process.argv[2] ?? "/home/oleksandr/workspace/liquid-harness-trailer-v12");
const { twinPose } = await import(pathToFileURL(resolve(trailer, "src/v10/twin10.ts")));
const original = await readFile(
  new URL("../../ui/src/lib/twin/twin.frag", import.meta.url),
  "utf8",
);
const output = resolve(import.meta.dirname, "../../ui/public/twin");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.setContent('<canvas id="twin"></canvas>');
const poses = { idle: 1180, learning: 1370, ready: 1518, answer: 1660, angry: 1180, furious: 1180 };
try {
  for (const [name, frame] of Object.entries(poses)) {
    const anger = name === "angry" ? 0.7 : name === "furious" ? 1 : 0;
    const uniforms = {
      ...twinPose(frame),
      uAnger: anger,
      uCam: [0, 0.95, 8.5],
      uTarget: [0, 0.35, 0],
      uFocal: 2.2,
    };
    if (anger)
      Object.assign(uniforms, {
        uSmile: 0,
        uBlink: 0.12,
        uLook: [0, -0.08],
        uTilt: [0, 0.04],
        uArms: [0.16, 0.16, 0.45, 0.45],
        uSquash: 0.96,
      });
    const data = await page.evaluate(
      ({ frag, uniforms }) => {
        const canvas = document.getElementById("twin");
        const gl = canvas.getContext("webgl2", {
          alpha: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
        });
        canvas.width = 640;
        canvas.height = 640;
        const shader = (kind, source) => {
          const value = gl.createShader(kind);
          gl.shaderSource(value, source);
          gl.compileShader(value);
          if (!gl.getShaderParameter(value, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(value));
          return value;
        };
        const program = gl.createProgram();
        gl.attachShader(
          program,
          shader(
            gl.VERTEX_SHADER,
            "#version 300 es\nin vec2 p; void main(){gl_Position=vec4(p,0.,1.);}",
          ),
        );
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, frag));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(program));
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const position = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        let seed = 1234567;
        const noise = new Uint8Array(256 * 256);
        for (let i = 0; i < noise.length; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          noise[i] = Math.floor((seed / 4294967296) * 256);
        }
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, noise);
        for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
          gl.texParameteri(gl.TEXTURE_2D, axis, gl.REPEAT);
        for (const size of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
          gl.texParameteri(gl.TEXTURE_2D, size, gl.LINEAR);
        gl.uniform1i(gl.getUniformLocation(program, "uNoise"), 0);
        gl.uniform2f(gl.getUniformLocation(program, "uRes"), 640, 640);
        for (const [key, value] of Object.entries(uniforms)) {
          const location = gl.getUniformLocation(program, key);
          if (typeof value === "number") gl.uniform1f(location, value);
          else if (value.length === 2) gl.uniform2fv(location, value);
          else if (value.length === 3) gl.uniform3fv(location, value);
          else gl.uniform4fv(location, value);
        }
        gl.viewport(0, 0, 640, 640);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const result = canvas.toDataURL("image/webp", 0.92);
        gl.deleteProgram(program);
        gl.deleteBuffer(buffer);
        gl.deleteTexture(texture);
        return result;
      },
      { frag: original, uniforms },
    );
    await writeFile(resolve(output, `${name}.webp`), Buffer.from(data.split(",")[1], "base64"));
  }
  await writeFile(
    resolve(output, "provenance.json"),
    `${JSON.stringify({ source: "liquid-harness-trailer-v12", shaderSha256: createHash("sha256").update(original).digest("hex"), frames: poses, changes: "Original purple 3D shader and rig, with anger and fury expressions. Live interactive WebGL2 in the UI; these images are the fallback for unavailable or lost contexts." }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
