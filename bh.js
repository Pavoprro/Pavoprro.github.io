/*  OMEN·IT — "Horizonte"
 *  Agujero negro procedimental ligado al scroll (WebGL1 crudo, sin librerías).
 *  Reconstrucción del efecto del sitio omen-it.tech.
 *
 *  Timeline (scroll-scrub):
 *    hero (centrado, dramático)
 *      -> vista cenital en "qué hacemos"
 *        -> full-bleed con lensing + flare en el manifiesto
 *          -> colapso hacia el caret del chat
 *            -> un punto en el footer
 *
 *  Degradación: sin WebGL o prefers-reduced-motion -> se deja el fallback CSS.
 *  Watchdog: baja la resolución si la GPU no da. DPR clamp 1.5. Pausa con pestaña oculta.
 *  QA:  ?bhp=0..1  fija el progreso   |  ?bhscroll=1  imprime el progreso en consola
 */
(function () {
  "use strict";

  var canvas = document.getElementById("bh");
  if (!canvas) return;

  var params = new URLSearchParams(location.search);
  var forcedProg = params.has("bhp") ? clamp(parseFloat(params.get("bhp")), 0, 1) : null;
  var logScroll = params.get("bhscroll") === "1";

  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var gl = null;
  try {
    gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" })
      || canvas.getContext("experimental-webgl", { antialias: false, alpha: false });
  } catch (e) { gl = null; }

  // Sin WebGL o movimiento reducido -> el fallback CSS de bh.css se queda tal cual.
  if (!gl || reduce) return;

  document.documentElement.classList.add("bh-on");

  /* ---------- shaders ---------- */
  var VERT = [
    "attribute vec2 a;",
    "void main(){ gl_Position = vec4(a, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "precision highp float;",
    "uniform vec2  uRes;",
    "uniform float uTime;",
    "uniform vec2  uCenter;",   // centro en unidades y-normalizadas (y hacia arriba)
    "uniform float uRadius;",   // radio del horizonte de sucesos
    "uniform float uTilt;",     // 0 = de canto, 1 = cenital
    "uniform float uBright;",   // intensidad global
    "uniform float uSeed;",

    "float h21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }",
    "float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);",
    "  float a=h21(i),b=h21(i+vec2(1.0,0.0)),c=h21(i+vec2(0.0,1.0)),d=h21(i+vec2(1.0,1.0));",
    "  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }",
    "float fbm(vec2 p){ float v=0.0,a=0.55; mat2 m=mat2(1.6,1.2,-1.2,1.6);",
    "  for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p; a*=0.5; } return v; }",

    "void main(){",
    "  vec2 uv = (gl_FragCoord.xy - 0.5*uRes)/uRes.y;",
    "  vec2 p  = uv - uCenter;",
    "  float r = length(p);",
    "  float ang = atan(p.y, p.x);",
    "  float Rh = max(uRadius, 0.0008);",
    "  float ny = p.y/(r+1e-4);",              // componente vertical normalizada
    "  vec3 col = vec3(0.0);",

    // campo de estrellas tenue, lejos del anillo
    "  float st = pow(h21(floor((uv+uSeed)*vec2(uRes.x/uRes.y,1.0)*380.0)), 60.0);",
    "  col += st * 0.45 * smoothstep(Rh*2.2, Rh*4.2, r);",

    // arrastre de marco: wisps lenseados girando cerca del horizonte
    "  float drag = 0.72/(r+0.06);",
    "  float a2 = ang + drag + uTime*0.04;",
    "  float wisp = fbm(vec2(a2*1.4, r*5.0 - uTime*0.05));",
    "  wisp *= (1.0 - smoothstep(Rh*1.02, Rh*3.4, r));",
    "  col += vec3(wisp) * 0.34 * uBright;",

    // disco de acreción fino y kepleriano, inclinado (elipse)
    "  float sq = mix(0.14, 0.72, uTilt);",
    "  vec2 e = vec2(p.x, p.y/sq);",
    "  float er = length(e);",
    "  float Rin = Rh*1.25, Rout = Rh*3.35;",
    "  float disk = smoothstep(Rin, Rin+Rh*0.5, er) * (1.0 - smoothstep(Rout-Rh, Rout, er));",
    "  float dtex = 0.55 + 0.75*fbm(vec2(ang*3.0 + uTime*0.25, er*7.0));",
    "  disk *= dtex;",
    // doppler: un lado (izquierdo) mucho más brillante
    "  float dopp = 0.30 + 0.95*(0.5 - 0.5*cos(ang));",
    "  disk *= dopp;",
    // la mitad cercana (abajo) cruza POR DELANTE de la sombra; la lejana detrás se oculta
    "  float front = step(0.0, -p.y);",
    "  float behindHidden = 1.0 - (step(0.0, p.y) * (1.0 - smoothstep(Rh, Rh*1.03, r)));",
    "  disk *= mix(behindHidden, 1.0, front);",
    "  col += vec3(disk) * 1.10 * uBright;",

    // arco lenseado del lado lejano (anillo de Einstein primario, arriba)
    "  float arc = exp(-pow((r - Rh*1.12)/(Rh*0.10), 2.0));",
    "  arc *= smoothstep(-0.4, 0.7, ny);",
    "  arc *= 0.7 + 0.6*fbm(vec2(ang*4.0 - uTime*0.2, 3.0));",
    "  col += vec3(arc) * 0.85 * uBright;",
    // secundario tenue abajo
    "  float arc2 = exp(-pow((r - Rh*1.30)/(Rh*0.06), 2.0)) * (1.0 - smoothstep(-0.6, 0.2, ny));",
    "  col += vec3(arc2) * 0.22 * uBright;",

    // anillo de fotones fino y brillante
    "  float ring = exp(-pow((r - Rh*1.03)/(Rh*0.05), 2.0));",
    "  col += vec3(ring) * (1.45*uBright);",

    // sombra: negro puro dentro del horizonte
    "  float shadow = 1.0 - smoothstep(Rh*0.96, Rh*1.0, r);",
    "  col *= (1.0 - shadow);",

    // desvanecido del campo lejano
    "  col *= (1.0 - smoothstep(0.95, 2.5, r));",

    // tono suave (tipo filmic) y clamp
    "  col = 1.0 - exp(-col*1.45);",
    "  col = clamp(col, 0.0, 1.0);",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("[bh] shader error:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { document.documentElement.classList.remove("bh-on"); return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[bh] link error:", gl.getProgramInfoLog(prog));
    document.documentElement.classList.remove("bh-on");
    return;
  }
  gl.useProgram(prog);

  // triángulo de pantalla completa
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aLoc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

  var U = {
    res: gl.getUniformLocation(prog, "uRes"),
    time: gl.getUniformLocation(prog, "uTime"),
    center: gl.getUniformLocation(prog, "uCenter"),
    radius: gl.getUniformLocation(prog, "uRadius"),
    tilt: gl.getUniformLocation(prog, "uTilt"),
    bright: gl.getUniformLocation(prog, "uBright"),
    seed: gl.getUniformLocation(prog, "uSeed")
  };
  gl.uniform1f(U.seed, Math.random() * 10.0);

  /* ---------- estado / resize ---------- */
  var dprCap = 1.5;
  var scale = 1.0;          // el watchdog lo baja si hay lag
  var W = 0, H = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, dprCap) * scale;
    W = Math.max(1, Math.floor(innerWidth * dpr));
    H = Math.max(1, Math.floor(innerHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    gl.viewport(0, 0, W, H);
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  /* ---------- keyframes del timeline ----------
   * cx/cy en unidades y-normalizadas (y hacia arriba). r = radio. t = tilt. b = brillo.
   */
  var KF = [
    { p: 0.00, cx: 0.16, cy: 0.06, r: 0.17, t: 0.20, b: 1.00 }, // hero
    { p: 0.28, cx: 0.00, cy: 0.34, r: 0.12, t: 0.85, b: 0.95 }, // servicios (cenital, arriba)
    { p: 0.56, cx: 0.00, cy: 0.00, r: 0.30, t: 0.45, b: 1.25 }, // manifiesto (full-bleed + flare)
    { p: 0.82, cx: 0.00, cy: -0.20, r: 0.055, t: 0.30, b: 1.05 }, // colapso al caret del chat
    { p: 1.00, cx: 0.00, cy: 0.00, r: 0.006, t: 0.50, b: 1.10 }  // punto en el footer
  ];

  function sampleKF(p) {
    var a = KF[0], b = KF[KF.length - 1];
    for (var i = 0; i < KF.length - 1; i++) {
      if (p >= KF[i].p && p <= KF[i + 1].p) { a = KF[i]; b = KF[i + 1]; break; }
    }
    var span = (b.p - a.p) || 1;
    var k = clamp((p - a.p) / span, 0, 1);
    k = k * k * (3 - 2 * k); // smoothstep
    return {
      cx: lerp(a.cx, b.cx, k),
      cy: lerp(a.cy, b.cy, k),
      r: lerp(a.r, b.r, k),
      t: lerp(a.t, b.t, k),
      b: lerp(a.b, b.b, k)
    };
  }

  function scrollProg() {
    if (forcedProg !== null) return forcedProg;
    var max = document.documentElement.scrollHeight - innerHeight;
    var p = max > 0 ? window.scrollY / max : 0;
    return clamp(p, 0, 1);
  }

  /* ---------- watchdog de rendimiento ---------- */
  var slow = 0, lastT = performance.now();

  var running = true;
  document.addEventListener("visibilitychange", function () {
    running = !document.hidden;
    if (running) { lastT = performance.now(); requestAnimationFrame(frame); }
  });

  function frame(now) {
    if (!running) return;
    var dt = now - lastT; lastT = now;

    // si vamos lento de forma sostenida, bajamos resolución una vez
    if (dt > 34) { slow++; } else { slow = Math.max(0, slow - 1); }
    if (slow > 45 && scale > 0.62) { scale = 0.62; slow = 0; resize(); }

    var p = scrollProg();
    if (logScroll) console.log("[bh] prog", p.toFixed(3));
    var s = sampleKF(p);

    gl.uniform2f(U.res, W, H);
    gl.uniform1f(U.time, now * 0.001);
    gl.uniform2f(U.center, s.cx, s.cy);
    gl.uniform1f(U.radius, s.r);
    gl.uniform1f(U.tilt, s.t);
    gl.uniform1f(U.bright, s.b);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- utils ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }
})();
