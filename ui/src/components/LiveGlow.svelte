<script lang="ts">
  import { onMount } from "svelte";
  import { reducedMotion } from "../lib/media.svelte";
  import { fallbackToken } from "../lib/markdown/tokens";

  const VERT = `
    attribute vec2 p;
    void main() {
      gl_Position = vec4(p, 0.0, 1.0);
    }
  `;

  const GLOW_FRAG = `
    precision mediump float;
    uniform vec3 uAccent;
    uniform vec3 uAccentHover;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uActivity;
    uniform float uPad;

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;

      float t = uTime * (0.08 + 0.08 * uActivity);
      float w1 = sin(uv.x * 9.0 + sin(uv.y * 3.0 + t * 1.1) * 2.0 + t * 0.6);
      float w2 = sin(uv.x * 17.0 - sin(uv.y * 5.0 - t * 0.8) * 1.4 - t * 0.4);
      float f = smoothstep(0.3, 0.9, 0.5 + 0.3 * w1 + 0.2 * w2);
      f = mix(0.7, 1.0, f);

      float v = 1.0 - smoothstep(0.0, 0.5, abs(uv.y - 0.5));
      v = pow(v, 1.3);
      float x = clamp((uv.x - uPad) / max(0.0001, 1.0 - 2.0 * uPad), 0.0, 1.0);
      float band = 0.78 + 0.22 * sin(x * 3.14159);
      float edge = smoothstep(0.0, uPad, uv.x) * (1.0 - smoothstep(1.0 - uPad, 1.0, uv.x));
      float flicker = 0.94 + 0.04 * sin(uTime * 2.2) + 0.02 * sin(uTime * 5.7 + 1.3);

      float a = f * v * band * edge * 0.15 * flicker;
      vec3 col = mix(uAccent, uAccentHover, f);
      gl_FragColor = vec4(col * a, a);
    }
  `;

  const SURFACE_FRAG = `
    precision mediump float;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uActivity;
    uniform float uPad;
    uniform float uPadV;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.02 + vec2(11.7, 7.3);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      float aspect = uRes.x / max(1.0, uRes.y);
      vec2 p = vec2(uv.x * aspect, uv.y);

      float t = uTime * (0.006 + 0.012 * uActivity);

      vec3 base = vec3(0.052, 0.055, 0.066);
      vec3 slate = vec3(0.16, 0.19, 0.26);
      vec3 plum = vec3(0.22, 0.15, 0.24);
      vec3 teal = vec3(0.11, 0.20, 0.20);

      float n1 = fbm(p * 2.0 + vec2(t * 0.8, -t * 0.35));
      float n2 = fbm(p * 3.1 + vec2(-t * 0.45, t * 0.6) + n1 * 1.7);
      float field = n2 * 0.68 + n1 * 0.32;
      float mesh = smoothstep(0.44, 0.78, field);
      float spot = smoothstep(0.55, 0.9, fbm(p * 1.15 + vec2(t * 0.22, t * 0.3) + 5.0));
      float shimmer = mesh * (0.35 + 0.65 * spot);

      vec3 tint = mix(slate, plum, smoothstep(0.25, 0.8, n1));
      tint = mix(tint, teal, smoothstep(0.55, 0.95, n2));

      float body = mix(1.0, 0.62, smoothstep(0.1, 1.0, uv.y));
      float edgeX = smoothstep(0.0, uPad, uv.x) * (1.0 - smoothstep(1.0 - uPad, 1.0, uv.x));
      float edgeY = smoothstep(0.0, uPadV, uv.y) * (1.0 - smoothstep(1.0 - uPadV, 1.0, uv.y));
      float edge = edgeX * edgeY;

      float baseA = 0.52 * body * edge;
      float shimmerA = shimmer * mix(0.035, 0.075, uActivity) * edge;

      float a = baseA + shimmerA;
      vec3 col = base * baseA + tint * shimmerA;
      gl_FragColor = vec4(col, a);
    }
  `;

  interface Props {
    variant?: "row" | "surface";
    activity?: number;
  }

  let { variant = "row", activity = 0.55 }: Props = $props();

  let canvas: HTMLCanvasElement;
  let visible = $state(true);
  let ready = $state(false);
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let uniforms: {
    res: WebGLUniformLocation;
    time: WebGLUniformLocation;
    activity: WebGLUniformLocation;
    pad: WebGLUniformLocation;
    padV: WebGLUniformLocation | null;
  } | null = null;
  let raf = 0;
  let started = 0;
  let phase = 0;

  function compile(type: number, source: string): WebGLShader | null {
    if (!gl) return null;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function uniform(name: string): WebGLUniformLocation | null {
    if (!gl || !program) return null;
    return gl.getUniformLocation(program, name);
  }

  function init(): boolean {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return false;

    const vert = compile(gl.VERTEX_SHADER, VERT);
    const frag = compile(
      gl.FRAGMENT_SHADER,
      variant === "surface" ? SURFACE_FRAG : GLOW_FRAG,
    );
    if (!vert || !frag) return false;

    program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const location = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    if (variant === "row") {
      const style = getComputedStyle(document.documentElement);
      for (const [name, token] of [["uAccent", "--primary"], ["uAccentHover", "--primary-hover"]] as const) {
        const hex = style.getPropertyValue(token).trim() || fallbackToken(token);
        gl.uniform3fv(uniform(name), [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255));
      }
    }

    const res = uniform("uRes");
    const time = uniform("uTime");
    const activityUniform = uniform("uActivity");
    const pad = uniform("uPad");
    const padV = uniform("uPadV");
    if (!res || !time || !activityUniform || !pad || (variant === "surface" && !padV)) return false;

    uniforms = { res, time, activity: activityUniform, pad, padV };
    gl.clearColor(0, 0, 0, 0);
    phase = variant === "surface" ? Math.random() * 42_000 : 0;
    started = performance.now() - phase;
    return true;
  }

  function resize(): void {
    if (!gl || !uniforms) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * 0.5));
    const height = Math.max(1, Math.round(rect.height * 0.5));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(uniforms.res, width, height);
    gl.uniform1f(uniforms.pad, 24 / Math.max(1, rect.width));
    if (uniforms.padV) gl.uniform1f(uniforms.padV, 14 / Math.max(1, rect.height));
    draw(performance.now());
  }

  function draw(now: number): void {
    if (!gl || !uniforms || !program || !canvas.isConnected) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uniforms.time, (now - started) / 1000);
    gl.uniform1f(uniforms.activity, activity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now: number): void {
    raf = 0;
    if (!gl || document.hidden || !visible) return;
    draw(now);
    if (!reducedMotion.current) raf = requestAnimationFrame(frame);
  }

  function start(): void {
    if (raf || reducedMotion.current) {
      if (reducedMotion.current) draw(performance.now());
      return;
    }
    if (!started) started = performance.now() - phase;
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  onMount(() => {
    if (!init()) return;

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const inView = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) start();
      else stop();
    });
    inView.observe(canvas);

    const onVisibility = (): void => {
      if (document.hidden) stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    start();
    const reveal = requestAnimationFrame(() => {
      ready = true;
    });

    return () => {
      cancelAnimationFrame(reveal);
      stop();
      resizeObserver.disconnect();
      inView.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
      program = null;
      uniforms = null;
    };
  });

  $effect(() => {
    const reduced = reducedMotion.current;
    const shown = visible;
    if (!gl) return;

    if (reduced) {
      stop();
      draw(performance.now());
    } else if (shown && !document.hidden) {
      start();
    }
  });
</script>

<canvas
  bind:this={canvas}
  class="live-glow"
  class:is-surface={variant === "surface"}
  class:is-ready={ready}
  aria-hidden="true"
></canvas>

<style>
  .live-glow {
    position: absolute;
    left: -24px;
    top: -30px;
    z-index: -1;
    display: block;
    width: calc(100% + 48px);
    height: 80px;
    opacity: 1;
    pointer-events: none;
    transition: opacity 1200ms var(--ease);
  }

  .live-glow.is-surface {
    left: -24px;
    top: -10px;
    width: calc(100% + 48px);
    height: calc(100% + 20px);
    opacity: 0;
    transition: opacity 220ms var(--ease);
  }

  .live-glow.is-surface.is-ready {
    opacity: 1;
  }
</style>
