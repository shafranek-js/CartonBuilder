import { describe, expect, it, beforeEach } from 'vitest';
import { enhanceSlider, initSliderSteppers } from '../../src/ui/SliderStepper.js';

function createMockElement(tagName) {
  const listeners = {};
  const children = [];
  const attrs = {};

  const el = {
    tagName: tagName.toUpperCase(),
    type: tagName === 'input' ? 'range' : 'button',
    value: '5',
    min: '0',
    max: '10',
    step: '1',
    disabled: false,
    dataset: {},
    parentElement: null,
    children,
    listeners,
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => attrs[k] || null,
    appendChild: (child) => {
      child.parentElement = el;
      children.push(child);
      return child;
    },
    insertBefore: (newChild, refChild) => {
      newChild.parentElement = el;
      const idx = children.indexOf(refChild);
      if (idx >= 0) {
        children.splice(idx, 0, newChild);
      } else {
        children.push(newChild);
      }
      return newChild;
    },
    querySelector: (selector) => {
      if (selector === '.slider-step-dec') return children.find(c => c.className?.includes('slider-step-dec'));
      if (selector === '.slider-step-inc') return children.find(c => c.className?.includes('slider-step-inc'));
      if (selector === '.slider-track-wrap') return children.find(c => c.className?.includes('slider-track-wrap'));
      return null;
    },
    querySelectorAll: (selector) => {
      const res = [];
      const search = (node) => {
        if (node.type === 'range') res.push(node);
        if (node.children) node.children.forEach(search);
      };
      search(el);
      return res;
    },
    addEventListener: (evt, handler) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(handler);
    },
    dispatchEvent: (evt) => {
      const list = listeners[evt.type] || [];
      list.forEach(fn => fn(evt));
      return true;
    },
    click: () => {
      const list = listeners['click'] || [];
      list.forEach(fn => fn({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} }));
    },
  };
  return el;
}

function createMockDocument() {
  return {
    createElement: (tagName) => createMockElement(tagName),
  };
}

describe('SliderStepper', () => {
  let mockDoc;
  let container;
  let range;

  beforeEach(() => {
    mockDoc = createMockDocument();
    container = mockDoc.createElement('div');
    range = mockDoc.createElement('input');
    container.appendChild(range);
  });

  it('enhances range input with [-] and [+] stepper buttons', () => {
    enhanceSlider(range, mockDoc);
    expect(range.dataset.stepperEnhanced).toBe('true');
    const wrap = container.querySelector('.slider-track-wrap');
    expect(wrap).not.toBeNull();
    const decBtn = wrap.querySelector('.slider-step-dec');
    const incBtn = wrap.querySelector('.slider-step-inc');
    expect(decBtn).not.toBeNull();
    expect(incBtn).not.toBeNull();
    expect(decBtn.textContent).toBe('−');
    expect(incBtn.textContent).toBe('+');
  });

  it('increments and decrements slider value on button click', () => {
    enhanceSlider(range, mockDoc);
    const wrap = container.querySelector('.slider-track-wrap');
    const decBtn = wrap.querySelector('.slider-step-dec');
    const incBtn = wrap.querySelector('.slider-step-inc');

    let inputFired = false;
    let changeFired = false;
    range.addEventListener('input', () => { inputFired = true; });
    range.addEventListener('change', () => { changeFired = true; });

    incBtn.click();
    expect(range.value).toBe('6');
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);

    decBtn.click();
    expect(range.value).toBe('5');
  });

  it('respects decimal step precision', () => {
    range.min = '0.05';
    range.max = '2.0';
    range.step = '0.01';
    range.value = '0.35';
    enhanceSlider(range, mockDoc);

    const wrap = container.querySelector('.slider-track-wrap');
    const incBtn = wrap.querySelector('.slider-step-inc');
    const decBtn = wrap.querySelector('.slider-step-dec');

    incBtn.click();
    expect(range.value).toBe('0.36');

    decBtn.click();
    expect(range.value).toBe('0.35');
  });

  it('disables decrement at min and increment at max', () => {
    range.min = '0';
    range.max = '10';
    range.value = '0';
    enhanceSlider(range, mockDoc);

    const wrap = container.querySelector('.slider-track-wrap');
    const decBtn = wrap.querySelector('.slider-step-dec');
    const incBtn = wrap.querySelector('.slider-step-inc');

    expect(decBtn.disabled).toBe(true);
    expect(incBtn.disabled).toBe(false);

    range.value = '10';
    range.dispatchEvent({ type: 'input' });

    expect(decBtn.disabled).toBe(false);
    expect(incBtn.disabled).toBe(true);
  });

  it('initSliderSteppers enhances all range inputs in a container', () => {
    const range2 = mockDoc.createElement('input');
    container.appendChild(range2);

    initSliderSteppers(container, mockDoc);

    expect(range.dataset.stepperEnhanced).toBe('true');
    expect(range2.dataset.stepperEnhanced).toBe('true');
  });
});
