#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uT;
uniform sampler2D uNoise;   // 256x256 R8 white noise, linear, repeat
uniform float uSquash;      // 1 rest, <1 squash, >1 stretch (about the floor contact)
uniform float uBlink;       // 0 open .. 1 closed
uniform vec2 uLook;         // gaze -1..1
uniform vec2 uTilt;         // roll, pitch (rad)
uniform float uYaw;
uniform vec4 uArms;         // raise L, raise R, fwd L, fwd R
uniform float uSmile;       // 0 .. 1
uniform float uAnger;       // explicit correction verdict, 0 calm .. 1 furious
uniform vec4 uRipple;       // dir xyz (body space, unit), age s in w (<0 none)
uniform vec4 uRipple2;
uniform float uTuft;        // tuft sway
uniform vec3 uFlow;         // secondary motion: strands lag behind the body (body-space vector)
uniform float uGlow;        // inner iris glow
uniform float uFur;         // fur growth 0 (liquid droplet) .. 1 (+ overshoot)
uniform float uEyes;        // eye scale 0 .. 1
uniform float uLift;        // body height above the floor (hop)
uniform float uLimbs;       // feet + paws grow out of the droplet 0..1
uniform vec3 uBend;         // v11 jelly: lateral (x) and fore-aft (z) offset of the top of the body, twist (rad) — grows with height
uniform vec3 uCam;
uniform vec3 uTarget;
uniform float uFocal;       // 2.6 default

const float PI = 3.14159265;
const float H0 = 0.15;

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdEllipsoid(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdRoundCone(vec3 p, float r1, float r2, float h) {
  vec2 q = vec2(length(p.xz), p.y);
  float b = (r1 - r2) / h, a = sqrt(1.0 - b * b), k = dot(q, vec2(-b, a));
  if (k < 0.0) return length(q) - r1;
  if (k > a * h) return length(q - vec2(0.0, h)) - r2;
  return dot(q, vec2(a, b)) - r1;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
mat2 gArmR[2], gArmF[2];

vec3 toBody(vec3 p) {
  p.y += 1.0 - uLift;
  p.xz = rot(uYaw) * p.xz;
  p.xy = rot(uTilt.x) * p.xy;
  p.yz = rot(uTilt.y) * p.yz;
  float s = uSquash; p.y /= s; p.xz *= sqrt(s);
  p.y -= 1.0;
  return p;
}
// v11 · jelly bend: the body sways like a soft blob — the offset grows with height (feet stay planted).
// bendQ maps the deformed (visible) body space to the rest space where the SDF lives; unbendQ is the inverse (eyes).
float bendW(float y) { float w = clamp((y + 1.0) / 2.45, 0.0, 1.0); return w * w; }
vec3 bendQ(vec3 q) { float w = bendW(q.y); q.xz -= uBend.xy * w; q.xz = rot(uBend.z * w) * q.xz; return q; }
vec3 unbendQ(vec3 q) { float w = bendW(q.y); q.xz = rot(-uBend.z * w) * q.xz; q.xz += uBend.xy * w; return q; }
float sdBody(vec3 q) {
  vec3 qb = q; float tb = smoothstep(0.55, 1.45, q.y); qb.x -= uTuft * 0.22 * tb * tb;
  float d = sdRoundCone(qb, 1.0, 0.07, 1.36);
  float lb = uLimbs;
  if (q.y < -0.2 && lb > 0.02) {
    vec3 fc = mix(vec3(0.24, -0.78, 0.22), vec3(0.37, -0.91, 0.46), lb);
    vec3 fR = vec3(0.26, 0.15, 0.31) * mix(0.35, 1.0, lb);
    d = smin(d, sdEllipsoid(q - vec3(-fc.x, fc.y, fc.z), fR), 0.08);
    d = smin(d, sdEllipsoid(q - fc, fR), 0.08);
  }
  for (int i = 0; i < 2; i++) {
    float sx = i == 0 ? -1.0 : 1.0;
    if (lb < 0.02) break;
    vec3 a = q - vec3(sx * mix(0.6, 0.74, lb), -0.3, 0.3);
    if (dot(a, a) > 0.95 * 0.95) continue;
    a.xy = gArmR[i] * a.xy;
    a.yz = gArmF[i] * a.yz;
    d = smin(d, sdEllipsoid(a - vec3(0.0, -0.17, 0.0), vec3(0.165, 0.26, 0.17) * mix(0.4, 1.0, lb)), 0.09);
  }
  return d;
}
vec3 eyeC(int i) { return vec3(i == 0 ? -0.37 : 0.37, -0.02, 0.83); }
const float ER = 0.215;

float furLen(vec3 q) {
  float face = smoothstep(0.55, 0.9, q.z) * (1.0 - smoothstep(0.35, 0.7, abs(q.y)));
  float eyes = 0.0;
  for (int i = 0; i < 2; i++) eyes = max(eyes, 1.0 - smoothstep(ER * 1.0, ER * 1.38, length(q - eyeC(i))));
  float tuft = smoothstep(0.95, 1.5, q.y);
  return mix(1.0, 0.55, face) * mix(1.0, 0.42, eyes * uEyes) * (1.0 + 1.6 * tuft);
}
float noiseT(vec2 uv) { return texture(uNoise, uv).r; }
float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 strandUV(vec3 q) {
  vec3 d = normalize(q - vec3(0.0, 0.1, 0.0));
  float th = atan(d.z, d.y), ph = acos(clamp(d.x, -1.0, 1.0));
  return vec2(th / (2.0 * PI) * 5.0, ph / PI * 2.5);
}
vec3 bodyNormal(vec3 q) {
  const vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(sdBody(q + e.xyy) - sdBody(q - e.xyy), sdBody(q + e.yxy) - sdBody(q - e.yxy), sdBody(q + e.yyx) - sdBody(q - e.yyx)));
}
float softShadow(vec3 q, vec3 L) {
  float res = 1.0, t = 0.04;
  for (int i = 0; i < 16; i++) {
    float h = sdBody(q + L * t);
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.04, 0.28);
    if (res < 0.02 || t > 3.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
const vec3 LK = normalize(vec3(-0.55, 0.75, 0.6));
const vec3 CK = vec3(1.42, 1.24, 1.06);
const vec3 LF = normalize(vec3(0.8, 0.05, 0.55));
const vec3 CF = vec3(0.17, 0.21, 0.32);
const vec3 LB = normalize(vec3(0.45, 0.55, -0.9));
const vec3 CB = vec3(1.3, 1.05, 0.92);

float mouth(vec3 q) {
  if (q.z < 0.6) return 0.0;
  float x = q.x, y = q.y + 0.29;
  float curve = mix(0.11 * uSmile + 0.02, -0.07, uAnger);
  float yc = -curve + curve * (x * x) / (0.13 * 0.13);
  float w = 0.018 + 0.03 * uSmile * (1.0 - smoothstep(0.0, 0.12, abs(x)));
  float inX = 1.0 - smoothstep(0.12, 0.135, abs(x));
  float lip = inX * (1.0 - smoothstep(w * 0.5, w * 0.5 + 0.012, abs(y - yc)));
  float browY = 0.25 + 0.34 * (abs(q.x) - 0.22);
  float browX = smoothstep(0.16, 0.24, abs(q.x)) * (1.0 - smoothstep(0.5, 0.57, abs(q.x)));
  float brow = browX * (1.0 - smoothstep(0.025, 0.045, abs(q.y - browY)));
  return max(lip, brow * uAnger);
}
float rayEll(vec3 ro, vec3 rd, vec3 c, vec3 r) {
  vec3 o = (ro - c) / r, d = rd / r;
  float a = dot(d, d), b = dot(o, d), cc = dot(o, o) - 1.0, h = b * b - a * cc;
  if (h < 0.0) return -1.0;
  return (-b - sqrt(h)) / a;
}
vec3 eyeShade(vec3 n, vec3 v, int i) {
  vec3 gaze = normalize(vec3(uLook.x * 0.42 + (i == 0 ? 0.08 : -0.08), uLook.y * 0.35 + 0.05, 1.0));
  float g = dot(n, gaze);
  vec3 base = vec3(0.03, 0.025, 0.045);
  float ring = smoothstep(0.80, 0.90, g) * (1.0 - smoothstep(0.955, 0.975, g));
  base += vec3(0.14, 0.10, 0.24) * ring * 0.6;
  float pool = smoothstep(0.1, 0.9, dot(n, normalize(vec3(0.45, -0.75, 0.6))));
  base += vec3(0.24, 0.17, 0.38) * pool * 0.6 * smoothstep(0.7, 0.88, g);
  // soften the very edge (no black ring): the rim picks up a little fur bounce
  float edge = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  base += vec3(0.10, 0.075, 0.16) * smoothstep(0.55, 0.95, edge);
  vec3 r = reflect(-v, n);
  float fres = 0.04 + 0.96 * pow(edge, 5.0);
  vec3 env = mix(vec3(0.03, 0.025, 0.03), vec3(0.17, 0.16, 0.18), smoothstep(-0.2, 0.9, r.y));
  vec3 col = base + env * fres * 1.3;
  float hk = smoothstep(0.955, 0.985, dot(r, LK));
  float hf = smoothstep(0.988, 0.996, dot(r, normalize(vec3(0.55, -0.25, 0.8))));
  col += vec3(1.0, 0.97, 0.93) * hk * 1.15 + vec3(0.85, 0.9, 1.0) * hf * 0.7;
  return col;
}
// glossy liquid iris (the droplet before the fur grows)
vec3 irisBody(vec3 N, vec3 V, float sh) {
  vec3 r = reflect(-V, N);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float wrap = clamp((dot(N, LK) + 0.45) / 1.45, 0.0, 1.0) * mix(0.55, 1.0, sh);
  vec3 c0 = vec3(0.93, 0.88, 0.99), c1 = vec3(0.72, 0.63, 0.91), c2 = vec3(0.30, 0.23, 0.47);
  vec3 col = mix(c2, c1, smoothstep(0.0, 0.6, wrap));
  col = mix(col, c0, smoothstep(0.6, 1.0, wrap));
  col *= 0.82 + 0.18 * clamp(dot(N, LF) + 0.6, 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 env = mix(vec3(0.07, 0.055, 0.10), vec3(0.52, 0.48, 0.58), smoothstep(-0.2, 0.9, r.y));
  col = mix(col, col * 0.6 + env, 0.35 * fres);
  float box = smoothstep(0.88, 0.96, dot(r, LK));
  float strip = smoothstep(0.94, 0.98, dot(r, normalize(vec3(0.9, 0.1, 0.3))));
  float rimL = smoothstep(0.7, 0.95, dot(r, LB));
  col += vec3(1.0, 0.95, 0.9) * box * 0.9 * mix(0.4, 1.0, sh) + vec3(0.8, 0.85, 0.95) * strip * 0.35 + vec3(0.9, 0.84, 1.0) * rimL * 0.5 * fres;
  return col;
}

void main() {
  gArmR[0] = rot(-1.0 * (0.35 + uArms.x * 1.7)); gArmR[1] = rot(0.35 + uArms.y * 1.7);
  gArmF[0] = rot(-uArms.z); gArmF[1] = rot(-uArms.w);
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;
  vec3 ro = uCam, ta = uTarget;
  vec3 ww = normalize(ta - ro), uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0))), vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + uFocal * ww);
  float fur = max(uFur, 0.0);
  float H = H0 * fur;
  vec3 bc = vec3(0.0, 0.2 + uLift, 0.0); float br = 1.95;
  vec3 oc = ro - bc; float b = dot(oc, rd), c = dot(oc, oc) - br * br, disc = b * b - c;
  vec4 acc = vec4(0.0);
  if (disc > 0.0) {
    float t = max(-b - sqrt(disc), 0.0), tEnd = -b + sqrt(disc);
    float shellH = max(H * 2.6, 0.003);
    float tShell = -1.0;
    vec3 rob = toBody(ro), rdb = toBody(ro + rd) - rob;
    for (int i = 0; i < 64; i++) {
      vec3 q = bendQ(rob + rdb * t);
      float d = sdBody(q) - shellH;
      if (d < 0.002) { tShell = t; break; }
      t += max(d * 0.7, 0.004);
      if (t > tEnd) break;
    }
    float tEye = 1e9; int eyeI = -1;
    float es = uEyes;
    float blinkS = mix(1.0, 0.07, uBlink);
    if (es > 0.01) {
      for (int i = 0; i < 2; i++) {
        vec3 c0 = unbendQ(eyeC(i)) - vec3(0.0, 0.0, (1.0 - es) * 0.12);
        float te = rayEll(rob, rdb, c0, vec3(ER * es, ER * blinkS * es, ER * 0.92 * es));
        if (te > 0.0 && te < tEye) { tEye = te; eyeI = i; }
      }
    }
    if (tShell > 0.0 || tEye < 1e8) {
      if (tShell < 0.0) tShell = tEye;
      float stp = max(H, 0.02) / 11.0;
      float tt = tShell + stp * hash2(gl_FragCoord.xy * 0.731 + 3.1);
      bool hitBody = false; vec3 qHit = vec3(0.0);
      bool ctx = false;
      vec3 N = vec3(0.0, 0.0, 1.0); float sh = 1.0, ao = 1.0;
      vec3 lightA = vec3(0.0), sssC = vec3(0.0); float rimB = 0.0, specB = 0.0;
      float patchK = 0.0, blushK = 0.0, mK = 0.0, eyeLift = 0.0;
      vec3 V = -rd;
      int nIt = fur > 0.02 ? 170 : 40;
      float dE = 0.0, tE = -1.0, slope = 0.0; int iE = 0;
      for (int i = 0; i < 170; i++) {
        if (i >= nIt || tt > tEye) break;
        vec3 q = bendQ(rob + rdb * tt);
        float d;
        if (i - iE >= 3 || tE < 0.0) { float dn = sdBody(q); if (tE >= 0.0) slope = (dn - dE) / max(tt - tE, 1e-5); dE = dn; tE = tt; iE = i; d = dn; }
        else d = dE + slope * (tt - tE);
        if (d < 0.0) { hitBody = true; qHit = q; break; }
        float L = H * furLen(q);
        if (d < L) {
          if (!ctx) {
            N = bodyNormal(q); vec3 qr = q - N * d;
            sh = softShadow(qr, LK);
            ao = clamp(0.45 + 0.55 * (0.5 * sdBody(qr + N * 0.18) / 0.18 + 0.5 * sdBody(qr + N * 0.4) / 0.4), 0.0, 1.0);
            float ndl = dot(N, LK);
            float wrapK = clamp((ndl + 0.55) / 1.55, 0.0, 1.0) * mix(0.45, 1.0, sh) * mix(0.78, 1.0, ao);
            float wrapF = clamp((dot(N, LF) + 0.5) / 1.5, 0.0, 1.0);
            rimB = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0) * smoothstep(-0.2, 0.6, dot(-V, LB) + 0.4);
            vec3 Hk = normalize(LK + V);
            float kk = sqrt(max(0.0, 1.0 - pow(dot(N, Hk), 2.0)));
            specB = pow(kk, 24.0) * 0.2 * sh;
            vec3 amb = mix(vec3(0.075, 0.06, 0.10), vec3(0.14, 0.13, 0.16), 0.5 + 0.5 * N.y) * mix(0.6, 1.0, ao);
            lightA = amb + CK * wrapK * 0.95 + CF * wrapF;
            sssC = vec3(0.66, 0.5, 1.0) * 0.24 * (1.0 - wrapK);
            patchK = smoothstep(0.42, 0.85, qr.z) * (1.0 - smoothstep(0.08, 0.55, abs(qr.y + 0.36) * 0.95 + abs(qr.x) * 0.5));
            for (int k = 0; k < 2; k++) {
              vec3 ch = qr - vec3(k == 0 ? -0.58 : 0.58, -0.25, 0.72);
              blushK = max(blushK, 1.0 - smoothstep(0.03, 0.2, length(ch * vec3(1.0, 1.45, 1.0))));
            }
            for (int k = 0; k < 2; k++) eyeLift = max(eyeLift, 1.0 - smoothstep(ER * 1.0, ER * 1.5, length(qr - eyeC(k))));
            eyeLift *= uEyes;
            mK = mouth(qr) * uEyes;
            ctx = true;
          }
          float u = d / max(L, 1e-4);
          // comb: gravity, a cowlick on the tuft, secondary motion, impact ripples
          float tuftK = smoothstep(0.75, 1.35, q.y);
          vec3 g = normalize(mix(vec3(0.0, -1.0, 0.0), vec3(1.0, 0.35, 0.0), tuftK)) + uFlow;
          vec3 dq = normalize(q - vec3(0.0, 0.1, 0.0));
          if (uRipple.w >= 0.0) {
            float ang = acos(clamp(dot(dq, uRipple.xyz), -1.0, 1.0));
            float wave = sin(ang * 9.0 - uRipple.w * 16.0) * exp(-uRipple.w * 2.2) * smoothstep(uRipple.w * 3.2 + 0.4, uRipple.w * 3.2 - 0.2, ang);
            g += normalize(dq - uRipple.xyz * dot(dq, uRipple.xyz) + 1e-4) * wave * 1.4;
          }
          if (uRipple2.w >= 0.0) {
            float ang = acos(clamp(dot(dq, uRipple2.xyz), -1.0, 1.0));
            float wave = sin(ang * 9.0 - uRipple2.w * 16.0) * exp(-uRipple2.w * 2.2) * smoothstep(uRipple2.w * 3.2 + 0.4, uRipple2.w * 3.2 - 0.2, ang);
            g += normalize(dq - uRipple2.xyz * dot(dq, uRipple2.xyz) + 1e-4) * wave * 1.4;
          }
          // around the eyes the strands lean away from the eye (like lashes), so the eye stays clear
          for (int k = 0; k < 2; k++) { vec3 de = q - eyeC(k); float w = (1.0 - smoothstep(ER * 0.9, ER * 1.7, length(de))) * uEyes; g = mix(g, normalize(de) * 1.6, w); }
          vec3 ct = g - N * dot(N, g);
          vec2 s = strandUV(q + ct * (0.12 + 0.14 * tuftK) * u * u);
          // clumping: strand tips converge on clump centres
          vec2 cs = s * 36.0; vec2 ci = floor(cs);
          vec2 cc = (ci + 0.5 + 0.45 * (vec2(hash2(ci), hash2(ci + 17.3)) - 0.5)) / 36.0;
          vec2 s2 = mix(s, cc, 0.38 * u * u);
          float n = noiseT(s2);
          float clump = noiseT(s * 0.11 + 0.37);
          float len = 0.4 + 0.6 * n * (0.75 + 0.45 * clump);
          float dens = smoothstep(u - 0.05, u + 0.03, len);
          if (uFur < 0.7) { float grow = clamp(uFur / 0.7, 0.0, 1.0); dens *= smoothstep(1.0 - grow, 1.0 - grow + 0.2, noiseT(s * 0.5 + 0.71)); }
          float m = mK;
          if (dens > 0.001 || m > 0.0) {
            float gw = clamp(uFur, 0.0, 1.0);
            vec3 root = mix(vec3(0.72, 0.63, 0.91), vec3(0.36, 0.28, 0.56), gw * gw), mid = vec3(0.79, 0.70, 0.96), tip = vec3(0.96, 0.93, 1.0);
            vec3 col = mix(root, mid, smoothstep(0.0, 0.55, u));
            col = mix(col, tip, smoothstep(0.45, 1.0, u));
            col *= 0.86 + 0.28 * n;
            col = mix(col, col * vec3(1.04, 1.04, 1.06) + vec3(0.07, 0.07, 0.09), 0.7 * patchK * (0.3 + 0.7 * u));
            col = mix(col, col + vec3(0.04, 0.03, 0.07), eyeLift * (1.0 - u) * 0.6);
            col = mix(col, vec3(1.0, 0.5, 0.5), 0.55 * blushK);
            col = mix(col, vec3(0.13, 0.09, 0.2), m);
            dens = max(dens, m);
            float selfOcc = mix(mix(0.8, 0.36, gw * gw), 1.0, u * u);
            vec3 lit = col * (lightA + sssC * u) * selfOcc + CB * rimB * 0.9 * u * (0.6 + 0.4 * n) + CK * specB * u;
            lit += uGlow * vec3(0.78, 0.64, 1.0) * 0.45 * (1.0 - u * 0.6) * selfOcc;
            float a = clamp(dens * 0.5, 0.0, 1.0);
            acc.rgb += (1.0 - acc.a) * a * lit;
            acc.a += (1.0 - acc.a) * a;
            if (acc.a > 0.985) break;
          }
        }
        tt += stp * (d > H * 2.7 ? 3.0 : 1.0);
        if (tt > tEnd) break;
      }
      if (tEye < 1e8 && acc.a < 0.985 && !hitBody) {
        vec3 qe = rob + rdb * tEye; vec3 c0 = unbendQ(eyeC(eyeI)) - vec3(0.0, 0.0, (1.0 - es) * 0.12);
        vec3 ne = normalize((qe - c0) / vec3(ER * ER, ER * blinkS * ER * blinkS, ER * ER * 0.85));
        vec3 col = eyeShade(ne, -rd, eyeI);
        acc.rgb += (1.0 - acc.a) * col; acc.a = 1.0;
      }
      if (hitBody && acc.a < 0.985) {
        vec3 Nb = bodyNormal(qHit);
        float shb = fur < 0.6 ? softShadow(qHit + Nb * 0.01, LK) : 1.0;
        float wk = clamp((dot(Nb, LK) + 0.6) / 1.6, 0.0, 1.0);
        vec3 skin = vec3(0.30, 0.24, 0.48) * (0.12 + 0.7 * wk);
        vec3 liquid = irisBody(Nb, -rd, shb) + uGlow * vec3(0.75, 0.6, 1.0) * 0.3;
        vec3 col = mix(liquid, skin, smoothstep(0.0, 0.55, fur));
        acc.rgb += (1.0 - acc.a) * col; acc.a = 1.0;
      }
    }
  }
  if (acc.a < 0.999 && rd.y < 0.0) {
    float tf = (-1.0 - ro.y) / rd.y;
    vec3 pf = ro + rd * tf;
    float dB = sdBody(bendQ(toBody(pf + vec3(0.0, 0.02, 0.0))));
    float lift = clamp(uLift / 0.8, 0.0, 1.0);
    float shA = (0.5 * (1.0 - smoothstep(-0.05, 0.75 + lift * 0.4, dB)) + 0.38 * (1.0 - smoothstep(0.0, 0.14 + lift * 0.3, dB)) * (1.0 - lift)) * (1.0 - 0.6 * lift);
    acc.a += (1.0 - acc.a) * clamp(shA, 0.0, 0.9);
  }
  fragColor = vec4(acc.rgb, acc.a);
}
