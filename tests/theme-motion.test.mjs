import test from "node:test";
import assert from "node:assert/strict";
import { setRollingNumber, switchThemeWithMotion } from "../js/theme-motion.js";

function counterFixture(reduced = false) {
  const attributes = new Map();
  const classes = new Set();
  const frames = new Map();
  let nextFrame = 0;
  const element = {
    textContent: "—",
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
  };
  const window = {
    performance: { now: () => 0 },
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  return { element, attributes, classes, frames, environment: { window } };
}

test("rolling counters keep final text stable while visual numbers animate", () => {
  const data = counterFixture();
  setRollingNumber(data.element, 200, { suffix: "%" }, data.environment);
  assert.equal(data.element.textContent, "200%");
  assert.equal(data.attributes.get("data-motion-value"), "0%");
  assert.ok(data.classes.has("is-counting"));
  const firstFrame = [...data.frames.values()][0];
  data.frames.clear();
  firstFrame(325);
  assert.equal(data.element.textContent, "200%");
  assert.ok(parseInt(data.attributes.get("data-motion-value"), 10) > 0);
  const lastFrame = [...data.frames.values()][0];
  data.frames.clear();
  lastFrame(650);
  assert.equal(data.element.textContent, "200%");
  assert.equal(data.attributes.has("data-motion-value"), false);
  assert.equal(data.classes.has("is-counting"), false);
});

test("rolling counters respect reduced motion and skip unchanged values", () => {
  const data = counterFixture(true);
  setRollingNumber(data.element, 42, {}, data.environment);
  assert.equal(data.element.textContent, "42");
  assert.equal(data.frames.size, 0);
  setRollingNumber(data.element, 42, {}, data.environment);
  assert.equal(data.frames.size, 0);
});

test("rolling counters cancel stale frames when a new value arrives", () => {
  const data = counterFixture();
  setRollingNumber(data.element, 100, {}, data.environment);
  const initialFrame = [...data.frames.values()][0];
  data.frames.clear();
  initialFrame(325);
  const staleFrame = [...data.frames.values()][0];
  setRollingNumber(data.element, 20, {}, data.environment);
  assert.equal(data.element.textContent, "20");
  assert.equal(data.frames.size, 1);
  const latestVisual = data.attributes.get("data-motion-value");
  staleFrame(500);
  assert.equal(data.attributes.get("data-motion-value"), latestVisual);
  const latestFrame = [...data.frames.values()][0];
  latestFrame(650);
  assert.equal(data.element.textContent, "20");
  assert.equal(data.attributes.has("data-motion-value"), false);
});

function fixture({ reduced = false, supported = true } = {}) {
  const properties = new Map();
  const root = { dataset: { theme: "light" }, style: { setProperty: (name, value) => properties.set(name, value) } };
  const environment = { document: { documentElement: root }, window: { innerWidth: 1000, innerHeight: 500, matchMedia: () => ({ matches: reduced }) } };
  let transitions = 0;
  if (supported) environment.document.startViewTransition = (update) => { transitions += 1; update(); return { finished: Promise.resolve() }; };
  const button = { getBoundingClientRect: () => ({ left: 900, top: 20, width: 40, height: 40 }) };
  const themes = [];
  return { environment, button, properties, themes, applyTheme: (theme) => themes.push(theme), transitionCount: () => transitions };
}

test("reveals the next theme from the theme control", () => {
  const data = fixture();
  switchThemeWithMotion(data.applyTheme, data.button, data.environment);
  assert.deepEqual(data.themes, ["dark"]);
  assert.equal(data.transitionCount(), 1);
  assert.equal(data.properties.get("--theme-reveal-x"), "920px");
  assert.equal(data.properties.get("--theme-reveal-y"), "40px");
  assert.ok(parseFloat(data.properties.get("--theme-reveal-radius")) > 1000);
});

test("changes theme immediately when reduced motion is requested or transitions are unsupported", () => {
  for (const options of [{ reduced: true }, { supported: false }]) {
    const data = fixture(options);
    switchThemeWithMotion(data.applyTheme, data.button, data.environment);
    assert.deepEqual(data.themes, ["dark"]);
    assert.equal(data.transitionCount(), 0);
    assert.equal(data.properties.size, 0);
  }
});

test("rapid clicks apply the latest requested theme when callbacks are delayed", () => {
  const data = fixture();
  const callbacks = [];
  data.environment.document.startViewTransition = (update) => { callbacks.push(update); return { finished: Promise.resolve() }; };
  switchThemeWithMotion(data.applyTheme, data.button, data.environment);
  switchThemeWithMotion(data.applyTheme, data.button, data.environment);
  callbacks[0]();
  callbacks[1]();
  assert.deepEqual(data.themes, ["light"]);
});