import type { TwinPose } from "./pose";
import fragment from "./twin.frag?raw";

const vertex = "#version 300 es\nin vec2 p; void main(){gl_Position=vec4(p,0.,1.);}";

/** The trailer's SDF/fur renderer. Scheduling belongs to the visible component. */
export function createTwinRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  if (!context) throw new Error("Twin requires WebGL2");
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
    if (!shader) throw new Error("Twin could not allocate a shader");
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "Twin shader compilation failed");
    return shader;
  }

  function location(name: string): WebGLUniformLocation | null {
    if (!program) throw new Error("Twin shader program is unavailable");
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  }

  function uniform(name: string, value: number | readonly number[]): void {
    const at = location(name);
    if (at === null) return;
    if (typeof value === "number") gl.uniform1f(at, value);
    else {
      const vector = new Float32Array(value);
      switch (vector.length) {
        case 2:
          gl.uniform2fv(at, vector);
          break;
        case 3:
          gl.uniform3fv(at, vector);
          break;
        case 4:
          gl.uniform4fv(at, vector);
          break;
        default:
          throw new Error(`Twin uniform ${name} has an unsupported vector length`);
      }
    }
  }

  try {
    program = gl.createProgram();
    if (!program) throw new Error("Twin could not allocate a shader program");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "Twin shader linking failed");
    for (const shader of shaders) {
      gl.detachShader(program, shader);
      gl.deleteShader(shader);
    }
    shaders.length = 0;
    gl.useProgram(program);

    buffer = gl.createBuffer();
    if (!buffer) throw new Error("Twin could not allocate geometry");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    // Identical deterministic strand noise to the trailer's offline renderer.
    let seed = 1234567;
    const noise = new Uint8Array(256 * 256);
    for (let index = 0; index < noise.length; index++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[index] = Math.floor((seed / 4294967296) * 256);
    }
    texture = gl.createTexture();
    if (!texture) throw new Error("Twin could not allocate its fur texture");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(location("uNoise"), 0);
    uniform("uCam", [0, 0.95, 8.5]);
    uniform("uTarget", [0, 0.35, 0]);
    uniform("uFocal", 2.2);
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    render(pose: TwinPose, resolution: number): void {
      if (disposed) throw new Error("Twin renderer has been disposed");
      if (gl.isContextLost()) throw new Error("Twin WebGL context was lost");
      if (!Number.isFinite(resolution) || resolution < 1 || resolution > 1024)
        throw new Error("Twin render resolution must be between 1 and 1024 pixels");
      const size = Math.round(resolution);
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      gl.useProgram(program);
      gl.uniform2f(location("uRes"), size, size);
      for (const [name, value] of Object.entries(pose)) uniform(name, value);
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose,
  };
}
