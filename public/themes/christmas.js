const style = document.createElement('link');
style.rel = 'stylesheet';
style.href = '/themes/christmas.css';
document.head.append(style);
document.body.classList.add('theme-christmas');

const banner = document.createElement('div');
banner.className = 'holiday-banner';
banner.textContent = 'Happy holidays from Sunspec';
document.querySelector('.content')?.prepend(banner);

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const snow = document.createElement('canvas');
  snow.className = 'holiday-snow';
  document.body.append(snow);
  const context = snow.getContext('2d');
  const flakes = Array.from({ length: 40 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 1 + Math.random() * 2,
    s: 0.15 + Math.random() * 0.45,
  }));
  function frame() {
    snow.width = window.innerWidth;
    snow.height = window.innerHeight;
    context.clearRect(0, 0, snow.width, snow.height);
    context.fillStyle = 'rgba(255,255,255,.8)';
    for (const flake of flakes) {
      flake.y += flake.s / 100;
      if (flake.y > 1) flake.y = 0;
      context.beginPath();
      context.arc(flake.x * snow.width, flake.y * snow.height, flake.r, 0, Math.PI * 2);
      context.fill();
    }
    window.requestAnimationFrame(frame);
  }
  frame();
}
