(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- */
  /* Preloader                                                         */
  /* ---------------------------------------------------------------- */
  window.addEventListener('load', () => {
    const pre = document.getElementById('preloader');
    if (!pre) return;
    setTimeout(() => pre.classList.add('done'), 400);
  });

  /* ---------------------------------------------------------------- */
  /* Header scroll state + back-to-top                                 */
  /* ---------------------------------------------------------------- */
  const header = document.getElementById('siteHeader');
  const backToTop = document.getElementById('backToTop');

  function onScroll() {
    const y = window.scrollY;
    if (header) header.classList.toggle('scrolled', y > 40);
    if (backToTop) backToTop.classList.toggle('visible', y > 600);
  }
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------------------------------------------------------- */
  /* Mobile nav toggle                                                  */
  /* ---------------------------------------------------------------- */
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');

  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const open = mainNav.classList.toggle('open');
      navToggle.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });

    mainNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mainNav.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Scroll reveal (IntersectionObserver)                               */
  /* ---------------------------------------------------------------- */
  const revealEls = document.querySelectorAll('.reveal-up');
  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in-view'));
  }

  /* ---------------------------------------------------------------- */
  /* Animated stat counters                                            */
  /* ---------------------------------------------------------------- */
  const counters = document.querySelectorAll('.stat-number');
  function animateCounter(el) {
    const target = parseFloat(el.dataset.count || '0');
    const suffix = el.dataset.suffix || '';
    const duration = 1600;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(target * eased);
      el.textContent = value + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if (counters.length) {
    if ('IntersectionObserver' in window) {
      const counterObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateCounter(entry.target);
              counterObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.6 }
      );
      counters.forEach((el) => counterObserver.observe(el));
    } else {
      counters.forEach((el) => animateCounter(el));
    }
  }

  /* ---------------------------------------------------------------- */
  /* Process progress line                                             */
  /* ---------------------------------------------------------------- */
  const processProgress = document.getElementById('processProgress');
  const processTrack = document.querySelector('.process-track');
  if (processProgress && processTrack && 'IntersectionObserver' in window) {
    const po = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            processProgress.style.width = '100%';
            po.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    po.observe(processTrack);
  }

  /* ---------------------------------------------------------------- */
  /* 3D tilt effect on cards                                            */
  /* ---------------------------------------------------------------- */
  const tiltCards = document.querySelectorAll('[data-tilt]');
  if (!prefersReducedMotion && window.matchMedia('(hover: hover)').matches) {
    tiltCards.forEach((card) => {
      const maxTilt = 8;

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(1000px) rotateY(${x * maxTilt * 2}deg) rotateX(${-y * maxTilt * 2}deg) translateZ(6px)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateY(0deg) rotateX(0deg) translateZ(0)';
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Contact form (front-end only — replace action with real endpoint) */
  /* ---------------------------------------------------------------- */
  const form = document.getElementById('contactForm');
  const formNote = document.getElementById('formNote');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (formNote) {
        formNote.textContent = 'Grazie! Il tuo messaggio è stato preparato: collega il form a un servizio di invio email per completare l\'integrazione.';
      }
      form.reset();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Footer year                                                       */
  /* ---------------------------------------------------------------- */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
