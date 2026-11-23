/*!
 * IRAI hero swarm — "Swarms of societies of swarms."
 * WebGL2 GPGPU particle swarm, cursor-driven fluid, HD ASCII phosphor post-process.
 * Classic script. Requires three.js r150 (global THREE). Exposes window.IraiSwarm:
 *   IraiSwarm.create(canvas, { rho = 0.25, agents = 1000, reducedMotion, focus = [0.5, 0.5], radius = 0.42 })
 *     -> controller | null
 *   controller.setRho(0..0.95), setAgents(10|100|1000), setFocus(x, y[, radius]), pause(), resume(), destroy()
 *   focus: fractions of the canvas CSS box (from top-left) where the global centroid appears.
 *   radius: fraction of the canvas CSS height the swarm's ~95th-percentile extent fits within at every rho
 *     (low rho fills it, monoculture clumps to about half); density fades softly past it.
 */
(function () {
  'use strict';

  var MAX_AGENTS = 1000;
  var RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  var BLOCKS = ['\u2591', '\u2592', '\u2593', '\u2588']; // ░▒▓█
  var SPECIAL = ['\u2500', '\u2502', '\u253C', '\u2571', '\u2572', '\u25C6', '\u00B7', '\u00D7']; // ─│┼╱╲◆·×
  var ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var PROCEDURAL = '\u2591\u2592\u2593\u2588\u2500\u2502\u253C\u2571\u2572\u25C6';
  var FONT = '"JetBrains Mono","IBM Plex Mono","SFMono-Regular",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace';
  var TILE_W = 48, TILE_H = 72, ATLAS_COLS = 16;
  var LABEL_T = 'TRUTH', LABEL_C = 'CROWD';

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

  var VEL_FRAG = FRAG_HEAD + SIM_COMMON + '\n' + [
    'uniform sampler2D uPos, uVel, uInfo, uCent, uFluidVel, uFluidDye;',
    'uniform float uDt, uTime, uK, uDrag, uTurb, uLock, uNoiseFreq, uFluidForce;',
    'uniform int uNSub;',
    'uniform mat4 uViewProj; uniform vec3 uCamRight, uCamUp;',
    'void main(){',
    '  ivec2 ij = ivec2(gl_FragCoord.xy);',
    '  vec4 P = texelFetch(uPos, ij, 0), V = texelFetch(uVel, ij, 0), I = texelFetch(uInfo, ij, 0);',
    '  int si = int(I.x) * uNSub + int(I.y);',
    '  vec4 C = texelFetch(uCent, ivec2(si, 0), 0), A = texelFetch(uCent, ivec2(si, 1), 0);',
    '  vec3 p = P.xyz, v = V.xyz;',
    '  vec3 rel = p - C.xyz; float dist = length(rel) + 1e-5; vec3 n = rel / dist;',
    '  float breathe = 1.0 + 0.18 * sin(uTime * 0.9 + I.x * 2.1 + I.w * 6.2831);',
    '  float r0 = C.w * (0.3 + 0.7 * pow(I.z, 0.3333)) * breathe;',
    '  vec3 f = -n * (dist - r0) * uK;',
    // individual swirl axis around the shared sub-swarm axis (boids-like alignment)
    '  vec3 jit = vec3(fract(I.w * 127.1), fract(I.w * 311.7), fract(I.w * 74.7)) - 0.5;',
    '  vec3 axis = normalize(A.xyz + jit * 1.1 * (1.0 - 0.6 * uLock));',
    '  vec3 vT = cross(axis, rel) * A.w * (0.55 + 0.9 * fract(I.w * 13.3));',
    '  float vl = length(vT); if (vl > 2.2) vT *= 2.2 / vl;',
    '  f += (vT - v) * uDrag;',
    '  float ph = I.x * 1.731 * (1.0 - uLock) + I.y * 0.37;',
    '  f += turbulence(p * uNoiseFreq, uTime * 0.35, ph) * uTurb;',
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
    // crowd estimate = mean of agent positions + shared (correlated) error, eased over time
    'uniform sampler2D uPos, uAgents, uPrev; uniform int uN; uniform vec3 uErr; uniform float uBlend;',
    'void main(){',
    '  vec3 s = vec3(0.0);',
    '  for (int i = 0; i < ' + MAX_AGENTS + '; i++) {',
    '    if (i >= uN) break;',
    '    s += texelFetch(uPos, ivec2(texelFetch(uAgents, ivec2(i, 0), 0).xy), 0).xyz;',
    '  }',
    '  vec3 cur = s / float(max(uN, 1)) + uErr;',
    '  O = vec4(mix(texelFetch(uPrev, ivec2(0), 0).xyz, cur, uBlend), 1.0);',
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

  var PARTICLE_VERT = HEAD + [
    'in float position;',
    'uniform mat4 modelViewMatrix, projectionMatrix;',
    'uniform sampler2D uPos, uVel, uInfo; uniform int uSize;',
    'uniform float uPointScale, uIntensity, uTime;',
    'uniform vec3 uHoney, uHoneyDeep, uHot, uLav;',
    'out vec3 vColor;',
    'void main(){',
    '  ivec2 ij = ivec2(gl_VertexID % uSize, gl_VertexID / uSize);',
    '  vec3 p = texelFetch(uPos, ij, 0).xyz; vec4 V = texelFetch(uVel, ij, 0); vec4 I = texelFetch(uInfo, ij, 0);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float r = I.w;',
    '  float sz = uPointScale * (0.6 + 1.1 * fract(r * 91.7)) / max(-mv.z, 0.1);',
    '  float k = fract(r * 53.3);',
    '  vec3 col = k < 0.16 ? uHot : (k < 0.5 ? uHoneyDeep : uHoney);',
    '  float tw = 0.0;',
    '  if (fract(r * 17.1) < 0.03) {',
    '    tw = pow(0.5 + 0.5 * sin(uTime * (1.5 + r * 4.0) + r * 60.0), 5.0);',
    '    col = uLav; sz *= 1.3 + 1.2 * tw;',
    '  }',
    '  float inten = uIntensity * (0.75 + 0.2 * min(length(V.xyz), 3.0) + 2.0 * V.w + 2.5 * tw + (tw > 0.0 ? 0.6 : 0.0));',
    '  vColor = col * inten;',
    '  gl_PointSize = clamp(sz, 1.0, 10.0);',
    '}'
  ].join('\n');

  var AGENT_VERT = HEAD + [
    'in float position;',
    'uniform mat4 modelViewMatrix, projectionMatrix;',
    'uniform sampler2D uPos, uAgents;',
    'uniform float uPointScale, uIntensity, uMarkScaleX, uMarkScaleY, uTime;',
    'uniform vec3 uColor; uniform int uMarks;',
    'out vec3 vColor;',
    'void main(){',
    '  vec2 t = texelFetch(uAgents, ivec2(gl_VertexID, 0), 0).xy;',
    '  vec3 p = texelFetch(uPos, ivec2(t), 0).xyz;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vec4 clip = projectionMatrix * mv;',
    '  if (uMarks == 1) {',
    '    clip.xy = ((clip.xy / clip.w * 0.5 + 0.5) * vec2(uMarkScaleX, uMarkScaleY) * 2.0 - 1.0) * clip.w;',
    '    gl_PointSize = 1.0; vColor = vec3(1.0);',
    '  } else {',
    '    gl_PointSize = max(uPointScale / max(-mv.z, 0.1), 2.0);',
    '    float pulse = 0.8 + 0.2 * sin(uTime * 2.0 + float(gl_VertexID) * 0.77);',
    '    vColor = uColor * uIntensity * pulse;',
    '  }',
    '  gl_Position = clip;',
    '}'
  ].join('\n');

  var LINK_VERT = HEAD + [
    'in float position;',
    'uniform mat4 modelViewMatrix, projectionMatrix;',
    'uniform sampler2D uLinks; uniform int uPer;',
    'uniform float uPointScale, uIntensity, uTime;',
    'uniform vec3 uColor, uLav;',
    'out vec3 vColor;',
    'void main(){',
    '  int li = gl_VertexID / uPer; float t = (float(gl_VertexID % uPer) + 0.5) / float(uPer);',
    '  vec4 A = texelFetch(uLinks, ivec2(li, 0), 0), B = texelFetch(uLinks, ivec2(li, 1), 0);',
    '  vec3 p = mix(A.xyz, B.xyz, t);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float h = fract(sin(float(li) * 12.9898) * 43758.5453);',
    '  float pk = fract(t - uTime * (0.18 + 0.2 * h) + h);',
    '  float pulse = smoothstep(0.86, 1.0, pk);',
    '  gl_PointSize = max(uPointScale * (1.0 + 1.5 * pulse) / max(-mv.z, 0.1), 1.0);',
    '  float ends = smoothstep(0.0, 0.2, t) * smoothstep(1.0, 0.8, t);',
    '  vColor = mix(uColor, uLav, B.w * pulse) * uIntensity * A.w * ends * (0.4 + 1.4 * pulse);',
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

  function asciiFrag(g) {
    return FRAG_HEAD + [
      'uniform sampler2D uCells, uMarks, uAtlas, uBloom, uMean;',
      'uniform mat4 uViewProj;',
      'uniform vec2 uCellPx, uScreen, uGrid, uAtlasGrid, uTruth;',
      'uniform float uRampN, uTime, uGlitch, uBloomAmt, uExposure, uRingR, uPR, uAgentGlyph, uFadeR;',
      'uniform int uLabelT[8], uLabelC[8];',
      'uniform vec3 uAmber, uHot, uLav, uCer, uBg, uHoney;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'void main(){',
      '  vec2 fc = gl_FragCoord.xy;',
      '  vec2 cf = fc / uCellPx;',
      '  ivec2 cell = ivec2(floor(cf));',
      '  vec2 local = cf - floor(cf);',
      '  ivec2 src = cell;',
      '  float tq = floor(uTime * 14.0);',
      '  bool glitchBand = false;',
      '  if (uGlitch > 0.0 && hash(vec2(tq, 7.0)) < 0.035) {',
      '    float row = floor(hash(vec2(tq, 3.0)) * uGrid.y);',
      '    if (abs(float(cell.y) - row) < 1.5) { src.x += int((hash(vec2(tq, 9.0)) - 0.5) * 14.0); glitchBand = true; }',
      '  }',
      '  src = clamp(src, ivec2(0), ivec2(uGrid) - 1);',
      '  vec4 C = texelFetch(uCells, src, 0);',
      '  float lum = mix(dot(C.rgb, vec3(0.3, 0.5, 0.2)), C.a, 0.15);',
      // soft density falloff toward the framing radius around the global centroid
      '  float fade = 1.0 - smoothstep(0.85, 1.15, length((vec2(cell) + 0.5) * uCellPx - uTruth) / uFadeR);',
      '  lum *= fade;',
      '  float L = 1.0 - exp(-lum * uExposure);',
      '  int g = 0;',
      // text ramp up to L=0.92; block shades (L>0.95) only where the whole neighbourhood (bloom) is dense too
      '  float nb = fade * dot(texture(uBloom, (vec2(src) + 0.5) * uCellPx / uScreen).rgb, vec3(0.3, 0.5, 0.2));',
      '  float Ln = 1.0 - exp(-nb * uExposure * 1.5);',
      '  float textN = uRampN - ' + BLOCKS.length + '.0;',
      '  if (L > 0.03) {',
      '    float Lb = min(L, Ln);',
      '    if (Lb < 0.95) g = 1 + int(pow((min(L, 0.92) - 0.03) / 0.89, 0.85) * (textN - 1.001));',
      '    else g = int(textN) + min(int((Lb - 0.95) / 0.012), ' + (BLOCKS.length - 1) + ');',
      '  }',
      '  float mc = max(max(C.r, C.g), C.b);',
      '  vec3 hue = mc > 1e-5 ? C.rgb / mc : uAmber;',
      '  float lav = smoothstep(0.02, 0.3, hue.b - hue.r);',
      '  vec3 tint = mix(mix(hue, uAmber, 0.6), uLav * 1.15, lav);',
      '  tint = mix(tint, uHot, smoothstep(0.7, 1.0, L) * 0.55);',
      '  vec3 col = tint * (0.45 + 0.8 * L);',
      '  if (glitchBand) col *= vec3(0.75, 0.85, 1.25);',
      '  if (uGlitch > 0.0 && L > 0.05 && hash(vec2(cell) + tq * 1.37) < 0.0012) {',
      '    g = 1 + int(hash(vec2(cell) * 1.7 + tq) * (textN - 2.0));',
      '    col = hash(vec2(cell) - tq) < 0.5 ? uLav * 1.3 : uHot;',
      '  }',
      // --- markers (cell-space overlays rendered as glyphs)
      '  vec2 cc = (vec2(cell) + 0.5) * uCellPx;',
      // agents: diamonds in sparse cells for small crowds; a 1000-agent crowd lights its cells honey instead
      '  if (fade > 0.3 && texelFetch(uMarks, cell, 0).r > 0.0) {',
      '    if (uAgentGlyph > 0.5 && L < 0.55) { g = ' + g.agent + '; col = uHoney * 1.3; }',
      '    else { g = max(g, 2); col = mix(uHoney, uHot, 0.45) * 1.35; }',
      '  }',
      '  vec4 mc4 = uViewProj * vec4(texelFetch(uMean, ivec2(0), 0).xyz, 1.0);',
      '  vec2 crowd = mc4.w > 0.01 ? (mc4.xy / mc4.w * 0.5 + 0.5) * uScreen : vec2(-1e4);',
      '  ivec2 tc = ivec2(floor(uTruth / uCellPx)), kc = ivec2(floor(crowd / uCellPx));',
      // error vector: dotted line truth -> crowd
      '  vec2 ab = crowd - uTruth; float abl = length(ab);',
      '  if (abl > uRingR * 1.05) {',
      '    vec2 pa = cc - uTruth; float h = clamp(dot(pa, ab) / (abl * abl), 0.0, 1.0);',
      '    vec2 adx = abs(pa - ab * h) / uCellPx;',
      '    if (adx.x < 0.5 && adx.y < 0.5 && length(cc - crowd) > uRingR && length(cc - uTruth) > 2.5 * uCellPx.x) { g = ' + g.dot + '; col = uCer * 1.6; }',
      '  }',
      // crowd ring: one glyph per sampled point, oriented along the tangent
      '  if (length(cc - crowd) < uRingR + uCellPx.y) {',
      '    for (int k = 0; k < 28; k++) {',
      '      float a = (float(k) + 0.5) * 0.2243994753;',
      '      vec2 n = vec2(cos(a), sin(a));',
      '      if (ivec2(floor((crowd + n * uRingR) / uCellPx)) == cell) {',
      '        g = abs(n.x) > 0.93 ? ' + g.v + ' : (abs(n.y) > 0.93 ? ' + g.h + ' : (n.x * n.y > 0.0 ? ' + g.back + ' : ' + g.fwd + '));',
      '        col = uLav * 1.5;',
      '      }',
      '    }',
      '  }',
      '  if (cell == kc) { g = ' + g.times + '; col = uLav * 1.6; }',
      // truth reticle
      '  ivec2 dt = cell - tc;',
      '  if (dt.y == 0 && abs(dt.x) >= 1 && abs(dt.x) <= 2) { g = ' + g.h + '; col = uHot * 1.3; }',
      '  if (dt.x == 0 && abs(dt.y) == 1) { g = ' + g.v + '; col = uHot * 1.3; }',
      '  if (dt == ivec2(0)) { g = ' + g.cross + '; col = uHot * 1.5; }',
      // labels sit on the outer sides so they never collide
      '  bool crowdLeft = crowd.x < uTruth.x;',
      '  int li = cell.x - (crowdLeft ? tc.x + 4 : tc.x - 3 - ' + g.lenT + ');',
      '  if (cell.y == tc.y && li >= 0 && li < ' + g.lenT + ') { g = uLabelT[li]; col = uHot * 1.2; }',
      '  int rc = int(ceil(uRingR / uCellPx.x));',
      '  li = cell.x - (crowdLeft ? kc.x - rc - 1 - ' + g.lenC + ' : kc.x + rc + 2);',
      '  if (cell.y == kc.y && li >= 0 && li < ' + g.lenC + ') { g = uLabelC[li]; col = uLav * 1.5; }',
      // glyph lookup
      '  float m = 0.0;',
      '  if (g > 0) {',
      '    vec2 gc = vec2(float(g % int(uAtlasGrid.x)), float(g / int(uAtlasGrid.x)));',
      '    vec2 l = clamp(local, 0.015, 0.985);',
      '    vec2 auv = (gc + vec2(l.x, 1.0 - l.y)) / uAtlasGrid;',
      '    vec2 gx = vec2(1.0 / (uCellPx.x * uAtlasGrid.x), 0.0), gy = vec2(0.0, 1.0 / (uCellPx.y * uAtlasGrid.y));',
      '    m = textureGrad(uAtlas, auv, gx, gy).r;',
      '  }',
      '  vec3 bl = texture(uBloom, fc / uScreen).rgb * (1.0 - smoothstep(0.8, 1.2, length(fc - uTruth) / uFadeR));',
      '  float bll = dot(bl, vec3(0.3, 0.5, 0.2));',
      '  bl = bl / (1.0 + bl);',
      '  vec3 outc = mix(bl, bll / (1.0 + bll) * uAmber, 0.5) * uBloomAmt + col * m;',
      '  outc *= 0.95 + 0.05 * sin(fc.y * 3.14159265 / uPR);',
      '  vec2 uv = fc / uScreen - 0.5; uv.x *= uScreen.x / uScreen.y;',
      '  outc = uBg + outc * mix(0.55, 1.0, smoothstep(1.15, 0.3, length(uv)));',
      '  O = vec4(outc, 1.0);',
      '}'
    ].join('\n');
  }

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
  function tiltedNormal(r, bias) {
    var v = randUnit(r);
    if (v[1] < 0) { v = [-v[0], -v[1], -v[2]]; }
    return norm([v[0], v[1] + bias, v[2]]);
  }
  function smooth01(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

  function buildAtlas() {
    var ramp = RAMP.slice(1).split('');
    var fontPx = Math.round(TILE_H * 0.74);
    var font = '600 ' + fontPx + 'px ' + FONT;
    function draw(ctx, ch, x, y) {
      var lw = 6, cx = x + TILE_W / 2, cy = y + TILE_H / 2, i, j, q;
      if (PROCEDURAL.indexOf(ch) < 0) { ctx.fillText(ch, cx, cy + TILE_H * 0.03); return; }
      if (ch === '\u2588') { ctx.fillRect(x, y, TILE_W, TILE_H); return; }
      if (ch === '\u2591' || ch === '\u2592' || ch === '\u2593') {
        var fill = ch === '\u2591' ? 1 : ch === '\u2592' ? 2 : 3;
        for (j = 0; j < TILE_H; j += 8) {
          for (i = 0; i < TILE_W; i += 8) {
            var odd = ((i + j) / 8) & 1;
            for (q = 0; q < fill; q++) {
              var k = (q + odd * 2) & 3;
              ctx.fillRect(x + i + (k & 1) * 4, y + j + (k >> 1) * 4, 4, 4);
            }
          }
        }
        return;
      }
      if (ch === '\u2500' || ch === '\u253C') ctx.fillRect(x, cy - lw / 2, TILE_W, lw);
      if (ch === '\u2502' || ch === '\u253C') ctx.fillRect(cx - lw / 2, y, lw, TILE_H);
      if (ch === '\u2571' || ch === '\u2572') {
        ctx.lineWidth = lw; ctx.beginPath();
        if (ch === '\u2571') { ctx.moveTo(x, y + TILE_H); ctx.lineTo(x + TILE_W, y); } else { ctx.moveTo(x, y); ctx.lineTo(x + TILE_W, y + TILE_H); }
        ctx.stroke();
      }
      if (ch === '\u25C6') {
        ctx.beginPath(); ctx.moveTo(cx, cy - TILE_H * 0.2); ctx.lineTo(cx + TILE_W * 0.26, cy);
        ctx.lineTo(cx, cy + TILE_H * 0.2); ctx.lineTo(cx - TILE_W * 0.26, cy); ctx.closePath(); ctx.fill();
      }
    }
    function prep(ctx) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
      ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    }
    // measure ink coverage of each ramp glyph in this font, sort ascending
    var meas = document.createElement('canvas');
    meas.width = TILE_W * ramp.length; meas.height = TILE_H;
    var mctx = meas.getContext('2d', { willReadFrequently: true });
    prep(mctx);
    ramp.forEach(function (ch, i) { draw(mctx, ch, i * TILE_W, 0); });
    var px = mctx.getImageData(0, 0, meas.width, meas.height).data;
    var cov = ramp.map(function (ch, i) {
      var s = 0;
      for (var y = 0; y < TILE_H; y++) for (var x = 0; x < TILE_W; x++) s += px[(y * meas.width + i * TILE_W + x) * 4];
      return { ch: ch, c: s, i: i };
    });
    cov.sort(function (a, b) { return a.c - b.c || a.i - b.i; });
    var list = [' '].concat(cov.filter(function (o) { return o.c > 0; }).map(function (o) { return o.ch; }), BLOCKS);
    var rampN = list.length;
    list = list.concat(SPECIAL, ALNUM.split(''));
    var rows = Math.ceil(list.length / ATLAS_COLS);
    var cv = document.createElement('canvas');
    cv.width = TILE_W * ATLAS_COLS; cv.height = TILE_H * rows;
    var ctx = cv.getContext('2d');
    prep(ctx);
    list.forEach(function (ch, i) { draw(ctx, ch, (i % ATLAS_COLS) * TILE_W, Math.floor(i / ATLAS_COLS) * TILE_H); });
    return { canvas: cv, list: list, rampN: rampN, cols: ATLAS_COLS, rows: rows };
  }

  function labelCodes(atlas, text) {
    var out = new Int32Array(8);
    for (var i = 0; i < 8 && i < text.length; i++) { var k = atlas.list.indexOf(text[i]); out[i] = k > 0 ? k : 0; }
    return out;
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
        premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
      });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
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
    var LINKS_PER = 3;                   // 2 nearest neighbours + global centroid
    var NLINK = NS * LINKS_PER;
    var LINK_PTS = coarse ? 32 : 72;
    var SIM_RES = 256, DYE_RES = 512;
    var PRESSURE_ITERS = coarse ? 8 : 14;
    var CELL_W = 6, CELL_H = 9;          // CSS px per ASCII cell (scaled by DPR)
    var FOV = 40, TAN_H = Math.tan(FOV * Math.PI / 360);
    var EXTENT_GAIN = 0.8;               // calibrates the CPU extent estimate to the rendered 95th percentile

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
      honey: v3(0xF2B632), honeyDeep: v3(0xE8A90C), hot: v3(0xFFE7B3), lav: v3(0x8088E8),
      cer: v3(0xB8482A), bg: v3(0x05060A), amber: v3(0xF2B632)
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
    var rnd = mulberry(0x1A2A1);
    var socs = [], subs = [];
    var sharedN = norm([0.25, 1, 0.12]), sharedF = frame(sharedN);
    for (var i = 0; i < NS; i++) {
      var s;
      if (i & 1) {
        var m0 = socs[i - 1];
        s = { f: m0.f, R: m0.R, w: m0.w, th: m0.th + Math.PI, off: [-m0.off[0], -m0.off[1], -m0.off[2]], br: rnd() * 6.28 };
      } else {
        var dir = randUnit(rnd), ol = 0.75 + 0.8 * rnd();
        s = {
          f: frame(tiltedNormal(rnd, 0.35 + rnd() * 1.2)),
          R: 1.25 + 1.9 * Math.pow(rnd(), 0.8),
          w: (0.07 + 0.2 * rnd()) * (rnd() < 0.3 ? -1 : 1),
          th: rnd() * Math.PI * 2,
          off: [dir[0] * ol, dir[1] * ol * 0.7, dir[2] * ol],
          br: rnd() * 6.28
        };
      }
      s.pos = [0, 0, 0];
      socs.push(s);
      for (var j = 0; j < NSUB; j++) {
        subs.push({
          f: frame(randUnit(rnd)), r: 0.2 + 0.24 * rnd(), w: (0.22 + 0.5 * rnd()) * (rnd() < 0.5 ? -1 : 1),
          th: rnd() * Math.PI * 2, shell: 0.11 + 0.11 * rnd(), swirl: (0.5 + 1.1 * rnd()) * (rnd() < 0.5 ? -1 : 1),
          axis: randUnit(rnd), br: rnd() * 6.28
        });
      }
    }
    var sharedW = 0.21, sharedTh = 0, sharedR = 0.95, sharedSpin = 0;
    var centData = new Float32Array(NSS * 2 * 4);
    var centTex = dataTex(centData, NSS, 2);
    var linkData = new Float32Array(NLINK * 2 * 4);
    var linkTex = dataTex(linkData, NLINK, 2);

    function rotAxis(v, a, ang) { // Rodrigues
      var c = Math.cos(ang), sn = Math.sin(ang), d = (a[0] * v[0] + a[1] * v[1] + a[2] * v[2]) * (1 - c), cr = cross(a, v);
      return [v[0] * c + cr[0] * sn + a[0] * d, v[1] * c + cr[1] * sn + a[1] * d, v[2] * c + cr[2] * sn + a[2] * d];
    }

    // ~95th-percentile distance of the swarm from the global centroid (world units), from sub-swarm
    // centroids plus their shell and turbulence spread; drives the camera framing
    var extArr = new Float32Array(NSS), worldExt = 3.5;
    function updateWorld(dt, t, lock) {
      sharedTh += sharedW * dt;
      sharedSpin += 0.35 * dt;
      var sc = [
        sharedR * (sharedF.u[0] * Math.cos(sharedTh) + sharedF.w[0] * Math.sin(sharedTh)),
        sharedR * (sharedF.u[1] * Math.cos(sharedTh) + sharedF.w[1] * Math.sin(sharedTh)),
        sharedR * (sharedF.u[2] * Math.cos(sharedTh) + sharedF.w[2] * Math.sin(sharedTh))
      ];
      var i, j, k;
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
        for (k = 0; k < 3; k++) s.pos[k] = ind[k] + (sc[k] + ro[k] - ind[k]) * lock;
        for (j = 0; j < NSUB; j++) {
          var b = subs[i * NSUB + j];
          b.th += dt * b.w * (1 - 0.5 * lock);
          var r = b.r * (1 - 0.35 * lock) * (1 + 0.15 * Math.sin(t * 0.8 + b.br));
          var bc = Math.cos(b.th), bs = Math.sin(b.th);
          var o = (i * NSUB + j) * 4, o2 = (NSS + i * NSUB + j) * 4;
          for (k = 0; k < 3; k++) centData[o + k] = s.pos[k] + r * (b.f.u[k] * bc + b.f.w[k] * bs);
          centData[o + 3] = b.shell * (1 - 0.15 * lock) * (1 + 0.12 * Math.sin(t * 0.9 + b.br * 2.0));
          extArr[i * NSUB + j] = Math.hypot(centData[o], centData[o + 1], centData[o + 2]) +
            centData[o + 3] * 1.25 + 0.3 * (1 - 0.8 * lock);
          for (k = 0; k < 3; k++) centData[o2 + k] = b.axis[k] + (sharedN[k] - b.axis[k]) * lock;
          centData[o2 + 3] = b.swirl * (1 - 0.35 * lock);
        }
      }
      centTex.needsUpdate = true;
      extArr.sort();
      worldExt = extArr[Math.floor(0.95 * (NSS - 1))];
      // filaments: each society -> 2 nearest societies, and -> global centroid
      for (i = 0; i < NS; i++) {
        var a = socs[i].pos, best = [-1, -1], bd = [1e9, 1e9];
        for (j = 0; j < NS; j++) {
          if (j === i) continue;
          var q = socs[j].pos, d2 = (a[0] - q[0]) * (a[0] - q[0]) + (a[1] - q[1]) * (a[1] - q[1]) + (a[2] - q[2]) * (a[2] - q[2]);
          if (d2 < bd[0]) { bd[1] = bd[0]; best[1] = best[0]; bd[0] = d2; best[0] = j; } else if (d2 < bd[1]) { bd[1] = d2; best[1] = j; }
        }
        for (k = 0; k < LINKS_PER; k++) {
          var li = i * LINKS_PER + k, oa = li * 4, ob = (NLINK + li) * 4, target, wgt;
          if (k < 2) {
            target = socs[best[k]].pos;
            wgt = smooth01((2.4 - Math.sqrt(bd[k])) / 1.6);
          } else { target = [0, 0, 0]; wgt = 0.55; }
          linkData[oa] = a[0]; linkData[oa + 1] = a[1]; linkData[oa + 2] = a[2]; linkData[oa + 3] = wgt;
          linkData[ob] = target[0]; linkData[ob + 1] = target[1]; linkData[ob + 2] = target[2]; linkData[ob + 3] = k === 2 ? 1 : 0;
        }
      }
      linkTex.needsUpdate = true;
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
        uPos: { value: null }, uVel: { value: null }, uInfo: { value: infoTex }, uCent: { value: centTex },
        uFluidVel: { value: null }, uFluidDye: { value: null },
        uDt: { value: 0 }, uTime: { value: 0 }, uK: { value: 7 }, uDrag: { value: 2.6 }, uTurb: { value: 1 },
        uLock: { value: 0 }, uNoiseFreq: { value: 0.9 }, uFluidForce: { value: 0 }, uNSub: { value: NSUB },
        uViewProj: { value: new THREE.Matrix4() }, uCamRight: { value: new THREE.Vector3() }, uCamUp: { value: new THREE.Vector3() }
      }),
      pos: mat(POS_FRAG, { uPos: { value: null }, uVel: { value: null }, uDt: { value: 0 } }),
      mean: mat(MEAN_FRAG, {
        uPos: { value: null }, uAgents: { value: agentTex }, uPrev: { value: null }, uN: { value: 1000 },
        uErr: { value: new THREE.Vector3() }, uBlend: { value: 1 }
      }),
      cells: mat(CELLS_FRAG, { uScene: { value: null }, uCellPx: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() } }),
      down: mat(DOWN_FRAG, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } }),
      blur: mat(BLUR_FRAG, { uTex: { value: null }, uDir: { value: new THREE.Vector2() } })
    };

    // ------------------------------------------------------------ atlas + ascii
    var atlas = buildAtlas();
    var atlasTex = track(new THREE.CanvasTexture(atlas.canvas));
    atlasTex.flipY = false;
    atlasTex.generateMipmaps = true;
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    function gi(ch) { return atlas.list.indexOf(ch); }
    var asciiUniforms = {
      uCells: { value: null }, uMarks: { value: null }, uAtlas: { value: atlasTex }, uBloom: { value: null },
      uCellPx: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() }, uGrid: { value: new THREE.Vector2() },
      uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      uTruth: { value: new THREE.Vector2(-1e4, -1e4) }, uMean: { value: null }, uViewProj: { value: new THREE.Matrix4() },
      uRampN: { value: atlas.rampN }, uTime: { value: 0 }, uGlitch: { value: reducedMotion ? 0 : 1 },
      uBloomAmt: { value: 0.28 }, uExposure: { value: 1.5 }, uRingR: { value: 22 }, uPR: { value: 1 }, uAgentGlyph: { value: 1 },
      uFadeR: { value: 1e5 },
      uLabelT: { value: labelCodes(atlas, LABEL_T) }, uLabelC: { value: labelCodes(atlas, LABEL_C) },
      uAmber: { value: COL.amber }, uHot: { value: COL.hot }, uLav: { value: COL.lav }, uCer: { value: COL.cer },
      uBg: { value: COL.bg }, uHoney: { value: COL.honey }
    };
    function makeAscii() {
      return mat(asciiFrag({
        agent: gi('\u25C6'), dot: gi('\u00B7'), h: gi('\u2500'), v: gi('\u2502'), cross: gi('\u253C'),
        fwd: gi('\u2571'), back: gi('\u2572'), times: gi('\u00D7'), lenT: LABEL_T.length, lenC: LABEL_C.length
      }), asciiUniforms);
    }
    M.ascii = makeAscii();
    if (document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(function () {
        if (destroyed) return;
        atlas = buildAtlas();
        atlasTex.image = atlas.canvas; atlasTex.needsUpdate = true;
        asciiUniforms.uAtlasGrid.value.set(atlas.cols, atlas.rows);
        asciiUniforms.uRampN.value = atlas.rampN;
        asciiUniforms.uLabelT.value = labelCodes(atlas, LABEL_T);
        asciiUniforms.uLabelC.value = labelCodes(atlas, LABEL_C);
        M.ascii.dispose();
        M.ascii = makeAscii();
        renderStill();
      });
    }

    // ------------------------------------------------------------ scene
    var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0.5, 10);
    var scene = new THREE.Scene();
    var markScene = new THREE.Scene();
    function idGeo(n) {
      var g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n), 1));
      return g;
    }
    var additive = { transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false };
    var partMat = track(new THREE.RawShaderMaterial(Object.assign({
      glslVersion: THREE.GLSL3, vertexShader: PARTICLE_VERT, fragmentShader: POINT_FRAG,
      uniforms: {
        uPos: { value: null }, uVel: { value: null }, uInfo: { value: infoTex }, uSize: { value: SIZE },
        uPointScale: { value: 1 }, uIntensity: { value: coarse ? 0.75 : 0.18 }, uTime: { value: 0 },
        uHoney: { value: COL.honey }, uHoneyDeep: { value: COL.honeyDeep }, uHot: { value: COL.hot }, uLav: { value: COL.lav }
      }
    }, additive)));
    var particles = new THREE.Points(idGeo(COUNT), partMat);
    particles.frustumCulled = false;
    scene.add(particles);

    var linkMat = track(new THREE.RawShaderMaterial(Object.assign({
      glslVersion: THREE.GLSL3, vertexShader: LINK_VERT, fragmentShader: POINT_FRAG,
      uniforms: {
        uLinks: { value: linkTex }, uPer: { value: LINK_PTS }, uPointScale: { value: 1 }, uIntensity: { value: 8.0 },
        uTime: { value: 0 }, uColor: { value: COL.honeyDeep }, uLav: { value: COL.lav }
      }
    }, additive)));
    var links = new THREE.Points(idGeo(NLINK * LINK_PTS), linkMat);
    links.frustumCulled = false;
    scene.add(links);

    var agentUniforms = {
      uPos: { value: null }, uAgents: { value: agentTex }, uPointScale: { value: 1 }, uIntensity: { value: 0.5 },
      uMarkScaleX: { value: 1 }, uMarkScaleY: { value: 1 }, uTime: { value: 0 }, uColor: { value: COL.honey }, uMarks: { value: 0 }
    };
    var agentMat = track(new THREE.RawShaderMaterial(Object.assign({
      glslVersion: THREE.GLSL3, vertexShader: AGENT_VERT, fragmentShader: POINT_FRAG, uniforms: agentUniforms
    }, additive)));
    var agentGeo = idGeo(MAX_AGENTS);
    var agentPts = new THREE.Points(agentGeo, agentMat);
    agentPts.frustumCulled = false;
    scene.add(agentPts);
    var markUniforms = Object.assign({}, agentUniforms, { uMarks: { value: 1 } });
    var markMat = track(new THREE.RawShaderMaterial(Object.assign({
      glslVersion: THREE.GLSL3, vertexShader: AGENT_VERT, fragmentShader: FRAG_HEAD + 'in vec3 vColor; void main(){ O = vec4(vColor, 1.0); }',
      uniforms: markUniforms
    }, additive)));
    var markPts = new THREE.Points(agentGeo, markMat);
    markPts.frustumCulled = false;
    markScene.add(markPts);

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
      pass(M.mean, meanRT.write); meanRT.swap();
    }

    // ------------------------------------------------------------ sizing
    var cssW = 0, cssH = 0, pr = 1, bufW = 0, bufH = 0, cols = 0, rows = 0, cellW = 6, cellH = 9;
    var sceneRT = null, cellsRT = null, marksRT = null, bloomA = null, bloomB = null;
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
      [sceneRT, cellsRT, marksRT, bloomA, bloomB].forEach(function (r) {
        if (r) { r.dispose(); disposables.splice(disposables.indexOf(r), 1); }
      });
      var sw = Math.min(cssW, 2048), sh = Math.max(2, Math.round(sw * cssH / cssW));
      sceneRT = rt(sw, sh, HF, THREE.LinearFilter);
      cellsRT = rt(cols, rows, HF, THREE.NearestFilter);
      marksRT = rt(cols, rows, THREE.UnsignedByteType, THREE.NearestFilter);
      var bw = Math.max(2, Math.round(sw / 4)), bh = Math.max(2, Math.round(sh / 4));
      bloomA = rt(bw, bh, HF, THREE.LinearFilter);
      bloomB = rt(bw, bh, HF, THREE.LinearFilter);

      var aspect = cssW / cssH;
      camera.aspect = aspect;
      var tanH = TAN_H;
      applyFocus();
      var projScale = sh * 0.5 / tanH;
      partMat.uniforms.uPointScale.value = (coarse ? 0.024 : 0.0125) * projScale;
      linkMat.uniforms.uPointScale.value = 0.016 * projScale;
      agentUniforms.uPointScale.value = 0.035 * projScale;
      agentUniforms.uMarkScaleX.value = bufW / (cols * cellW);
      agentUniforms.uMarkScaleY.value = bufH / (rows * cellH);
      M.cells.uniforms.uCellPx.value.set(cellW, cellH);
      M.cells.uniforms.uScreen.value.set(bufW, bufH);
      asciiUniforms.uCellPx.value.set(cellW, cellH);
      asciiUniforms.uScreen.value.set(bufW, bufH);
      asciiUniforms.uGrid.value.set(cols, rows);
      asciiUniforms.uRingR.value = 22 * pr;
      asciiUniforms.uPR.value = pr;
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
      asciiUniforms.uFadeR.value = radiusS * cssH * pr;
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
      // monoculture packs every particle into one clump: lower exposure to keep glyph gradation
      asciiUniforms.uExposure.value = 1.5 * (1 - 0.72 * lock);
      U.uTurb.value = 1.5 + (0.3 - 1.5) * lock;
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

    function render(t) {
      partMat.uniforms.uPos.value = posRT.read.texture;
      partMat.uniforms.uVel.value = velRT.read.texture;
      partMat.uniforms.uTime.value = t;
      linkMat.uniforms.uTime.value = t;
      agentUniforms.uPos.value = posRT.read.texture;
      agentUniforms.uTime.value = t;
      markUniforms.uPos.value = posRT.read.texture;
      agentGeo.setDrawRange(0, Math.round(agentsT));
      asciiUniforms.uAgentGlyph.value = agentsT <= 100 ? 1 : 0;
      tmpV.set(0, 0, 0).project(camera);
      asciiUniforms.uTruth.value.set((tmpV.x * 0.5 + 0.5) * bufW, (tmpV.y * 0.5 + 0.5) * bufH);
      asciiUniforms.uViewProj.value.copy(viewProj);
      asciiUniforms.uMean.value = meanRT.read.texture;

      renderer.setRenderTarget(sceneRT); renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.setRenderTarget(marksRT); renderer.clear(true, false, false);
      renderer.render(markScene, camera);

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
      asciiUniforms.uMarks.value = marksRT.texture;
      asciiUniforms.uBloom.value = bloomA.texture;
      asciiUniforms.uTime.value = t;
      pass(M.ascii, null);
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
      render(simTime);
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
      render(simTime);
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
        M.ascii.dispose();
        renderer.setRenderTarget(null);
        renderer.dispose();
      }
    };
    return controller;
  }

  window.IraiSwarm = { create: create };
})();
