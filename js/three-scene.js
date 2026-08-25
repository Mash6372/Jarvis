import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const ACCENT = 0x69d1ca;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/* ---------------------------------------------------------------------- */
/* HERO SCENE — rotating geometric core + drifting particle field          */
/* ---------------------------------------------------------------------- */
function initHero() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 9);

  const renderer = makeRenderer(canvas);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // --- Central icosahedral core (wireframe + inner solid) ---
  const coreGroup = new THREE.Group();

  const icoGeo = new THREE.IcosahedronGeometry(2.1, 1);
  const icoMat = new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true, transparent: true, opacity: 0.55 });
  const ico = new THREE.Mesh(icoGeo, icoMat);
  coreGroup.add(ico);

  const innerGeo = new THREE.IcosahedronGeometry(1.35, 0);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.14 });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  coreGroup.add(inner);

  const ringGeo = new THREE.TorusGeometry(3.1, 0.008, 8, 120);
  const ringMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 });
  const ring1 = new THREE.Mesh(ringGeo, ringMat);
  ring1.rotation.x = Math.PI / 2.4;
  const ring2 = ring1.clone();
  ring2.rotation.x = Math.PI / 1.6;
  ring2.rotation.y = 0.6;
  coreGroup.add(ring1, ring2);

  coreGroup.position.set(2.4, 0, 0);
  scene.add(coreGroup);

  // --- Particle field (eco motif: drifting points) ---
  const PARTICLE_COUNT = 260;
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const speeds = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 22;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    speeds[i] = 0.15 + Math.random() * 0.35;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: ACCENT,
    size: 0.045,
    transparent: true,
    opacity: 0.55,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  resize();
  window.addEventListener('resize', resize);

  // Mouse parallax
  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  const clock = new THREE.Clock();
  let raf;

  function animate() {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const dt = clock.getDelta();

    coreGroup.rotation.y += dt * 0.18;
    coreGroup.rotation.x = Math.sin(t * 0.2) * 0.15;
    ring1.rotation.z += dt * 0.12;
    ring2.rotation.z -= dt * 0.09;

    const posAttr = particleGeo.attributes.position;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let y = posAttr.getY(i) + speeds[i] * dt;
      if (y > 7) y = -7;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;

    camera.position.x += (mouse.x * 1.1 - camera.position.x) * 0.03;
    camera.position.y += (-mouse.y * 0.7 - camera.position.y) * 0.03;
    camera.lookAt(1.2, 0, 0);

    renderer.render(scene, camera);
  }

  if (prefersReducedMotion) {
    renderer.render(scene, camera);
  } else {
    animate();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!prefersReducedMotion) animate();
  });
}

/* ---------------------------------------------------------------------- */
/* CTA SCENE — soft ambient torus-knot backdrop                            */
/* ---------------------------------------------------------------------- */
function initCTA() {
  const canvas = document.getElementById('cta-canvas');
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 7);

  const renderer = makeRenderer(canvas);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const geo = new THREE.TorusKnotGeometry(1.6, 0.35, 140, 16, 2, 3);
  const mat = new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true, transparent: true, opacity: 0.22 });
  const knot = new THREE.Mesh(geo, mat);
  scene.add(knot);

  let observerVisible = true;
  const io = new IntersectionObserver(([entry]) => { observerVisible = entry.isIntersecting; }, { threshold: 0.05 });
  io.observe(canvas);

  const clock = new THREE.Clock();
  let raf;
  function animate() {
    raf = requestAnimationFrame(animate);
    if (!observerVisible) return;
    const dt = clock.getDelta();
    knot.rotation.x += dt * 0.09;
    knot.rotation.y += dt * 0.14;
    renderer.render(scene, camera);
  }

  if (prefersReducedMotion) {
    renderer.render(scene, camera);
  } else {
    animate();
  }
}

initHero();
initCTA();
