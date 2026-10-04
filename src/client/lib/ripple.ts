/**
 * Delegated Material touch ripple for elements with [data-ripple].
 * Like the platform ripple it grows for 225ms while the pointer is down and
 * fades out over 150ms once released, finishing its growth as it fades.
 */
export const installRipple = (): (() => void) => {
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (document.documentElement.dataset.motion === 'reduced') return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-ripple]'
    );
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const size = Math.hypot(rect.width, rect.height) * 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.appendChild(ripple);

    const release = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      const from = getComputedStyle(ripple).opacity;
      const fade = ripple.animate([{ opacity: from }, { opacity: 0 }], {
        duration: 150,
        easing: 'linear',
        fill: 'forwards',
      });
      fade.onfinish = () => ripple.remove();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  };
  document.addEventListener('pointerdown', onDown, { passive: true });
  return () => document.removeEventListener('pointerdown', onDown);
};
