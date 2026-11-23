/*!
 * IRAI hero swarm — "Swarms of societies of swarms."
 * WebGL2 GPGPU particle swarm, cursor-driven fluid, calm ASCII phosphor post-process, and a crisp vector
 * overlay (truth crosshair, crowd-average ring, error vector, agent dots, labels) drawn at device resolution.
 * Classic script. Requires three.js r150 (global THREE). Exposes window.IraiSwarm:
 *   IraiSwarm.create(canvas, { rho = 0.25, agents = 1000, reducedMotion, focus = [0.5, 0.5], radius = 0.42,
 *                              labels = { truth: 'truth', crowd: 'crowd average' } })
 *     -> controller | null
 *   controller.setRho(0..0.95), setAgents(10|100|1000), setFocus(x, y[, radius]), setLabels({ truth, crowd }),
 *     refreshLabels() (re-rasterise after web fonts load), pause(), resume(), destroy()
 *   focus: fractions of the canvas CSS box (from top-left) where the global centroid appears.
 *   radius: fraction of the canvas CSS height the swarm's ~95th-percentile extent fits within at every rho
 *     (low rho fills it, monoculture clumps to about half); density fades softly past it.
 */
(function () {
  'use strict';

  var MAX_AGENTS = 1000;
  var RAMP = ' .\u00B7:+*#%@';           // calm glyph ramp ( .·:+*#%@), ascending ink
  var FONT = '"JetBrains Mono","IBM Plex Mono","SFMono-Regular",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace';
  var LABEL_FONT = '"JetBrains Mono", ui-monospace, "Noto Sans SC", "Noto Sans JP", sans-serif';
  var TILE_W = 48, TILE_H = 72;
  var DEFAULT_LABELS = { truth: 'truth', crowd: 'crowd average' };

  // ---------------------------------------------------------------- shaders
  var HEAD = 'precision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
  var FRAG_HEAD = HEAD + 'out vec4 O;\n';

  var FS_VERT = HEAD + [
    'in vec2 position;',
    'out vec2 vUv;',
    'void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }'
  ].join('\n');

  var COPY_FRAG = FRAG_HEAD + [
    'uniform sampler2D uTex; in vec2 vUv;',
    'void main(){ O = texture(uTex, vUv); }'
  ].join('\n');

  // --- fluid (after Pavel Dobryakov's WebGL fluid simulation, MIT)
  var SPLAT_FRAG = FRAG_HEAD + [
    'uniform sampler2D uTarget; uniform float uAspect, uRadius; uniform vec3 uColor; uniform vec2 uA, uB;',
    'in vec2 vUv;',
    'void main(){',
    '  vec2 pa = vUv - uA, ba = uB - uA; pa.x *= uAspect; ba.x *= uAspect;',
    '  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);',
    '  vec2 d = pa - ba * h;',
    '  O = vec4(texture(uTarget, vUv).xyz + exp(-dot(d, d) / uRadius) * uColor, 1.0);',
    '}'
  ].join('\n');

  var NB = [
    'uniform vec2 uTexel; in vec2 vUv;',
    'vec2 vL(){ return vUv - vec2(uTexel.x, 0.0); } vec2 vR(){ return vUv + vec2(uTexel.x, 0.0); }',
    'vec2 vT(){ return vUv + vec2(0.0, uTexel.y); } vec2 vB(){ return vUv - vec2(0.0, uTexel.y); }'
  ].join('\n');

  var CURL_FRAG = FRAG_HEAD + NB + '\n' + [
    'uniform sampler2D uVelocity;',
    'void main(){',
    '  float L = texture(uVelocity, vL()).y, R = texture(uVelocity, vR()).y;',
    '  float T = texture(uVelocity, vT()).x, B = texture(uVelocity, vB()).x;',
    '  O = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var VORT_FRAG = FRAG_HEAD + NB + '\n' + [
    'uniform sampler2D uVelocity, uCurl; uniform float uCurlStrength, uDt;',
    'void main(){',
    '  float L = texture(uCurl, vL()).x, R = texture(uCurl, vR()).x;',
    '  float T = texture(uCurl, vT()).x, B = texture(uCurl, vB()).x, C = texture(uCurl, vUv).x;',
    '  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
    '  f /= length(f) + 1e-4; f *= uCurlStrength * C; f.y = -f.y;',
    '  vec2 v = texture(uVelocity, vUv).xy + f * uDt;',
    '  O = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);',
    '}'
  ].join('\n');

  var DIV_FRAG = FRAG_HEAD + NB + '\n' + [
    'uniform sampler2D uVelocity;',
    'void main(){',
    '  vec2 l = vL(), r = vR(), t = vT(), b = vB();',
    '  float L = texture(uVelocity, l).x, R = texture(uVelocity, r).x;',
    '  float T = texture(uVelocity, t).y, B = texture(uVelocity, b).y;',
    '  vec2 C = texture(uVelocity, vUv).xy;',
    '  if (l.x < 0.0) L = -C.x; if (r.x > 1.0) R = -C.x;',
    '  if (t.y > 1.0) T = -C.y; if (b.y < 0.0) B = -C.y;',
    '  O = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var CLEAR_FRAG = FRAG_HEAD + [
    'uniform sampler2D uTex; uniform float uValue; in vec2 vUv;',
    'void main(){ O = uValue * texture(uTex, vUv); }'
  ].join('\n');

  var PRESSURE_FRAG = FRAG_HEAD + NB + '\n' + [
    'uniform sampler2D uPressure, uDivergence;',
    'void main(){',
    '  float L = texture(uPressure, vL()).x, R = texture(uPressure, vR()).x;',
    '  float T = texture(uPressure, vT()).x, B = texture(uPressure, vB()).x;',
    '  float d = texture(uDivergence, vUv).x;',
    '  O = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var GRAD_FRAG = FRAG_HEAD + NB + '\n' + [
    'uniform sampler2D uPressure, uVelocity;',
    'void main(){',
    '  float L = texture(uPressure, vL()).x, R = texture(uPressure, vR()).x;',
    '  float T = texture(uPressure, vT()).x, B = texture(uPressure, vB()).x;',
    '  vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B);',
    '  O = vec4(v, 0.0, 1.0);',
    '}'
  ].join('\n');

  var ADVECT_FRAG = FRAG_HEAD + [
    'uniform sampler2D uVelocity, uSource; uniform vec2 uTexel; uniform float uDt, uDissipation; in vec2 vUv;',
    'void main(){',
    '  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;',
    '  O = uDissipation * texture(uSource, coord);',
    '}'
  ].join('\n');

  // --- particle simulation
  // particle role from its hash: x = 1 for the diffuse field orbiting the centroid, y = position along
  // its society's trail (0 = in the head clump, 1 = oldest point of the trail)
  var ROLE = [
    'vec2 role(float w){',
    '  float fld = step(fract(w * 7.31), 0.12);',
    '  float h = fract(w * 29.7);',
    '  return vec2(fld, h < 0.6 ? 0.0 : pow((h - 0.6) / 0.4, 1.2) * (1.0 - fld));',
    '}'
  ].join('\n');

  var SIM_COMMON = [
    // divergence-free turbulence: curl of a sum of plane-wave vector potentials
    'vec3 curlWave(vec3 q, vec3 a, vec3 b, vec3 c, vec3 ph){',
    '  float Cx = cos(dot(a, q) + ph.x), Cy = cos(dot(b, q) + ph.y), Cz = cos(dot(c, q) + ph.z);',
    '  return vec3(c.y * Cz - b.z * Cy, a.z * Cx - c.x * Cz, b.x * Cy - a.y * Cx);',
    '}',
    'vec3 turbulence(vec3 p, float t, float ph){',
    '  vec3 r = curlWave(p, vec3(1.0, 0.6, -0.4), vec3(-0.5, 1.1, 0.7), vec3(0.8, -0.3, 1.2), vec3(0.7 * t + ph, 0.5 * t + 1.3 * ph, -0.6 * t + 0.7 * ph));',
    '  r += 0.55 * curlWave(p * 2.3 + 3.1, vec3(-0.9, 0.4, 1.0), vec3(0.6, -1.2, 0.3), vec3(1.1, 0.7, -0.5), vec3(-0.9 * t + 2.0 * ph, 1.1 * t - ph, 0.8 * t + 0.4 * ph));',
    '  r += 0.3 * curlWave(p * 4.7 + 7.7, vec3(0.3, 1.0, -0.8), vec3(1.0, 0.2, 0.9), vec3(-0.7, 1.0, 0.4), vec3(1.7 * t + ph, -1.3 * t + 0.5 * ph, 1.5 * t - 1.7 * ph));',
    '  return r;',
    '}'
  ].join('\n');

  var VEL_FRAG = FRAG_HEAD + SIM_COMMON + '\n' + ROLE + '\n' + [
    'uniform sampler2D uPos, uVel, uInfo, uCent, uHist, uFluidVel, uFluidDye;',
    'uniform float uDt, uTime, uK, uDrag, uTurb, uLock, uNoiseFreq, uFluidForce, uOrbitV, uFieldR, uTrail, uHistA1, uHistDt;',
    'uniform int uNSub, uHistN;',
    'uniform mat4 uViewProj; uniform vec3 uCamRight, uCamUp, uSharedN, uPivot;',
    'void main(){',
    '  ivec2 ij = ivec2(gl_FragCoord.xy);',
    '  vec4 P = texelFetch(uPos, ij, 0), V = texelFetch(uVel, ij, 0), I = texelFetch(uInfo, ij, 0);',
    '  vec3 p = P.xyz, v = V.xyz;',
    '  vec2 ro = role(I.w);',
    '  float breathe = 1.0 + 0.18 * sin(uTime * 0.9 + I.x * 2.1 + I.w * 6.2831);',
    '  vec3 jit = vec3(fract(I.w * 127.1), fract(I.w * 311.7), fract(I.w * 74.7)) - 0.5;',
    '  vec3 anchor = uPivot, av = vec3(0.0), axis; float r0, spin;',
    '  if (ro.x > 0.5) {',
    // diffuse field: thin shells around the centroid with centre-weighted radii, circulating with the
    // shared sense of rotation on varied inclinations; a few stragglers counter-rotate until lockstep
    '    r0 = uFieldR * (0.02 + pow(I.z, 2.6)) * (0.92 + 0.08 * breathe);',
    '    float sg = fract(I.w * 5.17) < 0.14 ? mix(-1.0, 1.0, uLock) : 1.0;',
    '    axis = normalize(uSharedN * sg + jit * 1.1 * (1.0 - 0.7 * uLock) + vec3(1e-3));',
    '    spin = uOrbitV / (r0 + 1.0);',
    '  } else {',
    '    int soc = int(I.x), si = soc * uNSub + int(I.y);',
    '    vec4 C = texelFetch(uCent, ivec2(si, 0), 0), A = texelFetch(uCent, ivec2(si, 1), 0);',
    '    anchor = C.xyz; av = texelFetch(uCent, ivec2(si, 2), 0).xyz;',
    '    if (ro.y > 0.0) {',
    // trail: follow the society's recent path, sub-swarm offsets narrowing toward the tail
    '      float age = ro.y * uTrail;',
    '      float x = min(age < uHistA1 ? age / uHistA1 : 1.0 + (age - uHistA1) / uHistDt, float(uHistN) - 1.001);',
    '      int k = int(x);',
    '      vec3 h0 = texelFetch(uHist, ivec2(k, soc), 0).xyz, h1 = texelFetch(uHist, ivec2(k + 1, soc), 0).xyz;',
    '      anchor = mix(h0, h1, x - float(k)) + (C.xyz - texelFetch(uHist, ivec2(0, soc), 0).xyz) * (1.0 - 0.9 * sqrt(ro.y));',
    '      if (k > 0) av = (h0 - h1) / uHistDt;',
    '    }',
    '    r0 = C.w * (0.3 + 0.7 * pow(I.z, 0.3333)) * breathe * (1.0 - 0.85 * sqrt(ro.y));',
    // individual swirl axis around the shared sub-swarm axis (boids-like alignment)
    '    axis = normalize(A.xyz + jit * 1.1 * (1.0 - 0.6 * uLock));',
    '    spin = A.w * (0.55 + 0.9 * fract(I.w * 13.3));',
    '  }',
    '  vec3 rel = p - anchor; float dist = length(rel) + 1e-5; vec3 n = rel / dist;',
    '  vec3 f = -n * (dist - r0) * uK;',
    '  vec3 vT = cross(axis, rel) * spin;',
    '  float vl = length(vT); if (vl > 2.2) vT *= 2.2 / vl;',
    // drag toward the swirl measured in the anchor's moving frame, so clumps keep their shape in orbit
    '  f += (vT + av - v) * uDrag;',
    '  float ph = I.x * 1.731 * (1.0 - uLock) + I.y * 0.37;',
    '  f += turbulence(p * uNoiseFreq, uTime * 0.35, ph) * uTurb * (1.0 - 0.8 * ro.y);',
    // cursor fluid: project to screen, push along camera plane, masked by dye density
    '  vec4 clip = uViewProj * vec4(p, 1.0);',
    '  float excite = V.w * exp(-uDt * 1.6);',
    '  if (clip.w > 0.01) {',
    '    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;',
    '    if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {',
    '      vec2 fv = texture(uFluidVel, suv).xy;',
    '      float m = clamp(texture(uFluidDye, suv).r, 0.0, 1.0);',
    '      f += (uCamRight * fv.x + uCamUp * fv.y) * uFluidForce * m;',
    '      excite = max(excite, m * min(length(fv) * 0.01, 1.0));',
    '    }',
    '  }',
    '  v += f * uDt;',
    '  float sp = length(v); if (sp > 14.0) v *= 14.0 / sp;',
    '  O = vec4(v, excite);',
    '}'
  ].join('\n');

  var POS_FRAG = FRAG_HEAD + [
    'uniform sampler2D uPos, uVel; uniform float uDt;',
    'void main(){',
    '  ivec2 ij = ivec2(gl_FragCoord.xy);',
    '  vec4 P = texelFetch(uPos, ij, 0);',
    '  O = vec4(P.xyz + texelFetch(uVel, ij, 0).xyz * uDt, P.w);',
    '}'
  ].join('\n');

  var MEAN_FRAG = FRAG_HEAD + [
    // crowd estimate = mean of agent positions + shared (correlated) error, eased over time;
    // w = eased side of the crowd relative to the truth on screen (-1 left, +1 right), with hysteresis,
    // so the overlay labels sit on the outer sides without flickering
    'uniform sampler2D uPos, uAgents, uPrev; uniform int uN; uniform vec3 uErr; uniform float uBlend, uSideBlend, uHyst;',
    'uniform mat4 uViewProj;',
    'void main(){',
    '  vec3 s = vec3(0.0);',
    '  for (int i = 0; i < ' + MAX_AGENTS + '; i++) {',
    '    if (i >= uN) break;',
    '    s += texelFetch(uPos, ivec2(texelFetch(uAgents, ivec2(i, 0), 0).xy), 0).xyz;',
    '  }',
    '  vec4 prev = texelFetch(uPrev, ivec2(0), 0);',
    '  vec3 m = mix(prev.xyz, s / float(max(uN, 1)) + uErr, uBlend);',
    '  vec4 c = uViewProj * vec4(m, 1.0), t = uViewProj * vec4(0.0, 0.0, 0.0, 1.0);',
    '  float dx = c.x / max(c.w, 1e-3) - t.x / max(t.w, 1e-3);',
    '  float side = dx > uHyst ? 1.0 : (dx < -uHyst ? -1.0 : (prev.w < 0.0 ? -1.0 : 1.0));',
    '  O = vec4(m, mix(prev.w, side, uSideBlend));',
    '}'
  ].join('\n');

  // --- rendering
  var POINT_FRAG = FRAG_HEAD + [
    'in vec3 vColor;',
    'void main(){',
    '  vec2 q = gl_PointCoord - 0.5; float d = dot(q, q) * 4.0;',
    '  if (d > 1.0) discard;',
    '  float a = (1.0 - d); a *= a;',
    '  O = vec4(vColor * a, 1.0);',
    '}'
  ].join('\n');

  var PARTICLE_VERT = HEAD + ROLE + '\n' + [
    'in float position;',
    'uniform mat4 modelViewMatrix, projectionMatrix;',
    'uniform sampler2D uPos, uVel, uInfo; uniform int uSize;',
    'uniform float uPointScale, uIntensity;',
    'uniform vec3 uColor;',
    'out vec3 vColor;',
    'void main(){',
    '  ivec2 ij = ivec2(gl_VertexID % uSize, gl_VertexID / uSize);',
    '  vec3 p = texelFetch(uPos, ij, 0).xyz; vec4 V = texelFetch(uVel, ij, 0);',
    '  float r = texelFetch(uInfo, ij, 0).w;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float sz = uPointScale * (0.6 + 1.1 * fract(r * 91.7)) / max(-mv.z, 0.1);',
    // pushed particles (fluid excitation) glow brighter, so the cursor wake reads in the ASCII
    '  float inten = uIntensity * (0.75 + 0.2 * min(length(V.xyz), 3.0) + 2.0 * V.w);',
    '  vec2 ro = role(r);',
    '  inten *= ro.x > 0.5 ? 1.1 : (ro.y > 0.0 ? 1.6 - 0.9 * ro.y : 1.5);',
    '  vColor = uColor * inten;',
    '  gl_PointSize = clamp(sz, 1.0, 10.0);',
    '}'
  ].join('\n');

  var CELLS_FRAG = FRAG_HEAD + [
    'uniform sampler2D uScene; uniform vec2 uCellPx, uScreen;',
    'void main(){',
    '  vec2 base = floor(gl_FragCoord.xy) * uCellPx;',
    '  vec3 sum = vec3(0.0); float mx = 0.0;',
    '  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {',
    '    vec3 s = texture(uScene, (base + (vec2(i, j) + 0.5) * 0.25 * uCellPx) / uScreen).rgb;',
    '    sum += s; mx = max(mx, dot(s, vec3(0.3, 0.5, 0.2)));',
    '  }',
    '  O = vec4(sum / 16.0, mx);',
    '}'
  ].join('\n');

  var DOWN_FRAG = FRAG_HEAD + [
    'uniform sampler2D uTex; uniform vec2 uTexel; in vec2 vUv;',
    'void main(){',
    '  O = 0.25 * (texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, -1.0))',
    '            + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, 1.0)));',
    '}'
  ].join('\n');

  var BLUR_FRAG = FRAG_HEAD + [
    'uniform sampler2D uTex; uniform vec2 uDir; in vec2 vUv;',
    'void main(){',
    '  vec4 s = texture(uTex, vUv) * 0.2270270270;',
    '  s += (texture(uTex, vUv + uDir * 1.3846153846) + texture(uTex, vUv - uDir * 1.3846153846)) * 0.3162162162;',
    '  s += (texture(uTex, vUv + uDir * 3.2307692308) + texture(uTex, vUv - uDir * 3.2307692308)) * 0.0702702703;',
    '  O = s;',
    '}'
  ].join('\n');

  // the swarm body: one glyph per cell from a short ramp, glyph and brightness stepping together
  var ASCII_FRAG = FRAG_HEAD + [
    'uniform sampler2D uCells, uAtlas, uBloom;',
    'uniform vec2 uCellPx, uScreen, uTruth;',
    'uniform float uRampN, uBloomAmt, uExposure, uFadeR;',
    'uniform vec3 uDim, uHoney, uHot, uBg;',
    'void main(){',
    '  vec2 fc = gl_FragCoord.xy, cf = fc / uCellPx;',
    '  ivec2 cell = ivec2(floor(cf));',
    '  vec2 local = cf - floor(cf);',
    '  vec4 C = texelFetch(uCells, cell, 0);',
    // part peak, part mean: thin orbit streams still register, not just filled clumps
    '  float lum = mix(dot(C.rgb, vec3(0.3, 0.5, 0.2)), C.a, 0.3);',
    // soft density falloff toward the framing radius around the global centroid
    '  lum *= 1.0 - smoothstep(0.85, 1.15, length((vec2(cell) + 0.5) * uCellPx - uTruth) / uFadeR);',
    '  float L = 1.0 - exp(-lum * uExposure);',
    // sparse haze below the first level stays blank so the swarm keeps its shape
    '  int g = L > 0.12 ? 1 + int(clamp((L - 0.12) / 0.8, 0.0, 1.0) * (uRampN - 1.001)) : 0;',
    '  float t = float(g) / (uRampN - 1.0);',
    '  vec3 col = mix(uDim, uHoney, smoothstep(0.0, 0.8, t));',
    '  col = mix(col, uHot, 0.3 * smoothstep(0.75, 1.0, t));',
    '  float m = 0.0;',
    '  if (g > 0) {',
    '    vec2 l = clamp(local, 0.015, 0.985);',
    '    vec2 auv = vec2((float(g) + l.x) / uRampN, 1.0 - l.y);',
    '    m = textureGrad(uAtlas, auv, vec2(1.0 / (uCellPx.x * uRampN), 0.0), vec2(0.0, 1.0 / uCellPx.y)).r;',
    '  }',
    '  vec3 bl = texture(uBloom, fc / uScreen).rgb * (1.0 - smoothstep(0.8, 1.2, length(fc - uTruth) / uFadeR));',
    '  vec3 outc = bl / (1.0 + bl) * uBloomAmt + col * m;',
    '  vec2 uv = fc / uScreen - 0.5; uv.x *= uScreen.x / uScreen.y;',
    '  O = vec4(uBg + outc * mix(0.55, 1.0, smoothstep(1.15, 0.3, length(uv))), 1.0);',
    '}'
  ].join('\n');

  // --- vector overlay: one instanced quad per mark, positioned from the GPU state (no readback).
  // Instance 0 = error vector, 1..N = agents, then crowd ring, truth crosshair, truth label, crowd label.
  var OVERLAY_VERT = HEAD + [
    'in vec2 position; in float aId;',
    'uniform sampler2D uPos, uAgents, uMean;',
    'uniform mat4 uViewProj;',
    'uniform vec2 uScreen, uLabSizeT, uLabSizeC;',
    'uniform vec4 uLabUvT, uLabUvC;',
    'uniform float uPR, uN, uDotR, uDotA, uFadeR, uArm, uRingR;',
    'out vec2 vP, vUv; out float vLen, vA; flat out int vKind;',
    'vec2 scr(vec3 p){ vec4 c = uViewProj * vec4(p, 1.0); return (c.xy / max(c.w, 1e-3) * 0.5 + 0.5) * uScreen; }',
    'void main(){',
    '  int id = int(aId + 0.5), n = int(uN + 0.5), kind;',
    '  vec2 truth = scr(vec3(0.0));',
    '  vec4 M = texelFetch(uMean, ivec2(0), 0);',
    '  vec2 crowd = scr(M.xyz);',
    '  float side = clamp(M.w, -1.0, 1.0), pad = 3.0 * uPR, gap = 6.0 * uPR;',
    '  vec2 c, h, ax = vec2(1.0, 0.0);',
    '  vA = 1.0; vLen = 0.0; vUv = vec2(0.0);',
    '  if (id == 0) {',
    '    kind = 3;',
    '    vec2 d = crowd - truth; vLen = length(d);',
    '    if (vLen > 1e-3) ax = d / vLen;',
    '    c = 0.5 * (truth + crowd); h = vec2(0.5 * vLen, pad);',
    '  } else if (id <= n) {',
    '    kind = 0;',
    '    c = scr(texelFetch(uPos, ivec2(texelFetch(uAgents, ivec2(id - 1, 0), 0).xy), 0).xyz);',
    '    h = vec2(uDotR + pad);',
    '    vA = uDotA * mix(0.35, 1.0, 1.0 - smoothstep(0.9, 1.25, length(c - truth) / uFadeR));',
    '  } else if (id == n + 1) {',
    '    kind = 2; c = crowd; h = vec2(uRingR + pad);',
    '  } else if (id == n + 2) {',
    '    kind = 1; c = truth; h = vec2(uArm + pad);',
    '  } else {',
    // labels on the outer sides (truth away from the crowd, crowd beyond its ring); while the crowd
    // crosses over the truth they swing round below/above instead of sliding through the marks
    '    bool isT = id == n + 3;',
    '    kind = isT ? 4 : 5;',
    '    vec2 sz = isT ? uLabSizeT : uLabSizeC;',
    '    float lift = 1.0 - abs(side);',
    '    c = isT ? truth + vec2(-side * (uArm + gap + 0.5 * sz.x), -lift * (uArm + gap + 0.5 * sz.y))',
    '            : crowd + vec2(side * (uRingR + gap + 0.5 * sz.x), lift * (uRingR + gap + 0.5 * sz.y));',
    '    c.x = clamp(c.x, 0.5 * sz.x + gap, uScreen.x - 0.5 * sz.x - gap);',
    '    c = floor(c - 0.5 * sz + 0.5) + 0.5 * sz;',
    '    h = 0.5 * sz;',
    '    vec4 r = isT ? uLabUvT : uLabUvC;',
    '    vUv = vec2(mix(r.x, r.z, position.x * 0.5 + 0.5), mix(r.w, r.y, position.y * 0.5 + 0.5));',
    '  }',
    '  vKind = kind;',
    '  vP = position * h;',
    '  vec2 px = c + ax * vP.x + vec2(-ax.y, ax.x) * vP.y;',
    '  gl_Position = vec4(px / uScreen * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  // anti-aliased SDF marks with a thin dark halo so they separate from the glyphs; premultiplied output
  var OVERLAY_FRAG = FRAG_HEAD + [
    'uniform sampler2D uLabels;',
    'uniform vec3 uInk, uHoney, uBg;',
    'uniform float uPR, uArm, uRingR, uStroke, uDotR;',
    'in vec2 vP, vUv; in float vLen, vA; flat in int vKind;',
    'float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }',
    'void main(){',
    '  if (vKind >= 4) { O = texture(uLabels, vUv); return; }',
    '  float d, a = vA, w = 0.5 * uStroke; vec3 col = uInk;',
    '  if (vKind == 0) { d = length(vP) - uDotR; col = uHoney; }',
    '  else if (vKind == 1) d = min(box(vP, vec2(uArm, w)), box(vP, vec2(w, uArm)));',
    '  else if (vKind == 2) d = abs(length(vP) - uRingR) - w;',
    '  else {',
    // dashed error vector from the crosshair to the ring, hidden while they overlap
    '    float s = vP.x + 0.5 * vLen, s0 = uArm + 4.0 * uPR, s1 = vLen - uRingR - 4.0 * uPR;',
    '    float per = 7.0 * uPR, on = 3.5 * uPR, u = mod(s - s0, per);',
    '    float dash = u <= on ? max(u - on, -u) : min(u - on, per - u);',
    '    d = max(max(abs(vP.y) - 0.7 * w, dash), max(s0 - s, s - s1));',
    '    a *= 0.85 * smoothstep(0.0, 6.0 * uPR, s1 - s0);',
    '  }',
    '  float cov = clamp(0.5 - d, 0.0, 1.0);',
    '  float halo = 0.65 * clamp(0.5 - (d - 1.5 * uPR), 0.0, 1.0);',
    '  O = a * (vec4(uBg * halo, halo) * (1.0 - cov) + vec4(col, 1.0) * cov);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------- helpers
  function mulberry(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function randUnit(r) { var z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), z, s * Math.sin(a)]; }
  function frame(n) {
    var u = norm(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n));
    return { n: n, u: u, w: cross(n, u) };
  }
  function smooth01(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

  // one row of ramp glyphs, white on black, sampled as coverage
  function buildAtlas() {
    var cv = document.createElement('canvas');
    cv.width = TILE_W * RAMP.length; cv.height = TILE_H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff';
    ctx.font = '600 ' + Math.round(TILE_H * 0.74) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 1; i < RAMP.length; i++) ctx.fillText(RAMP[i], (i + 0.5) * TILE_W, TILE_H * 0.53);
    return cv;
  }

  // Truth and crowd labels as two rows of a premultiplied texture at device resolution: light text on a
  // dark plate so they stay legible over the glyphs. Returns each label's uv rect and size in device px.
  function drawLabels(cv, labels, pr) {
    var fontPx = Math.round(11 * pr), padX = Math.round(5 * pr), padY = Math.round(3 * pr);
    var font = '500 ' + fontPx + 'px ' + LABEL_FONT;
    var ctx = cv.getContext('2d');
    var texts = [labels.truth, labels.crowd];
    ctx.font = font;
    var ws = texts.map(function (t) { return t ? Math.ceil(ctx.measureText(t).width) + 2 * padX : 0; });
    var h = fontPx + 2 * padY, rowH = h + 2;
    cv.width = Math.max(ws[0], ws[1], 1); cv.height = 2 * rowH;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    return texts.map(function (t, i) {
      var y = i * rowH;
      if (t) {
        ctx.fillStyle = 'rgba(5,6,10,0.8)'; ctx.fillRect(0, y, ws[i], h);
        ctx.fillStyle = '#E6E3D8'; ctx.fillText(t, padX, y + h / 2 + 0.06 * fontPx);
      }
      return { uv: [0, y / cv.height, ws[i] / cv.width, (y + h) / cv.height], size: [ws[i], t ? h : 0] };
    });
  }

  function cleanLabels(l, base) {
    l = l || {};
    return {
      truth: l.truth !== undefined && l.truth !== null ? String(l.truth) : base.truth,
      crowd: l.crowd !== undefined && l.crowd !== null ? String(l.crowd) : base.crowd
    };
  }

  // Chromium's SwiftShader context is not always reported as a performance caveat, so also
  // match the renderer string. Software rasterisers run the hero at a few fps.
  function isSoftwareRenderer(gl) {
    var d = gl.getExtension('WEBGL_debug_renderer_info');
    var r = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
    return /SwiftShader|llvmpipe|softpipe|Basic Render|WARP/i.test(r);
  }

  function releaseContext(gl) {
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }

  // ---------------------------------------------------------------- create
  function create(canvas, opts) {
    opts = opts || {};
    var THREE = window.THREE;
    if (!THREE || !canvas || typeof WebGL2RenderingContext === 'undefined') return null;
    var gl, renderer;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: true
      });
      if (!gl) return null;
      if (isSoftwareRenderer(gl)) { releaseContext(gl); return null; }
      if (!gl.getExtension('EXT_color_buffer_float')) return null;
      renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, antialias: false, alpha: false, depth: false, stencil: false });
      if (!renderer.capabilities.isWebGL2) { renderer.dispose(); return null; }
      return build(canvas, opts, THREE, gl, renderer);
    } catch (e) {
      if (renderer) { try { renderer.dispose(); } catch (e2) { /* ignore */ } }
      return null;
    }
  }

  function build(canvas, opts, THREE, gl, renderer) {
    var reducedMotion = opts.reducedMotion !== undefined ? !!opts.reducedMotion
      : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var SIZE = coarse ? 128 : 512;
    var COUNT = SIZE * SIZE;
    var NS = coarse ? 24 : 36;           // societies
    var NSUB = 4;                        // sub-swarms per society
    var NSS = NS * NSUB;
    var SIM_RES = 256, DYE_RES = 512;
    var PRESSURE_ITERS = coarse ? 8 : 14;
    var CELL_W = 6, CELL_H = 9;          // CSS px per ASCII cell (scaled by DPR)
    var FOV = 40, TAN_H = Math.tan(FOV * Math.PI / 360);
    var EXTENT_GAIN = 0.62;              // calibrates the CPU extent estimate to the rendered 95th percentile
    var ORBIT_V = 1.6;                   // orbital speed scale (world units/s); angular speed ~ ORBIT_V / (R + 1)
    var FIELD_R = 2.6;                   // outer shell radius of the diffuse field around the centroid
    var TRAIL = 3.0;                     // seconds of orbit each society trails behind its head clump
    var NH = 24, HIST_DT = TRAIL / (NH - 2); // society path history samples and their spacing (s)

    var disposables = [];
    function track(o) { disposables.push(o); return o; }

    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);

    var HF = THREE.HalfFloatType, FF = THREE.FloatType;
    function rt(w, h, type, filter) {
      return track(new THREE.WebGLRenderTarget(w, h, {
        type: type, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false
      }));
    }
    function doubleRT(w, h, type, filter) {
      var o = { read: rt(w, h, type, filter), write: rt(w, h, type, filter) };
      o.swap = function () { var t = o.read; o.read = o.write; o.write = t; };
      return o;
    }
    function dataTex(data, w, h) {
      var t = track(new THREE.DataTexture(data, w, h, THREE.RGBAFormat, FF));
      t.needsUpdate = true;
      return t;
    }
    function mat(frag, uniforms, extra) {
      var m = new THREE.RawShaderMaterial(Object.assign({
        glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: frag, uniforms: uniforms,
        depthTest: false, depthWrite: false
      }, extra || {}));
      return track(m);
    }
    function v3(hex) { var c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); }

    var COL = {
      honey: v3(0xF2B632), dim: v3(0x8A6A22), hot: v3(0xFFE7B3), ink: v3(0xE6E3D8), bg: v3(0x05060A)
    };

    // fullscreen pass plumbing
    var triGeo = track(new THREE.BufferGeometry());
    triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
    var fsMesh = new THREE.Mesh(triGeo);
    fsMesh.frustumCulled = false;
    var fsScene = new THREE.Scene(); fsScene.add(fsMesh);
    var fsCam = new THREE.Camera();
    function pass(material, target) {
      fsMesh.material = material;
      renderer.setRenderTarget(target);
      renderer.render(fsScene, fsCam);
    }

    // ------------------------------------------------------------ world (CPU)
    // Societies orbit the global centroid on tilted orbits with centre-weighted radii; most share one
    // sense of rotation about sharedN (mostly facing the camera, so the swirl reads on screen), a few
    // counter-rotate. Each odd society mirrors its even partner across the centroid, keeping it the mean.
    var rnd = mulberry(0x1A2A1);
    var socs = [], subs = [];
    var sharedN = norm([0.2, 0.45, 1]), sharedF = frame(sharedN);
    for (var i = 0; i < NS; i++) {
      var s;
      if (i & 1) {
        var m0 = socs[i - 1];
        s = { f: m0.f, R: m0.R, w: m0.w, th: m0.th + Math.PI, off: [-m0.off[0], -m0.off[1], -m0.off[2]], br: rnd() * 6.28 };
      } else {
        var dir = randUnit(rnd), sa = rnd() * Math.PI * 2, ol = 0.35 + 0.85 * rnd(), lift = (rnd() - 0.5) * 0.5;
        var R0 = 0.4 + 2.7 * Math.pow(rnd(), 1.4), ca = Math.cos(sa) * ol, sb = Math.sin(sa) * ol;
        s = {
          // inclinations spread up to ~55 degrees around the shared axis; ~12% counter-rotate
          f: frame(norm([dir[0] + 1.25 * sharedN[0], dir[1] + 1.25 * sharedN[1], dir[2] + 1.25 * sharedN[2]])),
          R: R0,
          w: ORBIT_V / (R0 + 1.0) * (0.8 + 0.4 * rnd()) * (rnd() < 0.12 ? -1 : 1),
          th: rnd() * Math.PI * 2,
          // monoculture slot: a disc in the shared plane, spun in lockstep
          off: [
            sharedF.u[0] * ca + sharedF.w[0] * sb + sharedN[0] * lift,
            sharedF.u[1] * ca + sharedF.w[1] * sb + sharedN[1] * lift,
            sharedF.u[2] * ca + sharedF.w[2] * sb + sharedN[2] * lift
          ],
          br: rnd() * 6.28
        };
      }
      s.pos = [0, 0, 0]; s.vel = [0, 0, 0];
      socs.push(s);
      for (var j = 0; j < NSUB; j++) {
        subs.push({
          f: frame(randUnit(rnd)), r: 0.26 + 0.3 * rnd(), w: (0.22 + 0.5 * rnd()) * (rnd() < 0.5 ? -1 : 1),
          th: rnd() * Math.PI * 2, shell: 0.15 + 0.14 * rnd(), swirl: (0.5 + 1.1 * rnd()) * (rnd() < 0.5 ? -1 : 1),
          axis: randUnit(rnd), br: rnd() * 6.28
        });
      }
    }
    var sharedW = 0.3, sharedTh = 0, sharedR = 0.7, sharedSpin = 0, sharedSpinW = 0.6;
    var pivot = [0, 0, 0];               // centre of the field: the centroid, drifting with the monoculture
    var centData = new Float32Array(NSS * 3 * 4);
    var centTex = dataTex(centData, NSS, 3);
    // society path history: column 0 = now, column k >= 1 = pushed (k - 1) * HIST_DT + histAge seconds ago
    var histData = new Float32Array(NS * NH * 4), histTex = dataTex(histData, NH, NS), histAge = 0, histFilled = false;

    function rotAxis(v, a, ang) { // Rodrigues
      var c = Math.cos(ang), sn = Math.sin(ang), d = (a[0] * v[0] + a[1] * v[1] + a[2] * v[2]) * (1 - c), cr = cross(a, v);
      return [v[0] * c + cr[0] * sn + a[0] * d, v[1] * c + cr[1] * sn + a[1] * d, v[2] * c + cr[2] * sn + a[2] * d];
    }

    // ~95th-percentile distance of the swarm from the global centroid (world units), from sub-swarm
    // centroids plus their shell and turbulence spread (in monoculture the vortex streams and the field
    // around the off-centre pivot widen it); drives the camera framing
    var extArr = new Float32Array(NSS), worldExt = 3.5;
    function updateWorld(dt, t, lock) {
      sharedTh += sharedW * dt;
      sharedSpin += sharedSpinW * dt;
      var sc = [
        sharedR * (sharedF.u[0] * Math.cos(sharedTh) + sharedF.w[0] * Math.sin(sharedTh)),
        sharedR * (sharedF.u[1] * Math.cos(sharedTh) + sharedF.w[1] * Math.sin(sharedTh)),
        sharedR * (sharedF.u[2] * Math.cos(sharedTh) + sharedF.w[2] * Math.sin(sharedTh))
      ];
      var i, j, k;
      for (k = 0; k < 3; k++) pivot[k] = sc[k] * lock;
      histAge += dt;
      var push = histFilled && histAge >= HIST_DT;
      if (push) histAge = histAge - HIST_DT < HIST_DT ? histAge - HIST_DT : 0;
      var va = 1 - Math.exp(-dt * 12);
      for (i = 0; i < NS; i++) {
        var s = socs[i];
        if (!(i & 1)) s.th += dt * (s.w + (sharedW - s.w) * lock);
        else s.th = socs[i - 1].th + Math.PI;
        var R = s.R * (1 + 0.08 * Math.sin(t * 0.37 + s.br)), c = Math.cos(s.th), sn = Math.sin(s.th);
        var wob = 0.18 * Math.sin(t * 0.5 + s.br * 1.7) * (i & 1 ? -1 : 1);
        var ind = [
          R * (s.f.u[0] * c + s.f.w[0] * sn) + s.f.n[0] * wob,
          R * (s.f.u[1] * c + s.f.w[1] * sn) + s.f.n[1] * wob,
          R * (s.f.u[2] * c + s.f.w[2] * sn) + s.f.n[2] * wob
        ];
        var ro = rotAxis(s.off, sharedN, sharedSpin);
        for (k = 0; k < 3; k++) {
          var np = ind[k] + (sc[k] + ro[k] - ind[k]) * lock;
          if (dt > 0) s.vel[k] += ((np - s.pos[k]) / dt - s.vel[k]) * va;
          s.pos[k] = np;
        }
        var h = i * NH * 4;
        if (!histFilled) for (k = 1; k < NH; k++) histData.set(s.pos, h + k * 4);
        histData.set(s.pos, h);
        if (push) histData.copyWithin(h + 4, h, h + (NH - 1) * 4);
        for (j = 0; j < NSUB; j++) {
          var b = subs[i * NSUB + j];
          b.th += dt * b.w * (1 - 0.5 * lock);
          var r = b.r * (1 - 0.35 * lock) * (1 + 0.15 * Math.sin(t * 0.8 + b.br));
          var bc = Math.cos(b.th), bs = Math.sin(b.th);
          var o = (i * NSUB + j) * 4, o2 = (NSS + i * NSUB + j) * 4, o3 = (2 * NSS + i * NSUB + j) * 4;
          for (k = 0; k < 3; k++) centData[o + k] = s.pos[k] + r * (b.f.u[k] * bc + b.f.w[k] * bs);
          centData[o + 3] = b.shell * (1 - 0.15 * lock) * (1 + 0.12 * Math.sin(t * 0.9 + b.br * 2.0));
          extArr[i * NSUB + j] = Math.hypot(centData[o], centData[o + 1], centData[o + 2]) +
            centData[o + 3] * 1.25 + 0.3 + 0.45 * lock;
          for (k = 0; k < 3; k++) centData[o2 + k] = b.axis[k] + (sharedN[k] - b.axis[k]) * lock;
          centData[o2 + 3] = b.swirl * (1 - 0.35 * lock);
          for (k = 0; k < 3; k++) centData[o3 + k] = s.vel[k];
        }
      }
      histFilled = true;
      centTex.needsUpdate = true;
      histTex.needsUpdate = true;
      extArr.sort();
      worldExt = extArr[Math.floor(0.95 * (NSS - 1))];
    }

    // ------------------------------------------------------------ particle state
    var info = new Float32Array(COUNT * 4), init = new Float32Array(COUNT * 4);
    for (i = 0; i < COUNT; i++) {
      info[i * 4] = i % NS;
      info[i * 4 + 1] = Math.floor(i / NS) % NSUB;
      info[i * 4 + 2] = rnd();
      info[i * 4 + 3] = rnd();
      var u = randUnit(rnd), rr = 2.5 + 3.5 * Math.cbrt(rnd());
      init[i * 4] = u[0] * rr * 1.3; init[i * 4 + 1] = u[1] * rr; init[i * 4 + 2] = u[2] * rr * 0.8; init[i * 4 + 3] = 1;
    }
    var infoTex = dataTex(info, SIZE, SIZE);
    var initTex = dataTex(init, SIZE, SIZE);
    var posRT = doubleRT(SIZE, SIZE, FF, THREE.NearestFilter);
    var velRT = doubleRT(SIZE, SIZE, FF, THREE.NearestFilter);

    // agents: evenly spread over societies, random sub-swarms
    var agentData = new Float32Array(MAX_AGENTS * 4);
    var perSoc = Math.floor(COUNT / NS);
    for (i = 0; i < MAX_AGENTS; i++) {
      var idx = (i % NS) + NS * ((Math.imul(i + 1, 2654435761) >>> 0) % perSoc);
      agentData[i * 4] = idx % SIZE; agentData[i * 4 + 1] = Math.floor(idx / SIZE);
    }
    var agentTex = dataTex(agentData, MAX_AGENTS, 1);

    // ------------------------------------------------------------ fluid
    var simTexel = new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES);
    var fVel = doubleRT(SIM_RES, SIM_RES, HF, THREE.LinearFilter);
    var fDye = doubleRT(DYE_RES, DYE_RES, HF, THREE.LinearFilter);
    var fPres = doubleRT(SIM_RES, SIM_RES, HF, THREE.NearestFilter);
    var fDiv = rt(SIM_RES, SIM_RES, HF, THREE.NearestFilter);
    var fCurl = rt(SIM_RES, SIM_RES, HF, THREE.NearestFilter);

    var M = {
      copy: mat(COPY_FRAG, { uTex: { value: null } }),
      splat: mat(SPLAT_FRAG, {
        uTarget: { value: null }, uAspect: { value: 1 }, uRadius: { value: 0.002 },
        uColor: { value: new THREE.Vector3() }, uA: { value: new THREE.Vector2() }, uB: { value: new THREE.Vector2() }
      }),
      curl: mat(CURL_FRAG, { uVelocity: { value: null }, uTexel: { value: simTexel } }),
      vort: mat(VORT_FRAG, { uVelocity: { value: null }, uCurl: { value: null }, uCurlStrength: { value: 30 }, uDt: { value: 0 }, uTexel: { value: simTexel } }),
      div: mat(DIV_FRAG, { uVelocity: { value: null }, uTexel: { value: simTexel } }),
      clear: mat(CLEAR_FRAG, { uTex: { value: null }, uValue: { value: 0.8 } }),
      pres: mat(PRESSURE_FRAG, { uPressure: { value: null }, uDivergence: { value: null }, uTexel: { value: simTexel } }),
      grad: mat(GRAD_FRAG, { uPressure: { value: null }, uVelocity: { value: null }, uTexel: { value: simTexel } }),
      advect: mat(ADVECT_FRAG, { uVelocity: { value: null }, uSource: { value: null }, uTexel: { value: simTexel }, uDt: { value: 0 }, uDissipation: { value: 1 } }),
      vel: mat(VEL_FRAG, {
        uPos: { value: null }, uVel: { value: null }, uInfo: { value: infoTex }, uCent: { value: centTex }, uHist: { value: histTex },
        uFluidVel: { value: null }, uFluidDye: { value: null },
        uDt: { value: 0 }, uTime: { value: 0 }, uK: { value: 7 }, uDrag: { value: 2.6 }, uTurb: { value: 1 },
        uLock: { value: 0 }, uNoiseFreq: { value: 0.9 }, uFluidForce: { value: 0 }, uNSub: { value: NSUB },
        uOrbitV: { value: ORBIT_V }, uFieldR: { value: FIELD_R }, uTrail: { value: TRAIL }, uHistA1: { value: 0 },
        uHistDt: { value: HIST_DT }, uHistN: { value: NH },
        uSharedN: { value: new THREE.Vector3().fromArray(sharedN) }, uPivot: { value: new THREE.Vector3() },
        uViewProj: { value: new THREE.Matrix4() }, uCamRight: { value: new THREE.Vector3() }, uCamUp: { value: new THREE.Vector3() }
      }),
      pos: mat(POS_FRAG, { uPos: { value: null }, uVel: { value: null }, uDt: { value: 0 } }),
      mean: mat(MEAN_FRAG, {
        uPos: { value: null }, uAgents: { value: agentTex }, uPrev: { value: null }, uN: { value: 1000 },
        uErr: { value: new THREE.Vector3() }, uBlend: { value: 1 }, uSideBlend: { value: 1 }, uHyst: { value: 0.02 },
        uViewProj: { value: new THREE.Matrix4() }
      }),
      cells: mat(CELLS_FRAG, { uScene: { value: null }, uCellPx: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() } }),
      down: mat(DOWN_FRAG, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } }),
      blur: mat(BLUR_FRAG, { uTex: { value: null }, uDir: { value: new THREE.Vector2() } })
    };

    // ------------------------------------------------------------ atlas + ascii
    var atlasTex = track(new THREE.CanvasTexture(buildAtlas()));
    atlasTex.flipY = false;
    atlasTex.generateMipmaps = true;
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    var asciiUniforms = {
      uCells: { value: null }, uAtlas: { value: atlasTex }, uBloom: { value: null },
      uCellPx: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() },
      uTruth: { value: new THREE.Vector2(-1e4, -1e4) },
      uRampN: { value: RAMP.length }, uBloomAmt: { value: 0.13 }, uExposure: { value: 1.5 }, uFadeR: { value: 1e5 },
      uDim: { value: COL.dim }, uHoney: { value: COL.honey }, uHot: { value: COL.hot }, uBg: { value: COL.bg }
    };
    M.ascii = mat(ASCII_FRAG, asciiUniforms);

    // ------------------------------------------------------------ scene
    var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0.5, 10);
    var scene = new THREE.Scene();
    var partGeo = track(new THREE.BufferGeometry());
    partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT), 1));
    var partMat = track(new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: PARTICLE_VERT, fragmentShader: POINT_FRAG,
      uniforms: {
        uPos: { value: null }, uVel: { value: null }, uInfo: { value: infoTex }, uSize: { value: SIZE },
        uPointScale: { value: 1 }, uIntensity: { value: coarse ? 0.75 : 0.18 }, uColor: { value: COL.honey }
      },
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
    }));
    var particles = new THREE.Points(partGeo, partMat);
    particles.frustumCulled = false;
    scene.add(particles);

    // ------------------------------------------------------------ vector overlay (device resolution)
    var labels = cleanLabels(opts.labels, DEFAULT_LABELS);
    var labelCanvas = document.createElement('canvas');
    var labelTex = track(new THREE.CanvasTexture(labelCanvas));
    labelTex.flipY = false;
    labelTex.premultiplyAlpha = true;
    labelTex.generateMipmaps = false;
    labelTex.minFilter = labelTex.magFilter = THREE.LinearFilter;
    var ovGeo = track(new THREE.InstancedBufferGeometry());
    ovGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), 2));
    var ids = new Float32Array(MAX_AGENTS + 5);
    for (i = 0; i < ids.length; i++) ids[i] = i;
    ovGeo.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
    var ovUniforms = {
      uPos: { value: null }, uAgents: { value: agentTex }, uMean: { value: null }, uLabels: { value: labelTex },
      uViewProj: { value: new THREE.Matrix4() }, uScreen: { value: new THREE.Vector2(1, 1) },
      uLabSizeT: { value: new THREE.Vector2() }, uLabSizeC: { value: new THREE.Vector2() },
      uLabUvT: { value: new THREE.Vector4() }, uLabUvC: { value: new THREE.Vector4() },
      uPR: { value: 1 }, uN: { value: 0 }, uDotR: { value: 2.5 }, uDotA: { value: 1 }, uFadeR: { value: 1e5 },
      uArm: { value: 9 }, uRingR: { value: 11 }, uStroke: { value: 1.5 },
      uInk: { value: COL.ink }, uHoney: { value: COL.honey }, uBg: { value: COL.bg }
    };
    var ovMesh = new THREE.Mesh(ovGeo, track(new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: OVERLAY_VERT, fragmentShader: OVERLAY_FRAG, uniforms: ovUniforms,
      transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, depthTest: false, depthWrite: false
    })));
    ovMesh.frustumCulled = false;
    var ovScene = new THREE.Scene(); ovScene.add(ovMesh);

    function rasterLabels() {
      var r = drawLabels(labelCanvas, labels, pr);
      ovUniforms.uLabUvT.value.fromArray(r[0].uv); ovUniforms.uLabSizeT.value.fromArray(r[0].size);
      ovUniforms.uLabUvC.value.fromArray(r[1].uv); ovUniforms.uLabSizeC.value.fromArray(r[1].size);
      labelTex.dispose();                 // the canvas may have changed size: reallocate the texture
      labelTex.needsUpdate = true;
    }

    if (document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(function () {
        if (destroyed) return;
        atlasTex.image = buildAtlas(); atlasTex.needsUpdate = true;
        rasterLabels();
        renderStill();
      });
    }

    // ------------------------------------------------------------ crowd estimate (stays on the GPU)
    var meanRT = doubleRT(1, 1, FF, THREE.NearestFilter);
    var errVec = new THREE.Vector3();
    function updateCrowd(dt, instant) {
      // shared (correlated) error: |e| = sigma / sqrt(N_eff), N_eff = N / (1 + (N-1) rho)
      var N = Math.exp(logN), neff = N / (1 + (N - 1) * rhoS), t = simTime;
      errVec.set(Math.cos(t * 0.23) + 0.4 * Math.sin(t * 0.61), 0.6 * Math.sin(t * 0.31 + 1.0), 0.8 * Math.sin(t * 0.17))
        .normalize().multiplyScalar(1.25 / Math.sqrt(neff));
      var U = M.mean.uniforms;
      U.uPos.value = posRT.read.texture;
      U.uPrev.value = meanRT.read.texture;
      U.uN.value = Math.round(agentsT);
      U.uErr.value.copy(errVec);
      U.uBlend.value = instant ? 1 : 1 - Math.exp(-dt * 4);
      U.uSideBlend.value = instant ? 1 : 1 - Math.exp(-dt * 5);
      U.uViewProj.value.copy(viewProj);
      pass(M.mean, meanRT.write); meanRT.swap();
    }

    // ------------------------------------------------------------ sizing
    var cssW = 0, cssH = 0, pr = 1, bufW = 0, bufH = 0, cols = 0, rows = 0, cellW = 6, cellH = 9;
    var sceneRT = null, cellsRT = null, bloomA = null, bloomB = null;
    function resize() {
      var w = Math.round(canvas.clientWidth), h = Math.round(canvas.clientHeight);
      var p = Math.min(window.devicePixelRatio || 1, 2);
      if (w < 2 || h < 2) return false;
      if (w === cssW && h === cssH && p === pr && sceneRT) return false;
      cssW = w; cssH = h; pr = p;
      renderer.setPixelRatio(pr);
      renderer.setSize(cssW, cssH, false);
      bufW = Math.round(cssW * pr); bufH = Math.round(cssH * pr);
      cellW = Math.max(4, Math.round(CELL_W * pr)); cellH = Math.max(6, Math.round(CELL_H * pr));
      cols = Math.ceil(bufW / cellW); rows = Math.ceil(bufH / cellH);
      [sceneRT, cellsRT, bloomA, bloomB].forEach(function (r) {
        if (r) { r.dispose(); disposables.splice(disposables.indexOf(r), 1); }
      });
      var sw = Math.min(cssW, 2048), sh = Math.max(2, Math.round(sw * cssH / cssW));
      sceneRT = rt(sw, sh, HF, THREE.LinearFilter);
      cellsRT = rt(cols, rows, HF, THREE.NearestFilter);
      var bw = Math.max(2, Math.round(sw / 4)), bh = Math.max(2, Math.round(sh / 4));
      bloomA = rt(bw, bh, HF, THREE.LinearFilter);
      bloomB = rt(bw, bh, HF, THREE.LinearFilter);

      var aspect = cssW / cssH;
      camera.aspect = aspect;
      applyFocus();
      var projScale = sh * 0.5 / TAN_H;
      partMat.uniforms.uPointScale.value = (coarse ? 0.024 : 0.0125) * projScale;
      M.cells.uniforms.uCellPx.value.set(cellW, cellH);
      M.cells.uniforms.uScreen.value.set(bufW, bufH);
      M.mean.uniforms.uHyst.value = 24 / cssW;          // 12 CSS px, in NDC
      asciiUniforms.uCellPx.value.set(cellW, cellH);
      asciiUniforms.uScreen.value.set(bufW, bufH);
      ovUniforms.uScreen.value.set(bufW, bufH);
      ovUniforms.uPR.value = pr;
      ovUniforms.uArm.value = 9 * pr;
      ovUniforms.uRingR.value = 11 * pr;
      ovUniforms.uStroke.value = 1.5 * pr;
      rasterLabels();
      M.splat.uniforms.uAspect.value = aspect;
      return true;
    }

    // ------------------------------------------------------------ pointer
    var ptr = { x: 0.5, y: 0.5, lx: 0, ly: 0, has: false, moved: false, gx: 0, gy: 0 };
    function onPoint(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      var x = (clientX - r.left) / r.width, y = 1 - (clientY - r.top) / r.height;
      ptr.gx = Math.max(-1, Math.min(1, x * 2 - 1));
      ptr.gy = Math.max(-1, Math.min(1, y * 2 - 1));
      if (x < 0 || x > 1 || y < 0 || y > 1) { ptr.has = false; return; }
      if (!ptr.has) { ptr.lx = x; ptr.ly = y; ptr.has = true; }
      ptr.x = x; ptr.y = y; ptr.moved = true;
    }
    function onPointerMove(e) { if (e.pointerType !== 'touch') onPoint(e.clientX, e.clientY); }
    function onTouch(e) { var t = e.touches && e.touches[0]; if (t) onPoint(t.clientX, t.clientY); }
    function onTouchEnd() { ptr.has = false; }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    // ------------------------------------------------------------ simulation step
    var rhoT = clampRho(opts.rho !== undefined ? +opts.rho : 0.25), rhoS = rhoT;
    var agentsT = clampAgents(opts.agents !== undefined ? +opts.agents : 1000), logN = Math.log(agentsT);
    var simTime = 0, lockNow = lockOf(rhoS), screenWorldH = 7;
    var tmpV = new THREE.Vector3(), viewProj = new THREE.Matrix4();
    var gaze = new THREE.Vector2();
    var focusT = clampFocus(opts.focus), focusS = focusT.slice();
    var radiusT = clampRadius(opts.radius), radiusS = radiusT, extS = worldExt;

    function clampRadius(r) { return isFinite(r) && r !== null ? Math.min(1, Math.max(0.05, +r)) : 0.42; }

    function clampFocus(f) {
      var x = f && isFinite(f[0]) ? +f[0] : 0.5, y = f && isFinite(f[1]) ? +f[1] : 0.5;
      return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
    }
    // lens shift: the global centroid lands at focusS (fractions of the CSS box, y from the top)
    function applyFocus() {
      if (cssW < 2) return;
      camera.setViewOffset(cssW, cssH, (0.5 - focusS[0]) * cssW, (0.5 - focusS[1]) * cssH, cssW, cssH);
    }

    function clampRho(r) { return isFinite(r) ? Math.min(0.95, Math.max(0, r)) : 0.25; }
    function clampAgents(n) { return isFinite(n) ? Math.min(MAX_AGENTS, Math.max(1, Math.round(n))) : 1000; }
    // 0 = independent societies, 1 = lockstep monoculture; eased so mid rho still reads as a big swarm
    function lockOf(r) { return Math.pow(smooth01(r / 0.95), 1.5); }

    function updateCamera(dt, instant) {
      var a = instant ? 1 : 1 - Math.pow(0.95, dt * 60);
      gaze.x += (ptr.gx - gaze.x) * a; gaze.y += (ptr.gy - gaze.y) * a;
      var fa = instant ? 1 : 1 - Math.exp(-dt * 3);
      if (Math.abs(focusT[0] - focusS[0]) + Math.abs(focusT[1] - focusS[1]) > 1e-5) {
        focusS[0] += (focusT[0] - focusS[0]) * fa; focusS[1] += (focusT[1] - focusS[1]) * fa;
        applyFocus();
      }
      var ra = instant ? 1 : 1 - Math.exp(-dt * 2.5);
      radiusS += (radiusT - radiusS) * ra;
      extS += (worldExt - extS) * (instant ? 1 : 1 - Math.exp(-dt * 1.5));
      // framing: the swarm's ~95th-percentile extent fills `radius` of the CSS height at low rho and
      // about half of it in monoculture, so the rho contrast stays readable inside a fixed window
      var target = radiusS * (1 - 0.5 * lockNow);
      var dist = Math.max(extS * EXTENT_GAIN / (2 * target * TAN_H), extS + 2.5), k = dist / 8;
      screenWorldH = 2 * dist * TAN_H;
      asciiUniforms.uFadeR.value = ovUniforms.uFadeR.value = radiusS * cssH * pr;
      camera.position.set(gaze.x * 1.5 * k, (0.45 + gaze.y * 0.9) * k, dist);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    }

    function stepFluid(dt) {
      if (ptr.moved && ptr.has) {
        var dx = ptr.x - ptr.lx, dy = ptr.y - ptr.ly;
        var speed = Math.hypot(dx * camera.aspect, dy) / Math.max(dt, 1e-3);
        if (dx !== 0 || dy !== 0) {
          var sp = Math.min(speed, 4);
          M.splat.uniforms.uA.value.set(ptr.lx, ptr.ly);
          M.splat.uniforms.uB.value.set(ptr.x, ptr.y);
          M.splat.uniforms.uRadius.value = 0.0007 + 0.0014 * sp;
          M.splat.uniforms.uTarget.value = fVel.read.texture;
          M.splat.uniforms.uColor.value.set(dx * 6000, dy * 6000, 0);
          pass(M.splat, fVel.write); fVel.swap();
          M.splat.uniforms.uTarget.value = fDye.read.texture;
          var amt = Math.min(0.35 + 0.5 * sp, 1.6);
          M.splat.uniforms.uColor.value.set(amt, amt, amt);
          pass(M.splat, fDye.write); fDye.swap();
        }
        ptr.lx = ptr.x; ptr.ly = ptr.y;
      }
      ptr.moved = false;

      M.curl.uniforms.uVelocity.value = fVel.read.texture;
      pass(M.curl, fCurl);
      M.vort.uniforms.uVelocity.value = fVel.read.texture;
      M.vort.uniforms.uCurl.value = fCurl.texture;
      M.vort.uniforms.uDt.value = dt;
      pass(M.vort, fVel.write); fVel.swap();
      M.div.uniforms.uVelocity.value = fVel.read.texture;
      pass(M.div, fDiv);
      M.clear.uniforms.uTex.value = fPres.read.texture;
      pass(M.clear, fPres.write); fPres.swap();
      M.pres.uniforms.uDivergence.value = fDiv.texture;
      for (var it = 0; it < PRESSURE_ITERS; it++) {
        M.pres.uniforms.uPressure.value = fPres.read.texture;
        pass(M.pres, fPres.write); fPres.swap();
      }
      M.grad.uniforms.uPressure.value = fPres.read.texture;
      M.grad.uniforms.uVelocity.value = fVel.read.texture;
      pass(M.grad, fVel.write); fVel.swap();
      var f60 = dt * 60;
      M.advect.uniforms.uDt.value = dt;
      M.advect.uniforms.uVelocity.value = fVel.read.texture;
      M.advect.uniforms.uSource.value = fVel.read.texture;
      M.advect.uniforms.uDissipation.value = Math.pow(0.98, f60);
      pass(M.advect, fVel.write); fVel.swap();
      M.advect.uniforms.uVelocity.value = fVel.read.texture;
      M.advect.uniforms.uSource.value = fDye.read.texture;
      M.advect.uniforms.uDissipation.value = Math.pow(0.97, f60);
      pass(M.advect, fDye.write); fDye.swap();
    }

    function stepSim(dt, withFluid) {
      simTime += dt;
      rhoS += (rhoT - rhoS) * (1 - Math.exp(-dt * 2.0));
      logN += (Math.log(agentsT) - logN) * (1 - Math.exp(-dt * 3.0));
      var lock = lockNow = lockOf(rhoS);
      updateWorld(dt, simTime, lock);
      if (withFluid) stepFluid(dt);

      var U = M.vel.uniforms;
      U.uPos.value = posRT.read.texture; U.uVel.value = velRT.read.texture;
      U.uFluidVel.value = fVel.read.texture; U.uFluidDye.value = fDye.read.texture;
      U.uDt.value = dt; U.uTime.value = simTime;
      U.uK.value = 7 * (0.4 + 0.6 * smooth01(simTime / 1.2));
      U.uLock.value = lock;
      U.uFieldR.value = FIELD_R * (1 - 0.6 * lock);
      U.uPivot.value.fromArray(pivot);
      U.uHistA1.value = histAge;
      // monoculture packs every particle into one clump: lower exposure so it still steps through the ramp
      asciiUniforms.uExposure.value = 2.2 * (1 - 0.55 * lock);
      U.uTurb.value = 0.9 + (0.3 - 0.9) * lock;
      U.uFluidForce.value = withFluid ? (screenWorldH / SIM_RES) * 2.2 : 0;
      U.uViewProj.value.copy(viewProj);
      U.uCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
      U.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
      pass(M.vel, velRT.write); velRT.swap();
      M.pos.uniforms.uPos.value = posRT.read.texture;
      M.pos.uniforms.uVel.value = velRT.read.texture;
      M.pos.uniforms.uDt.value = dt;
      pass(M.pos, posRT.write); posRT.swap();
    }

    function render() {
      partMat.uniforms.uPos.value = posRT.read.texture;
      partMat.uniforms.uVel.value = velRT.read.texture;
      tmpV.set(0, 0, 0).project(camera);
      asciiUniforms.uTruth.value.set((tmpV.x * 0.5 + 0.5) * bufW, (tmpV.y * 0.5 + 0.5) * bufH);

      renderer.setRenderTarget(sceneRT); renderer.clear(true, false, false);
      renderer.render(scene, camera);

      M.cells.uniforms.uScene.value = sceneRT.texture;
      pass(M.cells, cellsRT);
      M.down.uniforms.uTex.value = sceneRT.texture;
      M.down.uniforms.uTexel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
      pass(M.down, bloomA);
      for (var k = 0; k < 2; k++) {
        M.blur.uniforms.uTex.value = bloomA.texture;
        M.blur.uniforms.uDir.value.set(1 / bloomA.width, 0);
        pass(M.blur, bloomB);
        M.blur.uniforms.uTex.value = bloomB.texture;
        M.blur.uniforms.uDir.value.set(0, 1 / bloomA.height);
        pass(M.blur, bloomA);
      }
      asciiUniforms.uCells.value = cellsRT.texture;
      asciiUniforms.uBloom.value = bloomA.texture;
      pass(M.ascii, null);

      // overlay on top of the ASCII image: agents as dots (smaller and fainter for a large crowd)
      var n = Math.round(agentsT);
      ovUniforms.uPos.value = posRT.read.texture;
      ovUniforms.uMean.value = meanRT.read.texture;
      ovUniforms.uViewProj.value.copy(viewProj);
      ovUniforms.uN.value = n;
      ovUniforms.uDotR.value = (n <= 10 ? 3.5 : n <= 100 ? 2.5 : 1.4) * pr;
      ovUniforms.uDotA.value = n <= 100 ? 1 : 0.6;
      ovGeo.instanceCount = n + 5;
      renderer.setRenderTarget(null);
      renderer.render(ovScene, fsCam);
    }

    // ------------------------------------------------------------ loop / lifecycle
    var raf = 0, last = 0, destroyed = false;
    var userPaused = false, rmHalted = reducedMotion, inView = true, docHidden = !!document.hidden;

    function shouldRun() { return !destroyed && !userPaused && !rmHalted && inView && !docHidden; }
    function tick(now) {
      raf = 0;
      if (!shouldRun()) return;
      raf = requestAnimationFrame(tick);
      var dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      if (dt <= 0) return;
      resize();
      if (!sceneRT) return;
      updateCamera(dt, false);
      stepSim(dt, true);
      updateCrowd(dt, false);
      render();
    }
    function sync() {
      if (shouldRun()) {
        if (!raf) { last = 0; ptr.has = false; raf = requestAnimationFrame(tick); }
      } else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    // Static frame (reduced motion / paused / resized while stopped).
    function renderStill() {
      if (destroyed || shouldRun() || !sceneRT) return;
      updateCamera(0, true);
      updateCrowd(0, true);
      render();
    }
    function settle(seconds) {
      var steps = Math.round(seconds * 60);
      updateCamera(0, true);
      for (var k = 0; k < steps; k++) stepSim(1 / 60, false);
    }

    var ro = new ResizeObserver(function () {
      if (destroyed) return;
      if (resize()) renderStill();
    });
    ro.observe(canvas);
    var io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(function (entries) {
        inView = entries[entries.length - 1].isIntersecting;
        sync();
      }, { threshold: 0 });
      io.observe(canvas);
    }
    function onVis() { docHidden = !!document.hidden; sync(); }
    document.addEventListener('visibilitychange', onVis);
    function onLost(e) { e.preventDefault(); userPaused = true; sync(); }
    canvas.addEventListener('webglcontextlost', onLost);

    // init particle state
    M.copy.uniforms.uTex.value = initTex;
    pass(M.copy, posRT.read);
    [velRT.read, velRT.write, fVel.read, fVel.write, fDye.read, fDye.write, fPres.read, fPres.write].forEach(function (r) {
      renderer.setRenderTarget(r); renderer.clear(true, false, false);
    });
    resize();
    updateWorld(0, 0, lockOf(rhoS));
    if (reducedMotion) {
      settle(4.5);
      renderStill();
    } else {
      sync();
    }

    var controller = {
      setRho: function (r) {
        rhoT = clampRho(+r);
        if (rmHalted && !destroyed) { settle(1.5); renderStill(); }
      },
      setAgents: function (n) {
        agentsT = clampAgents(+n);
        if (!shouldRun() && !destroyed) { logN = Math.log(agentsT); renderStill(); }
      },
      setFocus: function (x, y, radius) {
        focusT = clampFocus([x, y]);
        if (radius !== undefined) radiusT = clampRadius(radius);
        if (!shouldRun() && !destroyed) renderStill();
      },
      setLabels: function (l) {
        if (destroyed) return;
        labels = cleanLabels(l, labels);
        rasterLabels();
        renderStill();
      },
      refreshLabels: function () {
        if (destroyed) return;
        rasterLabels();
        renderStill();
      },
      pause: function () { userPaused = true; sync(); },
      resume: function () {
        if (destroyed) return;
        userPaused = false; rmHalted = false;
        if (renderer.getContext().isContextLost()) return;
        sync();
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect();
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        canvas.removeEventListener('webglcontextlost', onLost);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('touchstart', onTouch);
        window.removeEventListener('touchmove', onTouch);
        window.removeEventListener('touchend', onTouchEnd);
        disposables.forEach(function (d) { d.dispose(); });
        renderer.setRenderTarget(null);
        renderer.dispose();
      }
    };
    return controller;
  }

  window.IraiSwarm = { create: create };
})();
