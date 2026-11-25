const pendingThemes = new WeakMap();
const counters = new WeakMap();

export function setRollingNumber(element, value, options = {}, environment = globalThis) {
  const window = environment.window || environment;
  const format = options.format || ((number) => String(number));
  const suffix = options.suffix || "";
  const duration = options.duration || 650;
  const previous = counters.get(element);
  const finalText = `${format(value)}${suffix}`;
  if (previous?.target === value && element.textContent === finalText) return;
  if (previous?.frame !== undefined) window.cancelAnimationFrame(previous.frame);
  const initial = previous?.display ?? 0;
  element.textContent = finalText;
  const entry = { target: value, display: initial, frame: undefined };
  counters.set(element, entry);
  const finish = () => {
    entry.display = value;
    entry.frame = undefined;
    element.removeAttribute("data-motion-value");
    element.classList.remove("is-counting");
  };
  if (!window.requestAnimationFrame || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || initial === value) {
    finish();
    return;
  }
  const start = window.performance.now();
  element.setAttribute("data-motion-value", `${format(initial)}${suffix}`);
  element.classList.add("is-counting");
  const tick = (timestamp) => {
    if (counters.get(element) !== entry) return;
    const progress = Math.max(0, Math.min(1, (timestamp - start) / duration));
    entry.display = Math.round(initial + (value - initial) * (1 - (1 - progress) ** 3));
    element.setAttribute("data-motion-value", `${format(entry.display)}${suffix}`);
    if (progress < 1) entry.frame = window.requestAnimationFrame(tick);
    else finish();
  };
  entry.frame = window.requestAnimationFrame(tick);
}

export function switchThemeWithMotion(applyTheme, button, environment = globalThis) {
  const document = environment.document;
  const window = environment.window || environment;
  const currentTheme = pendingThemes.get(document)?.theme || document.documentElement.dataset.theme;
  const request = { theme: currentTheme === "light" ? "dark" : "light" };
  pendingThemes.set(document, request);
  const update = () => {
    if (pendingThemes.get(document) !== request) return;
    pendingThemes.delete(document);
    applyTheme(request.theme);
  };
  if (!document.startViewTransition || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }

  const bounds = button.getBoundingClientRect();
  const centerX = Math.max(0, Math.min(window.innerWidth, bounds.left + bounds.width / 2));
  const centerY = Math.max(0, Math.min(window.innerHeight, bounds.top + bounds.height / 2));
  const radius = Math.hypot(Math.max(centerX, window.innerWidth - centerX), Math.max(centerY, window.innerHeight - centerY));
  document.documentElement.style.setProperty("--theme-reveal-x", `${centerX}px`);
  document.documentElement.style.setProperty("--theme-reveal-y", `${centerY}px`);
  document.documentElement.style.setProperty("--theme-reveal-radius", `${radius}px`);
  try {
    document.startViewTransition(update).finished.catch(() => {});
  } catch {
    update();
  }
}