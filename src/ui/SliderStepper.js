/**
 * Utility to enhance range inputs with [-] and [+] micro-stepper buttons.
 */

function countDecimals(value) {
  if (Math.floor(value) === value) return 0;
  const str = String(value);
  if (str.includes('e-')) {
    const [, exp] = str.split('e-');
    return parseInt(exp, 10);
  }
  return str.split('.')[1]?.length || 0;
}

function clampAndRound(val, min, max, step) {
  let clamped = Math.max(min, Math.min(max, val));
  const decimals = countDecimals(step);
  if (decimals > 0) {
    clamped = parseFloat(clamped.toFixed(decimals));
  } else {
    clamped = Math.round(clamped);
  }
  return clamped;
}

export function enhanceSlider(rangeInput, documentRef = rangeInput?.ownerDocument || (typeof document !== 'undefined' ? document : null)) {
  if (!rangeInput || rangeInput.type !== 'range') return;
  if (rangeInput.dataset?.stepperEnhanced === 'true') {
    updateButtonStates(rangeInput);
    return;
  }

  const min = rangeInput.min !== '' && rangeInput.min != null ? parseFloat(rangeInput.min) : 0;
  const max = rangeInput.max !== '' && rangeInput.max != null ? parseFloat(rangeInput.max) : 100;
  const step = rangeInput.step !== '' && rangeInput.step !== 'any' && rangeInput.step != null ? parseFloat(rangeInput.step) : 1;

  const parent = rangeInput.parentElement;
  if (!parent || !documentRef?.createElement) return;

  const wrap = documentRef.createElement('div');
  wrap.className = 'slider-track-wrap';

  const decBtn = documentRef.createElement('button');
  decBtn.type = 'button';
  decBtn.className = 'slider-step-btn slider-step-dec';
  decBtn.setAttribute('aria-label', 'Decrement');
  decBtn.setAttribute('tabindex', '-1');
  decBtn.textContent = '−';

  const incBtn = documentRef.createElement('button');
  incBtn.type = 'button';
  incBtn.className = 'slider-step-btn slider-step-inc';
  incBtn.setAttribute('aria-label', 'Increment');
  incBtn.setAttribute('tabindex', '-1');
  incBtn.textContent = '+';

  parent.insertBefore(wrap, rangeInput);
  wrap.appendChild(decBtn);
  wrap.appendChild(rangeInput);
  wrap.appendChild(incBtn);

  if (rangeInput.dataset) {
    rangeInput.dataset.stepperEnhanced = 'true';
  }

  function stepValue(direction) {
    if (rangeInput.disabled) return;
    const currentMin = rangeInput.min !== '' && rangeInput.min != null ? parseFloat(rangeInput.min) : min;
    const currentMax = rangeInput.max !== '' && rangeInput.max != null ? parseFloat(rangeInput.max) : max;
    const currentStep = rangeInput.step !== '' && rangeInput.step !== 'any' && rangeInput.step != null ? parseFloat(rangeInput.step) : step;
    const currentVal = parseFloat(rangeInput.value) || 0;

    const newVal = clampAndRound(currentVal + direction * currentStep, currentMin, currentMax, currentStep);
    if (newVal !== currentVal) {
      rangeInput.value = String(newVal);
      if (typeof Event !== 'undefined' && rangeInput.dispatchEvent) {
        rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
        rangeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    updateStates();
  }

  function updateStates() {
    const currentMin = rangeInput.min !== '' && rangeInput.min != null ? parseFloat(rangeInput.min) : min;
    const currentMax = rangeInput.max !== '' && rangeInput.max != null ? parseFloat(rangeInput.max) : max;
    const currentVal = parseFloat(rangeInput.value) || 0;

    const isDisabled = rangeInput.disabled;
    decBtn.disabled = isDisabled || currentVal <= currentMin;
    incBtn.disabled = isDisabled || currentVal >= currentMax;
  }

  decBtn.addEventListener('click', (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    stepValue(-1);
  });

  incBtn.addEventListener('click', (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    stepValue(1);
  });

  if (rangeInput.addEventListener) {
    rangeInput.addEventListener('input', updateStates);
    rangeInput.addEventListener('change', updateStates);
  }

  updateStates();
  rangeInput._updateStepperStates = updateStates;
}

export function updateButtonStates(rangeInput) {
  if (rangeInput && typeof rangeInput._updateStepperStates === 'function') {
    rangeInput._updateStepperStates();
  }
}

export function initSliderSteppers(container = (typeof document !== 'undefined' ? document : null), documentRef = container?.ownerDocument || (typeof document !== 'undefined' ? document : null)) {
  if (!container || !container.querySelectorAll) return;
  const sliders = container.querySelectorAll('input[type="range"]');
  for (const slider of sliders) {
    enhanceSlider(slider, documentRef);
  }
}
