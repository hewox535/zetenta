import './style.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { Z_CELLS, WORDMARK_D } from './brand.js';

gsap.registerPlugin(ScrollTrigger);

// La app vive en el mismo dominio (la landing solo ocupa la raíz), así que los
// botones de cuenta son rutas internas; VITE_APP_URL permite apuntar a otra.
const APP_URL = (import.meta.env.VITE_APP_URL || '').replace(/\/$/, '');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ============================================================
   Marca e íconos inyectados (un solo origen para la Z y el wordmark)
   ============================================================ */
function rect(x, y, cls) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', x); r.setAttribute('y', y);
  r.setAttribute('width', 48); r.setAttribute('height', 48); r.setAttribute('rx', 12);
  if (cls) r.setAttribute('class', cls);
  return r;
}
const isZ = (row, col) => Z_CELLS.some(([r, c]) => r === row && c === col);

function paintBrand() {
  $$('[data-zsymbol]').forEach((svg) => Z_CELLS.forEach(([r, c]) => svg.appendChild(rect(c * 60, r * 60))));
  $$('[data-zsymbol-g]').forEach((g) => Z_CELLS.forEach(([r, c]) => g.appendChild(rect(112 + c * 60, 112 + r * 60))));
  $$('[data-wordmark]').forEach((svg) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', WORDMARK_D);
    svg.appendChild(p);
  });
  $$('[data-wordmark-path]').forEach((p) => p.setAttribute('d', WORDMARK_D));

  // Loader y CTA: la matriz completa de 5 × 5, con la Z encendida encima.
  for (const svg of [$('#loaderGrid'), $('#ctaZ')]) {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (!isZ(r, c)) svg.appendChild(rect(c * 60, r * 60, 'off'));
    }
    Z_CELLS.forEach(([r, c], i) => {
      const el = rect(c * 60, r * 60, 'on');
      el.dataset.i = i;
      svg.appendChild(el);
    });
  }
}

const ICONS = {
  cart: '<path d="M3 4h2.2l2.1 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6.1"/><circle cx="9.5" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  box: '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M10.5 18.5h3"/>',
  chat: '<path d="M4 18.5 5.3 15A7.5 7.5 0 1 1 9 18.2L4 18.5Z"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
function paintIcons() {
  $$('[data-ico]').forEach((el) => {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[el.dataset.ico] || ''}</svg>`;
  });
}

function wireAppLinks() {
  $$('[data-app]').forEach((a) => { a.href = APP_URL + a.dataset.app; });
}

/* ============================================================
   Utilidades
   ============================================================ */
const nf = (dec) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Cifras que corren hasta su valor (formato venezolano: $1.284,50).
function countUp(el, { duration = 1.6, delay = 0 } = {}) {
  const to = Number(el.dataset.count);
  const dec = el.dataset.dec != null ? Number(el.dataset.dec) : 2;
  const fmt = nf(dec);
  const pre = el.dataset.prefix || '';
  const suf = el.dataset.suffix || '';
  const o = { v: 0 };
  return gsap.to(o, {
    v: to, duration, delay, ease: 'power3.out',
    onUpdate: () => { el.textContent = pre + fmt.format(o.v) + suf; },
  });
}

// Parte un párrafo en palabras sin romper los tiles en línea.
function splitWords(el) {
  const out = [];
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const s = document.createElement('span');
          s.className = 'word';
          s.textContent = part;
          frag.appendChild(s);
          out.push(s);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.classList.contains('itile')) {
        out.push(n);
      } else if (n.nodeType === 1) {
        walk(n);
      }
    });
  };
  walk(el);
  return out;
}

function splitChars(el) {
  const out = [];
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((w) => {
          if (!w) return;
          if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
          const word = document.createElement('span');
          word.style.display = 'inline-block';
          [...w].forEach((ch) => {
            const s = document.createElement('span');
            s.className = 'char';
            s.textContent = ch;
            word.appendChild(s);
            out.push(s);
          });
          frag.appendChild(word);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  walk(el);
  return out;
}

/* ============================================================
   Scroll suave
   ============================================================ */
let lenis = null;
function smoothScroll() {
  if (REDUCED) return;
  lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();

  // Anclas internas con el mismo scroll suave.
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const target = $(id);
    if (!target) return;
    e.preventDefault();
    closeMenu();
    lenis.scrollTo(target, { offset: 0, duration: 1.4 });
  }));
}

/* ============================================================
   LOADER: la matriz se prende, la Z vuela al logo del nav
   ============================================================ */
function waitForAssets() {
  const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
  const load = document.readyState === 'complete'
    ? Promise.resolve()
    : new Promise((r) => window.addEventListener('load', r, { once: true }));
  return Promise.race([Promise.all([fonts, load]), new Promise((r) => setTimeout(r, 6000))]);
}

function runLoader() {
  const loader = $('#loader');
  if (REDUCED) {
    loader.remove();
    document.body.classList.remove('is-loading');
    return Promise.resolve();
  }
  const grid = $('#loaderGrid');
  const offs = $$('.off', grid);
  const ons = $$('.on', grid).sort((a, b) => a.dataset.i - b.dataset.i);
  const word = $('.loader-word', loader);
  const count = $('#loaderCount');
  const progress = { v: 0 };
  const show = () => { count.textContent = String(Math.round(progress.v)).padStart(3, '0'); };

  return new Promise((resolve) => {
    const intro = gsap.timeline();
    intro
      .from(offs, { scale: 0, opacity: 0, duration: .5, ease: 'back.out(2)', stagger: { each: .025, from: 'center' } })
      .to(ons, {
        opacity: 1, scale: 1, duration: .32, ease: 'back.out(3)',
        stagger: .085, startAt: { scale: .3 },
      }, '-=.15')
      .to(progress, { v: 86, duration: 1.4, ease: 'power1.inOut', onUpdate: show }, '<')
      .to(word, { clipPath: 'inset(0 0% 0 0)', duration: .7, ease: 'power3.inOut' }, '-=.35');

    Promise.all([waitForAssets(), new Promise((r) => intro.eventCallback('onComplete', r))]).then(() => {
      gsap.to(progress, {
        v: 100, duration: .45, ease: 'power2.out', onUpdate: show,
        onComplete: () => exitLoader(loader, grid, offs, ons, word).then(resolve),
      });
    });
  });
}

function exitLoader(loader, grid, offs, ons, word) {
  return new Promise((resolve) => {
    const navZ = $('.nav-z');
    const from = grid.getBoundingClientRect();
    const to = navZ.getBoundingClientRect();
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    const scale = to.width / from.width;

    gsap.set('.nav', { autoAlpha: 0 });
    const tl = gsap.timeline({
      onComplete: () => {
        loader.remove();
        document.body.classList.remove('is-loading');
        lenis?.start();
        ScrollTrigger.refresh();
        resolve();
      },
    });
    tl.to([offs, word, '.loader-meta'], { opacity: 0, duration: .35, ease: 'power2.in' })
      .to(ons, { scale: 1.12, duration: .18, ease: 'power2.out', stagger: { each: .01, from: 'end' } }, '<')
      .to('.loader-bg', { clipPath: 'inset(0 0 100% 0)', duration: 1, ease: 'expo.inOut' }, '-=.05')
      .to(grid, { x: dx, y: dy, scale, duration: 1, ease: 'expo.inOut' }, '<')
      .to(ons, { fill: '#2323FF', filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))', duration: .5 }, '<+.35')
      .add(heroIntro(), '<+.15')
      .to('.nav', { autoAlpha: 1, duration: .4 }, '-=.6')
      .to(grid, { opacity: 0, duration: .2 }, '-=.35');
  });
}

/* ============================================================
   HERO
   ============================================================ */
function heroIntro() {
  const tl = gsap.timeline();
  tl.call(() => heroLed?.sweep())
    .from('.hero-title .line > span', { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: .1 })
    .from('.hero .reveal-up', { y: 24, opacity: 0, duration: .9, ease: 'power3.out', stagger: .08 }, '-=.8')
    .fromTo('.hero-title .az', { opacity: 0 }, { opacity: 1, duration: .06, repeat: 4, yoyo: true, ease: 'none', stagger: .2 }, '-=.6')
    .from('.hero-device', { y: 140, opacity: 0, duration: 1.4, ease: 'expo.out' }, '-=1.1')
    .from('.scroll-hint', { opacity: 0, duration: .6 }, '-=.4');
  return tl;
}

/* ============================================================
   HERO: matriz LED de fondo. Los puntos se encienden alrededor del cursor
   (en táctil, una luz que pasea sola) y al entrar una onda la recorre.
   ============================================================ */
let heroLed = null;
function createHeroLed() {
  const canvas = $('#heroLed');
  const ctx = canvas.getContext('2d');
  const PITCH = 22;
  const RADIUS = 220;
  let w = 0, h = 0, dpr = 1, cols = 0, rows = 0, glow = new Float32Array(0);
  let pointer = { x: -9999, y: -9999, active: false };
  let wave = -1; // radio de la onda de entrada; -1 = sin onda
  let running = false;
  let t0 = performance.now();

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    cols = Math.ceil(w / PITCH) + 1; rows = Math.ceil(h / PITCH) + 1;
    glow = new Float32Array(cols * rows);
  };

  const frame = (now) => {
    if (!running) return;
    const t = (now - t0) / 1000;
    let px = pointer.x, py = pointer.y;
    if (!pointer.active) { // luz que pasea sola (táctil o sin mouse encima)
      px = w * (.5 + .34 * Math.sin(t * .45));
      py = h * (.32 + .18 * Math.sin(t * .7 + 1));
    }
    if (wave >= 0) wave += 22;
    if (wave > Math.hypot(w, h)) wave = -1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const ox = (w - (cols - 1) * PITCH) / 2;
    for (let r = 0; r < rows; r++) {
      const y = r * PITCH + PITCH / 2;
      const fade = Math.max(0, 1 - Math.pow(y / h, 1.4) * .95); // se apaga hacia abajo
      if (fade <= 0) continue;
      for (let c = 0; c < cols; c++) {
        const x = ox + c * PITCH;
        const k = r * cols + c;
        const d = Math.hypot(x - px, y - py);
        let target = d < RADIUS ? Math.pow(1 - d / RADIUS, 2) : 0;
        if (wave >= 0) {
          const dw = Math.abs(Math.hypot(x, y) - wave);
          if (dw < 60) target = Math.max(target, 1 - dw / 60);
        }
        if (Math.random() < .0006) target = Math.max(target, .7); // destellos sueltos
        glow[k] += (target - glow[k]) * (target > glow[k] ? .35 : .06);
        const g = glow[k];
        const a = (.13 + g * .87) * fade;
        const rad = 1.4 + g * 3.6;
        // De azul Zetenta a cielo en el centro del brillo.
        ctx.fillStyle = g > .55 ? `rgba(76,213,255,${a})` : `rgba(35,35,255,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  };

  const hero = $('.hero');
  hero.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top, active: true };
  });
  hero.addEventListener('pointerleave', () => { pointer.active = false; });
  addEventListener('resize', resize);
  resize();

  // Solo anima mientras el hero está a la vista.
  new IntersectionObserver(([entry]) => {
    const was = running;
    running = entry.isIntersecting;
    if (running && !was) requestAnimationFrame(frame);
  }).observe(hero);

  return { sweep: () => { wave = 0; } };
}

function heroMotion() {
  heroLed = createHeroLed();
  // Al bajar, el texto se aleja y la matriz se queda atrás.
  gsap.timeline({ scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })
    .to('.hero-copy', { y: -80, opacity: .2, ease: 'none' }, 0)
    .to('.hero-led', { yPercent: 18, ease: 'none' }, 0)
    .to('.hero-device', { y: -60, scale: 1.04, ease: 'none' }, 0);
}

/* ============================================================
   NAV y menú: la pastilla del logo se despliega en un panel
   ============================================================ */
let menuOpen = false;
let menuTl = null;
function setMenu(open) {
  if (open === menuOpen) return;
  menuOpen = open;
  $('#nav').classList.toggle('menu-open', open);
  $('#menuScrim').classList.toggle('open', open);
  $('#menu').setAttribute('aria-hidden', String(!open));
  $('#navMore').setAttribute('aria-expanded', String(open));
  $('#navMore').setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  if (open) { lenis?.stop(); menuTl.timeScale(1).play(); } else { lenis?.start(); menuTl.timeScale(1.6).reverse(); }
}
function closeMenu() { setMenu(false); }

function nav() {
  const navEl = $('#nav');
  ScrollTrigger.create({
    start: 120, end: () => ScrollTrigger.maxScroll(window) + 1,
    onToggle: (self) => navEl.classList.toggle('compact', self.isActive),
  });
  // Sobre secciones oscuras el nav cambia a su versión nocturna.
  $$('.story, .bigline, .visor, .gallery, .cta').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec, start: 'top 40px', end: 'bottom 40px',
      onToggle: (self) => navEl.classList.toggle('on-dark', self.isActive),
    });
  });

  menuTl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } })
    .set('#menu', { visibility: 'visible' })
    .fromTo('#menu', { opacity: 0, y: -14, scaleY: .92, clipPath: 'inset(0 0 100% 0 round 22px)' },
      { opacity: 1, y: 0, scaleY: 1, clipPath: 'inset(0 0 0% 0 round 22px)', duration: .6 })
    .fromTo('.menu-row', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .5, stagger: .05 }, '-=.42')
    .fromTo('.mtile', { scale: .4, rotation: -20 }, { scale: 1, rotation: 0, duration: .6, ease: 'back.out(2.2)', stagger: .05 }, '<')
    .fromTo('.menu-foot', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .4 }, '-=.35');
  menuTl.eventCallback('onReverseComplete', () => gsap.set('#menu', { visibility: 'hidden' }));

  $('#navMore').addEventListener('click', () => setMenu(!menuOpen));
  $('#menuScrim').addEventListener('click', closeMenu);
  $$('#menu a').forEach((a) => a.addEventListener('click', closeMenu));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
}

/* ============================================================
   MARQUEE: velocidad según el scroll
   ============================================================ */
function marquee() {
  const track = $('.marquee-track');
  track.innerHTML += track.innerHTML; // dos copias para el bucle
  const loop = gsap.to(track, { xPercent: -50, duration: 28, ease: 'none', repeat: -1 });
  ScrollTrigger.create({
    trigger: '.marquee-sec', start: 'top bottom', end: 'bottom top',
    onUpdate: (self) => {
      const v = Math.min(Math.abs(self.getVelocity()) / 400, 4);
      gsap.to(loop, { timeScale: (self.direction === -1 ? -1 : 1) * (1 + v), duration: .25, overwrite: true });
    },
  });
}

/* ============================================================
   Texto que se enciende palabra por palabra
   ============================================================ */
function scrubWords() {
  $$('[data-scrub-words]').forEach((el) => {
    const words = splitWords(el);
    const dark = el.closest('.bigline') ? '#fff' : '#0B0E2A';
    const tl = gsap.timeline({
      scrollTrigger: { trigger: el, start: 'top 82%', end: el.classList.contains('statement-text') ? 'bottom 45%' : 'bottom 60%', scrub: .6 },
    });
    words.forEach((w, i) => {
      if (w.classList.contains('itile')) {
        tl.from(w, { scale: 0, rotation: -25, duration: .6, ease: 'back.out(2.2)' }, i * .1);
      } else {
        tl.to(w, { color: dark, duration: .3, ease: 'none' }, i * .1);
      }
    });
  });
  $$('[data-scrub-chars]').forEach((el) => {
    const chars = splitChars(el);
    gsap.to(chars.filter((c) => !c.closest('.grad')), {
      color: '#fff', ease: 'none', stagger: .02,
      scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 55%', scrub: .5 },
    });
    gsap.from($$('.grad .char', el), {
      opacity: 0, yPercent: 40, ease: 'none', stagger: .04,
      scrollTrigger: { trigger: el, start: 'center 70%', end: 'bottom 55%', scrub: .5 },
    });
  });
}

/* ============================================================
   PANEL HOY: los tiles caen al visor
   ============================================================ */
function today() {
  const tiles = $$('.ttile');
  gsap.from('.today-panel', {
    y: 120, scale: .94, opacity: 0, ease: 'power3.out', duration: 1.2,
    scrollTrigger: { trigger: '.today', start: 'top 85%' },
  });
  gsap.from(tiles, {
    y: -260, rotation: (i) => [-14, 9, -6, 12, -9][i % 5], opacity: 0,
    duration: 1.2, ease: 'bounce.out', stagger: .09,
    scrollTrigger: {
      trigger: '.today-panel', start: 'top 70%',
      onEnter: () => $$('.today [data-count]').forEach((el, i) => countUp(el, { delay: .4 + i * .1 })),
    },
  });
  gsap.fromTo('.today-ruler-sel', { left: '0%', width: '20%' }, {
    left: '30%', width: '55%', ease: 'none',
    scrollTrigger: { trigger: '.today', start: 'top 70%', end: 'bottom 30%', scrub: 1 },
  });
}

/* ============================================================
   STORY: teléfono fijo, Vende. Cobra. Cuadra.
   ============================================================ */
function story() {
  const screens = ['.screen-intro', '.screen-pos', '.screen-pay', '.screen-close'].map((s) => $(s));
  gsap.set(screens.slice(1), { autoAlpha: 0, y: 30 });
  const mobile = innerWidth < 640;

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: { trigger: '.story', start: 'top top', end: '+=360%', pin: '.story-pin', scrub: 1, anticipatePin: 1 },
  });
  tl.fromTo('#phone', { scale: mobile ? 1.25 : 1.9, yPercent: mobile ? 12 : 42 }, { scale: 1, yPercent: 0, duration: 1.2 })
    .fromTo('.phone-glow', { opacity: .3 }, { opacity: 1, duration: 1.2 }, '<')
    // Vende
    .to(screens[0], { autoAlpha: 0, y: -30, duration: .4 })
    .to(screens[1], { autoAlpha: 1, y: 0, duration: .5 }, '<+.15')
    .fromTo('.sw-1', { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: .6 }, '<')
    .fromTo('.cap-1', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .4 }, '<')
    .from('.screen-pos .ps-line', { opacity: 0, x: -20, stagger: .15, duration: .4 }, '<+.2')
    .to({}, { duration: .5 })
    // Cobra
    .to('.cap-1', { opacity: 0, y: -10, duration: .3 })
    .to(screens[1], { autoAlpha: 0, y: -30, duration: .4 }, '<')
    .to(screens[2], { autoAlpha: 1, y: 0, duration: .5 }, '<+.15')
    .to('.sw-1', { opacity: mobile ? 0 : .15, duration: .5 }, '<')
    .fromTo('.sw-2', { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: .6 }, '<')
    .fromTo('.cap-2', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .4 }, '<')
    .from('.screen-pay .pm', { opacity: 0, y: 16, stagger: .15, duration: .4 }, '<+.2')
    .to({}, { duration: .5 })
    // Cuadra
    .to('.cap-2', { opacity: 0, y: -10, duration: .3 })
    .to(screens[2], { autoAlpha: 0, y: -30, duration: .4 }, '<')
    .to(screens[3], { autoAlpha: 1, y: 0, duration: .5 }, '<+.15')
    .to('.sw-2', { opacity: mobile ? 0 : .15, duration: .5 }, '<')
    .fromTo('.sw-3', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: .6 }, '<')
    .fromTo('.cap-3', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .4 }, '<')
    .from('.close-z', { scale: 0, rotation: -90, duration: .5, ease: 'back.out(2)' }, '<+.1')
    .from('.close-list > div', { opacity: 0, x: 20, stagger: .12, duration: .35 }, '<+.2')
    .to({}, { duration: .6 });
}

/* ============================================================
   FEATURES
   ============================================================ */
function features() {
  // Paneles que suben con un leve giro 3D.
  $$('.feature-visual > *').forEach((el) => {
    gsap.from(el, {
      y: 110, rotationX: 12, opacity: 0, transformPerspective: 1200, transformOrigin: '50% 100%',
      duration: 1.3, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 88%' },
    });
  });
  $$('.feature .ticks li').forEach((li) => {
    gsap.from(li, { x: -20, opacity: 0, duration: .8, ease: 'power3.out', scrollTrigger: { trigger: li, start: 'top 92%' } });
  });

  // Inventario: filas, conteo de stock y traslado entre sucursales.
  gsap.from('.inv-row', {
    x: 40, opacity: 0, stagger: .1, duration: .9, ease: 'power3.out',
    scrollTrigger: {
      trigger: '#invPanel', start: 'top 75%',
      onEnter: () => $$('[data-stock]').forEach((el) => {
        const o = { v: 0 };
        gsap.to(o, { v: +el.dataset.stock, duration: 1.4, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(o.v); } });
      }),
    },
  });
  const tr = gsap.timeline({ repeat: -1, repeatDelay: .6, paused: true });
  tr.fromTo('.it-box', { left: '0%', xPercent: 0 }, { left: '100%', xPercent: -100, duration: 1.8, ease: 'power2.inOut' })
    .to('.it-track i', { background: 'rgba(76,213,255,1)', stagger: .12, duration: .2, yoyo: true, repeat: 1 }, 0);
  ScrollTrigger.create({ trigger: '#invPanel', start: 'top bottom', end: 'bottom top', onToggle: (s) => (s.isActive ? tr.play() : tr.pause()) });

  // Catálogo: tres ventas en el mostrador agotan el producto en la web.
  const stockEl = $('#syncStock');
  const badge = $('#catBadge');
  const card = $('#catCard');
  const btn = $('#syncBtn');
  const sale = gsap.timeline({
    scrollTrigger: { trigger: '#sync', start: 'top 70%', end: 'bottom 25%', scrub: .8 },
  });
  [2, 1, 0].forEach((left) => {
    sale.call(() => btn.classList.remove('done'))
      .fromTo('.sync-qty', { scale: 1 }, { scale: 1.35, duration: .15, yoyo: true, repeat: 1 })
      .call(() => btn.classList.add('done'))
      .fromTo('.sync-pulse', { left: '0%', opacity: 1 }, { left: '100%', duration: .6, ease: 'power1.inOut' })
      .to('.sync-pulse', { opacity: 0, duration: .1 })
      .call(() => {
        const dir = sale.scrollTrigger?.direction ?? 1;
        const n = dir > 0 ? left : left + 1;
        stockEl.textContent = n;
        badge.textContent = n === 0 ? 'Agotado' : `Quedan ${n}`;
        badge.classList.toggle('out', n === 0);
        card.classList.toggle('sold', n === 0);
      })
      .fromTo('#catCard', { scale: 1 }, { scale: 1.06, duration: .12, yoyo: true, repeat: 1 })
      .to({}, { duration: .35 });
  });

  // Estadísticas: barras y cifras.
  gsap.from('.chart-bars i', {
    scaleY: 0, duration: 1.1, ease: 'expo.out', stagger: .05,
    scrollTrigger: {
      trigger: '#statsPanel', start: 'top 70%',
      onEnter: () => $$('#statsPanel [data-count]').forEach((el, i) => countUp(el, { delay: i * .12 })),
    },
  });
  gsap.from('.split-bar i', { scaleX: 0, duration: 1.2, ease: 'expo.out', stagger: .1, scrollTrigger: { trigger: '.split', start: 'top 85%' } });
}

/* ============================================================
   EN LA TIENDA Y EN LA WEB: fotos que se abren y hacen parallax
   ============================================================ */
function shops() {
  $$('.shot').forEach((shot) => {
    gsap.fromTo($('.shot-media', shot), { clipPath: 'inset(18% 12% 18% 12% round 32px)' }, {
      clipPath: 'inset(0% 0% 0% 0% round 32px)', ease: 'none',
      scrollTrigger: { trigger: shot, start: 'top 95%', end: 'top 35%', scrub: 1 },
    });
    gsap.fromTo($('img', shot), { scale: 1.25, yPercent: -6 }, {
      scale: 1, yPercent: 6, ease: 'none',
      scrollTrigger: { trigger: shot, start: 'top bottom', end: 'bottom top', scrub: true },
    });
    gsap.from($('figcaption', shot), {
      y: 30, opacity: 0, duration: 1, ease: 'expo.out',
      scrollTrigger: { trigger: shot, start: 'top 55%' },
    });
  });
}

/* ============================================================
   BENTO: aparecen en cascada y se inclinan al pasar el mouse
   ============================================================ */
function bento() {
  gsap.from('.all-head > *', { y: 40, opacity: 0, stagger: .1, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.all-head', start: 'top 85%' } });
  ScrollTrigger.batch('.card', {
    start: 'top 90%',
    onEnter: (els) => gsap.fromTo(els, { y: 80, opacity: 0, scale: .96 }, { y: 0, opacity: 1, scale: 1, duration: 1, ease: 'expo.out', stagger: .08, overwrite: true }),
  });
  gsap.set('.card', { opacity: 0 });
  if (!matchMedia('(pointer: fine)').matches) return;
  $$('.card').forEach((card) => {
    const rx = gsap.quickTo(card, 'rotationX', { duration: .6, ease: 'power3' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: .6, ease: 'power3' });
    gsap.set(card, { transformPerspective: 900 });
    card.addEventListener('pointermove', (e) => {
      const b = card.getBoundingClientRect();
      ry(((e.clientX - b.left) / b.width - .5) * 8);
      rx(-((e.clientY - b.top) / b.height - .5) * 8);
    });
    card.addEventListener('pointerleave', () => { rx(0); ry(0); });
  });
}

/* ============================================================
   VISOR: la foto en puntos LED se revela como foto real
   ============================================================ */
function visor() {
  gsap.timeline({ scrollTrigger: { trigger: '.visor-media', start: 'top 75%', end: 'bottom 35%', scrub: 1 } })
    .fromTo('.visor-media', { scale: .9, borderRadius: 60 }, { scale: 1, borderRadius: 32, ease: 'none' }, 0)
    .fromTo('.visor-photo', { clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0%)', ease: 'power1.inOut' }, .15)
    .fromTo('.visor-led', { scale: 1.08 }, { scale: 1, ease: 'none' }, 0);
  gsap.from('.proof', {
    y: 80, opacity: 0, stagger: .12, duration: 1.1, ease: 'expo.out',
    scrollTrigger: { trigger: '.proofs', start: 'top 90%' },
  });
}

/* ============================================================
   CIELO: notificaciones que flotan a distintas profundidades
   ============================================================ */
function sky() {
  gsap.from('.sky-head > *', { y: 50, opacity: 0, stagger: .12, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '.sky', start: 'top 70%' } });
  gsap.fromTo('.sky-orb', { yPercent: 30 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.sky', start: 'top bottom', end: 'bottom bottom', scrub: true } });
  gsap.fromTo('.sky-phone', { y: 120, rotation: -6 }, {
    y: 0, rotation: 0, ease: 'none',
    scrollTrigger: { trigger: '.sky-stage', start: 'top bottom', end: 'center center', scrub: 1 },
  });
  gsap.to('.sky-ring.r1', { rotation: 360, duration: 90, ease: 'none', repeat: -1 });
  $$('.ncard').forEach((card, i) => {
    const depth = +card.dataset.depth || 1;
    gsap.from(card, {
      y: 120 * depth, opacity: 0, scale: .85,
      scrollTrigger: { trigger: '.sky-stage', start: 'top 85%', end: 'center 55%', scrub: 1 },
    });
    gsap.to(card, { y: `+=${8 + i * 2}`, duration: 2.2 + i * .3, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: i * .2 });
  });
}

/* ============================================================
   MARCA BLANCA: la misma app con la marca de cada tienda
   ============================================================ */
function whiteLabel() {
  const brands = [
    { name: 'Roma', domain: 'roma.zetenta.app', color: '#2323FF' },
    { name: 'Lina Boutique', domain: 'tienda.linaboutique.com', color: '#E0457B' },
    { name: 'Verde Café', domain: 'pedidos.verdecafe.com', color: '#0E8A6A' },
    { name: 'Ferre Centro', domain: 'ferrecentro.zetenta.app', color: '#F28C28' },
  ];
  const card = $('#wlCard');
  const sw = $$('.wl-swatches i');
  let i = 0;
  let timer = null;
  const apply = () => {
    const b = brands[i];
    gsap.timeline()
      .to(['#wlName', '#wlDomain', '#wlLogo'], { opacity: 0, y: -6, duration: .2, stagger: .03 })
      .call(() => {
        card.style.setProperty('--brand', b.color);
        $('#wlName').textContent = b.name;
        $('#wlDomain').textContent = b.domain;
        $('#wlLogo').textContent = b.name[0];
        sw.forEach((s, j) => s.classList.toggle('on', j === i));
      })
      .to(['#wlName', '#wlDomain', '#wlLogo'], { opacity: 1, y: 0, duration: .35, stagger: .04 });
  };
  sw[0].classList.add('on');
  ScrollTrigger.create({
    trigger: '.wl', start: 'top 70%', end: 'bottom 20%',
    onToggle: (s) => {
      clearInterval(timer);
      if (s.isActive) timer = setInterval(() => { i = (i + 1) % brands.length; apply(); }, 2200);
    },
  });
  gsap.from('.wl-card', { y: 80, rotation: -4, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: '.wl', start: 'top 75%' } });
  gsap.from('.wl-copy > *', { y: 40, opacity: 0, stagger: .1, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.wl', start: 'top 75%' } });
}

/* ============================================================
   GALERÍA horizontal
   ============================================================ */
function gallery() {
  const track = $('#galleryTrack');
  const dist = () => Math.max(0, track.scrollWidth - innerWidth);
  gsap.to(track, {
    x: () => -dist(), ease: 'none',
    scrollTrigger: { trigger: '.gallery', start: 'top top', end: () => `+=${dist()}`, pin: '.gallery-pin', scrub: 1, invalidateOnRefresh: true, anticipatePin: 1 },
  });
  gsap.from('.gallery-head > *', { y: 50, opacity: 0, stagger: .1, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.gallery', start: 'top 70%' } });
}

/* ============================================================
   CTA: la Z gigante se enciende con el scroll
   ============================================================ */
function cta() {
  const ons = $$('#ctaZ .on').sort((a, b) => a.dataset.i - b.dataset.i);
  gsap.set(ons, { fill: 'rgba(255,255,255,.08)' });
  gsap.to(ons, {
    fill: '#ffffff', stagger: .1, ease: 'none',
    scrollTrigger: { trigger: '.cta', start: 'top 70%', end: 'center 45%', scrub: .5 },
  });
  gsap.from('.cta-copy > *', { y: 60, opacity: 0, stagger: .1, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '.cta', start: 'top 65%' } });
}

/* ============================================================
   FOOTER: el logo gigante se arma cuadro a cuadro
   ============================================================ */
function footer() {
  const rects = $$('.foot-logo rect');
  gsap.timeline({ scrollTrigger: { trigger: '#footMark', start: 'top 92%' } })
    .from(rects, { scale: 0, rotation: 90, duration: .7, ease: 'back.out(2.5)', stagger: .05 })
    .from('.foot-logo path', { opacity: 0, y: 30, duration: 1, ease: 'expo.out' }, '-=.4')
    .from('.foot-glow', { opacity: 0, scaleX: .4, duration: 1.4, ease: 'expo.out' }, '<');
}

/* ============================================================
   Botones magnéticos
   ============================================================ */
function magnetic() {
  if (!matchMedia('(pointer: fine)').matches) return;
  $$('.magnetic').forEach((b) => {
    const x = gsap.quickTo(b, 'x', { duration: .5, ease: 'power3' });
    const y = gsap.quickTo(b, 'y', { duration: .5, ease: 'power3' });
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      x((e.clientX - r.left - r.width / 2) * .3);
      y((e.clientY - r.top - r.height / 2) * .4);
    });
    b.addEventListener('pointerleave', () => { x(0); y(0); });
  });
}

/* ============================================================
   Arranque
   ============================================================ */
paintBrand();
paintIcons();
wireAppLinks();
smoothScroll();
ScrollTrigger.config({ ignoreMobileResize: true });

if (REDUCED) {
  // Sin movimiento: estados finales visibles y nada fijado.
  $('#loader')?.remove();
  document.body.classList.remove('is-loading');
  $$('[data-count]').forEach((el) => { el.dataset.dur = 0; countUp(el, { duration: 0 }); });
  $$('#ctaZ .on').forEach((r) => r.setAttribute('fill', '#fff'));
  gsap.set('.screen-intro, .screen-pay, .screen-close', { autoAlpha: 0 });
  gsap.set('.sw-1, .cap-1', { opacity: 1 });
  nav();
} else {
  history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  heroMotion();
  marquee();
  scrubWords();
  today();
  story();
  shops();
  features();
  bento();
  visor();
  sky();
  whiteLabel();
  gallery();
  cta();
  footer();
  magnetic();
  nav(); // al final: sus disparadores dependen del espacio que agregan las secciones fijadas
  runLoader();
}
