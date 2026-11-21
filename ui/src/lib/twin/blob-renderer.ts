import fragment from "./twin-blob.frag?raw";

const vertex = "#version 300 es\nin vec2 p; void main(){gl_Position=vec4(p,0.,1.);}";

export interface TwinBlobFrame {
  width: number;
  height: number;
  boxWidth: number;
  boxHeight: number;
  radiusPx: number;
  furPx: number;
  time: number;
}

/** 3D SDF rounded-rectangle renderer with volumetric fur contour for Twin chat blobs. */
export function createTwinBlobRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  if (!context) throw new Error("Twin blob requires WebGL2");
  const gl: WebGL2RenderingContext = context;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  let disposed = false;
  const locations = new Map<string, WebGLUniformLocation | null>();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const shader of shaders) gl.deleteShader(shader);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    locations.clear();
  }

  function compile(kind: number, source: string): WebGLShader {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error("Twin blob could not allocate a shader");
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "Twin blob shader compilation failed");
    return shader;
  }

  function location(name: string): WebGLUniformLocation | null {
    if (!program) throw new Error("Twin blob shader program is unavailable");
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  }

  try {
    program = gl.createProgram();
    if (!program) throw new Error("Twin blob could not allocate a shader program");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "Twin blob shader linking failed");
    for (const shader of shaders) {
      gl.detachShader(program, shader);
      gl.deleteShader(shader);
    }
    shaders.length = 0;
    gl.useProgram(program);

    buffer = gl.createBuffer();
    if (!buffer) throw new Error("Twin blob could not allocate geometry");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    let seed = 1234567;
    const noise = new Uint8Array(256 * 256);
    for (let index = 0; index < noise.length; index++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[index] = Math.floor((seed / 4294967296) * 256);
    }
    texture = gl.createTexture();
    if (!texture) throw new Error("Twin blob could not allocate its fur texture");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(location("uNoise"), 0);
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    render(frame: TwinBlobFrame): void {
      if (disposed || gl.isContextLost()) return;
      const w = Math.max(16, Math.min(2048, Math.round(frame.width)));
      const h = Math.max(16, Math.min(2048, Math.round(frame.height)));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.useProgram(program);
      gl.uniform2f(location("uRes"), w, h);
      gl.uniform2f(location("uBoxPx"), frame.boxWidth, frame.boxHeight);
      gl.uniform1f(location("uRadiusPx"), frame.radiusPx);
      gl.uniform1f(location("uFurPx"), frame.furPx);
      gl.uniform1f(location("uT"), frame.time);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose,
  };
}
