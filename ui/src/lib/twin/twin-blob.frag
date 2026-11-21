#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uRes;
uniform vec2 uBoxPx;
uniform float uRadiusPx;
uniform float uFurPx;
uniform float uT;
uniform sampler2D uNoise;

const float PI = 3.14159265;

float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noiseT(vec2 uv) {
  return texture(uNoise, uv).r;
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

vec3 boxNormal(vec3 p, vec3 b, float r) {
  const vec2 e = vec2(1.5, 0.0);
  return normalize(
    vec3(
      sdRoundBox(p + e.xyy, b, r) - sdRoundBox(p - e.xyy, b, r),
      sdRoundBox(p + e.yxy, b, r) - sdRoundBox(p - e.yxy, b, r),
      sdRoundBox(p + e.yyx, b, r) - sdRoundBox(p - e.yyx, b, r)
    )
  );
}

const vec3 LK = normalize(vec3(-0.52, 0.72, 0.65));
const vec3 CK = vec3(1.38, 1.22, 1.08);
const vec3 LF = normalize(vec3(0.78, 0.10, 0.55));
const vec3 CF = vec3(0.20, 0.22, 0.34);
const vec3 LB = normalize(vec3(0.42, 0.55, -0.85));
const vec3 CB = vec3(1.28, 1.04, 0.96);

void main() {
  vec2 p2 = gl_FragCoord.xy - 0.5 * uRes;
  vec2 halfBox = 0.5 * uBoxPx;
  float depth = 22.0;
  float rad = min(uRadiusPx, min(halfBox.x, halfBox.y));
  vec3 b = vec3(halfBox, depth);
  float H = max(uFurPx, 8.0);

  // Subtle organic breathing & ripple wave along the 3D rounded-rectangle contour
  float wave = sin(p2.x * 0.032 + uT * 1.9) * cos(p2.y * 0.038 - uT * 1.5) * 1.35;
  vec2 q2 = abs(p2) - (halfBox - rad);
  float d2 = length(max(q2, 0.0)) + min(max(q2.x, q2.y), 0.0) - rad + wave;

  if (d2 > H * 1.45) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 ro = vec3(p2, depth + H + 8.0);
  vec3 rd = vec3(0.0, 0.0, -1.0);
  vec3 V = -rd;

  vec4 acc = vec4(0.0);
  float zTop = depth + H * 1.15;
  float zBot = -4.0;
  int steps = 26;
  float stp = (zTop - zBot) / float(steps);
  float z = zTop - stp * hash2(gl_FragCoord.xy * 0.713 + 1.9);

  // Perimeter coordinate for continuous fur strand distribution around the rounded rectangle
  vec2 nearest = clamp(p2, -halfBox + rad, halfBox - rad);
  vec2 outDir = p2 - nearest;
  float outLen = length(outDir);
  vec2 dir2 = outLen > 1e-3 ? outDir / outLen : vec2(0.0, 1.0);
  float angle = atan(dir2.y, dir2.x);
  float perim = (p2.x + p2.y) * 0.014 + angle * 1.8;

  for (int i = 0; i < 26; i++) {
    vec3 q = vec3(p2.x, p2.y, z);
    float d = sdRoundBox(q, b, rad) + wave * 0.55;
    if (d < 0.0) {
      vec3 N = boxNormal(q, b, rad);
      float ndl = clamp((dot(N, LK) + 0.55) / 1.55, 0.0, 1.0);
      float ndf = clamp((dot(N, LF) + 0.5) / 1.5, 0.0, 1.0);
      float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.3);
      vec3 Hk = normalize(LK + V);
      float spec = pow(max(0.0, dot(N, Hk)), 28.0) * 0.28;

      // Deep velvety 3D interior of the Twin rounded rectangle for high text contrast
      vec3 baseDark = vec3(0.08, 0.06, 0.14);
      vec3 baseMid = vec3(0.15, 0.11, 0.24);
      vec3 baseEdge = vec3(0.32, 0.23, 0.50);
      float edgeProximity = smoothstep(-22.0, 0.0, d2);
      vec3 bodyCol = mix(baseDark, baseMid, ndl * 0.75 + ndf * 0.2);
      bodyCol = mix(bodyCol, baseEdge, edgeProximity * 0.7);
      bodyCol += CB * rim * 0.28 + CK * spec * 0.6;
      acc.rgb += (1.0 - acc.a) * bodyCol * 0.97;
      acc.a += (1.0 - acc.a) * 0.97;
      break;
    }

    if (d < H && d2 > -6.0) {
      float u = clamp(d / H, 0.0, 1.0);
      vec3 N = boxNormal(q, b, rad);
      // Gravity + gentle breeze sway on fur tips
      vec3 sway = vec3(
        sin(uT * 2.1 + p2.y * 0.04) * 0.35,
        -0.55 + cos(uT * 1.7 + p2.x * 0.04) * 0.22,
        0.18
      );
      vec3 comb = normalize(mix(N, N + sway, u));
      vec2 suv = vec2(
        perim * 0.42 + (q.x - comb.x * u * 7.0) * 0.016,
        (q.y - comb.y * u * 7.0) * 0.016 + q.z * 0.022
      );
      vec2 cs = suv * 34.0;
      vec2 ci = floor(cs);
      vec2 cc = (ci + 0.5 + 0.42 * (vec2(hash2(ci), hash2(ci + 17.3)) - 0.5)) / 34.0;
      vec2 s2 = mix(suv, cc, 0.38 * u * u);
      float n = noiseT(s2);
      float clump = noiseT(suv * 0.14 + 0.37);
      float strandLen = 0.34 + 0.66 * n * (0.76 + 0.42 * clump);
      float dens = smoothstep(u - 0.06, u + 0.035, strandLen);

      if (dens > 0.002) {
        vec3 root = vec3(0.34, 0.26, 0.54);
        vec3 mid = vec3(0.76, 0.66, 0.95);
        vec3 tip = vec3(0.96, 0.93, 1.0);
        vec3 col = mix(root, mid, smoothstep(0.0, 0.55, u));
        col = mix(col, tip, smoothstep(0.45, 1.0, u));
        col *= 0.86 + 0.28 * n;

        float ndl = clamp((dot(N, LK) + 0.55) / 1.55, 0.0, 1.0);
        float wrapF = clamp((dot(N, LF) + 0.5) / 1.5, 0.0, 1.0);
        float rimB = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.85);
        vec3 amb = mix(vec3(0.10, 0.08, 0.14), vec3(0.18, 0.16, 0.22), 0.5 + 0.5 * N.y);
        vec3 lightA = amb + CK * ndl * 0.92 + CF * wrapF;
        vec3 sssC = vec3(0.68, 0.52, 1.0) * 0.25 * (1.0 - ndl);
        float selfOcc = mix(0.42, 1.0, u * u);
        vec3 lit = col * (lightA + sssC * u) * selfOcc + CB * rimB * 0.85 * u * (0.6 + 0.4 * n);
        float a = clamp(dens * 0.52, 0.0, 1.0);
        acc.rgb += (1.0 - acc.a) * a * lit;
        acc.a += (1.0 - acc.a) * a;
        if (acc.a > 0.985) break;
      }
    }
    z -= stp;
  }

  fragColor = vec4(acc.rgb, acc.a);
}
