/* =====================================================================
   SHADER-BG · fond anime WebGL
   ---------------------------------------------------------------------
   Portage autonome du rendu ShaderGradient, sans Three.js et sans aucune
   dependance. Un seul canvas, un seul programme GLSL.

   Parametres repris de la configuration fournie :
     color1   #ffff17     color2 #f8ff26     color3 / fond  #000000
     uSpeed   0.05        uDensity 4.1       uFrequency 5.5
     uStrength 1.2        uAmplitude 0       grain on
     rotationZ 70 deg     positionX -0.1     pixelDensity 1.7

   Pourquoi un portage plutot que la bibliotheque d'origine : ShaderGradient
   s'appuie sur Three.js et sur react-three-fiber, soit plus de 600 Ko de
   dependances et un point de montage React. Cette application est un
   fichier HTML unique en JavaScript natif. Le rendu est donc reecrit en
   GLSL direct : meme aspect, meme mouvement, 6 Ko, zero dependance.

   API :
     ShaderBG.mount(canvas)   prepare le contexte et compile le programme
     ShaderBG.start()         lance la boucle de rendu
     ShaderBG.stop()          met en pause (economise la batterie)
     ShaderBG.destroy()       libere le contexte
   ===================================================================== */
(function (global) {
  "use strict";

  var VERT = [
    "attribute vec2 p;",
    "void main(){ gl_Position = vec4(p, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "precision highp float;",
    "uniform vec2  uRes;",
    "uniform float uTime;",
    "uniform vec3  uC1;",
    "uniform vec3  uC2;",
    "uniform float uDensity;",
    "uniform float uFrequency;",
    "uniform float uStrength;",
    "uniform float uGrain;",

    /* Bruit simplexe 2D — implementation Ashima/Gustavson, domaine public.
       Choisi plutot qu'un bruit de valeur : ses gradients sont isotropes,
       donc les bandes ne montrent pas d'artefacts alignes sur les axes. */
    "vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }",
    "vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }",
    "vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }",
    "float snoise(vec2 v){",
    "  const vec4 C = vec4(0.211324865405187, 0.366025403784439,",
    "                     -0.577350269189626, 0.024390243902439);",
    "  vec2 i  = floor(v + dot(v, C.yy));",
    "  vec2 x0 = v -   i + dot(i, C.xx);",
    "  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);",
    "  vec4 x12 = x0.xyxy + C.xxzz;",
    "  x12.xy -= i1;",
    "  i = mod289(i);",
    "  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))",
    "                          + i.x + vec3(0.0, i1.x, 1.0));",
    "  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);",
    "  m = m*m; m = m*m;",
    "  vec3 x  = 2.0 * fract(p * C.www) - 1.0;",
    "  vec3 h  = abs(x) - 0.5;",
    "  vec3 ox = floor(x + 0.5);",
    "  vec3 a0 = x - ox;",
    "  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);",
    "  vec3 g;",
    "  g.x  = a0.x  * x0.x  + h.x  * x0.y;",
    "  g.yz = a0.yz * x12.xz + h.yz * x12.yw;",
    "  return 130.0 * dot(m, g);",
    "}",

    /* Bruit fractionnaire : quatre octaves suffisent. Au-dela le gain
       visuel est nul a cette echelle et le cout grimpe sur mobile. */
    "float fbm(vec2 p){",
    "  float s = 0.0, a = 0.5;",
    "  for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.02; a *= 0.5; }",
    "  return s;",
    "}",

    "void main(){",
    "  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);",

    /* rotationZ = 70 deg, positionX = -0.1 */
    "  float ca = cos(1.2217), sa = sin(1.2217);",
    "  uv = mat2(ca, -sa, sa, ca) * uv;",
    "  uv.x -= 0.1;",

    "  float t = uTime * 0.05;",

    /* Deformation du domaine : c'est elle qui produit les plis larges et
       lents caracteristiques du rendu d'origine. Deux passes suffisent ;
       une troisieme rendait le mouvement nerveux. */
    "  vec2 q = vec2(fbm(uv * uDensity * 0.35 + t),",
    "                fbm(uv * uDensity * 0.35 + vec2(3.7, 1.3) - t));",
    "  vec2 r = vec2(fbm(uv * uDensity * 0.5 + q * uStrength + t * 0.7),",
    "                fbm(uv * uDensity * 0.5 + q * uStrength + vec2(8.2, 2.8)));",
    "  float n = fbm(uv * uFrequency * 0.28 + r * uStrength);",

    /* Remise a [0,1] puis courbe de reponse : le seuil bas garde de larges
       aplats noirs, comme sur la reference. */
    "  float v = clamp(n * 0.5 + 0.5, 0.0, 1.0);",
    "  v = smoothstep(0.34, 0.92, v);",
    "  v = pow(v, 1.35);",

    "  vec3 jaune = mix(uC1, uC2, clamp(r.x * 0.5 + 0.5, 0.0, 1.0));",
    "  vec3 col = mix(vec3(0.0), jaune, v);",

    /* Grain. Sur un degrade sombre le banding est tres visible ; le grain
       le masque en plus de reproduire le rendu d'origine. */
    "  float g = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);",
    "  col += (g - 0.5) * uGrain;",

    "  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);",
    "}"
  ].join("\n");

  function compiler(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("[shader-bg] compilation :", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  var ShaderBG = {
    _gl: null, _cv: null, _prog: null, _raf: 0, _t0: 0, _u: {},
    /* pixelDensity 1.7 sur la reference : on la respecte. */
    dpr: Math.min(window.devicePixelRatio || 1, 1.7),
    couleurs: { c1: [1.0, 1.0, 0.09], c2: [0.973, 1.0, 0.149] },
    reglages: { densite: 4.1, frequence: 5.5, force: 1.2, grain: 0.055 },

    mount: function (canvas) {
      if (!canvas) return false;
      var gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" })
            || canvas.getContext("experimental-webgl");
      if (!gl) { console.warn("[shader-bg] WebGL indisponible"); return false; }

      var vs = compiler(gl, gl.VERTEX_SHADER, VERT);
      var fs = compiler(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;

      var pr = gl.createProgram();
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
        console.warn("[shader-bg] edition de liens :", gl.getProgramInfoLog(pr));
        return false;
      }
      gl.useProgram(pr);

      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(pr, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this._gl = gl; this._cv = canvas; this._prog = pr;
      this._u = {
        res:  gl.getUniformLocation(pr, "uRes"),
        time: gl.getUniformLocation(pr, "uTime"),
        c1:   gl.getUniformLocation(pr, "uC1"),
        c2:   gl.getUniformLocation(pr, "uC2"),
        den:  gl.getUniformLocation(pr, "uDensity"),
        fre:  gl.getUniformLocation(pr, "uFrequency"),
        str:  gl.getUniformLocation(pr, "uStrength"),
        gra:  gl.getUniformLocation(pr, "uGrain"),
      };
      gl.uniform3fv(this._u.c1, this.couleurs.c1);
      gl.uniform3fv(this._u.c2, this.couleurs.c2);
      gl.uniform1f(this._u.den, this.reglages.densite);
      gl.uniform1f(this._u.fre, this.reglages.frequence);
      gl.uniform1f(this._u.str, this.reglages.force);
      gl.uniform1f(this._u.gra, this.reglages.grain);

      this._resize();
      this._onResize = this._resize.bind(this);
      window.addEventListener("resize", this._onResize);
      this._t0 = performance.now();
      return true;
    },

    _resize: function () {
      if (!this._gl || !this._cv) return;
      var w = Math.max(1, Math.round(this._cv.clientWidth  * this.dpr));
      var hh = Math.max(1, Math.round(this._cv.clientHeight * this.dpr));
      if (this._cv.width === w && this._cv.height === hh) return;
      this._cv.width = w; this._cv.height = hh;
      this._gl.viewport(0, 0, w, hh);
      this._gl.uniform2f(this._u.res, w, hh);
    },

    start: function () {
      if (!this._gl || this._raf) return;
      var self = this;
      /* Plein regime : le grain se recalcule a chaque image, a 30 images
         par seconde son scintillement devient granuleux. */
      (function boucle(now) {
        self._raf = requestAnimationFrame(boucle);
        self._resize();
        self._gl.uniform1f(self._u.time, (now - self._t0) / 1000);
        self._gl.drawArrays(self._gl.TRIANGLES, 0, 3);
      })(performance.now());
    },

    stop: function () {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    },

    destroy: function () {
      this.stop();
      if (this._onResize) window.removeEventListener("resize", this._onResize);
      var gl = this._gl;
      if (gl) { var e = gl.getExtension("WEBGL_lose_context"); if (e) e.loseContext(); }
      this._gl = this._cv = this._prog = null;
    },
  };

  global.ShaderBG = ShaderBG;
})(window);
