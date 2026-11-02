// Canvas creation, swappable so the same poster code also runs in Node (the
// family-field-guide skill sets a factory backed by @napi-rs/canvas).

let factory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function setCanvasFactory(fn) {
  factory = fn;
}

export function makeCanvas(w, h) {
  return factory(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}
